# Prompt: Minimalist File Encryption App for Linux (GNOME, GJS, TypeScript)

You are an expert GNOME desktop engineer. Build a **minimalist, privacy-first file encryption application for Linux** that feels native on GNOME. The app is written in **TypeScript** targeting **GJS** (GNOME JavaScript), uses **GTK 4 + Libadwaita**, and integrates cleanly with the desktop.

The guiding principle: **do one thing well** — encrypt and decrypt files — with a small, calm UI and secure defaults.

---

## 1) Product goal

Create a GNOME app (code name: **"gtkrypt"**) that allows a user to:

- **Encrypt** one or more files into an encrypted container file (single output per input, or optional batch mode).
- **Decrypt** encrypted files back to their original contents.
- Use a **password/passphrase** (no online services, no accounts).
- Operate entirely **offline**.
- Provide clear feedback, safe defaults, and predictable behavior.

The UX must be extremely simple:
- One window.
- One primary action area.
- Minimal settings (advanced options hidden behind a disclosure).

---

## 2) Target platform & constraints

- **Linux desktop**: GNOME (Wayland/X11).
- **UI toolkit**: GTK 4 + Libadwaita.
- **Runtime**: GJS.
- **Language**: TypeScript (compiled to JS compatible with GJS).
- **Dev run**: `meson + gjs` (Flatpak packaging deferred to post-completion).

Non-goals:
- No cloud sync.
- No user accounts.
- No multi-device keychains.
- No complex filesystem vault mounting (keep it file-based, not a FUSE filesystem).

---

## 3) Security model & cryptography requirements

### 3.1 Threat model (practical desktop)
Protect against:
- Accidental disclosure (sending, storing, or backing up sensitive files).
- Casual/local attackers without the passphrase.
- Offline brute-force attempts (slow KDF).
- Tampering detection (authenticated encryption).

Not attempting to protect against:
- Compromised OS / keylogger while passphrase is typed.
- Side-channel attacks by advanced adversaries.
- Memory forensics post-compromise (but still try to minimize exposure).

### 3.2 Cryptography design (must implement)
Use modern, standard primitives:

- **Authenticated encryption**: `AES-256-GCM` (or `XChaCha20-Poly1305` if supported easily).
- **KDF**: `Argon2id` (via Rust `argon2` crate).
- **Salt**: 16 bytes random.
- **Nonce/IV**: 12 bytes for AES-GCM (random).
- **Auth tag**: 16 bytes (GCM).
- **Randomness**: from a cryptographically secure source.

**Implementation backend:** Rust binary (`gtkrypt-crypto`) via `Gio.Subprocess`.
  - Uses `aes-gcm` and `argon2` crates for AES-256-GCM and Argon2id.
  - Compiled native binary — fast, no runtime dependencies, avoids rolling crypto in JS.

**Important:** whichever backend is chosen, the app must:
- Verify authentication before writing decrypted output.
- Fail closed: if verification fails, do not output partial plaintext.

### 3.3 File format
Define a simple, self-describing binary container format. Example:

- Magic: 8 bytes: `GTKRYPT\0` (or similar).
- Version: 1 byte.
- KDF id: 1 byte (e.g., 1=Argon2id, 2=scrypt, 3=PBKDF2).
- KDF params: fixed-length structure (or TLV).
- Salt length + salt.
- Nonce length + nonce.
- Original filename (UTF-8) length + bytes (optional, user-toggle; default: **do not store filename**).
- Original file size (u64).
- Ciphertext length (u64).
- Ciphertext.
- Auth tag (if not included in ciphertext blob by backend).

Requirements:
- Must support **streaming** for large files (do not read entire file into memory).
- Must be forward-compatible: unknown TLVs are ignored if possible.
- Include a header checksum or rely on AEAD to detect corruption (AEAD is sufficient if header is authenticated).

### 3.4 Secure handling rules
- Never log passphrases, keys, or plaintext paths in debug output.
- Avoid keeping passphrase in memory longer than needed.
- On decrypt: write to a **temporary file** in the target directory, then atomic rename on success.
- On encrypt: do the same for output.
- Provide an option to **wipe plaintext source file** after successful encryption (off by default; clearly labeled).

---

## 4) UX & UI requirements (Libadwaita)

### 4.1 Main window layout
Single window with:
- Headerbar title: "gtkrypt"
- Primary content:
  - Drag-and-drop area: “Drop files here to encrypt or decrypt”
  - Button: “Choose Files…”
- After selecting files:
  - List of selected items (filename, size, status icon)
  - Primary action button becomes:
    - “Encrypt” if inputs are plaintext
    - "Decrypt" if inputs are `.gtkrypt` containers (detect by magic header)
    - If mixed, prompt user to split or auto-group (prefer: show two sections)

### 4.2 Passphrase flow
When Encrypt/Decrypt is pressed:
- Present a modal sheet:
  - Passphrase entry (with reveal toggle)
  - Confirm passphrase on encrypt only
  - Strength hint (lightweight; do not shame)
  - Option: “Remember for this session” (stores in memory only until app closes)
- A “Show advanced options” expander:
  - Output location (default: same folder)
  - Encrypt output extension: `.gtkrypt`
  - Store original filename in container (default: off)
  - Wipe original after encrypt (default: off)
  - KDF choice (if multiple supported) + params (simple presets: Balanced / Strong / Very Strong)

### 4.3 Progress & results
- Show progress per file and overall.
- Allow canceling an in-progress operation (must stop subprocess/streaming cleanly).
- On completion:
  - Summary: “3 files encrypted” with “Show in Files” button.
  - Inline errors per file (click to expand details).
- Errors must be human-readable:
  - Wrong passphrase → “Incorrect passphrase or file corrupted.”
  - Corrupted header → "Not a gtkrypt file."
  - Permission issues → “No permission to write to …”

### 4.4 Accessibility and GNOME HIG
- Keyboard navigation for everything.
- Proper accessible names and roles.
- High contrast friendly.
- HIG-compliant spacing, typography, and wording.
- Use Adwaita icons and standard GNOME dialogs.

---

## 5) App behavior details

### 5.1 Determining encrypt vs decrypt
- For each selected file:
  - Read the first N bytes (at least magic length).
  - If magic matches container format → treat as encrypted.
  - Otherwise → treat as plaintext.
- If selection contains both:
  - UI should show two groups and let user choose action per group.

### 5.2 Output naming rules
- Encrypt:
  - Default output: `<originalname>.gtkrypt` in same directory.
  - If conflict: append ` (1)`, ` (2)` etc.
- Decrypt:
  - If filename stored in container and user allows using it → restore it.
  - Otherwise default: remove `.gtkrypt` or name as `Decrypted - <timestamp>`.

### 5.3 File permissions
- Preserve original file mode when decrypting (where possible).
- Encrypted outputs: default permissions `0600`.
- Handle symlinks safely: refuse to encrypt symlinks by default; show warning.

### 5.4 Internationalization
- Prepare for i18n:
  - Use gettext for all UI strings.
  - Avoid concatenating strings; use placeholders.

---

## 6) Technical architecture

### 6.1 Project structure (suggested)
- `src/`
  - `main.ts` (app entry)
  - `ui/` (GTK/Adw UI code)
  - `services/crypto.ts` (crypto orchestration)
  - `services/io.ts` (streaming, temp files, atomic rename)
  - `services/format.ts` (container header encode/decode)
  - `services/detect.ts` (magic detection)
  - `models/` (types)
  - `util/` (errors, logging, byte helpers)
- `data/`
  - `.desktop`, app ID, icons, metainfo
- `meson.build`, `package.json` (ts build tooling)

### 6.2 TypeScript for GJS
Use a TS → JS build pipeline compatible with GJS:
- Compile to ES2020 (or what GJS supports on target GNOME).
- Generate GObject Introspection-friendly imports (`gi://Gtk?version=4.0`, etc.) or equivalent.
- Provide typings via `@girs/*` packages where available.

### 6.3 Crypto backend: Rust binary via subprocess

**Chosen approach:** A bundled Rust binary (`gtkrypt-crypto`) invoked via `Gio.Subprocess`.

**Rationale:** OpenSSL CLI lacks AES-GCM in `enc`; libgcrypt/libsodium have no GI typelibs on the target system. A Rust binary using the `aes-gcm` and `argon2` crates provides AES-256-GCM + Argon2id + streaming with zero runtime dependencies, memory safety, and native performance.

**Architecture:**
- A Rust binary (`gtkrypt-crypto`) built from the `crypto/` directory and bundled with the app.
- GJS invokes it via `Gio.Subprocess`, passing parameters as CLI args.
- The binary handles: KDF (Argon2id), encryption/decryption (AES-256-GCM), streaming I/O.
- Passphrase is read from stdin (one line, then EOF).
- Progress is reported via stdout (JSON lines); errors via stderr.
- The binary writes directly to output files (temp file + atomic rename).

**GJS-side interface:**
- `encrypt(inputPath, outputPath, passphrase, options): Promise<void>`
- `decrypt(inputPath, outputPath, passphrase, options): Promise<void>`
- These wrap subprocess invocation, parse progress, and map errors to typed errors.

### 6.4 Streaming I/O
- Use `Gio.File` streams (`Gio.InputStream`, `Gio.OutputStream`).
- Use buffered copying and avoid loading whole files.
- Provide cancellation via `Gio.Cancellable`.

### 6.5 Error taxonomy
Define typed errors:
- `WrongPassphraseError`
- `CorruptFileError`
- `UnsupportedVersionError`
- `PermissionError`
- `CancelledError`
- `InternalCryptoError`

UI maps them to friendly messages.

---

## 7) Packaging & metadata

### 7.1 App ID and desktop integration
- App ID: `io.github.gtkrypt`.
- Include:
  - `.desktop` file
  - AppStream metainfo
  - Icon(s)

### 7.2 Permissions
- Rely on user-selected files where possible.
- Avoid broad filesystem access.

---

## 8) Testing & validation

### 8.1 Unit tests (where feasible)
- Header encode/decode roundtrip.
- Detection logic for magic/version.
- Output naming conflict resolution.
- Error mapping.

### 8.2 Integration tests
- Encrypt → decrypt roundtrip for:
  - small text file
  - binary file
  - large file (>= 1GB) — ensure streaming works.
- Wrong passphrase should produce no plaintext output.
- Corrupted ciphertext should fail with integrity error.
- Cancel mid-operation should:
  - stop crypto backend
  - remove temp files
  - keep originals untouched

### 8.3 Security checks
- Ensure temporary files are not world-readable.
- Ensure decrypted output is only produced after successful verification.
- Confirm that header fields are authenticated (either by including header in AEAD AAD or encrypting header-sensitive fields).

---

## 9) Deliverables

Produce:
1. Full source code (TypeScript + build scripts) for a working GNOME app.
2. Desktop integration files (`.desktop`, metainfo, icons).
3. Clear README:
   - Build/run instructions
   - Cryptography choices and file format
   - Threat model and limitations
4. A short “Design Notes” explaining any tradeoffs (e.g., KDF availability).

---

## 10) Acceptance criteria (must pass)

- App launches and matches GNOME look/feel (Libadwaita).
- Drag-and-drop and file picker both work.
- Encrypt and decrypt operations succeed reliably.
- Large files work without high memory usage.
- Wrong passphrase/corruption never leaks plaintext output.
- Cancel works and leaves no half-written output files.
- No sensitive data in logs.
- Minimal, polished UX.

---

## 11) Implementation hints (do not ignore)

- Prefer a single clear “Encrypt / Decrypt” main flow; avoid complicated modes.
- Keep settings minimal and safe; default to “strong enough” KDF.
- Make the container format versioned from day one.
- The Rust crypto binary must be tested for correct Argon2id + AES-256-GCM behavior on the target system.
- The `gtkrypt-crypto` binary must be compiled and bundled with the app.

---

## 12) Output format for the final answer from the coding assistant

When you implement this prompt, respond with:
- A brief overview of the architecture.
- The complete project file tree.
- All key files with code blocks.
- Build + run steps.
- Notes on crypto and file format.

(Do not include any secrets or example real passphrases in logs.)
