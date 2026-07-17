import type { PreparedPopulationRow } from "../population/populationTypes";
import type {
  DistributionCurrentData,
  DistributionEvent,
  DistributionLog
} from "./distributionTypes";
import { logError } from "../storage/errorLogger";
import {
  deriveEmployeeQuotas,
  foldDistributionEvents,
  summarizeDistribution
} from "./distributionDerivation";

export { computeDaysRemainingForDeadline } from "./distributionDerivation";

/**
 * Version of the derivation algorithm in deriveCurrentDistribution. Bump when
 * fold semantics change (v2: totalAssigned excludes replaced rows; "replaced"
 * is terminal). loadOrDeriveDistributionCurrent treats cached snapshots with a
 * missing or older deriveVersion as stale and re-derives them.
 */
export const DERIVE_VERSION = 2;

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
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    eventType: "assigned",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    eventAt: new Date().toISOString(),
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
  const { entries, droppedEventIds, droppedImageIds } = foldDistributionEvents(
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

  const quotas = deriveEmployeeQuotas(log.events, droppedEventIds, log.monthFolderName);
  const summary = summarizeDistribution(entries);

  return {
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
}
