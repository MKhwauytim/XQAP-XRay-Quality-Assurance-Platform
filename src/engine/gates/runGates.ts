import type { ProcessedDataset } from "../data/processing";
import type { EngineIssue } from "../errors";
import type { LayoutDoc } from "../layout/types";
import { lintLayout, lintOutputText, lintText } from "../lint/designLint";
import type { MessageKey } from "../messages";
import type { ResolvedValue } from "../resolve/resolve";
import type { ThemeTokens } from "../spec/types";
import type { WorkbookPlan } from "../xlsx/planWorkbook";
import { decodeXml, tokenizeXml } from "../xml/tokenize";
import { checkFigureParity } from "./figureParity";
import { checkLayoutParity } from "./layoutParity";
import { checkOoxml } from "./ooxmlSelfCheck";
import { pptxBoxesFromParts, readHtmlBoxes, readXlsxSource, readXlsxSteps, workbookSheetTexts, xmlTexts, zipParts } from "./readBack";
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
  /** The recipe JSON, when the caller has it; scanned for T3/T6. */
  recipe?: string;
}

/** Visible HTML text: text nodes outside `<style>` and `<script>`, decoded. */
function htmlTexts(html: string): string[] {
  const out: string[] = [];
  let skip = 0;
  for (const t of tokenizeXml(html)) {
    if (t.k === "text") { if (skip === 0 && !t.text.startsWith("<")) out.push(decodeXml(t.text)); }
    else if (t.name === "style" || t.name === "script") skip += t.k === "open" ? 1 : t.k === "close" ? -1 : 0;
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

/** Runs every release gate on the issued bytes in one pass (M13, M16). Any issue blocks the issue. */
export async function runGates(input: GateInput): Promise<GateReport> {
  const issues: EngineIssue[] = [];
  const lint = { errors: [] as EngineIssue[], warnings: [] as EngineIssue[] };
  const counts: Record<string, number> = {};

  await guarded("gate.ooxml", issues, async () => {
    const r = await checkOoxml(input.pptx, input.xlsx, input.doc, input.plan, input.companion);
    issues.push(...r.issues);
    Object.assign(counts, r.counts);
  });

  let pptxParts = new Map<string, string>();
  await guarded("gate.ooxml", issues, async () => { pptxParts = await zipParts(input.pptx); });
  const pptxBoxes = pptxBoxesFromParts(pptxParts);
  const htmlBoxes = readHtmlBoxes(input.html);

  await guarded("gate.figureParity", issues, async () => {
    const source = await readXlsxSource(input.xlsx);
    issues.push(...checkFigureParity(input.doc, pptxBoxes, htmlBoxes, source, input.values));
  });
  await guarded("gate.layoutParity", issues, () => { issues.push(...checkLayoutParity(htmlBoxes, pptxBoxes)); });
  await guarded("gate.reconcile", issues, async () => {
    issues.push(...checkReconciliation(input.processed, await readXlsxSteps(input.xlsx, input.plan)));
  });

  await guarded("gate.lint", lint.errors, async () => {
    const layout = lintLayout(input.doc, input.theme);
    lint.errors.push(...layout.errors);
    lint.warnings.push(...layout.warnings);
    lint.errors.push(...lintOutputText("html", htmlTexts(input.html)));
    for (const [name, xml] of pptxParts) if (/\.(xml|rels)$/.test(name)) lint.errors.push(...lintOutputText(`pptx: ${name}`, xmlTexts(xml)));
    // The report workbook holds no raw sheet (raw sheets live in the companion), so all of it is scanned.
    for (const [name, xml] of await zipParts(input.xlsx)) if (/\.(xml|rels)$/.test(name)) lint.errors.push(...lintOutputText(`xlsx: ${name}`, xmlTexts(xml)));
    const raw = new Set(input.plan.companion.sheets.filter((s) => s.kind === "raw").map((s) => s.name));
    let skipped = 0;
    for (const { sheet, texts } of workbookSheetTexts(input.companion)) {
      if (raw.has(sheet)) skipped += texts.reduce((a, t) => a + lintText(t).length, 0);
      else lint.errors.push(...lintOutputText(`companion: ${sheet}`, texts));
    }
    counts.rawLintHitsSkipped = skipped;
    if (input.recipe !== undefined) lint.errors.push(...lintOutputText("recipe", [input.recipe]));
  });

  issues.push(...lint.errors);
  return { passed: issues.length === 0, issues, warnings: [...lint.warnings], counts, lint };
}
