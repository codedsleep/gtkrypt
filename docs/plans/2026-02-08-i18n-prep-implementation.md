# i18n Prep Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wrap all user-facing strings with gettext and add pluralization where needed.

**Architecture:** Add `src/util/i18n.ts` to initialize gettext and export `_`/`ngettext`. Initialize in `src/index.ts` and replace literals in UI modules with `_()` / `ngettext()`.

**Tech Stack:** TypeScript (GJS), GTK4 + Libadwaita.

---

### Task 1: Add i18n helper and initialize

**Files:**
- Create: `src/util/i18n.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

Skip: no TS/GJS test harness. Requires permission.

**Step 2: Implement minimal helper**

Create `src/util/i18n.ts`:

```ts
import GLib from "gi://GLib";

const domain = "gtkrypt";

// Bind text domain to default locale dir if installed, else fallback.
imports.gettext.bindtextdomain(domain, GLib.get_home_dir());
imports.gettext.textdomain(domain);

export const _ = imports.gettext.gettext;
export const ngettext = imports.gettext.ngettext;
```

Update `src/index.ts` to import this module early (before creating UI), e.g.:

```ts
import "./util/i18n.js";
```

**Step 3: Commit**

```bash
git add src/util/i18n.ts src/index.ts
git commit -m "feat(i18n): add gettext helper"
```

---

### Task 2: Wrap strings in UI modules

**Files:**
- Modify: `src/ui/window.ts`
- Modify: `src/ui/fileList.ts`
- Modify: `src/ui/progressView.ts`
- Modify: `src/ui/resultView.ts`
- Modify: `src/ui/passphraseDialog.ts`
- Modify: `src/models/errors.ts` (userMessage strings)

**Step 1: Write the failing test**

Skip: no TS/GJS test harness. Requires permission.

**Step 2: Implement minimal change**

- Import `{ _ , ngettext }` where needed.
- Wrap all user-facing strings in `_()`.
- For pluralized strings (e.g. result summary in `resultView.ts`), use `ngettext`:

```ts
const title = ngettext("%d file encrypted", "%d files encrypted", total).replace("%d", String(total));
```

- Avoid concatenation by using `GLib.sprintf` if needed.

**Step 3: Commit**

```bash
git add src/ui/*.ts src/models/errors.ts
git commit -m "feat(i18n): wrap UI strings"
```

---

### Task 3: Update scope tracking

**Files:**
- Modify: `SCOPE.md`

**Step 1: Mark Phase 5.6 complete**

**Step 2: Commit**

```bash
git add SCOPE.md
git commit -m "docs: mark i18n prep complete"
```

---

## Verification

- Manual: launch app and verify UI labels render normally.
