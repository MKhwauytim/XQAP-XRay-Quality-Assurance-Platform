import type { EngineIssue } from "../errors";
import type { LayoutDoc } from "../layout/types";
import { arabicIndicCount } from "../lint/designLint";
import type { WorkbookPlan } from "../xlsx/planWorkbook";
import { tokenizeXml } from "../xml/tokenize";
import { workbookSheetTexts, xmlTexts, zipParts } from "./readBack";

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

/** Structural problems of one package: a part that does not tokenize cleanly, or an internal relationship with no part. */
function packageIssues(label: string, parts: Map<string, string>): EngineIssue[] {
  const out: EngineIssue[] = [];
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

async function open(label: string, bytes: Uint8Array, issues: EngineIssue[]): Promise<Map<string, string>> {
  try {
    return await zipParts(bytes);
  } catch (e) {
    issues.push({ rule: "gate.ooxml", path: label, detail: `zip does not open: ${e instanceof Error ? e.message : String(e)}` });
    return new Map();
  }
}

function digitIssues(label: string, parts: Map<string, string>, skip: (name: string) => boolean): EngineIssue[] {
  const out: EngineIssue[] = [];
  for (const [name, xml] of parts) {
    if (!XML_PART.test(name) || skip(name)) continue;
    const n = xmlTexts(xml).reduce((a, s) => a + arabicIndicCount(s), 0);
    if (n > 0) out.push({ rule: "gate.ooxml", path: `${label}: ${name}`, detail: `${n} Arabic-Indic digits` });
  }
  return out;
}

/**
 * Re-opens the PPTX, the report workbook and (when given) the companion raw workbook; every XML part must
 * tokenize with balanced tags and every internal relationship must reach a part; part counts must equal what
 * the layout and the plan declare; and no Arabic-Indic digit may appear outside a raw sheet (C9, C15).
 */
export async function checkOoxml(
  pptx: Uint8Array, xlsx: Uint8Array, doc: LayoutDoc, plan: WorkbookPlan, companion?: Uint8Array,
): Promise<{ issues: EngineIssue[]; counts: OoxmlCounts }> {
  const issues: EngineIssue[] = [];
  const p = await open("pptx", pptx, issues);
  const x = await open("xlsx", xlsx, issues);
  const c = companion === undefined ? new Map<string, string>() : await open("companion", companion, issues);
  issues.push(...packageIssues("pptx", p), ...packageIssues("xlsx", x), ...packageIssues("companion", c));

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

  issues.push(...digitIssues("pptx", p, () => false), ...digitIssues("xlsx", x, () => false));
  if (companion !== undefined) {
    // Companion cells are attributed per sheet, because its shared strings serve the cover and the raw sheets alike.
    issues.push(...digitIssues("companion", c, (n) => n.startsWith("xl/worksheets/") || n === "xl/sharedStrings.xml"));
    const raw = new Set(plan.companion.sheets.filter((s) => s.kind === "raw").map((s) => s.name));
    for (const { sheet, texts } of workbookSheetTexts(companion)) {
      const n = texts.reduce((a, s) => a + arabicIndicCount(s), 0);
      if (n === 0) continue;
      if (raw.has(sheet)) counts.rawDigitHitsSkipped += n;
      else issues.push({ rule: "gate.ooxml", path: `companion: ${sheet}`, detail: `${n} Arabic-Indic digits` });
    }
  }
  return { issues, counts };
}
