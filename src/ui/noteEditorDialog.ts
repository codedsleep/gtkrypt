/**
 * Note editor dialog for gtkrypt vault items.
 *
 * Provides a dialog for creating or editing free-form text notes
 * with title, content, category, and tags.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import type { CategoryDef } from "../models/types.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Note editor dialog implementation
// ---------------------------------------------------------------------------

class _NoteEditorDialog extends Adw.Dialog {
  /** Called when the user saves the note. */
  public onSave?: (
    title: string,
    text: string,
    category: string,
    tags: string[],
  ) => void;

  // -- Widget references ----------------------------------------------------
  private _titleRow!: Adw.EntryRow;
  private _textView!: Gtk.TextView;
  private _saveButton!: Gtk.Button;
  private _categoryRow!: Adw.ComboRow;
  private _tagsRow!: Adw.EntryRow;

  private _categories: CategoryDef[];

  constructor(
    categories: CategoryDef[],
    existingTitle?: string,
    existingText?: string,
  ) {
    super();
    this._categories = categories;

    this.set_content_width(500);
    this.set_title(existingTitle ? _("Edit Note") : _("New Note"));

    this._buildUi(existingTitle, existingText);
    this._validate();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(existingTitle?: string, existingText?: string): void {
    // -- Header bar ---------------------------------------------------------
    const headerBar = new Adw.HeaderBar();
    headerBar.set_show_end_title_buttons(false);
    headerBar.set_show_start_title_buttons(false);

    const cancelButton = new Gtk.Button({ label: _("Cancel") });
    cancelButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Cancel note editing")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._saveButton = new Gtk.Button({ label: _("Save") });
    this._saveButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Save note")],
    );
    this._saveButton.add_css_class("suggested-action");
    this._saveButton.set_sensitive(false);
    this._saveButton.connect("clicked", () => this._onSave());
    headerBar.pack_end(this._saveButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: Title --------------------------------------------------------
    const titleGroup = new Adw.PreferencesGroup({
      title: _("Title"),
    });

    this._titleRow = new Adw.EntryRow({
      title: _("Title"),
    });
    if (existingTitle) {
      this._titleRow.set_text(existingTitle);
    }
    this._titleRow.connect("changed", () => this._validate());
    titleGroup.add(this._titleRow);

    preferencesPage.add(titleGroup);

    // Group 2: Note content -------------------------------------------------
    const contentGroup = new Adw.PreferencesGroup({
      title: _("Note"),
    });

    const frame = new Gtk.Frame();
    const scrolledWindow = new Gtk.ScrolledWindow();
    scrolledWindow.set_min_content_height(200);
    scrolledWindow.set_hexpand(true);

    this._textView = new Gtk.TextView();
    this._textView.set_wrap_mode(Gtk.WrapMode.WORD_CHAR);
    this._textView.set_top_margin(8);
    this._textView.set_bottom_margin(8);
    this._textView.set_left_margin(8);
    this._textView.set_right_margin(8);

    if (existingText) {
      this._textView.get_buffer().set_text(existingText, -1);
    }

    this._textView.get_buffer().connect("changed", () => this._validate());

    scrolledWindow.set_child(this._textView);
    frame.set_child(scrolledWindow);
    contentGroup.add(frame);

    preferencesPage.add(contentGroup);

    // Group 3: Category -----------------------------------------------------
    const categoryGroup = new Adw.PreferencesGroup({
      title: _("Category"),
    });

    const categoryLabels = this._categories.map((c) => c.label);
    const categoryModel = Gtk.StringList.new(categoryLabels);
    this._categoryRow = new Adw.ComboRow({
      title: _("Category"),
      model: categoryModel,
    });

    // Pre-select "other" category
    const otherIndex = this._categories.findIndex((c) => c.id === "other");
    if (otherIndex >= 0) {
      this._categoryRow.set_selected(otherIndex);
    }

    categoryGroup.add(this._categoryRow);
    preferencesPage.add(categoryGroup);

    // Group 4: Tags ---------------------------------------------------------
    const tagsGroup = new Adw.PreferencesGroup({
      title: _("Tags"),
    });

    this._tagsRow = new Adw.EntryRow({
      title: _("Tags"),
    });
    this._tagsRow.set_text("");
    (this._tagsRow as Adw.EntryRow & { set_placeholder_text?: (t: string) => void }).set_placeholder_text?.(_("tag1, tag2, ..."));
    tagsGroup.add(this._tagsRow);

    preferencesPage.add(tagsGroup);

    // -- Assemble with ToolbarView ------------------------------------------
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(preferencesPage);

    this.set_child(toolbarView);
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private _validate(): void {
    const title = this._titleRow.get_text().trim();
    this._saveButton.set_sensitive(title.length > 0);
  }

  // -------------------------------------------------------------------------
  // Save handler
  // -------------------------------------------------------------------------

  private _onSave(): void {
    const title = this._titleRow.get_text().trim();

    // Get textview content
    const buffer = this._textView.get_buffer();
    const start = buffer.get_start_iter();
    const end = buffer.get_end_iter();
    const text = buffer.get_text(start, end, false);

    // Get selected category ID
    const selectedIndex = this._categoryRow.get_selected();
    const category = this._categories[selectedIndex]?.id ?? "other";

    // Parse tags
    const tagsText = this._tagsRow.get_text().trim();
    const tags = tagsText.length > 0
      ? tagsText.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
      : [];

    this.onSave?.(title, text, category, tags);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const NoteEditorDialog = GObject.registerClass(
  { GTypeName: "NoteEditorDialog" },
  _NoteEditorDialog,
);

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Creates and presents a note editor dialog.
 */
export function showNoteEditor(
  parent: Gtk.Window | null,
  categories: CategoryDef[],
  onSave: (
    title: string,
    text: string,
    category: string,
    tags: string[],
  ) => void,
  existingTitle?: string,
  existingText?: string,
): void {
  const dialog = new NoteEditorDialog(
    categories,
    existingTitle,
    existingText,
  );
  dialog.onSave = onSave;

  if (parent) {
    dialog.present(parent);
  }
}
