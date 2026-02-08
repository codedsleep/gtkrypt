/**
 * Main application window for gtkrypt.
 *
 * Provides the primary UI shell: header bar with menu, toast overlay,
 * drag-and-drop target, file chooser, and swappable content area that
 * transitions between the empty state, file list, progress, and results
 * views as the user works through an encrypt/decrypt flow.
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
import { encrypt, decrypt } from "../services/crypto.js";
import { getEncryptOutputPath, getDecryptOutputPath } from "../services/naming.js";
import { isSymlink, getFileSize, secureWipe, readFileHead } from "../services/io.js";
import { parseHeader } from "../services/format.js";
import type {
  FileEntry,
  EncryptOptions,
  DecryptOptions,
  ProgressEvent,
} from "../models/types.js";

// ---------------------------------------------------------------------------
// Hamburger menu XML
// ---------------------------------------------------------------------------
const APP_MENU = `
<?xml version="1.0" encoding="UTF-8"?>
<interface>
<menu id='app-menu'>
  <section>
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
  background-color: alpha(@accent_bg_color, 0.1);
  border: 2px dashed @accent_bg_color;
  border-radius: 12px;
}
`;

// ---------------------------------------------------------------------------
// Window implementation
// ---------------------------------------------------------------------------
class _GtkryptWindow extends Adw.ApplicationWindow {
  /** Toast overlay that wraps all main content. */
  private _toastOverlay!: Adw.ToastOverlay;

  /** Toolbar view providing headerbar + content structure. */
  private _toolbarView!: Adw.ToolbarView;

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
    this._registerAction("about", this._onAbout.bind(this));
    this._registerAction("quit", () => this.close());
    this._registerAction("open_files", () => this._openFileChooser());
    this.application!.set_accels_for_action("win.open_files", ["<primary>o"]);

    // -- Header bar -----------------------------------------------------------
    const headerBar = new Adw.HeaderBar();

    const menuButton = this._buildMenuButton();
    menuButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Open application menu")]);
    headerBar.pack_end(menuButton);

    // -- Toast overlay --------------------------------------------------------
    this._toastOverlay = new Adw.ToastOverlay();

    // -- Toolbar view (headerbar on top, toast overlay as content) ------------
    this._toolbarView = new Adw.ToolbarView();
    this._toolbarView.add_top_bar(headerBar);
    this._toolbarView.set_content(this._toastOverlay);
    this.set_content(this._toolbarView);

    // -- Drag and drop --------------------------------------------------------
    this._setupDropTarget();

    // -- Wire up file handler -------------------------------------------------
    this.onFilesAdded = (paths) => this._handleFilesAdded(paths);

    // -- Initial state --------------------------------------------------------
    this.showEmptyState();
  }

  // -------------------------------------------------------------------------
  // Content management
  // -------------------------------------------------------------------------

  /** Replace the current main content widget. */
  setContent(widget: Gtk.Widget): void {
    this._toastOverlay.set_child(widget);
  }

  /** Show the initial empty / welcome state. */
  showEmptyState(): void {
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
    chooseButton.add_css_class("pill");
    chooseButton.connect("clicked", () => this._openFileChooser());

    statusPage.set_child(chooseButton);

    this.setContent(statusPage);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      chooseButton.grab_focus();
      return GLib.SOURCE_REMOVE;
    });
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
