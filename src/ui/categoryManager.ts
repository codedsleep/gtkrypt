/**
 * Category manager dialog for gtkrypt.
 *
 * Provides an Adw.Dialog for viewing, adding, editing, and deleting
 * vault categories. Built-in categories are shown as read-only;
 * custom categories can be edited or removed.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import type { CategoryDef } from "../models/types.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ICON_LIST = [
  "folder-symbolic",
  "document-text-symbolic",
  "key-symbolic",
  "lock-symbolic",
  "heart-symbolic",
  "star-symbolic",
  "bookmark-symbolic",
  "flag-symbolic",
  "tag-symbolic",
  "person-symbolic",
  "home-symbolic",
  "briefcase-symbolic",
  "camera-symbolic",
  "music-note-symbolic",
  "globe-symbolic",
  "phone-symbolic",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a slug ID from a label string. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Deep-copy a categories array. */
function cloneCategories(cats: CategoryDef[]): CategoryDef[] {
  return cats.map((c) => ({ ...c }));
}

// ---------------------------------------------------------------------------
// Category manager dialog implementation
// ---------------------------------------------------------------------------

class _CategoryManagerDialog extends Adw.Dialog {
  private _categories: CategoryDef[];
  private _onSave: (categories: CategoryDef[]) => void;

  private _saveButton!: Gtk.Button;
  private _group!: Adw.PreferencesGroup;
  private _preferencesPage!: Adw.PreferencesPage;

  /** Index of the category currently being edited, or -1 if none. */
  private _editingIndex = -1;
  /** True when the inline form is for adding a new category. */
  private _isAdding = false;

  /** Inline edit form widgets (created lazily). */
  private _editGroup: Adw.PreferencesGroup | null = null;
  private _editNameRow: Adw.EntryRow | null = null;
  private _editIconRow: Adw.ComboRow | null = null;

  constructor(
    categories: CategoryDef[],
    onSave: (categories: CategoryDef[]) => void,
  ) {
    super();
    this._categories = cloneCategories(categories);
    this._onSave = onSave;

    this.set_content_width(480);
    this.set_title(_("Manage Categories"));

    this._buildUi();
    this._rebuildList();
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
      [_("Cancel category changes")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._saveButton = new Gtk.Button({ label: _("Save") });
    this._saveButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Save category changes")],
    );
    this._saveButton.add_css_class("suggested-action");
    this._saveButton.connect("clicked", () => this._onSaveClicked());
    headerBar.pack_end(this._saveButton);

    // -- Preferences page ---------------------------------------------------
    this._preferencesPage = new Adw.PreferencesPage();

    this._group = new Adw.PreferencesGroup({
      title: _("Categories"),
    });
    this._preferencesPage.add(this._group);

    // -- Assemble with ToolbarView ------------------------------------------
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(this._preferencesPage);

    this.set_child(toolbarView);
  }

  // -------------------------------------------------------------------------
  // List rendering
  // -------------------------------------------------------------------------

  /** Tear down and rebuild the entire category list + add button. */
  private _rebuildList(): void {
    // Remove old group and edit group from the page
    this._preferencesPage.remove(this._group);
    if (this._editGroup) {
      this._preferencesPage.remove(this._editGroup);
      this._editGroup = null;
    }

    // Create fresh group
    this._group = new Adw.PreferencesGroup({
      title: _("Categories"),
    });

    for (let i = 0; i < this._categories.length; i++) {
      const cat = this._categories[i];
      const row = this._buildCategoryRow(cat, i);
      this._group.add(row);
    }

    // "Add Category" button
    const addButton = new Gtk.Button({ label: _("Add Category") });
    addButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Add a new category")],
    );
    addButton.add_css_class("suggested-action");
    addButton.set_margin_top(12);
    addButton.connect("clicked", () => this._startAdd());
    this._group.add(addButton);

    this._preferencesPage.add(this._group);
  }

  /** Build an ActionRow for a single category. */
  private _buildCategoryRow(cat: CategoryDef, index: number): Adw.ActionRow {
    const row = new Adw.ActionRow({
      title: cat.label,
    });
    row.set_activatable(false);

    // Prefix icon
    const icon = new Gtk.Image({ icon_name: cat.icon });
    row.add_prefix(icon);

    if (cat.builtin) {
      // Built-in badge
      const badge = new Gtk.Label({ label: _("Built-in") });
      badge.add_css_class("dim-label");
      row.add_suffix(badge);
    } else {
      // Edit button
      const editBtn = new Gtk.Button({ icon_name: "document-edit-symbolic" });
      editBtn.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [_("Edit category")],
      );
      editBtn.add_css_class("flat");
      editBtn.set_valign(Gtk.Align.CENTER);
      editBtn.connect("clicked", () => this._startEdit(index));
      row.add_suffix(editBtn);

      // Delete button
      const deleteBtn = new Gtk.Button({
        icon_name: "user-trash-symbolic",
      });
      deleteBtn.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [_("Delete category")],
      );
      deleteBtn.add_css_class("flat");
      deleteBtn.add_css_class("error");
      deleteBtn.set_valign(Gtk.Align.CENTER);
      deleteBtn.connect("clicked", () => this._confirmDelete(index));
      row.add_suffix(deleteBtn);
    }

    return row;
  }

  // -------------------------------------------------------------------------
  // Inline edit / add form
  // -------------------------------------------------------------------------

  /** Show the inline edit form for an existing category. */
  private _startEdit(index: number): void {
    this._editingIndex = index;
    this._isAdding = false;
    const cat = this._categories[index];
    this._showEditForm(cat.label, cat.icon);
  }

  /** Show the inline add form for a new category. */
  private _startAdd(): void {
    this._editingIndex = -1;
    this._isAdding = true;
    this._showEditForm("", ICON_LIST[0]);
  }

  /** Build and display the inline edit form below the main list. */
  private _showEditForm(name: string, icon: string): void {
    // Remove previous edit group if any
    if (this._editGroup) {
      this._preferencesPage.remove(this._editGroup);
    }

    this._editGroup = new Adw.PreferencesGroup({
      title: this._isAdding ? _("New Category") : _("Edit Category"),
    });

    // Name entry
    this._editNameRow = new Adw.EntryRow({
      title: _("Name"),
    });
    this._editNameRow.set_text(name);
    this._editGroup.add(this._editNameRow);

    // Icon combo
    const iconModel = Gtk.StringList.new(ICON_LIST);
    this._editIconRow = new Adw.ComboRow({
      title: _("Icon"),
      model: iconModel,
    });
    // Select current icon
    const iconIndex = ICON_LIST.indexOf(icon);
    if (iconIndex >= 0) {
      this._editIconRow.set_selected(iconIndex);
    }
    this._editGroup.add(this._editIconRow);

    // Button row
    const buttonBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
      halign: Gtk.Align.END,
      margin_top: 8,
    });

    const editCancelBtn = new Gtk.Button({ label: _("Cancel") });
    editCancelBtn.connect("clicked", () => this._cancelEdit());
    buttonBox.append(editCancelBtn);

    const editSaveBtn = new Gtk.Button({
      label: this._isAdding ? _("Add") : _("Save"),
    });
    editSaveBtn.add_css_class("suggested-action");
    editSaveBtn.connect("clicked", () => this._commitEdit());
    buttonBox.append(editSaveBtn);

    this._editGroup.add(buttonBox);

    this._preferencesPage.add(this._editGroup);
  }

  /** Discard the inline edit form without saving. */
  private _cancelEdit(): void {
    if (this._editGroup) {
      this._preferencesPage.remove(this._editGroup);
      this._editGroup = null;
    }
    this._editingIndex = -1;
    this._isAdding = false;
  }

  /** Commit the inline edit: update or add the category. */
  private _commitEdit(): void {
    const name = this._editNameRow?.get_text().trim() ?? "";
    if (name.length === 0) return;

    const selectedIcon =
      ICON_LIST[this._editIconRow?.get_selected() ?? 0] ?? ICON_LIST[0];

    if (this._isAdding) {
      const id = slugify(name);
      this._categories.push({
        id,
        label: name,
        icon: selectedIcon,
        builtin: false,
      });
    } else if (this._editingIndex >= 0) {
      const cat = this._categories[this._editingIndex];
      cat.label = name;
      cat.icon = selectedIcon;
      // Regenerate ID from new label for custom categories
      cat.id = slugify(name);
    }

    this._cancelEdit();
    this._rebuildList();
  }

  // -------------------------------------------------------------------------
  // Delete confirmation
  // -------------------------------------------------------------------------

  /** Show a confirmation dialog before deleting a custom category. */
  private _confirmDelete(index: number): void {
    const cat = this._categories[index];

    const dialog = new Adw.AlertDialog({
      heading: _("Delete Category?"),
      body: _('Items in "%s" will be moved to "Other".').replace(
        "%s",
        cat.label,
      ),
    });

    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("delete", _("Delete"));
    dialog.set_default_response("cancel");
    dialog.set_response_appearance(
      "delete",
      Adw.ResponseAppearance.DESTRUCTIVE,
    );

    dialog.connect(
      "response",
      (_dialog: Adw.AlertDialog, response: string) => {
        if (response === "delete") {
          this._categories.splice(index, 1);
          this._rebuildList();
        }
      },
    );

    dialog.present(this);
  }

  // -------------------------------------------------------------------------
  // Save handler
  // -------------------------------------------------------------------------

  private _onSaveClicked(): void {
    this._onSave(this._categories);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

const CategoryManagerDialog = GObject.registerClass(
  { GTypeName: "CategoryManagerDialog" },
  _CategoryManagerDialog,
);

// ---------------------------------------------------------------------------
// Public convenience API
// ---------------------------------------------------------------------------

/**
 * Show the category manager dialog.
 *
 * Creates a deep copy of the categories array to work with, and only
 * calls `onSave` with the final result when the user clicks Save.
 *
 * @param parent     - The parent window to present the dialog over.
 * @param categories - Current category definitions.
 * @param onSave     - Callback invoked with updated categories on save.
 */
export function showCategoryManager(
  parent: Gtk.Window,
  categories: CategoryDef[],
  onSave: (categories: CategoryDef[]) => void,
): void {
  const dialog = new CategoryManagerDialog(categories, onSave);
  dialog.present(parent);
}
