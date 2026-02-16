/**
 * Change passphrase dialog for gtkrypt.
 *
 * Provides a modal dialog for changing a vault's passphrase with
 * current passphrase verification, new passphrase confirmation,
 * strength indicator, and KDF preset selection.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import type { KdfPreset } from "../models/types.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// KDF preset mapping
// ---------------------------------------------------------------------------

const kdfPresets: KdfPreset[] = ["balanced", "strong", "very-strong"];

// ---------------------------------------------------------------------------
// Change passphrase dialog implementation
// ---------------------------------------------------------------------------

class _ChangePassphraseDialog extends Adw.Dialog {
  /** Called when the user confirms the passphrase change. */
  public onConfirm?: (
    currentPassphrase: string,
    newPassphrase: string,
    kdfPreset: KdfPreset,
  ) => void;

  // -- Widget references ----------------------------------------------------
  private _currentRow!: Adw.PasswordEntryRow;
  private _newRow!: Adw.PasswordEntryRow;
  private _confirmRow!: Adw.PasswordEntryRow;
  private _strengthBar!: Gtk.LevelBar;
  private _mismatchLabel!: Gtk.Label;
  private _kdfRow!: Adw.ComboRow;
  private _changeButton!: Gtk.Button;

  constructor() {
    super();

    this.set_content_width(440);
    this.set_title(_("Change Passphrase"));

    this._buildUi();
    this._connectSignals();
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
      [_("Cancel passphrase change")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._changeButton = new Gtk.Button({ label: _("Change") });
    this._changeButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Change vault passphrase")],
    );
    this._changeButton.add_css_class("suggested-action");
    this._changeButton.set_sensitive(false);
    this._changeButton.connect("clicked", () => this._onConfirm());
    headerBar.pack_end(this._changeButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: Current Passphrase -------------------------------------------
    const currentGroup = new Adw.PreferencesGroup({
      title: _("Current Passphrase"),
    });

    this._currentRow = new Adw.PasswordEntryRow({
      title: _("Current Passphrase"),
    });
    currentGroup.add(this._currentRow);

    preferencesPage.add(currentGroup);

    // Group 2: New Passphrase -----------------------------------------------
    const newGroup = new Adw.PreferencesGroup({
      title: _("New Passphrase"),
    });

    this._newRow = new Adw.PasswordEntryRow({
      title: _("New Passphrase"),
    });
    newGroup.add(this._newRow);

    this._confirmRow = new Adw.PasswordEntryRow({
      title: _("Confirm New Passphrase"),
    });
    newGroup.add(this._confirmRow);

    // Strength indicator
    this._strengthBar = new Gtk.LevelBar();
    this._strengthBar.update_property(
      [Gtk.AccessibleProperty.DESCRIPTION],
      [_("Passphrase strength indicator")],
    );
    this._strengthBar.set_min_value(0);
    this._strengthBar.set_max_value(1);
    this._strengthBar.set_value(0);
    this._strengthBar.set_hexpand(true);
    this._strengthBar.set_valign(Gtk.Align.CENTER);
    const strengthRow = new Adw.ActionRow({
      title: _("Strength"),
    });
    strengthRow.set_activatable(false);
    strengthRow.add_suffix(this._strengthBar);
    newGroup.add(strengthRow);

    // Mismatch label
    this._mismatchLabel = new Gtk.Label({
      label: _("Passphrases don't match"),
      visible: false,
    });
    this._mismatchLabel.add_css_class("error");
    this._mismatchLabel.add_css_class("caption");
    this._mismatchLabel.set_margin_start(12);
    this._mismatchLabel.set_margin_end(12);
    this._mismatchLabel.set_margin_bottom(6);
    newGroup.add(this._mismatchLabel);

    preferencesPage.add(newGroup);

    // Group 3: KDF Preset ---------------------------------------------------
    const kdfGroup = new Adw.PreferencesGroup({
      title: _("Security"),
    });

    const model = Gtk.StringList.new([
      _("Balanced"),
      _("Strong"),
      _("Very Strong"),
    ]);
    this._kdfRow = new Adw.ComboRow({
      title: _("Key derivation strength"),
      subtitle: _("Higher values are slower but more secure"),
      model: model,
    });
    kdfGroup.add(this._kdfRow);

    preferencesPage.add(kdfGroup);

    // Group 4: Warning ------------------------------------------------------
    const warningGroup = new Adw.PreferencesGroup();

    const warningLabel = new Gtk.Label({
      label: _("This will re-encrypt all items in the vault. This may take a while for large vaults."),
      wrap: true,
      xalign: 0,
    });
    warningLabel.add_css_class("dim-label");
    warningLabel.add_css_class("caption");
    warningLabel.set_margin_start(12);
    warningLabel.set_margin_end(12);
    warningGroup.add(warningLabel);

    preferencesPage.add(warningGroup);

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
    this._currentRow.connect("changed", () => this._validate());

    this._newRow.connect("changed", () => {
      this._updateStrength();
      this._validate();
    });

    this._confirmRow.connect("changed", () => this._validate());
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private _validate(): void {
    const current = this._currentRow.get_text();
    const newPass = this._newRow.get_text();
    const confirm = this._confirmRow.get_text();

    const hasCurrent = current.length > 0;
    const hasNew = newPass.length > 0;
    const confirmHasText = confirm.length > 0;
    const matches = newPass === confirm;

    this._mismatchLabel.set_visible(confirmHasText && !matches);

    this._changeButton.set_sensitive(hasCurrent && hasNew && matches);
  }

  private _updateStrength(): void {
    const length = this._newRow.get_text().length;
    let fraction: number;

    if (length === 0) {
      fraction = 0;
    } else if (length < 8) {
      fraction = 0.25;
    } else if (length < 12) {
      fraction = 0.5;
    } else if (length < 16) {
      fraction = 0.75;
    } else {
      fraction = 1.0;
    }

    this._strengthBar.set_value(fraction);
  }

  // -------------------------------------------------------------------------
  // Confirm handler
  // -------------------------------------------------------------------------

  private _onConfirm(): void {
    const currentPassphrase = this._currentRow.get_text();
    const newPassphrase = this._newRow.get_text();
    const kdfPreset = kdfPresets[this._kdfRow.get_selected()];

    this.onConfirm?.(currentPassphrase, newPassphrase, kdfPreset);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const ChangePassphraseDialog = GObject.registerClass(
  { GTypeName: "ChangePassphraseDialog" },
  _ChangePassphraseDialog,
);

// ---------------------------------------------------------------------------
// Public convenience API
// ---------------------------------------------------------------------------

/**
 * Show the change passphrase dialog modally over the given parent window.
 *
 * @param parent - The parent window to present the dialog over.
 * @param onConfirm - Callback invoked with the current passphrase,
 *                    new passphrase, and KDF preset.
 */
export function showChangePassphraseDialog(
  parent: Gtk.Window,
  onConfirm: (
    currentPassphrase: string,
    newPassphrase: string,
    kdfPreset: KdfPreset,
  ) => void,
): void {
  const dialog = new ChangePassphraseDialog();
  dialog.onConfirm = onConfirm;
  dialog.present(parent);
}
