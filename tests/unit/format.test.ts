/**
 * Unit tests for the container format parser (src/services/format.ts).
 *
 * Tests cover v1 and v2 header parsing, error cases for invalid
 * magic bytes, unsupported versions, short buffers, and edge cases
 * like zero-length filenames. Also tests getAADBytes extraction.
 */

import {
  assert,
  assertEqual,
  assertDeepEqual,
  assertBigIntEqual,
  assertThrows,
  report,
} from "../../tests/harness.js";
import {
  parseHeader,
  HEADER_MAGIC,
  CURRENT_VERSION,
  getAADBytes,
} from "../../src/services/format.js";
import {
  writeUint8,
  writeUint16BE,
  writeUint32BE,
  writeUint64BE,
} from "../../src/util/bytes.js";

// ---------------------------------------------------------------------------
// Helper: build a valid header buffer from field values
// ---------------------------------------------------------------------------

interface HeaderFields {
  version: number;
  kdfId: number;
  timeCost: number;
  memoryCost: number;
  parallelism: number;
  salt: Uint8Array;
  nonce: Uint8Array;
  filename: string;
  mode?: number;
  fileSize: bigint;
  ciphertextLength: bigint;
}

function buildHeader(fields: HeaderFields): Uint8Array {
  const encoder = new TextEncoder();
  const filenameBytes = encoder.encode(fields.filename);
  const filenameLength = filenameBytes.byteLength;

  const isV2 = fields.version === 2;
  const totalSize = (isV2 ? 71 : 67) + filenameLength;
  const buf = new Uint8Array(totalSize);

  // Magic (offset 0, 8 bytes)
  buf.set(HEADER_MAGIC, 0);

  // Version (offset 8, 1 byte)
  writeUint8(buf, 8, fields.version);

  // KDF ID (offset 9, 1 byte)
  writeUint8(buf, 9, fields.kdfId);

  // KDF params
  writeUint32BE(buf, 10, fields.timeCost);
  writeUint32BE(buf, 14, fields.memoryCost);
  writeUint8(buf, 18, fields.parallelism);

  // Salt (offset 19: length, offset 20: data)
  writeUint8(buf, 19, fields.salt.byteLength);
  buf.set(fields.salt, 20);

  // Nonce (offset 36: length, offset 37: data)
  writeUint8(buf, 36, fields.nonce.byteLength);
  buf.set(fields.nonce, 37);

  // Filename length (offset 49, uint16 BE)
  writeUint16BE(buf, 49, filenameLength);

  // Filename data (offset 51)
  if (filenameLength > 0) {
    buf.set(filenameBytes, 51);
  }

  const offset = 51 + filenameLength;

  if (isV2) {
    // Mode (offset 51+N, uint32 BE)
    writeUint32BE(buf, offset, fields.mode ?? 0);
    // File size (offset 55+N, uint64 BE)
    writeUint64BE(buf, offset + 4, fields.fileSize);
    // Ciphertext length (offset 63+N, uint64 BE)
    writeUint64BE(buf, offset + 12, fields.ciphertextLength);
  } else {
    // File size (offset 51+N, uint64 BE)
    writeUint64BE(buf, offset, fields.fileSize);
    // Ciphertext length (offset 59+N, uint64 BE)
    writeUint64BE(buf, offset + 8, fields.ciphertextLength);
  }

  return buf;
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const TEST_SALT = new Uint8Array([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
]);

const TEST_NONCE = new Uint8Array([
  0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6,
  0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac,
]);

// ---------------------------------------------------------------------------
// Test 1: Valid v2 header with filename
// ---------------------------------------------------------------------------

{
  const fields: HeaderFields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "secret.txt",
    mode: 0o644,
    fileSize: 1024n,
    ciphertextLength: 1040n,
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
  assertEqual(header.mode, 0o644, "v2: mode");
  assertBigIntEqual(header.fileSize, 1024n, "v2: fileSize");
  assertBigIntEqual(header.ciphertextLength, 1040n, "v2: ciphertextLength");
}

// ---------------------------------------------------------------------------
// Test 2: Valid v1 header (no mode field)
// ---------------------------------------------------------------------------

{
  const fields: HeaderFields = {
    version: 1,
    kdfId: 1,
    timeCost: 4,
    memoryCost: 262144,
    parallelism: 2,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "report.pdf",
    fileSize: 999999n,
    ciphertextLength: 1000015n,
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
  assertEqual(header.mode, undefined, "v1: mode is undefined");
  assertBigIntEqual(header.fileSize, 999999n, "v1: fileSize");
  assertBigIntEqual(header.ciphertextLength, 1000015n, "v1: ciphertextLength");
}

// ---------------------------------------------------------------------------
// Test 3: Reject invalid magic bytes
// ---------------------------------------------------------------------------

{
  const fields: HeaderFields = {
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
    ciphertextLength: 0n,
  };

  const buf = buildHeader(fields);

  // Corrupt the first magic byte
  buf[0] = 0x00;

  assertThrows(
    () => parseHeader(buf),
    "CorruptFileError",
    "invalid magic: corrupted first byte",
  );

  // Restore first byte, corrupt last magic byte
  buf[0] = 0x47;
  buf[7] = 0xff;

  assertThrows(
    () => parseHeader(buf),
    "CorruptFileError",
    "invalid magic: corrupted last byte",
  );
}

// ---------------------------------------------------------------------------
// Test 4: Reject unsupported version
// ---------------------------------------------------------------------------

{
  const fields: HeaderFields = {
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
    ciphertextLength: 0n,
  };

  const buf = buildHeader(fields);

  // Overwrite version to 99
  writeUint8(buf, 8, 99);

  assertThrows(
    () => parseHeader(buf),
    "UnsupportedVersionError",
    "unsupported version 99",
  );

  // Also test version 0
  writeUint8(buf, 8, 0);

  assertThrows(
    () => parseHeader(buf),
    "UnsupportedVersionError",
    "unsupported version 0",
  );
}

// ---------------------------------------------------------------------------
// Test 5: Zero-length filename
// ---------------------------------------------------------------------------

{
  const fields: HeaderFields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "",
    mode: 0o755,
    fileSize: 512n,
    ciphertextLength: 528n,
  };

  const buf = buildHeader(fields);
  const header = parseHeader(buf);

  assertEqual(header.filename, "", "empty filename: value is empty string");
  assertEqual(header.mode, 0o755, "empty filename: mode still parsed");
  assertBigIntEqual(header.fileSize, 512n, "empty filename: fileSize");
  assertBigIntEqual(header.ciphertextLength, 528n, "empty filename: ciphertextLength");
}

// ---------------------------------------------------------------------------
// Test 6: Non-zero filename decoded correctly from UTF-8
// ---------------------------------------------------------------------------

{
  // Test with ASCII filename
  const asciiFields: HeaderFields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "hello-world_2024.tar.gz",
    mode: 0o644,
    fileSize: 2048n,
    ciphertextLength: 2064n,
  };

  const asciiHeader = parseHeader(buildHeader(asciiFields));
  assertEqual(asciiHeader.filename, "hello-world_2024.tar.gz", "ASCII filename decoded");

  // Test with multi-byte UTF-8 filename
  const unicodeFields: HeaderFields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "\u00e4\u00f6\u00fc\u00df-\u6587\u4ef6.txt",
    mode: 0o600,
    fileSize: 256n,
    ciphertextLength: 272n,
  };

  const unicodeHeader = parseHeader(buildHeader(unicodeFields));
  assertEqual(
    unicodeHeader.filename,
    "\u00e4\u00f6\u00fc\u00df-\u6587\u4ef6.txt",
    "UTF-8 multi-byte filename decoded",
  );
}

// ---------------------------------------------------------------------------
// Test 7: Buffer too short
// ---------------------------------------------------------------------------

{
  // Completely empty buffer
  assertThrows(
    () => parseHeader(new Uint8Array(0)),
    "CorruptFileError",
    "buffer too short: empty buffer",
  );

  // One byte short of minimum v1 header (67 bytes)
  assertThrows(
    () => parseHeader(new Uint8Array(66)),
    "CorruptFileError",
    "buffer too short: 66 bytes (need 67 for v1)",
  );

  // Exactly v1 minimum size but claiming v2 -- should fail
  // because v2 needs 71 bytes minimum
  const v2ShortFields: HeaderFields = {
    version: 1, // build as v1 (67 bytes) ...
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "",
    fileSize: 0n,
    ciphertextLength: 0n,
  };

  const v2ShortBuf = buildHeader(v2ShortFields);
  // Now change the version byte to 2 so the parser expects 71 bytes
  writeUint8(v2ShortBuf, 8, 2);

  assertThrows(
    () => parseHeader(v2ShortBuf),
    "CorruptFileError",
    "buffer too short: 67 bytes claiming v2 (need 71)",
  );

  // Buffer has valid header but filename extends past available bytes
  // Build a v2 header with no filename, then overwrite filenameLength to 10
  const truncFields: HeaderFields = {
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
    ciphertextLength: 0n,
  };

  const truncBuf = buildHeader(truncFields);
  // Overwrite filename length to claim 10 bytes, but buffer has no room
  writeUint16BE(truncBuf, 49, 10);

  assertThrows(
    () => parseHeader(truncBuf),
    "CorruptFileError",
    "buffer too short: filename extends past available bytes",
  );
}

// ---------------------------------------------------------------------------
// Test 8: getAADBytes extraction
// ---------------------------------------------------------------------------

{
  const fields: HeaderFields = {
    version: 2,
    kdfId: 1,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4,
    salt: TEST_SALT,
    nonce: TEST_NONCE,
    filename: "test.bin",
    mode: 0o644,
    fileSize: 100n,
    ciphertextLength: 116n,
  };

  const buf = buildHeader(fields);
  const aad = getAADBytes(buf);

  assertEqual(aad.byteLength, 49, "AAD: length is 49 bytes");
  assertDeepEqual(
    aad.slice(0, 8),
    HEADER_MAGIC,
    "AAD: starts with magic bytes",
  );
  assertEqual(aad[8], 2, "AAD: contains version byte");
  // AAD ends at byte 48 (inclusive), which is the last nonce byte
  assertEqual(aad[48], TEST_NONCE[11], "AAD: last byte is last nonce byte");

  // getAADBytes should throw on short buffer
  assertThrows(
    () => getAADBytes(new Uint8Array(48)),
    "CorruptFileError",
    "AAD: buffer too short (48 bytes)",
  );

  assertThrows(
    () => getAADBytes(new Uint8Array(0)),
    "CorruptFileError",
    "AAD: buffer too short (0 bytes)",
  );
}

// ---------------------------------------------------------------------------
// Test 9: CURRENT_VERSION constant
// ---------------------------------------------------------------------------

{
  assertEqual(CURRENT_VERSION, 2, "CURRENT_VERSION is 2");
}

// ---------------------------------------------------------------------------
// Test 10: HEADER_MAGIC matches expected bytes
// ---------------------------------------------------------------------------

{
  const expected = new Uint8Array([0x47, 0x54, 0x4b, 0x52, 0x59, 0x50, 0x54, 0x00]);
  assertDeepEqual(HEADER_MAGIC, expected, "HEADER_MAGIC is GTKRYPT\\0");
}

// ---------------------------------------------------------------------------
report("format");
