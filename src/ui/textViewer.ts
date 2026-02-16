/**
 * Text viewer widget for gtkrypt.
 *
 * Displays text content from in-memory bytes in a read-only text view
 * with optional monospace font for code and structured data.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";

import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// MIME types that should use monospace rendering
// ---------------------------------------------------------------------------

const MONOSPACE_PATTERNS = [
  "json",
  "javascript",
  "xml",
  "yaml",
  "csv",
  "plain",
  "text/x-",
];

// ---------------------------------------------------------------------------
// Text viewer implementation
// ---------------------------------------------------------------------------

class _TextViewer extends Gtk.ScrolledWindow {
  private _textView!: Gtk.TextView;

  constructor() {
    super({
      vexpand: true,
      hexpand: true,
      hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    });

    this._buildUi();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(): void {
    this._textView = new Gtk.TextView({
      editable: false,
      cursor_visible: false,
      wrap_mode: Gtk.WrapMode.WORD,
      top_margin: 12,
      bottom_margin: 12,
      left_margin: 12,
      right_margin: 12,
    });
    this._textView.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Text content viewer")],
    );

    this.set_child(this._textView);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Set an accessible description for the text viewer.
   *
   * @param itemName - The name of the vault item being displayed.
   */
  setItemName(itemName: string): void {
    this._textView.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Encrypted text content of %s").replace("%s", itemName)],
    );
    this.update_property(
      [Gtk.AccessibleProperty.DESCRIPTION],
      [_("Encrypted text content of %s").replace("%s", itemName)],
    );
  }

  /**
   * Load text content from raw bytes.
   *
   * @param data - The raw text bytes.
   * @param mimeType - Optional MIME type for monospace auto-detection.
   */
  loadFromBytes(data: Uint8Array, mimeType?: string): void {
    const text = new TextDecoder().decode(data);
    const buffer = this._textView.get_buffer();
    buffer.set_text(text, text.length);

    // Auto-detect monospace based on MIME type
    if (mimeType) {
      const shouldMono = MONOSPACE_PATTERNS.some(
        (p) => mimeType.includes(p) || mimeType.startsWith("text/x-"),
      );
      this.setMonospace(shouldMono);
    }
  }

  /**
   * Toggle monospace font rendering.
   *
   * @param mono - Whether to use monospace font.
   */
  setMonospace(mono: boolean): void {
    if (mono) {
      this._textView.add_css_class("monospace");
    } else {
      this._textView.remove_css_class("monospace");
    }
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const TextViewer = GObject.registerClass(
  { GTypeName: "TextViewer" },
  _TextViewer,
);
