# gtkrypt Vault — Project Scope & Development Checklist

> Transform gtkrypt from a file encryption tool into a personal data vault.

---

## Overview

**gtkrypt** currently encrypts and decrypts individual files using AES-256-GCM with Argon2id key derivation. This scope extends it into a **personal data vault** — a secure, organized store for sensitive documents (passport scans, bank details, medical records, etc.) with in-app viewing, structured data entry, search, and import/export capabilities.

### Design philosophy

- **Build on existing crypto** — the Rust backend and `.gtkrypt` container format remain the foundation
- **Vault = directory + encrypted manifest** — no database, no daemon, just files
- **Unlock once, work freely** — master passphrase unlocks the vault for a session
- **Never write plaintext to disk** — previews are in-memory only
- **Preserve standalone mode** — the existing encrypt/decrypt-files workflow remains fully functional alongside vault mode

### Key decisions

| Item | Decision |
|---|---|
| Vault storage | Directory at `~/.local/share/gtkrypt/vaults/<name>/` |
| Manifest | Encrypted JSON (`.gtkrypt` container) tracking all items |
| Item storage | Individual `.gtkrypt` files keyed by UUID |
| Master key | Argon2id-derived from vault passphrase, held in memory while unlocked |
| Item encryption | Uses existing `gtkrypt-crypto` encrypt/decrypt subprocess |
| Structured data | JSON records encrypted as `.gtkrypt` containers |
| Navigation | Adw.NavigationView stack (vault list / vault browser / item detail) |
| Categories | Predefined set + user-defined custom categories |
| Templates | Built-in templates for common document types |

### Non-goals (deferred)

- Cloud sync / multi-device
- FUSE filesystem / vault mounting
- Shared vaults / multi-user access
- Hardware security module (HSM) integration
- Biometric unlock

---

## Architecture (vault mode)

```
┌──────────────────────────────────────────────────────┐
│                    GJS Process                        │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  Navigation   │  │  Vault Views │  │  Services   │ │
│  │  (Adw.Nav)   │→ │  (GTK4/Adw)  │→ │            │ │
│  │              │  │              │  │ vault.ts    │ │
│  │ - Vault List │  │ - Browser    │  │ manifest.ts │ │
│  │ - Browser    │  │ - Detail     │  │ crypto.ts   │ │
│  │ - Detail     │  │ - Editor     │  │ io.ts       │ │
│  │ - Editor     │  │ - Viewer     │  │ search.ts   │ │
│  └──────────────┘  └──────────────┘  └──────┬─────┘ │
│                                             │        │
│                                   Gio.Subprocess     │
│                                             │        │
└─────────────────────────────────────────────┼────────┘
                                              │
                                       ┌──────▼──────┐
                                       │ Rust binary │
                                       │ gtkrypt-    │
                                       │ crypto      │
                                       └─────────────┘
```

### Vault directory layout

```
~/.local/share/gtkrypt/vaults/
└── my-vault/
    ├── manifest.gtkrypt     # Encrypted JSON: item index, categories, settings
    ├── manifest.salt        # Argon2id salt for the vault (plaintext, 16 bytes)
    ├── items/
    │   ├── a1b2c3d4.gtkrypt  # Encrypted file (scan, document)
    │   ├── e5f6g7h8.gtkrypt  # Encrypted structured record (JSON)
    │   └── ...
    └── thumbs/
        ├── a1b2c3d4.gtkrypt  # Encrypted thumbnail (optional)
        └── ...
```

### Manifest structure (decrypted JSON)

```typescript
interface VaultManifest {
  version: 1;
  name: string;
  createdAt: string;                // ISO 8601
  modifiedAt: string;               // ISO 8601
  kdfPreset: KdfPreset;             // Vault-wide KDF strength
  categories: CategoryDef[];        // Available categories
  items: VaultItem[];               // All items in the vault
  settings: VaultSettings;          // Vault preferences
}

interface CategoryDef {
  id: string;                       // Slug: "passport", "banking", etc.
  label: string;                    // Display name
  icon: string;                     // GTK icon name
  builtin: boolean;                 // true = cannot be deleted
}

interface VaultItem {
  id: string;                       // UUID v4
  type: "file" | "record" | "note"; // What kind of item
  name: string;                     // User-visible title
  category: string;                 // Category ID
  tags: string[];                   // Free-form tags
  createdAt: string;                // ISO 8601
  modifiedAt: string;               // ISO 8601
  accessedAt: string;               // ISO 8601 (for "recently accessed")
  favorite: boolean;                // Pinned to favorites
  filename?: string;                // Original filename (file items)
  mimeType?: string;                // MIME type (file items)
  fileSize?: number;                // Original file size in bytes
  templateId?: string;              // Template used (record items)
  fields?: Record<string, string>;  // Structured fields (record items)
  notes?: string;                   // Plain text notes (note items)
  hasThumbnail?: boolean;           // Whether a thumbnail exists
}

interface VaultSettings {
  autoLockMinutes: number;          // 0 = never
  defaultCategory: string;          // Category ID for new items
  sortOrder: "name" | "date" | "category";
  viewMode: "grid" | "list";
}
```

### Data flow: adding a file to the vault

```
User drops/picks file
  ↓
App reads file metadata (name, size, MIME type)
  ↓
User assigns category, tags, name (optional edit dialog)
  ↓
Generate UUID for item
  ↓
Encrypt file → items/<uuid>.gtkrypt (using vault passphrase)
  ↓
(Optional) Generate + encrypt thumbnail → thumbs/<uuid>.gtkrypt
  ↓
Add VaultItem entry to in-memory manifest
  ↓
Re-encrypt + save manifest.gtkrypt
```

### Data flow: viewing a vault item

```
User clicks item in vault browser
  ↓
Decrypt items/<uuid>.gtkrypt → in-memory buffer (never written to disk)
  ↓
Determine viewer by MIME type:
  - image/* → Gtk.Picture from GdkPixbuf loaded from memory
  - text/* → Gtk.TextView with buffer
  - application/pdf → (future: WebKitWebView or external)
  - record/note → render structured fields or note text
  ↓
Update accessedAt timestamp in manifest
  ↓
Display in detail view panel
```

---

## Project structure (new/modified files)

```
src/
├── models/
│   ├── types.ts              # (EXTEND) Add vault types
│   ├── errors.ts             # (EXTEND) Add vault error classes
│   ├── templates.ts          # NEW: Built-in document templates
│   └── categories.ts         # NEW: Default category definitions
├── services/
│   ├── vault.ts              # NEW: Vault lifecycle (create, open, lock, close)
│   ├── manifest.ts           # NEW: Manifest read/write/search
│   ├── thumbnail.ts          # NEW: Thumbnail generation from in-memory data
│   ├── clipboard.ts          # NEW: Clipboard write + auto-clear timer
│   ├── crypto.ts             # (EXTEND) Add encrypt-to-memory, decrypt-to-memory
│   └── io.ts                 # (EXTEND) Add vault directory helpers
├── ui/
│   ├── window.ts             # (MODIFY) Add vault mode + navigation stack
│   ├── vaultListView.ts      # NEW: List/create/delete vaults
│   ├── vaultUnlockDialog.ts  # NEW: Passphrase dialog for vault unlock
│   ├── vaultBrowser.ts       # NEW: Browse items (grid/list), filter, search
│   ├── itemDetailView.ts     # NEW: View single item (metadata + preview)
│   ├── itemEditorDialog.ts   # NEW: Add/edit item (name, category, tags, fields)
│   ├── recordEditorDialog.ts # NEW: Create/edit structured records
│   ├── noteEditorDialog.ts   # NEW: Create/edit encrypted notes
│   ├── imageViewer.ts        # NEW: In-memory image viewer widget
│   ├── textViewer.ts         # NEW: In-memory text viewer widget
│   ├── importDialog.ts       # NEW: Bulk import wizard
│   ├── exportDialog.ts       # NEW: Export/backup dialog
│   ├── categoryManager.ts    # NEW: Manage custom categories
│   └── settingsDialog.ts     # NEW: Vault settings (auto-lock, defaults)
└── util/
    └── uuid.ts               # NEW: UUID v4 generation
```

---

## Development Phases & Checklist

### Phase 1: Vault data model & core types

> Goal: All vault-related types, categories, and templates compile. No UI yet.

- [x] **1.1 Define vault types in `src/models/types.ts`**
  - Add `VaultManifest`, `VaultItem`, `VaultSettings`, `CategoryDef` interfaces
  - Add `VaultItemType = "file" | "record" | "note"` type
  - Add `SortOrder = "name" | "date" | "category"` type
  - Add `ViewMode = "grid" | "list"` type
  - _Acceptance: `npm run check` passes with no errors_

- [x] **1.2 Define vault error classes in `src/models/errors.ts`**
  - `VaultLockedError` — operation attempted while vault is locked
  - `VaultNotFoundError` — vault directory does not exist
  - `VaultCorruptError` — manifest failed to parse after decryption
  - `ItemNotFoundError` — item UUID not in manifest
  - `DuplicateVaultError` — vault with same name already exists
  - Each with a `userMessage` property
  - _Acceptance: errors compile, each has correct `userMessage`_

- [x] **1.3 Define default categories in `src/models/categories.ts`**
  - Built-in categories (all with `builtin: true`):
    - `identity` — "Identity Documents" — `contact-new-symbolic`
    - `banking` — "Banking & Finance" — `wallet-symbolic` (or `money-symbolic`)
    - `medical` — "Medical Records" — `heart-filled-symbolic`
    - `insurance` — "Insurance" — `shield-safe-symbolic`
    - `legal` — "Legal Documents" — `text-x-generic-symbolic`
    - `education` — "Education" — `school-symbolic`
    - `travel` — "Travel" — `airplane-symbolic` (or `map-symbolic`)
    - `property` — "Property & Housing" — `building-symbolic`
    - `vehicle` — "Vehicles" — `car-symbolic`
    - `other` — "Other" — `folder-symbolic`
  - Export `DEFAULT_CATEGORIES: CategoryDef[]`
  - _Acceptance: array compiles and has 10 entries_

- [x] **1.4 Define document templates in `src/models/templates.ts`**
  - Template interface:
    ```typescript
    interface DocumentTemplate {
      id: string;
      name: string;
      category: string;        // Default category ID
      icon: string;
      fields: TemplateField[];
    }
    interface TemplateField {
      key: string;
      label: string;
      type: "text" | "date" | "number" | "multiline";
      required: boolean;
      placeholder?: string;
    }
    ```
  - Built-in templates:
    - **Passport**: number, full name, nationality, date of birth, issue date, expiry date, issuing authority
    - **National ID**: number, full name, date of birth, issue date, expiry date
    - **Driver's License**: number, full name, category/class, issue date, expiry date, issuing state
    - **Credit/Debit Card**: card name, card number, cardholder name, expiry date, bank name (NO CVV — intentional, too dangerous to store)
    - **Bank Account**: bank name, account holder, account number, routing/sort code, IBAN, SWIFT/BIC
    - **Medical Record**: patient name, date, provider, diagnosis/condition, notes
    - **Insurance Policy**: provider, policy number, type (health/auto/home/life), start date, end date, coverage amount
    - **Login Credentials**: service name, username/email, password, URL, notes
    - **Wi-Fi Network**: network name (SSID), password, security type
  - _Acceptance: templates compile, each has at least 3 fields_

- [x] **1.5 Implement UUID v4 generation in `src/util/uuid.ts`**
  - Use `GLib.uuid_string_random()` if available, otherwise manual implementation using crypto random bytes
  - Export `generateUuid(): string`
  - _Acceptance: generates valid UUID v4 strings, no duplicates in 10,000 calls_

---

### Phase 2: Vault service layer

> Goal: Vault lifecycle operations work (create, unlock, lock, save manifest) using the existing Rust crypto backend. No UI.

- [x] **2.1 Implement vault directory helpers in `src/services/io.ts`**
  - `getVaultsBaseDir(): string` — returns `~/.local/share/gtkrypt/vaults/`
  - `getVaultDir(name: string): string` — returns path for a named vault
  - `ensureVaultDir(name: string): void` — creates vault dir + `items/` + `thumbs/` subdirs
  - `listVaultNames(): string[]` — list subdirectories under vaults base dir
  - `deleteVaultDir(name: string): void` — recursively delete a vault directory
  - _Acceptance: functions create/list/delete vault directories correctly_

- [x] **2.2 Implement manifest service in `src/services/manifest.ts`**
  - `createEmptyManifest(name: string, kdfPreset: KdfPreset): VaultManifest` — returns a new manifest with defaults
  - `serializeManifest(manifest: VaultManifest): Uint8Array` — JSON encode to bytes
  - `deserializeManifest(bytes: Uint8Array): VaultManifest` — JSON decode from bytes, validate version
  - `saveManifest(vaultDir: string, manifest: VaultManifest, passphrase: string): Promise<void>` — encrypt + write `manifest.gtkrypt`
  - `loadManifest(vaultDir: string, passphrase: string): Promise<VaultManifest>` — read + decrypt `manifest.gtkrypt`
  - Uses the existing `encrypt()` / `decrypt()` from `crypto.ts` under the hood
  - _Acceptance: roundtrip create → serialize → encrypt → decrypt → deserialize returns identical manifest_

- [x] **2.3 Extend crypto service for in-memory operations**
  - Add to `crypto.ts`:
    - `encryptBuffer(data: Uint8Array, outputPath: string, passphrase: string, options: EncryptOptions): Promise<CryptoResult>` — write data to temp file, encrypt, delete temp
    - `decryptToBuffer(inputPath: string, passphrase: string): Promise<Uint8Array>` — decrypt to temp file, read into memory, delete temp
  - Both operations ensure temp files are cleaned up even on failure
  - Temp files created with `0600` permissions
  - _Acceptance: roundtrip encrypt buffer → decrypt to buffer returns identical data_

- [x] **2.4 Implement vault service in `src/services/vault.ts`**
  - Vault state management:
    ```typescript
    interface VaultState {
      name: string;
      dir: string;
      manifest: VaultManifest;
      passphrase: string;       // Held in memory while unlocked
      locked: boolean;
      autoLockTimeoutId: number | null;
    }
    ```
  - `createVault(name: string, passphrase: string, kdfPreset: KdfPreset): Promise<VaultState>` — create dir, generate empty manifest, encrypt + save
  - `unlockVault(name: string, passphrase: string): Promise<VaultState>` — load + decrypt manifest, return state
  - `lockVault(state: VaultState): void` — clear passphrase + manifest from memory, cancel auto-lock timer
  - `deleteVault(name: string, passphrase: string): Promise<void>` — verify passphrase, then delete directory
  - `saveVaultState(state: VaultState): Promise<void>` — re-encrypt + write manifest
  - _Acceptance: create → unlock → lock → unlock roundtrip works; wrong passphrase on unlock fails_

- [x] **2.5 Implement auto-lock timeout**
  - In `vault.ts`:
    - `resetAutoLockTimer(state: VaultState): void` — restart countdown based on `state.manifest.settings.autoLockMinutes`
    - `cancelAutoLockTimer(state: VaultState): void` — cancel pending timer
  - Timer uses `GLib.timeout_add_seconds`
  - On timeout: call `lockVault()` and emit a signal/callback so UI can respond
  - `onAutoLock?: () => void` callback on VaultState
  - _Acceptance: vault auto-locks after configured timeout; user activity resets timer_

- [x] **2.6 Implement vault item operations**
  - In `vault.ts`:
    - `addFileToVault(state: VaultState, filePath: string, metadata: Partial<VaultItem>): Promise<VaultItem>` — encrypt file to `items/<uuid>.gtkrypt`, add to manifest, save manifest
    - `addRecordToVault(state: VaultState, metadata: Partial<VaultItem>): Promise<VaultItem>` — encrypt JSON record to `items/<uuid>.gtkrypt`, add to manifest, save manifest
    - `addNoteToVault(state: VaultState, title: string, text: string, metadata: Partial<VaultItem>): Promise<VaultItem>` — encrypt text as JSON, add to manifest, save manifest
    - `removeItem(state: VaultState, itemId: string): Promise<void>` — delete `items/<id>.gtkrypt` + `thumbs/<id>.gtkrypt`, remove from manifest, save
    - `updateItemMetadata(state: VaultState, itemId: string, updates: Partial<VaultItem>): Promise<void>` — update fields in manifest, save
    - `getItemData(state: VaultState, itemId: string): Promise<Uint8Array>` — decrypt item to memory buffer
  - _Acceptance: add file → get data returns original bytes; add record → get data returns JSON; remove item deletes files_

---

### Phase 3: Search & filtering

> Goal: Users can search and filter vault items by name, category, tags, and fields.

- [x] **3.1 Implement search service in `src/services/search.ts`**
  - `searchItems(manifest: VaultManifest, query: string): VaultItem[]` — case-insensitive substring search across:
    - Item name
    - Tags
    - Category label
    - Template fields (values)
    - Notes content (note items only, from manifest)
  - `filterByCategory(manifest: VaultManifest, categoryId: string): VaultItem[]`
  - `filterByTag(manifest: VaultManifest, tag: string): VaultItem[]`
  - `filterFavorites(manifest: VaultManifest): VaultItem[]`
  - `filterRecent(manifest: VaultManifest, limit: number): VaultItem[]` — sorted by `accessedAt` descending
  - `sortItems(items: VaultItem[], order: SortOrder): VaultItem[]`
  - All operations are in-memory (search the decrypted manifest, no disk I/O)
  - _Acceptance: search returns correct items for name, tag, and field queries; filters work correctly_

---

### Phase 4: UI — Navigation & vault management

> Goal: App has a vault mode with navigation between vault list, browser, and detail views. Users can create, unlock, lock, and delete vaults.

- [x] **4.1 Modify window for dual-mode navigation**
  - In `window.ts`:
    - Add `Adw.NavigationView` as the root content widget
    - Add an `AppMode` state: `"files"` (existing) or `"vault"` (new)
    - Add mode switcher in the header bar (e.g., `Adw.ViewSwitcher` or simple toggle button)
    - When in `"files"` mode: existing encrypt/decrypt flow (unchanged)
    - When in `"vault"` mode: push vault navigation pages
  - _Acceptance: mode toggle switches between file encryption view and vault view; existing file workflow still works_

- [x] **4.2 Implement vault list view in `src/ui/vaultListView.ts`**
  - `Adw.NavigationPage` showing all vaults
  - Each vault row: `Adw.ActionRow` with vault name, last-modified date, lock icon
  - "Create New Vault" button (suggested-action)
  - Right-click / long-press context menu: Delete vault
  - On row activation: push unlock dialog → push vault browser
  - Empty state: `Adw.StatusPage` with "No vaults yet" + create button
  - _Acceptance: lists existing vaults; create button opens creation dialog; row click opens unlock_

- [x] **4.3 Implement vault creation dialog**
  - `Adw.Dialog` with:
    - Vault name entry (validated: non-empty, no special chars, unique)
    - Passphrase entry + confirm + strength bar (reuse pattern from `passphraseDialog.ts`)
    - KDF preset selector
    - Create / Cancel buttons
  - On create: call `createVault()` → auto-unlock → push browser view
  - _Acceptance: creates vault directory with encrypted manifest; navigates to browser_

- [x] **4.4 Implement vault unlock dialog in `src/ui/vaultUnlockDialog.ts`**
  - `Adw.Dialog` with:
    - Vault name displayed as title
    - Passphrase entry
    - Unlock / Cancel buttons
    - Error message area for wrong passphrase feedback
  - On unlock: call `unlockVault()` → push vault browser
  - On wrong passphrase: show error, stay on dialog
  - _Acceptance: correct passphrase unlocks and navigates; wrong passphrase shows error_

- [x] **4.5 Implement vault delete confirmation**
  - `Adw.AlertDialog` with destructive action styling
  - Requires entering vault name to confirm (type-to-confirm pattern)
  - Requires vault passphrase to verify ownership
  - On confirm: call `deleteVault()` → refresh vault list
  - _Acceptance: vault deleted after correct name + passphrase; cancelled on mismatch_

---

### Phase 5: UI — Vault browser

> Goal: Users can browse, search, and filter items in an unlocked vault with grid and list view modes.

- [x] **5.1 Implement vault browser view in `src/ui/vaultBrowser.ts`**
  - `Adw.NavigationPage` with:
    - Header bar: vault name as title, lock button, search button, add button, settings button
    - `Gtk.SearchBar` + `Gtk.SearchEntry` (toggle with search button or Ctrl+F)
    - Category sidebar or `Adw.ComboRow` filter (Favorites / Recent / All / per-category)
    - Main content area: switchable between grid and list views
  - Lock button: locks vault, pops back to vault list
  - _Acceptance: browser shows items from manifest; header actions work_

- [x] **5.2 Implement list view mode**
  - `Gtk.ListBox` with `Adw.ActionRow` per item:
    - Icon based on category or MIME type
    - Title: item name
    - Subtitle: category label + tags
    - Favorite star suffix
    - Date suffix (modified or accessed)
  - Row activation: push item detail view
  - _Acceptance: all vault items displayed as rows; clicking opens detail_

- [x] **5.3 Implement grid view mode**
  - `Gtk.FlowBox` with card-style children:
    - Thumbnail image (if available) or category icon placeholder
    - Item name label below
    - Favorite star overlay
  - FlowBox child activation: push item detail view
  - Responsive: cards reflow based on window width
  - _Acceptance: items display as cards; clicking opens detail; grid reflows on resize_

- [x] **5.4 Implement search integration in browser**
  - `Gtk.SearchBar` connected to `Gtk.SearchEntry`
  - On search text change: filter displayed items via `searchItems()`
  - Debounce search input (300ms)
  - Show "No results" placeholder when search returns empty
  - _Acceptance: typing in search filters items in real-time; clearing search shows all_

- [x] **5.5 Implement category filter in browser**
  - Sidebar or dropdown with:
    - "All Items" (default)
    - "Favorites"
    - "Recently Accessed"
    - Each category from manifest
  - Selection filters the displayed items
  - Item count badges per category
  - _Acceptance: selecting a category shows only matching items; counts are correct_

- [x] **5.6 Implement view mode toggle**
  - Toggle button in header bar (grid/list icon)
  - Persists preference to `manifest.settings.viewMode`
  - Saves on toggle (re-encrypts manifest)
  - _Acceptance: toggle switches between grid and list; preference persists across sessions_

---

### Phase 6: UI — Item detail & viewers

> Goal: Users can view item metadata and preview file contents in-memory.

- [x] **6.1 Implement item detail view in `src/ui/itemDetailView.ts`**
  - `Adw.NavigationPage` showing:
    - Header: item name as title, edit button, delete button, favorite toggle, copy menu
    - Metadata section: category badge, tags as pills, dates (created, modified, accessed)
    - Preview section: in-memory content viewer (based on item type)
    - For records: display fields in a `Adw.PreferencesGroup` with copy buttons per field
    - For notes: display note text in scrollable area
    - For files: show viewer widget (image/text) or "Preview not available" fallback
  - _Acceptance: detail view shows correct metadata; preview renders for supported types_

- [x] **6.2 Implement image viewer in `src/ui/imageViewer.ts`**
  - Decrypts file to in-memory buffer using `getItemData()`
  - Loads `GdkPixbuf.Pixbuf` from buffer using `Pixbuf.new_from_stream()`
  - Displays in `Gtk.Picture` widget with zoom controls (fit, actual size, zoom in/out)
  - Supports: JPEG, PNG, GIF, BMP, TIFF, WebP (whatever GdkPixbuf supports)
  - Never writes decrypted data to disk
  - _Acceptance: encrypted images display correctly; zoom controls work; no temp files created_

- [x] **6.3 Implement text viewer in `src/ui/textViewer.ts`**
  - Decrypts file to in-memory buffer using `getItemData()`
  - Decodes UTF-8, displays in `Gtk.TextView` (read-only)
  - Monospace font option for code/config files
  - Word wrap enabled
  - Supports: text/plain, text/csv, text/markdown, application/json, etc.
  - _Acceptance: encrypted text files display correctly; no temp files created_

- [x] **6.4 Implement record detail renderer**
  - In `itemDetailView.ts`:
    - For `type === "record"`: decrypt item JSON, parse fields
    - Render each field as an `Adw.ActionRow` with:
      - Field label as title
      - Field value as subtitle (or masked for sensitive fields like passwords)
      - Copy-to-clipboard button as suffix
      - Show/hide toggle for password fields
  - Template name displayed as section header
  - _Acceptance: record fields display correctly; copy buttons work; password fields toggle visibility_

- [x] **6.5 Implement note viewer**
  - In `itemDetailView.ts`:
    - For `type === "note"`: decrypt item JSON, extract note text
    - Display in `Gtk.TextView` (read-only)
    - Edit button transitions to note editor
  - _Acceptance: note content displays correctly; edit button opens editor_

- [x] **6.6 Implement clipboard service in `src/services/clipboard.ts`**
  - `copyToClipboard(text: string, autoClearSeconds?: number): void`
    - Uses `Gdk.Display.get_default().get_clipboard().set(text)`
    - If `autoClearSeconds` > 0: schedule `GLib.timeout_add_seconds` to clear clipboard
    - Default auto-clear: 30 seconds
  - `clearClipboard(): void`
  - Show toast notification: "Copied to clipboard (clears in 30s)"
  - _Acceptance: text copies to system clipboard; clipboard clears after timeout_

- [x] **6.7 Implement item deletion**
  - Delete button on detail view triggers `Adw.AlertDialog`:
    - "Delete <item name>?"
    - "This will permanently remove this item from the vault."
    - Delete (destructive) / Cancel
  - On confirm: call `removeItem()` → pop back to browser
  - _Acceptance: item removed from manifest and disk; browser refreshes_

---

### Phase 7: UI — Item creation & editing

> Goal: Users can add files, create structured records, write notes, and edit item metadata.

- [x] **7.1 Implement "Add to Vault" flow in browser**
  - "+" button in vault browser header opens a menu:
    - "Add File..." — opens file chooser
    - "New Record..." — opens template picker → record editor
    - "New Note..." — opens note editor
  - _Acceptance: menu items open correct dialogs_

- [x] **7.2 Implement file import dialog in `src/ui/itemEditorDialog.ts`**
  - After file selection (single or multi):
    - `Adw.Dialog` for each file with:
      - File name (editable)
      - Category dropdown (from manifest categories)
      - Tags entry (comma-separated, with pill display)
      - Favorite toggle
    - "Add to Vault" / "Cancel" buttons
  - On confirm: call `addFileToVault()` for each file
  - Show progress for multi-file imports
  - _Acceptance: files encrypted and added to vault; metadata saved in manifest_

- [x] **7.3 Implement template picker**
  - `Adw.Dialog` with `Gtk.ListBox` listing available templates
  - Each row: template icon, template name, field count
  - Row activation: close picker → open record editor with selected template
  - _Acceptance: templates listed; selection opens record editor_

- [x] **7.4 Implement record editor dialog in `src/ui/recordEditorDialog.ts`**
  - `Adw.Dialog` with:
    - Record name entry (pre-filled from template name + timestamp)
    - Template fields rendered as appropriate input rows:
      - `text` → `Adw.EntryRow`
      - `date` → `Adw.EntryRow` with date format hint
      - `number` → `Adw.EntryRow` with number input mode
      - `multiline` → `Gtk.TextView` in a row
    - Category dropdown (pre-filled from template default)
    - Tags entry
    - Save / Cancel buttons
  - Required fields validated before save
  - On save: call `addRecordToVault()` with field data
  - For editing existing records: pre-fill all fields from decrypted data
  - _Acceptance: record created with correct fields; required validation works; edit pre-fills_

- [x] **7.5 Implement note editor dialog in `src/ui/noteEditorDialog.ts`**
  - `Adw.Dialog` with:
    - Title entry
    - `Gtk.TextView` for note body (full-height, scrollable)
    - Category dropdown
    - Tags entry
    - Save / Cancel buttons
  - On save: call `addNoteToVault()` with title + body
  - For editing existing notes: pre-fill title and body from decrypted data
  - _Acceptance: note created and encrypted; edit works with pre-fill_

- [x] **7.6 Implement item metadata editor**
  - Edit button on item detail view opens `Adw.Dialog` with:
    - Name entry (editable)
    - Category dropdown
    - Tags editor
    - Favorite toggle
  - On save: call `updateItemMetadata()` → refresh detail view
  - For records: also allow editing field values (via record editor)
  - For notes: also allow editing note text (via note editor)
  - _Acceptance: metadata changes persist; record/note content editable_

---

### Phase 8: Thumbnail generation

> Goal: Grid view shows meaningful thumbnails for image items.

- [x] **8.1 Implement thumbnail service in `src/services/thumbnail.ts`**
  - `generateThumbnail(imageBytes: Uint8Array, maxSize: number): Uint8Array | null`
    - Load image from buffer via `GdkPixbuf.Pixbuf.new_from_stream()`
    - Scale to fit within `maxSize x maxSize` (default 256) preserving aspect ratio
    - Encode as JPEG (quality 80) to buffer
    - Return buffer or null if not an image
  - _Acceptance: generates scaled JPEG thumbnails from PNG/JPEG input; returns null for non-images_

- [x] **8.2 Integrate thumbnail generation into add-file flow**
  - After encrypting a file item:
    - If MIME type starts with `image/`: generate thumbnail from original bytes
    - Encrypt thumbnail → `thumbs/<uuid>.gtkrypt`
    - Set `hasThumbnail: true` on VaultItem
  - Skip thumbnail for non-image files
  - _Acceptance: image files get encrypted thumbnails; non-images do not_

- [x] **8.3 Load thumbnails in grid view**
  - In `vaultBrowser.ts` grid mode:
    - For items with `hasThumbnail: true`:
      - Decrypt `thumbs/<uuid>.gtkrypt` to memory
      - Load as `GdkPixbuf.Pixbuf` → set as `Gtk.Picture` source
    - For items without thumbnails: show category icon placeholder
  - Load thumbnails lazily (on scroll into view or on page load with idle scheduling)
  - Cache decrypted thumbnails in memory for the session
  - _Acceptance: grid shows image thumbnails for image items; category icons for others_

---

### Phase 9: Import & export

> Goal: Users can bulk-import files and export/backup vaults.

- [x] **9.1 Implement bulk import dialog in `src/ui/importDialog.ts`**
  - Multi-file or folder selection via `Gtk.FileDialog`
  - Import wizard:
    - Step 1: file selection
    - Step 2: category assignment (can assign one category to all, or auto-detect)
    - Step 3: review list + tags
    - Step 4: progress view during encryption
  - Auto-categorization heuristic (by file extension):
    - `.pdf` → Legal or Other
    - `.jpg/.png` → based on filename keywords ("passport", "id", "receipt")
    - Default: "Other"
  - _Acceptance: bulk import encrypts multiple files with progress; categories assigned_

- [x] **9.2 Implement export/backup dialog in `src/ui/exportDialog.ts`**
  - Options:
    - "Export vault backup" — copies entire vault directory to chosen location
    - "Export single item" — decrypt + save item to chosen location
  - Vault backup: copies `manifest.gtkrypt` + all `items/*.gtkrypt` + `thumbs/*.gtkrypt`
  - Item export: decrypts item to chosen path (using existing decrypt workflow)
  - Progress view for backup operations
  - _Acceptance: vault backup creates complete copy; single item export decrypts correctly_

- [x] **9.3 Implement vault restore from backup**
  - In vault list view: "Import Vault..." button
  - Folder selection dialog
  - Validate: check for `manifest.gtkrypt`, prompt for passphrase to verify
  - Copy backup directory into vaults base dir
  - _Acceptance: restored vault appears in list and can be unlocked_

---

### Phase 10: Settings & category management

> Goal: Users can configure vault settings and manage custom categories.

- [x] **10.1 Implement settings dialog in `src/ui/settingsDialog.ts`**
  - `Adw.Dialog` with `Adw.PreferencesPage`:
    - **Security group**:
      - Auto-lock timeout: `Adw.SpinRow` (0-60 minutes, 0 = never)
    - **Display group**:
      - Default view mode: grid / list toggle
      - Default sort order: dropdown (name / date / category)
      - Default category for new items: dropdown
    - **Danger zone group**:
      - "Change vault passphrase" button → opens change-passphrase flow
      - "Delete this vault" button → opens delete confirmation
  - On save: update `manifest.settings`, call `saveVaultState()`
  - _Acceptance: settings persist across lock/unlock cycles_

- [x] **10.2 Implement category manager in `src/ui/categoryManager.ts`**
  - Accessible from settings or browser sidebar
  - `Adw.Dialog` with list of categories:
    - Built-in categories: shown but not deletable (edit label only)
    - Custom categories: full edit + delete
    - "Add Category" button at bottom
  - Add/edit dialog: name entry, icon picker (from common GTK icon names)
  - On save: update `manifest.categories`, call `saveVaultState()`
  - _Acceptance: custom categories created and appear in filters; built-in categories not deletable_

- [x] **10.3 Implement change-passphrase flow**
  - Dialog with:
    - Current passphrase entry
    - New passphrase + confirm + strength bar
    - KDF preset selector
  - On confirm:
    1. Verify current passphrase (attempt unlock)
    2. Re-encrypt manifest with new passphrase
    3. Re-encrypt ALL items with new passphrase (with progress bar)
    4. Re-encrypt ALL thumbnails with new passphrase
    5. Update vault state with new passphrase
  - This is an expensive operation — warn user about duration
  - _Acceptance: all items re-encrypted; old passphrase no longer works; new passphrase unlocks_

---

### Phase 11: Security enhancements

> Goal: Optional keyfile support for two-factor vault security.

- [x] **11.1 Extend Rust backend for keyfile support**
  - Add `--keyfile PATH` argument to `gtkrypt-crypto encrypt` and `decrypt` commands
  - When keyfile is provided:
    - Read keyfile contents (first 64 KiB max)
    - Derive combined key: `Argon2id(passphrase || SHA-256(keyfile), salt)`
    - This means both passphrase AND keyfile are needed to decrypt
  - Add `sha2` crate to `Cargo.toml` for SHA-256
  - _Acceptance: encrypt with keyfile → decrypt without keyfile fails; decrypt with correct keyfile succeeds_

- [x] **11.2 Extend TypeScript crypto service for keyfile**
  - Add optional `keyfilePath?: string` to encrypt/decrypt function signatures
  - Pass `--keyfile` argument to subprocess when provided
  - _Acceptance: TS-side encrypt/decrypt works with keyfile parameter_

- [x] **11.3 Add keyfile option to vault creation**
  - In vault creation dialog:
    - "Use keyfile (optional)" expander
    - File picker for keyfile
    - Warning text: "You will need BOTH the passphrase and this keyfile to unlock the vault"
  - Store keyfile usage flag in manifest (the manifest itself needs the keyfile too)
  - Actually: store keyfile flag in a plaintext `vault.json` metadata file alongside `manifest.gtkrypt`
  - _Acceptance: vault created with keyfile; unlock requires both passphrase and keyfile_

- [x] **11.4 Add keyfile option to vault unlock**
  - In vault unlock dialog:
    - If vault uses keyfile (`vault.json` has `keyfile: true`): show keyfile picker
    - Error message when keyfile is missing or wrong
  - _Acceptance: unlock with correct keyfile works; missing keyfile shows helpful error_

---

### Phase 12: Polish & edge cases

> Goal: Error handling, accessibility, and UX refinements.

- [x] **12.1 Handle vault corruption gracefully**
  - If manifest decryption fails (wrong passphrase): clear error message
  - If manifest JSON is invalid after decryption: `VaultCorruptError` with recovery suggestion
  - If an item file is missing from disk but in manifest: mark as "missing" in browser, offer cleanup
  - _Acceptance: each corruption scenario shows appropriate user-facing error_

- [x] **12.2 Implement keyboard navigation for vault views**
  - Tab order through vault browser: search → filter → item list/grid → action buttons
  - Arrow keys navigate items in grid/list
  - Enter opens selected item
  - Escape closes dialogs, goes back in navigation
  - Ctrl+F focuses search
  - Ctrl+N opens "add item" menu
  - _Acceptance: all vault views fully operable via keyboard_

- [x] **12.3 Implement accessible labels for vault views**
  - Vault list rows: accessible description with vault name + status
  - Browser items: accessible description with item name + category + type
  - Detail view fields: accessible labels on all interactive elements
  - Viewers: accessible descriptions on images ("Encrypted image preview")
  - _Acceptance: screen reader can navigate all vault views_

- [x] **12.4 Wrap all new user-visible strings with gettext**
  - All new UI strings use `_("...")` or `ngettext()`
  - No bare string literals in new UI code
  - _Acceptance: grep for bare strings in new UI files returns zero results_

- [x] **12.5 Handle concurrent vault access**
  - On manifest save: check file modification time, warn if externally modified
  - Use atomic write (temp file + rename) for manifest saves
  - _Acceptance: concurrent modification detected and user warned_

---

### Phase 13: Testing

> Goal: Comprehensive tests for all new vault functionality.

- [x] **13.1 Unit tests: vault types and categories**
  - Default categories array has expected entries
  - Templates have required fields
  - UUID generation produces valid format
  - _Acceptance: all pass_

- [x] **13.2 Unit tests: manifest serialize/deserialize**
  - Roundtrip: create → serialize → deserialize returns identical manifest
  - Version validation: reject unknown versions
  - Missing fields: handle gracefully with defaults
  - _Acceptance: all pass_

- [x] **13.3 Unit tests: search and filtering**
  - Search by name: exact and substring matches
  - Search by tag: matches items with specific tag
  - Search by field value: finds records with matching fields
  - Filter by category: returns only matching items
  - Filter favorites: returns only favorited items
  - Filter recent: returns items sorted by accessedAt
  - Sort by name, date, category: correct ordering
  - _Acceptance: all pass_

- [x] **13.4 Integration tests: vault lifecycle**
  - Create vault → verify directory structure
  - Unlock vault → verify manifest loaded
  - Lock vault → verify memory cleared
  - Delete vault → verify directory removed
  - Wrong passphrase → verify error, no state change
  - _Acceptance: all pass_

- [x] **13.5 Integration tests: item operations**
  - Add file → verify encrypted file exists, manifest updated
  - Add record → verify encrypted JSON exists, manifest updated
  - Add note → verify encrypted note exists, manifest updated
  - Get item data → verify matches original
  - Remove item → verify files deleted, manifest updated
  - Update metadata → verify manifest updated
  - _Acceptance: all pass_

- [x] **13.6 Integration tests: in-memory operations**
  - Encrypt buffer → decrypt to buffer → verify roundtrip
  - Decrypt to buffer → verify no temp files remain
  - Encrypt buffer error → verify no temp files remain
  - _Acceptance: all pass_

- [x] **13.7 Integration tests: thumbnail generation**
  - Generate thumbnail from JPEG → valid JPEG output, smaller dimensions
  - Generate thumbnail from PNG → valid JPEG output
  - Generate thumbnail from text file → returns null
  - _Acceptance: all pass_

- [x] **13.8 Rust backend tests: keyfile support**
  - Encrypt with keyfile → decrypt with keyfile: roundtrip passes
  - Encrypt with keyfile → decrypt without keyfile: fails
  - Encrypt without keyfile → decrypt with keyfile: fails
  - Encrypt with keyfile A → decrypt with keyfile B: fails
  - _Acceptance: `cargo test` all pass_

---

## Built-in categories reference

| ID | Label | Icon | Built-in |
|---|---|---|---|
| `identity` | Identity Documents | `contact-new-symbolic` | Yes |
| `banking` | Banking & Finance | `wallet-symbolic` | Yes |
| `medical` | Medical Records | `heart-filled-symbolic` | Yes |
| `insurance` | Insurance | `shield-safe-symbolic` | Yes |
| `legal` | Legal Documents | `text-x-generic-symbolic` | Yes |
| `education` | Education | `school-symbolic` | Yes |
| `travel` | Travel | `airplane-symbolic` | Yes |
| `property` | Property & Housing | `building-symbolic` | Yes |
| `vehicle` | Vehicles | `car-symbolic` | Yes |
| `other` | Other | `folder-symbolic` | Yes |

---

## Built-in templates reference

| Template | Default Category | Key Fields |
|---|---|---|
| Passport | identity | number, full name, nationality, DOB, issue date, expiry, authority |
| National ID | identity | number, full name, DOB, issue date, expiry |
| Driver's License | identity | number, full name, class, issue date, expiry, state |
| Credit/Debit Card | banking | card name, number, holder, expiry, bank |
| Bank Account | banking | bank, holder, account number, routing, IBAN, SWIFT |
| Medical Record | medical | patient, date, provider, diagnosis, notes |
| Insurance Policy | insurance | provider, policy number, type, start, end, coverage |
| Login Credentials | other | service, username, password, URL, notes |
| Wi-Fi Network | other | SSID, password, security type |

---

## Acceptance criteria (vault feature complete)

All of the following must pass:

- [x] Vault mode accessible from main window alongside existing file encrypt/decrypt
- [x] Create, unlock, lock, and delete vaults
- [x] Add files, records, and notes to a vault
- [x] Browse vault with grid and list views
- [x] Search by name, tag, category, and field values
- [x] Filter by category, favorites, and recent
- [x] Preview images and text in-memory (no plaintext written to disk)
- [x] Copy field values to clipboard with auto-clear
- [x] Edit item metadata, record fields, and note content
- [x] Bulk import files with category assignment
- [x] Export vault backup and single item export
- [x] Auto-lock timeout works correctly
- [x] Optional keyfile support for vault security
- [x] Custom category creation and management
- [x] Change vault passphrase (re-encrypts all items)
- [x] Keyboard navigation and accessibility labels
- [x] All new strings wrapped with gettext
- [x] All unit tests pass
- [x] All integration tests pass
- [x] Existing file encrypt/decrypt workflow unchanged and tests still pass
- [x] TypeScript type-checks with `npm run check`
