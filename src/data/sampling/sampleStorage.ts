import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { SampleMasterData } from "./sampleTypes";

const POPULATION_FOLDER = "Population";
const SAMPLE_FILE = "sample.master.json";

async function getSampleDir(
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
  return monthDir.getDirectoryHandle("sample", { create: true });
}

export async function saveSampleMaster(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  data: SampleMasterData
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sampleDir = await getSampleDir(directoryHandle, monthFolderName);
    await safeWriteJson(sampleDir, SAMPLE_FILE, data);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function loadSampleMaster(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<SampleMasterData | null> {
  try {
    const sampleDir = await getSampleDir(directoryHandle, monthFolderName);
    const result = await safeReadJson<SampleMasterData>(sampleDir, SAMPLE_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}
