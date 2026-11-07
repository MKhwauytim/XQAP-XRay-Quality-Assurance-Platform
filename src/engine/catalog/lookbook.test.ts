import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_THEME } from "../__fixtures__/twoSlide";
import type { RawFile } from "../data/types";
import { issueReport } from "../issue/issueReport";
import type { IssueEnv } from "../issue/issueReport";
import { createFixedAdvanceMeasurer } from "../layout/measure";
import { lintOutputText } from "../lint/designLint";
import { buildSpecFromPicks } from "./bind";
import type { PickBinding } from "./bind";
import { DEMO_NOTE, DEMO_PARAMS, demoInputs } from "./designs/demo";
import { NOTE_SLOT } from "./designs/shared";
import { renderLookbook } from "./lookbook";
import { activeDesigns } from "./registry";

const env = (): IssueEnv => ({ theme: structuredClone(FIXTURE_THEME), measurer: createFixedAdvanceMeasurer() });
const count = (s: string, sub: string): number => s.split(sub).length - 1;

/** (value key, shown text) pairs, tags stripped. */
function figures(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/data-value-key="([^"]+)"[^>]*>(.*?)<\/(?:div|td|th|g)>/g)) {
    out.push(`${m[1]}=${m[2].replace(/<[^>]+>/g, "|")}`);
  }
  return out.sort();
}

/** Same layout as the demo, different figures and a real source line: the "real files" a host passes. */
function realInputs(numbers: number[]) {
  const designs = numbers.map((n) => activeDesigns().find((d) => d.number === n)!);
  const first = demoInputs(designs[0]);
  const files: RawFile[] = structuredClone(first.files);
  files[0].sheets[0].rows = files[0].sheets[0].rows.map((r) => [r[0], r[1], r[2], Number(r[3]) + 11, Number(r[4]) + 5]);
  const bindings: PickBinding[] = designs.map((d) => {
    const b = demoInputs(d).binding;
    return { ...b, slots: { ...b.slots, [NOTE_SLOT.id]: { text: "المصدر: ملف الربع الثالث" } } };
  });
  return { base: { ...first.base, title: "تقرير الربع الثالث" }, bindings, files };
}

describe("renderLookbook", () => {
  it("demo lookbook: designs 1 to 9 in order, labelled, planned listed once, static and lint-clean", () => {
    const r = renderLookbook(env());
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const nums = [...r.html.matchAll(/data-design-number="(\d+)"/g)].map((m) => Number(m[1]));
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(count(r.html, DEMO_NOTE)).toBe(9);
    expect(count(r.html, "قيد الإعداد")).toBe(1);
    expect(r.html).toContain("أرسلوا أرقام الشرائح المطلوبة بالترتيب، مثال: 1، 4، 5");
    expect(r.html).toContain("يحتاج: ");
    expect(r.html).not.toContain("<script");
    expect(lintOutputText("lookbook", [r.html])).toEqual([]);
  });

  it("preview: bound designs use the real files and match issueReport figure for figure", async () => {
    const numbers = [2, 4, 5];
    const { base, bindings, files } = realInputs(numbers);
    const r = renderLookbook(env(), { preview: { numbers, bindings, base, files } });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const sections = r.html.split('data-design-number="').slice(1);
    for (const n of numbers) {
      const sec = sections.find((s) => s.startsWith(`${n}"`))!;
      expect(sec, `design ${n}`).not.toContain(DEMO_NOTE);
    }
    expect(count(r.html, DEMO_NOTE)).toBe(9 - numbers.length);

    const built = buildSpecFromPicks(numbers, bindings, base);
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const issued = await issueReport(built.spec, files, DEMO_PARAMS, env());
    if (!issued.ok) throw new Error(issued.message);
    const want = figures(issued.files.html);
    expect(want.length).toBeGreaterThan(0);
    const previewSections = sections.filter((s) => numbers.some((n) => s.startsWith(`${n}"`))).join("");
    expect(figures(previewSections)).toEqual(want);
  });

  it("an invalid preview binding returns the bind issues", () => {
    const { base, bindings, files } = realInputs([3]);
    const broken = [{ ...bindings[0], slots: { ...bindings[0].slots, category: { measure: "studied" } } }];
    const r = renderLookbook(env(), { preview: { numbers: [3], bindings: broken, base, files } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.rule)).toContain("bind.wrongKind");
  });
});

/** Writes lookbook.html when CATALOG_OUT is set (see writeCatalogDemos.test.ts). */
const outDir = process.env.CATALOG_OUT;
describe.skipIf(outDir === undefined || outDir === "")("lookbook to CATALOG_OUT", () => {
  it("writes lookbook.html", () => {
    const r = renderLookbook(env());
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    mkdirSync(outDir ?? "", { recursive: true });
    writeFileSync(join(outDir ?? "", "lookbook.html"), r.html);
  });
});
