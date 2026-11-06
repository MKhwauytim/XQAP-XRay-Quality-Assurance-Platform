import type * as XLSX from "xlsx";
import type { ProcessedDataset } from "../data/processing";
import type { EngineIssue } from "../errors";
import type { LayoutDoc } from "../layout/types";
import { arabicIndicCount, lintLayout, lintOutputText, lintText } from "../lint/designLint";
import type { MessageKey } from "../messages";
import type { ResolvedValue } from "../resolve/resolve";
import type { ReportSpec, ThemeTokens } from "../spec/types";
import type { WorkbookPlan } from "../xlsx/planWorkbook";
import { decodeXml, tokenizeXml } from "../xml/tokenize";
import { checkFigureParity } from "./figureParity";
import { checkLayoutParity } from "./layoutParity";
import { checkOoxmlParts, companionTexts, openPackage, partTexts } from "./ooxmlSelfCheck";
import type { OpenedOutputs } from "./ooxmlSelfCheck";
import {
  layoutBoxes, pptxBoxesFromParts, readHtmlBoxes, readProcessedRowCounts, readRawRowCounts, readWorkbook,
  readXlsxSource, readXlsxSteps,
} from "./readBack";
import type { ReadBox } from "./readBack";
import { checkReconciliation } from "./reconcile";

export interface GateReport {
  passed: boolean;
  /** Every blocking problem, lint errors included. */
  issues: EngineIssue[];
  warnings: EngineIssue[];
  counts: Record<string, number>;
  /** The lint result on its own, for `IssueOutput.lintReport`. */
  lint: { errors: EngineIssue[]; warnings: EngineIssue[] };
}

export interface GateInput {
  spec: ReportSpec;
  doc: LayoutDoc;
  html: string;
  pptx: Uint8Array;
  /** The report workbook (`XlsxOutput.report`). */
  xlsx: Uint8Array;
  /** The companion raw workbook (`XlsxOutput.companion`). */
  companion: Uint8Array;
  plan: WorkbookPlan;
  processed: Map<string, ProcessedDataset>;
  values: Map<string, ResolvedValue>;
  theme: ThemeTokens;
  /** The recipe JSON, when the caller has it; scanned for T3, T6 and Arabic-Indic digits. */
  recipe?: string;
}

const HTML_TEXT_ATTRS = ["title", "alt", "aria-label"];

/** Visible HTML text: text nodes outside `<style>` and `<script>` (the `<title>` included), and title, alt and aria-label values. */
export function htmlTexts(html: string): string[] {
  const out: string[] = [];
  let skip = 0;
  for (const t of tokenizeXml(html)) {
    if (t.k === "text") { if (skip === 0 && !t.text.startsWith("<")) out.push(decodeXml(t.text)); continue; }
    if (t.name === "style" || t.name === "script") skip += t.k === "open" ? 1 : t.k === "close" ? -1 : 0;
    for (const a of HTML_TEXT_ATTRS) { const v = t.attrs.get(a); if (v !== undefined) out.push(v); }
  }
  return out;
}

/** A gate that throws becomes one blocking issue under its rule; the others still run (M13: fail closed, never short-circuit). */
async function guarded(rule: MessageKey, issues: EngineIssue[], run: () => Promise<void> | void): Promise<void> {
  try {
    await run();
  } catch (e) {
    issues.push({ rule, detail: `gate failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}

function digitIssues(where: string, texts: string[]): EngineIssue[] {
  const n = texts.reduce((a, s) => a + arabicIndicCount(s), 0);
  return n > 0 ? [{ rule: "gate.lint", path: where, detail: `decision 4: ${n} Arabic-Indic digits` }] : [];
}

/** Runs every release gate on the issued bytes in one pass (M13, M16). Any issue blocks the issue. */
export async function runGates(input: GateInput): Promise<GateReport> {
  const issues: EngineIssue[] = [];
  const lint = { errors: [] as EngineIssue[], warnings: [] as EngineIssue[] };
  const counts: Record<string, number> = {};

  // Each package is unzipped once and each workbook parsed once; every gate reads from these.
  const opened: OpenedOutputs = { pptx: new Map(), xlsx: new Map() };
  let reportWb: XLSX.WorkBook | undefined;
  let companionWb: XLSX.WorkBook | undefined;
  let companionParts = new Map<string, string>();
  await guarded("gate.ooxml", issues, async () => {
    opened.pptx = await openPackage("pptx", input.pptx, issues);
    opened.xlsx = await openPackage("xlsx", input.xlsx, issues);
    companionParts = await openPackage("companion", input.companion, issues);
  });
  await guarded("gate.ooxml", issues, () => { if (opened.xlsx.size > 0) reportWb = readWorkbook(input.xlsx); });
  await guarded("gate.ooxml", issues, () => {
    if (companionParts.size > 0) {
      companionWb = readWorkbook(input.companion);
      opened.companion = { parts: companionParts, wb: companionWb };
    }
  });
  const need = <T>(v: T | undefined, what: string): T => {
    if (v === undefined) throw new Error(`${what} did not open`);
    return v;
  };

  await guarded("gate.ooxml", issues, () => {
    const r = checkOoxmlParts(opened, input.doc, input.plan);
    issues.push(...r.issues);
    Object.assign(counts, r.counts);
  });

  let pptxBoxes = new Map<number, ReadBox[]>();
  let htmlBoxes = new Map<number, ReadBox[]>();
  await guarded("gate.layoutParity", issues, () => {
    pptxBoxes = pptxBoxesFromParts(opened.pptx);
    htmlBoxes = readHtmlBoxes(input.html);
    issues.push(...checkLayoutParity(htmlBoxes, pptxBoxes, 2, layoutBoxes(input.doc)));
  });
  await guarded("gate.figureParity", issues, async () => {
    const source = await readXlsxSource(need(reportWb, "report workbook"));
    issues.push(...checkFigureParity(input.doc, pptxBoxes, htmlBoxes, source, input.values));
  });
  await guarded("gate.reconcile", issues, async () => {
    const report = need(reportWb, "report workbook");
    const rows = {
      // Dimension-versus-rows problems go straight into issues as gate.reconcile.
      raw: readRawRowCounts(need(companionWb, "companion workbook"), input.plan, input.spec, companionParts, issues),
      processed: readProcessedRowCounts(report, opened.xlsx, input.plan),
    };
    issues.push(...checkReconciliation(input.processed, await readXlsxSteps(report, input.plan), rows));
  });

  await guarded("gate.lint", lint.errors, () => {
    const layout = lintLayout(input.doc, input.theme);
    lint.errors.push(...layout.errors);
    lint.warnings.push(...layout.warnings);
    const html = htmlTexts(input.html);
    lint.errors.push(...lintOutputText("html", html), ...digitIssues("html", html));
    for (const { where, texts } of [...partTexts("pptx", opened.pptx), ...partTexts("xlsx", opened.xlsx)]) {
      lint.errors.push(...lintOutputText(where, texts));
    }
    let skipped = 0;
    if (opened.companion !== undefined) {
      const c = companionTexts(opened.companion.parts, opened.companion.wb, input.plan);
      for (const { where, texts } of c.scanned) lint.errors.push(...lintOutputText(where, texts));
      skipped = c.raw.reduce((a, t) => a + lintText(t).length, 0);
    }
    counts.rawLintHitsSkipped = skipped;
    if (input.recipe !== undefined) lint.errors.push(...lintOutputText("recipe", [input.recipe]), ...digitIssues("recipe", [input.recipe]));
  });

  issues.push(...lint.errors);
  return { passed: issues.length === 0, issues, warnings: [...lint.warnings], counts, lint };
}
