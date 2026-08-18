import { describe, expect, it } from "vitest";

import { outcomeDonutSvg } from "./kpiCharts";

describe("outcomeDonutSvg", () => {
  it("draws a visible ring when a single outcome class holds 100%", () => {
    // A lone slice sweeps the full circle: as an elliptical arc its start and end
    // points coincide, and SVG omits such an arc entirely — the ring vanished while
    // the centre «100%» label and the legend still rendered, reading as a broken card.
    const svg = outcomeDonutSvg([{ label: "سليمة صحيحة", value: 10 }], "لا توجد بيانات");

    expect(svg).toContain('<circle cx="110" cy="100" r="72" fill="none"');
    expect(svg).toContain('stroke-width="30"');
    // No degenerate arc (identical start/end point) left behind.
    expect(svg).not.toMatch(/M 110 13 A 87 87 0 1 1 110 13/);
    expect(svg).toContain("100%");
  });

  it("keeps the multi-slice arc geometry byte-identical", () => {
    // Report output is deterministic by contract — this pins the two-slice ring.
    const svg = outcomeDonutSvg(
      [
        { label: "أ", value: 6 },
        { label: "ب", value: 4 },
      ],
      "لا توجد بيانات"
    );

    expect(svg).toContain(
      '<path d="M 111.3 13.01 A 87 87 0 1 1 59.92 171.14 L 77.19 146.61 A 57 57 0 1 0 110.85 43.01 Z" fill="var(--c-teal-deep)"/>'
    );
    expect(svg).toContain(
      '<path d="M 57.81 169.61 A 87 87 0 0 1 108.7 13.01 L 109.15 43.01 A 57 57 0 0 0 75.81 145.61 Z" fill="var(--c-sky)"/>'
    );
  });

  it("falls back to the empty state when nothing is positive", () => {
    const svg = outcomeDonutSvg([{ label: "أ", value: 0 }], "لا توجد بيانات");
    expect(svg).toContain("لا توجد بيانات");
    expect(svg).not.toContain("<circle");
  });
});
