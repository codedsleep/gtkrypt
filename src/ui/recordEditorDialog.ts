/**
 * Record editor dialog for gtkrypt vault items.
 *
 * Provides a template picker to choose a document template, and a record
 * editor dialog for creating or editing structured records with typed fields.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import type { DocumentTemplate, TemplateField } from "../models/templates.js";
import { BUILTIN_TEMPLATES } from "../models/templates.js";
import type { CategoryDef } from "../models/types.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Template picker
// ---------------------------------------------------------------------------

/**
 * Shows a dialog that lets the user pick a document template.
 * Calls `onSelect` with the chosen template and closes.
 */
export function showTemplatePicker(
  parent: Gtk.Window | null,
  onSelect: (template: DocumentTemplate) => void,
): void {
  const dialog = new Adw.Dialog();
  dialog.set_content_width(440);
  dialog.set_title(_("Choose Template"));

  const headerBar = new Adw.HeaderBar();
  headerBar.set_show_end_title_buttons(false);
  headerBar.set_show_start_title_buttons(false);

  const cancelButton = new Gtk.Button({ label: _("Cancel") });
  cancelButton.update_property(
    [Gtk.AccessibleProperty.LABEL],
    [_("Cancel template selection")],
  );
  cancelButton.connect("clicked", () => dialog.close());
  headerBar.pack_start(cancelButton);

  const preferencesPage = new Adw.PreferencesPage();

  const group = new Adw.PreferencesGroup();

  const listBox = new Gtk.ListBox();
  listBox.add_css_class("boxed-list");
  listBox.set_selection_mode(Gtk.SelectionMode.NONE);

  for (const template of BUILTIN_TEMPLATES) {
    const row = new Adw.ActionRow({
      title: template.name,
      subtitle: _("%d fields").replace("%d", String(template.fields.length)),
      activatable: true,
    });

    const icon = new Gtk.Image({ icon_name: template.icon });
    row.add_prefix(icon);

    row.connect("activated", () => {
      dialog.close();
      onSelect(template);
    });

    listBox.append(row);
  }

  group.add(listBox);
  preferencesPage.add(group);

  const toolbarView = new Adw.ToolbarView();
  toolbarView.add_top_bar(headerBar);
  toolbarView.set_content(preferencesPage);

  dialog.set_child(toolbarView);

  if (parent) {
    dialog.present(parent);
  }
}

// ---------------------------------------------------------------------------
// Record editor dialog implementation
// ---------------------------------------------------------------------------

class _RecordEditorDialog extends Adw.Dialog {
  /** Called when the user saves the record. */
  public onSave?: (
    name: string,
    fields: Record<string, string>,
    category: string,
    tags: string[],
  ) => void;

  // -- Widget references ----------------------------------------------------
  private _nameRow!: Adw.EntryRow;
  private _saveButton!: Gtk.Button;
  private _categoryRow!: Adw.ComboRow;
  private _tagsRow!: Adw.EntryRow;

  private _template: DocumentTemplate;
  private _categories: CategoryDef[];
  private _fieldWidgets: Map<string, Adw.EntryRow | Gtk.TextView> = new Map();
  private _requiredKeys: Set<string>;

  constructor(
    template: DocumentTemplate,
    categories: CategoryDef[],
    existingFields?: Record<string, string>,
    existingName?: string,
  ) {
    super();
    this._template = template;
    this._categories = categories;
    this._requiredKeys = new Set(
      template.fields.filter((f) => f.required).map((f) => f.key),
    );

    this.set_content_width(500);
    this.set_title(existingFields ? _("Edit Record") : template.name);

    this._buildUi(existingFields, existingName);
    this._validate();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(
    existingFields?: Record<string, string>,
    existingName?: string,
  ): void {
    // -- Header bar ---------------------------------------------------------
    const headerBar = new Adw.HeaderBar();
    headerBar.set_show_end_title_buttons(false);
    headerBar.set_show_start_title_buttons(false);

    const cancelButton = new Gtk.Button({ label: _("Cancel") });
    cancelButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Cancel record editing")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._saveButton = new Gtk.Button({ label: _("Save") });
    this._saveButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Save record")],
    );
    this._saveButton.add_css_class("suggested-action");
    this._saveButton.set_sensitive(false);
    this._saveButton.connect("clicked", () => this._onSave());
    headerBar.pack_end(this._saveButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: Record Name --------------------------------------------------
    const nameGroup = new Adw.PreferencesGroup({
      title: _("Record Name"),
    });

    this._nameRow = new Adw.EntryRow({
      title: _("Name"),
    });
    const defaultName =
      existingName ??
      this._template.name + " " + new Date().toLocaleDateString();
    this._nameRow.set_text(defaultName);
    this._nameRow.connect("changed", () => this._validate());
    nameGroup.add(this._nameRow);

    preferencesPage.add(nameGroup);

    // Group 2: Template Fields ----------------------------------------------
    const fieldsGroup = new Adw.PreferencesGroup({
      title: this._template.name + " " + _("Fields"),
    });

    for (const field of this._template.fields) {
      this._addField(fieldsGroup, preferencesPage, field, existingFields);
    }

    preferencesPage.add(fieldsGroup);

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

    // Pre-select matching category
    const targetCategory = this._template.category;
    const categoryIndex = this._categories.findIndex(
      (c) => c.id === targetCategory,
    );
    if (categoryIndex >= 0) {
      this._categoryRow.set_selected(categoryIndex);
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

  private _addField(
    fieldsGroup: Adw.PreferencesGroup,
    preferencesPage: Adw.PreferencesPage,
    field: TemplateField,
    existingFields?: Record<string, string>,
  ): void {
    const existingValue = existingFields?.[field.key] ?? "";

    if (field.type === "multiline") {
      // Multiline fields get their own group with a frame + textview
      const multiGroup = new Adw.PreferencesGroup({
        title: field.label,
      });

      const frame = new Gtk.Frame();
      const textView = new Gtk.TextView();
      textView.set_wrap_mode(Gtk.WrapMode.WORD_CHAR);
      textView.set_top_margin(8);
      textView.set_bottom_margin(8);
      textView.set_left_margin(8);
      textView.set_right_margin(8);
      textView.get_style_context().add_class("card");
      textView.set_size_request(-1, 80);

      if (existingValue) {
        textView.get_buffer().set_text(existingValue, -1);
      }

      textView.get_buffer().connect("changed", () => this._validate());

      frame.set_child(textView);
      multiGroup.add(frame);

      // Add multiline group after the main fields group
      preferencesPage.add(multiGroup);

      this._fieldWidgets.set(field.key, textView);
    } else {
      const row = new Adw.EntryRow({
        title: field.label,
      });

      if (field.placeholder) {
        (row as Adw.EntryRow & { set_placeholder_text?: (t: string) => void }).set_placeholder_text?.(field.placeholder);
      }

      if (field.type === "number") {
        row.set_input_purpose(Gtk.InputPurpose.NUMBER);
      }

      if (field.type === "date" && !field.placeholder) {
        (row as Adw.EntryRow & { set_placeholder_text?: (t: string) => void }).set_placeholder_text?.(_("YYYY-MM-DD"));
      }

      if (existingValue) {
        row.set_text(existingValue);
      }

      row.connect("changed", () => this._validate());
      fieldsGroup.add(row);

      this._fieldWidgets.set(field.key, row);
    }
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private _validate(): void {
    const name = this._nameRow.get_text().trim();
    if (name.length === 0) {
      this._saveButton.set_sensitive(false);
      return;
    }

    // Check all required fields are non-empty
    for (const key of this._requiredKeys) {
      const widget = this._fieldWidgets.get(key);
      if (!widget) {
        this._saveButton.set_sensitive(false);
        return;
      }

      if (widget instanceof Gtk.TextView) {
        const buffer = widget.get_buffer();
        const start = buffer.get_start_iter();
        const end = buffer.get_end_iter();
        const text = buffer.get_text(start, end, false);
        if (text.trim().length === 0) {
          this._saveButton.set_sensitive(false);
          return;
        }
      } else {
        // Adw.EntryRow
        if ((widget as Adw.EntryRow).get_text().trim().length === 0) {
          this._saveButton.set_sensitive(false);
          return;
        }
      }
    }

    this._saveButton.set_sensitive(true);
  }

  // -------------------------------------------------------------------------
  // Save handler
  // -------------------------------------------------------------------------

  private _onSave(): void {
    const name = this._nameRow.get_text().trim();

    // Collect field values
    const fields: Record<string, string> = {};
    for (const field of this._template.fields) {
      const widget = this._fieldWidgets.get(field.key);
      if (!widget) continue;

      if (widget instanceof Gtk.TextView) {
        const buffer = widget.get_buffer();
        const start = buffer.get_start_iter();
        const end = buffer.get_end_iter();
        fields[field.key] = buffer.get_text(start, end, false);
      } else {
        fields[field.key] = (widget as Adw.EntryRow).get_text();
      }
    }

    // Get selected category ID
    const selectedIndex = this._categoryRow.get_selected();
    const category = this._categories[selectedIndex]?.id ?? "other";

    // Parse tags
    const tagsText = this._tagsRow.get_text().trim();
    const tags = tagsText.length > 0
      ? tagsText.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
      : [];

    this.onSave?.(name, fields, category, tags);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const RecordEditorDialog = GObject.registerClass(
  { GTypeName: "RecordEditorDialog" },
  _RecordEditorDialog,
);

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Creates and presents a record editor dialog.
 */
export function showRecordEditor(
  parent: Gtk.Window | null,
  template: DocumentTemplate,
  categories: CategoryDef[],
  onSave: (
    name: string,
    fields: Record<string, string>,
    category: string,
    tags: string[],
  ) => void,
  existingFields?: Record<string, string>,
  existingName?: string,
): void {
  const dialog = new RecordEditorDialog(
    template,
    categories,
    existingFields,
    existingName,
  );
  dialog.onSave = onSave;

  if (parent) {
    dialog.present(parent);
  }
}
