# Wipe Original After Encrypt (Phase 5.2) Design

## Goal
Add per-file confirmation for the “Delete original after encryption” option and securely wipe originals after successful encrypt, with an optional “apply to remaining files” choice to reduce repeated prompts.

## Recommended Approach
- Confirm **per file** immediately after each successful encrypt when wipe is enabled.
- Provide an “Apply this choice to remaining files” checkbox in the confirmation dialog.
- If encryption fails or is canceled, do not prompt or wipe.
- Wipe uses `secureWipe()` from `src/services/io.ts` after encrypted output is written.

## UX Flow
- User enables “Delete original after encryption” in passphrase dialog.
- During processing, after each file encrypts successfully, show a confirmation dialog:
  - Text: “This will permanently delete the original file: <filename>. Continue?”
  - Buttons: “Delete” (destructive) and “Keep”.
  - Checkbox: “Apply this choice to remaining files.”
- If checkbox is checked, reuse that choice for subsequent files in the batch.

## Implementation Notes
- Add async helper in `src/ui/window.ts` to present dialog and return `{ decision, applyToRemaining }`.
- Track `wipeDecision` and `applyToRemaining` within `_processFiles` loop.
- Call `secureWipe(originalPath)` only after encryption succeeds.
- If wipe fails, surface a per-file error but keep the encrypted output intact.

## Error Handling
- Wipe errors should map to a user-friendly message and mark that file as failed.
- Never delete encrypted output on wipe failure.

## Testing
- Manual test: enable wipe, encrypt multiple files, confirm per file, verify originals are deleted or kept correctly.
- Future: add TS UI test harness to mock confirmation callbacks.
