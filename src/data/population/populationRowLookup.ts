import { codedMessage } from "../storage/errorCodes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "./populationTypes";
import type {
  PopulationQueryWorkerRequest,
  PopulationQueryWorkerResponse,
} from "../../workers/populationQueryWorkerTypes";
import { loadMonthPopulationFinalRawText } from "./populationStorage";

/**
 * Resolve ONE population row by `xrayImageId` without running `JSON.parse` on the
 * main thread (item 1.12).
 *
 * ## Why this exists
 *
 * Confirming a replacement needs the FULL population row (the candidate list only
 * carries the slim replacement-index projection), so it read `population.final.json`
 * end-to-end and kept exactly one row. On a large month that parse is seconds of
 * blocked main thread — the app-freeze users actually report. The read itself is
 * unavoidable today; what this moves is the parse, into the same dedicated worker
 * Population Browse already uses.
 *
 * ## Why a plain function and not a hook
 *
 * `usePopulationBrowseWorker` owns a long-lived worker plus a three-slot staleness
 * guard tuned for Browse's interleaved query streams. Neither caller here has streams
 * to keep straight — each wants one answer, once — and one of them is data-layer code
 * that cannot consume a hook at all. Reusing that hook would mean lifting its lane
 * machinery into a place with no lanes; this owns a worker for the duration of one
 * lookup and terminates it.
 *
 * Note this does NOT share Browse's cache: workers are per-instance, so a prior Browse
 * visit does not make this lookup free. The win here is strictly that the main thread
 * stays responsive, not that the work disappears — that happens when `sample.master`
 * stops storing full rows and the replacement index can answer this directly.
 */
export type PopulationRowLookupResult =
  /** `row: null` = parsed fine, no such id (the stale-candidate case). */
  | { ok: true; row: PreparedPopulationRow | null }
  /** The lookup could not be performed — missing/corrupt file, or the worker failed. */
  | { ok: false; error: string };

/** Injectable for tests: Vitest cannot construct a real DedicatedWorker. */
export type PopulationQueryWorkerLike = {
  postMessage: (message: PopulationQueryWorkerRequest) => void;
  terminate: () => void;
  onmessage: ((ev: MessageEvent<PopulationQueryWorkerResponse>) => void) | null;
  // Optional so a test double can omit them; a real Worker always has both.
  // Without these a dead worker leaves the caller's promise unsettled forever.
  onerror?: ((ev: unknown) => void) | null;
  onmessageerror?: ((ev: unknown) => void) | null;
};

export type FindPopulationRowByIdOptions = {
  /**
   * Overrides worker construction. Defaults to a lazy `import()` of the real worker —
   * lazy so that merely importing this module (which data-layer tests do transitively)
   * never pulls Vite's `?worker&inline` specifier into a Node test environment.
   */
  spawnWorker?: () => Promise<PopulationQueryWorkerLike>;
};

async function defaultSpawnWorker(): Promise<PopulationQueryWorkerLike> {
  const { default: PopulationQueryWorker } = await import(
    "../../workers/populationQueryWorker?worker&inline"
  );
  return new PopulationQueryWorker() as unknown as PopulationQueryWorkerLike;
}

export async function findPopulationRowById(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  xrayImageId: string,
  options?: FindPopulationRowByIdOptions
): Promise<PopulationRowLookupResult> {
  const rawJsonText = await loadMonthPopulationFinalRawText(directoryHandle, monthFolderName);
  if (rawJsonText === null) {
    // Matches the direct-read path's behaviour: a month with no readable
    // population.final.json yields no row rather than throwing.
    return { ok: false, error: "تعذر قراءة ملف مجتمع الشهر." };
  }

  let worker: PopulationQueryWorkerLike;
  try {
    worker = await (options?.spawnWorker ?? defaultSpawnWorker)();
  } catch {
    return { ok: false, error: "تعذر تشغيل عامل استعلام المجتمع." };
  }

  try {
    return await new Promise<PopulationRowLookupResult>((resolve) => {
      // Two requests are posted back-to-back without awaiting the "loaded" reply:
      // the worker processes its message queue in order, so "rowById" cannot be
      // served before the "load" that precedes it. Only the second reply is acted
      // on; the "loaded" reply is ignored on purpose.
      const LOAD_REQUEST_ID = 1;
      const LOOKUP_REQUEST_ID = 2;

      // A worker that DIES never sends a message, so without these the promise
      // below never settles: the `finally` that terminates the worker never
      // runs (leaking it), and the caller — the replacement confirm dialog —
      // spins forever with no error. This function exists precisely because
      // population.final.json is big enough to freeze the main thread, i.e. big
      // enough to OOM the worker parsing it, so the failure it guards against
      // is the one most likely to kill it.
      //
      // `resolve`, not `reject`: every caller already handles `{ ok: false }`,
      // and the outer `finally` still terminates the worker either way.
      worker.onerror = () => {
        resolve({ ok: false, error: codedMessage("XQ-POP-007") });
      };
      // Delivery failure of a message that WAS sent — a payload that could not
      // be deserialized. Distinct event from `error`, and just as silent.
      worker.onmessageerror = () => {
        resolve({ ok: false, error: codedMessage("XQ-POP-007") });
      };

      worker.onmessage = (ev: MessageEvent<PopulationQueryWorkerResponse>) => {
        const response = ev.data;
        if (response.type === "row" && response.requestId === LOOKUP_REQUEST_ID) {
          resolve({ ok: true, row: (response.row as PreparedPopulationRow | null) ?? null });
          return;
        }
        if (response.type === "error") {
          // Covers a failed load (unparseable file) as well as a failed lookup —
          // either way this call cannot produce a row, and the distinction is not
          // one any caller acts on.
          resolve({ ok: false, error: response.error });
        }
      };

      // Deliberately no `stageMappings`/`monthFolder`: this path must return exactly
      // what `loadMonthPopulationFinal` returned, and that accessor does NOT run
      // rows through `appendMonthInfo` (unlike its siblings in populationStorage.ts).
      // Passing `monthFolder` here would silently add _monthFolder/_month/_year to a
      // row that then gets written into sample.master.
      worker.postMessage({ type: "load", requestId: LOAD_REQUEST_ID, rawJsonText });
      worker.postMessage({ type: "rowById", requestId: LOOKUP_REQUEST_ID, xrayImageId });
    });
  } finally {
    worker.terminate();
  }
}
