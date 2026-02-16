/**
 * UUID v4 generation utility.
 *
 * Uses GLib's built-in random UUID generator which produces
 * RFC 4122 version 4 UUIDs.
 */

import GLib from "gi://GLib";

/**
 * Generate a new random UUID v4 string.
 *
 * @returns A UUID string in the format "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".
 */
export function generateUuid(): string {
  return GLib.uuid_string_random();
}
