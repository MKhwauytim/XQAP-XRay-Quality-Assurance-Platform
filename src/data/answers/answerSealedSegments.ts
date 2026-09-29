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
 *  - `invalidateSealedAnswerSegmentNames(names)`: forget the confirmation of
 *    exactly those segments NOW. Called by the 45 s sync probe with the names
 *    whose signature entry moved (grew, new, or vanished). A colleague's
 *    activity elsewhere no longer costs a re-stat of every sealed segment;
 *  - `invalidateSealedAnswerSegments()`: forget EVERY confirmation NOW. Called
 *    when the probe cannot say which names moved, on the admin's manual
 *    refresh, and after a backup restore that merged `answers.events`.
 *
 * Deliberately a tiny standalone module (a generation counter, no imports of the
 * answers store) so `workspaceSync` and `backupStorage` can call it without
 * pulling in — or cycling through — `answerStorage`.
 */
import { subscribeToDataRefresh } from "../workspace/dataRefreshSignal";

/**
 * Was 60 s. The probe now invalidates the exact names that moved, so this
 * interval is only the backstop for growth the probe cannot see (a sealed
 * segment beyond its stat budget) -- a rare late-append hazard the writer
 * already avoids (`listedSegmentNames`) -- and can afford to be longer, which
 * halves how often a save pays a full re-stat of every sealed segment.
 */
export const SEALED_REVALIDATE_MS = 180_000;

/** More distinct invalidated names than this and we simply reset everything. */
const MAX_TRACKED_INVALIDATED_NAMES = 2_000;

let epoch = 0;
let nameGeneration = 0;
/** name -> the `nameGeneration` value at which its confirmation was last invalidated. */
const invalidatedAt = new Map<string, number>();

/** Bumped by every invalidation; a confirmation taken under an older epoch is not trusted. */
export function getSealedAnswerSegmentsEpoch(): number {
  return epoch;
}

export function invalidateSealedAnswerSegments(): void {
  epoch += 1;
  invalidatedAt.clear();
}

/**
 * Forget the sealed confirmation of each named segment (and only those). A
 * confirmation taken at a generation older than the name's invalidation is not
 * trusted, so the very next read re-opens the segment and re-confirms it.
 */
export function invalidateSealedAnswerSegmentNames(names: Iterable<string>): void {
  for (const name of names) {
    nameGeneration += 1;
    invalidatedAt.set(name, nameGeneration);
  }
  if (invalidatedAt.size > MAX_TRACKED_INVALIDATED_NAMES) invalidateSealedAnswerSegments();
}

/** Read BEFORE a directory read; store with the confirmations it produces. */
export function getSealedNamesGeneration(): number {
  return nameGeneration;
}

/** The confirmations still trustworthy: those not invalidated since `confirmedAtGeneration`. */
export function stillSealedNames(
  confirmed: ReadonlySet<string>,
  confirmedAtGeneration: number
): ReadonlySet<string> {
  if (invalidatedAt.size === 0) return confirmed;
  let out: Set<string> | null = null;
  for (const name of confirmed) {
    const at = invalidatedAt.get(name);
    if (at !== undefined && at > confirmedAtGeneration) {
      out ??= new Set(confirmed);
      out.delete(name);
    }
  }
  return out ?? confirmed;
}

if (typeof window !== "undefined") {
  // Same rule as directoryScan's own cache: only the MANUAL admin refresh is a
  // wholesale reset; periodic broadcasts are handled by the probe's own call.
  subscribeToDataRefresh((source) => {
    if (source === "manual") invalidateSealedAnswerSegments();
  });
}
