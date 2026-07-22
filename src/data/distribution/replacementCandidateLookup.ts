/**
 * Indexed replacement-candidate lookup — avoids reading the full population
 * for the common case by reading only the replacement-candidate index built
 * in src/data/population/replacementIndexStorage.ts. Falls back to the
 * unchanged full-scan getReplacementCandidates() when the index is missing or
 * stale, and opportunistically rebuilds it in the background on that path.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import { createRng, hashSeedString } from "../sampling/rng";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DistributionEntry } from "./distributionTypes";
import type { StageAliasMappings } from "../population/populationConfig";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { getStageKey, type StageCountKey } from "../population/stageHelpers";
import {
  loadMonthPopulationFinal,
  loadMonthPopulationFinalRevision,
} from "../population/populationStorage";
import {
  computeStageMappingsHash,
  isReplacementIndexFresh,
  loadReplacementBucket,
  loadReplacementIndexManifest,
  rebuildReplacementIndex,
} from "../population/replacementIndexStorage";
import type { ReplacementIndexManifest } from "../population/replacementIndexTypes";
import {
  buildExclusionSets,
  capSeeded,
  getReplacementCandidates,
  isEligibleCandidate,
  REPLACEMENT_POOL_LIMIT,
  type ReplacementCandidates,
} from "./replacement";

const ALL_STAGE_KEYS: readonly StageCountKey[] = ["first", "second", "third", "fourth", "unknown"];

export async function getReplacementCandidatesIndexed(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  entry: DistributionEntry,
  sampleMaster: SampleMasterData,
  allEntries: DistributionEntry[],
  stageMappings?: Partial<StageAliasMappings>,
  builtBy = "system"
): Promise<ReplacementCandidates> {
  const sourceRevision = await loadMonthPopulationFinalRevision(directoryHandle, monthFolderName);
  const liveHash = computeStageMappingsHash(stageMappings);
  const manifest =
    sourceRevision === null ? null : await loadReplacementIndexManifest(directoryHandle, monthFolderName);

  // Tracked so a fallback (of any kind) leaves a breadcrumb in the error-log
  // ring buffer — every failure mode here silently degrades to the safe full
  // scan, which means nothing would otherwise indicate whether the index is
  // actually working in production. Deliberately NOT logged on the success
  // path: that would flood the 50-entry ring buffer with routine noise on
  // every dialog open and drown out genuine errors.
  let fallbackReason: string;
  if (sourceRevision === null) {
    fallbackReason = "no-population-revision";
  } else if (!manifest) {
    fallbackReason = "missing-index";
  } else if (!isReplacementIndexFresh(manifest, sourceRevision, liveHash)) {
    fallbackReason = "stale-index";
  } else {
    const indexed = await readFromIndex(directoryHandle, monthFolderName, entry, sampleMaster, allEntries, stageMappings, manifest);
    if (indexed) return indexed;
    // Manifest claimed fresh but a bucket it lists failed to read (missing or
    // corrupt despite being published) — fall through to the safe full-scan
    // path rather than silently under-counting candidates.
    fallbackReason = "bucket-read-failure";
  }

  logError("distribution:replacement-index-fallback", `month=${monthFolderName} reason=${fallbackReason}`);

  const finalData = await loadMonthPopulationFinal(directoryHandle, monthFolderName);
  const populationRows = (finalData?.rows ?? []) as PreparedPopulationRow[];
  const result = getReplacementCandidates(entry, populationRows, sampleMaster, allEntries, stageMappings);

  // Fire-and-forget: this call already paid the one unavoidable full read to
  // answer correctly; rebuilding the index from rows already in memory is
  // free and must not add latency to the slow path it exists to fix.
  // rebuildReplacementIndex never throws (always resolves), but the extra
  // .catch is cheap defense-in-depth against an unexpected synchronous throw.
  if (sourceRevision !== null && populationRows.length > 0) {
    void rebuildReplacementIndex(
      directoryHandle,
      monthFolderName,
      populationRows,
      stageMappings,
      sourceRevision,
      builtBy
    ).catch(() => undefined);
  }

  return result;
}

/** A bucket that shows up empty could mean "genuinely zero rows" or "the file
 *  failed to read despite the manifest listing it" — those must not be
 *  treated the same way. Throws when the manifest says a bucket exists but
 *  loadReplacementBucket couldn't produce it, so the caller falls back to the
 *  full scan instead of silently returning fewer candidates than actually exist. */
async function loadBucketOrThrowIfExpected(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  tier: PreparedPopulationRow["certScanStatus"],
  stageKey: StageCountKey,
  expectedBucketKeys: ReadonlySet<string>
): Promise<PreparedPopulationRow[]> {
  const bucket = await loadReplacementBucket(directoryHandle, monthFolderName, tier, stageKey);
  if (bucket) return bucket;
  if (expectedBucketKeys.has(`${tier}::${stageKey}`)) {
    throw new Error(`Replacement-index bucket ${tier}/${stageKey} is listed in the manifest but failed to read.`);
  }
  return []; // not listed in the manifest — this (tier, stageKey) combination legitimately has zero rows
}

async function readFromIndex(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  entry: DistributionEntry,
  sampleMaster: SampleMasterData,
  allEntries: DistributionEntry[],
  stageMappings: Partial<StageAliasMappings> | undefined,
  manifest: ReplacementIndexManifest
): Promise<ReplacementCandidates | null> {
  try {
    const rng = createRng(hashSeedString(`${sampleMaster.rngSeed}:${entry.xrayImageId}`));
    const { sampleIds, ownedIds } = buildExclusionSets(sampleMaster, allEntries);
    const deadTier = entry.row.certScanStatus;
    const deadStageKey = getStageKey(entry.row.stage, stageMappings);
    const expectedBucketKeys = new Set(manifest.buckets.map((b) => `${b.tier}::${b.stageKey}`));

    const primaryBucket = await loadBucketOrThrowIfExpected(
      directoryHandle, monthFolderName, deadTier, deadStageKey, expectedBucketKeys
    );
    const sameStage = primaryBucket.filter((row) => isEligibleCandidate(row, entry, sampleIds, ownedIds));

    if (sameStage.length > 0) {
      const recommended = sameStage.filter((row) => row.portName === entry.row.portName);
      return {
        recommended: capSeeded(recommended, REPLACEMENT_POOL_LIMIT, rng),
        all: capSeeded(sameStage, REPLACEMENT_POOL_LIMIT, rng),
      };
    }

    // Cascade: read every sibling stage bucket for the same tier, comparing
    // POST-DEDUP supply — never the manifest's raw rowCount. A stage can be
    // almost entirely pre-sampled (e.g. "first" under the default sampling
    // rules) while still showing a large raw count, which would pick the
    // wrong cascade winner and silently under-return candidates.
    let winner: { stageKey: StageCountKey; rows: PreparedPopulationRow[] } | null = null;
    for (const stageKey of ALL_STAGE_KEYS) {
      if (stageKey === deadStageKey) continue;
      const bucket = await loadBucketOrThrowIfExpected(
        directoryHandle, monthFolderName, deadTier, stageKey, expectedBucketKeys
      );
      const eligible = bucket.filter((row) => isEligibleCandidate(row, entry, sampleIds, ownedIds));
      if (eligible.length === 0) continue;
      if (
        !winner ||
        eligible.length > winner.rows.length ||
        (eligible.length === winner.rows.length && stageKey.localeCompare(winner.stageKey) < 0)
      ) {
        winner = { stageKey, rows: eligible };
      }
    }

    return { recommended: [], all: capSeeded(winner?.rows ?? [], REPLACEMENT_POOL_LIMIT, rng) };
  } catch {
    return null;
  }
}
