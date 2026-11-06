import { describe, expect, it } from "vitest";
import { layoutFixture } from "../__fixtures__/helpers";
import { FIXTURE_THEME } from "../__fixtures__/twoSlide";
import type { LayoutDoc, TextBox } from "../layout/types";
import { contrastRatio, lintLayout, lintOutputText, lintText } from "./designLint";

const theme = FIXTURE_THEME;

const textOf = (doc: LayoutDoc): TextBox => {
  const box = doc.slides[0].boxes.find((b): b is TextBox => b.kind === "text" && b.visualId === "p1text");
  if (box === undefined) throw new Error("fixture has no p1text box");
  return box;
};

function docWithTextColor(c: string): LayoutDoc {
  const doc = layoutFixture();
  textOf(doc).color = c;
  return doc;
}

const f1 = (doc: LayoutDoc): boolean => lintLayout(doc, theme).errors.some((e) => (e.detail ?? "").startsWith("F1"));

describe("design lint", () => {
  it("the fixture layout has no errors and no warnings", () => {
    expect(lintLayout(layoutFixture(), theme)).toEqual({ errors: [], warnings: [] });
  });

  it("F1 contrast: muted text on panel below 4.5:1 is an error", () => {
    const doc = docWithTextColor(theme.ink.hair);
    expect(lintLayout(doc, theme).errors.map((e) => e.detail)).toContainEqual(expect.stringContaining("F1"));
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#fff", "#ffffff")).toBe(1);
  });

  it("F1: an unparseable colour is an error, never a pass", () => {
    expect(Number.isNaN(contrastRatio("red", "#ffffff"))).toBe(true);
    expect(f1(docWithTextColor("red"))).toBe(true);
    expect(f1(docWithTextColor("#12345"))).toBe(true);
  });

  it("F1 accepts 3:1 at 44px and above", () => {
    const grey = "#8f8f8f";
    expect(contrastRatio(grey, "#ffffff")).toBeGreaterThan(3);
    expect(contrastRatio(grey, "#ffffff")).toBeLessThan(4.5);
    const doc = docWithTextColor(grey);
    expect(f1(doc)).toBe(true);
    textOf(doc).sizePx = 48;
    expect(f1(doc)).toBe(false);
  });

  it("F1 reads the panel under a KPI tile as the background", () => {
    const doc = layoutFixture();
    const kpi = doc.slides[0].boxes.find((b): b is TextBox => b.kind === "text" && b.visualId === "p1kpi");
    if (kpi === undefined) throw new Error("fixture has no KPI text");
    kpi.color = theme.ink.panel;
    expect(lintLayout(doc, theme).errors).toContainEqual(expect.objectContaining({ path: kpi.id, detail: expect.stringContaining(`on ${theme.ink.panel}`) }));
  });

  it("F4 flags text under 20px; F2 carries the layout's fit errors", () => {
    const doc = layoutFixture();
    textOf(doc).sizePx = 18;
    doc.issues.push({ rule: "fit.tooLong", page: 1, visual: "p1text" });
    const details = lintLayout(doc, theme).errors.map((e) => e.detail ?? "");
    expect(details).toContainEqual(expect.stringContaining("F4: 18px"));
    expect(details).toContainEqual("F2: fit.tooLong");
  });

  it("R3 warns on a differently coloured box laid over the title", () => {
    const doc = layoutFixture();
    const title = doc.slides[0].boxes[0] as TextBox;
    doc.slides[0].boxes.push({ ...title, id: "accent", color: theme.tones.bad, x: title.x + 100, w: 100 });
    expect(lintLayout(doc, theme).warnings).toEqual([{ rule: "gate.lint", page: 1, path: "accent", detail: "R3: كلمة ملونة منفردة في العنوان" }]);
  });

  it.each(["عنوان \u2014 فرعي", "نتيجة \u2013 جيدة", "تم \u2705", "تحذير \u26A0", "سهم \u2192"])("lint fails %s", (s) => {
    expect(lintText(s).length).toBeGreaterThan(0);
  });

  it("lint passes plain hyphen, colon and Latin digits", () => {
    expect(lintText("نسبة: 85.5% - جدة")).toEqual([]);
  });

  it("names the rule, index and code point", () => {
    expect(lintText("a\u2014b\u2713")).toEqual([{ rule: "T3", index: 1 }, { rule: "T6", index: 3 }]);
    expect(lintOutputText("html", ["x\u2605"])).toEqual([{ rule: "gate.lint", path: "html", detail: "T6: U+2605" }]);
  });
});
