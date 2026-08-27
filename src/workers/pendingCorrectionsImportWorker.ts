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

// Well above any realistic معلقة queue size for this app's domain, but low
// enough that a pathological accidental multi-hundred-thousand-row upload
// fails fast with a message instead of hanging the tab.
const MAX_IMPORT_ROWS = 20_000;

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
    // Cap check happens HERE — right after `aoa.length` is known (an O(1) read;
    // `sheet_to_json` already fully materialized the array-of-arrays above) and
    // BEFORE the per-row loop below builds a `Record<string,string>` for every
    // row. Doing it here, rather than after that loop, means an oversized sheet
    // fails fast instead of paying for the full per-row construction anyway.
    //
    // This counts RAW post-header rows, not just non-blank ones. Counting only
    // non-blank rows (as a naive "cap the useful rows" reading would do) is
    // actually the wrong choice here: the blank-row filter in the loop below is
    // itself only a cheap `Array.every` scan, so it doesn't save the expensive
    // work either way — and worse, it would let a sheet padded with hundreds of
    // thousands of blank rows sail through the cap (few "real" rows) while still
    // forcing the worker to allocate and scan that entire huge array-of-arrays,
    // which is exactly the slowness this cap exists to prevent.
    const dataRowCount = aoa.length - 1;
    if (dataRowCount > MAX_IMPORT_ROWS) {
      send({
        type: "error",
        error: `عدد صفوف الملف (${dataRowCount.toLocaleString("ar-SA-u-nu-latn")}) يتجاوز الحد الأقصى المسموح به (${MAX_IMPORT_ROWS.toLocaleString("ar-SA-u-nu-latn")} صف).`,
      });
      return;
    }
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
