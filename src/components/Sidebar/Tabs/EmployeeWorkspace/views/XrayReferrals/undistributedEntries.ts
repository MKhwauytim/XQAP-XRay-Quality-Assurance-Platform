// «غير موزعة» rows for the oversight queue (owner, 2026-11-01): a sample row
// with no distribution entry was invisible in «صور الأشعة المحالة», so a case
// the Excel import reported as «موجودة» could not be found by searching its
// id. An admin now sees every live sample row, the undistributed ones as
// synthetic entries with no assignee. They are display-only: the panel opens
// read-only (see `resolvePanelAuthoring`), and distribution still happens on
// the distribution screen.

import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { toEmployeeMirrorRowStub } from "../../../../../../data/population/populationTypes";
import { liveSampleRows } from "../../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../../data/sampling/sampleTypes";

/** The assignee of a row nobody has been given yet. */
export const UNASSIGNED = "";

export function isUndistributedEntry(entry: DistributionEntry): boolean {
  return entry.assignedTo === UNASSIGNED;
}

/** The month's live sample rows that no entry covers, as unassigned entries. */
export function undistributedEntries(
  sample: SampleMasterData | null,
  entries: readonly DistributionEntry[]
): DistributionEntry[] {
  if (!sample) return [];
  const covered = new Set(entries.map((entry) => entry.xrayImageId));
  return liveSampleRows(sample)
    .filter((row) => !covered.has(row.xrayImageId))
    .map((row) => ({
      xrayImageId: row.xrayImageId,
      assignedTo: UNASSIGNED,
      status: "pending",
      replacedById: null,
      lastEventAt: "",
      row: toEmployeeMirrorRowStub(row),
    }) as DistributionEntry);
}
