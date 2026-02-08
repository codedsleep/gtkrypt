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

// src/util/i18n.ts
import GLib from "gi://GLib";
var domain = "gtkrypt";
imports.gettext.bindtextdomain(domain, GLib.get_home_dir());
imports.gettext.textdomain(domain);
var _ = imports.gettext.gettext;
var ngettext = imports.gettext.ngettext;

// src/models/errors.ts
var GtkryptError = class extends Error {
  userMessage;
  constructor(message, userMessage) {
    super(message);
    this.name = "GtkryptError";
    this.userMessage = userMessage;
  }
};
var WrongPassphraseError = class extends GtkryptError {
  constructor(message = "Wrong passphrase or integrity check failed") {
    super(message, _("Incorrect passphrase or file corrupted."));
    this.name = "WrongPassphraseError";
  }
};
var CorruptFileError = class extends GtkryptError {
  constructor(message = "Corrupt or unrecognized file format") {
    super(message, _("Not a gtkrypt file or file is corrupted."));
    this.name = "CorruptFileError";
  }
};
var UnsupportedVersionError = class extends GtkryptError {
  constructor(message = "Unsupported container version") {
    super(message, _("This file was created with a newer version of gtkrypt."));
    this.name = "UnsupportedVersionError";
  }
};
var PermissionError = class extends GtkryptError {
  constructor(message = "Permission denied") {
    super(message, _("No permission to write to the target directory."));
    this.name = "PermissionError";
  }
};
var CancelledError = class extends GtkryptError {
  constructor(message = "Operation cancelled") {
    super(message, "");
    this.name = "CancelledError";
  }
};
var InternalCryptoError = class extends GtkryptError {
  constructor(message = "Internal crypto error") {
    super(message, _("An internal error occurred. Please report this bug."));
    this.name = "InternalCryptoError";
  }
};

// tests/unit/errors.test.ts
var wrongPass = new WrongPassphraseError();
assertEqual(wrongPass.name, "WrongPassphraseError", "WrongPassphraseError.name");
assert(wrongPass.userMessage.length > 0, "WrongPassphraseError.userMessage is non-empty");
var corrupt = new CorruptFileError();
assertEqual(corrupt.name, "CorruptFileError", "CorruptFileError.name");
assert(corrupt.userMessage.length > 0, "CorruptFileError.userMessage is non-empty");
var unsupported = new UnsupportedVersionError();
assertEqual(unsupported.name, "UnsupportedVersionError", "UnsupportedVersionError.name");
assert(unsupported.userMessage.length > 0, "UnsupportedVersionError.userMessage is non-empty");
var perm = new PermissionError();
assertEqual(perm.name, "PermissionError", "PermissionError.name");
assert(perm.userMessage.length > 0, "PermissionError.userMessage is non-empty");
var cancelled = new CancelledError();
assertEqual(cancelled.name, "CancelledError", "CancelledError.name");
assertEqual(cancelled.userMessage, "", "CancelledError.userMessage is empty (silent)");
var internal = new InternalCryptoError();
assertEqual(internal.name, "InternalCryptoError", "InternalCryptoError.name");
assert(internal.userMessage.length > 0, "InternalCryptoError.userMessage is non-empty");
assert(wrongPass instanceof GtkryptError, "WrongPassphraseError instanceof GtkryptError");
assert(corrupt instanceof GtkryptError, "CorruptFileError instanceof GtkryptError");
assert(unsupported instanceof GtkryptError, "UnsupportedVersionError instanceof GtkryptError");
assert(perm instanceof GtkryptError, "PermissionError instanceof GtkryptError");
assert(cancelled instanceof GtkryptError, "CancelledError instanceof GtkryptError");
assert(internal instanceof GtkryptError, "InternalCryptoError instanceof GtkryptError");
assert(wrongPass instanceof Error, "WrongPassphraseError instanceof Error");
assert(corrupt instanceof Error, "CorruptFileError instanceof Error");
assert(unsupported instanceof Error, "UnsupportedVersionError instanceof Error");
assert(perm instanceof Error, "PermissionError instanceof Error");
assert(cancelled instanceof Error, "CancelledError instanceof Error");
assert(internal instanceof Error, "InternalCryptoError instanceof Error");
var base = new GtkryptError("test", "test msg");
assert(base instanceof Error, "GtkryptError instanceof Error");
assertEqual(base.name, "GtkryptError", "GtkryptError.name");
var customWrong = new WrongPassphraseError("custom wrong passphrase detail");
assertEqual(
  customWrong.message,
  "custom wrong passphrase detail",
  "WrongPassphraseError custom message passes through"
);
var customCorrupt = new CorruptFileError("custom corrupt detail");
assertEqual(
  customCorrupt.message,
  "custom corrupt detail",
  "CorruptFileError custom message passes through"
);
var customUnsupported = new UnsupportedVersionError("custom version detail");
assertEqual(
  customUnsupported.message,
  "custom version detail",
  "UnsupportedVersionError custom message passes through"
);
var customPerm = new PermissionError("custom permission detail");
assertEqual(
  customPerm.message,
  "custom permission detail",
  "PermissionError custom message passes through"
);
var customCancelled = new CancelledError("custom cancel detail");
assertEqual(
  customCancelled.message,
  "custom cancel detail",
  "CancelledError custom message passes through"
);
var customInternal = new InternalCryptoError("custom internal detail");
assertEqual(
  customInternal.message,
  "custom internal detail",
  "InternalCryptoError custom message passes through"
);
assertEqual(
  wrongPass.message,
  "Wrong passphrase or integrity check failed",
  "WrongPassphraseError default message"
);
assertEqual(
  corrupt.message,
  "Corrupt or unrecognized file format",
  "CorruptFileError default message"
);
assertEqual(
  unsupported.message,
  "Unsupported container version",
  "UnsupportedVersionError default message"
);
assertEqual(
  perm.message,
  "Permission denied",
  "PermissionError default message"
);
assertEqual(
  cancelled.message,
  "Operation cancelled",
  "CancelledError default message"
);
assertEqual(
  internal.message,
  "Internal crypto error",
  "InternalCryptoError default message"
);
report("errors");
//# sourceMappingURL=errors.test.js.map
