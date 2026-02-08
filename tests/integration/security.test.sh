#!/usr/bin/env bash
# Integration tests for gtkrypt-crypto security properties (SCOPE.md 7.8)
#
# Validates that the crypto binary correctly rejects:
#   - Wrong passphrases (no plaintext leakage)
#   - Corrupted ciphertext (GCM authentication failure)
#   - Corrupted header magic (not recognized as gtkrypt file)
#   - Tampered header AAD bytes (GCM authentication failure)
# Also validates output file permissions are restrictive.
#
# Exit codes from the binary:
#   0  = success
#   1  = wrong passphrase (also covers GCM auth failures)
#   2  = corrupt file (header parse failure)
#   3  = permission error
#   10 = internal error

set -euo pipefail

CRYPTO_BIN="${CRYPTO_BIN:-crypto/target/release/gtkrypt-crypto}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

PASS=0
FAIL=0
TOTAL=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Use minimal KDF params so tests run fast
KDF_TIME=1
KDF_MEM=1024
KDF_PAR=1

# Run encryption with fast KDF params.
# Usage: do_encrypt <passphrase> <input> <output>
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

# Run decryption.
# Usage: do_decrypt <passphrase> <input> <output>
do_decrypt() {
  local pass="$1" input="$2" output="$3"
  printf '%s\n' "$pass" | "$CRYPTO_BIN" decrypt \
    --input "$input" \
    --output "$output" \
    >/dev/null 2>&1
}

# Run a command that is expected to fail with a specific exit code.
# Usage: expect_exit <expected_code> <command> [args...]
# Returns 0 if the command failed with the expected code, 1 otherwise.
expect_exit() {
  local expected="$1"; shift
  local actual=0
  "$@" || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    return 0
  else
    echo "    Expected exit code $expected, got $actual"
    return 1
  fi
}

# Announce a test and track counts.
# Usage: run_test <name> <function>
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

# ---------------------------------------------------------------------------
# Setup: create a sample plaintext file used by most tests
# ---------------------------------------------------------------------------

PLAINTEXT="$TMPDIR/sample.txt"
printf 'The quick brown fox jumps over the lazy dog.\n' > "$PLAINTEXT"

# ---------------------------------------------------------------------------
# Test 1: Wrong passphrase produces exit code 1 and no output file
# ---------------------------------------------------------------------------

test_wrong_passphrase() {
  local enc="$TMPDIR/wrong_pass.gtkrypt"
  local dec="$TMPDIR/wrong_pass_out.txt"

  do_encrypt "correct-passphrase" "$PLAINTEXT" "$enc"

  # Attempt decrypt with a different passphrase
  expect_exit 1 do_decrypt "wrong-passphrase" "$enc" "$dec" || return 1

  # Output file must not exist (no partial plaintext leakage)
  if [ -e "$dec" ]; then
    echo "    Output file exists after wrong passphrase -- plaintext may have leaked"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 2: Corrupted ciphertext causes authentication failure, no output
# ---------------------------------------------------------------------------

test_corrupted_ciphertext() {
  local enc="$TMPDIR/corrupt_ct.gtkrypt"
  local tampered="$TMPDIR/corrupt_ct_tampered.gtkrypt"
  local dec="$TMPDIR/corrupt_ct_out.txt"

  do_encrypt "my-secret" "$PLAINTEXT" "$enc"

  # Copy the encrypted file and flip a byte well inside the ciphertext area.
  # Header with no filename is 71 bytes (v2). Ciphertext starts at byte 71.
  # We target byte 80, safely within the first ciphertext chunk.
  cp "$enc" "$tampered"
  python3 -c "
import sys
data = bytearray(open('$tampered', 'rb').read())
if len(data) > 80:
    data[80] ^= 0xFF
    open('$tampered', 'wb').write(data)
else:
    sys.exit(1)
"

  # GCM auth failure maps to exit code 1 (wrong passphrase / auth failure)
  expect_exit 1 do_decrypt "my-secret" "$tampered" "$dec" || return 1

  # No output file
  if [ -e "$dec" ]; then
    echo "    Output file exists after corrupted ciphertext"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 3: Corrupted header magic causes exit code 2 (corrupt file)
# ---------------------------------------------------------------------------

test_corrupted_magic() {
  local enc="$TMPDIR/corrupt_magic.gtkrypt"
  local tampered="$TMPDIR/corrupt_magic_tampered.gtkrypt"
  local dec="$TMPDIR/corrupt_magic_out.txt"

  do_encrypt "magic-pass" "$PLAINTEXT" "$enc"

  # Overwrite byte 0 (first byte of "GTKRYPT\0" magic) with 0xFF
  cp "$enc" "$tampered"
  printf '\xff' | dd of="$tampered" bs=1 seek=0 count=1 conv=notrunc 2>/dev/null

  # Header parse failure: exit code 2
  expect_exit 2 do_decrypt "magic-pass" "$tampered" "$dec" || return 1

  # No output file
  if [ -e "$dec" ]; then
    echo "    Output file exists after corrupted magic"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 4: Tampered header AAD byte causes GCM authentication failure
#
# The AAD covers header bytes 0..48 (magic, version, KDF params, salt, nonce).
# We flip a byte in the nonce field (byte 40, within bytes 37-48). This does
# NOT change the KDF params, so key derivation runs at the same fast speed,
# but the stored nonce is now wrong:
#   - The per-chunk nonce derived from the tampered base nonce differs from
#     the one used during encryption.
#   - The AAD passed to GCM also differs (it includes the tampered bytes).
# Both effects cause GCM authentication to fail.
# ---------------------------------------------------------------------------

test_tampered_header_aad() {
  local enc="$TMPDIR/tampered_aad.gtkrypt"
  local tampered="$TMPDIR/tampered_aad_modified.gtkrypt"
  local dec="$TMPDIR/tampered_aad_out.txt"

  do_encrypt "aad-pass" "$PLAINTEXT" "$enc"

  # Flip byte 40 (inside the nonce field at offsets 37-48, within the AAD).
  # This avoids changing KDF params (which would make Argon2id run with
  # absurdly large time/memory costs), while still tampering with a byte
  # that GCM authenticates.
  cp "$enc" "$tampered"
  python3 -c "
data = bytearray(open('$tampered', 'rb').read())
data[40] ^= 0xFF
open('$tampered', 'wb').write(data)
"

  # GCM decryption will fail because the nonce and AAD no longer match what
  # was used during encryption. Exit code 1 (wrong passphrase / auth failure).
  expect_exit 1 do_decrypt "aad-pass" "$tampered" "$dec" || return 1

  # No output file
  if [ -e "$dec" ]; then
    echo "    Output file exists after tampered header AAD"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 5: Encrypted output file has restrictive permissions (not world-readable)
# ---------------------------------------------------------------------------

test_output_permissions() {
  local enc="$TMPDIR/perms_test.gtkrypt"

  do_encrypt "perm-pass" "$PLAINTEXT" "$enc"

  if [ ! -f "$enc" ]; then
    echo "    Encrypted output file does not exist"
    return 1
  fi

  # Get the octal permission mode (last 3 digits)
  local mode
  mode="$(stat -c '%a' "$enc" 2>/dev/null || stat -f '%Lp' "$enc" 2>/dev/null)"

  # The file should be 0600 (owner read/write only, no group or other access).
  # At minimum, the "other" permission bits must be 0 (not world-readable).
  local other_bits="${mode: -1}"
  if [ "$other_bits" != "0" ]; then
    echo "    Output file is world-accessible (mode=$mode), expected other=0"
    return 1
  fi

  # Group bits should also be 0 for 0600
  local group_bits="${mode: -2:1}"
  if [ "$group_bits" != "0" ]; then
    echo "    Output file is group-accessible (mode=$mode), expected group=0"
    return 1
  fi

  # Verify owner has read+write (6)
  local owner_bits="${mode: -3:1}"
  if [ "$owner_bits" != "6" ]; then
    echo "    Output file owner bits unexpected (mode=$mode), expected owner=6"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 6: Flipping a byte in the GCM auth tag causes failure, no output
# ---------------------------------------------------------------------------

test_corrupted_auth_tag() {
  local enc="$TMPDIR/corrupt_tag.gtkrypt"
  local tampered="$TMPDIR/corrupt_tag_tampered.gtkrypt"
  local dec="$TMPDIR/corrupt_tag_out.txt"

  do_encrypt "tag-pass" "$PLAINTEXT" "$enc"

  # The auth tag is the last 16 bytes of the first (and only) chunk.
  # Flip a byte in the tag area (last byte of the file for single-chunk data).
  cp "$enc" "$tampered"
  local file_size
  file_size="$(stat -c '%s' "$tampered" 2>/dev/null || stat -f '%z' "$tampered" 2>/dev/null)"
  local tag_offset=$((file_size - 1))

  python3 -c "
data = bytearray(open('$tampered', 'rb').read())
data[$tag_offset] ^= 0xFF
open('$tampered', 'wb').write(data)
"

  expect_exit 1 do_decrypt "tag-pass" "$tampered" "$dec" || return 1

  if [ -e "$dec" ]; then
    echo "    Output file exists after corrupted auth tag"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 7: Successful roundtrip still works (sanity check among security tests)
# ---------------------------------------------------------------------------

test_valid_roundtrip() {
  local enc="$TMPDIR/roundtrip.gtkrypt"
  local dec="$TMPDIR/roundtrip_out.txt"

  do_encrypt "roundtrip-pass" "$PLAINTEXT" "$enc" || {
    echo "    Encryption failed"
    return 1
  }

  do_decrypt "roundtrip-pass" "$enc" "$dec" || {
    echo "    Decryption failed"
    return 1
  }

  if ! diff -q "$PLAINTEXT" "$dec" >/dev/null 2>&1; then
    echo "    Decrypted content does not match original"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------

echo ""
echo "Security property tests"
echo "======================="

run_test "Wrong passphrase: exit 1, no output file"        test_wrong_passphrase
run_test "Corrupted ciphertext: GCM auth fails, no output" test_corrupted_ciphertext
run_test "Corrupted header magic: exit 2, no output"       test_corrupted_magic
run_test "Tampered header AAD byte: GCM auth fails"        test_tampered_header_aad
run_test "Output permissions: not world-readable (0600)"   test_output_permissions
run_test "Corrupted auth tag: GCM auth fails, no output"   test_corrupted_auth_tag
run_test "Valid roundtrip: sanity check"                    test_valid_roundtrip

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "------------------------------"
echo "Security tests: $PASS passed, $FAIL failed (out of $TOTAL)"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "All security tests passed."
exit 0
