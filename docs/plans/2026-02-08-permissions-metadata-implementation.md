# Permissions Metadata Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store original Unix permissions in the container header and restore them on decrypt, while remaining backward compatible with v1 headers.

**Architecture:** Bump header version to v2 and add a `mode` field (`uint32 BE`) after the optional filename. Rust encodes/decodes v1 and v2, with v2 carrying `mode` (0 meaning unknown). Decrypt applies `mode` after atomic rename when present. TypeScript parser recognizes v1/v2 and exposes `mode?: number`.

**Tech Stack:** Rust (`aes-gcm`, `argon2`, `tempfile`), TypeScript (GJS), esbuild.

---

### Task 1: Update Rust header format to support v2 with `mode`

**Files:**
- Modify: `crypto/src/header.rs`
- Test: `crypto/src/header.rs` (tests section)

**Step 1: Write the failing test**

Add a v2 roundtrip test to `crypto/src/header.rs`:

```rust
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
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p gtkrypt-crypto header::tests::test_roundtrip_encode_decode_with_mode_v2`
Expected: FAIL (missing `mode` field / v2 logic).

**Step 3: Write minimal implementation**

Update `ContainerHeader` to include `mode: Option<u32>` and update `encode_header`/`decode_header`:

- Set `VERSION` to `2` for new files.
- For v2 encoding:
  - After filename, write `mode` as `u32 BE`.
  - Then write `original_file_size` and `ciphertext_length`.
- For decoding:
  - Accept versions 1 or 2.
  - For v1, parse file_size and ciphertext_length at old offsets and set `mode = None`.
  - For v2, parse `mode` at offset `51 + filename_len` and shift file_size/ciphertext_length by +4.

**Step 4: Run test to verify it passes**

Run: `cargo test -p gtkrypt-crypto header::tests::test_roundtrip_encode_decode_with_mode_v2`
Expected: PASS.

**Step 5: Commit**

```bash
git add crypto/src/header.rs
git commit -m "feat(crypto): add v2 header mode field"
```

---

### Task 2: Persist and restore permissions in Rust encrypt/decrypt

**Files:**
- Modify: `crypto/src/encrypt.rs`
- Modify: `crypto/src/decrypt.rs`
- Test: `crypto/src/decrypt.rs`

**Step 1: Write the failing test**

Add a Unix-only test in `crypto/src/decrypt.rs`:

```rust
#[cfg(unix)]
#[test]
fn test_decrypt_restores_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let plaintext = b"perm test";
    let passphrase = "perm_pass";

    let mut input_file = tempfile::NamedTempFile::new().unwrap();
    input_file.write_all(plaintext).unwrap();
    input_file.flush().unwrap();

    let input_path = input_file.path();
    let perms = std::fs::Permissions::from_mode(0o640);
    std::fs::set_permissions(input_path, perms).unwrap();

    let output_dir = tempfile::tempdir().unwrap();
    let encrypted_path = output_dir.path().join("test.gtkrypt");

    let enc_opts = encrypt::EncryptOptions {
        input_path: input_path.to_str().unwrap().to_string(),
        output_path: encrypted_path.to_str().unwrap().to_string(),
        passphrase: passphrase.to_string(),
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
        passphrase: passphrase.to_string(),
    };

    decrypt(&dec_opts).unwrap();

    let restored = std::fs::metadata(&decrypted_path).unwrap().permissions().mode() & 0o7777;
    assert_eq!(restored, 0o640);
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p gtkrypt-crypto decrypt::tests::test_decrypt_restores_permissions`
Expected: FAIL (permissions not restored).

**Step 3: Write minimal implementation**

- In `encrypt.rs`, read input file permissions on Unix:
  - `use std::os::unix::fs::PermissionsExt;`
  - `let mode = metadata.permissions().mode() & 0o7777;`
  - Store `mode` in the header as `Some(mode)`.
  - For non-Unix, store `None`.
- In `decrypt.rs`, after `persist` succeeds:
  - If `header_obj.mode` is `Some(mode)` and `mode != 0`, set permissions on the output file.
  - If setting permissions fails, return `DecryptError::Permission` (do not delete the decrypted output).

**Step 4: Run test to verify it passes**

Run: `cargo test -p gtkrypt-crypto decrypt::tests::test_decrypt_restores_permissions`
Expected: PASS (on Unix).

**Step 5: Commit**

```bash
git add crypto/src/encrypt.rs crypto/src/decrypt.rs
git commit -m "feat(crypto): store and restore file permissions"
```

---

### Task 3: Update TypeScript header parser to recognize v2

**Files:**
- Modify: `src/models/types.ts`
- Modify: `src/services/format.ts`

**Step 1: Write the failing test**

Skip: there is no TS/GJS test harness yet. We’ll make a targeted code change and verify via `npm run check`.

**Step 2: Implement minimal changes**

- In `src/models/types.ts`, add `mode?: number` to `ContainerHeader`.
- In `src/services/format.ts`:
  - Allow `CURRENT_VERSION` to be `2` while still accepting `1`.
  - Update `parseHeader` to branch on version:
    - v1: parse as today, set `mode` to `undefined`.
    - v2: read `mode` at `51 + filenameLength`, then shift file size and ciphertext length by +4.
  - Update `MIN_HEADER_SIZE` for v2 (no filename) to 71.

**Step 3: Run typecheck**

Run: `npm run check`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/models/types.ts src/services/format.ts
git commit -m "feat(ts): parse v2 headers with permissions"
```

---

### Task 4: Update scope and docs references

**Files:**
- Modify: `SCOPE.md`

**Step 1: Update container format section**

- Note header v2 includes `mode` (uint32 BE) after filename.
- Update offsets and minimum header size.

**Step 2: Commit**

```bash
git add SCOPE.md
git commit -m "docs: update header format for permissions"
```

---

## Verification

- `cargo test -p gtkrypt-crypto`
- `npm run check`

## Notes
- If the repository isn’t a Git repo, skip commit steps.
- If tests are slow, run the specific test commands first, then full suites.
