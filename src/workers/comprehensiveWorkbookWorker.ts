import { readComprehensiveWorkbooks } from "../data/workbookImport/readWorkbook";
import type { ComprehensiveWorkerRequest, ComprehensiveWorkerMessage } from "./comprehensiveWorkbookWorkerTypes";

const ctx = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<ComprehensiveWorkerRequest>) => void) | null;
  postMessage: (m: ComprehensiveWorkerMessage) => void;
};
ctx.onmessage = async (ev) => {
  try {
    const { rows, report, populationSummary } = await readComprehensiveWorkbooks(ev.data.files, (p) => ctx.postMessage({ type: "progress", ...p }), { requireFollowUp: ev.data.requireFollowUp });
    ctx.postMessage({ type: "done", rows, report, populationSummary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.postMessage({ type: "error", code: /^(XQ-WB-[A-Z]+)/.exec(msg)?.[1] ?? "XQ-WB-UNKNOWN", message: msg });
  }
};
