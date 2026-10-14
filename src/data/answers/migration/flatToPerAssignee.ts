// src/data/answers/migration/flatToPerAssignee.ts
//
// ONE-TIME, ADMIN-CONFIRMED migration of a month's flat `answers.events/` (v1)
// into per-assignee folders (v2) — spec 2026-10-13 §6 and CLAUDE.md's
// post-launch migration policy: offered on admin sign-in, never automatic,
// archives every original (moves to `_archive-v1/`), never deletes.
//
// Crash-safe by construction: `_layout.json` (the commit point) is written
// LAST. Before it exists the month is v1 (`v1-migrating` while the lock is
// fresh or `_archive-v1/` holds moved files): v1 readers read flat + `_archive-v1/`, writers defer.
// Unreadable flat segments on a first run are decided (`onUnreadable`) after the
// read-only phase and before the first write, so "postpone" moves nothing.
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import {
  appendEventSegment,
  chunkEventsForSegmentAppends,
  utf8Length,
  type AppendOnlyEventLogConfig,
  type SegmentWriterIdentity,
} from "../../storage/appendOnlyEventLog";
import { casLoop, readBackOwnWrite } from "../../storage/casLoop";
import { mapWithConcurrency } from "../../storage/concurrency";
import { DIRECTORY_READ_CONCURRENCY, listDirectoryEntries } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { bumpWorkspaceEpoch, workspaceScopeId } from "../../storage/inFlightReads";
import { unwrap, wrap, type JsonEnvelope } from "../../storage/jsonEnvelope";
import { moveFileVerified } from "../../storage/moveFileVerified";
import { isNotFoundError } from "../../storage/transientFileErrors";
import { readFileTextWithRetry, safeReadJson, safeRemoveJson, safeWriteJson } from "../../storage/safeWrite";
import { getDistributionDeviceId } from "../../distribution/distributionEventStore";
import {
  ANSWER_EVENTS_FOLDERS,
  answerAssigneeFolderName,
  getAnswerArchiveV1Dir,
  getAnswerEventsDir,
  getAnswerEventsLayout,
  getAssigneeAnswerEventsDir,
  MIGRATION_LOCK_STALE_MS,
  noteAnswerEventsLayoutV2,
} from "../../workspace/workspacePaths";

export { MIGRATION_LOCK_STALE_MS };
import { ANSWER_EVENT_LOG, ANSWER_EVENT_SEGMENT_SUFFIX, sortAnswerEventsForFold, type AnswerEvent } from "../answerEventStore";
import { clearAnswerEventsCache, foldEmployeeEvents, loadLegacyAnswerSeed } from "../answerStorage";
import { v1OffsetKey } from "../v2/answerSnapshot";
import { readAnswerEventsLayoutMarker, writeAnswerEventsLayoutMarker, type AnswerEventsLayoutMarker } from "../v2/answerEventsLayout";
import { listAssigneeFolders } from "../v2/assigneeEventReader";
import { rebuildAndPersistAssigneeSnapshot } from "../v2/rebuildAssigneeSnapshot";

/** Minimum spacing between lock heartbeats (progress steps can number in the thousands). */
export const MIGRATION_LOCK_HEARTBEAT_MS = 30 * 1000;
export const MIGRATION_MS_PER_SEGMENT_ESTIMATE = 150;
const MAX_STRAGGLER_PASSES = 3;

export type MigrationPhase = "lock" | "read" | "archive" | "snapshot" | "move" | "stragglers" | "commit" | "verify";
export type MigrationProgress = { phase: MigrationPhase; done: number; total: number };
export type UnreadableDecision = "finish" | "postpone";
export type MigrateMonthOptions = {
  actor: string;
  nowMs?: () => number;
  onProgress?: (progress: MigrationProgress) => void | Promise<void>;
  /**
   * Asked ONCE, on a month's first (v1 → v2) run, after every flat segment was
   * read and BEFORE anything is written or moved, when some segments could not
   * be opened. "finish" commits with those names in `unfolded` (their answers
   * stay invisible to v2 readers until a re-run opens them); "postpone" (the
   * default when absent) returns `postponed` with nothing moved: the month is
   * still plain v1, readable and writable, and is offered again next sign-in.
   * Never asked on a v2 straggler re-run, where nothing new is hidden.
   */
  onUnreadable?: (names: readonly string[]) => Promise<UnreadableDecision>;
  /**
   * Round 7: take over the FRESH lock carrying exactly this run token (from a
   * prior `locked-elsewhere` result with `takeoverAllowed`), after the admin
   * confirmed. Honoured only while that lock is still this admin's own from
   * this device, or its heartbeat is silent for MIGRATION_LOCK_SILENT_MS. A
   * different token (someone else took the lock since) is never taken.
   */
  takeOverLockToken?: string;
};
export type MigrateMonthResult =
  | {
      status: "migrated";
      marker: AnswerEventsLayoutMarker;
      quarantinedLines: number;
      /** Flat segments still in place (folded-but-stuck AND unfolded). Mirrors marker.unmovable. */
      unmovable: string[];
      /**
       * Flat segments whose events are NOT in any assignee folder (could not be
       * opened, or landed after the last listing). Invisible to v2 readers until
       * a re-run folds them; the probe re-offers the month while they exist.
       */
      unfolded: string[];
    }
  | { status: "nothing-to-do" }
  /**
   * `self`: the lock is this admin's own, from this device (never "another device").
   * `takeoverAllowed`: self, or the holder's heartbeat is silent for MIGRATION_LOCK_SILENT_MS;
   * pass `token` back as `takeOverLockToken` after the admin confirms.
   */
  | { status: "locked-elsewhere"; by: string; startedAt: string; lastSeenAt: string; self: boolean; takeoverAllowed: boolean; token: string }
  /** Option C: unreadable flat segments and the admin postponed — nothing was moved or written. */
  | { status: "postponed"; unreadable: string[] };

export type QuarantinedLine = { segment: string; line: number; raw: string; reason: "unparseable" | "no-assignee" };
type AssigneeGroup = { assignee: string; events: AnswerEvent[]; segments: Map<string, number> };

/**
 * `token` is the RUN token (one per migrateMonthToPerAssignee call), not the
 * casLoop write token: only the run that took the lock may reuse it while it is
 * fresh — the same admin on the same device in another tab or a later run
 * cannot (review finding 6). Freshness is measured from `heartbeatAt` (falling
 * back to `startedAt` for locks written before it existed).
 */
type MigrationLock = { by: string; deviceId: string; startedAt: string; heartbeatAt?: string; token: string; revision: number; abandoned?: boolean; _writeToken?: string };

/**
 * Run tokens of runs that ENDED in this tab (success or failure). A lock that
 * still carries one of these, because its removal failed on the share, is
 * known-dead and may be taken over at once by the same admin on this device
 * (round 7: the owner's retry was otherwise blocked for 30 minutes).
 */
const endedRunTokens = new Set<string>();

/** @internal tests: a fresh page (another tab) has no memory of ended runs. */
export function __forgetEndedMigrationRunsForTests(): void {
  endedRunTokens.clear();
}

/** Thrown when the lock file itself cannot be written (acquisition exhausted its retries). */
export class MigrationLockWriteError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MigrationLockWriteError";
  }
}

/** Thrown when no heartbeat landed for half the stale window: the lock is about to look abandoned. */
export class MigrationLockHeartbeatError extends Error {
  constructor(cause?: unknown) {
    super("answers migration lock heartbeat kept failing", cause === undefined ? undefined : { cause });
    this.name = "MigrationLockHeartbeatError";
  }
}

function lockLastSeenMs(lock: MigrationLock): number {
  return Math.max(Date.parse(lock.startedAt) || 0, Date.parse(lock.heartbeatAt ?? "") || 0);
}

/** Pure: spec §6 step 2's grouping. Exported for its own test. */
export function groupFlatSegmentLines(
  segments: readonly { name: string; bytes: number; text: string }[]
): { groups: Map<string, AssigneeGroup>; quarantined: QuarantinedLine[] } {
  const groups = new Map<string, AssigneeGroup>();
  const quarantined: QuarantinedLine[] = [];
  for (const segment of segments) {
    segment.text.split("\n").forEach((raw, line) => {
      if (raw.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        quarantined.push({ segment: segment.name, line, raw, reason: "unparseable" });
        return;
      }
      if (!parsed || typeof parsed !== "object") {
        quarantined.push({ segment: segment.name, line, raw, reason: "unparseable" });
        return;
      }
      const event = parsed as AnswerEvent;
      // answeredBy ONLY (v154.0 review finding 6): v1's eventsForEmployee matched
      // nothing else, so an event without it was invisible to every v1 reader.
      // Falling back to eventBy would surface it in e.g. a supervisor's folder;
      // instead it is quarantined (archived verbatim, never deleted). Every
      // production writer sets answeredBy (performAnswerWrite, on-behalf, seed).
      const owner = (event.answeredBy ?? "").trim();
      let folder: string;
      try {
        folder = answerAssigneeFolderName(owner);
      } catch {
        quarantined.push({ segment: segment.name, line, raw, reason: "no-assignee" });
        return;
      }
      const group = groups.get(folder) ?? { assignee: owner, events: [], segments: new Map<string, number>() };
      group.events.push(event);
      group.segments.set(segment.name, segment.bytes);
      groups.set(folder, group);
    });
  }
  return { groups, quarantined };
}

type LockVerdict = { ok: true } | { ok: false; by: string; startedAt: string; lastSeenAt: string; self: boolean; takeoverAllowed: boolean; token: string };

/**
 * A holder whose heartbeat (every <= MIGRATION_LOCK_HEARTBEAT_MS while it runs)
 * has been silent this long has almost certainly died: an admin may take its
 * lock over after confirming, instead of waiting MIGRATION_LOCK_STALE_MS.
 */
export const MIGRATION_LOCK_SILENT_MS = 3 * 60 * 1000;

/**
 * May this run take over a FRESH lock it does not own? Silently: only this
 * admin's own lock from this device whose run is known to have ended (in this
 * tab, or marked `abandoned` by its failed release). After the admin confirmed
 * that exact token: their own lock, or anyone's whose heartbeat is silent for
 * MIGRATION_LOCK_SILENT_MS. A live holder's lock is never taken (finding 6).
 */
function isOwnLock(held: MigrationLock, actor: string, deviceId: string): boolean {
  return held.by === actor && held.deviceId === deviceId;
}

function mayTakeOverLock(held: MigrationLock, actor: string, deviceId: string, nowMs: number, confirmedToken: string | undefined): boolean {
  const own = isOwnLock(held, actor, deviceId);
  if (own && (held.abandoned === true || endedRunTokens.has(held.token))) return true;
  if (confirmedToken !== held.token) return false;
  return own || nowMs - lockLastSeenMs(held) >= MIGRATION_LOCK_SILENT_MS;
}

async function acquireMigrationLock(
  eventsDir: DirectoryHandleLike,
  actor: string,
  nowMs: number,
  runToken: string,
  takeOverLockToken: string | undefined
): Promise<LockVerdict> {
  const name = ANSWER_EVENTS_FOLDERS.migrationLock;
  const deviceId = getDistributionDeviceId();
  let lastCause: unknown;
  const outcome = await casLoop<LockVerdict>(
    async (writeToken) => {
      const existing = await safeReadJson<JsonEnvelope<MigrationLock>>(eventsDir, name);
      const held = existing.ok ? unwrap<MigrationLock>(existing.value) : null;
      const fresh = held !== null && nowMs - lockLastSeenMs(held) < MIGRATION_LOCK_STALE_MS;
      if (held && fresh && held.token !== runToken && !mayTakeOverLock(held, actor, deviceId, nowMs, takeOverLockToken)) {
        const self = isOwnLock(held, actor, deviceId);
        const lastSeenMs = lockLastSeenMs(held);
        return { done: true, result: { ok: false, by: held.by, startedAt: held.startedAt, lastSeenAt: new Date(lastSeenMs).toISOString(), self, takeoverAllowed: self || nowMs - lastSeenMs >= MIGRATION_LOCK_SILENT_MS, token: held.token } };
      }
      const previousRevision = held?.revision ?? 0;
      const nowIso = new Date(nowMs).toISOString();
      const next: MigrationLock = { by: actor, deviceId, startedAt: nowIso, heartbeatAt: nowIso, token: runToken, revision: previousRevision + 1, _writeToken: writeToken };
      try {
        const written = await safeWriteJson(eventsDir, name, wrap(next, previousRevision));
        const verdict = await readBackOwnWrite(
          written,
          () => safeReadJson<JsonEnvelope<MigrationLock>>(eventsDir, name),
          (verify) => verify.ok && unwrap<MigrationLock>(verify.value)._writeToken === writeToken,
          "answers:migration-lock"
        );
        return verdict === "not-mine" ? { done: false } : { done: true, result: { ok: true } };
      } catch (error) {
        lastCause = error;
        throw error;
      }
    },
    { context: "answers:migration-lock", maxRetries: 3, baseDelayMs: 150 }
  );
  // Round 7 field report: this used to be a plain `new Error(text)`, which the
  // migration dialog could only show as "unexpected error".
  if ("error" in outcome) throw new MigrationLockWriteError(outcome.error, lastCause);
  return outcome;
}

class MigrationLockLostError extends Error {
  constructor(by: string | null) {
    super(by ? `answers migration lock lost to ${by}` : "answers migration lock lost");
    this.name = "MigrationLockLostError";
  }
}

/**
 * Refreshes `heartbeatAt` on our lock (throttled by MIGRATION_LOCK_HEARTBEAT_MS
 * unless `force`). Throws MigrationLockLostError only when the lock is
 * VERIFIABLY gone or carries another run's token — a stale takeover happened,
 * so this run must not keep moving files or commit.
 *
 * Round 7 field report: a heartbeat whose REPLACE the share refused (the lock
 * is read by every v154 client's layout probe, so it is often open elsewhere)
 * used to abort the whole month mid-archive. A failed read or write is now
 * logged and retried on the next progress step; the run gives up
 * (MigrationLockHeartbeatError) only once no heartbeat has landed for half of
 * MIGRATION_LOCK_STALE_MS, i.e. well before another admin could see the lock
 * as abandoned and take it over.
 */
function createLockHeartbeat(eventsDir: DirectoryHandleLike, runToken: string, now: () => number) {
  let lastAttemptMs = now();
  let lastLandedMs = lastAttemptMs;
  return async (force = false): Promise<void> => {
    const nowMs = now();
    if (!force && nowMs - lastAttemptMs < MIGRATION_LOCK_HEARTBEAT_MS) return;
    lastAttemptMs = nowMs;
    let failure: unknown;
    try {
      const read = await safeReadJson<JsonEnvelope<MigrationLock>>(eventsDir, ANSWER_EVENTS_FOLDERS.migrationLock);
      if (!read.ok && read.reason === "missing") throw new MigrationLockLostError(null);
      if (read.ok) {
        const held = unwrap<MigrationLock>(read.value);
        if (held.token !== runToken) throw new MigrationLockLostError(held.by);
        const next: MigrationLock = { ...held, heartbeatAt: new Date(nowMs).toISOString(), revision: held.revision + 1 };
        await safeWriteJson(eventsDir, ANSWER_EVENTS_FOLDERS.migrationLock, wrap(next, held.revision));
        lastLandedMs = nowMs;
        return;
      }
      failure = new Error("answers migration lock unreadable (corrupt)");
    } catch (error) {
      if (error instanceof MigrationLockLostError) throw error;
      failure = error;
    }
    logError("answers:migration-lock-heartbeat", failure);
    if (nowMs - lastLandedMs > MIGRATION_LOCK_STALE_MS / 2) throw new MigrationLockHeartbeatError(failure);
  };
}

/**
 * Best-effort, never throws: drop the lock if it is still ours (siblings first,
 * see safeRemoveJson). When the share refuses the delete, try to mark it
 * `abandoned` so this admin can take it over at once from another tab; either
 * way the run token is remembered as ended in this tab.
 */
async function releaseLockIfOurs(eventsDir: DirectoryHandleLike, runToken: string): Promise<void> {
  endedRunTokens.add(runToken);
  try {
    const read = await safeReadJson<JsonEnvelope<MigrationLock>>(eventsDir, ANSWER_EVENTS_FOLDERS.migrationLock);
    if (!read.ok) return;
    const held = unwrap<MigrationLock>(read.value);
    if (held.token !== runToken) return;
    const removed = await safeRemoveJson(eventsDir, ANSWER_EVENTS_FOLDERS.migrationLock);
    if (removed.ok || !removed.remaining.includes(ANSWER_EVENTS_FOLDERS.migrationLock)) return;
    await safeWriteJson(eventsDir, ANSWER_EVENTS_FOLDERS.migrationLock, wrap({ ...held, abandoned: true, revision: held.revision + 1 }, held.revision));
  } catch (error) {
    logError("answers:migration-lock-release", error);
  }
}

async function listFlatSegmentNames(eventsDir: DirectoryHandleLike): Promise<string[]> {
  return (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX))
    .map((entry) => entry.name)
    .sort();
}

type FlatRead =
  | { status: "ok"; name: string; bytes: number; text: string }
  | { status: "missing"; name: string }
  | { status: "unopenable"; name: string };

async function readFlatSegments(eventsDir: DirectoryHandleLike, names: readonly string[], options: MigrateMonthOptions): Promise<FlatRead[]> {
  let done = 0;
  const reads = await mapWithConcurrency(names, DIRECTORY_READ_CONCURRENCY, async (name): Promise<FlatRead> => {
    try {
      const text = await readFileTextWithRetry(eventsDir, name);
      return text === null ? { status: "missing", name } : { status: "ok", name, bytes: utf8Length(text), text };
    } catch (error) {
      logError("answers:migration:unopenable", error, { action: name });
      return { status: "unopenable", name };
    }
  });
  // Progress is reported after every read finished, so a crash injected at
  // "read" happens before any write (spec §6 step 2).
  while (done < reads.length) {
    done += 1;
    await options.onProgress?.({ phase: "read", done, total: reads.length });
  }
  return reads;
}

function migrationWriter(root: DirectoryHandleLike, month: string, folder: string, kind: "v1merge" | "quarant"): { writer: SegmentWriterIdentity; config: AppendOnlyEventLogConfig } {
  return {
    // Scoped per folder: the module-level seq memos are keyed on scopeId.
    writer: { deviceId: kind, sessionId: "migrat", scopeId: `${workspaceScopeId(root)}|${month}|${folder}|${kind}`, stable: false },
    config: {
      ...ANSWER_EVENT_LOG,
      consumerNamespace: "ansmig",
      eventsDirName: kind === "v1merge" ? ANSWER_EVENTS_FOLDERS.assigneeArchive : ANSWER_EVENTS_FOLDERS.quarantine,
      baseNamePrefix: kind === "v1merge" ? "v1" : "unparsed-v1",
    },
  };
}

/**
 * Round 7 (resume): parsed lines already present in `{parent}/{child}/`. A
 * rerun after a crash re-reads every flat segment still in place (it must, to
 * move it with a verified byte count), but appends only what an earlier run
 * did not already write -- so reruns never grow an assignee's archive or the
 * quarantine. A missing folder is "nothing written yet"; any other read
 * failure propagates (never mistake "could not look" for "empty").
 */
async function readWrittenLines(parent: DirectoryHandleLike, child: string): Promise<unknown[]> {
  let dir: DirectoryHandleLike;
  try {
    dir = await parent.getDirectoryHandle(child, { create: false });
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
  const out: unknown[] = [];
  for (const entry of await listDirectoryEntries(dir)) {
    if (entry.kind !== "file" || !entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX)) continue;
    const text = await readFileTextWithRetry(dir, entry.name);
    for (const raw of (text ?? "").split("\n")) {
      if (raw.length === 0) continue;
      try {
        out.push(JSON.parse(raw));
      } catch {
        // A torn tail line is not "written"; its event is appended again.
      }
    }
  }
  return out;
}

function eventIdOf(value: unknown): string | null {
  const id = (value as { eventId?: unknown } | null)?.eventId;
  return typeof id === "string" && id !== "" ? id : null;
}

async function appendToAssigneeArchive(root: DirectoryHandleLike, month: string, folder: string, group: AssigneeGroup): Promise<void> {
  const assigneeDir = await getAssigneeAnswerEventsDir(root, month, group.assignee, true);
  const written = new Set((await readWrittenLines(assigneeDir, ANSWER_EVENTS_FOLDERS.assigneeArchive)).map(eventIdOf).filter((id): id is string => id !== null));
  const pending = group.events.filter((event) => {
    const id = eventIdOf(event);
    if (id === null) return true;
    if (written.has(id)) return false;
    written.add(id);
    return true;
  });
  if (pending.length === 0) return;
  const { writer, config } = migrationWriter(root, month, folder, "v1merge");
  for (const chunk of chunkEventsForSegmentAppends(sortAnswerEventsForFold(pending))) {
    await appendEventSegment<AnswerEvent>(assigneeDir, chunk, writer, config);
  }
}

/** Quarantined lines are wrapped as JSON records (the raw text is kept verbatim in `raw`; the original segment itself is archived untouched in `_archive-v1/`). */
async function writeQuarantine(root: DirectoryHandleLike, month: string, eventsDir: DirectoryHandleLike, lines: readonly QuarantinedLine[], nowIso: string): Promise<void> {
  const key = (segment: unknown, line: unknown, raw: unknown) => JSON.stringify([segment, line, raw]);
  const written = new Set((await readWrittenLines(eventsDir, ANSWER_EVENTS_FOLDERS.quarantine)).map((record) => {
    const r = record as { quarantinedFrom?: unknown; line?: unknown; raw?: unknown } | null;
    return key(r?.quarantinedFrom, r?.line, r?.raw);
  }));
  const pending = lines.filter((line) => !written.has(key(line.segment, line.line, line.raw)));
  if (pending.length === 0) return;
  const { writer, config } = migrationWriter(root, month, ANSWER_EVENTS_FOLDERS.quarantine, "quarant");
  const records = pending.map((line) => ({ quarantinedFrom: line.segment, line: line.line, reason: line.reason, raw: line.raw, quarantinedAt: nowIso }));
  for (const chunk of chunkEventsForSegmentAppends(records)) await appendEventSegment(eventsDir, chunk, writer, config);
}

/**
 * `unmovable`: every flat segment left in place. `unfolded`: the subset whose
 * events never reached an assignee folder. `foldedStuck`: prior runs'
 * unmovable-but-folded names (not re-read, so not in `processed`).
 */
type MigrationState = {
  processed: Map<string, number>;
  unmovable: Set<string>;
  unfolded: Set<string>;
  foldedStuck: ReadonlySet<string>;
  moved: number;
  quarantinedLines: number;
};

async function migratePass(
  root: DirectoryHandleLike,
  month: string,
  eventsDir: DirectoryHandleLike,
  archiveV1Dir: () => Promise<DirectoryHandleLike>,
  names: readonly string[],
  state: MigrationState,
  options: MigrateMonthOptions,
  now: () => number,
  /** First v1 pass only: decides unreadable segments before the first write. */
  decideUnreadable: ((names: readonly string[]) => Promise<UnreadableDecision>) | null
): Promise<{ kind: "done" } | { kind: "postponed"; unreadable: string[] }> {
  const reads = await readFlatSegments(eventsDir, names, options);
  const fresh: { name: string; bytes: number; text: string }[] = [];
  const unopenable: string[] = [];
  for (const read of reads) {
    if (read.status === "missing") continue;
    if (read.status === "unopenable") unopenable.push(read.name);
    else if (state.processed.get(read.name) === read.bytes) state.unmovable.add(read.name); // folded, but its move keeps failing
    else fresh.push(read);
  }
  // Nothing has been written yet (reads only): a postponed run leaves the month exactly as found.
  unopenable.sort();
  if (unopenable.length > 0 && decideUnreadable && (await decideUnreadable(unopenable)) === "postpone") return { kind: "postponed", unreadable: unopenable };
  for (const name of unopenable) {
    state.unmovable.add(name);
    state.unfolded.add(name);
  }
  const { groups, quarantined } = groupFlatSegmentLines(fresh);
  if (quarantined.length > 0) {
    await writeQuarantine(root, month, eventsDir, quarantined, new Date(now()).toISOString());
    state.quarantinedLines += quarantined.length;
  }
  const blocked = await foldGroups(root, month, groups, options, now);
  // v154.0 field report: a per-assignee failure (unreadable legacy file or
  // archive segment, fold refusal) used to throw the whole month on every
  // retry. Its flat segments now stay in place as UNFOLDED — on a first run
  // the admin decides first, exactly like an unopenable segment (nothing has
  // been moved yet, so "postpone" leaves the month plain v1).
  if (blocked.length > 0 && decideUnreadable && (await decideUnreadable(blocked)) === "postpone") return { kind: "postponed", unreadable: blocked };
  const blockedSet = new Set(blocked);
  for (const name of blocked) {
    state.unmovable.add(name);
    state.unfolded.add(name);
  }
  const folded = fresh.filter((segment) => !blockedSet.has(segment.name));
  for (const segment of folded) state.processed.set(segment.name, segment.bytes);
  let done = 0;
  for (const segment of folded) {
    const archive = await archiveV1Dir();
    const outcome = await moveFileVerified(eventsDir, segment.name, archive, segment.bytes, await freeArchiveName(archive, segment.name, segment.text));
    if (outcome.status === "moved") state.moved += 1;
    done += 1;
    await options.onProgress?.({ phase: "move", done, total: folded.length });
  }
  return { kind: "done" };
}

/**
 * Archive + snapshot every assignee group. A group whose own step throws is
 * logged and skipped (never the lock-lost abort); the names of every flat
 * segment holding any of its events are returned so they stay flat.
 */
async function foldGroups(
  root: DirectoryHandleLike,
  month: string,
  groups: Map<string, AssigneeGroup>,
  options: MigrateMonthOptions,
  now: () => number
): Promise<string[]> {
  const failed = new Set<string>();
  const attempt = async (folder: string, step: () => Promise<unknown>): Promise<void> => {
    try {
      await step();
    } catch (error) {
      if (error instanceof MigrationLockLostError) throw error;
      logError("answers:migration:assignee-failed", error, { action: `${month}/${folder}` });
      failed.add(folder);
    }
  };
  let done = 0;
  for (const [folder, group] of groups) {
    await attempt(folder, () => appendToAssigneeArchive(root, month, folder, group));
    done += 1;
    await options.onProgress?.({ phase: "archive", done, total: groups.size });
  }
  done = 0;
  for (const [folder, group] of groups) {
    if (!failed.has(folder)) {
      const extraOffsets = Object.fromEntries([...group.segments].map(([name, bytes]) => [v1OffsetKey(name), bytes]));
      await attempt(folder, () => rebuildAndPersistAssigneeSnapshot(root, month, group.assignee, {
        actor: options.actor,
        loadLegacySeed: () => loadLegacyAnswerSeed(root, month, group.assignee),
        foldFn: foldEmployeeEvents,
        extraOffsets,
        nowMs: now(),
      }));
    }
    done += 1;
    await options.onProgress?.({ phase: "snapshot", done, total: groups.size });
  }
  const blocked = new Set<string>();
  for (const folder of failed) for (const name of groups.get(folder)!.segments.keys()) blocked.add(name);
  return [...blocked].sort();
}

const MAX_ARCHIVE_NAME_PROBES = 1000;

/**
 * The `_archive-v1/` name to move `name` to. The copy fallback overwrites, so
 * an existing entry with DIFFERENT bytes (a writer re-created a segment name
 * after an earlier move) must never be the target: the copy goes to
 * `{stem}.dup-{k}{suffix}` instead (still a segment name to every suffix-glob
 * reader; fold dedupes eventIds). Identical bytes reuse the name.
 */
async function freeArchiveName(archive: DirectoryHandleLike, name: string, text: string): Promise<string> {
  const stem = name.slice(0, -ANSWER_EVENT_SEGMENT_SUFFIX.length);
  for (let k = 0; k < MAX_ARCHIVE_NAME_PROBES; k += 1) {
    const candidate = k === 0 ? name : `${stem}.dup-${k}${ANSWER_EVENT_SEGMENT_SUFFIX}`;
    const existing = await readFileTextWithRetry(archive, candidate);
    if (existing === null || existing === text) return candidate;
  }
  throw new Error(`No free _archive-v1 name for ${name}`);
}

async function fileSizeOrNull(dir: DirectoryHandleLike, name: string): Promise<number | null> {
  try {
    return (await (await dir.getFileHandle(name, { create: false })).getFile()).size;
  } catch {
    return null;
  }
}

/**
 * Classify flat segments still present: folded (this run read exactly these
 * bytes, or a prior run recorded it folded-but-stuck) vs UNFOLDED (never read,
 * unopenable, or grew after it was read). Unfolded must never be hidden.
 */
async function classifyLeftovers(eventsDir: DirectoryHandleLike, names: readonly string[], state: MigrationState): Promise<void> {
  for (const name of names) {
    state.unmovable.add(name);
    if (state.unfolded.has(name)) continue;
    const processedBytes = state.processed.get(name);
    const folded = processedBytes !== undefined
      ? (await fileSizeOrNull(eventsDir, name)) === processedBytes
      : state.foldedStuck.has(name);
    if (!folded) state.unfolded.add(name);
  }
}

export async function migrateMonthToPerAssignee(
  root: DirectoryHandleLike,
  month: string,
  options: MigrateMonthOptions
): Promise<MigrateMonthResult> {
  const now = options.nowMs ?? Date.now;
  const layout = await getAnswerEventsLayout(root, month);
  if (layout === "absent") return { status: "nothing-to-do" };
  const eventsDir = await getAnswerEventsDir(root, month, false);
  const prior = layout === "v2" ? await readAnswerEventsLayoutMarker(root, month) : null;
  // A prior run's UNFOLDED segments are retried (finding 3); only its
  // folded-but-stuck ones are skipped. Re-folding an event is harmless: the
  // fold drops a duplicate eventId.
  const priorUnfolded = new Set(prior?.unfolded ?? []);
  const foldedStuck = new Set((prior?.unmovable ?? []).filter((name) => !priorUnfolded.has(name)));
  const state: MigrationState = { processed: new Map(), unmovable: new Set(foldedStuck), unfolded: new Set(), foldedStuck, moved: 0, quarantinedLines: 0 };
  const names = (await listFlatSegmentNames(eventsDir)).filter((name) => !state.unmovable.has(name));
  if (layout === "v2" && names.length === 0) return { status: "nothing-to-do" };

  await options.onProgress?.({ phase: "lock", done: 0, total: 1 });
  const runToken = crypto.randomUUID();
  const lock = await acquireMigrationLock(eventsDir, options.actor, now(), runToken, options.takeOverLockToken);
  if (!lock.ok) {
    const { ok: _ok, ...held } = lock;
    void _ok;
    return { status: "locked-elsewhere", ...held };
  }
  const heartbeat = createLockHeartbeat(eventsDir, runToken, now);
  // Every progress step doubles as the lock heartbeat (finding 6).
  const beatingOptions: MigrateMonthOptions = {
    ...options,
    onProgress: async (progress) => {
      await heartbeat();
      await options.onProgress?.(progress);
    },
  };
  try {
    const result = await runLockedMigration(root, month, eventsDir, prior, state, names, beatingOptions, now, heartbeat);
    // Postponed = nothing moved: drop our lock so the month reads as plain v1 again at once.
    // Migrated: `_layout.json` is authoritative from here (getAnswerEventsLayout checks it
    // first), so a lock the share refuses to delete can no longer fail or block the month.
    await releaseLockIfOurs(eventsDir, runToken);
    return result;
  } catch (error) {
    // The month stays v1-migrating if `_archive-v1/` holds moved files, so writers keep
    // deferring; dropping OUR lock just lets a retry start without waiting 30 min.
    await releaseLockIfOurs(eventsDir, runToken);
    throw error;
  }
}

async function runLockedMigration(
  root: DirectoryHandleLike,
  month: string,
  eventsDir: DirectoryHandleLike,
  prior: AnswerEventsLayoutMarker | null,
  state: MigrationState,
  initialNames: string[],
  options: MigrateMonthOptions,
  now: () => number,
  heartbeat: (force?: boolean) => Promise<void>
): Promise<MigrateMonthResult> {
  let names = initialNames;
  // Created LAZILY at the first move (v154.0 review finding 2): a run that dies
  // before moving anything must not leave an `_archive-v1/` that reads as
  // v1-migrating and blocks every write for the month.
  let archiveV1: DirectoryHandleLike | null = null;
  const archiveV1Dir = async (): Promise<DirectoryHandleLike> => (archiveV1 ??= await getAnswerArchiveV1Dir(root, month, true));

  // Option C (2026-10-14): on a month's FIRST run, unreadable flat segments are
  // decided before the first write. Default postpone: committing would hide
  // their answers from every v2 reader; refusing forever would leave the month
  // `v1-migrating` (saves deferred, on-behalf refused) with no admin control.
  // Later passes and v2 re-runs keep the unfolded bookkeeping (nothing new hidden).
  const decideUnreadable = prior === null ? (options.onUnreadable ?? (async () => "postpone" as const)) : null;
  for (let pass = 0; pass < MAX_STRAGGLER_PASSES && names.length > 0; pass += 1) {
    if (pass > 0) await options.onProgress?.({ phase: "stragglers", done: pass, total: MAX_STRAGGLER_PASSES - 1 });
    const outcome = await migratePass(root, month, eventsDir, archiveV1Dir, names, state, options, now, pass === 0 ? decideUnreadable : null);
    if (outcome.kind === "postponed") return { status: "postponed", unreadable: outcome.unreadable };
    names = (await listFlatSegmentNames(eventsDir)).filter((name) => !state.unmovable.has(name));
  }
  await classifyLeftovers(eventsDir, names, state);

  await options.onProgress?.({ phase: "commit", done: 0, total: 1 });
  // Never commit on a lock another run has taken over.
  await heartbeat(true);
  let marker: AnswerEventsLayoutMarker = {
    layout: "per-assignee",
    schemaVersion: 1,
    migratedAt: new Date(now()).toISOString(),
    migratedBy: options.actor,
    flatSegmentsArchived: (prior?.flatSegmentsArchived ?? 0) + state.moved,
    assignees: (await listAssigneeFolders(root, month)).length,
    unmovable: [...state.unmovable].sort(),
    unfolded: [...state.unfolded].sort(),
    origin: prior?.origin ?? "migration",
  };
  await writeAnswerEventsLayoutMarker(eventsDir, marker);
  // A writer that decided v1 before the marker can still land a flat segment
  // right after it (finding 4). One more listing: record any such straggler as
  // unfolded so the result names it and the probe re-offers the month.
  await options.onProgress?.({ phase: "verify", done: 0, total: 1 });
  const unfoldedBefore = state.unfolded.size;
  await classifyLeftovers(eventsDir, await listFlatSegmentNames(eventsDir), state);
  if (state.unfolded.size !== unfoldedBefore) {
    marker = { ...marker, unmovable: [...state.unmovable].sort(), unfolded: [...state.unfolded].sort() };
    await writeAnswerEventsLayoutMarker(eventsDir, marker);
  }
  noteAnswerEventsLayoutV2(root, month);
  bumpWorkspaceEpoch(root, month);
  clearAnswerEventsCache();
  return { status: "migrated", marker, quarantinedLines: state.quarantinedLines, unmovable: marker.unmovable, unfolded: marker.unfolded ?? [] };
}
