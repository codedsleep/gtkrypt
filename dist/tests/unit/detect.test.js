// tests/harness.ts
var _passed = 0;
var _failed = 0;
var _errors = [];
function assertEqual(actual, expected, message) {
  if (actual === expected) {
    _passed++;
  } else {
    _failed++;
    _errors.push(`  FAIL: ${message}
    expected: ${String(expected)}
    actual:   ${String(actual)}`);
  }
}
function report(suiteName) {
  if (_errors.length > 0) {
    printerr(`
${suiteName}:`);
    for (const err of _errors) {
      printerr(err);
    }
  }
  print(`${suiteName}: ${_passed} passed, ${_failed} failed`);
  if (_failed > 0) {
    imports.system.exit(1);
  }
}

// src/services/detect.ts
import Gio from "gi://Gio";

// src/util/i18n.ts
import GLib from "gi://GLib";
var domain = "gtkrypt";
imports.gettext.bindtextdomain(domain, GLib.get_home_dir());
imports.gettext.textdomain(domain);
var _ = imports.gettext.gettext;
var ngettext = imports.gettext.ngettext;

// src/services/format.ts
var HEADER_MAGIC = new Uint8Array([
  71,
  84,
  75,
  82,
  89,
  80,
  84,
  0
]);

// src/services/detect.ts
function detectFileType(path) {
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

// tests/unit/detect.test.ts
import GLib2 from "gi://GLib";
import Gio2 from "gi://Gio";
var tmpDir = GLib2.dir_make_tmp("gtkrypt-test-XXXXXX");
function writeTempFile(name, data) {
  const path = GLib2.build_filenamev([tmpDir, name]);
  const file = Gio2.File.new_for_path(path);
  const stream = file.create(Gio2.FileCreateFlags.NONE, null);
  if (data.byteLength > 0) {
    stream.write_bytes(new GLib2.Bytes(data), null);
  }
  stream.close(null);
  return path;
}
function removeTempFile(path) {
  try {
    Gio2.File.new_for_path(path).delete(null);
  } catch {
  }
}
function removeTempDir() {
  try {
    Gio2.File.new_for_path(tmpDir).delete(null);
  } catch {
  }
}
var MAGIC = new Uint8Array([71, 84, 75, 82, 89, 80, 84, 0]);
var tempFiles = [];
{
  const extra = new Uint8Array([1, 2, 3, 4, 255, 254]);
  const data = new Uint8Array(MAGIC.byteLength + extra.byteLength);
  data.set(MAGIC, 0);
  data.set(extra, MAGIC.byteLength);
  const path = writeTempFile("valid-encrypted.gtkrypt", data);
  tempFiles.push(path);
  const result = detectFileType(path);
  assertEqual(result, "encrypted", "File with valid magic bytes should be detected as encrypted");
}
{
  const encoder = new TextEncoder();
  const data = encoder.encode("Hello, this is a plain text file.\n");
  const path = writeTempFile("plain.txt", data);
  tempFiles.push(path);
  const result = detectFileType(path);
  assertEqual(result, "plaintext", "Plain text file should be detected as plaintext");
}
{
  const path = writeTempFile("empty.bin", new Uint8Array(0));
  tempFiles.push(path);
  const result = detectFileType(path);
  assertEqual(result, "unknown", "Empty file should be detected as unknown");
}
{
  const data = new Uint8Array([71, 84, 75]);
  const path = writeTempFile("short.bin", data);
  tempFiles.push(path);
  const result = detectFileType(path);
  assertEqual(result, "unknown", "File shorter than 8 bytes should be detected as unknown");
}
{
  const fakePath = GLib2.build_filenamev([tmpDir, "does-not-exist.gtkrypt"]);
  const result = detectFileType(fakePath);
  assertEqual(result, "unknown", "Nonexistent file should be detected as unknown");
}
for (const path of tempFiles) {
  removeTempFile(path);
}
removeTempDir();
report("detect");
//# sourceMappingURL=detect.test.js.map
