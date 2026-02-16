/**
 * Default category definitions for vault items.
 *
 * Built-in categories cannot be deleted by the user. Custom categories
 * can be added through the category manager UI.
 */

import type { CategoryDef } from "./types.js";

/** Default set of built-in vault categories. */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: "identity", label: "Identity Documents", icon: "contact-new-symbolic", builtin: true },
  { id: "banking", label: "Banking & Finance", icon: "wallet-symbolic", builtin: true },
  { id: "medical", label: "Medical Records", icon: "heart-filled-symbolic", builtin: true },
  { id: "insurance", label: "Insurance", icon: "shield-safe-symbolic", builtin: true },
  { id: "legal", label: "Legal Documents", icon: "text-x-generic-symbolic", builtin: true },
  { id: "education", label: "Education", icon: "school-symbolic", builtin: true },
  { id: "travel", label: "Travel", icon: "airplane-symbolic", builtin: true },
  { id: "property", label: "Property & Housing", icon: "building-symbolic", builtin: true },
  { id: "vehicle", label: "Vehicles", icon: "car-symbolic", builtin: true },
  { id: "other", label: "Other", icon: "folder-symbolic", builtin: true },
];
