import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sheetAoa, unzip } from "../__fixtures__/xlsxKit";
import { FIXTURE_THEME } from "../__fixtures__/twoSlide";
import type { RawFile } from "../data/types";
import { reissueFromRecipe } from "../issue/issueReport";
import type { IssueEnv } from "../issue/issueReport";
import { createFixedAdvanceMeasurer } from "../layout/measure";
import type { PickBinding, PicksBase } from "./bind";
import { DEMO_NOTE, DEMO_PARAMS, demoInputs } from "./designs/demo";
import { NOTE_SLOT } from "./designs/shared";
import { issueFromPicks } from "./issueFromPicks";
import { activeDesigns } from "./registry";

const env = (): IssueEnv => ({ theme: structuredClone(FIXTURE_THEME), measurer: createFixedAdvanceMeasurer() });
const REAL = "نتائج الربع الثالث";

/** The demo layouts with real names: no demo wording survives in the base, the files or the note. */
function realInputs(numbers: number[], files?: RawFile[]) {
  const designs = numbers.map((n) => activeDesigns().find((d) => d.number === n)!);
  const first = demoInputs(designs[0]!);
  const rename = <T,>(v: T): T => JSON.parse(JSON.stringify(v).split(DEMO_NOTE).join(REAL)) as T;
  const base: PicksBase = rename({ ...first.base, title: "تقرير الربع الثالث" });
  const bindings: PickBinding[] = designs.map((d) => {
    const b = demoInputs(d).binding;
    return { ...b, slots: { ...b.slots, [NOTE_SLOT.id]: { text: "المصدر: ملف الربع الثالث" } } };
  });
  return { base, bindings, files: rename(files ?? first.files) };
}

/** 40 rows of month x port, so design 4 has to continue. */
function longFiles(): RawFile[] {
  const rows: (string | number)[][] = [];
  for (let i = 0; i < 40; i++) rows.push([`منفذ ${i + 1}`, ["يناير", "فبراير", "مارس"][i % 3]!, (i % 3) + 1, 100 + i, 90 + (i % 7)]);
  const f = demoInputs(activeDesigns()[0]!).files;
  return [{ ...f[0]!, sheets: [{ ...f[0]!.sheets[0]!, rows }] }];
}

const pagesOf = (html: string): number[] => [...html.matchAll(/data-page="p\d+-d(\d+)"/g)].map((m) => Number(m[1]));
const titlesOf = (html: string): string[] => [...html.matchAll(/data-slide="\d+"/g)].map((m) => m[0]);

describe("issueFromPicks", () => {
  it("picks 1، 4، 5، 6 issue every file in that order (HTML, PPTX, workbook)", async () => {
    const { base, bindings, files } = realInputs([1, 4, 5, 6]);
    const r = await issueFromPicks("1، 4، 5، 6", bindings, base, files, DEMO_PARAMS, env());
    if (!r.ok) throw new Error(r.message);
    expect(pagesOf(r.files.html)).toEqual([1, 4, 5, 6]);
    const z = await unzip(r.files.pptx);
    const slides = z.list(/^ppt\/slides\/slide\d+\.xml$/).sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
    expect(slides).toHaveLength(4);
    const titles = bindings.map((b) => b.title.replace(/\{\{measure:[^}]+\}\}/g, "").trim().split(" ")[0]!);
    slides.forEach((s, i) => expect(z.text(s)).toContain(titles[i]!));
    const stats = sheetAoa(r.files.xlsx, "الإحصائيات").flat().map(String);
    // Slide 1 (design 1) has no figures, so the statistics sections are for slides 2, 3 and 4 (designs 4, 5, 6).
    const sections = stats.map((c) => /^(.+)، الشريحة ([0-9]+)$/.exec(c)).filter((m) => m !== null);
    expect(sections.map((m) => Number(m![2]))).toEqual([2, 3, 4]);
    expect(sections.map((m) => m![1])).toEqual(["الحاويات المدروسة حسب الشهر", "الحاويات المدروسة حسب المنفذ", "الحاويات المدروسة حسب المنفذ"]);
  });

  it("a long design 4 continues with (يتبع) and design 5 starts after the last continuation", async () => {
    const { base, bindings, files } = realInputs([4, 5], longFiles());
    const r = await issueFromPicks([4, 5].join("، "), bindings, base, files, DEMO_PARAMS, env());
    if (!r.ok) throw new Error(r.message);
    const pages = pagesOf(r.files.html);
    expect(pages.length).toBeGreaterThan(2);
    expect(r.files.html).toContain("(يتبع)");
    expect(pages.at(-1)).toBe(5);
    expect(pages.filter((p) => p === 5)).toHaveLength(1);
    expect(pages.slice(0, -1).every((p) => p === 4)).toBe(true);
    expect(titlesOf(r.files.html)).toHaveLength(pages.length);
  });

  it("a refused pick returns ok:false and no files", async () => {
    const { base, bindings, files } = realInputs([1, 4]);
    for (const picks of ["1، 4، 99", "1، 12"]) {
      const r = await issueFromPicks(picks, bindings, base, files, DEMO_PARAMS, env());
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.message).not.toBe("");
      expect(Object.keys(r)).not.toContain("files");
    }
    const unbound = await issueFromPicks("1، 4، 5", bindings, base, files, DEMO_PARAMS, env());
    expect(unbound.ok).toBe(false);
  });

  it("a picks sheet works like typed picks", async () => {
    const { base, bindings, files } = realInputs([1, 4]);
    const sheet = { sheetName: "الاختيارات", headers: ["الرقم"], rows: [["1"], ["4"]] };
    const r = await issueFromPicks(sheet, bindings, base, files, DEMO_PARAMS, env());
    if (!r.ok) throw new Error(r.message);
    expect(pagesOf(r.files.html)).toEqual([1, 4]);
  });

  it("re-issue from the recipe reproduces byte-identical files", async () => {
    const { base, bindings, files } = realInputs([1, 4, 5, 6]);
    const a = await issueFromPicks("1، 4، 5، 6", bindings, base, files, DEMO_PARAMS, env());
    if (!a.ok) throw new Error(a.message);
    const b = await reissueFromRecipe(a.files.recipe, files, env());
    if (!b.ok) throw new Error(b.message);
    expect(b.files.html).toBe(a.files.html);
    expect(Buffer.from(b.files.pptx).equals(Buffer.from(a.files.pptx))).toBe(true);
    expect(Buffer.from(b.files.xlsx).equals(Buffer.from(a.files.xlsx))).toBe(true);
    expect(Buffer.from(b.files.companion).equals(Buffer.from(a.files.companion))).toBe(true);
  });

  it("the demo label appears in no output (F3)", async () => {
    const { base, bindings, files } = realInputs([1, 4, 5, 6]);
    const r = await issueFromPicks("1، 4، 5، 6", bindings, base, files, DEMO_PARAMS, env());
    if (!r.ok) throw new Error(r.message);
    expect(r.files.html).not.toContain(DEMO_NOTE);
    expect(r.files.recipe).not.toContain(DEMO_NOTE);
    for (const bytes of [r.files.pptx, r.files.xlsx, r.files.companion]) {
      const z = await unzip(bytes);
      for (const n of z.names) expect(z.text(n), n).not.toContain(DEMO_NOTE);
    }
  });
});

/** Writes the 1، 4، 5، 6 outputs for the real-application check:
 *   $env:CATALOG_ISSUE_OUT = "C:\some\folder"; npx vitest run src/engine/catalog/issueFromPicks.test.ts */
const outDir = process.env.CATALOG_ISSUE_OUT;
describe.skipIf(outDir === undefined || outDir === "")("picks 1، 4، 5، 6 to CATALOG_ISSUE_OUT", () => {
  it("writes the files", async () => {
    const dir = outDir ?? "";
    mkdirSync(dir, { recursive: true });
    const { base, bindings, files } = realInputs([1, 4, 5, 6]);
    const r = await issueFromPicks("1، 4، 5، 6", bindings, base, files, DEMO_PARAMS, env());
    if (!r.ok) throw new Error(r.message);
    writeFileSync(join(dir, "report.html"), r.files.html);
    writeFileSync(join(dir, "report.pptx"), r.files.pptx);
    writeFileSync(join(dir, r.files.reportFileName), r.files.xlsx);
    writeFileSync(join(dir, r.files.companionFileName), r.files.companion);
    writeFileSync(join(dir, "report.recipe.json"), r.files.recipe);
    expect(r.files.xlsx.length).toBeGreaterThan(0);
  });
});
