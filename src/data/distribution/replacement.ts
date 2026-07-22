/**
 * Replacement business logic — candidate selection + atomic execution.
 *
 * Rules implemented (per spec §13.3 / §13.5):
 *  1. Candidate must be same CertScan tier as the dead row (preserve ratio + license).
 *  2. Candidate must not already be in the sample master (dedup, ISSUE-004).
 *  3. Candidate must not already have a distribution event (dedup against owned rows).
 *  4. Preferred pool: same stage → same port (recommended) or same stage (all).
 *  5. Cascade: if same-stage pool empty, fall back to the stage with the most remaining
 *     candidates of the same tier (spec §13.3 highest-supply cascade).
 *  6. Execution is atomic-enough: sample row appended first (idempotent guard), then
 *     distribution events written. Events are the source of truth; a partial failure
 *     between the two writes can be detected and retried by the caller.
 */

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DistributionEntry } from "./distributionTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getStageKey } from "../population/stageHelpers";
import type { StageAliasMappings } from "../population/populationConfig";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createRng, drawWithoutReplacement, hashSeedString, type Rng } from "../sampling/rng";
import { appendSampleRow } from "../sampling/sampleStorage";
import {
  appendDistributionEvents,
} from "./distributionStorage";
import {
  buildAssignEvent,
  buildReplacedEvent,
} from "./distributionLog";

export type ReplacementCandidates = {
  recommended: PreparedPopulationRow[];
  all: PreparedPopulationRow[];
};

/**
 * Compute valid replacement candidates for a dead distribution entry.
 *
 * @param entry       The entry being replaced (dead row).
 * @param populationRows  All processed rows for the month.
 * @param sampleMaster    Current sample master (rows in sample are excluded).
 * @param allEntries      All distribution entries (owned rows are excluded).
 * @param stageMappings   Optional stage alias overrides.
 */
// Deterministic cap: draws `limit` rows with the caller's seeded RNG so the
// same inputs always produce the same candidate list (audit reproducibility).
// Exported so replacementCandidateLookup.ts can apply the identical cap to
// rows sourced from the replacement-candidate index instead of a full scan.
export function capSeeded<T>(pool: T[], limit: number, rng: Rng): T[] {
  if (pool.length <= limit) return pool;
  return drawWithoutReplacement(pool, limit, rng);
}

export const REPLACEMENT_POOL_LIMIT = 100;

/** Ids to exclude from candidacy: already sampled, or already owned by any
 *  distribution entry. Exported so both the full-scan and indexed candidate
 *  paths apply the exact same dedup rule. */
export function buildExclusionSets(
  sampleMaster: SampleMasterData,
  allEntries: DistributionEntry[]
): { sampleIds: Set<string>; ownedIds: Set<string> } {
  return {
    sampleIds: new Set(sampleMaster.rows.map((r) => r.xrayImageId)),
    ownedIds: new Set(allEntries.map((e) => e.xrayImageId)),
  };
}

/** A row is eligible as a replacement for `entry` when it has a valid id, isn't
 *  the dead row itself, isn't already sampled/owned, and shares the dead row's
 *  CertScan tier. Exported for reuse by the indexed candidate-lookup path. */
export function isEligibleCandidate(
  row: PreparedPopulationRow,
  entry: DistributionEntry,
  sampleIds: Set<string>,
  ownedIds: Set<string>
): boolean {
  return (
    Boolean(row.xrayImageId) &&
    row.xrayImageId !== entry.xrayImageId &&
    !sampleIds.has(row.xrayImageId) &&
    !ownedIds.has(row.xrayImageId) &&
    row.certScanStatus === entry.row.certScanStatus
  );
}

export function getReplacementCandidates(
  entry: DistributionEntry,
  populationRows: PreparedPopulationRow[],
  sampleMaster: SampleMasterData,
  allEntries: DistributionEntry[],
  stageMappings?: Partial<StageAliasMappings>
): ReplacementCandidates {
  // Seeded per dead-row RNG: same draw seed + same dead row => same candidate
  // list on every call, so replacement pools are reproducible for audits.
  const rng = createRng(hashSeedString(`${sampleMaster.rngSeed}:${entry.xrayImageId}`));

  const { sampleIds, ownedIds } = buildExclusionSets(sampleMaster, allEntries);
  const deadStageKey = getStageKey(entry.row.stage, stageMappings);

  // Base pool: valid id, not the dead row itself, not already sampled, not owned, same tier.
  const base = populationRows.filter((row) => isEligibleCandidate(row, entry, sampleIds, ownedIds));

  // Primary pool: same stage.
  const sameStage = base.filter(
    (row) => getStageKey(row.stage, stageMappings) === deadStageKey
  );

  // Recommended: same stage AND same port (strict, no fallback).
  const recommended = sameStage.filter(
    (row) => row.portName === entry.row.portName
  );

  if (sameStage.length > 0) {
    return {
      recommended: capSeeded(recommended, REPLACEMENT_POOL_LIMIT, rng),
      all: capSeeded(sameStage, REPLACEMENT_POOL_LIMIT, rng),
    };
  }

  const rowsByStage = new Map<string, PreparedPopulationRow[]>();
  for (const row of base) {
    const stageKey = getStageKey(row.stage, stageMappings);
    const rows = rowsByStage.get(stageKey) ?? [];
    rows.push(row);
    rowsByStage.set(stageKey, rows);
  }

  const fallbackStage = Array.from(rowsByStage.entries()).sort(
    ([stageA, rowsA], [stageB, rowsB]) =>
      rowsB.length - rowsA.length || stageA.localeCompare(stageB)
  )[0];

  return { recommended: [], all: capSeeded(fallbackStage?.[1] ?? [], REPLACEMENT_POOL_LIMIT, rng) };
}

export type ExecuteReplacementResult =
  | { ok: true; updatedSample: SampleMasterData }
  | { ok: false; error: string; partialSampleWrite?: true };

/**
 * Execute a replacement: atomically-enough appends the new row to the sample
 * master and writes the distribution events.
 *
 * Ordering: sample append first (idempotent), then events (source of truth).
 * If the events write fails after a successful sample append, the error result
 * carries `partialSampleWrite: true` so the caller can surface a recoverable
 * error and prompt the user to retry — on retry the sample append is a no-op.
 *
 * Pre-conditions:
 *  - `deadEntry.status` should be "pending" (not already replaced/completed).
 *  - `replacementRow` should still be eligible (callers should re-check after any delay).
 */
export async function executeReplacement(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  deadEntry: DistributionEntry;
  replacementRow: PreparedPopulationRow;
  reason: string;
  eventBy: string;
  /** Idempotency key stamped onto both emitted events (replay detection). */
  sourceRequestId?: string;
}): Promise<ExecuteReplacementResult> {
  const { directoryHandle, monthFolderName, deadEntry, replacementRow, reason, eventBy, sourceRequestId } = params;

  // Guard: dead row must not already be replaced or completed.
  if (deadEntry.status === "replaced" || deadEntry.status === "completed") {
    return {
      ok: false,
      error: `لا يمكن استبدال هذه العينة — الحالة الحالية: ${deadEntry.status}.`
    };
  }

  // Step 1: append replacement row to sample master (idempotent — safe to retry).
  const sampleResult = await appendSampleRow(directoryHandle, monthFolderName, replacementRow);
  if (!sampleResult.ok) {
    return { ok: false, error: sampleResult.error };
  }

  // Step 2: write the distribution events (source of truth).
  const events = [
    {
      ...buildAssignEvent({
        xrayImageId: replacementRow.xrayImageId,
        assignedTo: deadEntry.assignedTo,
        eventBy,
        notes: `استبدال للمعرف ${deadEntry.xrayImageId} — ${reason}`,
      }),
      sourceRequestId,
    },
    {
      ...buildReplacedEvent({
        xrayImageId: deadEntry.xrayImageId,
        assignedTo: deadEntry.assignedTo,
        replacedById: replacementRow.xrayImageId,
        eventBy,
        notes: reason,
      }),
      sourceRequestId,
    },
  ];

  const eventsResult = await appendDistributionEvents(directoryHandle, monthFolderName, events);
  if (!eventsResult.ok) {
    return {
      ok: false,
      error: `تمت إضافة البديل للعينة لكن فشل تسجيل الحدث — يُرجى المحاولة مرة أخرى: ${eventsResult.error}`,
      partialSampleWrite: true,
    };
  }

  return { ok: true, updatedSample: sampleResult.data };
}
