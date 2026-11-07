import type { PendingReplayBlockReason, PendingReplaySummary } from "../../../../../../data/answers/pendingAnswerReplay";
import type { Labels } from "../../../../../../data/labels/labelsStore";

/** After this long without a result the button says the share is not answering (the pass keeps running). */
export const SEND_NOW_SLOW_MS = 30_000;

function blockedLabel(reason: PendingReplayBlockReason, L: Labels): string {
  switch (reason) {
    case "month-closed": return L.ew_answers_send_blocked_month_closed;
    case "read-only": return L.ew_answers_send_blocked_read_only;
    case "folder-missing": return L.ew_answers_send_blocked_folder_missing;
    case "folder-unreachable": return L.ew_answers_send_blocked_folder_unreachable;
    case "not-responding": return L.ew_answers_send_blocked_not_responding;
    case "unreadable": return L.ew_answers_send_blocked_unreadable;
  }
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/**
 * One line per outcome of a send pass, so «إرسال الآن» never looks like it
 * did nothing: what landed, then each reason the rest stayed unsent, with the
 * months it applies to. Never empty.
 */
export function describeFlushResult(summary: PendingReplaySummary, L: Labels): string[] {
  if (summary.skipped) return [L.ew_answers_send_busy];
  const lines: string[] = [];
  const sent = summary.replayed + summary.alreadyOnDisk;
  if (sent > 0) lines.push(fill(L.ew_answers_send_ok, { count: String(sent) }));
  for (const [reason, entry] of Object.entries(summary.blocked ?? {})) {
    if (!entry?.count) continue;
    lines.push(fill(blockedLabel(reason as PendingReplayBlockReason, L), {
      count: String(entry.count),
      months: entry.months.join("، "),
      error: summary.lastError ?? "",
    }));
  }
  if (summary.failed > 0) {
    lines.push(fill(L.ew_answers_send_failed, { count: String(summary.failed), error: summary.lastError ?? "" }));
  }
  return lines.length > 0 ? lines : [L.ew_answers_send_nothing];
}

/** Whether any outcome left answers that a backup copy should be offered for. */
export function flushLeftAnswersBehind(summary: PendingReplaySummary): boolean {
  return Boolean(summary.skipped) || summary.cannotLand > 0 || summary.failed > 0;
}
