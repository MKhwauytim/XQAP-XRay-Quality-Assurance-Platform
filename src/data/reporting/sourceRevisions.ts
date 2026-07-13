/**
 * Report-to-revision linkage (B2). A generated report is only defensible if it can
 * be tied back to the EXACT data snapshot it was built from. Every report input
 * collects a `SourceRevisions` map — source file name → `JsonEnvelope.metadata.revision`
 * captured at load time — and every document/deck footer and Excel metadata sheet
 * prints it (Arabic label + file → revision list).
 *
 * Backward compatible: the map is optional everywhere. A missing/empty map renders
 * nothing, so legacy callers and legacy report snapshots are unaffected.
 *
 * The revisions are read via `readEnvelopeRevision` at the Reports-tab load seam,
 * next to where each source file is already loaded for the report.
 */

export type SourceRevisions = Record<string, number>;

/** Arabic heading for the source-revision block (shared across all editions). */
export const SOURCE_REVISIONS_LABEL_AR = "مراجعات ملفات المصدر";

/** Arabic note explaining what the revisions mean (integrity/traceability). */
export const SOURCE_REVISIONS_NOTE_AR =
  "يربط هذا التقرير بنسخة البيانات المحددة: رقم المراجعة لكل ملف مصدر وقت التوليد.";

/** Column headers for the Excel source-revisions sheet. */
export const SOURCE_REVISIONS_SHEET_HEADERS_AR = ["ملف المصدر", "رقم المراجعة"] as const;

/** Sheet name for the Excel source-revisions sheet (kept short for Excel's 31-char cap). */
export const SOURCE_REVISIONS_SHEET_NAME_AR = "مراجعات المصادر";

/** Minimal styling for the source-revision footer, shared by every report viewer. */
export const SOURCE_REVISIONS_CSS = `
.source-revisions{margin:24px 12px;padding:14px 18px;border-top:1px solid rgba(120,130,150,.35);font-size:12px;color:#4a5568;}
.source-revisions .srev-title{margin:0 0 4px;font-size:13px;font-weight:700;}
.source-revisions .srev-note{margin:0 0 8px;opacity:.8;}
.source-revisions .srev-list{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px 14px;}
.source-revisions .srev-list li{display:flex;gap:6px;align-items:baseline;}
.source-revisions .srev-file{font-family:monospace;}
.source-revisions .srev-rev{font-weight:700;}
`;

/** True when there is at least one revision to print. */
export function hasSourceRevisions(revisions: SourceRevisions | undefined | null): boolean {
  return !!revisions && Object.keys(revisions).length > 0;
}

/** Stable, name-sorted (file, revision) pairs for deterministic rendering. */
export function sourceRevisionEntries(
  revisions: SourceRevisions | undefined | null
): Array<[string, number]> {
  if (!revisions) return [];
  return Object.entries(revisions).sort(([a], [b]) => a.localeCompare(b));
}

/** Compact one-line summary, e.g. "population.final.json ⟵ مراجعة 3 · sample.master.json ⟵ مراجعة 1". */
export function formatSourceRevisionsInline(
  revisions: SourceRevisions | undefined | null
): string {
  const entries = sourceRevisionEntries(revisions);
  if (entries.length === 0) return "";
  return entries.map(([file, rev]) => `${file} ⟵ مراجعة ${rev}`).join(" · ");
}

/**
 * HTML footer block (B2). `escFn` MUST be the caller's hardened `esc` primitive so
 * file names (which can contain a folder segment) are safely interpolated. Returns
 * an empty string when there are no revisions, so callers can concatenate freely.
 */
export function sourceRevisionsFooterHtml(
  revisions: SourceRevisions | undefined | null,
  escFn: (value: string) => string
): string {
  const entries = sourceRevisionEntries(revisions);
  if (entries.length === 0) return "";
  const items = entries
    .map(
      ([file, rev]) =>
        `<li><span class="srev-file">${escFn(file)}</span><span class="srev-rev">مراجعة ${escFn(String(rev))}</span></li>`
    )
    .join("");
  return (
    `<section class="source-revisions" aria-label="${escFn(SOURCE_REVISIONS_LABEL_AR)}">` +
    `<h4 class="srev-title">${escFn(SOURCE_REVISIONS_LABEL_AR)}</h4>` +
    `<p class="srev-note">${escFn(SOURCE_REVISIONS_NOTE_AR)}</p>` +
    `<ul class="srev-list">${items}</ul>` +
    `</section>`
  );
}

/** AOA rows (header + one row per source file) for an Excel metadata sheet. */
export function sourceRevisionsSheetAoa(
  revisions: SourceRevisions | undefined | null
): Array<Array<string | number>> {
  const entries = sourceRevisionEntries(revisions);
  return [
    [...SOURCE_REVISIONS_SHEET_HEADERS_AR],
    ...entries.map(([file, rev]) => [file, rev] as Array<string | number>),
  ];
}
