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
function assertDeepEqual(actual, expected, message) {
  if (actual.length !== expected.length) {
    _failed++;
    _errors.push(`  FAIL: ${message}
    length mismatch: expected ${expected.length}, got ${actual.length}`);
    return;
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      _failed++;
      _errors.push(`  FAIL: ${message}
    byte ${i} differs: expected ${expected[i]}, got ${actual[i]}`);
      return;
    }
  }
  _passed++;
}
function assertThrows(fn, errorName, message) {
  try {
    fn();
    _failed++;
    _errors.push(`  FAIL: ${message}
    expected ${errorName} to be thrown, but nothing was thrown`);
  } catch (e) {
    const err = e;
    if (err.name === errorName) {
      _passed++;
    } else {
      _failed++;
      _errors.push(`  FAIL: ${message}
    expected ${errorName}, got ${err.name ?? String(e)}`);
    }
  }
}
function assertBigIntEqual(actual, expected, message) {
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

// src/util/i18n.ts
import GLib from "gi://GLib";
var domain = "gtkrypt";
imports.gettext.bindtextdomain(domain, GLib.get_home_dir());
imports.gettext.textdomain(domain);
var _ = imports.gettext.gettext;
var ngettext = imports.gettext.ngettext;

// src/models/errors.ts
var GtkryptError = class extends Error {
  userMessage;
  constructor(message, userMessage) {
    super(message);
    this.name = "GtkryptError";
    this.userMessage = userMessage;
  }
};
var CorruptFileError = class extends GtkryptError {
  constructor(message = "Corrupt or unrecognized file format") {
    super(message, _("Not a gtkrypt file or file is corrupted."));
    this.name = "CorruptFileError";
  }
};
var UnsupportedVersionError = class extends GtkryptError {
  constructor(message = "Unsupported container version") {
    super(message, _("This file was created with a newer version of gtkrypt."));
    this.name = "UnsupportedVersionError";
  }
};

// src/util/bytes.ts
function writeUint8(buffer, offset, value) {
  buffer[offset] = value & 255;
}
function writeUint16BE(buffer, offset, value) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint16(offset, value, false);
}
function writeUint32BE(buffer, offset, value) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(offset, value, false);
}
function writeUint64BE(buffer, offset, value) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setBigUint64(offset, value, false);
}
function readUint8(buffer, offset) {
  return buffer[offset];
}
function readUint16BE(buffer, offset) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getUint16(offset, false);
}
function readUint32BE(buffer, offset) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getUint32(offset, false);
}
function readUint64BE(buffer, offset) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getBigUint64(offset, false);
}

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
var CURRENT_VERSION = 2;
var KDF_ARGON2ID = 1;
var SALT_LENGTH = 16;
var NONCE_LENGTH = 12;
var MIN_HEADER_SIZE_V1 = 67;
var MIN_HEADER_SIZE_V2 = 71;
function parseHeader(bytes) {
  if (bytes.byteLength < MIN_HEADER_SIZE_V1) {
    throw new CorruptFileError("Header too short to be a valid gtkrypt file");
  }
  for (let i = 0; i < HEADER_MAGIC.length; i++) {
    if (bytes[i] !== HEADER_MAGIC[i]) {
      throw new CorruptFileError("Invalid magic bytes");
    }
  }
  const version = readUint8(bytes, 8);
  if (version !== 1 && version !== 2) {
    throw new UnsupportedVersionError(
      `Container version ${version} is not supported (expected 1 or ${CURRENT_VERSION})`
    );
  }
  if (version === 2 && bytes.byteLength < MIN_HEADER_SIZE_V2) {
    throw new CorruptFileError("Header too short to be a valid gtkrypt v2 file");
  }
  const kdfId = readUint8(bytes, 9);
  if (kdfId !== KDF_ARGON2ID) {
    throw new CorruptFileError(`Unknown KDF identifier: ${kdfId}`);
  }
  const timeCost = readUint32BE(bytes, 10);
  const memoryCost = readUint32BE(bytes, 14);
  const parallelism = readUint8(bytes, 18);
  const kdfParams = { timeCost, memoryCost, parallelism };
  const saltLength = readUint8(bytes, 19);
  if (saltLength !== SALT_LENGTH) {
    throw new CorruptFileError(
      `Unexpected salt length: ${saltLength} (expected ${SALT_LENGTH})`
    );
  }
  const salt = bytes.slice(20, 20 + saltLength);
  const nonceLength = readUint8(bytes, 36);
  if (nonceLength !== NONCE_LENGTH) {
    throw new CorruptFileError(
      `Unexpected nonce length: ${nonceLength} (expected ${NONCE_LENGTH})`
    );
  }
  const nonce = bytes.slice(37, 37 + nonceLength);
  const filenameLength = readUint16BE(bytes, 49);
  const requiredSize = (version === 2 ? MIN_HEADER_SIZE_V2 : MIN_HEADER_SIZE_V1) + filenameLength;
  if (bytes.byteLength < requiredSize) {
    throw new CorruptFileError(
      "Header too short: filename extends past available bytes"
    );
  }
  let filename = "";
  if (filenameLength > 0) {
    const decoder = new TextDecoder("utf-8");
    filename = decoder.decode(bytes.slice(51, 51 + filenameLength));
  }
  const offset = 51 + filenameLength;
  let mode;
  let fileSize;
  let ciphertextLength;
  if (version === 2) {
    mode = readUint32BE(bytes, offset);
    fileSize = readUint64BE(bytes, offset + 4);
    ciphertextLength = readUint64BE(bytes, offset + 12);
  } else {
    fileSize = readUint64BE(bytes, offset);
    ciphertextLength = readUint64BE(bytes, offset + 8);
  }
  return {
    version,
    kdfId,
    kdfParams,
    salt,
    nonce,
    filename,
    mode,
    fileSize,
    ciphertextLength
  };
}
function getAADBytes(bytes) {
  const AAD_END = 49;
  if (bytes.byteLength < AAD_END) {
    throw new CorruptFileError("Buffer too short to extract AAD bytes");
  }
  return bytes.slice(0, AAD_END);
}

// tests/unit/format.test.ts
function buildHeader(fields) {
  const encoder = new TextEncoder();
  const filenameBytes = encoder.encode(fields.filename);
  const filenameLength = filenameBytes.byteLength;
  const isV2 = fields.version === 2;
  const totalSize = (isV2 ? 71 : 67) + filenameLength;
  const buf = new Uint8Array(totalSize);
  buf.set(HEADER_MAGIC, 0);
  writeUint8(buf, 8, fields.version);
  writeUint8(buf, 9, fields.kdfId);
  writeUint32BE(buf, 10, fields.timeCost);
  writeUint32BE(buf, 14, fields.memoryCost);
  writeUint8(buf, 18, fields.parallelism);
  writeUint8(buf, 19, fields.salt.byteLength);
  buf.set(fields.salt, 20);
  writeUint8(buf, 36, fields.nonce.byteLength);
  buf.set(fields.nonce, 37);
  writeUint16BE(buf, 49, filenameLength);
  if (filenameLength > 0) {
    buf.set(filenameBytes, 51);
  }
  const offset = 51 + filenameLength;
  if (isV2) {
    writeUint32BE(buf, offset, fields.mode ?? 0);
    writeUint64BE(buf, offset + 4, fields.fileSize);
    writeUint64BE(buf, offset + 12, fields.ciphertextLength);
  } else {
    writeUint64BE(buf, offset, fields.fileSize);
    writeUint64BE(buf, offset + 8, fields.ciphertextLength);
  }
  return buf;
}
var TEST_SALT = new Uint8Array([
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16
]);
var TEST_NONCE = new Uint8Array([
  161,
  162,
  163,
  164,
  165,
  166,
  167,
  168,
  169,
  170,
  171,
  172
]);
{
  const fields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "secret.txt",
    mode: 420,
    fileSize: 1024n,
    ciphertextLength: 1040n
  };
  const buf = buildHeader(fields);
  const header = parseHeader(buf);
  assertEqual(header.version, 2, "v2: version");
  assertEqual(header.kdfId, 1, "v2: kdfId");
  assertEqual(header.kdfParams.timeCost, 3, "v2: timeCost");
  assertEqual(header.kdfParams.memoryCost, 65536, "v2: memoryCost");
  assertEqual(header.kdfParams.parallelism, 4, "v2: parallelism");
  assertDeepEqual(header.salt, TEST_SALT, "v2: salt");
  assertDeepEqual(header.nonce, TEST_NONCE, "v2: nonce");
  assertEqual(header.filename, "secret.txt", "v2: filename");
  assertEqual(header.mode, 420, "v2: mode");
  assertBigIntEqual(header.fileSize, 1024n, "v2: fileSize");
  assertBigIntEqual(header.ciphertextLength, 1040n, "v2: ciphertextLength");
}
{
  const fields = {
    version: 1,
    kdfId: 1,
    timeCost: 4,
    memoryCost: 262144,
    parallelism: 2,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "report.pdf",
    fileSize: 999999n,
    ciphertextLength: 1000015n
  };
  const buf = buildHeader(fields);
  const header = parseHeader(buf);
  assertEqual(header.version, 1, "v1: version");
  assertEqual(header.kdfId, 1, "v1: kdfId");
  assertEqual(header.kdfParams.timeCost, 4, "v1: timeCost");
  assertEqual(header.kdfParams.memoryCost, 262144, "v1: memoryCost");
  assertEqual(header.kdfParams.parallelism, 2, "v1: parallelism");
  assertDeepEqual(header.salt, TEST_SALT, "v1: salt");
  assertDeepEqual(header.nonce, TEST_NONCE, "v1: nonce");
  assertEqual(header.filename, "report.pdf", "v1: filename");
  assertEqual(header.mode, void 0, "v1: mode is undefined");
  assertBigIntEqual(header.fileSize, 999999n, "v1: fileSize");
  assertBigIntEqual(header.ciphertextLength, 1000015n, "v1: ciphertextLength");
}
{
  const fields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "",
    mode: 0,
    fileSize: 0n,
    ciphertextLength: 0n
  };
  const buf = buildHeader(fields);
  buf[0] = 0;
  assertThrows(
    () => parseHeader(buf),
    "CorruptFileError",
    "invalid magic: corrupted first byte"
  );
  buf[0] = 71;
  buf[7] = 255;
  assertThrows(
    () => parseHeader(buf),
    "CorruptFileError",
    "invalid magic: corrupted last byte"
  );
}
{
  const fields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "",
    mode: 0,
    fileSize: 0n,
    ciphertextLength: 0n
  };
  const buf = buildHeader(fields);
  writeUint8(buf, 8, 99);
  assertThrows(
    () => parseHeader(buf),
    "UnsupportedVersionError",
    "unsupported version 99"
  );
  writeUint8(buf, 8, 0);
  assertThrows(
    () => parseHeader(buf),
    "UnsupportedVersionError",
    "unsupported version 0"
  );
}
{
  const fields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "",
    mode: 493,
    fileSize: 512n,
    ciphertextLength: 528n
  };
  const buf = buildHeader(fields);
  const header = parseHeader(buf);
  assertEqual(header.filename, "", "empty filename: value is empty string");
  assertEqual(header.mode, 493, "empty filename: mode still parsed");
  assertBigIntEqual(header.fileSize, 512n, "empty filename: fileSize");
  assertBigIntEqual(header.ciphertextLength, 528n, "empty filename: ciphertextLength");
}
{
  const asciiFields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "hello-world_2024.tar.gz",
    mode: 420,
    fileSize: 2048n,
    ciphertextLength: 2064n
  };
  const asciiHeader = parseHeader(buildHeader(asciiFields));
  assertEqual(asciiHeader.filename, "hello-world_2024.tar.gz", "ASCII filename decoded");
  const unicodeFields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "\xE4\xF6\xFC\xDF-\u6587\u4EF6.txt",
    mode: 384,
    fileSize: 256n,
    ciphertextLength: 272n
  };
  const unicodeHeader = parseHeader(buildHeader(unicodeFields));
  assertEqual(
    unicodeHeader.filename,
    "\xE4\xF6\xFC\xDF-\u6587\u4EF6.txt",
    "UTF-8 multi-byte filename decoded"
  );
}
{
  assertThrows(
    () => parseHeader(new Uint8Array(0)),
    "CorruptFileError",
    "buffer too short: empty buffer"
  );
  assertThrows(
    () => parseHeader(new Uint8Array(66)),
    "CorruptFileError",
    "buffer too short: 66 bytes (need 67 for v1)"
  );
  const v2ShortFields = {
    version: 1,
    // build as v1 (67 bytes) ...
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "",
    fileSize: 0n,
    ciphertextLength: 0n
  };
  const v2ShortBuf = buildHeader(v2ShortFields);
  writeUint8(v2ShortBuf, 8, 2);
  assertThrows(
    () => parseHeader(v2ShortBuf),
    "CorruptFileError",
    "buffer too short: 67 bytes claiming v2 (need 71)"
  );
  const truncFields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "",
    mode: 0,
    fileSize: 0n,
    ciphertextLength: 0n
  };
  const truncBuf = buildHeader(truncFields);
  writeUint16BE(truncBuf, 49, 10);
  assertThrows(
    () => parseHeader(truncBuf),
    "CorruptFileError",
    "buffer too short: filename extends past available bytes"
  );
}
{
  const fields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "test.bin",
    mode: 420,
    fileSize: 100n,
    ciphertextLength: 116n
  };
  const buf = buildHeader(fields);
  const aad = getAADBytes(buf);
  assertEqual(aad.byteLength, 49, "AAD: length is 49 bytes");
  assertDeepEqual(
    aad.slice(0, 8),
    HEADER_MAGIC,
    "AAD: starts with magic bytes"
  );
  assertEqual(aad[8], 2, "AAD: contains version byte");
  assertEqual(aad[48], TEST_NONCE[11], "AAD: last byte is last nonce byte");
  assertThrows(
    () => getAADBytes(new Uint8Array(48)),
    "CorruptFileError",
    "AAD: buffer too short (48 bytes)"
  );
  assertThrows(
    () => getAADBytes(new Uint8Array(0)),
    "CorruptFileError",
    "AAD: buffer too short (0 bytes)"
  );
}
{
  assertEqual(CURRENT_VERSION, 2, "CURRENT_VERSION is 2");
}
{
  const expected = new Uint8Array([71, 84, 75, 82, 89, 80, 84, 0]);
  assertDeepEqual(HEADER_MAGIC, expected, "HEADER_MAGIC is GTKRYPT\\0");
}
report("format");
//# sourceMappingURL=format.test.js.map
