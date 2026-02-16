/**
 * Vault list view for gtkrypt.
 *
 * Displays all vaults as a list of action rows. Provides vault selection,
 * creation (via dialog), and deletion (via context menu). Shows an empty
 * state when no vaults exist.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk?version=4.0";
import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";

import type { KdfPreset } from "../models/types.js";
import { listVaultNames } from "../services/io.js";
import { _ } from "../util/i18n.js";
import { VaultCreateDialog } from "./vaultCreateDialog.js";
import { showDeleteDialog } from "./vaultDeleteDialog.js";
import { readVaultMetaByName } from "../services/vault.js";

const PAGE_MARGIN = 24;
const CONTENT_MAX_WIDTH = 720;

// ---------------------------------------------------------------------------
// Vault list view implementation
// ---------------------------------------------------------------------------

class _VaultListView extends Adw.NavigationPage {
  /** Called when the user selects a vault to unlock. */
  public onVaultSelected?: (name: string) => void;

  /** Called when the user creates a new vault from the dialog. */
  public onCreateVault?: (
    name: string,
    passphrase: string,
    kdfPreset: KdfPreset,
    keyfilePath?: string,
  ) => void;

  /** Called when the user confirms deletion of a vault (with passphrase). */
  public onDeleteVault?: (name: string, passphrase: string, keyfilePath?: string) => void;

  /** Called when the user wants to import/restore a vault from a backup. */
  public onImportVault?: (sourceDir: string) => void;

  // -- Widget references ----------------------------------------------------
  private _contentBox!: Gtk.Box;
  private _vaultGroup!: Adw.PreferencesGroup;
  private _emptyState!: Adw.StatusPage;
  private _emptyClamp!: Adw.Clamp;
  private _emptyImportClamp!: Adw.Clamp;
  private _scrolledWindow!: Gtk.ScrolledWindow;
  private _listClamp!: Adw.Clamp;
  private _createButton!: Gtk.Button;
  private _importButton!: Gtk.Button;
  private _emptyImportButton!: Gtk.Button;
  private _footerBox!: Gtk.Box;
  private _footerClamp!: Adw.Clamp;

  /** Cached vault names from the last refresh. */
  private _vaultNames: string[] = [];

  constructor() {
    super({ title: _("Vaults") });
    this._buildUi();
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Reload the vault list from disk. */
  refresh(): void {
    this._vaultNames = listVaultNames();
    this._rebuildList();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(): void {
    this._contentBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
    });

    // -- Empty state --------------------------------------------------------
    this._emptyState = new Adw.StatusPage({
      icon_name: "channel-secure-symbolic",
      title: _("No Vaults Yet"),
      description: _("Create a vault to securely store your files and secrets"),
    });

    const emptyCreateButton = new Gtk.Button({
      label: _("Create New Vault"),
      halign: Gtk.Align.CENTER,
    });
    emptyCreateButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Create new vault")],
    );
    emptyCreateButton.add_css_class("suggested-action");
    emptyCreateButton.add_css_class("pill");
    emptyCreateButton.connect("clicked", () => this._openCreateDialog());
    this._emptyState.set_child(emptyCreateButton);
    this._emptyClamp = new Adw.Clamp({
      maximum_size: CONTENT_MAX_WIDTH,
      margin_start: PAGE_MARGIN,
      margin_end: PAGE_MARGIN,
      margin_top: PAGE_MARGIN,
      margin_bottom: 12,
      child: this._emptyState,
    });

    // -- Vault list area ----------------------------------------------------
    this._vaultGroup = new Adw.PreferencesGroup({
      title: _("Your Vaults"),
    });

    const listPage = new Adw.PreferencesPage();
    listPage.add(this._vaultGroup);

    this._listClamp = new Adw.Clamp({
      maximum_size: CONTENT_MAX_WIDTH,
      margin_start: PAGE_MARGIN,
      margin_end: PAGE_MARGIN,
      margin_top: 12,
      margin_bottom: 0,
      child: listPage,
    });

    this._scrolledWindow = new Gtk.ScrolledWindow({
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      child: this._listClamp,
    });

    // -- Create button (shown below list) -----------------------------------
    this._createButton = new Gtk.Button({
      label: _("Create New Vault"),
      halign: Gtk.Align.CENTER,
    });
    this._createButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Create new vault")],
    );
    this._createButton.add_css_class("suggested-action");
    this._createButton.connect("clicked", () => this._openCreateDialog());

    // -- Import button (shown below create button) --------------------------
    this._importButton = new Gtk.Button({
      label: _("Import Vault\u2026"),
      halign: Gtk.Align.CENTER,
    });
    this._importButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Import vault from backup")],
    );
    this._importButton.add_css_class("flat");
    this._importButton.connect("clicked", () => this._openImportDialog());

    this._emptyImportButton = new Gtk.Button({
      label: _("Import Vault\u2026"),
      halign: Gtk.Align.CENTER,
    });
    this._emptyImportButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Import vault from backup")],
    );
    this._emptyImportButton.connect("clicked", () => this._openImportDialog());

    this._footerBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
      margin_top: 8,
      margin_bottom: 0,
      halign: Gtk.Align.CENTER,
    });

    const quickActionsRow = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
      halign: Gtk.Align.CENTER,
    });
    quickActionsRow.append(this._createButton);
    quickActionsRow.append(this._importButton);
    this._footerBox.append(quickActionsRow);

    this._footerClamp = new Adw.Clamp({
      maximum_size: CONTENT_MAX_WIDTH,
      margin_start: PAGE_MARGIN,
      margin_end: PAGE_MARGIN,
      margin_bottom: PAGE_MARGIN,
      child: this._footerBox,
    });

    this._emptyImportClamp = new Adw.Clamp({
      maximum_size: CONTENT_MAX_WIDTH,
      margin_start: PAGE_MARGIN,
      margin_end: PAGE_MARGIN,
      margin_bottom: PAGE_MARGIN,
      child: this._emptyImportButton,
    });

    this.set_child(this._contentBox);
  }

  // -------------------------------------------------------------------------
  // List management
  // -------------------------------------------------------------------------

  /** Rebuild the view based on current vault names. */
  private _rebuildList(): void {
    // Clear existing content
    let child = this._contentBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._contentBox.remove(child);
      child = next;
    }

    if (this._vaultNames.length === 0) {
      this._contentBox.append(this._emptyClamp);
      this._contentBox.append(this._emptyImportClamp);
      return;
    }

    // Clear existing rows from group
    this._clearGroup();

    // Add a row for each vault
    for (const name of this._vaultNames) {
      this._addVaultRow(name);
    }

    this._contentBox.append(this._scrolledWindow);
    this._contentBox.append(this._footerClamp);
  }

  /** Remove all rows from the preferences group. */
  private _clearGroup(): void {
    // Re-create the group to clear it (PreferencesGroup has no remove-all)
    const listPage = this._listClamp.get_child() as Adw.PreferencesPage;
    listPage.remove(this._vaultGroup);

    this._vaultGroup = new Adw.PreferencesGroup({
      title: _("Your Vaults"),
    });
    listPage.add(this._vaultGroup);
  }

  /** Create and add a single vault row. */
  private _addVaultRow(name: string): void {
    const row = new Adw.ActionRow({
      title: name,
      activatable: true,
    });
    row.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Vault: %s").replace("%s", name)],
    );
    row.update_property(
      [Gtk.AccessibleProperty.DESCRIPTION],
      [_("Locked")],
    );

    // Lock icon prefix
    const lockIcon = new Gtk.Image({
      icon_name: "channel-secure-symbolic",
    });
    row.add_prefix(lockIcon);

    // Navigation arrow suffix
    const arrow = new Gtk.Image({
      icon_name: "go-next-symbolic",
      css_classes: ["dim-label"],
    });
    row.add_suffix(arrow);

    // Row activation — select this vault
    row.connect("activated", () => {
      this.onVaultSelected?.(name);
    });

    // Context menu for deletion
    this._addContextMenu(row, name);

    this._vaultGroup.add(row);
  }

  // -------------------------------------------------------------------------
  // Context menu
  // -------------------------------------------------------------------------

  /** Attach a right-click context menu with a "Delete" action to a row. */
  private _addContextMenu(row: Adw.ActionRow, vaultName: string): void {
    const menuModel = new Gio.Menu();
    menuModel.append(_("Delete"), `vault.delete-${vaultName}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @girs type mismatch between transitive GLib deps
    const popover = Gtk.PopoverMenu.new_from_model(menuModel as any);
    popover.set_parent(row);
    popover.set_has_arrow(false);

    // Register the delete action on the row
    const actionGroup = new Gio.SimpleActionGroup();
    const deleteAction = Gio.SimpleAction.new(
      `delete-${vaultName}`,
      null,
    );
    deleteAction.connect("activate", () => {
      this._confirmDelete(vaultName);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @girs type mismatch between transitive GLib deps
    actionGroup.add_action(deleteAction as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @girs type mismatch between transitive GLib deps
    row.insert_action_group("vault", actionGroup as any);

    // Right-click gesture
    const gesture = new Gtk.GestureClick();
    gesture.set_button(3); // Right click
    gesture.connect(
      "pressed",
      (_gesture: Gtk.GestureClick, _nPress: number, x: number, y: number) => {
        const rect = new Gdk.Rectangle();
        rect.x = x;
        rect.y = y;
        rect.width = 1;
        rect.height = 1;
        popover.set_pointing_to(rect);
        popover.popup();
      },
    );
    row.add_controller(gesture);

    // Long-press gesture for touch
    const longPress = new Gtk.GestureLongPress();
    longPress.connect(
      "pressed",
      (_gesture: Gtk.GestureLongPress, x: number, y: number) => {
        const rect = new Gdk.Rectangle();
        rect.x = x;
        rect.y = y;
        rect.width = 1;
        rect.height = 1;
        popover.set_pointing_to(rect);
        popover.popup();
      },
    );
    row.add_controller(longPress);
  }

  // -------------------------------------------------------------------------
  // Delete confirmation
  // -------------------------------------------------------------------------

  /** Show a confirmation dialog before deleting a vault. */
  private _confirmDelete(name: string): void {
    const parent = this.get_root() as Gtk.Window | null;
    if (!parent) return;

    const meta = readVaultMetaByName(name);
    showDeleteDialog(parent, name, (passphrase: string, keyfilePath?: string) => {
      this.onDeleteVault?.(name, passphrase, keyfilePath);
    }, meta.keyfile);
  }

  // -------------------------------------------------------------------------
  // Create dialog
  // -------------------------------------------------------------------------

  /** Open the vault creation dialog. */
  private _openCreateDialog(): void {
    const dialog = new VaultCreateDialog(this._vaultNames);
    dialog.onConfirm = (
      name: string,
      passphrase: string,
      kdfPreset: KdfPreset,
      keyfilePath?: string,
    ) => {
      this.onCreateVault?.(name, passphrase, kdfPreset, keyfilePath);
    };

    const parent = this.get_root() as Gtk.Window | null;
    dialog.present(parent);
  }

  // -------------------------------------------------------------------------
  // Import dialog
  // -------------------------------------------------------------------------

  /** Open a folder chooser to import/restore a vault from a backup. */
  private _openImportDialog(): void {
    const dialog = new Gtk.FileDialog();
    dialog.set_title(_("Select Vault Backup Folder"));

    const parent = this.get_root() as Gtk.Window | null;
    dialog.select_folder(parent, null, (_dialog, result) => {
      try {
        const folder = dialog.select_folder_finish(result);
        if (!folder) return;
        const path = folder.get_path();
        if (!path) return;

        // Validate: check for manifest.gtkrypt
        const manifestPath = GLib.build_filenamev([path, "manifest.gtkrypt"]);
        if (!GLib.file_test(manifestPath, GLib.FileTest.EXISTS)) {
          const errorDialog = new Adw.AlertDialog({
            heading: _("Invalid Vault Backup"),
            body: _(
              "The selected folder does not contain a valid vault backup. A vault backup must contain a manifest.gtkrypt file.",
            ),
          });
          errorDialog.add_response("ok", _("OK"));
          errorDialog.present(parent);
          return;
        }

        this.onImportVault?.(path);
      } catch {
        // User cancelled the folder dialog.
      }
    });
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const VaultListView = GObject.registerClass(
  { GTypeName: "VaultListView" },
  _VaultListView,
);
