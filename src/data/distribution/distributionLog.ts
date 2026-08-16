import type { PreparedPopulationRow } from "../population/populationTypes";
import type {
  DistributionCurrentData,
  DistributionEvent,
  DistributionLog,
  QuotaFacts
} from "./distributionTypes";
import { logError } from "../storage/errorLogger";
import {
  deriveEmployeeQuotasWithFacts,
  findLateEvent,
  foldDistributionEvents,
  summarizeDistribution
} from "./distributionDerivation";

export { computeDaysRemainingForDeadline } from "./distributionDerivation";

/**
 * Version of the derivation algorithm in deriveCurrentDistribution. Bump when
 * fold semantics change. loadOrDeriveDistributionCurrent treats cached
 * snapshots with a missing or older deriveVersion as stale and re-derives
 * them, and refuses to resume a fold checkpoint stamped with another version.
 *
 * - v2: totalAssigned excludes replaced rows; "replaced" is terminal.
 * - v3: (a) P2 — `quotas[].sampleCount` counts LIVE entries owned by the
 *   employee instead of raw `assigned` events, so reassignment and replacement
 *   no longer corrupt it; (b) P5 — an unknown `eventType` is dropped outright
 *   instead of being recorded as dropped and still advancing the entry's
 *   `lastEventAt`/`lastEventId`. Both change persisted derived output, so every
 *   `distribution.current.json` and every fold checkpoint from v2 must refold.
 */
export const DERIVE_VERSION = 3;

/**
 * Current distribution-event schema version (A7). Stamped on every newly built
 * event; a missing version reads as 1 (legacy). The fold drops-and-preserves any
 * event whose version exceeds this, so an older client never mis-folds a newer
 * event shape. Bump when the event schema changes in a fold-affecting way.
 */
export const EVENT_SCHEMA_VERSION = 1;

export function createEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `evt-${crypto.randomUUID()}`;
  }
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Compute whole days remaining until the auditing deadline.
 * Deadline = 3 days before month-end, at 23:59:59 local time of that day.
 * e.g. June 2025 (monthEnd = 30) → deadline = 27th. The result is
 * Math.ceil of the remaining time, so any part of "today" still counts as a
 * full remaining day, and the value is clamped to a minimum of 0 once past due.
 */
export function buildAssignEvent(params: {
  xrayImageId: string;
  assignedTo: string;
  eventBy: string;
  notes?: string;
  dailyQuota?: number;
  daysRemainingAtAssignment?: number;
  /** Override for eventAt (defaults to now) — lets batch callers share one timestamp. */
  eventAt?: string;
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    eventType: "assigned",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    eventAt: params.eventAt ?? new Date().toISOString(),
    eventBy: params.eventBy,
    notes: params.notes,
    dailyQuota: params.dailyQuota,
    daysRemainingAtAssignment: params.daysRemainingAtAssignment,
  };
}

export function buildReassignEvent(params: {
  xrayImageId: string;
  assignedTo: string;
  reassignedTo: string;
  eventBy: string;
  notes?: string;
  sourceRequestId?: string;
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    eventType: "reassigned",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    reassignedTo: params.reassignedTo,
    eventAt: new Date().toISOString(),
    eventBy: params.eventBy,
    notes: params.notes,
    sourceRequestId: params.sourceRequestId
  };
}

export function buildReopenedEvent(params: {
  xrayImageId: string;
  assignedTo: string;
  eventBy: string;
  notes?: string;
  sourceRequestId?: string;
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    eventType: "reopened",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    eventAt: new Date().toISOString(),
    eventBy: params.eventBy,
    notes: params.notes,
    sourceRequestId: params.sourceRequestId
  };
}

export function buildReopenRequestedEvent(params: {
  xrayImageId: string;
  assignedTo: string;
  eventBy: string;
  notes?: string;
  sourceRequestId?: string;
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    eventType: "reopen-requested",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    eventAt: new Date().toISOString(),
    eventBy: params.eventBy,
    notes: params.notes,
    sourceRequestId: params.sourceRequestId
  };
}

export function buildCompletedEvent(params: {
  xrayImageId: string;
  assignedTo: string;
  eventBy: string;
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    eventType: "completed",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    eventAt: new Date().toISOString(),
    eventBy: params.eventBy
  };
}

export function buildReplacementRequestedEvent(params: {
  xrayImageId: string;
  assignedTo: string;
  eventBy: string;
  notes?: string;
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    eventType: "replacement-requested",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    eventAt: new Date().toISOString(),
    eventBy: params.eventBy,
    notes: params.notes
  };
}

export function buildReplacedEvent(params: {
  xrayImageId: string;
  assignedTo: string;
  replacedById: string;
  eventBy: string;
  notes?: string;
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    eventType: "replaced",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    replacedById: params.replacedById,
    eventAt: new Date().toISOString(),
    eventBy: params.eventBy,
    notes: params.notes
  };
}

// Derive the current distribution state from the event log.
// Each entry represents the latest state of a sample item.
export function deriveCurrentDistribution(
  log: DistributionLog,
  sampleRows: PreparedPopulationRow[]
): DistributionCurrentData {
  return deriveCurrentDistributionWithFacts(log, sampleRows).current;
}

/**
 * Same computation as deriveCurrentDistribution, but also returns the quota
 * accumulator facts (perf: fold-checkpoint) so a caller (distributionStorage.ts)
 * can persist them as part of a resumable checkpoint instead of recomputing
 * quotas from the full event history on every subsequent load.
 */
export function deriveCurrentDistributionWithFacts(
  log: DistributionLog,
  sampleRows: PreparedPopulationRow[]
): { current: DistributionCurrentData; quotaFacts: QuotaFacts } {
  const { entries, droppedEventIds, droppedImageIds, absentRowEventIds } = foldDistributionEvents(
    log.events,
    sampleRows,
    EVENT_SCHEMA_VERSION
  );

  // One aggregated report per derivation (not per event): a log permanently
  // containing illegal events would otherwise crowd the error ring buffer on
  // every slow-path derive.
  if (droppedEventIds.size > 0) {
    logError(
      "distribution:derive",
      new Error(
        `Dropped ${droppedEventIds.size} illegal/unknown event(s) targeting terminal (replaced/completed) or uninterpretable row(s): ${[...droppedImageIds].join(", ")}.`
      )
    );
  }

  // `entries` drives sampleCount (P2 — live ownership, not raw assign events).
  // Both exclusion sets are still passed: they keep a dropped/absent-row event
  // from setting the employee's assignment WINDOW.
  const { quotas, facts } = deriveEmployeeQuotasWithFacts(
    log.events,
    entries,
    { droppedEventIds, absentRowEventIds },
    log.monthFolderName
  );
  const summary = summarizeDistribution(entries);

  const current: DistributionCurrentData = {
    monthFolderName: log.monthFolderName,
    // Stamped here (not by callers) so every derived snapshot carries the
    // revision it came from — the mirror monotonic guard in syncSampleMirrors
    // treats a missing revision as 0 and would freeze mirrors otherwise.
    logRevision: log.revision,
    deriveVersion: DERIVE_VERSION,
    derivedAt: new Date().toISOString(),
    // Live (non-replaced) entries only. Invariant:
    // totalPending + totalCompleted + count(status === "replacement-requested") === totalAssigned.
    ...summary,
    entries,
    quotas,
  };

  return { current, quotaFacts: facts };
}

export type DistributionIncrementalResult = {
  current: DistributionCurrentData;
  quotaFacts: QuotaFacts;
  /**
   * True when an out-of-order ("late") event was detected relative to
   * `previous`. When true, `current`/`quotaFacts` are just `previous`/
   * `previousQuotaFacts` echoed back unchanged — the caller MUST discard its
   * checkpoint and perform a full refold from the complete event list instead
   * of trusting this result. See findLateEvent's doc comment for why patching
   * in place is never safe here.
   */
  requiresFullRefold: boolean;
};

/**
 * Resumable sibling of deriveCurrentDistribution (perf: fold-checkpoint).
 * Folds only `newEvents` on top of `previous`'s already-derived entries and
 * `previousQuotaFacts`, instead of refolding the entire event history. Safe
 * only when none of `newEvents` predates what `previous` already reflects for
 * the same xrayImageId (see findLateEvent) — callers must check
 * `requiresFullRefold` and fall back to deriveCurrentDistributionWithFacts
 * with the COMPLETE event list when it is true.
 */
export function deriveCurrentDistributionIncremental(
  previous: DistributionCurrentData,
  previousQuotaFacts: QuotaFacts,
  newEvents: DistributionEvent[],
  sampleRows: PreparedPopulationRow[]
): DistributionIncrementalResult {
  if (newEvents.length === 0) {
    return { current: previous, quotaFacts: previousQuotaFacts, requiresFullRefold: false };
  }

  if (findLateEvent(previous.entries, newEvents)) {
    return { current: previous, quotaFacts: previousQuotaFacts, requiresFullRefold: true };
  }

  const resumeEntries = new Map(previous.entries.map((entry) => [entry.xrayImageId, entry]));
  const { entries, droppedEventIds, droppedImageIds, absentRowEventIds } = foldDistributionEvents(
    newEvents,
    sampleRows,
    EVENT_SCHEMA_VERSION,
    resumeEntries
  );

  if (droppedEventIds.size > 0) {
    logError(
      "distribution:derive",
      new Error(
        `Dropped ${droppedEventIds.size} illegal/unknown event(s) targeting terminal (replaced/completed) or uninterpretable row(s): ${[...droppedImageIds].join(", ")}.`
      )
    );
  }

  // `entries` here is the COMPLETE folded set (the fold re-emits every resumed
  // entry), so the live-ownership count is whole even though only `newEvents`
  // extend the resumable facts.
  const { quotas, facts } = deriveEmployeeQuotasWithFacts(
    newEvents,
    entries,
    { droppedEventIds, absentRowEventIds },
    previous.monthFolderName,
    previousQuotaFacts
  );
  const summary = summarizeDistribution(entries);

  const current: DistributionCurrentData = {
    monthFolderName: previous.monthFolderName,
    logRevision: previous.logRevision,
    deriveVersion: DERIVE_VERSION,
    derivedAt: new Date().toISOString(),
    ...summary,
    entries,
    quotas,
  };

  return { current, quotaFacts: facts, requiresFullRefold: false };
}
