#!/usr/bin/env bash
# Integration tests: encrypt/decrypt roundtrip (SCOPE.md 7.7)
#
# Verifies that encrypting then decrypting a file produces
# byte-identical output for various file types and path patterns.
set -euo pipefail

CRYPTO_BIN="${CRYPTO_BIN:-crypto/target/release/gtkrypt-crypto}"
PASS=0
FAIL=0
PASSPHRASE="test-passphrase-123"

# Use fast KDF parameters so tests complete quickly
KDF_FLAGS="--time-cost 1 --memory-cost 1024 --parallelism 1"

# Create a temporary directory and ensure cleanup on exit
TEST_TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TMPDIR"' EXIT

# --------------------------------------------------------------------------
# Test helper
# --------------------------------------------------------------------------
run_test() {
  local name="$1"
  shift

  echo -n "  $name ... "
  if "$@" 2>&1; then
    echo "PASSED"
    PASS=$((PASS + 1))
  else
    echo "FAILED"
    FAIL=$((FAIL + 1))
  fi
}

# --------------------------------------------------------------------------
# Roundtrip helper: encrypt then decrypt, compare with diff
# --------------------------------------------------------------------------
roundtrip() {
  local input="$1"
  local encrypted="$2"
  local decrypted="$3"

  # Encrypt
  echo "$PASSPHRASE" | "$CRYPTO_BIN" encrypt \
    --input "$input" \
    --output "$encrypted" \
    $KDF_FLAGS >/dev/null

  # Decrypt
  echo "$PASSPHRASE" | "$CRYPTO_BIN" decrypt \
    --input "$encrypted" \
    --output "$decrypted" >/dev/null

  # Compare
  diff "$input" "$decrypted"
}

# --------------------------------------------------------------------------
# Test 1: Small text file (< 1 KiB)
# --------------------------------------------------------------------------
test_small_text() {
  local dir="$TEST_TMPDIR/small_text"
  mkdir -p "$dir"

  printf 'Hello, gtkrypt!\nThis is a small text file for roundtrip testing.\n' \
    > "$dir/input.txt"

  roundtrip "$dir/input.txt" "$dir/input.txt.gtkrypt" "$dir/output.txt"
}

# --------------------------------------------------------------------------
# Test 2: Binary file (~1 MiB random bytes)
# --------------------------------------------------------------------------
test_binary_1mib() {
  local dir="$TEST_TMPDIR/binary_1mib"
  mkdir -p "$dir"

  dd if=/dev/urandom of="$dir/input.bin" bs=1024 count=1024 2>/dev/null

  roundtrip "$dir/input.bin" "$dir/input.bin.gtkrypt" "$dir/output.bin"
}

# --------------------------------------------------------------------------
# Test 3: Unicode filename
# --------------------------------------------------------------------------
test_unicode_filename() {
  local dir="$TEST_TMPDIR/unicode"
  mkdir -p "$dir"

  local fname="caf\u00e9-donn\u00e9es.txt"
  printf -v fname "$fname"

  printf 'Contenu avec des caract\u00e8res sp\u00e9ciaux: \u00e9\u00e0\u00fc\u00f1\u00df\n' \
    > "$dir/$fname"

  roundtrip "$dir/$fname" "$dir/${fname}.gtkrypt" "$dir/${fname}.out"
}

# --------------------------------------------------------------------------
# Test 4: File with spaces in path
# --------------------------------------------------------------------------
test_spaces_in_path() {
  local dir="$TEST_TMPDIR/path with spaces/sub dir"
  mkdir -p "$dir"

  printf 'File stored in a directory with spaces.\n' \
    > "$dir/my file.txt"

  roundtrip "$dir/my file.txt" "$dir/my file.txt.gtkrypt" "$dir/my file.out.txt"
}

# --------------------------------------------------------------------------
# Test 5: Byte-for-byte preservation verified with sha256sum
# --------------------------------------------------------------------------
test_sha256_preservation() {
  local dir="$TEST_TMPDIR/sha256"
  mkdir -p "$dir"

  # Create a file with mixed content: text + binary
  {
    printf 'Line 1\nLine 2\n'
    dd if=/dev/urandom bs=512 count=1 2>/dev/null
    printf '\nTrailing text\n'
  } > "$dir/input.dat"

  roundtrip "$dir/input.dat" "$dir/input.dat.gtkrypt" "$dir/output.dat"

  # Also explicitly verify sha256 checksums match
  local hash_in hash_out
  hash_in="$(sha256sum "$dir/input.dat" | cut -d' ' -f1)"
  hash_out="$(sha256sum "$dir/output.dat" | cut -d' ' -f1)"

  if [ "$hash_in" != "$hash_out" ]; then
    echo "SHA-256 mismatch: $hash_in != $hash_out"
    return 1
  fi
}

# --------------------------------------------------------------------------
# Test 6: Empty file (edge case)
# --------------------------------------------------------------------------
test_empty_file() {
  local dir="$TEST_TMPDIR/empty"
  mkdir -p "$dir"

  touch "$dir/input.txt"

  roundtrip "$dir/input.txt" "$dir/input.txt.gtkrypt" "$dir/output.txt"
}

# --------------------------------------------------------------------------
# Test 7: Exactly one chunk boundary (64 KiB)
# --------------------------------------------------------------------------
test_chunk_boundary() {
  local dir="$TEST_TMPDIR/chunk_boundary"
  mkdir -p "$dir"

  dd if=/dev/urandom of="$dir/input.bin" bs=65536 count=1 2>/dev/null

  roundtrip "$dir/input.bin" "$dir/input.bin.gtkrypt" "$dir/output.bin"
}

# --------------------------------------------------------------------------
# Test 8: Multi-chunk file (3 chunks = 192 KiB)
# --------------------------------------------------------------------------
test_multi_chunk() {
  local dir="$TEST_TMPDIR/multi_chunk"
  mkdir -p "$dir"

  dd if=/dev/urandom of="$dir/input.bin" bs=65536 count=3 2>/dev/null

  roundtrip "$dir/input.bin" "$dir/input.bin.gtkrypt" "$dir/output.bin"
}

# --------------------------------------------------------------------------
# Run all tests
# --------------------------------------------------------------------------
echo "=== Roundtrip Integration Tests ==="

run_test "Small text file (< 1 KiB)"          test_small_text
run_test "Binary file (~1 MiB)"               test_binary_1mib
run_test "Unicode filename"                    test_unicode_filename
run_test "Spaces in path"                      test_spaces_in_path
run_test "SHA-256 byte-for-byte preservation"  test_sha256_preservation
run_test "Empty file"                          test_empty_file
run_test "Chunk boundary (64 KiB)"            test_chunk_boundary
run_test "Multi-chunk (192 KiB)"              test_multi_chunk

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
