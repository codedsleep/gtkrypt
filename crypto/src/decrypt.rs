use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

use aes_gcm::aead::AeadInPlace;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce, Tag};

use crate::header::{self, AAD_LENGTH, CHUNK_SIZE, TAG_LEN};
use crate::kdf;
use crate::progress;

/// Options for decryption.
pub struct DecryptOptions {
    pub input_path: String,
    pub output_path: String,
    pub passphrase: Vec<u8>,
}

/// Perform streaming chunked decryption of a gtkrypt container file and write
/// plaintext to the output path.
///
/// Reads chunks of (up to 64 KiB ciphertext + 16-byte tag) at a time, keeping
/// peak memory bounded regardless of input file size.
pub fn decrypt(opts: &DecryptOptions) -> Result<(), DecryptError> {
    // 1. Open input file with BufReader and read header only
    let input_file = fs::File::open(&opts.input_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            DecryptError::Permission(format!("Cannot read input file: {}", e))
        } else {
            DecryptError::Internal(format!("Failed to read input file: {}", e))
        }
    })?;
    let mut reader = BufReader::new(input_file);

    // 2. Parse header from the stream
    let (header_obj, header_size, header_bytes) =
        header::read_header_from_reader(&mut reader).map_err(|e| match e {
            header::HeaderError::InvalidMagic => {
                DecryptError::CorruptFile(format!("Not a gtkrypt file: {}", e))
            }
            header::HeaderError::UnsupportedVersion(_) => {
                DecryptError::CorruptFile(format!("Unsupported version: {}", e))
            }
            header::HeaderError::UnsupportedKdf(_) => {
                DecryptError::CorruptFile(format!("Unsupported KDF: {}", e))
            }
            _ => DecryptError::CorruptFile(format!("Invalid header: {}", e)),
        })?;

    // 3. Validate the file has enough data for all chunks + tags
    let ciphertext_len = header_obj.ciphertext_length as usize;
    let num_chunks = if ciphertext_len == 0 {
        0usize
    } else {
        (ciphertext_len + CHUNK_SIZE - 1) / CHUNK_SIZE
    };

    // Guard against nonce reuse: chunk_index is u32, so reject if too many chunks.
    if num_chunks > u32::MAX as usize {
        return Err(DecryptError::CorruptFile(format!(
            "Ciphertext too large: {} chunks exceeds maximum of {}",
            num_chunks, u32::MAX
        )));
    }

    let total_tags_size = num_chunks * TAG_LEN;

    // Check overall file size
    let file_size = fs::metadata(&opts.input_path)
        .map_err(|e| DecryptError::Internal(format!("Failed to stat input file: {}", e)))?
        .len() as usize;

    let expected_total = header_size + ciphertext_len + total_tags_size;
    if file_size != expected_total {
        return Err(DecryptError::CorruptFile(format!(
            "File size mismatch: expected {} bytes, got {}",
            expected_total, file_size
        )));
    }

    // 4. Extract AAD from raw header bytes
    let aad = &header_bytes[..AAD_LENGTH];

    // 5. Derive key via Argon2id with header params
    progress::emit_progress("kdf", 0, 0);

    let key = kdf::derive_key(
        &opts.passphrase,
        &header_obj.salt,
        &header_obj.kdf_params,
    )
    .map_err(|e| DecryptError::Internal(format!("KDF failed: {}", e)))?;

    progress::emit_progress("kdf", 1, 1);

    // 6. Initialize cipher
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| DecryptError::Internal(format!("Failed to initialize cipher: {}", e)))?;

    // 7. Open temp output file with BufWriter
    let output_dir = Path::new(&opts.output_path)
        .parent()
        .unwrap_or(Path::new("."));

    let temp_file = tempfile::NamedTempFile::new_in(output_dir).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            DecryptError::Permission(format!("Cannot write to output directory: {}", e))
        } else {
            DecryptError::Internal(format!("Failed to create temp file: {}", e))
        }
    })?;

    let mut writer = BufWriter::new(temp_file.as_file());

    // 8. Stream chunks: read (chunk_ciphertext + 16-byte tag), decrypt, write plaintext
    progress::emit_progress("decrypt", 0, ciphertext_len as u64);

    let mut remaining_ciphertext = ciphertext_len;
    let mut chunk_index: u32 = 0;
    let mut bytes_decrypted: u64 = 0;
    // Allocate a single buffer large enough for the largest chunk + tag
    let mut chunk_buf = vec![0u8; CHUNK_SIZE + TAG_LEN];

    while remaining_ciphertext > 0 {
        let this_chunk_ct_len = std::cmp::min(remaining_ciphertext, CHUNK_SIZE);
        let read_len = this_chunk_ct_len + TAG_LEN;

        // Read exactly chunk ciphertext + tag
        reader
            .read_exact(&mut chunk_buf[..read_len])
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::UnexpectedEof {
                    DecryptError::CorruptFile(format!(
                        "File is truncated at chunk {}",
                        chunk_index
                    ))
                } else {
                    DecryptError::Internal(format!("Failed to read input: {}", e))
                }
            })?;

        // Split into ciphertext and tag
        let (ct_slice, tag_slice) = chunk_buf[..read_len].split_at_mut(this_chunk_ct_len);
        let tag = Tag::from_slice(&tag_slice[..TAG_LEN]);

        // Derive per-chunk nonce and AAD
        let chunk_nonce_bytes = header::derive_chunk_nonce(&header_obj.nonce, chunk_index);
        let chunk_nonce = Nonce::from_slice(&chunk_nonce_bytes);
        let chunk_aad = header::build_chunk_aad(aad, chunk_index);

        // Decrypt in place
        cipher
            .decrypt_in_place_detached(chunk_nonce, &chunk_aad, ct_slice, tag)
            .map_err(|_| {
                DecryptError::WrongPassphrase(
                    "Decryption failed: incorrect passphrase or corrupted data".to_string(),
                )
            })?;

        // Write decrypted plaintext
        writer.write_all(ct_slice).map_err(|e| {
            DecryptError::Internal(format!("Failed to write plaintext: {}", e))
        })?;

        remaining_ciphertext -= this_chunk_ct_len;
        bytes_decrypted += this_chunk_ct_len as u64;
        chunk_index += 1;

        progress::emit_progress("decrypt", bytes_decrypted, ciphertext_len as u64);
    }

    writer.flush().map_err(|e| {
        DecryptError::Internal(format!("Failed to flush output: {}", e))
    })?;
    // Drop the BufWriter so only the NamedTempFile owns the file handle
    drop(writer);

    // 9. Atomic rename
    temp_file
        .persist(&opts.output_path)
        .map_err(|e| {
            if e.error.kind() == std::io::ErrorKind::PermissionDenied {
                DecryptError::Permission(format!("Cannot write to output path: {}", e.error))
            } else {
                DecryptError::Internal(format!(
                    "Failed to rename temp file to output: {}",
                    e.error
                ))
            }
        })?;

    #[cfg(unix)]
    {
        if let Some(mode) = header_obj.mode {
            if mode != 0 {
                use std::os::unix::fs::PermissionsExt;
                let perms = fs::Permissions::from_mode(mode & 0o7777);
                fs::set_permissions(&opts.output_path, perms).map_err(|e| {
                    if e.kind() == std::io::ErrorKind::PermissionDenied {
                        DecryptError::Permission(format!(
                            "Cannot set output permissions: {}",
                            e
                        ))
                    } else {
                        DecryptError::Internal(format!(
                            "Failed to set output permissions: {}",
                            e
                        ))
                    }
                })?;
            }
        }
    }

    progress::emit_progress("decrypt", ciphertext_len as u64, ciphertext_len as u64);

    Ok(())
}

/// Errors that can occur during decryption.
#[derive(Debug)]
pub enum DecryptError {
    WrongPassphrase(String),
    CorruptFile(String),
    Permission(String),
    Internal(String),
}

impl std::fmt::Display for DecryptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecryptError::WrongPassphrase(msg) => write!(f, "Wrong passphrase: {}", msg),
            DecryptError::CorruptFile(msg) => write!(f, "Corrupt file: {}", msg),
            DecryptError::Permission(msg) => write!(f, "Permission error: {}", msg),
            DecryptError::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for DecryptError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encrypt::{self, EncryptOptions};
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_max_chunk_count_is_u32_max() {
        // The maximum number of chunks is u32::MAX. At 64 KiB per chunk,
        // this corresponds to ~256 TiB of plaintext.
        let max_chunks = u32::MAX as usize;
        let max_plaintext: u64 = (max_chunks as u64) * (CHUNK_SIZE as u64);
        assert_eq!(max_plaintext, 4294967295u64 * 65536);
    }

    fn encrypt_test_file(plaintext: &[u8], passphrase: &str) -> (String, tempfile::TempDir) {
        let mut input_file = NamedTempFile::new().unwrap();
        input_file.write_all(plaintext).unwrap();
        input_file.flush().unwrap();

        let output_dir = tempfile::tempdir().unwrap();
        let output_path = output_dir.path().join("test.gtkrypt");

        let opts = EncryptOptions {
            input_path: input_file.path().to_str().unwrap().to_string(),
            output_path: output_path.to_str().unwrap().to_string(),
            passphrase: passphrase.as_bytes().to_vec(),
            time_cost: 1,
            memory_cost_kib: 1024,
            parallelism: 1,
            store_filename: false,
        };

        encrypt::encrypt(&opts).unwrap();
        (output_path.to_str().unwrap().to_string(), output_dir)
    }

    #[test]
    fn test_decrypt_roundtrip() {
        let plaintext = b"Hello, World! This is a secret message.";
        let passphrase = "test_password_123";

        let (encrypted_path, dir) = encrypt_test_file(plaintext, passphrase);
        let decrypted_path = dir.path().join("decrypted.txt");

        let opts = DecryptOptions {
            input_path: encrypted_path,
            output_path: decrypted_path.to_str().unwrap().to_string(),
            passphrase: passphrase.as_bytes().to_vec(),
        };

        decrypt(&opts).unwrap();

        let decrypted = fs::read(&decrypted_path).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_wrong_passphrase() {
        let plaintext = b"Secret data here";
        let (encrypted_path, dir) = encrypt_test_file(plaintext, "correct_password");
        let decrypted_path = dir.path().join("decrypted.txt");

        let opts = DecryptOptions {
            input_path: encrypted_path,
            output_path: decrypted_path.to_str().unwrap().to_string(),
            passphrase: b"wrong_password".to_vec(),
        };

        let result = decrypt(&opts);
        assert!(matches!(result, Err(DecryptError::WrongPassphrase(_))));
        // Output file should NOT exist
        assert!(!decrypted_path.exists());
    }

    #[test]
    fn test_decrypt_corrupt_magic() {
        let mut input_file = NamedTempFile::new().unwrap();
        input_file.write_all(b"NOT_GTKRYPT_FILE_CONTENT").unwrap();
        input_file.flush().unwrap();

        let output_dir = tempfile::tempdir().unwrap();
        let decrypted_path = output_dir.path().join("decrypted.txt");

        let opts = DecryptOptions {
            input_path: input_file.path().to_str().unwrap().to_string(),
            output_path: decrypted_path.to_str().unwrap().to_string(),
            passphrase: b"any_password".to_vec(),
        };

        let result = decrypt(&opts);
        assert!(matches!(result, Err(DecryptError::CorruptFile(_))));
    }

    #[test]
    fn test_decrypt_truncated_file() {
        // Create a valid header but truncate the ciphertext
        let plaintext = b"Some data to encrypt";
        let (encrypted_path, _dir) = encrypt_test_file(plaintext, "password");

        // Read the encrypted file and truncate it
        let mut data = fs::read(&encrypted_path).unwrap();
        data.truncate(70); // Cut off most of the ciphertext + tag

        let truncated_dir = tempfile::tempdir().unwrap();
        let truncated_path = truncated_dir.path().join("truncated.gtkrypt");
        fs::write(&truncated_path, &data).unwrap();

        let decrypted_path = truncated_dir.path().join("decrypted.txt");

        let opts = DecryptOptions {
            input_path: truncated_path.to_str().unwrap().to_string(),
            output_path: decrypted_path.to_str().unwrap().to_string(),
            passphrase: b"password".to_vec(),
        };

        let result = decrypt(&opts);
        assert!(matches!(result, Err(DecryptError::CorruptFile(_))));
    }

    #[test]
    fn test_decrypt_empty_file_roundtrip() {
        let plaintext = b"";
        let passphrase = "password_for_empty";

        let (encrypted_path, dir) = encrypt_test_file(plaintext, passphrase);
        let decrypted_path = dir.path().join("decrypted.txt");

        let opts = DecryptOptions {
            input_path: encrypted_path,
            output_path: decrypted_path.to_str().unwrap().to_string(),
            passphrase: passphrase.as_bytes().to_vec(),
        };

        decrypt(&opts).unwrap();

        let decrypted = fs::read(&decrypted_path).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_multi_chunk_roundtrip() {
        // Create data larger than one chunk (64 KiB) to exercise multi-chunk path
        let plaintext: Vec<u8> = (0..=255u8).cycle().take(CHUNK_SIZE * 2 + 1000).collect();
        let passphrase = "multi_chunk_test";

        let (encrypted_path, dir) = encrypt_test_file(&plaintext, passphrase);
        let decrypted_path = dir.path().join("decrypted.bin");

        let opts = DecryptOptions {
            input_path: encrypted_path,
            output_path: decrypted_path.to_str().unwrap().to_string(),
            passphrase: passphrase.as_bytes().to_vec(),
        };

        decrypt(&opts).unwrap();

        let decrypted = fs::read(&decrypted_path).unwrap();
        assert_eq!(decrypted.len(), plaintext.len());
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_exact_chunk_boundary() {
        // Data exactly equal to one chunk
        let plaintext: Vec<u8> = vec![0xAB; CHUNK_SIZE];
        let passphrase = "exact_chunk";

        let (encrypted_path, dir) = encrypt_test_file(&plaintext, passphrase);
        let decrypted_path = dir.path().join("decrypted.bin");

        let opts = DecryptOptions {
            input_path: encrypted_path,
            output_path: decrypted_path.to_str().unwrap().to_string(),
            passphrase: passphrase.as_bytes().to_vec(),
        };

        decrypt(&opts).unwrap();

        let decrypted = fs::read(&decrypted_path).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[cfg(unix)]
    #[test]
    fn test_decrypt_restores_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let plaintext = b"perm test";
        let passphrase = "perm_pass";

        let mut input_file = NamedTempFile::new().unwrap();
        input_file.write_all(plaintext).unwrap();
        input_file.flush().unwrap();

        let input_path = input_file.path();
        let perms = std::fs::Permissions::from_mode(0o640);
        std::fs::set_permissions(input_path, perms).unwrap();

        let output_dir = tempfile::tempdir().unwrap();
        let encrypted_path = output_dir.path().join("test.gtkrypt");

        let enc_opts = EncryptOptions {
            input_path: input_path.to_str().unwrap().to_string(),
            output_path: encrypted_path.to_str().unwrap().to_string(),
            passphrase: passphrase.as_bytes().to_vec(),
            time_cost: 1,
            memory_cost_kib: 1024,
            parallelism: 1,
            store_filename: false,
        };

        encrypt::encrypt(&enc_opts).unwrap();

        let decrypted_path = output_dir.path().join("out.txt");
        let dec_opts = DecryptOptions {
            input_path: encrypted_path.to_str().unwrap().to_string(),
            output_path: decrypted_path.to_str().unwrap().to_string(),
            passphrase: passphrase.as_bytes().to_vec(),
        };

        decrypt(&dec_opts).unwrap();

        let restored =
            std::fs::metadata(&decrypted_path).unwrap().permissions().mode() & 0o7777;
        assert_eq!(restored, 0o640);
    }
}
