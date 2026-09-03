import { describe, expect, it } from "vitest";
import { averageCount, gapsByMonthSvg, samplesTrendSvg, type MonthGapPoint } from "./performanceCharts";

describe("averageCount", () => {
  it("returns 0 for an empty list", () => {
    expect(averageCount([])).toBe(0);
  });

  it("averages the counts", () => {
    expect(
      averageCount([
        { day: "2026-06-01", count: 2 },
        { day: "2026-06-02", count: 5 },
      ])
    ).toBe(3.5);
  });
});

describe("samplesTrendSvg", () => {
  it("falls back to the empty state when there are no points", () => {
    const svg = samplesTrendSvg([], "لا توجد بيانات");
    expect(svg).toContain("لا توجد بيانات");
    expect(svg).not.toContain("<rect");
  });

  it("draws one bar per point, escapes day labels, and draws a dashed average line", () => {
    const svg = samplesTrendSvg(
      [
        { day: "2026-06-01", count: 2 },
        { day: "2026-06-02", count: 5 },
      ],
      "لا توجد بيانات"
    );
    // 2 bars + 1 average-label background rect.
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    expect(rectCount).toBe(3);
    expect(svg).toContain("06-01");
    expect(svg).toContain("06-02");
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("3.5"); // average of 2 and 5
    // No raw hex color literal — every colour is a var(--c-…) token. The
    // gradient's own #um-perf-trend-grad id reference is not a color and is
    // deliberately excluded from this check.
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("does not divide by zero when every count is zero", () => {
    const svg = samplesTrendSvg(
      [
        { day: "2026-06-01", count: 0 },
        { day: "2026-06-02", count: 0 },
      ],
      "لا توجد بيانات"
    );
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });
});

function monthPoint(over: Partial<MonthGapPoint> = {}): MonthGapPoint {
  return {
    label: "يونيو 2026",
    durationMsByTier: { small: 0, medium: 0, large: 0 },
    totalDurationMs: 0,
    ...over,
  };
}

describe("gapsByMonthSvg", () => {
  it("falls back to the empty state when there are no points", () => {
    const svg = gapsByMonthSvg([], "لا توجد بيانات");
    expect(svg).toContain("لا توجد بيانات");
    expect(svg).not.toContain("<rect");
  });

  it("draws one stacked segment per non-zero tier and escapes the month label", () => {
    const svg = gapsByMonthSvg(
      [monthPoint({ label: "أغسطس 2026", durationMsByTier: { small: 60_000, medium: 120_000, large: 0 }, totalDurationMs: 180_000 })],
      "لا توجد بيانات"
    );
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    expect(rectCount).toBe(2); // small + medium; zero-duration large is skipped
    expect(svg).toContain("أغسطس 2026");
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("does not divide by zero when every month has zero total duration", () => {
    const svg = gapsByMonthSvg([monthPoint(), monthPoint({ label: "يوليو 2026" })], "لا توجد بيانات");
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });
});
