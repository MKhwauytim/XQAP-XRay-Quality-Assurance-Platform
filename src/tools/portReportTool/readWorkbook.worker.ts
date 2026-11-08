// Reads the dropped workbook off the main thread, so the page stays responsive
// while a few hundred MB of sheet XML is streamed.

import { readReportWorkbook } from "./readWorkbook";
import type { WorkbookRead } from "./readWorkbook";

export type WorkerRequest = { file: File };
export type WorkerMessage =
  | { type: "progress"; stage: string; done: number; total: number }
  | { type: "result"; read: WorkbookRead }
  | { type: "error"; message: string };

const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const data = await event.data.file.arrayBuffer();
    const read = await readReportWorkbook(data, (stage, done, total) => post({ type: "progress", stage, done, total }));
    post({ type: "result", read });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
