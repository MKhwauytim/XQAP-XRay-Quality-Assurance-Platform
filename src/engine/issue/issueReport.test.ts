import { describe, expect, it } from "vitest";
import type { RawFile } from "../data/types";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { Fixture } from "../__fixtures__/twoSlide";
import { createFixedAdvanceMeasurer } from "../layout/measure";
import { LIMITS } from "../limits";
import type { MessageKey } from "../messages";
import { issueReport } from "./issueReport";
import type { IssueEnv, IssueOutput } from "./issueReport";

const baseEnv = (f: Fixture): IssueEnv => ({ theme: f.theme, measurer: createFixedAdvanceMeasurer() });

function withRows(n: number): RawFile[] {
  const files = structuredClone(FIXTURE_FILES);
  files[0]!.sheets[0]!.rows = files[0]!.sheets[0]!.rows.slice(0, n);
  return files;
}

async function issueOk(files: RawFile[]): Promise<IssueOutput> {
  const f = twoSlideFixture();
  const r = await issueReport(f.spec, files, f.params, baseEnv(f));
  if (!r.ok) throw new Error(r.message);
  return r.files;
}

const cases: [string, (f: Fixture, e: IssueEnv) => void, MessageKey][] = [
  ["unknown measure", (f) => { f.spec.pages[0]!.visuals[1]!.wells.values![0] = { measure: "nope" }; }, "measure.unknown"],
  ["hostile formula", (f) => { f.spec.model.measures[0]!.formula = "constructor"; }, "formula.notAllowed"],
  ["a measure over a column with type errors", (f) => { f.spec.model.measures[0]!.formula = "sum([العدد])"; }, "type.errors"],
  ["long dash in a title", (f) => { f.spec.pages[0]!.title = "عنوان — فرعي"; }, "gate.lint"],
  ["text that cannot fit", (f) => { f.spec.pages[0]!.visuals[0]!.text = "س".repeat(400); }, "fit.tooLong"],
  ["a step that miscounts (test seam)", (_f, e) => { e.__testSeam = "miscountStep"; }, "gate.reconcile"],
  ["time budget exceeded (env.now jumps)", (_f, e) => { let t = 0; e.now = () => (t += LIMITS.issueTimeBudgetMs); }, "limit.time"],
  ["writer throws", (_f, e) => { e.__testSeam = "throwInPptx"; }, "gate.ooxml"],
  ["an unsafe theme colour", (f) => { f.theme.tones.primary = "red;}"; }, "theme.invalid"],
];

describe("issueReport: all or nothing", () => {
  it.each(cases)("%s returns ok:false with no files and one Arabic message", async (_n, mutate, rule) => {
    const f = twoSlideFixture(); const e = baseEnv(f); mutate(f, e);
    const r = await issueReport(f.spec, FIXTURE_FILES, f.params, e);
    expect(r.ok).toBe(false); expect(r).not.toHaveProperty("files"); if (r.ok) return;
    expect(r.issues[0]!.rule).toBe(rule);
    expect(r.message).toMatch(/[؀-ۿ]/);
    expect(r.message).toContain(`(${rule})`);
    expect(r.message).not.toMatch(/[–—]/);
  });

  it("a host message override is used for the returned message", async () => {
    const f = twoSlideFixture();
    f.spec.model.measures[0]!.formula = "constructor";
    f.params.messages = { "formula.notAllowed": "رسالة مخصصة" };
    const r = await issueReport(f.spec, FIXTURE_FILES, f.params, baseEnv(f));
    expect(r.ok).toBe(false); if (r.ok) return;
    expect(r.message.startsWith("رسالة مخصصة")).toBe(true);
  });

  it("an empty dataset issues '-' for ratios and 0 for counts and passes gates", async () => {
    const a = await issueOk(withRows(0));
    expect(a.parityReport.passed).toBe(true);
    expect(a.html).toContain('<span dir="ltr">0</span>');
    expect(a.html).toMatch(/data-value-key="matchRate[^"]*"[^>]*>-</);
  });

  it("a one-row dataset issues and passes gates", async () => {
    const a = await issueOk(withRows(1));
    expect(a.parityReport.passed).toBe(true);
    expect(a.parityReport.counts.slides).toBe(2);
  });
});
