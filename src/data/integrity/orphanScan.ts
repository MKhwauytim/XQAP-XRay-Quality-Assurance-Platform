/**
 * Referential-integrity check (B3). A staged-validation pass over the `xrayImageId`
 * foreign key that ties population → sample → distribution → answers/approvals. It
 * flags rows that have drifted out of that chain:
 *
 *  - `answersOrphans`   — ids with a saved answer but no current distribution entry
 *  - `approvalsOrphans` — ids referenced by a referral/replacement request but no
 *                         current distribution entry
 *  - `sampleOrphans`    — sample rows whose id is absent from the population
 *
 * Pure and side-effect free so it is trivially unit-testable; the Data Accuracy view
 * loads the id sets and renders the result.
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

  const answersOrphans = missingFrom(input.answersIds, distributionSet);
  const approvalsOrphans = missingFrom(input.approvalsIds, distributionSet);
  const sampleOrphans = missingFrom(input.sampleIds, populationSet);

  return {
    answersOrphans,
    approvalsOrphans,
    sampleOrphans,
    clean:
      answersOrphans.length === 0 &&
      approvalsOrphans.length === 0 &&
      sampleOrphans.length === 0,
  };
}
