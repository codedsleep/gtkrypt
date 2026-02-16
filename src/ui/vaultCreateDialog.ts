/**
 * Vault creation dialog for gtkrypt.
 *
 * Provides a modal dialog for creating a new vault with name, passphrase,
 * confirmation, strength indicator, and KDF preset selection.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Adw from "gi://Adw?version=1";

import type { KdfPreset } from "../models/types.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// KDF preset mapping
// ---------------------------------------------------------------------------

const kdfPresets: KdfPreset[] = ["balanced", "strong", "very-strong"];

// ---------------------------------------------------------------------------
// Vault name validation
// ---------------------------------------------------------------------------

/** Vault names may only contain alphanumeric characters, hyphens, and underscores. */
const VAULT_NAME_RE = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Vault creation dialog implementation
// ---------------------------------------------------------------------------

class _VaultCreateDialog extends Adw.Dialog {
  /** Called when the user confirms vault creation. */
  public onConfirm?: (
    name: string,
    passphrase: string,
    kdfPreset: KdfPreset,
    keyfilePath?: string,
  ) => void;

  // -- Widget references ----------------------------------------------------
  private _nameRow!: Adw.EntryRow;
  private _nameErrorLabel!: Gtk.Label;
  private _passphraseRow!: Adw.PasswordEntryRow;
  private _confirmRow!: Adw.PasswordEntryRow;
  private _strengthBar!: Gtk.LevelBar;
  private _mismatchLabel!: Gtk.Label;
  private _kdfRow!: Adw.ComboRow;
  private _createButton!: Gtk.Button;
  private _keyfileRow!: Adw.ActionRow;
  private _keyfileButton!: Gtk.Button;
  private _keyfileClearButton!: Gtk.Button;
  private _keyfileWarningLabel!: Gtk.Label;

  /** Selected keyfile path, or undefined if no keyfile is used. */
  private _keyfilePath?: string;

  /** Optional set of existing vault names to prevent duplicates. */
  private _existingNames: Set<string>;

  constructor(existingNames: string[] = []) {
    super();
    this._existingNames = new Set(existingNames);

    this.set_content_width(440);
    this.set_title(_("Create Vault"));

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
      [_("Cancel vault creation")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._createButton = new Gtk.Button({ label: _("Create") });
    this._createButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Create vault")],
    );
    this._createButton.add_css_class("suggested-action");
    this._createButton.set_sensitive(false);
    this._createButton.connect("clicked", () => this._onConfirm());
    headerBar.pack_end(this._createButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: Vault Name ---------------------------------------------------
    const nameGroup = new Adw.PreferencesGroup({
      title: _("Vault Name"),
    });

    this._nameRow = new Adw.EntryRow({
      title: _("Name"),
    });
    nameGroup.add(this._nameRow);

    this._nameErrorLabel = new Gtk.Label({
      label: "",
      visible: false,
    });
    this._nameErrorLabel.add_css_class("error");
    this._nameErrorLabel.add_css_class("caption");
    this._nameErrorLabel.set_margin_start(12);
    this._nameErrorLabel.set_margin_end(12);
    this._nameErrorLabel.set_margin_bottom(6);
    nameGroup.add(this._nameErrorLabel);

    preferencesPage.add(nameGroup);

    // Group 2: Passphrase ---------------------------------------------------
    const passphraseGroup = new Adw.PreferencesGroup({
      title: _("Passphrase"),
    });

    this._passphraseRow = new Adw.PasswordEntryRow({
      title: _("Passphrase"),
    });
    passphraseGroup.add(this._passphraseRow);

    this._confirmRow = new Adw.PasswordEntryRow({
      title: _("Confirm Passphrase"),
    });
    passphraseGroup.add(this._confirmRow);

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
    passphraseGroup.add(strengthRow);

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
    passphraseGroup.add(this._mismatchLabel);

    preferencesPage.add(passphraseGroup);

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

    // Group 4: Keyfile (optional) -------------------------------------------
    const keyfileGroup = new Adw.PreferencesGroup({
      title: _("Keyfile (optional)"),
    });

    this._keyfileRow = new Adw.ActionRow({
      title: _("Keyfile"),
      subtitle: _("None selected"),
    });
    this._keyfileRow.set_activatable(false);

    this._keyfileButton = new Gtk.Button({
      icon_name: "document-open-symbolic",
      valign: Gtk.Align.CENTER,
    });
    this._keyfileButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Select keyfile")],
    );
    this._keyfileButton.connect("clicked", () => this._openKeyfileChooser());
    this._keyfileRow.add_suffix(this._keyfileButton);

    this._keyfileClearButton = new Gtk.Button({
      icon_name: "edit-clear-symbolic",
      valign: Gtk.Align.CENTER,
      visible: false,
    });
    this._keyfileClearButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Remove keyfile")],
    );
    this._keyfileClearButton.add_css_class("flat");
    this._keyfileClearButton.connect("clicked", () => {
      this._keyfilePath = undefined;
      this._keyfileRow.set_subtitle(_("None selected"));
      this._keyfileClearButton.set_visible(false);
      this._keyfileWarningLabel.set_visible(false);
    });
    this._keyfileRow.add_suffix(this._keyfileClearButton);

    keyfileGroup.add(this._keyfileRow);

    this._keyfileWarningLabel = new Gtk.Label({
      label: _("You will need BOTH the passphrase and this keyfile to unlock the vault"),
      visible: false,
      wrap: true,
      xalign: 0,
    });
    this._keyfileWarningLabel.add_css_class("warning");
    this._keyfileWarningLabel.add_css_class("caption");
    this._keyfileWarningLabel.set_margin_start(12);
    this._keyfileWarningLabel.set_margin_end(12);
    this._keyfileWarningLabel.set_margin_bottom(6);
    keyfileGroup.add(this._keyfileWarningLabel);

    preferencesPage.add(keyfileGroup);

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

    this._passphraseRow.connect("changed", () => {
      this._updateStrength();
      this._validate();
    });

    this._confirmRow.connect("changed", () => this._validate());
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private _validate(): void {
    const name = this._nameRow.get_text().trim();
    const passphrase = this._passphraseRow.get_text();
    const confirm = this._confirmRow.get_text();

    // Validate name
    let nameValid = true;
    if (name.length === 0) {
      nameValid = false;
      this._nameErrorLabel.set_visible(false);
    } else if (!VAULT_NAME_RE.test(name)) {
      nameValid = false;
      this._nameErrorLabel.set_label(
        _("Only letters, numbers, hyphens, and underscores allowed"),
      );
      this._nameErrorLabel.set_visible(true);
    } else if (this._existingNames.has(name)) {
      nameValid = false;
      this._nameErrorLabel.set_label(_("A vault with this name already exists"));
      this._nameErrorLabel.set_visible(true);
    } else {
      this._nameErrorLabel.set_visible(false);
    }

    // Validate passphrase match
    const hasPassphrase = passphrase.length > 0;
    const confirmHasText = confirm.length > 0;
    const matches = passphrase === confirm;

    this._mismatchLabel.set_visible(confirmHasText && !matches);

    this._createButton.set_sensitive(
      nameValid && hasPassphrase && matches,
    );
  }

  private _updateStrength(): void {
    const length = this._passphraseRow.get_text().length;
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
    const name = this._nameRow.get_text().trim();
    const passphrase = this._passphraseRow.get_text();
    const kdfPreset = kdfPresets[this._kdfRow.get_selected()];

    this.onConfirm?.(name, passphrase, kdfPreset, this._keyfilePath);
    this.close();
  }

  // -------------------------------------------------------------------------
  // Keyfile chooser
  // -------------------------------------------------------------------------

  private _openKeyfileChooser(): void {
    const dialog = new Gtk.FileDialog();
    const parent = this.get_root() as Gtk.Window | null;

    dialog.open(parent, null, (_dialog, result) => {
      try {
        const file = dialog.open_finish(result);
        if (!file) return;
        const path = file.get_path();
        if (!path) return;

        this._keyfilePath = path;
        this._keyfileRow.set_subtitle(GLib.path_get_basename(path));
        this._keyfileClearButton.set_visible(true);
        this._keyfileWarningLabel.set_visible(true);
      } catch {
        // User cancelled the file dialog.
      }
    });
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const VaultCreateDialog = GObject.registerClass(
  { GTypeName: "VaultCreateDialog" },
  _VaultCreateDialog,
);
