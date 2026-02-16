/**
 * Vault manifest service.
 *
 * Handles creation, serialization, encryption, and decryption of
 * the vault manifest — the encrypted JSON file that tracks all
 * items, categories, and settings for a vault.
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";

import type { VaultManifest, KdfPreset } from "../models/types.js";
import { DEFAULT_CATEGORIES } from "../models/categories.js";
import {
  VaultCorruptError,
  ManifestConcurrentModificationError,
} from "../models/errors.js";
import { encryptBuffer, decryptToBuffer } from "./crypto.js";
import { _ } from "../util/i18n.js";

/**
 * Create a new empty manifest with default settings.
 *
 * @param name - Vault display name.
 * @param kdfPreset - KDF strength preset for the vault.
 * @returns A fresh VaultManifest ready to be saved.
 */
export function createEmptyManifest(
  name: string,
  kdfPreset: KdfPreset,
): VaultManifest {
  const now = new Date().toISOString();
  return {
    version: 1,
    name,
    createdAt: now,
    modifiedAt: now,
    kdfPreset,
    categories: [...DEFAULT_CATEGORIES],
    items: [],
    settings: {
      autoLockMinutes: 5,
      defaultCategory: "other",
      sortOrder: "date",
      viewMode: "list",
    },
  };
}

/**
 * Serialize a manifest to a JSON byte buffer.
 *
 * @param manifest - The manifest to serialize.
 * @returns UTF-8 encoded JSON bytes.
 */
export function serializeManifest(manifest: VaultManifest): Uint8Array {
  const json = JSON.stringify(manifest, null, 2);
  return new TextEncoder().encode(json);
}

/**
 * Deserialize a manifest from a JSON byte buffer.
 *
 * @param bytes - UTF-8 encoded JSON bytes.
 * @returns The parsed manifest.
 * @throws {@link VaultCorruptError} if the data is not valid manifest JSON.
 */
export function deserializeManifest(bytes: Uint8Array): VaultManifest {
  try {
    const json = new TextDecoder().decode(bytes);
    const manifest = JSON.parse(json) as VaultManifest;

    if (manifest.version !== 1) {
      throw new VaultCorruptError(
        `Unsupported manifest version: ${manifest.version}`,
        _("Unsupported vault version. Try updating gtkrypt to the latest version."),
      );
    }

    return manifest;
  } catch (e) {
    if (e instanceof VaultCorruptError) throw e;
    throw new VaultCorruptError(
      `Failed to parse vault manifest: ${e}`,
      _("The vault manifest is corrupted. Try restoring from a backup."),
    );
  }
}

/**
 * Get the modification time of the manifest file.
 *
 * @param vaultDir - Absolute path to the vault directory.
 * @returns Modification time in seconds since epoch, or 0 if not found.
 */
export function getManifestMtime(vaultDir: string): number {
  const manifestPath = GLib.build_filenamev([vaultDir, "manifest.gtkrypt"]);
  const file = Gio.File.new_for_path(manifestPath);
  try {
    const info = file.query_info(
      "time::modified",
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    return info.get_modification_date_time()?.to_unix() ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Encrypt and save a manifest to disk using atomic write.
 *
 * Writes to a temporary file first, then renames to the final path.
 * Optionally checks for concurrent modification via mtime.
 *
 * @param vaultDir - Absolute path to the vault directory.
 * @param manifest - The manifest to save.
 * @param passphrase - Vault passphrase for encryption.
 * @param expectedMtime - If provided, checks that manifest hasn't been modified since this time.
 * @returns The new modification time of the saved manifest.
 * @throws {@link ManifestConcurrentModificationError} if mtime doesn't match.
 */
export async function saveManifest(
  vaultDir: string,
  manifest: VaultManifest,
  passphrase: string,
  expectedMtime?: number,
  keyfilePath?: string,
): Promise<number> {
  const outputPath = GLib.build_filenamev([vaultDir, "manifest.gtkrypt"]);

  // Check for concurrent modification before writing.
  if (expectedMtime !== undefined && expectedMtime > 0) {
    const currentMtime = getManifestMtime(vaultDir);
    if (currentMtime > 0 && currentMtime !== expectedMtime) {
      throw new ManifestConcurrentModificationError();
    }
  }

  // Atomic write: encrypt to temp file, then rename.
  const tmpPath = outputPath + ".tmp";
  const bytes = serializeManifest(manifest);
  await encryptBuffer(bytes, tmpPath, passphrase, {
    storeFilename: false,
    wipeOriginal: false,
    kdfPreset: manifest.kdfPreset,
  }, keyfilePath);

  const tmpFile = Gio.File.new_for_path(tmpPath);
  const destFile = Gio.File.new_for_path(outputPath);
  tmpFile.move(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);

  return getManifestMtime(vaultDir);
}

/**
 * Load and decrypt a manifest from disk.
 *
 * @param vaultDir - Absolute path to the vault directory.
 * @param passphrase - Vault passphrase for decryption.
 * @returns The decrypted manifest and the file's modification time.
 */
export async function loadManifest(
  vaultDir: string,
  passphrase: string,
  keyfilePath?: string,
): Promise<{ manifest: VaultManifest; mtime: number }> {
  const inputPath = GLib.build_filenamev([vaultDir, "manifest.gtkrypt"]);
  const mtime = getManifestMtime(vaultDir);
  const bytes = await decryptToBuffer(inputPath, passphrase, keyfilePath);
  return { manifest: deserializeManifest(bytes), mtime };
}
