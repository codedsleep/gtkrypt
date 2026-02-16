/**
 * Bulk import wizard dialog for gtkrypt vaults.
 *
 * Allows users to import multiple files at once, assigning a shared
 * category and tags before committing items to the vault.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import type { CategoryDef } from "../models/types.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Describes a single file entry produced by the import dialog. */
export interface ImportFileEntry {
  path: string;
  name: string;
  category: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a byte count into a human-readable size string. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Parse a comma-separated tag string into a trimmed, non-empty array. */
function _parseTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Build a category combo row pre-selected to the given category ID. */
function _buildCategoryComboRow(
  categories: CategoryDef[],
  selectedId: string,
): { row: Adw.ComboRow; getSelectedId: () => string } {
  const labels = categories.map((c) => c.label);
  const model = Gtk.StringList.new(labels);
  const row = new Adw.ComboRow({
    title: _("Category"),
    model,
  });

  const idx = categories.findIndex((c) => c.id === selectedId);
  if (idx >= 0) row.set_selected(idx);

  return {
    row,
    getSelectedId: () =>
      categories[row.get_selected()]?.id ?? categories[0].id,
  };
}

/**
 * Guess a category ID from a filename based on extension and keywords.
 *
 * Rules:
 * - `.pdf` → "legal"
 * - Image files with identity keywords → "identity"
 * - Image files with banking keywords → "banking"
 * - Image files with medical keywords → "medical"
 * - Everything else → "other"
 */
export function autoCategorize(filename: string): string {
  const lower = filename.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));

  if (ext === ".pdf") return "legal";

  if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
    const base = lower.slice(0, lower.lastIndexOf("."));

    if (/passport|id|license|driver/.test(base)) return "identity";
    if (/receipt|invoice|bank|statement/.test(base)) return "banking";
    if (/medical|health|prescription/.test(base)) return "medical";
  }

  return "other";
}

// ---------------------------------------------------------------------------
// Internal file tracking
// ---------------------------------------------------------------------------

interface _TrackedFile {
  path: string;
  name: string;
  size: number;
  row: Adw.ActionRow;
}

// ---------------------------------------------------------------------------
// Import Dialog
// ---------------------------------------------------------------------------

class _ImportDialog extends Adw.Dialog {
  /** Called when the user confirms the import. */
  public onImport?: (files: ImportFileEntry[]) => void;

  // -- Widget references ----------------------------------------------------
  private _importButton!: Gtk.Button;
  private _tagsRow!: Adw.EntryRow;
  private _getCategoryId!: () => string;
  private _filesGroup!: Adw.PreferencesGroup;

  private _categories: CategoryDef[];
  private _files: _TrackedFile[] = [];

  constructor(
    files: { path: string; name: string; size: number }[],
    categories: CategoryDef[],
  ) {
    super();
    this._categories = categories;

    this.set_content_width(480);
    this.set_title(_("Import Files"));

    this._buildUi();
    this._populateFiles(files);
    this._validate();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(): void {
    // -- Header bar ---------------------------------------------------------
    const headerBar = new Adw.HeaderBar();
    headerBar.set_show_end_title_buttons(false);
    headerBar.set_show_start_title_buttons(false);

    const cancelButton = new Gtk.Button({ label: _("Cancel") });
    cancelButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Cancel import")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._importButton = new Gtk.Button({ label: _("Import") });
    this._importButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Import files to vault")],
    );
    this._importButton.add_css_class("suggested-action");
    this._importButton.set_sensitive(false);
    this._importButton.connect("clicked", () => this._onImport());
    headerBar.pack_end(this._importButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: Files --------------------------------------------------------
    this._filesGroup = new Adw.PreferencesGroup({
      title: _("Files"),
    });
    preferencesPage.add(this._filesGroup);

    // Group 2: Organization -------------------------------------------------
    const orgGroup = new Adw.PreferencesGroup({
      title: _("Organization"),
    });

    const defaultCategory =
      this._categories.find((c) => c.id === "other")?.id ??
      this._categories[0]?.id ??
      "";
    const { row: categoryRow, getSelectedId } = _buildCategoryComboRow(
      this._categories,
      defaultCategory,
    );
    this._getCategoryId = getSelectedId;
    orgGroup.add(categoryRow);

    this._tagsRow = new Adw.EntryRow({
      title: _("Tags"),
    });
    this._tagsRow.set_text("");
    orgGroup.add(this._tagsRow);

    preferencesPage.add(orgGroup);

    // -- Assemble with ToolbarView ------------------------------------------
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(preferencesPage);

    this.set_child(toolbarView);
  }

  // -------------------------------------------------------------------------
  // File list management
  // -------------------------------------------------------------------------

  private _populateFiles(
    files: { path: string; name: string; size: number }[],
  ): void {
    for (const file of files) {
      this._addFileRow(file);
    }
  }

  private _addFileRow(file: {
    path: string;
    name: string;
    size: number;
  }): void {
    const row = new Adw.ActionRow({
      title: file.name,
      subtitle: formatSize(file.size),
    });

    const removeButton = new Gtk.Button({
      icon_name: "list-remove-symbolic",
      valign: Gtk.Align.CENTER,
    });
    removeButton.add_css_class("flat");
    removeButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Remove file")],
    );
    removeButton.connect("clicked", () => this._removeFile(file.path));
    row.add_suffix(removeButton);

    this._filesGroup.add(row);

    this._files.push({
      path: file.path,
      name: file.name,
      size: file.size,
      row,
    });
  }

  private _removeFile(path: string): void {
    const idx = this._files.findIndex((f) => f.path === path);
    if (idx < 0) return;

    const tracked = this._files[idx];
    this._filesGroup.remove(tracked.row);
    this._files.splice(idx, 1);
    this._validate();
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private _validate(): void {
    this._importButton.set_sensitive(this._files.length > 0);
  }

  // -------------------------------------------------------------------------
  // Import handler
  // -------------------------------------------------------------------------

  private _onImport(): void {
    const category = this._getCategoryId();
    const tags = _parseTags(this._tagsRow.get_text());

    const entries: ImportFileEntry[] = this._files.map((f) => ({
      path: f.path,
      name: f.name,
      category,
      tags,
    }));

    this.onImport?.(entries);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const ImportDialog = GObject.registerClass(
  { GTypeName: "ImportDialog" },
  _ImportDialog,
);

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/** Show a bulk import dialog attached to the given parent window. */
export function showImportDialog(
  parent: Gtk.Window | null,
  files: { path: string; name: string; size: number }[],
  categories: CategoryDef[],
  onImport: (files: ImportFileEntry[]) => void,
): void {
  const dialog = new ImportDialog(files, categories);
  dialog.onImport = onImport;
  dialog.present(parent);
}
