/**
 * Vault lifecycle and item management service.
 *
 * Manages vault creation, unlocking, locking, deletion, and all
 * item operations (add, remove, update, retrieve). The vault
 * passphrase is held in memory while the vault is unlocked.
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";

import type { VaultManifest, VaultItem, KdfPreset } from "../models/types.js";
import {
  VaultLockedError,
  VaultNotFoundError,
  DuplicateVaultError,
  ItemNotFoundError,
  ItemFileMissingError,
} from "../models/errors.js";
import {
  getVaultDir,
  ensureVaultDir,
  deleteVaultDir,
} from "./io.js";
import {
  createEmptyManifest,
  saveManifest,
  loadManifest,
} from "./manifest.js";
import { encrypt, encryptBuffer, decryptToBuffer } from "./crypto.js";
import { generateUuid } from "../util/uuid.js";
import { log } from "../util/logging.js";
import { _ } from "../util/i18n.js";
import { generateThumbnail } from "./thumbnail.js";

/** Runtime state of an unlocked vault. */
export interface VaultState {
  name: string;
  dir: string;
  manifest: VaultManifest;
  passphrase: string;
  locked: boolean;
  autoLockTimeoutId: number | null;
  onAutoLock?: () => void;
  /** Last known modification time of manifest.gtkrypt (seconds since epoch). */
  manifestMtime?: number;
  /** Keyfile path used for this vault, if any. */
  keyfilePath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Vault metadata stored in vault.json (plaintext). */
export interface VaultMeta {
  keyfile: boolean;
}

/**
 * Read the plaintext vault.json metadata file from a vault directory.
 *
 * @param vaultDir - Absolute path to the vault directory.
 * @returns Parsed metadata, or a default (no keyfile) if the file is missing.
 */
export function readVaultMeta(vaultDir: string): VaultMeta {
  const metaPath = GLib.build_filenamev([vaultDir, "vault.json"]);
  try {
    const file = Gio.File.new_for_path(metaPath);
    const [, contents] = file.load_contents(null);
    const json = new TextDecoder().decode(contents);
    const parsed = JSON.parse(json) as VaultMeta;
    return { keyfile: !!parsed.keyfile };
  } catch {
    return { keyfile: false };
  }
}

/**
 * Read the plaintext vault.json metadata for a vault by name.
 *
 * @param name - Vault name.
 * @returns Parsed metadata, or a default (no keyfile) if the file is missing.
 */
export function readVaultMetaByName(name: string): VaultMeta {
  const dir = getVaultDir(name);
  return readVaultMeta(dir);
}

/** Throw if the vault is locked. */
function assertUnlocked(state: VaultState): void {
  if (state.locked) {
    throw new VaultLockedError();
  }
}

/** Find an item in the manifest by ID, or throw. */
function findItem(state: VaultState, itemId: string): VaultItem {
  const item = state.manifest.items.find((i) => i.id === itemId);
  if (!item) {
    throw new ItemNotFoundError(`Item ${itemId} not found`);
  }
  return item;
}

/** Get the path to an item's encrypted file. */
function itemPath(state: VaultState, itemId: string): string {
  return GLib.build_filenamev([state.dir, "items", `${itemId}.gtkrypt`]);
}

/** Get the path to an item's encrypted thumbnail. */
export function thumbPath(state: VaultState, itemId: string): string {
  return GLib.build_filenamev([state.dir, "thumbs", `${itemId}.gtkrypt`]);
}

/** Silently delete a file if it exists. */
function deleteIfExists(path: string): void {
  try {
    Gio.File.new_for_path(path).delete(null);
  } catch {
    // File may not exist.
  }
}

// ---------------------------------------------------------------------------
// Vault lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new vault with an empty manifest.
 *
 * @param name - Vault display name (also used as directory name).
 * @param passphrase - Master passphrase for the vault.
 * @param kdfPreset - KDF strength preset.
 * @returns An unlocked VaultState ready for use.
 * @throws {@link DuplicateVaultError} if a vault with this name exists.
 */
export async function createVault(
  name: string,
  passphrase: string,
  kdfPreset: KdfPreset,
  keyfilePath?: string,
): Promise<VaultState> {
  const dir = getVaultDir(name);

  if (GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
    throw new DuplicateVaultError();
  }

  ensureVaultDir(name);

  let mtime: number;
  const manifest = createEmptyManifest(name, kdfPreset);
  log("info", `createVault: saving manifest for "${name}" in ${dir}`);
  try {
    mtime = await saveManifest(dir, manifest, passphrase, undefined, keyfilePath);
  } catch (e) {
    log("error", `createVault: manifest save failed: ${e}`);
    // Clean up the partially-created vault directory so it doesn't
    // appear in the vault list without a usable manifest.
    try {
      deleteVaultDir(name);
    } catch {
      // Best-effort cleanup.
    }
    throw e;
  }

  // Write vault.json metadata (keyfile usage flag).
  const vaultMeta = JSON.stringify({ keyfile: !!keyfilePath }, null, 2);
  const metaPath = GLib.build_filenamev([dir, "vault.json"]);
  const metaFile = Gio.File.new_for_path(metaPath);
  const metaStream = metaFile.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
  metaStream.write_bytes(
    new GLib.Bytes(new TextEncoder().encode(vaultMeta)),
    null,
  );
  metaStream.close(null);

  log("info", `Vault created: ${name}`);

  const state: VaultState = {
    name,
    dir,
    manifest,
    passphrase,
    locked: false,
    autoLockTimeoutId: null,
    manifestMtime: mtime,
    keyfilePath,
  };

  resetAutoLockTimer(state);
  return state;
}

/**
 * Unlock an existing vault by decrypting its manifest.
 *
 * @param name - Vault name.
 * @param passphrase - Master passphrase.
 * @returns An unlocked VaultState.
 * @throws {@link VaultNotFoundError} if the vault directory does not exist.
 * @throws {@link WrongPassphraseError} if the passphrase is incorrect.
 */
export async function unlockVault(
  name: string,
  passphrase: string,
  keyfilePath?: string,
): Promise<VaultState> {
  const dir = getVaultDir(name);

  if (!GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
    throw new VaultNotFoundError();
  }

  const { manifest, mtime } = await loadManifest(dir, passphrase, keyfilePath);

  log("info", `Vault unlocked: ${name}`);

  const state: VaultState = {
    name,
    dir,
    manifest,
    passphrase,
    locked: false,
    autoLockTimeoutId: null,
    manifestMtime: mtime,
    keyfilePath,
  };

  resetAutoLockTimer(state);
  return state;
}

/**
 * Lock a vault, clearing sensitive data from memory.
 */
export function lockVault(state: VaultState): void {
  cancelAutoLockTimer(state);
  state.passphrase = "";
  state.keyfilePath = undefined;
  state.locked = true;
  log("info", `Vault locked: ${state.name}`);
}

/**
 * Delete a vault after verifying the passphrase.
 *
 * @param name - Vault name.
 * @param passphrase - Must match the vault passphrase.
 */
export async function deleteVault(
  name: string,
  passphrase: string,
  keyfilePath?: string,
): Promise<void> {
  const dir = getVaultDir(name);

  if (!GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
    throw new VaultNotFoundError();
  }

  // Verify passphrase by attempting to load the manifest.
  await loadManifest(dir, passphrase, keyfilePath).then((r) => r.manifest);

  deleteVaultDir(name);
  log("info", `Vault deleted: ${name}`);
}

/**
 * Restore a vault from a backup directory.
 *
 * Verifies the backup passphrase, derives a vault name from the manifest,
 * copies all files into a new vault directory, and returns the vault name.
 *
 * @param sourceDir - Path to the backup folder (must contain manifest.gtkrypt).
 * @param passphrase - Passphrase to verify the backup.
 * @returns The name of the restored vault.
 * @throws {@link DuplicateVaultError} if a vault with this name already exists.
 * @throws {@link WrongPassphraseError} if the passphrase is incorrect.
 */
export async function restoreVault(
  sourceDir: string,
  passphrase: string,
  keyfilePath?: string,
): Promise<string> {
  // Verify passphrase by loading the manifest.
  const { manifest } = await loadManifest(sourceDir, passphrase, keyfilePath);
  const name = manifest.name;

  const destDir = getVaultDir(name);
  if (GLib.file_test(destDir, GLib.FileTest.IS_DIR)) {
    throw new DuplicateVaultError();
  }

  // Create vault directory structure.
  ensureVaultDir(name);

  // Copy all files from backup to vault directory.
  copyDirContents(Gio.File.new_for_path(sourceDir), Gio.File.new_for_path(destDir));

  log("info", `Vault restored from backup: ${name}`);
  return name;
}

/**
 * Recursively copy the contents of a source directory into a destination
 * directory. Existing files in the destination are overwritten.
 */
function copyDirContents(src: Gio.File, dest: Gio.File): void {
  const enumerator = src.enumerate_children(
    "standard::name,standard::type",
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  );

  let info: Gio.FileInfo | null;
  while ((info = enumerator.next_file(null)) !== null) {
    const childName = info.get_name();
    const srcChild = src.get_child(childName);
    const destChild = dest.get_child(childName);

    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
      GLib.mkdir_with_parents(destChild.get_path()!, 0o700);
      copyDirContents(srcChild, destChild);
    } else {
      srcChild.copy(destChild, Gio.FileCopyFlags.OVERWRITE, null, null);
    }
  }
  enumerator.close(null);
}

/**
 * Save the current vault state (re-encrypt manifest).
 *
 * @param state - Unlocked vault state.
 * @param force - If true, skip concurrent modification check.
 */
export async function saveVaultState(
  state: VaultState,
  force = false,
): Promise<void> {
  assertUnlocked(state);
  state.manifest.modifiedAt = new Date().toISOString();
  const newMtime = await saveManifest(
    state.dir,
    state.manifest,
    state.passphrase,
    force ? undefined : state.manifestMtime,
    state.keyfilePath,
  );
  state.manifestMtime = newMtime;
}

// ---------------------------------------------------------------------------
// Auto-lock timer
// ---------------------------------------------------------------------------

/**
 * Reset the auto-lock countdown timer.
 */
export function resetAutoLockTimer(state: VaultState): void {
  cancelAutoLockTimer(state);

  const minutes = state.manifest.settings.autoLockMinutes;
  if (minutes <= 0) return;

  state.autoLockTimeoutId = GLib.timeout_add_seconds(
    GLib.PRIORITY_DEFAULT,
    minutes * 60,
    () => {
      log("info", `Auto-lock triggered for vault: ${state.name}`);
      lockVault(state);
      state.onAutoLock?.();
      return GLib.SOURCE_REMOVE;
    },
  );
}

/**
 * Cancel any pending auto-lock timer.
 */
export function cancelAutoLockTimer(state: VaultState): void {
  if (state.autoLockTimeoutId !== null) {
    GLib.source_remove(state.autoLockTimeoutId);
    state.autoLockTimeoutId = null;
  }
}

// ---------------------------------------------------------------------------
// Item operations
// ---------------------------------------------------------------------------

/**
 * Add a file to the vault.
 *
 * Encrypts the file and adds an entry to the manifest.
 *
 * @param state - Unlocked vault state.
 * @param filePath - Absolute path to the source file.
 * @param metadata - Optional metadata overrides.
 * @returns The created VaultItem.
 */
export async function addFileToVault(
  state: VaultState,
  filePath: string,
  metadata: Partial<VaultItem>,
): Promise<VaultItem> {
  assertUnlocked(state);

  const id = generateUuid();
  const outputFile = itemPath(state, id);
  const now = new Date().toISOString();

  // Read file metadata.
  const file = Gio.File.new_for_path(filePath);
  const info = file.query_info(
    "standard::display-name,standard::size,standard::content-type",
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  const fileName = info.get_display_name();
  const fileSize = info.get_size();
  const contentType = info.get_content_type();

  // Encrypt the file.
  await encrypt(filePath, outputFile, state.passphrase, {
    storeFilename: true,
    wipeOriginal: false,
    kdfPreset: state.manifest.kdfPreset,
  }, undefined, undefined, state.keyfilePath);

  // Generate thumbnail for image files.
  let hasThumbnail = false;
  if (contentType && contentType.startsWith("image/")) {
    try {
      const [, fileBytes] = Gio.File.new_for_path(filePath).load_contents(null);
      const thumbBytes = generateThumbnail(fileBytes);
      if (thumbBytes) {
        await encryptBuffer(thumbBytes, thumbPath(state, id), state.passphrase, {
          storeFilename: false,
          wipeOriginal: false,
          kdfPreset: state.manifest.kdfPreset,
        }, state.keyfilePath);
        hasThumbnail = true;
        log("debug", `Thumbnail generated for ${id}`);
      }
    } catch (e) {
      log("warn", `Thumbnail generation failed for ${id}: ${e}`);
      // Non-fatal — continue without thumbnail.
    }
  }

  const item: VaultItem = {
    id,
    type: "file",
    name: metadata.name ?? fileName,
    category: metadata.category ?? state.manifest.settings.defaultCategory,
    tags: metadata.tags ?? [],
    createdAt: now,
    modifiedAt: now,
    accessedAt: now,
    favorite: metadata.favorite ?? false,
    filename: fileName,
    mimeType: contentType ?? undefined,
    fileSize,
    hasThumbnail,
  };

  state.manifest.items.push(item);
  await saveVaultState(state);
  resetAutoLockTimer(state);

  log("info", `File added to vault: ${item.name} (${id})`);
  return item;
}

/**
 * Add a structured record to the vault.
 *
 * Encrypts the record fields as JSON.
 *
 * @param state - Unlocked vault state.
 * @param metadata - Record metadata including fields.
 * @returns The created VaultItem.
 */
export async function addRecordToVault(
  state: VaultState,
  metadata: Partial<VaultItem>,
): Promise<VaultItem> {
  assertUnlocked(state);

  const id = generateUuid();
  const outputFile = itemPath(state, id);
  const now = new Date().toISOString();

  // Encrypt the fields as JSON.
  const recordData = new TextEncoder().encode(
    JSON.stringify(metadata.fields ?? {}),
  );
  await encryptBuffer(recordData, outputFile, state.passphrase, {
    storeFilename: false,
    wipeOriginal: false,
    kdfPreset: state.manifest.kdfPreset,
  }, state.keyfilePath);

  const item: VaultItem = {
    id,
    type: "record",
    name: metadata.name ?? _("Untitled Record"),
    category: metadata.category ?? state.manifest.settings.defaultCategory,
    tags: metadata.tags ?? [],
    createdAt: now,
    modifiedAt: now,
    accessedAt: now,
    favorite: metadata.favorite ?? false,
    templateId: metadata.templateId,
    fields: metadata.fields,
  };

  state.manifest.items.push(item);
  await saveVaultState(state);
  resetAutoLockTimer(state);

  log("info", `Record added to vault: ${item.name} (${id})`);
  return item;
}

/**
 * Add an encrypted note to the vault.
 *
 * @param state - Unlocked vault state.
 * @param title - Note title.
 * @param text - Note body text.
 * @param metadata - Optional metadata overrides.
 * @returns The created VaultItem.
 */
export async function addNoteToVault(
  state: VaultState,
  title: string,
  text: string,
  metadata: Partial<VaultItem>,
): Promise<VaultItem> {
  assertUnlocked(state);

  const id = generateUuid();
  const outputFile = itemPath(state, id);
  const now = new Date().toISOString();

  // Encrypt note content as JSON.
  const noteData = new TextEncoder().encode(
    JSON.stringify({ title, text }),
  );
  await encryptBuffer(noteData, outputFile, state.passphrase, {
    storeFilename: false,
    wipeOriginal: false,
    kdfPreset: state.manifest.kdfPreset,
  }, state.keyfilePath);

  const item: VaultItem = {
    id,
    type: "note",
    name: title,
    category: metadata.category ?? state.manifest.settings.defaultCategory,
    tags: metadata.tags ?? [],
    createdAt: now,
    modifiedAt: now,
    accessedAt: now,
    favorite: metadata.favorite ?? false,
    notes: text,
  };

  state.manifest.items.push(item);
  await saveVaultState(state);
  resetAutoLockTimer(state);

  log("info", `Note added to vault: ${item.name} (${id})`);
  return item;
}

/**
 * Remove an item from the vault.
 *
 * Deletes the encrypted item file, thumbnail, and manifest entry.
 */
export async function removeItem(
  state: VaultState,
  itemId: string,
): Promise<void> {
  assertUnlocked(state);
  findItem(state, itemId); // Validates item exists.

  // Delete encrypted files.
  deleteIfExists(itemPath(state, itemId));
  deleteIfExists(thumbPath(state, itemId));

  // Remove from manifest.
  state.manifest.items = state.manifest.items.filter((i) => i.id !== itemId);
  await saveVaultState(state);
  resetAutoLockTimer(state);

  log("info", `Item removed from vault: ${itemId}`);
}

/**
 * Update metadata fields on an existing item.
 *
 * The `id` and `type` fields cannot be changed.
 */
export async function updateItemMetadata(
  state: VaultState,
  itemId: string,
  updates: Partial<VaultItem>,
): Promise<void> {
  assertUnlocked(state);
  const item = findItem(state, itemId);

  // Apply updates, protecting immutable fields.
  if (updates.name !== undefined) item.name = updates.name;
  if (updates.category !== undefined) item.category = updates.category;
  if (updates.tags !== undefined) item.tags = updates.tags;
  if (updates.favorite !== undefined) item.favorite = updates.favorite;
  if (updates.fields !== undefined) item.fields = updates.fields;
  if (updates.notes !== undefined) item.notes = updates.notes;
  if (updates.templateId !== undefined) item.templateId = updates.templateId;
  if (updates.hasThumbnail !== undefined) item.hasThumbnail = updates.hasThumbnail;

  item.modifiedAt = new Date().toISOString();

  await saveVaultState(state);
  resetAutoLockTimer(state);
}

/**
 * Change the vault passphrase, re-encrypting all items and the manifest.
 *
 * @param state - Unlocked vault state.
 * @param currentPassphrase - The current vault passphrase (for verification).
 * @param newPassphrase - The new passphrase to apply.
 * @param newKdfPreset - KDF strength preset for the new passphrase.
 * @param onProgress - Optional callback reporting re-encryption progress.
 */
export async function changeVaultPassphrase(
  state: VaultState,
  currentPassphrase: string,
  newPassphrase: string,
  newKdfPreset: KdfPreset,
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  assertUnlocked(state);

  // Verify current passphrase.
  if (currentPassphrase !== state.passphrase) {
    throw new VaultLockedError();
  }

  // Count total work: each item + each thumbnail + manifest.
  const thumbnailCount = state.manifest.items.filter(
    (i) => i.hasThumbnail,
  ).length;
  const total = state.manifest.items.length + thumbnailCount + 1;
  let completed = 0;

  // Re-encrypt each item.
  for (const item of state.manifest.items) {
    const path = itemPath(state, item.id);
    const data = await decryptToBuffer(path, currentPassphrase, state.keyfilePath);
    await encryptBuffer(data, path, newPassphrase, {
      storeFilename: item.type === "file",
      wipeOriginal: false,
      kdfPreset: newKdfPreset,
    }, state.keyfilePath);
    completed++;
    onProgress?.(completed, total);

    // Re-encrypt thumbnail if present.
    if (item.hasThumbnail) {
      const tPath = thumbPath(state, item.id);
      const thumbData = await decryptToBuffer(tPath, currentPassphrase, state.keyfilePath);
      await encryptBuffer(thumbData, tPath, newPassphrase, {
        storeFilename: false,
        wipeOriginal: false,
        kdfPreset: newKdfPreset,
      }, state.keyfilePath);
      completed++;
      onProgress?.(completed, total);
    }
  }

  // Update manifest KDF preset and re-encrypt with new passphrase.
  state.manifest.kdfPreset = newKdfPreset;
  state.manifest.modifiedAt = new Date().toISOString();
  const newMtime = await saveManifest(state.dir, state.manifest, newPassphrase, undefined, state.keyfilePath);

  // Update state with new passphrase and mtime.
  state.passphrase = newPassphrase;
  state.manifestMtime = newMtime;

  completed++;
  onProgress?.(completed, total);

  resetAutoLockTimer(state);
  log("info", `Vault passphrase changed: ${state.name}`);
}

/**
 * Check whether an item's encrypted file exists on disk.
 */
export function itemFileExists(state: VaultState, itemId: string): boolean {
  const path = itemPath(state, itemId);
  return GLib.file_test(path, GLib.FileTest.EXISTS);
}

/**
 * Decrypt and return an item's data as an in-memory buffer.
 *
 * Updates the item's `accessedAt` timestamp.
 * @throws {@link ItemFileMissingError} if the item's file is missing from disk.
 */
export async function getItemData(
  state: VaultState,
  itemId: string,
): Promise<Uint8Array> {
  assertUnlocked(state);
  const item = findItem(state, itemId);

  // Check file existence before attempting decryption.
  if (!itemFileExists(state, itemId)) {
    throw new ItemFileMissingError(
      `Item file missing: items/${itemId}.gtkrypt`,
    );
  }

  const data = await decryptToBuffer(
    itemPath(state, itemId),
    state.passphrase,
    state.keyfilePath,
  );

  // Update access timestamp.
  item.accessedAt = new Date().toISOString();
  await saveVaultState(state);
  resetAutoLockTimer(state);

  return data;
}

/**
 * Remove items from the manifest whose encrypted files are missing from disk.
 *
 * @param state - Unlocked vault state.
 * @returns Array of removed item IDs.
 */
export async function cleanupMissingItems(
  state: VaultState,
): Promise<string[]> {
  assertUnlocked(state);

  const missingIds: string[] = [];

  for (const item of state.manifest.items) {
    if (!itemFileExists(state, item.id)) {
      missingIds.push(item.id);
    }
  }

  if (missingIds.length > 0) {
    // Remove missing items from manifest.
    state.manifest.items = state.manifest.items.filter(
      (i) => !missingIds.includes(i.id),
    );

    // Also clean up orphaned thumbnail entries.
    for (const id of missingIds) {
      deleteIfExists(thumbPath(state, id));
    }

    await saveVaultState(state);
    log("info", `Cleaned up ${missingIds.length} missing item(s)`);
  }

  return missingIds;
}
