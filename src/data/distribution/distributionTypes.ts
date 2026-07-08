import type { PreparedPopulationRow } from "../population/populationTypes";

export type DistributionEventType =
  | "assigned"
  | "completed"
  | "replacement-requested"
  | "replaced"
  | "reassigned"
  | "reopened";

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
  /** Idempotency key: the referral/replacement/reopen request that produced this event. */
  sourceRequestId?: string;
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
  /** Version of deriveCurrentDistribution that produced this snapshot; missing or older than DERIVE_VERSION means stale. */
  deriveVersion?: number;
  derivedAt: string;
  totalAssigned: number;
  totalCompleted: number;
  totalReplaced: number;
  totalPending: number;
  entries: DistributionEntry[];
  /** Daily quotas per employee, derived from assignment date through the monthly deadline. */
  quotas?: Record<string, EmployeeQuota>;
};
