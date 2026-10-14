// src/data/answers/v2/rebuildAssigneeSnapshot.ts
//
// Fold EVERYTHING one assignee has (archive + live + frozen legacy seed) and
// write it as the snapshot, CAS against whatever revision is there. Used by the
// migration (with the v1 offset keys), by a restore that merged segments, and
// by compaction when a late event forces a full refold.
//
// STRICT read, never `tolerateConfirmedDead` (v154.0 review finding 1): the
// written snapshot is authoritative and archive/ is not re-read afterwards, so
// a segment that cannot be opened aborts the write (EventSegmentUnreadableError)
// instead of being folded as "no events". Callers log; the existing snapshot
// stays untouched.
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { getAssigneeAnswerEventsDir } from "../../workspace/workspacePaths";
import type { AnswerLegacySeed } from "../answerEventStore";
import { isV1OffsetKey, snapshotDraftFromFold, type FoldFn } from "./answerSnapshot";
import { AnswerSnapshotCorruptError, readAnswerSnapshot, writeAnswerSnapshotCas } from "./answerSnapshotStore";
import { rebuildAssigneeState } from "./assigneeEventReader";

async function currentRevisionAndV1Keys(dir: DirectoryHandleLike): Promise<{ revision: number; v1Offsets: Record<string, number> }> {
  try {
    const read = await readAnswerSnapshot(dir);
    if (read.kind === "absent") return { revision: 0, v1Offsets: {} };
    const v1Offsets = Object.fromEntries(Object.entries(read.snapshot.foldedOffsets).filter(([key]) => isV1OffsetKey(key)));
    return { revision: read.snapshot.revision, v1Offsets };
  } catch (error) {
    if (error instanceof AnswerSnapshotCorruptError) return { revision: 0, v1Offsets: {} };
    throw error;
  }
}

export async function rebuildAndPersistAssigneeSnapshot(
  root: DirectoryHandleLike,
  month: string,
  assignee: string,
  deps: { actor: string; loadLegacySeed: () => Promise<AnswerLegacySeed>; foldFn?: FoldFn; extraOffsets?: Record<string, number>; nowMs?: number }
): Promise<{ status: "written"; revision: number } | { status: "no-events" }> {
  const assigneeDir = await getAssigneeAnswerEventsDir(root, month, assignee, true);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await currentRevisionAndV1Keys(assigneeDir);
    const rebuilt = await rebuildAssigneeState(root, month, assignee, { loadLegacySeed: deps.loadLegacySeed, foldFn: deps.foldFn, strict: true });
    if (rebuilt.deltaEvents.length === 0) return { status: "no-events" };
    const draft = snapshotDraftFromFold(rebuilt.result, {
      assignee,
      monthFolderName: month,
      legacySeed: rebuilt.legacySeed,
      foldedOffsets: { ...current.v1Offsets, ...(deps.extraOffsets ?? {}), ...rebuilt.archiveOffsets, ...rebuilt.liveOffsets },
      compactedAt: new Date(deps.nowMs ?? Date.now()).toISOString(),
      compactedBy: deps.actor,
    });
    const write = await writeAnswerSnapshotCas(assigneeDir, current.revision, draft, "answers:snapshot-rebuild");
    if (!write.ok) throw new Error(write.error);
    if (write.status === "written") return { status: "written", revision: write.snapshot.revision };
  }
  throw new Error(`Snapshot for ${assignee} in ${month} kept changing during a rebuild`);
}
