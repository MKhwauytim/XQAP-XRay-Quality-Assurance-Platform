# Comprehensive Executive Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New Reports sub-tab that builds one executive report across all system months (completed samples only), optionally merged with an uploaded workbook (system wins on same image ID + month).

**Architecture:** Workbook rows are mapped straight to `ExecutiveReportRow` (the engine's own row type). A new optional `ExecutiveReportInput.rowsOverride` lets `buildReportModel` run on pre-built rows, so deck2/deck3/document/XLSX builders are reused unchanged. The 144 MB workbook is read by a dependency-free zip + XML reader (central directory + native `DecompressionStream`) that inflates only the needed sheets, inside a Web Worker. SheetJS cannot do this: its whole-workbook read did not finish in 2 min on this file.

**Tech Stack:** React 19, TypeScript strict, Vitest, Web Worker (`?worker&inline`), native `DecompressionStream`.

**Spec:** `docs/superpowers/specs/2026-10-05-comprehensive-executive-report-design.md`

## Global Constraints
- UI text Arabic, RTL; strings via `DEFAULT_LABELS` in `src/data/labels/labelsStore.ts`, not inlined.
- No new npm dependency. `dist/` stays a single `index.html`; never add files to `public/`.
- Sub-tab-only component exports a default component and **nothing else** (no `tabConfig`).
- Never invent metrics: every figure comes from a mapped real column. Unrecognised values are counted in the mapping report, not dropped silently.
- Merge rule: workbook row skipped iff system has same `xrayImageId` **and** same month folder. System wins.
- Completed: system `isRowStudied(row)`; workbook `الاكتمال == "مكتمل"`.
- Population-level scope only (no employee performance).
- Workbook data is memory-only; never written to the workspace.
- Gates (tier 3): `lint`, `typecheck`, `test:run`, `check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`; edit log via `npm run editlog -- --tier=3 --append --sync-package "Add (reports): ..."`.

## Deviations from spec (stated up front)
1. `Q*_Pop` sheets are **not read** (the `بطاقة العمل` sheet already carries population/sample counts, and 900k rows buy nothing for a completed-sample report).
2. `بطاقة العمل` and `data issue` are **not parsed in v1** (no new deck slides, no preview table). Follow-up item.
3. Rollup is one combined report over all periods (month labelled `جميع_الأشهر`), not per-period reports.

## Review Focus
- Same image ID in two different months, inside the combined input → must not collapse into one row (Task 5 test).
- Workbook row with blank/garbled `الشهر` or `معرف الأشعة` → counted in report, never crashes (Task 3 test).
- Workbook `نتيجة المستوى الأول/الثاني` empty or unknown → row skipped + counted, not defaulted (Task 3 test).
- System has zero months / zero completed rows and no file → clear empty state, no empty report (Task 7).
- Workbook lacks a `*_Sample` sheet or a required column → named Arabic error (Task 4 test).

## File Structure
- Modify `src/data/reporting/executiveReportTypes.ts` — add `rowsOverride?`.
- Modify `src/data/reporting/executiveReportData.ts` — honour `rowsOverride`; export `deriveRowAccuracy`.
- Modify `src/data/reporting/executive/model/reportModel.ts` — BI-count guard when override present.
- Create `src/data/workbookImport/zipReader.ts` — central directory + inflate.
- Create `src/data/workbookImport/sheetXml.ts` — shared strings + sheet row parser.
- Create `src/data/workbookImport/workbookColumnMap.ts` — column → row mapping + `MappingReport`.
- Create `src/data/workbookImport/readWorkbook.ts` — orchestrates; returns rows + report.
- Create `src/workers/comprehensiveWorkbookWorker.ts` (+ `…Types.ts`).
- Create `src/data/workbookImport/mergeWithSystem.ts` — dedupe + combined input.
- Create `src/data/reporting/loadMonthExecInput.ts` — extracted from `TabView.tsx:371-415`.
- Create `src/components/Sidebar/Tabs/Reports/ComprehensiveExecutive/index.tsx` (+ `.css`).
- Modify `src/auth/tabCatalog.ts`, `src/auth/userManagement.ts`, `Reports/index.tsx`, `Reports/TabView.tsx`, `labelsStore.ts`, listed tests.

---

### Task 1: `rowsOverride` in the engine

**Files:** Modify `executiveReportTypes.ts`, `executiveReportData.ts`, `executive/model/reportModel.ts`; Test `src/data/reporting/executiveReportData.rowsOverride.test.ts`.

**Interfaces:**
- Produces: `ExecutiveReportInput.rowsOverride?: ExecutiveReportRow[]`; `export function deriveRowAccuracy(levelOne: ResultValue, levelTwo: ResultValue, imageResult: ResultValue, expert: ResultValue | null): Pick<ExecutiveReportRow,"imageResultAccurate"|"levelOneAccurate"|"levelTwoAccurate"|"verificationCategory">` where `ResultValue = "سليمة" | "اشتباه"`.

- [ ] **Step 1: Snapshot first.** Run `npx vitest run src/data/reporting` and note it green (deterministic-by-contract area).
- [ ] **Step 2: Failing test**
```ts
import { describe, expect, it } from "vitest";
import { buildExecutiveReportRows, deriveRowAccuracy } from "./executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";

describe("rowsOverride", () => {
  it("returns override rows verbatim", () => {
    const rows = [{ xrayImageId: "X1" }] as never;
    const out = buildExecutiveReportRows({
      monthFolderName: "all", populationRows: [], sample: null, distribution: null,
      employeeFiles: [], template: null, config: DEFAULT_EXEC_CONFIG, rowsOverride: rows,
    });
    expect(out).toBe(rows);
  });
  it("deriveRowAccuracy matches the §9 truth table", () => {
    const a = deriveRowAccuracy("اشتباه", "سليمة", "اشتباه", "اشتباه");
    expect(a.levelOneAccurate).toBe(true);
    expect(a.levelTwoAccurate).toBe(false);
    expect(a.verificationCategory).toBe("correct-suspicious");
    expect(deriveRowAccuracy("سليمة", "سليمة", "سليمة", null).verificationCategory).toBeNull();
  });
});
```
- [ ] **Step 3:** Run it; expect FAIL (`deriveRowAccuracy` not exported, `rowsOverride` unknown).
- [ ] **Step 4: Implement.** In `executiveReportTypes.ts` add to `ExecutiveReportInput`: `rowsOverride?: ExecutiveReportRow[];` with a doc comment "pre-built rows (comprehensive report); skips derivation". In `executiveReportData.ts` open `buildExecutiveReportRows` (line 104): where it computes `imageResultAccurate/levelOneAccurate/levelTwoAccurate/verificationCategory`, move that block into exported `deriveRowAccuracy(...)` (same logic, same outputs) and call it from there; then add as the first line of `buildExecutiveReportRows`: `if (input.rowsOverride) return input.rowsOverride;`. In `reportModel.ts` lines ~269-274 (`biMatched`/`biEnrichmentStatus` counts from `input.populationRows`): wrap so that when `input.rowsOverride` is set those counts take the same "BI not provided" state the model already uses for months without BI (read the surrounding code; reuse that state, do not invent one).
- [ ] **Step 5:** Run `npx vitest run src/data/reporting` — all prior tests + new pass (snapshot unchanged).
- [ ] **Step 6: Commit** `git add -A && git commit -m "Add (reporting): rowsOverride input + deriveRowAccuracy"`

---

### Task 2: Zip reader

**Files:** Create `src/data/workbookImport/zipReader.ts`; Test `zipReader.test.ts`.

**Interfaces:** Produces `readZipDirectory(file: Blob): Promise<Map<string, ZipEntry>>`, `readZipEntryText(file: Blob, entry: ZipEntry): Promise<string>`, `type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number }`.

- [ ] **Step 1: Failing test** (builds a real xlsx with the vendored SheetJS, which is also a zip)
```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readZipDirectory, readZipEntryText } from "./zipReader";

function xlsxBlob(): Blob {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], ["1", "2"]]), "S");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([buf]);
}
describe("zipReader", () => {
  it("lists and inflates entries", async () => {
    const f = xlsxBlob();
    const dir = await readZipDirectory(f);
    expect(dir.has("xl/workbook.xml")).toBe(true);
    const xml = await readZipEntryText(f, dir.get("xl/workbook.xml")!);
    expect(xml).toContain('name="S"');
  });
  it("rejects non-zip", async () => {
    await expect(readZipDirectory(new Blob(["nope"]))).rejects.toThrow("XQ-WB-ZIP");
  });
});
```
- [ ] **Step 2:** Run; FAIL (module missing).
- [ ] **Step 3: Implement**
```ts
export type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number };

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

export async function readZipDirectory(file: Blob): Promise<Map<string, ZipEntry>> {
  const tailLen = Math.min(file.size, 66_000);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("XQ-WB-ZIP: not a zip/xlsx file");
  const count = u16(tail, eocd + 10);
  const dirSize = u32(tail, eocd + 12);
  const dirOffset = u32(tail, eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new Error("XQ-WB-ZIP: zip64 not supported");
  const dir = new DataView(await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const out = new Map<string, ZipEntry>();
  const dec = new TextDecoder("utf-8");
  let p = 0;
  for (let n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (u32(dir, p) !== 0x02014b50) throw new Error("XQ-WB-ZIP: corrupt central directory");
    const nameLen = u16(dir, p + 28), extraLen = u16(dir, p + 30), commentLen = u16(dir, p + 32);
    const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    out.set(name, { name, method: u16(dir, p + 10), compressedSize: u32(dir, p + 20), localOffset: u32(dir, p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function readZipEntryText(file: Blob, entry: ZipEntry): Promise<string> {
  const head = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  if (u32(head, 0) !== 0x04034b50) throw new Error("XQ-WB-ZIP: bad local header");
  const start = entry.localOffset + 30 + u16(head, 26) + u16(head, 28);
  const body = file.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return body.text();
  if (entry.method !== 8) throw new Error(`XQ-WB-ZIP: unsupported method ${entry.method}`);
  const stream = body.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}
```
- [ ] **Step 4:** Run; PASS. **Step 5:** commit `Add (workbookImport): dependency-free zip reader`.

---

### Task 3: Sheet XML parser + column map

**Files:** Create `sheetXml.ts`, `workbookColumnMap.ts`; Tests `sheetXml.test.ts`, `workbookColumnMap.test.ts`.

**Interfaces:**
- Produces `parseSharedStrings(xml: string): string[]`; `parseSheetRows(xml: string, shared: string[]): Array<Record<string,string>>` keyed by **column letter**; `rowsByHeader(rows): Array<Record<string,string>>` (first row = headers);
- `type MappingReport = { sheetsRead: { name: string; rows: number }[]; totalRows: number; completed: number; incomplete: number; skippedNoId: number; skippedNoMonth: number; skippedBadResult: number; unmappedValues: Record<string, Record<string, number>> }`; `newMappingReport(): MappingReport`;
- `type MappedWorkbookRow = { row: ExecutiveReportRow; month: string; sheet: string }`; `mapSampleRow(cells: Record<string,string>, sheet: string, report: MappingReport): MappedWorkbookRow | null` (returns `null` for incomplete or skipped rows after counting them).
- Consumes `parseStudyMonth` (`src/data/adhocImport/adhocMonthBinding.ts:252`), `classifyImageResult` (`src/data/population/imageResult`), `deriveRowAccuracy` (Task 1).

- [ ] **Step 1: Failing tests**
```ts
// sheetXml.test.ts
import { describe, expect, it } from "vitest";
import { parseSharedStrings, parseSheetRows, rowsByHeader } from "./sheetXml";
describe("sheetXml", () => {
  const ss = parseSharedStrings('<sst><si><t>الاكتمال</t></si><si><t>مكتمل</t></si><si><t>a &amp; b</t></si></sst>');
  it("decodes shared strings", () => expect(ss).toEqual(["الاكتمال", "مكتمل", "a & b"]));
  it("reads rows by header", () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>n</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>46023</v></c></row></sheetData></worksheet>';
    expect(rowsByHeader(parseSheetRows(xml, ss))).toEqual([{ "الاكتمال": "مكتمل", n: "46023" }]);
  });
});
```
```ts
// workbookColumnMap.test.ts
import { describe, expect, it } from "vitest";
import { mapSampleRow, newMappingReport } from "./workbookColumnMap";

const base = {
  "معرف الأشعة": "30B8202512010003", "الشهر": "46023", "المستوى": "FORTH_STAGE",
  "نتيجة المستوى الأول": "اشتباه", "نتيجة المستوى الثاني": "سليمة", "صحة النتيجة": "سليمة",
  "الاكتمال": "مكتمل", "هل يوجد صورة؟": "نعم", "هل يوجد تحديد؟": "لا", "مستوى جودة الصورة": "عالي",
  "اسم المنفذ": "ميناء", "نوع المنفذ": "منفذ بحري", "رمز المنفذ": "30",
};
describe("mapSampleRow", () => {
  it("maps a completed row", () => {
    const r = newMappingReport();
    const m = mapSampleRow(base, "Q1_Sample", r)!;
    expect(m.month).toBe("1-january-2026");
    expect(m.row.expertResult).toBe("سليمة");
    expect(m.row.imageAvailable).toBe(true);
    expect(m.row.hasMarking).toBe(false);
    expect(m.row.imageQuality).toBe("عالي");
    expect(m.row.answerStatus).toBe("submitted");
    expect(r.completed).toBe(1);
  });
  it("counts incomplete without mapping", () => {
    const r = newMappingReport();
    expect(mapSampleRow({ ...base, "الاكتمال": "" }, "Q1_Sample", r)).toBeNull();
    expect(r.incomplete).toBe(1);
  });
  it("counts missing id / month / level result", () => {
    const r = newMappingReport();
    mapSampleRow({ ...base, "معرف الأشعة": "" }, "S", r);
    mapSampleRow({ ...base, "الشهر": "" }, "S", r);
    mapSampleRow({ ...base, "نتيجة المستوى الأول": "؟" }, "S", r);
    expect([r.skippedNoId, r.skippedNoMonth, r.skippedBadResult]).toEqual([1, 1, 1]);
    expect(r.unmappedValues["نتيجة المستوى الأول"]["؟"]).toBe(1);
  });
  it("maps invalid image id to unavailable with reason", () => {
    const m = mapSampleRow({ ...base, "هل يوجد صورة؟": "معرف غير صحيح" }, "S", newMappingReport())!;
    expect(m.row.imageAvailable).toBe(false);
    expect(m.row.noImageReason).toBe("معرف غير صحيح");
  });
});
```
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3: Implement `sheetXml.ts`**
```ts
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, g: string) =>
    g[0] === "#" ? String.fromCodePoint(g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : (ENT[g] ?? m));
const textOf = (x: string) => {
  let o = ""; for (const m of x.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) o += m[1]; return decode(o);
};

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) out.push(m[1] ? textOf(m[1]) : "");
  return out;
}

export function parseSheetRows(xml: string, shared: string[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rec: Record<string, string> = {};
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] ?? "";
      const col = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!col) continue;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let val: string | undefined;
      if (t === "inlineStr") val = textOf(inner);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) val = t === "s" ? (shared[Number(v)] ?? "") : decode(v);
      }
      if (val !== undefined && val !== "") rec[col] = val;
    }
    rows.push(rec);
  }
  return rows;
}

export function rowsByHeader(rows: Array<Record<string, string>>): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const hdr = rows[0];
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    for (const [col, name] of Object.entries(hdr)) if (r[col] !== undefined) o[name] = r[col];
    return o;
  });
}
```
- [ ] **Step 4: Implement `workbookColumnMap.ts`**
```ts
import { parseStudyMonth } from "../adhocImport/adhocMonthBinding";
import { classifyImageResult } from "../population/imageResult";
import { deriveRowAccuracy } from "../reporting/executiveReportData";
import type { ExecutiveReportRow } from "../reporting/executiveReportTypes";

export type MappingReport = {
  sheetsRead: { name: string; rows: number }[];
  totalRows: number; completed: number; incomplete: number;
  skippedNoId: number; skippedNoMonth: number; skippedBadResult: number;
  unmappedValues: Record<string, Record<string, number>>;
};
export type MappedWorkbookRow = { row: ExecutiveReportRow; month: string; sheet: string };

export const newMappingReport = (): MappingReport => ({
  sheetsRead: [], totalRows: 0, completed: 0, incomplete: 0,
  skippedNoId: 0, skippedNoMonth: 0, skippedBadResult: 0, unmappedValues: {},
});

const COMPLETED = "مكتمل";
type Result = "سليمة" | "اشتباه";
type Level = "عالي" | "متوسط" | "منخفض";

function note(r: MappingReport, col: string, v: string) {
  const c = (r.unmappedValues[col] ??= {});
  c[v] = (c[v] ?? 0) + 1;
}
function result(r: MappingReport, col: string, v: string | undefined): Result | null {
  const s = v?.trim() ?? "";
  if (s === "") return null;
  if (s === "سليمة" || s === "اشتباه") return s;
  note(r, col, s);
  return null;
}
function level(r: MappingReport, col: string, v: string | undefined): Level | null {
  const s = v?.trim() ?? "";
  if (s === "") return null;
  if (s === "عالي" || s === "متوسط" || s === "منخفض") return s;
  note(r, col, s);
  return null;
}
const text = (v: string | undefined) => (v?.trim() ? v.trim() : null);

export function mapSampleRow(c: Record<string, string>, sheet: string, report: MappingReport): MappedWorkbookRow | null {
  report.totalRows++;
  if ((c["الاكتمال"] ?? "").trim() !== COMPLETED) { report.incomplete++; return null; }
  const id = text(c["معرف الأشعة"]);
  if (!id) { report.skippedNoId++; return null; }
  const month = parseStudyMonth(c["الشهر"]);
  if (!month) { report.skippedNoMonth++; return null; }
  const l1 = result(report, "نتيجة المستوى الأول", c["نتيجة المستوى الأول"]);
  const l2 = result(report, "نتيجة المستوى الثاني", c["نتيجة المستوى الثاني"]);
  if (!l1 || !l2) { report.skippedBadResult++; return null; }
  const expert = result(report, "صحة النتيجة", c["صحة النتيجة"]);
  const imageResult = classifyImageResult(l1, l2);
  const img = (c["هل يوجد صورة؟"] ?? "").trim();
  const imageAvailable = img === "نعم" ? true : img === "" ? null : false;
  if (img !== "" && img !== "نعم" && img !== "لا" && img !== "معرف غير صحيح") note(report, "هل يوجد صورة؟", img);
  const mark = (c["هل يوجد تحديد؟"] ?? "").trim();
  const row: ExecutiveReportRow = {
    xrayImageId: id,
    portCode: text(c["رمز المنفذ"]), portName: text(c["اسم المنفذ"]), portType: text(c["نوع المنفذ"]),
    movementType: null, stage: text(c["المستوى"]),
    levelOneEmployeeId: null, levelTwoEmployeeId: null,
    levelOneResult: l1, levelTwoResult: l2, imageResult,
    selectedInSample: true, assignedTo: null, distributionStatus: null,
    expertResult: expert, imageAvailable,
    noImageReason: imageAvailable === false ? (img === "لا" ? "لا توجد صورة" : img) : null,
    hasMarking: mark === "نعم" ? true : mark === "لا" ? false : null,
    imageQuality: level(report, "مستوى جودة الصورة", c["مستوى جودة الصورة"]),
    lowQualityReason: text(c["أسباب انخفاض الجودة"]),
    suspicionLevel: level(report, "تقييم الاشتباه", c["تقييم الاشتباه"]),
    suspectedTypes: text(c["الاصناف المشبوهة"]), smuggleMethod: text(c["الية التهريب المحتملة"]),
    answerStatus: "submitted", assignedAt: null, submittedAt: null,
    ...deriveRowAccuracy(l1, l2, imageResult, expert),
    otherResults: {
      manual: { result: result(report, "نتيجة المعاين", c["نتيجة المعاين"]), employeeId: null },
      opposite: { result: result(report, "نتيجة المفتش المعاكس", c["نتيجة المفتش المعاكس"]), employeeId: null },
      liveMeans: { result: result(report, "نتيجة الوسائل الحية", c["نتيجة الوسائل الحية"]), employeeId: null },
    },
    notes: text(c["الملاحظات العامة"]),
  };
  report.completed++;
  return { row, month, sheet };
}
```
(If `tsc` reports other required `ExecutiveReportRow` fields beyond those listed at `executiveReportTypes.ts:33-91`, set them to `null`; do not add defaults that fabricate values.)
- [ ] **Step 5:** `npx vitest run src/data/workbookImport` PASS. Confirm the stage value: open a system-shaped fixture (`reportTestFixtures.makeRow`) and verify `stage` uses the same raw strings (`FIRST_STAGE`…); if the system normalises, apply the same normaliser to `c["المستوى"]`.
- [ ] **Step 6:** commit `Add (workbookImport): sheet xml parser and column mapping`.

---

### Task 4: Workbook reader + worker

**Files:** Create `readWorkbook.ts`, `src/workers/comprehensiveWorkbookWorkerTypes.ts`, `src/workers/comprehensiveWorkbookWorker.ts`; Test `readWorkbook.test.ts`.

**Interfaces:**
- Produces `readComprehensiveWorkbook(file: Blob, onProgress?: (p: {sheet: string; done: number; total: number}) => void): Promise<{ rows: MappedWorkbookRow[]; report: MappingReport }>`; throws `Error("XQ-WB-NOSAMPLE: ...")` when no `Q\d_Sample` sheet; `XQ-WB-COLUMNS` when a required header is missing.
- Worker request `{ file: File }`; messages `{type:"progress", sheet, done, total} | {type:"done", rows: MappedWorkbookRow[], report: MappingReport} | {type:"error", code: string, message: string}`.

- [ ] **Step 1: Failing test** (synthetic xlsx via SheetJS with a sample sheet, one incomplete row, one non-sample sheet that must not be read)
```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readComprehensiveWorkbook } from "./readWorkbook";

const H = ["الربع","الشهر","المستوى","معرف الأشعة","نتيجة المستوى الأول","نتيجة المستوى الثاني","صحة النتيجة","الاكتمال"];
function wbBlob(sheets: Record<string, string[][]>): Blob {
  const wb = XLSX.utils.book_new();
  for (const [n, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n);
  return new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer]);
}
describe("readComprehensiveWorkbook", () => {
  it("reads only *_Sample sheets, completed rows", async () => {
    const f = wbBlob({
      Q1_Sample: [H, ["Q1","46023","FIRST_STAGE","A1","سليمة","اشتباه","اشتباه","مكتمل"], ["Q1","46023","FIRST_STAGE","A2","سليمة","سليمة","سليمة",""]],
      Q2_Pop: [["x"], ["y"]],
    });
    const { rows, report } = await readComprehensiveWorkbook(f);
    expect(rows.map((r) => r.row.xrayImageId)).toEqual(["A1"]);
    expect(report.sheetsRead.map((s) => s.name)).toEqual(["Q1_Sample"]);
    expect(report.incomplete).toBe(1);
  });
  it("errors when no sample sheet", async () => {
    await expect(readComprehensiveWorkbook(wbBlob({ Q1_Pop: [["x"]] }))).rejects.toThrow("XQ-WB-NOSAMPLE");
  });
  it("errors when a required column is missing", async () => {
    await expect(readComprehensiveWorkbook(wbBlob({ Q1_Sample: [["معرف الأشعة"], ["A"]] }))).rejects.toThrow("XQ-WB-COLUMNS");
  });
});
```
(`الشهر` "46023" is an Excel serial; it goes through `parseStudyMonth`'s serial path.)
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3: Implement**
```ts
import { readZipDirectory, readZipEntryText } from "./zipReader";
import { parseSharedStrings, parseSheetRows, rowsByHeader } from "./sheetXml";
import { mapSampleRow, newMappingReport, type MappedWorkbookRow, type MappingReport } from "./workbookColumnMap";

const REQUIRED = ["معرف الأشعة", "الشهر", "نتيجة المستوى الأول", "نتيجة المستوى الثاني", "الاكتمال"];
const SAMPLE_SHEET = /^Q\d_Sample$/;

export async function readComprehensiveWorkbook(
  file: Blob,
  onProgress?: (p: { sheet: string; done: number; total: number }) => void,
): Promise<{ rows: MappedWorkbookRow[]; report: MappingReport }> {
  const dir = await readZipDirectory(file);
  const need = (n: string) => { const e = dir.get(n); if (!e) throw new Error(`XQ-WB-ZIP: missing ${n}`); return e; };
  const wbXml = await readZipEntryText(file, need("xl/workbook.xml"));
  const relXml = await readZipEntryText(file, need("xl/_rels/workbook.xml.rels"));
  const target = new Map<string, string>();
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target.set(id, t.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const sheets: { name: string; path: string }[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const path = rid ? target.get(rid) : undefined;
    if (name && path && SAMPLE_SHEET.test(name)) sheets.push({ name, path });
  }
  if (sheets.length === 0) throw new Error("XQ-WB-NOSAMPLE: no Q*_Sample sheet found");
  const ssEntry = dir.get("xl/sharedStrings.xml");
  const shared = ssEntry ? parseSharedStrings(await readZipEntryText(file, ssEntry)) : [];
  const report = newMappingReport();
  const rows: MappedWorkbookRow[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const { name, path } = sheets[i];
    onProgress?.({ sheet: name, done: i, total: sheets.length });
    const raw = parseSheetRows(await readZipEntryText(file, need(path)), shared);
    const headers = new Set(Object.values(raw[0] ?? {}));
    const missing = REQUIRED.filter((h) => !headers.has(h));
    if (missing.length) throw new Error(`XQ-WB-COLUMNS: ${name} missing ${missing.join("، ")}`);
    const data = rowsByHeader(raw);
    report.sheetsRead.push({ name, rows: data.length });
    for (const cells of data) { const m = mapSampleRow(cells, name, report); if (m) rows.push(m); }
  }
  onProgress?.({ sheet: "", done: sheets.length, total: sheets.length });
  return { rows, report };
}
```
Worker (`comprehensiveWorkbookWorker.ts`), same `globalThis` cast pattern as `src/workers/workbookWorker.ts`:
```ts
import { readComprehensiveWorkbook } from "../data/workbookImport/readWorkbook";
import type { ComprehensiveWorkerRequest, ComprehensiveWorkerMessage } from "./comprehensiveWorkbookWorkerTypes";

const ctx = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<ComprehensiveWorkerRequest>) => void) | null;
  postMessage: (m: ComprehensiveWorkerMessage) => void;
};
ctx.onmessage = async (ev) => {
  try {
    const { rows, report } = await readComprehensiveWorkbook(ev.data.file, (p) => ctx.postMessage({ type: "progress", ...p }));
    ctx.postMessage({ type: "done", rows, report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.postMessage({ type: "error", code: /^(XQ-WB-[A-Z]+)/.exec(msg)?.[1] ?? "XQ-WB-UNKNOWN", message: msg });
  }
};
```
Types file exports `ComprehensiveWorkerRequest = { file: File }` and the `ComprehensiveWorkerMessage` union above (importing `MappedWorkbookRow`, `MappingReport` types).
- [ ] **Step 4:** Run tests PASS. **Step 5 (real-file smoke, not committed):** write a scratch Node script in the scratchpad that calls `readComprehensiveWorkbook(new Blob([fs.readFileSync(realPath)]))` via `npx tsx`; expect Q1 completed ≈17,466, finishing without OOM. Record counts + wall time in the edit log. If Node's string limit or memory fails on a ~30 MB sheet, fall back to chunked row scanning in `parseSheetRows` (stream by `<row` boundaries from a `ReadableStream`).
- [ ] **Step 6:** commit `Add (workbookImport): workbook reader and worker`.

---

### Task 5: Merge + combined input

**Files:** Create `src/data/reporting/loadMonthExecInput.ts`, `src/data/workbookImport/mergeWithSystem.ts`; Modify `Reports/TabView.tsx:371-415`; Test `mergeWithSystem.test.ts`.

**Interfaces:**
- Produces `loadMonthExecInput(directoryHandle: DirectoryHandleLike, month: string): Promise<ExecutiveReportInput | null>` (body moved **verbatim** from `TabView.tsx` `loadExecInput`, with `selectedMonth`→`month`); TabView's `loadExecInput` becomes `() => directoryHandle && selectedMonth ? loadMonthExecInput(directoryHandle, selectedMonth) : Promise.resolve(null)`.
- `type MergeStats = { systemMonths: number; systemCompleted: number; workbookRead: number; duplicatesSkipped: number; workbookAdded: number }`
- `mergeCompletedRows(systemByMonth: Array<{ month: string; rows: ExecutiveReportRow[] }>, workbook: MappedWorkbookRow[]): { rows: ExecutiveReportRow[]; stats: MergeStats }` — system rows filtered by `isRowStudied` and `selectedInSample`; workbook row dropped iff `${id}|${month}` already in the system set; ids that collide across months in the final list get suffix `@${month}` on the later occurrences.
- `buildComprehensiveInput(rows: ExecutiveReportRow[], base: ExecutiveReportInput): ExecutiveReportInput` — `{ ...base, monthFolderName: "جميع_الأشهر", populationRows: [], sample: null, distribution: null, employeeFiles: [], rowsOverride: rows }` (`base` supplies `config`, `template`, `stageMappings`).

- [ ] **Step 1: Failing tests**
```ts
import { describe, expect, it } from "vitest";
import { mergeCompletedRows } from "./mergeWithSystem";
import { makeRow } from "../reporting/reportTestFixtures";

const sys = (id: string, studied = true) => ({
  ...makeRow(id, "P"), selectedInSample: true,
  answerStatus: studied ? ("submitted" as const) : ("draft" as const), imageAvailable: true as boolean | null,
});
const wb = (id: string, month: string) => ({ row: { ...sys(id) }, month, sheet: "Q1_Sample" });

describe("mergeCompletedRows", () => {
  it("system wins on same id+month; keeps same id in another month", () => {
    const { rows, stats } = mergeCompletedRows(
      [{ month: "1-january-2026", rows: [sys("A")] }],
      [wb("A", "1-january-2026"), wb("A", "2-february-2026"), wb("B", "1-january-2026")],
    );
    expect(stats.duplicatesSkipped).toBe(1);
    expect(stats.workbookAdded).toBe(2);
    expect(rows).toHaveLength(3);
  });
  it("never collapses an id repeated across months", () => {
    const { rows } = mergeCompletedRows([], [wb("A", "1-january-2026"), wb("A", "2-february-2026")]);
    expect(new Set(rows.map((r) => r.xrayImageId)).size).toBe(2);
  });
  it("drops non-completed system rows", () => {
    const { rows } = mergeCompletedRows([{ month: "1-january-2026", rows: [sys("A", false)] }], []);
    expect(rows).toHaveLength(0);
  });
});
```
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3: Implement** `mergeCompletedRows` exactly per the interface (Set of `${id}|${month}` from system completed rows; iterate workbook; then a final pass counting ids, suffixing later repeats with `@month`; the first/earliest occurrence keeps the plain id). Extract `loadMonthExecInput` and re-point TabView; run `npx vitest run src/components/Sidebar/Tabs/Reports` to prove the refactor changed nothing.
- [ ] **Step 4:** All PASS. **Step 5:** commit `Refactor (reports): extract loadMonthExecInput; Add (workbookImport): merge`.

---

### Task 6: Sub-tab registration

**Files:** Modify `tabCatalog.ts`, `userManagement.ts`, `Reports/index.tsx`, `Reports/TabView.tsx` (`KNOWN_RAIL_SUB_TABS`), and the enumerating tests found by the scan.

- [ ] **Step 1:** In `tabCatalog.ts` after line 66 add `{ id: "reports/comprehensive-executive", label: "تقرير تنفيذي شامل", parentId: "reports", allowedRoles: ["supervisor", "manager", "admin"] },`.
- [ ] **Step 2:** In `userManagement.ts` add one default-permission row per role beside the `report-designer` rows (guest/employee/supervisor `none`, manager/admin `edit`), same shape as lines 475-514.
- [ ] **Step 3:** In `Reports/index.tsx` `tabConfig.subTabs` add `{ id: "comprehensive-executive", label: "تقرير تنفيذي شامل", allowedRoles: tabAllowedRoles("reports/comprehensive-executive") }`; in `TabView.tsx` add the id to `KNOWN_RAIL_SUB_TABS` and render it exactly like `visitedReportDesigner` (lazy, kept mounted after first visit, `TabGuard tabId="reports/comprehensive-executive"`, `Suspense`).
- [ ] **Step 4:** Run `npx vitest run src/auth src/components/Sidebar/Tabs/Reports src/components/Sidebar/Tabs/Population/Population.foreignSubTabGuard.test.tsx`; update the literal expected lists the failures point at (`userManagement.test.ts:55-77`, `tabCatalog.test.ts`, `Reports/index.test.tsx` stub for the new lazy component) until green.
- [ ] **Step 5:** commit `Add (reports): comprehensive-executive sub-tab registration`.

---

### Task 7: UI page

**Files:** Create `Reports/ComprehensiveExecutive/index.tsx`, `ComprehensiveExecutive.css`; Modify `labelsStore.ts`; Test `ComprehensiveExecutive.test.tsx`.

**Interfaces:** default export `ComprehensiveExecutive()` only. Uses `useWorkspace` (directory handle), `useLabels`, `listMonthFolders`, `loadMonthExecInput`, `buildExecutiveReportRows`, `mergeCompletedRows`, `buildComprehensiveInput`, worker via `import ComprehensiveWorkbookWorker from "../../../../../workers/comprehensiveWorkbookWorker?worker&inline"`, and the openers (`openExecutiveReport`, `openExecutiveDeckV2`, `openExecutiveDeckV3`, `buildExecutiveXlsx`, lazily imported like `TabView.tsx` `handleExport`).

- [ ] **Step 1: Labels.** Add keys to `DEFAULT_LABELS` (all Arabic): `ce_title` "تقرير تنفيذي شامل", `ce_subtitle` "لجميع الأشهر — للعينات المكتملة فقط", `ce_upload_hint` "رفع ملف Excel (اختياري)", `ce_reading` "جارٍ قراءة الملف…", `ce_load_system` "تحميل بيانات النظام", `ce_stat_system_months`, `ce_stat_system_completed`, `ce_stat_wb_read`, `ce_stat_wb_incomplete`, `ce_stat_dup_skipped` "مكرر (مطابق للنظام: نفس المعرف والشهر)", `ce_stat_wb_added`, `ce_empty` "لا توجد عينات مكتملة لإنشاء التقرير", `ce_generate_doc/deck2/deck3/xlsx`, `ce_unmapped_title` "قيم غير معروفة في الملف", `ce_error_NOSAMPLE`, `ce_error_COLUMNS`, `ce_error_ZIP`, `ce_error_UNKNOWN`.
- [ ] **Step 2: Failing test (jsdom, `/* @vitest-environment jsdom */` line 1)** — mock `?worker&inline` with a fake worker that posts `done` with one mapped row; mock `listMonthFolders` → `[]`; assert: page renders title; with no file and no system months the generate buttons are disabled and `ce_empty` is shown; after selecting a file the stats panel shows the workbook-read count; a worker `error` with code `XQ-WB-NOSAMPLE` shows the `ce_error_NOSAMPLE` text.
- [ ] **Step 3: Implement.** State: `systemState: loading | ready`, `fileState: none | reading | read | error`. On mount (and on `dataRefreshSignal`, never clobbering a loaded workbook) load every month: for each folder `loadMonthExecInput` → `buildExecutiveReportRows(input)` → `{month, rows}`; skip months returning `null`. File input `accept=".xlsx"`; on select spawn the worker, wire `progress|done|error|messageerror` with a 180 000 ms silence watchdog (same pattern as `Population/index.tsx`), terminate on unmount. Recompute `mergeCompletedRows(systemByMonth, workbookRows)` with `useMemo`; show stats grid, unmapped-values table from `report.unmappedValues`, and `ce_empty` when `rows.length === 0`. Generate buttons: `base` = first loaded system input, else `{ monthFolderName: "جميع_الأشهر", populationRows: [], sample: null, distribution: null, employeeFiles: [], template: null, config: DEFAULT_EXEC_CONFIG }`; `const input = buildComprehensiveInput(rows, base)`; edition handlers copy the invocation shapes from `TabView.tsx` `handleExport` (document / v2 with `loadDeckStyleChoices` / v3 / xlsx). Wrap actions in the same export-permission check `handleExport` uses. CSS uses existing tokens (no raw hex — `check:hex-literals`).
- [ ] **Step 4:** Run the component test PASS; `npm run lint && npm run typecheck`.
- [ ] **Step 5:** commit `Add (reports): comprehensive executive report page`.

---

### Task 8: Verification and release gates

- [ ] **Step 1:** `npm run test:run` (all green; report any pre-existing failure by name, do not mask).
- [ ] **Step 2:** `npm run lint`, `npm run typecheck`, `npm run check:complexity`, `npm run check:hex-literals`, `npm run build`, `npm run check:bundle-size`, `npm run check:vendor`.
- [ ] **Step 3: Real-app check.** `npm run dev`; in Chrome/Edge open the sub-tab, upload the real 144 MB workbook, confirm: progress moves, Q1/Q2/Q3 completed counts match the file (Q1 = 17,466), duplicates vs system shown, document edition opens, Arabic RTL renders, no console errors. If the worker run exceeds memory, apply the Task 4 fallback and re-run.
- [ ] **Step 4:** `npm run editlog -- --tier=3 --append --sync-package "Add (reports): comprehensive executive report (system + optional workbook)"`, fill prose (Why/What/Before-After/migration none), then `npm run check:release`.
- [ ] **Step 5:** commit; stop before pushing — `npm run build` already run; open the PR only when the user asks.
