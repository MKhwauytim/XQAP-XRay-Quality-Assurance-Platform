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
import { userFacingErrorText } from "../storage/writeErrorText";
import { codedMessage } from "../storage/errorCodes";
import { getStageKey } from "../population/stageHelpers";
import type { StageAliasMappings } from "../population/populationConfig";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createRng, drawWithoutReplacement, hashSeedString, type Rng } from "../sampling/rng";
import { appendSampleRow } from "../sampling/sampleStorage";
import {
  appendDistributionEvents,
  refreshDistributionCacheAfterWrite,
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
 *  CertScan tier. Exported for reuse by the indexed candidate-lookup path.
 *  Deliberately typed against a minimal `Pick`, not the full `PreparedPopulationRow`
 *  — the indexed path only ever has the slim `ReplacementIndexRow` projection
 *  available (see `replacementIndexTypes.ts`), and eligibility never needs more
 *  than these two fields. */
export function isEligibleCandidate(
  row: Pick<PreparedPopulationRow, "xrayImageId" | "certScanStatus">,
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

export type ReplacementRowAvailability = "free" | "resume-partial" | "taken";

/**
 * Classify whether `replacementXrayImageId` may be committed as the
 * replacement for `deadXrayImageId`, given a FRESH sample master and derived
 * distribution entries.
 *
 * "taken" — the row is owned by a distribution entry, or sits in the sample
 * for any reason other than a partial write of this very substitution.
 * Committing it would silently transfer ownership or double-count the row.
 *
 * "resume-partial" — the XQ-DIST-005 crash state, and the reason this helper
 * exists: an earlier executeReplacement for this same dead row appended the
 * sample row and retired the dead id (one atomic CAS write — see
 * appendSampleRow), then failed to write the distribution events. The sample
 * says the substitution happened; the event log does not know. Re-running
 * executeReplacement with the SAME candidate is the designed recovery: the
 * sample append no-ops and only the missing events are emitted. Both call
 * sites (approveReplacement step 3b and XrayReferrals' immediate-replace
 * freshness re-check) used to treat this state as taken, which made the
 * failure PERMANENT — every retry was rejected as a conflict, the dead row
 * stayed live, and the appended row stayed stranded with no owner.
 */
export function classifyReplacementRowAvailability(params: {
  replacementXrayImageId: string;
  deadXrayImageId: string;
  sample: Pick<SampleMasterData, "rows" | "replacedRowIds">;
  entries: readonly DistributionEntry[] | null | undefined;
}): ReplacementRowAvailability {
  const { replacementXrayImageId, deadXrayImageId, sample, entries } = params;
  const owned = entries?.some((entry) => entry.xrayImageId === replacementXrayImageId) ?? false;
  const inSample = sample.rows.some((row) => row.xrayImageId === replacementXrayImageId);
  if (!owned && !inSample) return "free";
  if (!owned && inSample && (sample.replacedRowIds ?? []).includes(deadXrayImageId)) {
    return "resume-partial";
  }
  return "taken";
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
  /**
   * Stage alias overrides the month was drawn under. Forwarded to appendSampleRow
   * so the replacement row lands in the right stage bucket; omitted, a workspace
   * with custom aliases silently under-counts stageAllocations.
   */
  stageMappings?: Partial<StageAliasMappings>;
}): Promise<ExecuteReplacementResult> {
  const {
    directoryHandle,
    monthFolderName,
    deadEntry,
    replacementRow,
    reason,
    eventBy,
    sourceRequestId,
    stageMappings,
  } = params;

  // Guard: dead row must not already be replaced or completed.
  if (deadEntry.status === "replaced" || deadEntry.status === "completed") {
    return {
      ok: false,
      error: codedMessage("XQ-DIST-004", { status: deadEntry.status })
    };
  }

  // Step 1: append replacement row to sample master (idempotent — safe to retry).
  // The dead row's id is passed so the append is recorded as a SUBSTITUTION:
  // the sample keeps the size it was drawn at instead of growing by one per
  // replacement (P1-A). The dead row itself stays in `rows` — it is the audit
  // trail and the dedup set `buildExclusionSets` reads.
  const sampleResult = await appendSampleRow(
    directoryHandle,
    monthFolderName,
    replacementRow,
    stageMappings,
    deadEntry.xrayImageId
  );
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
      // The wrapper sentence is Arabic, so the interpolated detail has to be
      // mapped here — at the caller the whole string would already look Arabic
      // and pass through with the raw DOMException text still embedded in it.
      error: codedMessage("XQ-DIST-005", {
        detail: userFacingErrorText(eventsResult.error, "replacement:append-events"),
      }),
      partialSampleWrite: true,
    };
  }

  // A6b/F20: refresh the derived cache + every employee sample mirror after the
  // append, now that pure reads no longer persist them. Without this the
  // replacement flow — the one flow that actually MOVES a row between rows/
  // employees — left `distribution.current.json` and every `{username}.samples.json`
  // stale until the next 45s sync tick. Swallows its own failure by contract;
  // the sample master read back above is the freshest row set available here.
  await refreshDistributionCacheAfterWrite(
    directoryHandle,
    monthFolderName,
    sampleResult.data.rows
  );

  return { ok: true, updatedSample: sampleResult.data };
}
