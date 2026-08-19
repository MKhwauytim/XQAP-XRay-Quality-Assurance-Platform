/**
 * Referential-integrity check (B3). A staged-validation pass over the `xrayImageId`
 * foreign key that ties population → sample → distribution → answers/approvals. It
 * flags rows that have drifted out of that chain:
 *
 *  - `answersOrphans`      — ids with a saved answer but no current distribution entry
 *  - `approvalsOrphans`    — ids referenced by a referral/replacement request but no
 *                            current distribution entry
 *  - `sampleOrphans`       — sample rows whose id is absent from the population
 *  - `distributionOrphans` — distribution entries whose id is absent from the sample
 *
 * Pure and side-effect free so it is trivially unit-testable.
 *
 * Wired read-only into the Archive tab (per-month, on-demand button) —
 * `src/data/integrity/orphanScanLoader.ts` gathers the five id sets from disk and
 * calls this function; see that module for how each family is read.
 */

export type OrphanScanInput = {
  populationIds: Iterable<string>;
  sampleIds: Iterable<string>;
  distributionIds: Iterable<string>;
  answersIds: Iterable<string>;
  approvalsIds: Iterable<string>;
};

export type OrphanScanResult = {
  answersOrphans: string[];
  approvalsOrphans: string[];
  sampleOrphans: string[];
  distributionOrphans: string[];
  /** True when no orphans were found in any category. */
  clean: boolean;
};

function toSet(ids: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const id of ids) {
    if (id) set.add(id);
  }
  return set;
}

/** Sorted list of ids present in `ids` but absent from `reference`. */
function missingFrom(ids: Iterable<string>, reference: Set<string>): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    if (id && !reference.has(id)) out.add(id);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function scanReferentialIntegrity(input: OrphanScanInput): OrphanScanResult {
  const populationSet = toSet(input.populationIds);
  const distributionSet = toSet(input.distributionIds);
  const sampleSet = toSet(input.sampleIds);

  const answersOrphans = missingFrom(input.answersIds, distributionSet);
  const approvalsOrphans = missingFrom(input.approvalsIds, distributionSet);
  const sampleOrphans = missingFrom(input.sampleIds, populationSet);
  const distributionOrphans = missingFrom(input.distributionIds, sampleSet);

  return {
    answersOrphans,
    approvalsOrphans,
    sampleOrphans,
    distributionOrphans,
    clean:
      answersOrphans.length === 0 &&
      approvalsOrphans.length === 0 &&
      sampleOrphans.length === 0 &&
      distributionOrphans.length === 0,
  };
}
