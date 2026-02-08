/**
 * Unit tests for magic byte detection (`src/services/detect.ts`).
 *
 * Covers SCOPE.md task 7.4: valid .gtkrypt detection, plaintext,
 * empty files, short files, and nonexistent paths.
 */

import { assertEqual, report } from "../../tests/harness.js";
import { detectFileType } from "../../src/services/detect.js";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory for this test run. */
const tmpDir = GLib.dir_make_tmp("gtkrypt-test-XXXXXX");

/** Write raw bytes to a file inside the temp directory. */
function writeTempFile(name: string, data: Uint8Array): string {
  const path = GLib.build_filenamev([tmpDir, name]);
  const file = Gio.File.new_for_path(path);
  const stream = file.create(Gio.FileCreateFlags.NONE, null);
  if (data.byteLength > 0) {
    stream.write_bytes(new GLib.Bytes(data), null);
  }
  stream.close(null);
  return path;
}

/** Delete a file at the given path, ignoring errors. */
function removeTempFile(path: string): void {
  try {
    Gio.File.new_for_path(path).delete(null);
  } catch {
    // Ignore — file may already be deleted or nonexistent.
  }
}

/** Remove the temp directory (must be empty). */
function removeTempDir(): void {
  try {
    Gio.File.new_for_path(tmpDir).delete(null);
  } catch {
    // Ignore if removal fails.
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/** Valid GTKRYPT magic bytes: "GTKRYPT\0" */
const MAGIC = new Uint8Array([0x47, 0x54, 0x4b, 0x52, 0x59, 0x50, 0x54, 0x00]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const tempFiles: string[] = [];

// 1. File starting with GTKRYPT\0 magic bytes + extra data -> 'encrypted'
{
  const extra = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xff, 0xfe]);
  const data = new Uint8Array(MAGIC.byteLength + extra.byteLength);
  data.set(MAGIC, 0);
  data.set(extra, MAGIC.byteLength);

  const path = writeTempFile("valid-encrypted.gtkrypt", data);
  tempFiles.push(path);

  const result = detectFileType(path);
  assertEqual(result, "encrypted", "File with valid magic bytes should be detected as encrypted");
}

// 2. Plain text file -> 'plaintext'
{
  const encoder = new TextEncoder();
  const data = encoder.encode("Hello, this is a plain text file.\n");

  const path = writeTempFile("plain.txt", data);
  tempFiles.push(path);

  const result = detectFileType(path);
  assertEqual(result, "plaintext", "Plain text file should be detected as plaintext");
}

// 3. Empty file (0 bytes) -> 'unknown'
{
  const path = writeTempFile("empty.bin", new Uint8Array(0));
  tempFiles.push(path);

  const result = detectFileType(path);
  assertEqual(result, "unknown", "Empty file should be detected as unknown");
}

// 4. File shorter than 8 bytes -> 'unknown'
{
  const data = new Uint8Array([0x47, 0x54, 0x4b]); // 3 bytes — partial magic
  const path = writeTempFile("short.bin", data);
  tempFiles.push(path);

  const result = detectFileType(path);
  assertEqual(result, "unknown", "File shorter than 8 bytes should be detected as unknown");
}

// 5. Nonexistent path -> 'unknown'
{
  const fakePath = GLib.build_filenamev([tmpDir, "does-not-exist.gtkrypt"]);
  const result = detectFileType(fakePath);
  assertEqual(result, "unknown", "Nonexistent file should be detected as unknown");
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

for (const path of tempFiles) {
  removeTempFile(path);
}
removeTempDir();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

report("detect");
