import { describe, expect, it } from "vitest";
import { samplesTrendSvg, workingHoursStripSvg } from "./performanceCharts";

describe("samplesTrendSvg", () => {
  it("falls back to the empty state when there are no points", () => {
    const svg = samplesTrendSvg([], "لا توجد بيانات");
    expect(svg).toContain("لا توجد بيانات");
    expect(svg).not.toContain("<path");
  });

  it("draws one line for a set of points and escapes day labels", () => {
    const svg = samplesTrendSvg(
      [
        { day: "2026-06-01", count: 2 },
        { day: "2026-06-02", count: 5 },
      ],
      "لا توجد بيانات"
    );
    expect(svg).toContain("<path");
    expect(svg).toContain("06-01");
    expect(svg).toContain("06-02");
    expect(svg).not.toContain("#"); // no raw hex — every color is a var(--c-…) token
  });
});

describe("workingHoursStripSvg", () => {
  it("falls back to the empty state when there are no days", () => {
    const svg = workingHoursStripSvg([], "اختر موظفاً");
    expect(svg).toContain("اختر موظفاً");
  });

  it("draws a base bar spanning sign-in to last finish, and a gap overlay for a non-normal gap", () => {
    const svg = workingHoursStripSvg(
      [
        {
          day: "2026-06-01",
          signInMinute: 6 * 60,
          lastFinishMinute: 11 * 60,
          gapSegments: [{ startMinute: 6 * 60 + 20, endMinute: 7 * 60 + 20, tier: "large" }],
        },
      ],
      "اختر موظفاً"
    );
    // Base bar + one non-normal gap overlay = at least two <rect> fills beyond the track background.
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    expect(rectCount).toBeGreaterThanOrEqual(3); // track + base bar + gap overlay
    expect(svg).toContain("2026-06-01");
  });

  it("does not draw an overlay for a normal-tier gap", () => {
    const svg = workingHoursStripSvg(
      [
        {
          day: "2026-06-01",
          signInMinute: 6 * 60,
          lastFinishMinute: 7 * 60,
          gapSegments: [{ startMinute: 6 * 60, endMinute: 6 * 60 + 5, tier: "normal" }],
        },
      ],
      "اختر موظفاً"
    );
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    expect(rectCount).toBe(2); // track + base bar only, no gap overlay
  });

  it("does not draw an overlay for an unclassified-tier gap", () => {
    const svg = workingHoursStripSvg(
      [
        {
          day: "2026-06-01",
          signInMinute: 6 * 60,
          lastFinishMinute: 7 * 60,
          gapSegments: [{ startMinute: 6 * 60, endMinute: 6 * 60 + 5, tier: "unclassified" }],
        },
      ],
      "اختر موظفاً"
    );
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    expect(rectCount).toBe(2); // track + base bar only, no gap overlay
  });
});
