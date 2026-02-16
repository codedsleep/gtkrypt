/**
 * Vault unlock dialog for gtkrypt.
 *
 * Provides a modal dialog for entering a passphrase to unlock a vault.
 * Includes error display for wrong passphrase feedback.
 * When the vault requires a keyfile, shows a keyfile picker.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Adw from "gi://Adw?version=1";

import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Vault unlock dialog implementation
// ---------------------------------------------------------------------------

class _VaultUnlockDialog extends Adw.Dialog {
  /** Callback invoked when the user confirms the unlock. */
  public onUnlock?: (passphrase: string, keyfilePath?: string) => void;

  // -- Widget references ----------------------------------------------------
  private _passphraseRow!: Adw.PasswordEntryRow;
  private _errorLabel!: Gtk.Label;
  private _unlockButton!: Gtk.Button;

  // Keyfile UI (only created when requiresKeyfile is true)
  private _keyfileRow: Adw.ActionRow | null = null;
  private _keyfileButton: Gtk.Button | null = null;
  private _keyfileClearButton: Gtk.Button | null = null;
  private _keyfileHintLabel: Gtk.Label | null = null;

  /** Whether this vault requires a keyfile. */
  private _requiresKeyfile: boolean;

  /** Selected keyfile path, or undefined if none selected. */
  private _keyfilePath?: string;

  constructor(vaultName: string, requiresKeyfile = false) {
    super();
    this._requiresKeyfile = requiresKeyfile;

    this.set_content_width(440);
    this.set_title(_("Unlock %s").replace("%s", vaultName));

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
      [_("Cancel unlock dialog")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._unlockButton = new Gtk.Button({ label: _("Unlock") });
    this._unlockButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Unlock vault")],
    );
    this._unlockButton.add_css_class("suggested-action");
    this._unlockButton.set_sensitive(false);
    this._unlockButton.connect("clicked", () => this._onConfirm());
    headerBar.pack_end(this._unlockButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    const group = new Adw.PreferencesGroup({
      title: _("Passphrase"),
    });

    this._passphraseRow = new Adw.PasswordEntryRow({
      title: _("Passphrase"),
    });
    group.add(this._passphraseRow);

    // Error label (initially hidden)
    this._errorLabel = new Gtk.Label({
      label: "",
      visible: false,
    });
    this._errorLabel.add_css_class("error");
    this._errorLabel.add_css_class("caption");
    this._errorLabel.set_margin_start(12);
    this._errorLabel.set_margin_end(12);
    this._errorLabel.set_margin_bottom(6);
    group.add(this._errorLabel);

    preferencesPage.add(group);

    // -- Keyfile group (only when required) ----------------------------------
    if (this._requiresKeyfile) {
      const keyfileGroup = new Adw.PreferencesGroup({
        title: _("Keyfile"),
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
        this._keyfileRow!.set_subtitle(_("None selected"));
        this._keyfileClearButton!.set_visible(false);
        this._validate();
      });
      this._keyfileRow.add_suffix(this._keyfileClearButton);

      keyfileGroup.add(this._keyfileRow);

      this._keyfileHintLabel = new Gtk.Label({
        label: _("This vault requires a keyfile. Select the keyfile used when creating this vault."),
        visible: true,
        wrap: true,
        xalign: 0,
      });
      this._keyfileHintLabel.add_css_class("warning");
      this._keyfileHintLabel.add_css_class("caption");
      this._keyfileHintLabel.set_margin_start(12);
      this._keyfileHintLabel.set_margin_end(12);
      this._keyfileHintLabel.set_margin_bottom(6);
      keyfileGroup.add(this._keyfileHintLabel);

      preferencesPage.add(keyfileGroup);
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
      // Hide error when user starts typing again
      this._errorLabel.set_visible(false);
      this._validate();
    });
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private _validate(): void {
    const hasPassphrase = this._passphraseRow.get_text().length > 0;
    const hasKeyfile = !this._requiresKeyfile || this._keyfilePath !== undefined;
    this._unlockButton.set_sensitive(hasPassphrase && hasKeyfile);
  }

  // -------------------------------------------------------------------------
  // Error display
  // -------------------------------------------------------------------------

  /** Show an error message (e.g. wrong passphrase) and keep the dialog open. */
  public showError(message: string): void {
    this._errorLabel.set_label(message);
    this._errorLabel.set_visible(true);
  }

  // -------------------------------------------------------------------------
  // Confirm handler
  // -------------------------------------------------------------------------

  private _onConfirm(): void {
    const passphrase = this._passphraseRow.get_text();
    this.onUnlock?.(passphrase, this._keyfilePath);
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
        this._keyfileRow!.set_subtitle(GLib.path_get_basename(path));
        this._keyfileClearButton!.set_visible(true);
        this._validate();
      } catch {
        // User cancelled the file dialog.
      }
    });
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const VaultUnlockDialog = GObject.registerClass(
  { GTypeName: "VaultUnlockDialog" },
  _VaultUnlockDialog,
);

// ---------------------------------------------------------------------------
// Public convenience API
// ---------------------------------------------------------------------------

/**
 * Show the vault unlock dialog modally over the given parent window.
 *
 * @param parent          - The parent window to present the dialog over.
 * @param vaultName       - The name of the vault being unlocked.
 * @param onUnlock        - Callback invoked with the entered passphrase and optional keyfilePath.
 * @param requiresKeyfile - Whether the vault requires a keyfile.
 * @returns The dialog instance, so the caller can call `showError()` if
 *          the unlock attempt fails.
 */
export function showUnlockDialog(
  parent: Gtk.Window,
  vaultName: string,
  onUnlock: (passphrase: string, keyfilePath?: string) => void,
  requiresKeyfile = false,
): InstanceType<typeof VaultUnlockDialog> {
  const dialog = new VaultUnlockDialog(vaultName, requiresKeyfile);
  dialog.onUnlock = onUnlock;
  dialog.present(parent);
  return dialog;
}
