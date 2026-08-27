import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { readJsonDirectory } from "../storage/directoryScan";
import { logCodedError } from "../storage/errorCodes";
import {
  isNotFoundError,
  isNotReadableError,
} from "../storage/transientFileErrors";
import {
  MAX_OPEN_SEGMENT_BYTES,
  MAX_OPEN_SEGMENT_LINES,
  type AppendOnlyEventLogConfig,
  type SegmentEventsDelta as GenericSegmentEventsDelta,
  type SegmentVerification as GenericSegmentVerification,
  __resetAppendOnlyEventLogMemosForTests,
  appendEventSegment,
  chunkEventsForSegmentAppends as chunkForSegmentAppends,
  eventSetDigest,
  readEventSegmentDelta,
  segmentFileName,
  sortEventsForFold,
} from "../storage/appendOnlyEventLog";
import type { DistributionEvent } from "./distributionTypes";

export const DISTRIBUTION_EVENTS_DIR = "distribution.events";
/** Per-writer-session append-only segment file suffix (perf: replaces one-file-per-event durability). */
export const DISTRIBUTION_EVENT_SEGMENT_SUFFIX = ".ndjson";

/**
 * Distribution's binding of the generic append-only event log
 * (`src/data/storage/appendOnlyEventLog.ts`).
 *
 * ALL of the storage MECHANICS this file used to implement inline — writer-
 * session-hashed segment naming, rotation by size/line cap, the per-writer-chain
 * lock, the re-read-before-append, the post-close size verify, the commutative
 * event-set digest — now live there and are shared with a second consumer. The
 * behaviour is unchanged in every observable respect: the segment names are the
 * same bytes (no `baseNamePrefix`, so the base stays `{deviceHash}-{sessionHash}`
 * exactly as it is already written on every deployed share), the retry ladders
 * are the same ladders, and the error codes and log contexts below are the same
 * strings the audit and the incident runbooks refer to.
 *
 * `consumerNamespace` is what keeps distribution's module-level writer memos
 * (`writtenSegmentsThisSession`, `openSegmentSeqByWriter`) private to
 * distribution now that another consumer shares the same module in the same
 * tab — see that module's `segmentMemoKey` for what sharing them would cost.
 */
const DISTRIBUTION_EVENT_LOG: AppendOnlyEventLogConfig = {
  consumerNamespace: "dist",
  eventsDirName: DISTRIBUTION_EVENTS_DIR,
  segmentSuffix: DISTRIBUTION_EVENT_SEGMENT_SUFFIX,
  diagnostics: {
    writeContext: "distribution:append-segment",
    rereadContext: "distribution:segment-reread",
    verifyContext: "distribution:segment-verify",
    cannotWriteCode: "XQ-DIST-006",
    unverifiedCode: "XQ-DIST-007",
    sizeMismatchCode: "XQ-DIST-008",
    segmentParseError: (segmentName) => `Cannot parse distribution event segment: ${segmentName}`,
    verificationFailedError: (fileName, expectedBytes, observedBytes) =>
      `Distribution event segment write verification failed: ${fileName} ` +
      `(expected ${expectedBytes} bytes, saw ${observedBytes})`,
  },
};

export { MAX_OPEN_SEGMENT_BYTES, MAX_OPEN_SEGMENT_LINES };

type SegmentVerification = GenericSegmentVerification;

const DEVICE_ID_STORAGE_KEY = "xray_distribution_device_id_v1";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Cached fallback for the no-localStorage branch below (private browsing, a
// non-browser test environment, a throwing storage quota, ...). Without this,
// every call that can't reach localStorage would mint a brand-new random id,
// which would fragment every single write into its own segment file within
// ONE app session -- silently defeating the entire point of this change (one
// file per writer SESSION, not per event) for exactly the users this is
// least safe for (already-degraded storage).
let ephemeralDeviceId: string | null = null;

/**
 * Stable per-machine id, persisted in localStorage. Combined with a fresh
 * per-app-session id (below), this is the unit of write uniqueness that
 * replaces per-event ids: two machines -- or two tabs on the same machine --
 * never share a segment file, so concurrent writers still never target the
 * same file (see appendOnlyEventLog's doc on appendEventSegment).
 */
export function getDistributionDeviceId(): string {
  if (typeof window === "undefined" || !window.localStorage) {
    ephemeralDeviceId ??= `ephemeral-${randomId()}`;
    return ephemeralDeviceId;
  }
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = randomId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    ephemeralDeviceId ??= `ephemeral-${randomId()}`;
    return ephemeralDeviceId;
  }
}

/** @internal test-only — forces a fresh ephemeral fallback id on the next getDistributionDeviceId() call (only affects the no-localStorage branch). */
export function __resetDistributionDeviceIdForTests(): void {
  ephemeralDeviceId = null;
}

let currentSessionId: string | null = null;

/** Fresh per app session (module load) — never persisted, so a page reload always starts a new segment file. */
export function getDistributionSessionId(): string {
  if (!currentSessionId) currentSessionId = randomId();
  return currentSessionId;
}

/** @internal test-only — forces a fresh session id on the next getDistributionSessionId() call. */
export function __resetDistributionSessionIdForTests(): void {
  currentSessionId = null;
}

/**
 * `{deviceHash}-{sessionHash}[-{seq}].ndjson`.
 *
 * See appendOnlyEventLog's SHORT NAMES note for why this is 8 hex of device and
 * 6 of session rather than the raw ids, and why the length is asserted rather
 * than merely intended (XQ-IO-031 was a real, four-times-reported production
 * incident caused by an 80-character name on a deep UNC path).
 */
export function distributionEventSegmentFileName(
  deviceId: string,
  sessionId: string,
  seq = 0
): string {
  return segmentFileName(DISTRIBUTION_EVENT_LOG, { deviceId, sessionId }, seq);
}

/**
 * Append a whole batch of events to the CURRENT writer session's own OPEN
 * NDJSON segment, replacing the old one-file-per-event durability path
 * (writeImmutableDistributionEvent below, still kept for reading legacy
 * files — see loadImmutableDistributionEvents).
 *
 * The mechanics (bounded rotation, crash safety, the per-writer-chain lock, the
 * re-read-before-append and the post-close verify) live in
 * `appendOnlyEventLog.ts`'s `appendEventSegment` and are documented there.
 */
export async function appendDistributionEventSegment(
  distributionDir: DirectoryHandleLike,
  events: DistributionEvent[],
  writer: SegmentWriter = {
    deviceId: getDistributionDeviceId(),
    sessionId: getDistributionSessionId(),
  }
): Promise<SegmentVerification> {
  return appendEventSegment(distributionDir, events, writer, DISTRIBUTION_EVENT_LOG);
}

/**
 * Split a batch so no single append rewrites more than one full segment's worth
 * of bytes or lines. See `appendOnlyEventLog`'s own doc for why the escape
 * hatch in `shouldRotate` makes this necessary rather than merely tidy.
 */
export function chunkEventsForSegmentAppends(
  events: DistributionEvent[]
): DistributionEvent[][] {
  return chunkForSegmentAppends(events);
}

export type DurableAppendOptions = {
  writer?: SegmentWriter;
  /**
   * Re-resolve the distribution directory for ONE retry after a failed segment
   * write. `distributionStorage` passes a resolver that purges the workspace
   * directory-handle cache first, because a CACHED CHILD handle (`2-samples`,
   * the month folder, `1-main`) goes stale when an SMB session idle-disconnects
   * or the folder is re-created by another machine, and every write through it
   * then fails `NotFoundError`. Re-resolution replaces those; it cannot replace
   * the root handle the workspace has held since mount — that is what the
   * "works after re-picking the folder" report needs, and it takes a user
   * gesture. Omit to skip the retry entirely.
   */
  reopenDir?: () => Promise<DirectoryHandleLike>;
  /** Progress after each chunk lands, for the save-progress bar. */
  onChunk?: (completedEvents: number, totalEvents: number) => void;
};

/**
 * Durably write `events`, degrading through every option before failing.
 *
 * 1. **Chunked segment appends** (the fast path) — bounded writes, see
 *    `chunkEventsForSegmentAppends`.
 * 2. **One retry against a freshly-resolved directory handle** — covers a stale
 *    handle BELOW the workspace root (see `distributionStorage`'s resolver for
 *    what re-resolution reaches and what it cannot: the root handle itself is
 *    held since mount and needs a user gesture to replace, so a fault there
 *    falls through to step 3).
 * 3. **Per-event `{eventId}.json` files** — the pre-segment layout, which every
 *    reader still merges (`loadImmutableDistributionEvents`, and the checkpoint
 *    path's `legacyEventFileNames`). Names are 41 characters and the extension
 *    is `.json`, so this survives both a path-length limit and an
 *    `.ndjson`-blocking scanner. Slower, and that is the correct trade: the
 *    alternative is refusing to distribute the month at all.
 *
 * This ladder stays with distribution rather than moving into the generic
 * module: step 3's fallback file layout IS distribution's own, and a consumer
 * with a different one would need a different step 3.
 *
 * Only when all three fail does the batch report failure. Retries and the
 * fallback can each write an event twice; every reader dedupes by `eventId`
 * (`mergeDistributionEvents`, `distributionEventSetIdFromIds`), so a duplicate
 * is harmless where a lost event is not.
 */
export async function appendDistributionEventsDurably(
  distributionDir: DirectoryHandleLike,
  events: DistributionEvent[],
  options?: DurableAppendOptions
): Promise<SegmentVerification> {
  if (events.length === 0) return "verified";
  const writer = options?.writer ?? {
    deviceId: getDistributionDeviceId(),
    sessionId: getDistributionSessionId(),
  };
  const chunks = chunkEventsForSegmentAppends(events);
  let verification: SegmentVerification = "verified";
  let completed = 0;
  let directory = distributionDir;
  let fallbackReported = false;
  // Once a chunk has exhausted the segment path AND the re-resolved handle AND
  // degraded, the remaining chunks of THIS save go straight to the fallback.
  //
  // The causes this degrades for are properties of the NAME, not of the moment:
  // a path too long for the share, or an extension a scanner removes, fails
  // identically for every chunk. Re-deriving that per chunk costs the full
  // ~11 s write ladder + ~1.2 s classification + a second ~11 s ladder on the
  // re-resolved handle EVERY time — roughly 24 s of pure sleeping per chunk, so
  // an 18-chunk month spent ~7 minutes asleep to reach the same conclusion 18
  // times, and paid it again before surfacing an error if the fallback also
  // failed. Deciding once turns that back into one diagnosis per save.
  //
  // Scoped to this call deliberately: a later save re-probes from scratch, so a
  // genuinely transient failure never latches beyond the operation it hit.
  let segmentPathUnusable = false;
  // The failure that caused the first degradation, kept across iterations —
  // later chunks skip the segment attempt and so produce no error of their own,
  // but a fallback failure must still report the original classified cause.
  let degradeCause: unknown = null;

  for (const chunk of chunks) {
    let chunkVerification: SegmentVerification | null = null;
    let firstFailure: unknown = null;
    try {
      if (segmentPathUnusable) throw degradeCause;
      chunkVerification = await appendDistributionEventSegment(directory, chunk, writer);
    } catch (error) {
      if (segmentPathUnusable) {
        // Not a fresh diagnosis — the standing one. Fall through to the
        // fallback without re-running the ladders or the reopen retry.
        firstFailure = degradeCause;
      } else {
      // Degrade ONLY for the failure shape a different handle or a different
      // file name could plausibly fix: a NotFound/NotReadable on a name the
      // share will not produce. A revoked grant (NotAllowedError), a full disk
      // (QuotaExceededError) or a browser with no `createWritable` fail the
      // per-event path in exactly the same way, so retrying them through it
      // would burn one write per event to reach the same error while hiding the
      // specific, already-classified code the user needs to read.
      if (!isNotFoundError(error) && !isNotReadableError(error)) throw error;
      firstFailure = error;
      }
    }

    if (chunkVerification === null && !segmentPathUnusable && options?.reopenDir) {
      try {
        directory = await options.reopenDir();
        chunkVerification = await appendDistributionEventSegment(directory, chunk, writer);
        logCodedError("distribution:append-segment-reopened", "XQ-DIST-007", firstFailure);
      } catch {
        // Keep `firstFailure` as the reported cause: the re-resolved handle
        // failing the same way says nothing new.
      }
    }

    if (chunkVerification === null) {
      try {
        for (const event of chunk) {
          await writeImmutableDistributionEvent(directory, event);
        }
      } catch {
        // The fallback failed too. Report the ORIGINAL cause: it is the one
        // that was classified (path length, blocked extension, unreachable
        // folder), and it is what the user must act on.
        throw firstFailure ?? degradeCause;
      }
      chunkVerification = "verified";
      segmentPathUnusable = true;
      degradeCause ??= firstFailure;
      if (!fallbackReported) {
        logCodedError("distribution:append-events-fallback", "XQ-DIST-009", firstFailure);
        fallbackReported = true;
      }
    }

    if (chunkVerification === "unverified") verification = "unverified";
    completed += chunk.length;
    options?.onChunk?.(completed, events.length);
  }

  return verification;
}

/** Optional workspace/month identity for the memo key — see appendOnlyEventLog's `writtenSegmentsThisSession`. */
export type SegmentWriter = { deviceId: string; sessionId: string; scopeId?: string };

/** @internal test-only — forget which segments this session has written, and
 *  which sequence each writer chain's open segment sits at (both are per-session
 *  writer state; a test that resets one without the other would leave a writer
 *  pointing at a segment it no longer believes it wrote). */
export function __resetWrittenSegmentsForTests(): void {
  __resetAppendOnlyEventLogMemosForTests();
}

export type SegmentEventsDelta = GenericSegmentEventsDelta<DistributionEvent>;

/**
 * Read only the event lines appended past each segment's previously-known
 * byte offset (perf: fold-checkpoint). Passing `{}` reads every segment from
 * the start — the same function serves both a cold (full) read and a warm
 * (incremental) one.
 */
export async function readDistributionEventSegmentDelta(
  distributionDir: DirectoryHandleLike,
  knownOffsets: Record<string, number>
): Promise<SegmentEventsDelta> {
  return readEventSegmentDelta<DistributionEvent>(
    distributionDir,
    knownOffsets,
    DISTRIBUTION_EVENT_LOG
  );
}

/** Full cold read of every segment file — for callers (loadDistributionLog) that need the complete raw merged event list rather than a checkpoint delta. */
export async function loadDistributionEventSegments(
  distributionDir: DirectoryHandleLike
): Promise<DistributionEvent[]> {
  const { events } = await readDistributionEventSegmentDelta(distributionDir, {});
  return events;
}

function eventFileName(eventId: string): string {
  // Generated event ids are UUID-based. Rejecting instead of sanitizing avoids
  // two distinct ids mapping to one file and silently overwriting each other.
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(eventId)) {
    throw new Error(`Invalid distribution event id: ${eventId}`);
  }
  return `${eventId}.json`;
}

function sameEvent(left: DistributionEvent, right: DistributionEvent): boolean {
  return left.eventId === right.eventId
    && left.eventType === right.eventType
    && (left.eventSchemaVersion ?? 1) === (right.eventSchemaVersion ?? 1)
    && left.xrayImageId === right.xrayImageId
    && left.assignedTo === right.assignedTo
    && left.replacedById === right.replacedById
    && left.reassignedTo === right.reassignedTo
    && left.eventAt === right.eventAt
    && left.eventBy === right.eventBy
    && left.notes === right.notes
    && left.dailyQuota === right.dailyQuota
    && left.daysRemainingAtAssignment === right.daysRemainingAtAssignment
    && left.sourceRequestId === right.sourceRequestId;
}

/**
 * Persist an event as an immutable, uniquely named file.
 *
 * This removes the shared mutable log from the durability path: writers using
 * different event ids never target the same file. File System Access still has
 * no distributed transaction primitive, so a duplicate id with different
 * content is rejected rather than pretending an exactly-once guarantee.
 */
export async function writeImmutableDistributionEvent(
  distributionDir: DirectoryHandleLike,
  event: DistributionEvent
): Promise<void> {
  const eventsDir = await distributionDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: true });
  const fileName = eventFileName(event.eventId);
  const existing = await safeReadJson<DistributionEvent>(eventsDir, fileName);
  if (existing.ok) {
    if (sameEvent(existing.value, event)) return;
    throw new Error(`Distribution event id collision: ${event.eventId}`);
  }
  if (existing.reason === "corrupt") {
    throw new Error(`Distribution event file is corrupt: ${fileName}`);
  }

  await safeWriteJson(eventsDir, fileName, event);
  // Sibling of the segment verification in appendOnlyEventLog: this reads back
  // a file the line before provably wrote, so a NotFoundError is share latency,
  // not absence — opt into the bounded retry rather than declaring a completed
  // write failed.
  const verify = await safeReadJson<DistributionEvent>(eventsDir, fileName, {
    retryMissing: true,
  });
  if (!verify.ok || !sameEvent(verify.value, event)) {
    throw new Error(`Distribution event verification failed: ${event.eventId}`);
  }
}

export async function loadImmutableDistributionEvents(
  distributionDir: DirectoryHandleLike
): Promise<DistributionEvent[]> {
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await distributionDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  } catch {
    return [];
  }

  const { values } = await readJsonDirectory<DistributionEvent>(eventsDir, {
    suffix: ".json",
    onUnreadable: "throw",
    unreadableError: (name) => `Cannot read immutable distribution event: ${name}`,
  });
  return values.sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId));
}

/**
 * Same identity as distributionEventSetId, computed directly from ids so a
 * checkpoint holding `knownEventIds` (already-folded ids, small in-memory
 * array manipulation) can extend it without re-reading every event file.
 *
 * A one-line adapter over the generic, deliberately non-parameterized
 * `eventSetDigest` — see its doc for the commutative-digest reasoning and for
 * why every consumer shares the one implementation rather than supplying its
 * own.
 */
export function distributionEventSetIdFromIds(ids: Iterable<string>): string {
  return eventSetDigest(ids);
}

export function distributionEventSetId(events: DistributionEvent[]): string {
  return distributionEventSetIdFromIds(events.map((event) => event.eventId));
}

/**
 * The fold's canonical event order: ascending `eventAt`, ties left in the order
 * they were supplied.
 *
 * Ties are the whole point. A bulk distribution builds its entire batch with
 * ONE shared timestamp (see buildAssignEvent's `eventAt` override), so hundreds
 * of events can share an `eventAt` and no timestamp comparison can order them.
 * Until v85 the tie was broken by `eventId` here, and the resulting scramble was
 * invisible because `distribution.log.json` carried a full copy of every event
 * and its stored array order won: the batch's own order survived through that
 * projection. With the projection now body-less (item 2.6), this ordering is the
 * only one left — so it must reproduce what the projection used to give, or the
 * default order of an employee's queue silently becomes "sorted by random
 * UUID".
 *
 * `Array#sort` is specified as stable, so the tie order is exactly the INPUT
 * order — which makes assembling that input the caller's responsibility, not
 * this function's. Every input is deterministic: legacy per-event files and
 * segment files are both name-sorted by `directoryScan`, and lines within a
 * segment are in append order, so two clients reading the same directory always
 * agree. Within one layout that order IS the causal order.
 *
 * ACROSS layouts it is only as good as the concatenation the caller chose, and
 * a mixed workspace is reachable: `appendDistributionEventsDurably` degrades a
 * batch's later chunks from segments to per-event files. `distributionStorage`'s
 * `orderImmutableSources` is where that decision lives (segments first, so a
 * degraded batch still folds in chunk order) and where the residual limit — a
 * fallback chunk is internally name-ordered, i.e. by random UUID — is recorded.
 *
 * THIS COMPARATOR IS THE ONE distribution's late-event guard must also use
 * (`distributionDerivation.ts`'s `isEventEarlierThanEntry`, which extends it
 * with the `eventId` tie-break the checkpoint marker carries). See
 * `appendOnlyEventLog`'s `isEventOutOfOrder` for why a guard that orders
 * differently from the fold it guards is not a guard.
 */
export function sortDistributionEventsForFold<T extends DistributionEvent>(events: T[]): T[] {
  return sortEventsForFold(events, (a, b) => a.eventAt.localeCompare(b.eventAt));
}

export function mergeDistributionEvents(
  compatibilityEvents: DistributionEvent[],
  immutableEvents: DistributionEvent[]
): DistributionEvent[] {
  const byId = new Map<string, DistributionEvent>();
  const orderedBase: DistributionEvent[] = [];
  for (const event of compatibilityEvents) {
    const existing = byId.get(event.eventId);
    if (existing && !sameEvent(existing, event)) {
      throw new Error(`Distribution event id has conflicting content: ${event.eventId}`);
    }
    if (!existing) orderedBase.push(event);
    byId.set(event.eventId, event);
  }
  for (const event of immutableEvents) {
    const existing = byId.get(event.eventId);
    if (existing && !sameEvent(existing, event)) {
      throw new Error(`Distribution event id has conflicting content: ${event.eventId}`);
    }
    byId.set(event.eventId, event);
  }

  // Preserve the historical log order. Events missing from that projection are
  // concurrent/new immutable writes and get a deterministic timestamp/id order.
  const compatibilityIds = new Set(compatibilityEvents.map((event) => event.eventId));
  const additionIds = new Set<string>();
  const additions = sortDistributionEventsForFold(
    immutableEvents.filter((event) => {
      if (compatibilityIds.has(event.eventId) || additionIds.has(event.eventId)) return false;
      additionIds.add(event.eventId);
      return true;
    })
  );
  return [...orderedBase, ...additions];
}
