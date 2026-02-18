# gtkrypt

A minimalist, privacy-first file encryption app and personal data vault for GNOME Linux desktops.
gtkrypt encrypts and decrypts files using a passphrase and provides a personal
vault for organizing sensitive files, records, and notes. It runs natively on
GNOME with GTK 4 and Libadwaita, is written in TypeScript targeting GJS, and
delegates all cryptography to a bundled Rust binary.

<img width="5120" height="2816" alt="Screenshot From 2026-02-18 01-43-03" src="https://github.com/user-attachments/assets/459432d9-b947-47aa-ad9f-a87a2dca469e" />

---

## Features

### Files Mode

- Encrypt any file with a passphrase using AES-256-GCM and Argon2id key derivation
- Decrypt `.gtkrypt` files back to their original form
- Drag-and-drop or file picker for selecting files
- Automatic detection of encrypted vs. plaintext files
- Streaming encryption for large files with low memory usage
- Progress reporting with cancel support
- Session passphrase memory (never written to disk)
- Configurable wipe-original option with zero-overwrite

### Vault Mode

- Create encrypted vaults protected by passphrase (with optional keyfile two-factor)
- Store three item types: **files**, **structured records**, and **free-form notes**
- 9 built-in record templates: Passport, National ID, Driver's License, Credit/Debit Card, Bank Account, Medical Record, Insurance Policy, Login Credentials, Wi-Fi Network
- 10 built-in categories: Identity, Banking, Medical, Insurance, Legal, Education, Travel, Property, Vehicles, Other
- Full-text search across item names, tags, categories, and content
- Filter by category, favorites, or recently accessed items
- Grid and list view modes with sorting by name, date, or category
- Image previews with zoom controls and encrypted thumbnail caching
- Sensitive field masking (passwords, PINs, secrets) with reveal toggle
- Clipboard auto-clear for copied secrets (30-second timer)
- Auto-lock after configurable inactivity timeout
- Bulk import with auto-categorization
- Full vault backup and restore
- Custom categories and per-vault settings
- Change passphrase (re-encrypts all items)

### General

- GNOME-native look and feel with Libadwaita
- Mode switcher between Files and Vault workflows
- Keyboard navigation (Ctrl+O, Ctrl+Q, Ctrl+Comma, Escape back-navigation)
- Desktop integration with `.gtkrypt` file association and MIME type registration
- Accessible labels and keyboard-operable controls

---

## Runtime Dependencies

| Dependency | Minimum Version |
|---|---|
| GJS | >= 1.78 |
| GTK4 | >= 4.14 |
| libadwaita | >= 1.5 |
| Rust toolchain | For building the crypto binary |
| Node.js / npm | For building the TypeScript frontend |
| Meson | >= 1.0.1 (for system install) |

On Fedora:

```sh
sudo dnf install gjs gtk4 libadwaita
```

On Ubuntu / Debian:

```sh
sudo apt install gjs libgtk-4-1 libgtk-4-dev libadwaita-1-dev
```

---

## Building

### 1. Install JavaScript dependencies

```sh
npm install
```

### 2. Build the Rust crypto backend

```sh
cd crypto && cargo build --release
```

This produces the `gtkrypt-crypto` binary at `crypto/target/release/gtkrypt-crypto`.

### 3. Build the TypeScript frontend

```sh
npm run build
```

This bundles `src/index.ts` into `dist/` via esbuild.

---

## Running

After building both the crypto backend and the frontend:

```sh
npm run start
```

Or run directly:

```sh
gjs -m dist/main.js
```

### Debug logging

```sh
G_MESSAGES_DEBUG=all gjs -m dist/main.js
```

---

## System Install (Meson)

To install gtkrypt as a proper GNOME application with desktop file, icons, and
MIME type registration:

```sh
npm run build
cd crypto && cargo build --release && cd ..
meson setup builddir
ninja -C builddir
ninja -C builddir install
```

After installation, gtkrypt appears in the application launcher and `.gtkrypt`
files are associated with the app.

---

## Usage

### Files Mode

#### Encrypting files

1. Launch gtkrypt (starts in Files mode by default).
2. Drag files onto the window, or click "Choose Files" to open the file picker.
3. The app automatically detects whether each file should be encrypted or
   decrypted. Plaintext files are marked for encryption.
4. Click the "Encrypt" button.
5. Enter a passphrase and confirm it. The passphrase is never stored on disk.
6. Encrypted output is saved alongside the original with a `.gtkrypt` extension.

#### Decrypting files

1. Drop or select `.gtkrypt` files. The app detects them automatically.
2. Click the "Decrypt" button.
3. Enter the passphrase used during encryption.
4. The decrypted file is saved alongside the encrypted file with its original
   name restored.

#### Encryption Options

The passphrase dialog includes an advanced options panel:

- **KDF preset** -- Controls the strength of the key derivation function
  (Argon2id). Choose from Balanced (default), Strong, or Very Strong. Stronger
  presets take longer but provide a higher security margin.
- **Store filename** -- Embeds the original filename inside the encrypted
  container so it can be restored on decryption.
- **Wipe original** -- After successful encryption, overwrites the original file
  with zeros and deletes it. A confirmation dialog is shown before wiping.

### Vault Mode

Switch to Vault mode using the mode switcher in the header bar.

#### Creating a vault

1. Click "Create Vault" from the vault list.
2. Enter a vault name and passphrase.
3. Optionally select a keyfile for two-factor encryption.
4. Choose a KDF strength preset (Balanced, Strong, or Very Strong).
5. The vault is created and unlocked.

#### Adding items

From an unlocked vault, add items using the toolbar:

- **Files** -- Select files from disk. Images get automatic thumbnail generation.
- **Records** -- Choose from 9 built-in templates (Passport, Credit Card, Bank
  Account, etc.) and fill in the structured fields.
- **Notes** -- Create free-form text notes with a title and body.

All items support names, categories, tags, and a favorite flag.

#### Browsing and searching

- Toggle between grid and list view.
- Sort by name, date modified, or category.
- Filter by category, favorites, or recently accessed items.
- Use the search bar for full-text search across all item fields.

#### Vault security

- Vaults auto-lock after a configurable inactivity timeout (default 5 minutes).
- Sensitive fields (passwords, PINs, CVVs) are masked by default with a reveal
  toggle.
- Copied secrets are auto-cleared from the clipboard after 30 seconds.
- Keyfile two-factor adds an additional encryption layer beyond the passphrase.

#### Vault management

- **Change passphrase** -- Re-encrypts the entire vault with a new passphrase.
- **Backup** -- Export the full vault to a directory for safekeeping.
- **Restore** -- Import a vault from a backup directory.
- **Delete vault** -- Permanently remove a vault after passphrase verification.
- **Settings** -- Configure auto-lock timeout, default view mode, sort order,
  and manage custom categories.

### KDF Presets

| Preset | Time Cost | Memory | Parallelism | Notes |
|---|---|---|---|---|
| Balanced | 3 | 64 MiB | 4 | Default. Fast enough for interactive use. |
| Strong | 4 | 256 MiB | 4 | Higher security margin. ~1-2s on modern hardware. |
| Very Strong | 6 | 512 MiB | 4 | Maximum security. May take several seconds. |

---

## File Format

gtkrypt uses a custom `.gtkrypt` container format built on AES-256-GCM with
Argon2id key derivation. Files are processed in 64 KiB streaming chunks, so
memory usage stays low regardless of file size.

The container stores a header with KDF parameters, salt, nonce, and optional
original filename, followed by chunked ciphertext with per-chunk authentication
tags. Header bytes are included as additional authenticated data (AAD) for GCM,
ensuring the header cannot be tampered with.

Vault items use the same `.gtkrypt` container format for individual item
encryption and for the encrypted manifest that stores vault metadata.

For the full byte-level specification, see [SCOPE.md](SCOPE.md#container-format-gtkrypt).

---

## Project Structure

```
gtkrypt/
  src/
    index.ts                  Entry point (Adw.Application)
    ui/
      window.ts               Main window with mode switcher
      fileList.ts             Selected files list widget
      passphraseDialog.ts     Modal passphrase entry
      progressView.ts         Per-file + overall progress
      resultView.ts           Completion summary
      vaultListView.ts        Vault list with create/unlock/delete
      vaultBrowser.ts         Vault content browser (grid/list)
      vaultCreateDialog.ts    Create vault dialog
      vaultUnlockDialog.ts    Unlock vault dialog
      vaultDeleteDialog.ts    Delete vault confirmation
      itemDetailView.ts       Item detail + file preview
      itemEditorDialog.ts     Item metadata editor
      recordEditorDialog.ts   Record template editor
      noteEditorDialog.ts     Note editor
      settingsDialog.ts       Vault settings
      changePassphraseDialog.ts  Passphrase change
      categoryManager.ts      Category management
      importDialog.ts         Bulk import wizard
      exportDialog.ts         Backup and item export
      imageViewer.ts          Image preview with zoom
      textViewer.ts           Text preview
    services/
      crypto.ts               Subprocess orchestration for encrypt/decrypt
      vault.ts                Vault lifecycle and item management
      manifest.ts             Manifest serialization/encryption
      io.ts                   File metadata, permissions, secure wipe
      format.ts               Container header decode (TS side)
      detect.ts               Magic byte detection
      naming.ts               Output filename generation
      search.ts               Full-text search and filtering
      clipboard.ts            Clipboard with auto-clear
      thumbnail.ts            Image thumbnail generation
    models/
      types.ts                Shared types and interfaces
      errors.ts               Typed error classes
      categories.ts           Built-in category definitions
      templates.ts            Built-in document templates
    util/
      bytes.ts                Binary read/write helpers
      logging.ts              Safe logger (never logs secrets)
      i18n.ts                 Gettext wrapper
      uuid.ts                 UUID generation
  crypto/                     Rust crypto backend (gtkrypt-crypto)
  data/                       Desktop file, AppStream metainfo, icons, MIME type
  dist/                       Build output and meson resources
  bin/                        Dev launcher script
```

---

## License

[GPL-3.0](LICENSE)
