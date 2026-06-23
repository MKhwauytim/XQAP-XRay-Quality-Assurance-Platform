import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { BrowseDatasetKind } from "../population/populationStorage";

const SYSTEM_FOLDER = ".system";
const USER_PRESETS_FOLDER = "user-presets";

export type BrowseDatasetPreset = {
  columnOrder: string[];
  visibleColumns: string[];
  /** Per-column width overrides in fr units — mirrors ColConfig.widths */
  widths?: Record<string, number>;
  /** Per-column date-format overrides — mirrors ColConfig.dateFmt */
  dateFmt?: Record<string, string>;
  updatedAt: string;
};

export type BrowsePresetDatasetKind = BrowseDatasetKind | "xray-referrals";

export type UserBrowsePresetFile = {
  username: string;
  browseData: Partial<Record<BrowsePresetDatasetKind, BrowseDatasetPreset>>;
};

function safeUserFileName(username: string): string {
  const safeName = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return `${safeName || "unknown"}.browse-preset.json`;
}

async function getPresetDir(
  directoryHandle: DirectoryHandleLike,
  create: boolean
): Promise<DirectoryHandleLike> {
  const systemDir = await directoryHandle.getDirectoryHandle(SYSTEM_FOLDER, {
    create
  });
  return systemDir.getDirectoryHandle(USER_PRESETS_FOLDER, { create });
}

export async function loadUserBrowsePreset(
  directoryHandle: DirectoryHandleLike,
  username: string
): Promise<UserBrowsePresetFile> {
  try {
    const dir = await getPresetDir(directoryHandle, false);
    const result = await safeReadJson<UserBrowsePresetFile>(
      dir,
      safeUserFileName(username)
    );

    if (result.ok && result.value.username === username) {
      return result.value;
    }
  } catch {
    // Missing preset directory/file is expected for new users.
  }

  return {
    username,
    browseData: {}
  };
}

export async function saveUserBrowseDatasetPreset(
  directoryHandle: DirectoryHandleLike,
  username: string,
  dataset: BrowsePresetDatasetKind,
  preset: Omit<BrowseDatasetPreset, "updatedAt">
): Promise<void> {
  const existing = await loadUserBrowsePreset(directoryHandle, username);
  const nextFile: UserBrowsePresetFile = {
    username,
    browseData: {
      ...existing.browseData,
      [dataset]: {
        ...preset,
        updatedAt: new Date().toISOString()
      }
    }
  };

  const dir = await getPresetDir(directoryHandle, true);
  await safeWriteJson(dir, safeUserFileName(username), nextFile);
}
