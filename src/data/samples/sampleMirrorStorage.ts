import type { DistributionCurrentData, DistributionEntry } from "../distribution/distributionTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import {
  getSampleEmployeeDir,
  getSampleMainDir,
  safeWorkspaceFilePart,
} from "../workspace/workspacePaths";

export type MainSamplesFile = {
  monthFolderName: string;
  updatedAt: string;
  sourceLogRevision: number;
  entries: DistributionEntry[];
};

export type EmployeeSamplesFile = MainSamplesFile & {
  username: string;
};

const MAIN_SAMPLES_FILE = "main.samples.json";

function employeeSamplesFileName(username: string): string {
  return `${safeWorkspaceFilePart(username)}.samples.json`;
}

export async function syncSampleMirrors(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  current: DistributionCurrentData
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const sourceLogRevision = current.logRevision ?? 0;
  const mainDir = await getSampleMainDir(directoryHandle, monthFolderName, true);
  const employeesDir = await getSampleEmployeeDir(directoryHandle, monthFolderName, true);

  const mainFile: MainSamplesFile = {
    monthFolderName,
    updatedAt,
    sourceLogRevision,
    entries: current.entries,
  };

  await safeWriteJson(mainDir, MAIN_SAMPLES_FILE, mainFile);

  const entriesByEmployee = new Map<string, DistributionEntry[]>();
  for (const entry of current.entries) {
    const list = entriesByEmployee.get(entry.assignedTo) ?? [];
    list.push(entry);
    entriesByEmployee.set(entry.assignedTo, list);
  }

  await Promise.all(
    [...entriesByEmployee.entries()].map(([username, entries]) =>
      safeWriteJson<EmployeeSamplesFile>(
        employeesDir,
        employeeSamplesFileName(username),
        {
          monthFolderName,
          username,
          updatedAt,
          sourceLogRevision,
          entries,
        }
      )
    )
  );
}

export async function loadMainSampleMirror(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<MainSamplesFile | null> {
  try {
    const dir = await getSampleMainDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<MainSamplesFile>(dir, MAIN_SAMPLES_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function loadEmployeeSampleMirror(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string
): Promise<EmployeeSamplesFile | null> {
  try {
    const dir = await getSampleEmployeeDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<EmployeeSamplesFile>(dir, employeeSamplesFileName(username));
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}
