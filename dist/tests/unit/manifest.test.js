// tests/harness.ts
var _passed = 0;
var _failed = 0;
var _errors = [];
function assert(condition, message) {
  if (condition) {
    _passed++;
  } else {
    _failed++;
    _errors.push(`  FAIL: ${message}`);
  }
}
function assertEqual(actual, expected, message) {
  if (actual === expected) {
    _passed++;
  } else {
    _failed++;
    _errors.push(`  FAIL: ${message}
    expected: ${String(expected)}
    actual:   ${String(actual)}`);
  }
}
function assertThrows(fn, errorName, message) {
  try {
    fn();
    _failed++;
    _errors.push(`  FAIL: ${message}
    expected ${errorName} to be thrown, but nothing was thrown`);
  } catch (e) {
    const err = e;
    if (err.name === errorName) {
      _passed++;
    } else {
      _failed++;
      _errors.push(`  FAIL: ${message}
    expected ${errorName}, got ${err.name ?? String(e)}`);
    }
  }
}
function report(suiteName) {
  if (_errors.length > 0) {
    printerr(`
${suiteName}:`);
    for (const err of _errors) {
      printerr(err);
    }
  }
  print(`${suiteName}: ${_passed} passed, ${_failed} failed`);
  if (_failed > 0) {
    imports.system.exit(1);
  }
}

// src/services/manifest.ts
import GLib4 from "gi://GLib";
import Gio2 from "gi://Gio";

// src/models/categories.ts
var DEFAULT_CATEGORIES = [
  { id: "identity", label: "Identity Documents", icon: "contact-new-symbolic", builtin: true },
  { id: "banking", label: "Banking & Finance", icon: "wallet-symbolic", builtin: true },
  { id: "medical", label: "Medical Records", icon: "heart-filled-symbolic", builtin: true },
  { id: "insurance", label: "Insurance", icon: "shield-safe-symbolic", builtin: true },
  { id: "legal", label: "Legal Documents", icon: "text-x-generic-symbolic", builtin: true },
  { id: "education", label: "Education", icon: "school-symbolic", builtin: true },
  { id: "travel", label: "Travel", icon: "airplane-symbolic", builtin: true },
  { id: "property", label: "Property & Housing", icon: "building-symbolic", builtin: true },
  { id: "vehicle", label: "Vehicles", icon: "car-symbolic", builtin: true },
  { id: "other", label: "Other", icon: "folder-symbolic", builtin: true }
];

// src/util/i18n.ts
import GLib from "gi://GLib";
var domain = "gtkrypt";
imports.gettext.bindtextdomain(domain, GLib.get_home_dir());
imports.gettext.textdomain(domain);
var _ = imports.gettext.gettext;
var ngettext = imports.gettext.ngettext;

// src/models/errors.ts
var GtkryptError = class extends Error {
  userMessage;
  constructor(message, userMessage) {
    super(message);
    this.name = "GtkryptError";
    this.userMessage = userMessage;
  }
};
var VaultCorruptError = class extends GtkryptError {
  constructor(message = "Vault data is corrupted", userMessage) {
    super(message, userMessage ?? _("The vault data is corrupted."));
    this.name = "VaultCorruptError";
  }
};

// src/services/crypto.ts
import Gio from "gi://Gio";
import GLib3 from "gi://GLib";

// src/util/logging.ts
import GLib2 from "gi://GLib";

// src/services/manifest.ts
function createEmptyManifest(name, kdfPreset) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    version: 1,
    name,
    createdAt: now,
    modifiedAt: now,
    kdfPreset,
    categories: [...DEFAULT_CATEGORIES],
    items: [],
    settings: {
      autoLockMinutes: 5,
      defaultCategory: "other",
      sortOrder: "date",
      viewMode: "list"
    }
  };
}
function serializeManifest(manifest2) {
  const json = JSON.stringify(manifest2, null, 2);
  return new TextEncoder().encode(json);
}
function deserializeManifest(bytes3) {
  try {
    const json = new TextDecoder().decode(bytes3);
    const manifest2 = JSON.parse(json);
    if (manifest2.version !== 1) {
      throw new VaultCorruptError(
        `Unsupported manifest version: ${manifest2.version}`,
        _("Unsupported vault version. Try updating gtkrypt to the latest version.")
      );
    }
    return manifest2;
  } catch (e) {
    if (e instanceof VaultCorruptError) throw e;
    throw new VaultCorruptError(
      `Failed to parse vault manifest: ${e}`,
      _("The vault manifest is corrupted. Try restoring from a backup.")
    );
  }
}

// tests/unit/manifest.test.ts
var manifest = createEmptyManifest("Test Vault", "balanced");
assertEqual(manifest.version, 1, "createEmptyManifest returns version 1");
assertEqual(manifest.name, "Test Vault", "createEmptyManifest has correct name");
assertEqual(manifest.kdfPreset, "balanced", "createEmptyManifest has correct kdfPreset");
assertEqual(manifest.items.length, 0, "createEmptyManifest has empty items array");
assertEqual(manifest.categories.length, 10, "createEmptyManifest has 10 default categories");
assertEqual(manifest.settings.autoLockMinutes, 5, "Default autoLockMinutes is 5");
assertEqual(manifest.settings.defaultCategory, "other", "Default category is 'other'");
assertEqual(manifest.settings.sortOrder, "date", "Default sortOrder is 'date'");
assertEqual(manifest.settings.viewMode, "list", "Default viewMode is 'list'");
var bytes = serializeManifest(manifest);
var restored = deserializeManifest(bytes);
assertEqual(restored.version, manifest.version, "Roundtrip preserves version");
assertEqual(restored.name, manifest.name, "Roundtrip preserves name");
assertEqual(restored.kdfPreset, manifest.kdfPreset, "Roundtrip preserves kdfPreset");
assertEqual(restored.items.length, 0, "Roundtrip preserves empty items array");
var testItem = {
  id: "test-uuid-001",
  type: "record",
  name: "Test Record",
  category: "banking",
  tags: ["test", "unit"],
  createdAt: "2025-01-01T00:00:00.000Z",
  modifiedAt: "2025-01-02T00:00:00.000Z",
  accessedAt: "2025-01-03T00:00:00.000Z",
  favorite: true,
  fields: { bankName: "Test Bank", accountNumber: "99999" }
};
var manifestWithItem = {
  ...manifest,
  items: [testItem]
};
var bytes2 = serializeManifest(manifestWithItem);
var restored2 = deserializeManifest(bytes2);
assertEqual(restored2.items.length, 1, "Roundtrip preserves items count");
assertEqual(restored2.items[0].name, "Test Record", "Roundtrip preserves item name");
assertEqual(restored2.items[0].favorite, true, "Roundtrip preserves item favorite");
assertEqual(
  restored.settings.autoLockMinutes,
  manifest.settings.autoLockMinutes,
  "Roundtrip preserves autoLockMinutes"
);
assertEqual(
  restored.settings.defaultCategory,
  manifest.settings.defaultCategory,
  "Roundtrip preserves defaultCategory"
);
assertEqual(
  restored.settings.sortOrder,
  manifest.settings.sortOrder,
  "Roundtrip preserves sortOrder"
);
assertEqual(
  restored.settings.viewMode,
  manifest.settings.viewMode,
  "Roundtrip preserves viewMode"
);
var badVersion = { ...manifest, version: 99 };
var badVersionBytes = new TextEncoder().encode(JSON.stringify(badVersion));
assertThrows(
  () => deserializeManifest(badVersionBytes),
  "VaultCorruptError",
  "Rejects manifest with version !== 1"
);
var invalidJsonBytes = new TextEncoder().encode("not valid json {{{");
assertThrows(
  () => deserializeManifest(invalidJsonBytes),
  "VaultCorruptError",
  "Rejects invalid JSON"
);
var emptyBytes = new Uint8Array(0);
assertThrows(
  () => deserializeManifest(emptyBytes),
  "VaultCorruptError",
  "Rejects empty bytes"
);
var serialized = serializeManifest(manifest);
var jsonText = new TextDecoder().decode(serialized);
var parsed = null;
try {
  parsed = JSON.parse(jsonText);
} catch {
}
assert(parsed !== null, "serializeManifest produces valid parseable JSON");
report("manifest");
//# sourceMappingURL=manifest.test.js.map
