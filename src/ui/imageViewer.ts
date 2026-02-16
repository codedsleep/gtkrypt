/**
 * Image viewer widget for gtkrypt.
 *
 * Displays an image from in-memory bytes with zoom controls:
 * fit to container, actual size, zoom in (+25%), zoom out (-25%).
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gdk from "gi://Gdk?version=4.0";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";

import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.25;
const DEFAULT_ZOOM = 1.0;

// ---------------------------------------------------------------------------
// Image viewer implementation
// ---------------------------------------------------------------------------

class _ImageViewer extends Gtk.Box {
  private _picture!: Gtk.Picture;
  private _scrolled!: Gtk.ScrolledWindow;
  private _zoomLabel!: Gtk.Label;
  private _zoomInButton!: Gtk.Button;
  private _zoomOutButton!: Gtk.Button;
  private _fitButton!: Gtk.Button;
  private _actualButton!: Gtk.Button;

  private _pixbuf: GdkPixbuf.Pixbuf | null = null;
  private _zoomLevel: number = DEFAULT_ZOOM;

  constructor() {
    super({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
      vexpand: true,
      hexpand: true,
    });

    this._buildUi();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(): void {
    // -- Zoom toolbar -------------------------------------------------------
    const toolbar = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 4,
      halign: Gtk.Align.CENTER,
      margin_top: 6,
      margin_bottom: 6,
    });
    toolbar.add_css_class("toolbar");

    this._fitButton = new Gtk.Button({
      icon_name: "zoom-fit-best-symbolic",
      tooltip_text: _("Fit to window"),
    });
    this._fitButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Fit image to window")],
    );
    this._fitButton.connect("clicked", () => this._onFit());
    toolbar.append(this._fitButton);

    this._actualButton = new Gtk.Button({
      icon_name: "zoom-original-symbolic",
      tooltip_text: _("Actual size"),
    });
    this._actualButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Show image at actual size")],
    );
    this._actualButton.connect("clicked", () => this._onActualSize());
    toolbar.append(this._actualButton);

    this._zoomOutButton = new Gtk.Button({
      icon_name: "zoom-out-symbolic",
      tooltip_text: _("Zoom out"),
    });
    this._zoomOutButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Zoom out")],
    );
    this._zoomOutButton.connect("clicked", () => this._onZoomOut());
    toolbar.append(this._zoomOutButton);

    this._zoomLabel = new Gtk.Label({ label: "100%" });
    this._zoomLabel.set_width_chars(5);
    toolbar.append(this._zoomLabel);

    this._zoomInButton = new Gtk.Button({
      icon_name: "zoom-in-symbolic",
      tooltip_text: _("Zoom in"),
    });
    this._zoomInButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Zoom in")],
    );
    this._zoomInButton.connect("clicked", () => this._onZoomIn());
    toolbar.append(this._zoomInButton);

    this.append(toolbar);

    // -- Scrollable image area ----------------------------------------------
    this._picture = new Gtk.Picture();
    this._picture.set_can_shrink(true);
    this._picture.set_keep_aspect_ratio(true);

    this._scrolled = new Gtk.ScrolledWindow({
      vexpand: true,
      hexpand: true,
      child: this._picture,
    });
    this.append(this._scrolled);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Set an accessible description for the image viewer.
   *
   * @param itemName - The name of the vault item being displayed.
   */
  setItemName(itemName: string): void {
    this._picture.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Encrypted image preview of %s").replace("%s", itemName)],
    );
    this.update_property(
      [Gtk.AccessibleProperty.DESCRIPTION],
      [_("Encrypted image preview of %s").replace("%s", itemName)],
    );
  }

  /**
   * Load an image from raw bytes into the viewer.
   *
   * @param data - The raw image bytes (PNG, JPEG, etc.).
   */
  loadFromBytes(data: Uint8Array): void {
    const gbytes = new GLib.Bytes(data);
    const stream = Gio.MemoryInputStream.new_from_bytes(gbytes);
    this._pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
    stream.close(null);

    this._zoomLevel = DEFAULT_ZOOM;
    this._applyZoom();
  }

  // -------------------------------------------------------------------------
  // Zoom actions
  // -------------------------------------------------------------------------

  private _onFit(): void {
    if (!this._pixbuf) return;

    const containerWidth = this._scrolled.get_allocated_width();
    const imgWidth = this._pixbuf.get_width();

    if (imgWidth > 0 && containerWidth > 0) {
      this._zoomLevel = Math.min(containerWidth / imgWidth, ZOOM_MAX);
      this._zoomLevel = Math.max(this._zoomLevel, ZOOM_MIN);
    } else {
      this._zoomLevel = DEFAULT_ZOOM;
    }

    this._applyZoom();
  }

  private _onActualSize(): void {
    this._zoomLevel = DEFAULT_ZOOM;
    this._applyZoom();
  }

  private _onZoomIn(): void {
    this._zoomLevel = Math.min(this._zoomLevel + ZOOM_STEP, ZOOM_MAX);
    this._applyZoom();
  }

  private _onZoomOut(): void {
    this._zoomLevel = Math.max(this._zoomLevel - ZOOM_STEP, ZOOM_MIN);
    this._applyZoom();
  }

  // -------------------------------------------------------------------------
  // Zoom application
  // -------------------------------------------------------------------------

  private _applyZoom(): void {
    if (!this._pixbuf) return;

    const origW = this._pixbuf.get_width();
    const origH = this._pixbuf.get_height();
    const newW = Math.round(origW * this._zoomLevel);
    const newH = Math.round(origH * this._zoomLevel);

    if (newW <= 0 || newH <= 0) return;

    const scaled = this._pixbuf.scale_simple(
      newW,
      newH,
      GdkPixbuf.InterpType.BILINEAR,
    );

    if (scaled) {
      const texture = Gdk.Texture.new_for_pixbuf(scaled);
      this._picture.set_paintable(texture);
    }

    // Update zoom label and button sensitivity
    this._zoomLabel.set_label(`${Math.round(this._zoomLevel * 100)}%`);
    this._zoomInButton.set_sensitive(this._zoomLevel < ZOOM_MAX);
    this._zoomOutButton.set_sensitive(this._zoomLevel > ZOOM_MIN);
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const ImageViewer = GObject.registerClass(
  { GTypeName: "ImageViewer" },
  _ImageViewer,
);
