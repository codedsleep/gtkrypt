#!/usr/bin/env bash
# Integration tests: vault item operations (SCOPE.md 13.5, 13.7)
#
# Verifies adding/retrieving/removing encrypted items (files, records,
# notes) in a vault, and image data roundtrip for thumbnails.
set -euo pipefail

CRYPTO_BIN="${CRYPTO_BIN:-crypto/target/release/gtkrypt-crypto}"
PASS=0
FAIL=0
TOTAL=0

# Use fast KDF params for test speed
KDF_TIME=1
KDF_MEM=1024
KDF_PAR=1
PASSPHRASE="vault-items-test-pass"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

do_encrypt() {
  local pass="$1" input="$2" output="$3"
  printf '%s\n' "$pass" | "$CRYPTO_BIN" encrypt \
    --input "$input" \
    --output "$output" \
    --time-cost "$KDF_TIME" \
    --memory-cost "$KDF_MEM" \
    --parallelism "$KDF_PAR" \
    >/dev/null 2>&1
}

do_decrypt() {
  local pass="$1" input="$2" output="$3"
  printf '%s\n' "$pass" | "$CRYPTO_BIN" decrypt \
    --input "$input" \
    --output "$output" \
    >/dev/null 2>&1
}

run_test() {
  local name="$1" func="$2"
  TOTAL=$((TOTAL + 1))
  echo "  [$TOTAL] $name"
  if "$func"; then
    echo "    PASSED"
    PASS=$((PASS + 1))
  else
    echo "    FAILED"
    FAIL=$((FAIL + 1))
  fi
}

# Create temp dir and clean up on exit
TEST_TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TMPDIR"' EXIT

# Set up a vault directory structure for item tests
VAULT_DIR="$TEST_TMPDIR/vault"
mkdir -p "$VAULT_DIR/items"
mkdir -p "$VAULT_DIR/thumbs"

# ---------------------------------------------------------------------------
# Test 1: Add file item → encrypt to items dir, verify exists
# ---------------------------------------------------------------------------
test_add_file() {
  local original="$TEST_TMPDIR/original-file.txt"
  local item_id="file-item-001"
  local encrypted="$VAULT_DIR/items/${item_id}.gtkrypt"

  printf 'This is a test file for vault item storage.\nMultiple lines of content.\n' > "$original"

  do_encrypt "$PASSPHRASE" "$original" "$encrypted" || {
    echo "    Encryption failed"
    return 1
  }

  if [ ! -s "$encrypted" ]; then
    echo "    Encrypted item file missing or empty"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 2: Get file data → decrypt item, verify content matches
# ---------------------------------------------------------------------------
test_get_file_data() {
  local original="$TEST_TMPDIR/original-file.txt"
  local item_id="file-item-001"
  local encrypted="$VAULT_DIR/items/${item_id}.gtkrypt"
  local decrypted="$TEST_TMPDIR/decrypted-file.txt"

  do_decrypt "$PASSPHRASE" "$encrypted" "$decrypted" || {
    echo "    Decryption failed"
    return 1
  }

  if ! diff -q "$original" "$decrypted" >/dev/null 2>&1; then
    echo "    Decrypted content does not match original"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 3: Add record → encrypt JSON record, decrypt and verify roundtrip
# ---------------------------------------------------------------------------
test_add_record() {
  local record_file="$TEST_TMPDIR/record.json"
  local item_id="record-item-001"
  local encrypted="$VAULT_DIR/items/${item_id}.gtkrypt"
  local decrypted="$TEST_TMPDIR/decrypted-record.json"

  local record_json='{"type":"record","title":"Bank Login","fields":[{"name":"username","value":"john@example.com"},{"name":"password","value":"s3cret!"}]}'
  printf '%s' "$record_json" > "$record_file"

  do_encrypt "$PASSPHRASE" "$record_file" "$encrypted" || {
    echo "    Record encryption failed"
    return 1
  }

  do_decrypt "$PASSPHRASE" "$encrypted" "$decrypted" || {
    echo "    Record decryption failed"
    return 1
  }

  local decrypted_content
  decrypted_content="$(cat "$decrypted")"
  if [ "$decrypted_content" != "$record_json" ]; then
    echo "    Record JSON roundtrip mismatch"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 4: Add note → encrypt JSON note, decrypt and verify roundtrip
# ---------------------------------------------------------------------------
test_add_note() {
  local note_file="$TEST_TMPDIR/note.json"
  local item_id="note-item-001"
  local encrypted="$VAULT_DIR/items/${item_id}.gtkrypt"
  local decrypted="$TEST_TMPDIR/decrypted-note.json"

  local note_json='{"type":"note","title":"My Secret Note","content":"This is a confidential note with special chars: éàü\n and symbols: @#$%"}'
  printf '%s' "$note_json" > "$note_file"

  do_encrypt "$PASSPHRASE" "$note_file" "$encrypted" || {
    echo "    Note encryption failed"
    return 1
  }

  do_decrypt "$PASSPHRASE" "$encrypted" "$decrypted" || {
    echo "    Note decryption failed"
    return 1
  }

  local decrypted_content
  decrypted_content="$(cat "$decrypted")"
  if [ "$decrypted_content" != "$note_json" ]; then
    echo "    Note JSON roundtrip mismatch"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 5: Remove item → delete encrypted file, verify gone
# ---------------------------------------------------------------------------
test_remove_item() {
  local remove_file="$TEST_TMPDIR/to-remove.txt"
  local item_id="remove-item-001"
  local encrypted="$VAULT_DIR/items/${item_id}.gtkrypt"

  printf 'File to be removed' > "$remove_file"
  do_encrypt "$PASSPHRASE" "$remove_file" "$encrypted" || {
    echo "    Setup encryption failed"
    return 1
  }

  # Verify it exists first
  if [ ! -f "$encrypted" ]; then
    echo "    Encrypted file not created"
    return 1
  fi

  # Remove the item
  rm "$encrypted"

  # Verify it's gone
  if [ -f "$encrypted" ]; then
    echo "    Encrypted file still exists after removal"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 6: Multiple items → add 3, verify all exist, remove one, verify correct one gone
# ---------------------------------------------------------------------------
test_multiple_items() {
  local items=("multi-001" "multi-002" "multi-003")

  # Add 3 items
  for item_id in "${items[@]}"; do
    local src="$TEST_TMPDIR/${item_id}.txt"
    printf 'Content for %s' "$item_id" > "$src"
    do_encrypt "$PASSPHRASE" "$src" "$VAULT_DIR/items/${item_id}.gtkrypt" || {
      echo "    Failed to encrypt $item_id"
      return 1
    }
  done

  # Verify all 3 exist
  for item_id in "${items[@]}"; do
    if [ ! -f "$VAULT_DIR/items/${item_id}.gtkrypt" ]; then
      echo "    Missing item: $item_id"
      return 1
    fi
  done

  # Remove the middle one
  rm "$VAULT_DIR/items/multi-002.gtkrypt"

  # Verify multi-002 is gone
  if [ -f "$VAULT_DIR/items/multi-002.gtkrypt" ]; then
    echo "    multi-002 still exists after removal"
    return 1
  fi

  # Verify multi-001 and multi-003 still exist
  if [ ! -f "$VAULT_DIR/items/multi-001.gtkrypt" ]; then
    echo "    multi-001 missing after removing multi-002"
    return 1
  fi
  if [ ! -f "$VAULT_DIR/items/multi-003.gtkrypt" ]; then
    echo "    multi-003 missing after removing multi-002"
    return 1
  fi

  # Verify remaining items decrypt correctly
  for item_id in "multi-001" "multi-003"; do
    local dec="$TEST_TMPDIR/${item_id}-dec.txt"
    do_decrypt "$PASSPHRASE" "$VAULT_DIR/items/${item_id}.gtkrypt" "$dec" || {
      echo "    Failed to decrypt $item_id after removing multi-002"
      return 1
    }
    local expected
    expected="$(printf 'Content for %s' "$item_id")"
    local actual
    actual="$(cat "$dec")"
    if [ "$actual" != "$expected" ]; then
      echo "    Content mismatch for $item_id after removing multi-002"
      return 1
    fi
  done

  return 0
}

# ---------------------------------------------------------------------------
# Test 7: Image data roundtrip (thumbnail test - 13.7)
#
# Creates a minimal valid JPEG file, encrypts to thumbs/ dir,
# decrypts, and verifies byte-for-byte match via sha256sum.
# ---------------------------------------------------------------------------
test_image_data_roundtrip() {
  local img_file="$TEST_TMPDIR/test-thumbnail.jpg"
  local encrypted="$VAULT_DIR/thumbs/thumb-001.gtkrypt"
  local decrypted="$TEST_TMPDIR/decrypted-thumbnail.jpg"

  # Create a minimal valid JPEG: SOI marker + JFIF APP0 + minimal content + EOI
  # This is a small but valid JPEG header structure
  python3 -c "
import struct, sys
# Minimal JPEG: SOI + APP0 (JFIF) + DQT + SOF0 + DHT + SOS + EOI
# We just need a binary blob that looks like image data
data = bytearray()
# SOI marker
data += b'\xff\xd8'
# APP0 JFIF marker
data += b'\xff\xe0'
data += struct.pack('>H', 16)  # length
data += b'JFIF\x00'            # identifier
data += b'\x01\x01'            # version
data += b'\x00'                # units
data += struct.pack('>HH', 1, 1)  # density
data += b'\x00\x00'            # thumbnail size
# Add some random-ish binary content to simulate image data
data += bytes(range(256)) * 4  # 1024 bytes of binary data
# EOI marker
data += b'\xff\xd9'
sys.stdout.buffer.write(data)
" > "$img_file"

  local orig_hash
  orig_hash="$(sha256sum "$img_file" | cut -d' ' -f1)"

  do_encrypt "$PASSPHRASE" "$img_file" "$encrypted" || {
    echo "    Image encryption failed"
    return 1
  }

  if [ ! -s "$encrypted" ]; then
    echo "    Encrypted thumbnail missing or empty"
    return 1
  fi

  do_decrypt "$PASSPHRASE" "$encrypted" "$decrypted" || {
    echo "    Image decryption failed"
    return 1
  }

  local dec_hash
  dec_hash="$(sha256sum "$decrypted" | cut -d' ' -f1)"

  if [ "$orig_hash" != "$dec_hash" ]; then
    echo "    SHA-256 mismatch: image data not preserved"
    echo "    Original: $orig_hash"
    echo "    Decrypted: $dec_hash"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------
echo ""
echo "Vault item operation tests"
echo "=========================="

run_test "Add file item to vault"                       test_add_file
run_test "Get file data: decrypt and verify content"    test_get_file_data
run_test "Add record: JSON roundtrip"                   test_add_record
run_test "Add note: JSON roundtrip"                     test_add_note
run_test "Remove item: delete encrypted file"           test_remove_item
run_test "Multiple items: add, verify, remove, verify"  test_multiple_items
run_test "Image data roundtrip (thumbnail)"             test_image_data_roundtrip

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "------------------------------"
echo "Vault items: $PASS passed, $FAIL failed (out of $TOTAL)"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "All vault item tests passed."
exit 0
