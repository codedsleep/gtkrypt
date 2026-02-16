/**
 * File import dialog and item metadata editor for gtkrypt vaults.
 *
 * Provides dialogs for adding files to a vault with metadata,
 * and for editing existing item metadata.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import type { CategoryDef, VaultItem } from "../models/types.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

/** Parse a comma-separated tag string into a trimmed, non-empty array. */
function _parseTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// File Import Dialog
// ---------------------------------------------------------------------------

class _FileImportDialog extends Adw.Dialog {
  /** Called when the user confirms file import. */
  public onConfirm?: (
    name: string,
    category: string,
    tags: string[],
    favorite: boolean,
  ) => void;

  // -- Widget references ----------------------------------------------------
  private _nameRow!: Adw.EntryRow;
  private _tagsRow!: Adw.EntryRow;
  private _favoriteRow!: Adw.SwitchRow;
  private _addButton!: Gtk.Button;
  private _getCategoryId!: () => string;

  private _categories: CategoryDef[];

  constructor(fileName: string, categories: CategoryDef[]) {
    super();
    this._categories = categories;

    this.set_content_width(440);
    this.set_title(_("Add File to Vault"));

    this._buildUi(fileName);
    this._connectSignals();
    this._validate();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(fileName: string): void {
    // -- Header bar ---------------------------------------------------------
    const headerBar = new Adw.HeaderBar();
    headerBar.set_show_end_title_buttons(false);
    headerBar.set_show_start_title_buttons(false);

    const cancelButton = new Gtk.Button({ label: _("Cancel") });
    cancelButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Cancel file import")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._addButton = new Gtk.Button({ label: _("Add to Vault") });
    this._addButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Add file to vault")],
    );
    this._addButton.add_css_class("suggested-action");
    this._addButton.set_sensitive(false);
    this._addButton.connect("clicked", () => this._onConfirm());
    headerBar.pack_end(this._addButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: File ---------------------------------------------------------
    const fileGroup = new Adw.PreferencesGroup({
      title: _("File"),
    });

    // Strip .gtkrypt extension if present
    const displayName = fileName.replace(/\.gtkrypt$/i, "");
    this._nameRow = new Adw.EntryRow({
      title: _("Name"),
    });
    this._nameRow.set_text(displayName);
    fileGroup.add(this._nameRow);

    preferencesPage.add(fileGroup);

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

    this._favoriteRow = new Adw.SwitchRow({
      title: _("Favorite"),
    });
    this._favoriteRow.set_active(false);
    orgGroup.add(this._favoriteRow);

    preferencesPage.add(orgGroup);

    // -- Assemble with ToolbarView ------------------------------------------
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(preferencesPage);

    this.set_child(toolbarView);
  }

  // -------------------------------------------------------------------------
  // Signal connections
  // -------------------------------------------------------------------------

  private _connectSignals(): void {
    this._nameRow.connect("changed", () => this._validate());
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private _validate(): void {
    const name = this._nameRow.get_text().trim();
    this._addButton.set_sensitive(name.length > 0);
  }

  // -------------------------------------------------------------------------
  // Confirm handler
  // -------------------------------------------------------------------------

  private _onConfirm(): void {
    const name = this._nameRow.get_text().trim();
    const category = this._getCategoryId();
    const tags = _parseTags(this._tagsRow.get_text());
    const favorite = this._favoriteRow.get_active();

    this.onConfirm?.(name, category, tags, favorite);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// Item Metadata Editor
// ---------------------------------------------------------------------------

class _ItemMetadataEditor extends Adw.Dialog {
  /** Called when the user saves metadata changes. */
  public onSave?: (
    name: string,
    category: string,
    tags: string[],
    favorite: boolean,
  ) => void;

  // -- Widget references ----------------------------------------------------
  private _nameRow!: Adw.EntryRow;
  private _tagsRow!: Adw.EntryRow;
  private _favoriteRow!: Adw.SwitchRow;
  private _saveButton!: Gtk.Button;
  private _getCategoryId!: () => string;

  private _categories: CategoryDef[];

  constructor(item: VaultItem, categories: CategoryDef[]) {
    super();
    this._categories = categories;

    this.set_content_width(440);
    this.set_title(_("Edit Item"));

    this._buildUi(item);
    this._connectSignals();
    this._validate();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(item: VaultItem): void {
    // -- Header bar ---------------------------------------------------------
    const headerBar = new Adw.HeaderBar();
    headerBar.set_show_end_title_buttons(false);
    headerBar.set_show_start_title_buttons(false);

    const cancelButton = new Gtk.Button({ label: _("Cancel") });
    cancelButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Cancel editing")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._saveButton = new Gtk.Button({ label: _("Save") });
    this._saveButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Save item changes")],
    );
    this._saveButton.add_css_class("suggested-action");
    this._saveButton.set_sensitive(false);
    this._saveButton.connect("clicked", () => this._onSave());
    headerBar.pack_end(this._saveButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: Name ---------------------------------------------------------
    const nameGroup = new Adw.PreferencesGroup({
      title: _("Name"),
    });

    this._nameRow = new Adw.EntryRow({
      title: _("Name"),
    });
    this._nameRow.set_text(item.name);
    nameGroup.add(this._nameRow);

    preferencesPage.add(nameGroup);

    // Group 2: Organization -------------------------------------------------
    const orgGroup = new Adw.PreferencesGroup({
      title: _("Organization"),
    });

    const { row: categoryRow, getSelectedId } = _buildCategoryComboRow(
      this._categories,
      item.category,
    );
    this._getCategoryId = getSelectedId;
    orgGroup.add(categoryRow);

    this._tagsRow = new Adw.EntryRow({
      title: _("Tags"),
    });
    this._tagsRow.set_text(item.tags.join(", "));
    orgGroup.add(this._tagsRow);

    this._favoriteRow = new Adw.SwitchRow({
      title: _("Favorite"),
    });
    this._favoriteRow.set_active(item.favorite);
    orgGroup.add(this._favoriteRow);

    preferencesPage.add(orgGroup);

    // -- Assemble with ToolbarView ------------------------------------------
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(preferencesPage);

    this.set_child(toolbarView);
  }

  // -------------------------------------------------------------------------
  // Signal connections
  // -------------------------------------------------------------------------

  private _connectSignals(): void {
    this._nameRow.connect("changed", () => this._validate());
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private _validate(): void {
    const name = this._nameRow.get_text().trim();
    this._saveButton.set_sensitive(name.length > 0);
  }

  // -------------------------------------------------------------------------
  // Save handler
  // -------------------------------------------------------------------------

  private _onSave(): void {
    const name = this._nameRow.get_text().trim();
    const category = this._getCategoryId();
    const tags = _parseTags(this._tagsRow.get_text());
    const favorite = this._favoriteRow.get_active();

    this.onSave?.(name, category, tags, favorite);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const FileImportDialog = GObject.registerClass(
  { GTypeName: "FileImportDialog" },
  _FileImportDialog,
);

export const ItemMetadataEditor = GObject.registerClass(
  { GTypeName: "ItemMetadataEditor" },
  _ItemMetadataEditor,
);

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

/** Show a file import dialog attached to the given parent window. */
export function showFileImportDialog(
  parent: Gtk.Window | null,
  fileName: string,
  categories: CategoryDef[],
  onConfirm: (
    name: string,
    category: string,
    tags: string[],
    favorite: boolean,
  ) => void,
): void {
  const dialog = new FileImportDialog(fileName, categories);
  dialog.onConfirm = onConfirm;
  dialog.present(parent);
}

/** Show an item metadata editor dialog attached to the given parent window. */
export function showItemMetadataEditor(
  parent: Gtk.Window | null,
  item: VaultItem,
  categories: CategoryDef[],
  onSave: (
    name: string,
    category: string,
    tags: string[],
    favorite: boolean,
  ) => void,
): void {
  const dialog = new ItemMetadataEditor(item, categories);
  dialog.onSave = onSave;
  dialog.present(parent);
}
