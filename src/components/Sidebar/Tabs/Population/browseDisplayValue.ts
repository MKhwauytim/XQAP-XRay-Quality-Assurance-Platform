import type { BrowseRow } from "../../../../data/population/populationStorage";
import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import type { PopulationConfig } from "../../../../data/population/populationConfig";
import { formatStageLabel } from "./components/helpers";

// Split out of BrowseDataView.tsx so tests (and the C2 worker/fallback parity
// test) can use the REAL formatter; a component file may not export non-components.

function formatMonthFolderLabel(monthFolder: string): string {
  return formatMonthFolderShortLabel(monthFolder);
}

export function formatBrowseCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (Array.isArray(value)) {
    return value.map(formatBrowseCellValue).join("، ");
  }

  if (typeof value === "boolean") {
    return value ? "نعم" : "لا";
  }

  return String(value);
}

// The real (main-thread) display-value formatter — used directly for: per-page cell
// rendering (both paths, always correct since it's a plain function call over at
// most DATA_PAGE_SIZE rows), the fallback (non-worker) path's search/filter/sort
// query, and the fallback path's column-filter dropdown preview. For the
// worker-backed "population" path, this SAME special-casing is mirrored inside the
// worker itself (src/workers/populationQueryWorker.ts's getWorkerDisplayValue) since
// a function can't cross postMessage — see this file's PR/commit notes for the full
// rationale (Task 4's CRITICAL gap).
export function getBrowseDisplayValue(
  row: BrowseRow,
  key: string,
  stageMappings?: PopulationConfig["stageMappings"]
): string {
  if (key === "stage") {
    return formatStageLabel(row[key], stageMappings);
  }

  if (key === "_monthFolder") {
    return formatMonthFolderLabel(String(row[key] ?? ""));
  }

  return formatBrowseCellValue(row[key]);
}
