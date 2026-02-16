#!/usr/bin/env bash
# Integration tests: vault lifecycle operations (SCOPE.md 13.4)
#
# Verifies vault directory structure creation, manifest encrypt/decrypt,
# wrong passphrase rejection, and vault deletion.
set -euo pipefail

CRYPTO_BIN="${CRYPTO_BIN:-crypto/target/release/gtkrypt-crypto}"
PASS=0
FAIL=0
TOTAL=0

# Use fast KDF params for test speed
KDF_TIME=1
KDF_MEM=1024
KDF_PAR=1
PASSPHRASE="vault-lifecycle-test-pass"

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

# ---------------------------------------------------------------------------
# Manifest JSON used across tests
# ---------------------------------------------------------------------------
MANIFEST_JSON='{"version":1,"name":"test-vault","createdAt":"2024-01-01T00:00:00.000Z","modifiedAt":"2024-01-01T00:00:00.000Z","kdfPreset":"balanced","categories":[],"items":[],"settings":{"autoLockMinutes":5,"defaultCategory":"other","sortOrder":"date","viewMode":"list"}}'

# ---------------------------------------------------------------------------
# Test 1: Create vault structure and encrypt manifest
# ---------------------------------------------------------------------------
test_create_vault_structure() {
  local vault_dir="$TEST_TMPDIR/vault"

  # Create vault directory structure
  mkdir -p "$vault_dir/items"
  mkdir -p "$vault_dir/thumbs"

  # Write manifest JSON to a temp file
  printf '%s' "$MANIFEST_JSON" > "$vault_dir/manifest.json"

  # Encrypt the manifest
  do_encrypt "$PASSPHRASE" "$vault_dir/manifest.json" "$vault_dir/manifest.gtkrypt" || {
    echo "    Encryption failed"
    return 1
  }

  # Verify directory structure
  if [ ! -d "$vault_dir/items" ]; then
    echo "    items/ directory missing"
    return 1
  fi

  if [ ! -d "$vault_dir/thumbs" ]; then
    echo "    thumbs/ directory missing"
    return 1
  fi

  # Verify encrypted manifest exists and is non-empty
  if [ ! -s "$vault_dir/manifest.gtkrypt" ]; then
    echo "    Encrypted manifest missing or empty"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 2: Decrypt manifest and verify JSON content
# ---------------------------------------------------------------------------
test_decrypt_manifest() {
  local vault_dir="$TEST_TMPDIR/vault"
  local decrypted="$TEST_TMPDIR/decrypted-manifest.json"

  # Decrypt the manifest
  do_decrypt "$PASSPHRASE" "$vault_dir/manifest.gtkrypt" "$decrypted" || {
    echo "    Decryption failed"
    return 1
  }

  # Verify the decrypted content matches original
  local decrypted_content
  decrypted_content="$(cat "$decrypted")"

  if [ "$decrypted_content" != "$MANIFEST_JSON" ]; then
    echo "    Content mismatch"
    echo "    Expected: $MANIFEST_JSON"
    echo "    Got:      $decrypted_content"
    return 1
  fi

  # Verify it contains expected JSON keys using grep
  for key in '"version"' '"name"' '"items"' '"settings"'; do
    if ! echo "$decrypted_content" | grep -q "$key"; then
      echo "    Missing expected key: $key"
      return 1
    fi
  done

  return 0
}

# ---------------------------------------------------------------------------
# Test 3: Wrong passphrase on manifest → exit code 1
# ---------------------------------------------------------------------------
test_wrong_passphrase() {
  local vault_dir="$TEST_TMPDIR/vault"
  local decrypted="$TEST_TMPDIR/wrong-pass-output.json"

  local exit_code=0
  do_decrypt "wrong-passphrase-123" "$vault_dir/manifest.gtkrypt" "$decrypted" || exit_code=$?

  if [ "$exit_code" -ne 1 ]; then
    echo "    Expected exit code 1, got $exit_code"
    return 1
  fi

  # Output file should not exist (no plaintext leakage)
  if [ -e "$decrypted" ]; then
    echo "    Output file exists after wrong passphrase"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 4: Delete vault directory and verify cleanup
# ---------------------------------------------------------------------------
test_delete_vault() {
  local vault_dir="$TEST_TMPDIR/vault-to-delete"

  # Create a fresh vault to delete
  mkdir -p "$vault_dir/items"
  mkdir -p "$vault_dir/thumbs"
  printf '%s' "$MANIFEST_JSON" > "$vault_dir/manifest.json"
  do_encrypt "$PASSPHRASE" "$vault_dir/manifest.json" "$vault_dir/manifest.gtkrypt" || {
    echo "    Setup encryption failed"
    return 1
  }

  # Verify vault exists
  if [ ! -d "$vault_dir" ]; then
    echo "    Vault directory was not created"
    return 1
  fi

  # Delete the vault
  rm -rf "$vault_dir"

  # Verify it's gone
  if [ -d "$vault_dir" ]; then
    echo "    Vault directory still exists after deletion"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------
echo ""
echo "Vault lifecycle tests"
echo "====================="

run_test "Create vault structure and encrypt manifest"  test_create_vault_structure
run_test "Decrypt manifest and verify JSON content"     test_decrypt_manifest
run_test "Wrong passphrase on manifest: exit code 1"    test_wrong_passphrase
run_test "Delete vault and verify cleanup"              test_delete_vault

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "------------------------------"
echo "Vault lifecycle: $PASS passed, $FAIL failed (out of $TOTAL)"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "All vault lifecycle tests passed."
exit 0
