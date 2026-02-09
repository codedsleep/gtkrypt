/**
 * Result view widget for displaying encryption/decryption outcomes.
 *
 * Shows a summary status page (success, partial failure, or total failure),
 * a per-file results list, and action buttons to open the output directory
 * or start a new operation.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import Adw from "gi://Adw?version=1";

import { _, ngettext } from "../util/i18n.js";
// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/** Per-file outcome data for display in the results list. */
export interface FileResult {
  filename: string;
  outputPath: string;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary title from the results.
 *
 * @param results - Array of per-file results
 * @param mode    - Whether this was an encrypt or decrypt operation
 * @returns Title string such as "3 files encrypted" or "Encryption failed"
 */
function getSummaryTitle(results: FileResult[], mode: string): string {
  const total = results.length;
  const succeeded = results.filter((r) => r.success).length;
  const action = mode === "encrypt" ? _("encrypted") : _("decrypted");

  if (succeeded === total) {
    return ngettext("1 file %s", "%d files %s", total)
      .replace("%d", String(total))
      .replace("%s", action);
  }
  if (succeeded === 0) {
    return mode === "encrypt" ? _("Encryption failed") : _("Decryption failed");
  }
  const summary = ngettext(
    "%d of %d file %s",
    "%d of %d files %s",
    total,
  );
  return summary
    .replace("%d", String(succeeded))
    .replace("%d", String(total))
    .replace("%s", action);
}

/**
 * Choose the appropriate icon for the summary status page.
 *
 * @param results - Array of per-file results
 * @returns Icon name string
 */
function getSummaryIcon(results: FileResult[]): string {
  const succeeded = results.filter((r) => r.success).length;
  if (succeeded === results.length) return "emblem-ok-symbolic";
  if (succeeded === 0) return "dialog-error-symbolic";
  return "dialog-warning-symbolic";
}

/**
 * Build a concise summary description from success/failure counts.
 *
 * @param results - Array of per-file results
 * @returns Description text for the status page
 */
function getSummaryDescription(results: FileResult[]): string {
  const total = results.length;
  const succeeded = results.filter((r) => r.success).length;
  const failed = total - succeeded;

  if (failed === 0) {
    return ngettext("Processed %d file successfully", "Processed %d files successfully", total)
      .replace("%d", String(total));
  }
  if (succeeded === 0) {
    return ngettext("Failed to process %d file", "Failed to process %d files", total)
      .replace("%d", String(total));
  }

  return ngettext(
    "%d file succeeded, %d failed",
    "%d files succeeded, %d failed",
    succeeded,
  )
    .replace("%d", String(succeeded))
    .replace("%d", String(failed));
}

// ---------------------------------------------------------------------------
// Result view implementation
// ---------------------------------------------------------------------------

class _ResultView extends Gtk.Box {
  private _statusPage!: Adw.StatusPage;
  private _listBox!: Gtk.ListBox;
  private _buttonBox!: Gtk.Box;
  private _scrolledWindow!: Gtk.ScrolledWindow;

  /** Called when the user clicks "Show in Files". */
  onShowInFiles?: (path: string) => void;

  /** Called when the user clicks "Encrypt/Decrypt More". */
  onStartOver?: () => void;

  constructor(config: Partial<Gtk.Box.ConstructorProps> = {}) {
    super({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
      ...config,
    });

    this._buildStatusArea();
    this._buildResultsList();
    this._buildActionButtons();
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Populate the view with operation results.
   *
   * Builds the summary title, populates the per-file list, and wires
   * up action buttons with the appropriate labels.
   *
   * @param results - Array of per-file outcomes
   * @param mode    - Whether this was "encrypt" or "decrypt"
   */
  setResults(results: FileResult[], mode: "encrypt" | "decrypt"): void {
    // Update status page
    this._statusPage.set_title(getSummaryTitle(results, mode));
    this._statusPage.set_icon_name(getSummaryIcon(results));
    this._statusPage.set_description(getSummaryDescription(results));

    // Rebuild the results list
    this._clearList();
    for (const result of results) {
      this._addResultRow(result);
    }

    // Rebuild action buttons
    this._rebuildButtons(results, mode);
  }

  // -- Private: widget construction -----------------------------------------

  /** Build the summary status page at the top. */
  private _buildStatusArea(): void {
    this._statusPage = new Adw.StatusPage({
      icon_name: "emblem-ok-symbolic",
      title: _("Complete"),
      vexpand: false,
    });

    const clamp = new Adw.Clamp({
      maximum_size: 620,
      margin_start: 24,
      margin_end: 24,
      margin_top: 18,
      child: this._statusPage,
    });

    this.append(clamp);
  }

  /** Build the scrolled results list. */
  private _buildResultsList(): void {
    this._listBox = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      css_classes: ["boxed-list"],
    });

    const clamp = new Adw.Clamp({
      maximum_size: 620,
      margin_start: 18,
      margin_end: 18,
      margin_top: 12,
      child: this._listBox,
    });

    this._scrolledWindow = new Gtk.ScrolledWindow({
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      child: clamp,
    });

    this.append(this._scrolledWindow);
  }

  /** Build the bottom action buttons container. */
  private _buildActionButtons(): void {
    this._buttonBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 12,
      halign: Gtk.Align.END,
    });

    const clamp = new Adw.Clamp({
      maximum_size: 620,
      margin_start: 18,
      margin_end: 18,
      margin_top: 12,
      margin_bottom: 18,
      child: this._buttonBox,
    });

    this.append(clamp);
  }

  // -- Private: list management ---------------------------------------------

  /** Remove all children from the list box. */
  private _clearList(): void {
    let child = this._listBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._listBox.remove(child);
      child = next;
    }
  }

  /**
   * Add a single result row to the list box.
   *
   * Success rows show the output path as a subtitle. Error rows show
   * the error message and use an expander row when there is additional
   * detail available.
   *
   * @param result - Per-file outcome to display
   */
  private _addResultRow(result: FileResult): void {
    const iconName = result.success
      ? "emblem-ok-symbolic"
      : "dialog-error-symbolic";

    const icon = new Gtk.Image({
      icon_name: iconName,
      css_classes: [result.success ? "success" : "error"],
    });

    if (!result.success && result.error) {
      // Use an expander row for errors with detail
      const row = new Adw.ExpanderRow({
        title: result.filename,
        subtitle: result.error,
      });
      row.add_prefix(icon);
      this._listBox.append(row);
    } else {
      const row = new Adw.ActionRow({
        title: result.filename,
        subtitle: result.success
          ? result.outputPath
          : (result.error ?? _("Unknown error")),
      });
      row.add_prefix(icon);
      this._listBox.append(row);
    }
  }

  /**
   * Rebuild the action buttons for the current result set.
   *
   * Shows "Show in Files" when at least one file succeeded, and
   * always shows a "start over" button.
   *
   * @param results - Array of per-file outcomes
   * @param mode    - Whether this was "encrypt" or "decrypt"
   */
  private _rebuildButtons(
    results: FileResult[],
    mode: "encrypt" | "decrypt",
  ): void {
    // Clear existing buttons
    let child = this._buttonBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._buttonBox.remove(child);
      child = next;
    }

    const hasSuccess = results.some((r) => r.success);

    if (hasSuccess) {
      // Find the first successful output path to open its directory
      const firstSuccess = results.find((r) => r.success);
      const showButton = new Gtk.Button({
        label: _("Show in Files"),
        css_classes: ["suggested-action"],
      });
      showButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Show output in Files")]);
      showButton.connect("clicked", () => {
        if (firstSuccess) {
          if (this.onShowInFiles) {
            this.onShowInFiles(firstSuccess.outputPath);
          } else {
            this._showInFiles(firstSuccess.outputPath);
          }
        }
      });
      this._buttonBox.append(showButton);
    }

    const moreLabel =
      mode === "encrypt" ? _("Encrypt More") : _("Decrypt More");
    const moreButton = new Gtk.Button({
      label: moreLabel,
      css_classes: ["flat"],
    });
    moreButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Start another operation")]);
    moreButton.connect("clicked", () => {
      this.onStartOver?.();
    });
    this._buttonBox.append(moreButton);
  }

  /**
   * Open the parent directory of a file in the default file manager.
   *
   * @param path - Absolute path to a file whose parent should be opened
   */
  private _showInFiles(path: string): void {
    const file = Gio.File.new_for_path(path);
    const parent = file.get_parent();
    if (parent) {
      const uri = parent.get_uri();
      if (uri) {
        Gio.AppInfo.launch_default_for_uri(uri, null);
      }
    }
  }
}

export const ResultView = GObject.registerClass(
  { GTypeName: "ResultView" },
  _ResultView,
);
