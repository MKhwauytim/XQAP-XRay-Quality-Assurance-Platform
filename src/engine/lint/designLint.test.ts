import { describe, expect, it } from "vitest";
import { layoutFixture, layoutOf, withText } from "../__fixtures__/helpers";
import { FIXTURE_FILES, FIXTURE_THEME, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { BarChartBox, LayoutDoc, LayoutSlide, TableBox, TextBox } from "../layout/types";
import { catalogEntryGate, contrastRatio, lintLayout, lintOutputText, lintText } from "./designLint";

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

/** Warnings other than R8, which the figure-less fixture titles always raise. */
const warnsExceptR8 = (doc: LayoutDoc) => lintLayout(doc, theme).warnings.filter((w) => !(w.detail ?? "").startsWith("R8"));

const f1 = (doc: LayoutDoc): boolean => lintLayout(doc, theme).errors.some((e) => (e.detail ?? "").startsWith("F1"));

describe("design lint", () => {
  it("the fixture layout has no errors; its only warnings are R8 (its titles carry no figure)", () => {
    const r = lintLayout(layoutFixture(), theme);
    expect(r.errors).toEqual([]);
    expect(r.overruled).toEqual([]);
    expect(r.warnings.map((w) => (w.detail ?? "").slice(0, 2))).toEqual(["R8", "R8"]);
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

  it("M6 warns, without blocking, on digits typed into static text, but not on a param value with digits", () => {
    const f = twoSlideFixture();
    f.spec.params.push({ id: "month", type: "month", required: true });
    f.params.values.month = "2026-05";
    f.spec.pages[0].visuals[0].text = "تقرير {{param:month}}: {{measure:matchRate}}";
    expect(warnsExceptR8(layoutOf({ f, files: FIXTURE_FILES }))).toEqual([]);
    const doc1 = layoutOf(withText("المستوى 1: {{measure:matchRate}}"));
    expect(lintLayout(doc1, theme).errors).toEqual([]);
    expect(warnsExceptR8(doc1)).toEqual([{ rule: "gate.lint", page: 1, path: "s1-p1text-0", detail: "M6: رقم مكتوب في نص ثابت: المستوى 1:" }]);
  });

  it("R3 warns on a differently coloured box laid over the title", () => {
    const doc = layoutFixture();
    const title = doc.slides[0].boxes[0] as TextBox;
    doc.slides[0].boxes.push({ ...title, id: "accent", color: theme.tones.bad, x: title.x + 100, w: 100 });
    expect(warnsExceptR8(doc)).toEqual([{ rule: "gate.lint", page: 1, path: "accent", detail: "R3: كلمة ملونة منفردة في العنوان" }]);
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

  describe("catalog entry rules", () => {
    const run = (text: string) => [{ text, ltr: false }];
    const tb = (id: string, over: Partial<TextBox>): TextBox => ({
      kind: "text", id, visualId: id, x: 100, y: 400, w: 300, h: 60, sizePx: 24, weight: 400, color: theme.ink.text,
      lines: [run("نص")], valueKeys: [], ...over,
    });
    const bar = (id: string, over: Partial<BarChartBox>): BarChartBox => ({
      kind: "bar", id, visualId: id, x: 100, y: 300, w: 800, h: 400, categories: ["أ"], values: [1], valueKeys: [], format: { kind: "int", digits: 0 },
      color: theme.ink.navy, ...over,
    });
    const table = (id: string, colW: number[]): TableBox => ({ kind: "table", id, visualId: id, x: 0, y: 0, colW, rowH: 50, header: [], rows: [[]], continued: false });
    const slide = (index: number, title: string, boxes: LayoutSlide["boxes"]): LayoutSlide => ({
      index, pageId: `p${index}`, title, boxes: [tb(`s${index}-title`, { y: 100, sizePx: 48, lines: [run(title)] }), ...boxes],
    });
    const doc = (...slides: LayoutSlide[]): LayoutDoc => ({ width: 1920, height: 1080, slides, figures: [], nonFigureSpans: [], issues: [] });
    const rules = (d: LayoutDoc, k: "errors" | "warnings" | "overruled" = "warnings"): string[] =>
      lintLayout(d, theme)[k].map((i) => (i.detail ?? "").slice(0, 2));

    it("F5: a good or bad bar with no value label and no text beside it is an error; a labelled one passes", () => {
      const bad = doc(slide(1, "ملخص ٥", [bar("b", { color: theme.tones.bad, categories: [""], values: [null] })]));
      expect(rules(bad, "errors")).toContain("F5");
      const ok = doc(slide(1, "ملخص ٥", [bar("b", { color: theme.tones.bad })]));
      expect(rules(ok, "errors")).not.toContain("F5");
      const beside = doc(slide(1, "ملخص ٥", [bar("b", { color: theme.tones.good, categories: [""], values: [null] }), tb("legend", { x: 100, y: 710 })]));
      expect(rules(beside, "errors")).not.toContain("F5");
    });

    it("F5: a good or bad KPI value alone fails; with a label box in its tile it passes", () => {
      const alone = doc(slide(1, "ملخص ٥", [tb("kpi", { color: theme.tones.good })]));
      expect(rules(alone, "errors")).toContain("F5");
      const labelled = doc(slide(1, "ملخص ٥", [tb("kpi", { color: theme.tones.good }), tb("lbl", { y: 470, color: theme.ink.muted })]));
      expect(rules(labelled, "errors")).not.toContain("F5");
    });

    it("R1: an eyebrow above the title on more than one slide warns; on one slide it does not", () => {
      const eyebrow = (i: number) => tb(`e${i}`, { y: 20, h: 40, sizePx: 24 });
      expect(rules(doc(slide(1, "ملخص ٥", [eyebrow(1)]), slide(2, "ملخص ٦", [eyebrow(2)])))).toEqual(["R1", "R1"]);
      expect(rules(doc(slide(1, "ملخص ٥", [eyebrow(1)]), slide(2, "ملخص ٦", [])))).toEqual([]);
    });

    it("R2: an all-capitals Latin word over 3 letters warns; 3 letters and mixed case pass", () => {
      expect(rules(doc(slide(1, "ملخص ٥", [tb("t", { lines: [run("REPORT نص")] })])))).toEqual(["R2"]);
      expect(rules(doc(slide(1, "ملخص ٥", [tb("t", { lines: [run("CSV Report نص")] })])))).toEqual([]);
    });

    it("R8: a title with no figure warns; one with a figure passes", () => {
      expect(rules(doc(slide(1, "ملخص", [])))).toEqual(["R8"]);
      expect(rules(doc(slide(1, "ملخص 85%", [])))).toEqual([]);
    });

    it("R9: two charts of similar size warn; one at least 1.5 times the other passes", () => {
      const pair = (w2: number) => doc(slide(1, "ملخص ٥", [bar("a", { w: 800 }), bar("b", { w: w2 })]));
      expect(rules(pair(700))).toEqual(["R9"]);
      expect(rules(pair(400))).toEqual([]);
      expect(rules(doc(slide(1, "ملخص ٥", [table("t", [400, 400]), table("u", [380, 380])])))).toEqual(["R9"]);
    });

    it("an overrule with a reason moves R9 to overruled; an empty reason does not; F5 cannot be overruled", () => {
      const d = doc(slide(1, "ملخص ٥", [bar("a", {}), bar("b", {})]));
      const withReason = lintLayout(d, theme, { overrules: [{ rule: "R9", reasonAr: "مقارنة متكافئة" }] });
      expect(withReason.warnings).toEqual([]);
      expect(withReason.overruled.map((i) => i.detail?.slice(0, 2))).toEqual(["R9"]);
      const empty = lintLayout(d, theme, { overrules: [{ rule: "R9", reasonAr: "  " }] });
      expect(empty.warnings.map((i) => i.detail?.slice(0, 2))).toEqual(["R9"]);
      expect(empty.overruled).toEqual([]);
      const f5Doc = doc(slide(1, "ملخص ٥", [tb("kpi", { color: theme.tones.bad })]));
      const f5 = lintLayout(f5Doc, theme, { overrules: [{ rule: "F5", reasonAr: "سبب" }] });
      expect(f5.errors.map((i) => i.detail?.slice(0, 2))).toContain("F5");
      expect(f5.overruled).toEqual([]);
    });

    it("catalogEntryGate passes only with no errors and no warnings left", () => {
      const clean = doc(slide(1, "ملخص ٥", [bar("a", { w: 800 }), bar("b", { w: 400 })]));
      expect(catalogEntryGate(clean, theme)).toEqual({ ok: true, issues: [] });
      const two = doc(slide(1, "ملخص ٥", [bar("a", {}), bar("b", {})]));
      expect(catalogEntryGate(two, theme).ok).toBe(false);
      expect(catalogEntryGate(two, theme, [{ rule: "R9", reasonAr: "سبب" }]).ok).toBe(true);
    });
  });
});
