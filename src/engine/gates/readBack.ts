import JSZip from "jszip";
import * as XLSX from "xlsx";
import { typedRowSources } from "../data/typing";
import { LAYOUT } from "../layout/layoutReport";
import type { EngineIssue } from "../errors";
import type { LayoutDoc } from "../layout/types";
import { EMU_PER_PX } from "../pptx/units";
import type { ReportSpec } from "../spec/types";
import { SOURCE_HEADERS, SOURCE_KEY_HEADER, SOURCE_SHEET } from "../xlsx/planWorkbook";
import type { WorkbookPlan } from "../xlsx/planWorkbook";
import { decodeXml, matchingClose, tokenizeXml } from "../xml/tokenize";
import type { XmlTag, XmlToken } from "../xml/tokenize";

/**
 * Gate read-backs: the issued bytes are read again, never the in-memory model, so a gate sees what a reader opens.
 * Everything runs on the shared XML tokenizer and SheetJS; there is no DOMParser in node and no new dependency.
 */

/** One text box, table cell or shape as read back. Positions in px on the 1920x1080 slide. */
export interface ReadBox { id: string; x: number; y: number; lines: number; text: string }

/** Every non-directory entry of a zip as text. */
export async function zipParts(bytes: Uint8Array): Promise<Map<string, string>> {
  const z = await JSZip.loadAsync(bytes);
  const out = new Map<string, string>();
  for (const name of Object.keys(z.files).sort()) if (!z.files[name].dir) out.set(name, await z.files[name].async("string"));
  return out;
}

const opens = (t: XmlToken, name: string): boolean => (t.k === "open" || t.k === "self") && t.name === name;
const attr = (t: XmlToken, key: string): string | undefined => (t.k === "text" ? undefined : t.attrs.get(key));
const num = (s: string | undefined): number => (s === undefined ? 0 : Number(s));
const px = (emu: number): number => emu / EMU_PER_PX;

/** Decoded `a:t` text and the `a:br` count in tokens `[from, to]`. */
function textIn(toks: XmlToken[], from: number, to: number): { text: string; brs: number } {
  let text = "";
  let brs = 0;
  for (let i = from; i <= to; i++) {
    const t = toks[i];
    if (opens(t, "a:br")) brs++;
    else if (t.k === "open" && t.name === "a:t") {
      const inner = toks[i + 1];
      if (inner?.k === "text") text += decodeXml(inner.text);
    }
  }
  return { text, brs };
}

function firstTag(toks: XmlToken[], from: number, to: number, name: string): XmlTag | undefined {
  for (let i = from; i <= to; i++) if (opens(toks[i], name)) return toks[i] as XmlTag;
  return undefined;
}

function tableCells(toks: XmlToken[], from: number, to: number, name: string, x0: number, y0: number): ReadBox[] {
  const colW: number[] = [];
  const out: ReadBox[] = [];
  let row = -1;
  let y = y0;
  let rowH = 0;
  for (let i = from; i <= to; i++) {
    const t = toks[i];
    if (opens(t, "a:gridCol")) colW.push(px(num(attr(t, "w"))));
    else if (opens(t, "a:tr")) {
      if (row >= 0) y += rowH;
      row++;
      rowH = px(num(attr(t, "h")));
      let col = 0;
      const trEnd = matchingClose(toks, i);
      for (let j = i + 1; j < trEnd; j++) {
        if (!opens(toks[j], "a:tc")) continue;
        const tcEnd = matchingClose(toks, j);
        const { text, brs } = textIn(toks, j, tcEnd);
        const x = x0 + colW.slice(0, col).reduce((a, w) => a + w, 0);
        out.push({ id: `${name}-r${row}c${col}`, x, y, lines: brs + 1, text });
        col++;
        j = tcEnd;
      }
      i = trEnd;
    }
  }
  return out;
}

/**
 * Chart part text in cache order: category labels as cached, values formatted with the first data-label
 * format code (`c:dLbls/c:numFmt`), which is what PowerPoint draws; the cache's own code is `General`.
 */
function chartText(xml: string): string {
  const toks = tokenizeXml(xml);
  const parts: string[] = [];
  let code: string | undefined;
  let inVal = false;
  let inLabels = false;
  let inCat = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === "open" && t.name === "c:val") inVal = true;
    else if (t.k === "close" && t.name === "c:val") inVal = false;
    else if (t.k === "open" && t.name === "c:cat") inCat = true;
    else if (t.k === "close" && t.name === "c:cat") inCat = false;
    else if (t.k === "open" && t.name === "c:dLbls") inLabels = true;
    else if (t.k === "close" && t.name === "c:dLbls") inLabels = false;
    else if (inLabels && code === undefined && opens(t, "c:numFmt")) code = attr(t, "formatCode");
    else if ((inVal || inCat) && t.k === "open" && t.name === "c:v" && toks[i + 1]?.k === "text") {
      const v = decodeXml((toks[i + 1] as { text: string }).text);
      parts.push(inVal ? formatCached(v, code ?? "General") : v);
    }
  }
  return parts.join(" ");
}

/** The two format codes the PPTX writer emits for chart labels: `0.00"%"` and `#,##0.00` (digits vary). */
export function formatCached(v: string, code: string): string {
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n)) return v;
  const m = /0(?:\.(0+))?/.exec(code.replace(/#,##/, ""));
  const digits = m?.[1]?.length ?? 0;
  const pct = code.includes('"%"') || code.endsWith("%");
  const fixed = n.toFixed(digits);
  const grouped = code.includes("#,##") ? Number(fixed).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : fixed;
  return pct ? `${grouped}%` : grouped;
}

function relTargets(rels: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of tokenizeXml(rels ?? "")) if (opens(t, "Relationship")) out.set(attr(t, "Id") ?? "", attr(t, "Target") ?? "");
  return out;
}

const resolvePart = (base: string, target: string): string => {
  const parts = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
};

/** Slide numbers present in a PPTX, ascending. */
export function slideNumbers(parts: Map<string, string>): number[] {
  return [...parts.keys()].flatMap((n) => { const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(n); return m ? [Number(m[1])] : []; }).sort((a, b) => a - b);
}

function slideBoxes(parts: Map<string, string>, n: number): ReadBox[] {
  const path = `ppt/slides/slide${n}.xml`;
  const toks = tokenizeXml(parts.get(path) ?? "");
  const rels = relTargets(parts.get(`ppt/slides/_rels/slide${n}.xml.rels`));
  const out: ReadBox[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!(t.k === "open" && (t.name === "p:sp" || t.name === "p:graphicFrame"))) continue;
    const end = matchingClose(toks, i);
    const name = firstTag(toks, i, end, "p:cNvPr")?.attrs.get("name") ?? "";
    const off = firstTag(toks, i, end, "a:off");
    const x = px(num(off?.attrs.get("x")));
    const y = px(num(off?.attrs.get("y")));
    const tbl = firstTag(toks, i, end, "a:tbl");
    const chart = firstTag(toks, i, end, "c:chart");
    if (tbl !== undefined) {
      out.push({ id: name, x, y, lines: 1, text: "" });
      out.push(...tableCells(toks, i, end, name, x, y));
    } else if (chart !== undefined) {
      const target = rels.get(chart.attrs.get("r:id") ?? "");
      const xml = target === undefined ? "" : (parts.get(resolvePart(path, target)) ?? "");
      out.push({ id: name, x, y, lines: 1, text: chartText(xml) });
    } else {
      const { text, brs } = textIn(toks, i, end);
      out.push({ id: name, x, y, lines: brs + 1, text });
    }
    i = end;
  }
  return out;
}

/** Boxes per 1-based slide: text shapes by shape name, table cells by `{tableShapeName}-r{row}c{col}`. */
export async function readPptxBoxes(pptx: Uint8Array): Promise<Map<number, ReadBox[]>> {
  return pptxBoxesFromParts(await zipParts(pptx));
}

export function pptxBoxesFromParts(parts: Map<string, string>): Map<number, ReadBox[]> {
  return new Map(slideNumbers(parts).map((n) => [n, slideBoxes(parts, n)]));
}

const styleNum = (style: string | undefined, prop: string): number => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`).exec(style ?? "");
  return m ? Number(m[1]) : 0;
};
interface TableGeom { x: number; y: number; colW: number[]; rowY: number[]; lastH: number }
interface Frame { name: string; box?: ReadBox; skip: boolean }

const CELL_ID = /-r(\d+)c(\d+)$/;
const VOID = new Set(["br", "col", "meta", "img", "input", "hr", "link", "source", "wbr", "area", "base", "embed", "track", "param"]);

/** Pseudo box id holding text a slide shows outside every `data-box` element. */
export const UNBOXED = "@unboxed";
/** Pseudo slide for body text outside every slide section; any digit there is a figure with no place. */
export const NO_SLIDE = 0;

/**
 * Boxes per slide from the static HTML: `data-box` on boxes and cells, `<br>` count + 1 lines (M2). Depth is
 * tracked for every element, so a nested unboxed element never closes a box early. Text a slide shows outside
 * every box goes to a pseudo box `UNBOXED`; body text outside every slide goes to slide `NO_SLIDE`.
 */
export function readHtmlBoxes(html: string): Map<number, ReadBox[]> {
  const out = new Map<number, ReadBox[]>();
  const loose = new Map<number, ReadBox>();
  const stack: Frame[] = [];
  let slide = NO_SLIDE;
  let inBody = false;
  let table: TableGeom | undefined;
  const boxOf = (): ReadBox | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].box !== undefined) return stack[i].box;
    return undefined;
  };
  const looseOf = (s: number): ReadBox => {
    let b = loose.get(s);
    if (b === undefined) { b = { id: UNBOXED, x: 0, y: 0, lines: 1, text: "" }; loose.set(s, b); }
    return b;
  };
  for (const t of tokenizeXml(html)) {
    if (t.k === "text") {
      if (t.text.startsWith("<") || !inBody || stack.some((f) => f.skip)) continue;
      const text = decodeXml(t.text);
      if (text.trim() === "") continue;
      const target = boxOf() ?? looseOf(slide);
      target.text += (target.text === "" ? "" : " ") + text;
      continue;
    }
    if (t.k === "close") {
      const at = stack.map((f) => f.name).lastIndexOf(t.name);
      if (at >= 0) {
        if (stack[at].name === "section") slide = NO_SLIDE;
        stack.length = at;
      }
      if (t.name === "body") inBody = false;
      continue;
    }
    if (t.name === "body") { inBody = true; continue; }
    if (t.name === "br") { const b = boxOf(); if (b !== undefined) b.lines++; continue; }
    const style = t.attrs.get("style");
    if (t.name === "col" && table !== undefined) table.colW.push(styleNum(style, "width"));
    if (t.name === "tr" && table !== undefined) {
      const prev = table.rowY.length;
      table.rowY.push(prev === 0 ? table.y : table.rowY[prev - 1] + table.lastH);
      table.lastH = styleNum(style, "height");
    }
    if (t.k === "self" || VOID.has(t.name)) continue;
    const frame: Frame = { name: t.name, skip: t.name === "style" || t.name === "script" };
    if (t.name === "section" && t.attrs.has("data-slide")) {
      slide = Number(t.attrs.get("data-slide"));
      out.set(slide, []);
    }
    const id = t.attrs.get("data-box");
    if (id !== undefined) {
      const cell = CELL_ID.exec(id);
      if ((t.name === "th" || t.name === "td") && cell !== null && table !== undefined) {
        const c = Number(cell[2]);
        frame.box = { id, x: table.x + table.colW.slice(0, c).reduce((a, w) => a + w, 0), y: table.rowY[Number(cell[1])] ?? table.y, lines: 1, text: "" };
      } else {
        frame.box = { id, x: styleNum(style, "left"), y: styleNum(style, "top"), lines: 1, text: "" };
        table = { x: frame.box.x, y: frame.box.y, colW: [], rowY: [], lastH: 0 };
      }
      if (!out.has(slide)) out.set(slide, []);
      out.get(slide)?.push(frame.box);
    }
    stack.push(frame);
  }
  for (const [s, b] of loose) {
    if (!out.has(s)) out.set(s, []);
    out.get(s)?.push(b);
  }
  return out;
}

const DISPLAY_HEADER = SOURCE_HEADERS[2];

export type WorkbookInput = Uint8Array | XLSX.WorkBook;
export const readWorkbook = (x: WorkbookInput): XLSX.WorkBook => (x instanceof Uint8Array ? XLSX.read(x, { type: "array" }) : x);

function aoa(wb: XLSX.WorkBook, name: string, blankrows = true): unknown[][] {
  const ws = wb.Sheets[name];
  return ws === undefined ? [] : XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows });
}

/** The المصدر table rows, joined by its value-key column. */
export async function readXlsxSource(xlsx: WorkbookInput): Promise<{ valueKey: string; display: string }[]> {
  const rows = aoa(readWorkbook(xlsx), SOURCE_SHEET);
  const head = rows.findIndex((r) => r.includes(SOURCE_KEY_HEADER));
  if (head < 0) return [];
  const k = rows[head].indexOf(SOURCE_KEY_HEADER);
  const d = rows[head].indexOf(DISPLAY_HEADER);
  return rows.slice(head + 1)
    .filter((r) => typeof r[k] === "string" && r[k] !== "")
    .map((r) => ({ valueKey: String(r[k]), display: r[d] === null || r[d] === undefined ? "" : String(r[d]) }));
}

export interface XlsxStepCounts { datasetId: string; stepId: string; inCount: number; removed: number; outCount: number }

/** B4:D4 of each step sheet the plan declares; a missing sheet or cell reads as NaN so reconciliation fails. */
export async function readXlsxSteps(xlsx: WorkbookInput, plan: WorkbookPlan): Promise<XlsxStepCounts[]> {
  const wb = readWorkbook(xlsx);
  const cell = (ws: XLSX.WorkSheet | undefined, ref: string): number => {
    const v = ws?.[ref]?.v;
    return typeof v === "number" ? v : Number.NaN;
  };
  return plan.sheets.filter((s) => s.kind === "step").map((s) => {
    const ws = wb.Sheets[s.name];
    return { datasetId: s.datasetId ?? "", stepId: s.stepId ?? "", inCount: cell(ws, "B4"), removed: cell(ws, "C4"), outCount: cell(ws, "D4") };
  });
}

/**
 * Data rows written on a sheet, counted from the sheet XML itself: the highest `<row r>` below the header row, so
 * blank rows (empty `<row>` elements or gaps in `r`) count as rows, as in typing. The `!ref` span and the
 * `<row>` elements are cross-checked against it; a disagreement is reported, never trusted (any row loss shows).
 */
export function writtenDataRows(xml: string | undefined, ws: XLSX.WorkSheet | undefined, problems: string[] = []): number {
  const rs: number[] = [];
  for (const t of tokenizeXml(xml ?? "")) if (t.k !== "text" && t.k !== "close" && t.name === "row") rs.push(Number(t.attrs.get("r")));
  const highest = rs.length === 0 ? 0 : Math.max(...rs);
  if (rs.some((r) => !Number.isInteger(r) || r < 1)) problems.push("row without a valid r");
  if (new Set(rs).size !== rs.length || rs.length > highest) problems.push(`${rs.length} row elements for ${highest} rows`);
  const ref = ws?.["!ref"];
  const refRows = ref === undefined ? 0 : XLSX.utils.decode_range(ref).e.r + 1;
  if (refRows !== highest) problems.push(`dimension does not match rows: dimension ${refRows}, highest row ${highest}`);
  return Math.max(0, highest - 1);
}

/**
 * Data rows of the raw sheets in the companion, summed per dataset over exactly the (file, sheet) pairs typing
 * reads (`typedRowSources`): an unreferenced sheet such as a notes tab never counts, and blank rows always do.
 * Rows come from the sheet XML (`parts`); a sheet whose dimension and rows disagree adds a `gate.reconcile` issue.
 */
export function readRawRowCounts(
  companion: WorkbookInput, plan: WorkbookPlan, spec: ReportSpec, parts: Map<string, string>, issues: EngineIssue[] = [],
): Map<string, number> {
  const wb = readWorkbook(companion);
  const paths = sheetPartPaths(parts);
  const raw = plan.companion.sheets.flatMap((s) => (s.kind === "raw" && s.raw !== undefined ? [{ name: s.name, ...s.raw }] : []));
  const files = [...new Set(raw.map((r) => r.fileName))].map((fileName) => ({
    fileName, sheets: raw.filter((r) => r.fileName === fileName).map((r) => ({ sheetName: r.sheetName })),
  }));
  const out = new Map<string, number>();
  for (const def of spec.datasets) {
    let n = 0;
    for (const src of typedRowSources(def, files)) {
      const s = raw.find((r) => r.fileName === src.fileName && r.sheetName === src.sheetName);
      if (s === undefined) continue;
      const problems: string[] = [];
      n += writtenDataRows(parts.get(paths.get(s.name) ?? ""), wb.Sheets[s.name], problems);
      for (const p of problems) issues.push({ rule: "gate.reconcile", path: `companion: ${s.name}`, detail: p });
    }
    out.set(def.id, n);
  }
  return out;
}

/** The `ref` of each table part, by table name. */
export function tableRefs(parts: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, xml] of parts) {
    if (!/^xl\/tables\/table\d+\.xml$/.test(name)) continue;
    for (const t of tokenizeXml(xml)) {
      if (t.k === "text" || t.name !== "table") continue;
      out.set(t.attrs.get("name") ?? "", t.attrs.get("ref") ?? "");
      break;
    }
  }
  return out;
}

/**
 * Data rows inside each processed set's table on the report workbook, per dataset (NaN when the table is gone).
 * Counted from the sheet XML's cell elements (`<c>`, valued or not) within the table ref span, the same rule `writtenDataRows` uses
 * for raw sheets: a row whose cells are all null is still a row (the writer always emits it), and a row that is
 * really gone is missing. Never from cell values, which would drop an all-null row and block falsely.
 */
export function readProcessedRowCounts(report: WorkbookInput, parts: Map<string, string>, plan: WorkbookPlan): Map<string, number> {
  const wb = readWorkbook(report);
  const refs = tableRefs(parts);
  const paths = sheetPartPaths(parts);
  const out = new Map<string, number>();
  for (const s of plan.sheets) {
    if (s.kind !== "processed" || s.datasetId === undefined) continue;
    const ref = refs.get(s.table ?? "");
    const xml = parts.get(paths.get(s.name) ?? "");
    if (ref === undefined || ref === "" || wb.Sheets[s.name] === undefined || xml === undefined) { out.set(s.datasetId, Number.NaN); continue; }
    const r = XLSX.utils.decode_range(ref);
    const present = new Set<number>();
    // A row counts when it holds a cell element inside the table's columns (a pivot beside the table shares rows).
    for (const t of tokenizeXml(xml)) {
      if (t.k === "text" || t.k === "close" || t.name !== "c") continue;
      const at = XLSX.utils.decode_cell(t.attrs.get("r") ?? "");
      if (at.c >= r.s.c && at.c <= r.e.c) present.add(at.r);
    }
    let n = 0;
    for (let row = r.s.r + 1; row <= r.e.r; row++) if (present.has(row)) n++;
    out.set(s.datasetId, n);
  }
  return out;
}

/** Every string a workbook sheet shows (cell values and formatted text), per sheet name. */
export function workbookSheetTexts(xlsx: WorkbookInput): { sheet: string; texts: string[] }[] {
  const wb = readWorkbook(xlsx);
  return wb.SheetNames.map((sheet) => {
    const ws = wb.Sheets[sheet];
    const texts: string[] = [];
    for (const k of Object.keys(ws)) {
      if (k.startsWith("!")) continue;
      const c = ws[k] as XLSX.CellObject;
      if (typeof c.v === "string") texts.push(c.v);
      if (typeof c.w === "string" && c.w !== c.v) texts.push(c.w);
    }
    return { sheet, texts };
  });
}

/** Worksheet part path per sheet name, from `xl/workbook.xml` and its relationships. */
export function sheetPartPaths(parts: Map<string, string>): Map<string, string> {
  const rels = relTargets(parts.get("xl/_rels/workbook.xml.rels"));
  const out = new Map<string, string>();
  for (const t of tokenizeXml(parts.get("xl/workbook.xml") ?? "")) {
    if (t.k === "text" || t.name !== "sheet") continue;
    const target = rels.get(t.attrs.get("r:id") ?? "");
    if (target !== undefined) out.set(t.attrs.get("name") ?? "", resolvePart("xl/workbook.xml", target));
  }
  return out;
}

/** Decoded text content of an XML part (text nodes and attribute values), for character scans. */
export function xmlTexts(xml: string): string[] {
  const out: string[] = [];
  for (const t of tokenizeXml(xml)) {
    if (t.k === "text") { if (!t.text.startsWith("<")) out.push(decodeXml(t.text)); }
    else for (const v of t.attrs.values()) out.push(v);
  }
  return out;
}

/** Layout boxes in read-back form: the third source for layout parity. */
export function layoutBoxes(doc: LayoutDoc): Map<number, ReadBox[]> {
  const out = new Map<number, ReadBox[]>();
  for (const s of doc.slides) {
    const list: ReadBox[] = [];
    for (const b of s.boxes) {
      const lines = b.kind === "text" ? Math.max(1, b.lines.length) : 1;
      list.push({ id: b.id, x: b.x, y: b.y, lines, text: "" });
      if (b.kind !== "table") continue;
      [b.header, ...b.rows].forEach((row, r) => row.forEach((c, col) => {
        const x = b.x + b.colW.slice(0, col).reduce((a, w) => a + w, 0);
        const y = r === 0 ? b.y : b.y + LAYOUT.headerH + (r - 1) * b.rowH;
        list.push({ id: c.id, x, y, lines: Math.max(1, c.lines.length), text: "" });
      }));
    }
    out.set(s.index, list);
  }
  return out;
}
