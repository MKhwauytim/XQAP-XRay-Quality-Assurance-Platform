/**
 * Admin export of BOTH audit logs behind «النشاط والإجراءات» to one XLSX file:
 * the session activity log and the workspace action log (live + yearly archives).
 *
 * Same shape as `data/errorLog/errorLogExport.ts`: pure, DOM-free row builders
 * (pinned by a node-env test) and a thin `XLSX.writeFile` tail. Headers are
 * Arabic constants — they are the schema of a file leaving the app, not UI
 * chrome. The export is deliberately UNFILTERED: it ignores the on-screen type
 * picker, so the high-volume `answer-submitted` entries are included too.
 * Exports write nothing to the workspace and are unaffected by read-only mode.
 */

import * as XLSX from "xlsx";

import type { AuthActivityCloseReason, AuthActivityLogEntry } from "../../../../auth/authActivityLog";
import { readAuthActivityLog } from "../../../../auth/authActivityLog";
import { MANAGED_ROLES } from "../../../../auth/userManagement";
import {
  readWorkspaceActionArchive,
  readWorkspaceActions,
  type WorkspaceActionEntry,
} from "../../../../data/audit/actionLog";
import { getLabels } from "../../../../data/labels/labelsStore";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { formatExportTimestamp } from "../../../../utils/formatting";
import { ACTION_TYPE_LABEL_KEYS } from "./actionCatalog";

export const ACTIVITY_EXPORT_HEADERS = [
  "المستخدم",
  "الدور",
  "وقت الدخول (UTC)",
  "آخر ظهور (UTC)",
  "وقت الخروج (UTC)",
  "المدة (دقائق)",
  "السبب",
] as const;

export const ACTIONS_EXPORT_HEADERS = [
  "الوقت (UTC)",
  "المستخدم",
  "الدور",
  "الإجراء",
  "الهدف",
  "الشهر",
  "التفاصيل",
] as const;

export const ACTIVITY_SHEET_NAME = "سجل الأنشطة";
export const ACTIONS_SHEET_NAME = "سجل الإجراءات";

/** How many calendar years of per-actor action archives to fold in (this year + N back). */
const ARCHIVE_YEARS_BACK = 2;

function roleLabel(role: string): string {
  return MANAGED_ROLES.find((item) => item.id === role)?.label ?? role;
}

function closeReasonLabel(reason: AuthActivityCloseReason | null): string {
  if (reason === "logout") return "تسجيل خروج";
  if (reason === "expired") return "انتهت الجلسة";
  if (reason === "session-replaced") return "دخول جديد";
  if (reason === "page-closed") return "إغلاق التطبيق/المتصفح";
  return "نشط";
}

/** Newest first, matching the on-screen tables. Pure. */
export function buildActivityExportRows(entries: readonly AuthActivityLogEntry[]): (string | number)[][] {
  return entries
    .slice()
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
    .map((entry) => [
      entry.username,
      roleLabel(entry.role),
      formatExportTimestamp(entry.signedInAt),
      formatExportTimestamp(entry.lastSeenAt),
      formatExportTimestamp(entry.signedOutAt),
      Math.round(Math.max(0, entry.durationMs) / 60_000),
      closeReasonLabel(entry.closeReason),
    ]);
}

/** Newest first. `details` is flattened to `key: value` pairs, never raw JSON braces. Pure. */
export function buildActionsExportRows(entries: readonly WorkspaceActionEntry[]): string[][] {
  const labels = getLabels();
  return entries
    .slice()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((entry) => [
      formatExportTimestamp(entry.at),
      entry.actor,
      roleLabel(entry.actorRole),
      labels[ACTION_TYPE_LABEL_KEYS[entry.action]] ?? entry.action,
      entry.target ?? "",
      entry.monthFolderName ?? "",
      entry.details
        ? Object.entries(entry.details).map(([key, value]) => `${key}: ${value ?? ""}`).join(" | ")
        : "",
    ]);
}

function mergeActionsById(groups: WorkspaceActionEntry[][]): WorkspaceActionEntry[] {
  const byId = new Map<string, WorkspaceActionEntry>();
  for (const group of groups) {
    for (const entry of group) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

/** Live action log ∪ the recent yearly archives, de-duplicated by id. */
export async function gatherAllActions(directoryHandle: DirectoryHandleLike): Promise<WorkspaceActionEntry[]> {
  const groups: WorkspaceActionEntry[][] = [await readWorkspaceActions(directoryHandle)];
  const year = new Date().getFullYear();
  for (let back = 0; back <= ARCHIVE_YEARS_BACK; back += 1) {
    groups.push(await readWorkspaceActionArchive(directoryHandle, year - back));
  }
  return mergeActionsById(groups);
}

export type AuditExportResult = { activityCount: number; actionCount: number };

/** Reads both logs fresh from disk and downloads one workbook with two sheets. */
export async function exportAuditLogs(directoryHandle: DirectoryHandleLike): Promise<AuditExportResult> {
  const [activity, actions] = await Promise.all([readAuthActivityLog(), gatherAllActions(directoryHandle)]);
  const activityRows = buildActivityExportRows(activity);
  const actionRows = buildActionsExportRows(actions);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[...ACTIONS_EXPORT_HEADERS], ...actionRows]), ACTIONS_SHEET_NAME);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[...ACTIVITY_EXPORT_HEADERS], ...activityRows]), ACTIVITY_SHEET_NAME);
  XLSX.writeFile(workbook, `audit-logs-${new Date().toISOString().slice(0, 10)}.xlsx`);

  return { activityCount: activityRows.length, actionCount: actionRows.length };
}
