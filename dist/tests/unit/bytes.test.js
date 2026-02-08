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
function concatBytes(...arrays) {
  let totalLength = 0;
  for (const arr of arrays) {
    totalLength += arr.byteLength;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  return result;
}

// tests/unit/bytes.test.ts
{
  const buf = new Uint8Array(4);
  writeUint8(buf, 0, 42);
  assertEqual(readUint8(buf, 0), 42, "uint8 roundtrip value 42");
}
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 0);
  assertEqual(readUint8(buf, 0), 0, "uint8 roundtrip zero");
}
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 255);
  assertEqual(readUint8(buf, 0), 255, "uint8 roundtrip max 0xFF");
}
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 128);
  assertEqual(readUint8(buf, 0), 128, "uint8 roundtrip boundary 0x80");
}
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 127);
  assertEqual(readUint8(buf, 0), 127, "uint8 roundtrip boundary 0x7F");
}
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 1);
  assertEqual(readUint8(buf, 0), 1, "uint8 roundtrip value 1");
}
{
  const buf = new Uint8Array(4);
  writeUint8(buf, 2, 171);
  assertEqual(readUint8(buf, 2), 171, "uint8 non-zero offset");
  assertEqual(readUint8(buf, 0), 0, "uint8 other bytes untouched at 0");
  assertEqual(readUint8(buf, 1), 0, "uint8 other bytes untouched at 1");
  assertEqual(readUint8(buf, 3), 0, "uint8 other bytes untouched at 3");
}
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 511);
  assertEqual(readUint8(buf, 0), 255, "uint8 masking 0x1FF -> 0xFF");
}
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 256);
  assertEqual(readUint8(buf, 0), 0, "uint8 masking 0x100 -> 0x00");
}
{
  const buf = new Uint8Array(3);
  writeUint8(buf, 0, 17);
  writeUint8(buf, 1, 34);
  writeUint8(buf, 2, 51);
  assertEqual(readUint8(buf, 0), 17, "uint8 multi-write offset 0");
  assertEqual(readUint8(buf, 1), 34, "uint8 multi-write offset 1");
  assertEqual(readUint8(buf, 2), 51, "uint8 multi-write offset 2");
}
{
  const buf = new Uint8Array(4);
  writeUint16BE(buf, 0, 1e3);
  assertEqual(readUint16BE(buf, 0), 1e3, "uint16BE roundtrip value 1000");
}
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 0);
  assertEqual(readUint16BE(buf, 0), 0, "uint16BE roundtrip zero");
}
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 65535);
  assertEqual(readUint16BE(buf, 0), 65535, "uint16BE roundtrip max 0xFFFF");
}
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 1);
  assertEqual(readUint16BE(buf, 0), 1, "uint16BE roundtrip value 1");
}
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 256);
  assertEqual(readUint16BE(buf, 0), 256, "uint16BE roundtrip boundary 0x0100");
}
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 255);
  assertEqual(readUint16BE(buf, 0), 255, "uint16BE roundtrip boundary 0x00FF");
}
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 32768);
  assertEqual(readUint16BE(buf, 0), 32768, "uint16BE roundtrip boundary 0x8000");
}
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 32767);
  assertEqual(readUint16BE(buf, 0), 32767, "uint16BE roundtrip boundary 0x7FFF");
}
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 258);
  assertEqual(buf[0], 1, "uint16BE big-endian high byte");
  assertEqual(buf[1], 2, "uint16BE big-endian low byte");
}
{
  const buf = new Uint8Array(6);
  writeUint16BE(buf, 3, 43981);
  assertEqual(readUint16BE(buf, 3), 43981, "uint16BE non-zero offset");
  assertEqual(buf[0], 0, "uint16BE other bytes untouched");
  assertEqual(buf[1], 0, "uint16BE other bytes untouched");
  assertEqual(buf[2], 0, "uint16BE other bytes untouched");
  assertEqual(buf[5], 0, "uint16BE other bytes untouched");
}
{
  const buf = new Uint8Array(6);
  writeUint16BE(buf, 0, 4660);
  writeUint16BE(buf, 2, 22136);
  writeUint16BE(buf, 4, 39612);
  assertEqual(readUint16BE(buf, 0), 4660, "uint16BE multi-write offset 0");
  assertEqual(readUint16BE(buf, 2), 22136, "uint16BE multi-write offset 2");
  assertEqual(readUint16BE(buf, 4), 39612, "uint16BE multi-write offset 4");
}
{
  const buf = new Uint8Array(8);
  writeUint32BE(buf, 0, 1e5);
  assertEqual(readUint32BE(buf, 0), 1e5, "uint32BE roundtrip value 100000");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 0);
  assertEqual(readUint32BE(buf, 0), 0, "uint32BE roundtrip zero");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 4294967295);
  assertEqual(readUint32BE(buf, 0), 4294967295, "uint32BE roundtrip max 0xFFFFFFFF");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 1);
  assertEqual(readUint32BE(buf, 0), 1, "uint32BE roundtrip value 1");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 65536);
  assertEqual(readUint32BE(buf, 0), 65536, "uint32BE roundtrip boundary 0x00010000");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 65535);
  assertEqual(readUint32BE(buf, 0), 65535, "uint32BE roundtrip boundary 0x0000FFFF");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 2147483648);
  assertEqual(readUint32BE(buf, 0), 2147483648, "uint32BE roundtrip boundary 0x80000000");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 2147483647);
  assertEqual(readUint32BE(buf, 0), 2147483647, "uint32BE roundtrip boundary 0x7FFFFFFF");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 16909060);
  assertEqual(buf[0], 1, "uint32BE big-endian byte 0");
  assertEqual(buf[1], 2, "uint32BE big-endian byte 1");
  assertEqual(buf[2], 3, "uint32BE big-endian byte 2");
  assertEqual(buf[3], 4, "uint32BE big-endian byte 3");
}
{
  const buf = new Uint8Array(8);
  writeUint32BE(buf, 4, 3735928559);
  assertEqual(readUint32BE(buf, 4), 3735928559, "uint32BE non-zero offset");
  assertEqual(readUint32BE(buf, 0), 0, "uint32BE other bytes untouched");
}
{
  const buf = new Uint8Array(8);
  writeUint32BE(buf, 0, 287454020);
  writeUint32BE(buf, 4, 1432778632);
  assertEqual(readUint32BE(buf, 0), 287454020, "uint32BE multi-write offset 0");
  assertEqual(readUint32BE(buf, 4), 1432778632, "uint32BE multi-write offset 4");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 3);
  assertEqual(readUint32BE(buf, 0), 3, "uint32BE Argon2 time_cost value 3");
}
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 65536);
  assertEqual(readUint32BE(buf, 0), 65536, "uint32BE Argon2 memory_cost 64 MiB");
}
{
  const buf = new Uint8Array(16);
  writeUint64BE(buf, 0, 1000000n);
  assertBigIntEqual(readUint64BE(buf, 0), 1000000n, "uint64BE roundtrip value 1000000");
}
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0n);
  assertBigIntEqual(readUint64BE(buf, 0), 0n, "uint64BE roundtrip zero");
}
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 1n);
  assertBigIntEqual(readUint64BE(buf, 0), 1n, "uint64BE roundtrip value 1");
}
{
  const buf = new Uint8Array(8);
  const maxUint64 = 0xffffffffffffffffn;
  writeUint64BE(buf, 0, maxUint64);
  assertBigIntEqual(readUint64BE(buf, 0), maxUint64, "uint64BE roundtrip max 2^64-1");
}
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0x100000000n);
  assertBigIntEqual(readUint64BE(buf, 0), 0x100000000n, "uint64BE roundtrip 2^32");
}
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0xffffffffn);
  assertBigIntEqual(readUint64BE(buf, 0), 0xffffffffn, "uint64BE roundtrip 2^32-1");
}
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0x8000000000000000n);
  assertBigIntEqual(
    readUint64BE(buf, 0),
    0x8000000000000000n,
    "uint64BE roundtrip boundary 2^63"
  );
}
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0x7fffffffffffffffn);
  assertBigIntEqual(
    readUint64BE(buf, 0),
    0x7fffffffffffffffn,
    "uint64BE roundtrip boundary 2^63-1"
  );
}
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0x0102030405060708n);
  assertEqual(buf[0], 1, "uint64BE big-endian byte 0");
  assertEqual(buf[1], 2, "uint64BE big-endian byte 1");
  assertEqual(buf[2], 3, "uint64BE big-endian byte 2");
  assertEqual(buf[3], 4, "uint64BE big-endian byte 3");
  assertEqual(buf[4], 5, "uint64BE big-endian byte 4");
  assertEqual(buf[5], 6, "uint64BE big-endian byte 5");
  assertEqual(buf[6], 7, "uint64BE big-endian byte 6");
  assertEqual(buf[7], 8, "uint64BE big-endian byte 7");
}
{
  const buf = new Uint8Array(16);
  writeUint64BE(buf, 8, 0xdeadbeefcafebaben);
  assertBigIntEqual(
    readUint64BE(buf, 8),
    0xdeadbeefcafebaben,
    "uint64BE non-zero offset"
  );
  assertBigIntEqual(readUint64BE(buf, 0), 0n, "uint64BE other bytes untouched");
}
{
  const buf = new Uint8Array(8);
  const fourGiB = 4n * 1024n * 1024n * 1024n;
  writeUint64BE(buf, 0, fourGiB);
  assertBigIntEqual(readUint64BE(buf, 0), fourGiB, "uint64BE large file size 4 GiB");
}
{
  const buf = new Uint8Array(16);
  writeUint64BE(buf, 0, 0x1111111111111111n);
  writeUint64BE(buf, 8, 0x2222222222222222n);
  assertBigIntEqual(readUint64BE(buf, 0), 0x1111111111111111n, "uint64BE multi-write offset 0");
  assertBigIntEqual(readUint64BE(buf, 8), 0x2222222222222222n, "uint64BE multi-write offset 8");
}
{
  const header = new Uint8Array(30);
  writeUint8(header, 0, 1);
  writeUint8(header, 1, 1);
  writeUint32BE(header, 2, 3);
  writeUint32BE(header, 6, 65536);
  writeUint8(header, 10, 4);
  writeUint8(header, 11, 16);
  writeUint16BE(header, 12, 0);
  writeUint64BE(header, 14, 2097152n);
  writeUint64BE(header, 22, 2097152n);
  assertEqual(readUint8(header, 0), 1, "header version");
  assertEqual(readUint8(header, 1), 1, "header kdf_id");
  assertEqual(readUint32BE(header, 2), 3, "header time_cost");
  assertEqual(readUint32BE(header, 6), 65536, "header memory_cost");
  assertEqual(readUint8(header, 10), 4, "header parallelism");
  assertEqual(readUint8(header, 11), 16, "header salt_len");
  assertEqual(readUint16BE(header, 12), 0, "header filename_len");
  assertBigIntEqual(readUint64BE(header, 14), 2097152n, "header file_size");
  assertBigIntEqual(readUint64BE(header, 22), 2097152n, "header ciphertext_len");
}
{
  const result = concatBytes();
  assertEqual(result.length, 0, "concatBytes no args returns empty array");
  assert(result instanceof Uint8Array, "concatBytes no args returns Uint8Array");
}
{
  const result = concatBytes(new Uint8Array(0));
  assertEqual(result.length, 0, "concatBytes single empty array");
}
{
  const result = concatBytes(new Uint8Array(0), new Uint8Array(0), new Uint8Array(0));
  assertEqual(result.length, 0, "concatBytes multiple empty arrays");
}
{
  const input = new Uint8Array([1, 2, 3]);
  const result = concatBytes(input);
  assertDeepEqual(result, new Uint8Array([1, 2, 3]), "concatBytes single array");
}
{
  const a = new Uint8Array([1, 2]);
  const b = new Uint8Array([3, 4]);
  const result = concatBytes(a, b);
  assertDeepEqual(result, new Uint8Array([1, 2, 3, 4]), "concatBytes two arrays");
}
{
  const a = new Uint8Array([1]);
  const b = new Uint8Array([2, 3]);
  const c = new Uint8Array([4, 5, 6]);
  const result = concatBytes(a, b, c);
  assertDeepEqual(
    result,
    new Uint8Array([1, 2, 3, 4, 5, 6]),
    "concatBytes three arrays"
  );
}
{
  const a = new Uint8Array(0);
  const b = new Uint8Array([170, 187]);
  const c = new Uint8Array(0);
  const d = new Uint8Array([204]);
  const e = new Uint8Array(0);
  const result = concatBytes(a, b, c, d, e);
  assertDeepEqual(
    result,
    new Uint8Array([170, 187, 204]),
    "concatBytes mixed empty and non-empty"
  );
}
{
  const a = new Uint8Array([1, 2]);
  const b = new Uint8Array([3, 4]);
  const result = concatBytes(a, b);
  result[0] = 255;
  assertEqual(a[0], 1, "concatBytes result is independent copy (source unchanged)");
  a[1] = 238;
  assertEqual(result[1], 2, "concatBytes result is independent copy (result unchanged)");
}
{
  const size = 1024;
  const a = new Uint8Array(size);
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    a[i] = i & 255;
    b[i] = size - i & 255;
  }
  const result = concatBytes(a, b);
  assertEqual(result.length, size * 2, "concatBytes large arrays length");
  assertEqual(result[0], 0, "concatBytes large arrays first byte of a");
  assertEqual(result[size - 1], size - 1 & 255, "concatBytes large arrays last byte of a");
  assertEqual(result[size], size & 255, "concatBytes large arrays first byte of b");
  assertEqual(result[size * 2 - 1], 1, "concatBytes large arrays last byte of b");
}
{
  const result = concatBytes(
    new Uint8Array([71]),
    new Uint8Array([84]),
    new Uint8Array([75]),
    new Uint8Array([82]),
    new Uint8Array([89]),
    new Uint8Array([80]),
    new Uint8Array([84]),
    new Uint8Array([0])
  );
  assertDeepEqual(
    result,
    new Uint8Array([71, 84, 75, 82, 89, 80, 84, 0]),
    "concatBytes single-byte arrays form magic bytes"
  );
}
{
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    allBytes[i] = i;
  }
  const result = concatBytes(allBytes);
  assertEqual(result.length, 256, "concatBytes preserves all 256 byte values length");
  let allMatch = true;
  for (let i = 0; i < 256; i++) {
    if (result[i] !== i) {
      allMatch = false;
      break;
    }
  }
  assert(allMatch, "concatBytes preserves all 256 byte values");
}
report("bytes");
//# sourceMappingURL=bytes.test.js.map
