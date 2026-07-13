import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { ensureMonthWritable } from "../population/monthLock";
import type {
  EmployeeAnswerFile,
  ItemAnswer,
  ItemAnswerHistoryEntry,
  ItemValueHistoryEntry,
} from "./answerTypes";
import type { ReferralRequest, ReopenRequest, ReplacementRequest } from "../referral/referralTypes";
import { getPopulationMonthDir, getSampleEmployeeDir, safeWorkspaceFilePart } from "../workspace/workspacePaths";

const ANSWERS_FOLDER = "employee-answers";

type DirectoryEntryLike = { name: string; kind: string };

function getDirectoryEntries(dir: DirectoryHandleLike): AsyncIterable<DirectoryEntryLike> | null {
  const d = dir as DirectoryHandleLike & {
    values?: () => AsyncIterable<DirectoryEntryLike>;
    entries?: () => AsyncIterable<[string, DirectoryEntryLike]>;
    [Symbol.asyncIterator]?: () => AsyncIterator<DirectoryEntryLike>;
  };
  if (typeof d.values === "function") return d.values.call(d);
  if (typeof d.entries === "function") {
    return {
      async *[Symbol.asyncIterator]() {
        for await (const [, entry] of d.entries!.call(d)) yield entry;
      },
    };
  }
  if (typeof d[Symbol.asyncIterator] === "function") return d as AsyncIterable<DirectoryEntryLike>;
  return null;
}

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

function answerFileName(username: string): string {
  // Strip path-dangerous characters so a crafted username can't escape the
  // answers folder (path traversal / separators). Usernames are otherwise
  // admin-controlled and normalized lowercase.
  const safe = safeWorkspaceFilePart(username);
  return `${safe}.answers.json`;
}

function emptyAnswerFile(username: string, monthFolderName: string): EmployeeAnswerFile {
  return { username, monthFolderName, revision: 0, items: [] };
}

/**
 * Per-item value-history cap (A4). A documented retention decision, not silent
 * loss: on overflow the first/original entry is always preserved and only the
 * middle is pruned, so the earliest recorded state and the most recent
 * VALUE_HISTORY_CAP-1 changes are always available.
 */
export const VALUE_HISTORY_CAP = 20;

function appendValueHistory(
  existing: ItemValueHistoryEntry[] | undefined,
  entry: ItemValueHistoryEntry
): ItemValueHistoryEntry[] {
  const list = [...(existing ?? []), entry];
  if (list.length <= VALUE_HISTORY_CAP) return list;
  // Keep the original (index 0) plus the most recent VALUE_HISTORY_CAP-1 entries.
  const first = list[0]!;
  const tail = list.slice(list.length - (VALUE_HISTORY_CAP - 1));
  return [first, ...tail];
}

/** A save onto a previously-reopened draft is a correction; otherwise a plain save. */
function changeReason(previous: ItemAnswer): ItemValueHistoryEntry["reason"] {
  const wasReopened =
    previous.status === "draft" &&
    (previous.history?.some((h) => h.action === "reopened") ?? false);
  return wasReopened ? "reopen-correction" : "save";
}

/**
 * Return `next` with an A4 value-history entry appended when it overwrites an
 * existing item (`previous`). A first insert (no previous) records nothing.
 * The incoming item's own `valueHistory` is ignored; history is always folded
 * from the stored `previous` so a client cannot rewrite the trail.
 */
function withValueHistory(previous: ItemAnswer | undefined, next: ItemAnswer): ItemAnswer {
  if (!previous) {
    // First insert of this item — no prior state to snapshot.
    return { ...next, valueHistory: undefined };
  }
  const entry: ItemValueHistoryEntry = {
    changedAt: new Date().toISOString(),
    changedBy: next.answeredBy,
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

export async function loadEmployeeAnswers(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<EmployeeAnswerFile> {
  try {
    const dir = await getAnswersDir(directoryHandle, monthFolderName);
    const result = await safeReadJson<EmployeeAnswerFile>(
      dir,
      answerFileName(username)
    );
    return result.ok
      ? result.value
      : emptyAnswerFile(username, monthFolderName);
  } catch {
    try {
      const legacyDir = await getLegacyAnswersDir(directoryHandle, monthFolderName);
      const result = await safeReadJson<EmployeeAnswerFile>(
        legacyDir,
        answerFileName(username)
      );
      return result.ok ? result.value : emptyAnswerFile(username, monthFolderName);
    } catch {
      return emptyAnswerFile(username, monthFolderName);
    }
  }
}

async function updateEmployeeAnswerFile(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  updater: (file: EmployeeAnswerFile) => EmployeeAnswerFile
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Month lock gate — single choke point for every employee-file write
  // (answers, referral/replacement requests, reopen). Rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  return casLoop<{ ok: true } | { ok: false; error: string }>(
    async (writeToken) => {
      const dir = await getAnswersDir(directoryHandle, monthFolderName);
      const existing = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
      const nextRevision = (existing.revision ?? 0) + 1;
      const updated: EmployeeAnswerFile = {
        ...updater(existing),
        username,
        monthFolderName,
        revision: nextRevision,
        _writeToken: writeToken,
        lastUpdatedAt: new Date().toISOString(),
      };
      await safeWriteJson(dir, answerFileName(username), updated);
      const verify = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
      if (verify.revision === nextRevision && verify._writeToken === writeToken) {
        return {
          done: true,
          result: { ok: true as const },
          verify: async () => {
            const recheck = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
            return recheck.revision === nextRevision && recheck._writeToken === writeToken;
          },
        };
      }
      return { done: false };
    },
    { conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ ملف الموظف بعد عدة محاولات." }
  );
}

export async function saveEmployeeAnswers(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  items: ItemAnswer[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
    // A4: fold each incoming item against its stored predecessor so an
    // overwriting bulk save snapshots the prior answers/status into valueHistory.
    const prevById = new Map(file.items.map((i) => [i.xrayImageId, i]));
    return {
      ...file,
      items: items.map((item) => withValueHistory(prevById.get(item.xrayImageId), item)),
    };
  });
}

export async function upsertItemAnswer(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  item: ItemAnswer
): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
    const previous = file.items.find((i) => i.xrayImageId === item.xrayImageId);
    const others = file.items.filter((i) => i.xrayImageId !== item.xrayImageId);
    // A4: record the overwritten snapshot before replacing the item.
    return { ...file, items: [...others, withValueHistory(previous, item)] };
  });
}

/**
 * Reopen a submitted answer for correction (Tier-1 Item D).
 * Idempotent: if the item is missing or not "submitted", this is a no-op.
 * The previous answers are preserved — only the status flips to "draft" and a
 * history entry records who reopened it, when, why, and the prior submittedAt.
 */
export async function reopenItemAnswer(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  xrayImageId: string,
  reopenedBy: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
    const item = file.items.find((i) => i.xrayImageId === xrayImageId);
    if (!item || item.status !== "submitted") {
      return file; // idempotent no-op
    }
    const historyEntry: ItemAnswerHistoryEntry = {
      action: "reopened",
      at: new Date().toISOString(),
      by: reopenedBy,
      reason,
      previousSubmittedAt: item.submittedAt,
    };
    const reopened: ItemAnswer = {
      ...item,
      status: "draft",
      submittedAt: null,
      history: [...(item.history ?? []), historyEntry],
    };
    return {
      ...file,
      items: file.items.map((i) => (i.xrayImageId === xrayImageId ? reopened : i)),
    };
  });
}

/** Idempotently append a referral request to the originating employee's personal file. */
export async function appendReferralToEmployee(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReferralRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const username = request.fromEmployee;
    return await updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
      if (file.referralRequests?.some((r) => r.requestId === request.requestId)) {
        return file;
      }
      return { ...file, referralRequests: [...(file.referralRequests ?? []), request] };
    });
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
    return await updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
      if (file.replacementRequests?.some((r) => r.requestId === request.requestId)) {
        return file;
      }
      return { ...file, replacementRequests: [...(file.replacementRequests ?? []), request] };
    });
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
    return await updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
      if (file.reopenRequests?.some((r) => r.requestId === request.requestId)) {
        return file;
      }
      return { ...file, reopenRequests: [...(file.reopenRequests ?? []), request] };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "خطأ غير معروف." };
  }
}

/** Read all employee files for the month (used by supervisor/admin aggregation). */
export async function loadAllEmployeeFiles(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<EmployeeAnswerFile[]> {
  try {
    const dir = await getAnswersDir(directoryHandle, monthFolderName);
    const results: EmployeeAnswerFile[] = [];
    const iterable = getDirectoryEntries(dir);
    if (!iterable) return results;
    for await (const entry of iterable) {
      if (entry.kind !== "file" || !entry.name.endsWith(".answers.json")) continue;
      const r = await safeReadJson<EmployeeAnswerFile>(dir, entry.name);
      if (r.ok) results.push(r.value);
    }
    return results;
  } catch {
    return [];
  }
}
