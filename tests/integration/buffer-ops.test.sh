#!/usr/bin/env bash
# Integration tests: buffer/in-memory operations (SCOPE.md 13.6)
#
# Verifies encrypt/decrypt roundtrip for various data sizes:
# small buffer, empty buffer, and multi-chunk (>64 KiB) buffer.
set -euo pipefail

CRYPTO_BIN="${CRYPTO_BIN:-crypto/target/release/gtkrypt-crypto}"
PASS=0
FAIL=0
TOTAL=0

# Use fast KDF params for test speed
KDF_TIME=1
KDF_MEM=1024
KDF_PAR=1
PASSPHRASE="buffer-ops-test-pass"

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
# Test 1: Small buffer roundtrip (< 1 KiB)
# ---------------------------------------------------------------------------
test_small_buffer() {
  local dir="$TEST_TMPDIR/small"
  mkdir -p "$dir"

  printf 'Small buffer content for testing.\n' > "$dir/input.dat"

  do_encrypt "$PASSPHRASE" "$dir/input.dat" "$dir/encrypted.gtkrypt" || {
    echo "    Encryption failed"
    return 1
  }

  do_decrypt "$PASSPHRASE" "$dir/encrypted.gtkrypt" "$dir/output.dat" || {
    echo "    Decryption failed"
    return 1
  }

  if ! diff -q "$dir/input.dat" "$dir/output.dat" >/dev/null 2>&1; then
    echo "    Content mismatch after roundtrip"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 2: Empty buffer roundtrip (0 bytes)
# ---------------------------------------------------------------------------
test_empty_buffer() {
  local dir="$TEST_TMPDIR/empty"
  mkdir -p "$dir"

  touch "$dir/input.dat"

  # Verify input is truly empty
  local size
  size="$(stat --format='%s' "$dir/input.dat")"
  if [ "$size" -ne 0 ]; then
    echo "    Input file is not empty ($size bytes)"
    return 1
  fi

  do_encrypt "$PASSPHRASE" "$dir/input.dat" "$dir/encrypted.gtkrypt" || {
    echo "    Encryption of empty buffer failed"
    return 1
  }

  do_decrypt "$PASSPHRASE" "$dir/encrypted.gtkrypt" "$dir/output.dat" || {
    echo "    Decryption of empty buffer failed"
    return 1
  }

  local out_size
  out_size="$(stat --format='%s' "$dir/output.dat")"
  if [ "$out_size" -ne 0 ]; then
    echo "    Decrypted empty buffer is $out_size bytes, expected 0"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 3: Multi-chunk buffer (>64 KiB, 3 chunks = 192 KiB)
# ---------------------------------------------------------------------------
test_multi_chunk_buffer() {
  local dir="$TEST_TMPDIR/multichunk"
  mkdir -p "$dir"

  # Create a 192 KiB file (3 × 64 KiB chunks)
  dd if=/dev/urandom of="$dir/input.dat" bs=65536 count=3 2>/dev/null

  local orig_hash
  orig_hash="$(sha256sum "$dir/input.dat" | cut -d' ' -f1)"

  do_encrypt "$PASSPHRASE" "$dir/input.dat" "$dir/encrypted.gtkrypt" || {
    echo "    Encryption of multi-chunk buffer failed"
    return 1
  }

  do_decrypt "$PASSPHRASE" "$dir/encrypted.gtkrypt" "$dir/output.dat" || {
    echo "    Decryption of multi-chunk buffer failed"
    return 1
  }

  local dec_hash
  dec_hash="$(sha256sum "$dir/output.dat" | cut -d' ' -f1)"

  if [ "$orig_hash" != "$dec_hash" ]; then
    echo "    SHA-256 mismatch for multi-chunk buffer"
    echo "    Original: $orig_hash"
    echo "    Decrypted: $dec_hash"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Test 4: Temp file cleanup verification
#
# After decrypt, verify the encrypted file still exists (not consumed/deleted)
# and the decrypted output matches the original.
# ---------------------------------------------------------------------------
test_temp_file_cleanup() {
  local dir="$TEST_TMPDIR/cleanup"
  mkdir -p "$dir"

  printf 'Data for temp file cleanup test.\nLine two.\n' > "$dir/input.dat"

  do_encrypt "$PASSPHRASE" "$dir/input.dat" "$dir/encrypted.gtkrypt" || {
    echo "    Encryption failed"
    return 1
  }

  # Record encrypted file size before decrypt
  local enc_size_before
  enc_size_before="$(stat --format='%s' "$dir/encrypted.gtkrypt")"

  do_decrypt "$PASSPHRASE" "$dir/encrypted.gtkrypt" "$dir/output.dat" || {
    echo "    Decryption failed"
    return 1
  }

  # Encrypted file should still exist and be unchanged
  if [ ! -f "$dir/encrypted.gtkrypt" ]; then
    echo "    Encrypted file was deleted after decrypt"
    return 1
  fi

  local enc_size_after
  enc_size_after="$(stat --format='%s' "$dir/encrypted.gtkrypt")"
  if [ "$enc_size_before" != "$enc_size_after" ]; then
    echo "    Encrypted file size changed: $enc_size_before → $enc_size_after"
    return 1
  fi

  # Decrypted output should match original
  if ! diff -q "$dir/input.dat" "$dir/output.dat" >/dev/null 2>&1; then
    echo "    Decrypted output does not match original"
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------
echo ""
echo "Buffer operation tests"
echo "======================"

run_test "Small buffer roundtrip (< 1 KiB)"          test_small_buffer
run_test "Empty buffer roundtrip (0 bytes)"           test_empty_buffer
run_test "Multi-chunk buffer roundtrip (192 KiB)"     test_multi_chunk_buffer
run_test "Temp file cleanup: encrypted file persists"  test_temp_file_cleanup

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "------------------------------"
echo "Buffer ops: $PASS passed, $FAIL failed (out of $TOTAL)"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo "All buffer operation tests passed."
exit 0
