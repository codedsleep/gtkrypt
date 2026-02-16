/**
 * Unit tests for vault types, categories, templates, and UUID generation.
 */

import { assert, assertEqual, report } from "../harness.js";
import { DEFAULT_CATEGORIES } from "../../src/models/categories.js";
import { BUILTIN_TEMPLATES } from "../../src/models/templates.js";
import { generateUuid } from "../../src/util/uuid.js";

// ---------------------------------------------------------------------------
// DEFAULT_CATEGORIES
// ---------------------------------------------------------------------------

assertEqual(DEFAULT_CATEGORIES.length, 10, "DEFAULT_CATEGORIES has 10 entries");

for (const cat of DEFAULT_CATEGORIES) {
  assert(cat.id.length > 0, `Category "${cat.id}" has non-empty id`);
  assert(cat.label.length > 0, `Category "${cat.id}" has non-empty label`);
  assert(cat.icon.length > 0, `Category "${cat.id}" has non-empty icon`);
  assertEqual(cat.builtin, true, `Category "${cat.id}" has builtin: true`);
}

// All category IDs are unique
const categoryIds = DEFAULT_CATEGORIES.map((c) => c.id);
const uniqueCategoryIds = new Set(categoryIds);
assertEqual(uniqueCategoryIds.size, categoryIds.length, "Category IDs are unique");

// Specific expected categories exist
const expectedCategories = [
  "identity", "banking", "medical", "insurance", "legal",
  "education", "travel", "property", "vehicle", "other",
];
for (const id of expectedCategories) {
  assert(categoryIds.includes(id), `Category "${id}" exists`);
}

// ---------------------------------------------------------------------------
// BUILTIN_TEMPLATES
// ---------------------------------------------------------------------------

assert(BUILTIN_TEMPLATES.length > 0, "BUILTIN_TEMPLATES is not empty");

const validFieldTypes = new Set(["text", "date", "number", "multiline"]);

for (const tpl of BUILTIN_TEMPLATES) {
  assert(tpl.id.length > 0, `Template "${tpl.id}" has non-empty id`);
  assert(tpl.name.length > 0, `Template "${tpl.id}" has non-empty name`);
  assert(tpl.category.length > 0, `Template "${tpl.id}" has non-empty category`);
  assert(tpl.icon.length > 0, `Template "${tpl.id}" has non-empty icon`);
  assert(tpl.fields.length >= 3, `Template "${tpl.id}" has at least 3 fields`);

  for (const field of tpl.fields) {
    assert(field.key.length > 0, `Template "${tpl.id}" field has non-empty key`);
    assert(field.label.length > 0, `Template "${tpl.id}" field has non-empty label`);
    assert(
      validFieldTypes.has(field.type),
      `Template "${tpl.id}" field "${field.key}" has valid type "${field.type}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// generateUuid
// ---------------------------------------------------------------------------

const uuid = generateUuid();
assertEqual(uuid.length, 36, "UUID has length 36");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
assert(uuidPattern.test(uuid), "UUID matches 8-4-4-4-12 hex pattern");

// 1000 UUIDs should all be unique
const uuids = new Set<string>();
for (let i = 0; i < 1000; i++) {
  uuids.add(generateUuid());
}
assertEqual(uuids.size, 1000, "1000 generated UUIDs are all unique");

// ---------------------------------------------------------------------------
report("vault-types");
