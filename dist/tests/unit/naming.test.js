// tests/harness.ts
var _passed = 0;
var _failed = 0;
var _errors = [];
function assert(condition, message) {
  if (condition) {
    _passed++;
  } else {
    _failed++;
    _errors.push(`  FAIL: ${message}`);
  }
}
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

// src/services/naming.ts
import Gio from "gi://Gio";
import GLib from "gi://GLib";
var EXTENSION = ".gtkrypt";
var MAX_CONFLICT_ATTEMPTS = 1e3;
function resolveConflict(basePath) {
  const dir = GLib.path_get_dirname(basePath);
  const fullName = GLib.path_get_basename(basePath);
  const dotIndex = fullName.lastIndexOf(".");
  let stem;
  let ext;
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
    `Could not find an available filename after ${MAX_CONFLICT_ATTEMPTS} attempts: ${basePath}`
  );
}
function getEncryptOutputPath(inputPath, outputDir) {
  const baseName = GLib.path_get_basename(inputPath) + EXTENSION;
  const dir = outputDir !== void 0 ? outputDir : GLib.path_get_dirname(inputPath);
  const outputPath = GLib.build_filenamev([dir, baseName]);
  if (!Gio.File.new_for_path(outputPath).query_exists(null)) {
    return outputPath;
  }
  return resolveConflict(outputPath);
}
function getDecryptOutputPath(inputPath, storedFilename, outputDir) {
  let baseName;
  if (storedFilename !== void 0 && storedFilename.length > 0) {
    baseName = storedFilename;
  } else {
    const inputName = GLib.path_get_basename(inputPath);
    if (inputName.endsWith(EXTENSION)) {
      baseName = inputName.substring(0, inputName.length - EXTENSION.length);
    } else {
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      baseName = `Decrypted - ${stamp}`;
    }
  }
  const dir = outputDir !== void 0 ? outputDir : GLib.path_get_dirname(inputPath);
  const outputPath = GLib.build_filenamev([dir, baseName]);
  if (!Gio.File.new_for_path(outputPath).query_exists(null)) {
    return outputPath;
  }
  return resolveConflict(outputPath);
}

// tests/unit/naming.test.ts
import GLib2 from "gi://GLib";
import Gio2 from "gi://Gio";
function makeTmpDir() {
  return GLib2.dir_make_tmp("gtkrypt-naming-XXXXXX");
}
function touchFile(path) {
  const file = Gio2.File.new_for_path(path);
  const stream = file.create(Gio2.FileCreateFlags.NONE, null);
  stream.close(null);
}
function rmDir(dirPath) {
  const dir = Gio2.File.new_for_path(dirPath);
  const enumerator = dir.enumerate_children(
    "standard::name,standard::type",
    Gio2.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null
  );
  let info = enumerator.next_file(null);
  while (info !== null) {
    const child = enumerator.get_child(info);
    const fileType = info.get_file_type();
    if (fileType === Gio2.FileType.DIRECTORY) {
      rmDir(child.get_path());
    } else {
      child.delete(null);
    }
    info = enumerator.next_file(null);
  }
  enumerator.close(null);
  dir.delete(null);
}
var tmpDir = makeTmpDir();
try {
  {
    const inputPath = GLib2.build_filenamev([tmpDir, "photo.jpg"]);
    touchFile(inputPath);
    const result = getEncryptOutputPath(inputPath);
    const expected = GLib2.build_filenamev([tmpDir, "photo.jpg.gtkrypt"]);
    assertEqual(result, expected, "basic encrypt: photo.jpg -> photo.jpg.gtkrypt");
  }
  {
    const inputPath = GLib2.build_filenamev([tmpDir, "photo.jpg"]);
    const conflicting = GLib2.build_filenamev([tmpDir, "photo.jpg.gtkrypt"]);
    touchFile(conflicting);
    const result = getEncryptOutputPath(inputPath);
    const expected = GLib2.build_filenamev([tmpDir, "photo.jpg (1).gtkrypt"]);
    assertEqual(result, expected, "conflict resolution: photo.jpg (1).gtkrypt");
  }
  {
    const existing1 = GLib2.build_filenamev([tmpDir, "photo.jpg (1).gtkrypt"]);
    touchFile(existing1);
    const inputPath = GLib2.build_filenamev([tmpDir, "photo.jpg"]);
    const result = getEncryptOutputPath(inputPath);
    const expected = GLib2.build_filenamev([tmpDir, "photo.jpg (2).gtkrypt"]);
    assertEqual(result, expected, "double conflict: photo.jpg (2).gtkrypt");
  }
  {
    const inputPath = GLib2.build_filenamev([tmpDir, "photo.jpg.gtkrypt"]);
    const result = getDecryptOutputPath(inputPath);
    const subDir = GLib2.build_filenamev([tmpDir, "decrypt-basic"]);
    GLib2.mkdir_with_parents(subDir, 493);
    const freshInput = GLib2.build_filenamev([subDir, "photo.jpg.gtkrypt"]);
    touchFile(freshInput);
    const freshResult = getDecryptOutputPath(freshInput);
    const expected = GLib2.build_filenamev([subDir, "photo.jpg"]);
    assertEqual(freshResult, expected, "basic decrypt: photo.jpg.gtkrypt -> photo.jpg");
  }
  {
    const subDir = GLib2.build_filenamev([tmpDir, "decrypt-stored"]);
    GLib2.mkdir_with_parents(subDir, 493);
    const inputPath = GLib2.build_filenamev([subDir, "data.gtkrypt"]);
    touchFile(inputPath);
    const result = getDecryptOutputPath(inputPath, "report.pdf");
    const expected = GLib2.build_filenamev([subDir, "report.pdf"]);
    assertEqual(result, expected, "decrypt with stored filename: report.pdf");
  }
  {
    const subDir = GLib2.build_filenamev([tmpDir, "decrypt-empty-stored"]);
    GLib2.mkdir_with_parents(subDir, 493);
    const inputPath = GLib2.build_filenamev([subDir, "notes.txt.gtkrypt"]);
    touchFile(inputPath);
    const result = getDecryptOutputPath(inputPath, "");
    const expected = GLib2.build_filenamev([subDir, "notes.txt"]);
    assertEqual(result, expected, "empty stored filename falls back to extension strip");
  }
  {
    const subDir = GLib2.build_filenamev([tmpDir, "decrypt-fallback"]);
    GLib2.mkdir_with_parents(subDir, 493);
    const inputPath = GLib2.build_filenamev([subDir, "mystery"]);
    touchFile(inputPath);
    const result = getDecryptOutputPath(inputPath);
    assert(
      result.startsWith(subDir + "/Decrypted - "),
      "fallback starts with 'Decrypted - '"
    );
    assert(
      !result.endsWith(EXTENSION),
      "fallback does not have .gtkrypt extension"
    );
    const basename = GLib2.path_get_basename(result);
    const stampPart = basename.replace("Decrypted - ", "");
    assert(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(stampPart),
      `fallback timestamp format valid: ${stampPart}`
    );
  }
  {
    const srcDir = GLib2.build_filenamev([tmpDir, "custom-src"]);
    const outDir = GLib2.build_filenamev([tmpDir, "custom-out"]);
    GLib2.mkdir_with_parents(srcDir, 493);
    GLib2.mkdir_with_parents(outDir, 493);
    const inputPath = GLib2.build_filenamev([srcDir, "secret.doc"]);
    touchFile(inputPath);
    const result = getEncryptOutputPath(inputPath, outDir);
    const expected = GLib2.build_filenamev([outDir, "secret.doc.gtkrypt"]);
    assertEqual(result, expected, "custom output dir (encrypt): placed in outDir");
    assertEqual(
      GLib2.path_get_dirname(result),
      outDir,
      "custom output dir (encrypt): dirname matches outDir"
    );
  }
  {
    const srcDir = GLib2.build_filenamev([tmpDir, "custom-dec-src"]);
    const outDir = GLib2.build_filenamev([tmpDir, "custom-dec-out"]);
    GLib2.mkdir_with_parents(srcDir, 493);
    GLib2.mkdir_with_parents(outDir, 493);
    const inputPath = GLib2.build_filenamev([srcDir, "archive.tar.gtkrypt"]);
    touchFile(inputPath);
    const result = getDecryptOutputPath(inputPath, void 0, outDir);
    const expected = GLib2.build_filenamev([outDir, "archive.tar"]);
    assertEqual(result, expected, "custom output dir (decrypt): placed in outDir");
    assertEqual(
      GLib2.path_get_dirname(result),
      outDir,
      "custom output dir (decrypt): dirname matches outDir"
    );
  }
  {
    const srcDir = GLib2.build_filenamev([tmpDir, "custom-conflict-src"]);
    const outDir = GLib2.build_filenamev([tmpDir, "custom-conflict-out"]);
    GLib2.mkdir_with_parents(srcDir, 493);
    GLib2.mkdir_with_parents(outDir, 493);
    const inputPath = GLib2.build_filenamev([srcDir, "data.bin"]);
    touchFile(inputPath);
    const conflicting = GLib2.build_filenamev([outDir, "data.bin.gtkrypt"]);
    touchFile(conflicting);
    const result = getEncryptOutputPath(inputPath, outDir);
    const expected = GLib2.build_filenamev([outDir, "data.bin (1).gtkrypt"]);
    assertEqual(
      result,
      expected,
      "custom output dir with conflict: data.bin (1).gtkrypt"
    );
  }
  {
    const subDir = GLib2.build_filenamev([tmpDir, "decrypt-conflict"]);
    GLib2.mkdir_with_parents(subDir, 493);
    const inputPath = GLib2.build_filenamev([subDir, "readme.md.gtkrypt"]);
    touchFile(inputPath);
    const existing = GLib2.build_filenamev([subDir, "readme.md"]);
    touchFile(existing);
    const result = getDecryptOutputPath(inputPath);
    const expected = GLib2.build_filenamev([subDir, "readme (1).md"]);
    assertEqual(result, expected, "decrypt conflict: readme (1).md");
  }
  {
    assertEqual(EXTENSION, ".gtkrypt", "EXTENSION constant is .gtkrypt");
  }
} finally {
  rmDir(tmpDir);
}
report("naming");
//# sourceMappingURL=naming.test.js.map
