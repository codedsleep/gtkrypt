/**
 * Typed error classes for gtkrypt.
 *
 * Every error that can surface to the user has a `userMessage` property
 * containing a human-readable string suitable for display in the UI.
 * The `name` property is set to the class name for reliable `instanceof`
 * checks and clear stack traces.
 */

import { _ } from "../util/i18n.js";

/** Base error class for all gtkrypt errors. */
export class GtkryptError extends Error {
  public readonly userMessage: string;

  constructor(message: string, userMessage: string) {
    super(message);
    this.name = "GtkryptError";
    this.userMessage = userMessage;
  }
}

/** The passphrase did not match or the file integrity check failed. */
export class WrongPassphraseError extends GtkryptError {
  constructor(message = "Wrong passphrase or integrity check failed") {
    super(message, _("Incorrect passphrase or file corrupted."));
    this.name = "WrongPassphraseError";
  }
}

/** The file is not a valid `.gtkrypt` container or has been corrupted. */
export class CorruptFileError extends GtkryptError {
  constructor(message = "Corrupt or unrecognized file format") {
    super(message, _("Not a gtkrypt file or file is corrupted."));
    this.name = "CorruptFileError";
  }
}

/** The container version is newer than this build understands. */
export class UnsupportedVersionError extends GtkryptError {
  constructor(message = "Unsupported container version") {
    super(message, _("This file was created with a newer version of gtkrypt."));
    this.name = "UnsupportedVersionError";
  }
}

/** The application lacks write permission to the target directory. */
export class PermissionError extends GtkryptError {
  constructor(message = "Permission denied") {
    super(message, _("No permission to write to the target directory."));
    this.name = "PermissionError";
  }
}

/** The user cancelled the operation. This is a silent error. */
export class CancelledError extends GtkryptError {
  constructor(message = "Operation cancelled") {
    super(message, "");
    this.name = "CancelledError";
  }
}

/** An unexpected internal error in the crypto backend. */
export class InternalCryptoError extends GtkryptError {
  constructor(message = "Internal crypto error") {
    super(message, _("An internal error occurred. Please report this bug."));
    this.name = "InternalCryptoError";
  }
}

// ---------------------------------------------------------------------------
// Vault errors
// ---------------------------------------------------------------------------

/** Operation attempted while vault is locked. */
export class VaultLockedError extends GtkryptError {
  constructor(message = "Vault is locked") {
    super(message, _("The vault is locked. Please unlock it first."));
    this.name = "VaultLockedError";
  }
}

/** Vault directory does not exist. */
export class VaultNotFoundError extends GtkryptError {
  constructor(message = "Vault not found") {
    super(message, _("Vault not found."));
    this.name = "VaultNotFoundError";
  }
}

/** Manifest failed to parse after decryption. */
export class VaultCorruptError extends GtkryptError {
  constructor(message = "Vault data is corrupted", userMessage?: string) {
    super(message, userMessage ?? _("The vault data is corrupted."));
    this.name = "VaultCorruptError";
  }
}

/** An item's encrypted file is missing from the vault directory. */
export class ItemFileMissingError extends GtkryptError {
  constructor(message = "Item file is missing from vault") {
    super(
      message,
      _("Item file is missing from vault. The item may be corrupted."),
    );
    this.name = "ItemFileMissingError";
  }
}

/** The manifest was modified externally since last load/save. */
export class ManifestConcurrentModificationError extends GtkryptError {
  constructor(message = "Manifest was modified externally") {
    super(
      message,
      _("The vault was modified externally. Please lock and re-unlock to reload."),
    );
    this.name = "ManifestConcurrentModificationError";
  }
}

/** Item UUID not found in manifest. */
export class ItemNotFoundError extends GtkryptError {
  constructor(message = "Item not found in vault") {
    super(message, _("Item not found in vault."));
    this.name = "ItemNotFoundError";
  }
}

/** Vault with same name already exists. */
export class DuplicateVaultError extends GtkryptError {
  constructor(message = "A vault with this name already exists") {
    super(message, _("A vault with this name already exists."));
    this.name = "DuplicateVaultError";
  }
}
