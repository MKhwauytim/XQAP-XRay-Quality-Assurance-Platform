import { describe, expect, it } from "vitest";
import { timeSeriesBand } from "./analyticsCharts";
import type { BandSeries } from "./analyticsCharts";

function series(points: BandSeries["points"]): BandSeries[] {
  return [{ label: "دقة السليمة", tone: "success", points }];
}

describe("timeSeriesBand", () => {
  it("renders an empty state when no series has a plottable point", () => {
    const html = timeSeriesBand(series([{ x: 1, y: null, n: 0, lo: null, hi: null }]));
    expect(html).toContain("<svg");
    expect(html).toContain("—");
  });

  it("renders one polyline segment per contiguous run and never bridges a gap", () => {
    const html = timeSeriesBand(
      series([
        { x: 1, y: 90, n: 10, lo: 80, hi: 100 },
        { x: 2, y: null, n: 0, lo: null, hi: null },
        { x: 3, y: 95, n: 10, lo: 85, hi: 100 },
      ]),
    );
    // two separate runs → two polylines, not one spanning x=1..3
    expect((html.match(/<polyline/g) ?? [])).toHaveLength(2);
  });

  it("keeps the x axis at a fixed 1..31 regardless of how sparse the data is", () => {
    const dense = timeSeriesBand(series([{ x: 1, y: 50, n: 5, lo: 40, hi: 60 }]));
    const sparse = timeSeriesBand(series([{ x: 31, y: 50, n: 5, lo: 40, hi: 60 }]));
    expect(dense).toContain('data-x-max="31"');
    expect(sparse).toContain('data-x-max="31"');
  });

  it("marks a point that falls outside its own band", () => {
    const html = timeSeriesBand(
      series([
        { x: 1, y: 95, n: 20, lo: 90, hi: 99 },
        { x: 2, y: 50, n: 20, lo: 90, hi: 99 },
      ]),
    );
    expect(html).toContain("ts-out");
  });

  it("escapes series labels", () => {
    const html = timeSeriesBand([
      { label: '<script>x</script>', tone: "success", points: [{ x: 1, y: 50, n: 5, lo: 40, hi: 60 }] },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is deterministic — same input, byte-identical output", () => {
    const points = [{ x: 4, y: 88.5, n: 12, lo: 70, hi: 99 }];
    expect(timeSeriesBand(series(points))).toBe(timeSeriesBand(series(points)));
  });
});
