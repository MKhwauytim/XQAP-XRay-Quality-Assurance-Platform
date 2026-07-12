import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

export const WORKSPACE_ROOTS = {
  population: "1-population",
  samples: "2-samples",
  userData: "3-user-data",
  reports: "4-reports",
  system: "5-system",
  templates: "6-templates",
} as const;

export const POPULATION_SUBFOLDERS = {
  raw: "1-raw",
  processed: "2-processed",
} as const;

export const SAMPLE_SUBFOLDERS = {
  main: "1-main",
  employees: "2-employees",
  approvals: "3-approvals",
} as const;

export const SYSTEM_FOLDER_NAMES = {
  locks: "locks",
  audit: "audit",
  backups: "backups",
  powerbiExport: "powerbi-export",
  userPresets: "user-presets",
  feedback: "feedback",
  notifications: "notifications",
} as const;

export const REPORTS_SUBFOLDERS = {
  designs: "designs",
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
  return monthDir.getDirectoryHandle(SAMPLE_SUBFOLDERS.main, { create });
}

export async function getSampleEmployeeDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  const monthDir = await getSampleMonthDir(directoryHandle, monthFolderName, create);
  return monthDir.getDirectoryHandle(SAMPLE_SUBFOLDERS.employees, { create });
}

export async function getSampleApprovalsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  const monthDir = await getSampleMonthDir(directoryHandle, monthFolderName, create);
  return monthDir.getDirectoryHandle(SAMPLE_SUBFOLDERS.approvals, { create });
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
