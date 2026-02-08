# Accessibility Labels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add explicit accessible names/descriptions for all interactive elements and key progress indicators.

**Architecture:** Add `accessible_name` and `accessible_description` properties to GTK widgets in UI components.

**Tech Stack:** TypeScript (GJS), GTK4 + Libadwaita.

---

### Task 1: File list accessibility

**Files:**
- Modify: `src/ui/fileList.ts`

**Step 1: Write the failing test**

Skip: no TS/GJS test harness. Requires permission.

**Step 2: Implement minimal change**

- Set `accessible_name` on remove button (e.g., `Remove <filename>`).
- Set `accessible_description` on row with filename, size, action (Encrypt/Decrypt).

**Step 3: Commit**

```bash
git add src/ui/fileList.ts
git commit -m "feat(a11y): label file list items"
```

---

### Task 2: Progress view accessibility

**Files:**
- Modify: `src/ui/progressView.ts`

**Step 1: Write the failing test**

Skip: no TS/GJS test harness. Requires permission.

**Step 2: Implement minimal change**

- Set `accessible_description` on per-file progress bars when updating progress (include filename, percent, phase).
- Set `accessible_description` on overall progress bar (file X of Y).
- Set `accessible_name` on Cancel button.

**Step 3: Commit**

```bash
git add src/ui/progressView.ts
git commit -m "feat(a11y): label progress view"
```

---

### Task 3: Dialog and main window accessibility

**Files:**
- Modify: `src/ui/window.ts`
- Modify: `src/ui/passphraseDialog.ts`
- Modify: `src/ui/resultView.ts`

**Step 1: Write the failing test**

Skip: no TS/GJS test harness. Requires permission.

**Step 2: Implement minimal change**

- Wipe-confirm checkbox: set `accessible_name`.
- Menu button: set `accessible_name`.
- Passphrase dialog: ensure confirm/cancel buttons have accessible names; confirm button already labeled, but explicitly set if needed; add accessible description to strength bar.
- Result view: set accessible name for "Show in Files" and "Encrypt/Decrypt More" buttons if not already covered by labels.

**Step 3: Commit**

```bash
git add src/ui/window.ts src/ui/passphraseDialog.ts src/ui/resultView.ts
git commit -m "feat(a11y): label dialogs and actions"
```

---

### Task 4: Update scope tracking

**Files:**
- Modify: `SCOPE.md`

**Step 1: Mark Phase 5.5 complete**

**Step 2: Commit**

```bash
git add SCOPE.md
git commit -m "docs: mark accessibility labels complete"
```

---

## Verification

- Manual: screen reader/GTK inspector shows labels for buttons, progress bars, and list rows.
