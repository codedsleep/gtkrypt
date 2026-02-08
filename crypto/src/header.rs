use std::io::Read;

use crate::kdf::KdfParams;

/// Magic bytes identifying a gtkrypt container file.
pub const MAGIC: &[u8; 8] = b"GTKRYPT\0";

/// Current container format version.
pub const VERSION: u8 = 2;

/// KDF identifier for Argon2id.
pub const KDF_ID_ARGON2ID: u8 = 1;

/// Salt length in bytes.
pub const SALT_LEN: usize = 16;

/// Nonce/IV length in bytes for AES-256-GCM.
pub const NONCE_LEN: usize = 12;

/// GCM authentication tag length in bytes.
pub const TAG_LEN: usize = 16;

/// Chunk size for streaming encryption/decryption (64 KiB).
pub const CHUNK_SIZE: usize = 65536;

/// Parsed container header.
#[derive(Debug, Clone)]
pub struct ContainerHeader {
    pub version: u8,
    pub kdf_id: u8,
    pub kdf_params: KdfParams,
    pub salt: [u8; SALT_LEN],
    pub nonce: [u8; NONCE_LEN],
    pub filename: Option<String>,
    pub mode: Option<u32>,
    pub original_file_size: u64,
    pub ciphertext_length: u64,
}

/// Encode a container header into bytes.
///
/// Returns the full header byte vector. The AAD portion is bytes 0 through
/// the end of the nonce field (offset 0..49).
pub fn encode_header(header: &ContainerHeader) -> Vec<u8> {
    let filename_bytes = header
        .filename
        .as_ref()
        .map(|s| s.as_bytes().to_vec())
        .unwrap_or_default();
    let filename_len = filename_bytes.len() as u16;

    // Calculate total header size:
    // v1:
    //   8 (magic) + 1 (version) + 1 (kdf_id) + 4 (time_cost) + 4 (memory_cost)
    //   + 1 (parallelism) + 1 (salt_len) + 16 (salt) + 1 (nonce_len) + 12 (nonce)
    //   + 2 (filename_len) + N (filename) + 8 (file_size) + 8 (ciphertext_len)
    //   = 67 + N
    // v2 adds mode (uint32 BE) after filename:
    //   = 71 + N
    let total_size = if header.version == 1 {
        67 + filename_bytes.len()
    } else {
        71 + filename_bytes.len()
    };
    let mut buf = Vec::with_capacity(total_size);

    // Magic (8 bytes)
    buf.extend_from_slice(MAGIC);

    // Version (1 byte)
    buf.push(header.version);

    // KDF ID (1 byte)
    buf.push(header.kdf_id);

    // Argon2 time cost (uint32 BE)
    buf.extend_from_slice(&header.kdf_params.time_cost.to_be_bytes());

    // Argon2 memory cost in KiB (uint32 BE)
    buf.extend_from_slice(&header.kdf_params.memory_cost_kib.to_be_bytes());

    // Argon2 parallelism (uint8)
    buf.push(header.kdf_params.parallelism as u8);

    // Salt length (1 byte, always 16)
    buf.push(SALT_LEN as u8);

    // Salt (16 bytes)
    buf.extend_from_slice(&header.salt);

    // Nonce length (1 byte, always 12)
    buf.push(NONCE_LEN as u8);

    // Nonce (12 bytes)
    buf.extend_from_slice(&header.nonce);

    // --- End of AAD portion (offset 49) ---

    // Filename length (uint16 BE)
    buf.extend_from_slice(&filename_len.to_be_bytes());

    // Filename (N bytes, UTF-8)
    buf.extend_from_slice(&filename_bytes);

    // Mode (uint32 BE, v2+ only; 0 means unknown)
    if header.version >= 2 {
        let mode = header.mode.unwrap_or(0);
        buf.extend_from_slice(&mode.to_be_bytes());
    }

    // Original file size (uint64 BE)
    buf.extend_from_slice(&header.original_file_size.to_be_bytes());

    // Ciphertext length (uint64 BE)
    buf.extend_from_slice(&header.ciphertext_length.to_be_bytes());

    buf
}

/// The AAD (Additional Authenticated Data) is the header bytes from offset 0
/// through the end of the nonce field.
/// Layout: magic(8) + version(1) + kdf_id(1) + time_cost(4) + memory_cost(4)
///         + parallelism(1) + salt_len(1) + salt(16) + nonce_len(1) + nonce(12) = 49
pub const AAD_LENGTH: usize = MAGIC.len() + 1 + 1 + 4 + 4 + 1 + 1 + SALT_LEN + 1 + NONCE_LEN;

/// Extract the AAD portion from encoded header bytes.
pub fn extract_aad(header_bytes: &[u8]) -> &[u8] {
    &header_bytes[..AAD_LENGTH]
}

/// Decode a container header from raw bytes read from a file.
///
/// Returns the parsed header and the total number of bytes consumed.
pub fn decode_header(data: &[u8]) -> Result<(ContainerHeader, usize), HeaderError> {
    // Minimum header size without filename: 67 bytes
    if data.len() < 67 {
        return Err(HeaderError::TooShort);
    }

    // Validate magic
    if &data[0..8] != MAGIC {
        return Err(HeaderError::InvalidMagic);
    }

    // Version
    let version = data[8];
    if version != 1 && version != 2 {
        return Err(HeaderError::UnsupportedVersion(version));
    }

    // KDF ID
    let kdf_id = data[9];
    if kdf_id != KDF_ID_ARGON2ID {
        return Err(HeaderError::UnsupportedKdf(kdf_id));
    }

    // Argon2 time cost (uint32 BE at offset 10)
    let time_cost = u32::from_be_bytes([data[10], data[11], data[12], data[13]]);

    // Argon2 memory cost (uint32 BE at offset 14)
    let memory_cost_kib = u32::from_be_bytes([data[14], data[15], data[16], data[17]]);

    // Argon2 parallelism (uint8 at offset 18)
    let parallelism = data[18] as u32;

    // Salt length (offset 19, must be 16)
    let salt_len = data[19] as usize;
    if salt_len != SALT_LEN {
        return Err(HeaderError::InvalidSaltLength(salt_len));
    }

    // Salt (offset 20..36)
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&data[20..36]);

    // Nonce length (offset 36, must be 12)
    let nonce_len = data[36] as usize;
    if nonce_len != NONCE_LEN {
        return Err(HeaderError::InvalidNonceLength(nonce_len));
    }

    // Nonce (offset 37..49)
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&data[37..49]);

    // Filename length (uint16 BE at offset 49)
    let filename_len = u16::from_be_bytes([data[49], data[50]]) as usize;

    // Filename (offset 51..51+filename_len)
    let filename = if filename_len > 0 {
        let filename_bytes = &data[51..51 + filename_len];
        Some(
            String::from_utf8(filename_bytes.to_vec())
                .map_err(|_| HeaderError::InvalidFilename)?,
        )
    } else {
        None
    };

    let offset = 51 + filename_len;

    let (mode, original_file_size, ciphertext_length, total_consumed) = if version == 1 {
        // Check we have enough data for file_size + ciphertext_length
        let remaining_needed = offset + 16;
        if data.len() < remaining_needed {
            return Err(HeaderError::TooShort);
        }

        let original_file_size = u64::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]);

        let ciphertext_length = u64::from_be_bytes([
            data[offset + 8],
            data[offset + 9],
            data[offset + 10],
            data[offset + 11],
            data[offset + 12],
            data[offset + 13],
            data[offset + 14],
            data[offset + 15],
        ]);

        (None, original_file_size, ciphertext_length, offset + 16)
    } else {
        // v2: mode (4) + file_size (8) + ciphertext_length (8)
        let remaining_needed = offset + 20;
        if data.len() < remaining_needed {
            return Err(HeaderError::TooShort);
        }

        let mode = u32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]);

        let original_file_size = u64::from_be_bytes([
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
            data[offset + 8],
            data[offset + 9],
            data[offset + 10],
            data[offset + 11],
        ]);

        let ciphertext_length = u64::from_be_bytes([
            data[offset + 12],
            data[offset + 13],
            data[offset + 14],
            data[offset + 15],
            data[offset + 16],
            data[offset + 17],
            data[offset + 18],
            data[offset + 19],
        ]);

        (Some(mode), original_file_size, ciphertext_length, offset + 20)
    };

    let header = ContainerHeader {
        version,
        kdf_id,
        kdf_params: KdfParams {
            time_cost,
            memory_cost_kib,
            parallelism,
        },
        salt,
        nonce,
        filename,
        mode,
        original_file_size,
        ciphertext_length,
    };

    Ok((header, total_consumed))
}

/// Errors that can occur when parsing a container header.
#[derive(Debug)]
pub enum HeaderError {
    TooShort,
    InvalidMagic,
    UnsupportedVersion(u8),
    UnsupportedKdf(u8),
    InvalidSaltLength(usize),
    InvalidNonceLength(usize),
    InvalidFilename,
}

impl std::fmt::Display for HeaderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HeaderError::TooShort => write!(f, "File is too short to contain a valid header"),
            HeaderError::InvalidMagic => write!(f, "Not a gtkrypt file (invalid magic bytes)"),
            HeaderError::UnsupportedVersion(v) => {
                write!(f, "Unsupported container version: {}", v)
            }
            HeaderError::UnsupportedKdf(id) => write!(f, "Unsupported KDF identifier: {}", id),
            HeaderError::InvalidSaltLength(len) => {
                write!(f, "Invalid salt length: {} (expected {})", len, SALT_LEN)
            }
            HeaderError::InvalidNonceLength(len) => {
                write!(f, "Invalid nonce length: {} (expected {})", len, NONCE_LEN)
            }
            HeaderError::InvalidFilename => write!(f, "Filename is not valid UTF-8"),
        }
    }
}

impl std::error::Error for HeaderError {}

/// Derive a per-chunk nonce by XOR-ing the chunk counter (big-endian u32)
/// into the last 4 bytes of the base nonce.
pub fn derive_chunk_nonce(base_nonce: &[u8; NONCE_LEN], chunk_index: u32) -> [u8; NONCE_LEN] {
    let mut nonce = *base_nonce;
    let counter_bytes = chunk_index.to_be_bytes();
    for i in 0..4 {
        nonce[8 + i] ^= counter_bytes[i];
    }
    nonce
}

/// Build per-chunk AAD by appending the chunk index (big-endian u32)
/// to the base header AAD bytes.
pub fn build_chunk_aad(header_aad: &[u8], chunk_index: u32) -> Vec<u8> {
    let mut aad = header_aad.to_vec();
    aad.extend_from_slice(&chunk_index.to_be_bytes());
    aad
}

/// Read and decode a container header from a reader without loading the
/// entire file into memory. Returns the parsed header, the total header
/// byte count consumed, and the raw header bytes (needed for AAD extraction).
pub fn read_header_from_reader<R: Read>(
    reader: &mut R,
) -> Result<(ContainerHeader, usize, Vec<u8>), HeaderError> {
    // Read the minimum 67 bytes (header with no filename)
    let mut header_buf = vec![0u8; 67];
    reader
        .read_exact(&mut header_buf)
        .map_err(|_| HeaderError::TooShort)?;

    // Peek at version and filename_len at offset 49..51
    let version = header_buf[8];
    let filename_len = u16::from_be_bytes([header_buf[49], header_buf[50]]) as usize;

    let total_size = if version == 2 {
        71 + filename_len
    } else {
        67 + filename_len
    };

    if total_size > header_buf.len() {
        let extra_needed = total_size - header_buf.len();
        let mut extra = vec![0u8; extra_needed];
        reader
            .read_exact(&mut extra)
            .map_err(|_| HeaderError::TooShort)?;
        header_buf.extend_from_slice(&extra);
    }

    let (header, consumed) = decode_header(&header_buf)?;
    Ok((header, consumed, header_buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_header(filename: Option<&str>) -> ContainerHeader {
        ContainerHeader {
            version: VERSION,
            kdf_id: KDF_ID_ARGON2ID,
            kdf_params: KdfParams {
                time_cost: 3,
                memory_cost_kib: 65536,
                parallelism: 4,
            },
            salt: [1u8; SALT_LEN],
            nonce: [2u8; NONCE_LEN],
            filename: filename.map(|s| s.to_string()),
            mode: Some(0o600),
            original_file_size: 12345,
            ciphertext_length: 12361, // 12345 + 16 tag
        }
    }

    #[test]
    fn test_roundtrip_encode_decode_no_filename() {
        let header = make_test_header(None);
        let encoded = encode_header(&header);

        let (decoded, consumed) = decode_header(&encoded).unwrap();
        assert_eq!(consumed, encoded.len());
        assert_eq!(decoded.version, header.version);
        assert_eq!(decoded.kdf_id, header.kdf_id);
        assert_eq!(decoded.kdf_params.time_cost, header.kdf_params.time_cost);
        assert_eq!(
            decoded.kdf_params.memory_cost_kib,
            header.kdf_params.memory_cost_kib
        );
        assert_eq!(decoded.kdf_params.parallelism, header.kdf_params.parallelism);
        assert_eq!(decoded.salt, header.salt);
        assert_eq!(decoded.nonce, header.nonce);
        assert_eq!(decoded.filename, None);
        assert_eq!(decoded.mode, header.mode);
        assert_eq!(decoded.original_file_size, header.original_file_size);
        assert_eq!(decoded.ciphertext_length, header.ciphertext_length);
    }

    #[test]
    fn test_roundtrip_encode_decode_with_filename() {
        let header = make_test_header(Some("my_secret_file.txt"));
        let encoded = encode_header(&header);

        let (decoded, consumed) = decode_header(&encoded).unwrap();
        assert_eq!(consumed, encoded.len());
        assert_eq!(decoded.filename, Some("my_secret_file.txt".to_string()));
        assert_eq!(decoded.mode, header.mode);
        assert_eq!(decoded.original_file_size, header.original_file_size);
        assert_eq!(decoded.ciphertext_length, header.ciphertext_length);
    }

    #[test]
    fn test_roundtrip_encode_decode_with_mode_v2() {
        let header = ContainerHeader {
            version: 2,
            kdf_id: KDF_ID_ARGON2ID,
            kdf_params: KdfParams {
                time_cost: 3,
                memory_cost_kib: 65536,
                parallelism: 4,
            },
            salt: [1u8; SALT_LEN],
            nonce: [2u8; NONCE_LEN],
            filename: Some("secret.txt".to_string()),
            mode: Some(0o640),
            original_file_size: 12345,
            ciphertext_length: 12345,
        };

        let encoded = encode_header(&header);
        let (decoded, consumed) = decode_header(&encoded).unwrap();
        assert_eq!(consumed, encoded.len());
        assert_eq!(decoded.version, 2);
        assert_eq!(decoded.mode, Some(0o640));
        assert_eq!(decoded.filename, Some("secret.txt".to_string()));
    }

    #[test]
    fn test_roundtrip_with_unicode_filename() {
        let header = make_test_header(Some("Geheime Datei.txt"));
        let encoded = encode_header(&header);

        let (decoded, _) = decode_header(&encoded).unwrap();
        assert_eq!(decoded.filename, Some("Geheime Datei.txt".to_string()));
    }

    #[test]
    fn test_reject_invalid_magic() {
        let header = make_test_header(None);
        let mut encoded = encode_header(&header);
        encoded[0] = b'X'; // corrupt magic

        let result = decode_header(&encoded);
        assert!(matches!(result, Err(HeaderError::InvalidMagic)));
    }

    #[test]
    fn test_reject_unsupported_version() {
        let header = make_test_header(None);
        let mut encoded = encode_header(&header);
        encoded[8] = 99; // unsupported version

        let result = decode_header(&encoded);
        assert!(matches!(result, Err(HeaderError::UnsupportedVersion(99))));
    }

    #[test]
    fn test_reject_unsupported_kdf() {
        let header = make_test_header(None);
        let mut encoded = encode_header(&header);
        encoded[9] = 42; // unsupported KDF

        let result = decode_header(&encoded);
        assert!(matches!(result, Err(HeaderError::UnsupportedKdf(42))));
    }

    #[test]
    fn test_reject_too_short() {
        let result = decode_header(&[0u8; 10]);
        assert!(matches!(result, Err(HeaderError::TooShort)));
    }

    #[test]
    fn test_aad_length() {
        let header = make_test_header(None);
        let encoded = encode_header(&header);
        let aad = extract_aad(&encoded);
        assert_eq!(aad.len(), AAD_LENGTH);
        assert_eq!(aad.len(), 49);
        // AAD should start with magic
        assert_eq!(&aad[0..8], MAGIC);
    }

    #[test]
    fn test_magic_bytes() {
        assert_eq!(MAGIC, b"GTKRYPT\0");
        assert_eq!(MAGIC.len(), 8);
    }

    #[test]
    fn test_header_field_offsets() {
        let header = make_test_header(None);
        let encoded = encode_header(&header);

        // Verify field layout at expected offsets
        assert_eq!(&encoded[0..8], MAGIC); // magic
        assert_eq!(encoded[8], VERSION); // version
        assert_eq!(encoded[9], KDF_ID_ARGON2ID); // kdf_id
        assert_eq!(
            u32::from_be_bytes([encoded[10], encoded[11], encoded[12], encoded[13]]),
            3
        ); // time_cost
        assert_eq!(
            u32::from_be_bytes([encoded[14], encoded[15], encoded[16], encoded[17]]),
            65536
        ); // memory_cost
        assert_eq!(encoded[18], 4); // parallelism
        assert_eq!(encoded[19], 16); // salt_len
        assert_eq!(&encoded[20..36], &[1u8; 16]); // salt
        assert_eq!(encoded[36], 12); // nonce_len
        assert_eq!(&encoded[37..49], &[2u8; 12]); // nonce
        assert_eq!(u16::from_be_bytes([encoded[49], encoded[50]]), 0); // filename_len
    }

    #[test]
    fn test_derive_chunk_nonce_index_zero() {
        let base_nonce = [0xAA; NONCE_LEN];
        let derived = derive_chunk_nonce(&base_nonce, 0);
        // XOR with 0 should leave the nonce unchanged
        assert_eq!(derived, base_nonce);
    }

    #[test]
    fn test_derive_chunk_nonce_index_one() {
        let base_nonce = [0u8; NONCE_LEN];
        let derived = derive_chunk_nonce(&base_nonce, 1);
        // Only the last byte should be 1
        assert_eq!(derived[11], 1);
        assert_eq!(derived[8], 0);
        assert_eq!(derived[9], 0);
        assert_eq!(derived[10], 0);
    }

    #[test]
    fn test_derive_chunk_nonce_different_indices_produce_different_nonces() {
        let base_nonce = [0x42; NONCE_LEN];
        let n0 = derive_chunk_nonce(&base_nonce, 0);
        let n1 = derive_chunk_nonce(&base_nonce, 1);
        let n2 = derive_chunk_nonce(&base_nonce, 2);
        assert_ne!(n0, n1);
        assert_ne!(n1, n2);
        assert_ne!(n0, n2);
    }

    #[test]
    fn test_build_chunk_aad() {
        let header_aad = vec![0xAA; AAD_LENGTH];
        let aad = build_chunk_aad(&header_aad, 5);
        assert_eq!(aad.len(), AAD_LENGTH + 4);
        assert_eq!(&aad[..AAD_LENGTH], &header_aad[..]);
        assert_eq!(&aad[AAD_LENGTH..], &5u32.to_be_bytes());
    }

    #[test]
    fn test_read_header_from_reader_no_filename() {
        let header = make_test_header(None);
        let encoded = encode_header(&header);
        // Append some extra bytes to simulate ciphertext following the header
        let mut data = encoded.clone();
        data.extend_from_slice(&[0u8; 100]);

        let mut reader = std::io::Cursor::new(data);
        let (decoded, consumed, raw) = read_header_from_reader(&mut reader).unwrap();
        assert_eq!(consumed, encoded.len());
        assert_eq!(raw.len(), encoded.len());
        assert_eq!(decoded.version, header.version);
        assert_eq!(decoded.ciphertext_length, header.ciphertext_length);
    }

    #[test]
    fn test_read_header_from_reader_with_filename() {
        let header = make_test_header(Some("secret.txt"));
        let encoded = encode_header(&header);
        let mut data = encoded.clone();
        data.extend_from_slice(&[0u8; 100]);

        let mut reader = std::io::Cursor::new(data);
        let (decoded, consumed, _raw) = read_header_from_reader(&mut reader).unwrap();
        assert_eq!(consumed, encoded.len());
        assert_eq!(decoded.filename, Some("secret.txt".to_string()));
    }
}
