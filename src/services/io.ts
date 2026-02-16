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

// ---------------------------------------------------------------------------
// Vault directory helpers
// ---------------------------------------------------------------------------

/**
 * Get the base directory where all vaults are stored.
 *
 * @returns Absolute path to `~/.local/share/gtkrypt/vaults/`.
 */
export function getVaultsBaseDir(): string {
  return GLib.build_filenamev([GLib.get_user_data_dir(), "gtkrypt", "vaults"]);
}

/**
 * Get the directory path for a named vault.
 *
 * @param name - Vault name (used as directory name).
 * @returns Absolute path to the vault directory.
 */
export function getVaultDir(name: string): string {
  return GLib.build_filenamev([getVaultsBaseDir(), name]);
}

/**
 * Create the directory structure for a new vault.
 *
 * Creates the vault directory along with `items/` and `thumbs/`
 * subdirectories. Uses mode `0o700` for privacy.
 *
 * @param name - Vault name.
 */
export function ensureVaultDir(name: string): void {
  const vaultDir = getVaultDir(name);
  GLib.mkdir_with_parents(GLib.build_filenamev([vaultDir, "items"]), 0o700);
  GLib.mkdir_with_parents(GLib.build_filenamev([vaultDir, "thumbs"]), 0o700);
}

/**
 * List the names of all vaults in the base directory.
 *
 * @returns Array of vault directory names.
 */
export function listVaultNames(): string[] {
  const baseDir = getVaultsBaseDir();
  const dir = Gio.File.new_for_path(baseDir);

  if (!dir.query_exists(null)) {
    return [];
  }

  const names: string[] = [];
  const enumerator = dir.enumerate_children(
    "standard::name,standard::type",
    Gio.FileQueryInfoFlags.NONE,
    null,
  );

  let info: Gio.FileInfo | null;
  while ((info = enumerator.next_file(null)) !== null) {
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
      names.push(info.get_name());
    }
  }
  enumerator.close(null);

  return names.sort();
}

/**
 * Recursively delete a vault directory and all its contents.
 *
 * @param name - Vault name.
 */
export function deleteVaultDir(name: string): void {
  const vaultDir = getVaultDir(name);
  deleteRecursive(Gio.File.new_for_path(vaultDir));
}

/**
 * Recursively delete a file or directory.
 *
 * @param file - The GIO file to delete.
 */
function deleteRecursive(file: Gio.File): void {
  const info = file.query_info(
    "standard::type",
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  );

  if (info.get_file_type() === Gio.FileType.DIRECTORY) {
    const enumerator = file.enumerate_children(
      "standard::name,standard::type",
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );

    let childInfo: Gio.FileInfo | null;
    while ((childInfo = enumerator.next_file(null)) !== null) {
      const child = file.get_child(childInfo.get_name());
      deleteRecursive(child);
    }
    enumerator.close(null);
  }

  file.delete(null);
}
