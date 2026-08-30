// STAGE 1 OF `docs/architecture/ANSWER_SAVE_DELTA_PROPOSAL_2026-08-27.md` (rev 4).
//
// The answers-specific half of the append-only rewrite: the `AnswerEvent` type
// (§3), the ONE fold order (§4), the fold's business rules, the single-item
// fold the on-behalf append-then-confirm protocol needs (§5), and the
// `migration-seed` marker (§8). Every storage MECHANIC — segment naming,
// rotation, the per-writer-chain lock, the post-close verify, the event-set
// digest, the checkpoint resume/dedup contract, the late-event guard — comes
// from the generic `src/data/storage/appendOnlyEventLog.ts` (Stage 0) and is
// deliberately NOT re-derived here.
//
// THIS MODULE HAS ZERO PRODUCTION CALLERS ON PURPOSE. Stage 2 wires it into
// `answerStorage.ts`; until then nothing outside this file and its test imports
// it, so it can be reviewed and reverted on its own.
//
// The fold's business rules below are a faithful reproduction of what
// `answerStorage.ts` does TODAY (`upsertItemAnswer`, `upsertItemAnswerOnBehalf`,
// `reopenItemAnswer`, `setItemQualityNote`), not a redesign. Where today's
// behaviour is surprising it is reproduced anyway and flagged in a comment;
// changing it is a separate, visible decision, never a side effect of changing
// how answers are stored.

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  type AppendOnlyEventLogConfig,
  type AppendOnlyFoldCheckpoint,
  type CheckpointResumeVerdict,
  type FoldOrderComparison,
  type SegmentEventsDelta,
  type SegmentVerification,
  type SegmentWriterIdentity,
  appendEventSegment,
  checkpointResumeVerdict,
  eventSetDigest,
  filterAlreadyFolded,
  isEventOutOfOrder,
  readEventSegmentDelta,
  segmentFileName,
  sortEventsForFold,
} from "../storage/appendOnlyEventLog";
import type {
  EmployeeAnswerFile,
  FieldAnswer,
  ItemAnswer,
  ItemAnswerHistoryEntry,
  ItemAnswerStatus,
  ItemValueHistoryEntry,
} from "./answerTypes";

/* ─────────────────────────────── the event ──────────────────────────────── */

export type AnswerEventType =
  | "item-saved"
  | "item-reopened"
  | "quality-note-set"
  | "migration-seed";

/**
 * TIE-BREAK ONLY, at exactly equal `eventAt` — never a primary ranking (§4).
 *
 * An earlier draft of the proposal made this the PRIMARY sort key and would
 * have broken the reopen→correct workflow, the app's core correction loop:
 * `reopenItemAnswer` is itself supervisor-authored, so a supervisor-first order
 * makes every reopen permanently outrank the employee fix it exists to invite.
 * It also contradicts `upsertItemAnswerOnBehalf`'s own docblock and
 * `answerOnBehalf.test.ts` ("the assignee may still overwrite their OWN
 * submitted answer"). Demoted to a same-instant tie-break, it reproduces
 * today's real last-write-wins behaviour in every case that matters.
 */
export type AnswerEventAuthority = "self" | "supervisor";

/**
 * One durable, immutable fact about one employee's answers for one month.
 *
 * `eventId` is STABLE PER USER ACTION, not a fresh uuid per attempt (§3): a
 * retried append after an ambiguous failure must be a detectable duplicate
 * rather than a silent replay. `filterAlreadyFolded` and the fold's own
 * first-seen dedup below are what make that detectable-ness cost nothing.
 *
 * FIELDS BEYOND §3's LISTING, and why they are here. §3 lists the fields the
 * proposal's prose reasons about; it is not a complete serialization of an
 * `ItemAnswer`, and the fold's output is `EmployeeAnswerFile`-shaped, so the
 * event has to be able to carry the item metadata `ItemAnswer` requires and
 * §3 does not name (`templateId`, `templateVersion`, `lastSavedAt`,
 * `submittedAt`), the `reason` string both oversight history entries require
 * (`ItemAnswerHistoryEntry.reason`), and §8's `migration-seed` payload
 * (`legacyContentHash`; §8's `at` is `eventAt`). All are optional and every one
 * has a defined fallback in the fold, so an event written by a client that
 * omits them still folds. This is a documented widening of §3, flagged for
 * ratification before Stage 2 wires a writer.
 */
export type AnswerEvent = {
  /** Stable per user action — see above. */
  eventId: string;
  eventType: AnswerEventType;
  eventAt: string;
  eventBy: string;
  /** Tie-break ONLY at exactly equal `eventAt` (§4). */
  authority: AnswerEventAuthority;
  /** Absent only for `migration-seed`. */
  xrayImageId?: string;
  answers?: FieldAnswer[];
  status?: ItemAnswerStatus;
  /** The ASSIGNEE — the `${xrayImageId}::${assignedTo}` join key, never the actor. */
  answeredBy?: string;
  /** The REAL author, when that is not the assignee (on-behalf). */
  answeredOnBehalfBy?: string;
  qualityNote?: string;
  eventSchemaVersion?: number;

  /* — beyond §3's listing; see the type's docblock — */
  templateId?: string;
  templateVersion?: number;
  lastSavedAt?: string;
  submittedAt?: string | null;
  /** Reason text for the `reopened` / `answered-on-behalf` history entry. */
  reason?: string;
  /**
   * §8: content hash of the frozen legacy `{username}.answers.json` this
   * employee's segment chain was seeded from. An empty string means "this
   * employee had no legacy file at migration time" — a real case (a brand-new
   * employee still needs the marker, or §8's no-marker rule would reject their
   * chain), and the only one that seeds from nothing rather than refusing.
   */
  legacyContentHash?: string;
};

export const ANSWER_EVENT_SCHEMA_VERSION = 1;

/* ──────────────────────────── storage binding ───────────────────────────── */

/** Child of `2-samples/{month}/` that holds every employee's segments (§3: ONE flat per-month directory). */
export const ANSWER_EVENTS_DIR = "answers.events";
export const ANSWER_EVENT_SEGMENT_SUFFIX = ".ndjson";

/**
 * §3's `{sortableTimePrefix}` — minutes since the epoch in base 36.
 *
 * It exists so §6's read-only bounded (top-N by name) directory signature never
 * evicts an ongoing session's most recent appends. Minutes, not milliseconds,
 * because every character in a segment name is a correctness cost on a deep UNC
 * path (see `appendOnlyEventLog`'s SHORT NAMES note and XQ-IO-031): 5 characters
 * today, 6 from ~2084, against a 27-character budget that the full base name
 * (`{time}-ans-{deviceHash}-{sessionHash}` = 25) already fits inside. Segments
 * written in the same minute simply sort by their writer hashes, which is
 * deterministic and is all the signal the top-N listing needs.
 */
export function answerSegmentTimePrefix(nowMs: number = Date.now()): string {
  return Math.floor(nowMs / 60_000).toString(36);
}

/**
 * Answers' binding of the generic append-only event log.
 *
 * `consumerNamespace: "ans"` is the load-bearing part: it keeps the generic
 * module's module-level writer memos (`writtenSegmentsThisSession`,
 * `openSegmentSeqByWriter`) private to answers now that distribution shares the
 * same module in the same tab — without it, answers' genuinely-first append of a
 * session would see distribution's entry, take the patient ~11 s ladder on a
 * `NotFoundError` that is simply the correct answer, and resume at a sequence
 * number that does not exist in its own directory (which §8's "earliest segment
 * in the writer's chain" marker rule depends on not happening).
 *
 * DIAGNOSTICS CODES ARE ANSWERS' OWN, registered in `errorCodes.ts`'s `ANS`
 * area with their own Arabic user-facing text in `labelsStore.ts` (Stage 2 —
 * `XQ-ANS-001/002/003`, mirroring distribution's `XQ-DIST-006/007/008`
 * one-for-one by failure mode). Stage 1 borrowed the distribution codes as
 * placeholders here since this module had no callers yet; Stage 2 wired a
 * writer and switched these over.
 */
export function buildAnswerEventLogConfig(nowMs?: number): AppendOnlyEventLogConfig {
  return {
    consumerNamespace: "ans",
    eventsDirName: ANSWER_EVENTS_DIR,
    segmentSuffix: ANSWER_EVENT_SEGMENT_SUFFIX,
    baseNamePrefix: `${answerSegmentTimePrefix(nowMs)}-ans`,
    diagnostics: {
      writeContext: "answers:append-segment",
      rereadContext: "answers:segment-reread",
      verifyContext: "answers:segment-verify",
      cannotWriteCode: "XQ-ANS-001",
      unverifiedCode: "XQ-ANS-002",
      sizeMismatchCode: "XQ-ANS-003",
      segmentParseError: (segmentName) => `Cannot parse answer event segment: ${segmentName}`,
      verificationFailedError: (fileName, expectedBytes, observedBytes) =>
        `Answer event segment write verification failed: ${fileName} ` +
        `(expected ${expectedBytes} bytes, saw ${observedBytes})`,
    },
  };
}

/**
 * Session-stable config. Built once at module load, matching the app-session
 * lifetime of the writer session id it shares a segment name with — a prefix
 * that changed mid-session would fragment one writer's chain across names.
 */
export const ANSWER_EVENT_LOG: AppendOnlyEventLogConfig = buildAnswerEventLogConfig();

/** Segment file name for one writer chain — thin adapter, for tests and diagnostics. */
export function answerSegmentFileName(
  writer: Pick<SegmentWriterIdentity, "deviceId" | "sessionId">,
  seq = 0,
  config: AppendOnlyEventLogConfig = ANSWER_EVENT_LOG
): string {
  return segmentFileName(config, writer, seq);
}

/** Append a batch to this writer session's open segment under `{parentDir}/answers.events/`. */
export async function appendAnswerEventSegment(
  parentDir: DirectoryHandleLike,
  events: AnswerEvent[],
  writer: SegmentWriterIdentity,
  config: AppendOnlyEventLogConfig = ANSWER_EVENT_LOG
): Promise<SegmentVerification> {
  return appendEventSegment<AnswerEvent>(parentDir, events, writer, config);
}

/** Read only the lines appended past each segment's already-folded byte offset. */
export async function readAnswerEventDelta(
  parentDir: DirectoryHandleLike,
  knownOffsets: Record<string, number>,
  config: AppendOnlyEventLogConfig = ANSWER_EVENT_LOG
): Promise<SegmentEventsDelta<AnswerEvent>> {
  return readEventSegmentDelta<AnswerEvent>(parentDir, knownOffsets, config);
}

/* ───────────────────────── the ONE fold order (§4) ──────────────────────── */

/**
 * `(eventAt, authority, eventId)`.
 *
 * `eventAt` is the PRIMARY total order — it is what today's five cross-user
 * write paths already resolve to (last write wins) and what
 * `distributionDerivation`'s `isEventEarlierThanEntry` uses. `authority` only
 * separates two events stamped at exactly the same instant, where no timestamp
 * comparison can decide and one of them is a genuine same-instant race between
 * a supervisor and the assignee; `supervisor` sorts LAST, i.e. wins, because
 * the fold is last-write-wins. `eventId` remains the final tie-break so the
 * order is total and two clients always agree.
 *
 * There is exactly ONE comparator in this module, and both the fold and the
 * late-event guard take it (round 3's Gap 1b: a guard that orders differently
 * from the fold it guards is not a guard). Everything below compares through
 * `compareAnswerFoldOrderKeys`.
 */
type AnswerFoldOrderKey = {
  eventAt: string;
  authority: AnswerEventAuthority;
  eventId: string;
};

function authorityRank(authority: AnswerEventAuthority): number {
  return authority === "supervisor" ? 1 : 0;
}

function compareAnswerFoldOrderKeys(left: AnswerFoldOrderKey, right: AnswerFoldOrderKey): number {
  const byTime = left.eventAt.localeCompare(right.eventAt);
  if (byTime !== 0) return byTime;
  const byAuthority = authorityRank(left.authority) - authorityRank(right.authority);
  if (byAuthority !== 0) return byAuthority;
  return left.eventId.localeCompare(right.eventId);
}

function foldOrderKeyOf(event: AnswerEvent): AnswerFoldOrderKey {
  return { eventAt: event.eventAt, authority: event.authority, eventId: event.eventId };
}

/** The one comparator. Negative when `left` folds BEFORE `right`. */
export function compareAnswerEventsForFold(left: AnswerEvent, right: AnswerEvent): number {
  return compareAnswerFoldOrderKeys(foldOrderKeyOf(left), foldOrderKeyOf(right));
}

/** Sort a batch into fold order (mutates and returns, matching `Array#sort`). */
export function sortAnswerEventsForFold<T extends AnswerEvent>(events: T[]): T[] {
  return sortEventsForFold(events, compareAnswerEventsForFold);
}

/* ───────────────────── event-set digest + checkpoint (§1) ───────────────── */

/**
 * One-line adapter over the generic, deliberately non-parameterized
 * `eventSetDigest` — the SAME function distribution uses. Not reimplemented:
 * a second, wrong-but-plausible digest could be non-commutative and would
 * silently break the cache-validity binding that depends on it.
 */
export function answerEventSetIdFromIds(ids: Iterable<string>): string {
  return eventSetDigest(ids);
}

export function answerEventSetId(events: readonly AnswerEvent[]): string {
  return answerEventSetIdFromIds(events.map((event) => event.eventId));
}

/**
 * Fold algorithm version for the answers consumer. Bump on any deliberate
 * change to the fold's semantics below — it is how a checkpoint written by an
 * older build is recognized as non-resumable (`checkpointResumeVerdict`
 * rejects it, costing one full refold, which self-heals).
 */
export const ANSWER_DERIVE_VERSION = 1;

/**
 * Extends the generic checkpoint with `seeded` — the generic shape has no
 * concept of a migration marker, but §8's fold requires it: without it, a
 * checkpoint reconstructed from disk (as opposed to an in-memory
 * `AnswerFoldResult` still held in a session) would default `seeded` to
 * false, and the very next incremental fold would hit the "no migration-seed
 * marker" hard-failure path even though the chain was already validly seeded
 * — a spurious "this employee has no answers" false negative one read after
 * the first checkpoint. Persisting it here is what makes a checkpoint
 * genuinely resumable across a page reload, not just within one session.
 */
export type AnswerFoldCheckpoint = AppendOnlyFoldCheckpoint & { seeded: boolean };

/** May this checkpoint be resumed against a cache with `expectedEventSetId`? */
export function answerCheckpointResumeVerdict(
  checkpoint: Pick<AnswerFoldCheckpoint, "deriveVersion" | "eventSetId">,
  expectedEventSetId: string | undefined
): CheckpointResumeVerdict {
  return checkpointResumeVerdict(checkpoint, {
    deriveVersion: ANSWER_DERIVE_VERSION,
    eventSetId: expectedEventSetId,
  });
}

/** Drop events a checkpoint has already folded — dedup ACROSS the checkpoint boundary. */
export function filterAlreadyFoldedAnswerEvents(
  events: Iterable<AnswerEvent>,
  knownEventIds: Iterable<string>
): AnswerEvent[] {
  return filterAlreadyFolded(events, knownEventIds, (event) => event.eventId);
}

/** Checkpoint for a fold result, to be persisted alongside the folded cache. */
export function buildAnswerFoldCheckpoint(
  result: AnswerFoldResult,
  segmentOffsets: Record<string, number>
): AnswerFoldCheckpoint {
  return {
    segmentOffsets: { ...segmentOffsets },
    knownEventIds: [...result.foldedEventIds],
    deriveVersion: ANSWER_DERIVE_VERSION,
    eventSetId: result.eventSetId,
    seeded: result.seeded,
  };
}

/* ───────────────────────── late-event detection (§1) ────────────────────── */

/**
 * Per-item record of the last event folded for it — the marker the late-event
 * guard orders against. Both optional fields are what an older checkpoint
 * format may lack; their absence is treated as UNKNOWN order, which the generic
 * `isEventOutOfOrder` conservatively calls late.
 */
export type AnswerFoldMarker = {
  lastEventAt: string;
  lastEventId?: string;
  lastAuthority?: AnswerEventAuthority;
};

function compareAnswerEventToMarker(
  event: AnswerEvent,
  marker: AnswerFoldMarker
): FoldOrderComparison {
  if (!marker.lastEventId || !marker.lastAuthority) return "unknown";
  return compareAnswerFoldOrderKeys(foldOrderKeyOf(event), {
    eventAt: marker.lastEventAt,
    authority: marker.lastAuthority,
    eventId: marker.lastEventId,
  });
}

/**
 * Does `event` sort BEFORE what the marker says was already folded for its item?
 *
 * A `true` answer obliges the caller to DISCARD the checkpoint and refold
 * everything from scratch — never to patch in place. The fold is not
 * commutative (an on-behalf save is refused or accepted depending on the status
 * it lands on), so absorbing a late event onto a resumed accumulator can
 * produce state no full fold would ever produce.
 */
export function isAnswerEventOutOfOrder(
  event: AnswerEvent,
  marker: AnswerFoldMarker | undefined | null
): boolean {
  return isEventOutOfOrder(event, marker, compareAnswerEventToMarker);
}

/** First late event in `events`, or null when the batch is safe to fold on top. */
export function findLateAnswerEvent(
  markers: Readonly<Record<string, AnswerFoldMarker>>,
  events: readonly AnswerEvent[]
): AnswerEvent | null {
  for (const event of events) {
    if (!event.xrayImageId) continue;
    if (isAnswerEventOutOfOrder(event, markers[event.xrayImageId])) return event;
  }
  return null;
}

/* ────────────────────── fold business rules (from answerStorage) ─────────── */

/**
 * MUST stay equal to `VALUE_HISTORY_CAP` in `answerStorage.ts`. Duplicated
 * rather than imported so this module keeps no production dependency on the
 * legacy storage module (Stage 2 makes the dependency run the other way, and a
 * cycle through `safeWrite.ts` is a documented hazard in this repo). The test
 * asserts the two are equal, so drift fails the suite rather than shipping.
 */
export const ANSWER_VALUE_HISTORY_CAP = 20;

/**
 * `appendValueHistory` from `answerStorage.ts`, verbatim: on overflow the
 * first/original entry is always preserved and only the middle is pruned.
 *
 * The CAP APPLIES TO THE FOLD OUTPUT ONLY (§5). The segments are the uncapped
 * source of truth — every `item-saved` line stays on disk forever — and this
 * bounds what the served `ItemAnswer` carries, exactly as the legacy file did.
 */
function appendValueHistory(
  existing: ItemValueHistoryEntry[] | undefined,
  entry: ItemValueHistoryEntry
): ItemValueHistoryEntry[] {
  const list = [...(existing ?? []), entry];
  if (list.length <= ANSWER_VALUE_HISTORY_CAP) return list;
  const first = list[0]!;
  const tail = list.slice(list.length - (ANSWER_VALUE_HISTORY_CAP - 1));
  return [first, ...tail];
}

/** `changeReason` from `answerStorage.ts`: a save onto a reopened draft is a correction. */
function changeReason(previous: ItemAnswer): ItemValueHistoryEntry["reason"] {
  const wasReopened =
    previous.status === "draft" &&
    (previous.history?.some((entry) => entry.action === "reopened") ?? false);
  return wasReopened ? "reopen-correction" : "save";
}

/**
 * `withValueHistory` from `answerStorage.ts`, with ONE deliberate difference:
 * `changedAt` is `event.eventAt`, never `new Date()`.
 *
 * That is not a style choice. A fold must be a pure function of its event
 * bytes — two clients folding the same segments, and one client folding the
 * same segments twice, have to produce identical output, or the cache-validity
 * digest and every cross-machine comparison built on it become noise. Reading
 * the clock inside the fold was a real defect an earlier design round found.
 */
function withValueHistory(
  previous: ItemAnswer | undefined,
  next: ItemAnswer,
  eventAt: string
): ItemAnswer {
  if (!previous) return { ...next, valueHistory: undefined };
  const entry: ItemValueHistoryEntry = {
    changedAt: eventAt,
    // The real author, not the file owner — `answeredBy` is pinned to the
    // assignee, so on an on-behalf write it would attribute the supervisor's
    // edit to the assignee.
    changedBy: next.answeredOnBehalfBy ?? next.answeredBy,
    reason: changeReason(previous),
    previous: {
      answers: previous.answers,
      status: previous.status,
      submittedAt: previous.submittedAt,
      lastSavedAt: previous.lastSavedAt,
    },
  };
  return { ...next, valueHistory: appendValueHistory(previous.valueHistory, entry) };
}

/** `sameUser` from `answerStorage.ts` — comparison only, never used to build a name. */
function sameUser(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * The item an `item-saved` event describes, before history folding.
 *
 * Fallbacks exist for every field §3's event does not name, so an event written
 * by a client that omits them still folds deterministically: metadata falls back
 * to the stored predecessor, then to a neutral default; timestamps fall back to
 * `eventAt` (never to the clock).
 *
 * `qualityNote` is taken from the EVENT, not carried over from `previous` —
 * faithful to today: `XrayReferrals.handleSave` builds a fresh `ItemAnswer` with
 * no `qualityNote`, so an employee save already clears a supervisor's coaching
 * note through `upsertItemAnswer`. Reproduced deliberately; if that is to change
 * it should change visibly, as its own decision, not as a side effect of this
 * rewrite.
 */
function itemFromSavedEvent(
  event: AnswerEvent,
  previous: ItemAnswer | undefined,
  fileUsername: string
): ItemAnswer {
  const status: ItemAnswerStatus = event.status ?? previous?.status ?? "draft";
  const submittedAt =
    event.submittedAt !== undefined
      ? event.submittedAt
      : status === "submitted"
        ? event.eventAt
        : null;
  return {
    xrayImageId: event.xrayImageId!,
    templateId: event.templateId ?? previous?.templateId ?? "",
    templateVersion: event.templateVersion ?? previous?.templateVersion ?? 0,
    answers: event.answers ?? [],
    lastSavedAt: event.lastSavedAt ?? event.eventAt,
    submittedAt,
    // The ASSIGNEE, defensively — the `${xrayImageId}::${assignedTo}` join key.
    answeredBy: event.answeredBy ?? previous?.answeredBy ?? (fileUsername || event.eventBy),
    status,
    qualityNote: event.qualityNote,
  };
}

/* ─────────────────────────────── the fold ───────────────────────────────── */

/** Why a folded event produced no state change. */
export type AnswerFoldRefusal = {
  eventId: string;
  xrayImageId: string;
  reason: "on-behalf-already-submitted";
};

/** Why an input event was not folded at all. */
export type AnswerFoldDrop = {
  eventId: string;
  reason: "already-folded" | "duplicate-event-id" | "unrecognized-type" | "missing-xray-image-id";
};

/** The frozen legacy `{username}.answers.json` a `migration-seed` names (§8). */
export type AnswerLegacySeed = {
  /** Must equal the seed event's `legacyContentHash`. */
  contentHash: string;
  items: readonly ItemAnswer[];
};

export type FoldAnswerEventsOptions = {
  /** Prior fold to resume onto. Its `foldedEventIds` are the dedup boundary. */
  resume?: AnswerFoldResult;
  /** Legacy snapshot the `migration-seed` event names (§8). */
  legacySeed?: AnswerLegacySeed;
  username?: string;
  monthFolderName?: string;
  /**
   * §8's hard-failure rule: events present with no `migration-seed` anywhere in
   * the chain is pre-migration rollback residue or a corrupted first segment,
   * and is a read FAILURE, not something to guess at (§10 defines no
   * corrupt-segment recovery beyond throw). Defaults to true; `foldSingleItem`
   * turns it off because it folds a caller-narrowed slice, not a whole chain.
   */
  requireMigrationSeed?: boolean;
};

export type AnswerFoldResult = {
  /** `EmployeeAnswerFile`-shaped item state. Request queues are §7's separate file. */
  file: EmployeeAnswerFile;
  /** Last folded event per `xrayImageId` — the late-event guard's markers. */
  markers: Record<string, AnswerFoldMarker>;
  /** Whether a `migration-seed` has been consumed for this chain. */
  seeded: boolean;
  /** Every event id consumed, sorted — a checkpoint's `knownEventIds`. */
  foldedEventIds: string[];
  eventSetId: string;
  deriveVersion: number;
  refusals: AnswerFoldRefusal[];
  dropped: AnswerFoldDrop[];
};

/**
 * A fold that cannot proceed: a chain with events but no `migration-seed`
 * marker, or a marker whose named legacy content is missing or does not match
 * (§8). Exported so Stage 2's read path can tell "this chain is unreadable"
 * apart from an I/O failure — and, per §10 and the P0-1 "unreadable never
 * becomes empty" contract, so that neither is ever turned into empty state.
 */
export type AnswerFoldErrorReason = "missing-migration-seed" | "legacy-seed-hash-mismatch";

export class AnswerFoldError extends Error {
  /**
   * Which of the two hard-failure rules this is (§8/§10) — a real
   * discriminant for a caller that needs to tell them apart (Stage 2's
   * `XQ-ANS-005` vs `XQ-ANS-006` classification in `answerStorage.ts`),
   * added so that classification does not have to match on `message` text.
   */
  readonly reason: AnswerFoldErrorReason;

  constructor(message: string, reason: AnswerFoldErrorReason) {
    super(message);
    this.name = "AnswerFoldError";
    this.reason = reason;
  }
}

/** Seed items from the legacy snapshot a `migration-seed` names — exactly once (§8). */
function seedItemsFromLegacy(
  event: AnswerEvent,
  legacySeed: AnswerLegacySeed | undefined
): ItemAnswer[] {
  const hash = event.legacyContentHash ?? "";
  // No legacy file existed for this employee at migration time. The marker is
  // still required (it is what proves the chain is post-migration); it just
  // seeds nothing.
  if (hash === "") return [];
  if (!legacySeed) {
    throw new AnswerFoldError(
      `Answer migration-seed ${event.eventId} names legacy content ${hash}, ` +
        `but no legacy snapshot was supplied to the fold.`,
      "legacy-seed-hash-mismatch"
    );
  }
  if (legacySeed.contentHash !== hash) {
    // Refuse rather than merge: a legacy file that diverged after migration is
    // exactly §9's rollback residue, and folding segments onto it would produce
    // state no single writer ever wrote.
    throw new AnswerFoldError(
      `Answer migration-seed ${event.eventId} names legacy content ${hash}, ` +
        `but the supplied legacy snapshot hashes to ${legacySeed.contentHash}.`,
      "legacy-seed-hash-mismatch"
    );
  }
  return legacySeed.items.map((item) => ({ ...item }));
}

/** `upsertItemAnswer`'s fold step: strip on-behalf, take history from the predecessor, snapshot A4. */
function foldSelfSave(
  event: AnswerEvent,
  previous: ItemAnswer | undefined,
  fileUsername: string
): ItemAnswer {
  const next: ItemAnswer = {
    ...itemFromSavedEvent(event, previous, fileUsername),
    // `stripOnBehalf`: the field always describes the answers currently stored.
    answeredOnBehalfBy: undefined,
    // `withStoredHistory`: the oversight trail comes from the STORED
    // predecessor, never from the incoming item, so a client cannot rewrite it —
    // and so an ordinary re-save does not erase the reopen / on-behalf record.
    history: previous?.history,
  };
  return withValueHistory(previous, next, event.eventAt);
}

/** `upsertItemAnswerOnBehalf`'s fold step, including its refusal precondition. */
function foldOnBehalfSave(
  event: AnswerEvent,
  previous: ItemAnswer | undefined,
  assignee: string,
  author: string
): ItemAnswer | { refused: true } {
  // ONLY AN UNANSWERED ITEM MAY BE ANSWERED ON BEHALF. The test is the STATUS,
  // not mere existence: an item a reopen flipped back to "draft" is by
  // definition no longer submitted and becomes answerable on behalf again,
  // which is exactly the correction route.
  if (previous?.status === "submitted") return { refused: true };
  const historyEntry: ItemAnswerHistoryEntry = {
    action: "answered-on-behalf",
    at: event.eventAt,
    by: author,
    reason: event.reason ?? "",
    previousSubmittedAt: previous?.submittedAt ?? null,
    onBehalfOf: assignee,
  };
  const next: ItemAnswer = {
    ...itemFromSavedEvent(event, previous, assignee),
    answeredBy: assignee,
    answeredOnBehalfBy: author,
    history: [...(previous?.history ?? []), historyEntry],
  };
  return withValueHistory(previous, next, event.eventAt);
}

/** `reopenItemAnswer`'s fold step. Idempotent no-op when missing or not submitted. */
function foldReopen(event: AnswerEvent, previous: ItemAnswer | undefined): ItemAnswer | undefined {
  if (!previous || previous.status !== "submitted") return undefined;
  const historyEntry: ItemAnswerHistoryEntry = {
    action: "reopened",
    at: event.eventAt,
    by: event.eventBy,
    reason: event.reason ?? "",
    previousSubmittedAt: previous.submittedAt,
  };
  // No A4 snapshot: `reopenItemAnswer` maps the item in place and does not go
  // through `upsertItemInFile`, so it records no valueHistory entry today.
  return {
    ...previous,
    status: "draft",
    submittedAt: null,
    history: [...(previous.history ?? []), historyEntry],
  };
}

/** `setItemQualityNote`'s fold step. Idempotent no-op when the item does not exist yet. */
function foldQualityNote(
  event: AnswerEvent,
  previous: ItemAnswer | undefined
): ItemAnswer | undefined {
  if (!previous) return undefined;
  const trimmed = (event.qualityNote ?? "").trim();
  return { ...previous, qualityNote: trimmed.length > 0 ? trimmed : undefined };
}

/**
 * Replay `events` onto an `EmployeeAnswerFile`-shaped accumulator.
 *
 * PURE — no I/O, no clock, no randomness. Two folds of identical event bytes
 * produce byte-identical output; that is what the checkpoint digest, the
 * cross-machine cache comparison and `foldSingleItem`'s consistency guarantee
 * all rest on.
 *
 * Order of operations:
 *  1. dedup — against the resumed checkpoint's `knownEventIds` (the generic
 *     `filterAlreadyFolded`) and against the batch itself, so an id is absorbed
 *     exactly once. `eventId` is stable per user action by design, so a retried
 *     append after an ambiguous failure is a real duplicate, not a new event.
 *     Content resolution for a repeated id is the generic module's and is left
 *     alone: first-seen order, last copy's content. Same-id-DIFFERENT-content is
 *     out of contract — §8a makes it a merge error the backup layer must
 *     detect, not something a fold silently arbitrates.
 *  2. sort by the ONE comparator (§4).
 *  3. apply the `migration-seed` (§8) as the INITIAL STATE, before any other
 *     event — it is the chain's baseline, not a step in its timeline.
 *  4. replay the rest in fold order.
 *
 * Item array order reproduces `answerStorage.ts` exactly: a save moves its item
 * to the END of the array (`upsertItemInFile`'s `[...others, item]`), while a
 * reopen or a quality-note edits in place (`file.items.map`).
 */
export function foldAnswerEvents(
  events: readonly AnswerEvent[],
  options: FoldAnswerEventsOptions = {}
): AnswerFoldResult {
  const { resume, legacySeed, requireMigrationSeed = true } = options;
  const username = options.username ?? resume?.file.username ?? "";
  const monthFolderName = options.monthFolderName ?? resume?.file.monthFolderName ?? "";

  const items = new Map<string, ItemAnswer>(
    (resume?.file.items ?? []).map((item) => [item.xrayImageId, item])
  );
  const markers = new Map<string, AnswerFoldMarker>(Object.entries(resume?.markers ?? {}));
  const foldedIds = new Set<string>(resume?.foldedEventIds ?? []);
  const refusals: AnswerFoldRefusal[] = [];
  const dropped: AnswerFoldDrop[] = [];
  let seeded = resume?.seeded ?? false;

  // 1. dedup, and record why anything was dropped.
  const fresh = filterAlreadyFoldedAnswerEvents(events, foldedIds);
  const seenInBatch = new Set<string>();
  for (const event of events) {
    if (foldedIds.has(event.eventId)) {
      dropped.push({ eventId: event.eventId, reason: "already-folded" });
      continue;
    }
    if (seenInBatch.has(event.eventId)) {
      dropped.push({ eventId: event.eventId, reason: "duplicate-event-id" });
      continue;
    }
    seenInBatch.add(event.eventId);
  }

  // 2. one comparator, one order.
  const ordered = sortAnswerEventsForFold([...fresh]);

  // 3. the migration marker (§8).
  if (!seeded) {
    const seedEvent = ordered.find((event) => event.eventType === "migration-seed");
    if (seedEvent) {
      for (const item of seedItemsFromLegacy(seedEvent, legacySeed)) {
        items.set(item.xrayImageId, item);
      }
      seeded = true;
    } else if (requireMigrationSeed && ordered.length > 0) {
      throw new AnswerFoldError(
        `Answer event segments contain ${ordered.length} event(s) but no migration-seed marker. ` +
          `This is pre-migration rollback residue or a corrupted first segment — refusing to guess ` +
          `at the missing baseline (proposal §8/§10).`,
        "missing-migration-seed"
      );
    }
  }

  // 4. replay.
  for (const event of ordered) {
    foldedIds.add(event.eventId);
    if (event.eventType === "migration-seed") continue; // already applied as the baseline
    const xrayImageId = event.xrayImageId;
    if (!xrayImageId) {
      dropped.push({ eventId: event.eventId, reason: "missing-xray-image-id" });
      continue;
    }
    const previous = items.get(xrayImageId);
    const applied = applyAnswerEvent(event, previous, username, xrayImageId, refusals);
    if (applied === "unrecognized") {
      dropped.push({ eventId: event.eventId, reason: "unrecognized-type" });
      continue;
    }
    // Marker first, and for every RECOGNIZED event — including a no-op reopen
    // and a refused on-behalf save. Both were genuinely folded, and a later
    // event arriving before them would change their outcome under a full
    // refold, so the guard must see them.
    markers.set(xrayImageId, {
      lastEventAt: event.eventAt,
      lastEventId: event.eventId,
      lastAuthority: event.authority,
    });
    if (applied === undefined) continue; // idempotent no-op — state unchanged
    if (event.eventType === "item-saved") {
      // `upsertItemInFile`: the saved item moves to the end of the array.
      items.delete(xrayImageId);
    }
    items.set(xrayImageId, applied);
  }

  const foldedEventIds = [...foldedIds].sort();
  return {
    file: { username, monthFolderName, items: [...items.values()] },
    markers: Object.fromEntries(markers),
    seeded,
    foldedEventIds,
    eventSetId: answerEventSetIdFromIds(foldedEventIds),
    deriveVersion: ANSWER_DERIVE_VERSION,
    refusals,
    dropped,
  };
}

/**
 * One event's business rule. Returns the next item, `undefined` for an
 * idempotent no-op, or `"unrecognized"` for an event type this build does not
 * know (a newer client's forward-compatible write — reported, never fatal;
 * §10's throw policy is about corrupt BYTES, not unknown types).
 */
function applyAnswerEvent(
  event: AnswerEvent,
  previous: ItemAnswer | undefined,
  fileUsername: string,
  xrayImageId: string,
  refusals: AnswerFoldRefusal[]
): ItemAnswer | undefined | "unrecognized" {
  switch (event.eventType) {
    case "item-saved": {
      const author = (event.answeredOnBehalfBy ?? "").trim();
      const assignee = event.answeredBy ?? fileUsername;
      // `author === assignee` is NOT on-behalf — it is a self-answer that
      // arrived through the supervisor UI, recorded as one (no attribution
      // field, no history entry), exactly as `upsertItemAnswerOnBehalf` does.
      if (author === "" || sameUser(author, assignee)) {
        return foldSelfSave(event, previous, fileUsername);
      }
      const onBehalf = foldOnBehalfSave(event, previous, assignee, author);
      if ("refused" in onBehalf) {
        refusals.push({ eventId: event.eventId, xrayImageId, reason: "on-behalf-already-submitted" });
        return undefined;
      }
      return onBehalf;
    }
    case "item-reopened":
      return foldReopen(event, previous);
    case "quality-note-set":
      return foldQualityNote(event, previous);
    default:
      return "unrecognized";
  }
}

/**
 * §5's cheap single-item fold, for the on-behalf append-then-confirm protocol.
 *
 * Replays only this image's events (small by construction — an item accumulates
 * at most a handful of save/reopen/note events per month) through the EXACT
 * same code path as the full fold, so its answer is by construction what a full
 * fold would produce for that item: same comparator, same business rules, same
 * seeding. `migration-seed` events are kept in the slice because the seed is the
 * item's baseline; a supplied `legacySeed` is narrowed to the same item, which
 * leaves its `contentHash` intact so §8's hash check still applies.
 *
 * `requireMigrationSeed` defaults to FALSE here: the caller is confirming its
 * own just-appended event against a slice it narrowed itself, not reading a
 * whole chain, so §8's "no marker in the chain" failure is not its question to
 * answer.
 */
export function foldSingleItem(
  events: readonly AnswerEvent[],
  xrayImageId: string,
  options: FoldAnswerEventsOptions = {}
): ItemAnswer | undefined {
  const scoped = events.filter(
    (event) => event.eventType === "migration-seed" || event.xrayImageId === xrayImageId
  );
  const legacySeed = options.legacySeed
    ? {
        contentHash: options.legacySeed.contentHash,
        items: options.legacySeed.items.filter((item) => item.xrayImageId === xrayImageId),
      }
    : undefined;
  const resume = options.resume
    ? {
        ...options.resume,
        file: {
          ...options.resume.file,
          items: options.resume.file.items.filter((item) => item.xrayImageId === xrayImageId),
        },
      }
    : undefined;
  const result = foldAnswerEvents(scoped, {
    ...options,
    resume,
    legacySeed,
    requireMigrationSeed: options.requireMigrationSeed ?? false,
  });
  return result.file.items.find((item) => item.xrayImageId === xrayImageId);
}
