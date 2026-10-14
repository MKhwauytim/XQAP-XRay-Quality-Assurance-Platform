// src/data/answers/v2/assigneeEventReader.ts
//
// Layout v2 read model (spec 2026-10-13 §5): snapshot.json + live segments
// past `foldedOffsets`. Anything that makes the snapshot untrustworthy (a .bak
// recovery, corruption, a late event, a snapshot that keeps changing under the
// read) falls back to a FULL rebuild from `{assignee}/archive/` + live — never
// to "empty" (P0-1).
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import type { AppendOnlyEventLogConfig } from "../../storage/appendOnlyEventLog";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { isNotFoundError } from "../../storage/transientFileErrors";
import {
  ANSWER_EVENTS_FOLDERS,
  answerAssigneeFolderName,
  getAnswerEventsDir,
  getAssigneeAnswerEventsDir,
  isAnswerAssigneeFolderName,
} from "../../workspace/workspacePaths";
import {
  ANSWER_DERIVE_VERSION,
  ANSWER_EVENT_LOG,
  answerEventSetIdFromIds,
  foldAnswerEvents,
  readAnswerEventDelta,
  type AnswerEvent,
  type AnswerFoldResult,
  type AnswerLegacySeed,
} from "../answerEventStore";
import { foldSnapshotPlusDelta, type AnswerSnapshot, type FoldFn } from "./answerSnapshot";
import { AnswerSnapshotCorruptError, readAnswerSnapshot, sameSnapshotStat, statAnswerSnapshot, type SnapshotStat } from "./answerSnapshotStore";

export function assigneeSegmentConfig(assignee: string): AppendOnlyEventLogConfig {
  return { ...ANSWER_EVENT_LOG, eventsDirName: answerAssigneeFolderName(assignee) };
}

export function assigneeArchiveConfig(): AppendOnlyEventLogConfig {
  return { ...ANSWER_EVENT_LOG, eventsDirName: ANSWER_EVENTS_FOLDERS.assigneeArchive };
}

export type AssigneeReadOptions = {
  loadLegacySeed: () => Promise<AnswerLegacySeed>;
  foldFn?: FoldFn;
  strict?: boolean;
  tolerateConfirmedDead?: boolean;
  /** Bytes this tab already consumed past the snapshot, per BARE live name (Task 10 cache). */
  knownOffsets?: Record<string, number>;
  /** Events read from those bytes (Task 10 cache). */
  cachedDelta?: readonly AnswerEvent[];
  /** A snapshot this tab already parsed — reused while its stat is unchanged (Task 10 cache). */
  cachedSnapshot?: { stat: SnapshotStat; snapshot: AnswerSnapshot } | null;
};

export type AssigneeReadResult = {
  result: AnswerFoldResult;
  snapshot: AnswerSnapshot | null;
  snapshotStat: SnapshotStat | null;
  legacySeed: AnswerLegacySeed;
  /** Events past the snapshot (all events when `rebuilt`). */
  deltaEvents: AnswerEvent[];
  liveOffsets: Record<string, number>;
  liveSegmentNames: string[];
  unreadableNames: string[];
  rebuilt: boolean;
  archiveOffsets: Record<string, number>;
};

const MAX_SNAPSHOT_RACE_ATTEMPTS = 3;
let afterSnapshotReadHook: (() => Promise<void>) | null = null;

/** Test seam: runs between the snapshot read and the segment listing. */
export function __setAfterSnapshotReadHookForTests(hook: (() => Promise<void>) | null): void {
  afterSnapshotReadHook = hook;
}

function dedupeById(events: Iterable<AnswerEvent>): AnswerEvent[] {
  const byId = new Map<string, AnswerEvent>();
  for (const event of events) byId.set(event.eventId, event);
  return [...byId.values()];
}

/** v1's `ownEvents.length === 0` read: the legacy file's items, unfolded and unseeded. */
function passthrough(legacySeed: AnswerLegacySeed, assignee: string, month: string): AnswerFoldResult {
  return {
    file: { username: assignee, monthFolderName: month, items: legacySeed.items.map((item) => ({ ...item })) },
    markers: {}, seeded: false, foldedEventIds: [], eventSetId: answerEventSetIdFromIds([]),
    deriveVersion: ANSWER_DERIVE_VERSION, refusals: [], dropped: [],
  };
}

function bareOffsets(snapshot: AnswerSnapshot | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(snapshot?.foldedOffsets ?? {})) if (!key.includes("/")) out[key] = value;
  return out;
}

function maxOffsets(a: Record<string, number>, b: Record<string, number> | undefined): Record<string, number> {
  const out = { ...a };
  for (const [key, value] of Object.entries(b ?? {})) out[key] = Math.max(out[key] ?? 0, value);
  return out;
}

function onlyListed(offsets: Record<string, number>, names: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) if (offsets[name] !== undefined) out[name] = offsets[name]!;
  return out;
}

async function openAssigneeDir(root: DirectoryHandleLike, month: string, assignee: string): Promise<DirectoryHandleLike | null> {
  try {
    return await getAssigneeAnswerEventsDir(root, month, assignee, false);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/** Every event of one assignee: `{assignee}/archive/` + live, from byte 0, deduped by id. */
export async function readAllAssigneeEvents(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  options: { strict?: boolean; tolerateConfirmedDead?: boolean } = {}
): Promise<{ events: AnswerEvent[]; liveOffsets: Record<string, number>; liveSegmentNames: string[]; archiveOffsets: Record<string, number>; unreadableNames: string[] }> {
  const assigneeDir = await openAssigneeDir(root, month, assignee);
  if (!assigneeDir) return { events: [], liveOffsets: {}, liveSegmentNames: [], archiveOffsets: {}, unreadableNames: [] };
  const eventsDir = await getAnswerEventsDir(root, month, false);
  const [archive, live] = await Promise.all([
    readAnswerEventDelta(assigneeDir, {}, assigneeArchiveConfig(), options),
    readAnswerEventDelta(eventsDir, {}, assigneeSegmentConfig(assignee), options),
  ]);
  return {
    events: dedupeById([...archive.events, ...live.events]),
    liveOffsets: onlyListed(live.offsets, live.segmentNames),
    liveSegmentNames: live.segmentNames,
    archiveOffsets: onlyListed(archive.offsets, archive.segmentNames),
    unreadableNames: [...archive.unreadableNames, ...live.unreadableNames],
  };
}

export async function rebuildAssigneeState(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  options: AssigneeReadOptions
): Promise<AssigneeReadResult> {
  const foldFn = options.foldFn ?? foldAnswerEvents;
  const all = await readAllAssigneeEvents(root, month, assignee, options);
  const assigneeDir = await openAssigneeDir(root, month, assignee);
  const snapshotStat = assigneeDir ? await statAnswerSnapshot(assigneeDir) : null;
  const legacySeed = await options.loadLegacySeed();
  const result = all.events.length === 0
    ? passthrough(legacySeed, assignee, month)
    : foldFn(all.events, { legacySeed, username: assignee, monthFolderName: month });
  return {
    result, snapshot: null, snapshotStat, legacySeed, deltaEvents: all.events,
    liveOffsets: all.liveOffsets, liveSegmentNames: all.liveSegmentNames, unreadableNames: all.unreadableNames,
    rebuilt: true, archiveOffsets: all.archiveOffsets,
  };
}

type SnapshotPick = { kind: "use"; snapshot: AnswerSnapshot | null } | { kind: "rebuild" };

async function pickSnapshot(assigneeDir: DirectoryHandleLike, statBefore: SnapshotStat | null, options: AssigneeReadOptions): Promise<SnapshotPick> {
  if (options.cachedSnapshot && sameSnapshotStat(options.cachedSnapshot.stat, statBefore)) {
    return { kind: "use", snapshot: options.cachedSnapshot.snapshot };
  }
  try {
    const read = await readAnswerSnapshot(assigneeDir);
    if (read.kind === "recovered-from-bak") return { kind: "rebuild" };
    return { kind: "use", snapshot: read.kind === "ok" ? read.snapshot : null };
  } catch (error) {
    if (!(error instanceof AnswerSnapshotCorruptError)) throw error;
    logError("answers:v2:snapshot-corrupt", error);
    return { kind: "rebuild" };
  }
}

export async function readAssigneeState(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  options: AssigneeReadOptions
): Promise<AssigneeReadResult> {
  const assigneeDir = await openAssigneeDir(root, month, assignee);
  if (!assigneeDir) {
    const legacySeed = await options.loadLegacySeed();
    return {
      result: passthrough(legacySeed, assignee, month), snapshot: null, snapshotStat: null, legacySeed,
      deltaEvents: [], liveOffsets: {}, liveSegmentNames: [], unreadableNames: [], rebuilt: false, archiveOffsets: {},
    };
  }
  const eventsDir = await getAnswerEventsDir(root, month, false);
  for (let attempt = 0; attempt < MAX_SNAPSHOT_RACE_ATTEMPTS; attempt += 1) {
    const statBefore = await statAnswerSnapshot(assigneeDir);
    const picked = await pickSnapshot(assigneeDir, statBefore, options);
    if (picked.kind === "rebuild") return rebuildAssigneeState(root, month, assignee, options);
    const snapshot = picked.snapshot;
    if (afterSnapshotReadHook) await afterSnapshotReadHook();
    const delta = await readAnswerEventDelta(eventsDir, maxOffsets(bareOffsets(snapshot), options.knownOffsets), assigneeSegmentConfig(assignee), {
      strict: options.strict,
      tolerateConfirmedDead: options.tolerateConfirmedDead,
    });
    const statAfter = await statAnswerSnapshot(assigneeDir);
    if (!sameSnapshotStat(statBefore, statAfter)) continue; // a compaction committed under us
    const legacySeed = snapshot?.legacySeed ?? (await options.loadLegacySeed());
    const deltaEvents = dedupeById([...(options.cachedDelta ?? []), ...delta.events]);
    const common = {
      snapshot, snapshotStat: statAfter, legacySeed, deltaEvents,
      liveOffsets: onlyListed(delta.offsets, delta.segmentNames), liveSegmentNames: delta.segmentNames,
      unreadableNames: delta.unreadableNames, archiveOffsets: {},
    };
    if (!snapshot && deltaEvents.length === 0) return { ...common, result: passthrough(legacySeed, assignee, month), rebuilt: false };
    const folded = foldSnapshotPlusDelta(snapshot, deltaEvents, { legacySeed, username: assignee, monthFolderName: month, foldFn: options.foldFn });
    if (folded.kind === "late") return rebuildAssigneeState(root, month, assignee, options);
    return { ...common, result: folded.result, rebuilt: false };
  }
  return rebuildAssigneeState(root, month, assignee, options);
}

/** Assignee folders of a v2 month (`_archive-v1`, `_quarantine`, files skipped). */
export async function listAssigneeFolders(root: DirectoryHandleLike, month: string): Promise<string[]> {
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await getAnswerEventsDir(root, month, false);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
  return (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "directory" && isAnswerAssigneeFolderName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * The username an assignee folder belongs to, for a folder no `2-employees/`
 * stem accounts for (Task 10 fan-out). A folder name the sanitizer left intact
 * IS the canonical username; a hash-suffixed one (review finding 9) is not
 * invertible, so the owner is read from the folder's own content — the
 * snapshot's `assignee`, else the first event's `answeredBy` — and accepted only
 * when it maps back to exactly this folder. Null when nothing names an owner.
 */
export async function resolveAssigneeFolderOwner(
  root: DirectoryHandleLike,
  month: string,
  folder: string,
  options: { strict?: boolean; tolerateConfirmedDead?: boolean } = {}
): Promise<string | null> {
  const mapsHere = (candidate: string | undefined): candidate is string => {
    if (!candidate || candidate.trim() === "") return false;
    try {
      return answerAssigneeFolderName(candidate) === folder;
    } catch {
      return false;
    }
  };
  if (mapsHere(folder)) return folder;
  const eventsDir = await getAnswerEventsDir(root, month, false);
  const folderDir = await eventsDir.getDirectoryHandle(folder, { create: false });
  try {
    const snap = await readAnswerSnapshot(folderDir);
    if (snap.kind !== "absent" && mapsHere(snap.snapshot.assignee)) return snap.snapshot.assignee;
  } catch (error) {
    if (!(error instanceof AnswerSnapshotCorruptError)) throw error;
  }
  const config = { ...ANSWER_EVENT_LOG, eventsDirName: folder };
  const [live, archive] = await Promise.all([
    readAnswerEventDelta(eventsDir, {}, config, options),
    readAnswerEventDelta(folderDir, {}, assigneeArchiveConfig(), options),
  ]);
  for (const event of [...live.events, ...archive.events]) if (mapsHere(event.answeredBy)) return event.answeredBy!;
  return null;
}
