# gtkrypt — Project Scope & Development Checklist

> Minimalist, privacy-first file encryption app for GNOME Linux desktops.

---

## Overview

**gtkrypt** encrypts and decrypts files using a passphrase. It runs natively on GNOME with GTK 4 + Libadwaita, is written in TypeScript targeting GJS, and delegates all cryptography to a bundled Rust binary (`gtkrypt-crypto`).

### Key decisions (locked in)

| Item | Decision |
|---|---|
| App name | gtkrypt |
| App ID | `io.github.gtkrypt` |
| File extension | `.gtkrypt` |
| Magic bytes | `GTKRYPT\0` (8 bytes) |
| AEAD cipher | AES-256-GCM |
| KDF | Argon2id |
| Crypto backend | Rust binary (`gtkrypt-crypto`) via `Gio.Subprocess` |
| UI toolkit | GTK 4.20 + libadwaita 1.8 |
| Runtime | GJS (targeting Firefox 115 / GJS >= 1.77.2) |
| Language | TypeScript → ES2024 JS (esbuild, entry `src/index.ts`) |
| Packaging (v1) | `meson + gjs` dev mode |

### Runtime dependencies

- GJS >= 1.78
- GTK4 >= 4.14
- libadwaita >= 1.5
- `gtkrypt-crypto` binary (bundled, built from Rust source in `crypto/`)

### Non-goals

- Cloud sync, user accounts, multi-device keychains
- FUSE filesystem / vault mounting
- Flatpak packaging (deferred to post-completion)

---

## Status snapshot (February 8, 2026)

- Core Rust crypto backend is implemented with chunked AES-256-GCM, Argon2id, header parsing/encoding, and progress/error JSON reporting.
- GJS app flow is implemented end-to-end (DnD, file picker, file list, passphrase dialog, progress, results, symlink warning).
- Desktop integration is complete: .desktop file, AppStream metainfo, app icons, MIME type registration, and full meson install rules.
- All core features are implemented including passphrase dialog options (output directory, stored filename toggle), file permission handling, and TypeScript test infrastructure.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│                  GJS Process                  │
│                                              │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
│  │ index.ts │→ │  UI layer │→ │  Services  │ │
│  │ (Adw.App)│  │ (GTK4/Adw)│  │(crypto,io)│ │
│  └──────────┘  └───────────┘  └─────┬─────┘ │
│                                     │        │
│                          Gio.Subprocess      │
│                                     │        │
└─────────────────────────────────────┼────────┘
                                      │
                               ┌──────▼──────┐
                               │ Rust binary │
                               │ gtkrypt-    │
                               │ crypto      │
                               │             │
                               │ - Argon2id  │
                               │ - AES-256-  │
                               │   GCM       │
                               │ - Streaming │
                               └─────────────┘
```

### Data flow

1. User selects files via drag-and-drop or file picker
2. App detects encrypt vs decrypt by reading magic bytes
3. User enters passphrase in modal dialog
4. GJS spawns `gtkrypt-crypto` via `Gio.Subprocess`
5. Helper reads input, derives key (Argon2id), encrypts/decrypts (AES-256-GCM)
6. Helper streams progress via stdout JSON lines (`progress`, `bytes_processed`, `total_bytes`, `phase`)
7. Helper writes to temp file, then atomic rename on success
8. GJS shows results; user can "Show in Files"

### Container format (`.gtkrypt`)

Header layout (variable length due to optional filename):

```
Offset  Size     Field
─────────────────────────────────
0       8        Magic: GTKRYPT\0
8       1        Version (1)
9       1        KDF ID (1=Argon2id)
10      4        Argon2 time cost (uint32 BE)
14      4        Argon2 memory cost in KiB (uint32 BE)
18      1        Argon2 parallelism (uint8)
19      1        Salt length (16)
20      16       Salt
36      1        Nonce length (12)
37      12       Nonce/IV (base nonce)
49      2        Filename length (uint16 BE, 0 = not stored)
51      N        Original filename (UTF-8, optional)
51+N    4        Mode (uint32 BE, v2 only; 0 = unknown)
55+N    8        Original file size (uint64 BE)
63+N    8        Ciphertext length (uint64 BE, equals original size)
```

Payload layout (repeats per chunk, chunk size = 64 KiB):

```
Chunk i:
  - Ciphertext chunk (len = min(64 KiB, remaining))
  - GCM auth tag (16 bytes) for that chunk
```

Notes:
Header bytes 0..48 (inclusive) are used as base AAD.
Per-chunk AAD = base AAD + chunk index (uint32 BE).
Per-chunk nonce = base nonce with chunk index XOR’d into the last 4 bytes.
Forward-compatible: readers reject unknown versions with `UnsupportedVersionError`.

---

## Project structure

```
gtkrypt/
├── src/
│   ├── index.ts                 # Adw.Application entry point
│   ├── ui/
│   │   ├── window.ts            # Main window (Adw.ApplicationWindow)
│   │   ├── fileList.ts          # Selected files list widget
│   │   ├── passphraseDialog.ts  # Modal passphrase entry
│   │   ├── progressView.ts      # Per-file + overall progress
│   │   └── resultView.ts        # Completion summary
│   ├── services/
│   │   ├── crypto.ts            # Subprocess orchestration for encrypt/decrypt
│   │   ├── io.ts                # File metadata, permissions, secure wipe
│   │   ├── format.ts            # Container header decode (TS side)
│   │   ├── detect.ts            # Magic byte detection
│   │   └── naming.ts            # Output filename generation + conflict resolution
│   ├── models/
│   │   ├── types.ts             # Shared types and interfaces
│   │   └── errors.ts            # Typed error classes
│   ├── util/
│   │   ├── bytes.ts             # Binary read/write helpers
│   │   └── logging.ts           # Safe logger (never logs secrets)
│   ├── MainWindow.ts            # Legacy prototype (unused)
│   └── MenuButton.ts            # Legacy prototype (unused)
├── crypto/                       # Rust crypto backend
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs               # CLI entry point
│       ├── encrypt.rs            # Encryption logic
│       ├── decrypt.rs            # Decryption logic
│       ├── header.rs             # Container header encode/decode
│       ├── kdf.rs                # Argon2id key derivation
│       └── progress.rs           # JSON progress reporting
├── data/
│   ├── io.github.gtkrypt.metainfo.xml
│   ├── meson.build
│   └── icons/                    # App icon assets (currently empty)
├── dist/                         # Build output + meson resources
│   ├── index.js
│   ├── io.github.gtkrypt.js
│   ├── io.github.gtkrypt.src.gresource.xml
│   └── meson.build
├── bin/gtkrypt
├── esbuild.js
├── meson.build
├── package.json
├── tsconfig.json
├── PROMPT.md
├── SCOPE.md
└── README.md
```

---

## Development Phases & Checklist

### Phase 1: Foundation — Build system & data layer

> Goal: Project compiles, runs a blank Adw window, and all types/models exist.

- [x] **1.1 Initialize project scaffolding**
  - Create directory structure (`src/`, `crypto/`, `tests/`, `data/`)
  - Create `package.json` with project metadata
  - Install dev dependencies: `typescript`, `esbuild`, `@girs/gjs`, `@girs/gtk-4.0`, `@girs/adw-1`
  - _Acceptance: `npm install` succeeds_

- [x] **1.2 Configure TypeScript**
  - Create `tsconfig.json` targeting ES2022, strict mode, ESM output
  - Configure paths for `gi://` imports
  - _Acceptance: `npx tsc --noEmit` succeeds with no errors on an empty `index.ts`_

- [x] **1.3 Configure esbuild for GJS**
  - Create `esbuild.js` that bundles `src/index.ts` → `dist/`
  - Handle `gi://` imports as external
  - Configure GJS-compatible output (ESM, target `firefox115`)
  - Add `npm run build` script
  - Current status: build outputs `dist/index.js`; `npm run start` still references `dist/main.js`
  - _Acceptance: `npm run build` produces `dist/index.js`_

- [x] **1.4 Create minimal app entry point**
  - `src/index.ts`: import GJS modules, create `Adw.Application`, show main window
  - `src/ui/window.ts`: `Adw.ApplicationWindow` implementation
  - Add `npm run start` script (`npm run build && gjs -m dist/main.js`)
  - _Acceptance: `npm run build && npm run start` launches a blank Adw window titled "gtkrypt"_

- [x] **1.5 Define data models and types**
  - `src/models/types.ts`:
    - `FileEntry` (path, name, size, type: 'plaintext' | 'encrypted' | 'unknown')
    - `EncryptOptions` (outputDir, storeFilename, wipeOriginal, kdfPreset)
    - `DecryptOptions` (outputDir, useStoredFilename)
    - `KdfPreset` ('balanced' | 'strong' | 'very-strong') with Argon2 params
    - `ContainerHeader` (version, kdfId, kdfParams, salt, nonce, filename, fileSize, ciphertextLength)
    - `ProgressEvent` (fileIndex, bytesProcessed, totalBytes, phase: 'kdf' | 'encrypt' | 'decrypt')
    - `CryptoResult` (success, outputPath, error?)
  - _Acceptance: types compile with no errors_

- [x] **1.6 Define error classes**
  - `src/models/errors.ts`:
    - `GtkryptError` (base class)
    - `WrongPassphraseError`
    - `CorruptFileError`
    - `UnsupportedVersionError`
    - `PermissionError`
    - `CancelledError`
    - `InternalCryptoError`
  - Each has a `userMessage` property with human-readable text
  - _Acceptance: errors compile, each has correct `userMessage`_

- [x] **1.7 Implement binary helpers**
  - `src/util/bytes.ts`:
    - `writeUint8(buffer, offset, value)`
    - `writeUint16BE(buffer, offset, value)`
    - `writeUint32BE(buffer, offset, value)`
    - `writeUint64BE(buffer, offset, value)`
    - Corresponding `readUint8`, `readUint16BE`, `readUint32BE`, `readUint64BE`
    - `concatBytes(...arrays): Uint8Array`
  - _Acceptance: unit tests pass for roundtrip encode/decode of each type_

- [x] **1.8 Implement safe logger**
  - `src/util/logging.ts`:
    - `log(level, message)` — outputs to stderr
    - Never accepts or logs passphrase/key/plaintext arguments
    - Configurable verbosity via env var (`GTKRYPT_LOG_LEVEL`)
  - _Acceptance: logger compiles; does not expose any function that takes sensitive params_

---

### Phase 2: Crypto — Rust backend & container format

> Goal: Encryption and decryption work end-to-end via CLI, container format is solid.

- [x] **2.1 Set up Rust project**
  - `crypto/Cargo.toml`:
    - Binary name: `gtkrypt-crypto`
    - Dependencies: `aes-gcm`, `argon2`, `clap`, `serde`, `serde_json`, `rand`
    - Build profile: release optimized
  - _Acceptance: `cargo build --release` produces `crypto/target/release/gtkrypt-crypto`_

- [x] **2.2 Implement Rust crypto binary**
  - `crypto/src/main.rs` + modules:
    - CLI interface: `gtkrypt-crypto encrypt|decrypt --input PATH --output PATH [--time-cost N --memory-cost N --parallelism N --store-filename]`
    - Passphrase read from stdin (one line, then EOF)
    - Argon2id KDF with configurable params (time_cost, memory_cost, parallelism)
    - AES-256-GCM encryption with 12-byte random nonce
    - Streaming: read input in 64 KiB chunks
    - Write container header + chunked ciphertext + per-chunk auth tags
    - Temp file + atomic rename on success
    - Progress reporting: JSON lines on stdout (`{"progress":0.5,"bytes_processed":1048576,"total_bytes":2097152,"phase":"encrypt"}`)
    - Error reporting: JSON on stderr (`{"error": "wrong_passphrase", "message": "..."}`)
    - Exit codes: 0 = success, 1 = wrong passphrase, 2 = corrupt file, 3 = permission error, 10 = internal error
  - _Acceptance: `echo "testpass" | gtkrypt-crypto encrypt --input test.txt --output test.txt.gtkrypt` succeeds_

- [x] **2.3 Implement container header encoding in Rust**
  - Encode header per the format spec (magic, version, KDF params, salt, nonce, filename, file size, ciphertext length)
  - Include header bytes (up through nonce) as AAD for GCM authentication
  - _Acceptance: hexdump of output shows correct magic bytes and field layout_

- [x] **2.4 Implement container header decoding in Rust**
  - Parse and validate magic, version, KDF ID
  - Extract salt, nonce, optional filename, file size, ciphertext length
  - Reject unknown versions with clear error
  - _Acceptance: decrypt reads back what encrypt wrote_

- [x] **2.5 Implement decrypt in Rust binary**
  - Read header, derive key from passphrase + salt via Argon2id
  - Decrypt ciphertext with AES-256-GCM, verifying auth tag
  - On auth failure: exit with code 1, output no plaintext
  - On success: atomic rename temp file to output path
  - _Acceptance: encrypt → decrypt roundtrip preserves file contents byte-for-byte_

- [x] **2.6 Implement streaming for large files**
  - Encrypt/decrypt in 64 KiB chunks
  - Manual chunked AES-GCM with per-chunk nonces and tags
  - Report progress after each chunk
  - _Acceptance: encrypt + decrypt a 100 MB file; peak memory stays under ~10 MB_

- [x] **2.7 Write Rust tests**
  - `crypto/src/` inline tests + `crypto/tests/` integration tests:
    - Roundtrip: small text file, binary file
    - Wrong passphrase: no output file created
    - Corrupted ciphertext: integrity error, no output
    - Corrupted header: clear error message
    - KDF presets produce correct Argon2id params
    - Header AAD: tampered header detected by GCM
  - _Acceptance: `cargo test` all pass (tests currently live in `crypto/src/*`)_

- [x] **2.8 Implement container format in TypeScript (read-only)**
  - `src/services/format.ts`:
    - `parseHeader(bytes: Uint8Array): ContainerHeader` — decode header for display/detection
    - `HEADER_MAGIC = new Uint8Array([0x47, 0x54, 0x4B, 0x52, 0x59, 0x50, 0x54, 0x00])`
    - `CURRENT_VERSION = 1`
  - _Acceptance: parsing a .gtkrypt file's first N bytes returns correct ContainerHeader_

- [x] **2.9 Implement magic detection**
  - `src/services/detect.ts`:
    - `detectFileType(path: string): Promise<'plaintext' | 'encrypted' | 'unknown'>`
    - Read first 8 bytes via `Gio.File` / `Gio.InputStream`
    - Compare against `HEADER_MAGIC`
  - _Acceptance: correctly identifies .gtkrypt files vs plaintext vs empty files_

- [x] **2.10 Implement output naming logic**
  - `src/services/naming.ts`:
    - `getEncryptOutputPath(inputPath, outputDir?): string` — appends `.gtkrypt`, handles conflicts with `(1)`, `(2)` etc.
    - `getDecryptOutputPath(inputPath, storedFilename?, outputDir?): string` — strips `.gtkrypt` or generates `Decrypted - <timestamp>`
    - Conflict detection via `Gio.File.query_exists()`
  - _Acceptance: unit tests cover name generation, conflict resolution, and edge cases_

---

### Phase 3: GJS ↔ Rust bridge

> Goal: TypeScript services can invoke encrypt/decrypt and receive structured results.

- [x] **3.1 Implement crypto service**
  - `src/services/crypto.ts`:
    - `encrypt(inputPath, outputPath, passphrase, options): Promise<CryptoResult>`
    - `decrypt(inputPath, outputPath, passphrase, options): Promise<CryptoResult>`
    - Spawn `gtkrypt-crypto` via `Gio.Subprocess`
    - Write passphrase to subprocess stdin, then close stdin
    - Parse stdout JSON lines for progress events
    - Parse stderr for error JSON
    - Map exit codes to typed errors
    - Support `Gio.Cancellable` — kill subprocess on cancel
  - _Acceptance: calling `encrypt()` from GJS encrypts a file; `decrypt()` decrypts it back_

- [x] **3.2 Implement I/O service**
  - `src/services/io.ts`:
    - `setFilePermissions(path, mode)` — set file permissions (default `0600` for encrypted output)
    - `isSymlink(path): boolean` — detect symlinks
    - `getFileSize(path): number`
    - `readFileHead(path, bytes): Uint8Array` — read first N bytes for detection
  - _Acceptance: each function works correctly from GJS_

- [x] **3.3 Implement progress event handling**
  - In `crypto.ts`: parse JSON lines from subprocess stdout
  - Emit progress via a callback: `onProgress(event: ProgressEvent)`
  - Handle partial line buffering (JSON lines may arrive in chunks)
  - _Acceptance: progress callback fires with correct percentages during encrypt/decrypt_

- [x] **3.4 Implement cancellation**
  - Pass `Gio.Cancellable` through to subprocess
  - On cancel: send SIGTERM to subprocess, clean up temp files
  - Ensure no partial output files remain after cancel
  - _Acceptance: canceling mid-operation kills subprocess and leaves no temp files_

---

### Phase 4: User Interface

> Goal: Full GNOME-native UI with all interactions working.

- [x] **4.1 Implement main window**
  - `src/ui/window.ts`:
    - `Adw.ApplicationWindow` subclass
    - Headerbar with title "gtkrypt"
    - Main content area using `Adw.StatusPage` as initial state (icon + drop text)
    - Wire up `Gtk.DropTarget` for file DnD
    - "Choose Files..." button using `Gtk.FileDialog`
  - _Acceptance: window launches with correct title, icon, and drop area text_

- [x] **4.2 Implement drag-and-drop**
  - In `window.ts` or `src/ui/dropArea.ts`:
    - `Gtk.DropTarget` accepting `Gio.File` type
    - On drop: extract file paths, run detection, update file list
    - Visual feedback: highlight area on drag-over
  - _Acceptance: dragging files onto the window adds them to the file list_

- [x] **4.3 Implement file chooser**
  - "Choose Files..." button opens `Gtk.FileDialog` (GTK4 async API)
  - Multi-select enabled
  - On selection: detect file types, update file list
  - _Acceptance: file picker opens, selected files appear in the list_

- [x] **4.4 Implement file list view**
  - `src/ui/fileList.ts`:
    - `Gtk.ListBox` showing selected files
    - Each row: file icon, filename, file size (human-readable), type badge (Encrypt/Decrypt)
    - Remove button per file
    - Clear all button
    - If mixed types: show two groups with section headers
  - _Acceptance: files display correctly with type detection; remove and clear work_

- [x] **4.5 Implement primary action button**
  - Dynamic label: "Encrypt" / "Decrypt" / "Encrypt & Decrypt" based on file types
  - Disabled when no files selected
  - On click: open passphrase dialog
  - _Acceptance: button label updates correctly based on file list content_

- [x] **4.6 Implement passphrase dialog**
  - `src/ui/passphraseDialog.ts`:
    - `Adw.Dialog` with passphrase + confirm (encrypt), strength bar, session memory
    - Advanced options expander includes store filename, wipe original, KDF preset
    - Output location chooser (folder picker) visible in both modes
    - Decrypt "Use original filename" toggle for stored filename restoration
    - OK / Cancel buttons
  - _Acceptance: dialog opens, validates matching passphrases, returns passphrase + options_

- [x] **4.7 Implement session passphrase memory**
  - In application state: optional in-memory passphrase (cleared on app close)
  - If "Remember for this session" was checked, pre-fill passphrase on next operation
  - Never persisted to disk
  - _Acceptance: passphrase pre-fills after checking "remember"; clears on app restart_

- [x] **4.8 Implement progress view**
  - `src/ui/progressView.ts`:
    - Replace file list with progress view during operation
    - Per-file progress bar with filename label
    - Overall progress bar
    - Current phase label ("Deriving key..." / "Encrypting..." / "Decrypting...")
    - Cancel button
  - _Acceptance: progress bars update during encryption; cancel button works_

- [x] **4.9 Implement result view**
  - `src/ui/resultView.ts`:
    - Summary line: "3 files encrypted" / "1 file decrypted"
    - Per-file result: success icon + output path, or error icon + expandable error detail
    - "Show in Files" button (opens `Gio.AppInfo` for the output directory)
    - "Encrypt/Decrypt More" button to return to drop area
  - _Acceptance: results display correctly; "Show in Files" opens file manager; can start over_

- [x] **4.10 Implement symlink warning**
  - When files are added, check for symlinks via `io.isSymlink()`
  - Show `Adw.AlertDialog` warning: "Symlinks are not supported. The following files were skipped: ..."
  - Exclude symlinks from file list
  - _Acceptance: symlinks show a warning and are excluded_

- [x] **4.11 Wire UI state machine**
  - Window states: `empty` → `files_selected` → `passphrase` → `processing` → `results` → `empty`
  - Transitions swap the main content area widget
  - Back/cancel navigation works at each step
  - _Acceptance: full flow works end-to-end: drop files → enter passphrase → see progress → see results → start over_

---

### Phase 5: Polish & edge cases

> Goal: App handles all edge cases, errors are friendly, permissions are correct.

- [x] **5.1 Implement file permission handling**
  - Encrypted output: `0600` permissions (set on Rust temp file before write)
  - Decrypted output: restores original Unix mode from v2 header, falls back to umask
  - Mode stored in v2 container header (`uint32 BE` at offset `51+N`)
  - _Acceptance: encrypted files have `0600`; decrypted files have reasonable permissions_

- [x] **5.2 Implement wipe-original option**
  - After successful encryption with "wipe original" enabled:
    - Overwrite file with zeros (single pass), then delete
    - Show confirmation dialog first: "This will permanently delete the original file(s). Continue?"
  - Current status: per-file confirm dialog with “apply to remaining files” option is wired into encrypt flow and calls `secureWipe()`
  - _Acceptance: original file is wiped after encryption when option is enabled_

- [x] **5.3 Implement error display**
  - Typed errors map to user-friendly messages in UI
  - `CancelledError` returns silently to file list (no results screen)
  - _Acceptance: each error type shows the correct message in the result view_

- [x] **5.4 Implement keyboard navigation**
  - Tab order: drop area → choose files → file list → action button
  - Enter activates focused button
  - Escape closes dialogs
  - Ctrl+O opens file chooser
  - _Acceptance: all UI elements reachable and operable via keyboard only_

- [x] **5.5 Implement accessible labels**
  - All buttons have accessible names
  - Progress bars have accessible descriptions ("Encrypting file 2 of 5, 45% complete")
  - File list rows have accessible descriptions
  - _Acceptance: ATK audit shows no unlabeled interactive elements_

- [x] **5.6 Prepare for i18n**
  - Wrap all user-visible strings with gettext (`_("...")`)
  - Avoid string concatenation; use format placeholders
  - Create initial `.pot` template (optional: actual translations deferred)
  - _Acceptance: all visible strings use gettext; no bare string literals in UI code_

---

### Phase 6: Desktop integration

> Goal: App installs and integrates with GNOME desktop.

- [x] **6.1 Create .desktop file**
  - `data/io.github.gtkrypt.desktop`:
    - Name: gtkrypt
    - GenericName: File Encryption
    - Comment: Encrypt and decrypt files with a passphrase
    - Exec: io.github.gtkrypt %F
    - Icon: io.github.gtkrypt
    - Categories: Utility;Security;
    - MimeType: application/x-gtkrypt
  - _Acceptance: desktop file validates with `desktop-file-validate`_

- [x] **6.2 Create AppStream metainfo**
  - `data/io.github.gtkrypt.metainfo.xml`:
    - Summary, description, screenshots (placeholder), releases
    - OARS content rating, developer info, display/control recommendations
  - _Acceptance: metainfo validates with `appstreamcli validate` (only placeholder URL warnings)_

- [x] **6.3 Create app icon**
  - `data/icons/io.github.gtkrypt.svg` (128x128 full-color, GNOME rounded-rect style with padlock)
  - `data/icons/io.github.gtkrypt-symbolic.svg` (16x16 monochrome symbolic padlock)
  - _Acceptance: icon renders at 16px, 32px, 48px, and 128px without artifacts_

- [x] **6.4 Configure meson build**
  - `meson.build`: installs JS output, Rust crypto binary, desktop file, metainfo, icons, MIME type
  - `data/meson.build`: install rules for icons, desktop file, metainfo, MIME type
  - `dist/meson.build`: configures GJS entry point and compiles GResource
  - Post-install hooks: icon cache, desktop database, MIME database
  - _Acceptance: `meson setup builddir && ninja -C builddir && DESTDIR=/tmp/test ninja -C builddir install` works_

- [x] **6.5 Register MIME type**
  - `data/io.github.gtkrypt.mime.xml`: registers `application/x-gtkrypt` with `.gtkrypt` glob and `GTKRYPT\0` magic bytes
  - Associated with gtkrypt in the desktop file via `MimeType=application/x-gtkrypt;`
  - _Acceptance: `.gtkrypt` files show the gtkrypt icon and open in the app_

---

### Phase 7: Testing

> Goal: Comprehensive automated tests proving correctness and security.

- [x] **7.1 Set up test infrastructure**
  - Custom GJS test harness (`tests/harness.ts`) with assert helpers
  - esbuild bundles tests to `dist/tests/` for GJS execution
  - `npm test` runs `tests/run.sh` which executes unit + integration tests
  - _Acceptance: `npm test` runs and reports results_

- [x] **7.2 Unit tests: binary helpers**
  - Roundtrip encode/decode for uint8, uint16BE, uint32BE, uint64BE
  - Edge cases: max values, zero, boundary values
  - `concatBytes` with empty arrays, single arrays, multiple arrays
  - _Acceptance: all pass_

- [x] **7.3 Unit tests: container format**
  - Encode a header → decode it → fields match
  - Reject invalid magic
  - Reject unsupported version
  - Handle zero-length filename (not stored)
  - Handle maximum-length filename
  - _Acceptance: all pass_

- [x] **7.4 Unit tests: magic detection**
  - Detect valid `.gtkrypt` file
  - Detect plaintext file
  - Handle empty file
  - Handle file shorter than magic length
  - _Acceptance: all pass_

- [x] **7.5 Unit tests: output naming**
  - Basic encrypt naming: `photo.jpg` → `photo.jpg.gtkrypt`
  - Conflict resolution: `photo.jpg.gtkrypt` exists → `photo.jpg (1).gtkrypt`
  - Basic decrypt naming: `photo.jpg.gtkrypt` → `photo.jpg`
  - Decrypt with stored filename
  - Decrypt without extension: fallback to `Decrypted - <timestamp>`
  - Custom output directory
  - _Acceptance: all pass_

- [x] **7.6 Unit tests: error mapping**
  - Each exit code maps to the correct error class
  - Each error class produces the correct `userMessage`
  - _Acceptance: all pass_

- [x] **7.7 Integration tests: encrypt/decrypt roundtrip**
  - Small text file (< 1 KiB)
  - Binary file (random bytes, ~1 MiB)
  - File with unicode filename
  - File with spaces in path
  - Roundtrip preserves content byte-for-byte
  - _Acceptance: all pass, output matches input exactly_

- [x] **7.8 Integration tests: security properties**
  - Wrong passphrase: no output file exists after attempt
  - Corrupted ciphertext: fails with `CorruptFileError`, no output file
  - Corrupted header magic: fails with `CorruptFileError`
  - Tampered header (modify a KDF param byte): fails GCM auth check
  - Temp files: during operation, temp file has `0600` permissions
  - After cancel: no temp files remain
  - _Acceptance: all pass_

- [x] **7.9 Integration tests: edge cases**
  - Empty file (0 bytes)
  - Very long filename (255 bytes UTF-8)
  - Read-only output directory: `PermissionError`
  - Symlink input: rejected with warning
  - _Acceptance: all pass_

- [x] **7.10 Rust crypto backend tests**
  - Tests exist in `crypto/src/` modules (unit + integration-style coverage)
  - Cover: roundtrip, wrong passphrase, corrupt file, streaming, KDF presets
  - _Acceptance: `cargo test` all pass_

---

### Phase 8: Documentation

> Goal: Project is documented for users and contributors.

- [x] **8.1 Write README.md**
  - Project description, features, runtime dependencies, build/run instructions
  - Full usage guide (encrypt, decrypt, options, KDF presets)
  - Project structure overview
  - _Acceptance: a new user can build and run the app by following the README_

- [x] **8.2 Document cryptography and file format**
  - `DESIGN.md`: AES-256-GCM and Argon2id rationale, byte-level container format spec (v1 + v2), AAD design, chunked streaming, KDF presets, threat model with limitations, library provenance
  - _Acceptance: a security reviewer can understand all crypto decisions from the docs_

- [x] **8.3 Document development workflow**
  - `CONTRIBUTING.md`: dev environment setup (Fedora/Ubuntu), build steps, running tests (unit + integration + Rust), code organization with architecture summary, adding features (TS and Rust), conventions
  - _Acceptance: a contributor can orient themselves in the codebase_

---

## KDF Presets

| Preset | time_cost | memory_cost (KiB) | parallelism | Use case |
|---|---|---|---|---|
| Balanced | 3 | 65536 (64 MiB) | 4 | Default. Fast enough for interactive use. |
| Strong | 4 | 262144 (256 MiB) | 4 | Higher security margin. ~1-2s on modern hardware. |
| Very Strong | 6 | 524288 (512 MiB) | 4 | Maximum security. May take several seconds. |

---

## Acceptance Criteria (final)

All of the following must pass before the project is considered complete:

- [ ] App launches and matches GNOME look/feel (Libadwaita)
- [ ] Drag-and-drop and file picker both work
- [ ] Encrypt and decrypt operations succeed reliably
- [ ] Large files (100 MB+) work without high memory usage
- [ ] Wrong passphrase / corruption never leaks plaintext output
- [ ] Cancel works and leaves no half-written output files
- [ ] No sensitive data in logs
- [ ] Minimal, polished UX
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All Rust crypto backend tests pass (`cargo test`)
- [ ] Desktop file and metainfo validate
- [ ] README allows a new user to build and run the app
