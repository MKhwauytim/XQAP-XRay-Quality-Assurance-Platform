// Reads the dropped workbook off the main thread, so the page stays responsive
// while a few hundred MB of sheet XML is streamed. The same worker writes the
// processed-data workbook, which streams the population sheets again.

import { readReportWorkbook, streamPopulation } from "./readWorkbook";
import type { WorkbookRead } from "./readWorkbook";
import { buildDataWorkbook } from "../../data/reporting/portReport/dataWorkbook";
import type { PortStudyRow } from "../../data/reporting/portReport/portReportModel";

export type DataWorkbookRequest = { kind: "dataXlsx"; file: File; studies: PortStudyRow[]; portNames: Record<string, string>; months: string[]; excludeTransit: boolean };
export type WorkerRequest = { kind?: "read"; file: File } | DataWorkbookRequest;
export type WorkerMessage =
  | { type: "progress"; stage: string; done: number; total: number }
  | { type: "result"; read: WorkbookRead }
  | { type: "dataXlsx"; blob: Blob }
  | { type: "error"; message: string };

const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const req = event.data;
    const data = await req.file.arrayBuffer();
    if (req.kind === "dataXlsx") {
      const keep = new Set(req.months);
      const blob = await buildDataWorkbook({
        readPopulation: (onRow) => streamPopulation(data, onRow),
        studies: req.studies,
        portNames: req.portNames,
        keepMonth: (ym) => keep.has(ym),
        excludeTransit: req.excludeTransit,
        progress: (stage) => post({ type: "progress", stage, done: 0, total: 1 }),
      });
      post({ type: "dataXlsx", blob });
      return;
    }
    const read = await readReportWorkbook(data, (stage, done, total) => post({ type: "progress", stage, done, total }));
    post({ type: "result", read });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
