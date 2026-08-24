/**
 * The chunked worker→window transfer protocol for a Population Phase-1 import.
 *
 * Why this exists: `workbookWorker.ts` used to post the ENTIRE parsed result --
 * `RiskWorkbookResult.rows` plus every BI file's rows, each row carrying its
 * full `rawRow` (riskDataNormalizer.ts:261, biDataNormalizer.ts:281) -- in one
 * `postMessage`. Structured clone has to serialize that whole graph into a
 * single contiguous allocation, so a large month failed with
 * `DataCloneError: Data cannot be cloned, out of memory` (XQ-POP-003) before a
 * single row reached the UI.
 *
 * Nothing about the DATA changes here: `createWorkbookResultAccumulator`
 * reassembles exactly the object graph the window used to receive in one
 * message, so `setRiskWorkbookResult` / `applyBiFileResults` are untouched.
 * This is purely how the bytes get across the boundary.
 *
 * NOT a step toward Phase C/D of LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22:
 * the window still ends up holding the complete population. Phase D's answer is
 * to stop returning it at all (proposal §7); if that is ever approved, this
 * module is deleted rather than extended.
 */
import type {
  BiWorkbookResult,
  NormalizedBiRow
} from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type {
  NormalizedRiskRow,
  RiskWorkbookResult
} from "../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import { yieldToMain } from "../data/storage/yieldToMain";
import type { BiFileResult } from "./workbookWorkerTypes";

/**
 * Rows per `postMessage`. Deliberately the SMALLER of the two chunk sizes the
 * ingest pipeline already uses (riskDataWorkbook.ts:131 = 5000,
 * biDataWorkbook.ts:235 = 10000), because a normalized row is wider than a
 * source row: it carries ~30 mapped fields AND the retained `rawRow`.
 *
 * Raising this trades peak allocation for message count. Do not set it to
 * Infinity or 0 -- workbookResultStream.test.ts guards the bound, because
 * losing it silently restores the original OOM.
 */
export const WORKBOOK_ROW_CHUNK_SIZE = 5000;

/** A `RiskWorkbookResult` with the bulk rows removed -- small enough to post whole. */
export type RiskWorkbookShell = Omit<RiskWorkbookResult, "rows">;
/** A `BiWorkbookResult` with the bulk rows removed. */
export type BiWorkbookShell = Omit<BiWorkbookResult, "rows">;
/** `BiFileResult` with its result's bulk rows removed. Keeps the soft-failure shape. */
export type BiFileShell = {
  fileName: string;
  result: BiWorkbookShell | null;
  error?: string;
};

/**
 * Emit `rows` in batches, RELEASING each batch from `rows` as soon as it has
 * been handed to `emit`.
 *
 * The mutation is the point, not a side effect: batching alone still leaves the
 * worker holding the complete dataset while the window builds its own copy. By
 * clearing each emitted span, the worker's retained set shrinks as the window's
 * grows, so peak combined memory stays near one dataset instead of two or three.
 * Callers must therefore treat `rows` as CONSUMED. Every caller in this repo
 * destructures it off a result it is about to discard.
 *
 * Yields between batches so the worker's event loop can drain and GC can
 * reclaim the released rows rather than holding every batch until the end.
 */
export async function streamRowsInChunks<TRow>(
  rows: TRow[],
  emit: (chunk: TRow[]) => void,
  chunkSize: number = WORKBOOK_ROW_CHUNK_SIZE
): Promise<void> {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, rows.length);
    emit(rows.slice(start, end));
    // `emit` is a synchronous postMessage: by the time it returns, the clone
    // exists on the transfer queue and the worker's own references are dead
    // weight. Clearing the span (rather than splicing) keeps this O(n) overall.
    rows.fill(undefined as unknown as TRow, start, end);
    await yieldToMain();
  }
}

export type WorkbookResultAccumulator = {
  acceptRiskRows(rows: NormalizedRiskRow[]): void;
  /** `fileIndex` is index-aligned with `WorkbookWorkerRequest.biFiles`. */
  acceptBiRows(fileIndex: number, rows: NormalizedBiRow[]): void;
  finalize(done: {
    riskResult: RiskWorkbookShell;
    biResults: BiFileShell[];
  }): { riskResult: RiskWorkbookResult; biResults: BiFileResult[] };
};

/**
 * Window side. Collects streamed row batches, then stitches them back into the
 * shells carried by the terminal `done` message.
 *
 * `done` is the single commit point: nothing is applied to React state until it
 * arrives, so a worker that dies mid-stream leaves this accumulator to be
 * garbage-collected with the parse run's closure and never half-applies a
 * population.
 *
 * BI batches are keyed by `fileIndex`, not by arrival order, so per-file
 * isolation is a property of this code rather than of `postMessage` ordering.
 */
export function createWorkbookResultAccumulator(): WorkbookResultAccumulator {
  const riskRows: NormalizedRiskRow[] = [];
  const biRowsByFileIndex = new Map<number, NormalizedBiRow[]>();

  return {
    acceptRiskRows(rows) {
      // A loop, never push(...rows): one BI/risk population already exceeds
      // V8's ~65k argument limit -- same reason as biDataWorkbook.ts:354-356.
      for (const row of rows) riskRows.push(row);
    },
    acceptBiRows(fileIndex, rows) {
      let target = biRowsByFileIndex.get(fileIndex);
      if (!target) {
        target = [];
        biRowsByFileIndex.set(fileIndex, target);
      }
      for (const row of rows) target.push(row);
    },
    finalize(done) {
      return {
        riskResult: { ...done.riskResult, rows: riskRows },
        // Spreading `shell` (rather than rebuilding it field by field)
        // preserves `error`'s PRESENCE as well as its value, so a successful
        // file never acquires a stray `error: undefined` key.
        biResults: done.biResults.map((shell, index) => ({
          ...shell,
          result:
            shell.result === null
              ? null
              : { ...shell.result, rows: biRowsByFileIndex.get(index) ?? [] }
        }))
      };
    }
  };
}
