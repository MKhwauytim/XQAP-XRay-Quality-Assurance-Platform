import type { PreparedPopulationRow } from "../population/populationTypes";

export type DistributionEventType =
  | "assigned"
  | "completed"
  | "replacement-requested"
  | "replaced"
  | "reassigned";

export type DistributionEvent = {
  eventId: string;
  eventType: DistributionEventType;
  xrayImageId: string;
  assignedTo: string;
  replacedById?: string;
  reassignedTo?: string;
  eventAt: string;
  eventBy: string;
  notes?: string;
  /** Daily quota snapshot frozen at assignment time (only on "assigned" events from bulk distribution). */
  dailyQuota?: number;
  /** Days remaining until deadline at assignment time. */
  daysRemainingAtAssignment?: number;
};

/** Per-employee quota derived from the distribution log. */
export type EmployeeQuota = {
  username: string;
  sampleCount: number;
  dailyQuota: number;
  daysRemainingAtAssignment: number;
  assignedAt: string;
};

export type DistributionLog = {
  monthFolderName: string;
  /** Monotonically increasing counter — incremented on every append. Used for CAS conflict detection. */
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  events: DistributionEvent[];
};

export type DistributionStatus =
  | "pending"
  | "completed"
  | "replacement-requested"
  | "replaced";

export type DistributionEntry = {
  xrayImageId: string;
  assignedTo: string;
  status: DistributionStatus;
  replacedById: string | null;
  lastEventAt: string;
  row: PreparedPopulationRow;
};

export type DistributionCurrentData = {
  monthFolderName: string;
  /** Revision of the DistributionLog this snapshot was derived from. Used to detect stale cache. */
  logRevision?: number;
  derivedAt: string;
  totalAssigned: number;
  totalCompleted: number;
  totalReplaced: number;
  totalPending: number;
  entries: DistributionEntry[];
  /** Frozen daily quotas per employee, computed at assignment time. */
  quotas?: Record<string, EmployeeQuota>;
};
