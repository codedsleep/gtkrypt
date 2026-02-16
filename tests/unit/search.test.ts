/**
 * Unit tests for search and filtering service.
 */

import { assert, assertEqual, report } from "../harness.js";
import {
  searchItems,
  filterByCategory,
  filterByTag,
  filterFavorites,
  filterRecent,
  sortItems,
} from "../../src/services/search.js";
import { DEFAULT_CATEGORIES } from "../../src/models/categories.js";
import type { VaultManifest, VaultItem } from "../../src/models/types.js";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<VaultItem> & Pick<VaultItem, "id" | "type" | "name" | "category">): VaultItem {
  return {
    tags: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    modifiedAt: "2025-01-01T00:00:00.000Z",
    accessedAt: "2025-01-01T00:00:00.000Z",
    favorite: false,
    ...overrides,
  };
}

const item1 = makeItem({
  id: "item-1",
  type: "file",
  name: "Passport Scan",
  category: "identity",
  tags: ["travel", "id"],
  favorite: true,
  modifiedAt: "2025-01-05T00:00:00.000Z",
  accessedAt: "2025-01-10T00:00:00.000Z",
});

const item2 = makeItem({
  id: "item-2",
  type: "record",
  name: "Bank of America",
  category: "banking",
  tags: ["savings"],
  fields: { bankName: "BoA", accountNumber: "12345" },
  modifiedAt: "2025-01-04T00:00:00.000Z",
  accessedAt: "2025-01-09T00:00:00.000Z",
});

const item3 = makeItem({
  id: "item-3",
  type: "note",
  name: "Insurance Notes",
  category: "insurance",
  tags: ["health"],
  notes: "Important policy details",
  modifiedAt: "2025-01-03T00:00:00.000Z",
  accessedAt: "2025-01-08T00:00:00.000Z",
});

const item4 = makeItem({
  id: "item-4",
  type: "file",
  name: "Tax Return 2024",
  category: "legal",
  tags: ["taxes", "2024"],
  favorite: false,
  modifiedAt: "2025-01-02T00:00:00.000Z",
  accessedAt: "2025-01-07T00:00:00.000Z",
});

const item5 = makeItem({
  id: "item-5",
  type: "record",
  name: "Wi-Fi Home",
  category: "other",
  tags: ["network"],
  fields: { ssid: "MyNetwork" },
  modifiedAt: "2025-01-01T00:00:00.000Z",
  accessedAt: "2025-01-06T00:00:00.000Z",
});

const testManifest: VaultManifest = {
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
    viewMode: "list",
  },
};

const emptyManifest: VaultManifest = {
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
    viewMode: "list",
  },
};

// ---------------------------------------------------------------------------
// searchItems
// ---------------------------------------------------------------------------

// Search by name
const passportResults = searchItems(testManifest, "passport");
assertEqual(passportResults.length, 1, "searchItems 'passport' returns 1 result");
assertEqual(passportResults[0].id, "item-1", "searchItems 'passport' finds Passport Scan");

const bankResults = searchItems(testManifest, "bank");
assert(bankResults.some((i) => i.id === "item-2"), "searchItems 'bank' matches Bank of America");

// Search by field value
const fieldResults = searchItems(testManifest, "12345");
assertEqual(fieldResults.length, 1, "searchItems '12345' returns 1 result");
assertEqual(fieldResults[0].id, "item-2", "searchItems '12345' matches field value");

// Search by notes
const noteResults = searchItems(testManifest, "policy");
assertEqual(noteResults.length, 1, "searchItems 'policy' returns 1 result");
assertEqual(noteResults[0].id, "item-3", "searchItems 'policy' matches note content");

// Search by tag
const tagResults = searchItems(testManifest, "travel");
assert(tagResults.some((i) => i.id === "item-1"), "searchItems 'travel' matches tag");

// No matches
const noResults = searchItems(testManifest, "nonexistent");
assertEqual(noResults.length, 0, "searchItems 'nonexistent' returns empty array");

// Case insensitive
const caseResults = searchItems(testManifest, "PASSPORT");
assertEqual(caseResults.length, 1, "searchItems is case-insensitive");
assertEqual(caseResults[0].id, "item-1", "searchItems case-insensitive finds correct item");

// ---------------------------------------------------------------------------
// filterByCategory
// ---------------------------------------------------------------------------

const identityItems = filterByCategory(testManifest, "identity");
assertEqual(identityItems.length, 1, "filterByCategory 'identity' returns 1 item");
assertEqual(identityItems[0].id, "item-1", "filterByCategory 'identity' returns Passport Scan");

const bankingItems = filterByCategory(testManifest, "banking");
assertEqual(bankingItems.length, 1, "filterByCategory 'banking' returns 1 item");
assertEqual(bankingItems[0].id, "item-2", "filterByCategory 'banking' returns Bank of America");

// ---------------------------------------------------------------------------
// filterByTag
// ---------------------------------------------------------------------------

const travelTagged = filterByTag(testManifest, "travel");
assertEqual(travelTagged.length, 1, "filterByTag 'travel' returns 1 item");
assertEqual(travelTagged[0].id, "item-1", "filterByTag 'travel' returns item 1");

const taxesTagged = filterByTag(testManifest, "taxes");
assertEqual(taxesTagged.length, 1, "filterByTag 'taxes' returns 1 item");
assertEqual(taxesTagged[0].id, "item-4", "filterByTag 'taxes' returns item 4");

// ---------------------------------------------------------------------------
// filterFavorites
// ---------------------------------------------------------------------------

const favorites = filterFavorites(testManifest);
assertEqual(favorites.length, 1, "filterFavorites returns 1 item");
assertEqual(favorites[0].id, "item-1", "filterFavorites returns the favorited item");

// ---------------------------------------------------------------------------
// filterRecent
// ---------------------------------------------------------------------------

const recent2 = filterRecent(testManifest, 2);
assertEqual(recent2.length, 2, "filterRecent limit 2 returns 2 items");
// item1 has highest accessedAt (Jan 10), item2 next (Jan 9)
assertEqual(recent2[0].id, "item-1", "filterRecent first is most recently accessed");
assertEqual(recent2[1].id, "item-2", "filterRecent second is next most recently accessed");

// ---------------------------------------------------------------------------
// sortItems
// ---------------------------------------------------------------------------

// Sort by name (case-insensitive alphabetical)
const byName = sortItems(testManifest.items, "name");
assertEqual(byName[0].name, "Bank of America", "sortItems 'name' first is Bank of America");
assertEqual(byName[1].name, "Insurance Notes", "sortItems 'name' second is Insurance Notes");
assertEqual(byName[2].name, "Passport Scan", "sortItems 'name' third is Passport Scan");
assertEqual(byName[3].name, "Tax Return 2024", "sortItems 'name' fourth is Tax Return 2024");
assertEqual(byName[4].name, "Wi-Fi Home", "sortItems 'name' fifth is Wi-Fi Home");

// Sort by category (alphabetical by category ID)
const byCat = sortItems(testManifest.items, "category");
assertEqual(byCat[0].category, "banking", "sortItems 'category' first is banking");
assertEqual(byCat[1].category, "identity", "sortItems 'category' second is identity");
assertEqual(byCat[2].category, "insurance", "sortItems 'category' third is insurance");
assertEqual(byCat[3].category, "legal", "sortItems 'category' fourth is legal");
assertEqual(byCat[4].category, "other", "sortItems 'category' fifth is other");

// ---------------------------------------------------------------------------
// Empty manifest: all functions return empty arrays
// ---------------------------------------------------------------------------

assertEqual(searchItems(emptyManifest, "anything").length, 0, "Empty manifest: searchItems returns empty");
assertEqual(filterByCategory(emptyManifest, "identity").length, 0, "Empty manifest: filterByCategory returns empty");
assertEqual(filterByTag(emptyManifest, "travel").length, 0, "Empty manifest: filterByTag returns empty");
assertEqual(filterFavorites(emptyManifest).length, 0, "Empty manifest: filterFavorites returns empty");
assertEqual(filterRecent(emptyManifest, 5).length, 0, "Empty manifest: filterRecent returns empty");
assertEqual(sortItems([], "name").length, 0, "Empty array: sortItems returns empty");

// ---------------------------------------------------------------------------
report("search");
