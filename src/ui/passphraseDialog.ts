/**
 * Passphrase dialog for gtkrypt.
 *
 * Provides a modal dialog for entering a passphrase before encrypt/decrypt
 * operations. Includes strength indicator, confirmation matching, advanced
 * options (encrypt mode), and optional session passphrase memory.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import type {
  EncryptOptions,
  DecryptOptions,
  KdfPreset,
} from "../models/types.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Session passphrase memory (Task 4.7)
// ---------------------------------------------------------------------------

let _sessionPassphrase: string | null = null;

/** Store a passphrase in memory for the duration of the session. */
export function setSessionPassphrase(passphrase: string): void {
  _sessionPassphrase = passphrase;
}

/** Retrieve the session passphrase, or null if none is stored. */
export function getSessionPassphrase(): string | null {
  return _sessionPassphrase;
}

/** Clear the stored session passphrase. */
export function clearSessionPassphrase(): void {
  _sessionPassphrase = null;
}

// ---------------------------------------------------------------------------
// KDF preset mapping
// ---------------------------------------------------------------------------

const kdfPresets: KdfPreset[] = ["balanced", "strong", "very-strong"];

// ---------------------------------------------------------------------------
// Passphrase dialog implementation
// ---------------------------------------------------------------------------

class _PassphraseDialog extends Adw.Dialog {
  /** Whether the dialog is for encryption or decryption. */
  private _mode: "encrypt" | "decrypt";

  /** Callback invoked when the user confirms the dialog. */
  public onConfirm?: (
    passphrase: string,
    options: EncryptOptions | DecryptOptions,
    remember: boolean,
  ) => void;

  // -- Widget references ----------------------------------------------------
  private _passphraseRow!: Adw.PasswordEntryRow;
  private _confirmRow!: Adw.PasswordEntryRow;
  private _strengthBar!: Gtk.LevelBar;
  private _mismatchLabel!: Gtk.Label;
  private _rememberSwitch!: Adw.SwitchRow;
  private _confirmButton!: Gtk.Button;

  // Encrypt-only widgets
  private _storeFilenameSwitch!: Adw.SwitchRow;
  private _wipeOriginalSwitch!: Adw.SwitchRow;
  private _kdfRow!: Adw.ComboRow;

  // Output location widgets (both modes)
  private _outputDirRow!: Adw.ActionRow;
  private _outputDir: string | null = null;
  private _clearOutputButton!: Gtk.Button;

  // Decrypt-only widgets
  private _useStoredFilenameSwitch!: Adw.SwitchRow;

  constructor(mode: "encrypt" | "decrypt") {
    super();
    this._mode = mode;

    this.set_content_width(440);
    this.set_title(_("Enter Passphrase"));

    this._buildUi();
    this._connectSignals();
    this._prefillFromSession();
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
    cancelButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Cancel passphrase dialog")]);
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._confirmButton = new Gtk.Button({
      label: this._mode === "encrypt" ? _("Encrypt") : _("Decrypt"),
    });
    this._confirmButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Confirm passphrase")]);
    this._confirmButton.add_css_class("suggested-action");
    this._confirmButton.set_sensitive(false);
    this._confirmButton.connect("clicked", () => this._onConfirm());
    headerBar.pack_end(this._confirmButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: Passphrase ---------------------------------------------------
    const passphraseGroup = new Adw.PreferencesGroup({
      title: _("Passphrase"),
    });

    this._passphraseRow = new Adw.PasswordEntryRow({
      title: _("Passphrase"),
    });
    passphraseGroup.add(this._passphraseRow);

    // Confirmation row (encrypt mode only)
    this._confirmRow = new Adw.PasswordEntryRow({
      title: _("Confirm Passphrase"),
    });
    if (this._mode === "encrypt") {
      passphraseGroup.add(this._confirmRow);
    }

    // Strength indicator
    this._strengthBar = new Gtk.LevelBar();
    this._strengthBar.update_property([Gtk.AccessibleProperty.DESCRIPTION], [_("Passphrase strength indicator")]);
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

    // Mismatch label (encrypt mode only)
    this._mismatchLabel = new Gtk.Label({
      label: _("Passphrases don't match"),
      visible: false,
    });
    this._mismatchLabel.add_css_class("error");
    this._mismatchLabel.add_css_class("caption");
    this._mismatchLabel.set_margin_start(12);
    this._mismatchLabel.set_margin_end(12);
    this._mismatchLabel.set_margin_bottom(6);
    if (this._mode === "encrypt") {
      passphraseGroup.add(this._mismatchLabel);
    }

    // Remember switch
    this._rememberSwitch = new Adw.SwitchRow({
      title: _("Remember for this session"),
      subtitle: _("Passphrase will be kept in memory until the app closes"),
    });
    this._rememberSwitch.update_property([Gtk.AccessibleProperty.LABEL], [_("Remember passphrase for this session")]);
    passphraseGroup.add(this._rememberSwitch);

    preferencesPage.add(passphraseGroup);

    // Group 2: Output Location (both modes) ---------------------------------
    const outputGroup = new Adw.PreferencesGroup({
      title: _("Output"),
    });

    this._outputDirRow = new Adw.ActionRow({
      title: _("Output location"),
      subtitle: _("Same as input file"),
    });
    this._outputDirRow.set_activatable(false);

    const folderButton = new Gtk.Button({
      icon_name: "folder-open-symbolic",
      valign: Gtk.Align.CENTER,
    });
    folderButton.add_css_class("flat");
    folderButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Choose output folder")]);
    folderButton.connect("clicked", () => this._pickOutputDir());
    this._outputDirRow.add_suffix(folderButton);

    this._clearOutputButton = new Gtk.Button({
      icon_name: "edit-clear-symbolic",
      valign: Gtk.Align.CENTER,
    });
    this._clearOutputButton.add_css_class("flat");
    this._clearOutputButton.set_sensitive(false);
    this._clearOutputButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Reset output location")]);
    this._clearOutputButton.connect("clicked", () => {
      this._outputDir = null;
      this._outputDirRow.set_subtitle(_("Same as input file"));
      this._clearOutputButton.set_sensitive(false);
    });
    this._outputDirRow.add_suffix(this._clearOutputButton);

    outputGroup.add(this._outputDirRow);
    preferencesPage.add(outputGroup);

    // Group 3: Decrypt Options (decrypt mode only) --------------------------
    if (this._mode === "decrypt") {
      const decryptGroup = new Adw.PreferencesGroup({
        title: _("Options"),
      });

      this._useStoredFilenameSwitch = new Adw.SwitchRow({
        title: _("Use original filename"),
        subtitle: _("Restore the filename stored during encryption"),
        active: true,
      });
      decryptGroup.add(this._useStoredFilenameSwitch);
      preferencesPage.add(decryptGroup);
    }

    // Group 4: Advanced Options (encrypt mode only) -------------------------
    if (this._mode === "encrypt") {
      const advancedGroup = new Adw.PreferencesGroup({
        title: _("Advanced"),
      });

      const expanderRow = new Adw.ExpanderRow({
        title: _("Advanced Options"),
      });

      this._storeFilenameSwitch = new Adw.SwitchRow({
        title: _("Store original filename"),
        subtitle: _("Save the filename inside the encrypted file"),
        active: false,
      });
      expanderRow.add_row(this._storeFilenameSwitch);

      this._wipeOriginalSwitch = new Adw.SwitchRow({
        title: _("Delete original after encryption"),
        subtitle: _("Permanently delete the source file"),
        active: false,
      });
      expanderRow.add_row(this._wipeOriginalSwitch);

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
      expanderRow.add_row(this._kdfRow);

      advancedGroup.add(expanderRow);
      preferencesPage.add(advancedGroup);
    }

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
    this._passphraseRow.connect("changed", () => {
      this._updateStrength();
      this._validate();
    });

    if (this._mode === "encrypt") {
      this._confirmRow.connect("changed", () => {
        this._validate();
      });
    }
  }

  // -------------------------------------------------------------------------
  // Session pre-fill
  // -------------------------------------------------------------------------

  private _prefillFromSession(): void {
    if (_sessionPassphrase !== null) {
      this._passphraseRow.set_text(_sessionPassphrase);
      if (this._mode === "encrypt") {
        this._confirmRow.set_text(_sessionPassphrase);
      }
      this._rememberSwitch.set_active(true);
    }
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private _validate(): void {
    const passphrase = this._passphraseRow.get_text();
    const hasPassphrase = passphrase.length > 0;

    if (this._mode === "encrypt") {
      const confirm = this._confirmRow.get_text();
      const matches = passphrase === confirm;
      const confirmHasText = confirm.length > 0;

      // Show mismatch label only when both fields have text and they differ
      this._mismatchLabel.set_visible(confirmHasText && !matches);
      this._confirmButton.set_sensitive(hasPassphrase && matches);
    } else {
      this._confirmButton.set_sensitive(hasPassphrase);
    }
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
  // Folder picker
  // -------------------------------------------------------------------------

  private _pickOutputDir(): void {
    const dialog = new Gtk.FileDialog();
    const parent = this.get_root() as Gtk.Window | null;

    dialog.select_folder(parent, null, (_dialog, result) => {
      try {
        const folder = dialog.select_folder_finish(result);
        if (!folder) return;
        const path = folder.get_path();
        if (path) {
          this._outputDir = path;
          this._outputDirRow.set_subtitle(path);
          this._clearOutputButton.set_sensitive(true);
        }
      } catch {
        // User cancelled the folder picker — nothing to do.
      }
    });
  }

  // -------------------------------------------------------------------------
  // Confirm handler
  // -------------------------------------------------------------------------

  private _onConfirm(): void {
    const passphrase = this._passphraseRow.get_text();
    const remember = this._rememberSwitch.get_active();
    const outputDir = this._outputDir ?? undefined;

    if (this._mode === "encrypt") {
      const options: EncryptOptions = {
        outputDir,
        storeFilename: this._storeFilenameSwitch.get_active(),
        wipeOriginal: this._wipeOriginalSwitch.get_active(),
        kdfPreset: kdfPresets[this._kdfRow.get_selected()],
      };
      this.onConfirm?.(passphrase, options, remember);
    } else {
      const options: DecryptOptions = {
        outputDir,
        useStoredFilename: this._useStoredFilenameSwitch.get_active(),
      };
      this.onConfirm?.(passphrase, options, remember);
    }

    this.close();
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const PassphraseDialog = GObject.registerClass(
  { GTypeName: "PassphraseDialog" },
  _PassphraseDialog,
);

// ---------------------------------------------------------------------------
// Public convenience API
// ---------------------------------------------------------------------------

/**
 * Show the passphrase dialog modally over the given parent window.
 *
 * @param parent  - The parent window to present the dialog over.
 * @param mode    - Whether the dialog is for encrypting or decrypting.
 * @param onConfirm - Callback invoked with the passphrase, options, and
 *                    whether the user wants the passphrase remembered.
 */
export function showPassphraseDialog(
  parent: Gtk.Window,
  mode: "encrypt" | "decrypt",
  onConfirm: (
    passphrase: string,
    options: EncryptOptions | DecryptOptions,
    remember: boolean,
  ) => void,
): void {
  const dialog = new PassphraseDialog(mode);
  dialog.onConfirm = onConfirm;
  dialog.present(parent);
}
