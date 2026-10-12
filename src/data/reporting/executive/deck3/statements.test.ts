import { describe, expect, it } from "vitest";
import { findOutliers, type PortShare } from "./statements";

const port = (name: string, sea: boolean, num: number, den: number): PortShare => ({ name, sea, num, den });

describe("findOutliers — a port against the REST of its own type", () => {
  it("flags the land port whose high-quality share is far below the other land ports", () => {
    const stats = [
      port("البطحاء", false, 760, 1000),
      port("الحديثة", false, 770, 1000),
      port("سلوى", false, 250, 1000),
      port("ميناء جدة", true, 790, 1000),
    ];
    const low = findOutliers(stats, "low", 300, 10);
    expect(low.map((o) => o.name)).toEqual(["سلوى"]);
    expect(low[0].sea).toBe(false);
    expect(Math.round(low[0].othersShare)).toBe(77);
  });

  it("does not judge a port against its own volume: a dominant port is compared with the others", () => {
    const stats = [port("كبير", false, 100, 10000), port("صغير أ", false, 800, 1000), port("صغير ب", false, 800, 1000)];
    expect(findOutliers(stats, "low", 300, 10).map((o) => o.name)).toEqual(["كبير"]);
  });

  it("ignores ports below the base and gaps below the threshold", () => {
    const stats = [port("أ", false, 70, 100), port("ب", false, 750, 1000), port("ج", false, 700, 1000)];
    expect(findOutliers(stats, "low", 300, 10)).toEqual([]);
    expect(findOutliers(stats, "low", 50, 10).map((o) => o.name)).toEqual([]);
  });

  it("finds high outliers and orders the biggest gap first", () => {
    const stats = [port("أ", false, 500, 1000), port("ب", false, 400, 1000), port("ج", false, 100, 1000), port("د", false, 100, 1000)];
    expect(findOutliers(stats, "high", 300, 10).map((o) => o.name)).toEqual(["أ", "ب"]);
  });

  it("falls back to every other port when a type has no peers with enough evidence", () => {
    const stats = [port("بحري وحيد", true, 100, 1000), port("بري أ", false, 800, 1000), port("بري ب", false, 800, 1000)];
    expect(findOutliers(stats, "low", 300, 10).map((o) => o.name)).toEqual(["بحري وحيد"]);
  });
});
