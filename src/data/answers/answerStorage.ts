import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import type { EmployeeAnswerFile, ItemAnswer } from "./answerTypes";
import type { ReferralRequest, ReplacementRequest } from "../referral/referralTypes";
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
        return { done: true, result: { ok: true as const } };
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
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => ({
    ...file,
    items,
  }));
}

export async function upsertItemAnswer(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  item: ItemAnswer
): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateEmployeeAnswerFile(directoryHandle, monthFolderName, username, (file) => {
    const others = file.items.filter((i) => i.xrayImageId !== item.xrayImageId);
    return { ...file, items: [...others, item] };
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
