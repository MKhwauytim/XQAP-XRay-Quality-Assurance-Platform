import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import type { BrowseDatasetKind } from "../population/populationStorage";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";

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
  /** Monotonically increasing counter for CAS conflict detection. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
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
  return systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.userPresets, { create });
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
  const fileName = safeUserFileName(username);
  // Lock the read-modify-write: two rapid preset saves for the same user
  // (e.g. column order then width) must not race and drop one dataset's update.
  // NB: the `:rmw` suffix keeps this key distinct from safeWriteJson's own internal
  // `${dir.name}/${fileName}` lock ("user-presets/<file>") — withResourceLock is not
  // reentrant, so a colliding key would self-deadlock the nested write.
  await withResourceLock(`${SYSTEM_FOLDER_NAMES.userPresets}/${fileName}:rmw`, async () => {
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
    await safeWriteJson(dir, fileName, nextFile);
  });
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Shared, multi-writer file (any admin on any PC). `:rmw` suffix — see
  // saveUserBrowseDatasetPreset: keeps this outer lock distinct from safeWriteJson's
  // internal non-reentrant lock to avoid a self-deadlock. The outer lock serializes
  // same-tab saves; casLoop's revision + _writeToken read-back guards cross-machine races.
  return withResourceLock(`${SYSTEM_FOLDER_NAMES.userPresets}/${ADMIN_SHARED_PRESET_FILE}:rmw`, () =>
    casLoop<{ ok: true }>(
      async (writeToken) => {
        const existing = await loadAdminBrowsePreset(directoryHandle);
        const nextRevision = (existing.revision ?? 0) + 1;
        const nextFile: SharedBrowsePresetFile = {
          owner: "admin",
          revision: nextRevision,
          _writeToken: writeToken,
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
        const verify = await loadAdminBrowsePreset(directoryHandle);
        if (verify.revision === nextRevision && verify._writeToken === writeToken) {
          return { done: true, result: { ok: true as const } };
        }
        return { done: false };
      },
      { conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ إعدادات الأعمدة بعد عدة محاولات." }
    )
  );
}

