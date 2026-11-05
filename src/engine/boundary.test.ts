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
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

interface Imp { file: string; spec: string }
function scanImports(): Imp[] {
  const re = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;
  const res: Imp[] = [];
  for (const file of shippedFiles(ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) res.push({ file, spec: (m[1] ?? m[2] ?? m[3])! });
  }
  return res;
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
});
