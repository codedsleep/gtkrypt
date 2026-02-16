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

// src/models/templates.ts
var BUILTIN_TEMPLATES = [
  {
    id: "passport",
    name: "Passport",
    category: "identity",
    icon: "contact-new-symbolic",
    fields: [
      { key: "number", label: "Passport Number", type: "text", required: true, placeholder: "AB1234567" },
      { key: "fullName", label: "Full Name", type: "text", required: true },
      { key: "nationality", label: "Nationality", type: "text", required: true },
      { key: "dateOfBirth", label: "Date of Birth", type: "date", required: true },
      { key: "issueDate", label: "Issue Date", type: "date", required: true },
      { key: "expiryDate", label: "Expiry Date", type: "date", required: true },
      { key: "issuingAuthority", label: "Issuing Authority", type: "text", required: false }
    ]
  },
  {
    id: "national-id",
    name: "National ID",
    category: "identity",
    icon: "contact-new-symbolic",
    fields: [
      { key: "number", label: "ID Number", type: "text", required: true },
      { key: "fullName", label: "Full Name", type: "text", required: true },
      { key: "dateOfBirth", label: "Date of Birth", type: "date", required: true },
      { key: "issueDate", label: "Issue Date", type: "date", required: false },
      { key: "expiryDate", label: "Expiry Date", type: "date", required: false }
    ]
  },
  {
    id: "drivers-license",
    name: "Driver's License",
    category: "identity",
    icon: "contact-new-symbolic",
    fields: [
      { key: "number", label: "License Number", type: "text", required: true },
      { key: "fullName", label: "Full Name", type: "text", required: true },
      { key: "class", label: "Category / Class", type: "text", required: true },
      { key: "issueDate", label: "Issue Date", type: "date", required: false },
      { key: "expiryDate", label: "Expiry Date", type: "date", required: true },
      { key: "issuingState", label: "Issuing State", type: "text", required: false }
    ]
  },
  {
    id: "credit-card",
    name: "Credit/Debit Card",
    category: "banking",
    icon: "wallet-symbolic",
    fields: [
      { key: "cardName", label: "Card Name", type: "text", required: true, placeholder: "Visa Gold" },
      { key: "cardNumber", label: "Card Number", type: "text", required: true, placeholder: "1234 5678 9012 3456" },
      { key: "cardholderName", label: "Cardholder Name", type: "text", required: true },
      { key: "expiryDate", label: "Expiry Date", type: "text", required: true, placeholder: "MM/YY" },
      { key: "bankName", label: "Bank Name", type: "text", required: false }
    ]
  },
  {
    id: "bank-account",
    name: "Bank Account",
    category: "banking",
    icon: "wallet-symbolic",
    fields: [
      { key: "bankName", label: "Bank Name", type: "text", required: true },
      { key: "accountHolder", label: "Account Holder", type: "text", required: true },
      { key: "accountNumber", label: "Account Number", type: "text", required: true },
      { key: "routingCode", label: "Routing / Sort Code", type: "text", required: false },
      { key: "iban", label: "IBAN", type: "text", required: false },
      { key: "swift", label: "SWIFT / BIC", type: "text", required: false }
    ]
  },
  {
    id: "medical-record",
    name: "Medical Record",
    category: "medical",
    icon: "heart-filled-symbolic",
    fields: [
      { key: "patientName", label: "Patient Name", type: "text", required: true },
      { key: "date", label: "Date", type: "date", required: true },
      { key: "provider", label: "Healthcare Provider", type: "text", required: true },
      { key: "diagnosis", label: "Diagnosis / Condition", type: "text", required: false },
      { key: "notes", label: "Notes", type: "multiline", required: false }
    ]
  },
  {
    id: "insurance-policy",
    name: "Insurance Policy",
    category: "insurance",
    icon: "shield-safe-symbolic",
    fields: [
      { key: "provider", label: "Provider", type: "text", required: true },
      { key: "policyNumber", label: "Policy Number", type: "text", required: true },
      { key: "type", label: "Type", type: "text", required: true, placeholder: "Health / Auto / Home / Life" },
      { key: "startDate", label: "Start Date", type: "date", required: true },
      { key: "endDate", label: "End Date", type: "date", required: false },
      { key: "coverageAmount", label: "Coverage Amount", type: "number", required: false }
    ]
  },
  {
    id: "login-credentials",
    name: "Login Credentials",
    category: "other",
    icon: "dialog-password-symbolic",
    fields: [
      { key: "serviceName", label: "Service Name", type: "text", required: true, placeholder: "GitHub" },
      { key: "username", label: "Username / Email", type: "text", required: true },
      { key: "password", label: "Password", type: "text", required: true },
      { key: "url", label: "URL", type: "text", required: false, placeholder: "https://..." },
      { key: "notes", label: "Notes", type: "multiline", required: false }
    ]
  },
  {
    id: "wifi-network",
    name: "Wi-Fi Network",
    category: "other",
    icon: "network-wireless-symbolic",
    fields: [
      { key: "ssid", label: "Network Name (SSID)", type: "text", required: true },
      { key: "password", label: "Password", type: "text", required: true },
      { key: "securityType", label: "Security Type", type: "text", required: false, placeholder: "WPA2 / WPA3" }
    ]
  }
];

// src/util/uuid.ts
import GLib from "gi://GLib";
function generateUuid() {
  return GLib.uuid_string_random();
}

// tests/unit/vault-types.test.ts
assertEqual(DEFAULT_CATEGORIES.length, 10, "DEFAULT_CATEGORIES has 10 entries");
for (const cat of DEFAULT_CATEGORIES) {
  assert(cat.id.length > 0, `Category "${cat.id}" has non-empty id`);
  assert(cat.label.length > 0, `Category "${cat.id}" has non-empty label`);
  assert(cat.icon.length > 0, `Category "${cat.id}" has non-empty icon`);
  assertEqual(cat.builtin, true, `Category "${cat.id}" has builtin: true`);
}
var categoryIds = DEFAULT_CATEGORIES.map((c) => c.id);
var uniqueCategoryIds = new Set(categoryIds);
assertEqual(uniqueCategoryIds.size, categoryIds.length, "Category IDs are unique");
var expectedCategories = [
  "identity",
  "banking",
  "medical",
  "insurance",
  "legal",
  "education",
  "travel",
  "property",
  "vehicle",
  "other"
];
for (const id of expectedCategories) {
  assert(categoryIds.includes(id), `Category "${id}" exists`);
}
assert(BUILTIN_TEMPLATES.length > 0, "BUILTIN_TEMPLATES is not empty");
var validFieldTypes = /* @__PURE__ */ new Set(["text", "date", "number", "multiline"]);
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
      `Template "${tpl.id}" field "${field.key}" has valid type "${field.type}"`
    );
  }
}
var uuid = generateUuid();
assertEqual(uuid.length, 36, "UUID has length 36");
var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
assert(uuidPattern.test(uuid), "UUID matches 8-4-4-4-12 hex pattern");
var uuids = /* @__PURE__ */ new Set();
for (let i = 0; i < 1e3; i++) {
  uuids.add(generateUuid());
}
assertEqual(uuids.size, 1e3, "1000 generated UUIDs are all unique");
report("vault-types");
//# sourceMappingURL=vault-types.test.js.map
