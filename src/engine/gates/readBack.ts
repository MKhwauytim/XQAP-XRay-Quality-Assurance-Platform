import JSZip from "jszip";
import * as XLSX from "xlsx";
import { EMU_PER_PX } from "../pptx/units";
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

interface OpenBox { name: string; box: ReadBox }
interface TableGeom { x: number; y: number; colW: number[]; rowY: number[]; lastH: number }

const CELL_ID = /-r(\d+)c(\d+)$/;

/** Boxes per slide from the static HTML: `data-box` on boxes and cells, `<br>` count + 1 lines (M2). */
export function readHtmlBoxes(html: string): Map<number, ReadBox[]> {
  const out = new Map<number, ReadBox[]>();
  const stack: OpenBox[] = [];
  let slide = 0;
  let table: TableGeom | undefined;
  for (const t of tokenizeXml(html)) {
    if (t.k === "text") {
      const top = stack[stack.length - 1];
      if (top !== undefined) top.box.text += (top.box.text === "" ? "" : " ") + decodeXml(t.text);
      continue;
    }
    if (t.k === "close") {
      if (stack.length > 0 && stack[stack.length - 1].name === t.name) stack.pop();
      continue;
    }
    if (t.name === "section" && t.attrs.has("data-slide")) { slide = Number(t.attrs.get("data-slide")); out.set(slide, []); continue; }
    if (t.name === "br") { const top = stack[stack.length - 1]; if (top !== undefined) top.box.lines++; continue; }
    const style = t.attrs.get("style");
    if (t.name === "col" && table !== undefined) { table.colW.push(styleNum(style, "width")); continue; }
    if (t.name === "tr" && table !== undefined) {
      const prev = table.rowY.length;
      table.rowY.push(prev === 0 ? table.y : table.rowY[prev - 1] + table.lastH);
      table.lastH = styleNum(style, "height");
      continue;
    }
    const id = t.attrs.get("data-box");
    if (id === undefined || t.k === "self") continue;
    let box: ReadBox;
    const cell = CELL_ID.exec(id);
    if ((t.name === "th" || t.name === "td") && cell !== null && table !== undefined) {
      const c = Number(cell[2]);
      box = { id, x: table.x + table.colW.slice(0, c).reduce((a, w) => a + w, 0), y: table.rowY[Number(cell[1])] ?? table.y, lines: 1, text: "" };
    } else {
      box = { id, x: styleNum(style, "left"), y: styleNum(style, "top"), lines: 1, text: "" };
      table = { x: box.x, y: box.y, colW: [], rowY: [], lastH: 0 };
    }
    stack.push({ name: t.name, box });
    out.get(slide)?.push(box);
  }
  return out;
}

const DISPLAY_HEADER = SOURCE_HEADERS[2];

function aoa(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name];
  return ws === undefined ? [] : XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: true });
}

/** The المصدر table rows, joined by its value-key column. */
export async function readXlsxSource(xlsx: Uint8Array): Promise<{ valueKey: string; display: string }[]> {
  const rows = aoa(XLSX.read(xlsx, { type: "array" }), SOURCE_SHEET);
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
export async function readXlsxSteps(xlsx: Uint8Array, plan: WorkbookPlan): Promise<XlsxStepCounts[]> {
  const wb = XLSX.read(xlsx, { type: "array" });
  const cell = (ws: XLSX.WorkSheet | undefined, ref: string): number => {
    const v = ws?.[ref]?.v;
    return typeof v === "number" ? v : Number.NaN;
  };
  return plan.sheets.filter((s) => s.kind === "step").map((s) => {
    const ws = wb.Sheets[s.name];
    return { datasetId: s.datasetId ?? "", stepId: s.stepId ?? "", inCount: cell(ws, "B4"), removed: cell(ws, "C4"), outCount: cell(ws, "D4") };
  });
}

/** Every string a workbook sheet shows (cell values and formatted text), per sheet name. */
export function workbookSheetTexts(xlsx: Uint8Array): { sheet: string; texts: string[] }[] {
  const wb = XLSX.read(xlsx, { type: "array" });
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

/** Decoded text content of an XML part (text nodes and attribute values), for character scans. */
export function xmlTexts(xml: string): string[] {
  const out: string[] = [];
  for (const t of tokenizeXml(xml)) {
    if (t.k === "text") { if (!t.text.startsWith("<")) out.push(decodeXml(t.text)); }
    else for (const v of t.attrs.values()) out.push(v);
  }
  return out;
}

