/**
 * Replacement-candidate index (deliberate exception to the pending large-population
 * performance proposal's phase sequence — see docs/edit logs/2026-07-22.md v59.0).
 *
 * Splits processed population rows into small files bucketed by (tier, stageKey),
 * built once at population-save time from rows already in memory, so computing
 * replacement candidates never requires reading the full population.final.json.
 * See docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md for
 * the general partitioned-storage mechanism this narrow index predates.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { hashJsonValue } from "../storage/jsonEnvelope";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import type { CertScanMatchStatus, PreparedPopulationRow } from "./populationTypes";
import type { StageAliasMappings } from "./populationConfig";
import { getStageKey, resolveStageMappings, type StageCountKey } from "./stageHelpers";
import {
  REPLACEMENT_INDEX_FORMAT_VERSION,
  type ReplacementIndexBucketEntry,
  type ReplacementIndexManifest,
} from "./replacementIndexTypes";

const REPLACEMENT_INDEX_FOLDER = "replacement-index";
const MANIFEST_FILE = "index.manifest.json";

const ALL_TIERS: readonly CertScanMatchStatus[] = ["Certscan", "NonCertscan"];
const ALL_STAGE_KEYS: readonly StageCountKey[] = ["first", "second", "third", "fourth", "unknown"];

function indexLockKey(monthFolderName: string): string {
  return `replacement-index/${monthFolderName}:rmw`;
}

export function bucketFileName(tier: CertScanMatchStatus, stageKey: StageCountKey): string {
  return `${tier.toLowerCase()}.${stageKey}.json`;
}

/** Single source of truth for the staleness-check hash — build and read sides
 *  must resolve mappings identically or a config edit could go undetected. */
export function computeStageMappingsHash(
  stageMappings?: Partial<StageAliasMappings>
): string {
  return hashJsonValue(resolveStageMappings(stageMappings));
}

async function getReplacementIndexDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create: boolean
): Promise<DirectoryHandleLike> {
  const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
  const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
  return processedDir.getDirectoryHandle(REPLACEMENT_INDEX_FOLDER, { create });
}

export async function loadReplacementIndexManifest(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<ReplacementIndexManifest | null> {
  try {
    const dir = await getReplacementIndexDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<ReplacementIndexManifest>(dir, MANIFEST_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/** True only when the manifest's format, source revision, AND stage-mappings
 *  hash all match the live values — any mismatch means "don't trust this". */
export function isReplacementIndexFresh(
  manifest: ReplacementIndexManifest | null,
  liveSourceRevision: number,
  liveStageMappingsHash: string
): boolean {
  if (!manifest) return false;
  return (
    manifest.formatVersion === REPLACEMENT_INDEX_FORMAT_VERSION &&
    manifest.sourceRevision === liveSourceRevision &&
    manifest.stageMappingsHash === liveStageMappingsHash
  );
}

/**
 * True when `existing` already reflects (or supersedes) what a rebuild for
 * `sourceRevision`/`stageMappingsHash` would produce, so the rebuild can be
 * skipped entirely. Revision alone is NOT sufficient: editing stage-mapping
 * aliases in Settings never touches population.final.json, so sourceRevision
 * stays the same while bucket assignment should change. A revision-only
 * check would treat that case as "nothing to do" and permanently block the
 * self-heal a stale-mappings fallback triggers, until the month is fully
 * reprocessed (bumping sourceRevision for an unrelated reason).
 */
function isRebuildRedundant(
  existing: ReplacementIndexManifest | null,
  sourceRevision: number,
  stageMappingsHash: string
): boolean {
  if (!existing) return false;
  if (existing.sourceRevision > sourceRevision) return true; // a newer index already won — never regress
  if (existing.sourceRevision < sourceRevision) return false; // genuinely stale — must rebuild
  return existing.stageMappingsHash === stageMappingsHash; // same revision: redundant only if mappings also match
}

export async function loadReplacementBucket(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  tier: CertScanMatchStatus,
  stageKey: StageCountKey
): Promise<PreparedPopulationRow[] | null> {
  try {
    const dir = await getReplacementIndexDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<PreparedPopulationRow[]>(dir, bucketFileName(tier, stageKey));
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/**
 * (Re)build the replacement-candidate index from rows already in memory.
 * Never throws — a failure here must not invalidate an otherwise-successful
 * population save (this is a secondary, derived artifact).
 *
 * Monotonic: a rebuild whose sourceRevision is not strictly greater than what's
 * already published is a no-op, so a straggling background rebuild (triggered
 * by a stale-index fallback on one machine) can never clobber a newer index
 * another machine already published after a fresh reprocess.
 */
export async function rebuildReplacementIndex(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  processedRows: PreparedPopulationRow[],
  stageMappings: Partial<StageAliasMappings> | undefined,
  sourceRevision: number,
  builtBy: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await withResourceLock(indexLockKey(monthFolderName), async () => {
      const stageMappingsHash = computeStageMappingsHash(stageMappings);

      // Bail out BEFORE touching any bucket file — bucket files are fixed
      // filenames, not revisioned, so writing them first (with the monotonic
      // guard applied only to the manifest, published last) would let a stale
      // rebuild clobber a newer bucket's content even while the manifest
      // correctly keeps pointing at the newer sourceRevision. This closes the
      // gap for same-machine races, which withResourceLock already serializes
      // (so this check reliably sees the winner of any prior attempt on this
      // machine). A genuinely simultaneous cross-machine bucket write is not
      // fully closed by this — same accepted, documented limitation as the
      // large-population proposal's own index.json commit protocol.
      const existing = await loadReplacementIndexManifest(directoryHandle, monthFolderName);
      if (isRebuildRedundant(existing, sourceRevision, stageMappingsHash)) {
        return { ok: true as const };
      }

      // Single left-to-right pass, insertion-ordered accumulator: capSeeded's
      // Fisher-Yates draw downstream is order-sensitive, so bucket contents
      // must preserve original population row order, never be re-sorted.
      const buckets = new Map<string, PreparedPopulationRow[]>();
      for (const row of processedRows) {
        const stageKey = getStageKey(row.stage, stageMappings);
        const key = `${row.certScanStatus}::${stageKey}`;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.push(row);
        } else {
          buckets.set(key, [row]);
        }
      }

      const dir = await getReplacementIndexDir(directoryHandle, monthFolderName, true);
      const bucketEntries: ReplacementIndexBucketEntry[] = [];
      for (const tier of ALL_TIERS) {
        for (const stageKey of ALL_STAGE_KEYS) {
          const fileName = bucketFileName(tier, stageKey);
          const rows = buckets.get(`${tier}::${stageKey}`);
          if (rows && rows.length > 0) {
            await safeWriteJson(dir, fileName, rows);
            bucketEntries.push({ tier, stageKey, fileName, rowCount: rows.length });
          } else if (dir.removeEntry) {
            // Best-effort: a bucket that shrank to zero rows on a reprocess is
            // simply not referenced by the new manifest, so a leftover file is
            // harmless — but remove it anyway to avoid stale-data confusion.
            try {
              await dir.removeEntry(fileName);
            } catch {
              // ignore — not referenced by the manifest either way
            }
          }
        }
      }

      return await casLoop<{ ok: true } | { ok: false; error: string }>(
        async (writeToken) => {
          const currentResult = await safeReadJson<ReplacementIndexManifest>(dir, MANIFEST_FILE);
          const current = currentResult.ok ? currentResult.value : null;
          if (isRebuildRedundant(current, sourceRevision, stageMappingsHash)) {
            // Already current (a concurrent machine won, or nothing actually
            // changed) — no-op, not a conflict.
            return { done: true, result: { ok: true as const } };
          }
          const manifest: ReplacementIndexManifest = {
            formatVersion: REPLACEMENT_INDEX_FORMAT_VERSION,
            monthFolderName,
            sourceRevision,
            stageMappingsHash,
            builtAt: new Date().toISOString(),
            builtBy,
            totalIndexedRows: processedRows.length,
            buckets: bucketEntries,
            _writeToken: writeToken,
          };
          await safeWriteJson(dir, MANIFEST_FILE, manifest);
          const verify = await safeReadJson<ReplacementIndexManifest>(dir, MANIFEST_FILE);
          if (
            verify.ok &&
            verify.value.sourceRevision === sourceRevision &&
            verify.value._writeToken === writeToken
          ) {
            return { done: true, result: { ok: true as const } };
          }
          return { done: false };
        },
        { conflictError: "تعذّر نشر فهرس بدائل الاستبدال: تعارض في الكتابة بعد عدة محاولات." }
      );
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
