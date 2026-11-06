import { describe, expect, it } from "vitest";
import { sha } from "../__fixtures__/xlsxKit";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { Fixture } from "../__fixtures__/twoSlide";
import { ENGINE_ACTION_MAP, createFixedAdvanceMeasurer, issueReport, reissueFromRecipe, validateRecipe, validateSpec } from "../index";
import type { IssueEnv, IssueOutput } from "../index";

const f = twoSlideFixture();
const env: IssueEnv = { theme: f.theme, measurer: createFixedAdvanceMeasurer() };

async function issueOk(x: Fixture = twoSlideFixture()): Promise<IssueOutput> {
  const r = await issueReport(x.spec, FIXTURE_FILES, x.params, { theme: x.theme, measurer: createFixedAdvanceMeasurer() });
  if (!r.ok) throw new Error(r.message);
  return r.files;
}

describe("walking skeleton", () => {
  it("issues the two-slide fixture in all six outputs with every gate passing", async () => {
    const r = await issueReport(f.spec, FIXTURE_FILES, f.params, env);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.files.pdfPrintable).toBe(r.files.html);
    expect(r.files.html).toContain("<html");
    expect(r.files.pptx.byteLength).toBeGreaterThan(0);
    expect(r.files.xlsx.byteLength).toBeGreaterThan(0);
    expect(r.files.companion.byteLength).toBeGreaterThan(0);
    expect(r.files.reportFileName).toMatch(/\.xlsx$/);
    expect(r.files.companionFileName).toMatch(/\.xlsx$/);
    expect(r.files.reportFileName).not.toBe(r.files.companionFileName);
    expect(validateRecipe(r.files.recipe).ok).toBe(true);
    expect(r.files.parityReport).toMatchObject({ passed: true, counts: { slides: 2, pptxTables: 1, pptxCharts: 1, xlsxTables: 2 } });
    expect(r.files.lintReport.errors).toEqual([]);
    expect(r.files.lintReport).toBe(r.files.parityReport.lint);
  });

  it("is byte-identical across two issues", async () => {
    const a = await issueOk(); const b = await issueOk();
    expect(sha(a.pptx)).toBe(sha(b.pptx));
    expect(sha(a.xlsx)).toBe(sha(b.xlsx));
    expect(sha(a.companion)).toBe(sha(b.companion));
    expect(a.html).toBe(b.html);
    expect(a.recipe).toBe(b.recipe);
  });

  it("re-issuing from the recipe plus the same raw files gives byte-identical outputs", async () => {
    const a = await issueOk();
    const b = await reissueFromRecipe(a.recipe, FIXTURE_FILES, env);
    expect(b.ok).toBe(true); if (!b.ok) return;
    expect(sha(b.files.pptx)).toBe(sha(a.pptx));
    expect(sha(b.files.xlsx)).toBe(sha(a.xlsx));
    expect(sha(b.files.companion)).toBe(sha(a.companion));
    expect(b.files.html).toBe(a.html);
    expect(b.files.recipe).toBe(a.recipe);
  });

  it("re-issue ignores a divergent copy of the steps and measures in the recipe", async () => {
    const a = await issueOk();
    const r = JSON.parse(a.recipe) as { steps: Record<string, unknown[]>; measures: { formula: string }[] };
    r.steps.studies = [];
    r.measures[0]!.formula = "count([المنفذ]) * 2";
    const b = await reissueFromRecipe(JSON.stringify(r), FIXTURE_FILES, env);
    expect(b.ok).toBe(true); if (!b.ok) return;
    expect(sha(b.files.pptx)).toBe(sha(a.pptx));
    expect(sha(b.files.xlsx)).toBe(sha(a.xlsx));
    expect(b.files.html).toBe(a.html);
  });

  it("re-issue with a changed raw file is refused with recipe.hashMismatch and no files", async () => {
    const a = await issueOk();
    const changed = [{ ...FIXTURE_FILES[0]!, bytesSha256: "f".repeat(64) }];
    const b = await reissueFromRecipe(a.recipe, changed, env);
    expect(b.ok).toBe(false); expect(b).not.toHaveProperty("files"); if (b.ok) return;
    expect(b.issues[0]!.rule).toBe("recipe.hashMismatch");
    expect(b.message).toContain("studies.xlsx");
  });

  it("re-issue of a broken recipe is refused with recipe.invalid", async () => {
    const b = await reissueFromRecipe("{not json", FIXTURE_FILES, env);
    expect(b.ok).toBe(false); if (b.ok) return;
    expect(b.issues[0]!.rule).toBe("recipe.invalid");
  });

  it("the action map routes the three actions to their entry points", () => {
    expect(ENGINE_ACTION_MAP.author).toBe(validateSpec);
    expect(ENGINE_ACTION_MAP.run.issueReport).toBe(issueReport);
    expect(ENGINE_ACTION_MAP.run.reissueFromRecipe).toBe(reissueFromRecipe);
    expect(ENGINE_ACTION_MAP.view).toBe(validateRecipe);
    expect(Object.keys(ENGINE_ACTION_MAP).sort()).toEqual(["author", "run", "view"]);
  });
});
