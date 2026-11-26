import { logError } from "../storage/errorLogger";
import type { PendingReplaySummary } from "./pendingAnswerReplay";

/**
 * Answers this browser cannot land stay on this one PC; the admin, reading the
 * shared folder, sees the cases unanswered and has no way to learn why. Each
 * blocked cause is written once per session (cause + months) to the error log,
 * which the durable sink copies into the workspace's per-user error file the
 * admin can export. The replay itself keeps these silent on purpose — they
 * recur every tick — so this is the one place they are reported.
 */
const reported = new Set<string>();

/** @internal test-only */
export function __resetStuckAnswersReportForTests(): void {
  reported.clear();
}

export function reportStuckAnswers(username: string, summary: PendingReplaySummary): void {
  for (const [reason, detail] of Object.entries(summary.blocked ?? {})) {
    if (!detail || detail.count === 0) continue;
    const months = [...detail.months].sort().join(", ");
    const key = `${username}::${reason}::${months}`;
    if (reported.has(key)) continue;
    reported.add(key);
    const cause = summary.lastError ? ` (${summary.lastError})` : "";
    logError(
      "answers:stuck-unsent",
      new Error(`${detail.count} answer(s) by ${username} are saved only on this PC and cannot reach the shared folder: ${reason}${cause} — months: ${months}`),
      { action: `stuck-unsent:${reason}` }
    );
  }
}
