// src/data/reporting/executive/deck3/chartKit.test.ts
import { describe, expect, it } from "vitest";
import { scalePct, barChart, groupedBarChart } from "./chartKit";

describe("scalePct", () => {
  it("maps the midpoint to 50%", () => {
    expect(scalePct(50, 0, 100)).toBe(50);
  });
  it("clamps below min to 0 and above max to 100", () => {
    expect(scalePct(-10, 0, 100)).toBe(0);
    expect(scalePct(150, 0, 100)).toBe(100);
  });
});

describe("barChart", () => {
  it("renders one bar per category with a height style derived from scalePct", () => {
    const html = barChart({ bars: [{ label: "منفذ أ", value: 92 }], min: 86, max: 98 });
    expect(html).toContain("منفذ أ");
    expect(html).toContain("height:50.0%"); // (92-86)/(98-86)*100 = 50
  });
  it("renders a dashed reference line at the reference value's scaled position", () => {
    const html = barChart({
      bars: [{ label: "أ", value: 90 }],
      min: 86, max: 98,
      references: [{ value: 92, label: "المتوسط", tone: "gold-dark" }],
    });
    expect(html).toContain("bottom:50.00%"); // (92-86)/(98-86)*100 = 50
    expect(html).toContain("المتوسط");
    expect(html).toContain("v3-refline gold-dark");
  });
  it("renders an honest gap (no bar) for a null value instead of a 0% bar", () => {
    const html = barChart({ bars: [{ label: "أ", value: null }], min: 0, max: 100 });
    expect(html).toContain('<div class="v3-cell"></div>');
    expect(html).not.toContain("height:0.0%");
  });
  it("caps bar width and tints the plot per the handoff geometry", () => {
    const html = barChart({ bars: [{ label: "أ", value: 50 }], min: 0, max: 100, tint: "land", barMaxWidth: 120 });
    expect(html).toContain("v3-plot land");
    expect(html).toContain("max-width:120px");
  });
  it("hides the category row for the mini-chart pattern", () => {
    const html = barChart({ bars: [{ label: "", value: 50 }], min: 0, max: 100, hideCats: true });
    expect(html).not.toContain("v3-cats");
  });
});

describe("groupedBarChart", () => {
  it("renders two bars (a/b) per group with independent heights", () => {
    const html = groupedBarChart({
      groups: [{ label: "منفذ أ", a: { label: "مستوى 1", value: 94 }, b: { label: "مستوى 2", value: 88 } }],
      min: 86, max: 96,
    });
    expect(html).toContain("منفذ أ");
    expect(html).toContain("height:80.0%"); // (94-86)/(96-86)*100 = 80
    expect(html).toContain("height:20.0%"); // (88-86)/(96-86)*100 = 20
  });
  it("pins groups to a fixed width slice and centers the row when groupWidthPct is set", () => {
    const html = groupedBarChart({
      groups: [{ label: "أ", a: { label: "", value: 90 }, b: { label: "", value: 91 } }],
      min: 86, max: 96,
      groupWidthPct: 16.2,
    });
    expect(html).toContain("flex:0 0 16.2%");
    expect(html).toContain("v3-bars center");
  });
});
