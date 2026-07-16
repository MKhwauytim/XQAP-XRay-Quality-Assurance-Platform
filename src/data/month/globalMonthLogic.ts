import {
  currentMonthFolderInfo,
  type MonthFolderInfo,
} from "../population/monthFolder";

/** The single app-wide month selection. `pending` = chosen via "شهر جديد" but no folder on disk yet. */
export type GlobalMonthSelection =
  | { kind: "existing"; folderName: string; month: number; year: number }
  | { kind: "pending"; folderName: string; month: number; year: number }
  | { kind: "none" };

export const GLOBAL_MONTH_STORAGE_KEY = "xray_global_month_v1";

/** Latest existing month, or a pending current-calendar month when the workspace has none. */
export function latestMonthSelection(months: MonthFolderInfo[]): GlobalMonthSelection {
  const last = months[months.length - 1];
  if (!last) {
    const current = currentMonthFolderInfo();
    return { kind: "pending", ...current };
  }
  return { kind: "existing", ...last };
}

export function resolveInitialSelection(
  months: MonthFolderInfo[],
  storedFolderName: string | null
): GlobalMonthSelection {
  if (storedFolderName) {
    const match = months.find((entry) => entry.folderName === storedFolderName);
    if (match) return { kind: "existing", ...match };
  }
  return latestMonthSelection(months);
}

/** Re-validate a selection against a fresh month list (promote pending, drop vanished folders). */
export function reconcileSelection(
  months: MonthFolderInfo[],
  current: GlobalMonthSelection
): GlobalMonthSelection {
  if (current.kind === "pending") {
    const promoted = months.find((entry) => entry.folderName === current.folderName);
    return promoted ? { kind: "existing", ...promoted } : current;
  }
  if (current.kind === "existing") {
    const stillThere = months.some((entry) => entry.folderName === current.folderName);
    return stillThere ? current : latestMonthSelection(months);
  }
  return latestMonthSelection(months);
}
