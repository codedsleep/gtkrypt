/**
 * Unit tests for the output naming service.
 *
 * Tests encrypt/decrypt path generation, conflict resolution,
 * custom output directories, and fallback naming behaviour.
 *
 * Uses real temp directories so that `Gio.File.query_exists()`
 * and `GLib.path_get_dirname/basename/build_filenamev` work as
 * they would in the actual application.
 */

import { assertEqual, assert, report } from "../../tests/harness.js";
import {
  getEncryptOutputPath,
  getDecryptOutputPath,
  EXTENSION,
} from "../../src/services/naming.js";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory for test isolation. */
function makeTmpDir(): string {
  return GLib.dir_make_tmp("gtkrypt-naming-XXXXXX");
}

/** Create an empty file at `path` so it "exists" for conflict checks. */
function touchFile(path: string): void {
  const file = Gio.File.new_for_path(path);
  const stream = file.create(Gio.FileCreateFlags.NONE, null);
  stream.close(null);
}

/** Recursively remove a directory and its contents. */
function rmDir(dirPath: string): void {
  const dir = Gio.File.new_for_path(dirPath);
  const enumerator = dir.enumerate_children(
    "standard::name,standard::type",
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  );

  let info = enumerator.next_file(null);
  while (info !== null) {
    const child = enumerator.get_child(info);
    const fileType = info.get_file_type();
    if (fileType === Gio.FileType.DIRECTORY) {
      rmDir(child.get_path()!);
    } else {
      child.delete(null);
    }
    info = enumerator.next_file(null);
  }
  enumerator.close(null);
  dir.delete(null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const tmpDir = makeTmpDir();

try {
  // --- 1. Basic encrypt naming ---
  {
    const inputPath = GLib.build_filenamev([tmpDir, "photo.jpg"]);
    touchFile(inputPath);

    const result = getEncryptOutputPath(inputPath);
    const expected = GLib.build_filenamev([tmpDir, "photo.jpg.gtkrypt"]);

    assertEqual(result, expected, "basic encrypt: photo.jpg -> photo.jpg.gtkrypt");
  }

  // --- 2. Conflict resolution (encrypt) ---
  {
    const inputPath = GLib.build_filenamev([tmpDir, "photo.jpg"]);
    // photo.jpg already exists from test 1.
    // Create the default output so it conflicts.
    const conflicting = GLib.build_filenamev([tmpDir, "photo.jpg.gtkrypt"]);
    touchFile(conflicting);

    const result = getEncryptOutputPath(inputPath);
    const expected = GLib.build_filenamev([tmpDir, "photo.jpg (1).gtkrypt"]);

    assertEqual(result, expected, "conflict resolution: photo.jpg (1).gtkrypt");
  }

  // --- 2b. Double conflict resolution ---
  {
    // photo.jpg.gtkrypt and photo.jpg (1).gtkrypt both exist now; create (1).
    const existing1 = GLib.build_filenamev([tmpDir, "photo.jpg (1).gtkrypt"]);
    touchFile(existing1);

    const inputPath = GLib.build_filenamev([tmpDir, "photo.jpg"]);
    const result = getEncryptOutputPath(inputPath);
    const expected = GLib.build_filenamev([tmpDir, "photo.jpg (2).gtkrypt"]);

    assertEqual(result, expected, "double conflict: photo.jpg (2).gtkrypt");
  }

  // --- 3. Basic decrypt naming ---
  {
    const inputPath = GLib.build_filenamev([tmpDir, "photo.jpg.gtkrypt"]);
    // File was created in test 2, so it exists on disk (not strictly required
    // for getDecryptOutputPath, but keeps the scenario realistic).

    const result = getDecryptOutputPath(inputPath);

    // photo.jpg already exists (from test 1), so conflict resolution kicks in.
    // Use a fresh subdir to avoid that interference.
    const subDir = GLib.build_filenamev([tmpDir, "decrypt-basic"]);
    GLib.mkdir_with_parents(subDir, 0o755);

    const freshInput = GLib.build_filenamev([subDir, "photo.jpg.gtkrypt"]);
    touchFile(freshInput);

    const freshResult = getDecryptOutputPath(freshInput);
    const expected = GLib.build_filenamev([subDir, "photo.jpg"]);

    assertEqual(freshResult, expected, "basic decrypt: photo.jpg.gtkrypt -> photo.jpg");
  }

  // --- 4. Decrypt with stored filename ---
  {
    const subDir = GLib.build_filenamev([tmpDir, "decrypt-stored"]);
    GLib.mkdir_with_parents(subDir, 0o755);

    const inputPath = GLib.build_filenamev([subDir, "data.gtkrypt"]);
    touchFile(inputPath);

    const result = getDecryptOutputPath(inputPath, "report.pdf");
    const expected = GLib.build_filenamev([subDir, "report.pdf"]);

    assertEqual(result, expected, "decrypt with stored filename: report.pdf");
  }

  // --- 4b. Stored filename ignored when empty string ---
  {
    const subDir = GLib.build_filenamev([tmpDir, "decrypt-empty-stored"]);
    GLib.mkdir_with_parents(subDir, 0o755);

    const inputPath = GLib.build_filenamev([subDir, "notes.txt.gtkrypt"]);
    touchFile(inputPath);

    const result = getDecryptOutputPath(inputPath, "");
    const expected = GLib.build_filenamev([subDir, "notes.txt"]);

    assertEqual(result, expected, "empty stored filename falls back to extension strip");
  }

  // --- 5. Decrypt without .gtkrypt extension (timestamp fallback) ---
  {
    const subDir = GLib.build_filenamev([tmpDir, "decrypt-fallback"]);
    GLib.mkdir_with_parents(subDir, 0o755);

    const inputPath = GLib.build_filenamev([subDir, "mystery"]);
    touchFile(inputPath);

    const result = getDecryptOutputPath(inputPath);

    assert(
      result.startsWith(subDir + "/Decrypted - "),
      "fallback starts with 'Decrypted - '",
    );
    assert(
      !result.endsWith(EXTENSION),
      "fallback does not have .gtkrypt extension",
    );
    // Verify the timestamp portion looks like an ISO-ish date (YYYY-MM-DD...).
    const basename = GLib.path_get_basename(result);
    const stampPart = basename.replace("Decrypted - ", "");
    assert(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(stampPart),
      `fallback timestamp format valid: ${stampPart}`,
    );
  }

  // --- 6. Custom output directory (encrypt) ---
  {
    const srcDir = GLib.build_filenamev([tmpDir, "custom-src"]);
    const outDir = GLib.build_filenamev([tmpDir, "custom-out"]);
    GLib.mkdir_with_parents(srcDir, 0o755);
    GLib.mkdir_with_parents(outDir, 0o755);

    const inputPath = GLib.build_filenamev([srcDir, "secret.doc"]);
    touchFile(inputPath);

    const result = getEncryptOutputPath(inputPath, outDir);
    const expected = GLib.build_filenamev([outDir, "secret.doc.gtkrypt"]);

    assertEqual(result, expected, "custom output dir (encrypt): placed in outDir");
    assertEqual(
      GLib.path_get_dirname(result),
      outDir,
      "custom output dir (encrypt): dirname matches outDir",
    );
  }

  // --- 6b. Custom output directory (decrypt) ---
  {
    const srcDir = GLib.build_filenamev([tmpDir, "custom-dec-src"]);
    const outDir = GLib.build_filenamev([tmpDir, "custom-dec-out"]);
    GLib.mkdir_with_parents(srcDir, 0o755);
    GLib.mkdir_with_parents(outDir, 0o755);

    const inputPath = GLib.build_filenamev([srcDir, "archive.tar.gtkrypt"]);
    touchFile(inputPath);

    const result = getDecryptOutputPath(inputPath, undefined, outDir);
    const expected = GLib.build_filenamev([outDir, "archive.tar"]);

    assertEqual(result, expected, "custom output dir (decrypt): placed in outDir");
    assertEqual(
      GLib.path_get_dirname(result),
      outDir,
      "custom output dir (decrypt): dirname matches outDir",
    );
  }

  // --- 6c. Custom output directory with conflict ---
  {
    const srcDir = GLib.build_filenamev([tmpDir, "custom-conflict-src"]);
    const outDir = GLib.build_filenamev([tmpDir, "custom-conflict-out"]);
    GLib.mkdir_with_parents(srcDir, 0o755);
    GLib.mkdir_with_parents(outDir, 0o755);

    const inputPath = GLib.build_filenamev([srcDir, "data.bin"]);
    touchFile(inputPath);

    // Create conflict in the output dir
    const conflicting = GLib.build_filenamev([outDir, "data.bin.gtkrypt"]);
    touchFile(conflicting);

    const result = getEncryptOutputPath(inputPath, outDir);
    const expected = GLib.build_filenamev([outDir, "data.bin (1).gtkrypt"]);

    assertEqual(
      result,
      expected,
      "custom output dir with conflict: data.bin (1).gtkrypt",
    );
  }

  // --- 7. Decrypt conflict resolution ---
  {
    const subDir = GLib.build_filenamev([tmpDir, "decrypt-conflict"]);
    GLib.mkdir_with_parents(subDir, 0o755);

    const inputPath = GLib.build_filenamev([subDir, "readme.md.gtkrypt"]);
    touchFile(inputPath);

    // Create the plain output file so it conflicts
    const existing = GLib.build_filenamev([subDir, "readme.md"]);
    touchFile(existing);

    const result = getDecryptOutputPath(inputPath);
    const expected = GLib.build_filenamev([subDir, "readme (1).md"]);

    assertEqual(result, expected, "decrypt conflict: readme (1).md");
  }

  // --- 8. EXTENSION constant ---
  {
    assertEqual(EXTENSION, ".gtkrypt", "EXTENSION constant is .gtkrypt");
  }
} finally {
  // Clean up temp directory regardless of test outcome.
  rmDir(tmpDir);
}

report("naming");
