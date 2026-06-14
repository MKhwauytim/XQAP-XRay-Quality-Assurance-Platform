import type { PreparedPopulationRow } from "../../components/Sidebar/Tabs/Population/processing/populationProcessingTypes";
import type {
  DistributionCurrentData,
  DistributionEntry,
  DistributionEvent,
  DistributionLog,
  DistributionStatus
} from "./distributionTypes";

export function createEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildAssignEvent(params: {
  xrayImageId: string;
  assignedTo: string;
  eventBy: string;
  notes?: string;
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventType: "assigned",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    eventAt: new Date().toISOString(),
    eventBy: params.eventBy,
    notes: params.notes
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
    assignedTo: params.reassignedTo,
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
}): DistributionEvent {
  return {
    eventId: createEventId(),
    eventType: "replaced",
    xrayImageId: params.xrayImageId,
    assignedTo: params.assignedTo,
    replacedById: params.replacedById,
    eventAt: new Date().toISOString(),
    eventBy: params.eventBy
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

  return {
    monthFolderName: log.monthFolderName,
    derivedAt: now,
    totalAssigned: entries.length,
    totalCompleted: entries.filter((e) => e.status === "completed").length,
    totalReplaced: entries.filter((e) => e.status === "replaced").length,
    totalPending: entries.filter((e) => e.status === "pending").length,
    entries
  };
}
