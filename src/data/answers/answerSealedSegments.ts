/**
 * Freshness controls for the "sealed segments are not re-opened" read shortcut
 * (S3, `directoryScan.readSegmentTails`).
 *
 * A segment is skipped only after a read confirmed a higher-seq sibling of its
 * chain exists — but a STABLE answer chain can still receive a late append below
 * its head (a second tab with a stale memo, a listing that lagged on the first
 * append after a reload). The writer avoids that (`listedSegmentNames` in
 * appendOnlyEventLog.ts); this module bounds how long a reader can be wrong if it
 * happens anyway:
 *
 *  - `SEALED_REVALIDATE_MS`: sealed-confirmed names are re-opened at most this
 *    long after they were confirmed, then re-confirmed (one full re-open per
 *    interval, not per read);
 *  - `invalidateSealedAnswerSegments()`: forget every confirmation NOW. Called
 *    when the 45 s sync probe reports `answers` changed, on the admin's manual
 *    refresh, and after a backup restore that merged `answers.events`.
 *
 * Deliberately a tiny standalone module (a generation counter, no imports of the
 * answers store) so `workspaceSync` and `backupStorage` can call it without
 * pulling in — or cycling through — `answerStorage`.
 */
import { subscribeToDataRefresh } from "../workspace/dataRefreshSignal";

export const SEALED_REVALIDATE_MS = 60_000;

let epoch = 0;

/** Bumped by every invalidation; a confirmation taken under an older epoch is not trusted. */
export function getSealedAnswerSegmentsEpoch(): number {
  return epoch;
}

export function invalidateSealedAnswerSegments(): void {
  epoch += 1;
}

if (typeof window !== "undefined") {
  // Same rule as directoryScan's own cache: only the MANUAL admin refresh is a
  // wholesale reset; periodic broadcasts are handled by the probe's own call.
  subscribeToDataRefresh((source) => {
    if (source === "manual") invalidateSealedAnswerSegments();
  });
}
