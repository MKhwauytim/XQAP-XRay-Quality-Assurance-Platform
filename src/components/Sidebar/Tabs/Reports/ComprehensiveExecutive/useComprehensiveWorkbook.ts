import { useCallback, useEffect, useRef, useState } from "react";
import ComprehensiveWorkbookWorker from "../../../../../workers/comprehensiveWorkbookWorker?worker&inline";
import type {
  ComprehensiveWorkerMessage,
  ComprehensiveWorkerRequest,
} from "../../../../../workers/comprehensiveWorkbookWorkerTypes";
import type { MappedWorkbookRow, MappingReport } from "../../../../../data/workbookImport/workbookColumnMap";
import { logError } from "../../../../../data/storage/errorLogger";

/** Same silence-based watchdog as Population's workbook import: re-armed on every worker message. */
const SILENCE_LIMIT_MS = 180_000;

export type WorkbookErrorCode = "NOSAMPLE" | "COLUMNS" | "ZIP" | "UNKNOWN";

export type WorkbookState =
  | { status: "none" }
  | { status: "reading"; fileName: string; sheet: string | null }
  | { status: "read"; fileName: string; rows: MappedWorkbookRow[]; report: MappingReport }
  | { status: "error"; fileName: string; code: WorkbookErrorCode };

const KNOWN_CODES: Record<string, WorkbookErrorCode> = {
  "XQ-WB-NOSAMPLE": "NOSAMPLE",
  "XQ-WB-COLUMNS": "COLUMNS",
  "XQ-WB-ZIP": "ZIP",
};

export function toWorkbookErrorCode(code: string): WorkbookErrorCode {
  return KNOWN_CODES[code] ?? "UNKNOWN";
}

/**
 * Owns the comprehensive-workbook worker: one worker per selected file, memory
 * only (the workbook is never written anywhere). A result from a replaced or
 * removed file is ignored via the run token and by terminating its worker.
 */
export function useComprehensiveWorkbook(): {
  state: WorkbookState;
  selectFile: (file: File) => void;
  removeFile: () => void;
} {
  const [state, setState] = useState<WorkbookState>({ status: "none" });
  const stopRef = useRef<(() => void) | null>(null);
  const runRef = useRef(0);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const removeFile = useCallback(() => {
    runRef.current++;
    stop();
    setState({ status: "none" });
  }, [stop]);

  const selectFile = useCallback((file: File) => {
    const run = ++runRef.current;
    stop();
    setState({ status: "reading", fileName: file.name, sheet: null });

    const worker = new ComprehensiveWorkbookWorker();
    let watchdog: number | undefined;
    const finish = () => {
      if (watchdog !== undefined) window.clearTimeout(watchdog);
      worker.removeEventListener("message", onMessage as EventListener);
      worker.removeEventListener("error", onFail);
      worker.removeEventListener("messageerror", onFail);
      worker.terminate();
      if (stopRef.current === finish) stopRef.current = null;
    };
    const fail = (code: WorkbookErrorCode) => {
      finish();
      if (runRef.current === run) setState({ status: "error", fileName: file.name, code });
    };
    const armWatchdog = () => {
      if (watchdog !== undefined) window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        logError("comprehensive-executive:workbook-worker-silent", new Error(`No worker progress for ${SILENCE_LIMIT_MS} ms.`));
        fail("UNKNOWN");
      }, SILENCE_LIMIT_MS);
    };
    function onMessage(ev: MessageEvent<ComprehensiveWorkerMessage>): void {
      if (runRef.current !== run) return;
      const msg = ev.data;
      armWatchdog();
      if (msg.type === "progress") {
        setState({ status: "reading", fileName: file.name, sheet: msg.sheet });
      } else if (msg.type === "done") {
        finish();
        setState({ status: "read", fileName: file.name, rows: msg.rows, report: msg.report });
      } else {
        logError("comprehensive-executive:workbook-read", new Error(`${msg.code}: ${msg.message}`));
        fail(toWorkbookErrorCode(msg.code));
      }
    }
    function onFail(ev: unknown): void {
      logError("comprehensive-executive:workbook-worker-error", ev);
      fail("UNKNOWN");
    }

    stopRef.current = finish;
    worker.addEventListener("message", onMessage as EventListener);
    worker.addEventListener("error", onFail);
    worker.addEventListener("messageerror", onFail);
    armWatchdog();
    worker.postMessage({ file } satisfies ComprehensiveWorkerRequest);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { state, selectFile, removeFile };
}
