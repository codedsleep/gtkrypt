/**
 * Item detail view for gtkrypt vault browser.
 *
 * Displays vault item metadata and content preview. Supports file preview
 * (image/text), structured record fields with sensitive masking, and notes.
 * Implements phases 6.1, 6.4, 6.5, 6.7 of the vault UI specification.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Gdk from "gi://Gdk?version=4.0";
import Adw from "gi://Adw?version=1";

import type { VaultItem } from "../models/types.js";
import { ItemFileMissingError } from "../models/errors.js";
import { BUILTIN_TEMPLATES } from "../models/templates.js";
import { copyToClipboard } from "../services/clipboard.js";
import { ImageViewer } from "./imageViewer.js";
import { TextViewer } from "./textViewer.js";
import { _ } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Mask string for sensitive fields. */
const SENSITIVE_MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

/** Keys that indicate a sensitive field (checked with lowercase includes). */
const SENSITIVE_KEYS = ["password", "pin", "secret", "cvv"];

/** MIME types treated as text for preview. */
const TEXT_MIME_TYPES = ["application/json", "application/xml"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO date string for display. */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString();
}

/** Whether a field key represents a sensitive value. */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

/** Format file size in human-readable units. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Item detail view implementation
// ---------------------------------------------------------------------------

class _ItemDetailView extends Adw.NavigationPage {
  // -- Public callbacks -----------------------------------------------------
  public onDeleteItem?: (item: VaultItem) => void;
  public onEditItem?: (item: VaultItem) => void;
  public onToggleFavorite?: (item: VaultItem) => void;
  public onExportItem?: (item: VaultItem) => void;
  /** Called to remove a broken/missing item from the manifest. */
  public onRemoveBrokenItem?: (item: VaultItem) => void;

  /** Called when the user presses Escape to navigate back. */
  public onGoBack?: () => void;

  // -- Internal state -------------------------------------------------------
  private _item: VaultItem | null = null;
  private _getItemData: (() => Promise<Uint8Array>) | null = null;

  // -- Widget references ----------------------------------------------------
  private _headerBar!: Adw.HeaderBar;
  private _favoriteButton!: Gtk.ToggleButton;
  private _preferencesPage!: Adw.PreferencesPage;
  private _previewGroup!: Adw.PreferencesGroup;

  /** Tracks which sensitive fields are currently revealed (by field key). */
  private _revealedFields: Set<string> = new Set();

  constructor() {
    super({ title: _("Item Details") });
    this._buildUi();
    this._setupKeyboardShortcuts();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Set the item to display and begin loading preview data.
   *
   * @param item - The vault item to display.
   * @param getItemData - Async function that returns decrypted item bytes.
   */
  setItem(item: VaultItem, getItemData: () => Promise<Uint8Array>): void {
    this._item = item;
    this._getItemData = getItemData;
    this._revealedFields.clear();

    this.set_title(item.name);
    this._syncFavoriteButton();
    this._rebuildContent();
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private _buildUi(): void {
    const toolbarView = new Adw.ToolbarView();

    // -- Header bar ---------------------------------------------------------
    this._headerBar = new Adw.HeaderBar();

    // Edit button
    const editButton = new Gtk.Button({
      icon_name: "document-edit-symbolic",
    });
    editButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Edit item")],
    );
    editButton.connect("clicked", () => {
      if (this._item) this.onEditItem?.(this._item);
    });
    this._headerBar.pack_end(editButton);

    // Delete button
    const deleteButton = new Gtk.Button({
      icon_name: "user-trash-symbolic",
    });
    deleteButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Delete item")],
    );
    deleteButton.connect("clicked", () => this._showDeleteDialog());
    this._headerBar.pack_end(deleteButton);

    // Export button
    const exportButton = new Gtk.Button({
      icon_name: "document-save-symbolic",
    });
    exportButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Export item")],
    );
    exportButton.connect("clicked", () => {
      if (this._item) this.onExportItem?.(this._item);
    });
    this._headerBar.pack_end(exportButton);

    // Favorite toggle
    this._favoriteButton = new Gtk.ToggleButton({
      icon_name: "non-starred-symbolic",
    });
    this._favoriteButton.add_css_class("flat");
    this._favoriteButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Toggle favorite")],
    );
    this._favoriteButton.connect("clicked", () => {
      if (this._item) this.onToggleFavorite?.(this._item);
    });
    this._headerBar.pack_end(this._favoriteButton);

    toolbarView.add_top_bar(this._headerBar);

    // -- Preferences page (scrollable content) ------------------------------
    this._preferencesPage = new Adw.PreferencesPage();
    toolbarView.set_content(this._preferencesPage);

    this.set_child(toolbarView);
  }

  // -------------------------------------------------------------------------
  // Favorite button sync
  // -------------------------------------------------------------------------

  private _syncFavoriteButton(): void {
    if (!this._item) return;

    if (this._item.favorite) {
      this._favoriteButton.set_icon_name("starred-symbolic");
      this._favoriteButton.set_active(true);
      this._favoriteButton.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [_("Remove from favorites")],
      );
    } else {
      this._favoriteButton.set_icon_name("non-starred-symbolic");
      this._favoriteButton.set_active(false);
      this._favoriteButton.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [_("Add to favorites")],
      );
    }
  }

  // -------------------------------------------------------------------------
  // Content rebuild
  // -------------------------------------------------------------------------

  /** Clear and rebuild the preferences page for the current item. */
  private _rebuildContent(): void {
    if (!this._item) return;

    // Remove all existing groups
    // Adw.PreferencesPage doesn't have a clear method — we remove groups
    // by keeping track. Simplest approach: recreate the page.
    const toolbarView = this.get_child() as Adw.ToolbarView;
    this._preferencesPage = new Adw.PreferencesPage();
    toolbarView.set_content(this._preferencesPage);

    // Metadata group
    this._buildMetadataGroup();

    // Preview group (content depends on item type)
    this._previewGroup = new Adw.PreferencesGroup({
      title: _("Content"),
    });
    this._preferencesPage.add(this._previewGroup);

    this._loadPreview();
  }

  // -------------------------------------------------------------------------
  // Metadata group
  // -------------------------------------------------------------------------

  private _buildMetadataGroup(): void {
    const item = this._item!;

    const group = new Adw.PreferencesGroup({
      title: _("Details"),
    });

    // Category row
    const categoryRow = new Adw.ActionRow({
      title: _("Category"),
      subtitle: item.category,
    });
    categoryRow.set_activatable(false);
    const categoryIcon = new Gtk.Image({
      icon_name: "folder-symbolic",
      pixel_size: 24,
    });
    categoryRow.add_prefix(categoryIcon);
    group.add(categoryRow);

    // Tags row
    const tagsText =
      item.tags.length > 0 ? item.tags.join(", ") : _("None");
    const tagsRow = new Adw.ActionRow({
      title: _("Tags"),
      subtitle: tagsText,
    });
    tagsRow.set_activatable(false);
    group.add(tagsRow);

    // Type row
    const typeRow = new Adw.ActionRow({
      title: _("Type"),
      subtitle: item.type,
    });
    typeRow.set_activatable(false);
    group.add(typeRow);

    // Last modified row
    const dateRow = new Adw.ActionRow({
      title: _("Last Modified"),
      subtitle: formatDate(item.modifiedAt),
    });
    dateRow.set_activatable(false);
    group.add(dateRow);

    this._preferencesPage.add(group);
  }

  // -------------------------------------------------------------------------
  // Preview loading
  // -------------------------------------------------------------------------

  private _loadPreview(): void {
    const item = this._item!;

    switch (item.type) {
      case "file":
        this._loadFilePreview();
        break;
      case "record":
        this._loadRecordPreview();
        break;
      case "note":
        this._loadNotePreview();
        break;
    }
  }

  // -------------------------------------------------------------------------
  // File preview (6.1)
  // -------------------------------------------------------------------------

  private _loadFilePreview(): void {
    const item = this._item!;
    const getItemData = this._getItemData!;

    // Show a spinner while loading
    const spinner = new Gtk.Spinner({ spinning: true });
    spinner.set_halign(Gtk.Align.CENTER);
    spinner.set_valign(Gtk.Align.CENTER);
    spinner.set_margin_top(24);
    spinner.set_margin_bottom(24);
    this._previewGroup.add(spinner);

    getItemData()
      .then((data: Uint8Array) => {
        // Remove spinner
        this._previewGroup.remove(spinner);

        const mime = item.mimeType ?? "";

        if (mime.startsWith("image/")) {
          const viewer = new ImageViewer();
          viewer.setItemName(item.name);
          viewer.loadFromBytes(data);
          this._previewGroup.add(viewer);
        } else if (
          mime.startsWith("text/") ||
          TEXT_MIME_TYPES.includes(mime)
        ) {
          const viewer = new TextViewer();
          viewer.setItemName(item.name);
          viewer.loadFromBytes(data, mime);
          this._previewGroup.add(viewer);
        } else {
          this._showFileInfoFallback();
        }
      })
      .catch((e: unknown) => {
        this._previewGroup.remove(spinner);
        if (this._isFileMissingError(e)) {
          this._showMissingFileError();
        } else {
          this._showFileInfoFallback();
        }
      });
  }

  /** Show fallback info when preview is not available. */
  private _showFileInfoFallback(): void {
    const item = this._item!;

    const sizeText = item.fileSize
      ? formatFileSize(item.fileSize)
      : _("Unknown size");
    const description = item.filename
      ? `${item.filename} \u2022 ${sizeText}`
      : sizeText;

    const status = new Adw.StatusPage({
      icon_name: "document-open-symbolic",
      title: _("Preview Not Available"),
      description,
    });
    status.set_vexpand(false);
    this._previewGroup.add(status);
  }

  // -------------------------------------------------------------------------
  // Record preview (6.4)
  // -------------------------------------------------------------------------

  private _loadRecordPreview(): void {
    const item = this._item!;
    const getItemData = this._getItemData!;

    const spinner = new Gtk.Spinner({ spinning: true });
    spinner.set_halign(Gtk.Align.CENTER);
    spinner.set_margin_top(24);
    spinner.set_margin_bottom(24);
    this._previewGroup.add(spinner);

    getItemData()
      .then((data: Uint8Array) => {
        this._previewGroup.remove(spinner);

        // Parse the decrypted JSON to field values
        const decoder = new TextDecoder();
        const fields: Record<string, string> = JSON.parse(decoder.decode(data));

        // Look up the template
        const template = BUILTIN_TEMPLATES.find(
          (t) => t.id === item.templateId,
        );

        // Replace the generic preview group with a named one
        this._preferencesPage.remove(this._previewGroup);
        const recordGroup = new Adw.PreferencesGroup({
          title: template ? template.name : _("Record Fields"),
        });
        this._preferencesPage.add(recordGroup);

        if (template) {
          // Render fields in template order
          for (const field of template.fields) {
            const value = fields[field.key] ?? "";
            this._addRecordFieldRow(recordGroup, field.key, field.label, value);
          }
        } else {
          // No template — render raw key/value pairs
          for (const [key, value] of Object.entries(fields)) {
            this._addRecordFieldRow(recordGroup, key, key, value);
          }
        }
      })
      .catch(() => {
        this._previewGroup.remove(spinner);
        const errorStatus = new Adw.StatusPage({
          icon_name: "dialog-error-symbolic",
          title: _("Failed to Load Record"),
        });
        errorStatus.set_vexpand(false);
        this._previewGroup.add(errorStatus);
      });
  }

  /**
   * Add a single field row to a record group.
   *
   * Sensitive fields (password, pin, secret, cvv) are masked by default
   * with a show/hide toggle button.
   */
  private _addRecordFieldRow(
    group: Adw.PreferencesGroup,
    key: string,
    label: string,
    value: string,
  ): void {
    const sensitive = isSensitiveKey(key);
    const displayValue =
      sensitive && !this._revealedFields.has(key) ? SENSITIVE_MASK : value;

    const row = new Adw.ActionRow({
      title: label,
      subtitle: displayValue || _("Empty"),
    });
    row.set_activatable(false);

    // Copy button
    const copyButton = new Gtk.Button({
      icon_name: "edit-copy-symbolic",
      valign: Gtk.Align.CENTER,
    });
    copyButton.add_css_class("flat");
    copyButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Copy %s to clipboard").replace("%s", label)],
    );
    copyButton.connect("clicked", () => {
      copyToClipboard(value);
    });
    row.add_suffix(copyButton);

    // Show/hide toggle for sensitive fields
    if (sensitive) {
      const revealed = this._revealedFields.has(key);
      const toggleButton = new Gtk.ToggleButton({
        icon_name: revealed ? "view-reveal-symbolic" : "view-conceal-symbolic",
        active: revealed,
        valign: Gtk.Align.CENTER,
      });
      toggleButton.add_css_class("flat");
      toggleButton.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [revealed ? _("Hide value") : _("Show value")],
      );
      toggleButton.connect("clicked", () => {
        if (this._revealedFields.has(key)) {
          this._revealedFields.delete(key);
          row.set_subtitle(SENSITIVE_MASK);
          toggleButton.set_icon_name("view-conceal-symbolic");
          toggleButton.update_property(
            [Gtk.AccessibleProperty.LABEL],
            [_("Show value")],
          );
        } else {
          this._revealedFields.add(key);
          row.set_subtitle(value || _("Empty"));
          toggleButton.set_icon_name("view-reveal-symbolic");
          toggleButton.update_property(
            [Gtk.AccessibleProperty.LABEL],
            [_("Hide value")],
          );
        }
      });
      row.add_suffix(toggleButton);
    }

    group.add(row);
  }

  // -------------------------------------------------------------------------
  // Note preview (6.5)
  // -------------------------------------------------------------------------

  private _loadNotePreview(): void {
    const getItemData = this._getItemData!;

    const spinner = new Gtk.Spinner({ spinning: true });
    spinner.set_halign(Gtk.Align.CENTER);
    spinner.set_margin_top(24);
    spinner.set_margin_bottom(24);
    this._previewGroup.add(spinner);

    getItemData()
      .then((data: Uint8Array) => {
        this._previewGroup.remove(spinner);

        const decoder = new TextDecoder();
        const parsed: { title?: string; text?: string } = JSON.parse(
          decoder.decode(data),
        );
        const noteText = parsed.text ?? "";

        const scrolled = new Gtk.ScrolledWindow({
          min_content_height: 200,
          hscrollbar_policy: Gtk.PolicyType.NEVER,
          vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        });

        const textView = new Gtk.TextView({
          editable: false,
          cursor_visible: false,
          wrap_mode: Gtk.WrapMode.WORD_CHAR,
          left_margin: 12,
          right_margin: 12,
          top_margin: 12,
          bottom_margin: 12,
        });
        textView.update_property(
          [Gtk.AccessibleProperty.LABEL],
          [_("Note content")],
        );

        const buffer = textView.get_buffer();
        buffer.set_text(noteText, -1);

        scrolled.set_child(textView);
        this._previewGroup.add(scrolled);
      })
      .catch(() => {
        this._previewGroup.remove(spinner);
        const errorStatus = new Adw.StatusPage({
          icon_name: "dialog-error-symbolic",
          title: _("Failed to Load Note"),
        });
        errorStatus.set_vexpand(false);
        this._previewGroup.add(errorStatus);
      });
  }

  // -------------------------------------------------------------------------
  // Delete dialog (6.7)
  // -------------------------------------------------------------------------

  private _showDeleteDialog(): void {
    if (!this._item) return;
    const item = this._item;

    const dialog = new Adw.AlertDialog({
      heading: _("Delete %s?").replace("%s", item.name),
      body: _("This will permanently remove this item from the vault."),
    });

    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("delete", _("Delete"));
    dialog.set_default_response("cancel");
    dialog.set_close_response("cancel");
    dialog.set_response_appearance(
      "delete",
      Adw.ResponseAppearance.DESTRUCTIVE,
    );

    dialog.connect(
      "response",
      (_dialog: Adw.AlertDialog, response: string) => {
        if (response === "delete") {
          this.onDeleteItem?.(item);
        }
      },
    );

    // Present over the nearest ancestor window
    const root = this.get_root();
    dialog.present(root as Gtk.Widget);
  }

  // -------------------------------------------------------------------------
  // Keyboard shortcuts (12.2)
  // -------------------------------------------------------------------------

  /** Set up keyboard shortcuts for the item detail view. */
  private _setupKeyboardShortcuts(): void {
    const keyController = new Gtk.EventControllerKey();
    keyController.connect(
      "key-pressed",
      (
        _controller: Gtk.EventControllerKey,
        keyval: number,
      ): boolean => {
        // Escape → go back to browser (pop navigation)
        if (keyval === Gdk.KEY_Escape) {
          this.onGoBack?.();
          return true;
        }

        return false;
      },
    );
    this.add_controller(keyController);
  }

  // -------------------------------------------------------------------------
  // Missing file handling
  // -------------------------------------------------------------------------

  /** Check whether an error is an ItemFileMissingError. */
  private _isFileMissingError(e: unknown): boolean {
    if (e instanceof ItemFileMissingError) return true;
    if (e instanceof Error && e.name === "ItemFileMissingError") return true;
    return false;
  }

  /** Show an error state for items whose encrypted file is missing from disk. */
  private _showMissingFileError(): void {
    const item = this._item;

    const status = new Adw.StatusPage({
      icon_name: "dialog-warning-symbolic",
      title: _("File Missing"),
      description: _(
        "The encrypted file for this item is missing from the vault. " +
        "You can remove this broken entry from the manifest.",
      ),
    });
    status.set_vexpand(false);

    const removeButton = new Gtk.Button({
      label: _("Remove Broken Entry"),
      halign: Gtk.Align.CENTER,
    });
    removeButton.add_css_class("destructive-action");
    removeButton.add_css_class("pill");
    removeButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Remove broken entry from manifest")],
    );
    removeButton.connect("clicked", () => {
      if (item) this.onRemoveBrokenItem?.(item);
    });
    status.set_child(removeButton);

    this._previewGroup.add(status);
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const ItemDetailView = GObject.registerClass(
  { GTypeName: "ItemDetailView" },
  _ItemDetailView,
);
