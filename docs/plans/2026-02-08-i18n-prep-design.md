# i18n Prep (Phase 5.6) Design

## Goal
Wrap all user-facing strings with gettext to prepare for localization, including pluralization where needed.

## Approach
- Add a small i18n helper (e.g., `src/util/i18n.ts`) that initializes gettext and exports `_` and `ngettext`.
- Initialize the text domain early in `src/index.ts` before creating UI.
- Replace all UI strings in `src/ui/*.ts` and other user-facing modules with `_()`.
- Use `ngettext` for pluralized strings (e.g., file counts in results).
- Avoid string concatenation; use placeholders with `GLib.sprintf` or equivalent for formatted strings.

## Scope
- UI labels, buttons, dialog headings and bodies, progress labels, error strings, menu items.
- Result summary text should use proper pluralization.

## Testing
- Manual: run app and confirm UI still renders correctly.
- (Optional later) generate `.pot` template.
