import { applySteps } from "../data/processing";
import type { ProcessedDataset } from "../data/processing";
import { profileColumns } from "../data/profile";
import type { ColumnProfile, RawFile } from "../data/types";
import { typeDataset } from "../data/typing";
import type { EngineIssue } from "../errors";
import { runGates } from "../gates/runGates";
import type { GateReport } from "../gates/runGates";
import { renderHtml, themeIssues } from "../html/renderHtml";
import { layoutReport } from "../layout/layoutReport";
import type { TextMeasurer } from "../layout/measure";
import { LIMITS } from "../limits";
import { formatIssue } from "../messages";
import { writePptx } from "../pptx/writePptx";
import { buildRecipe, checkSources, validateRecipe } from "../recipe/recipe";
import { resolveVisuals } from "../resolve/resolve";
import type { DomainPack, IssueParams, ReportSpec, ThemeTokens } from "../spec/types";
import { mergePackMeasures, validateSpec } from "../spec/validate";
import { planWorkbook } from "../xlsx/planWorkbook";
import { WorkbookRefused, writeXlsx } from "../xlsx/writeXlsx";

/**
 * Every file one issue produces (owner decision 2026-11-06: six files). `pdfPrintable` is the HTML itself:
 * the PDF is that page printed by the browser, so it carries no separate bytes.
 */
export interface IssueOutput {
  html: string;
  pdfPrintable: string;
  pptx: Uint8Array;
  /** The report workbook. */
  xlsx: Uint8Array;
  /** The companion raw-data workbook the report workbook links to. */
  companion: Uint8Array;
  reportFileName: string;
  companionFileName: string;
  recipe: string;
  lintReport: { errors: EngineIssue[]; warnings: EngineIssue[] };
  parityReport: GateReport;
}

export type IssueResult = { ok: true; files: IssueOutput } | { ok: false; issues: EngineIssue[]; message: string };

export interface IssueEnv {
  theme: ThemeTokens;
  measurer: TextMeasurer;
  /** The core never reads host storage, so the host passes the pack itself instead of a `packId`. */
  pack?: DomainPack;
  /** Clock for the time budget; defaults to `performance.now`. Never enters any output. */
  now?: () => number;
  /**
   * TEST ONLY, never set by a host. "miscountStep" corrupts one step count in the copy the workbook is
   * written from; "throwInPptx" throws inside the PPTX stage.
   */
  __testSeam?: "miscountStep" | "throwInPptx";
}

type Stage = "validate" | "data" | "resolve" | "layout" | "xlsx" | "html" | "pptx" | "gates" | "recipe";
const WRITER_STAGES: ReadonlySet<Stage> = new Set(["xlsx", "html", "pptx"]);

/** Thrown inside the pipeline to stop it with located issues; turned into `ok: false`. */
class Blocked extends Error {
  readonly issues: EngineIssue[];
  constructor(issues: EngineIssue[]) {
    super("blocked");
    this.issues = issues;
  }
}

const LONG_DASH = /[–—]/g;

function fail(issues: EngineIssue[], params: IssueParams): IssueResult {
  // A quoted detail may carry the very long dash the lint caught; the message itself never shows one.
  const message = formatIssue(issues[0]!, params.messages).replace(LONG_DASH, "-");
  return { ok: false, issues, message };
}

function miscount(processed: Map<string, ProcessedDataset>): Map<string, ProcessedDataset> {
  const copy = structuredClone(processed);
  const first = [...copy.values()].find((d) => d.steps.length > 0);
  if (first !== undefined) first.steps[0]!.removed += 1;
  return copy;
}

async function pipeline(spec: ReportSpec, files: RawFile[], params: IssueParams, env: IssueEnv, at: { stage: Stage }): Promise<IssueOutput> {
  const now = env.now ?? (() => performance.now());
  const start = now();
  const enter = (stage: Stage): void => {
    const elapsed = now() - start;
    if (elapsed > LIMITS.issueTimeBudgetMs) {
      throw new Blocked([{ rule: "limit.time", detail: `${Math.round(elapsed)} ms > ${LIMITS.issueTimeBudgetMs} ms before ${stage}` }]);
    }
    at.stage = stage;
  };
  const block = (issues: EngineIssue[]): void => { if (issues.length > 0) throw new Blocked(issues); };

  enter("validate");
  const merged = mergePackMeasures(spec, env.pack);
  block(validateSpec(merged, undefined, params));
  block(themeIssues(env.theme));

  enter("data");
  const processed = new Map<string, ProcessedDataset>();
  const profiles = new Map<string, ColumnProfile[]>();
  const dataIssues: EngineIssue[] = [];
  merged.datasets.forEach((def, i) => {
    const typed = typeDataset(def, files);
    dataIssues.push(...typed.issues);
    profiles.set(def.id, profileColumns(typed.data, def));
    const p = applySteps(typed.data, def, params, i);
    dataIssues.push(...p.issues);
    processed.set(def.id, p);
  });
  block(dataIssues);

  enter("resolve");
  const r = resolveVisuals(merged, processed, profiles, params);
  block(r.issues);

  enter("layout");
  const doc = layoutReport(merged, r.visuals, r.values, params, env.theme, env.measurer);
  block(doc.issues);

  enter("xlsx");
  const written = env.__testSeam === "miscountStep" ? miscount(processed) : processed;
  const plan = planWorkbook(files, merged, written, r.values, doc);
  const opts = { title: merged.title, issuedAt: params.issuedAt };
  const xlsx = await writeXlsx(plan, { files, spec: merged, processed: written, values: r.values, doc, theme: env.theme }, opts);

  enter("html");
  const html = renderHtml(doc, env.theme, opts);

  enter("pptx");
  if (env.__testSeam === "throwInPptx") throw new Error("test seam: PPTX writer failed");
  const pptx = await writePptx(doc, env.theme, opts);

  enter("recipe");
  const recipe = buildRecipe({ files, spec: merged, params, profiles });

  enter("gates");
  const report = await runGates({
    spec: merged, doc, html, pptx, xlsx: xlsx.report, companion: xlsx.companion, plan, processed, values: r.values,
    theme: env.theme, recipe,
  });
  block(report.issues);
  enter("gates");

  return {
    html, pdfPrintable: html, pptx, xlsx: xlsx.report, companion: xlsx.companion,
    reportFileName: xlsx.reportFileName, companionFileName: xlsx.companionFileName,
    recipe, lintReport: report.lint, parityReport: report,
  };
}

/**
 * One pass, no AI (M16). All or nothing (M13): every file with every gate passed, or no file and one
 * Arabic message naming the slide, block and rule. Order (C11): validate, data, resolve, layout, xlsx,
 * html, pptx, recipe, gates. Every figure comes from one set of measure definitions (M11).
 */
export async function issueReport(spec: ReportSpec, files: RawFile[], params: IssueParams, env: IssueEnv): Promise<IssueResult> {
  const at = { stage: "validate" as Stage };
  try {
    return { ok: true, files: await pipeline(spec, files, params, env, at) };
  } catch (e) {
    if (e instanceof Blocked) return fail(e.issues, params);
    if (e instanceof WorkbookRefused && e.issues.length > 0) return fail(e.issues, params);
    const rule = WRITER_STAGES.has(at.stage) ? "gate.ooxml" : "schema.invalid";
    return fail([{ rule, detail: `${at.stage}: ${e instanceof Error ? e.message : String(e)}` }], params);
  }
}

/**
 * Re-issues from a recipe (decision 12). Everything derives from `recipe.spec` and `recipe.params`; the
 * copied columns, steps and measures are ignored, so a divergent copy cannot change the output. A changed
 * or missing source file is refused.
 */
export async function reissueFromRecipe(recipeText: string, files: RawFile[], env: IssueEnv): Promise<IssueResult> {
  const v = validateRecipe(recipeText);
  if (!v.ok) return fail(v.issues, { issuedAt: "", values: {} });
  const params: IssueParams = v.recipe.params;
  const sources = checkSources(v.recipe, files);
  if (sources.length > 0) return fail(sources, params);
  // The recipe spec is already pack-merged (C23), so no pack is merged in again.
  return issueReport(v.recipe.spec, files, params, { ...env, pack: undefined });
}
