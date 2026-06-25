import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { BrowseDatasetKind } from "../population/populationStorage";
import { getSystemRoot } from "../workspace/workspacePaths";

const USER_PRESETS_FOLDER = "user-presets";
const ADMIN_SHARED_PRESET_FILE = "admin-shared.browse-preset.json";

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

export type SharedBrowsePresetFile = {
  owner: "admin";
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
  const systemDir = await getSystemRoot(directoryHandle, create);
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

export async function loadAdminBrowsePreset(
  directoryHandle: DirectoryHandleLike
): Promise<SharedBrowsePresetFile> {
  let presetDir: DirectoryHandleLike | null = null;
  try {
    presetDir = await getPresetDir(directoryHandle, false);
    const result = await safeReadJson<SharedBrowsePresetFile>(
      presetDir,
      ADMIN_SHARED_PRESET_FILE
    );
    if (result.ok && result.value.owner === "admin") {
      return result.value;
    }
  } catch {
    // Missing shared preset is expected until an admin changes columns.
  }

  try {
    const dir = presetDir ?? await getPresetDir(directoryHandle, false);
    const legacyAdminPreset = await safeReadJson<UserBrowsePresetFile>(
      dir,
      safeUserFileName("admin")
    );
    if (legacyAdminPreset.ok) {
      return {
        owner: "admin",
        browseData: legacyAdminPreset.value.browseData,
      };
    }
  } catch {
    // Missing legacy admin preset is also expected in new workspaces.
  }

  return {
    owner: "admin",
    browseData: {},
  };
}

export async function saveAdminBrowseDatasetPreset(
  directoryHandle: DirectoryHandleLike,
  dataset: BrowsePresetDatasetKind,
  preset: Omit<BrowseDatasetPreset, "updatedAt">
): Promise<void> {
  const existing = await loadAdminBrowsePreset(directoryHandle);
  const nextFile: SharedBrowsePresetFile = {
    owner: "admin",
    browseData: {
      ...existing.browseData,
      [dataset]: {
        ...preset,
        updatedAt: new Date().toISOString(),
      },
    },
  };

  const dir = await getPresetDir(directoryHandle, true);
  await safeWriteJson(dir, ADMIN_SHARED_PRESET_FILE, nextFile);
}

