import type { NormalizedRiskRow } from "../../components/Sidebar/Tabs/Population/riskData/riskDataTypes";

/**
 * Ad-hoc population import (owner requirement, 2026-08): an admin uploads an
 * arbitrary Excel file that is NOT the regular monthly risk/BI population —
 * e.g. a special one-off batch they need to hand to employees outside the
 * normal Population tab pipeline. Reuses the same column-mapping config as
 * the real pipeline (`populationConfig.ts`'s `mappingTemplates[0]`) so the
 * admin never re-teaches the app column names it already knows.
 *
 * Storage lives entirely outside `1-population/{month}/` (see
 * `adhocImportStorage.ts` / `getAdhocImportsDir`) and, once rows are
 * assigned, under a synthetic `2-samples/adhoc-{importId}/` "month" folder
 * whose name can never collide with a real `{month}-{MonthName}-{year}`
 * folder (see `adhocMonthFolderName`). Both are new, additive locations —
 * neither is read nor written by the real Population/EmployeeWorkspace
 * pipeline today.
 */

export type AdhocImportRowValidation =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * One parsed+mapped source row. `mapped` reuses `NormalizedRiskRow` verbatim
 * (the exact shape `normalizeRiskRow` — already used by the real Population
 * ingest — produces from a column-mapped Excel row), so no separate row
 * schema needs to be invented or kept in sync.
 */
export type AdhocImportRow = {
  /** Stable key within this import: `${sourceSheetName}:${sourceRowNumber}`. */
  rowKey: string;
  mapped: NormalizedRiskRow;
  validation: AdhocImportRowValidation;
  /** Admin review toggle — true means "do not assign", independent of `validation`. */
  excludedByAdmin: boolean;
  assigned: boolean;
  assignedTo: string | null;
  assignedAt: string | null;
  /**
   * The xrayImageId actually written to the distribution event log — always
   * `ADHOC-{importId}-{mapped.xrayImageId}` (see `namespacedXrayImageId`), so
   * an accidental clash with a real population's numeric ID is structurally
   * impossible, not just unlikely.
   */
  namespacedXrayImageId: string | null;
};

export type AdhocImportStatus = "open" | "closed";

export type AdhocImportRecord = {
  importId: string;
  fileName: string;
  importedBy: string;
  importedAt: string;
  /** Mirrors the real month-lock's fail-closed intent, scoped to this import only (B: "respect a lock"). */
  status: AdhocImportStatus;
  closedBy?: string;
  closedAt?: string;
  rows: AdhocImportRow[];
  /** Monotonic counter for CAS conflict detection, mirroring templateStorage.ts's pattern. */
  revision?: number;
  _writeToken?: string;
};

export type AdhocImportIndexEntry = {
  importId: string;
  fileName: string;
  importedBy: string;
  importedAt: string;
  status: AdhocImportStatus;
  totalRows: number;
  validRows: number;
  assignedRows: number;
};

export type AdhocImportIndex = {
  revision?: number;
  _writeToken?: string;
  imports: AdhocImportIndexEntry[];
};

export function adhocMonthFolderName(importId: string): string {
  return `adhoc-${importId}`;
}
