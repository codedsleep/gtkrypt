# Keyboard Navigation (Phase 5.4) Design

## Goal
Implement the keyboard shortcuts and focus behavior defined in SCOPE: Tab order, Enter activates focused button, Esc closes dialogs, Ctrl+O opens file chooser.

## Behavior
- `Ctrl+O`: opens file chooser from main window.
- `Esc`: closes dialogs (passphrase, alert dialogs, wipe confirm).
- `Enter`: activates focused button (use default response where applicable).
- Focus defaults:
  - Empty state: focus “Choose Files…” button.
  - File list: focus primary action button.
  - After cancel, return to file list and focus primary action button.

## Implementation Notes
- Add `win.open_files` action and accelerator `<primary>o` in `GtkryptWindow`.
- Wire the action to `_openFileChooser()`.
- Ensure dialogs set default responses and allow Esc to close (GTK/Adw defaults).
- Set focus when swapping views.

## Testing
- Manual: Ctrl+O opens file chooser, Esc closes dialogs, Enter activates focused button, tab traversal works in main view.
