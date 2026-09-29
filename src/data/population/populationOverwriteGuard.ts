/**
 * A2 (owner decision 2026-09-28): a re-processed population must never orphan
 * a month's sample once work has been done on it.
 *
 * Reports drive from the population and look up sample/answer data by
 * `xrayImageId`, so any live sampled id absent from a new population silently
 * vanishes from every report — the field case was a re-process with a file
 * from the wrong period that shared NO ids with the sample (0 answers shown).
 *
 * The rule is enforced in the data layer (`saveMonthRunLocked`), whatever the
 * caller confirmed; the Population tab calls the same two functions before the
 * save only to show the counts in its dialog.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { liveSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import { loadOrDeriveDistributionCurrentStrictForRead } from "../distribution/distributionStorage";
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import { scanReferentialIntegrity } from "../integrity/orphanScan";

/** How many missing ids a refusal names (the full count is always reported). */
export const OVERWRITE_MISSING_EXAMPLE_LIMIT = 10;

export type PopulationOverwriteImpact = {
  sampleExists: boolean;
  /** `liveSampleRows(sample)` ids — retired-by-replacement rows excluded. */
  liveSampledIds: string[];
  /**
   * The sample's stored `certScanStatus` per live sampled id (C2). Lets the
   * re-process dialog warn when the new run would flip a sampled row's
   * CertScan status while the drawn sample keeps its original split. Optional:
   * absent means "unknown", and no CertScan warning is raised.
   */
  liveSampledCertScan?: Record<string, string>;
  distributionCount: number;
  answerCount: number;
};

export type PopulationOverwriteAssessment = PopulationOverwriteImpact & {
  missingCount: number;
  missingExamples: string[];
  /**
   * How many live sampled rows also appear in the new rows with a DIFFERENT
   * `certScanStatus` than the sample stored (C2 — a changed CertScan flag or
   * pasted list). Advisory only: never blocks the save.
   */
  certScanChangedCount: number;
  /** True when the save must be refused whatever the user confirms. */
  blocked: boolean;
};

/**
 * What a population overwrite of this month would put at risk. Throws when the
 * sample exists but cannot be read (`loadSampleMaster`'s v93 contract), and
 * likewise when the month's distribution or answers cannot be read strictly
 * (`loadOrDeriveDistributionCurrentStrictForRead` with `{ strictSegments: true }`,
 * and `loadAllEmployeeFiles` called with `{ strict: true }`) — a guard that
 * cannot see whether the month has work must refuse, not silently treat the
 * read failure as "no work" (F21). `loadAllEmployeeFiles`'s LENIENT default
 * folds a failed event-log read, or one employee's unreadable file, into
 * "answered nothing" — exactly the silent-"no answers" outcome F21 forbids
 * here — so this always asks for the strict variant, never the default.
 *
 * `strictSegments: true` (fix round 3, controller ruling 2026-09-28) is
 * THIS MODULE'S OWN opt-in, and is passed here ONLY — every other caller of
 * `loadOrDeriveDistributionCurrentStrictForRead` (the employee-facing queue
 * views) must keep tolerating an ordinary skipped/not-yet-visible segment the
 * way they always have; see that function's own doc comment for the full
 * reasoning. This is the one caller for which a skipped segment (not just an
 * unreadable `distribution.log.json`) must also refuse the save.
 */
export async function loadPopulationOverwriteImpact(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<PopulationOverwriteImpact> {
  const sample = await loadSampleMaster(directoryHandle, monthFolderName);
  if (!sample) {
    return { sampleExists: false, liveSampledIds: [], distributionCount: 0, answerCount: 0 };
  }
  const [distribution, employeeFiles] = await Promise.all([
    loadOrDeriveDistributionCurrentStrictForRead(directoryHandle, monthFolderName, sample.rows, {
      strictSegments: true,
    }),
    loadAllEmployeeFiles(directoryHandle, monthFolderName, { strict: true }),
  ]);
  const liveRows = liveSampleRows(sample);
  return {
    sampleExists: true,
    liveSampledIds: liveRows.map((row) => row.xrayImageId),
    liveSampledCertScan: Object.fromEntries(
      liveRows.map((row) => [row.xrayImageId, row.certScanStatus])
    ),
    distributionCount: distribution?.entries.length ?? 0,
    answerCount: employeeFiles.reduce((total, file) => total + file.items.length, 0),
  };
}

/** Sampled rows (by id) whose `certScanStatus` differs between the sample and the new rows. */
function countCertScanChanges(
  sampled: Record<string, string> | undefined,
  newRows: ReadonlyArray<Record<string, unknown>>
): number {
  if (!sampled) return 0;
  let changed = 0;
  for (const row of newRows) {
    const id = row["xrayImageId"];
    const status = row["certScanStatus"];
    if (typeof id !== "string" || typeof status !== "string") continue;
    const before = Object.hasOwn(sampled, id) ? sampled[id] : undefined;
    if (before !== undefined && before !== status) changed += 1;
  }
  return changed;
}

/**
 * Pure: which live sampled ids the new rows lack, and whether that blocks the
 * save. The set difference itself is delegated to
 * `scanReferentialIntegrity(...).sampleOrphans` (B3's orphan scan) rather than
 * a second implementation of "ids in A missing from B" — `sampleIds` here are
 * the impact's live sampled ids and `populationIds` are the new rows' ids, so
 * `sampleOrphans` is exactly "live sampled ids absent from the new population".
 */
export function assessPopulationOverwrite(
  impact: PopulationOverwriteImpact,
  newRows: ReadonlyArray<Record<string, unknown>>
): PopulationOverwriteAssessment {
  const newIds: string[] = [];
  for (const row of newRows) {
    const id = row["xrayImageId"];
    if (typeof id === "string") newIds.push(id);
  }
  const { sampleOrphans } = scanReferentialIntegrity({
    populationIds: newIds,
    sampleIds: impact.liveSampledIds,
    distributionIds: [],
    answersIds: [],
    approvalsIds: [],
  });
  const hasWork = impact.distributionCount > 0 || impact.answerCount > 0;
  return {
    ...impact,
    certScanChangedCount: countCertScanChanges(impact.liveSampledCertScan, newRows),
    missingCount: sampleOrphans.length,
    missingExamples: sampleOrphans.slice(0, OVERWRITE_MISSING_EXAMPLE_LIMIT),
    blocked: hasWork && sampleOrphans.length > 0,
  };
}
