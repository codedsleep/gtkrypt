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

// src/services/search.ts
function searchItems(manifest, query) {
  const q = query.toLowerCase();
  if (q.length === 0) return [...manifest.items];
  return manifest.items.filter((item) => {
    if (item.name.toLowerCase().includes(q)) return true;
    if (item.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
    const cat = manifest.categories.find((c) => c.id === item.category);
    if (cat && cat.label.toLowerCase().includes(q)) return true;
    if (item.fields) {
      for (const value of Object.values(item.fields)) {
        if (value.toLowerCase().includes(q)) return true;
      }
    }
    if (item.notes && item.notes.toLowerCase().includes(q)) return true;
    return false;
  });
}
function filterByCategory(manifest, categoryId) {
  return manifest.items.filter((item) => item.category === categoryId);
}
function filterByTag(manifest, tag) {
  const t = tag.toLowerCase();
  return manifest.items.filter(
    (item) => item.tags.some((itemTag) => itemTag.toLowerCase() === t)
  );
}
function filterFavorites(manifest) {
  return manifest.items.filter((item) => item.favorite);
}
function filterRecent(manifest, limit) {
  return [...manifest.items].sort((a, b) => b.accessedAt.localeCompare(a.accessedAt)).slice(0, limit);
}
function sortItems(items, order) {
  const sorted = [...items];
  switch (order) {
    case "name":
      sorted.sort(
        (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
      break;
    case "date":
      sorted.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      break;
    case "category":
      sorted.sort((a, b) => {
        const catCmp = a.category.localeCompare(b.category);
        if (catCmp !== 0) return catCmp;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      break;
  }
  return sorted;
}

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

// tests/unit/search.test.ts
function makeItem(overrides) {
  return {
    tags: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    modifiedAt: "2025-01-01T00:00:00.000Z",
    accessedAt: "2025-01-01T00:00:00.000Z",
    favorite: false,
    ...overrides
  };
}
var item1 = makeItem({
  id: "item-1",
  type: "file",
  name: "Passport Scan",
  category: "identity",
  tags: ["travel", "id"],
  favorite: true,
  modifiedAt: "2025-01-05T00:00:00.000Z",
  accessedAt: "2025-01-10T00:00:00.000Z"
});
var item2 = makeItem({
  id: "item-2",
  type: "record",
  name: "Bank of America",
  category: "banking",
  tags: ["savings"],
  fields: { bankName: "BoA", accountNumber: "12345" },
  modifiedAt: "2025-01-04T00:00:00.000Z",
  accessedAt: "2025-01-09T00:00:00.000Z"
});
var item3 = makeItem({
  id: "item-3",
  type: "note",
  name: "Insurance Notes",
  category: "insurance",
  tags: ["health"],
  notes: "Important policy details",
  modifiedAt: "2025-01-03T00:00:00.000Z",
  accessedAt: "2025-01-08T00:00:00.000Z"
});
var item4 = makeItem({
  id: "item-4",
  type: "file",
  name: "Tax Return 2024",
  category: "legal",
  tags: ["taxes", "2024"],
  favorite: false,
  modifiedAt: "2025-01-02T00:00:00.000Z",
  accessedAt: "2025-01-07T00:00:00.000Z"
});
var item5 = makeItem({
  id: "item-5",
  type: "record",
  name: "Wi-Fi Home",
  category: "other",
  tags: ["network"],
  fields: { ssid: "MyNetwork" },
  modifiedAt: "2025-01-01T00:00:00.000Z",
  accessedAt: "2025-01-06T00:00:00.000Z"
});
var testManifest = {
  version: 1,
  name: "Test Vault",
  createdAt: "2025-01-01T00:00:00.000Z",
  modifiedAt: "2025-01-05T00:00:00.000Z",
  kdfPreset: "balanced",
  categories: [...DEFAULT_CATEGORIES],
  items: [item1, item2, item3, item4, item5],
  settings: {
    autoLockMinutes: 5,
    defaultCategory: "other",
    sortOrder: "date",
    viewMode: "list"
  }
};
var emptyManifest = {
  version: 1,
  name: "Empty Vault",
  createdAt: "2025-01-01T00:00:00.000Z",
  modifiedAt: "2025-01-01T00:00:00.000Z",
  kdfPreset: "balanced",
  categories: [...DEFAULT_CATEGORIES],
  items: [],
  settings: {
    autoLockMinutes: 5,
    defaultCategory: "other",
    sortOrder: "date",
    viewMode: "list"
  }
};
var passportResults = searchItems(testManifest, "passport");
assertEqual(passportResults.length, 1, "searchItems 'passport' returns 1 result");
assertEqual(passportResults[0].id, "item-1", "searchItems 'passport' finds Passport Scan");
var bankResults = searchItems(testManifest, "bank");
assert(bankResults.some((i) => i.id === "item-2"), "searchItems 'bank' matches Bank of America");
var fieldResults = searchItems(testManifest, "12345");
assertEqual(fieldResults.length, 1, "searchItems '12345' returns 1 result");
assertEqual(fieldResults[0].id, "item-2", "searchItems '12345' matches field value");
var noteResults = searchItems(testManifest, "policy");
assertEqual(noteResults.length, 1, "searchItems 'policy' returns 1 result");
assertEqual(noteResults[0].id, "item-3", "searchItems 'policy' matches note content");
var tagResults = searchItems(testManifest, "travel");
assert(tagResults.some((i) => i.id === "item-1"), "searchItems 'travel' matches tag");
var noResults = searchItems(testManifest, "nonexistent");
assertEqual(noResults.length, 0, "searchItems 'nonexistent' returns empty array");
var caseResults = searchItems(testManifest, "PASSPORT");
assertEqual(caseResults.length, 1, "searchItems is case-insensitive");
assertEqual(caseResults[0].id, "item-1", "searchItems case-insensitive finds correct item");
var identityItems = filterByCategory(testManifest, "identity");
assertEqual(identityItems.length, 1, "filterByCategory 'identity' returns 1 item");
assertEqual(identityItems[0].id, "item-1", "filterByCategory 'identity' returns Passport Scan");
var bankingItems = filterByCategory(testManifest, "banking");
assertEqual(bankingItems.length, 1, "filterByCategory 'banking' returns 1 item");
assertEqual(bankingItems[0].id, "item-2", "filterByCategory 'banking' returns Bank of America");
var travelTagged = filterByTag(testManifest, "travel");
assertEqual(travelTagged.length, 1, "filterByTag 'travel' returns 1 item");
assertEqual(travelTagged[0].id, "item-1", "filterByTag 'travel' returns item 1");
var taxesTagged = filterByTag(testManifest, "taxes");
assertEqual(taxesTagged.length, 1, "filterByTag 'taxes' returns 1 item");
assertEqual(taxesTagged[0].id, "item-4", "filterByTag 'taxes' returns item 4");
var favorites = filterFavorites(testManifest);
assertEqual(favorites.length, 1, "filterFavorites returns 1 item");
assertEqual(favorites[0].id, "item-1", "filterFavorites returns the favorited item");
var recent2 = filterRecent(testManifest, 2);
assertEqual(recent2.length, 2, "filterRecent limit 2 returns 2 items");
assertEqual(recent2[0].id, "item-1", "filterRecent first is most recently accessed");
assertEqual(recent2[1].id, "item-2", "filterRecent second is next most recently accessed");
var byName = sortItems(testManifest.items, "name");
assertEqual(byName[0].name, "Bank of America", "sortItems 'name' first is Bank of America");
assertEqual(byName[1].name, "Insurance Notes", "sortItems 'name' second is Insurance Notes");
assertEqual(byName[2].name, "Passport Scan", "sortItems 'name' third is Passport Scan");
assertEqual(byName[3].name, "Tax Return 2024", "sortItems 'name' fourth is Tax Return 2024");
assertEqual(byName[4].name, "Wi-Fi Home", "sortItems 'name' fifth is Wi-Fi Home");
var byCat = sortItems(testManifest.items, "category");
assertEqual(byCat[0].category, "banking", "sortItems 'category' first is banking");
assertEqual(byCat[1].category, "identity", "sortItems 'category' second is identity");
assertEqual(byCat[2].category, "insurance", "sortItems 'category' third is insurance");
assertEqual(byCat[3].category, "legal", "sortItems 'category' fourth is legal");
assertEqual(byCat[4].category, "other", "sortItems 'category' fifth is other");
assertEqual(searchItems(emptyManifest, "anything").length, 0, "Empty manifest: searchItems returns empty");
assertEqual(filterByCategory(emptyManifest, "identity").length, 0, "Empty manifest: filterByCategory returns empty");
assertEqual(filterByTag(emptyManifest, "travel").length, 0, "Empty manifest: filterByTag returns empty");
assertEqual(filterFavorites(emptyManifest).length, 0, "Empty manifest: filterFavorites returns empty");
assertEqual(filterRecent(emptyManifest, 5).length, 0, "Empty manifest: filterRecent returns empty");
assertEqual(sortItems([], "name").length, 0, "Empty array: sortItems returns empty");
report("search");
//# sourceMappingURL=search.test.js.map
