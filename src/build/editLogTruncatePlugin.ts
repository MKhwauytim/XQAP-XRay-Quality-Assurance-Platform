// Vite build plugin: truncates the `?raw` import of docs/EDIT_LOG.md so the shipped bundle
// doesn't inline the entire (multi-hundred-KB, ever-growing) edit log. Build-only (`apply:
// "build"`) — the dev server keeps serving the full log unmodified, since seeing the whole
// history is useful while authoring new EDIT_LOG entries.
//
// The repo file `docs/EDIT_LOG.md` itself is never written to. Only the in-memory module
// content produced for this one import is shortened.
import type { Plugin } from "vite";
import { readFileSync } from "node:fs";

/** Default number of most-recent version entries to keep in the shipped bundle. */
export const DEFAULT_KEEP_VERSIONS = 20;

// Matches a version heading line, e.g. "## v42.13 " — deliberately loose (no full line anchor
// on the far end) so `matchAll` gives us just the *start* offset of each heading for slicing.
const HEADING_RE = /^## v[\d.]+ /gm;

/**
 * Count real version headings in an EDIT_LOG.md-shaped string (before any truncation). Used to
 * inject the true total version count as a build-time constant — the ChangeLog tab's "إجمالي
 * الإصدارات" stat must reflect this, not `entries.length` of the (possibly truncated) bundled
 * log, or a production build under-reports its own history.
 */
export function countVersionHeadings(content: string): number {
  return [...content.matchAll(HEADING_RE)].length;
}

/**
 * Truncate an EDIT_LOG.md-shaped markdown string to the first `keep` version headings
 * (the log is prepend-ordered — newest entries are added at the top of the file — so "first
 * N headings from the top" means "N most recent versions").
 *
 * The cut always lands exactly on a heading boundary (never mid-entry): we slice up to the
 * byte offset where the (keep+1)-th heading begins. A synthetic "v0.0" notice entry is
 * appended explaining the truncation; v0.0 sorts after every real version under the
 * ChangeLog tab's newest-first ordering, so it always renders last without disturbing real
 * entries.
 *
 * Pure function — no file I/O — so it's directly unit-testable.
 */
export function truncateEditLog(content: string, keep: number = DEFAULT_KEEP_VERSIONS): string {
  const matches = [...content.matchAll(HEADING_RE)];
  if (matches.length <= keep) return content;

  const firstHeadingIndex = matches[0]!.index!;
  const cutIndex = matches[keep]!.index!;
  const header = content.slice(0, firstHeadingIndex);
  const kept = content.slice(firstHeadingIndex, cutIndex);
  const omitted = matches.length - keep;
  const today = new Date().toISOString().slice(0, 10);

  const notice =
    `## v0.0 — ${today} — سجل مختصر: تم حذف ${omitted} إصدارًا أقدم من هذه النسخة المضمّنة\n\n` +
    `تم اختصار سجل الإصدارات المضمّن داخل هذا الإصدار من التطبيق ليحتوي على آخر ${keep} إصدارًا ` +
    `فقط، وذلك لتقليل حجم الملف المبني. للاطلاع على السجل الكامل لجميع الإصدارات، راجع ` +
    "`docs/EDIT_LOG.md` في مستودع المشروع.\n";

  return `${header}${kept}${notice}`;
}

export function editLogTruncatePlugin(): Plugin {
  return {
    name: "edit-log-truncate",
    apply: "build",
    enforce: "pre",
    load(id) {
      if (!id.endsWith("EDIT_LOG.md?raw")) return null;
      const filePath = id.slice(0, id.length - "?raw".length);
      const raw = readFileSync(filePath, "utf8");
      const truncated = truncateEditLog(raw);
      return `export default ${JSON.stringify(truncated)};`;
    },
  };
}
