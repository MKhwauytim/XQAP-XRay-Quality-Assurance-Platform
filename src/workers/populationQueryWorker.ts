import { unwrap } from "../data/storage/jsonEnvelope";
import type { PopulationFinalData } from "../data/population/monthTypes";
import { runPopulationQuery } from "../data/population/populationQuery";
import type { PopulationQueryWorkerRequest, PopulationQueryWorkerResponse } from "./populationQueryWorkerTypes";

// This worker never receives a DirectoryHandleLike/FileSystemDirectoryHandle — the
// main thread reads population.final.json's raw file text itself and hands that
// string over on a "load" request. Parsing (JSON.parse + envelope unwrap) happens
// here, off the main thread.

export type PopulationQueryWorkerState = {
  cachedRows: Array<Record<string, unknown>> | null;
};

export function createInitialWorkerState(): PopulationQueryWorkerState {
  return { cachedRows: null };
}

// Generic display-value formatting mirroring BrowseDataView.tsx's `formatBrowseCellValue`
// default branch (empty -> "—", arrays joined with an Arabic comma, booleans -> نعم/لا,
// otherwise String(value)). Deliberately does NOT special-case the "stage" column
// (stage-mapping labels) or "_monthFolder" (month-folder short labels) the way
// BrowseDataView's real getBrowseDisplayValue does — those depend on caller-supplied
// config (PopulationConfig.stageMappings) that isn't part of this task's protocol.
// A later task threading full display parity into the worker can extend this.
function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (Array.isArray(value)) {
    return value.map(formatDisplayValue).join("، ");
  }

  if (typeof value === "boolean") {
    return value ? "نعم" : "لا";
  }

  return String(value);
}

function getGenericDisplayValue(row: Record<string, unknown>, key: string): string {
  return formatDisplayValue(row[key]);
}

/**
 * Pure request handler — extracted out of `ctx.onmessage` so it is directly
 * unit-testable without a real Worker environment (Vitest's node/jsdom cannot run
 * a real DedicatedWorker; see Population.wizard.test.tsx's WORKER BOUNDARY comment
 * for the established precedent on this exact limitation). `ctx.onmessage` below is
 * a thin wrapper that just threads module-level state through this function.
 */
export function handleWorkerMessage(
  state: PopulationQueryWorkerState,
  request: PopulationQueryWorkerRequest
): { state: PopulationQueryWorkerState; response: PopulationQueryWorkerResponse } {
  try {
    if (request.type === "load") {
      const parsed: unknown = JSON.parse(request.rawJsonText);
      // population.final.json is written as a JsonEnvelope (`{ metadata, data }`) by
      // safeWriteJson; `unwrap` also tolerates legacy bare (un-enveloped) JSON, same
      // as safeReadJson does on the main thread.
      const data = unwrap<PopulationFinalData>(parsed);
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const nextState: PopulationQueryWorkerState = { cachedRows: rows };
      return {
        state: nextState,
        response: { type: "loaded", requestId: request.requestId, totalRows: rows.length }
      };
    }

    if (request.type === "query") {
      if (!state.cachedRows) {
        throw new Error("لا توجد بيانات محمّلة بعد — يجب إرسال طلب تحميل قبل الاستعلام.");
      }
      const result = runPopulationQuery(state.cachedRows, request.params, getGenericDisplayValue);
      return {
        state,
        response: { type: "result", requestId: request.requestId, result }
      };
    }

    // Exhaustive per PopulationQueryWorkerRequest's discriminated union (only "load"
    // and "query" exist); kept as a defensive fallback rather than relying on
    // unreachable-code inference alone.
    const unhandled: never = request;
    throw new Error(`Unknown population-query worker request: ${JSON.stringify(unhandled)}`);
  } catch (err) {
    return {
      state,
      response: {
        type: "error",
        requestId: request.requestId,
        error: err instanceof Error ? err.message : "خطأ غير معروف في عامل استعلام المجتمع."
      }
    };
  }
}

// At runtime this module executes inside a DedicatedWorker, not a Window.
// We cast globalThis once to avoid conflicts with the DOM lib's Window types
// (same pattern as workbookWorker.ts).
const ctx = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<PopulationQueryWorkerRequest>) => void) | null;
  postMessage: (msg: PopulationQueryWorkerResponse) => void;
};

const send = (msg: PopulationQueryWorkerResponse) => ctx.postMessage(msg);

let workerState: PopulationQueryWorkerState = createInitialWorkerState();

ctx.onmessage = (ev) => {
  const { state, response } = handleWorkerMessage(workerState, ev.data);
  workerState = state;
  send(response);
};
