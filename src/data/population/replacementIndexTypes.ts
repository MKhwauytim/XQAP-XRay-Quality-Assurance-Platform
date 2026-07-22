import type { CertScanMatchStatus } from "./populationTypes";
import type { StageCountKey } from "./stageHelpers";

// Bumped only if the on-disk shape changes; a mismatch is treated the same as
// a missing index (safe fallback to the full-population read).
export const REPLACEMENT_INDEX_FORMAT_VERSION = 1;

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
