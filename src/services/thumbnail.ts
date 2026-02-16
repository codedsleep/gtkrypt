/**
 * Thumbnail generation service for gtkrypt.
 *
 * Produces JPEG thumbnails from in-memory image bytes by loading
 * through GdkPixbuf, downscaling to fit a maximum dimension while
 * preserving aspect ratio, and encoding as JPEG. Returns null for
 * non-image data or any processing error.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";

import { log } from "../util/logging.js";

/** Default maximum width/height in pixels for generated thumbnails. */
const DEFAULT_MAX_SIZE = 256;

/** JPEG quality parameter (0–100). */
const JPEG_QUALITY = "80";

/**
 * Generate a JPEG thumbnail from raw image bytes.
 *
 * The image is downscaled to fit within a `maxSize × maxSize` bounding
 * box while preserving its aspect ratio. Images smaller than `maxSize`
 * are kept at their original dimensions. The result is encoded as JPEG
 * at quality 80.
 *
 * @param imageBytes - Raw image data (PNG, JPEG, etc.).
 * @param maxSize - Maximum width or height in pixels (default 256).
 * @returns JPEG-encoded thumbnail bytes, or `null` if the input is
 *   not a valid image or any error occurs.
 */
export function generateThumbnail(
  imageBytes: Uint8Array,
  maxSize: number = DEFAULT_MAX_SIZE,
): Uint8Array | null {
  try {
    const gbytes = new GLib.Bytes(imageBytes);
    const stream = Gio.MemoryInputStream.new_from_bytes(gbytes);
    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
    stream.close(null);

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();

    let target = pixbuf;

    if (width > maxSize || height > maxSize) {
      const scale = Math.min(maxSize / width, maxSize / height);
      const newW = Math.round(width * scale);
      const newH = Math.round(height * scale);

      const scaled = pixbuf.scale_simple(
        newW,
        newH,
        GdkPixbuf.InterpType.BILINEAR,
      );

      if (!scaled) {
        log("warn", "Thumbnail scaling failed");
        return null;
      }

      target = scaled;
    }

    const [ok, buffer] = target.save_to_bufferv(
      "jpeg",
      ["quality"],
      [JPEG_QUALITY],
    );

    if (!ok) {
      log("warn", "Thumbnail JPEG encoding failed");
      return null;
    }

    return buffer;
  } catch {
    log("debug", "Thumbnail generation skipped (not a valid image)");
    return null;
  }
}
