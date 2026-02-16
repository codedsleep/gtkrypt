/**
 * Vault browser view for gtkrypt.
 *
 * Provides the main vault content browsing interface with search,
 * category filtering, list/grid view modes, and item management.
 * Implements phases 5.1–5.6 of the vault UI specification.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gdk from "gi://Gdk?version=4.0";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import Adw from "gi://Adw?version=1";

import type {
  VaultManifest,
  VaultItem,
  ViewMode,
} from "../models/types.js";
import {
  searchItems,
  filterByCategory,
  filterFavorites,
  filterRecent,
  sortItems,
} from "../services/search.js";
import { _, ngettext } from "../util/i18n.js";

// ---------------------------------------------------------------------------
// Add-item popover menu XML
// ---------------------------------------------------------------------------

const ADD_MENU_XML = `
<?xml version="1.0" encoding="UTF-8"?>
<interface>
<menu id='add-menu'>
  <section>
    <item>
      <attribute name='label' translatable='yes'>Add File\u2026</attribute>
      <attribute name='action'>browser.add-file</attribute>
    </item>
    <item>
      <attribute name='label' translatable='yes'>Import Files\u2026</attribute>
      <attribute name='action'>browser.bulk-import</attribute>
    </item>
    <item>
      <attribute name='label' translatable='yes'>New Record\u2026</attribute>
      <attribute name='action'>browser.add-record</attribute>
    </item>
    <item>
      <attribute name='label' translatable='yes'>New Note\u2026</attribute>
      <attribute name='action'>browser.add-note</attribute>
    </item>
  </section>
  <section>
    <item>
      <attribute name='label' translatable='yes'>Export Backup\u2026</attribute>
      <attribute name='action'>browser.export-backup</attribute>
    </item>
    <item>
      <attribute name='label' translatable='yes'>Clean Up Missing Items</attribute>
      <attribute name='action'>browser.cleanup-missing</attribute>
    </item>
  </section>
</menu>
</interface>
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of recent items to show in the "Recently Accessed" filter. */
const RECENT_LIMIT = 20;

/** Debounce delay for search input in milliseconds. */
const SEARCH_DEBOUNCE_MS = 300;

const PAGE_MARGIN = 24;
const CONTENT_MAX_WIDTH = 920;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO date string for display. */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Filter option indices (matches the order in the Gtk.DropDown model)
// ---------------------------------------------------------------------------

/** Index 0 = All Items, 1 = Favorites, 2 = Recently Accessed, 3+ = categories */
const FILTER_ALL = 0;
const FILTER_FAVORITES = 1;
const FILTER_RECENT = 2;
const FILTER_CATEGORY_OFFSET = 3;

// ---------------------------------------------------------------------------
// Vault browser implementation
// ---------------------------------------------------------------------------

class _VaultBrowser extends Adw.NavigationPage {
  // -- Internal state -------------------------------------------------------
  private _manifest: VaultManifest | null = null;
  private _currentFilter: "all" | "favorites" | "recent" | string = "all";
  private _searchQuery: string = "";
  private _searchTimeoutId: number | null = null;
  private _viewMode: ViewMode = "list";

  /** Cache of decrypted thumbnail pixbufs keyed by item ID. */
  private _thumbnailCache: Map<string, GdkPixbuf.Pixbuf> = new Map();

  /** Widgets that need thumbnail loading, keyed by item ID. */
  private _pendingThumbnails: Map<string, Gtk.Picture> = new Map();

  // -- Widget references ----------------------------------------------------
  private _headerBar!: Adw.HeaderBar;
  private _searchButton!: Gtk.ToggleButton;
  private _searchBar!: Gtk.SearchBar;
  private _searchEntry!: Gtk.SearchEntry;
  private _viewToggle!: Gtk.ToggleButton;
  private _filterDropDown!: Gtk.DropDown;
  private _resultsSummary!: Gtk.Label;
  private _filterModel!: Gtk.StringList;
  private _contentStack!: Gtk.Stack;
  private _listBox!: Gtk.ListBox;
  private _flowBox!: Gtk.FlowBox;
  private _emptyStatus!: Adw.StatusPage;
  private _listScrolled!: Gtk.ScrolledWindow;
  private _gridScrolled!: Gtk.ScrolledWindow;

  // -- Public callbacks -----------------------------------------------------
  public onLockVault?: () => void;
  public onItemSelected?: (item: VaultItem) => void;
  public onAddFile?: () => void;
  public onAddRecord?: () => void;
  public onAddNote?: () => void;
  public onViewModeChanged?: (mode: ViewMode) => void;
  public onBulkImport?: () => void;
  public onExportBackup?: () => void;
  public onSettings?: () => void;
  public onCleanupMissing?: () => void;

  /** Called when the user presses Escape to navigate back from the browser. */
  public onGoBack?: () => void;

  /** Called to load a thumbnail for an item. Returns decrypted thumbnail bytes. */
  public onLoadThumbnail?: (itemId: string) => Promise<Uint8Array>;

  /** Called to check if an item's file exists on disk. */
  public onCheckItemExists?: (itemId: string) => boolean;

  /** Tracks the items array used in the last grid rebuild for activation lookup. */
  private _gridItems: VaultItem[] = [];

  /** Reference to the add-menu button for programmatic popup. */
  private _addMenuButton!: Gtk.MenuButton;

  constructor() {
    super({ title: _("Vault") });

    const toolbarView = new Adw.ToolbarView();

    // -- Header bar (5.1) ---------------------------------------------------
    this._buildHeaderBar();
    toolbarView.add_top_bar(this._headerBar);

    // -- Main content box ---------------------------------------------------
    const mainBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
    });

    // Search and filter controls
    this._buildSearchBar();
    this._buildFilterBar();
    const filterRow = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 10,
      valign: Gtk.Align.CENTER,
    });
    this._filterDropDown.set_hexpand(true);
    filterRow.append(this._filterDropDown);
    filterRow.append(this._resultsSummary);

    const controlsBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
    });
    controlsBox.append(this._searchBar);
    controlsBox.append(filterRow);

    mainBox.append(
      new Adw.Clamp({
        maximum_size: CONTENT_MAX_WIDTH,
        margin_start: PAGE_MARGIN,
        margin_end: PAGE_MARGIN,
        margin_top: 12,
        margin_bottom: 6,
        child: controlsBox,
      }),
    );

    // Content area with stack (5.6)
    this._buildContentArea();
    mainBox.append(this._contentStack);

    toolbarView.set_content(mainBox);
    this.set_child(toolbarView);

    // -- Register actions ---------------------------------------------------
    this._registerActions();

    // -- Keyboard shortcuts (12.2) ------------------------------------------
    this._setupKeyboardShortcuts();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Initialize the browser with vault data.
   *
   * @param manifest - The decrypted vault manifest.
   * @param viewMode - The user's preferred view mode.
   */
  setVaultState(manifest: VaultManifest, viewMode: ViewMode): void {
    this._manifest = manifest;
    this._viewMode = viewMode;

    // Clear thumbnail cache for new vault state
    this._thumbnailCache.clear();
    this._pendingThumbnails.clear();

    // Update the page title to the vault name
    this.set_title(manifest.name);

    // Reset filter and search
    this._currentFilter = "all";
    this._searchQuery = "";
    this._searchEntry.set_text("");
    this._searchBar.set_search_mode(false);
    this._searchButton.set_active(false);

    // Sync view mode toggle
    this._syncViewToggle();

    // Rebuild filter model with categories
    this._rebuildFilterModel();

    // Rebuild item views
    this._rebuildItemViews();
  }

  /** Re-render items from the current manifest state. */
  refreshItems(): void {
    this._rebuildItemViews();
  }

  // -------------------------------------------------------------------------
  // Header bar construction (5.1)
  // -------------------------------------------------------------------------

  private _buildHeaderBar(): void {
    this._headerBar = new Adw.HeaderBar();

    // Lock button (start)
    const lockButton = new Gtk.Button({
      icon_name: "system-lock-screen-symbolic",
    });
    lockButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Lock vault")],
    );
    lockButton.connect("clicked", () => this.onLockVault?.());
    this._headerBar.pack_start(lockButton);

    // Settings button (start)
    const settingsButton = new Gtk.Button({
      icon_name: "emblem-system-symbolic",
    });
    settingsButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Vault settings")],
    );
    settingsButton.connect("clicked", () => this.onSettings?.());
    this._headerBar.pack_start(settingsButton);

    // Search toggle (end)
    this._searchButton = new Gtk.ToggleButton({
      icon_name: "system-search-symbolic",
    });
    this._searchButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Search items")],
    );
    this._headerBar.pack_end(this._searchButton);

    // Add menu button (end)
    this._addMenuButton = this._buildAddMenuButton();
    this._addMenuButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Add to vault")],
    );
    this._headerBar.pack_end(this._addMenuButton);

    // View toggle (end)
    this._viewToggle = new Gtk.ToggleButton({
      icon_name: "view-list-symbolic",
    });
    this._viewToggle.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Switch between grid and list view")],
    );
    this._viewToggle.connect("clicked", () => this._onViewToggle());
    this._headerBar.pack_end(this._viewToggle);
  }

  /** Build the add-item menu button from XML. */
  private _buildAddMenuButton(): Gtk.MenuButton {
    const builder = new Gtk.Builder();
    builder.add_from_string(ADD_MENU_XML, ADD_MENU_XML.length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @girs type mismatch
    const menuModel = builder.get_object("add-menu");

    const button = new Gtk.MenuButton();
    button.set_menu_model(menuModel as any);
    button.set_icon_name("list-add-symbolic");
    return button;
  }

  // -------------------------------------------------------------------------
  // Actions registration (5.1)
  // -------------------------------------------------------------------------

  private _registerActions(): void {
    const actionGroup = new Gio.SimpleActionGroup();

    const addFileAction = Gio.SimpleAction.new("add-file", null);
    addFileAction.connect("activate", () => this.onAddFile?.());
    actionGroup.add_action(addFileAction);

    const addRecordAction = Gio.SimpleAction.new("add-record", null);
    addRecordAction.connect("activate", () => this.onAddRecord?.());
    actionGroup.add_action(addRecordAction);

    const addNoteAction = Gio.SimpleAction.new("add-note", null);
    addNoteAction.connect("activate", () => this.onAddNote?.());
    actionGroup.add_action(addNoteAction);

    const bulkImportAction = Gio.SimpleAction.new("bulk-import", null);
    bulkImportAction.connect("activate", () => this.onBulkImport?.());
    actionGroup.add_action(bulkImportAction);

    const exportBackupAction = Gio.SimpleAction.new("export-backup", null);
    exportBackupAction.connect("activate", () => this.onExportBackup?.());
    actionGroup.add_action(exportBackupAction);

    const cleanupMissingAction = Gio.SimpleAction.new("cleanup-missing", null);
    cleanupMissingAction.connect("activate", () => this.onCleanupMissing?.());
    actionGroup.add_action(cleanupMissingAction);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @girs type mismatch
    (this as any).insert_action_group("browser", actionGroup);
  }

  // -------------------------------------------------------------------------
  // Search bar construction (5.4)
  // -------------------------------------------------------------------------

  private _buildSearchBar(): void {
    this._searchEntry = new Gtk.SearchEntry({
      placeholder_text: _("Search items\u2026"),
      hexpand: true,
    });
    this._searchEntry.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Search vault items")],
    );

    this._searchBar = new Gtk.SearchBar({
      child: this._searchEntry,
    });
    this._searchBar.connect_entry(this._searchEntry);

    // Connect search toggle button to search bar
    this._searchButton.connect("toggled", () => {
      this._searchBar.set_search_mode(this._searchButton.get_active());
      if (this._searchButton.get_active()) {
        this._searchEntry.grab_focus();
      }
    });

    // Debounced search on text change
    this._searchEntry.connect("search-changed", () => {
      this._onSearchChanged();
    });
  }

  /** Handle search text changes with debounce. */
  private _onSearchChanged(): void {
    // Cancel previous timeout
    if (this._searchTimeoutId !== null) {
      GLib.source_remove(this._searchTimeoutId);
      this._searchTimeoutId = null;
    }

    this._searchTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      SEARCH_DEBOUNCE_MS,
      () => {
        this._searchTimeoutId = null;
        this._searchQuery = this._searchEntry.get_text();
        this._rebuildItemViews();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  // -------------------------------------------------------------------------
  // Category filter bar construction (5.5)
  // -------------------------------------------------------------------------

  private _buildFilterBar(): void {
    this._filterModel = Gtk.StringList.new([_("All Items")]);

    this._filterDropDown = new Gtk.DropDown({
      model: this._filterModel,
    });
    this._filterDropDown.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [_("Filter items by category")],
    );

    this._resultsSummary = new Gtk.Label({
      label: _("0 items"),
      halign: Gtk.Align.END,
      valign: Gtk.Align.CENTER,
      css_classes: ["dim-label", "caption"],
    });

    this._filterDropDown.connect("notify::selected", () => {
      this._onFilterChanged();
    });
  }

  /** Rebuild the filter dropdown model with current categories. */
  private _rebuildFilterModel(): void {
    if (!this._manifest) return;

    const items = this._manifest.items;
    const categories = this._manifest.categories;

    // Count items per bucket
    const allCount = items.length;
    const favCount = items.filter((i) => i.favorite).length;
    const recentCount = Math.min(items.length, RECENT_LIMIT);

    // Build new model
    const labels: string[] = [
      `${_("All Items")} (${allCount})`,
      `${_("Favorites")} (${favCount})`,
      `${_("Recently Accessed")} (${recentCount})`,
    ];

    for (const cat of categories) {
      const catCount = items.filter((i) => i.category === cat.id).length;
      labels.push(`${cat.label} (${catCount})`);
    }

    // Replace model contents
    this._filterModel.splice(0, this._filterModel.get_n_items(), labels);

    // Reset selection to "All Items"
    this._filterDropDown.set_selected(FILTER_ALL);
  }

  /** Handle filter dropdown selection changes. */
  private _onFilterChanged(): void {
    const selected = this._filterDropDown.get_selected();

    if (selected === FILTER_ALL) {
      this._currentFilter = "all";
    } else if (selected === FILTER_FAVORITES) {
      this._currentFilter = "favorites";
    } else if (selected === FILTER_RECENT) {
      this._currentFilter = "recent";
    } else if (this._manifest) {
      const catIndex = selected - FILTER_CATEGORY_OFFSET;
      if (catIndex >= 0 && catIndex < this._manifest.categories.length) {
        this._currentFilter = this._manifest.categories[catIndex].id;
      }
    }

    this._rebuildItemViews();
  }

  // -------------------------------------------------------------------------
  // Content area construction (5.2, 5.3, 5.6)
  // -------------------------------------------------------------------------

  private _buildContentArea(): void {
    this._contentStack = new Gtk.Stack({
      vexpand: true,
      hexpand: true,
      transition_type: Gtk.StackTransitionType.CROSSFADE,
    });

    // List view (5.2)
    this._listBox = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
    });
    this._listBox.add_css_class("boxed-list");

    const listClamp = new Adw.Clamp({
      maximum_size: CONTENT_MAX_WIDTH,
      margin_start: PAGE_MARGIN,
      margin_end: PAGE_MARGIN,
      margin_top: 6,
      margin_bottom: PAGE_MARGIN,
      child: this._listBox,
    });

    this._listScrolled = new Gtk.ScrolledWindow({
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      child: listClamp,
    });
    this._contentStack.add_named(this._listScrolled, "list");

    // Grid view (5.3)
    this._flowBox = new Gtk.FlowBox({
      homogeneous: true,
      min_children_per_line: 2,
      max_children_per_line: 6,
      selection_mode: Gtk.SelectionMode.SINGLE,
      row_spacing: 12,
      column_spacing: 12,
    });

    // Connect grid activation once (handler uses _gridItems for lookup)
    this._flowBox.connect("child-activated", (_fb, flowBoxChild) => {
      if (!flowBoxChild) return;
      let index = 0;
      let cursor = this._flowBox.get_first_child();
      while (cursor && cursor !== flowBoxChild) {
        cursor = cursor.get_next_sibling();
        index++;
      }
      if (index < this._gridItems.length) {
        this.onItemSelected?.(this._gridItems[index]);
      }
    });

    const gridClamp = new Adw.Clamp({
      maximum_size: CONTENT_MAX_WIDTH,
      margin_start: PAGE_MARGIN,
      margin_end: PAGE_MARGIN,
      margin_top: 6,
      margin_bottom: PAGE_MARGIN,
      child: this._flowBox,
    });

    this._gridScrolled = new Gtk.ScrolledWindow({
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      child: gridClamp,
    });
    this._contentStack.add_named(this._gridScrolled, "grid");

    // Empty state
    this._emptyStatus = new Adw.StatusPage({
      icon_name: "system-search-symbolic",
      title: _("No Results"),
      description: _("Try a different search term or filter"),
    });
    this._contentStack.add_named(
      new Adw.Clamp({
        maximum_size: CONTENT_MAX_WIDTH,
        margin_start: PAGE_MARGIN,
        margin_end: PAGE_MARGIN,
        margin_top: PAGE_MARGIN,
        margin_bottom: PAGE_MARGIN,
        child: this._emptyStatus,
      }),
      "empty",
    );

    // Set initial visible child
    this._contentStack.set_visible_child_name("list");
  }

  // -------------------------------------------------------------------------
  // View mode toggle (5.6)
  // -------------------------------------------------------------------------

  private _syncViewToggle(): void {
    if (this._viewMode === "grid") {
      this._viewToggle.set_icon_name("view-grid-symbolic");
      this._viewToggle.set_active(true);
    } else {
      this._viewToggle.set_icon_name("view-list-symbolic");
      this._viewToggle.set_active(false);
    }
    this._setStackViewMode();
  }

  private _onViewToggle(): void {
    if (this._viewMode === "list") {
      this._viewMode = "grid";
      this._viewToggle.set_icon_name("view-grid-symbolic");
    } else {
      this._viewMode = "list";
      this._viewToggle.set_icon_name("view-list-symbolic");
    }

    this._setStackViewMode();
    this.onViewModeChanged?.(this._viewMode);
  }

  private _setStackViewMode(): void {
    // Only switch between list/grid if we have items to show.
    // If the empty page is currently visible, leave it.
    const currentName = this._contentStack.get_visible_child_name();
    if (currentName === "empty") return;

    this._contentStack.set_visible_child_name(this._viewMode);
  }

  // -------------------------------------------------------------------------
  // Item rendering
  // -------------------------------------------------------------------------

  /**
   * Master rebuild method — called whenever filter, search, or sort changes.
   *
   * 1. Get base items from manifest
   * 2. Apply category filter
   * 3. Apply search query
   * 4. Apply sort order
   * 5. Rebuild both list and grid views
   * 6. Show "No results" if empty
   */
  private _rebuildItemViews(): void {
    if (!this._manifest) return;

    // Step 1–2: Get filtered items
    let items: VaultItem[];

    switch (this._currentFilter) {
      case "all":
        items = [...this._manifest.items];
        break;
      case "favorites":
        items = filterFavorites(this._manifest);
        break;
      case "recent":
        items = filterRecent(this._manifest, RECENT_LIMIT);
        break;
      default:
        // Category filter
        items = filterByCategory(this._manifest, this._currentFilter);
        break;
    }

    // Step 3: Apply search
    if (this._searchQuery.length > 0) {
      // Create a temporary manifest-like object for searchItems
      const tempManifest: VaultManifest = {
        ...this._manifest,
        items,
      };
      items = searchItems(tempManifest, this._searchQuery);
    }

    // Step 4: Sort
    items = sortItems(items, this._manifest.settings.sortOrder);

    // Step 5: Check for missing item files
    const missingIds = new Set<string>();
    if (this.onCheckItemExists) {
      for (const item of items) {
        if (!this.onCheckItemExists(item.id)) {
          missingIds.add(item.id);
        }
      }
    }

    // Step 6: Rebuild views
    this._rebuildListView(items, missingIds);
    this._rebuildGridView(items, missingIds);
    this._resultsSummary.set_label(
      ngettext("%d item", "%d items", items.length).replace(
        "%d",
        String(items.length),
      ),
    );

    // Step 7: Show empty state if no results
    if (items.length === 0) {
      this._contentStack.set_visible_child_name("empty");
    } else {
      this._contentStack.set_visible_child_name(this._viewMode);
    }
  }

  // -------------------------------------------------------------------------
  // List view rendering (5.2)
  // -------------------------------------------------------------------------

  /** Clear all children from a Gtk.ListBox. */
  private _clearListBox(): void {
    let child = this._listBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._listBox.remove(child);
      child = next;
    }
  }

  /** Rebuild the list view with the given items. */
  private _rebuildListView(items: VaultItem[], missingIds: Set<string>): void {
    this._clearListBox();

    for (const item of items) {
      const row = this._createListRow(item, missingIds.has(item.id));
      this._listBox.append(row);
    }
  }

  /** Create a single list row for an item. */
  private _createListRow(item: VaultItem, isMissing: boolean): Adw.ActionRow {
    // Look up category for icon and label
    const category = this._manifest?.categories.find(
      (c) => c.id === item.category,
    );
    const categoryIcon = category?.icon ?? "folder-symbolic";
    const categoryLabel = category?.label ?? item.category;

    // Build subtitle: category + tags
    let subtitle = categoryLabel;
    if (item.tags.length > 0) {
      subtitle += ` \u2022 ${item.tags.join(", ")}`;
    }
    if (isMissing) {
      subtitle += ` \u2022 ${_("File missing")}`;
    }

    const row = new Adw.ActionRow({
      title: isMissing ? `${item.name}` : item.name,
      subtitle,
      activatable: true,
    });
    row.update_property(
      [Gtk.AccessibleProperty.DESCRIPTION],
      [_("%s, %s").replace("%s", item.name).replace("%s", categoryLabel)],
    );

    // Prefix: category icon (or error icon for missing items)
    const prefixIcon = new Gtk.Image({
      icon_name: isMissing ? "dialog-warning-symbolic" : categoryIcon,
      pixel_size: 24,
    });
    if (isMissing) {
      prefixIcon.add_css_class("warning");
    }
    row.add_prefix(prefixIcon);

    // Suffix: favorite star button
    const starButton = new Gtk.ToggleButton({
      icon_name: item.favorite
        ? "starred-symbolic"
        : "non-starred-symbolic",
      valign: Gtk.Align.CENTER,
    });
    starButton.add_css_class("flat");
    starButton.set_active(item.favorite);
    starButton.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [item.favorite ? _("Remove from favorites") : _("Add to favorites")],
    );
    row.add_suffix(starButton);

    // Suffix: formatted date
    const dateLabel = new Gtk.Label({
      label: formatDate(item.modifiedAt),
      valign: Gtk.Align.CENTER,
    });
    dateLabel.add_css_class("dim-label");
    dateLabel.add_css_class("caption");
    row.add_suffix(dateLabel);

    // Row activation
    row.connect("activated", () => {
      this.onItemSelected?.(item);
    });

    return row;
  }

  // -------------------------------------------------------------------------
  // Grid view rendering (5.3)
  // -------------------------------------------------------------------------

  /** Clear all children from a Gtk.FlowBox. */
  private _clearFlowBox(): void {
    this._pendingThumbnails.clear();
    let child = this._flowBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._flowBox.remove(child);
      child = next;
    }
  }

  /** Rebuild the grid view with the given items. */
  private _rebuildGridView(items: VaultItem[], missingIds: Set<string>): void {
    this._clearFlowBox();
    this._gridItems = items;

    for (const item of items) {
      const child = this._createGridChild(item, missingIds.has(item.id));
      this._flowBox.append(child);
    }

    // Schedule lazy thumbnail loading
    this._loadPendingThumbnails();
  }

  /** Load thumbnails for items that have them but aren't cached yet. */
  private _loadPendingThumbnails(): void {
    if (!this.onLoadThumbnail || this._pendingThumbnails.size === 0) return;

    const entries = [...this._pendingThumbnails.entries()];
    this._pendingThumbnails.clear();

    let index = 0;

    const loadNext = (): boolean => {
      if (index >= entries.length) return GLib.SOURCE_REMOVE;

      const [itemId, picture] = entries[index];
      index++;

      if (this._thumbnailCache.has(itemId)) {
        // Already cached (e.g. from concurrent load)
        const pixbuf = this._thumbnailCache.get(itemId)!;
        const texture = Gdk.Texture.new_for_pixbuf(pixbuf);
        picture.set_paintable(texture);
        return index < entries.length ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
      }

      // Load async
      this.onLoadThumbnail!(itemId).then((thumbBytes) => {
        try {
          const gbytes = new GLib.Bytes(thumbBytes);
          const stream = Gio.MemoryInputStream.new_from_bytes(gbytes);
          const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
          stream.close(null);

          this._thumbnailCache.set(itemId, pixbuf);

          // Update the picture widget if still in the tree
          const texture = Gdk.Texture.new_for_pixbuf(pixbuf);
          picture.set_paintable(texture);

          // Replace placeholder icon in the overlay parent
          const parent = picture.get_parent();
          if (parent instanceof Gtk.Overlay) {
            // The overlay's child is currently the placeholder icon
            // Replace it with the picture
            const currentChild = parent.get_child();
            if (currentChild && currentChild !== picture) {
              parent.set_child(picture);
            }
          }
        } catch {
          // Failed to load thumbnail — keep placeholder
        }
      }).catch(() => {
        // Failed to decrypt thumbnail — keep placeholder
      });

      return index < entries.length ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
    };

    // Use idle scheduling to avoid blocking the UI
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, loadNext);
  }

  /** Create a single grid child widget for an item. */
  private _createGridChild(item: VaultItem, isMissing: boolean): Gtk.Widget {
    const category = this._manifest?.categories.find(
      (c) => c.id === item.category,
    );
    const categoryIcon = isMissing
      ? "dialog-warning-symbolic"
      : (category?.icon ?? "folder-symbolic");

    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      margin_start: 12,
      margin_end: 12,
      margin_top: 12,
      margin_bottom: 12,
    });
    box.set_size_request(168, -1);

    // Thumbnail or category icon
    let iconWidget: Gtk.Widget;

    if (item.hasThumbnail && this._thumbnailCache.has(item.id)) {
      // Use cached thumbnail
      const pixbuf = this._thumbnailCache.get(item.id)!;
      const texture = Gdk.Texture.new_for_pixbuf(pixbuf);
      const picture = new Gtk.Picture({
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
      });
      picture.set_paintable(texture);
      picture.set_size_request(64, 64);
      picture.set_can_shrink(true);
      picture.set_keep_aspect_ratio(true);
      iconWidget = picture;
    } else if (item.hasThumbnail) {
      // Placeholder that will be replaced when thumbnail loads
      const picture = new Gtk.Picture({
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
      });
      picture.set_size_request(64, 64);
      // Show category icon as placeholder while loading
      const placeholderIcon = new Gtk.Image({
        icon_name: categoryIcon,
        pixel_size: 48,
      });
      placeholderIcon.add_css_class("dim-label");
      // We'll use the picture widget but track it for lazy loading
      this._pendingThumbnails.set(item.id, picture);
      iconWidget = placeholderIcon;
    } else {
      const icon = new Gtk.Image({
        icon_name: categoryIcon,
        pixel_size: 48,
      });
      icon.add_css_class("dim-label");
      iconWidget = icon;
    }

    // Overlay container for icon/thumbnail + optional star
    const overlay = new Gtk.Overlay({ child: iconWidget });

    if (item.favorite) {
      const starIcon = new Gtk.Image({
        icon_name: "starred-symbolic",
        pixel_size: 16,
        halign: Gtk.Align.END,
        valign: Gtk.Align.START,
      });
      starIcon.add_css_class("accent");
      overlay.add_overlay(starIcon);
    }

    box.append(overlay);

    // Item name label (ellipsize)
    const nameLabel = new Gtk.Label({
      label: item.name,
      ellipsize: 3, // Pango.EllipsizeMode.END
      max_width_chars: 16,
      halign: Gtk.Align.CENTER,
    });
    box.append(nameLabel);

    // Set accessible label with category and type context
    const categoryLabel = category?.label ?? item.category;
    const accessibleDesc = isMissing
      ? _("%s, %s, file missing")
          .replace("%s", item.name)
          .replace("%s", categoryLabel)
      : _("%s, %s, %s")
          .replace("%s", item.name)
          .replace("%s", categoryLabel)
          .replace("%s", item.type);
    box.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [accessibleDesc],
    );

    return box;
  }

  // -------------------------------------------------------------------------
  // Keyboard shortcuts (12.2)
  // -------------------------------------------------------------------------

  /** Set up keyboard shortcuts for vault browser navigation. */
  private _setupKeyboardShortcuts(): void {
    const keyController = new Gtk.EventControllerKey();
    keyController.connect(
      "key-pressed",
      (
        _controller: Gtk.EventControllerKey,
        keyval: number,
        _keycode: number,
        state: Gdk.ModifierType,
      ): boolean => {
        const ctrl =
          (state & Gdk.ModifierType.CONTROL_MASK) ===
          Gdk.ModifierType.CONTROL_MASK;

        // Ctrl+F → focus search entry
        if (ctrl && keyval === Gdk.KEY_f) {
          this._searchButton.set_active(true);
          this._searchBar.set_search_mode(true);
          this._searchEntry.grab_focus();
          return true;
        }

        // Ctrl+N → open "add item" menu
        if (ctrl && keyval === Gdk.KEY_n) {
          this._addMenuButton.popup();
          return true;
        }

        // Escape → clear search if active, otherwise go back
        if (keyval === Gdk.KEY_Escape) {
          if (this._searchBar.get_search_mode()) {
            this._searchEntry.set_text("");
            this._searchBar.set_search_mode(false);
            this._searchButton.set_active(false);
            return true;
          }
          // Navigate back (lock vault / pop navigation)
          this.onGoBack?.();
          return true;
        }

        return false;
      },
    );
    this.add_controller(keyController);
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Cancel any pending search timeout when the page is destroyed. */
  vfunc_unroot(): void {
    if (this._searchTimeoutId !== null) {
      GLib.source_remove(this._searchTimeoutId);
      this._searchTimeoutId = null;
    }
    super.vfunc_unroot();
  }
}

// ---------------------------------------------------------------------------
// GObject registration
// ---------------------------------------------------------------------------

export const VaultBrowser = GObject.registerClass(
  { GTypeName: "VaultBrowser" },
  _VaultBrowser,
);
