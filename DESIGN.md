# gtkrypt Cryptographic Design

This document describes the cryptographic design of gtkrypt: the algorithms chosen
and why, the binary container format at the byte level, key derivation parameters,
and the threat model with its limitations. It is intended to give a security
reviewer everything needed to evaluate the system without reading source code.

---

## Table of Contents

1. [Cryptographic Choices and Rationale](#cryptographic-choices-and-rationale)
2. [Container Format Specification](#container-format-specification)
3. [KDF Parameter Presets](#kdf-parameter-presets)
4. [Threat Model and Limitations](#threat-model-and-limitations)

---

## Cryptographic Choices and Rationale

### AES-256-GCM (Authenticated Encryption)

gtkrypt uses AES-256-GCM as its sole AEAD (Authenticated Encryption with
Associated Data) cipher.

**Why authenticated encryption.** An encryption scheme that does not authenticate
ciphertext is vulnerable to ciphertext manipulation. An attacker who modifies
encrypted bytes can cause the decrypted output to differ from the original in
controlled ways without the recipient detecting the change. GCM mode produces a
128-bit authentication tag for every encryption operation. If any bit of the
ciphertext, the nonce, or the associated data has been tampered with, decryption
fails with an authentication error rather than producing corrupted plaintext.
This is critical for a file encryption tool: a user must be able to trust that a
successfully decrypted file is identical to what was originally encrypted.

**Why 256-bit keys.** AES-128 is considered secure against classical brute force
for the foreseeable future. However, AES-256 provides a wider security margin
and is standard practice for file-at-rest encryption. It offers 128-bit
post-quantum security against Grover's algorithm (which halves the effective key
length for symmetric ciphers). The performance difference between AES-128 and
AES-256 is negligible on modern hardware with AES-NI instructions.

**Implementation.** The Rust backend uses the `aes-gcm` crate (version 0.10),
which builds on the RustCrypto ecosystem. Encryption and decryption use the
`encrypt_in_place_detached` and `decrypt_in_place_detached` APIs respectively,
which produce and verify a 16-byte (128-bit) authentication tag separate from
the ciphertext.

### Argon2id (Key Derivation Function)

gtkrypt derives the 256-bit AES key from the user's passphrase using Argon2id.

**Why Argon2id over bcrypt or scrypt.** Argon2 won the Password Hashing
Competition in 2015 and is recommended by OWASP and NIST SP 800-63B (via
reference) for password-based key derivation. The `id` variant combines the
side-channel resistance of Argon2i (data-independent memory access in the first
pass) with the GPU/ASIC resistance of Argon2d (data-dependent memory access in
subsequent passes). This makes it the best general-purpose choice:

- **bcrypt** is limited to 72-byte passwords and has a fixed, modest memory
  footprint (~4 KiB). It cannot be tuned for memory hardness, which leaves it
  vulnerable to GPU-based attacks.
- **scrypt** supports memory hardness but couples memory and CPU cost through a
  single parameter (N), making it difficult to tune independently. It also lacks
  the formal security analysis and competition vetting that Argon2 received.
- **Argon2id** provides independent tuning of time cost (iterations), memory
  cost, and parallelism, giving precise control over the cost/security tradeoff.

**Key derivation parameters.** Each encrypted file stores the Argon2id parameters
(time cost, memory cost, parallelism) in its header, so decryption always uses
the same parameters that were used during encryption. This means files remain
decryptable even if the application defaults change in a future version.

**Salt.** A 16-byte (128-bit) cryptographically random salt is generated per file
using the operating system's CSPRNG (via `rand::thread_rng()` in Rust, which
delegates to `getrandom`). The salt is stored in the file header. This ensures
that encrypting the same file with the same passphrase produces a different
derived key each time, preventing precomputation attacks.

**Implementation.** The Rust backend uses the `argon2` crate (version 0.5) with
`Algorithm::Argon2id` and `Version::V0x13` (Argon2 version 1.3). The output
length is fixed at 32 bytes (256 bits).

### Chunked Streaming Encryption (64 KiB Chunks)

Rather than encrypting the entire file as a single AES-GCM operation, gtkrypt
splits the plaintext into 64 KiB (65,536-byte) chunks. Each chunk is encrypted
independently with its own nonce and authentication tag.

**Why chunked.** AES-GCM operates on the entire plaintext in memory to produce
a single authentication tag. For large files (hundreds of megabytes or gigabytes),
this would require loading the entire file into memory. Chunked encryption keeps
peak memory usage bounded: only one 64 KiB buffer plus a small amount of
overhead is needed regardless of file size. This is essential for a desktop
application that must coexist with other programs.

**Per-chunk nonces.** Each chunk receives a unique 12-byte nonce derived from a
base nonce (stored in the header) by XOR-ing the chunk index (as a big-endian
uint32) into the last 4 bytes of the base nonce. This guarantees nonce
uniqueness across all chunks within a single file without requiring additional
random generation per chunk. The derivation is:

```
chunk_nonce = base_nonce
chunk_nonce[8..12] ^= chunk_index.to_be_bytes()
```

Since the base nonce is 12 bytes and the chunk index occupies the last 4 bytes,
this supports up to 2^32 chunks per file (256 TiB at 64 KiB per chunk), which
is far beyond any practical file size.

**Per-chunk AAD.** Each chunk's Additional Authenticated Data is formed by
appending the chunk index (big-endian uint32) to the base AAD (the first 49
bytes of the header). This binds each chunk to its position in the file,
preventing an attacker from reordering, duplicating, or removing chunks without
detection.

```
chunk_aad = header_bytes[0..49] || chunk_index.to_be_bytes()
```

**Per-chunk authentication tags.** Each chunk produces a 16-byte GCM
authentication tag that is written immediately after the chunk's ciphertext.
During decryption, each chunk is independently verified. If any single chunk
fails authentication (due to tampering, corruption, or a wrong passphrase), the
entire decryption operation fails and no plaintext is written to the output.

**Chunk size rationale.** 64 KiB balances memory efficiency against per-chunk
overhead. Each chunk adds 16 bytes of authentication tag, so the overhead is
16/65536 = 0.024%, which is negligible. Smaller chunks would increase overhead
and reduce throughput; larger chunks would increase peak memory usage.

---

## Container Format Specification

A `.gtkrypt` file consists of a variable-length header followed by a payload of
encrypted chunks. The file uses big-endian byte order for all multi-byte integer
fields.

### Header Layout

The header is divided into two regions: the AAD region (bytes 0 through 48,
inclusive) and the metadata region (bytes 49 onward).

#### Version 2 (current)

```
Offset    Size      Field                   Description
--------  --------  ----------------------  ------------------------------------
0         8         Magic                   ASCII "GTKRYPT" + null byte (0x00)
8         1         Version                 Format version (2)
9         1         KDF ID                  KDF algorithm identifier (1 = Argon2id)
10        4         Time cost               Argon2id iterations (uint32 BE)
14        4         Memory cost             Argon2id memory in KiB (uint32 BE)
18        1         Parallelism             Argon2id parallelism (uint8)
19        1         Salt length             Always 16 (uint8)
20        16        Salt                    Random salt for Argon2id
36        1         Nonce length            Always 12 (uint8)
37        12        Nonce                   Random base nonce for AES-256-GCM
                    --- AAD boundary (byte 49) ---
49        2         Filename length         Original filename length in bytes (uint16 BE; 0 = not stored)
51        N         Filename                Original filename (UTF-8, optional)
51+N      4         Mode                    POSIX file permissions (uint32 BE; 0 = unknown)
55+N      8         Original file size      Size of plaintext in bytes (uint64 BE)
63+N      8         Ciphertext length       Total ciphertext bytes, excluding tags (uint64 BE)
```

Total header size: **71 + N bytes**, where N is the filename length (0 if not stored).

#### Version 1 (legacy, still readable)

Version 1 omits the Mode field. Its header is **67 + N bytes**:

```
Offset    Size      Field
--------  --------  ----------------------
0-48                (identical to version 2)
49        2         Filename length
51        N         Filename
51+N      8         Original file size
59+N      8         Ciphertext length
```

The decoder accepts both version 1 and version 2 headers. Any other version
value causes the decoder to reject the file with an `UnsupportedVersion` error.

### AAD (Additional Authenticated Data)

The AAD for AES-GCM authentication is the first 49 bytes of the header (offsets
0 through 48 inclusive). This region covers:

- Magic bytes (ensures the file is identified correctly)
- Version and KDF identifier
- All Argon2id parameters (time cost, memory cost, parallelism)
- Salt length and salt value
- Nonce length and base nonce value

By including these fields in the AAD, any modification to the cryptographic
parameters (for example, reducing the time cost to weaken the KDF) will cause
GCM authentication to fail during decryption. The filename, mode, file size,
and ciphertext length are outside the AAD but are implicitly protected: if the
ciphertext length is altered, chunk boundaries will be wrong and decryption will
fail; if the filename is altered, it affects only the suggested output filename,
not the cryptographic integrity of the data.

### Payload Layout

The payload immediately follows the header. It consists of a sequence of
encrypted chunks:

```
For each chunk i (i = 0, 1, 2, ...):
  Offset (relative to payload start)    Size              Content
  -----------------------------------   ----------------  --------------------
  sum of previous (chunk + tag) sizes   min(65536, R)     Ciphertext chunk
  + chunk ciphertext size               16                GCM authentication tag
```

Where R is the remaining plaintext bytes. The last chunk may be shorter than
65,536 bytes.

Each chunk is encrypted with:
- **Nonce:** `base_nonce XOR (chunk_index as uint32 BE in last 4 bytes)`
- **AAD:** `header[0..49] || chunk_index as uint32 BE`
- **Key:** the 256-bit key derived from Argon2id

The ciphertext for each chunk has the same length as the corresponding plaintext
chunk. The 16-byte GCM authentication tag is appended after each chunk's
ciphertext.

**Total file size formula:**

```
total = header_size + ciphertext_length + (num_chunks * 16)

where:
  header_size      = 71 + filename_length   (version 2)
  ciphertext_length = original_file_size
  num_chunks       = ceil(original_file_size / 65536)
```

For a 0-byte file, num_chunks is 0 and the payload is empty.

### Nonce Uniqueness

The base nonce is a 12-byte value generated from the OS CSPRNG. Per-chunk nonces
are derived by XOR-ing the chunk index into bytes 8 through 11. Because each
file uses a freshly random base nonce and each chunk within a file uses a unique
index, nonce reuse cannot occur under normal operation. The probability of base
nonce collision across two files encrypted with the same key is approximately
2^-64 for the 8 unmodified bytes, which is negligible.

### Version Compatibility

- Readers MUST reject files with a version field other than 1 or 2.
- Version 1 files lack the Mode field; the decoder treats the file mode as
  unknown (no permission restoration on decrypt).
- Future versions may add fields after the current header. The version field
  allows readers to determine the header layout.

---

## KDF Parameter Presets

gtkrypt offers three Argon2id parameter presets. The user selects a preset in the
passphrase dialog. The parameters are stored in the encrypted file header, so the
correct parameters are always used during decryption regardless of what preset
the application currently defaults to.

| Preset        | Time Cost | Memory Cost       | Parallelism | Typical Duration     |
|---------------|-----------|-------------------|-------------|----------------------|
| Balanced      | 3         | 65,536 KiB (64 MiB)  | 4           | Sub-second on modern hardware |
| Strong        | 4         | 262,144 KiB (256 MiB) | 4           | 1-2 seconds          |
| Very Strong   | 6         | 524,288 KiB (512 MiB) | 4           | Several seconds      |

**Balanced** is the default. It is designed for interactive use where the user
should not wait more than roughly one second for key derivation on a typical
desktop machine (circa 2024).

**Strong** increases both time and memory costs. The 256 MiB memory requirement
makes GPU-based cracking significantly more expensive, since consumer GPUs
typically have limited per-thread memory.

**Very Strong** is intended for users with high-security requirements who are
willing to accept a multi-second delay. The 512 MiB memory cost makes parallel
cracking on GPUs or ASICs impractical with current hardware.

All presets use parallelism of 4, which maps well to modern multi-core desktop
CPUs without excessive resource consumption.

**Rationale for parameter choices.** The presets follow OWASP recommendations for
Argon2id, which suggest a minimum of 19 MiB memory and 2 iterations for
interactive login. gtkrypt's Balanced preset substantially exceeds this minimum
because file encryption is a less frequent operation than login, so a somewhat
longer delay is acceptable. The Strong and Very Strong presets are designed for
users who prioritize resistance to offline brute-force attacks over speed.

---

## Threat Model and Limitations

### What gtkrypt protects against

**File theft / unauthorized file access.** If an encrypted `.gtkrypt` file is
obtained by an attacker (via stolen disk, backup, USB drive, cloud storage, or
network interception), the attacker cannot recover the plaintext without knowing
the passphrase. The security rests on the strength of AES-256-GCM and the cost
of brute-forcing the passphrase through Argon2id.

**Ciphertext tampering.** Any modification to the encrypted file (header
parameters, ciphertext bytes, or authentication tags) is detected during
decryption. GCM authentication fails and no plaintext is emitted. This prevents
silent data corruption and targeted bit-flipping attacks.

**Header parameter downgrade.** Because the Argon2id parameters (time cost,
memory cost, parallelism) and the salt are included in the GCM Additional
Authenticated Data, an attacker cannot alter these values to weaken key
derivation without causing an authentication failure.

**Partial file exposure.** On decryption failure (wrong passphrase, corrupted
data, or cancellation), gtkrypt writes to a temporary file and only performs an
atomic rename on success. If decryption fails at any chunk, the temporary file
is not persisted and no partial plaintext is left on disk.

**Encrypted file permissions.** Encrypted output files are created with mode
`0600` (owner read/write only), preventing other users on the system from
reading the file before the user explicitly changes permissions.

### What gtkrypt does NOT protect against

**Weak passphrases.** Argon2id increases the cost of brute-force attacks but
cannot make a weak passphrase strong. A 4-digit PIN or a common dictionary word
will be cracked regardless of KDF parameters. gtkrypt does not enforce passphrase
complexity beyond requiring a non-empty input. Users are responsible for choosing
a strong passphrase.

**Compromised operating system or runtime.** If the operating system is
compromised (rootkit, malware, or a malicious kernel module), an attacker can
read the passphrase from process memory, intercept keystrokes, or read the
plaintext file before encryption or after decryption. gtkrypt assumes the OS and
the GJS runtime are trustworthy.

**Keyloggers and screen capture.** The passphrase is typed into a GTK dialog and
passed to the Rust subprocess via stdin. If a keylogger or screen capture tool
is running, the passphrase is exposed. gtkrypt does not provide any defense
against input interception.

**Memory forensics.** The derived key and passphrase exist in process memory
during the encryption or decryption operation. gtkrypt does not pin memory pages
or use `mlock` to prevent swapping, and it does not securely zero key material
after use. An attacker with access to a memory dump, swap file, or hibernation
image may recover sensitive material. (The passphrase held in the GJS session
memory feature is similarly unprotected in process memory for the lifetime of
the application.)

**Secure wipe limitations on SSDs and copy-on-write filesystems.** The "wipe
original" feature overwrites the original file with zeros in a single pass and
then deletes it. This is effective on traditional spinning-disk hard drives with
direct block mapping. However:

- **SSDs** use wear leveling and may retain old data in unmapped blocks. A
  single-pass overwrite does not guarantee that the original plaintext is
  physically erased from the flash storage.
- **Copy-on-write filesystems** (such as Btrfs or ZFS) do not overwrite data in
  place. Writing zeros creates a new copy of the blocks while the old blocks
  may remain allocated to snapshots or free space.
- **Journaling filesystems** (such as ext4 with `data=journal`) may retain
  copies of file data in the journal.

For these storage configurations, the only reliable way to ensure data erasure
is full-disk encryption (such as LUKS/dm-crypt) combined with secure key
destruction.

**No forward secrecy.** There is a single passphrase-derived key per file. If
the passphrase is later compromised, all files encrypted with that passphrase
can be decrypted. There is no ephemeral key exchange or ratcheting mechanism.

**No key stretching beyond Argon2id.** The system relies entirely on Argon2id
for passphrase-to-key derivation. There is no additional layer of key wrapping,
hardware security module (HSM) integration, or multi-factor key derivation. The
security of the derived key is bounded by the passphrase entropy and the
Argon2id cost parameters.

**No authentication of metadata outside the AAD.** The filename, file mode,
original file size, and ciphertext length fields in the header are not covered
by the GCM AAD (they fall after byte 48). Modifying these fields does not cause
a cryptographic authentication failure. However:

- Altering the **ciphertext length** will cause chunk boundary misalignment,
  resulting in GCM authentication failure during decryption.
- Altering the **original file size** may cause truncation or padding
  detection issues.
- Altering the **filename** only affects the suggested output filename on
  decryption; it does not compromise data integrity.
- Altering the **mode** only affects the permissions set on the decrypted
  output file.

An attacker who can modify the file on disk can always delete it entirely, so
the ability to alter non-AAD metadata fields is a limited concern.

**Side-channel attacks.** The Rust `aes-gcm` crate uses hardware AES-NI
instructions when available, which are constant-time. On platforms without
AES-NI, software AES implementations may be vulnerable to cache-timing attacks.
Argon2id's first pass uses data-independent memory access to mitigate
side-channel leakage during key derivation.

### Cryptographic Library Provenance

| Component   | Crate        | Version | Source                          |
|-------------|--------------|---------|---------------------------------|
| AES-256-GCM | `aes-gcm`   | 0.10    | RustCrypto project              |
| Argon2id    | `argon2`     | 0.5     | RustCrypto project              |
| CSPRNG      | `rand`       | 0.8     | Rust `rand` project (getrandom) |

All cryptographic operations run in the `gtkrypt-crypto` Rust binary. The
TypeScript/GJS frontend never handles key material or performs cryptographic
operations; it only spawns the Rust subprocess, passes the passphrase via stdin,
and reads progress/error JSON from stdout/stderr.

---

## Summary of Security Properties

| Property                        | Status    | Notes                                         |
|---------------------------------|-----------|-----------------------------------------------|
| Confidentiality                 | Provided  | AES-256-GCM encryption                        |
| Integrity                       | Provided  | Per-chunk GCM authentication tags              |
| Authenticity                    | Provided  | AAD binds header parameters to ciphertext      |
| Chunk ordering protection       | Provided  | Per-chunk AAD includes chunk index             |
| Nonce reuse prevention          | Provided  | Random base nonce + deterministic per-chunk derivation |
| Brute-force resistance          | Provided  | Argon2id with configurable cost parameters     |
| Forward secrecy                 | Not provided | Single key per file, no ratcheting           |
| Memory protection               | Not provided | No mlock, no secure zeroing                  |
| Secure deletion on SSD/COW      | Not provided | Single-pass overwrite only                   |
| Multi-factor authentication     | Not provided | Passphrase only                              |
