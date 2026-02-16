use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

use aes_gcm::aead::AeadInPlace;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use rand::RngCore;

use crate::header::{
    self, ContainerHeader, KDF_ID_ARGON2ID, NONCE_LEN, SALT_LEN, TAG_LEN, VERSION, CHUNK_SIZE,
};
use crate::kdf::{self, KdfParams};
use crate::progress;

/// Options for encryption.
pub struct EncryptOptions {
    pub input_path: String,
    pub output_path: String,
    pub passphrase: Vec<u8>,
    pub time_cost: u32,
    pub memory_cost_kib: u32,
    pub parallelism: u32,
    pub store_filename: bool,
}

/// Perform streaming chunked encryption of the input file and write the
/// gtkrypt container to the output path.
///
/// The file is split into 64 KiB chunks, each independently encrypted with
/// AES-256-GCM using a derived per-chunk nonce. This keeps peak memory usage
/// bounded regardless of input file size.
pub fn encrypt(opts: &EncryptOptions) -> Result<(), EncryptError> {
    // 1. Generate random salt and nonce
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    let mut rng = rand::thread_rng();
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    // 2. Derive key via Argon2id
    let kdf_params = KdfParams {
        time_cost: opts.time_cost,
        memory_cost_kib: opts.memory_cost_kib,
        parallelism: opts.parallelism,
    };

    progress::emit_progress("kdf", 0, 0);

    let key = kdf::derive_key(&opts.passphrase, &salt, &kdf_params)
        .map_err(|e| EncryptError::Internal(format!("KDF failed: {}", e)))?;

    progress::emit_progress("kdf", 1, 1);

    // 3. Get input file size without reading the whole file
    let input_metadata = fs::metadata(&opts.input_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            EncryptError::Permission(format!("Cannot read input file: {}", e))
        } else {
            EncryptError::Internal(format!("Failed to stat input file: {}", e))
        }
    })?;
    let input_size = input_metadata.len();

    // Guard against nonce reuse: chunk_index is u32, so we can have at most
    // u32::MAX chunks. Reject files that would exceed this limit.
    let max_input_size: u64 = (u32::MAX as u64) * (CHUNK_SIZE as u64);
    if input_size > max_input_size {
        return Err(EncryptError::Internal(format!(
            "File too large: {} bytes exceeds maximum of {} bytes",
            input_size, max_input_size
        )));
    }

    #[cfg(unix)]
    let mode = {
        use std::os::unix::fs::PermissionsExt;
        Some(input_metadata.permissions().mode() & 0o7777)
    };

    #[cfg(not(unix))]
    let mode = None;

    // 4. Determine optional original filename
    let filename = if opts.store_filename {
        Path::new(&opts.input_path)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
    } else {
        None
    };

    // 5. Build header
    //    ciphertext_length = original file size (each chunk's ciphertext
    //    is the same length as its plaintext; tags are additional).
    let container_header = ContainerHeader {
        version: VERSION,
        kdf_id: KDF_ID_ARGON2ID,
        kdf_params: kdf_params.clone(),
        salt,
        nonce: nonce_bytes,
        filename,
        mode,
        original_file_size: input_size,
        ciphertext_length: input_size,
    };

    let header_bytes = header::encode_header(&container_header);
    let aad = header::extract_aad(&header_bytes).to_vec();

    // 6. Initialize cipher
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| EncryptError::Internal(format!("Failed to initialize cipher: {}", e)))?;

    // 7. Open input file with BufReader
    let input_file = fs::File::open(&opts.input_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            EncryptError::Permission(format!("Cannot read input file: {}", e))
        } else {
            EncryptError::Internal(format!("Failed to open input file: {}", e))
        }
    })?;
    let mut reader = BufReader::new(input_file);

    // 8. Open temp output file with BufWriter
    let output_dir = Path::new(&opts.output_path)
        .parent()
        .unwrap_or(Path::new("."));

    let temp_file = tempfile::NamedTempFile::new_in(output_dir).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            EncryptError::Permission(format!("Cannot write to output directory: {}", e))
        } else {
            EncryptError::Internal(format!("Failed to create temp file: {}", e))
        }
    })?;

    // Set restrictive permissions (0600) before writing content
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        fs::set_permissions(temp_file.path(), perms).map_err(|e| {
            EncryptError::Internal(format!("Failed to set temp file permissions: {}", e))
        })?;
    }

    let mut writer = BufWriter::new(temp_file.as_file());

    // 9. Write header
    writer.write_all(&header_bytes).map_err(|e| {
        EncryptError::Internal(format!("Failed to write header: {}", e))
    })?;

    // 10. Stream chunks: read CHUNK_SIZE, encrypt, write ciphertext + tag
    progress::emit_progress("encrypt", 0, input_size);

    let mut chunk_buf = vec![0u8; CHUNK_SIZE];
    let mut chunk_index: u32 = 0;
    let mut bytes_processed: u64 = 0;

    loop {
        let bytes_read = read_exact_or_eof(&mut reader, &mut chunk_buf)?;
        if bytes_read == 0 {
            break;
        }

        let chunk_data = &mut chunk_buf[..bytes_read];

        // Derive per-chunk nonce and AAD
        let chunk_nonce_bytes = header::derive_chunk_nonce(&nonce_bytes, chunk_index);
        let chunk_nonce = Nonce::from_slice(&chunk_nonce_bytes);
        let chunk_aad = header::build_chunk_aad(&aad, chunk_index);

        // Encrypt in place, get detached tag
        let tag = cipher
            .encrypt_in_place_detached(chunk_nonce, &chunk_aad, chunk_data)
            .map_err(|e| EncryptError::Internal(format!("Encryption failed at chunk {}: {}", chunk_index, e)))?;

        // Write ciphertext chunk
        writer.write_all(chunk_data).map_err(|e| {
            EncryptError::Internal(format!("Failed to write ciphertext: {}", e))
        })?;

        // Write tag (16 bytes)
        assert_eq!(tag.len(), TAG_LEN);
        writer.write_all(&tag).map_err(|e| {
            EncryptError::Internal(format!("Failed to write auth tag: {}", e))
        })?;

        bytes_processed += bytes_read as u64;
        chunk_index += 1;

        progress::emit_progress("encrypt", bytes_processed, input_size);
    }

    writer.flush().map_err(|e| {
        EncryptError::Internal(format!("Failed to flush output: {}", e))
    })?;
    // Drop the BufWriter so only the NamedTempFile owns the file handle
    drop(writer);

    // 11. Atomic rename
    temp_file
        .persist(&opts.output_path)
        .map_err(|e| {
            if e.error.kind() == std::io::ErrorKind::PermissionDenied {
                EncryptError::Permission(format!("Cannot write to output path: {}", e.error))
            } else {
                EncryptError::Internal(format!("Failed to rename temp file to output: {}", e.error))
            }
        })?;

    progress::emit_progress("encrypt", input_size, input_size);

    Ok(())
}

/// Read up to `buf.len()` bytes from the reader, filling the buffer as
/// much as possible. Returns the number of bytes actually read. Unlike
/// `read_exact`, this does not error on EOF -- it returns a short count.
fn read_exact_or_eof<R: Read>(reader: &mut R, buf: &mut [u8]) -> Result<usize, EncryptError> {
    let mut total = 0;
    while total < buf.len() {
        match reader.read(&mut buf[total..]) {
            Ok(0) => break,
            Ok(n) => total += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => {
                return Err(EncryptError::Internal(format!(
                    "Failed to read input: {}",
                    e
                )));
            }
        }
    }
    Ok(total)
}

/// Errors that can occur during encryption.
#[derive(Debug)]
pub enum EncryptError {
    Permission(String),
    Internal(String),
}

impl std::fmt::Display for EncryptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncryptError::Permission(msg) => write!(f, "Permission error: {}", msg),
            EncryptError::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for EncryptError {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_encrypt_creates_output_file() {
        // Create a temp input file
        let mut input_file = NamedTempFile::new().unwrap();
        input_file.write_all(b"Hello, World!").unwrap();
        input_file.flush().unwrap();

        let output_dir = tempfile::tempdir().unwrap();
        let output_path = output_dir.path().join("test.gtkrypt");

        let opts = EncryptOptions {
            input_path: input_file.path().to_str().unwrap().to_string(),
            output_path: output_path.to_str().unwrap().to_string(),
            passphrase: b"test_password".to_vec(),
            time_cost: 1,
            memory_cost_kib: 1024,
            parallelism: 1,
            store_filename: false,
        };

        encrypt(&opts).unwrap();

        // Output file should exist and be larger than the header minimum
        assert!(output_path.exists());
        let output_data = fs::read(&output_path).unwrap();
        // At minimum: 67 (header no filename) + 13 (ciphertext) + 16 (tag) = 96
        assert!(output_data.len() >= 96);

        // Should start with magic bytes
        assert_eq!(&output_data[0..8], b"GTKRYPT\0");
    }

    #[test]
    fn test_max_input_size_constant() {
        // Verify the max input size is u32::MAX * CHUNK_SIZE
        let max: u64 = (u32::MAX as u64) * (CHUNK_SIZE as u64);
        // At 64 KiB chunks, this is ~256 TiB
        assert_eq!(max, 4294967295u64 * 65536);
    }

    #[test]
    fn test_encrypt_with_stored_filename() {
        let mut input_file = NamedTempFile::new().unwrap();
        input_file.write_all(b"test data").unwrap();
        input_file.flush().unwrap();

        let output_dir = tempfile::tempdir().unwrap();
        let output_path = output_dir.path().join("test.gtkrypt");

        let opts = EncryptOptions {
            input_path: input_file.path().to_str().unwrap().to_string(),
            output_path: output_path.to_str().unwrap().to_string(),
            passphrase: b"password123".to_vec(),
            time_cost: 1,
            memory_cost_kib: 1024,
            parallelism: 1,
            store_filename: true,
        };

        encrypt(&opts).unwrap();
        assert!(output_path.exists());
    }
}
