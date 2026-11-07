import type { EngineIssue } from "../errors";
import type { ColumnDecl, ColumnProfile, ProcessingStep, RawFile } from "../data/types";
import { validateSpec } from "../spec/validate";
import type { IssueParams, MeasureSpec, ReportSpec } from "../spec/types";
import { ENGINE_VERSION } from "../version";

export type RecipeProfile = Omit<ColumnProfile, "sampleErrors">;

/**
 * The file shipped with every issue (decision 12). It holds file names and hashes, column types,
 * processing steps, measures, the merged spec, parameters and the engine version. It never holds
 * row data or raw cell values. `profiles` carry counts only (C10). `spec` is the pack-merged spec,
 * so pack measures and `model.packId` travel inside it, and `measures` repeats `spec.model.measures` (C23).
 */
export interface Recipe {
  recipeVersion: 1;
  engineVersion: string;
  issuedAt: string;
  sources: { fileName: string; sha256: string; sheets: { sheetName: string; headers: string[]; rowCount: number }[] }[];
  columns: Record<string, ColumnDecl[]>;
  profiles: Record<string, RecipeProfile[]>;
  steps: Record<string, ProcessingStep[]>;
  measures: MeasureSpec[];
  spec: ReportSpec;
  params: Omit<IssueParams, "messages">;
}

export interface RecipeInput {
  files: RawFile[];
  spec: ReportSpec;
  params: IssueParams;
  profiles: Map<string, ColumnProfile[]>;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = sortKeys(o[k]);
    return out;
  }
  return v;
}

/** Canonical JSON: keys sorted, 2-space indent, LF line ends, trailing newline. */
function canonical(v: unknown): string {
  return `${JSON.stringify(sortKeys(v), null, 2)}\n`;
}

export function buildRecipe(input: RecipeInput): string {
  const spec = structuredClone(input.spec);
  const columns: Record<string, ColumnDecl[]> = {};
  const steps: Record<string, ProcessingStep[]> = {};
  for (const d of spec.datasets) {
    columns[d.id] = d.columns;
    steps[d.id] = d.steps;
  }
  const profiles: Record<string, RecipeProfile[]> = {};
  for (const [id, list] of input.profiles) {
    profiles[id] = list.map(({ columnId, total, valid, errors, nulls, distinct }) => ({
      columnId, total, valid, errors, nulls, distinct,
    }));
  }
  const recipe: Recipe = {
    recipeVersion: 1,
    engineVersion: ENGINE_VERSION,
    issuedAt: input.params.issuedAt,
    sources: input.files.map((f) => ({
      fileName: f.fileName,
      sha256: f.bytesSha256,
      sheets: f.sheets.map((s) => ({ sheetName: s.sheetName, headers: [...s.headers], rowCount: s.rows.length })),
    })),
    columns,
    profiles,
    steps,
    measures: spec.model.measures,
    spec,
    params: { issuedAt: input.params.issuedAt, values: { ...input.params.values } },
  };
  return canonical(recipe);
}

const SHA = /^[0-9a-f]{64}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bad(path: string, detail: string): EngineIssue {
  return { rule: "recipe.invalid", path, detail };
}

function checkSheets(out: EngineIssue[], sheets: unknown, p: string): void {
  if (!Array.isArray(sheets)) return void out.push(bad(`${p}.sheets`, "expected an array"));
  sheets.forEach((sh: unknown, j) => {
    const q = `${p}.sheets[${j}]`;
    if (!isObj(sh)) return void out.push(bad(q, "expected an object"));
    if (typeof sh.sheetName !== "string") out.push(bad(`${q}.sheetName`, "expected a string"));
    if (!Array.isArray(sh.headers) || !sh.headers.every((h) => typeof h === "string")) out.push(bad(`${q}.headers`, "expected strings"));
    if (!Number.isInteger(sh.rowCount) || (sh.rowCount as number) < 0) out.push(bad(`${q}.rowCount`, "expected a non-negative integer"));
  });
}

function checkShape(r: Record<string, unknown>): EngineIssue[] {
  const out: EngineIssue[] = [];
  if (typeof r.engineVersion !== "string") out.push(bad("engineVersion", "expected a string"));
  if (typeof r.issuedAt !== "string") out.push(bad("issuedAt", "expected a string"));
  if (!Array.isArray(r.sources)) out.push(bad("sources", "expected an array"));
  else {
    r.sources.forEach((s: unknown, i) => {
      const p = `sources[${i}]`;
      if (!isObj(s)) return void out.push(bad(p, "expected an object"));
      if (typeof s.fileName !== "string") out.push(bad(`${p}.fileName`, "expected a string"));
      if (typeof s.sha256 !== "string" || !SHA.test(s.sha256)) out.push(bad(`${p}.sha256`, "expected 64 hex characters"));
      checkSheets(out, s.sheets, p);
    });
  }
  for (const k of ["columns", "profiles", "steps"] as const) {
    const m = r[k];
    if (!isObj(m)) out.push(bad(k, "expected an object"));
    else for (const [id, v] of Object.entries(m)) if (!Array.isArray(v)) out.push(bad(`${k}.${id}`, "expected an array"));
  }
  if (!Array.isArray(r.measures)) out.push(bad("measures", "expected an array"));
  if (!isObj(r.params)) out.push(bad("params", "expected an object"));
  else {
    if (typeof r.params.issuedAt !== "string") out.push(bad("params.issuedAt", "expected a string"));
    if (!isObj(r.params.values)) out.push(bad("params.values", "expected an object"));
  }
  if (!isObj(r.spec)) out.push(bad("spec", "expected an object"));
  return out;
}

/** Parses and checks a recipe. Fails closed: any shape or spec problem rejects it with located issues. */
export function validateRecipe(text: string): { ok: true; recipe: Recipe } | { ok: false; issues: EngineIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: [bad("", "not valid JSON")] };
  }
  if (!isObj(parsed)) return { ok: false, issues: [bad("", "expected an object")] };
  // The version gate comes first: a recipe from another version is not read any further.
  if (parsed.recipeVersion !== 1) return { ok: false, issues: [bad("recipeVersion", "unsupported recipe version")] };
  const shape = checkShape(parsed);
  if (shape.length > 0) return { ok: false, issues: shape };
  const recipe = parsed as unknown as Recipe;
  const specIssues = validateSpec(recipe.spec, undefined, recipe.params).map((i) => ({ ...i, path: i.path === undefined ? "spec" : `spec.${i.path}` }));
  if (specIssues.length > 0) return { ok: false, issues: specIssues };
  return { ok: true, recipe };
}

/** A missing source file or a changed hash gives `recipe.hashMismatch` naming the file. */
export function checkSources(recipe: Recipe, files: RawFile[]): EngineIssue[] {
  const out: EngineIssue[] = [];
  for (const s of recipe.sources) {
    const f = files.find((x) => x.fileName === s.fileName);
    if (f === undefined) out.push({ rule: "recipe.hashMismatch", path: s.fileName, detail: `${s.fileName}: file missing` });
    else if (f.bytesSha256 !== s.sha256) out.push({ rule: "recipe.hashMismatch", path: s.fileName, detail: `${s.fileName}: hash changed` });
  }
  return out;
}
