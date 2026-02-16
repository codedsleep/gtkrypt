/**
 * Built-in document templates for structured vault records.
 *
 * Each template defines a set of typed fields that users fill in
 * when creating a new record. Templates are associated with a
 * default category and icon.
 */

/** A single field in a document template. */
export interface TemplateField {
  key: string;
  label: string;
  type: "text" | "date" | "number" | "multiline";
  required: boolean;
  placeholder?: string;
}

/** A document template for creating structured records. */
export interface DocumentTemplate {
  id: string;
  name: string;
  category: string;
  icon: string;
  fields: TemplateField[];
}

/** Built-in document templates. */
export const BUILTIN_TEMPLATES: DocumentTemplate[] = [
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
      { key: "issuingAuthority", label: "Issuing Authority", type: "text", required: false },
    ],
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
      { key: "expiryDate", label: "Expiry Date", type: "date", required: false },
    ],
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
      { key: "issuingState", label: "Issuing State", type: "text", required: false },
    ],
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
      { key: "bankName", label: "Bank Name", type: "text", required: false },
    ],
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
      { key: "swift", label: "SWIFT / BIC", type: "text", required: false },
    ],
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
      { key: "notes", label: "Notes", type: "multiline", required: false },
    ],
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
      { key: "coverageAmount", label: "Coverage Amount", type: "number", required: false },
    ],
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
      { key: "notes", label: "Notes", type: "multiline", required: false },
    ],
  },
  {
    id: "wifi-network",
    name: "Wi-Fi Network",
    category: "other",
    icon: "network-wireless-symbolic",
    fields: [
      { key: "ssid", label: "Network Name (SSID)", type: "text", required: true },
      { key: "password", label: "Password", type: "text", required: true },
      { key: "securityType", label: "Security Type", type: "text", required: false, placeholder: "WPA2 / WPA3" },
    ],
  },
];
