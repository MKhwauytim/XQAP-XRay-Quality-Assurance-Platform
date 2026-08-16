import type { PreparedPopulationRow } from "../population/populationTypes";
import { toEmployeeMirrorRowStub } from "../population/populationTypes";

import { parseMonthFolderName } from "../population/monthFolder";
import { logError } from "../storage/errorLogger";
import type {
  DistributionEntry,
  DistributionEvent,
  DistributionEventType,
  DistributionStatus,
  EmployeeQuota,
  QuotaFacts
} from "./distributionTypes";

export type FoldResult = {
  entries: DistributionEntry[];
  droppedEventIds: Set<string>;
  droppedImageIds: Set<string>;
  /**
   * Events whose `xrayImageId` is not in `sampleRows` at all. They cannot be
   * folded (there is no row to attach an entry to) and are therefore absorbed
   * — but absorbed VISIBLY: they used to vanish from both `droppedEventIds`
   * and `droppedImageIds`, so nothing downstream could tell they existed, and
   * an `assigned` event for a phantom image still inflated the employee's
   * `sampleCount`/`dailyQuota` in `deriveEmployeeQuotasWithFacts`. (Since P2
   * the count comes from folded entries, so a phantom cannot reach it that way
   * any more; the exclusion still matters because such an event must not set
   * the employee's assignment window either.)
   *
   * Kept SEPARATE from `droppedEventIds` on purpose: that set means "a real
   * sample row exists but this event was illegal/uninterpretable", it is what
   * the aggregated `distribution:derive` warning counts, and widening it would
   * change the meaning of an established output. Quota derivation excludes
   * both sets (see {@link QuotaExcludedEvents}).
   */
  absentRowEventIds: Set<string>;
};

/**
 * The event ids quota derivation must ignore. Pass a `FoldResult` (it is
 * structurally assignable) so BOTH the illegal/unknown events and the
 * absent-row events are excluded; a bare `ReadonlySet<string>` is still
 * accepted for callers that have only an explicit drop list.
 */
export type QuotaExcludedEvents =
  | ReadonlySet<string>
  | { droppedEventIds: ReadonlySet<string>; absentRowEventIds: ReadonlySet<string> };

function isExcludedEvent(excluded: QuotaExcludedEvents, eventId: string): boolean {
  return "has" in excluded
    ? excluded.has(eventId)
    : excluded.droppedEventIds.has(eventId) || excluded.absentRowEventIds.has(eventId);
}

type EventTransition = {
  status: DistributionStatus;
  assignedTo: string;
  replacedById: string | null;
};

export type DistributionSummary = {
  totalAssigned: number;
  totalCompleted: number;
  totalReplaced: number;
  totalPending: number;
};

export function computeDaysRemainingForDeadline(
  month: number,
  year: number,
  fromDate = new Date()
): number {
  const lastDay = new Date(year, month, 0).getDate();
  const deadline = new Date(year, month - 1, lastDay - 3, 23, 59, 59);
  return Math.max(0, Math.ceil((deadline.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)));
}

function isUnsupportedEvent(event: DistributionEvent, supportedSchemaVersion: number): boolean {
  return (event.eventSchemaVersion ?? 1) > supportedSchemaVersion;
}

function isIllegalTerminalTransition(
  existing: DistributionEntry | undefined,
  event: DistributionEvent
): boolean {
  if (existing?.status === "replaced") return event.eventType !== "replaced";
  return existing?.status === "completed" &&
    (event.eventType === "assigned" || event.eventType === "reassigned");
}

function priorTransitionValues(event: DistributionEvent, existing: DistributionEntry | undefined) {
  return {
    assignee: existing?.assignedTo ?? event.assignedTo,
    replacement: existing?.replacedById ?? null
  };
}

type TransitionHandler = (event: DistributionEvent, existing: DistributionEntry | undefined) => EventTransition;

const TRANSITION_HANDLERS: Record<DistributionEventType, TransitionHandler> = {
  assigned: (event, existing) => ({
    status: "pending",
    assignedTo: event.assignedTo,
    replacedById: existing?.replacedById ?? null
  }),
  reassigned: (event, existing) => ({
    status: "pending",
    assignedTo: event.reassignedTo ?? event.assignedTo,
    replacedById: existing?.replacedById ?? null
  }),
  completed: (event, existing) => {
    const prior = priorTransitionValues(event, existing);
    return { status: "completed", assignedTo: prior.assignee, replacedById: prior.replacement };
  },
  "replacement-requested": (event, existing) => {
    const prior = priorTransitionValues(event, existing);
    return { status: "replacement-requested", assignedTo: prior.assignee, replacedById: prior.replacement };
  },
  replaced: (event, existing) => ({
    status: "replaced",
    assignedTo: existing?.assignedTo ?? event.assignedTo,
    replacedById: event.replacedById ?? null
  }),
  "reopen-requested": (event, existing) => {
    const prior = priorTransitionValues(event, existing);
    return { status: existing?.status ?? "pending", assignedTo: prior.assignee, replacedById: prior.replacement };
  },
  reopened: (event, existing) => {
    const prior = priorTransitionValues(event, existing);
    return { status: "pending", assignedTo: prior.assignee, replacedById: prior.replacement };
  }
};

function isKnownEventType(eventType: string): boolean {
  return Object.prototype.hasOwnProperty.call(TRANSITION_HANDLERS, eventType);
}

function recordDroppedEvent(result: FoldResult, event: DistributionEvent): void {
  result.droppedEventIds.add(event.eventId);
  result.droppedImageIds.add(event.xrayImageId);
}

/**
 * Fold `events` into `entries`, optionally resuming from a prior fold's
 * accumulator map (perf: fold-checkpoint). `resumeEntries`, when given, is
 * copied (never mutated in place) so the caller's own cached snapshot stays
 * intact if this call is later discarded (e.g. a late event forces a full
 * refold instead). Callers resuming from a checkpoint MUST have already
 * verified via findLateEvent (below) that none of `events` predates what
 * `resumeEntries` already reflects for the same xrayImageId -- this function
 * itself does not re-check that, since by the time it runs the caller has
 * committed to either the resumed path or the full-refold path.
 */
export function foldDistributionEvents(
  events: DistributionEvent[],
  sampleRows: PreparedPopulationRow[],
  supportedSchemaVersion: number,
  resumeEntries?: ReadonlyMap<string, DistributionEntry>
): FoldResult {
  const rows = new Map(sampleRows.map((row) => [row.xrayImageId, row]));
  const entries = new Map<string, DistributionEntry>(resumeEntries ?? []);
  const result: FoldResult = {
    entries: [],
    droppedEventIds: new Set<string>(),
    droppedImageIds: new Set<string>(),
    absentRowEventIds: new Set<string>()
  };

  const absentImageIds = new Set<string>();

  // A6e (H3): make an otherwise-silent mass-absorption visible. `rows` empty
  // while real events exist means every one of them is about to be absorbed
  // by the absent-row branch below — this is the same condition
  // loadOrDeriveDistributionCurrent's entry gate (A6d) exists to stop before
  // it ever reaches this function on the normal path, but this module is also
  // callable directly (deriveCurrentDistribution and friends in
  // distributionLog.ts), so the visibility net stays here too. Logged once per
  // call, not per event -- one call already means N identical silent drops,
  // not N distinct problems.
  if (rows.size === 0 && events.length > 0) {
    logError(
      "distribution:fold-no-rows",
      new Error(`foldDistributionEvents: ${events.length} event(s) supplied with an empty sample-row set`)
    );
  }

  for (const event of events) {
    const row = rows.get(event.xrayImageId);
    if (!row) {
      // No sample row for this image: nothing can be folded. Record it in its
      // own set (NOT droppedEventIds — see the FoldResult docblock) so the
      // caller can see it and so quota derivation stops counting a phantom
      // `assigned` event toward the employee's sampleCount/dailyQuota.
      result.absentRowEventIds.add(event.eventId);
      absentImageIds.add(event.xrayImageId);
      continue;
    }

    const existing = entries.get(event.xrayImageId);
    if (isUnsupportedEvent(event, supportedSchemaVersion) || isIllegalTerminalTransition(existing, event)) {
      recordDroppedEvent(result, event);
      continue;
    }

    // P5: an unrecognized eventType is dropped OUTRIGHT. It used to be recorded
    // as dropped and then still rewrite the entry — preserving status/assignee
    // but advancing `lastEventAt`/`lastEventId` to the very event the fold
    // claims it discarded. That silently rewrote the user-facing distribution
    // date, and a future-dated unknown event permanently defeated the fold
    // checkpoint (every subsequent read looked "late" and paid a full refold).
    // A discarded event must leave no trace on the entry.
    if (!isKnownEventType(event.eventType)) {
      recordDroppedEvent(result, event);
      continue;
    }

    const transition = TRANSITION_HANDLERS[event.eventType](event, existing);

    entries.set(event.xrayImageId, {
      xrayImageId: event.xrayImageId,
      ...transition,
      lastEventAt: event.eventAt,
      lastEventId: event.eventId,
      // B5: only the employee-mirror stub is stored here now, not the full
      // PreparedPopulationRow — see the docblock on DistributionEntry.row.
      row: toEmployeeMirrorRowStub(row)
    });
  }

  // Aggregated once per call, same as the drop reporting in distributionLog.ts.
  // Skipped when the row set was empty — that case already logged above, and
  // repeating it per-image would just restate the same single problem.
  if (rows.size > 0 && result.absentRowEventIds.size > 0) {
    logError(
      "distribution:fold-absent-row",
      new Error(
        `foldDistributionEvents: ${result.absentRowEventIds.size} event(s) reference ${absentImageIds.size} xrayImageId(s) absent from the sample rows: ${[...absentImageIds].join(", ")}.`
      )
    );
  }

  result.entries = Array.from(entries.values());
  return result;
}

/**
 * Correctness guard for the fold-checkpoint resume path (perf). The fold is
 * NOT commutative: it enforces legal terminal-state transitions per
 * xrayImageId, so folding new events on top of a resumed accumulator is only
 * valid when every new event for an already-known image sorts AFTER that
 * image's last-folded event. On a shared network-share workspace with
 * several machines, an older event can legitimately surface later (a
 * straggling immutable file write, a slow sync). When that happens for an
 * image this checkpoint already has an entry for, resuming would silently
 * risk folding out of order -- the caller MUST discard the checkpoint and
 * refold everything from scratch instead of patching in place.
 *
 * Returns the first out-of-order event found (for logging), or null when
 * `newEvents` is safe to fold on top of `priorEntries` as-is.
 */
export function findLateEvent(
  priorEntries: readonly DistributionEntry[],
  newEvents: readonly DistributionEvent[]
): DistributionEvent | null {
  const byImage = new Map(priorEntries.map((entry) => [entry.xrayImageId, entry]));
  for (const event of newEvents) {
    const existing = byImage.get(event.xrayImageId);
    if (existing && isEventEarlierThanEntry(event, existing)) return event;
  }
  return null;
}

function isEventEarlierThanEntry(event: DistributionEvent, entry: DistributionEntry): boolean {
  const eventAtCmp = event.eventAt.localeCompare(entry.lastEventAt);
  if (eventAtCmp < 0) return true;
  if (eventAtCmp > 0) return false;
  // Equal timestamp: fall back to the same eventId tie-break the merge/sort
  // order uses everywhere else in this module. A missing lastEventId means
  // `entry` predates this field (an older checkpoint format) -- treat that as
  // unknown order and conservatively call it late, so the caller pays for one
  // safe full refold rather than risk a silent misordering.
  if (!entry.lastEventId) return true;
  return event.eventId.localeCompare(entry.lastEventId) < 0;
}

/**
 * Live (non-`replaced`) entries owned by each employee, i.e. the workload the
 * employee actually has right now. This — not the raw `assigned` event count —
 * is what a quota must be derived from.
 */
export function countLiveEntriesByEmployee(
  entries: readonly DistributionEntry[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.status === "replaced") continue;
    counts[entry.assignedTo] = (counts[entry.assignedTo] ?? 0) + 1;
  }
  return counts;
}

export function deriveEmployeeQuotas(
  events: DistributionEvent[],
  entries: readonly DistributionEntry[],
  excluded: QuotaExcludedEvents,
  monthFolderName: string
): Record<string, EmployeeQuota> | undefined {
  return deriveEmployeeQuotasWithFacts(events, entries, excluded, monthFolderName).quotas;
}

/**
 * Same computation as deriveEmployeeQuotas, but resumable (perf: fold-
 * checkpoint) and returning the accumulator facts alongside the result so a
 * caller can persist them and extend with only NEW assigned events next time,
 * instead of re-scanning the full event history on every load.
 *
 * `entries` must be the COMPLETE folded entry set (the fold always re-emits
 * every resumed entry, so the incremental caller can pass its fold output
 * directly). `sampleCount` comes from it, never from `facts.assignmentCounts`:
 *
 * P2 — counting raw `assigned` events corrupted the quota on both sides of a
 * reassignment (the giver kept the row it no longer owns, the receiver never
 * gained it, permanently) and inflated it by one on every replacement.
 * Referral approval emits reassign events, so normal daily use hit this. The
 * facts are still collected and still resumable — they source the assignment
 * WINDOW (`assignedAt` / `daysRemainingAtAssignment`), which is genuinely a
 * property of the first assignment event, not of current ownership.
 *
 * Known, pre-existing gap left unchanged: an employee who only ever received
 * rows by reassignment has no `assigned` event, hence no assignment window,
 * hence no quota row — they own entries but appear in neither `firstAssignments`
 * nor `quotas`.
 */
export function deriveEmployeeQuotasWithFacts(
  events: DistributionEvent[],
  entries: readonly DistributionEntry[],
  excluded: QuotaExcludedEvents,
  monthFolderName: string,
  resumeFacts?: QuotaFacts
): { quotas: Record<string, EmployeeQuota> | undefined; facts: QuotaFacts } {
  const facts = collectAssignmentFacts(events, excluded, resumeFacts);
  const liveCounts = countLiveEntriesByEmployee(entries);
  const quotas: Record<string, EmployeeQuota> = {};
  const monthInfo = parseMonthFolderName(monthFolderName);
  for (const [username, firstAssignment] of Object.entries(facts.firstAssignments)) {
    const sampleCount = liveCounts[username] ?? 0;
    if (sampleCount <= 0) continue;
    const daysRemaining = assignmentDaysRemaining(firstAssignment, facts.latestStoredQuotas[username], monthInfo);
    if (daysRemaining === undefined) continue;
    quotas[username] = {
      username,
      sampleCount,
      dailyQuota: Math.ceil(sampleCount / Math.max(1, daysRemaining)),
      daysRemainingAtAssignment: daysRemaining,
      assignedAt: firstAssignment.eventAt
    };
  }
  return { quotas: Object.keys(quotas).length > 0 ? quotas : undefined, facts };
}

function collectAssignmentFacts(
  events: DistributionEvent[],
  excluded: QuotaExcludedEvents,
  resumeFacts?: QuotaFacts
): QuotaFacts {
  const assignmentCounts: Record<string, number> = { ...(resumeFacts?.assignmentCounts ?? {}) };
  const firstAssignments: Record<string, DistributionEvent> = { ...(resumeFacts?.firstAssignments ?? {}) };
  const latestStoredQuotas: Record<string, DistributionEvent> = { ...(resumeFacts?.latestStoredQuotas ?? {}) };
  for (const event of events) {
    if (event.eventType !== "assigned" || isExcludedEvent(excluded, event.eventId)) continue;
    firstAssignments[event.assignedTo] ??= event;
    assignmentCounts[event.assignedTo] = (assignmentCounts[event.assignedTo] ?? 0) + 1;
    if (event.dailyQuota !== undefined && event.daysRemainingAtAssignment !== undefined) {
      latestStoredQuotas[event.assignedTo] = event;
    }
  }
  return { assignmentCounts, firstAssignments, latestStoredQuotas };
}

function assignmentDaysRemaining(
  firstAssignment: DistributionEvent,
  storedQuota: DistributionEvent | undefined,
  monthInfo: ReturnType<typeof parseMonthFolderName>
): number | undefined {
  const firstAssignedAt = new Date(firstAssignment.eventAt);
  return monthInfo && !Number.isNaN(firstAssignedAt.getTime())
    ? computeDaysRemainingForDeadline(monthInfo.month, monthInfo.year, firstAssignedAt)
    : storedQuota?.daysRemainingAtAssignment;
}

export function summarizeDistribution(entries: DistributionEntry[]): DistributionSummary {
  const summary: DistributionSummary = {
    totalAssigned: 0,
    totalCompleted: 0,
    totalReplaced: 0,
    totalPending: 0
  };
  for (const entry of entries) {
    if (entry.status !== "replaced") summary.totalAssigned += 1;
    if (entry.status === "completed") summary.totalCompleted += 1;
    if (entry.status === "replaced") summary.totalReplaced += 1;
    if (entry.status === "pending") summary.totalPending += 1;
  }
  return summary;
}
