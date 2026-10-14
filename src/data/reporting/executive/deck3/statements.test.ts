import { describe, expect, it } from "vitest";
import { findOutliers, type PortShare } from "./statements";

const port = (name: string, sea: boolean, num: number, den: number): PortShare => ({ name, sea, num, den });

describe("findOutliers — a port against ONE fixed baseline per port type", () => {
  it("flags the land port whose high-quality share is far below the land baseline (all land ports pooled)", () => {
    const stats = [
      port("البطحاء", false, 760, 1000),
      port("الحديثة", false, 770, 1000),
      port("سلوى", false, 250, 1000),
      port("ميناء جدة", true, 790, 1000),
    ];
    const low = findOutliers(stats, "low", 300, 10);
    expect(low.map((o) => o.name)).toEqual(["سلوى"]);
    expect(low[0].sea).toBe(false);
    // (760 + 770 + 250) / 3000 = 59.3 — every land port is judged against this same figure.
    expect(low[0].baseShare).toBeCloseTo(59.33, 1);
  });

  it("every flagged port of a type quotes the SAME baseline", () => {
    const stats = [port("أ", false, 900, 1000), port("ب", false, 900, 1000), port("ج", false, 100, 1000), port("د", false, 150, 1000)];
    const low = findOutliers(stats, "low", 300, 10);
    expect(low.map((o) => o.name)).toEqual(["ج", "د"]);
    expect(new Set(low.map((o) => o.baseShare)).size).toBe(1);
    expect(low[0].baseShare).toBeCloseTo(51.25, 2);
  });

  it("land and sea ports each use their own type's baseline", () => {
    const stats = [port("بري أ", false, 800, 1000), port("بري ب", false, 400, 1000), port("بحري أ", true, 300, 1000), port("بحري ب", true, 100, 1000)];
    const low = findOutliers(stats, "low", 300, 10);
    expect(low.map((o) => [o.name, Math.round(o.baseShare)])).toEqual([["بري ب", 60], ["بحري ب", 20]]);
  });

  it("small ports count toward the baseline but are not themselves judged; gaps below the threshold are ignored", () => {
    const stats = [port("أ", false, 10, 100), port("ب", false, 750, 1000), port("ج", false, 700, 1000)];
    expect(findOutliers(stats, "low", 300, 10)).toEqual([]);
  });

  it("finds high outliers and orders the biggest gap first", () => {
    const stats = [port("أ", false, 500, 1000), port("ب", false, 400, 1000), port("ج", false, 100, 1000), port("د", false, 100, 1000)];
    expect(findOutliers(stats, "high", 300, 10).map((o) => o.name)).toEqual(["أ", "ب"]);
  });
});
