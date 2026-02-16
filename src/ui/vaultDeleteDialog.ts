/**
 * Vault delete confirmation dialog for gtkrypt.
 *
 * Uses Adw.AlertDialog to require the user to type the vault name and
 * passphrase before confirming deletion, preventing accidental data loss.
 */

import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Adw from "gi://Adw?version=1";

import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Public convenience API
// ---------------------------------------------------------------------------

/**
 * Show a destructive confirmation dialog for deleting a vault.
 *
 * The user must type the vault name exactly and enter the passphrase
 * before the Delete button becomes enabled.
 *
 * @param parent          - The parent window to present the dialog over.
 * @param vaultName       - The name of the vault being deleted.
 * @param onConfirm       - Callback invoked with the passphrase and optional keyfilePath when confirmed.
 * @param requiresKeyfile - Whether the vault requires a keyfile for deletion.
 */
export function showDeleteDialog(
  parent: Gtk.Window,
  vaultName: string,
  onConfirm: (passphrase: string, keyfilePath?: string) => void,
  requiresKeyfile = false,
): void {
  const dialog = new Adw.AlertDialog({
    heading: _("Delete Vault?"),
    body: _("Type the vault name and passphrase to confirm deletion."),
  });

  dialog.add_response("cancel", _("Cancel"));
  dialog.add_response("delete", _("Delete"));
  dialog.set_default_response("cancel");
  dialog.set_response_appearance(
    "delete",
    Adw.ResponseAppearance.DESTRUCTIVE,
  );
  dialog.set_response_enabled("delete", false);

  // -- Extra child: name + passphrase entries -------------------------------
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
  });

  const listBox = new Gtk.ListBox({
    selection_mode: Gtk.SelectionMode.NONE,
  });
  listBox.add_css_class("boxed-list");

  const nameEntry = new Adw.EntryRow({
    title: _("Vault Name"),
  });
  nameEntry.update_property(
    [Gtk.AccessibleProperty.LABEL],
    [_("Type vault name to confirm deletion")],
  );
  listBox.append(nameEntry);

  const passphraseEntry = new Adw.PasswordEntryRow({
    title: _("Passphrase"),
  });
  listBox.append(passphraseEntry);

  // -- Keyfile state ---------------------------------------------------------
  let keyfilePath: string | undefined;

  // -- Validation -----------------------------------------------------------
  const validate = (): void => {
    const nameMatches = nameEntry.get_text() === vaultName;
    const hasPassphrase = passphraseEntry.get_text().length > 0;
    const hasKeyfile = !requiresKeyfile || keyfilePath !== undefined;
    dialog.set_response_enabled("delete", nameMatches && hasPassphrase && hasKeyfile);
  };

  nameEntry.connect("changed", () => validate());
  passphraseEntry.connect("changed", () => validate());

  // -- Keyfile picker (only when required) ----------------------------------
  if (requiresKeyfile) {
    const keyfileRow = new Adw.ActionRow({
      title: _("Keyfile"),
      subtitle: _("None selected"),
    });
    keyfileRow.set_activatable(false);

    const keyfileButton = new Gtk.Button({
      icon_name: "document-open-symbolic",
      valign: Gtk.Align.CENTER,
    });
    keyfileButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Select keyfile")],
    );
    keyfileRow.add_suffix(keyfileButton);

    const keyfileClearButton = new Gtk.Button({
      icon_name: "edit-clear-symbolic",
      valign: Gtk.Align.CENTER,
      visible: false,
    });
    keyfileClearButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Remove keyfile")],
    );
    keyfileClearButton.add_css_class("flat");
    keyfileRow.add_suffix(keyfileClearButton);

    listBox.append(keyfileRow);

    const keyfileHintLabel = new Gtk.Label({
      label: _("This vault requires a keyfile to delete."),
      visible: true,
      wrap: true,
      xalign: 0,
    });
    keyfileHintLabel.add_css_class("warning");
    keyfileHintLabel.add_css_class("caption");
    keyfileHintLabel.set_margin_start(12);
    keyfileHintLabel.set_margin_end(12);
    keyfileHintLabel.set_margin_top(6);
    box.append(keyfileHintLabel);

    // File chooser handler
    keyfileButton.connect("clicked", () => {
      const fileDialog = new Gtk.FileDialog();
      fileDialog.open(parent, null, (_dialog, result) => {
        try {
          const file = fileDialog.open_finish(result);
          if (!file) return;
          const path = file.get_path();
          if (!path) return;

          keyfilePath = path;
          keyfileRow.set_subtitle(GLib.path_get_basename(path));
          keyfileClearButton.set_visible(true);
          validate();
        } catch {
          // User cancelled the file dialog.
        }
      });
    });

    // Clear handler
    keyfileClearButton.connect("clicked", () => {
      keyfilePath = undefined;
      keyfileRow.set_subtitle(_("None selected"));
      keyfileClearButton.set_visible(false);
      validate();
    });
  }

  box.append(listBox);
  dialog.set_extra_child(box);

  // -- Response handler -----------------------------------------------------
  dialog.connect("response", (_dialog: Adw.AlertDialog, response: string) => {
    if (response === "delete") {
      onConfirm(passphraseEntry.get_text(), keyfilePath);
    }
  });

  dialog.present(parent);
}
