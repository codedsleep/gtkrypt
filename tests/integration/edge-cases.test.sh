#!/usr/bin/env bash
# Integration tests for edge cases (SCOPE.md 7.9)
# Tests: empty file, very long filename, read-only output dir, symlink input
set -euo pipefail

CRYPTO_BIN="${CRYPTO_BIN:-crypto/target/release/gtkrypt-crypto}"
TMPDIR="$(mktemp -d)"
trap "rm -rf $TMPDIR" EXIT

PASS=0
FAIL=0
ERRORS=()

# Use fast KDF params for test speed
KDF_ARGS="--time-cost 1 --memory-cost 1024 --parallelism 1"
PASSPHRASE="edge-case-test-passphrase"

pass() {
  echo "  PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "  FAIL: $1 — $2"
  FAIL=$((FAIL + 1))
  ERRORS+=("$1")
}

# ---------------------------------------------------------------------------
# Test 1: Empty file (0 bytes)
# Encrypt an empty file, decrypt it, and verify the output is also 0 bytes.
# ---------------------------------------------------------------------------
echo "--- Test 1: Empty file (0 bytes) ---"

EMPTY_DIR="$TMPDIR/empty"
mkdir -p "$EMPTY_DIR"
touch "$EMPTY_DIR/empty.txt"

# Verify input is truly 0 bytes
INPUT_SIZE=$(stat --format='%s' "$EMPTY_DIR/empty.txt")
if [ "$INPUT_SIZE" -ne 0 ]; then
  fail "empty-file-setup" "Input file is not 0 bytes (got $INPUT_SIZE)"
else
  # Encrypt
  if echo "$PASSPHRASE" | $CRYPTO_BIN encrypt \
      --input "$EMPTY_DIR/empty.txt" \
      --output "$EMPTY_DIR/empty.txt.gtkrypt" \
      $KDF_ARGS > /dev/null 2>&1; then

    # Encrypted file should exist and contain at least the header
    if [ -f "$EMPTY_DIR/empty.txt.gtkrypt" ]; then
      pass "empty-file-encrypt"
    else
      fail "empty-file-encrypt" "Encrypted output file not found"
    fi

    # Decrypt
    if echo "$PASSPHRASE" | $CRYPTO_BIN decrypt \
        --input "$EMPTY_DIR/empty.txt.gtkrypt" \
        --output "$EMPTY_DIR/empty-decrypted.txt" \
        > /dev/null 2>&1; then

      # Verify decrypted output is 0 bytes
      DECRYPTED_SIZE=$(stat --format='%s' "$EMPTY_DIR/empty-decrypted.txt")
      if [ "$DECRYPTED_SIZE" -eq 0 ]; then
        pass "empty-file-decrypt-size"
      else
        fail "empty-file-decrypt-size" "Decrypted file is $DECRYPTED_SIZE bytes, expected 0"
      fi
    else
      fail "empty-file-decrypt" "Decrypt command failed"
    fi
  else
    fail "empty-file-encrypt" "Encrypt command failed"
  fi
fi

# ---------------------------------------------------------------------------
# Test 2: Very long filename (255 bytes UTF-8)
# Create a file with a 255-character name, encrypt with --store-filename,
# decrypt, and verify the stored filename was preserved in the header.
# ---------------------------------------------------------------------------
echo "--- Test 2: Very long filename (255 bytes UTF-8) ---"

LONGNAME_DIR="$TMPDIR/longname"
mkdir -p "$LONGNAME_DIR"

# Generate a 255-character ASCII filename (stays within filesystem limits)
LONG_FILENAME=$(python3 -c "print('A' * 251 + '.txt')")
echo "long filename test content" > "$LONGNAME_DIR/$LONG_FILENAME"

# Verify the filename length
ACTUAL_LEN=${#LONG_FILENAME}
if [ "$ACTUAL_LEN" -ne 255 ]; then
  fail "long-filename-setup" "Filename is $ACTUAL_LEN chars, expected 255"
else
  # Encrypt with --store-filename
  if echo "$PASSPHRASE" | $CRYPTO_BIN encrypt \
      --input "$LONGNAME_DIR/$LONG_FILENAME" \
      --output "$LONGNAME_DIR/encrypted.gtkrypt" \
      --store-filename \
      $KDF_ARGS > /dev/null 2>&1; then

    pass "long-filename-encrypt"

    # Verify the stored filename by reading the header:
    # Offset 49-50 is filename_len (uint16 BE), then the filename follows.
    # We read the filename_len and then extract the filename bytes.
    STORED_FILENAME=$(python3 -c "
import struct, sys
with open('$LONGNAME_DIR/encrypted.gtkrypt', 'rb') as f:
    data = f.read(512)
    fn_len = struct.unpack('>H', data[49:51])[0]
    fn = data[51:51+fn_len].decode('utf-8')
    print(fn, end='')
")
    if [ "$STORED_FILENAME" = "$LONG_FILENAME" ]; then
      pass "long-filename-stored"
    else
      fail "long-filename-stored" "Stored filename does not match (got ${#STORED_FILENAME} chars)"
    fi

    # Decrypt and verify content roundtrip
    if echo "$PASSPHRASE" | $CRYPTO_BIN decrypt \
        --input "$LONGNAME_DIR/encrypted.gtkrypt" \
        --output "$LONGNAME_DIR/decrypted.txt" \
        > /dev/null 2>&1; then

      DECRYPTED_CONTENT=$(cat "$LONGNAME_DIR/decrypted.txt")
      if [ "$DECRYPTED_CONTENT" = "long filename test content" ]; then
        pass "long-filename-decrypt-content"
      else
        fail "long-filename-decrypt-content" "Decrypted content does not match"
      fi
    else
      fail "long-filename-decrypt" "Decrypt command failed"
    fi
  else
    fail "long-filename-encrypt" "Encrypt command failed"
  fi
fi

# ---------------------------------------------------------------------------
# Test 3: Read-only output directory
# Create a read-only directory and try to encrypt into it. The binary should
# fail with exit code 3 (permission error).
# ---------------------------------------------------------------------------
echo "--- Test 3: Read-only output directory ---"

READONLY_DIR="$TMPDIR/readonly"
mkdir -p "$READONLY_DIR/output"
echo "readonly test" > "$READONLY_DIR/input.txt"
chmod 555 "$READONLY_DIR/output"

# Attempt to encrypt into the read-only directory
set +e
echo "$PASSPHRASE" | $CRYPTO_BIN encrypt \
    --input "$READONLY_DIR/input.txt" \
    --output "$READONLY_DIR/output/encrypted.gtkrypt" \
    $KDF_ARGS > /dev/null 2>&1
EXIT_CODE=$?
set -e

# Restore permissions so cleanup works
chmod 755 "$READONLY_DIR/output"

if [ "$EXIT_CODE" -eq 3 ]; then
  pass "readonly-output-exit-code"
else
  fail "readonly-output-exit-code" "Expected exit code 3, got $EXIT_CODE"
fi

# The output file should not exist
if [ ! -f "$READONLY_DIR/output/encrypted.gtkrypt" ]; then
  pass "readonly-output-no-file"
else
  fail "readonly-output-no-file" "Output file was created despite read-only directory"
fi

# ---------------------------------------------------------------------------
# Test 4: Symlink input
# Create a symlink to a real file and verify the Rust binary can encrypt and
# decrypt through it. (Symlink rejection is a GJS UI concern, not a Rust
# binary concern.)
# ---------------------------------------------------------------------------
echo "--- Test 4: Symlink input ---"

SYMLINK_DIR="$TMPDIR/symlink"
mkdir -p "$SYMLINK_DIR"
echo "symlink target content" > "$SYMLINK_DIR/real-file.txt"
ln -s "$SYMLINK_DIR/real-file.txt" "$SYMLINK_DIR/link-to-file.txt"

# Verify we created a symlink
if [ -L "$SYMLINK_DIR/link-to-file.txt" ]; then
  # Encrypt through the symlink
  if echo "$PASSPHRASE" | $CRYPTO_BIN encrypt \
      --input "$SYMLINK_DIR/link-to-file.txt" \
      --output "$SYMLINK_DIR/encrypted.gtkrypt" \
      $KDF_ARGS > /dev/null 2>&1; then

    pass "symlink-encrypt"

    # Decrypt and verify content matches the real file
    if echo "$PASSPHRASE" | $CRYPTO_BIN decrypt \
        --input "$SYMLINK_DIR/encrypted.gtkrypt" \
        --output "$SYMLINK_DIR/decrypted.txt" \
        > /dev/null 2>&1; then

      ORIGINAL=$(cat "$SYMLINK_DIR/real-file.txt")
      DECRYPTED=$(cat "$SYMLINK_DIR/decrypted.txt")
      if [ "$DECRYPTED" = "$ORIGINAL" ]; then
        pass "symlink-decrypt-content"
      else
        fail "symlink-decrypt-content" "Decrypted content does not match original"
      fi
    else
      fail "symlink-decrypt" "Decrypt command failed"
    fi
  else
    fail "symlink-encrypt" "Encrypt command failed on symlink input"
  fi
else
  fail "symlink-setup" "Failed to create symlink"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=============================="
echo "Edge case tests: $PASS passed, $FAIL failed"
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "Failed:"
  for e in "${ERRORS[@]}"; do
    echo "  - $e"
  done
  exit 1
fi
echo "All edge case tests passed."
