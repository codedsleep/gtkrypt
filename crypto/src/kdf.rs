use argon2::{Algorithm, Argon2, Params, Version};

/// Argon2id key derivation parameters.
#[derive(Debug, Clone)]
pub struct KdfParams {
    pub time_cost: u32,
    pub memory_cost_kib: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        // "Balanced" preset
        KdfParams {
            time_cost: 3,
            memory_cost_kib: 65536, // 64 MiB
            parallelism: 4,
        }
    }
}

/// Derive a 32-byte key from a passphrase and salt using Argon2id.
///
/// Returns a 32-byte key suitable for AES-256-GCM.
pub fn derive_key(passphrase: &[u8], salt: &[u8], params: &KdfParams) -> Result<[u8; 32], String> {
    let argon2_params = Params::new(
        params.memory_cost_kib,
        params.time_cost,
        params.parallelism,
        Some(32),
    )
    .map_err(|e| format!("Invalid Argon2 params: {}", e))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase, salt, &mut key)
        .map_err(|e| format!("Argon2id key derivation failed: {}", e))?;

    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_key_produces_32_bytes() {
        let params = KdfParams {
            time_cost: 1,
            memory_cost_kib: 1024, // 1 MiB (fast for tests)
            parallelism: 1,
        };
        let salt = [0u8; 16];
        let key = derive_key(b"test_passphrase", &salt, &params).unwrap();
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn test_different_passwords_produce_different_keys() {
        let params = KdfParams {
            time_cost: 1,
            memory_cost_kib: 1024,
            parallelism: 1,
        };
        let salt = [0u8; 16];
        let key1 = derive_key(b"password_one", &salt, &params).unwrap();
        let key2 = derive_key(b"password_two", &salt, &params).unwrap();
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_different_salts_produce_different_keys() {
        let params = KdfParams {
            time_cost: 1,
            memory_cost_kib: 1024,
            parallelism: 1,
        };
        let salt1 = [0u8; 16];
        let salt2 = [1u8; 16];
        let key1 = derive_key(b"same_password", &salt1, &params).unwrap();
        let key2 = derive_key(b"same_password", &salt2, &params).unwrap();
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_same_inputs_produce_same_key() {
        let params = KdfParams {
            time_cost: 1,
            memory_cost_kib: 1024,
            parallelism: 1,
        };
        let salt = [42u8; 16];
        let key1 = derive_key(b"deterministic", &salt, &params).unwrap();
        let key2 = derive_key(b"deterministic", &salt, &params).unwrap();
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_default_params() {
        let params = KdfParams::default();
        assert_eq!(params.time_cost, 3);
        assert_eq!(params.memory_cost_kib, 65536);
        assert_eq!(params.parallelism, 4);
    }
}
