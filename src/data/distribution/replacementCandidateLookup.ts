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
  PopulationUnreadableError,
  loadMonthPopulationFinalRevision,
  readMonthPopulationFinal,
} from "../population/populationStorage";
import {
  computeStageMappingsHash,
  isReplacementIndexFresh,
  loadReplacementBucket,
  loadReplacementIndexManifest,
  rebuildReplacementIndex,
} from "../population/replacementIndexStorage";
import type { ReplacementIndexManifest, ReplacementIndexRow } from "../population/replacementIndexTypes";
import {
  buildExclusionSets,
  capSeeded,
  getReplacementCandidates,
  isEligibleCandidate,
  REPLACEMENT_POOL_LIMIT,
} from "./replacement";

const ALL_STAGE_KEYS: readonly StageCountKey[] = ["first", "second", "third", "fourth", "unknown"];

/**
 * The indexed candidate lookup only ever has the slim `ReplacementIndexRow`
 * projection available from disk (the whole point of the index is to avoid
 * reading the full population). When the index is missing/stale and this
 * falls back to `getReplacementCandidates` (a full population scan already in
 * memory), the full `PreparedPopulationRow[]` it returns is structurally a
 * superset of `ReplacementIndexRow[]` and is returned as-is — no projection
 * needed there, since those rows were never persisted to the index. Either
 * way, callers must treat the result as the slim shape: resolve the FULL row
 * from `population.final.json` by `xrayImageId` only once a candidate is
 * actually chosen (see `XrayReferrals.tsx`'s `handleReplace` and
 * `approveReferral.ts`'s `approveReplacement`), never for the whole pool.
 */
export type IndexedReplacementCandidates = {
  recommended: ReplacementIndexRow[];
  all: ReplacementIndexRow[];
};

export async function getReplacementCandidatesIndexed(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  entry: DistributionEntry,
  sampleMaster: SampleMasterData,
  allEntries: DistributionEntry[],
  stageMappings?: Partial<StageAliasMappings>,
  builtBy = "system"
): Promise<IndexedReplacementCandidates> {
  const sourceRevision = await loadMonthPopulationFinalRevision(directoryHandle, monthFolderName);
  // The sample master is already in hand, so prefer the alias table the DRAW
  // recorded over whatever live config currently holds (see
  // SampleMasterData.stageMappingsSnapshot). Resolved once here and used for
  // every mappings-dependent step below — the index freshness hash, the indexed
  // read, the full-scan fallback and the background index rebuild — so the
  // index can never be validated against one table and read under another.
  const classifyMappings = sampleMaster.stageMappingsSnapshot ?? stageMappings;
  const liveHash = computeStageMappingsHash(classifyMappings);
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
    const indexed = await readFromIndex(directoryHandle, monthFolderName, entry, sampleMaster, allEntries, classifyMappings, manifest);
    if (indexed) return indexed;
    // Manifest claimed fresh but a bucket it lists failed to read (missing or
    // corrupt despite being published) — fall through to the safe full-scan
    // path rather than silently under-counting candidates.
    fallbackReason = "bucket-read-failure";
  }

  logError("distribution:replacement-index-fallback", `month=${monthFolderName} reason=${fallbackReason}`);

  // T-08: an UNREADABLE population.final.json must not be laundered into an
  // empty row list. That produced "no replacement candidates" — a factual claim
  // about the month's data — from what is really a transient share failure, and
  // the operator's next move is to go looking for the month in the processing
  // tab. Refuse instead; the caller surfaces it as "unavailable, try again".
  const finalOutcome = await readMonthPopulationFinal(directoryHandle, monthFolderName);
  if (finalOutcome.status === "unreadable") {
    throw new PopulationUnreadableError(monthFolderName);
  }
  const finalData = finalOutcome.status === "loaded" ? finalOutcome.value : null;
  const populationRows = (finalData?.rows ?? []) as PreparedPopulationRow[];
  const result = getReplacementCandidates(entry, populationRows, sampleMaster, allEntries, classifyMappings);

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
      classifyMappings,
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
): Promise<ReplacementIndexRow[]> {
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
): Promise<IndexedReplacementCandidates | null> {
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
    let winner: { stageKey: StageCountKey; rows: ReplacementIndexRow[] } | null = null;
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
