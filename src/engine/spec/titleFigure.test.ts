import { describe, expect, it } from "vitest";
import { twoSlideFixture } from "../__fixtures__/twoSlide";
import { run } from "../__fixtures__/helpers";
import { FIXTURE_FILES } from "../__fixtures__/twoSlide";
import { validateSpec } from "./validate";

describe("a figure in a page title", () => {
  it("is filled from the measure and traced as a figure of the title box", () => {
    const f = twoSlideFixture();
    f.spec.pages[0].title = "المدروس {{measure:studied}}";
    const { doc } = run({ f, files: FIXTURE_FILES });
    expect(doc.slides[0].title).toBe("المدروس 10");
    expect(doc.figures.filter((x) => x.boxId === "s1-title").map((x) => x.display)).toEqual(["10"]);
  });
  it("refuses an unknown measure in a title", () => {
    const f = twoSlideFixture();
    f.spec.pages[0].title = "{{measure:nope}}";
    expect(validateSpec(f.spec, undefined, f.params).map((i) => i.rule)).toContain("measure.unknown");
  });
  it("refuses a visual that takes the reserved title id", () => {
    const f = twoSlideFixture();
    f.spec.pages[0].visuals[0].visualId = "title";
    expect(validateSpec(f.spec, undefined, f.params).some((i) => i.path === "pages[0].visuals[0].visualId")).toBe(true);
  });
});
