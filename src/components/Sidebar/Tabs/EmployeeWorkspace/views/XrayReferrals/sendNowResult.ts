import type { PendingReplaySummary } from "../../../../../../data/answers/pendingAnswerReplay";
import type { Labels } from "../../../../../../data/labels/labelsStore";

/** After this long without a result the button says the share is not answering (the pass keeps running). */
export const SEND_NOW_SLOW_MS = 30_000;

/**
 * One line per reason this pass left answers unsent, so «إرسال الآن» never
 * looks like it did nothing. Never empty.
 */
export function describeFlushResult(summary: PendingReplaySummary, L: Labels): string[] {
  if (summary.skipped) return [L.ew_answers_send_busy];
  const lines: string[] = [];
  const sent = summary.replayed + summary.alreadyOnDisk;
  if (sent > 0) lines.push(L.ew_answers_send_ok.replace("{count}", String(sent)));
  const reasonLabels = {
    "month-closed": L.ew_answers_send_blocked_month_closed,
    "read-only": L.ew_answers_send_blocked_read_only,
    "folder-missing": L.ew_answers_send_blocked_folder_missing,
    "folder-unreachable": L.ew_answers_send_blocked_folder_unreachable,
    unreadable: L.ew_answers_send_blocked_unreadable,
  } as const;
  for (const [reason, count] of Object.entries(summary.blocked ?? {})) {
    if (!count) continue;
    lines.push(
      reasonLabels[reason as keyof typeof reasonLabels]
        .replace("{count}", String(count))
        .replace("{error}", summary.lastError ?? "")
    );
  }
  if (summary.failed > 0) {
    lines.push(
      L.ew_answers_send_failed
        .replace("{count}", String(summary.failed))
        .replace("{error}", summary.lastError ?? "")
    );
  }
  return lines.length > 0 ? lines : [L.ew_answers_send_nothing];
}
