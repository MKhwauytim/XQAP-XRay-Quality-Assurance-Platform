// Vite virtual-module plugin for the date-organized files in docs/edit logs/.
// Development serves the complete history. Production keeps only the newest entries so the
// portable single-file build does not absorb the full, ever-growing documentation archive.
import type { Plugin } from "vite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Default number of most-recent version entries to keep in the shipped bundle. */
export const DEFAULT_KEEP_VERSIONS = 20;
export const EDIT_LOG_VIRTUAL_ID = "virtual:edit-log";

const RESOLVED_EDIT_LOG_VIRTUAL_ID = `\0${EDIT_LOG_VIRTUAL_ID}`;
const DAILY_LOG_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const HEADING_RE = /^## v[\d.]+ /gm;
const DEFAULT_EDIT_LOG_DIRECTORY = fileURLToPath(
  new URL("../../docs/edit%20logs/", import.meta.url),
);

/** Read every daily log in newest-date-first order as one parser-compatible document. */
export function readDailyEditLogs(directory = DEFAULT_EDIT_LOG_DIRECTORY): string {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && DAILY_LOG_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .map((name) => {
      const dailyFile = readFileSync(join(directory, name), "utf8");
      const firstEntryIndex = dailyFile.search(HEADING_RE);
      return firstEntryIndex >= 0 ? dailyFile.slice(firstEntryIndex).trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Count all real version headings across the aggregated daily history. */
export function countVersionHeadings(content: string): number {
  return [...content.matchAll(HEADING_RE)].length;
}

/** Keep complete entries only, cutting exactly at the next version heading. */
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
    `فقط، وذلك لتقليل حجم الملف المبني. للاطلاع على السجل الكامل، راجع الملفات اليومية في ` +
    "`docs/edit logs/` في مستودع المشروع.\n";

  return `${header}${kept}${notice}`;
}

export function editLogTruncatePlugin(directory = DEFAULT_EDIT_LOG_DIRECTORY): Plugin {
  let isBuild = false;

  return {
    name: "edit-log-daily-files",
    enforce: "pre",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    resolveId(id) {
      return id === EDIT_LOG_VIRTUAL_ID ? RESOLVED_EDIT_LOG_VIRTUAL_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_EDIT_LOG_VIRTUAL_ID) return null;
      const completeHistory = readDailyEditLogs(directory);
      const bundledHistory = isBuild ? truncateEditLog(completeHistory) : completeHistory;
      return `export default ${JSON.stringify(bundledHistory)};`;
    },
  };
}
