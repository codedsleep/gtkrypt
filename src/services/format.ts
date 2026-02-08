/**
 * Container format parser for `.gtkrypt` files (read-only).
 *
 * This module decodes the binary header written by the Rust crypto
 * backend. It is intentionally read-only -- encoding is performed
 * exclusively by the Rust binary to keep the single source of truth
 * for header construction in one place.
 *
 * The byte layout is documented in SCOPE.md under "Container format".
 */

import type { ContainerHeader, KdfParams } from "../models/types.js";
import {
  CorruptFileError,
  UnsupportedVersionError,
} from "../models/errors.js";
import {
  readUint8,
  readUint16BE,
  readUint32BE,
  readUint64BE,
} from "../util/bytes.js";

/** Magic bytes at the start of every `.gtkrypt` file: "GTKRYPT\0". */
export const HEADER_MAGIC = new Uint8Array([
  0x47, 0x54, 0x4b, 0x52, 0x59, 0x50, 0x54, 0x00,
]);

/** The newest container version this build can read. */
export const CURRENT_VERSION = 2;

/** KDF identifier for Argon2id. */
const KDF_ARGON2ID = 1;

/** Expected salt length in bytes. */
const SALT_LENGTH = 16;

/** Expected nonce/IV length in bytes. */
const NONCE_LENGTH = 12;

/** Minimum header sizes (no stored filename). */
const MIN_HEADER_SIZE_V1 = 67;
const MIN_HEADER_SIZE_V2 = 71;

/**
 * Parse a `.gtkrypt` container header from raw bytes.
 *
 * The caller should pass at least the first `MIN_HEADER_SIZE` bytes of
 * the file (more if a stored filename is present). This function does
 * not read or validate any ciphertext -- only the header fields.
 *
 * @param bytes - Raw bytes from the beginning of a `.gtkrypt` file.
 * @returns The parsed {@link ContainerHeader}.
 * @throws {@link CorruptFileError} if the magic bytes are wrong, the
 *   KDF identifier is unrecognised, or the buffer is too short.
 * @throws {@link UnsupportedVersionError} if the version field does
 *   not match {@link CURRENT_VERSION}.
 */
export function parseHeader(bytes: Uint8Array): ContainerHeader {
  if (bytes.byteLength < MIN_HEADER_SIZE_V1) {
    throw new CorruptFileError("Header too short to be a valid gtkrypt file");
  }

  // -- Magic (offset 0, 8 bytes) --
  for (let i = 0; i < HEADER_MAGIC.length; i++) {
    if (bytes[i] !== HEADER_MAGIC[i]) {
      throw new CorruptFileError("Invalid magic bytes");
    }
  }

  // -- Version (offset 8, 1 byte) --
  const version = readUint8(bytes, 8);
  if (version !== 1 && version !== 2) {
    throw new UnsupportedVersionError(
      `Container version ${version} is not supported (expected 1 or ${CURRENT_VERSION})`,
    );
  }
  if (version === 2 && bytes.byteLength < MIN_HEADER_SIZE_V2) {
    throw new CorruptFileError("Header too short to be a valid gtkrypt v2 file");
  }

  // -- KDF ID (offset 9, 1 byte) --
  const kdfId = readUint8(bytes, 9);
  if (kdfId !== KDF_ARGON2ID) {
    throw new CorruptFileError(`Unknown KDF identifier: ${kdfId}`);
  }

  // -- KDF parameters --
  const timeCost = readUint32BE(bytes, 10);
  const memoryCost = readUint32BE(bytes, 14);
  const parallelism = readUint8(bytes, 18);

  const kdfParams: KdfParams = { timeCost, memoryCost, parallelism };

  // -- Salt (offset 19: length, offset 20: data) --
  const saltLength = readUint8(bytes, 19);
  if (saltLength !== SALT_LENGTH) {
    throw new CorruptFileError(
      `Unexpected salt length: ${saltLength} (expected ${SALT_LENGTH})`,
    );
  }
  const salt = bytes.slice(20, 20 + saltLength);

  // -- Nonce (offset 36: length, offset 37: data) --
  const nonceLength = readUint8(bytes, 36);
  if (nonceLength !== NONCE_LENGTH) {
    throw new CorruptFileError(
      `Unexpected nonce length: ${nonceLength} (expected ${NONCE_LENGTH})`,
    );
  }
  const nonce = bytes.slice(37, 37 + nonceLength);

  // -- Filename (offset 49: uint16BE length, offset 51: UTF-8 data) --
  const filenameLength = readUint16BE(bytes, 49);

  const requiredSize =
    (version === 2 ? MIN_HEADER_SIZE_V2 : MIN_HEADER_SIZE_V1) + filenameLength;
  if (bytes.byteLength < requiredSize) {
    throw new CorruptFileError(
      "Header too short: filename extends past available bytes",
    );
  }

  let filename = "";
  if (filenameLength > 0) {
    const decoder = new TextDecoder("utf-8");
    filename = decoder.decode(bytes.slice(51, 51 + filenameLength));
  }

  const offset = 51 + filenameLength;

  let mode: number | undefined;
  let fileSize: bigint;
  let ciphertextLength: bigint;

  if (version === 2) {
    // -- Mode (uint32BE at 51 + filenameLength) --
    mode = readUint32BE(bytes, offset);

    // -- File size (uint64BE at 55 + filenameLength) --
    fileSize = readUint64BE(bytes, offset + 4);

    // -- Ciphertext length (uint64BE at 63 + filenameLength) --
    ciphertextLength = readUint64BE(bytes, offset + 12);
  } else {
    // -- File size (uint64BE at 51 + filenameLength) --
    fileSize = readUint64BE(bytes, offset);

    // -- Ciphertext length (uint64BE at 59 + filenameLength) --
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
    ciphertextLength,
  };
}

/**
 * Extract the Additional Authenticated Data (AAD) bytes from a header.
 *
 * AAD covers bytes 0 through 48 (inclusive) -- everything from the
 * magic through the end of the nonce. This range is authenticated
 * by GCM to detect header tampering.
 *
 * @param bytes - Raw bytes from the beginning of a `.gtkrypt` file.
 *   Must be at least 49 bytes long.
 * @returns A new Uint8Array containing the AAD region.
 * @throws {@link CorruptFileError} if the buffer is shorter than 49 bytes.
 */
export function getAADBytes(bytes: Uint8Array): Uint8Array {
  const AAD_END = 49;
  if (bytes.byteLength < AAD_END) {
    throw new CorruptFileError("Buffer too short to extract AAD bytes");
  }
  return bytes.slice(0, AAD_END);
}
