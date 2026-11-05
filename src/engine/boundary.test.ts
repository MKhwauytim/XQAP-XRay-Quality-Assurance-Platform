import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
    } else if (/\.(m?[jt]sx?|json)$/.test(name) && !/\.test\.(m?[jt]sx?)$/.test(name)) out.push(p);
  }
  return out;
}

interface Imp { file: string; spec: string }
const SPEC_RES = [
  /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  /import\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /import\.meta\.glob(?:Eager)?\s*\(\s*\[?\s*["']([^"']+)["']/g,
  /new\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g,
];
function scanSource(file: string, src: string): Imp[] {
  const res: Imp[] = [];
  for (const re of SPEC_RES) for (const m of src.matchAll(re)) res.push({ file, spec: m[1]! });
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
  it("scans .js, .mjs and .json files but not tests", () => {
    const names = shippedFiles(ROOT).map((f) => f.split(/[\\/]/).pop()!);
    expect(names).toContain("limits.ts");
    expect(names).not.toContain("boundary.test.ts");
    expect("a.mjs b.cjs c.jsx d.json e.test.mjs".split(" ").filter(
      (n) => /\.(m?[jt]sx?|json)$/.test(n) && !/\.test\.(m?[jt]sx?)$/.test(n),
    )).toEqual(["a.mjs", "c.jsx", "d.json"]);
  });
});
