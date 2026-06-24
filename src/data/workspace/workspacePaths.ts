import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

export const WORKSPACE_ROOTS = {
  population: "1-Population",
  samples: "2-Samples",
  userData: "3-User Data",
  reports: "4-Reports",
  system: "5-System",
  templates: "6-Templates",
} as const;

const LEGACY_ROOTS = {
  population: "Population",
  system: ".system",
  templates: "templates",
} as const;

async function getRoot(
  directoryHandle: DirectoryHandleLike,
  primaryName: string,
  legacyName: string | null,
  create: boolean
): Promise<DirectoryHandleLike> {
  if (create) {
    return directoryHandle.getDirectoryHandle(primaryName, { create: true });
  }

  try {
    return await directoryHandle.getDirectoryHandle(primaryName, { create: false });
  } catch {
    if (!legacyName) throw new Error(`Missing workspace folder: ${primaryName}`);
    return directoryHandle.getDirectoryHandle(legacyName, { create: false });
  }
}

export async function getPopulationRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.population, LEGACY_ROOTS.population, create);
}

export async function getPopulationMonthDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = false
): Promise<DirectoryHandleLike> {
  const populationRoot = await getPopulationRoot(directoryHandle, create);
  return populationRoot.getDirectoryHandle(monthFolderName, { create });
}

export async function getSamplesRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.samples, null, create);
}

export async function getSampleMonthDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  const samplesRoot = await getSamplesRoot(directoryHandle, create);
  return samplesRoot.getDirectoryHandle(monthFolderName, { create });
}

export async function getSampleMainDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  const monthDir = await getSampleMonthDir(directoryHandle, monthFolderName, create);
  return monthDir.getDirectoryHandle("1-Main", { create });
}

export async function getSampleEmployeeDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  const monthDir = await getSampleMonthDir(directoryHandle, monthFolderName, create);
  return monthDir.getDirectoryHandle("2-Employees", { create });
}

export async function getSampleApprovalsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  const monthDir = await getSampleMonthDir(directoryHandle, monthFolderName, create);
  return monthDir.getDirectoryHandle("3-Approvals", { create });
}

export async function getUserDataRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.userData, null, create);
}

export async function getSystemRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.system, LEGACY_ROOTS.system, create);
}

export async function getReportsRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.reports, null, create);
}

export async function getTemplatesRoot(
  directoryHandle: DirectoryHandleLike,
  create = true
): Promise<DirectoryHandleLike> {
  return getRoot(directoryHandle, WORKSPACE_ROOTS.templates, LEGACY_ROOTS.templates, create);
}

export function safeWorkspaceFilePart(value: string): string {
  return value.trim().replace(/[/\\:*?"<>|]+/g, "_").replace(/\.+/g, ".");
}
