import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type {
  DistributionCurrentData,
  DistributionEvent,
  DistributionLog
} from "./distributionTypes";

const POPULATION_FOLDER = "Population";
const LOG_FILE = "distribution.log.json";
const CURRENT_FILE = "distribution.current.json";

async function getDistributionDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  const population = await directoryHandle.getDirectoryHandle(
    POPULATION_FOLDER,
    { create: true }
  );
  return population.getDirectoryHandle(monthFolderName, { create: true });
}

export async function loadDistributionLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLog> {
  try {
    const dir = await getDistributionDir(directoryHandle, monthFolderName);
    const result = await safeReadJson<DistributionLog>(dir, LOG_FILE);
    return result.ok
      ? result.value
      : { monthFolderName, events: [] };
  } catch {
    return { monthFolderName, events: [] };
  }
}

export async function appendDistributionEvent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  event: DistributionEvent
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getDistributionDir(directoryHandle, monthFolderName);
    const existing = await loadDistributionLog(directoryHandle, monthFolderName);
    const updated: DistributionLog = {
      monthFolderName,
      events: [...existing.events, event]
    };
    await safeWriteJson(dir, LOG_FILE, updated);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function saveDistributionCurrent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  current: DistributionCurrentData
): Promise<void> {
  const dir = await getDistributionDir(directoryHandle, monthFolderName);
  await safeWriteJson(dir, CURRENT_FILE, current);
}

export async function loadDistributionCurrent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionCurrentData | null> {
  try {
    const dir = await getDistributionDir(directoryHandle, monthFolderName);
    const result = await safeReadJson<DistributionCurrentData>(
      dir,
      CURRENT_FILE
    );
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}
