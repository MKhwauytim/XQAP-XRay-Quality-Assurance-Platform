import type { EngineIssue } from "../errors";

type Obj = Record<string, unknown>;

const COLUMN_TYPES = ["text", "number", "date", "boolean"];
const TONES = ["primary", "neutral", "good", "bad"];

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const at = (path: string, k: string): string => (path === "" ? k : `${path}.${k}`);

function bad(out: EngineIssue[], path: string, detail: string): void {
  out.push({ rule: "schema.invalid", path, detail });
}

function obj(out: EngineIssue[], v: unknown, path: string): v is Obj {
  if (isObj(v)) return true;
  bad(out, path, "expected object");
  return false;
}

function str(out: EngineIssue[], o: Obj, k: string, path: string, optional = false): void {
  const v = o[k];
  if (v === undefined && optional) return;
  if (typeof v !== "string") bad(out, at(path, k), "expected string");
}

function num(out: EngineIssue[], o: Obj, k: string, path: string, optional = false): void {
  const v = o[k];
  if (v === undefined && optional) return;
  if (typeof v !== "number" || !Number.isFinite(v)) bad(out, at(path, k), "expected number");
}

function bool(out: EngineIssue[], o: Obj, k: string, path: string, optional = false): void {
  const v = o[k];
  if (v === undefined && optional) return;
  if (typeof v !== "boolean") bad(out, at(path, k), "expected boolean");
}

function oneOf(out: EngineIssue[], o: Obj, k: string, path: string, allowed: unknown[], optional = false): void {
  const v = o[k];
  if (v === undefined && optional) return;
  if (!allowed.includes(v)) bad(out, at(path, k), `expected one of ${allowed.join(", ")}`);
}

function arr(
  out: EngineIssue[], o: Obj, k: string, path: string, each: (e: unknown, p: string) => void, optional = false,
): void {
  const v = o[k];
  if (v === undefined && optional) return;
  if (!Array.isArray(v)) {
    bad(out, at(path, k), "expected array");
    return;
  }
  Array.from(v as unknown[]).forEach((e, i) => each(e, `${at(path, k)}[${i}]`));
}

function filterShape(out: EngineIssue[], f: unknown, path: string): void {
  if (!obj(out, f, path)) return;
  str(out, f, "field", path);
  oneOf(out, f, "op", path, ["eq", "neq", "in", "notNull"]);
  const v = f.value;
  if (v === undefined) return;
  const scalar = (x: unknown): boolean => typeof x === "string" || (typeof x === "number" && Number.isFinite(x)) || typeof x === "boolean";
  const ok = scalar(v)
    || (Array.isArray(v) && Array.from(v as unknown[]).every((x) => typeof x === "string" || (typeof x === "number" && Number.isFinite(x))))
    || (isObj(v) && typeof v.param === "string");
  if (!ok) bad(out, at(path, "value"), "unsupported filter value");
}

function columnShape(out: EngineIssue[], c: unknown, path: string): void {
  if (!obj(out, c, path)) return;
  if (obj(out, c.source, at(path, "source"))) {
    for (const k of ["file", "sheet", "header"]) str(out, c.source, k, at(path, "source"));
  }
  str(out, c, "id", path);
  str(out, c, "label", path);
  oneOf(out, c, "type", path, COLUMN_TYPES);
  oneOf(out, c, "role", path, ["dimension", "measure"]);
  oneOf(out, c, "level", path, ["nominal", "ordinal", "quantitative", "temporal"]);
  str(out, c, "packField", path, true);
}

function stepShape(out: EngineIssue[], s: unknown, path: string): void {
  if (!obj(out, s, path)) return;
  str(out, s, "id", path);
  str(out, s, "label", path);
  oneOf(out, s, "kind", path, ["filter", "dedupe", "calc"]);
  if (s.filter !== undefined) filterShape(out, s.filter, at(path, "filter"));
  arr(out, s, "key", path, (e, p) => { if (typeof e !== "string") bad(out, p, "expected string"); }, true);
  if (s.calc !== undefined || s.kind === "calc") {
    const p = at(path, "calc");
    if (obj(out, s.calc, p)) {
      str(out, s.calc, "columnId", p);
      oneOf(out, s.calc, "type", p, COLUMN_TYPES);
      str(out, s.calc, "formula", p);
    }
  }
}

function datasetShape(out: EngineIssue[], d: unknown, path: string): void {
  if (!obj(out, d, path)) return;
  str(out, d, "id", path);
  str(out, d, "label", path);
  arr(out, d, "files", path, (e, p) => { if (typeof e !== "string") bad(out, p, "expected string"); });
  arr(out, d, "columns", path, (e, p) => columnShape(out, e, p));
  arr(out, d, "steps", path, (e, p) => stepShape(out, e, p));
}

function measureShape(out: EngineIssue[], m: unknown, path: string): void {
  if (!obj(out, m, path)) return;
  for (const k of ["id", "label", "datasetId", "formula"]) str(out, m, k, path);
  if (obj(out, m.format, at(path, "format"))) {
    oneOf(out, m.format, "kind", at(path, "format"), ["int", "pct", "dec"]);
    num(out, m.format, "digits", at(path, "format"));
  }
}

function itemShape(out: EngineIssue[], it: unknown, path: string): void {
  if (!obj(out, it, path)) return;
  const f = typeof it.field === "string";
  const m = typeof it.measure === "string";
  if (f === m) bad(out, path, "expected exactly one of field or measure as a string");
}

function visualShape(out: EngineIssue[], v: unknown, path: string): void {
  if (!obj(out, v, path)) return;
  str(out, v, "visualId", path);
  oneOf(out, v, "type", path, ["text", "kpiBand", "table", "barChart"]);
  if (obj(out, v.frame, at(path, "frame"))) {
    for (const k of ["col", "row", "w", "h", "z"]) num(out, v.frame, k, at(path, "frame"));
  }
  if (obj(out, v.wells, at(path, "wells"))) {
    for (const [role, items] of Object.entries(v.wells)) {
      const p = at(at(path, "wells"), role);
      if (!Array.isArray(items)) bad(out, p, "expected array");
      else Array.from(items as unknown[]).forEach((it, i) => itemShape(out, it, `${p}[${i}]`));
    }
  }
  arr(out, v, "filters", path, (e, p) => filterShape(out, e, p), true);
  if (v.sort !== undefined && obj(out, v.sort, at(path, "sort"))) {
    str(out, v.sort, "by", at(path, "sort"));
    oneOf(out, v.sort, "dir", at(path, "sort"), ["asc", "desc"]);
  }
  if (v.limit !== undefined && obj(out, v.limit, at(path, "limit"))) {
    num(out, v.limit, "topN", at(path, "limit"));
    bool(out, v.limit, "others", at(path, "limit"));
  }
  if (v.format !== undefined && obj(out, v.format, at(path, "format"))) {
    oneOf(out, v.format, "tone", at(path, "format"), TONES);
    num(out, v.format, "sizePx", at(path, "format"), true);
    oneOf(out, v.format, "weight", at(path, "format"), [400, 700], true);
  }
  str(out, v, "text", path, true);
}

function pageShape(out: EngineIssue[], p: unknown, path: string): void {
  if (!obj(out, p, path)) return;
  str(out, p, "pageId", path);
  str(out, p, "title", path);
  oneOf(out, p, "size", path, ["16:9"]);
  if (obj(out, p.grid, at(path, "grid"))) {
    oneOf(out, p.grid, "cols", at(path, "grid"), [24]);
    oneOf(out, p.grid, "rows", at(path, "grid"), [14]);
  }
  arr(out, p, "filters", path, (e, q) => filterShape(out, e, q), true);
  arr(out, p, "visuals", path, (e, q) => visualShape(out, e, q));
}

/** Pure shape check of an untrusted spec. Never throws; returns schema.invalid with paths. */
export function checkSpecShape(spec: unknown): EngineIssue[] {
  const out: EngineIssue[] = [];
  if (!obj(out, spec, "")) {
    out[0]!.path = "spec";
    return out;
  }
  oneOf(out, spec, "schemaVersion", "", [1]);
  str(out, spec, "reportId", "");
  str(out, spec, "title", "");
  oneOf(out, spec, "theme", "", ["deck3"]);
  arr(out, spec, "datasets", "", (e, p) => datasetShape(out, e, p));
  if (obj(out, spec.model, "model")) {
    str(out, spec.model, "packId", "model", true);
    arr(out, spec.model, "measures", "model", (e, p) => measureShape(out, e, p));
  }
  arr(out, spec, "params", "", (e, p) => {
    if (!obj(out, e, p)) return;
    str(out, e, "id", p);
    oneOf(out, e, "type", p, ["text", "month", "number"]);
    bool(out, e, "required", p);
  });
  arr(out, spec, "filters", "", (e, p) => filterShape(out, e, p), true);
  arr(out, spec, "pages", "", (e, p) => pageShape(out, e, p));
  return out;
}

/** Shape check of an optional domain pack. */
export function checkPackShape(pack: unknown): EngineIssue[] {
  const out: EngineIssue[] = [];
  if (!obj(out, pack, "pack")) return out;
  str(out, pack, "packId", "pack");
  arr(out, pack, "measures", "pack", (e, p) => measureShape(out, e, p));
  return out;
}
