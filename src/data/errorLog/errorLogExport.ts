/**
 * Admin export of the workspace-wide error log to a single XLSX file.
 *
 * Mechanically identical to DataTable's own export (DataTable/index.tsx):
 * `aoa_to_sheet` -> `book_new` -> `book_append_sheet` -> `writeFile`, with the
 * row array built in chunks separated by `yieldToMain()` so a large history does
 * not block the UI thread for the whole build. The `XLSX.utils`/`writeFile` tail
 * is an unavoidable synchronous call; callers own an `isExporting` state for it.
 *
 * The pure row builder is separated from the XLSX call deliberately: `writeFile`
 * needs a DOM (it triggers a browser download), so keeping `buildErrorLogExportRows`
 * import-free of `xlsx` is what lets it be pinned by a plain node-env test — and
 * an export builder is deterministic-by-contract in this repo, so it needs one.
 *
 * HEADERS ARE ARABIC CONSTANTS, NOT LABEL KEYS. `powerbiExport/exportManager.ts`
 * sets the precedent that a generated file's column headings live in the builder
 * rather than in `DEFAULT_LABELS` — they are the schema of an artifact leaving the
 * app, not UI chrome an admin retitles from Settings. The button and status text in
 * Task 7 ARE label keys, because those are UI.
 *
 * Per `readOnlyMode.ts`, exports are explicitly *unaffected* by read-only mode —
 * they stream to a browser download and write nothing to the workspace. This
 * module never calls `isReadOnlyMode()`.
 */

import * as XLSX from "xlsx";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { yieldToMain } from "../storage/yieldToMain";
import type { PersistedErrorEntry } from "./errorLogTypes";
import { flushErrorLogNow } from "./errorLogSink";
import { readAllWorkspaceErrors, readWorkspaceErrorArchive } from "./errorLogStorage";

export const ERROR_EXPORT_HEADERS = [
  "الوقت",
  "المستخدم",
  "الدور",
  "الصفحة",
  "الإجراء",
  "رمز الخطأ",
  // The DOM error name, next to the code rather than buried in the stack. When
  // the code is the XQ-IO-032 catch-all this is the ONLY column that says what
  // actually failed — which is precisely the case an admin exports the log to
  // investigate.
  "نوع الخطأ",
  "السياق",
  "الرسالة",
  "التفاصيل التقنية",
] as const;

const EXPORT_CHUNK_SIZE = 1000;

function formatTimestamp(at: string): string {
  return at.slice(0, 19).replace("T", " ");
}

/** One `string[]` per entry, in header order. Pure, deterministic, DOM-free. */
export function buildErrorLogExportRows(entries: readonly PersistedErrorEntry[]): string[][] {
  return entries.map((entry) => [
    formatTimestamp(entry.at),
    entry.username ?? "",
    entry.role ?? "",
    entry.page ?? "",
    entry.action ?? "",
    entry.errorCode ?? "",
    entry.errorName ?? "",
    entry.context ?? "",
    entry.message ?? "",
    entry.stack ?? "",
  ]);
}

function mergeById(groups: PersistedErrorEntry[][]): PersistedErrorEntry[] {
  const byId = new Map<string, PersistedErrorEntry>();
  for (const group of groups) {
    for (const entry of group) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

export type GatherErrorLogRowsOptions = {
  /** Include the current and previous calendar year's per-user archives. */
  includeArchives: boolean;
};

export type GatherErrorLogRowsResult = {
  rows: string[][];
  rowCount: number;
};

/**
 * Gathers every workspace error, builds the export rows in chunks (yielding
 * to the main thread between them so a large history doesn't block the UI),
 * and returns them. Flushes the sink first so the admin's own just-hit
 * errors are included in the file they are about to read.
 */
export async function gatherErrorLogRows(
  directoryHandle: DirectoryHandleLike,
  options: GatherErrorLogRowsOptions
): Promise<GatherErrorLogRowsResult> {
  await flushErrorLogNow();

  const groups: PersistedErrorEntry[][] = [await readAllWorkspaceErrors(directoryHandle)];
  if (options.includeArchives) {
    const currentYear = new Date().getFullYear();
    groups.push(await readWorkspaceErrorArchive(directoryHandle, currentYear));
    groups.push(await readWorkspaceErrorArchive(directoryHandle, currentYear - 1));
  }
  const entries = mergeById(groups);

  const rows: string[][] = [];
  for (let i = 0; i < entries.length; i += EXPORT_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + EXPORT_CHUNK_SIZE);
    rows.push(...buildErrorLogExportRows(chunk));
    if (entries.length > EXPORT_CHUNK_SIZE) {
      await yieldToMain();
    }
  }

  return { rows, rowCount: rows.length };
}

export type ExportWorkspaceErrorLogOptions = GatherErrorLogRowsOptions & {
  /** Defaults to `error-log-{YYYY-MM-DD}.xlsx`. */
  fileName?: string;
};

/**
 * Gathers the workspace-wide error log and downloads it as a single XLSX
 * file. Returns `{ rowCount }` so the caller can tell an admin an empty
 * export was empty rather than broken.
 */
export async function exportWorkspaceErrorLog(
  directoryHandle: DirectoryHandleLike,
  options: ExportWorkspaceErrorLogOptions
): Promise<{ rowCount: number }> {
  const { rows, rowCount } = await gatherErrorLogRows(directoryHandle, options);

  const worksheet = XLSX.utils.aoa_to_sheet([[...ERROR_EXPORT_HEADERS], ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "سجل الأخطاء");
  const fileName = options.fileName ?? `error-log-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName);

  return { rowCount };
}
