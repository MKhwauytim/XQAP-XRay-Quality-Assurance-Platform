import type { EmployeeMirrorRowStub } from "../population/populationTypes";

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
  /**
   * Rows the employee currently owns: live (non-`replaced`) folded entries
   * assigned to them, NOT the number of `assigned` events they received (v3 /
   * P2 — see deriveEmployeeQuotasWithFacts).
   */
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
   * even when a compatibility-log writer lost a last-writer-wins race. Since
   * v85 this is a fixed-size commutative digest rather than a concatenation of
   * every id — see distributionEventSetIdFromIds.
   */
  eventSetId?: string;
  /**
   * IN MEMORY: every merged event (compatibility projection + immutable event
   * files/segments), which is what every consumer of a loaded `DistributionLog`
   * still gets.
   *
   * ON DISK (`distribution.log.json`): since v85 this is normally EMPTY. That
   * file is kept for its CAS stamp (`revision` + `_writeToken`, the
   * cross-machine commit protocol) and as the mirror-staleness authority read
   * by `readDistributionLogStamp` — but its event BODY was a duplicate of the
   * immutable `distribution.events/` segments, re-read and re-written on every
   * append. Appends now write a body-less stamp and keep only the residual
   * events that are NOT durable in the event store (i.e. those a pre-immutable
   * client wrote into the projection and nowhere else). Readers stay dual-read:
   * a legacy full-body log is still parsed and its events still folded.
   */
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
  /**
   * B5 (disk-bloat fix): new writes (`foldDistributionEvents` in
   * distributionDerivation.ts) only stamp `EMPLOYEE_MIRROR_STUB_FIELDS` here —
   * every field an employee-facing sample view actually renders — instead of
   * the full `PreparedPopulationRow`. This is what's inlined into
   * `distribution.current.json`, `main.samples.json`, and every
   * `{username}.samples.json` mirror; `xrayImageId` above is the join key back
   * to the full row in `population.final.json` / `sample.master.json` for
   * anything that needs more (replacement eligibility, reporting, etc — those
   * already load population/sample data separately, never through this field).
   *
   * Migration (B5/step 4): `EmployeeMirrorRowStub` is a strict subset (`Pick`)
   * of `PreparedPopulationRow`, so it's structurally satisfied by BOTH shapes —
   * an old on-disk entry that still carries the full inlined row reads back
   * fine here unchanged; only new writes are smaller. Never rewritten/migrated
   * in place.
   */
  row: EmployeeMirrorRowStub;
};

/** Per-employee quota bookkeeping used to resume deriveEmployeeQuotas incrementally (perf: fold-checkpoint). */
export type QuotaFacts = {
  /**
   * Raw non-excluded `assigned` event count per employee. Bookkeeping only
   * since v3 (P2): `EmployeeQuota.sampleCount` is derived from the folded
   * entries an employee actually still owns, because this counter cannot see a
   * reassignment or a replacement. Kept because it is part of the persisted
   * checkpoint shape and is a useful record of assignment volume.
   */
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
 *
 * STORAGE (v85): this is persisted in its OWN sidecar file,
 * `distribution.checkpoint.json`, next to `distribution.current.json` in the
 * month's `2-samples/{month}/1-main` folder — it used to be embedded in the
 * cache file itself, which made that (already multi-MB) file bigger for every
 * consumer that only ever wanted the entries. `eventSetId` below is what binds
 * the two files back together now that they can be written, restored, or
 * deleted independently.
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
  /**
   * Event-set digest of `knownEventIds` — identical to the `eventSetId` of the
   * `distribution.current.json` this checkpoint was written with.
   *
   * LOAD-BEARING for the sidecar split. While the checkpoint lived inside the
   * cache file the two could not disagree; as separate files they can (a
   * concurrent writer on an older build rewriting only the cache, a restore
   * that removed one and failed to remove the other, a half-landed write).
   * Resuming against a checkpoint whose `segmentOffsets` claim MORE has been
   * folded than the cache's entries actually reflect silently drops every event
   * in between, so the resume path refuses any sidecar whose digest does not
   * match the cache it is about to extend. Optional only so a legacy inline
   * checkpoint (read back out of an old `distribution.current.json`, where
   * consistency is structural) still type-checks.
   */
  eventSetId?: string;
};

export type DistributionCurrentData = {
  monthFolderName: string;
  /** Revision of the DistributionLog this snapshot was derived from. Used to detect stale cache. */
  logRevision?: number;
  /** Version of deriveCurrentDistribution that produced this snapshot; missing or older than DERIVE_VERSION means stale. */
  deriveVersion?: number;
  /** Event-set identity used to validate this rebuildable cache. */
  eventSetId?: string;
  /**
   * Identity of the `sampleRows` this snapshot was folded against (v4) — see
   * `sampleRowsFingerprint` in distributionLog.ts. Validated alongside
   * logRevision/eventSetId/deriveVersion before any cache is trusted, because
   * the row set can change (a replacement appends a row to
   * `sample.master.json`) while the event set does not. Optional only so a
   * pre-v4 snapshot still type-checks; absent reads as stale.
   */
  sampleRowsFingerprint?: string;
  derivedAt: string;
  totalAssigned: number;
  totalCompleted: number;
  totalReplaced: number;
  totalPending: number;
  entries: DistributionEntry[];
  /** Daily quotas per employee, derived from assignment date through the monthly deadline. */
  quotas?: Record<string, EmployeeQuota>;
  /**
   * Fold-checkpoint acceleration state (perf). Absent means the next load does
   * a full refold.
   *
   * IN MEMORY ONLY on the way out (v85): `saveDistributionCurrent` strips this
   * field before writing `distribution.current.json` and persists it to the
   * `distribution.checkpoint.json` sidecar instead. It is still POPULATED on
   * read — from the sidecar when one exists, otherwise from a legacy cache file
   * that still carries it inline — so in-memory consumers are unchanged.
   */
  foldCheckpoint?: DistributionFoldCheckpoint;
};
