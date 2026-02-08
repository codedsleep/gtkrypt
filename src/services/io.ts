/**
 * File I/O utility service.
 *
 * Provides thin wrappers around GIO file operations that are needed
 * by the encryption/decryption workflow: reading file metadata,
 * adjusting permissions, and sampling file contents.
 *
 * All paths are expected to be absolute. Operations are synchronous
 * because they target local filesystems where blocking is negligible.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

/**
 * Set Unix file permissions on a file.
 *
 * This is typically used after decryption to restore restrictive
 * permissions on the output file (e.g. `0o600`).
 *
 * @param path - Absolute filesystem path.
 * @param mode - Unix permission bits (e.g. `0o600`).
 */
export function setFilePermissions(path: string, mode: number): void {
  const file = Gio.File.new_for_path(path);
  const info = new Gio.FileInfo();
  info.set_attribute_uint32("unix::mode", mode);
  file.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, null);
}

/**
 * Check whether a path is a symbolic link.
 *
 * Uses `NOFOLLOW_SYMLINKS` so the query inspects the link itself
 * rather than its target.
 *
 * @param path - Absolute filesystem path.
 * @returns `true` if the path is a symlink.
 */
export function isSymlink(path: string): boolean {
  const file = Gio.File.new_for_path(path);
  const info = file.query_info(
    "standard::is-symlink",
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  );
  return info.get_is_symlink();
}

/**
 * Get the size of a file in bytes.
 *
 * @param path - Absolute filesystem path.
 * @returns File size in bytes.
 */
export function getFileSize(path: string): number {
  const file = Gio.File.new_for_path(path);
  const info = file.query_info(
    "standard::size",
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  return info.get_size();
}

/**
 * Read the first N bytes of a file.
 *
 * Useful for sniffing magic bytes or reading partial headers without
 * loading the entire file into memory.
 *
 * @param path - Absolute filesystem path.
 * @param bytes - Maximum number of bytes to read from the beginning.
 * @returns A Uint8Array containing up to `bytes` bytes. May be shorter
 *   if the file is smaller than the requested amount. Returns an
 *   empty array if the file is empty or unreadable.
 */
export function readFileHead(path: string, bytes: number): Uint8Array {
  const file = Gio.File.new_for_path(path);
  const stream = file.read(null);
  const gbytes = stream.read_bytes(bytes, null);
  stream.close(null);
  const data = gbytes.get_data();
  return data ?? new Uint8Array(0);
}

/**
 * Securely wipe a file by overwriting with zeros, then deleting.
 *
 * Single pass is sufficient for modern storage (SSD/HDD with wear
 * leveling). The file is overwritten in 64 KiB chunks to limit
 * memory usage, then deleted from the filesystem.
 *
 * @param path - Absolute filesystem path to wipe.
 */
export function secureWipe(path: string): void {
  const file = Gio.File.new_for_path(path);
  const info = file.query_info(
    "standard::size",
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  const size = info.get_size();

  // Overwrite with zeros
  const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
  const zeros = new Uint8Array(65536); // 64 KiB buffer
  let written = 0;
  while (written < size) {
    const chunk = Math.min(65536, size - written);
    const bytes = chunk === 65536 ? zeros : zeros.slice(0, chunk);
    stream.write_bytes(new GLib.Bytes(bytes), null);
    written += chunk;
  }
  stream.flush(null);
  stream.close(null);

  // Delete the file
  file.delete(null);
}
