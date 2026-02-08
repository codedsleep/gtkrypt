# Contributing to gtkrypt

This guide covers how to set up a development environment, build and test the
project, and navigate the codebase.

## Development Environment Setup

### System Dependencies

gtkrypt requires GJS, GTK4, libadwaita, a Rust toolchain, and Node.js.

**Fedora:**

```sh
sudo dnf install gjs gtk4-devel libadwaita-devel
```

**Ubuntu / Debian:**

```sh
sudo apt install gjs libgtk-4-dev libadwaita-1-dev
```

**Rust toolchain** (if not already installed):

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Node.js:** The project targets Node.js v23 (see `.nvmrc`). If you use nvm:

```sh
nvm install
nvm use
```

### Initial Build

Install Node.js dependencies, then build both the TypeScript frontend and the
Rust crypto backend:

```sh
npm install
cd crypto && cargo build --release && cd ..
npm run build
```

### Running the App

```sh
npm run start
```

This rebuilds the TypeScript bundle and launches the app under GJS. For debug
logging:

```sh
G_MESSAGES_DEBUG=all gjs -m dist/main.js
```

## Running Tests

**All tests** (unit + integration):

```sh
npm test
```

**Rust backend tests only:**

```sh
cd crypto && cargo test
```

**TypeScript type checking:**

```sh
npm run check
```

Unit tests run under GJS. Integration tests are shell scripts in `tests/`.

## Code Organization

```
gtkrypt/
  src/
    index.ts               Entry point (Adw.Application setup)
    ui/
      window.ts            Main window, drag-and-drop, file chooser, state machine
      fileList.ts          Selected files list widget
      passphraseDialog.ts  Modal passphrase entry dialog
      progressView.ts      Per-file and overall progress bars
      resultView.ts        Completion summary with per-file results
    services/
      crypto.ts            Spawns gtkrypt-crypto via Gio.Subprocess
      io.ts                File metadata, permissions, secure wipe
      format.ts            Container header parsing (TypeScript side)
      detect.ts            Magic byte detection (encrypted vs plaintext)
      naming.ts            Output filename generation and conflict resolution
    models/
      types.ts             Shared types and interfaces
      errors.ts            Typed error classes with user-facing messages
    util/
      bytes.ts             Binary read/write helpers (DataView-based)
      logging.ts           Safe logger (never logs secrets)
      i18n.ts              Gettext wrapper for translatable strings
  crypto/                  Rust crypto backend (independent binary)
    src/
      main.rs              CLI entry point (clap)
      encrypt.rs           AES-256-GCM chunked encryption
      decrypt.rs           AES-256-GCM chunked decryption
      header.rs            Container header encode/decode
      kdf.rs               Argon2id key derivation
      progress.rs          JSON progress reporting to stdout
  data/                    Desktop integration files
    io.github.gtkrypt.desktop
    io.github.gtkrypt.metainfo.xml
    io.github.gtkrypt.mime.xml
    icons/                 App icon SVGs
  dist/                    esbuild output (generated)
  bin/gtkrypt              Shell wrapper to launch the app
  meson.build              Meson build system (installs everything)
```

### Architecture Summary

The app is a GJS process (TypeScript compiled to ES modules by esbuild) that
uses GTK4 and libadwaita for the UI. All cryptography is performed by a
separate Rust binary (`gtkrypt-crypto`) spawned via `Gio.Subprocess`. The two
communicate through stdin (passphrase), stdout (JSON progress lines), and
stderr (JSON error reporting). Exit codes map to typed error classes on the
TypeScript side.

## Adding Features

### TypeScript (UI and Services)

1. Source files live in `src/`. UI components go in `src/ui/`, service logic in
   `src/services/`, shared types in `src/models/`, and utilities in `src/util/`.
2. GJS uses `gi://` imports for GTK, Adw, Gio, and GLib. These are externalized
   by esbuild -- do not bundle them.
3. All user-visible strings must be wrapped with `_("...")` from `src/util/i18n.ts`
   for translation readiness.
4. After making changes, rebuild and test:

   ```sh
   npm run build
   npm run start
   ```

5. Run `npm run check` to verify TypeScript types before committing.

### Rust (Crypto Backend)

1. The Rust source lives in `crypto/src/`. It is an independent binary project
   with its own `Cargo.toml`.
2. After changes, rebuild in release mode:

   ```sh
   cd crypto && cargo build --release
   ```

3. Run the Rust test suite:

   ```sh
   cd crypto && cargo test
   ```

4. The binary communicates with the GJS process through a well-defined
   interface: stdin for passphrase, stdout for JSON progress lines, stderr for
   JSON errors, and exit codes (0 = success, 1 = wrong passphrase, 2 = corrupt
   file, 3 = permission error, 10 = internal error).

### Build System (Meson)

The meson build handles system installation of the JS bundle, Rust binary,
desktop file, AppStream metainfo, icons, and MIME type registration. The Rust
binary must be pre-built before running meson:

```sh
npm run build
cd crypto && cargo build --release && cd ..
meson setup builddir --prefix=/usr/local
meson compile -C builddir
meson install -C builddir
```

## Conventions

- **TypeScript strict mode** is enforced. Avoid `any`; use `unknown` and narrow.
- **No secrets in logs.** The logger in `src/util/logging.ts` is designed to
  prevent accidental exposure of passphrases or key material.
- **Semantic accessibility.** All interactive elements must have accessible names
  and support keyboard navigation.
- **Small, focused commits.** Keep changes scoped to the task at hand.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
