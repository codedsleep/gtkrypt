# Wipe Original After Encrypt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prompt per file (with optional “apply to remaining” choice) when wipe-original is enabled, and securely wipe originals after successful encryption.

**Architecture:** Add an async confirmation helper in `src/ui/window.ts` that presents an `Adw.AlertDialog` with a checkbox. Track per-batch decisions in `_processFiles`. Call `secureWipe()` only after a successful encrypt when the user confirms.

**Tech Stack:** TypeScript (GJS), GTK4 + Libadwaita.

---

### Task 1: Add wipe confirmation helper in window

**Files:**
- Modify: `src/ui/window.ts`

**Step 1: Write the failing test**

Skip: there is no TS/GJS test harness yet. You must get explicit permission before proceeding without tests.

**Step 2: Implement minimal helper**

Add a private async helper in `GtkryptWindow`:

```ts
private async _confirmWipe(
  filename: string,
): Promise<{ decision: "wipe" | "keep"; applyToRemaining: boolean }> {
  const dialog = new Adw.AlertDialog({
    heading: "Delete original file?",
    body: `This will permanently delete the original file:\n\n${filename}`,
  });
  dialog.add_response("keep", "Keep");
  dialog.add_response("wipe", "Delete");
  dialog.set_default_response("keep");
  dialog.set_response_appearance("wipe", Adw.ResponseAppearance.DESTRUCTIVE);

  const applyCheck = new Gtk.CheckButton({
    label: "Apply this choice to remaining files",
  });
  dialog.set_extra_child(applyCheck);

  const response = await new Promise<string>((resolve) => {
    dialog.connect("response", (_d, resp) => resolve(resp));
    dialog.present(this);
  });

  return {
    decision: response === "wipe" ? "wipe" : "keep",
    applyToRemaining: applyCheck.get_active(),
  };
}
```

**Step 3: Commit**

```bash
git add src/ui/window.ts
git commit -m "feat(ui): add wipe confirmation dialog"
```

---

### Task 2: Wire wipe flow into processing loop

**Files:**
- Modify: `src/ui/window.ts`
- Modify: `src/services/io.ts` (only if new error mapping needed)

**Step 1: Write the failing test**

Skip: no TS/GJS harness. Requires permission.

**Step 2: Implement wiring**

- Import `secureWipe` from `src/services/io.ts`.
- In `_processFiles`, track:
  - `let wipeDecision: "wipe" | "keep" | null = null;`
  - `let applyToRemaining = false;`
- After a successful encrypt (and only in encrypt mode), if `options.wipeOriginal`:
  - If `applyToRemaining` is false, call `_confirmWipe(file.name)`.
  - Update `wipeDecision` and `applyToRemaining` based on response.
  - If `wipeDecision === "wipe"`, call `secureWipe(file.path)` inside try/catch.
  - On wipe error, mark this file as failed with a user-friendly message and **do not** delete encrypted output.

**Step 3: Commit**

```bash
git add src/ui/window.ts src/services/io.ts
git commit -m "feat(ui): wipe originals after encrypt with confirmation"
```

---

### Task 3: Update scope tracking

**Files:**
- Modify: `SCOPE.md`

**Step 1: Update Phase 5.2 status**
- Mark as complete and note per-file confirm + apply-to-remaining checkbox.

**Step 2: Commit**

```bash
git add SCOPE.md
git commit -m "docs: mark wipe-original complete"
```

---

## Verification

- Manual test: encrypt multiple files with wipe enabled; verify per-file confirm, apply-to-remaining works, and originals are deleted only when chosen.
