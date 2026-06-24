import type { PreparedPopulationRow } from "../population/populationTypes";
import type {
  DistributionCurrentData,
  DistributionEntry,
  DistributionEvent,
  DistributionLog,
  DistributionStatus,
  EmployeeQuota
} from "./distributionTypes";
import { parseMonthFolderName } from "../population/monthFolder";

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
export function computeDaysRemainingForDeadline(month: number, year: number, fromDate = new Date()): number {
  const lastDay = new Date(year, month, 0).getDate(); // last day of month
  const deadlineDay = lastDay - 3;
  const deadline = new Date(year, month - 1, deadlineDay, 23, 59, 59);
  const msRemaining = deadline.getTime() - fromDate.getTime();
  return Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
}

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
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventType: "reassigned",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    reassignedTo: params.reassignedTo,
    eventAt: new Date().toISOString(),
    eventBy: params.eventBy,
    notes: params.notes
  };
}

export function buildCompletedEvent(params: {
  xrayImageId: string;
  assignedTo: string;
  eventBy: string;
}): DistributionEvent {
  return {
    eventId: createEventId(),
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
  const rowMap = new Map<string, PreparedPopulationRow>(
    sampleRows.map((r) => [r.xrayImageId, r])
  );

  // Process events in order; latest event for each xrayImageId wins.
  const entryMap = new Map<string, DistributionEntry>();

  for (const evt of log.events) {
    const row = rowMap.get(evt.xrayImageId);
    if (!row) continue;

    let status: DistributionStatus = "pending";
    let replacedById: string | null = null;
    let assignedTo = evt.assignedTo;

    const existing = entryMap.get(evt.xrayImageId);
    if (existing) {
      replacedById = existing.replacedById;
    }

    switch (evt.eventType) {
      case "assigned":
        status = "pending";
        assignedTo = evt.assignedTo;
        break;
      case "reassigned":
        status = "pending";
        assignedTo = evt.reassignedTo ?? evt.assignedTo;
        break;
      case "completed":
        status = "completed";
        assignedTo = existing?.assignedTo ?? evt.assignedTo;
        break;
      case "replacement-requested":
        status = "replacement-requested";
        assignedTo = existing?.assignedTo ?? evt.assignedTo;
        break;
      case "replaced":
        status = "replaced";
        replacedById = evt.replacedById ?? null;
        assignedTo = existing?.assignedTo ?? evt.assignedTo;
        break;
    }

    entryMap.set(evt.xrayImageId, {
      xrayImageId: evt.xrayImageId,
      assignedTo,
      status,
      replacedById,
      lastEventAt: evt.eventAt,
      row
    });
  }

  const entries = Array.from(entryMap.values());
  const now = new Date().toISOString();

  // Derive per-employee quotas from assignment events.
  // Daily quota = employee sample count / days from first assignment until 3 days before month end.
  const quotaMap: Record<string, EmployeeQuota> = {};
  const assignCountPerEmployee: Record<string, number> = {};
  const firstAssignEventPerEmployee: Record<string, DistributionEvent> = {};
  const latestQuotaEventPerEmployee: Record<string, DistributionEvent> = {};

  for (const evt of log.events) {
    if (evt.eventType === "assigned") {
      if (!firstAssignEventPerEmployee[evt.assignedTo]) {
        firstAssignEventPerEmployee[evt.assignedTo] = evt;
      }
      assignCountPerEmployee[evt.assignedTo] = (assignCountPerEmployee[evt.assignedTo] ?? 0) + 1;

      if (evt.dailyQuota !== undefined && evt.daysRemainingAtAssignment !== undefined) {
        latestQuotaEventPerEmployee[evt.assignedTo] = evt;
      }
    }
  }

  const monthInfo = parseMonthFolderName(log.monthFolderName);
  for (const [username, firstAssignEvent] of Object.entries(firstAssignEventPerEmployee)) {
    const sampleCount = assignCountPerEmployee[username] ?? 0;
    if (sampleCount <= 0) continue;

    const firstAssignedAt = new Date(firstAssignEvent.eventAt);
    const storedQuotaEvent = latestQuotaEventPerEmployee[username];
    const daysRemaining = monthInfo && !Number.isNaN(firstAssignedAt.getTime())
      ? computeDaysRemainingForDeadline(monthInfo.month, monthInfo.year, firstAssignedAt)
      : storedQuotaEvent?.daysRemainingAtAssignment;
    if (daysRemaining === undefined) continue;

    const daysForQuota = Math.max(1, daysRemaining);
    quotaMap[username] = {
      username,
      sampleCount,
      dailyQuota: Math.ceil(sampleCount / daysForQuota),
      daysRemainingAtAssignment: daysRemaining,
      assignedAt: firstAssignEvent.eventAt,
    };
  }

  return {
    monthFolderName: log.monthFolderName,
    derivedAt: now,
    totalAssigned: entries.length,
    totalCompleted: entries.filter((e) => e.status === "completed").length,
    totalReplaced: entries.filter((e) => e.status === "replaced").length,
    totalPending: entries.filter((e) => e.status === "pending").length,
    entries,
    quotas: Object.keys(quotaMap).length > 0 ? quotaMap : undefined,
  };
}
