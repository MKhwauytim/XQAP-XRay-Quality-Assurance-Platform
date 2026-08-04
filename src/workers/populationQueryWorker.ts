import { unwrap } from "../data/storage/jsonEnvelope";
import type { PopulationFinalData } from "../data/population/monthTypes";
import { runPopulationQuery } from "../data/population/populationQuery";
import { formatMonthFolderShortLabel, parseMonthFolderName } from "../data/population/monthFolder";
import type { StageAliasMappings } from "../data/population/populationConfig";
import type { PopulationQueryWorkerRequest, PopulationQueryWorkerResponse } from "./populationQueryWorkerTypes";

// This worker never receives a DirectoryHandleLike/FileSystemDirectoryHandle — the
// main thread reads population.final.json's raw file text itself and hands that
// string over on a "load" request. Parsing (JSON.parse + envelope unwrap) happens
// here, off the main thread.

export type PopulationQueryWorkerState = {
  cachedRows: Array<Record<string, unknown>> | null;
  /** Set from the "load" request's optional `stageMappings` (see populationQueryWorkerTypes.ts). */
  stageMappings: StageAliasMappings | undefined;
};

export function createInitialWorkerState(): PopulationQueryWorkerState {
  return { cachedRows: null, stageMappings: undefined };
}

// Generic display-value formatting mirroring BrowseDataView.tsx's `formatBrowseCellValue`
// default branch (empty -> "—", arrays joined with an Arabic comma, booleans -> نعم/لا,
// otherwise String(value)).
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

// ── Stage-alias display parity (Task 4) ─────────────────────────────────────────
// Worker-local copy of src/data/population/stageHelpers.ts's normalizeStageToken /
// getStageKey / STAGE_LABELS_AR logic. NOT imported directly: stageHelpers.ts pulls
// its DEFAULT_STAGE_MAPPINGS constant from populationConfig.ts, a file whose other
// exports (safeReadJson, casLoop, withResourceLock, getPopulationRoot) assume a
// main-thread Window/File-System-Access-API context this DedicatedWorker doesn't
// have. Duplicating this small, pure slice avoids dragging that dependency graph
// into the worker bundle -- the same "defined locally per-file rather than shared
// across tab boundaries" idiom BrowseDataView.tsx already uses for its yieldToMain.
// Keep in sync with stageHelpers.ts by hand; both are covered by their own tests.
const WORKER_STAGE_KEYS = ["first", "second", "third", "fourth"] as const;
const WORKER_STAGE_LABELS_AR: Record<(typeof WORKER_STAGE_KEYS)[number], string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};

function normalizeStageToken(value: string): string {
  return value
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـ]/g, "")
    .replace(/[\s_]+/g, "_")
    .toUpperCase();
}

function formatStageLabelForWorker(stage: unknown, stageMappings: StageAliasMappings | undefined): string {
  const text = String(stage ?? "");
  if (!stageMappings) {
    return text;
  }
  const normalized = normalizeStageToken(text.trim());
  for (const stageKey of WORKER_STAGE_KEYS) {
    const aliases = stageMappings[stageKey] ?? [];
    if (aliases.some((alias) => normalizeStageToken(alias) === normalized)) {
      return WORKER_STAGE_LABELS_AR[stageKey];
    }
  }
  return text;
}

// Mirrors BrowseDataView.tsx's real getBrowseDisplayValue: special-cases "stage"
// (alias -> canonical Arabic label) and "_monthFolder" (folder name -> short Arabic
// month/year label) ahead of the generic fallback, so this worker's own search/
// filter/sort matching stays behaviorally identical to the pre-worker inline
// implementation for these two columns -- the CRITICAL gap flagged when this worker
// first shipped (Task 2) and resolved here (Task 4). When `stageMappings` is not
// supplied (older/other callers that don't thread it through "load"), the "stage"
// branch degenerates to a raw passthrough, matching the previous generic-formatter
// behavior for that call shape.
function getWorkerDisplayValue(
  row: Record<string, unknown>,
  key: string,
  stageMappings: StageAliasMappings | undefined
): string {
  if (key === "stage") {
    return formatStageLabelForWorker(row[key], stageMappings);
  }
  if (key === "_monthFolder") {
    return formatMonthFolderShortLabel(String(row[key] ?? ""));
  }
  return formatDisplayValue(row[key]);
}

// Mirrors populationStorage.ts's appendMonthInfo — attaches the constant
// _monthFolder/_month/_year fields a single-month "load" request's rows would
// otherwise be missing (see populationQueryWorkerTypes.ts's "load" doc comment).
function attachMonthFolderInfo(
  row: Record<string, unknown>,
  monthFolder: string
): Record<string, unknown> {
  const info = parseMonthFolderName(monthFolder);
  return {
    ...row,
    _monthFolder: monthFolder,
    _month: info?.month ?? null,
    _year: info?.year ?? null,
  };
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
      const baseRows = Array.isArray(data?.rows) ? data.rows : [];
      const rows = request.monthFolder
        ? baseRows.map((row) => attachMonthFolderInfo(row, request.monthFolder!))
        : baseRows;
      const nextState: PopulationQueryWorkerState = {
        cachedRows: rows,
        stageMappings: request.stageMappings
      };
      return {
        state: nextState,
        response: { type: "loaded", requestId: request.requestId, totalRows: rows.length }
      };
    }

    if (request.type === "query") {
      if (!state.cachedRows) {
        throw new Error("لا توجد بيانات محمّلة بعد — يجب إرسال طلب تحميل قبل الاستعلام.");
      }
      const result = runPopulationQuery(
        state.cachedRows,
        request.params,
        (row, key) => getWorkerDisplayValue(row, key, state.stageMappings)
      );
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
