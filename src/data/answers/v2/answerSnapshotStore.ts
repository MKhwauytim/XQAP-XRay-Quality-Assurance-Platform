// src/data/answers/v2/answerSnapshotStore.ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { casLoop, readBackOwnWrite } from "../../storage/casLoop";
import { unwrap, wrap, type JsonEnvelope } from "../../storage/jsonEnvelope";
import { isNotFoundError } from "../../storage/transientFileErrors";
import { directoryResourceKey, withResourceLock } from "../../storage/webLocks";
import { ANSWER_EVENTS_FOLDERS } from "../../workspace/workspacePaths";
import { ANSWER_SNAPSHOT_SCHEMA_VERSION, type AnswerSnapshot, type AnswerSnapshotDraft } from "./answerSnapshot";

const SNAPSHOT = ANSWER_EVENTS_FOLDERS.assigneeSnapshot;

export type SnapshotStat = { size: number; lastModified: number };

export function sameSnapshotStat(a: SnapshotStat | null, b: SnapshotStat | null): boolean {
  if (a === null || b === null) return a === b;
  return a.size === b.size && a.lastModified === b.lastModified;
}

/** Metadata only (one getFile, no content) — the reader's "did a compaction commit under me?" check. */
export async function statAnswerSnapshot(assigneeDir: DirectoryHandleLike): Promise<SnapshotStat | null> {
  try {
    const file = await (await assigneeDir.getFileHandle(SNAPSHOT, { create: false })).getFile();
    return { size: file.size, lastModified: file.lastModified };
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export class AnswerSnapshotCorruptError extends Error {
  constructor(folder: string) {
    super(`Answer snapshot in ${folder} is unreadable or not a snapshot`);
    this.name = "AnswerSnapshotCorruptError";
  }
}

export type SnapshotRead =
  | { kind: "absent" }
  | { kind: "ok"; snapshot: AnswerSnapshot }
  | { kind: "recovered-from-bak"; snapshot: AnswerSnapshot };

function isAnswerSnapshot(value: unknown): value is AnswerSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<AnswerSnapshot>;
  return (
    v.schemaVersion === ANSWER_SNAPSHOT_SCHEMA_VERSION &&
    Array.isArray(v.items) &&
    Array.isArray(v.foldedEventIds) &&
    typeof v.revision === "number" &&
    typeof v.foldedOffsets === "object" && v.foldedOffsets !== null &&
    typeof v.markers === "object" && v.markers !== null &&
    typeof v.legacySeed === "object" && v.legacySeed !== null
  );
}

/**
 * A `.bak` recovery is REPORTED, not served: the backup is the PREVIOUS
 * snapshot, written before the segments the current one folded were moved to
 * `archive/`. The reader (Task 4) rebuilds from archive + live in that case.
 */
export async function readAnswerSnapshot(assigneeDir: DirectoryHandleLike): Promise<SnapshotRead> {
  const read = await safeReadJson<JsonEnvelope<AnswerSnapshot>>(assigneeDir, SNAPSHOT);
  if (!read.ok) {
    if (read.reason === "missing") return { kind: "absent" };
    throw new AnswerSnapshotCorruptError(assigneeDir.name);
  }
  const snapshot = unwrap<AnswerSnapshot>(read.value);
  if (!isAnswerSnapshot(snapshot)) throw new AnswerSnapshotCorruptError(assigneeDir.name);
  return read.recoveredFromBak ? { kind: "recovered-from-bak", snapshot } : { kind: "ok", snapshot };
}

function revisionOf(value: unknown): number {
  const snapshot = unwrap<Partial<AnswerSnapshot> | null>(value);
  return snapshot && typeof snapshot.revision === "number" ? snapshot.revision : 0;
}

export type SnapshotWriteResult =
  | { ok: true; status: "written"; snapshot: AnswerSnapshot }
  | { ok: true; status: "conflict"; currentRevision: number };

/**
 * Compare-and-swap on `revision` (spec §7 step 2). A conflict is a RESULT, not
 * a retry: the caller (compaction) aborts, another tab already compacted.
 * `readBackOwnWrite` + `_writeToken` catch the cross-machine lost-update case
 * the revision alone cannot (same pattern as feedbackStorage's threads index).
 */
export async function writeAnswerSnapshotCas(
  assigneeDir: DirectoryHandleLike,
  expectedRevision: number,
  draft: AnswerSnapshotDraft,
  context: string
): Promise<SnapshotWriteResult | { ok: false; error: string }> {
  return withResourceLock(`${directoryResourceKey(assigneeDir, SNAPSHOT)}:cas`, () =>
    casLoop<SnapshotWriteResult>(
      async (writeToken) => {
        const current = await safeReadJson<JsonEnvelope<AnswerSnapshot>>(assigneeDir, SNAPSHOT);
        const currentRevision = current.ok ? revisionOf(current.value) : 0;
        if (currentRevision !== expectedRevision) {
          return { done: true, result: { ok: true, status: "conflict", currentRevision } };
        }
        const next: AnswerSnapshot = { ...draft, revision: expectedRevision + 1, _writeToken: writeToken };
        const written = await safeWriteJson(assigneeDir, SNAPSHOT, wrap(next, expectedRevision));
        const verdict = await readBackOwnWrite(
          written,
          () => safeReadJson<JsonEnvelope<AnswerSnapshot>>(assigneeDir, SNAPSHOT),
          (verify) =>
            verify.ok &&
            revisionOf(verify.value) === next.revision &&
            unwrap<AnswerSnapshot>(verify.value)._writeToken === writeToken,
          context
        );
        return verdict === "not-mine"
          ? { done: false }
          : { done: true, result: { ok: true, status: "written", snapshot: next } };
      },
      { context, maxRetries: 3, baseDelayMs: 100 }
    )
  );
}
