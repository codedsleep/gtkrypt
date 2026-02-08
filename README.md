# gtkrypt

A minimalist, privacy-first file encryption app for GNOME Linux desktops.

gtkrypt encrypts and decrypts files using a passphrase. It runs natively on
GNOME with GTK 4 and Libadwaita, is written in TypeScript targeting GJS, and
delegates all cryptography to a bundled Rust binary.

<!-- TODO: Add screenshot of main window and encrypt flow -->

---

## Features

- Encrypt any file with a passphrase using AES-256-GCM and Argon2id key derivation
- Decrypt `.gtkrypt` files back to their original form
- Drag-and-drop or file picker for selecting files
- Automatic detection of encrypted vs. plaintext files
- Streaming encryption for large files with low memory usage
- Progress reporting with cancel support
- Session passphrase memory (never written to disk)
- GNOME-native look and feel with Libadwaita

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

### Encrypting files

1. Launch gtkrypt.
2. Drag files onto the window, or click "Choose Files" to open the file picker.
3. The app automatically detects whether each file should be encrypted or
   decrypted. Plaintext files are marked for encryption.
4. Click the "Encrypt" button.
5. Enter a passphrase and confirm it. The passphrase is never stored on disk.
6. Encrypted output is saved alongside the original with a `.gtkrypt` extension.

### Decrypting files

1. Drop or select `.gtkrypt` files. The app detects them automatically.
2. Click the "Decrypt" button.
3. Enter the passphrase used during encryption.
4. The decrypted file is saved alongside the encrypted file with its original
   name restored (if the filename was stored during encryption).

### Options

The passphrase dialog includes an advanced options panel:

- **KDF preset** -- Controls the strength of the key derivation function
  (Argon2id). Choose from Balanced (default), Strong, or Very Strong. Stronger
  presets take longer but provide a higher security margin.
- **Store filename** -- Embeds the original filename inside the encrypted
  container so it can be restored on decryption.
- **Wipe original** -- After successful encryption, overwrites the original file
  with zeros and deletes it. A confirmation dialog is shown before wiping.

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

For the full byte-level specification, see [SCOPE.md](SCOPE.md#container-format-gtkrypt).

---

## Project Structure

```
gtkrypt/
  src/
    index.ts                  Entry point (Adw.Application)
    ui/                       GTK4/Libadwaita UI components
    services/                 Crypto, I/O, format, detection, naming
    models/                   Types and error classes
    util/                     Binary helpers and logging
  crypto/                     Rust crypto backend (gtkrypt-crypto)
  data/                       Desktop file, AppStream metainfo, icons, MIME type
  dist/                       Build output and meson resources
  bin/                        Dev launcher script
```

---

## License

[MIT](LICENSE)
