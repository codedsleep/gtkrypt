/**
 * Main application window for gtkrypt.
 *
 * Provides the primary UI shell with two modes:
 *   - **Files mode**: the original encrypt/decrypt workflow (drag-and-drop,
 *     file chooser, passphrase dialog, progress, results).
 *   - **Vault mode**: personal data vault with navigation between vault list,
 *     browser, and item detail views.
 *
 * A Gtk.Stack at the top level switches between modes. Within vault mode,
 * an Adw.NavigationView handles the hierarchical vault list → browser flow.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gdk from "gi://Gdk?version=4.0";
import Adw from "gi://Adw?version=1";

import pkg from "../../package.json" with { type: "json" };

import { FileListView } from "./fileList.js";
import { _ } from "../util/i18n.js";
import {
  showPassphraseDialog,
  setSessionPassphrase,
} from "./passphraseDialog.js";
import { ProgressView } from "./progressView.js";
import { ResultView } from "./resultView.js";
import type { FileResult } from "./resultView.js";

import { detectFileType } from "../services/detect.js";
import { encrypt, decrypt, decryptToBuffer } from "../services/crypto.js";
import { getEncryptOutputPath, getDecryptOutputPath } from "../services/naming.js";
import { isSymlink, getFileSize, secureWipe, readFileHead } from "../services/io.js";
import { parseHeader } from "../services/format.js";
import type {
  FileEntry,
  EncryptOptions,
  DecryptOptions,
  ProgressEvent,
  KdfPreset,
} from "../models/types.js";

// Vault imports
import { VaultListView } from "./vaultListView.js";
import { VaultBrowser } from "./vaultBrowser.js";
import { showUnlockDialog } from "./vaultUnlockDialog.js";
import { ItemDetailView } from "./itemDetailView.js";
import { showFileImportDialog, showItemMetadataEditor } from "./itemEditorDialog.js";
import { showTemplatePicker, showRecordEditor } from "./recordEditorDialog.js";
import { showNoteEditor } from "./noteEditorDialog.js";
import { showImportDialog } from "./importDialog.js";
import type { ImportFileEntry } from "./importDialog.js";
import { showExportBackupDialog, showItemExportDialog } from "./exportDialog.js";
import { showSettingsDialog } from "./settingsDialog.js";
import { showCategoryManager } from "./categoryManager.js";
import { showChangePassphraseDialog } from "./changePassphraseDialog.js";
import { showDeleteDialog } from "./vaultDeleteDialog.js";
import {
  createVault,
  unlockVault,
  lockVault,
  deleteVault,
  restoreVault,
  saveVaultState,
  addFileToVault,
  addRecordToVault,
  addNoteToVault,
  removeItem,
  updateItemMetadata,
  getItemData,
  resetAutoLockTimer,
  changeVaultPassphrase,
  thumbPath,
  itemFileExists,
  cleanupMissingItems,
  readVaultMetaByName,
  readVaultMeta,
} from "../services/vault.js";
import type { VaultState } from "../services/vault.js";
import type { VaultItem, VaultSettings } from "../models/types.js";
import { log } from "../util/logging.js";

// ---------------------------------------------------------------------------
// App mode type
// ---------------------------------------------------------------------------

type AppMode = "files" | "vault";

// ---------------------------------------------------------------------------
// Hamburger menu XML
// ---------------------------------------------------------------------------
const APP_MENU = `
<?xml version="1.0" encoding="UTF-8"?>
<interface>
<menu id='app-menu'>
  <section>
    <item>
      <attribute name='label' translatable='yes'>_Vault Settings</attribute>
      <attribute name='action'>win.vault_settings</attribute>
    </item>
    <item>
      <attribute name='label' translatable='yes'>_About</attribute>
      <attribute name='action'>win.about</attribute>
    </item>
    <item>
      <attribute name='label' translatable='yes'>_Quit</attribute>
      <attribute name='action'>win.quit</attribute>
    </item>
  </section>
</menu>
</interface>
`;

// ---------------------------------------------------------------------------
// CSS for drag-and-drop visual feedback
// ---------------------------------------------------------------------------
const DND_CSS = `
.drop-active {
  background-color: alpha(@accent_bg_color, 0.06);
  border: 1px dashed alpha(@accent_bg_color, 0.65);
  border-radius: 12px;
  transition: background-color 160ms ease-out, border-color 160ms ease-out;
}

.mode-switcher {
  background-color: alpha(@headerbar_bg_color, 0.45);
  border: 1px solid alpha(@headerbar_border_color, 0.4);
  border-radius: 8px;
  padding: 2px;
}
`;

/** Shared layout values for files-mode pages. */
const FILES_PAGE_MARGIN = 24;
const FILES_EMPTY_MAX_WIDTH = 640;

// ---------------------------------------------------------------------------
// Window implementation
// ---------------------------------------------------------------------------
class _GtkryptWindow extends Adw.ApplicationWindow {
  /** Toast overlay that wraps all main content. */
  private _toastOverlay!: Adw.ToastOverlay;

  /** Toolbar view providing headerbar + content structure. */
  private _toolbarView!: Adw.ToolbarView;

  /** Current application mode. */
  private _appMode: AppMode = "files";

  /** Top-level stack switching between files and vault modes. */
  private _modeStack!: Gtk.Stack;

  /** Container for the files mode content (changes with state machine). */
  private _filesContent!: Gtk.Box;

  /** Navigation view for vault mode (vault list → browser drill-down). */
  private _vaultNavView!: Adw.NavigationView;

  /** Vault list page (first page of vault navigation). */
  private _vaultListView!: InstanceType<typeof VaultListView>;

  /** Current vault browser page (pushed when a vault is unlocked). */
  private _vaultBrowser: InstanceType<typeof VaultBrowser> | null = null;

  /** Current unlocked vault state. */
  private _vaultState: VaultState | null = null;

  /** Visible mode switcher in the header bar. */
  private _modeSwitcher!: Gtk.StackSwitcher;

  /** Callback invoked when the user adds files (via drop or file chooser). */
  public onFilesAdded?: (paths: string[]) => void;

  /** Current list of files selected by the user. */
  private _files: FileEntry[] = [];

  /** Reference to the active file list view (when in files_selected state). */
  private _fileListView: InstanceType<typeof FileListView> | null = null;

  /** Cancellable for the current processing operation. */
  private _cancellable: Gio.Cancellable | null = null;

  /**
   * Accumulator for multi-file drops.  GTK4 fires one `drop` signal per
   * file so we batch them with a short idle timeout.
   */
  private _dropBatch: string[] = [];
  private _dropBatchSourceId: number | null = null;

  constructor(
    config: Partial<Adw.ApplicationWindow.ConstructorProps> = {},
  ) {
    super(config);

    // -- Load DnD CSS ---------------------------------------------------------
    const cssProvider = new Gtk.CssProvider();
    cssProvider.load_from_string(DND_CSS);
    Gtk.StyleContext.add_provider_for_display(
      Gdk.Display.get_default()!,
      cssProvider,
      Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
    );

    // -- Window actions -------------------------------------------------------
    this._registerAction("vault_settings", this._onVaultSettingsFromMenu.bind(this));
    this._registerAction("about", this._onAbout.bind(this));
    this._registerAction("quit", () => this.close());
    this._registerAction("open_files", () => this._openFileChooser());
    this.application!.set_accels_for_action("win.vault_settings", ["<primary>comma"]);
    this.application!.set_accels_for_action("win.open_files", ["<primary>o"]);
    this.application!.set_accels_for_action("win.quit", ["<primary>q"]);

    // -- Header bar -----------------------------------------------------------
    const headerBar = new Adw.HeaderBar();
    this._modeSwitcher = new Gtk.StackSwitcher({
      halign: Gtk.Align.CENTER,
    });
    this._modeSwitcher.add_css_class("mode-switcher");
    this._modeSwitcher.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Switch between files and vaults")],
    );
    headerBar.set_title_widget(this._modeSwitcher);

    const menuButton = this._buildMenuButton();
    menuButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Open application menu")]);
    headerBar.pack_end(menuButton);

    // -- Toast overlay --------------------------------------------------------
    this._toastOverlay = new Adw.ToastOverlay();

    // -- Mode stack -----------------------------------------------------------
    this._modeStack = new Gtk.Stack({
      transition_type: Gtk.StackTransitionType.SLIDE_LEFT_RIGHT,
      vexpand: true,
      hexpand: true,
    });

    // Files mode content container
    this._filesContent = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      vexpand: true,
      hexpand: true,
    });
    this._modeStack.add_titled(this._filesContent, "files", _("Files"));

    // Vault mode navigation
    this._buildVaultNavigation();
    this._modeStack.add_titled(this._vaultNavView, "vault", _("Vaults"));
    this._modeSwitcher.set_stack(this._modeStack);
    this._modeStack.connect("notify::visible-child-name", () => this._onModeChanged());

    this._toastOverlay.set_child(this._modeStack);

    // -- Toolbar view (headerbar on top, toast overlay as content) ------------
    this._toolbarView = new Adw.ToolbarView();
    this._toolbarView.add_top_bar(headerBar);
    this._toolbarView.set_content(this._toastOverlay);
    this.set_content(this._toolbarView);

    // -- Drag and drop --------------------------------------------------------
    this._setupDropTarget();

    // -- Keyboard navigation --------------------------------------------------
    const keyController = new Gtk.EventControllerKey();
    keyController.connect("key-pressed", (_ctrl: Gtk.EventControllerKey, keyval: number) => {
      // Escape: go back in vault navigation or clear file selection
      if (keyval === Gdk.KEY_Escape) {
        if (this._appMode === "vault" && this._vaultBrowser) {
          this._handleVaultLock();
          return true;
        }
        if (this._appMode === "files" && this._files.length > 0) {
          this._files = [];
          this._fileListView = null;
          this.showEmptyState();
          return true;
        }
      }
      return false;
    });
    this.add_controller(keyController);

    // -- Wire up file handler -------------------------------------------------
    this.onFilesAdded = (paths) => this._handleFilesAdded(paths);

    // -- Initial state --------------------------------------------------------
    this._modeStack.set_visible_child_name("files");
    this._onModeChanged();
    this._showFilesEmptyState();
  }

  // -------------------------------------------------------------------------
  // Mode switching
  // -------------------------------------------------------------------------

  /** Keep mode-dependent UI in sync with the visible stack page. */
  private _onModeChanged(): void {
    const visible = this._modeStack.get_visible_child_name();
    this._appMode = visible === "vault" ? "vault" : "files";
    if (this._appMode === "vault") {
      this._vaultListView.refresh();
    }
  }

  // -------------------------------------------------------------------------
  // Vault navigation
  // -------------------------------------------------------------------------

  /** Build the vault navigation view with vault list as root page. */
  private _buildVaultNavigation(): void {
    this._vaultNavView = new Adw.NavigationView();

    this._vaultListView = new VaultListView();
    this._vaultListView.set_tag("vault-list");

    // Wire vault list callbacks
    this._vaultListView.onVaultSelected = (name: string) => {
      this._handleVaultUnlock(name);
    };

    this._vaultListView.onCreateVault = (
      name: string,
      passphrase: string,
      kdfPreset: KdfPreset,
      keyfilePath?: string,
    ) => {
      this._handleVaultCreate(name, passphrase, kdfPreset, keyfilePath);
    };

    this._vaultListView.onDeleteVault = (name: string, passphrase: string, keyfilePath?: string) => {
      this._handleVaultDelete(name, passphrase, keyfilePath);
    };

    this._vaultListView.onImportVault = (sourceDir: string) => {
      this._handleVaultImport(sourceDir);
    };

    this._vaultNavView.push(this._vaultListView);
  }

  /** Handle vault creation. */
  private async _handleVaultCreate(
    name: string,
    passphrase: string,
    kdfPreset: KdfPreset,
    keyfilePath?: string,
  ): Promise<void> {
    try {
      this._vaultState = await createVault(name, passphrase, kdfPreset, keyfilePath);
      this._vaultState.onAutoLock = () => this._onVaultAutoLock();
      this.showToast(_("Vault created"));
      this._pushVaultBrowser();
    } catch (e) {
      const error = e as Error;
      const msg = "userMessage" in error
        ? (error as Error & { userMessage: string }).userMessage
        : error.message;
      this.showToast(msg);
    }
  }

  /** Handle vault unlock via unlock dialog. */
  private _handleVaultUnlock(name: string): void {
    const meta = readVaultMetaByName(name);
    const dialog = showUnlockDialog(
      this,
      name,
      async (passphrase: string, keyfilePath?: string) => {
        try {
          this._vaultState = await unlockVault(name, passphrase, keyfilePath);
          this._vaultState.onAutoLock = () => this._onVaultAutoLock();
          dialog.close();
          this._pushVaultBrowser();
        } catch (e) {
          const error = e as Error;
          const msg = "userMessage" in error
            ? (error as Error & { userMessage: string }).userMessage
            : error.message;
          dialog.showError(msg);
        }
      },
      meta.keyfile,
    );
  }

  /** Handle vault deletion. */
  private async _handleVaultDelete(
    name: string,
    passphrase: string,
    keyfilePath?: string,
  ): Promise<void> {
    try {
      await deleteVault(name, passphrase, keyfilePath);
      this._vaultListView.refresh();
      this.showToast(_("Vault deleted"));
    } catch (e) {
      const error = e as Error;
      const msg = "userMessage" in error
        ? (error as Error & { userMessage: string }).userMessage
        : error.message;
      this.showToast(msg);
    }
  }

  /** Handle vault import/restore from a backup directory. */
  private _handleVaultImport(sourceDir: string): void {
    const meta = readVaultMeta(sourceDir);
    const dialog = showUnlockDialog(
      this,
      _("Backup"),
      async (passphrase: string, keyfilePath?: string) => {
        try {
          const name = await restoreVault(sourceDir, passphrase, keyfilePath);
          dialog.close();
          this._vaultListView.refresh();
          this.showToast(_("Vault \u201C%s\u201D restored").replace("%s", name));
        } catch (e) {
          const error = e as Error;
          const msg = "userMessage" in error
            ? (error as Error & { userMessage: string }).userMessage
            : error.message;
          dialog.showError(msg);
        }
      },
      meta.keyfile,
    );
  }

  /** Push the vault browser onto the navigation stack. */
  private _pushVaultBrowser(): void {
    if (!this._vaultState) return;

    this._vaultBrowser = new VaultBrowser();
    this._vaultBrowser.setVaultState(
      this._vaultState.manifest,
      this._vaultState.manifest.settings.viewMode,
    );

    // Wire browser callbacks
    this._vaultBrowser.onLockVault = () => {
      this._handleVaultLock();
    };

    this._vaultBrowser.onItemSelected = (item: VaultItem) => {
      this._pushItemDetail(item);
    };

    this._vaultBrowser.onAddFile = () => {
      this._handleAddFile();
    };

    this._vaultBrowser.onAddRecord = () => {
      this._handleAddRecord();
    };

    this._vaultBrowser.onAddNote = () => {
      this._handleAddNote();
    };

    this._vaultBrowser.onViewModeChanged = async (mode) => {
      if (!this._vaultState) return;
      this._vaultState.manifest.settings.viewMode = mode;
      try {
        await saveVaultState(this._vaultState);
      } catch (e) {
        log("warn", `Failed to save view mode: ${e}`);
      }
    };

    this._vaultBrowser.onLoadThumbnail = async (itemId: string) => {
      if (!this._vaultState) throw new Error("Vault is locked");
      return decryptToBuffer(thumbPath(this._vaultState, itemId), this._vaultState.passphrase, this._vaultState.keyfilePath);
    };

    this._vaultBrowser.onBulkImport = () => {
      this._handleBulkImport();
    };

    this._vaultBrowser.onExportBackup = () => {
      this._handleExportBackup();
    };

    this._vaultBrowser.onSettings = () => {
      this._handleVaultSettings();
    };

    this._vaultBrowser.onCheckItemExists = (itemId: string) => {
      if (!this._vaultState) return true;
      return itemFileExists(this._vaultState, itemId);
    };

    this._vaultBrowser.onCleanupMissing = () => {
      this._handleCleanupMissing();
    };

    this._vaultBrowser.onGoBack = () => {
      this._handleVaultLock();
    };

    this._vaultNavView.push(this._vaultBrowser);
  }

  /** Handle vault lock (from browser lock button). */
  private _handleVaultLock(): void {
    if (this._vaultState) {
      lockVault(this._vaultState);
      this._vaultState = null;
    }
    this._vaultBrowser = null;
    this._vaultNavView.pop();
    this._vaultListView.refresh();
  }

  // -------------------------------------------------------------------------
  // Item detail view (Phase 6)
  // -------------------------------------------------------------------------

  /** Push the item detail view onto the navigation stack. */
  private _pushItemDetail(item: VaultItem): void {
    if (!this._vaultState) return;

    const state = this._vaultState;
    const detailView = new ItemDetailView();
    detailView.setItem(item, () => getItemData(state, item.id));

    detailView.onDeleteItem = async (deletedItem: VaultItem) => {
      try {
        await removeItem(state, deletedItem.id);
        this._vaultNavView.pop();
        this._vaultBrowser?.refreshItems();
        this.showToast(_("Item deleted"));
      } catch (e) {
        const error = e as Error;
        const msg = "userMessage" in error
          ? (error as Error & { userMessage: string }).userMessage
          : error.message;
        this.showToast(msg);
      }
    };

    detailView.onEditItem = (editItem: VaultItem) => {
      if (!this._vaultState) return;
      showItemMetadataEditor(this, editItem, this._vaultState.manifest.categories, async (
        name: string,
        category: string,
        tags: string[],
        favorite: boolean,
      ) => {
        try {
          await updateItemMetadata(state, editItem.id, { name, category, tags, favorite });
          // Refresh the detail view with updated item
          const updated = state.manifest.items.find(i => i.id === editItem.id);
          if (updated) {
            detailView.setItem(updated, () => getItemData(state, updated.id));
          }
          this._vaultBrowser?.refreshItems();
        } catch (e) {
          const error = e as Error;
          const msg = "userMessage" in error
            ? (error as Error & { userMessage: string }).userMessage
            : error.message;
          this.showToast(msg);
        }
      });
    };

    detailView.onToggleFavorite = async (favItem: VaultItem) => {
      try {
        await updateItemMetadata(state, favItem.id, { favorite: !favItem.favorite });
        const updated = state.manifest.items.find(i => i.id === favItem.id);
        if (updated) {
          detailView.setItem(updated, () => getItemData(state, updated.id));
        }
        this._vaultBrowser?.refreshItems();
      } catch (e) {
        log("warn", `Failed to toggle favorite: ${e}`);
      }
    };

    detailView.onExportItem = (exportItem: VaultItem) => {
      this._handleExportItem(exportItem);
    };

    detailView.onRemoveBrokenItem = async (brokenItem: VaultItem) => {
      try {
        await removeItem(state, brokenItem.id);
        this._vaultNavView.pop();
        this._vaultBrowser?.refreshItems();
        this.showToast(_("Broken entry removed"));
      } catch (e) {
        const error = e as Error;
        const msg = "userMessage" in error
          ? (error as Error & { userMessage: string }).userMessage
          : error.message;
        this.showToast(msg);
      }
    };

    detailView.onGoBack = () => {
      this._vaultNavView.pop();
    };

    this._vaultNavView.push(detailView);
  }

  // -------------------------------------------------------------------------
  // Add items to vault (Phase 7)
  // -------------------------------------------------------------------------

  /** Handle "Add File" from vault browser. */
  private _handleAddFile(): void {
    if (!this._vaultState) return;

    const state = this._vaultState;
    const dialog = new Gtk.FileDialog();

    dialog.open(this, null, (_dialog, result) => {
      try {
        const file = dialog.open_finish(result);
        if (!file) return;
        const path = file.get_path();
        if (!path) return;

        const fileName = GLib.path_get_basename(path);
        showFileImportDialog(this, fileName, state.manifest.categories, async (
          name: string,
          category: string,
          tags: string[],
          favorite: boolean,
        ) => {
          try {
            await addFileToVault(state, path, { name, category, tags, favorite });
            this._vaultBrowser?.refreshItems();
            resetAutoLockTimer(state);
            this.showToast(_("File added to vault"));
          } catch (e) {
            const error = e as Error;
            const msg = "userMessage" in error
              ? (error as Error & { userMessage: string }).userMessage
              : error.message;
            this.showToast(msg);
          }
        });
      } catch {
        // User cancelled the file dialog.
      }
    });
  }

  /** Handle "New Record" from vault browser. */
  private _handleAddRecord(): void {
    if (!this._vaultState) return;

    const state = this._vaultState;
    showTemplatePicker(this, (template) => {
      showRecordEditor(this, template, state.manifest.categories, async (
        name: string,
        fields: Record<string, string>,
        category: string,
        tags: string[],
      ) => {
        try {
          await addRecordToVault(state, {
            name,
            fields,
            category,
            tags,
            templateId: template.id,
          });
          this._vaultBrowser?.refreshItems();
          resetAutoLockTimer(state);
          this.showToast(_("Record added to vault"));
        } catch (e) {
          const error = e as Error;
          const msg = "userMessage" in error
            ? (error as Error & { userMessage: string }).userMessage
            : error.message;
          this.showToast(msg);
        }
      });
    });
  }

  /** Handle "New Note" from vault browser. */
  private _handleAddNote(): void {
    if (!this._vaultState) return;

    const state = this._vaultState;
    showNoteEditor(this, state.manifest.categories, async (
      title: string,
      text: string,
      category: string,
      tags: string[],
    ) => {
      try {
        await addNoteToVault(state, title, text, { category, tags });
        this._vaultBrowser?.refreshItems();
        resetAutoLockTimer(state);
        this.showToast(_("Note added to vault"));
      } catch (e) {
        const error = e as Error;
        const msg = "userMessage" in error
          ? (error as Error & { userMessage: string }).userMessage
          : error.message;
        this.showToast(msg);
      }
    });
  }

  /** Handle "Import Files" from vault browser. */
  private _handleBulkImport(): void {
    if (!this._vaultState) return;

    const state = this._vaultState;
    const dialog = new Gtk.FileDialog();

    dialog.open_multiple(this, null, (_dialog, result) => {
      try {
        const fileList = dialog.open_multiple_finish(result);
        if (!fileList) return;

        const files: { path: string; name: string; size: number }[] = [];
        for (let i = 0; i < fileList.get_n_items(); i++) {
          const item = fileList.get_item(i);
          if (!item) continue;
          const file = item as unknown as Gio.File;
          const path = file.get_path();
          if (!path) continue;
          const info = file.query_info(
            "standard::display-name,standard::size",
            Gio.FileQueryInfoFlags.NONE,
            null,
          );
          files.push({
            path,
            name: info.get_display_name(),
            size: info.get_size(),
          });
        }

        if (files.length === 0) return;

        showImportDialog(this, files, state.manifest.categories, async (entries: ImportFileEntry[]) => {
          let added = 0;
          for (const entry of entries) {
            try {
              await addFileToVault(state, entry.path, {
                name: entry.name,
                category: entry.category,
                tags: entry.tags,
              });
              added++;
            } catch (e) {
              log("warn", `Failed to import ${entry.name}: ${e}`);
            }
          }
          this._vaultBrowser?.refreshItems();
          resetAutoLockTimer(state);
          this.showToast(_("%d file(s) imported").replace("%d", String(added)));
        });
      } catch {
        // User cancelled the file dialog.
      }
    });
  }

  /** Handle "Export Backup" from vault browser. */
  private _handleExportBackup(): void {
    if (!this._vaultState) return;

    showExportBackupDialog(this, this._vaultState.name, this._vaultState.dir, (destPath: string) => {
      this.showToast(_("Backup exported to %s").replace("%s", GLib.path_get_basename(destPath)));
    });
  }

  /** Handle "Export Item" from item detail view. */
  private async _handleExportItem(item: VaultItem): Promise<void> {
    if (!this._vaultState) return;

    try {
      const data = await getItemData(this._vaultState, item.id);
      showItemExportDialog(this, item, data, (savedPath: string) => {
        this.showToast(_("Item exported to %s").replace("%s", GLib.path_get_basename(savedPath)));
      });
    } catch (e) {
      const error = e as Error;
      const msg = "userMessage" in error
        ? (error as Error & { userMessage: string }).userMessage
        : error.message;
      this.showToast(msg);
    }
  }

  // -------------------------------------------------------------------------
  // Settings, categories, and passphrase change (Phase 10)
  // -------------------------------------------------------------------------

  /** Handle "Settings" button in vault browser. */
  private _handleVaultSettings(): void {
    if (!this._vaultState) return;

    const state = this._vaultState;
    showSettingsDialog(this, state.manifest.settings, state.manifest.categories, {
      onSave: async (settings: VaultSettings) => {
        try {
          state.manifest.settings = settings;
          await saveVaultState(state);
          resetAutoLockTimer(state);
          this._vaultBrowser?.setVaultState(
            state.manifest,
            state.manifest.settings.viewMode,
          );
          this.showToast(_("Settings saved"));
        } catch (e) {
          const error = e as Error;
          const msg = "userMessage" in error
            ? (error as Error & { userMessage: string }).userMessage
            : error.message;
          this.showToast(msg);
        }
      },
      onChangePassphrase: () => {
        this._handleChangePassphrase();
      },
      onDeleteVault: () => {
        if (!this._vaultState) return;
        const name = this._vaultState.name;
        const meta = readVaultMetaByName(name);
        showDeleteDialog(this, name, async (passphrase: string, keyfilePath?: string) => {
          try {
            await deleteVault(name, passphrase, keyfilePath);
            this._vaultState = null;
            this._vaultBrowser = null;
            this._vaultNavView.pop_to_tag("vault-list");
            this._vaultListView.refresh();
            this.showToast(_("Vault deleted"));
          } catch (e) {
            const error = e as Error;
            const msg = "userMessage" in error
              ? (error as Error & { userMessage: string }).userMessage
              : error.message;
            this.showToast(msg);
          }
        }, meta.keyfile);
      },
      onManageCategories: () => {
        this._handleManageCategories();
      },
    });
  }

  /** Handle "Manage Categories" from settings dialog. */
  private _handleManageCategories(): void {
    if (!this._vaultState) return;

    const state = this._vaultState;
    showCategoryManager(this, state.manifest.categories, async (categories) => {
      try {
        // Reassign items whose category was deleted to "other".
        const categoryIds = new Set(categories.map((c) => c.id));
        for (const item of state.manifest.items) {
          if (!categoryIds.has(item.category)) {
            item.category = "other";
          }
        }

        state.manifest.categories = categories;
        await saveVaultState(state);
        resetAutoLockTimer(state);
        this._vaultBrowser?.setVaultState(
          state.manifest,
          state.manifest.settings.viewMode,
        );
        this.showToast(_("Categories updated"));
      } catch (e) {
        const error = e as Error;
        const msg = "userMessage" in error
          ? (error as Error & { userMessage: string }).userMessage
          : error.message;
        this.showToast(msg);
      }
    });
  }

  /** Handle "Change Passphrase" from settings dialog. */
  private _handleChangePassphrase(): void {
    if (!this._vaultState) return;

    const state = this._vaultState;
    showChangePassphraseDialog(this, async (currentPassphrase, newPassphrase, kdfPreset) => {
      try {
        await changeVaultPassphrase(
          state,
          currentPassphrase,
          newPassphrase,
          kdfPreset,
        );
        this.showToast(_("Passphrase changed successfully"));
      } catch (e) {
        const error = e as Error;
        const msg = "userMessage" in error
          ? (error as Error & { userMessage: string }).userMessage
          : error.message;
        this.showToast(msg);
      }
    });
  }

  /** Handle "Clean Up Missing Items" from vault browser. */
  private async _handleCleanupMissing(): Promise<void> {
    if (!this._vaultState) return;

    const state = this._vaultState;

    // First count missing items to show confirmation.
    let missingCount = 0;
    for (const item of state.manifest.items) {
      if (!itemFileExists(state, item.id)) {
        missingCount++;
      }
    }

    if (missingCount === 0) {
      this.showToast(_("No missing items found"));
      return;
    }

    const dialog = new Adw.AlertDialog({
      heading: _("Clean Up Missing Items"),
      body: _("%d item(s) have missing files and will be removed from the manifest.").replace(
        "%d",
        String(missingCount),
      ),
    });
    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("cleanup", _("Remove"));
    dialog.set_default_response("cancel");
    dialog.set_close_response("cancel");
    dialog.set_response_appearance(
      "cleanup",
      Adw.ResponseAppearance.DESTRUCTIVE,
    );

    dialog.connect(
      "response",
      async (_dialog: Adw.AlertDialog, response: string) => {
        if (response !== "cleanup") return;
        try {
          const removed = await cleanupMissingItems(state);
          this._vaultBrowser?.refreshItems();
          this.showToast(
            _("%d broken entry/entries removed").replace(
              "%d",
              String(removed.length),
            ),
          );
        } catch (e) {
          const error = e as Error;
          const msg = "userMessage" in error
            ? (error as Error & { userMessage: string }).userMessage
            : error.message;
          this.showToast(msg);
        }
      },
    );

    dialog.present(this);
  }

  /** Handle auto-lock timeout. */
  private _onVaultAutoLock(): void {
    this._vaultState = null;
    this._vaultBrowser = null;
    // Pop back to vault list
    this._vaultNavView.pop_to_tag("vault-list");
    this._vaultListView.refresh();
    this.showToast(_("Vault locked due to inactivity"));
  }

  // -------------------------------------------------------------------------
  // Files mode content management
  // -------------------------------------------------------------------------

  /** Replace the files mode content widget. */
  setContent(widget: Gtk.Widget): void {
    // Clear existing children
    let child = this._filesContent.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._filesContent.remove(child);
      child = next;
    }
    this._filesContent.append(widget);
  }

  /** Show the initial empty / welcome state for files mode. */
  private _showFilesEmptyState(): void {
    const statusPage = new Adw.StatusPage({
      icon_name: "channel-secure-symbolic",
      title: _("Encrypt or Decrypt Files"),
      description: _("Drop files here or choose files to get started"),
    });

    const chooseButton = new Gtk.Button({
      label: _("Choose Files\u2026"),
      halign: Gtk.Align.CENTER,
    });
    chooseButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Choose files")]);
    chooseButton.add_css_class("suggested-action");
    chooseButton.connect("clicked", () => this._openFileChooser());

    statusPage.set_child(chooseButton);
    const clamp = new Adw.Clamp({
      child: statusPage,
      maximum_size: FILES_EMPTY_MAX_WIDTH,
      margin_start: FILES_PAGE_MARGIN,
      margin_end: FILES_PAGE_MARGIN,
      margin_top: FILES_PAGE_MARGIN,
      margin_bottom: FILES_PAGE_MARGIN,
    });
    const contentBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      vexpand: true,
    });
    contentBox.append(clamp);

    this.setContent(contentBox);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      chooseButton.grab_focus();
      return GLib.SOURCE_REMOVE;
    });
  }

  /** Show the initial empty state — delegates to files mode. */
  showEmptyState(): void {
    this._showFilesEmptyState();
  }

  // -------------------------------------------------------------------------
  // State machine: files added
  // -------------------------------------------------------------------------

  /**
   * Handle newly added file paths from drop or file chooser.
   *
   * Filters out symlinks with a warning dialog (Task 4.10), detects
   * file types, builds FileEntry objects, and transitions to the
   * file list state.
   */
  private _handleFilesAdded(paths: string[]): void {
    // Switch to files mode if in vault mode
    if (this._appMode === "vault") {
      this._modeStack.set_visible_child_name("files");
    }

    const symlinks: string[] = [];
    const validPaths: string[] = [];

    for (const path of paths) {
      try {
        if (isSymlink(path)) {
          symlinks.push(GLib.path_get_basename(path));
        } else {
          validPaths.push(path);
        }
      } catch {
        // If we cannot query the file, skip it silently.
        validPaths.push(path);
      }
    }

    // Show symlink warning if any were skipped (Task 4.10)
    if (symlinks.length > 0) {
      const dialog = new Adw.AlertDialog({
        heading: _("Symlinks Not Supported"),
        body: _("The following files were skipped because they are symbolic links:") +
          `\n\n${symlinks.join("\n")}`,
      });
      dialog.add_response("ok", _("OK"));
      dialog.present(this);
    }

    // Build FileEntry objects from valid paths
    for (const path of validPaths) {
      // Avoid duplicates
      if (this._files.some((f) => f.path === path)) {
        continue;
      }

      const type = detectFileType(path);
      const size = getFileSize(path);
      const name = GLib.path_get_basename(path);

      this._files.push({ path, name, size, type });
    }

    if (this._files.length > 0) {
      this._showFileList();
    }
  }

  // -------------------------------------------------------------------------
  // State machine: file list
  // -------------------------------------------------------------------------

  /** Display the file list view and wire up its callbacks. */
  private _showFileList(): void {
    this._fileListView = new FileListView();
    this._fileListView.setFiles(this._files);

    this._fileListView.onAction = (files: FileEntry[]) => {
      // Determine mode from the file mix
      const hasEncrypted = files.some((f: FileEntry) => f.type === "encrypted");
      const hasPlaintext = files.some(
        (f: FileEntry) => f.type === "plaintext" || f.type === "unknown",
      );
      const mode = hasEncrypted && !hasPlaintext ? "decrypt" : "encrypt";

      showPassphraseDialog(this, mode, (passphrase, options, remember) => {
        if (remember) setSessionPassphrase(passphrase);
        this._processFiles(files, passphrase, options, mode);
      });
    };

    this._fileListView.onClear = () => {
      this._files = [];
      this._fileListView = null;
      this.showEmptyState();
    };

    this._fileListView.onFileRemoved = (index: number) => {
      this._files.splice(index, 1);
      if (this._files.length === 0) {
        this._fileListView = null;
        this.showEmptyState();
      } else {
        this._fileListView!.setFiles(this._files);
      }
    };

    this.setContent(this._fileListView);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._fileListView?.focusPrimaryAction();
      return GLib.SOURCE_REMOVE;
    });
  }

  // -------------------------------------------------------------------------
  // State machine: processing
  // -------------------------------------------------------------------------

  /**
   * Process files through the crypto backend.
   *
   * Transitions to the progress view, runs encrypt/decrypt for each
   * file, then transitions to the results view.
   */
  private async _processFiles(
    files: FileEntry[],
    passphrase: string,
    options: EncryptOptions | DecryptOptions,
    mode: string,
  ): Promise<void> {
    const progressView = new ProgressView();
    progressView.setupFiles(files.map((f) => f.name));

    this._cancellable = new Gio.Cancellable();

    progressView.onCancel = () => {
      this._cancellable?.cancel();
    };

    this.setContent(progressView);

    const results: FileResult[] = [];
    let wasCancelled = false;
    let wipeDecision: "wipe" | "keep" | null = null;
    let applyToRemaining = false;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        let outputPath: string;

        if (file.type === "encrypted") {
          // Decrypt — read header for stored filename
          const decryptOpts = options as DecryptOptions;
          let storedFilename: string | undefined;
          if (decryptOpts.useStoredFilename) {
            try {
              const headBytes = readFileHead(file.path, 512);
              const header = parseHeader(headBytes);
              if (header.filename.length > 0) {
                storedFilename = header.filename;
              }
            } catch {
              // Header parse failed — fall back to no stored filename.
            }
          }
          outputPath = getDecryptOutputPath(file.path, storedFilename, decryptOpts.outputDir);
          await decrypt(
            file.path,
            outputPath,
            passphrase,
            options as DecryptOptions,
            (event: ProgressEvent) => {
              const fraction =
                event.totalBytes > 0
                  ? event.bytesProcessed / event.totalBytes
                  : 0;
              progressView.updateFileProgress(i, fraction, event.phase);
            },
            this._cancellable,
          );
        } else {
          // Encrypt
          const encryptOpts = options as EncryptOptions;
          outputPath = getEncryptOutputPath(file.path, encryptOpts.outputDir);
          await encrypt(
            file.path,
            outputPath,
            passphrase,
            options as EncryptOptions,
            (event: ProgressEvent) => {
              const fraction =
                event.totalBytes > 0
                  ? event.bytesProcessed / event.totalBytes
                  : 0;
              progressView.updateFileProgress(i, fraction, event.phase);
            },
            this._cancellable,
          );

          if ((options as EncryptOptions).wipeOriginal) {
            if (!applyToRemaining) {
              const decision = await this._confirmWipe(file.name);
              wipeDecision = decision.decision;
              applyToRemaining = decision.applyToRemaining;
            }

            if (wipeDecision === "wipe") {
              try {
                secureWipe(file.path);
              } catch {
                throw new Error(
                  _("Encrypted file created, but failed to delete the original file."),
                );
              }
            }
          }
        }

        progressView.markFileComplete(i);
        results.push({ filename: file.name, outputPath, success: true });
      } catch (e) {
        const error = e as Error;
        const userMessage =
          "userMessage" in error
            ? (error as Error & { userMessage: string }).userMessage
            : error.message;
        results.push({
          filename: file.name,
          outputPath: "",
          success: false,
          error: userMessage,
        });

        // If cancelled, stop processing remaining files
        if (this._cancellable?.is_cancelled()) {
          wasCancelled = true;
          break;
        }
      }
    }

    this._cancellable = null;
    if (wasCancelled) {
      this._showFileList();
      return;
    }
    this._showResults(
      results,
      mode === "decrypt" ? "decrypt" : "encrypt",
    );
  }

  // -------------------------------------------------------------------------
  // State machine: results
  // -------------------------------------------------------------------------

  /** Display the results view and wire up the start-over callback. */
  private _showResults(
    results: FileResult[],
    mode: "encrypt" | "decrypt",
  ): void {
    const resultView = new ResultView();
    resultView.setResults(results, mode);

    resultView.onStartOver = () => {
      this._files = [];
      this._fileListView = null;
      this.showEmptyState();
    };

    this.setContent(resultView);
  }

  /** Show a transient toast message in the overlay. */
  showToast(message: string): void {
    this._toastOverlay.add_toast(Adw.Toast.new(message));
  }

  // -------------------------------------------------------------------------
  // Menu
  // -------------------------------------------------------------------------

  /** Build the hamburger menu button from XML. */
  private _buildMenuButton(): Gtk.MenuButton {
    const builder = new Gtk.Builder();
    builder.add_from_string(APP_MENU, APP_MENU.length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @girs type mismatch between transitive GLib/Gio deps
    const menuModel = builder.get_object("app-menu");

    const button = new Gtk.MenuButton();
    button.set_menu_model(menuModel as any);
    button.set_icon_name("open-menu-symbolic");
    return button;
  }

  /** Handler for win.about action. */
  private _onAbout(): void {
    const dialog = new Adw.AboutDialog({
      application_name: _("gtkrypt"),
      application_icon: "io.github.gtkrypt",
      developer_name: "zzz",
      version: pkg.version,
      developers: ["zzz"],
      copyright: "\u00A9 2026 zzz",
    });
    dialog.present(this);
  }

  /** Handler for win.vault_settings action from the application popover menu. */
  private _onVaultSettingsFromMenu(): void {
    if (this._vaultState) {
      this._handleVaultSettings();
      return;
    }

    // Route users to the vault view where settings become available once unlocked.
    this._modeStack.set_visible_child_name("vault");
    const dialog = new Adw.AlertDialog({
      heading: _("Unlock a Vault to Open Settings"),
      body: _("Vault settings are available after you unlock a vault."),
    });
    dialog.add_response("ok", _("OK"));
    dialog.present(this);
  }

  // -------------------------------------------------------------------------
  // Drag and drop
  // -------------------------------------------------------------------------

  /** Set up the Gtk.DropTarget on the toast overlay for file drops. */
  private _setupDropTarget(): void {
    const dropTarget = Gtk.DropTarget.new(
      Gio.File.$gtype,
      Gdk.DragAction.COPY,
    );

    // Visual feedback on drag enter
    const dropController = new Gtk.DropControllerMotion();
    dropController.connect("enter", () => {
      this._toastOverlay.add_css_class("drop-active");
    });
    dropController.connect("leave", () => {
      this._toastOverlay.remove_css_class("drop-active");
    });
    this._toastOverlay.add_controller(dropController);

    // Handle the actual drop (one signal per file)
    dropTarget.connect(
      "drop",
      (_target: Gtk.DropTarget, value: GObject.Object, _x: number, _y: number): boolean => {
        this._toastOverlay.remove_css_class("drop-active");

        const file = value as Gio.File;
        const path = file.get_path();
        if (path) {
          this._dropBatch.push(path);
          this._scheduleBatchFlush();
        }
        return true;
      },
    );

    this._toastOverlay.add_controller(dropTarget);
  }

  /**
   * Schedule a flush of the drop batch.  This coalesces multiple single-file
   * drop signals into one callback invocation.
   */
  private _scheduleBatchFlush(): void {
    if (this._dropBatchSourceId !== null) {
      return;
    }
    this._dropBatchSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      const paths = this._dropBatch.splice(0);
      this._dropBatchSourceId = null;
      if (paths.length > 0 && this.onFilesAdded) {
        this.onFilesAdded(paths);
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  // -------------------------------------------------------------------------
  // File chooser
  // -------------------------------------------------------------------------

  /** Open a multi-select file dialog. */
  private _openFileChooser(): void {
    const dialog = new Gtk.FileDialog();

    dialog.open_multiple(this, null, (_dialog, result) => {
      try {
        const files = dialog.open_multiple_finish(result);
        if (!files) return;
        const paths: string[] = [];
        for (let i = 0; i < files.get_n_items(); i++) {
          const item = files.get_item(i);
          if (!item) continue;
          const file = item as unknown as Gio.File;
          const path = file.get_path();
          if (path) paths.push(path);
        }
        if (paths.length > 0 && this.onFilesAdded) {
          this.onFilesAdded(paths);
        }
      } catch {
        // User cancelled the dialog -- nothing to do.
      }
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Register a simple action on the window and connect it to a handler. */
  private _registerAction(
    name: string,
    callback: (
      action: Gio.SimpleAction,
      parameter?: GLib.Variant | null,
    ) => void,
  ): void {
    const action = Gio.SimpleAction.new(name, null);
    action.connect("activate", callback);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @girs type mismatch between transitive GLib deps
    this.add_action(action as any);
  }

  private async _confirmWipe(
    filename: string,
  ): Promise<{ decision: "wipe" | "keep"; applyToRemaining: boolean }> {
    const dialog = new Adw.AlertDialog({
      heading: _("Delete original file?"),
      body: _("This will permanently delete the original file:") +
        `\n\n${filename}`,
    });
    dialog.add_response("keep", _("Keep"));
    dialog.add_response("wipe", _("Delete"));
    dialog.set_default_response("keep");
    dialog.set_response_appearance("wipe", Adw.ResponseAppearance.DESTRUCTIVE);

    const applyCheck = new Gtk.CheckButton({
      label: _("Apply this choice to remaining files"),
    });
    applyCheck.update_property([Gtk.AccessibleProperty.LABEL], [_("Apply choice to remaining files")]);
    dialog.set_extra_child(applyCheck);

    const response = await new Promise<string>((resolve) => {
      dialog.connect("response", (_dialog, resp) => resolve(resp));
      dialog.present(this);
    });

    return {
      decision: response === "wipe" ? "wipe" : "keep",
      applyToRemaining: applyCheck.get_active(),
    };
  }
}

export const GtkryptWindow = GObject.registerClass(
  { GTypeName: "GtkryptWindow" },
  _GtkryptWindow,
);
