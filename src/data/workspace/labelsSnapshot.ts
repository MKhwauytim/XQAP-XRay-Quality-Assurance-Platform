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
  isLabelKey,
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
      // The skip this function has always documented, now actually performed:
      // `setLabel` stores whatever key it is handed, and a key this build does
      // not define is invisible to the Settings tab (which iterates
      // DEFAULT_LABELS), so it could never be reset again — and would be
      // re-exported to the workspace on the next save.
      if (!isLabelKey(key)) continue;
      setLabel(key, value);
      applied += 1;
    }
    return applied;
  } catch (error) {
    logError("labels:import-snapshot", error);
    return 0;
  }
}

/**
 * Read-only peek at the workspace snapshot's override count — used to decide
 * whether to *offer* a restore, without applying anything. Never throws.
 */
export async function readLabelsSnapshotOverrideCount(
  directoryHandle: DirectoryHandleLike
): Promise<number> {
  try {
    const userDataDir = await getUserDataRoot(directoryHandle, false);
    const result = await safeReadJson<LabelsSnapshotData>(userDataDir, LABELS_SNAPSHOT_FILE);
    if (!result.ok) return 0;
    return Object.keys(result.value.overrides).length;
  } catch (error) {
    logError("labels:read-snapshot-count", error);
    return 0;
  }
}

export type LabelRestoreCheck = {
  localOverrideCount: number;
  snapshotOverrideCount: number;
};

/**
 * Label overrides live only in localStorage, which a neighbouring app on the
 * shared file:// origin can wipe. When they vanish but the workspace snapshot
 * still holds some, that is a loss worth offering to undo — as opposed to a
 * first run or a deliberate reset, where the snapshot is empty too.
 */
export function shouldOfferLabelRestore(check: LabelRestoreCheck): boolean {
  return check.localOverrideCount === 0 && check.snapshotOverrideCount > 0;
}
