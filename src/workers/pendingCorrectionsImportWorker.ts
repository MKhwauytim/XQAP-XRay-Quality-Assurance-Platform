/**
 * Off-main-thread XLSX parse for the معلقة (pending) corrections re-import —
 * same "SheetJS parse belongs in a Web Worker" convention as
 * `workbookWorker.ts`. This worker is deliberately dumb: it turns the first
 * sheet into a header row + string-keyed records and hands them back
 * untouched. Every domain rule (which xrayImageIds are known for the month,
 * which columns are correctable, what actually changed) lives on the main
 * thread in `data/population/populationCorrections.ts`, which is plain
 * TypeScript reusable from tests without a worker harness.
 */
import * as XLSX from "xlsx";
import type {
  PendingCorrectionsImportRequest,
  PendingCorrectionsImportResponse,
} from "./pendingCorrectionsImportWorkerTypes";

const ctx = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<PendingCorrectionsImportRequest>) => void) | null;
  postMessage: (msg: PendingCorrectionsImportResponse) => void;
};

const send = (msg: PendingCorrectionsImportResponse) => ctx.postMessage(msg);

ctx.onmessage = async (ev) => {
  try {
    const { file } = ev.data;
    send({ type: "progress", message: "جارٍ قراءة الملف..." });
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      send({ type: "error", error: "الملف لا يحتوي على أي ورقة بيانات." });
      return;
    }
    const sheet = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    if (aoa.length === 0) {
      send({ type: "error", error: "الملف فارغ." });
      return;
    }
    const headerRow = (aoa[0] ?? []).map((cell) => String(cell ?? "").trim());
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < aoa.length; i++) {
      const raw = aoa[i] ?? [];
      // Skip fully-blank rows (a trailing empty row is common in a
      // hand-edited spreadsheet) rather than importing them as a "correction"
      // that clears every field.
      if (raw.every((cell) => cell === "" || cell == null)) continue;
      const record: Record<string, string> = {};
      headerRow.forEach((header, idx) => {
        record[header] = String(raw[idx] ?? "").trim();
      });
      rows.push(record);
    }
    send({ type: "done", headerRow, rows });
  } catch (err) {
    send({ type: "error", error: err instanceof Error ? err.message : "خطأ غير معروف أثناء قراءة الملف." });
  }
};
