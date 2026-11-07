import { describe, expect, it } from "vitest";
import { twoSlideFixture } from "../__fixtures__/twoSlide";
import { run } from "../__fixtures__/helpers";
import { FIXTURE_FILES } from "../__fixtures__/twoSlide";
import { validateSpec } from "./validate";

describe("a figure in a page title", () => {
  it("is filled from the measure and traced as a figure of the title box", () => {
    const f = twoSlideFixture();
    // A measure no visual uses, so only the title resolution can supply it.
    f.spec.model.measures.push({ id: "rows", label: "الصفوف", datasetId: "studies", formula: "count([المنفذ])", format: { kind: "int", digits: 0 } });
    f.spec.pages[0].title = "الصفوف {{measure:rows}}";
    const { doc } = run({ f, files: FIXTURE_FILES });
    expect(doc.slides[0].title).toBe("الصفوف 10");
    expect(doc.figures.filter((x) => x.boxId === "s1-title").map((x) => x.display)).toEqual(["10"]);
  });
  it("refuses an unknown measure in a title", () => {
    const f = twoSlideFixture();
    f.spec.pages[0].title = "{{measure:nope}}";
    expect(validateSpec(f.spec, undefined, f.params).map((i) => i.rule)).toContain("measure.unknown");
  });
  it("refuses an unknown param in a title", () => {
    const f = twoSlideFixture();
    f.spec.pages[0].title = "تقرير {{param:nope}}";
    const issues = validateSpec(f.spec, undefined, f.params);
    expect(issues.find((i) => i.rule === "param.unknown")?.path).toBe("pages[0].title");
  });
  it("refuses a visual that takes the reserved title id", () => {
    const f = twoSlideFixture();
    f.spec.pages[0].visuals[0].visualId = "title";
    expect(validateSpec(f.spec, undefined, f.params).some((i) => i.path === "pages[0].visuals[0].visualId")).toBe(true);
  });
});
