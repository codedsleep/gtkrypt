/**
 * Crypto bridge service -- spawns the Rust `gtkrypt-crypto` binary.
 *
 * All encryption and decryption is delegated to the Rust subprocess.
 * Communication follows a simple protocol:
 *   - The passphrase is written to the subprocess's stdin (one line).
 *   - Progress events are emitted on stdout as newline-delimited JSON.
 *   - The exit code indicates success (0) or a classified error.
 *
 * This module never handles raw key material -- only the passphrase
 * is forwarded to the binary, and it is not logged.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import type {
  CryptoResult,
  EncryptOptions,
  DecryptOptions,
  ProgressEvent,
} from "../models/types.js";
import { KDF_PRESETS } from "../models/types.js";
import {
  WrongPassphraseError,
  CorruptFileError,
  PermissionError,
  CancelledError,
  InternalCryptoError,
  GtkryptError,
} from "../models/errors.js";
import { log } from "../util/logging.js";

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

/**
 * Locate the `gtkrypt-crypto` binary on the filesystem.
 *
 * Searches in the following order:
 *   1. Development build path relative to the running script.
 *   2. Installed alongside the main script.
 *   3. Anywhere on $PATH.
 *
 * @returns Absolute path to the binary.
 * @throws {@link InternalCryptoError} if the binary cannot be found.
 */
function findCryptoBinary(): string {
  const selfDir = GLib.path_get_dirname(imports.system.programInvocationName);

  // 1. Development path: <project>/crypto/target/release/gtkrypt-crypto
  const devPath = GLib.build_filenamev([
    selfDir,
    "..",
    "crypto",
    "target",
    "release",
    "gtkrypt-crypto",
  ]);
  if (GLib.file_test(devPath, GLib.FileTest.IS_EXECUTABLE)) {
    log("debug", `Found crypto binary (dev): ${devPath}`);
    return devPath;
  }

  // 2. Installed alongside the main binary
  const siblingPath = GLib.build_filenamev([selfDir, "gtkrypt-crypto"]);
  if (GLib.file_test(siblingPath, GLib.FileTest.IS_EXECUTABLE)) {
    log("debug", `Found crypto binary (sibling): ${siblingPath}`);
    return siblingPath;
  }

  // 3. Search $PATH
  const pathResult = GLib.find_program_in_path("gtkrypt-crypto");
  if (pathResult !== null) {
    log("debug", `Found crypto binary (PATH): ${pathResult}`);
    return pathResult;
  }

  throw new InternalCryptoError(
    "Could not locate the gtkrypt-crypto binary. " +
      "Ensure it is built or installed correctly.",
  );
}

// ---------------------------------------------------------------------------
// Exit-code error mapping
// ---------------------------------------------------------------------------

/**
 * Map a non-zero exit code from the Rust binary to a typed error.
 *
 * @param exitCode - Process exit code.
 * @param stderrText - First line of stderr output (may be empty).
 * @returns A {@link GtkryptError} subclass instance.
 */
function mapExitCodeToError(
  exitCode: number,
  stderrText: string,
): GtkryptError {
  const detail = stderrText.length > 0 ? stderrText : `exit code ${exitCode}`;

  switch (exitCode) {
    case 1:
      return new WrongPassphraseError(detail);
    case 2:
      return new CorruptFileError(detail);
    case 3:
      return new PermissionError(detail);
    case 10:
      return new InternalCryptoError(detail);
    default:
      return new InternalCryptoError(
        `Unexpected crypto exit code ${exitCode}: ${detail}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Progress line reader
// ---------------------------------------------------------------------------

/**
 * Read newline-delimited JSON progress events from stdout.
 *
 * Each line is expected to be a JSON object:
 * ```json
 * {"progress":0.5,"bytes_processed":1024,"total_bytes":2048,"phase":"encrypt"}
 * ```
 *
 * Malformed lines are silently ignored (the Rust binary may emit
 * debug messages on stdout in development builds).
 *
 * This function reads synchronously on the GLib main context via
 * `read_line_utf8`, which is appropriate because the subprocess
 * drives the pace of output and we process it in the async callback
 * pipeline initiated by `wait_async`.
 *
 * @param dataStream - DataInputStream wrapping the subprocess stdout.
 * @param onProgress - Callback to invoke for each parsed event.
 * @param cancellable - Optional cancellable to abort reading.
 */
function readProgressLines(
  dataStream: Gio.DataInputStream,
  onProgress: ((event: ProgressEvent) => void) | undefined,
  cancellable: Gio.Cancellable | null,
): void {
  if (onProgress === undefined) {
    // No progress listener -- drain stdout silently so the subprocess
    // is not killed by a broken-pipe signal when it writes progress.
    function drain(): void {
      dataStream.read_line_async(
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (_stream, result) => {
          try {
            const [line] = dataStream.read_line_finish_utf8(result);
            if (line === null) {
              try { dataStream.close(null); } catch { /* ignore */ }
              return;
            }
            drain();
          } catch {
            try { dataStream.close(null); } catch { /* ignore */ }
          }
        },
      );
    }
    drain();
    return;
  }

  // After the guard above, onProgress is guaranteed to be defined.
  const emit = onProgress!;

  /**
   * Recursively schedule async line reads so that the GLib main loop
   * is not blocked.  Each completed read triggers the next until EOF.
   */
  function readNext(): void {
    dataStream.read_line_async(
      GLib.PRIORITY_DEFAULT,
      cancellable,
      (_stream, result) => {
        try {
          const [line] = dataStream.read_line_finish_utf8(result);

          if (line === null) {
            // EOF reached -- subprocess has closed stdout.
            try {
              dataStream.close(null);
            } catch {
              // Ignore.
            }
            return;
          }

          try {
            const parsed = JSON.parse(line) as {
              progress?: number;
              bytes_processed?: number;
              total_bytes?: number;
              phase?: string;
            };

            if (
              typeof parsed.bytes_processed === "number" &&
              typeof parsed.total_bytes === "number" &&
              typeof parsed.phase === "string"
            ) {
              emit({
                fileIndex: 0,
                bytesProcessed: parsed.bytes_processed,
                totalBytes: parsed.total_bytes,
                phase: parsed.phase as ProgressEvent["phase"],
              });
            }
          } catch {
            // Malformed JSON -- skip this line.
          }

          // Schedule next line read.
          readNext();
        } catch {
          // Stream read failed (possibly cancelled). Stop reading.
          try {
            dataStream.close(null);
          } catch {
            // Ignore.
          }
        }
      },
    );
  }

  readNext();
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a file using the Rust crypto backend.
 *
 * @param inputPath - Absolute path to the plaintext input file.
 * @param outputPath - Absolute path for the resulting `.gtkrypt` file.
 * @param passphrase - User-supplied passphrase (not logged).
 * @param options - Encryption options including KDF preset.
 * @param onProgress - Optional callback for progress updates.
 * @param cancellable - Optional GIO cancellable to abort the operation.
 * @returns A promise resolving to a {@link CryptoResult} on success.
 */
export function encrypt(
  inputPath: string,
  outputPath: string,
  passphrase: string,
  options: EncryptOptions,
  onProgress?: (event: ProgressEvent) => void,
  cancellable?: Gio.Cancellable | null,
  keyfilePath?: string,
): Promise<CryptoResult> {
  return new Promise<CryptoResult>((resolve, reject) => {
    try {
      const binaryPath = findCryptoBinary();
      const params = KDF_PRESETS[options.kdfPreset];

      const argv = [
        binaryPath,
        "encrypt",
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--time-cost",
        String(params.timeCost),
        "--memory-cost",
        String(params.memoryCost),
        "--parallelism",
        String(params.parallelism),
      ];

      if (options.storeFilename) {
        argv.push("--store-filename");
      }

      if (keyfilePath) {
        argv.push("--keyfile", keyfilePath);
      }

      log("debug", `Spawning encrypt: ${argv.join(" ")}`);

      const subprocess = new Gio.Subprocess({
        argv: argv,
        flags:
          Gio.SubprocessFlags.STDIN_PIPE |
          Gio.SubprocessFlags.STDOUT_PIPE |
          Gio.SubprocessFlags.STDERR_PIPE,
      });
      subprocess.init(cancellable ?? null);

      // Hook up cancellation to force-kill the subprocess.
      let cancelledId = 0;
      if (cancellable !== undefined && cancellable !== null) {
        cancelledId = cancellable.connect(() => {
          log("info", "Encrypt operation cancelled -- killing subprocess");
          subprocess.force_exit();
        });
      }

      // Write the passphrase to stdin then close the pipe.
      const stdinStream = subprocess.get_stdin_pipe()!;
      const encoder = new TextEncoder();
      const passphraseBytes = encoder.encode(passphrase + "\n");
      stdinStream.write_bytes(
        new GLib.Bytes(passphraseBytes),
        cancellable ?? null,
      );
      stdinStream.close(cancellable ?? null);

      // Start reading progress from stdout.
      const stdoutStream = new Gio.DataInputStream({
        base_stream: subprocess.get_stdout_pipe()!,
      });
      readProgressLines(stdoutStream, onProgress, cancellable ?? null);

      // Wait for the subprocess to exit.
      subprocess.wait_async(cancellable ?? null, (_subprocess, result) => {
        // Disconnect the cancellable handler to avoid double-signalling.
        if (cancelledId > 0 && cancellable) {
          cancellable.disconnect(cancelledId);
        }

        try {
          subprocess.wait_finish(result);

          if (subprocess.get_if_exited()) {
            const exitCode = subprocess.get_exit_status();

            if (exitCode === 0) {
              log("info", "Encrypt completed successfully");
              resolve({ success: true, outputPath });
              return;
            }

            // Read first line of stderr for the error detail.
            const stderrStream = new Gio.DataInputStream({
              base_stream: subprocess.get_stderr_pipe()!,
            });
            const [stderrText] = stderrStream.read_line_utf8(null);
            stderrStream.close(null);

            log("warn", `Encrypt failed with exit code ${exitCode}: ${stderrText ?? "(no stderr)"}`);
            reject(mapExitCodeToError(exitCode, stderrText ?? ""));
          } else {
            // Process was killed by a signal.
            if (cancellable?.is_cancelled()) {
              reject(new CancelledError());
            } else {
              reject(
                new InternalCryptoError(
                  "Crypto process terminated by signal",
                ),
              );
            }
          }
        } catch (e) {
          if (cancellable?.is_cancelled()) {
            reject(new CancelledError());
          } else {
            reject(new InternalCryptoError(String(e)));
          }
        }
      });
    } catch (e) {
      if (cancellable?.is_cancelled()) {
        reject(new CancelledError());
      } else if (e instanceof GtkryptError) {
        reject(e);
      } else {
        reject(new InternalCryptoError(String(e)));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypt a `.gtkrypt` file using the Rust crypto backend.
 *
 * @param inputPath - Absolute path to the encrypted `.gtkrypt` file.
 * @param outputPath - Absolute path for the decrypted output file.
 * @param passphrase - User-supplied passphrase (not logged).
 * @param _options - Decryption options (reserved for future use).
 * @param onProgress - Optional callback for progress updates.
 * @param cancellable - Optional GIO cancellable to abort the operation.
 * @returns A promise resolving to a {@link CryptoResult} on success.
 */
export function decrypt(
  inputPath: string,
  outputPath: string,
  passphrase: string,
  _options: DecryptOptions,
  onProgress?: (event: ProgressEvent) => void,
  cancellable?: Gio.Cancellable | null,
  keyfilePath?: string,
): Promise<CryptoResult> {
  return new Promise<CryptoResult>((resolve, reject) => {
    try {
      const binaryPath = findCryptoBinary();

      const argv = [
        binaryPath,
        "decrypt",
        "--input",
        inputPath,
        "--output",
        outputPath,
      ];

      if (keyfilePath) {
        argv.push("--keyfile", keyfilePath);
      }

      log("debug", `Spawning decrypt: ${argv.join(" ")}`);

      const subprocess = new Gio.Subprocess({
        argv: argv,
        flags:
          Gio.SubprocessFlags.STDIN_PIPE |
          Gio.SubprocessFlags.STDOUT_PIPE |
          Gio.SubprocessFlags.STDERR_PIPE,
      });
      subprocess.init(cancellable ?? null);

      // Hook up cancellation to force-kill the subprocess.
      let cancelledId = 0;
      if (cancellable !== undefined && cancellable !== null) {
        cancelledId = cancellable.connect(() => {
          log("info", "Decrypt operation cancelled -- killing subprocess");
          subprocess.force_exit();
        });
      }

      // Write the passphrase to stdin then close the pipe.
      const stdinStream = subprocess.get_stdin_pipe()!;
      const encoder = new TextEncoder();
      const passphraseBytes = encoder.encode(passphrase + "\n");
      stdinStream.write_bytes(
        new GLib.Bytes(passphraseBytes),
        cancellable ?? null,
      );
      stdinStream.close(cancellable ?? null);

      // Start reading progress from stdout.
      const stdoutStream = new Gio.DataInputStream({
        base_stream: subprocess.get_stdout_pipe()!,
      });
      readProgressLines(stdoutStream, onProgress, cancellable ?? null);

      // Wait for the subprocess to exit.
      subprocess.wait_async(cancellable ?? null, (_subprocess, result) => {
        // Disconnect the cancellable handler to avoid double-signalling.
        if (cancelledId > 0 && cancellable) {
          cancellable.disconnect(cancelledId);
        }

        try {
          subprocess.wait_finish(result);

          if (subprocess.get_if_exited()) {
            const exitCode = subprocess.get_exit_status();

            if (exitCode === 0) {
              log("info", "Decrypt completed successfully");
              resolve({ success: true, outputPath });
              return;
            }

            // Read first line of stderr for the error detail.
            const stderrStream = new Gio.DataInputStream({
              base_stream: subprocess.get_stderr_pipe()!,
            });
            const [stderrText] = stderrStream.read_line_utf8(null);
            stderrStream.close(null);

            log("warn", `Decrypt failed (input=${inputPath}) with exit code ${exitCode}: ${stderrText ?? "(no stderr)"}`);
            reject(mapExitCodeToError(exitCode, stderrText ?? ""));
          } else {
            // Process was killed by a signal.
            if (cancellable?.is_cancelled()) {
              reject(new CancelledError());
            } else {
              reject(
                new InternalCryptoError(
                  "Crypto process terminated by signal",
                ),
              );
            }
          }
        } catch (e) {
          if (cancellable?.is_cancelled()) {
            reject(new CancelledError());
          } else {
            reject(new InternalCryptoError(String(e)));
          }
        }
      });
    } catch (e) {
      if (cancellable?.is_cancelled()) {
        reject(new CancelledError());
      } else if (e instanceof GtkryptError) {
        reject(e);
      } else {
        reject(new InternalCryptoError(String(e)));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// In-memory buffer operations
// ---------------------------------------------------------------------------

/**
 * Encrypt an in-memory buffer to a `.gtkrypt` file.
 *
 * Writes the buffer to a temporary file, encrypts it to the output path,
 * then securely removes the temporary file. The temp file is always
 * cleaned up, even if encryption fails.
 *
 * @param data - The plaintext data to encrypt.
 * @param outputPath - Absolute path for the resulting `.gtkrypt` file.
 * @param passphrase - User-supplied passphrase.
 * @param options - Encryption options including KDF preset.
 * @returns A promise resolving to a {@link CryptoResult}.
 */
export async function encryptBuffer(
  data: Uint8Array,
  outputPath: string,
  passphrase: string,
  options: EncryptOptions,
  keyfilePath?: string,
): Promise<CryptoResult> {
  const [fd, tempPath] = GLib.file_open_tmp("gtkrypt-XXXXXX");
  GLib.close(fd);

  try {
    // Write data to the temp file with restrictive permissions.
    const tempFile = Gio.File.new_for_path(tempPath);
    const stream = tempFile.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
    if (data.length > 0) {
      stream.write_bytes(new GLib.Bytes(data), null);
    }
    stream.close(null);

    return await encrypt(tempPath, outputPath, passphrase, options, undefined, undefined, keyfilePath);
  } finally {
    try {
      Gio.File.new_for_path(tempPath).delete(null);
    } catch {
      // Temp file may already be gone.
    }
  }
}

/**
 * Decrypt a `.gtkrypt` file to an in-memory buffer.
 *
 * Decrypts to a temporary file, reads the contents into memory,
 * then securely removes the temporary file. The temp file is always
 * cleaned up, even if decryption fails.
 *
 * @param inputPath - Absolute path to the encrypted `.gtkrypt` file.
 * @param passphrase - User-supplied passphrase.
 * @returns A promise resolving to the decrypted data as a Uint8Array.
 */
export async function decryptToBuffer(
  inputPath: string,
  passphrase: string,
  keyfilePath?: string,
): Promise<Uint8Array> {
  const [fd, tempPath] = GLib.file_open_tmp("gtkrypt-XXXXXX");
  GLib.close(fd);

  try {
    await decrypt(inputPath, tempPath, passphrase, { useStoredFilename: false }, undefined, undefined, keyfilePath);

    const tempFile = Gio.File.new_for_path(tempPath);
    const [, contents] = tempFile.load_contents(null);
    return contents;
  } finally {
    try {
      Gio.File.new_for_path(tempPath).delete(null);
    } catch {
      // Temp file may already be gone.
    }
  }
}
