/**
 * Label-overrides backup coverage (Tier-1 Item F).
 *
 * The custom label overrides (`labelsStore.ts`) live only in `localStorage` —
 * a workspace backup never captured them. This module snapshots them to
 * `3-user-data/labels.snapshot.json` (best-effort, never throws) and offers
 * an explicit opt-in import for restore.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
import { getUserDataRoot } from "./workspacePaths";
import {
  getCustomLabelOverrides,
  setLabel,
  type LabelKey,
} from "../labels/labelsStore";

const LABELS_SNAPSHOT_FILE = "labels.snapshot.json";

export type LabelsSnapshotData = {
  overrides: Partial<Record<LabelKey, string>>;
  savedAt: string;
};

/**
 * Best-effort write of the current label overrides to the workspace. Never
 * throws — a labels snapshot must not block a Settings save or a backup.
 */
export async function exportLabelsSnapshot(directoryHandle: DirectoryHandleLike): Promise<void> {
  try {
    const userDataDir = await getUserDataRoot(directoryHandle, true);
    const snapshot: LabelsSnapshotData = {
      overrides: getCustomLabelOverrides(),
      savedAt: new Date().toISOString(),
    };
    await safeWriteJson(userDataDir, LABELS_SNAPSHOT_FILE, snapshot);
  } catch (error) {
    logError("labels:export-snapshot", error);
  }
}

/**
 * Explicit opt-in import (restore flow only) — applies every override key
 * found in the snapshot via `setLabel`, skipping unknown/stale keys.
 * Returns the number of keys applied.
 */
export async function importLabelsSnapshot(directoryHandle: DirectoryHandleLike): Promise<number> {
  try {
    const userDataDir = await getUserDataRoot(directoryHandle, false);
    const result = await safeReadJson<LabelsSnapshotData>(userDataDir, LABELS_SNAPSHOT_FILE);
    if (!result.ok) return 0;

    let applied = 0;
    for (const [key, value] of Object.entries(result.value.overrides)) {
      if (typeof value !== "string") continue;
      setLabel(key as LabelKey, value);
      applied += 1;
    }
    return applied;
  } catch (error) {
    logError("labels:import-snapshot", error);
    return 0;
  }
}
