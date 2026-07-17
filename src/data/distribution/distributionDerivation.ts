import type { PreparedPopulationRow } from "../population/populationTypes";
import { parseMonthFolderName } from "../population/monthFolder";
import type {
  DistributionEntry,
  DistributionEvent,
  DistributionEventType,
  DistributionStatus,
  EmployeeQuota
} from "./distributionTypes";

export type FoldResult = {
  entries: DistributionEntry[];
  droppedEventIds: Set<string>;
  droppedImageIds: Set<string>;
};

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

function transitionForEvent(event: DistributionEvent, existing: DistributionEntry | undefined): EventTransition | null {
  const priorAssignee = existing?.assignedTo ?? event.assignedTo;
  const handler = TRANSITION_HANDLERS[event.eventType];
  return handler
    ? handler(event, existing)
    : existing
      ? { status: existing.status, assignedTo: priorAssignee, replacedById: existing.replacedById }
      : null;
}

function recordDroppedEvent(result: FoldResult, event: DistributionEvent): void {
  result.droppedEventIds.add(event.eventId);
  result.droppedImageIds.add(event.xrayImageId);
}

export function foldDistributionEvents(
  events: DistributionEvent[],
  sampleRows: PreparedPopulationRow[],
  supportedSchemaVersion: number
): FoldResult {
  const rows = new Map(sampleRows.map((row) => [row.xrayImageId, row]));
  const entries = new Map<string, DistributionEntry>();
  const result: FoldResult = {
    entries: [],
    droppedEventIds: new Set<string>(),
    droppedImageIds: new Set<string>()
  };

  for (const event of events) {
    const row = rows.get(event.xrayImageId);
    if (!row) continue;

    const existing = entries.get(event.xrayImageId);
    if (isUnsupportedEvent(event, supportedSchemaVersion) || isIllegalTerminalTransition(existing, event)) {
      recordDroppedEvent(result, event);
      continue;
    }

    const transition = transitionForEvent(event, existing);
    if (!transition) {
      recordDroppedEvent(result, event);
      continue;
    }

    // Unknown event types preserve an existing entry but are still reported as dropped.
    if (!(event.eventType === "assigned" || event.eventType === "reassigned" ||
      event.eventType === "completed" || event.eventType === "replacement-requested" ||
      event.eventType === "replaced" || event.eventType === "reopen-requested" ||
      event.eventType === "reopened")) {
      recordDroppedEvent(result, event);
    }

    entries.set(event.xrayImageId, {
      xrayImageId: event.xrayImageId,
      ...transition,
      lastEventAt: event.eventAt,
      row
    });
  }

  result.entries = Array.from(entries.values());
  return result;
}

export function deriveEmployeeQuotas(
  events: DistributionEvent[],
  droppedEventIds: ReadonlySet<string>,
  monthFolderName: string
): Record<string, EmployeeQuota> | undefined {
  const { assignmentCounts, firstAssignments, latestStoredQuotas } = collectAssignmentFacts(
    events,
    droppedEventIds
  );
  const quotas: Record<string, EmployeeQuota> = {};
  const monthInfo = parseMonthFolderName(monthFolderName);
  for (const [username, firstAssignment] of Object.entries(firstAssignments)) {
    const sampleCount = assignmentCounts[username] ?? 0;
    if (sampleCount <= 0) continue;
    const daysRemaining = assignmentDaysRemaining(firstAssignment, latestStoredQuotas[username], monthInfo);
    if (daysRemaining === undefined) continue;
    quotas[username] = {
      username,
      sampleCount,
      dailyQuota: Math.ceil(sampleCount / Math.max(1, daysRemaining)),
      daysRemainingAtAssignment: daysRemaining,
      assignedAt: firstAssignment.eventAt
    };
  }
  return Object.keys(quotas).length > 0 ? quotas : undefined;
}

function collectAssignmentFacts(events: DistributionEvent[], droppedEventIds: ReadonlySet<string>) {
  const assignmentCounts: Record<string, number> = {};
  const firstAssignments: Record<string, DistributionEvent> = {};
  const latestStoredQuotas: Record<string, DistributionEvent> = {};
  for (const event of events) {
    if (event.eventType !== "assigned" || droppedEventIds.has(event.eventId)) continue;
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
