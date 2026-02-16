/**
 * Progress view widget for displaying encryption/decryption progress.
 *
 * Replaces the file list during active operations. Shows per-file
 * progress bars, an overall progress indicator, and a cancel button.
 */

import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import Adw from "gi://Adw?version=1";

import { _ } from "../util/i18n.js";
// ---------------------------------------------------------------------------
// Progress view implementation
// ---------------------------------------------------------------------------

class _ProgressView extends Gtk.Box {
  private _statusPage!: Adw.StatusPage;
  private _fileProgressBox!: Gtk.Box;
  private _overallLabel!: Gtk.Label;
  private _overallBar!: Gtk.ProgressBar;
  private _cancelButton!: Gtk.Button;

  /** Per-file progress bars, indexed by file position. */
  private _fileBars: Gtk.ProgressBar[] = [];

  /** Per-file label widgets, indexed by file position. */
  private _fileLabels: Gtk.Label[] = [];

  /** Total number of files in the current batch. */
  private _totalFiles = 0;

  /** Number of files completed so far. */
  private _completedFiles = 0;

  /** Called when the user clicks the Cancel button. */
  onCancel?: () => void;

  constructor(config: Partial<Gtk.Box.ConstructorProps> = {}) {
    super({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
      ...config,
    });

    this._buildStatusArea();
    this._buildFileProgressArea();
    this._buildOverallProgress();
    this._buildCancelButton();
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Initialize the view for a batch of files.
   *
   * Creates a labelled progress bar for each filename and resets all
   * counters to zero.
   *
   * @param filenames - Display names of the files being processed
   */
  setupFiles(filenames: string[]): void {
    this._totalFiles = filenames.length;
    this._completedFiles = 0;

    // Clear any existing per-file widgets
    this._clearFileProgress();

    this._fileBars = [];
    this._fileLabels = [];

    for (const name of filenames) {
      const label = new Gtk.Label({
        label: name,
        halign: Gtk.Align.START,
        css_classes: ["caption", "dim-label"],
        ellipsize: 3, // Pango.EllipsizeMode.END
      });

      const bar = new Gtk.ProgressBar({
        show_text: true,
        text: _("0%"),
        fraction: 0,
      });
      bar.update_property([Gtk.AccessibleProperty.DESCRIPTION], [`${name}, ${_("0% complete")}`]);

      this._fileLabels.push(label);
      this._fileBars.push(bar);

      const row = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_top: 4,
        margin_bottom: 4,
      });
      row.append(label);
      row.append(bar);

      this._fileProgressBox.append(row);
    }

    // Reset overall progress
    const fileZeroLabel = _("File %d of %d")
      .replace("%d", String(0))
      .replace("%d", String(this._totalFiles));
    this._overallLabel.set_label(fileZeroLabel);
    this._overallBar.set_fraction(0);
    this._overallBar.set_text(_("0%"));

    // Reset status page
    this._statusPage.set_title(_("Processing..."));
  }

  /**
   * Update progress for a specific file.
   *
   * @param fileIndex - Index of the file in the batch
   * @param fraction  - Progress fraction between 0 and 1
   * @param phase     - Current processing phase (kdf, encrypt, decrypt)
   */
  updateFileProgress(fileIndex: number, fraction: number, phase: string): void {
    const bar = this._fileBars[fileIndex];
    if (!bar) return;

    const label = this._fileLabels[fileIndex];
    bar.set_fraction(fraction);
    bar.set_text(`${Math.round(fraction * 100)}%`);
    if (label) {
      bar.update_property([Gtk.AccessibleProperty.DESCRIPTION], [
        `${label.get_label()}, ${Math.round(fraction * 100)}% ` +
          `${_("complete")}, ${this._phaseLabel(phase)}`,
      ]);
    }

    this.setPhaseLabel(phase);
  }

  /**
   * Mark a file as complete and advance the overall progress.
   *
   * @param fileIndex - Index of the completed file
   */
  markFileComplete(fileIndex: number): void {
    const bar = this._fileBars[fileIndex];
    if (bar) {
      const label = this._fileLabels[fileIndex];
      bar.set_fraction(1);
      bar.set_text(_("100%"));
      if (label) {
        bar.update_property([Gtk.AccessibleProperty.DESCRIPTION], [`${label.get_label()}, ${_("100% complete")}`]);
      }
    }

    this._completedFiles++;

    const overallFraction =
      this._totalFiles > 0 ? this._completedFiles / this._totalFiles : 0;
    this._overallBar.set_fraction(overallFraction);
    this._overallBar.set_text(`${Math.round(overallFraction * 100)}%`);
    const overallLabel = _("File %d of %d")
      .replace("%d", String(this._completedFiles))
      .replace("%d", String(this._totalFiles));
    this._overallLabel.set_label(overallLabel);
    this._overallBar.update_property([Gtk.AccessibleProperty.DESCRIPTION], [
      _("Overall progress: file %d of %d")
        .replace("%d", String(this._completedFiles))
        .replace("%d", String(this._totalFiles)),
    ]);
  }

  /**
   * Update the status page title to reflect the current processing phase.
   *
   * @param phase - Phase identifier (kdf, encrypt, decrypt)
   */
  setPhaseLabel(phase: string): void {
    this._statusPage.set_title(this._phaseLabel(phase));
  }

  private _phaseLabel(phase: string): string {
    const labels: Record<string, string> = {
      kdf: _("Deriving key..."),
      encrypt: _("Encrypting..."),
      decrypt: _("Decrypting..."),
    };
    return labels[phase] ?? _("Processing...");
  }

  // -- Private: widget construction -----------------------------------------

  /** Build the top status area with icon and phase title. */
  private _buildStatusArea(): void {
    this._statusPage = new Adw.StatusPage({
      icon_name: "emblem-synchronizing-symbolic",
      title: _("Processing..."),
      description: _("Keep this window open while your files are being processed."),
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

  /** Build the scrolled area containing per-file progress bars. */
  private _buildFileProgressArea(): void {
    this._fileProgressBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
    });

    const clamp = new Adw.Clamp({
      maximum_size: 620,
      margin_start: 18,
      margin_end: 18,
      margin_top: 12,
      child: this._fileProgressBox,
    });

    const scrolled = new Gtk.ScrolledWindow({
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      child: clamp,
    });

    this.append(scrolled);
  }

  /** Build the overall progress section at the bottom. */
  private _buildOverallProgress(): void {
    const initialOverall = _("File %d of %d")
      .replace("%d", String(0))
      .replace("%d", String(0));
    this._overallLabel = new Gtk.Label({
      label: initialOverall,
      halign: Gtk.Align.START,
      css_classes: ["heading", "dim-label"],
    });

    this._overallBar = new Gtk.ProgressBar({
      show_text: true,
      text: _("0%"),
      fraction: 0,
    });
    this._overallBar.update_property([Gtk.AccessibleProperty.DESCRIPTION], [_("Overall progress: 0%")]);

    const overallBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
    });
    overallBox.append(this._overallLabel);
    overallBox.append(this._overallBar);

    const clamp = new Adw.Clamp({
      maximum_size: 620,
      margin_start: 18,
      margin_end: 18,
      margin_top: 12,
      child: overallBox,
    });

    this.append(clamp);
  }

  /** Build the centered cancel button. */
  private _buildCancelButton(): void {
    this._cancelButton = new Gtk.Button({
      label: _("Cancel"),
      css_classes: ["flat", "pill"],
      halign: Gtk.Align.END,
    });
    this._cancelButton.update_property([Gtk.AccessibleProperty.LABEL], [_("Cancel operation")]);

    this._cancelButton.connect("clicked", () => {
      this.onCancel?.();
    });

    const buttonBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      halign: Gtk.Align.FILL,
      margin_top: 12,
      margin_bottom: 18,
    });
    buttonBox.append(this._cancelButton);

    const clamp = new Adw.Clamp({
      maximum_size: 620,
      margin_start: 18,
      margin_end: 18,
      child: buttonBox,
    });
    this.append(clamp);
  }

  // -- Private: helpers -----------------------------------------------------

  /** Remove all per-file progress widgets from the container. */
  private _clearFileProgress(): void {
    let child = this._fileProgressBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._fileProgressBox.remove(child);
      child = next;
    }
  }
}

export const ProgressView = GObject.registerClass(
  { GTypeName: "ProgressView" },
  _ProgressView,
);
