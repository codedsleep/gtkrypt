# Error Display Improvements (Phase 5.3) Design

## Goal
Treat user cancellation as a non-error: return to the file list without results or toasts.

## Behavior
- When the user cancels during processing, stop further file processing immediately.
- Do not add per-file failure entries for cancelled operations.
- Skip the results screen entirely and return to the file list view with selected files intact.
- No toast or extra dialog on cancellation (silent).

## Implementation Notes
- In `src/ui/window.ts`, detect `cancellable.is_cancelled()` and short-circuit the `_processFiles` flow.
- After the loop, if cancelled, call `_showFileList()` instead of `_showResults()`.
- Ensure `_files` is preserved and the list view remains populated.

## Testing
- Manual: start encrypt, cancel mid-way, verify file list returns and no results screen is shown.
