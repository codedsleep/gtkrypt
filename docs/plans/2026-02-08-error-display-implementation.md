# Error Display Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** On user cancellation, return silently to the file list without showing results or error entries.

**Architecture:** Detect cancellation during `_processFiles` and short-circuit. Skip `_showResults` and re-show the existing file list.

**Tech Stack:** TypeScript (GJS), GTK4 + Libadwaita.

---

### Task 1: Short-circuit cancellation in processing loop

**Files:**
- Modify: `src/ui/window.ts`

**Step 1: Write the failing test**

Skip: no TS/GJS test harness. Requires permission to proceed without tests.

**Step 2: Implement minimal change**

- Add a `let wasCancelled = false;` flag before the loop.
- In the `catch` block, when `this._cancellable?.is_cancelled()` is true:
  - Set `wasCancelled = true`.
  - Break the loop without adding any new `results` entries.
- After the loop, if `wasCancelled` is true:
  - Restore the file list view via `_showFileList()`.
  - Return early, skipping `_showResults()`.

**Step 3: Commit**

```bash
git add src/ui/window.ts
git commit -m "feat(ui): return to file list on cancel"
```

---

### Task 2: Update scope tracking

**Files:**
- Modify: `SCOPE.md`

**Step 1: Update Phase 5.3 status**
- Mark as complete and note cancel now returns silently to file list.

**Step 2: Commit**

```bash
git add SCOPE.md
git commit -m "docs: mark error display complete"
```

---

## Verification

- Manual: start encrypt, cancel mid-way, verify file list returns and no results screen appears.
