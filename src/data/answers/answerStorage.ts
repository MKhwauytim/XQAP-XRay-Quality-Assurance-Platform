// STAGE 2 OF `docs/architecture/ANSWER_SAVE_DELTA_PROPOSAL_2026-08-27.md` (rev 4).
//
// Wires the append-only answer event log (Stage 0's generic
// `src/data/storage/appendOnlyEventLog.ts` + Stage 1's
// `src/data/answers/answerEventStore.ts`) into the real read/write functions
// this file exports. Every item-state write (`upsertItemAnswer`,
// `upsertItemAnswerOnBehalf`, `reopenItemAnswer`, `setItemQualityNote`) now
// APPENDS an `AnswerEvent` instead of rewriting the whole `{username}.answers.json`
// file; the three request queues (referral/replacement/reopen) move to their
// own `{username}.requests.json`, written with the same whole-file-rewrite
// mechanics they always had (§7 — deliberately NOT migrated to the event log).
//
// `{username}.answers.json` is FROZEN the moment an employee's first event is
// appended (§8) and is never written again after that — it is read-only from
// then on, the migration-seed source for folding that employee's segments. An
// employee who never had one still gets an (empty) one written exactly once,
// at that same moment — see `resolveSeed`'s "FREEZING THE LEGACY SOURCE" note
// for why: it is what lets a corrupted/unreadable legacy source be detected
// forever after (P0-1's "never becomes empty" contract), not just at the
// instant of migration.
//
// NO PERSISTED FOLD CHECKPOINT in Stage 2 (a deliberate scope cut, flagged for
// Stage 3): every read cold-folds `answers.events/` fresh. Stage 1's
// `AnswerFoldCheckpoint`/`buildAnswerFoldCheckpoint` exist and are exercised by
// this file's own tests, but nothing here persists one to disk yet. See the
// Stage 2 completion report for the reasoning and the perf follow-up this implies.

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readOptionalJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import {
  createDeadline,
  INTERACTIVE_WRITE_DEADLINE_MS,
} from "../storage/operationDeadline";
import { logError } from "../storage/errorLogger";
import { logCodedError, tagErrorOnce, type ErrorCode } from "../storage/errorCodes";
import { createSimpleHasher } from "../storage/jsonEnvelope";
import { listDirectoryEntries } from "../storage/directoryScan";
import { isNotFoundError } from "../storage/transientFileErrors";
import { ensureMonthWritable } from "../population/monthLock";
import { bumpWorkspaceEpoch, workspaceScopeId } from "../storage/inFlightReads";
import { subscribeToDataRefresh } from "../workspace/dataRefreshSignal";
import {
  getDistributionDeviceId,
  getDistributionSessionId,
} from "../distribution/distributionEventStore";
import {
  ANSWER_EVENTS_DIR,
  ANSWER_EVENT_SEGMENT_SUFFIX,
  AnswerFoldError,
  appendAnswerEventSegment,
  foldAnswerEvents,
  readAnswerEventDelta,
  type AnswerEvent,
  type AnswerLegacySeed,
} from "./answerEventStore";
import type { EmployeeAnswerFile, ItemAnswer } from "./answerTypes";
import type { ReferralRequest, ReopenRequest, ReplacementRequest } from "../referral/referralTypes";
import {
  getPopulationMonthDir,
  getSampleEmployeeDir,
  getSampleMainDir,
  safeWorkspaceFilePart,
} from "../workspace/workspacePaths";
import { loadMirroredAnswers, markAnswerPendingLocally, mirrorAnswerLocally } from "./answerLocalMirror";

export { ANSWER_EVENTS_DIR, ANSWER_EVENT_SEGMENT_SUFFIX };

const ANSWERS_FOLDER = "employee-answers";

/**
 * `updateEmployeeRequestsFile`'s own casLoop tuning, carried over unchanged
 * from the pre-Stage-2 `updateEmployeeAnswerFile` (B-XQIO032) — same
 * reasoning, same numbers. The request-queue file is lower-stakes than the
 * item-answer stream it used to share a file with (it is now a small,
 * low-volume, whole-file-rewrite file, same mechanics as before), but nothing
 * about that reasoning changed, so the ladder did not either.
 */
const ANSWER_SAVE_MAX_RETRIES = 14;
const ANSWER_SAVE_BASE_DELAY_MS = 150;

async function getAnswersDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  return getSampleEmployeeDir(directoryHandle, monthFolderName, true);
}

async function getLegacyAnswersDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
  return monthDir.getDirectoryHandle(ANSWERS_FOLDER, { create: false });
}

const ANSWERS_SUFFIX = ".answers.json";
const REQUESTS_SUFFIX = ".requests.json";

function answerFileName(username: string): string {
  // Strip path-dangerous characters so a crafted username can't escape the
  // answers folder (path traversal / separators). Usernames are otherwise
  // admin-controlled and normalized lowercase.
  const safe = safeWorkspaceFilePart(username);
  return `${safe}${ANSWERS_SUFFIX}`;
}

function requestsFileName(username: string): string {
  const safe = safeWorkspaceFilePart(username);
  return `${safe}${REQUESTS_SUFFIX}`;
}

function emptyAnswerFile(username: string, monthFolderName: string): EmployeeAnswerFile {
  return { username, monthFolderName, revision: 0, items: [] };
}

/**
 * Per-item value-history cap (A4). A documented retention decision, not silent
 * loss: on overflow the first/original entry is always preserved and only the
 * middle is pruned, so the earliest recorded state and the most recent
 * VALUE_HISTORY_CAP-1 changes are always available.
 *
 * MUST stay equal to `ANSWER_VALUE_HISTORY_CAP` in `answerEventStore.ts` — that
 * module's own test asserts the two agree, so drift fails the suite.
 */
export const VALUE_HISTORY_CAP = 20;

/**
 * Same normalization `normalizeUsername` (auth/userManagement) applies, inlined
 * so the answer-storage layer keeps no dependency on the auth module. Used only
 * to compare two usernames for equality, never to build a file name — that is
 * `answerFileName`/`safeWorkspaceFilePart`'s job.
 */
function sameUser(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/* ───────────────────────── monotonic event clock ─────────────────────────
 * `eventAt` is the fold's PRIMARY total-order key (§4); `eventId` is only a
 * same-instant tie-break, and it is a random UUID — its string order carries
 * no relationship to call order. `Date.now()`/`toISOString()` alone is
 * millisecond-resolution, and two `await`ed writes from the same process
 * routinely land in the same millisecond (an in-memory workspace, a fast
 * share, two awaits with no real I/O between them) — without this, the SECOND
 * of two rapid same-item writes could sort BEFORE the first purely by UUID
 * luck, silently discarding the newer save. This keeps every `eventAt` this
 * process issues strictly increasing (still a valid ISO-8601 instant, just
 * pushed forward at most a few ms during a burst), which is enough to make
 * "the later call wins" true again for the single-process case without
 * touching Stage 1's comparator or its `authority` tie-break (both still
 * matter across DIFFERENT processes/machines, where this clock cannot help). */
let lastIssuedAnswerEventAtMs = 0;

function nextAnswerEventAt(): string {
  const now = Date.now();
  const ms = now > lastIssuedAnswerEventAtMs ? now : lastIssuedAnswerEventAtMs + 1;
  lastIssuedAnswerEventAtMs = ms;
  return new Date(ms).toISOString();
}

/** @internal test-only — forget the monotonic floor so a fresh test starts from the real clock. */
export function __resetAnswerEventClockForTests(): void {
  lastIssuedAnswerEventAtMs = 0;
}

/* ─────────────────────── error-code tagging helpers (Stage 2) ───────────── */

/** Tag+log a coded failure without shadowing a more specific code already on `error`. */
function tagAndLog(error: unknown, context: string, code: ErrorCode): unknown {
  tagErrorOnce(error, code);
  logCodedError(context, code, error);
  return error;
}

/* ─────────────────── in-memory, per-tab-session event cache (perf) ────────
 *
 * THE PROBLEM: every one of Stage 2's write functions needs the CURRENT
 * folded item state before it can decide what to append (`performAnswerWrite`
 * reads, then decides, then appends). Before this cache, that read was
 * `readAnswerEventDelta(mainDir, {})` — an EMPTY offsets map — on every single
 * call, meaning `readSegmentTails` (`directoryScan.ts`) treated every segment
 * in the month's FLAT, ALL-EMPLOYEES `answers.events/` directory as unread and
 * transferred its full content from byte 0, every time. Because the directory
 * is flat by design (§3 of the proposal — segment names carry no username), an
 * employee's own save paid the cost of every OTHER employee's activity too:
 * the read cost scaled with TOTAL TEAM MONTHLY ACTIVITY, not the saving
 * employee's own growth — a structurally worse version of the exact scaling
 * problem this whole rewrite exists to fix.
 *
 * THE FIX, deliberately NOT a disk-persisted checkpoint (unlike distribution's
 * `distribution.checkpoint.json` sidecar — see `distributionStorage.ts`):
 * round 2 of the design review already rejected a shared, disk-written,
 * per-month file bumped by every employee's save, because that recreates the
 * XQ-IO-032 incident pattern (many concurrent writers contending on one
 * shared file) on the app's HIGHEST-frequency write path. So this cache is
 * in-memory, per-tab, and non-persisted: it holds every `AnswerEvent` this tab
 * has read so far for a (workspace root, month), plus the exact
 * `knownOffsets`/`offsets` shape `readAnswerEventDelta` already accepts and
 * returns (Stage 0's `readSegmentTails` machinery — already built, already
 * tested, previously never fed anything but `{}`). A read after the first one
 * for a given (root, month) in this tab therefore transfers only the bytes
 * appended since the LAST time this tab looked — usually just this tab's own
 * previous save, landing in its own open segment — instead of the whole
 * directory.
 *
 * WHY THIS NEVER NEEDS A LATE-EVENT GUARD (unlike distribution's checkpoint,
 * which resumes a FOLDED accumulator and therefore needs `isEventOutOfOrder`
 * to protect against non-commutative incremental folding): this cache stores
 * only RAW EVENTS, never a folded result. Every call to `foldEmployeeEvents`
 * still folds the complete accumulated raw-event list from scratch, and the
 * fold's own comparator (`compareAnswerEventsForFold`) sorts by
 * `(eventAt, authority, eventId)` regardless of the order events were
 * appended to this array or the order segments happened to be read in. A
 * "late" event — one whose bytes reach this tab after a later-timestamped
 * event's bytes already did — is simply one more array entry the next full
 * fold sorts into its correct place. There is no accumulator to corrupt.
 *
 * SCOPING: keyed on the STABLE workspace root handle (a `WeakMap`, so a
 * disconnected workspace's entries are naturally collectible — unlike
 * `directoryScan.ts`'s own `appendOnlyCache`, this cache never needs
 * enumeration for a per-root partial clear, only a wholesale drop, so a
 * WeakMap loses nothing `appendOnlyCache`'s plain `Map` needed). Every
 * `getDirectoryHandle()` call returns a FRESH object in both the real File
 * System Access API and this repo's `memoryDirectory.ts` test double, so the
 * key must be the root the caller already holds across calls — exactly the
 * scoping convention `workspaceScopeId`/`bumpWorkspaceEpoch`
 * (`inFlightReads.ts`) and `directoryScan.ts`'s own `appendOnlyCache` already
 * use for the same reason.
 *
 * INVALIDATION — deliberately narrow, matching `directoryScan.ts`'s own
 * `appendOnlyCache`/`resetAppendOnlyDirectoryCache` precedent for exactly this
 * class of cache: only an explicit MANUAL refresh (`AdminToolbar`'s button,
 * `broadcastDataRefresh("manual")`) wholesale-drops it. The 45s periodic sync
 * tick's `"answers"`-family broadcast (workspaceSync.ts's
 * `answersEventsSignature` probe) deliberately does NOT — see
 * `dataRefreshSignal.ts`'s own doc comment on `DataRefreshSource`: "a
 * subscriber holding a cache with its own correct invalidation ... should NOT
 * wholesale-reset on this source -- that would defeat the cache for no
 * correctness benefit." That is exactly this cache's situation: in a team with
 * concurrent activity across many employees, the `"answers"` family changes on
 * most ticks, and wholesale-dropping on every one of those would force a full
 * team-wide re-read on almost every tick — defeating the entire point of this
 * fix for the exact "active team" scenario it targets. Growth by ANY writer
 * (this tab or another machine) is instead always picked up correctly and
 * promptly by the incremental byte-diff read itself, live on every call this
 * tab makes — not merely once per 45s tick — because `readSegmentTails`
 * compares each segment's REAL current size on disk against this tab's last
 * known offset every time, regardless of who grew it.
 *
 * THE ONE CASE THAT NEEDS THE MANUAL SAFETY VALVE: a segment's bytes being
 * REPLACED (not merely grown) under an unchanged name — the shape of a backup
 * restore's `merge-events` action. `readSegmentTails` only ever treats a
 * SHRUNK-OR-UNCHANGED file as "no new tail" (see its own doc: "never a
 * negative-length read"), so a restore that rewrites a sealed segment's bytes
 * without growing it past this tab's last-known offset would not be detected
 * by the incremental diff alone. A restore is a rare, explicit admin action;
 * the manual-refresh safety valve is the same one `directoryScan.ts`'s own
 * segment-adjacent cache already relies on for this identical residual risk,
 * so this cache asks nothing new of the operator.
 *
 * SAFE TO DROP AT ANY TIME, BY CONSTRUCTION: because the cache holds only raw
 * events (never folded state) and a miss simply means "read with `{}`
 * offsets" (today's un-cached behaviour, byte-for-byte), losing this cache —
 * a crash, a tab close, a module reload, an explicit reset — can only ever
 * cost one full re-read. It can never make an unreadable source look empty
 * (P0-1): a `readAnswerEventDelta` failure is thrown BEFORE this cache is
 * updated, so a corrupt/unreadable segment throws exactly as it did before
 * this cache existed, every time, cached or not.
 */

type AnswerEventsCacheEntry = {
  /** Every event this tab has read so far for this (root, month), deduped by
   *  `eventId` — see the module doc for why raw-event dedup is enough (no
   *  fold-order tracking needed). */
  events: Map<string, AnswerEvent>;
  /** `readAnswerEventDelta`'s own `knownOffsets`/`offsets` shape: bytes
   *  already consumed, per segment file name. Persist verbatim as the next
   *  call's `knownOffsets`. */
  offsets: Record<string, number>;
};

/** WeakMap<workspace root, Map<monthFolderName, entry>> — see the module doc's SCOPING note. */
let answerEventsCacheByRoot = new WeakMap<DirectoryHandleLike, Map<string, AnswerEventsCacheEntry>>();

function getAnswerEventsCacheEntry(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): AnswerEventsCacheEntry | undefined {
  return answerEventsCacheByRoot.get(directoryHandle)?.get(monthFolderName);
}

function setAnswerEventsCacheEntry(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  entry: AnswerEventsCacheEntry
): void {
  let perRoot = answerEventsCacheByRoot.get(directoryHandle);
  if (!perRoot) {
    perRoot = new Map();
    answerEventsCacheByRoot.set(directoryHandle, perRoot);
  }
  perRoot.set(monthFolderName, entry);
}

/** Wholesale-drop every cached (root, month) entry — the ONLY invalidation
 *  trigger this cache has in production (see the module doc's INVALIDATION
 *  note): a fresh `WeakMap` sheds every previous entry with no enumeration
 *  needed, since nothing here requires a targeted per-root clear. */
function resetAnswerEventsCache(): void {
  answerEventsCacheByRoot = new WeakMap();
}

/** @internal test-only alias — see `resetAnswerEventsCache`. */
export function __resetAnswerEventsCacheForTests(): void {
  resetAnswerEventsCache();
}

// Module-init side effect, matching `directoryScan.ts`'s own precedent for an
// identical class of cache (see that module's own comment on why this is safe
// to do unconditionally at module scope, and why the `typeof window` guard
// keeps this module importable from Vitest's default `node` test environment
// without throwing): only the admin's explicit MANUAL refresh wholesale-drops
// this cache. A bare `subscribeToDataRefresh` callback receives just the
// `DataRefreshSource` string, so no `changed`-family filtering is needed here
// — the periodic branch is simply a no-op, on purpose (see INVALIDATION above).
if (typeof window !== "undefined") {
  subscribeToDataRefresh((source) => {
    if (source === "manual") resetAnswerEventsCache();
  });
}

/**
 * This tab's own just-appended events, reflected into the cache immediately —
 * zero directory reads, per the module doc's requirement #4. Deliberately a
 * no-op when no cache entry exists yet for this (root, month): every call site
 * (`performAnswerWrite`, `performOnBehalfWrite`) already called
 * `readAllAnswerEventsForMonth` earlier in the SAME casLoop attempt to compute
 * `previous`, which populates the entry — so in practice this only ever finds
 * a live entry to update. Refusing to SEED a partial entry from a write alone
 * (rather than lazily creating one here) keeps the "safe to drop at any time"
 * property intact: a cache entry either reflects a real read of the whole
 * directory as of some point, or it does not exist at all.
 *
 * Offsets are deliberately left untouched: this tab's own segment on disk grew
 * by exactly `events`' encoded bytes, but the next real read reads those same
 * bytes again from the (still-accurate, merely stale) offset — a small,
 * bounded re-read of only this tab's own last save, not the whole directory —
 * and the fold's own `duplicate-event-id` dedup (`foldAnswerEvents`, step 1)
 * discards the re-read copy for free. Tracking the exact resulting segment
 * name/size here instead would duplicate `appendOnlyEventLog.ts`'s own
 * rotation/naming logic a second time for a saving that is not worth that
 * risk.
 */
function reflectLocalAppendInAnswerEventsCache(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  appended: readonly AnswerEvent[]
): void {
  const entry = getAnswerEventsCacheEntry(directoryHandle, monthFolderName);
  if (!entry) return;
  for (const event of appended) entry.events.set(event.eventId, event);
}

/**
 * Read the WHOLE `answers.events/` directory — incrementally when this tab
 * has already read it at least once this session (see the cache above), fully
 * from byte 0 the first time, exactly as before this cache existed. Any
 * read/parse failure is tagged `XQ-ANS-004` and rethrown — never swallowed
 * into an empty event list (P0-1's contract applied to the event log itself,
 * matching distribution's own `loadDistributionLog`) — and, critically, is
 * thrown BEFORE the cache is updated, so a failed read never poisons it with
 * partial state; the entry (if any) is left exactly as it was before this
 * call, still safe to resume from on the next successful read.
 */
/**
 * Exported for `history/actionHistoryReaders.ts`, which folds exactly this
 * input to derive the pre-change trail the deleted answers-history writer used
 * to copy into its own files. Sharing the reader keeps the two from drifting.
 */
export async function readAllAnswerEventsForMonth(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<AnswerEvent[]> {
  const mainDir = await getSampleMainDir(directoryHandle, monthFolderName, true);
  try {
    const cached = getAnswerEventsCacheEntry(directoryHandle, monthFolderName);
    const delta = await readAnswerEventDelta(mainDir, cached?.offsets ?? {});
    const events = cached ? new Map(cached.events) : new Map<string, AnswerEvent>();
    for (const event of delta.events) events.set(event.eventId, event);
    setAnswerEventsCacheEntry(directoryHandle, monthFolderName, { events, offsets: delta.offsets });
    return [...events.values()];
  } catch (error) {
    throw tagAndLog(error, "answers:read-segments", "XQ-ANS-004");
  }
}

/** Every event this employee is the file-owner of — see `answeredBy` below. */
/** Exported alongside `readAllAnswerEventsForMonth` — see its note. */
export function eventsForEmployee(events: readonly AnswerEvent[], username: string): AnswerEvent[] {
  return events.filter((event) => sameUser(event.answeredBy ?? "", username));
}

/**
 * Fold `AnswerFoldError` (§8/§10's "events with no migration-seed" and "seed
 * hash mismatch" failures) into a coded, logged error before it propagates —
 * `XQ-ANS-005` / `XQ-ANS-006` respectively, matched on the exact message shape
 * `answerEventStore.ts`'s `foldAnswerEvents` throws today.
 */
function foldEmployeeEvents(
  events: readonly AnswerEvent[],
  options: Parameters<typeof foldAnswerEvents>[1]
): ReturnType<typeof foldAnswerEvents> {
  try {
    return foldAnswerEvents(events, options);
  } catch (error) {
    if (error instanceof AnswerFoldError) {
      // Discriminated on `error.reason` (a real field on `AnswerFoldError`,
      // set at each of its two throw sites) rather than matching on message
      // text — the message is free-form prose meant for a log/error, not a
      // classification contract.
      const code: ErrorCode = error.reason === "missing-migration-seed" ? "XQ-ANS-005" : "XQ-ANS-006";
      throw tagAndLog(error, "answers:fold", code);
    }
    throw error;
  }
}

/* ───────────────────────── legacy `.answers.json` (frozen) ──────────────── */

/**
 * Read the legacy `{username}.answers.json` — current location, then the
 * pre-numbered-root legacy folder, matching the two-location probe this file
 * always used. **Throws** on an unreadable or corrupt file (P0-1): this is the
 * migration-seed source, so an unreadable legacy file must never be silently
 * treated as "no legacy file" — that would seed from nothing and quietly
 * discard whatever answers were there before Stage 2.
 *
 * Read on EVERY fold that needs a legacy-derived baseline, not just once at
 * migration time — Stage 2 keeps no persisted checkpoint (see this file's
 * module doc), so every cold fold re-supplies the seed content fresh. The file
 * is frozen (this module never writes it again after `resolveSeed`'s one-time
 * freeze), so a healthy read always answers the same content; an unhealthy one
 * still throws, which is exactly what `readContract.test.ts`'s P0-1 corruption
 * case exercises.
 */
async function loadLegacyAnswersFile(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<EmployeeAnswerFile | null> {
  const fileName = answerFileName(username);
  const read = await readOptionalJson<EmployeeAnswerFile>(
    `answers:legacy:${monthFolderName}/${username}`,
    [
      { directory: () => getAnswersDir(directoryHandle, monthFolderName), fileName },
      { directory: () => getLegacyAnswersDir(directoryHandle, monthFolderName), fileName },
    ],
    { fallThroughOnMissingFile: false }
  );
  return read.kind === "found" ? read.value : null;
}

function hashLegacyAnswerItems(items: readonly ItemAnswer[]): string {
  const hasher = createSimpleHasher();
  hasher.update(JSON.stringify(items));
  return hasher.digest();
}

/**
 * §8's `legacyContentHash`: "" for BOTH a genuinely absent legacy file AND one
 * that is present but empty. Treating the two identically is what keeps a
 * retried migration-seed attempt consistent — see `resolveSeed`'s freeze step,
 * which can leave an empty shell on disk from an earlier failed attempt; the
 * retry must compute the SAME hash the first attempt did, not a different one
 * because a file that did not exist before now does.
 */
function legacyContentHashOf(legacy: EmployeeAnswerFile | null): string {
  return legacy && legacy.items.length > 0 ? hashLegacyAnswerItems(legacy.items) : "";
}

/* ───────────────────────── item-state read (segments + legacy) ──────────── */

type EmployeeItemState = { items: ItemAnswer[]; seeded: boolean };

/**
 * One employee's item state: fold their own slice of `answers.events/` (with
 * the frozen legacy file supplying the migration-seed baseline) when they have
 * any segments at all; otherwise pass the legacy file's items straight
 * through unfolded — the ordinary pre-migration read, byte-identical to what
 * this file always returned before Stage 2.
 *
 * `allEvents`, when supplied, is the whole month's already-read event list
 * (the fan-out reads it once and reuses it for every employee instead of
 * re-reading the same flat directory per employee).
 */
async function loadEmployeeItemState(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  allEvents?: readonly AnswerEvent[]
): Promise<EmployeeItemState> {
  const events = allEvents ?? (await readAllAnswerEventsForMonth(directoryHandle, monthFolderName));
  const ownEvents = eventsForEmployee(events, username);
  if (ownEvents.length === 0) {
    const legacy = await loadLegacyAnswersFile(directoryHandle, monthFolderName, username);
    return { items: legacy?.items ?? [], seeded: false };
  }
  const legacy = await loadLegacyAnswersFile(directoryHandle, monthFolderName, username);
  const legacySeed: AnswerLegacySeed = {
    contentHash: legacyContentHashOf(legacy),
    items: legacy?.items ?? [],
  };
  const result = foldEmployeeEvents(ownEvents, { legacySeed, username, monthFolderName });
  // Compatibility overlay for `saveEmployeeAnswers` (§11: explicitly stays on
  // the legacy whole-array-replace path, test/seed-only). That path can write
  // an item straight into `.answers.json` for an employee who ALSO has
  // segments (mixed test/seed usage), after the migration-seed's own
  // `legacyContentHash` has already frozen at an earlier value — the fold
  // correctly ignores such a rewrite for hash-verification purposes (§8), so
  // an item that exists ONLY there and never went through an event is added
  // here rather than silently dropped. An item the fold DOES know about always
  // wins over this overlay; this never overrides folded/event-sourced state.
  const foldedIds = new Set(result.file.items.map((item) => item.xrayImageId));
  const legacyOnly = (legacy?.items ?? []).filter((item) => !foldedIds.has(item.xrayImageId));
  const items = legacyOnly.length > 0 ? [...result.file.items, ...legacyOnly] : result.file.items;
  return { items, seeded: result.seeded };
}

/* ─────────────────────── request queues (§7 — own file, unchanged mechanics) ─ */

type EmployeeRequestsFile = {
  username: string;
  monthFolderName: string;
  revision?: number;
  _writeToken?: string;
  referralRequests?: ReferralRequest[];
  replacementRequests?: ReplacementRequest[];
  reopenRequests?: ReopenRequest[];
  lastUpdatedAt?: string;
};

function emptyRequestsFile(username: string, monthFolderName: string): EmployeeRequestsFile {
  return { username, monthFolderName, revision: 0 };
}

/**
 * `{username}.requests.json` if it exists; otherwise fall back to whatever
 * referral/replacement/reopen arrays are embedded in the legacy
 * `{username}.answers.json` (pre-Stage-2 data that predates the split) so that
 * data stays visible until the first write moves it into its own file. The
 * legacy file is never rewritten by this fallback — only read.
 */
async function loadEmployeeRequestsFile(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<EmployeeRequestsFile> {
  const fileName = requestsFileName(username);
  const read = await readOptionalJson<EmployeeRequestsFile>(
    `answers:requests:${monthFolderName}/${username}`,
    [{ directory: () => getAnswersDir(directoryHandle, monthFolderName), fileName }],
    { fallThroughOnMissingFile: false }
  );
  if (read.kind === "found") return read.value;
  const legacy = await loadLegacyAnswersFile(directoryHandle, monthFolderName, username);
  if (!legacy) return emptyRequestsFile(username, monthFolderName);
  return {
    username,
    monthFolderName,
    revision: 0,
    referralRequests: legacy.referralRequests,
    replacementRequests: legacy.replacementRequests,
    reopenRequests: legacy.reopenRequests,
  };
}

type RequestsFileUpdate = EmployeeRequestsFile | { refuse: string };

function isRefusal<T extends { refuse: string }>(update: unknown): update is T {
  return typeof update === "object" && update !== null && "refuse" in update;
}

/**
 * Whole-file read-modify-write on `{username}.requests.json` — the exact
 * mechanics `updateEmployeeAnswerFile` always used, scoped down to the three
 * request queues now that item answers no longer share this file (§7). Low
 * volume, already correct, deliberately not touched beyond the narrower shape.
 */
async function updateEmployeeRequestsFile(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  updater: (file: EmployeeRequestsFile) => RequestsFileUpdate,
  telemetryAction: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureMonthWritable(directoryHandle, monthFolderName);
  return casLoop<{ ok: true } | { ok: false; error: string }>(
    async (writeToken) => {
      const dir = await getAnswersDir(directoryHandle, monthFolderName);
      const existing = await loadEmployeeRequestsFile(directoryHandle, monthFolderName, username);
      const update = updater(existing);
      if (isRefusal(update)) {
        return { done: true, result: { ok: false as const, error: update.refuse } };
      }
      const nextRevision = (existing.revision ?? 0) + 1;
      const updated: EmployeeRequestsFile = {
        ...update,
        username,
        monthFolderName,
        revision: nextRevision,
        _writeToken: writeToken,
        lastUpdatedAt: new Date().toISOString(),
      };
      await safeWriteJson(dir, requestsFileName(username), updated);
      const verify = await loadEmployeeRequestsFile(directoryHandle, monthFolderName, username);
      if (verify.revision === nextRevision && verify._writeToken === writeToken) {
        bumpWorkspaceEpoch(directoryHandle, monthFolderName);
        return {
          done: true,
          result: { ok: true as const },
          verify: async () => {
            const recheck = await loadEmployeeRequestsFile(directoryHandle, monthFolderName, username);
            return recheck.revision === nextRevision && recheck._writeToken === writeToken;
          },
        };
      }
      return { done: false };
    },
    {
      context: "answers:requestsFile",
      maxRetries: ANSWER_SAVE_MAX_RETRIES,
      baseDelayMs: ANSWER_SAVE_BASE_DELAY_MS,
      // One budget for this whole user action. Without it the 14 attempts above
      // multiply against safeWriteJson's two ~11 s verify-readback ladders —
      // ~308 s, the "answer save takes 4 minutes" report. See
      // operationDeadline.ts; the first attempt always runs regardless.
      deadline: createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "answers:interactive-write"),
      conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ طلبات الموظف بعد عدة محاولات.",
      onExhausted: (cause, code) => {
        logError(`answerStorage:${telemetryAction}`, cause instanceof Error ? cause : new Error(String(cause)), {
          action: telemetryAction,
          errorCode: code,
        });
      },
    }
  );
}

/* ───────────────────────────── loadEmployeeAnswers (§7) ─────────────────── */

/**
 * The employee's answer file: a merge of exactly two sources (§7) — item state
 * (segments-and-fold, or the legacy file directly pre-migration; §8) and
 * `{username}.requests.json` (or its legacy fallback) — returning the
 * identical `EmployeeAnswerFile` shape every existing caller expects.
 *
 * Never defaults to empty on an unreadable source (P0-1): a throw from either
 * half propagates to the caller.
 */
export async function loadEmployeeAnswers(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<EmployeeAnswerFile> {
  const [itemState, requests] = await Promise.all([
    loadEmployeeItemState(directoryHandle, monthFolderName, username),
    loadEmployeeRequestsFile(directoryHandle, monthFolderName, username),
  ]);
  return {
    username,
    monthFolderName,
    revision: requests.revision ?? 0,
    items: itemState.items,
    referralRequests: requests.referralRequests,
    replacementRequests: requests.replacementRequests,
    reopenRequests: requests.reopenRequests,
    lastUpdatedAt: requests.lastUpdatedAt,
  };
}

/* ───────────────────────────── the event-append write path ──────────────── */

/**
 * `getDistributionDeviceId`/`getDistributionSessionId` are reused as-is
 * rather than minting a second, answers-only device/session id pair: device
 * and session identity are a property of the MACHINE and the APP SESSION, not
 * of which consumer is writing, so both should report — and do report — the
 * same values. What keeps the two consumers' segment chains and module-level
 * writer memos from colliding despite sharing device/session ids is
 * `consumerNamespace` (`"ans"` here vs distribution's `"dist"`), baked into
 * `ANSWER_EVENT_LOG`'s config in `answerEventStore.ts` — see
 * `appendOnlyEventLog.ts`'s `segmentMemoKey` for why that alone is sufficient.
 */
function answerWriterIdentity(directoryHandle: DirectoryHandleLike, monthFolderName: string) {
  return {
    deviceId: getDistributionDeviceId(),
    sessionId: getDistributionSessionId(),
    scopeId: `${workspaceScopeId(directoryHandle)}|${monthFolderName}`,
  };
}

/**
 * Resolve whether `username` needs a `migration-seed` event prepended to this
 * write's batch (§8), and the legacy-derived seed to fold with either way
 * (Stage 2 cold-folds every read/write — see the module doc).
 *
 * FREEZING THE LEGACY SOURCE. When no legacy `.answers.json` exists at all,
 * one is written here — ONCE, holding an empty shell — before the
 * `migration-seed` event is built. This is not a second copy of item state
 * (segments own that from here on) and it is never written again after this.
 * It exists so the migration-seed's `legacyContentHash` always names a real,
 * durably-readable artifact on disk: an employee who never had a legacy file
 * still gets the SAME "unreadable source never silently becomes empty"
 * guarantee (P0-1) as one who did, on every subsequent fold, not just at this
 * instant. `legacyContentHashOf` treats "absent" and "present-but-empty"
 * identically, so a retried attempt that finds this shell already frozen (an
 * earlier attempt wrote it, then failed later in the same call) computes the
 * SAME hash the first attempt did — the stable-`eventId` retry contract (§3)
 * would otherwise see the same id carry two different `legacyContentHash`
 * values across attempts.
 */
async function resolveSeed(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  ownEvents: readonly AnswerEvent[],
  eventId: string,
  eventAt: string
): Promise<{ seedEvent: AnswerEvent | null; legacySeed: AnswerLegacySeed }> {
  const alreadySeeded = ownEvents.some((event) => event.eventType === "migration-seed");
  const legacy = await loadLegacyAnswersFile(directoryHandle, monthFolderName, username);
  const legacySeed: AnswerLegacySeed = {
    contentHash: legacyContentHashOf(legacy),
    items: legacy?.items ?? [],
  };
  if (alreadySeeded) return { seedEvent: null, legacySeed };

  if (!legacy) {
    const answersDir = await getAnswersDir(directoryHandle, monthFolderName);
    await safeWriteJson(answersDir, answerFileName(username), emptyAnswerFile(username, monthFolderName));
  }

  const seedEvent: AnswerEvent = {
    eventId: `${eventId}-seed`,
    eventType: "migration-seed",
    eventAt,
    eventBy: username,
    authority: "self",
    answeredBy: username,
    legacyContentHash: legacySeed.contentHash,
  };
  return { seedEvent, legacySeed };
}

/** What one of the four write functions wants to happen, given the CURRENT (freshly-folded) item. */
type AnswerWriteDecision =
  | { event: Omit<AnswerEvent, "eventId" | "eventAt" | "answeredBy"> }
  | { skip: true };

/**
 * Shared append machinery for `upsertItemAnswer`, `reopenItemAnswer` and
 * `setItemQualityNote` — the three writers whose outcome does not depend on
 * winning a race (unlike on-behalf; see `performOnBehalfWrite`). `eventId`/
 * `eventAt` are fixed ONCE per call, before entering the retry loop, and reused
 * across every casLoop attempt (§3: a retried append after an ambiguous
 * failure must be a detectable duplicate, not a silent replay with a fresh id).
 *
 * `build` sees the item's CURRENT state (freshly folded from the real event
 * log, not a caller-supplied snapshot) and may decline to append at all
 * (`{ skip: true }`) — the idempotent-no-op cases (`reopenItemAnswer` on a
 * non-submitted item, `setItemQualityNote` on an item that does not exist yet)
 * stay genuine no-ops: nothing is appended, exactly as the pre-Stage-2
 * whole-file update reported `{ ok: true }` without writing.
 */
async function performAnswerWrite(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  xrayImageId: string,
  build: (ctx: { previous: ItemAnswer | undefined }) => AnswerWriteDecision,
  telemetryAction: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureMonthWritable(directoryHandle, monthFolderName);
  const eventId = crypto.randomUUID();
  const eventAt = nextAnswerEventAt();
  const writer = answerWriterIdentity(directoryHandle, monthFolderName);
  // No pre-change history write here any more. The state a snapshot would have
  // copied is already durable in `answers.events/*.ndjson`, which is
  // append-only and never pruned, so `actionHistoryReaders.ts` derives the same
  // trail by folding those events instead. That removes a whole-file write from
  // the hot save path — and with it the deep per-record path that made the
  // write fail on every save on a workspace deep on the share (XQ-IO-034).
  // The item state to mirror locally once the append succeeds — built from
  // the same in-memory `previous`/`event` the retry body already computed, so
  // mirroring never costs an extra disk read. Set on the LAST attempt only
  // (each retry overwrites it), which is exactly the state that ends up
  // durably appended.
  let mirrorCandidate: ItemAnswer | null = null;

  return casLoop<{ ok: true } | { ok: false; error: string }>(
    async () => {
      const mainDir = await getSampleMainDir(directoryHandle, monthFolderName, true);
      const allEvents = await readAllAnswerEventsForMonth(directoryHandle, monthFolderName);
      const ownEvents = eventsForEmployee(allEvents, username);

      const { seedEvent, legacySeed } = await resolveSeed(
        directoryHandle,
        monthFolderName,
        username,
        ownEvents,
        eventId,
        eventAt
      );

      const foldedNow = foldEmployeeEvents(
        seedEvent ? [...ownEvents, seedEvent] : ownEvents,
        { legacySeed, username, monthFolderName }
      );
      const previous = foldedNow.file.items.find((item) => item.xrayImageId === xrayImageId);

      const decision = build({ previous });
      if ("skip" in decision) {
        return { done: true, result: { ok: true as const } };
      }

      const event: AnswerEvent = { ...decision.event, eventId, eventAt, answeredBy: username };
      const batch = seedEvent ? [seedEvent, event] : [event];
      mirrorCandidate = {
        xrayImageId: event.xrayImageId ?? xrayImageId,
        templateId: event.templateId ?? previous?.templateId ?? "",
        templateVersion: event.templateVersion ?? previous?.templateVersion ?? 1,
        answers: event.answers ?? previous?.answers ?? [],
        lastSavedAt: event.lastSavedAt ?? eventAt,
        submittedAt: event.submittedAt ?? previous?.submittedAt ?? null,
        answeredBy: username,
        status: event.status ?? previous?.status ?? "draft",
        history: previous?.history,
        valueHistory: previous?.valueHistory,
        qualityNote: previous?.qualityNote,
        answeredOnBehalfBy: event.answeredOnBehalfBy,
      };
      // Pre-change snapshot (owner requirement, 2026-09-03): the item's state
      // right before this event, kept as a rolling last-10 history per
      // (month, employee, item) — the answers-family parity fix for the
      // per-write `.bak` every OTHER data family already gets from
      // safeWriteJson. Answers moved to this append-only event log (Stage 2 of
      // the answer-save proposal) and never call safeWriteJson for a real
      // save/reopen/note anymore, so they silently lost that protection; this
      // restores an equivalent (a recoverable prior state) for the new model.
      await appendAnswerEventSegment(mainDir, batch, writer);
      reflectLocalAppendInAnswerEventsCache(directoryHandle, monthFolderName, batch);
      return { done: true, result: { ok: true as const } };
    },
    {
      context: `answers:${telemetryAction}`,
      maxRetries: ANSWER_SAVE_MAX_RETRIES,
      baseDelayMs: ANSWER_SAVE_BASE_DELAY_MS,
      // One budget for this whole user action. Without it the 14 attempts above
      // multiply against safeWriteJson's two ~11 s verify-readback ladders —
      // ~308 s, the "answer save takes 4 minutes" report. See
      // operationDeadline.ts; the first attempt always runs regardless.
      deadline: createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "answers:interactive-write"),
      conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ إجابة الموظف بعد عدة محاولات.",
      onExhausted: (cause, code) => {
        logError(`answerStorage:${telemetryAction}`, cause instanceof Error ? cause : new Error(String(cause)), {
          action: telemetryAction,
          errorCode: code,
        });
      },
    }
  ).then(async (result) => {
    // Cache/derived-state refresh, after the durable append, never gating the
    // save's own success — same contract as distribution's
    // `refreshDistributionCacheAfterWrite` (awaited, wrapped so its own
    // failure can never flip a successful save to a failure).
    if (result.ok) {
      await refreshAnswerCacheAfterWrite(directoryHandle, monthFolderName);
      // Best-effort local backup — built from in-memory state above, so this
      // never costs an extra read of the file it is backing up.
      // `mirrorAnswerLocally` never throws (see its own doc comment).
      if (mirrorCandidate) await mirrorAnswerLocally(monthFolderName, username, mirrorCandidate);
    } else if (mirrorCandidate) {
      // The append never reached the shared folder (share down, permission
      // lost, exhausted retries) — queue it in the local backup as PENDING
      // rather than dropping it, so the 30s retry tick / next reconciliation
      // in `XrayInspectionResults.tsx` keeps trying until it lands, and the
      // employee sees a "not saved yet" count instead of a silently lost
      // answer. `markAnswerPendingLocally` never throws (see its doc comment).
      await markAnswerPendingLocally(monthFolderName, username, mirrorCandidate);
    }
    return result;
  });
}

/**
 * Reconcile this browser's local IndexedDB backup with the workspace file for
 * one employee's one month — the "sign-in" / periodic side of the local
 * mirror (see `answerLocalMirror.ts`'s module doc for why this exists and why
 * it never deletes on either side).
 *
 * Two passes, both additive-only:
 *  1. Any mirrored item that the file either lacks or holds an OLDER
 *     `lastSavedAt` for is replayed into the file through the normal
 *     `upsertItemAnswer` path — the same casLoop-protected, conflict-safe
 *     append every real save goes through, never a raw overwrite.
 *  2. The file is re-read (picking up anything just replayed) and every one
 *     of its items is written back into the mirror, so a browser that just
 *     had an empty/reset IndexedDB ends this call caught back up — restoring
 *     from an empty mirror only ever ADDS entries, it never removes the
 *     file's own data.
 *
 * Best-effort throughout: called opportunistically (on load, and on a
 * periodic tick from the UI), never gates rendering the employee's answers.
 */
export async function reconcileAnswersWithLocalMirror(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<void> {
  try {
    const [file, mirrored] = await Promise.all([
      loadEmployeeAnswers(directoryHandle, monthFolderName, username),
      loadMirroredAnswers(monthFolderName, username),
    ]);

    const onDiskByImage = new Map(file.items.map((item) => [item.xrayImageId, item]));
    let replayedAny = false;
    for (const mirroredItem of mirrored) {
      const onDisk = onDiskByImage.get(mirroredItem.xrayImageId);
      const mirrorIsNewer = !onDisk || mirroredItem.lastSavedAt > onDisk.lastSavedAt;
      if (!mirrorIsNewer) continue;
      const result = await upsertItemAnswer(directoryHandle, monthFolderName, username, mirroredItem);
      if (result.ok) replayedAny = true;
    }

    const finalFile = replayedAny
      ? await loadEmployeeAnswers(directoryHandle, monthFolderName, username)
      : file;
    for (const item of finalFile.items) {
      await mirrorAnswerLocally(monthFolderName, username, item);
    }
  } catch (error) {
    logError("answers:mirror-reconcile", error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Best-effort post-write refresh, matching distribution's
 * `refreshDistributionCacheAfterWrite` contract exactly: awaited by the caller
 * (never fire-and-forget, never debounced) but wrapped so its own failure can
 * never turn a successful append into a reported failure.
 *
 * Stage 2 keeps no persisted derived cache for answers (see this file's module
 * doc), so there is no cache file to rebuild here the way distribution rebuilds
 * `distribution.current.json` — the one piece of shared, cross-tab state a
 * write needs to invalidate is the workspace epoch that `dedupeInFlight`
 * readers key on, so another read in this tab does not serve a pre-write
 * result. `bumpWorkspaceEpoch` is idempotent and cheap (no I/O), so this never
 * meaningfully adds to the write's own latency even though it is awaited.
 */
async function refreshAnswerCacheAfterWrite(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<void> {
  try {
    bumpWorkspaceEpoch(directoryHandle, monthFolderName);
  } catch (error) {
    logError("answers:refresh-after-write", error);
  }
}

export async function saveEmployeeAnswers(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  items: ItemAnswer[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Explicitly excluded from the Stage 2 migration (proposal §11): test/seed
  // data only. Stays on the legacy whole-array-replace path, writing directly
  // to `{username}.answers.json` — the file every OTHER write path in this
  // module now treats as frozen once an employee has segments. Do not call
  // this after an employee has any real answer activity through the event log.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  return casLoop<{ ok: true } | { ok: false; error: string }>(
    async (writeToken) => {
      const dir = await getAnswersDir(directoryHandle, monthFolderName);
      const existing = await loadLegacyAnswersFile(directoryHandle, monthFolderName, username);
      const file = existing ?? emptyAnswerFile(username, monthFolderName);
      const prevById = new Map(file.items.map((item) => [item.xrayImageId, item]));
      const nextRevision = (file.revision ?? 0) + 1;
      const updated: EmployeeAnswerFile = {
        ...file,
        username,
        monthFolderName,
        revision: nextRevision,
        _writeToken: writeToken,
        lastUpdatedAt: new Date().toISOString(),
        items: items.map((item) => {
          const previous = prevById.get(item.xrayImageId);
          return withLegacyValueHistory(previous, withLegacyStoredHistory(previous, stripLegacyOnBehalf(item)));
        }),
      };
      await safeWriteJson(dir, answerFileName(username), updated);
      const verify = await loadLegacyAnswersFile(directoryHandle, monthFolderName, username);
      if (verify?.revision === nextRevision && verify._writeToken === writeToken) {
        bumpWorkspaceEpoch(directoryHandle, monthFolderName);
        return { done: true, result: { ok: true as const } };
      }
      return { done: false };
    },
    {
      context: "answers:legacySeedWrite",
      maxRetries: ANSWER_SAVE_MAX_RETRIES,
      baseDelayMs: ANSWER_SAVE_BASE_DELAY_MS,
      // One budget for this whole user action. Without it the 14 attempts above
      // multiply against safeWriteJson's two ~11 s verify-readback ladders —
      // ~308 s, the "answer save takes 4 minutes" report. See
      // operationDeadline.ts; the first attempt always runs regardless.
      deadline: createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "answers:interactive-write"),
      conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ ملف الموظف بعد عدة محاولات.",
    }
  );
}

/* ── legacy A4/history helpers, used ONLY by saveEmployeeAnswers above ──────
 * Kept byte-identical to the pre-Stage-2 logic that used to serve every write
 * path — saveEmployeeAnswers is explicitly excluded from the event-log
 * migration (§11), so it keeps behaving exactly as it always did. */

function legacyChangeReason(previous: ItemAnswer): "save" | "reopen-correction" {
  const wasReopened =
    previous.status === "draft" && (previous.history?.some((h) => h.action === "reopened") ?? false);
  return wasReopened ? "reopen-correction" : "save";
}

function withLegacyValueHistory(previous: ItemAnswer | undefined, next: ItemAnswer): ItemAnswer {
  if (!previous) return { ...next, valueHistory: undefined };
  const entry = {
    changedAt: new Date().toISOString(),
    changedBy: next.answeredOnBehalfBy ?? next.answeredBy,
    reason: legacyChangeReason(previous),
    previous: {
      answers: previous.answers,
      status: previous.status,
      submittedAt: previous.submittedAt,
      lastSavedAt: previous.lastSavedAt,
    },
  };
  const list = [...(previous.valueHistory ?? []), entry];
  const capped =
    list.length <= VALUE_HISTORY_CAP ? list : [list[0]!, ...list.slice(list.length - (VALUE_HISTORY_CAP - 1))];
  return { ...next, valueHistory: capped };
}

function stripLegacyOnBehalf(item: ItemAnswer): ItemAnswer {
  if (item.answeredOnBehalfBy === undefined) return item;
  return { ...item, answeredOnBehalfBy: undefined };
}

function withLegacyStoredHistory(previous: ItemAnswer | undefined, next: ItemAnswer): ItemAnswer {
  if (previous?.history === next.history) return next;
  return { ...next, history: previous?.history };
}

/* ────────────────────────── the four Stage-2 write functions ────────────── */

export async function upsertItemAnswer(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  item: ItemAnswer
): Promise<{ ok: true } | { ok: false; error: string }> {
  return performAnswerWrite(
    directoryHandle,
    monthFolderName,
    username,
    item.xrayImageId,
    () => ({
      event: {
        eventType: "item-saved",
        eventBy: username,
        authority: "self",
        xrayImageId: item.xrayImageId,
        answers: item.answers,
        status: item.status,
        submittedAt: item.submittedAt,
        templateId: item.templateId,
        templateVersion: item.templateVersion,
        lastSavedAt: item.lastSavedAt,
        // `answeredOnBehalfBy` deliberately never copied from `item` here: every
        // ordinary save strips it (foldSelfSave), so a client cannot forge
        // attribution through this path — matching the pre-Stage-2 `stripOnBehalf`.
      },
    }),
    "answer-save"
  );
}

/**
 * Write an answer that a user OTHER than the assignee authored — the
 * `answer-on-behalf` feature. See `performOnBehalfWrite` for the
 * append-then-confirm protocol (§5) this now goes through: the event is always
 * appended durably, then a single-item fold under the true `(eventAt,
 * authority, eventId)` order (§4) decides whether it actually took effect.
 *
 * Refuses BEFORE any read or append when no author is named — this guard has
 * no fold-level equivalent (the fold cannot express "refuse to append at
 * all"), so it has to live here, ahead of everything else.
 */
export async function upsertItemAnswerOnBehalf(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assigneeUsername: string,
  item: ItemAnswer,
  authorUsername: string,
  reason = ""
): Promise<{ ok: true } | { ok: false; error: string }> {
  const author = authorUsername.trim();
  if (author === "") {
    return {
      ok: false,
      error: "تعذر حفظ الإجابة نيابةً عن الموظف: لم يُحدَّد المستخدم الذي قام بالإجابة.",
    };
  }
  if (sameUser(author, assigneeUsername)) {
    // Not on behalf of anyone — the assignee answering their own sample.
    return upsertItemAnswer(directoryHandle, monthFolderName, assigneeUsername, item);
  }
  return performOnBehalfWrite(directoryHandle, monthFolderName, assigneeUsername, item, author, reason);
}

/**
 * §5's append-then-confirm on-behalf write.
 *
 * 1. Append the `item-saved` event unconditionally — no pre-check, no
 *    read-then-refuse. The fold itself already encodes the ONLY refusal rule
 *    (`previous?.status === "submitted"` at this event's place in true fold
 *    order), and a refused event provably changes nothing in the folded item
 *    state either way (`applyAnswerEvent` returns `undefined` for it), so
 *    skipping the append buys nothing.
 * 2. Re-fold this employee's events FRESH from disk — including the event
 *    just appended — with the SAME comparator the full fold uses (there is
 *    only one, `compareAnswerEventsForFold`), and check whether THIS event's
 *    id landed in `refusals`.
 *
 * In every single-writer scenario this reproduces the pre-Stage-2 synchronous
 * refusal exactly (the freshly-read state IS the state the old code would have
 * checked), and it additionally closes round 2's Finding 3: a genuinely
 * concurrent self-save that lands between the read and the append is now
 * caught by the confirm step instead of silently losing the race unnoticed.
 */
async function performOnBehalfWrite(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  assigneeUsername: string,
  item: ItemAnswer,
  author: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureMonthWritable(directoryHandle, monthFolderName);
  const eventId = crypto.randomUUID();
  const eventAt = nextAnswerEventAt();
  const writer = answerWriterIdentity(directoryHandle, monthFolderName);
  const xrayImageId = item.xrayImageId;

  const result = await casLoop<{ ok: true } | { ok: false; error: string }>(
    async () => {
      const mainDir = await getSampleMainDir(directoryHandle, monthFolderName, true);
      const beforeEvents = await readAllAnswerEventsForMonth(directoryHandle, monthFolderName);
      const ownBefore = eventsForEmployee(beforeEvents, assigneeUsername);
      // `legacySeed` from `resolveSeed` is not used here — the confirm step
      // below re-derives it fresh (`confirmSeed`) from a post-append read, so
      // the pre-append copy would only be a stale duplicate.
      const { seedEvent } = await resolveSeed(
        directoryHandle,
        monthFolderName,
        assigneeUsername,
        ownBefore,
        eventId,
        eventAt
      );

      const onBehalfEvent: AnswerEvent = {
        eventId,
        eventType: "item-saved",
        eventAt,
        eventBy: author,
        authority: "supervisor",
        xrayImageId,
        answers: item.answers,
        status: item.status,
        submittedAt: item.submittedAt,
        templateId: item.templateId,
        templateVersion: item.templateVersion,
        lastSavedAt: item.lastSavedAt,
        answeredBy: assigneeUsername,
        answeredOnBehalfBy: author,
        reason,
      };
      const batch = seedEvent ? [seedEvent, onBehalfEvent] : [onBehalfEvent];
      await appendAnswerEventSegment(mainDir, batch, writer);
      reflectLocalAppendInAnswerEventsCache(directoryHandle, monthFolderName, batch);

      // CONFIRM (§5): fresh read, same comparator, SINGLE-ITEM scope — the
      // exact slice `foldSingleItem` narrows to (migration-seed events plus
      // this one `xrayImageId`'s own), replicated inline rather than calling
      // it directly because `foldSingleItem` returns only the folded
      // `ItemAnswer`, not the `refusals` list this confirmation needs to know
      // whether THIS eventId specifically won or lost. `requireMigrationSeed:
      // false` matches `foldSingleItem`'s own default for the same reason it
      // documents: this call is confirming its own just-appended event
      // against a slice it narrowed itself, not reading a whole chain.
      const afterEvents = await readAllAnswerEventsForMonth(directoryHandle, monthFolderName);
      const ownAfter = eventsForEmployee(afterEvents, assigneeUsername);
      const scopedToItem = ownAfter.filter(
        (candidate) => candidate.eventType === "migration-seed" || candidate.xrayImageId === xrayImageId
      );
      const legacyForConfirm = await loadLegacyAnswersFile(directoryHandle, monthFolderName, assigneeUsername);
      const confirmSeed: AnswerLegacySeed = {
        contentHash: legacyContentHashOf(legacyForConfirm),
        items: (legacyForConfirm?.items ?? []).filter((item) => item.xrayImageId === xrayImageId),
      };
      const confirmed = foldEmployeeEvents(scopedToItem, {
        legacySeed: confirmSeed,
        username: assigneeUsername,
        monthFolderName,
        requireMigrationSeed: false,
      });
      const refused = confirmed.refusals.some((refusal) => refusal.eventId === eventId);
      if (refused) {
        return {
          done: true,
          result: {
            ok: false as const,
            error:
              "لا يمكن الإجابة نيابةً عن الموظف: تم تقديم إجابة لهذه العينة بالفعل. أعد فتح الإجابة أولاً إذا لزم تصحيحها.",
          },
        };
      }
      return { done: true, result: { ok: true as const } };
    },
    {
      context: "answers:answer-save-on-behalf",
      maxRetries: ANSWER_SAVE_MAX_RETRIES,
      baseDelayMs: ANSWER_SAVE_BASE_DELAY_MS,
      // One budget for this whole user action. Without it the 14 attempts above
      // multiply against safeWriteJson's two ~11 s verify-readback ladders —
      // ~308 s, the "answer save takes 4 minutes" report. See
      // operationDeadline.ts; the first attempt always runs regardless.
      deadline: createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "answers:interactive-write"),
      conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ الإجابة نيابةً عن الموظف بعد عدة محاولات.",
      onExhausted: (cause, code) => {
        logError("answerStorage:answer-save-on-behalf", cause instanceof Error ? cause : new Error(String(cause)), {
          action: "answer-save-on-behalf",
          errorCode: code,
        });
      },
    }
  );
  if (result.ok) await refreshAnswerCacheAfterWrite(directoryHandle, monthFolderName);
  return result;
}

/**
 * Reopen a submitted answer for correction (Tier-1 Item D).
 * Idempotent: if the item is missing or not "submitted", this is a no-op —
 * nothing is appended.
 */
export async function reopenItemAnswer(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  xrayImageId: string,
  reopenedBy: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return performAnswerWrite(
    directoryHandle,
    monthFolderName,
    username,
    xrayImageId,
    ({ previous }) => {
      if (!previous || previous.status !== "submitted") return { skip: true };
      return {
        event: {
          eventType: "item-reopened",
          eventBy: reopenedBy,
          authority: "supervisor",
          xrayImageId,
          reason,
        },
      };
    },
    "answer-reopen"
  );
}

/**
 * Set (or clear, on an empty/whitespace-only string) a supervisor coaching
 * note on one item (P2-2). Idempotent no-op when the item doesn't exist yet.
 */
export async function setItemQualityNote(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  xrayImageId: string,
  qualityNote: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return performAnswerWrite(
    directoryHandle,
    monthFolderName,
    username,
    xrayImageId,
    ({ previous }) => {
      if (!previous) return { skip: true };
      return {
        event: {
          eventType: "quality-note-set",
          eventBy: username,
          authority: "self",
          xrayImageId,
          qualityNote,
        },
      };
    },
    "quality-note-save"
  );
}

/* ────────────────────────── request-queue append helpers ────────────────── */

/** Idempotently append a referral request to the originating employee's personal file. */
export async function appendReferralToEmployee(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReferralRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const username = request.fromEmployee;
    return await updateEmployeeRequestsFile(directoryHandle, monthFolderName, username, (file) => {
      if (file.referralRequests?.some((r) => r.requestId === request.requestId)) return file;
      return { ...file, referralRequests: [...(file.referralRequests ?? []), request] };
    }, "referral-request-append");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "خطأ غير معروف." };
  }
}

/** Idempotently append a replacement request to the requesting employee's personal file. */
export async function appendReplacementToEmployee(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReplacementRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const username = request.employeeUsername;
    return await updateEmployeeRequestsFile(directoryHandle, monthFolderName, username, (file) => {
      if (file.replacementRequests?.some((r) => r.requestId === request.requestId)) return file;
      return { ...file, replacementRequests: [...(file.replacementRequests ?? []), request] };
    }, "replacement-request-append");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "خطأ غير معروف." };
  }
}

/** Idempotently append a reopen-case request to the requesting employee's personal file. */
export async function appendReopenToEmployee(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReopenRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const username = request.employeeUsername;
    return await updateEmployeeRequestsFile(directoryHandle, monthFolderName, username, (file) => {
      if (file.reopenRequests?.some((r) => r.requestId === request.requestId)) return file;
      return { ...file, reopenRequests: [...(file.reopenRequests ?? []), request] };
    }, "reopen-request-append");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "خطأ غير معروف." };
  }
}

/* ───────────────────────── loadAllEmployeeFiles fan-out (§7 Finding 5c) ─── */

const STEM_SUFFIXES = [ANSWERS_SUFFIX, REQUESTS_SUFFIX] as const;

function stemOf(name: string): string | null {
  for (const suffix of STEM_SUFFIXES) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return null;
}

/** Every filename stem in the per-employee answers directory (`.answers.json` and `.requests.json`). */
async function listAnswerDirStems(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<Set<string>> {
  const stems = new Set<string>();
  let dir: DirectoryHandleLike;
  try {
    dir = await getAnswersDir(directoryHandle, monthFolderName);
  } catch (error) {
    // A month with no answers directory at all is a FACT about the data, and
    // stays absence. (`getAnswersDir` opens with `create: true`, so this is
    // reachable only on a workspace that refuses the create.)
    if (isNotFoundError(error)) return stems;
    logError("answerStorage:listAnswerDirStems", error);
    throw error;
  }
  try {
    for (const entry of await listDirectoryEntries(dir)) {
      if (entry.kind !== "file") continue;
      const stem = stemOf(entry.name);
      if (stem) stems.add(stem);
    }
  } catch (error) {
    // Never a PARTIAL set. The stems this returns are the set of employees the
    // caller will report on, so a listing that died halfway handed a supervisor
    // a month in which every employee it never reached had simply done no work
    // — logged, but on screen indistinguishable from the truth.
    logError("answerStorage:listAnswerDirStems", error);
    throw error;
  }
  return stems;
}

/** Every distinct employee named by ANY event in the month's flat answer event log. */
function employeeUsernamesFromEvents(events: readonly AnswerEvent[]): Set<string> {
  const usernames = new Set<string>();
  for (const event of events) {
    const raw = event.answeredBy;
    if (raw && raw.trim().length > 0) usernames.add(raw);
  }
  return usernames;
}

/**
 * Read all employee answer files for the month (used by supervisor/admin
 * aggregation) — full item state included.
 *
 * Converted (§7 Finding 5c) from a raw `*.answers.json` directory scan into an
 * enumerate-then-`loadEmployeeAnswers` fan-out: the candidate set is the union
 * of `*.answers.json` stems, `*.requests.json` stems, and every username named
 * by an event in `answers.events/` (an employee who migrated may have no
 * `.answers.json`/`.requests.json` of their own at all). Preserves the
 * existing `onUnreadable: "skip"` per-employee isolation: one employee whose
 * legacy file is corrupt, or whose segment chain fails to fold, is skipped and
 * logged rather than aborting the whole scan.
 */
export async function loadAllEmployeeFiles(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<EmployeeAnswerFile[]> {
  try {
    const [dirStems, allEvents] = await Promise.all([
      listAnswerDirStems(directoryHandle, monthFolderName),
      readAllAnswerEventsForMonth(directoryHandle, monthFolderName).catch((error: unknown) => {
        logError("answerStorage:loadAllEmployeeFiles:events", error);
        return [] as AnswerEvent[];
      }),
    ]);
    const usernames = new Set<string>([...dirStems, ...employeeUsernamesFromEvents(allEvents)]);

    const files: EmployeeAnswerFile[] = [];
    for (const username of usernames) {
      try {
        const [itemState, requests] = await Promise.all([
          loadEmployeeItemState(directoryHandle, monthFolderName, username, allEvents),
          loadEmployeeRequestsFile(directoryHandle, monthFolderName, username),
        ]);
        files.push({
          username,
          monthFolderName,
          revision: requests.revision ?? 0,
          items: itemState.items,
          referralRequests: requests.referralRequests,
          replacementRequests: requests.replacementRequests,
          reopenRequests: requests.reopenRequests,
          lastUpdatedAt: requests.lastUpdatedAt,
        });
      } catch (error) {
        logError("answerStorage:loadAllEmployeeFiles:employee", error, { action: username });
      }
    }
    return files.sort((a, b) => a.username.localeCompare(b.username));
  } catch (err) {
    // Rethrown, not folded into `[]`. The per-employee `catch` above is the
    // deliberate isolation policy — one employee's unreadable file must not
    // abort the scan — and it is unaffected. This outer one is different: it
    // fires when the SCAN ITSELF could not be established, and returning an
    // empty array there tells every caller (the results view, the executive
    // report, the Power BI export, a backup) that nobody answered anything all
    // month. Callers already handle a rejection; none of them can handle a lie.
    logError("answerStorage:loadAllEmployeeFiles", err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}

/** The subset of `EmployeeAnswerFile` the requests-only fast path below returns. */
export type EmployeeRequestQueues = Pick<
  EmployeeAnswerFile,
  "username" | "monthFolderName" | "referralRequests" | "replacementRequests" | "reopenRequests"
>;

/**
 * Requests-only fast path (§7 Finding 5c): reads `*.requests.json` (and the
 * legacy embedded-array fallback for a not-yet-migrated employee) ONLY — never
 * opens `answers.events/`, never folds a single event. For a caller that only
 * needs the three request queues (today: `referralStorage.loadRequestLogs`,
 * the entire supervisor referral/replacement/reopen-approval surface), this is
 * the read-cost reduction the fan-out above was built to enable: it genuinely
 * drops to per-employee small-file reads instead of rising to a full
 * item-segment fold it never needed.
 *
 * Candidate usernames come from the SAME directory listing
 * `loadAllEmployeeFiles` uses (`.answers.json` ∪ `.requests.json` stems) —
 * deliberately NOT unioned with event-log usernames, since an employee who has
 * ONLY answer segments and no request of any kind contributes nothing this
 * function returns anyway.
 */
export async function loadAllEmployeeRequestFiles(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<EmployeeRequestQueues[]> {
  try {
    const stems = await listAnswerDirStems(directoryHandle, monthFolderName);
    const files: EmployeeRequestQueues[] = [];
    for (const username of stems) {
      try {
        const requests = await loadEmployeeRequestsFile(directoryHandle, monthFolderName, username);
        files.push({
          username,
          monthFolderName,
          referralRequests: requests.referralRequests,
          replacementRequests: requests.replacementRequests,
          reopenRequests: requests.reopenRequests,
        });
      } catch (error) {
        logError("answerStorage:loadAllEmployeeRequestFiles:employee", error, { action: username });
      }
    }
    return files.sort((a, b) => a.username.localeCompare(b.username));
  } catch (err) {
    // Same reasoning as the sibling above: an unestablished scan is not an
    // empty set of request queues.
    logError(
      "answerStorage:loadAllEmployeeRequestFiles",
      err instanceof Error ? err : new Error(String(err))
    );
    throw err;
  }
}
