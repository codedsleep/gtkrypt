/**
 * Unit tests for gtkrypt error classes.
 *
 * Validates that each error subclass has the correct name, userMessage,
 * inheritance chain, and message pass-through behavior.
 *
 * SCOPE.md 7.6 -- error classes and exit code mapping.
 */

import { assert, assertEqual, report } from "../harness.js";
import {
  GtkryptError,
  WrongPassphraseError,
  CorruptFileError,
  UnsupportedVersionError,
  PermissionError,
  CancelledError,
  InternalCryptoError,
} from "../../src/models/errors.js";

// ---------------------------------------------------------------------------
// 1. WrongPassphraseError
// ---------------------------------------------------------------------------

const wrongPass = new WrongPassphraseError();
assertEqual(wrongPass.name, "WrongPassphraseError", "WrongPassphraseError.name");
assert(wrongPass.userMessage.length > 0, "WrongPassphraseError.userMessage is non-empty");

// ---------------------------------------------------------------------------
// 2. CorruptFileError
// ---------------------------------------------------------------------------

const corrupt = new CorruptFileError();
assertEqual(corrupt.name, "CorruptFileError", "CorruptFileError.name");
assert(corrupt.userMessage.length > 0, "CorruptFileError.userMessage is non-empty");

// ---------------------------------------------------------------------------
// 3. UnsupportedVersionError
// ---------------------------------------------------------------------------

const unsupported = new UnsupportedVersionError();
assertEqual(unsupported.name, "UnsupportedVersionError", "UnsupportedVersionError.name");
assert(unsupported.userMessage.length > 0, "UnsupportedVersionError.userMessage is non-empty");

// ---------------------------------------------------------------------------
// 4. PermissionError
// ---------------------------------------------------------------------------

const perm = new PermissionError();
assertEqual(perm.name, "PermissionError", "PermissionError.name");
assert(perm.userMessage.length > 0, "PermissionError.userMessage is non-empty");

// ---------------------------------------------------------------------------
// 5. CancelledError (silent -- empty userMessage)
// ---------------------------------------------------------------------------

const cancelled = new CancelledError();
assertEqual(cancelled.name, "CancelledError", "CancelledError.name");
assertEqual(cancelled.userMessage, "", "CancelledError.userMessage is empty (silent)");

// ---------------------------------------------------------------------------
// 6. InternalCryptoError
// ---------------------------------------------------------------------------

const internal = new InternalCryptoError();
assertEqual(internal.name, "InternalCryptoError", "InternalCryptoError.name");
assert(internal.userMessage.length > 0, "InternalCryptoError.userMessage is non-empty");

// ---------------------------------------------------------------------------
// 7. All errors are instances of GtkryptError
// ---------------------------------------------------------------------------

assert(wrongPass instanceof GtkryptError, "WrongPassphraseError instanceof GtkryptError");
assert(corrupt instanceof GtkryptError, "CorruptFileError instanceof GtkryptError");
assert(unsupported instanceof GtkryptError, "UnsupportedVersionError instanceof GtkryptError");
assert(perm instanceof GtkryptError, "PermissionError instanceof GtkryptError");
assert(cancelled instanceof GtkryptError, "CancelledError instanceof GtkryptError");
assert(internal instanceof GtkryptError, "InternalCryptoError instanceof GtkryptError");

// ---------------------------------------------------------------------------
// 8. All errors are instances of Error
// ---------------------------------------------------------------------------

assert(wrongPass instanceof Error, "WrongPassphraseError instanceof Error");
assert(corrupt instanceof Error, "CorruptFileError instanceof Error");
assert(unsupported instanceof Error, "UnsupportedVersionError instanceof Error");
assert(perm instanceof Error, "PermissionError instanceof Error");
assert(cancelled instanceof Error, "CancelledError instanceof Error");
assert(internal instanceof Error, "InternalCryptoError instanceof Error");

// GtkryptError itself is also an Error
const base = new GtkryptError("test", "test msg");
assert(base instanceof Error, "GtkryptError instanceof Error");
assertEqual(base.name, "GtkryptError", "GtkryptError.name");

// ---------------------------------------------------------------------------
// 9. Custom messages pass through to the message property
// ---------------------------------------------------------------------------

const customWrong = new WrongPassphraseError("custom wrong passphrase detail");
assertEqual(
  customWrong.message,
  "custom wrong passphrase detail",
  "WrongPassphraseError custom message passes through",
);

const customCorrupt = new CorruptFileError("custom corrupt detail");
assertEqual(
  customCorrupt.message,
  "custom corrupt detail",
  "CorruptFileError custom message passes through",
);

const customUnsupported = new UnsupportedVersionError("custom version detail");
assertEqual(
  customUnsupported.message,
  "custom version detail",
  "UnsupportedVersionError custom message passes through",
);

const customPerm = new PermissionError("custom permission detail");
assertEqual(
  customPerm.message,
  "custom permission detail",
  "PermissionError custom message passes through",
);

const customCancelled = new CancelledError("custom cancel detail");
assertEqual(
  customCancelled.message,
  "custom cancel detail",
  "CancelledError custom message passes through",
);

const customInternal = new InternalCryptoError("custom internal detail");
assertEqual(
  customInternal.message,
  "custom internal detail",
  "InternalCryptoError custom message passes through",
);

// Also verify default messages are set when no argument is passed
assertEqual(
  wrongPass.message,
  "Wrong passphrase or integrity check failed",
  "WrongPassphraseError default message",
);
assertEqual(
  corrupt.message,
  "Corrupt or unrecognized file format",
  "CorruptFileError default message",
);
assertEqual(
  unsupported.message,
  "Unsupported container version",
  "UnsupportedVersionError default message",
);
assertEqual(
  perm.message,
  "Permission denied",
  "PermissionError default message",
);
assertEqual(
  cancelled.message,
  "Operation cancelled",
  "CancelledError default message",
);
assertEqual(
  internal.message,
  "Internal crypto error",
  "InternalCryptoError default message",
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

report("errors");
