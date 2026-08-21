import type { NormalizedRiskRow } from "../../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import type {
  AdhocField,
  AdhocImportKind,
  AdhocIndexEntry,
  AdhocMappedRow,
  AdhocMonthBinding,
  AdhocRowAssignment,
  AdhocSourceKind,
  ImportMapping,
} from "./adhocImportModel";
import { adhocMonthFolder } from "./adhocImportModel";

/**
 * Ad-hoc population import (owner requirement, 2026-08): an admin uploads an
 * arbitrary Excel file that is NOT the regular monthly risk/BI population —
 * e.g. a special one-off batch they need to hand to employees outside the
 * normal Population tab pipeline.
 *
 * Storage lives entirely outside `1-population/{month}/` (see
 * `adhocImportStorage.ts` / `getAdhocImportsDir`) and, once rows are assigned,
 * under a synthetic `2-samples/adhoc-{importId}/` "month" folder whose name can
 * never collide with a real `{month}-{MonthName}-{year}` folder.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * **This file is now the v1 COMPATIBILITY VIEW, not the type contract.**
 *
 * `adhocImportModel.ts` owns the contract (`AdhocRecord` / `AdhocRow` / …). The
 * types below describe the same document as the shape the existing Ad-hoc
 * Import tab and a dozen existing tests are written against, so both keep
 * compiling while the tab is rebuilt against the v2 model.
 *
 * Two deliberate widenings make that work without a cast anywhere:
 *
 * 1. `mapped` accepts EITHER shape. v1 wrote `NormalizedRiskRow` (the coupling
 *    to the Population component subtree that correction C1 removes); v2 writes
 *    `AdhocMappedRow`. Every field a v1 consumer reads off it — `xrayImageId`,
 *    `portName`, `declarationNumber`, `xrayLevelOneResult`,
 *    `xrayLevelTwoResult` — is `string | null` on both, so reads keep working
 *    against the union.
 * 2. The v2-only record fields are OPTIONAL here. A v1 record literal (of which
 *    there are many, in tests) stays valid, while a v2 record produced by
 *    `toLegacyRecord` is assignable to this type with nothing dropped.
 *
 * Deleting this file is the last step of the rework, once nothing imports it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type AdhocImportRowValidation =
  | { valid: true }
  | { valid: false; reason: string };

/** See widening (1) in the module docblock. */
export type AdhocImportMappedRow = NormalizedRiskRow | AdhocMappedRow;

/** One parsed+mapped source row, in the v1 shape. */
export type AdhocImportRow = {
  /** Stable key within this import: `${sourceSheetName}:${sourceRowNumber}`. */
  rowKey: string;
  mapped: AdhocImportMappedRow;
  validation: AdhocImportRowValidation;
  /** Admin review toggle — true means "do not assign", independent of `validation`. */
  excludedByAdmin: boolean;
  /**
   * v1's single-assignment scalars, re-derived from `assignments[0]` by
   * `toLegacyRow`. They cannot represent fan-out (one row, one reviewer each),
   * which is why `assignments` exists; they are still written to disk for one
   * release so an older build reading this workspace does not report every
   * assigned row as free. See `adhocRecordMigration.ts`.
   */
  assigned: boolean;
  assignedTo: string | null;
  assignedAt: string | null;
  /**
   * The xrayImageId actually written to the distribution event log — always
   * `ADHOC-{importId}-{xrayImageId}` for replica 0 (see
   * `namespacedXrayImageId`), so an accidental clash with a real population's
   * numeric ID is structurally impossible, not just unlikely.
   */
  namespacedXrayImageId: string | null;
  /** v2. Optional here only so a v1 literal still type-checks. */
  assignments?: AdhocRowAssignment[];
  /** v2 (`monthBinding.kind === "column"` imports). */
  linkedMonthFolder?: string;
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

  /* v2 fields — see widening (2) in the module docblock. */
  schemaVersion?: 2;
  kind?: AdhocImportKind;
  sourceKind?: AdhocSourceKind;
  mapping?: ImportMapping;
  fieldCatalog?: AdhocField[];
  monthBinding?: AdhocMonthBinding;
  templateId?: string;
  templateVersion?: number;
};

/**
 * The index entry IS the v2 entry — it gained `kind` and `linkedMonths` and lost
 * nothing, so no v1 reader is affected and there is no reason to keep two
 * shapes of the same file on disk.
 */
export type AdhocImportIndexEntry = AdhocIndexEntry;

export type AdhocImportIndex = {
  revision?: number;
  _writeToken?: string;
  imports: AdhocImportIndexEntry[];
};

/** @deprecated Use `adhocMonthFolder` from `adhocImportModel.ts`. */
export function adhocMonthFolderName(importId: string): string {
  return adhocMonthFolder(importId);
}
