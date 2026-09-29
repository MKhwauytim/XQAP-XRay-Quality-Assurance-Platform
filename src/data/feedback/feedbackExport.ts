/**
 * Admin export of every feedback conversation to one XLSX workbook with two
 * sheets (Workstream B, 2026-09-28):
 *
 *  - «المحادثات» — one row per thread: id, sender, role, category, status,
 *    created, last activity, reply count, resolved at/by, whether that
 *    resolution is estimated (legacy thread), original text.
 *  - «الرسائل»   — one row per message (the original, then each reply).
 *
 * PURE, NO I/O. The caller passes the threads to export; the click-time read
 * that gathers them lives in feedbackExportRead.ts. Every date cell is the
 * sortable `YYYY-MM-DD HH:mm:ss` text in LOCAL time (matching what the widget
 * shows) from `formatExportTimestamp` (utils/formatting.ts), so Excel sorts and
 * filters chronologically.
 *
 * Mechanically the same as `errorLog/errorLogExport.ts`: pure row builders,
 * rows assembled in chunks separated by `yieldToMain()`, then the synchronous
 * `aoa_to_sheet` -> `book_new` -> `book_append_sheet` -> `writeFile` tail.
 *
 * HEADERS ARE LABEL KEYS here, unlike errorLogExport's Arabic constants: the
 * corrective-plan spec asks for label-driven headers so an admin's Settings
 * override reaches the file, and every builder takes `labels` explicitly so it
 * stays pure and node-testable.
 *
 * Unaffected by read-only mode — a browser download writes nothing to the
 * workspace.
 */

import * as XLSX from "xlsx";

import { formatExportTimestamp as formatTimestampAs } from "../../utils/formatting";
import type { Labels } from "../labels/labelsStore";
import { yieldToMain } from "../storage/yieldToMain";
import type { FeedbackCategory, FeedbackMessage } from "./feedbackStorage";

export type FeedbackExportCell = string | number;
export type FeedbackExportRow = FeedbackExportCell[];

export type FeedbackExportSheets = {
  threadHeaders: string[];
  threadRows: FeedbackExportRow[];
  messageHeaders: string[];
  messageRows: FeedbackExportRow[];
};

const EXPORT_CHUNK_SIZE = 500;

/** Local time, like the widget shows. */
const formatExportTimestamp = (value: string | null | undefined) =>
  formatTimestampAs(value, { zone: "local" });


function categoryText(labels: Labels, category: FeedbackCategory): string {
  if (category === "issue") return labels.fb_category_issue;
  if (category === "inquiry") return labels.fb_category_inquiry;
  return labels.fb_category_suggestion;
}

function statusText(labels: Labels, status: FeedbackMessage["status"]): string {
  return status === "resolved" ? labels.fb_resolved_badge : labels.fb_filter_open;
}

/** Arabic role name for the five known roles; any other stored value is kept verbatim. */
function roleText(labels: Labels, role: string): string {
  const known: Record<string, string> = {
    admin: labels.toolbar_role_admin,
    manager: labels.toolbar_role_manager,
    supervisor: labels.toolbar_role_supervisor,
    employee: labels.toolbar_role_employee,
    guest: labels.toolbar_role_guest,
  };
  return known[role] ?? role;
}

function lastActivity(thread: FeedbackMessage): string {
  let latest = thread.timestamp;
  for (const reply of thread.replies) {
    if (reply.timestamp > latest) latest = reply.timestamp;
  }
  return latest;
}

/**
 * Resolved at/by, plus whether the pair is an estimate. The stored fields when
 * present; for a thread resolved before they existed, the last reply (resolving
 * always appends one), flagged in its OWN yes/no column so the date and author
 * cells stay clean for filtering and the file never presents a guess as a record.
 */
function resolutionCells(labels: Labels, thread: FeedbackMessage): [string, string, string] {
  if (thread.status !== "resolved") return ["", "", ""];
  if (thread.resolvedAt) {
    return [formatExportTimestamp(thread.resolvedAt), thread.resolvedBy ?? "", labels.fb_export_no];
  }
  const last = thread.replies.at(-1);
  if (!last) return ["", "", ""];
  return [formatExportTimestamp(last.timestamp), last.from, labels.fb_export_yes];
}

export function feedbackThreadHeaders(labels: Labels): string[] {
  return [
    labels.fb_export_col_thread_id,
    labels.fb_export_col_from,
    labels.fb_export_col_role,
    labels.fb_export_col_category,
    labels.fb_export_col_status,
    labels.fb_export_col_created_at,
    labels.fb_export_col_last_activity,
    labels.fb_export_col_reply_count,
    labels.fb_export_col_resolved_at,
    labels.fb_export_col_resolved_by,
    labels.fb_export_col_resolved_estimated,
    labels.fb_export_col_text,
  ];
}

export function feedbackMessageHeaders(labels: Labels): string[] {
  return [
    labels.fb_export_col_thread_id,
    labels.fb_export_col_category,
    labels.fb_export_col_status,
    labels.fb_export_col_sequence,
    labels.fb_export_col_author,
    labels.fb_export_col_role,
    labels.fb_export_col_date,
    labels.fb_export_col_message_text,
  ];
}

/** One row per thread, in input order, aligned with `feedbackThreadHeaders`. Pure. */
export function buildFeedbackThreadRows(
  threads: readonly FeedbackMessage[],
  labels: Labels
): FeedbackExportRow[] {
  return threads.map((thread) => {
    const [resolvedAt, resolvedBy, estimated] = resolutionCells(labels, thread);
    return [
      thread.id,
      thread.from,
      roleText(labels, thread.role),
      categoryText(labels, thread.category),
      statusText(labels, thread.status),
      formatExportTimestamp(thread.timestamp),
      formatExportTimestamp(lastActivity(thread)),
      thread.replies.length,
      resolvedAt,
      resolvedBy,
      estimated,
      thread.text,
    ];
  });
}

/**
 * One row per message -- the original (sequence 1) then each reply in stored
 * order (2, 3, ...) -- aligned with `feedbackMessageHeaders`. Pure.
 */
export function buildFeedbackMessageRows(
  threads: readonly FeedbackMessage[],
  labels: Labels
): FeedbackExportRow[] {
  const rows: FeedbackExportRow[] = [];
  for (const thread of threads) {
    const category = categoryText(labels, thread.category);
    const status = statusText(labels, thread.status);
    rows.push([
      thread.id,
      category,
      status,
      1,
      thread.from,
      roleText(labels, thread.role),
      formatExportTimestamp(thread.timestamp),
      thread.text,
    ]);
    thread.replies.forEach((reply, index) => {
      rows.push([
        thread.id,
        category,
        status,
        index + 2,
        reply.from,
        roleText(labels, reply.role),
        formatExportTimestamp(reply.timestamp),
        reply.text,
      ]);
    });
  }
  return rows;
}

/**
 * Both sheets' rows, built in chunks of EXPORT_CHUNK_SIZE threads with a
 * `yieldToMain()` between chunks so a long history does not block input.
 */
export async function buildFeedbackExportSheets(
  threads: readonly FeedbackMessage[],
  labels: Labels
): Promise<FeedbackExportSheets> {
  const threadRows: FeedbackExportRow[] = [];
  const messageRows: FeedbackExportRow[] = [];
  for (let i = 0; i < threads.length; i += EXPORT_CHUNK_SIZE) {
    const chunk = threads.slice(i, i + EXPORT_CHUNK_SIZE);
    threadRows.push(...buildFeedbackThreadRows(chunk, labels));
    messageRows.push(...buildFeedbackMessageRows(chunk, labels));
    if (threads.length > EXPORT_CHUNK_SIZE) {
      await yieldToMain();
    }
  }
  return {
    threadHeaders: feedbackThreadHeaders(labels),
    threadRows,
    messageHeaders: feedbackMessageHeaders(labels),
    messageRows,
  };
}

/** The two-sheet workbook, headers first on each sheet. Pure (no download). */
export function buildFeedbackWorkbook(sheets: FeedbackExportSheets, labels: Labels): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([sheets.threadHeaders, ...sheets.threadRows]),
    labels.fb_export_sheet_threads
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([sheets.messageHeaders, ...sheets.messageRows]),
    labels.fb_export_sheet_messages
  );
  return workbook;
}

/**
 * Builds and downloads the workbook. Returns the row counts so the caller can
 * tell an admin an empty export was empty rather than broken.
 */
export async function exportFeedbackWorkbook(
  threads: readonly FeedbackMessage[],
  labels: Labels,
  fileName = `feedback-${new Date().toISOString().slice(0, 10)}.xlsx`
): Promise<{ threadCount: number; messageCount: number }> {
  const sheets = await buildFeedbackExportSheets(threads, labels);
  XLSX.writeFile(buildFeedbackWorkbook(sheets, labels), fileName);
  return { threadCount: sheets.threadRows.length, messageCount: sheets.messageRows.length };
}
