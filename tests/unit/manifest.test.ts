/**
 * Unit tests for manifest creation, serialization, and deserialization.
 */

import { assert, assertEqual, assertThrows, report } from "../harness.js";
import {
  createEmptyManifest,
  serializeManifest,
  deserializeManifest,
} from "../../src/services/manifest.js";
import type { VaultManifest, VaultItem } from "../../src/models/types.js";

// ---------------------------------------------------------------------------
// createEmptyManifest
// ---------------------------------------------------------------------------

const manifest = createEmptyManifest("Test Vault", "balanced");

assertEqual(manifest.version, 1, "createEmptyManifest returns version 1");
assertEqual(manifest.name, "Test Vault", "createEmptyManifest has correct name");
assertEqual(manifest.kdfPreset, "balanced", "createEmptyManifest has correct kdfPreset");
assertEqual(manifest.items.length, 0, "createEmptyManifest has empty items array");
assertEqual(manifest.categories.length, 10, "createEmptyManifest has 10 default categories");

// Settings defaults
assertEqual(manifest.settings.autoLockMinutes, 5, "Default autoLockMinutes is 5");
assertEqual(manifest.settings.defaultCategory, "other", "Default category is 'other'");
assertEqual(manifest.settings.sortOrder, "date", "Default sortOrder is 'date'");
assertEqual(manifest.settings.viewMode, "list", "Default viewMode is 'list'");

// ---------------------------------------------------------------------------
// Roundtrip: create -> serialize -> deserialize
// ---------------------------------------------------------------------------

const bytes = serializeManifest(manifest);
const restored = deserializeManifest(bytes);

assertEqual(restored.version, manifest.version, "Roundtrip preserves version");
assertEqual(restored.name, manifest.name, "Roundtrip preserves name");
assertEqual(restored.kdfPreset, manifest.kdfPreset, "Roundtrip preserves kdfPreset");
assertEqual(restored.items.length, 0, "Roundtrip preserves empty items array");

// Roundtrip with an item
const testItem: VaultItem = {
  id: "test-uuid-001",
  type: "record",
  name: "Test Record",
  category: "banking",
  tags: ["test", "unit"],
  createdAt: "2025-01-01T00:00:00.000Z",
  modifiedAt: "2025-01-02T00:00:00.000Z",
  accessedAt: "2025-01-03T00:00:00.000Z",
  favorite: true,
  fields: { bankName: "Test Bank", accountNumber: "99999" },
};

const manifestWithItem: VaultManifest = {
  ...manifest,
  items: [testItem],
};

const bytes2 = serializeManifest(manifestWithItem);
const restored2 = deserializeManifest(bytes2);

assertEqual(restored2.items.length, 1, "Roundtrip preserves items count");
assertEqual(restored2.items[0].name, "Test Record", "Roundtrip preserves item name");
assertEqual(restored2.items[0].favorite, true, "Roundtrip preserves item favorite");

// Roundtrip preserves settings
assertEqual(
  restored.settings.autoLockMinutes,
  manifest.settings.autoLockMinutes,
  "Roundtrip preserves autoLockMinutes",
);
assertEqual(
  restored.settings.defaultCategory,
  manifest.settings.defaultCategory,
  "Roundtrip preserves defaultCategory",
);
assertEqual(
  restored.settings.sortOrder,
  manifest.settings.sortOrder,
  "Roundtrip preserves sortOrder",
);
assertEqual(
  restored.settings.viewMode,
  manifest.settings.viewMode,
  "Roundtrip preserves viewMode",
);

// ---------------------------------------------------------------------------
// deserializeManifest error cases
// ---------------------------------------------------------------------------

// Wrong version
const badVersion = { ...manifest, version: 99 };
const badVersionBytes = new TextEncoder().encode(JSON.stringify(badVersion));
assertThrows(
  () => deserializeManifest(badVersionBytes),
  "VaultCorruptError",
  "Rejects manifest with version !== 1",
);

// Invalid JSON
const invalidJsonBytes = new TextEncoder().encode("not valid json {{{");
assertThrows(
  () => deserializeManifest(invalidJsonBytes),
  "VaultCorruptError",
  "Rejects invalid JSON",
);

// Empty bytes
const emptyBytes = new Uint8Array(0);
assertThrows(
  () => deserializeManifest(emptyBytes),
  "VaultCorruptError",
  "Rejects empty bytes",
);

// ---------------------------------------------------------------------------
// serializeManifest produces valid JSON
// ---------------------------------------------------------------------------

const serialized = serializeManifest(manifest);
const jsonText = new TextDecoder().decode(serialized);
let parsed: unknown = null;
try {
  parsed = JSON.parse(jsonText);
} catch {
  // parsed stays null
}
assert(parsed !== null, "serializeManifest produces valid parseable JSON");

// ---------------------------------------------------------------------------
report("manifest");
