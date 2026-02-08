/**
 * Output filename generation and conflict resolution.
 *
 * Provides deterministic, user-friendly output paths for both
 * encryption and decryption operations. When a target path already
 * exists on disk the module appends a numeric suffix -- `(1)`,
 * `(2)`, etc. -- until an unused name is found.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

/** File extension used for encrypted containers. */
export const EXTENSION = ".gtkrypt";

/** Maximum number of conflict-resolution attempts before giving up. */
const MAX_CONFLICT_ATTEMPTS = 1000;

/**
 * Resolve a filename conflict by appending a numeric suffix.
 *
 * Given `/dir/photo.jpg.gtkrypt`, this tries in order:
 *   - `/dir/photo.jpg (1).gtkrypt`
 *   - `/dir/photo.jpg (2).gtkrypt`
 *   - ...
 *
 * The suffix is inserted before the *last* extension so the final
 * file still has the expected extension type.
 *
 * @param basePath - The desired output path that already exists.
 * @returns A path that does not yet exist on disk.
 * @throws If no available name is found within {@link MAX_CONFLICT_ATTEMPTS}.
 */
function resolveConflict(basePath: string): string {
  const dir = GLib.path_get_dirname(basePath);
  const fullName = GLib.path_get_basename(basePath);

  // Split into stem and extension at the *last* dot.
  const dotIndex = fullName.lastIndexOf(".");
  let stem: string;
  let ext: string;
  if (dotIndex > 0) {
    stem = fullName.substring(0, dotIndex);
    ext = fullName.substring(dotIndex);
  } else {
    stem = fullName;
    ext = "";
  }

  for (let i = 1; i <= MAX_CONFLICT_ATTEMPTS; i++) {
    const candidate = `${stem} (${i})${ext}`;
    const candidatePath = GLib.build_filenamev([dir, candidate]);
    if (!Gio.File.new_for_path(candidatePath).query_exists(null)) {
      return candidatePath;
    }
  }

  throw new Error(
    `Could not find an available filename after ${MAX_CONFLICT_ATTEMPTS} attempts: ${basePath}`,
  );
}

/**
 * Determine the output path for an encryption operation.
 *
 * The default behaviour is to append {@link EXTENSION} to the input
 * filename. If `outputDir` is provided the result is placed there
 * instead of alongside the input file.
 *
 * When the computed path already exists, a numeric suffix is appended
 * automatically (e.g. `photo.jpg (1).gtkrypt`).
 *
 * @param inputPath - Absolute path to the plaintext input file.
 * @param outputDir - Optional directory override for the output file.
 * @returns An absolute path that does not yet exist on disk.
 */
export function getEncryptOutputPath(
  inputPath: string,
  outputDir?: string,
): string {
  const baseName = GLib.path_get_basename(inputPath) + EXTENSION;

  const dir =
    outputDir !== undefined ? outputDir : GLib.path_get_dirname(inputPath);

  const outputPath = GLib.build_filenamev([dir, baseName]);

  if (!Gio.File.new_for_path(outputPath).query_exists(null)) {
    return outputPath;
  }

  return resolveConflict(outputPath);
}

/**
 * Determine the output path for a decryption operation.
 *
 * The filename is chosen using the following priority:
 *   1. `storedFilename` from the container header (if non-empty).
 *   2. The input filename with the `.gtkrypt` extension stripped.
 *   3. A timestamped fallback: `Decrypted - 2025-01-15T10-30-00-000Z`.
 *
 * If `outputDir` is provided the result is placed there instead of
 * alongside the input file.
 *
 * When the computed path already exists, a numeric suffix is appended
 * automatically (e.g. `photo (1).jpg`).
 *
 * @param inputPath - Absolute path to the encrypted input file.
 * @param storedFilename - Optional original filename stored in the container.
 * @param outputDir - Optional directory override for the output file.
 * @returns An absolute path that does not yet exist on disk.
 */
export function getDecryptOutputPath(
  inputPath: string,
  storedFilename?: string,
  outputDir?: string,
): string {
  let baseName: string;

  if (storedFilename !== undefined && storedFilename.length > 0) {
    baseName = storedFilename;
  } else {
    const inputName = GLib.path_get_basename(inputPath);
    if (inputName.endsWith(EXTENSION)) {
      baseName = inputName.substring(0, inputName.length - EXTENSION.length);
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      baseName = `Decrypted - ${stamp}`;
    }
  }

  const dir =
    outputDir !== undefined ? outputDir : GLib.path_get_dirname(inputPath);

  const outputPath = GLib.build_filenamev([dir, baseName]);

  if (!Gio.File.new_for_path(outputPath).query_exists(null)) {
    return outputPath;
  }

  return resolveConflict(outputPath);
}
