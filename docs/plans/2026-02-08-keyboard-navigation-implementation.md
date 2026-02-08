# Keyboard Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Ctrl+O to open file chooser, ensure Esc closes dialogs and Enter activates focused buttons, and set focus defaults for empty and file-list states.

**Architecture:** Add a window action + accelerator in `GtkryptWindow`, wire to `_openFileChooser()`, and set focus in view transitions.

**Tech Stack:** TypeScript (GJS), GTK4 + Libadwaita.

---

### Task 1: Add open-files action with accelerator

**Files:**
- Modify: `src/ui/window.ts`

**Step 1: Write the failing test**

Skip: no TS/GJS test harness. Requires permission.

**Step 2: Implement minimal change**

- Register `open_files` action on the window.
- Set accelerator `<primary>o` for `win.open_files`.
- Handler calls `_openFileChooser()`.

**Step 3: Commit**

```bash
git add src/ui/window.ts
git commit -m "feat(ui): add Ctrl+O to open file chooser"
```

---

### Task 2: Set focus defaults for empty and file list views

**Files:**
- Modify: `src/ui/window.ts`

**Step 1: Write the failing test**

Skip: no TS/GJS test harness. Requires permission.

**Step 2: Implement minimal change**

- In `showEmptyState()`, call `chooseButton.grab_focus()` after `setContent` (use idle if necessary).
- In `_showFileList()`, after setting content, focus the primary action button via a public method on `FileListView` or by grabbing focus on the button if exposed.
  - If `FileListView` lacks a focus method, add a `focusPrimaryAction()` method to it.
- After cancel return (already added), ensure focus is set by `_showFileList()`.

**Step 3: Commit**

```bash
git add src/ui/window.ts src/ui/fileList.ts
git commit -m "feat(ui): set focus defaults for keyboard navigation"
```

---

### Task 3: Update scope tracking

**Files:**
- Modify: `SCOPE.md`

**Step 1: Mark Phase 5.4 complete**

**Step 2: Commit**

```bash
git add SCOPE.md
git commit -m "docs: mark keyboard navigation complete"
```

---

## Verification

- Manual: Ctrl+O opens chooser; Esc closes dialogs; Enter activates focused button; focus starts on Choose Files / primary action button.
