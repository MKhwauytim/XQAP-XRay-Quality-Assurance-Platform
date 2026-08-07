import type { CertScanMatchStatus, PreparedPopulationRow } from "./populationTypes";
import type { StageCountKey } from "./stageHelpers";

// Bumped only if the on-disk shape changes; a mismatch is treated the same as
// a missing index (safe fallback to the full-population read).
// v2 (2026-08-07): buckets now store the slim ReplacementIndexRow projection
// instead of the full PreparedPopulationRow — a full-population-sized index
// was the largest remaining disk-waste item measured on real data (a 70k-row
// population produced a 132 MB index file, essentially a full second copy of
// population.final.json). Bumping this means any pre-existing full-row index
// on disk is treated as stale and safely rebuilt in the new slim shape,
// rather than being misread as already-slim.
export const REPLACEMENT_INDEX_FORMAT_VERSION = 2;

/**
 * The subset of `PreparedPopulationRow` fields the replacement-candidate index
 * actually needs. Derived by reading every consumer of an indexed candidate
 * row: `isEligibleCandidate` (xrayImageId, certScanStatus), the same-stage /
 * same-port filters in `replacementCandidateLookup.ts` (stage, portName), and
 * the candidate list the employee-facing `ReplacementDialog` renders
 * (xrayImageId, portName, stage, xrayEntryDate, plateOrContainerNumber) — see
 * `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx`.
 * Nothing else is needed to select or display a candidate: the FULL row is
 * resolved from `population.final.json` by `xrayImageId` only once a candidate
 * is actually chosen (a handful of rows), never for the whole stratum.
 */
export const REPLACEMENT_INDEX_ROW_FIELDS = [
  "xrayImageId",
  "certScanStatus",
  "stage",
  "portName",
  "xrayEntryDate",
  "plateOrContainerNumber",
] as const satisfies readonly (keyof PreparedPopulationRow)[];

export type ReplacementIndexRowField = (typeof REPLACEMENT_INDEX_ROW_FIELDS)[number];

/** The row shape stored inline in a replacement-index bucket file. */
export type ReplacementIndexRow = Pick<PreparedPopulationRow, ReplacementIndexRowField>;

/** Projects a full `PreparedPopulationRow` down to the replacement-index stub. */
export function toReplacementIndexRow(row: PreparedPopulationRow): ReplacementIndexRow {
  const stub = {} as ReplacementIndexRow;
  for (const field of REPLACEMENT_INDEX_ROW_FIELDS) {
    (stub as Record<ReplacementIndexRowField, unknown>)[field] = row[field];
  }
  return stub;
}

export type ReplacementIndexBucketEntry = {
  tier: CertScanMatchStatus;
  stageKey: StageCountKey;
  fileName: string;
  /** Pre-dedup row count — informational only. Never use this to pick a
   *  cascade fallback stage; a stage can be almost entirely pre-sampled
   *  (e.g. "first" under the default sampling rules) while still showing a
   *  large raw count here. Cascade selection must compare post-dedup supply,
   *  computed by actually reading and filtering the sibling buckets. */
  rowCount: number;
};

export type ReplacementIndexManifest = {
  formatVersion: number;
  monthFolderName: string;
  /** population.final.json's own envelope revision this index was built from. */
  sourceRevision: number;
  /** Hash of the fully-resolved stage mappings used to bucket rows — stage
   *  aliases can be edited independently of population processing, so
   *  sourceRevision alone cannot detect that drift. */
  stageMappingsHash: string;
  builtAt: string;
  builtBy: string;
  totalIndexedRows: number;
  buckets: ReplacementIndexBucketEntry[];
  _writeToken?: string;
};
