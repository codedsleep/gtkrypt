/**
 * File list view widget for displaying selected files and providing
 * the primary encrypt/decrypt action.
 *
 * Shows file entries with icons, sizes, type badges, and removal controls.
 * Groups files by type with section headers when both encrypted and
 * plaintext files are present.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import type { FileEntry } from "../models/types.js";
import { _, ngettext } from "../util/i18n.js";

/**
 * Format a byte count into a human-readable string using binary units.
 *
 * @param bytes - Raw byte count
 * @returns Formatted string such as "1.2 MiB" or "0 B"
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return _("0 B");
  const units = ["B", "KiB", "MiB", "GiB", "TiB"].map((unit) => _(unit));
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Determine the primary action button label based on the mix of file types.
 *
 * @param files - Current file entries
 * @returns Label string for the action button
 */
function getActionLabel(files: FileEntry[]): string {
  const hasEncrypted = files.some((f) => f.type === "encrypted");
  const hasPlaintext = files.some(
    (f) => f.type === "plaintext" || f.type === "unknown"
  );
  if (hasEncrypted && hasPlaintext) return _("Encrypt & Decrypt");
  if (hasEncrypted) return _("Decrypt");
  return _("Encrypt");
}

class _FileListView extends Gtk.Box {
  private _files: FileEntry[] = [];
  private _headerTitle!: Gtk.Label;
  private _headerSubtitle!: Gtk.Label;
  private _listBox!: Gtk.ListBox;
  private _actionButton!: Gtk.Button;
  private _clearButton!: Gtk.Button;
  private _scrolledWindow!: Gtk.ScrolledWindow;
  private _actionBar!: Gtk.Box;

  /** Called when the user clicks the primary action button. */
  onAction?: (files: FileEntry[]) => void;

  /** Called when the user clicks "Clear All". */
  onClear?: () => void;

  /** Called when the user removes a single file by index. */
  onFileRemoved?: (index: number) => void;

  constructor(config: Partial<Gtk.Box.ConstructorProps> = {}) {
    super({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
      ...config,
    });

    this._buildHeader();
    this._buildListArea();
    this._buildActionBar();
    this._updateActionState();
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Replace the current file list and rebuild all rows.
   *
   * @param files - New array of file entries to display
   */
  setFiles(files: FileEntry[]): void {
    this._files = [...files];
    this._rebuildList();
    this._updateActionState();
  }

  /**
   * Return a shallow copy of the current file list.
   */
  getFiles(): FileEntry[] {
    return [...this._files];
  }

  /**
   * Focus the primary action button for keyboard navigation.
   */
  focusPrimaryAction(): void {
    this._actionButton.grab_focus();
  }

  // -- Private: widget construction -----------------------------------------

  /** Create a simple title area above the list. */
  private _buildHeader(): void {
    this._headerTitle = new Gtk.Label({
      label: _("Selected Files"),
      halign: Gtk.Align.START,
      css_classes: ["heading"],
    });

    this._headerSubtitle = new Gtk.Label({
      label: _("Drop files or choose files to begin"),
      halign: Gtk.Align.START,
      css_classes: ["dim-label"],
      wrap: true,
    });

    const headerBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 4,
      margin_start: 24,
      margin_end: 24,
      margin_top: 18,
      margin_bottom: 6,
    });
    headerBox.append(this._headerTitle);
    headerBox.append(this._headerSubtitle);
    this.append(headerBox);
  }

  /** Create the scrolled list area that holds file rows. */
  private _buildListArea(): void {
    this._listBox = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      css_classes: ["boxed-list"],
    });

    const clamp = new Adw.Clamp({
      maximum_size: 760,
      margin_start: 18,
      margin_end: 18,
      margin_top: 6,
      child: this._listBox,
    });

    this._scrolledWindow = new Gtk.ScrolledWindow({
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      child: clamp,
    });

    this.append(this._scrolledWindow);
  }

  /** Create the bottom action bar with Clear All and the primary button. */
  private _buildActionBar(): void {
    this._clearButton = new Gtk.Button({
      label: _("Clear All"),
      css_classes: ["flat"],
    });
    this._clearButton.connect("clicked", () => {
      this.onClear?.();
    });

    this._actionButton = new Gtk.Button({
      label: _("Encrypt"),
      css_classes: ["suggested-action"],
      hexpand: true,
    });
    this._actionButton.connect("clicked", () => {
      this.onAction?.(this.getFiles());
    });

    this._actionBar = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 12,
    });

    const actionClamp = new Adw.Clamp({
      maximum_size: 360,
      child: this._actionButton,
    });
    this._actionBar.append(this._clearButton);
    this._actionBar.append(actionClamp);
    // Let the clamp expand to fill the remaining space
    actionClamp.set_hexpand(true);
    const actionOuterClamp = new Adw.Clamp({
      maximum_size: 760,
      margin_start: 18,
      margin_end: 18,
      margin_top: 12,
      margin_bottom: 18,
      child: this._actionBar,
    });
    this.append(actionOuterClamp);
  }

  // -- Private: list management ---------------------------------------------

  /** Remove all children from the list box. */
  private _clearList(): void {
    let child = this._listBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._listBox.remove(child);
      child = next;
    }
  }

  /** Rebuild all list rows from the current file array. */
  private _rebuildList(): void {
    this._clearList();

    if (this._files.length === 0) {
      return;
    }

    const hasEncrypted = this._files.some((f) => f.type === "encrypted");
    const hasPlaintext = this._files.some(
      (f) => f.type === "plaintext" || f.type === "unknown"
    );
    const isMixed = hasEncrypted && hasPlaintext;

    if (isMixed) {
      this._addMixedGroups();
    } else {
      this._files.forEach((entry, index) => {
        this._addFileRow(entry, index);
      });
    }
  }

  /**
   * When both encrypted and plaintext files are present, group them
   * under section headers for clarity.
   */
  private _addMixedGroups(): void {
    // "Files to Encrypt" section
    this._addSectionHeader(_("Files to Encrypt"));

    this._files.forEach((entry, index) => {
      if (entry.type === "plaintext" || entry.type === "unknown") {
        this._addFileRow(entry, index);
      }
    });

    // "Files to Decrypt" section
    this._addSectionHeader(_("Files to Decrypt"));

    this._files.forEach((entry, index) => {
      if (entry.type === "encrypted") {
        this._addFileRow(entry, index);
      }
    });
  }

  /**
   * Add a compact, non-activatable header row between mixed sections.
   */
  private _addSectionHeader(label: string): void {
    const sectionLabel = new Gtk.Label({
      label,
      halign: Gtk.Align.START,
      css_classes: ["caption", "dim-label"],
      hexpand: false,
    });
    const separator = new Gtk.Separator({
      orientation: Gtk.Orientation.HORIZONTAL,
      hexpand: true,
      valign: Gtk.Align.CENTER,
    });
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
      margin_start: 12,
      margin_end: 12,
      margin_top: 8,
      margin_bottom: 4,
    });
    box.append(sectionLabel);
    box.append(separator);

    const row = new Gtk.ListBoxRow({
      activatable: false,
      selectable: false,
    });
    row.set_child(box);
    this._listBox.append(row);
  }

  /**
   * Create and append a single file row to the list box.
   *
   * @param entry - The file entry to display
   * @param index - Index in the _files array (used for removal callback)
   */
  private _addFileRow(entry: FileEntry, index: number): void {
    const row = new Adw.ActionRow({
      title: entry.name,
      subtitle: formatFileSize(entry.size),
      icon_name:
        entry.type === "encrypted"
          ? "channel-secure-symbolic"
          : "text-x-generic-symbolic",
    });
    row.update_property([Gtk.AccessibleProperty.DESCRIPTION], [
      `${entry.name}, ${formatFileSize(entry.size)}, ` +
        `${entry.type === "encrypted" ? _("Decrypt") : _("Encrypt")}`,
    ]);

    // Type badge
    const badge = new Gtk.Label({
      label: entry.type === "encrypted" ? _("Decrypt") : _("Encrypt"),
      css_classes: [
        "caption",
        entry.type === "encrypted" ? "accent" : "success",
      ],
      valign: Gtk.Align.CENTER,
    });
    row.add_suffix(badge);

    // Remove button
    const removeBtn = new Gtk.Button({
      icon_name: "list-remove-symbolic",
      valign: Gtk.Align.CENTER,
      css_classes: ["flat"],
      tooltip_text: _("Remove file"),
    });
    removeBtn.update_property([Gtk.AccessibleProperty.LABEL], [`Remove ${entry.name}`]);
    removeBtn.connect("clicked", () => {
      this.onFileRemoved?.(index);
    });
    row.add_suffix(removeBtn);

    this._listBox.append(row);
  }

  /** Update the action button label and sensitivity based on file state. */
  private _updateActionState(): void {
    const hasFiles = this._files.length > 0;
    this._actionButton.set_label(getActionLabel(this._files));
    this._actionButton.set_sensitive(hasFiles);
    this._clearButton.set_sensitive(hasFiles);

    const subtitle = hasFiles
      ? ngettext("%d file ready", "%d files ready", this._files.length)
          .replace("%d", String(this._files.length))
      : _("Drop files or choose files to begin");
    this._headerSubtitle.set_label(subtitle);
  }
}

export const FileListView = GObject.registerClass(
  {
    GTypeName: "FileListView",
  },
  _FileListView
);
