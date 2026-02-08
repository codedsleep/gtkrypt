/**
 * Unit tests for src/util/bytes.ts — binary read/write helpers.
 *
 * Covers roundtrip encode/decode for all integer widths,
 * edge cases (zero, max values, boundary values), offset usage,
 * and concatBytes with various input combinations.
 */

import {
  assert,
  assertEqual,
  assertDeepEqual,
  assertBigIntEqual,
  report,
} from "../../tests/harness.js";

import {
  writeUint8,
  readUint8,
  writeUint16BE,
  readUint16BE,
  writeUint32BE,
  readUint32BE,
  writeUint64BE,
  readUint64BE,
  concatBytes,
} from "../../src/util/bytes.js";

// ---------------------------------------------------------------------------
// writeUint8 / readUint8
// ---------------------------------------------------------------------------

// Roundtrip: typical value
{
  const buf = new Uint8Array(4);
  writeUint8(buf, 0, 42);
  assertEqual(readUint8(buf, 0), 42, "uint8 roundtrip value 42");
}

// Roundtrip: zero
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 0);
  assertEqual(readUint8(buf, 0), 0, "uint8 roundtrip zero");
}

// Roundtrip: max value 0xFF
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 0xff);
  assertEqual(readUint8(buf, 0), 0xff, "uint8 roundtrip max 0xFF");
}

// Roundtrip: boundary value 0x80 (128)
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 0x80);
  assertEqual(readUint8(buf, 0), 0x80, "uint8 roundtrip boundary 0x80");
}

// Roundtrip: boundary value 0x7F (127)
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 0x7f);
  assertEqual(readUint8(buf, 0), 0x7f, "uint8 roundtrip boundary 0x7F");
}

// Roundtrip: value 1
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 1);
  assertEqual(readUint8(buf, 0), 1, "uint8 roundtrip value 1");
}

// Non-zero offset
{
  const buf = new Uint8Array(4);
  writeUint8(buf, 2, 0xab);
  assertEqual(readUint8(buf, 2), 0xab, "uint8 non-zero offset");
  assertEqual(readUint8(buf, 0), 0, "uint8 other bytes untouched at 0");
  assertEqual(readUint8(buf, 1), 0, "uint8 other bytes untouched at 1");
  assertEqual(readUint8(buf, 3), 0, "uint8 other bytes untouched at 3");
}

// Masking: values above 0xFF should be masked to lower 8 bits
{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 0x1ff);
  assertEqual(readUint8(buf, 0), 0xff, "uint8 masking 0x1FF -> 0xFF");
}

{
  const buf = new Uint8Array(1);
  writeUint8(buf, 0, 0x100);
  assertEqual(readUint8(buf, 0), 0x00, "uint8 masking 0x100 -> 0x00");
}

// Multiple writes at different offsets
{
  const buf = new Uint8Array(3);
  writeUint8(buf, 0, 0x11);
  writeUint8(buf, 1, 0x22);
  writeUint8(buf, 2, 0x33);
  assertEqual(readUint8(buf, 0), 0x11, "uint8 multi-write offset 0");
  assertEqual(readUint8(buf, 1), 0x22, "uint8 multi-write offset 1");
  assertEqual(readUint8(buf, 2), 0x33, "uint8 multi-write offset 2");
}

// ---------------------------------------------------------------------------
// writeUint16BE / readUint16BE
// ---------------------------------------------------------------------------

// Roundtrip: typical value
{
  const buf = new Uint8Array(4);
  writeUint16BE(buf, 0, 1000);
  assertEqual(readUint16BE(buf, 0), 1000, "uint16BE roundtrip value 1000");
}

// Roundtrip: zero
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 0);
  assertEqual(readUint16BE(buf, 0), 0, "uint16BE roundtrip zero");
}

// Roundtrip: max value 0xFFFF
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 0xffff);
  assertEqual(readUint16BE(buf, 0), 0xffff, "uint16BE roundtrip max 0xFFFF");
}

// Roundtrip: value 1
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 1);
  assertEqual(readUint16BE(buf, 0), 1, "uint16BE roundtrip value 1");
}

// Roundtrip: boundary 0x0100 (256)
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 0x0100);
  assertEqual(readUint16BE(buf, 0), 0x0100, "uint16BE roundtrip boundary 0x0100");
}

// Roundtrip: boundary 0x00FF (255)
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 0x00ff);
  assertEqual(readUint16BE(buf, 0), 0x00ff, "uint16BE roundtrip boundary 0x00FF");
}

// Roundtrip: boundary 0x8000 (32768)
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 0x8000);
  assertEqual(readUint16BE(buf, 0), 0x8000, "uint16BE roundtrip boundary 0x8000");
}

// Roundtrip: boundary 0x7FFF (32767)
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 0x7fff);
  assertEqual(readUint16BE(buf, 0), 0x7fff, "uint16BE roundtrip boundary 0x7FFF");
}

// Big-endian byte order verification
{
  const buf = new Uint8Array(2);
  writeUint16BE(buf, 0, 0x0102);
  assertEqual(buf[0], 0x01, "uint16BE big-endian high byte");
  assertEqual(buf[1], 0x02, "uint16BE big-endian low byte");
}

// Non-zero offset
{
  const buf = new Uint8Array(6);
  writeUint16BE(buf, 3, 0xabcd);
  assertEqual(readUint16BE(buf, 3), 0xabcd, "uint16BE non-zero offset");
  assertEqual(buf[0], 0, "uint16BE other bytes untouched");
  assertEqual(buf[1], 0, "uint16BE other bytes untouched");
  assertEqual(buf[2], 0, "uint16BE other bytes untouched");
  assertEqual(buf[5], 0, "uint16BE other bytes untouched");
}

// Multiple writes at different offsets
{
  const buf = new Uint8Array(6);
  writeUint16BE(buf, 0, 0x1234);
  writeUint16BE(buf, 2, 0x5678);
  writeUint16BE(buf, 4, 0x9abc);
  assertEqual(readUint16BE(buf, 0), 0x1234, "uint16BE multi-write offset 0");
  assertEqual(readUint16BE(buf, 2), 0x5678, "uint16BE multi-write offset 2");
  assertEqual(readUint16BE(buf, 4), 0x9abc, "uint16BE multi-write offset 4");
}

// ---------------------------------------------------------------------------
// writeUint32BE / readUint32BE
// ---------------------------------------------------------------------------

// Roundtrip: typical value
{
  const buf = new Uint8Array(8);
  writeUint32BE(buf, 0, 100000);
  assertEqual(readUint32BE(buf, 0), 100000, "uint32BE roundtrip value 100000");
}

// Roundtrip: zero
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 0);
  assertEqual(readUint32BE(buf, 0), 0, "uint32BE roundtrip zero");
}

// Roundtrip: max value 0xFFFFFFFF
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 0xffffffff);
  assertEqual(readUint32BE(buf, 0), 0xffffffff, "uint32BE roundtrip max 0xFFFFFFFF");
}

// Roundtrip: value 1
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 1);
  assertEqual(readUint32BE(buf, 0), 1, "uint32BE roundtrip value 1");
}

// Roundtrip: boundary 0x00010000 (65536)
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 0x00010000);
  assertEqual(readUint32BE(buf, 0), 0x00010000, "uint32BE roundtrip boundary 0x00010000");
}

// Roundtrip: boundary 0x0000FFFF (65535)
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 0x0000ffff);
  assertEqual(readUint32BE(buf, 0), 0x0000ffff, "uint32BE roundtrip boundary 0x0000FFFF");
}

// Roundtrip: boundary 0x80000000 (2147483648)
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 0x80000000);
  assertEqual(readUint32BE(buf, 0), 0x80000000, "uint32BE roundtrip boundary 0x80000000");
}

// Roundtrip: boundary 0x7FFFFFFF (2147483647)
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 0x7fffffff);
  assertEqual(readUint32BE(buf, 0), 0x7fffffff, "uint32BE roundtrip boundary 0x7FFFFFFF");
}

// Big-endian byte order verification
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 0x01020304);
  assertEqual(buf[0], 0x01, "uint32BE big-endian byte 0");
  assertEqual(buf[1], 0x02, "uint32BE big-endian byte 1");
  assertEqual(buf[2], 0x03, "uint32BE big-endian byte 2");
  assertEqual(buf[3], 0x04, "uint32BE big-endian byte 3");
}

// Non-zero offset
{
  const buf = new Uint8Array(8);
  writeUint32BE(buf, 4, 0xdeadbeef);
  assertEqual(readUint32BE(buf, 4), 0xdeadbeef, "uint32BE non-zero offset");
  assertEqual(readUint32BE(buf, 0), 0, "uint32BE other bytes untouched");
}

// Multiple writes at adjacent offsets
{
  const buf = new Uint8Array(8);
  writeUint32BE(buf, 0, 0x11223344);
  writeUint32BE(buf, 4, 0x55667788);
  assertEqual(readUint32BE(buf, 0), 0x11223344, "uint32BE multi-write offset 0");
  assertEqual(readUint32BE(buf, 4), 0x55667788, "uint32BE multi-write offset 4");
}

// Argon2 time_cost value (relevant to container format)
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 3);
  assertEqual(readUint32BE(buf, 0), 3, "uint32BE Argon2 time_cost value 3");
}

// Argon2 memory_cost value (relevant to container format)
{
  const buf = new Uint8Array(4);
  writeUint32BE(buf, 0, 65536);
  assertEqual(readUint32BE(buf, 0), 65536, "uint32BE Argon2 memory_cost 64 MiB");
}

// ---------------------------------------------------------------------------
// writeUint64BE / readUint64BE
// ---------------------------------------------------------------------------

// Roundtrip: typical value
{
  const buf = new Uint8Array(16);
  writeUint64BE(buf, 0, 1000000n);
  assertBigIntEqual(readUint64BE(buf, 0), 1000000n, "uint64BE roundtrip value 1000000");
}

// Roundtrip: zero
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0n);
  assertBigIntEqual(readUint64BE(buf, 0), 0n, "uint64BE roundtrip zero");
}

// Roundtrip: value 1
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 1n);
  assertBigIntEqual(readUint64BE(buf, 0), 1n, "uint64BE roundtrip value 1");
}

// Roundtrip: max value 2^64 - 1
{
  const buf = new Uint8Array(8);
  const maxUint64 = 0xffffffffffffffffn;
  writeUint64BE(buf, 0, maxUint64);
  assertBigIntEqual(readUint64BE(buf, 0), maxUint64, "uint64BE roundtrip max 2^64-1");
}

// Roundtrip: 2^32 (exceeds uint32 range, needs uint64)
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0x100000000n);
  assertBigIntEqual(readUint64BE(buf, 0), 0x100000000n, "uint64BE roundtrip 2^32");
}

// Roundtrip: 2^32 - 1 (max uint32 as bigint)
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0xffffffffn);
  assertBigIntEqual(readUint64BE(buf, 0), 0xffffffffn, "uint64BE roundtrip 2^32-1");
}

// Roundtrip: boundary 0x8000000000000000 (2^63)
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0x8000000000000000n);
  assertBigIntEqual(
    readUint64BE(buf, 0),
    0x8000000000000000n,
    "uint64BE roundtrip boundary 2^63",
  );
}

// Roundtrip: boundary 0x7FFFFFFFFFFFFFFF (2^63 - 1)
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0x7fffffffffffffffn);
  assertBigIntEqual(
    readUint64BE(buf, 0),
    0x7fffffffffffffffn,
    "uint64BE roundtrip boundary 2^63-1",
  );
}

// Big-endian byte order verification
{
  const buf = new Uint8Array(8);
  writeUint64BE(buf, 0, 0x0102030405060708n);
  assertEqual(buf[0], 0x01, "uint64BE big-endian byte 0");
  assertEqual(buf[1], 0x02, "uint64BE big-endian byte 1");
  assertEqual(buf[2], 0x03, "uint64BE big-endian byte 2");
  assertEqual(buf[3], 0x04, "uint64BE big-endian byte 3");
  assertEqual(buf[4], 0x05, "uint64BE big-endian byte 4");
  assertEqual(buf[5], 0x06, "uint64BE big-endian byte 5");
  assertEqual(buf[6], 0x07, "uint64BE big-endian byte 6");
  assertEqual(buf[7], 0x08, "uint64BE big-endian byte 7");
}

// Non-zero offset
{
  const buf = new Uint8Array(16);
  writeUint64BE(buf, 8, 0xdeadbeefcafebaben);
  assertBigIntEqual(
    readUint64BE(buf, 8),
    0xdeadbeefcafebaben,
    "uint64BE non-zero offset",
  );
  assertBigIntEqual(readUint64BE(buf, 0), 0n, "uint64BE other bytes untouched");
}

// Large file size value (relevant to container format - original file size field)
{
  const buf = new Uint8Array(8);
  const fourGiB = 4n * 1024n * 1024n * 1024n; // 4 GiB
  writeUint64BE(buf, 0, fourGiB);
  assertBigIntEqual(readUint64BE(buf, 0), fourGiB, "uint64BE large file size 4 GiB");
}

// Multiple writes at adjacent offsets
{
  const buf = new Uint8Array(16);
  writeUint64BE(buf, 0, 0x1111111111111111n);
  writeUint64BE(buf, 8, 0x2222222222222222n);
  assertBigIntEqual(readUint64BE(buf, 0), 0x1111111111111111n, "uint64BE multi-write offset 0");
  assertBigIntEqual(readUint64BE(buf, 8), 0x2222222222222222n, "uint64BE multi-write offset 8");
}

// ---------------------------------------------------------------------------
// Mixed-width operations in a single buffer (simulates header layout)
// ---------------------------------------------------------------------------

{
  // Simulate a mini container header:
  // offset 0: version (uint8)
  // offset 1: kdf_id (uint8)
  // offset 2: time_cost (uint32BE)
  // offset 6: memory_cost (uint32BE)
  // offset 10: parallelism (uint8)
  // offset 11: salt_len (uint8)
  // offset 12: filename_len (uint16BE)
  // offset 14: file_size (uint64BE)
  // offset 22: ciphertext_len (uint64BE)
  // Total: 30 bytes

  const header = new Uint8Array(30);

  writeUint8(header, 0, 1); // version
  writeUint8(header, 1, 1); // kdf_id = Argon2id
  writeUint32BE(header, 2, 3); // time_cost
  writeUint32BE(header, 6, 65536); // memory_cost (64 MiB)
  writeUint8(header, 10, 4); // parallelism
  writeUint8(header, 11, 16); // salt_len
  writeUint16BE(header, 12, 0); // filename_len (none)
  writeUint64BE(header, 14, 2097152n); // file_size (2 MiB)
  writeUint64BE(header, 22, 2097152n); // ciphertext_len

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

// ---------------------------------------------------------------------------
// concatBytes
// ---------------------------------------------------------------------------

// No arguments: returns empty Uint8Array
{
  const result = concatBytes();
  assertEqual(result.length, 0, "concatBytes no args returns empty array");
  assert(result instanceof Uint8Array, "concatBytes no args returns Uint8Array");
}

// Single empty array
{
  const result = concatBytes(new Uint8Array(0));
  assertEqual(result.length, 0, "concatBytes single empty array");
}

// Multiple empty arrays
{
  const result = concatBytes(new Uint8Array(0), new Uint8Array(0), new Uint8Array(0));
  assertEqual(result.length, 0, "concatBytes multiple empty arrays");
}

// Single non-empty array
{
  const input = new Uint8Array([1, 2, 3]);
  const result = concatBytes(input);
  assertDeepEqual(result, new Uint8Array([1, 2, 3]), "concatBytes single array");
}

// Two arrays
{
  const a = new Uint8Array([1, 2]);
  const b = new Uint8Array([3, 4]);
  const result = concatBytes(a, b);
  assertDeepEqual(result, new Uint8Array([1, 2, 3, 4]), "concatBytes two arrays");
}

// Three arrays
{
  const a = new Uint8Array([0x01]);
  const b = new Uint8Array([0x02, 0x03]);
  const c = new Uint8Array([0x04, 0x05, 0x06]);
  const result = concatBytes(a, b, c);
  assertDeepEqual(
    result,
    new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]),
    "concatBytes three arrays",
  );
}

// Mix of empty and non-empty arrays
{
  const a = new Uint8Array(0);
  const b = new Uint8Array([0xaa, 0xbb]);
  const c = new Uint8Array(0);
  const d = new Uint8Array([0xcc]);
  const e = new Uint8Array(0);
  const result = concatBytes(a, b, c, d, e);
  assertDeepEqual(
    result,
    new Uint8Array([0xaa, 0xbb, 0xcc]),
    "concatBytes mixed empty and non-empty",
  );
}

// Result is a new array (not a view of the original)
{
  const a = new Uint8Array([1, 2]);
  const b = new Uint8Array([3, 4]);
  const result = concatBytes(a, b);

  // Mutating the result should not affect originals
  result[0] = 0xff;
  assertEqual(a[0], 1, "concatBytes result is independent copy (source unchanged)");

  // Mutating originals should not affect the result
  a[1] = 0xee;
  assertEqual(result[1], 2, "concatBytes result is independent copy (result unchanged)");
}

// Large arrays
{
  const size = 1024;
  const a = new Uint8Array(size);
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    a[i] = i & 0xff;
    b[i] = (size - i) & 0xff;
  }
  const result = concatBytes(a, b);
  assertEqual(result.length, size * 2, "concatBytes large arrays length");
  assertEqual(result[0], 0, "concatBytes large arrays first byte of a");
  assertEqual(result[size - 1], (size - 1) & 0xff, "concatBytes large arrays last byte of a");
  assertEqual(result[size], size & 0xff, "concatBytes large arrays first byte of b");
  assertEqual(result[size * 2 - 1], 1, "concatBytes large arrays last byte of b");
}

// Single-byte arrays
{
  const result = concatBytes(
    new Uint8Array([0x47]),
    new Uint8Array([0x54]),
    new Uint8Array([0x4b]),
    new Uint8Array([0x52]),
    new Uint8Array([0x59]),
    new Uint8Array([0x50]),
    new Uint8Array([0x54]),
    new Uint8Array([0x00]),
  );
  // This spells out GTKRYPT\0 — the magic bytes
  assertDeepEqual(
    result,
    new Uint8Array([0x47, 0x54, 0x4b, 0x52, 0x59, 0x50, 0x54, 0x00]),
    "concatBytes single-byte arrays form magic bytes",
  );
}

// Preserves all byte values (0x00 through 0xFF)
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

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

report("bytes");
