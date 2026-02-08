/**
 * Minimal GJS test harness with assertion helpers.
 *
 * Each test file imports from this module, runs assertions, and
 * calls `report()` at the end. Non-zero exit on any failure.
 */

let _passed = 0;
let _failed = 0;
const _errors: string[] = [];

export function assert(condition: boolean, message: string): void {
  if (condition) {
    _passed++;
  } else {
    _failed++;
    _errors.push(`  FAIL: ${message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    _passed++;
  } else {
    _failed++;
    _errors.push(`  FAIL: ${message}\n    expected: ${String(expected)}\n    actual:   ${String(actual)}`);
  }
}

export function assertDeepEqual(actual: Uint8Array, expected: Uint8Array, message: string): void {
  if (actual.length !== expected.length) {
    _failed++;
    _errors.push(`  FAIL: ${message}\n    length mismatch: expected ${expected.length}, got ${actual.length}`);
    return;
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      _failed++;
      _errors.push(`  FAIL: ${message}\n    byte ${i} differs: expected ${expected[i]}, got ${actual[i]}`);
      return;
    }
  }
  _passed++;
}

export function assertThrows(fn: () => void, errorName: string, message: string): void {
  try {
    fn();
    _failed++;
    _errors.push(`  FAIL: ${message}\n    expected ${errorName} to be thrown, but nothing was thrown`);
  } catch (e: unknown) {
    const err = e as { name?: string };
    if (err.name === errorName) {
      _passed++;
    } else {
      _failed++;
      _errors.push(`  FAIL: ${message}\n    expected ${errorName}, got ${err.name ?? String(e)}`);
    }
  }
}

export function assertBigIntEqual(actual: bigint, expected: bigint, message: string): void {
  if (actual === expected) {
    _passed++;
  } else {
    _failed++;
    _errors.push(`  FAIL: ${message}\n    expected: ${String(expected)}\n    actual:   ${String(actual)}`);
  }
}

export function report(suiteName: string): void {
  if (_errors.length > 0) {
    printerr(`\n${suiteName}:`);
    for (const err of _errors) {
      printerr(err);
    }
  }
  print(`${suiteName}: ${_passed} passed, ${_failed} failed`);
  if (_failed > 0) {
    imports.system.exit(1);
  }
}
