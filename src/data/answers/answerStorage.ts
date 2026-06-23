import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { EmployeeAnswerFile, ItemAnswer } from "./answerTypes";
import type { ReferralRequest, ReplacementRequest } from "../referral/referralTypes";

const POPULATION_FOLDER = "Population";
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
  const population = await directoryHandle.getDirectoryHandle(
    POPULATION_FOLDER,
    { create: true }
  );
  const monthDir = await population.getDirectoryHandle(monthFolderName, {
    create: true
  });
  return monthDir.getDirectoryHandle(ANSWERS_FOLDER, { create: true });
}

function answerFileName(username: string): string {
  return `${username}.answers.json`;
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
      : { username, monthFolderName, items: [] };
  } catch {
    return { username, monthFolderName, items: [] };
  }
}

export async function saveEmployeeAnswers(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  items: ItemAnswer[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getAnswersDir(directoryHandle, monthFolderName);
    const existing = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
    const file: EmployeeAnswerFile = {
      ...existing,
      username,
      monthFolderName,
      items,
      lastUpdatedAt: new Date().toISOString(),
    };
    await safeWriteJson(dir, answerFileName(username), file);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function upsertItemAnswer(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  item: ItemAnswer
): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = await loadEmployeeAnswers(
    directoryHandle,
    monthFolderName,
    username
  );
  const others = file.items.filter((i) => i.xrayImageId !== item.xrayImageId);
  return saveEmployeeAnswers(directoryHandle, monthFolderName, username, [
    ...others,
    item
  ]);
}

/** Idempotently append a referral request to the originating employee's personal file. */
export async function appendReferralToEmployee(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReferralRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const username = request.fromEmployee;
    const dir = await getAnswersDir(directoryHandle, monthFolderName);
    const file = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
    if (file.referralRequests?.some((r) => r.requestId === request.requestId)) {
      return { ok: true };
    }
    const updated: EmployeeAnswerFile = {
      ...file,
      referralRequests: [...(file.referralRequests ?? []), request],
      lastUpdatedAt: new Date().toISOString(),
    };
    await safeWriteJson(dir, answerFileName(username), updated);
    return { ok: true };
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
    const dir = await getAnswersDir(directoryHandle, monthFolderName);
    const file = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
    if (file.replacementRequests?.some((r) => r.requestId === request.requestId)) {
      return { ok: true };
    }
    const updated: EmployeeAnswerFile = {
      ...file,
      replacementRequests: [...(file.replacementRequests ?? []), request],
      lastUpdatedAt: new Date().toISOString(),
    };
    await safeWriteJson(dir, answerFileName(username), updated);
    return { ok: true };
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
