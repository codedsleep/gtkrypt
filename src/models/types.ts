/**
 * Shared types and interfaces for gtkrypt.
 *
 * All data structures used across the application are defined here
 * to ensure a single source of truth for the type system.
 */

/** Represents a file selected by the user for encryption or decryption. */
export interface FileEntry {
  path: string;
  name: string;
  size: number;
  type: "plaintext" | "encrypted" | "unknown";
}

/** KDF strength preset selection. */
export type KdfPreset = "balanced" | "strong" | "very-strong";

/** Argon2id key derivation parameters. */
export interface KdfParams {
  timeCost: number;
  memoryCost: number;
  parallelism: number;
}

/** Maps each KDF preset to its Argon2id parameters. */
export const KDF_PRESETS: Readonly<Record<KdfPreset, KdfParams>> = {
  balanced: { timeCost: 3, memoryCost: 65536, parallelism: 4 },
  strong: { timeCost: 4, memoryCost: 262144, parallelism: 4 },
  "very-strong": { timeCost: 6, memoryCost: 524288, parallelism: 4 },
} as const;

/** Options passed to the encryption operation. */
export interface EncryptOptions {
  outputDir?: string;
  storeFilename: boolean;
  wipeOriginal: boolean;
  kdfPreset: KdfPreset;
}

/** Options passed to the decryption operation. */
export interface DecryptOptions {
  outputDir?: string;
  useStoredFilename: boolean;
}

/**
 * Parsed header of a `.gtkrypt` container file.
 *
 * Field layout corresponds to the binary container format
 * documented in SCOPE.md.
 */
export interface ContainerHeader {
  version: number;
  kdfId: number;
  kdfParams: KdfParams;
  salt: Uint8Array;
  nonce: Uint8Array;
  filename: string;
  mode?: number;
  fileSize: bigint;
  ciphertextLength: bigint;
}

/** Progress event emitted by the crypto subprocess during an operation. */
export interface ProgressEvent {
  fileIndex: number;
  bytesProcessed: number;
  totalBytes: number;
  phase: "kdf" | "encrypt" | "decrypt";
}

/** Result of an encryption or decryption operation. */
export interface CryptoResult {
  success: boolean;
  outputPath: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Vault types
// ---------------------------------------------------------------------------

/** The kind of item stored in a vault. */
export type VaultItemType = "file" | "record" | "note";

/** Sort order for vault item listings. */
export type SortOrder = "name" | "date" | "category";

/** Display mode for vault browser. */
export type ViewMode = "grid" | "list";

/** Defines a vault item category (built-in or user-created). */
export interface CategoryDef {
  id: string;
  label: string;
  icon: string;
  builtin: boolean;
}

/** Per-vault user preferences. */
export interface VaultSettings {
  autoLockMinutes: number;
  defaultCategory: string;
  sortOrder: SortOrder;
  viewMode: ViewMode;
}

/** A single item stored in a vault. */
export interface VaultItem {
  id: string;
  type: VaultItemType;
  name: string;
  category: string;
  tags: string[];
  createdAt: string;
  modifiedAt: string;
  accessedAt: string;
  favorite: boolean;
  filename?: string;
  mimeType?: string;
  fileSize?: number;
  templateId?: string;
  fields?: Record<string, string>;
  notes?: string;
  hasThumbnail?: boolean;
}

/** Encrypted manifest tracking all items in a vault. */
export interface VaultManifest {
  version: 1;
  name: string;
  createdAt: string;
  modifiedAt: string;
  kdfPreset: KdfPreset;
  categories: CategoryDef[];
  items: VaultItem[];
  settings: VaultSettings;
}
