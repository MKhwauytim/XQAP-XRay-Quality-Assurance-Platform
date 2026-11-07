import type * as XLSX from "xlsx";
import type { EngineIssue } from "../errors";
import type { LayoutDoc } from "../layout/types";
import { arabicIndicCount } from "../lint/designLint";
import type { WorkbookPlan } from "../xlsx/planWorkbook";
import { tokenizeXml } from "../xml/tokenize";
import { readWorkbook, sheetPartPaths, workbookSheetTexts, xmlTexts, zipParts } from "./readBack";

export interface OoxmlCounts {
  slides: number;
  pptxTables: number;
  pptxCharts: number;
  pptxPictures: number;
  xlsxTables: number;
  xlsxPivots: number;
  /** Arabic-Indic digits found in raw sheets, which M12 keeps untouched; counted, never an error (C9). */
  rawDigitHitsSkipped: number;
}

const XML_PART = /\.(xml|rels)$/;

/** Tag balance on the shared tokenizer: every close matches the innermost open, nothing left open. */
function balanceError(xml: string): string | undefined {
  const stack: string[] = [];
  for (const t of tokenizeXml(xml)) {
    if (t.k === "open") stack.push(t.name);
    else if (t.k === "close") {
      const top = stack.pop();
      if (top !== t.name) return `</${t.name}> closes <${top ?? ""}> at ${t.start}`;
    }
  }
  return stack.length > 0 ? `<${stack[stack.length - 1]}> never closed` : undefined;
}

function resolveTarget(relsPath: string, target: string): string {
  const base = relsPath.replace(/_rels\/[^/]*\.rels$/, "");
  const parts = target.startsWith("/") ? [] : base.split("/").filter((p) => p !== "");
  for (const seg of target.replace(/^\//, "").split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

const CONTENT_TYPES = "[Content_Types].xml";

/** Every override names a real part, and every part has an override or a default for its extension. */
function contentTypeIssues(label: string, parts: Map<string, string>): EngineIssue[] {
  const out: EngineIssue[] = [];
  const xml = parts.get(CONTENT_TYPES);
  if (xml === undefined) return [{ rule: "gate.ooxml", path: label, detail: `${CONTENT_TYPES} missing` }];
  const defaults = new Set<string>();
  const overrides = new Set<string>();
  for (const t of tokenizeXml(xml)) {
    if (t.k === "text") continue;
    if (t.name === "Default") defaults.add((t.attrs.get("Extension") ?? "").toLowerCase());
    if (t.name === "Override") overrides.add((t.attrs.get("PartName") ?? "").replace(/^\//, ""));
  }
  for (const o of overrides) if (!parts.has(o)) out.push({ rule: "gate.ooxml", path: `${label}: ${CONTENT_TYPES}`, detail: `override for missing part ${o}` });
  for (const name of parts.keys()) {
    if (name === CONTENT_TYPES || overrides.has(name)) continue;
    const ext = /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
    if (!defaults.has(ext)) out.push({ rule: "gate.ooxml", path: `${label}: ${name}`, detail: "part has no content type" });
  }
  return out;
}

/** Structural problems of one package: unbalanced XML, an internal relationship with no part, content types. */
function packageIssues(label: string, parts: Map<string, string>): EngineIssue[] {
  if (parts.size === 0) return [];
  const out: EngineIssue[] = contentTypeIssues(label, parts);
  for (const [name, xml] of parts) {
    if (!XML_PART.test(name)) continue;
    const err = balanceError(xml);
    if (err !== undefined) out.push({ rule: "gate.ooxml", path: `${label}: ${name}`, detail: err });
    if (!name.endsWith(".rels")) continue;
    for (const t of tokenizeXml(xml)) {
      if (t.k === "text" || t.name !== "Relationship" || t.attrs.get("TargetMode") === "External") continue;
      const target = resolveTarget(name, t.attrs.get("Target") ?? "");
      if (!parts.has(target)) out.push({ rule: "gate.ooxml", path: `${label}: ${name}`, detail: `relationship to missing part ${target}` });
    }
  }
  return out;
}

const count = (parts: Map<string, string>, re: RegExp): number => [...parts.keys()].filter((n) => re.test(n)).length;
const occurrences = (parts: Map<string, string>, re: RegExp, tag: RegExp): number =>
  [...parts].filter(([n]) => re.test(n)).reduce((a, [, xml]) => a + (xml.match(tag)?.length ?? 0), 0);

/** Opens a zip; a failure becomes a `gate.ooxml` issue and an empty part map. */
export async function openPackage(label: string, bytes: Uint8Array, issues: EngineIssue[]): Promise<Map<string, string>> {
  try {
    return await zipParts(bytes);
  } catch (e) {
    issues.push({ rule: "gate.ooxml", path: label, detail: `zip does not open: ${e instanceof Error ? e.message : String(e)}` });
    return new Map();
  }
}

/** Text of one package to scan: every XML part, decoded, by part name. */
export function partTexts(label: string, parts: Map<string, string>, skip: (name: string) => boolean = () => false): { where: string; texts: string[] }[] {
  return [...parts].filter(([n]) => XML_PART.test(n) && !skip(n)).map(([n, xml]) => ({ where: `${label}: ${n}`, texts: xmlTexts(xml) }));
}

/**
 * The companion split for character scans (C9): every part except the raw worksheet parts and the shared
 * strings, plus each non-raw sheet's cells (the shared strings attributed per sheet), are `scanned`; the raw
 * sheets' cells are `raw`, which is counted but never an error.
 */
export function companionTexts(parts: Map<string, string>, wb: XLSX.WorkBook, plan: WorkbookPlan): { scanned: { where: string; texts: string[] }[]; raw: string[] } {
  const rawNames = new Set(plan.companion.sheets.filter((s) => s.kind === "raw").map((s) => s.name));
  const paths = sheetPartPaths(parts);
  const rawParts = new Set([...paths].filter(([n]) => rawNames.has(n)).map(([, p]) => p));
  const scanned = partTexts("companion", parts, (n) => rawParts.has(n) || n === "xl/sharedStrings.xml");
  const raw: string[] = [];
  for (const { sheet, texts } of workbookSheetTexts(wb)) {
    if (rawNames.has(sheet)) raw.push(...texts);
    else scanned.push({ where: `companion: ${sheet}`, texts });
  }
  return { scanned, raw };
}

export interface OpenedOutputs {
  pptx: Map<string, string>;
  xlsx: Map<string, string>;
  companion?: { parts: Map<string, string>; wb: XLSX.WorkBook };
}

/** `checkOoxml` on packages already opened once (runGates). */
export function checkOoxmlParts(o: OpenedOutputs, doc: LayoutDoc, plan: WorkbookPlan): { issues: EngineIssue[]; counts: OoxmlCounts } {
  const issues: EngineIssue[] = [];
  const p = o.pptx;
  const x = o.xlsx;
  issues.push(...packageIssues("pptx", p), ...packageIssues("xlsx", x));
  if (o.companion !== undefined) issues.push(...packageIssues("companion", o.companion.parts));

  const slideRe = /^ppt\/slides\/slide\d+\.xml$/;
  const counts: OoxmlCounts = {
    slides: count(p, slideRe),
    pptxTables: occurrences(p, slideRe, /<a:tbl[\s>]/g),
    pptxCharts: count(p, /^ppt\/charts\/chart\d+\.xml$/),
    pptxPictures: occurrences(p, slideRe, /<p:pic[\s>]/g),
    xlsxTables: count(x, /^xl\/tables\/table\d+\.xml$/),
    xlsxPivots: count(x, /^xl\/pivotTables\/pivotTable\d+\.xml$/),
    rawDigitHitsSkipped: 0,
  };
  const boxes = doc.slides.flatMap((s) => s.boxes);
  const expected: Omit<OoxmlCounts, "rawDigitHitsSkipped"> = {
    slides: doc.slides.length,
    pptxTables: boxes.filter((b) => b.kind === "table").length,
    pptxCharts: boxes.filter((b) => b.kind === "bar").length,
    pptxPictures: 0,
    xlsxTables: plan.tables.length,
    xlsxPivots: plan.sheets.reduce((a, s) => a + (s.pivots?.length ?? 0), 0),
  };
  for (const k of Object.keys(expected) as (keyof typeof expected)[]) {
    if (counts[k] !== expected[k]) issues.push({ rule: "gate.ooxml", path: k, detail: `found ${counts[k]}, declared ${expected[k]}` });
  }

  // The report workbook holds no raw sheet (raw sheets live in the companion), so all of it is scanned.
  const scanned = [...partTexts("pptx", p), ...partTexts("xlsx", x)];
  if (o.companion !== undefined) {
    const c = companionTexts(o.companion.parts, o.companion.wb, plan);
    scanned.push(...c.scanned);
    counts.rawDigitHitsSkipped = c.raw.reduce((a, s) => a + arabicIndicCount(s), 0);
  }
  for (const { where, texts } of scanned) {
    const n = texts.reduce((a, s) => a + arabicIndicCount(s), 0);
    if (n > 0) issues.push({ rule: "gate.ooxml", path: where, detail: `${n} Arabic-Indic digits` });
  }
  return { issues, counts };
}

/**
 * Re-opens the PPTX, the report workbook and (when given) the companion raw workbook. Every XML part must
 * tokenize with balanced tags, every internal relationship must reach a part, and every part must have a
 * content type. Part counts must equal what the layout and the plan declare. No Arabic-Indic digit may appear
 * outside a raw sheet (C9, C15).
 */
export async function checkOoxml(
  pptx: Uint8Array, xlsx: Uint8Array, doc: LayoutDoc, plan: WorkbookPlan, companion?: Uint8Array,
): Promise<{ issues: EngineIssue[]; counts: OoxmlCounts }> {
  const issues: EngineIssue[] = [];
  const opened: OpenedOutputs = { pptx: await openPackage("pptx", pptx, issues), xlsx: await openPackage("xlsx", xlsx, issues) };
  if (companion !== undefined) {
    const parts = await openPackage("companion", companion, issues);
    if (parts.size > 0) opened.companion = { parts, wb: readWorkbook(companion) };
  }
  const r = checkOoxmlParts(opened, doc, plan);
  return { issues: [...issues, ...r.issues], counts: r.counts };
}
