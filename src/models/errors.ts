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
