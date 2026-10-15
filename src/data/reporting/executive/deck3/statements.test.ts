import { describe, expect, it } from "vitest";
import { findOutliers, typeTotal, type PortShare } from "./statements";

const port = (name: string, sea: boolean, num: number, den: number): PortShare => ({ name, sea, num, den });

describe("typeTotal — the pooled «إجمالي» of one port type", () => {
  it("pools counts, so a big port weighs more than a small one", () => {
    const stats = [port("كبير", false, 900, 1000), port("صغير", false, 10, 100), port("بحري", true, 50, 100)];
    expect(typeTotal(stats, false)).toBeCloseTo((910 / 1100) * 100, 5);
    expect(typeTotal(stats, true)).toBeCloseTo(50, 5);
  });

  it("is null for a type with no cases", () => {
    expect(typeTotal([port("أ", false, 1, 10)], true)).toBeNull();
  });
});

describe("findOutliers — a port against its own port type's total", () => {
  const stats = [
    port("البطحاء", false, 450, 1000),
    port("الحديثة", false, 150, 1000),
    port("جديدة عرعر", false, 150, 1000),
    port("صغير", false, 90, 90),
    port("ميناء جدة", true, 340, 1000),
    port("ميناء الملك عبدالعزيز", true, 100, 1000),
  ];

  it("names land ports far above the land total only, and skips ports under the minimum base", () => {
    const high = findOutliers(stats, false, "high");
    expect(high.map((o) => o.name)).toEqual(["البطحاء"]);
    expect(high[0].baseShare).toBeCloseTo((840 / 3090) * 100, 5);
  });

  it("judges sea ports against the sea total, never the land one", () => {
    const high = findOutliers(stats, true, "high");
    expect(high.map((o) => [o.name, Math.round(o.baseShare)])).toEqual([["ميناء جدة", 22]]);
  });

  it("finds low outliers worst first", () => {
    const low = findOutliers([port("أ", false, 900, 1000), port("ب", false, 100, 1000), port("ج", false, 300, 1000)], false, "low");
    expect(low.map((o) => o.name)).toEqual(["ب", "ج"]);
  });
});
