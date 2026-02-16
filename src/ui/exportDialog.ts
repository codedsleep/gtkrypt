/**
 * Export and backup dialogs for gtkrypt vaults.
 *
 * Provides two export workflows:
 * 1. ExportBackupDialog — exports an entire vault (encrypted files) to a
 *    user-chosen directory.
 * 2. ExportItemDialog — saves a single decrypted item to a user-chosen
 *    file path.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Adw from "gi://Adw?version=1";

import type { VaultItem } from "../models/types.js";
import { _ } from "../util/i18n.js";
import { log } from "../util/logging.js";

// ---------------------------------------------------------------------------
// File copy helper
// ---------------------------------------------------------------------------

/**
 * Recursively copy a vault directory to a destination.
 *
 * Creates the destination directory structure (items/, thumbs/) and
 * copies every `.gtkrypt` file from the source vault. Reports progress
 * after each file is copied.
 *
 * @param sourceDir - Absolute path to the vault directory.
 * @param destDir   - Absolute path to the destination directory.
 * @param onProgress - Called after each file copy with (copied, total).
 */
async function copyVaultDirectory(
  sourceDir: string,
  destDir: string,
  onProgress: (copied: number, total: number) => void,
): Promise<void> {
  const srcFile = Gio.File.new_for_path(sourceDir);

  // Collect all files to copy: manifest + items/* + thumbs/*
  const filesToCopy: { relativePath: string }[] = [];

  // Check manifest
  const manifestFile = srcFile.get_child("manifest.gtkrypt");
  if (manifestFile.query_exists(null)) {
    filesToCopy.push({ relativePath: "manifest.gtkrypt" });
  }

  // Enumerate subdirectories (items, thumbs)
  for (const subdir of ["items", "thumbs"]) {
    const subdirFile = srcFile.get_child(subdir);
    if (!subdirFile.query_exists(null)) continue;

    const enumerator = subdirFile.enumerate_children(
      "standard::name,standard::type",
      Gio.FileQueryInfoFlags.NONE,
      null,
    );

    let info: Gio.FileInfo | null;
    while ((info = enumerator.next_file(null)) !== null) {
      if (info.get_file_type() === Gio.FileType.REGULAR) {
        filesToCopy.push({
          relativePath: `${subdir}/${info.get_name()}`,
        });
      }
    }
    enumerator.close(null);
  }

  const total = filesToCopy.length;
  if (total === 0) return;

  // Create destination directory structure
  const destFile = Gio.File.new_for_path(destDir);
  GLib.mkdir_with_parents(destDir, 0o700);
  GLib.mkdir_with_parents(
    destFile.get_child("items").get_path()!,
    0o700,
  );
  GLib.mkdir_with_parents(
    destFile.get_child("thumbs").get_path()!,
    0o700,
  );

  // Copy each file
  let copied = 0;
  for (const entry of filesToCopy) {
    const src = srcFile.resolve_relative_path(entry.relativePath);
    const dst = destFile.resolve_relative_path(entry.relativePath);

    src.copy(dst, Gio.FileCopyFlags.OVERWRITE, null, null);
    copied++;
    onProgress(copied, total);

    // Yield to the main loop after each file so the progress bar updates
    await new Promise<void>((resolve) => {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Vault backup dialog
// ---------------------------------------------------------------------------

class _ExportBackupDialog extends Adw.Dialog {
  /** Called when the backup completes successfully. */
  public onComplete?: (destinationPath: string) => void;
  /** Called when the backup fails. */
  public onError?: (message: string) => void;

  // -- Widget references ----------------------------------------------------
  private _destRow!: Adw.ActionRow;
  private _progressBar!: Gtk.ProgressBar;
  private _exportButton!: Gtk.Button;
  private _cancelButton!: Gtk.Button;

  private _vaultName: string;
  private _vaultDir: string;
  private _destPath: string | null = null;

  constructor(vaultName: string, vaultDir: string) {
    super();
    this._vaultName = vaultName;
    this._vaultDir = vaultDir;

    this.set_content_width(440);
    this.set_title(_("Export Vault Backup"));

    this._buildUi();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(): void {
    // -- Header bar ---------------------------------------------------------
    const headerBar = new Adw.HeaderBar();
    headerBar.set_show_end_title_buttons(false);
    headerBar.set_show_start_title_buttons(false);

    this._cancelButton = new Gtk.Button({ label: _("Cancel") });
    this._cancelButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Cancel vault backup")],
    );
    this._cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(this._cancelButton);

    this._exportButton = new Gtk.Button({ label: _("Export") });
    this._exportButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Export vault backup")],
    );
    this._exportButton.add_css_class("suggested-action");
    this._exportButton.set_sensitive(false);
    this._exportButton.connect("clicked", () => this._onExport());
    headerBar.pack_end(this._exportButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: Info ---------------------------------------------------------
    const infoGroup = new Adw.PreferencesGroup({
      title: this._vaultName,
      description: _(
        "Export a backup of the encrypted vault files. The exported files remain encrypted and can be restored later.",
      ),
    });

    // Destination row
    this._destRow = new Adw.ActionRow({
      title: _("Destination"),
      subtitle: _("No destination selected"),
    });
    this._destRow.set_activatable(false);

    const folderButton = new Gtk.Button({
      icon_name: "folder-open-symbolic",
      valign: Gtk.Align.CENTER,
    });
    folderButton.add_css_class("flat");
    folderButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Choose destination folder")],
    );
    folderButton.connect("clicked", () => this._pickDestination());
    this._destRow.add_suffix(folderButton);

    infoGroup.add(this._destRow);

    // Progress bar
    this._progressBar = new Gtk.ProgressBar();
    this._progressBar.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Export progress")],
    );
    this._progressBar.set_visible(false);
    this._progressBar.set_show_text(true);
    this._progressBar.set_margin_top(12);
    this._progressBar.set_margin_bottom(6);
    this._progressBar.set_margin_start(12);
    this._progressBar.set_margin_end(12);
    infoGroup.add(this._progressBar);

    preferencesPage.add(infoGroup);

    // -- Assemble with ToolbarView ------------------------------------------
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(preferencesPage);

    this.set_child(toolbarView);
  }

  // -------------------------------------------------------------------------
  // Folder picker
  // -------------------------------------------------------------------------

  private _pickDestination(): void {
    const dialog = new Gtk.FileDialog();
    const parent = this.get_root() as Gtk.Window | null;

    dialog.select_folder(parent, null, (_dialog, result) => {
      try {
        const folder = dialog.select_folder_finish(result);
        if (!folder) return;
        const path = folder.get_path();
        if (path) {
          this._destPath = path;
          this._destRow.set_subtitle(path);
          this._exportButton.set_sensitive(true);
        }
      } catch {
        // User cancelled the folder picker — nothing to do.
      }
    });
  }

  // -------------------------------------------------------------------------
  // Export handler
  // -------------------------------------------------------------------------

  private _onExport(): void {
    if (!this._destPath) return;

    const fullDestPath = GLib.build_filenamev([
      this._destPath,
      this._vaultName,
    ]);

    // Disable controls during export
    this._exportButton.set_sensitive(false);
    this._cancelButton.set_sensitive(false);
    this._progressBar.set_visible(true);
    this._progressBar.set_fraction(0);
    this._progressBar.set_text(_("Preparing…"));

    copyVaultDirectory(
      this._vaultDir,
      fullDestPath,
      (copied, total) => {
        this._progressBar.set_fraction(copied / total);
        this._progressBar.set_text(`${copied} / ${total}`);
      },
    )
      .then(() => {
        log("info", `Vault backup exported to ${fullDestPath}`);
        this.onComplete?.(fullDestPath);
        this.close();
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : String(err);
        log("error", `Vault backup failed: ${message}`);
        this._progressBar.set_text(_("Export failed"));
        this._cancelButton.set_sensitive(true);
        this.onError?.(message);
      });
  }
}

// ---------------------------------------------------------------------------
// Item export dialog
// ---------------------------------------------------------------------------

class _ExportItemDialog extends Adw.Dialog {
  /** Called when the item export completes successfully. */
  public onComplete?: (savedPath: string) => void;
  /** Called when the item export fails. */
  public onError?: (message: string) => void;

  // -- Widget references ----------------------------------------------------
  private _saveRow!: Adw.ActionRow;
  private _exportButton!: Gtk.Button;

  private _item: VaultItem;
  private _itemData: Uint8Array;
  private _savePath: string | null = null;

  constructor(item: VaultItem, itemData: Uint8Array) {
    super();
    this._item = item;
    this._itemData = itemData;

    this.set_content_width(440);
    this.set_title(_("Export Item"));

    this._buildUi();
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
      [_("Cancel item export")],
    );
    cancelButton.connect("clicked", () => this.close());
    headerBar.pack_start(cancelButton);

    this._exportButton = new Gtk.Button({ label: _("Export") });
    this._exportButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Export item to file")],
    );
    this._exportButton.add_css_class("suggested-action");
    this._exportButton.set_sensitive(false);
    this._exportButton.connect("clicked", () => this._onExport());
    headerBar.pack_end(this._exportButton);

    // -- Preferences page ---------------------------------------------------
    const preferencesPage = new Adw.PreferencesPage();

    // Group 1: File ---------------------------------------------------------
    const fileGroup = new Adw.PreferencesGroup({
      title: this._item.name,
    });

    // Save location row
    this._saveRow = new Adw.ActionRow({
      title: _("Save location"),
      subtitle: _("No location selected"),
    });
    this._saveRow.set_activatable(false);

    const saveButton = new Gtk.Button({
      icon_name: "document-save-symbolic",
      valign: Gtk.Align.CENTER,
    });
    saveButton.add_css_class("flat");
    saveButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Choose save location")],
    );
    saveButton.connect("clicked", () => this._pickSaveLocation());
    this._saveRow.add_suffix(saveButton);

    fileGroup.add(this._saveRow);
    preferencesPage.add(fileGroup);

    // -- Assemble with ToolbarView ------------------------------------------
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);
    toolbarView.set_content(preferencesPage);

    this.set_child(toolbarView);
  }

  // -------------------------------------------------------------------------
  // File save picker
  // -------------------------------------------------------------------------

  private _pickSaveLocation(): void {
    const dialog = new Gtk.FileDialog();
    const suggestedName = this._item.filename ?? this._item.name;
    dialog.set_initial_name(suggestedName);
    const parent = this.get_root() as Gtk.Window | null;

    dialog.save(parent, null, (_dialog, result) => {
      try {
        const file = dialog.save_finish(result);
        if (!file) return;
        const path = file.get_path();
        if (path) {
          this._savePath = path;
          this._saveRow.set_subtitle(path);
          this._exportButton.set_sensitive(true);
        }
      } catch {
        // User cancelled the save dialog — nothing to do.
      }
    });
  }

  // -------------------------------------------------------------------------
  // Export handler
  // -------------------------------------------------------------------------

  private _onExport(): void {
    if (!this._savePath) return;

    try {
      const file = Gio.File.new_for_path(this._savePath);
      const stream = file.replace(
        null,
        false,
        Gio.FileCreateFlags.NONE,
        null,
      );
      stream.write_bytes(new GLib.Bytes(this._itemData), null);
      stream.flush(null);
      stream.close(null);

      log("info", `Item exported to ${this._savePath}`);
      this.onComplete?.(this._savePath);
      this.close();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      log("error", `Item export failed: ${message}`);
      this.onError?.(message);
    }
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const ExportBackupDialog = GObject.registerClass(
  { GTypeName: "ExportBackupDialog" },
  _ExportBackupDialog,
);

export const ExportItemDialog = GObject.registerClass(
  { GTypeName: "ExportItemDialog" },
  _ExportItemDialog,
);

// ---------------------------------------------------------------------------
// Public convenience API
// ---------------------------------------------------------------------------

/**
 * Show the vault backup export dialog.
 *
 * @param parent     - The parent window to present the dialog over.
 * @param vaultName  - Display name of the vault being exported.
 * @param vaultDir   - Absolute path to the vault directory.
 * @param onComplete - Callback invoked with the destination path on success.
 */
export function showExportBackupDialog(
  parent: Gtk.Window | null,
  vaultName: string,
  vaultDir: string,
  onComplete: (destinationPath: string) => void,
): void {
  const dialog = new ExportBackupDialog(vaultName, vaultDir);
  dialog.onComplete = onComplete;
  dialog.present(parent);
}

/**
 * Show the single-item export dialog.
 *
 * @param parent     - The parent window to present the dialog over.
 * @param item       - The vault item to export.
 * @param itemData   - Decrypted item data as a byte array.
 * @param onComplete - Callback invoked with the saved file path on success.
 */
export function showItemExportDialog(
  parent: Gtk.Window | null,
  item: VaultItem,
  itemData: Uint8Array,
  onComplete: (savedPath: string) => void,
): void {
  const dialog = new ExportItemDialog(item, itemData);
  dialog.onComplete = onComplete;
  dialog.present(parent);
}
