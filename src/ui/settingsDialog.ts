/**
 * Vault settings dialog for gtkrypt.
 *
 * Provides a modal dialog for editing per-vault preferences including
 * auto-lock timeout, display options, category management, and
 * dangerous operations (passphrase change, vault deletion).
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import type { VaultSettings, CategoryDef, SortOrder, ViewMode } from "../models/types.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Option mappings
// ---------------------------------------------------------------------------

const sortOrders: SortOrder[] = ["name", "date", "category"];
const viewModes: ViewMode[] = ["grid", "list"];

// ---------------------------------------------------------------------------
// Settings dialog implementation
// ---------------------------------------------------------------------------

class _SettingsDialog extends Adw.Dialog {
  /** Callbacks for dialog actions. */
  public callbacks?: {
    onSave: (settings: VaultSettings) => void;
    onChangePassphrase: () => void;
    onDeleteVault: () => void;
    onManageCategories: () => void;
  };

  // -- Widget references ----------------------------------------------------
  private _autoLockRow!: Adw.SpinRow;
  private _viewModeRow!: Adw.ComboRow;
  private _sortOrderRow!: Adw.ComboRow;
  private _categoryRow!: Adw.ComboRow;
  private _saveButton!: Gtk.Button;

  /** Category definitions for mapping combo selection back to ID. */
  private _categories: CategoryDef[];

  constructor(settings: VaultSettings, categories: CategoryDef[]) {
    super();
    this._categories = categories;

    this.set_content_width(440);
    this.set_title(_("Vault Settings"));

    this._buildUi(settings, categories);
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(settings: VaultSettings, categories: CategoryDef[]): void {
    // -- Header bar ---------------------------------------------------------
    const headerBar = new Adw.HeaderBar();
    headerBar.set_show_end_title_buttons(false);
    headerBar.set_show_start_title_buttons(false);

    const cancelButton = new Gtk.Button({ label: _("Cancel") });
    cancelButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Cancel settings")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._saveButton = new Gtk.Button({ label: _("Save") });
    this._saveButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Save vault settings")],
    );
    this._saveButton.add_css_class("suggested-action");
    this._saveButton.connect("clicked", () => this._onSave());
    headerBar.pack_end(this._saveButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: Security -----------------------------------------------------
    const securityGroup = new Adw.PreferencesGroup({
      title: _("Security"),
    });

    const adjustment = new Gtk.Adjustment({
      lower: 0,
      upper: 60,
      step_increment: 1,
      page_increment: 5,
      value: settings.autoLockMinutes,
    });
    this._autoLockRow = new Adw.SpinRow({
      title: _("Auto-lock after"),
      subtitle: _("Lock vault after inactivity (0 = never)"),
      adjustment: adjustment,
    });
    this._autoLockRow.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Auto-lock timeout in minutes")],
    );
    securityGroup.add(this._autoLockRow);

    preferencesPage.add(securityGroup);

    // Group 2: Display ------------------------------------------------------
    const displayGroup = new Adw.PreferencesGroup({
      title: _("Display"),
    });

    // Default view mode
    const viewModeModel = Gtk.StringList.new([
      _("List"),
      _("Grid"),
    ]);
    this._viewModeRow = new Adw.ComboRow({
      title: _("Default view mode"),
      model: viewModeModel,
    });
    this._viewModeRow.set_selected(
      Math.max(0, viewModes.indexOf(settings.viewMode)),
    );
    displayGroup.add(this._viewModeRow);

    // Default sort order
    const sortOrderModel = Gtk.StringList.new([
      _("Name"),
      _("Date"),
      _("Category"),
    ]);
    this._sortOrderRow = new Adw.ComboRow({
      title: _("Default sort order"),
      model: sortOrderModel,
    });
    this._sortOrderRow.set_selected(
      Math.max(0, sortOrders.indexOf(settings.sortOrder)),
    );
    displayGroup.add(this._sortOrderRow);

    // Default category
    const categoryLabels = categories.map((c) => c.label);
    const categoryModel = Gtk.StringList.new(categoryLabels);
    this._categoryRow = new Adw.ComboRow({
      title: _("Default category"),
      model: categoryModel,
    });
    const categoryIndex = categories.findIndex(
      (c) => c.id === settings.defaultCategory,
    );
    this._categoryRow.set_selected(Math.max(0, categoryIndex));
    displayGroup.add(this._categoryRow);

    // Manage Categories button
    const manageCategoriesButton = new Gtk.Button({
      label: _("Manage Categories"),
      valign: Gtk.Align.CENTER,
    });
    manageCategoriesButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Manage vault categories")],
    );
    manageCategoriesButton.connect("clicked", () => {
      this.callbacks?.onManageCategories();
    });
    const manageCategoriesRow = new Adw.ActionRow({
      title: _("Categories"),
      subtitle: _("Add, edit, or remove categories"),
    });
    manageCategoriesRow.set_activatable(false);
    manageCategoriesRow.add_suffix(manageCategoriesButton);
    displayGroup.add(manageCategoriesRow);

    preferencesPage.add(displayGroup);

    // Group 3: Danger Zone --------------------------------------------------
    const dangerGroup = new Adw.PreferencesGroup({
      title: _("Danger Zone"),
    });

    // Change Passphrase
    const changePassphraseButton = new Gtk.Button({
      label: _("Change Vault Passphrase"),
      valign: Gtk.Align.CENTER,
    });
    changePassphraseButton.add_css_class("destructive-action");
    changePassphraseButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Change vault passphrase")],
    );
    changePassphraseButton.connect("clicked", () => {
      this.callbacks?.onChangePassphrase();
    });
    const changePassphraseRow = new Adw.ActionRow({
      title: _("Passphrase"),
      subtitle: _("Change the vault's encryption passphrase"),
    });
    changePassphraseRow.set_activatable(false);
    changePassphraseRow.add_suffix(changePassphraseButton);
    dangerGroup.add(changePassphraseRow);

    // Delete Vault
    const deleteVaultButton = new Gtk.Button({
      label: _("Delete This Vault"),
      valign: Gtk.Align.CENTER,
    });
    deleteVaultButton.add_css_class("destructive-action");
    deleteVaultButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Delete this vault permanently")],
    );
    deleteVaultButton.connect("clicked", () => {
      this.callbacks?.onDeleteVault();
    });
    const deleteVaultRow = new Adw.ActionRow({
      title: _("Delete"),
      subtitle: _("Permanently delete this vault and all its contents"),
    });
    deleteVaultRow.set_activatable(false);
    deleteVaultRow.add_suffix(deleteVaultButton);
    dangerGroup.add(deleteVaultRow);

    preferencesPage.add(dangerGroup);

    // -- Assemble with ToolbarView ------------------------------------------
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(preferencesPage);

    this.set_child(toolbarView);
  }

  // -------------------------------------------------------------------------
  // Save handler
  // -------------------------------------------------------------------------

  private _onSave(): void {
    const settings: VaultSettings = {
      autoLockMinutes: this._autoLockRow.get_value(),
      viewMode: viewModes[this._viewModeRow.get_selected()],
      sortOrder: sortOrders[this._sortOrderRow.get_selected()],
      defaultCategory:
        this._categories[this._categoryRow.get_selected()]?.id ?? "",
    };

    this.callbacks?.onSave(settings);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const SettingsDialog = GObject.registerClass(
  { GTypeName: "SettingsDialog" },
  _SettingsDialog,
);

// ---------------------------------------------------------------------------
// Public convenience API
// ---------------------------------------------------------------------------

/**
 * Show the vault settings dialog modally over the given parent window.
 *
 * @param parent     - The parent window to present the dialog over.
 * @param settings   - Current vault settings to populate the form.
 * @param categories - Available categories from the vault manifest.
 * @param callbacks  - Action callbacks for save, passphrase change, deletion,
 *                     and category management.
 */
export function showSettingsDialog(
  parent: Gtk.Window,
  settings: VaultSettings,
  categories: CategoryDef[],
  callbacks: {
    onSave: (settings: VaultSettings) => void;
    onChangePassphrase: () => void;
    onDeleteVault: () => void;
    onManageCategories: () => void;
  },
): void {
  const dialog = new SettingsDialog(settings, categories);
  dialog.callbacks = callbacks;
  dialog.present(parent);
}
