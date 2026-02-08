# Permissions Metadata in Container Header (Phase 5.1)

## Goal
Store original file permissions in the container header so decrypted output can restore the original mode. If permissions are missing, decryption falls back to the system’s default umask behavior.

## Recommended Approach
- Add a `mode` field to the container header as a `uint32` (Unix permission bits).
- Bump the container version to `2` to preserve backward compatibility.
- Rust decrypt should accept v1 and v2; v1 has no `mode` field.
- Rust encrypt should store `mode` when available, otherwise store `0` as a sentinel.
- Rust decrypt should apply `mode` after successful atomic rename when `mode != 0`.
- TypeScript parser should decode v1 and v2 headers and expose `mode?: number`.

## Header Layout (v2)
After optional filename, insert a `mode` field:

- `mode` (uint32 BE) — original Unix permissions masked to `0o7777`
- `file_size` (uint64 BE)
- `ciphertext_length` (uint64 BE)

This change requires a version bump because the offsets after filename shift.

## Data Flow
- Encrypt (Rust): read metadata permissions via `PermissionsExt::mode()` (Unix), mask to `0o7777`, store in header as `mode`. If unavailable, store `0`.
- Decrypt (Rust): parse header; if `mode != 0` apply to output file after rename. If setting permissions fails, treat as permission error only if it indicates lack of write/metadata permissions; otherwise return an internal error but leave decrypted output intact.
- GJS: no additional subprocess roundtrip required; TS parsing updated for completeness.

## Error Handling
- Unsupported version: fail with `UnsupportedVersionError` (v1 and v2 accepted).
- Permission set failure: map to `PermissionError` when appropriate. Keep decrypted file rather than deleting (do not risk data loss).

## Testing
- Rust header tests: roundtrip encode/decode for v2 with `mode`.
- Rust decrypt test: on Unix, verify decrypted output has the stored `mode`.
- Non-Unix environments: skip permission assertions with `#[cfg(unix)]`.

## Out of Scope
- UI surface of permissions in results view.
- Changing defaults for encrypted file permissions (already set to `0600` in Rust temp output).
