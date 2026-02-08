/**
 * Magic byte detection for `.gtkrypt` files.
 *
 * Reads the first 8 bytes of a file and compares them against the
 * container magic to determine whether the file is encrypted or
 * plaintext. This drives the UI's automatic encrypt-vs-decrypt
 * mode selection.
 */

import Gio from "gi://Gio";

import { HEADER_MAGIC } from "./format.js";

/**
 * Detect whether a file is a `.gtkrypt` encrypted container,
 * an ordinary plaintext file, or indeterminate.
 *
 * Detection is based solely on the first 8 bytes (the magic header).
 * Files that are empty, shorter than 8 bytes, or unreadable are
 * reported as `'unknown'`.
 *
 * @param path - Absolute filesystem path to the file.
 * @returns `'encrypted'` if the magic bytes match, `'plaintext'` if
 *   the file is readable but does not match, or `'unknown'` if the
 *   file cannot be read or is too short.
 */
export function detectFileType(
  path: string,
): "plaintext" | "encrypted" | "unknown" {
  try {
    const file = Gio.File.new_for_path(path);
    const stream = file.read(null);
    const gbytes = stream.read_bytes(8, null);
    stream.close(null);

    const data = gbytes.get_data();
    if (data === null || data.byteLength < HEADER_MAGIC.length) {
      return "unknown";
    }

    for (let i = 0; i < HEADER_MAGIC.length; i++) {
      if (data[i] !== HEADER_MAGIC[i]) {
        return "plaintext";
      }
    }

    return "encrypted";
  } catch {
    return "unknown";
  }
}
