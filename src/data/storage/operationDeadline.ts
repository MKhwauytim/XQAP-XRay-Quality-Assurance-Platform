/**
 * One wall-clock budget for one user action.
 *
 * WHY THIS EXISTS. This app's I/O stack retries at four independent layers, and
 * on the production UNC/SMB share their costs MULTIPLY instead of adding:
 *
 *   casLoop                        14 attempts on the answer path
 *     └─ safeWriteJson             1 write = 5 I/O steps
 *          ├─ writeText            retryTransientWrite, ~630 ms
 *          ├─ readText (staged)    VERIFY_READBACK_RETRY_DELAYS_MS, ~11.03 s
 *          └─ readText (committed) VERIFY_READBACK_RETRY_DELAYS_MS, ~11.03 s
 *
 * 14 × 2 × 11.03 s ≈ 308 s of pure sleeping — which is the "saving an answer
 * takes 4 minutes" report from 2026-09-13, and the reason a طلب استبدال could
 * sit for minutes before failing. Every layer was individually well-reasoned;
 * nothing owned the product.
 *
 * `SNAPSHOT_STALE_RETRY_DELAYS_MS` in transientFileErrors.ts already states the
 * governing principle — "an inner ladder multiplies against that … Patience at
 * the wrong layer makes contention worse, not better" — and is deliberately kept
 * to ~630 ms because of it. The 11 s verify-readback ladder sits in the very
 * same nest and is 17× longer. It is not wrong on its own (a standalone month
 * save genuinely needs to outlast a share publishing an entry); it is wrong
 * *nested*. A deadline is how a ladder tells the difference: patience is
 * measured against the user's action, not against the ladder's own rung count.
 *
 * AND IT IS NOT ONLY LATENCY. Every extra moment inside an attempt is a moment
 * this machine holds a shared file open while N others want it, and every retry
 * re-arms the same race — so an unbounded ladder manufactures the contention it
 * is retrying against. Bounding the total is a correctness fix for the
 * error-growth loop (symptom D), not just a speed-up.
 *
 * SEMANTICS. A deadline never interrupts work in flight: an I/O call that has
 * already started always runs to completion, and a write that has committed is
 * never abandoned. It only answers "should I sleep and try AGAIN?". So the
 * worst case is the deadline plus the cost of the one attempt that was already
 * running — bounded and predictable, which unbounded nesting was not.
 *
 * Passing no deadline preserves the previous unbounded behaviour exactly, so
 * call sites adopt it one at a time.
 */

/** An absolute point in time after which a retry ladder should stop waiting. */
export type OperationDeadline = {
  /** `Date.now()` value past which no NEW attempt should start. */
  readonly at: number;
  /** Diagnostic label naming the user action that owns this budget. */
  readonly label: string;
};

/**
 * Budget for one interactive save (answer, request append, feedback write).
 *
 * Chosen to be comfortably longer than a healthy contended write (hundreds of
 * ms) and far shorter than the multi-minute stalls users reported. A user who
 * has waited 30 s for a click is already reporting a bug; spending 300 s to
 * reach the same failure helps nobody and keeps a hot file open the whole time.
 */
export const INTERACTIVE_WRITE_DEADLINE_MS = 30_000;

/**
 * Budget for a bulk/administrative write (month save, distribution rebuild).
 * These legitimately take longer and are not competing with a user's click.
 */
export const BULK_WRITE_DEADLINE_MS = 120_000;

export function createDeadline(budgetMs: number, label: string): OperationDeadline {
  return { at: Date.now() + budgetMs, label };
}

/** True once the budget is spent. A missing deadline is never expired. */
export function isDeadlineExpired(deadline: OperationDeadline | undefined): boolean {
  return deadline !== undefined && Date.now() >= deadline.at;
}

/** Milliseconds left, floored at 0. `Infinity` when there is no deadline. */
export function deadlineRemainingMs(deadline: OperationDeadline | undefined): number {
  if (deadline === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, deadline.at - Date.now());
}

/**
 * Decide whether a ladder may sleep `delayMs` before its next attempt.
 *
 * Returns the delay to actually sleep, or `null` meaning "the budget is spent,
 * stop retrying and report the failure you already have".
 *
 * A delay that would overrun the deadline is TRUNCATED to what is left rather
 * than refused outright: the remaining time is still a real chance for the
 * condition to clear, and truncating keeps the ladder's shape (short rungs
 * first) intact. Only a genuinely exhausted budget returns `null`.
 */
export function nextRetryDelayMs(
  delayMs: number,
  deadline: OperationDeadline | undefined
): number | null {
  if (deadline === undefined) return delayMs;
  const remaining = deadlineRemainingMs(deadline);
  // No time for even a token pause — another attempt would just re-arm the race.
  if (remaining <= 0) return null;
  return Math.min(delayMs, remaining);
}
