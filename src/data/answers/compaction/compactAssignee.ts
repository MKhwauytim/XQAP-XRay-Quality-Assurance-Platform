// src/data/answers/compaction/compactAssignee.ts
//
// Spec 2026-10-13 §7: automatic compaction of ONE assignee folder, run in that
// employee's own browser after a successful load. Folds old lines into
// snapshot.json (CAS on revision), then moves fully-folded, quiet, non-head
// segments into archive/. Never deletes; a failed move only leaves a segment
// live, whose bytes the snapshot's offset already covers.
import type { AuthSession } from "../../../auth/authTypes";
import { readRealSession } from "../../../auth/authSession";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { utf8Length } from "../../storage/appendOnlyEventLog";
import { mapWithConcurrency } from "../../storage/concurrency";
import { DIRECTORY_READ_CONCURRENCY, listDirectoryEntriesWithSize, parseSegmentName, type SizedDirectoryEntry } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { workspaceScopeId } from "../../storage/inFlightReads";
import { moveFileVerified } from "../../storage/moveFileVerified";
import { readFileTextWithRetry } from "../../storage/safeWrite";
import { isMonthClosed } from "../../population/monthLock";
import { answerAssigneeFolderName, getAssigneeAnswerEventsDir, getAssigneeArchiveDir } from "../../workspace/workspacePaths";
import { ANSWER_EVENT_SEGMENT_SUFFIX, type AnswerEvent, type AnswerLegacySeed } from "../answerEventStore";
import { foldSnapshotPlusDelta, isV1OffsetKey, snapshotDraftFromFold, type AnswerSnapshot, type FoldFn } from "../v2/answerSnapshot";
import { AnswerSnapshotCorruptError, readAnswerSnapshot, writeAnswerSnapshotCas } from "../v2/answerSnapshotStore";
import { rebuildAssigneeState, type AssigneeReadResult } from "../v2/assigneeEventReader";

export const COMPACTION_SEGMENT_THRESHOLD = 20;
export const COMPACTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const COMPACTION_QUIET_MS = 10 * 60 * 1000;
export const COMPACTION_MIN_INTERVAL_MS = 60 * 60 * 1000;

export function shouldCompact(input: { liveSegmentCount: number; snapshot: AnswerSnapshot | null; rebuilt: boolean; nowMs: number }): boolean {
  if (input.rebuilt) return true;
  if (input.liveSegmentCount > COMPACTION_SEGMENT_THRESHOLD) return true;
  if (input.liveSegmentCount < 1) return false;
  const last = input.snapshot ? Date.parse(input.snapshot.compactedAt) : Number.NEGATIVE_INFINITY;
  return !(input.nowMs - last < COMPACTION_MAX_AGE_MS);
}

/** Longest prefix of COMPLETE, parseable lines whose eventAt is older than the cutoff. A torn or corrupt line is never folded. */
export function foldablePrefix(tail: string, cutoffMs: number): { events: AnswerEvent[]; prefixBytes: number } {
  const events: AnswerEvent[] = [];
  let prefixBytes = 0;
  let start = 0;
  while (start < tail.length) {
    const end = tail.indexOf("\n", start);
    if (end === -1) break;
    const line = tail.slice(start, end);
    if (line.length > 0) {
      // A corrupt line ends the prefix (it and everything after stay unfolded and
      // live, for the reader to surface) — throwing here would block this
      // folder's compaction forever over one bad line.
      let event: AnswerEvent;
      try {
        event = JSON.parse(line) as AnswerEvent;
      } catch {
        break;
      }
      if (!event || typeof event.eventAt !== "string" || !(Date.parse(event.eventAt) < cutoffMs)) break;
      events.push(event);
    }
    prefixBytes += utf8Length(tail.slice(start, end + 1));
    start = end + 1;
  }
  return { events, prefixBytes };
}

/** Non-head, quiet, fully folded. A writer's head (highest seq of its base) is never a candidate. */
export function selectCompactionCandidates(
  listing: readonly SizedDirectoryEntry[],
  foldedOffsets: Record<string, number>,
  cutoffMs: number
): SizedDirectoryEntry[] {
  const headSeq = new Map<string, number>();
  for (const entry of listing) {
    const parsed = parseSegmentName(entry.name, ANSWER_EVENT_SEGMENT_SUFFIX);
    if (parsed) headSeq.set(parsed.base, Math.max(headSeq.get(parsed.base) ?? -1, parsed.seq));
  }
  return listing.filter((entry) => {
    const parsed = parseSegmentName(entry.name, ANSWER_EVENT_SEGMENT_SUFFIX);
    if (!parsed || parsed.seq >= (headSeq.get(parsed.base) ?? 0)) return false;
    return entry.lastModified < cutoffMs && foldedOffsets[entry.name] === entry.size;
  });
}

export type CompactionDeps = {
  actor: string;
  loadLegacySeed: () => Promise<AnswerLegacySeed>;
  foldFn?: FoldFn;
  nowMs?: number;
  /** Observability / test seam, awaited at each phase boundary. */
  onPhase?: (phase: "folded" | "committed" | "moved") => void | Promise<void>;
};

export type CompactionOutcome =
  | { status: "compacted"; revision: number; archived: string[]; keptLive: string[] }
  | { status: "conflict" }
  | { status: "failed"; error: string };

type FoldableTail = { name: string; foldedThrough: number; events: AnswerEvent[] };

async function readFoldableTail(dir: DirectoryHandleLike, entry: SizedDirectoryEntry, fromOffset: number, cutoffMs: number): Promise<FoldableTail> {
  if (fromOffset >= entry.size) return { name: entry.name, foldedThrough: fromOffset, events: [] };
  const text = await readFileTextWithRetry(dir, entry.name);
  if (text === null) return { name: entry.name, foldedThrough: fromOffset, events: [] };
  const tail = new TextDecoder().decode(new TextEncoder().encode(text).subarray(fromOffset));
  const { events, prefixBytes } = foldablePrefix(tail, cutoffMs);
  return { name: entry.name, foldedThrough: fromOffset + prefixBytes, events };
}

async function readSnapshotForCompaction(dir: DirectoryHandleLike): Promise<{ snapshot: AnswerSnapshot | null; trusted: boolean; revision: number }> {
  try {
    const read = await readAnswerSnapshot(dir);
    if (read.kind === "absent") return { snapshot: null, trusted: true, revision: 0 };
    return { snapshot: read.snapshot, trusted: read.kind === "ok", revision: read.snapshot.revision };
  } catch (error) {
    if (error instanceof AnswerSnapshotCorruptError) return { snapshot: null, trusted: false, revision: 0 };
    throw error;
  }
}

function v1Keys(snapshot: AnswerSnapshot | null): Record<string, number> {
  return Object.fromEntries(Object.entries(snapshot?.foldedOffsets ?? {}).filter(([key]) => isV1OffsetKey(key)));
}

export async function compactAssignee(root: DirectoryHandleLike, month: string, assignee: string, deps: CompactionDeps): Promise<CompactionOutcome> {
  const nowMs = deps.nowMs ?? Date.now();
  const cutoffMs = nowMs - COMPACTION_QUIET_MS;
  const assigneeDir = await getAssigneeAnswerEventsDir(root, month, assignee, false);
  const current = await readSnapshotForCompaction(assigneeDir);
  const listing = await listDirectoryEntriesWithSize(assigneeDir, ANSWER_EVENT_SEGMENT_SUFFIX);
  const prior = current.trusted ? current.snapshot : null;
  const tails = await mapWithConcurrency(listing, DIRECTORY_READ_CONCURRENCY, (entry) =>
    readFoldableTail(assigneeDir, entry, prior?.foldedOffsets[entry.name] ?? 0, cutoffMs)
  );
  const legacySeed = prior?.legacySeed ?? (await deps.loadLegacySeed());
  const merged = current.trusted
    ? foldSnapshotPlusDelta(prior, tails.flatMap((tail) => tail.events), { legacySeed, username: assignee, monthFolderName: month, foldFn: deps.foldFn })
    : ({ kind: "late", lateEventId: "" } as const);
  let result;
  let offsets: Record<string, number>;
  if (merged.kind === "resumed") {
    result = merged.result;
    offsets = { ...(prior?.foldedOffsets ?? {}) };
    for (const tail of tails) offsets[tail.name] = tail.foldedThrough;
  } else {
    // Late event or untrusted snapshot: refold everything (archive + live).
    const rebuilt = await rebuildAssigneeState(root, month, assignee, { loadLegacySeed: deps.loadLegacySeed, foldFn: deps.foldFn });
    result = rebuilt.result;
    offsets = { ...v1Keys(current.snapshot), ...rebuilt.archiveOffsets, ...rebuilt.liveOffsets };
  }
  await deps.onPhase?.("folded");
  const draft = snapshotDraftFromFold(result, { assignee, monthFolderName: month, legacySeed, foldedOffsets: offsets, compactedAt: new Date(nowMs).toISOString(), compactedBy: deps.actor });
  const write = await writeAnswerSnapshotCas(assigneeDir, current.revision, draft, "answers:compaction");
  if (!write.ok) return { status: "failed", error: write.error };
  if (write.status === "conflict") return { status: "conflict" };
  await deps.onPhase?.("committed");
  const archiveDir = await getAssigneeArchiveDir(root, month, assignee, true);
  const archived: string[] = [];
  const keptLive: string[] = [];
  for (const entry of selectCompactionCandidates(listing, offsets, cutoffMs)) {
    const moved = await moveFileVerified(assigneeDir, entry.name, archiveDir, entry.size);
    (moved.status === "moved" ? archived : keptLive).push(entry.name);
  }
  await deps.onPhase?.("moved");
  return { status: "compacted", revision: write.snapshot.revision, archived, keptLive };
}

const lastRunByKey = new Map<string, number>();

export function __resetCompactionRateLimitForTests(): void {
  lastRunByKey.clear();
}

/**
 * The trigger (spec §7): only the signed-in OWNER of the folder, never a demo
 * session, never a closed month, at most once per hour per (month, assignee) in
 * this tab. Returns null when gated out; the promise never rejects (errors are
 * logged) so a fire-and-forget caller cannot leak an unhandled rejection.
 */
export function maybeScheduleCompaction(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  read: Pick<AssigneeReadResult, "snapshot" | "liveSegmentNames" | "rebuilt">,
  deps: Omit<CompactionDeps, "actor"> & { session?: () => AuthSession | null }
): Promise<CompactionOutcome | null> | null {
  const session = (deps.session ?? readRealSession)();
  if (!session || session.mode === "demo") return null;
  if (session.username.trim().toLowerCase() !== assignee.trim().toLowerCase()) return null;
  const nowMs = deps.nowMs ?? Date.now();
  if (!shouldCompact({ liveSegmentCount: read.liveSegmentNames.length, snapshot: read.snapshot, rebuilt: read.rebuilt, nowMs })) return null;
  const key = `${workspaceScopeId(root)}|${month}|${answerAssigneeFolderName(assignee)}`;
  const last = lastRunByKey.get(key);
  if (last !== undefined && nowMs - last < COMPACTION_MIN_INTERVAL_MS) return null;
  lastRunByKey.set(key, nowMs);
  return (async () => {
    if (await isMonthClosed(root, month)) return null;
    return compactAssignee(root, month, assignee, { ...deps, actor: session.username });
  })().catch((error: unknown) => {
    logError("answers:compaction", error instanceof Error ? error : new Error(String(error)), { action: month });
    return null;
  });
}
