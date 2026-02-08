# Accessibility Labels (Phase 5.5) Design

## Goal
Add explicit accessible names and descriptions for all interactive elements and key progress indicators to support screen readers.

## Scope
- Buttons (including icon-only): set `accessible_name`.
- Progress bars: set `accessible_description` with file name + percent + phase.
- File list rows: set `accessible_description` with file name, size, and action.
- Dialog controls: ensure labels are explicit and checkbox described.

## Implementation Notes
- Use GTK/Adw accessibility properties (`accessible_name`, `accessible_description`, or setters where required).
- Keep descriptions concise, avoid redundancy with visible text.
- Update in `window.ts`, `fileList.ts`, `progressView.ts`, `resultView.ts`, `passphraseDialog.ts`.

## Testing
- Manual: verify screen reader announces meaningful labels for buttons, progress bars, and list items.
