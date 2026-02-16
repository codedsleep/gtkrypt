# CODE REVIEW — gtkrypt

Date: 2026-02-16
Reviewer: Codex (GPT-5)
Repository: `/home/zzz/code/gtkrypt`

## Scope of review
- `SCOPE.md` (project checklist and acceptance criteria)
- `SCOPE-VAULT.md` (vault expansion checklist, present in working tree)
- Git history (`git log`) and current working tree (`git status`, `git diff`)
- Verification commands: `npm run check`, `npm test`, `cargo test`, `cargo test --offline`

## Executive status assessment
1. Core project implementation appears complete by checklist, but final sign-off is not complete in `SCOPE.md`.
- All phase tasks are checked in `SCOPE.md` (`SCOPE.md:191` through `SCOPE.md:644`).
- Final acceptance criteria remain unchecked (`SCOPE.md:658` through `SCOPE.md:670`).

2. Git history shows the committed project is still the original encrypt/decrypt app plus cleanup commits.
- Latest commit: `de5c335` (2026-02-09) — docs cleanup.
- Major implementation commit: `4a18260` (2026-02-08) — base app + hardening.
- Total commits on branch: 10.

3. There is substantial uncommitted vault-mode work not yet integrated into history.
- Working tree: 15 modified tracked files + 37 untracked files.
- Tracked diff size: 15 files changed, 1445 insertions, 34 deletions.
- `SCOPE-VAULT.md` is fully checked including acceptance criteria, but this work is currently local/uncommitted.

## Findings (ordered by severity)

### P1 — Deleting keyfile-protected vaults is broken
**Impact:** Vaults created with keyfile support cannot be deleted successfully.

**Evidence:**
- `deleteVault` only accepts passphrase and calls `loadManifest(dir, passphrase)` without keyfile forwarding: `src/services/vault.ts:239`.
- Delete flows in UI only collect passphrase (no keyfile picker in these paths):
  - `src/ui/window.ts:358`
  - `src/ui/window.ts:792`

**Why this is a bug:**
If manifest decryption was configured with keyfile + passphrase, passphrase-only deletion path will fail (`WrongPassphraseError`) and leave the vault undeletable via intended UX.

**Recommendation:**
- Add optional `keyfilePath` to `deleteVault` service path.
- Detect keyfile requirement and require keyfile in both delete entry points.
- Add regression tests for deleting a keyfile-enabled vault.

### P1 — Restore/backup path does not support keyfile-protected vaults
**Impact:** Restoring a backup that requires keyfile fails; second factor is never requested.

**Evidence:**
- `restoreVault` calls `loadManifest(sourceDir, passphrase)` and does not pass keyfile: `src/services/vault.ts:268`.
- Import/restore UI path calls unlock dialog without enabling keyfile requirement:
  - `src/ui/window.ts:376`

**Why this is a bug:**
Backups of keyfile-enabled vaults cannot be restored from UI/service because required keyfile input is missing from workflow and service API.

**Recommendation:**
- Detect keyfile requirement from vault metadata during restore.
- Prompt for keyfile in restore unlock flow.
- Thread `keyfilePath` through restore service and manifest load path.
- Add integration test for keyfile-protected restore success/failure.

### P2 — Missing automated coverage for new keyfile lifecycle flows
**Impact:** Regressions in keyfile delete/restore flows are likely to ship undetected.

**Evidence:**
- New keyfile logic exists in lifecycle service ranges (`src/services/vault.ts:233` onward), but there is no explicit JS test coverage for delete/restore keyfile cases in current added tests.
- Current new tests focus on vault lifecycle/items generally (`tests/integration/vault-lifecycle.test.sh`, `tests/integration/vault-items.test.sh`) but no explicit keyfile delete/restore scenario is evident from review evidence.

**Recommendation:**
- Add targeted tests for:
  - delete with keyfile required
  - restore with keyfile required
  - wrong/missing keyfile behavior and UX messaging

## Verification results

### 1) `npm run check`
- Result: **FAILED**
- Failure class: duplicate GIR type declarations / ambient conflicts in dependencies (`@girs/*`), plus legacy type issues.
- Representative failing files include:
  - `node_modules/@girs/adw-1/adw-1.d.ts`
  - `node_modules/@girs/gio-2.0/gio-2.0-ambient.d.ts`
  - `src/MainWindow.ts`
  - `src/MenuButton.ts`
  - `src/index.ts`

### 2) `npm test`
- Result: **PASSED**
- Summary: 14 test suites passed, 0 failed.
- Includes new vault suites:
  - `integration/vault-lifecycle`
  - `integration/vault-items`

### 3) `cargo test`
- Result: **FAILED** in this environment.
- Reason: network-restricted dependency fetch (`index.crates.io` DNS resolution failure).

### 4) `cargo test --offline`
- Result: **FAILED** (required crates not present in local cache).

## Where the project is now
1. Committed history represents a stable base app with encrypt/decrypt flow and test harness.
2. `SCOPE.md` final acceptance is still not explicitly signed off.
3. A major vault feature expansion exists locally and is broadly implemented, but not committed.
4. Before merging vault work, keyfile lifecycle issues (delete/restore) should be fixed and covered by regression tests.

## Recommended next actions
1. Fix keyfile propagation in `deleteVault` and `restoreVault` paths.
2. Add test coverage for keyfile delete/restore edge cases.
3. Re-run `npm test` and (in a network-enabled environment) `cargo test`.
4. Decide whether to formally update/close `SCOPE.md` final acceptance criteria once verified.
