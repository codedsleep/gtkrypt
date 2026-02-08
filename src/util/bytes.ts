/**
 * Binary read/write helpers for working with Uint8Array buffers.
 *
 * All multi-byte operations use big-endian byte order to match
 * the gtkrypt container format specification. Implementations use
 * DataView for correctness and portability (no Node.js Buffer).
 */

/**
 * Write a single unsigned byte at the given offset.
 */
export function writeUint8(
  buffer: Uint8Array,
  offset: number,
  value: number,
): void {
  buffer[offset] = value & 0xff;
}

/**
 * Write an unsigned 16-bit integer in big-endian byte order.
 */
export function writeUint16BE(
  buffer: Uint8Array,
  offset: number,
  value: number,
): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint16(offset, value, false);
}

/**
 * Write an unsigned 32-bit integer in big-endian byte order.
 */
export function writeUint32BE(
  buffer: Uint8Array,
  offset: number,
  value: number,
): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(offset, value, false);
}

/**
 * Write an unsigned 64-bit integer in big-endian byte order.
 *
 * Accepts a `bigint` because JavaScript numbers cannot represent
 * the full uint64 range without loss of precision.
 */
export function writeUint64BE(
  buffer: Uint8Array,
  offset: number,
  value: bigint,
): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setBigUint64(offset, value, false);
}

/**
 * Read a single unsigned byte from the given offset.
 */
export function readUint8(buffer: Uint8Array, offset: number): number {
  return buffer[offset];
}

/**
 * Read an unsigned 16-bit integer in big-endian byte order.
 */
export function readUint16BE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getUint16(offset, false);
}

/**
 * Read an unsigned 32-bit integer in big-endian byte order.
 */
export function readUint32BE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getUint32(offset, false);
}

/**
 * Read an unsigned 64-bit integer in big-endian byte order.
 *
 * Returns a `bigint` because JavaScript numbers cannot represent
 * the full uint64 range without loss of precision.
 */
export function readUint64BE(buffer: Uint8Array, offset: number): bigint {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return view.getBigUint64(offset, false);
}

/**
 * Concatenate multiple Uint8Array instances into a single Uint8Array.
 *
 * Returns an empty Uint8Array if called with no arguments.
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
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
