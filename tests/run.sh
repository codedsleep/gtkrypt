#!/usr/bin/env bash
# Test runner for gtkrypt
# Builds and runs GJS unit tests + shell integration tests
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CRYPTO_BIN="$PROJECT_DIR/crypto/target/release/gtkrypt-crypto"

cd "$PROJECT_DIR"

PASS=0
FAIL=0
ERRORS=()

# --- Build test bundles ---
echo "Building test bundles..."
node tests/esbuild.js

# --- Run GJS unit tests ---
echo ""
echo "=== Unit Tests ==="
for test_file in dist/tests/unit/*.test.js; do
  [ -f "$test_file" ] || continue
  name="$(basename "$test_file" .test.js)"
  if gjs -m "$test_file" 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("unit/$name")
  fi
done

# --- Run integration tests ---
echo ""
echo "=== Integration Tests ==="
for test_file in tests/integration/*.test.sh; do
  [ -f "$test_file" ] || continue
  name="$(basename "$test_file" .test.sh)"
  echo "Running integration/$name..."
  if CRYPTO_BIN="$CRYPTO_BIN" bash "$test_file" 2>&1; then
    echo "  integration/$name: PASSED"
    PASS=$((PASS + 1))
  else
    echo "  integration/$name: FAILED"
    FAIL=$((FAIL + 1))
    ERRORS+=("integration/$name")
  fi
done

# --- Summary ---
echo ""
echo "=============================="
echo "Test suites: $PASS passed, $FAIL failed"
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "Failed:"
  for e in "${ERRORS[@]}"; do
    echo "  - $e"
  done
  exit 1
fi
echo "All tests passed."
