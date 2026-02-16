/**
 * Clipboard service for gtkrypt.
 *
 * Provides copy-to-clipboard with optional auto-clear timer for
 * sensitive data like passwords and account numbers.
 */

import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib";

/** Active auto-clear timer ID, or null. */
let _clearTimerId: number | null = null;

/**
 * Copy text to the system clipboard with optional auto-clear.
 *
 * @param text - The text to copy.
 * @param autoClearSeconds - Seconds before auto-clearing (0 = never, default 30).
 */
export function copyToClipboard(
  text: string,
  autoClearSeconds: number = 30,
): void {
  // Cancel any previous clear timer
  if (_clearTimerId !== null) {
    GLib.source_remove(_clearTimerId);
    _clearTimerId = null;
  }

  const display = Gdk.Display.get_default();
  if (!display) return;

  const clipboard = display.get_clipboard();
  // Use Gdk.ContentProvider to set text on the clipboard
  const provider = Gdk.ContentProvider.new_for_value(text);
  clipboard.set_content(provider);

  if (autoClearSeconds > 0) {
    _clearTimerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      autoClearSeconds,
      () => {
        _clearTimerId = null;
        clearClipboard();
        return GLib.SOURCE_REMOVE;
      },
    );
  }
}

/** Clear the system clipboard. */
export function clearClipboard(): void {
  if (_clearTimerId !== null) {
    GLib.source_remove(_clearTimerId);
    _clearTimerId = null;
  }

  const display = Gdk.Display.get_default();
  if (!display) return;

  const clipboard = display.get_clipboard();
  clipboard.set_content(null);
}
