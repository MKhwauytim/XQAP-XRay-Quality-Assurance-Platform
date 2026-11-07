import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ENGINE_ACTIONS } from "./actions";
import { LIMITS, LIMITS_STATUS } from "./limits";

const ROOT = resolve(__dirname);

function shippedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__fixtures__") continue;
      out.push(...shippedFiles(p));
    } else if (/\.([cm]?[jt]sx?|json)$/.test(name) && !/\.test\.([cm]?[jt]sx?)$/.test(name)) out.push(p);
  }
  return out;
}

interface Imp { file: string; spec: string }
const SPEC_RES = [
  /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  /import\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /new\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g,
];
function scanSource(file: string, src: string): Imp[] {
  const res: Imp[] = [];
  for (const re of SPEC_RES) for (const m of src.matchAll(re)) res.push({ file, spec: m[1]! });
  const globRe = /import\.meta\.glob(?:Eager)?\s*\(\s*(\[[^\]]*\]|["'][^"']+["'])/g;
  for (const g of src.matchAll(globRe)) {
    for (const q of g[1]!.matchAll(/["']([^"']+)["']/g)) res.push({ file, spec: q[1]! });
  }
  return res;
}
function scanImports(): Imp[] {
  return shippedFiles(ROOT).flatMap((f) => scanSource(f, readFileSync(f, "utf8")));
}

const ALLOWED = ["pptxgenjs", "jszip", "xlsx"];
const isBareOutsideAllowList = (i: Imp) =>
  !i.spec.startsWith(".") && !ALLOWED.includes(i.spec.split("/")[0]!);
const resolvesOutside = (i: Imp) => {
  if (!i.spec.startsWith(".")) return false;
  const target = resolve(join(i.file, ".."), i.spec);
  return !(target === ROOT || target.startsWith(ROOT + "\\") || target.startsWith(ROOT + "/"));
};

describe("engine boundary", () => {
  it("no engine file imports outside src/engine or the allowed packages", () => {
    const imps = scanImports();
    expect(imps.filter(isBareOutsideAllowList)).toEqual([]);
    expect(imps.filter(resolvesOutside)).toEqual([]);
  });
  it("no shipped engine source mentions permissions or account roles", () => {
    const re = /\b(permission|permissions|canMutate|AuthRole|userId|guest|employee|supervisor|manager|admin)\b/;
    const hits = shippedFiles(ROOT).filter((f) => re.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("exposes exactly the three actions", () => {
    expect(ENGINE_ACTIONS).toEqual(["author", "run", "view"]);
  });
  it("limits are marked provisional", () => {
    expect(LIMITS_STATUS).toBe("provisional");
    const src = readFileSync(join(ROOT, "limits.ts"), "utf8");
    expect(src.match(/provisional: fix by measurement/g)!.length).toBe(Object.keys(LIMITS).length);
  });
  it("detects require, import.meta.glob and new URL specifiers", () => {
    const f = join(ROOT, "x.ts");
    const src = [
      'const a = require("../../data/x");',
      'const b = import.meta.glob("../../components/*.ts");',
      'const c = new URL("../../assets/y.png", import.meta.url);',
      'const d = require("lodash");',
    ].join("\n");
    const imps = scanSource(f, src);
    expect(imps.map((i) => i.spec).sort()).toEqual([
      "../../assets/y.png", "../../components/*.ts", "../../data/x", "lodash",
    ]);
    expect(imps.filter(resolvesOutside).length).toBe(3);
    expect(imps.filter(isBareOutsideAllowList).map((i) => i.spec)).toEqual(["lodash"]);
  });
  it("shippedFiles picks up cjs, mjs, jsx and json but not tests or fixtures", () => {
    const dir = mkdtempSync(join(tmpdir(), "engine-scan-"));
    try {
      mkdirSync(join(dir, "__fixtures__"));
      for (const n of ["a.mjs", "b.cjs", "c.jsx", "d.json", "e.test.mjs", "f.test.cjs", "g.md", "__fixtures__/h.ts"]) {
        writeFileSync(join(dir, n), "");
      }
      const names = shippedFiles(dir).map((f) => f.split(/[\\/]/).pop()!).sort();
      expect(names).toEqual(["a.mjs", "b.cjs", "c.jsx", "d.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("captures every element of an import.meta.glob array", () => {
    const src = 'const m = import.meta.glob(["../../a/*.ts", "./ok/*.ts", "../b/*.ts"], { eager: true });';
    const specs = scanSource(join(ROOT, "x.ts"), src).map((i) => i.spec).sort();
    expect(specs).toEqual(["../../a/*.ts", "../b/*.ts", "./ok/*.ts"]);
  });
});
