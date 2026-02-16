/**
 * Search and filtering service for vault items.
 *
 * All operations work on the in-memory manifest — no disk I/O
 * is performed. Functions return new arrays and never mutate inputs.
 */

import type { VaultManifest, VaultItem, SortOrder } from "../models/types.js";

/**
 * Search items by case-insensitive substring match across
 * name, tags, category label, record fields, and note content.
 */
export function searchItems(
  manifest: VaultManifest,
  query: string,
): VaultItem[] {
  const q = query.toLowerCase();
  if (q.length === 0) return [...manifest.items];

  return manifest.items.filter((item) => {
    // Match item name
    if (item.name.toLowerCase().includes(q)) return true;

    // Match tags
    if (item.tags.some((tag) => tag.toLowerCase().includes(q))) return true;

    // Match category label
    const cat = manifest.categories.find((c) => c.id === item.category);
    if (cat && cat.label.toLowerCase().includes(q)) return true;

    // Match record field values
    if (item.fields) {
      for (const value of Object.values(item.fields)) {
        if (value.toLowerCase().includes(q)) return true;
      }
    }

    // Match note content
    if (item.notes && item.notes.toLowerCase().includes(q)) return true;

    return false;
  });
}

/** Filter items by category ID. */
export function filterByCategory(
  manifest: VaultManifest,
  categoryId: string,
): VaultItem[] {
  return manifest.items.filter((item) => item.category === categoryId);
}

/** Filter items by tag (case-insensitive). */
export function filterByTag(
  manifest: VaultManifest,
  tag: string,
): VaultItem[] {
  const t = tag.toLowerCase();
  return manifest.items.filter((item) =>
    item.tags.some((itemTag) => itemTag.toLowerCase() === t),
  );
}

/** Filter items that are marked as favorites. */
export function filterFavorites(manifest: VaultManifest): VaultItem[] {
  return manifest.items.filter((item) => item.favorite);
}

/** Get recently accessed items, sorted by accessedAt descending. */
export function filterRecent(
  manifest: VaultManifest,
  limit: number,
): VaultItem[] {
  return [...manifest.items]
    .sort((a, b) => b.accessedAt.localeCompare(a.accessedAt))
    .slice(0, limit);
}

/** Sort items by the specified order. Returns a new array. */
export function sortItems(items: VaultItem[], order: SortOrder): VaultItem[] {
  const sorted = [...items];

  switch (order) {
    case "name":
      sorted.sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
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
