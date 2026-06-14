import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { EmployeeAnswerFile, ItemAnswer } from "./answerTypes";

const POPULATION_FOLDER = "Population";
const ANSWERS_FOLDER = "employee-answers";

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
    const file: EmployeeAnswerFile = { username, monthFolderName, items };
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
