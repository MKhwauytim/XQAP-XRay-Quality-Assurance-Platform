import type { PreparedPopulationRow } from "../population/populationTypes";

export type DistributionEventType =
  | "assigned"
  | "completed"
  | "replacement-requested"
  | "replaced"
  | "reassigned"
  | "reopen-requested"
  | "reopened";

export type DistributionEvent = {
  eventId: string;
  eventType: DistributionEventType;
  /**
   * Event-sourcing replay-safety version (A7). Stamped as 1 on newly appended
   * events; absent means 1 on read. The fold preserves-existing (drops) any
   * event whose version is newer than the reader understands, so a future shape
   * change can never fold ambiguously on an older client.
   */
  eventSchemaVersion?: number;
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
  /**
   * Deterministic identity of the merged event-id set. Unlike `revision`, this
   * changes when immutable event files written by another machine are found,
   * even when a compatibility-log writer lost a last-writer-wins race.
   */
  eventSetId?: string;
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
  /**
   * eventId of the event that produced lastEventAt (perf: fold-checkpoint
   * resumability). Used only as an (eventAt, eventId) tie-break to detect a
   * "late" event arriving after this entry was folded -- an entry produced
   * before this field existed reads as undefined, which callers must treat
   * conservatively (see findLateEvent in distributionDerivation.ts).
   */
  lastEventId?: string;
  row: PreparedPopulationRow;
};

/** Per-employee quota bookkeeping used to resume deriveEmployeeQuotas incrementally (perf: fold-checkpoint). */
export type QuotaFacts = {
  assignmentCounts: Record<string, number>;
  firstAssignments: Record<string, DistributionEvent>;
  latestStoredQuotas: Record<string, DistributionEvent>;
};

/**
 * Persisted fold-acceleration checkpoint (perf). Lets loadOrDeriveDistributionCurrent
 * skip re-reading every distribution event file on a fresh page load -- it only
 * needs to read what has changed since this checkpoint was written. See
 * distributionStorage.ts's tryResumeFromCheckpoint for the read-and-verify path,
 * and distributionDerivation.ts's findLateEvent for the correctness guard that
 * forces a full refold instead of trusting this checkpoint when an
 * out-of-order event is detected.
 */
export type DistributionFoldCheckpoint = {
  /** Byte size already folded, per distribution.events/*.ndjson segment file name. */
  segmentOffsets: Record<string, number>;
  /** Names of legacy one-file-per-event *.json files already folded into this checkpoint. */
  legacyEventFileNames: string[];
  /** Every eventId already folded into this checkpoint (sorted). Used to id-diff the small compatibility-log file, and to extend eventSetId without re-reading every event file. */
  knownEventIds: string[];
  /** Quota accumulator state, resumable across checkpoint extensions. */
  quotaFacts: QuotaFacts;
  /** Fold/derive algorithm version this checkpoint was built with; a mismatch forces a full refold. */
  deriveVersion: number;
};

export type DistributionCurrentData = {
  monthFolderName: string;
  /** Revision of the DistributionLog this snapshot was derived from. Used to detect stale cache. */
  logRevision?: number;
  /** Version of deriveCurrentDistribution that produced this snapshot; missing or older than DERIVE_VERSION means stale. */
  deriveVersion?: number;
  /** Event-set identity used to validate this rebuildable cache. */
  eventSetId?: string;
  derivedAt: string;
  totalAssigned: number;
  totalCompleted: number;
  totalReplaced: number;
  totalPending: number;
  entries: DistributionEntry[];
  /** Daily quotas per employee, derived from assignment date through the monthly deadline. */
  quotas?: Record<string, EmployeeQuota>;
  /** Fold-checkpoint acceleration state (perf). Absent means the next load does a full refold. */
  foldCheckpoint?: DistributionFoldCheckpoint;
};
