import { describe, it, expect } from "vitest";
import { bubbleScatter, percentHeatmap } from "./analyticsCharts";
import type { BubblePoint, HeatMatrix } from "./analyticsCharts";
import { XSS_PAYLOADS, XSS_MARKER, findLiveInjection } from "../../xssPayloads";

// Same emoji guard the sibling chart tests use (see charts.test.ts / icons.test.ts —
// combining/ZWJ/keycap joiners kept out of the character class to satisfy
// no-misleading-character-class).
const EMOJI_RE = new RegExp(
  "[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{1F1E6}-\\u{1F1FF}]" +
    "|\\u{FE0F}|\\u{200D}|\\u{20E3}",
  "u",
);

const VIEWBOX_RE = /viewBox="0 0 [\d.]+ [\d.]+"/;

/** Every primitive returns <figure><svg …/><table …/></figure>. */
function assertFigure(html: string): void {
  expect(typeof html).toBe("string");
  expect(html).toContain("<figure");
  expect(html).toContain("</figure>");
  expect(html).toContain("<svg");
  expect(html).toContain("</svg>");
  expect(html).toMatch(VIEWBOX_RE);
  expect(EMOJI_RE.test(html)).toBe(false);
  // never leak broken math into the markup
  expect(html).not.toContain("NaN");
  expect(html).not.toContain("Infinity");
  expect(html).not.toContain("undefined");
  // accessibility contract: hidden SVG + semantic screen-reader table
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("<table");
  expect(html).toContain("<caption>");
  // print safety
  expect(html).toContain("print-color-adjust:exact");
  // no raw hex color literals — colors come from theme tokens / currentColor
  expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  // RTL: the SVG root must NOT declare direction=rtl (it would mirror every
  // text-anchor); RTL is expressed through coordinate math instead.
  expect(html).not.toContain('direction="rtl"');
}

/** Pull the numeric cx values of the bubbles, in document order. */
function circleCxs(html: string): number[] {
  return [...html.matchAll(/<circle cx="([-\d.]+)"/g)].map((m) => Number(m[1]));
}

/** Pull the x of every <text> carrying the given content. */
function textX(html: string, content: string): number[] {
  const re = new RegExp(`<text x="([-\\d.]+)"[^>]*>${content}</text>`, "g");
  return [...html.matchAll(re)].map((m) => Number(m[1]));
}

const PORTS: BubblePoint[] = [
  { label: "ميناء أ", x: 120, y: 92.4, size: 300 },
  { label: "ميناء ب", x: 40, y: 78, size: 90 },
  { label: "ميناء ج", x: 260, y: 61.5, size: 640 },
];

describe("bubbleScatter", () => {
  it("renders a bubble per point with axes, ticks and a screen-reader table", () => {
    const html = bubbleScatter(PORTS, {
      width: 520,
      height: 300,
      xLabel: "عدد الصور المفحوصة",
      yLabel: "نسبة الدقة",
      caption: "عبء العمل مقابل الدقة",
    });
    assertFigure(html);
    expect(circleCxs(html)).toHaveLength(3);
    expect(html).toContain("عبء العمل مقابل الدقة");
    expect(html).toContain("عدد الصور المفحوصة");
    expect(html).toContain("نسبة الدقة");
    // sr table lists every port with its three magnitudes
    expect(html).toContain("ميناء أ");
    expect(html).toContain("ميناء ج");
    expect(html).toContain("<th scope=\"row\">ميناء ب</th>");
    // percentage y ticks
    expect(html).toContain("100%");
  });

  it("puts the x axis in RTL order — the smallest x sits furthest RIGHT", () => {
    const html = bubbleScatter(
      [
        { label: "صغير", x: 10, y: 50, size: 1 },
        { label: "كبير", x: 500, y: 50, size: 1 },
      ],
      { width: 400, height: 240, showPointLabels: false },
    );
    assertFigure(html);
    // bubbles are emitted largest-radius-first; both radii are equal here, so
    // match them by label-free geometry: two circles, and the one for x=10 must
    // have the LARGER cx (further right) than the one for x=500.
    const cxs = circleCxs(html);
    expect(cxs).toHaveLength(2);
    expect(Math.max(...cxs) - Math.min(...cxs)).toBeGreaterThan(50);
    // The y-axis tick gutter lives on the right, so tick text x > plot centre.
    const tickXs = textX(html, "20%");
    expect(tickXs.length).toBeGreaterThan(0);
    expect(tickXs[0]).toBeGreaterThan(200);
  });

  it("scales bubble radius by AREA and stays finite when every size is 0", () => {
    const varied = bubbleScatter(
      [
        { label: "a", x: 1, y: 10, size: 100 },
        { label: "b", x: 2, y: 20, size: 25 },
      ],
      { width: 300, height: 200, minRadius: 4, maxRadius: 20 },
    );
    const radii = [...varied.matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(radii).toHaveLength(2);
    // sqrt(25/100) = 0.5 → 4 + 0.5*(20-4) = 12 ; sqrt(1) → 20
    expect(radii).toContain(20);
    expect(radii).toContain(12);

    const zeroSized = bubbleScatter(
      [
        { label: "a", x: 1, y: 10, size: 0 },
        { label: "b", x: 2, y: 20, size: 0 },
      ],
      { width: 300, height: 200, minRadius: 4, maxRadius: 20 },
    );
    assertFigure(zeroSized);
    const zeroRadii = [...zeroSized.matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(zeroRadii).toEqual([12, 12]); // mid radius, no divide-by-zero
  });

  it("handles a single point without a zero-width domain", () => {
    const html = bubbleScatter([{ label: "وحيد", x: 50, y: 88, size: 10 }], {
      width: 300,
      height: 200,
    });
    assertFigure(html);
    expect(circleCxs(html)).toHaveLength(1);
    expect(html).toContain("وحيد");
  });

  it("handles all-identical x and y values without dividing by zero", () => {
    const same: BubblePoint[] = [
      { label: "أ", x: 7, y: 7, size: 3 },
      { label: "ب", x: 7, y: 7, size: 3 },
      { label: "ج", x: 7, y: 7, size: 3 },
    ];
    const pct = bubbleScatter(same, { width: 320, height: 220 });
    assertFigure(pct);
    expect(circleCxs(pct)).toHaveLength(3);

    // non-percent axis: the y domain itself collapses, so the ±1 pad must kick in
    const raw = bubbleScatter(same, { width: 320, height: 220, yIsPercent: false });
    assertFigure(raw);
    const cys = [...raw.matchAll(/<circle [^>]*cy="([-\d.]+)"/g)].map((m) => Number(m[1]));
    expect(cys).toHaveLength(3);
    for (const cy of cys) expect(Number.isFinite(cy)).toBe(true);
  });

  it("renders a neutral empty state for empty / null / all-unplottable input", () => {
    for (const html of [
      bubbleScatter([], { width: 300, height: 200, emptyNote: "لا توجد بيانات" }),
      bubbleScatter(null, { width: 300, height: 200, emptyNote: "لا توجد بيانات" }),
      bubbleScatter(undefined, { width: 300, height: 200, emptyNote: "لا توجد بيانات" }),
      bubbleScatter([{ label: "س", x: null, y: null }], {
        width: 300,
        height: 200,
        emptyNote: "لا توجد بيانات",
      }),
    ]) {
      assertFigure(html);
      expect(html).toContain("—");
      expect(html).toContain("لا توجد بيانات");
      expect(circleCxs(html)).toHaveLength(0);
    }
  });

  it("omits unplottable points from the plot but keeps them in the sr table as —", () => {
    const html = bubbleScatter(
      [
        { label: "مكتمل", x: 10, y: 90, size: 5 },
        { label: "ناقص", x: 10, y: null, size: null },
        { label: "بلا س", x: Number.NaN, y: 40 },
      ],
      { width: 320, height: 220 },
    );
    assertFigure(html);
    expect(circleCxs(html)).toHaveLength(1); // only the complete point is plotted
    expect(html).toContain("ناقص");
    expect(html).toContain("بلا س");
    expect(html).toContain("<td>—</td>"); // the missing magnitudes read as —
  });

  it("clamps percentage y values into 0–100", () => {
    const html = bubbleScatter(
      [
        { label: "فوق", x: 1, y: 250, size: 1 },
        { label: "تحت", x: 2, y: -40, size: 1 },
      ],
      { width: 300, height: 200 },
    );
    assertFigure(html);
    expect(html).not.toContain("250%");
    expect(html).not.toContain("-40%");
    expect(html).toContain("100%");
    expect(html).toContain("0%");
  });

  it("draws reference lines with their caption at the RIGHT (RTL start) end", () => {
    const html = bubbleScatter(PORTS, {
      width: 520,
      height: 300,
      refLines: [{ value: 90, label: "المستهدف ٩٠٪", tone: "success" }],
    });
    assertFigure(html);
    expect(html).toContain("المستهدف ٩٠٪");
    expect(html).toContain('stroke-dasharray="5 4"');
    // caption anchored to the line's right end
    expect(html).toMatch(/<text x="[\d.]+" y="[\d.]+" text-anchor="end"[^>]*>المستهدف ٩٠٪<\/text>/);
  });

  it("renders legend rows RTL (swatch flush right, label growing left)", () => {
    const html = bubbleScatter(PORTS, {
      width: 520,
      height: 300,
      legend: [
        { label: "بري", tone: "success" },
        { label: "بحري", tone: "info" },
      ],
    });
    assertFigure(html);
    expect(html).toContain("بري");
    expect(html).toContain("بحري");
    // legend labels use text-anchor="end" so they grow leftward from the swatch
    expect(html).toMatch(/text-anchor="end"[^>]*>بري<\/text>/);
    // swatch sits within 20px of the right edge (w = 520)
    const swatchXs = [...html.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="8" height="8"/g)].map(
      (m) => Number(m[1]),
    );
    expect(swatchXs.length).toBe(2);
    for (const x of swatchXs) expect(x).toBeGreaterThan(520 - 25);
  });

  it("escapes injected markup in labels and axis titles", () => {
    const html = bubbleScatter(
      [{ label: XSS_PAYLOADS.scriptTag, x: 5, y: 50, size: 1 }],
      {
        width: 320,
        height: 220,
        xLabel: XSS_PAYLOADS.imgOnerror,
        yLabel: XSS_PAYLOADS.svgOnload,
        caption: XSS_PAYLOADS.attrBreak,
        legend: [{ label: XSS_PAYLOADS.structureBreak }],
        refLines: [{ value: 50, label: XSS_PAYLOADS.scriptTag }],
      },
    );
    expect(findLiveInjection(html)).toBeNull();
    expect(html).toContain(XSS_MARKER);
    expect(html).toContain("&lt;script&gt;");
  });

  it("never draws past the requested width/height box", () => {
    const w = 480;
    const h = 260;
    const html = bubbleScatter(PORTS, {
      width: w,
      height: h,
      xLabel: "س",
      yLabel: "ص",
      legend: [{ label: "أ" }, { label: "ب" }],
    });
    expect(html).toContain(`viewBox="0 0 ${w} ${h}"`);
    const ys = [...html.matchAll(/ (?:y|y1|y2|cy)="([-\d.]+)"/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(h);
    }
  });
});

const MATRIX: HeatMatrix = {
  rows: ["ميناء أ", "ميناء ب"],
  cols: ["التوفر", "التحديد", "الجودة"],
  values: [
    [98, 91.5, 74],
    [88, null, 60],
  ],
};

describe("percentHeatmap", () => {
  it("renders a labelled matrix with a value in every populated cell", () => {
    const html = percentHeatmap(MATRIX, { width: 460, height: 220, caption: "جودة الصور" });
    assertFigure(html);
    expect(html).toContain("جودة الصور");
    expect(html).toContain("ميناء أ");
    expect(html).toContain("التوفر");
    expect(html).toContain(">98%<");
    expect(html).toContain(">92%<"); // 91.5 rounded to 0 digits
    expect(html).toContain("الأعلى");
    expect(html).toContain("أقل");
  });

  it("orders columns RIGHT-to-LEFT — cols[0] is painted at the right edge", () => {
    const html = percentHeatmap(
      { rows: ["ص"], cols: ["أول", "ثانٍ", "ثالث"], values: [[10, 50, 90]] },
      { width: 400, height: 180 },
    );
    assertFigure(html);
    const first = textX(html, "أول")[0];
    const second = textX(html, "ثانٍ")[0];
    const third = textX(html, "ثالث")[0];
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(third);
    // row header sits in the RIGHT gutter, further right than any column header
    const rowHeaderX = textX(html, "ص")[0];
    expect(rowHeaderX).toBeGreaterThan(first);
    // the screen-reader table keeps the LOGICAL order and declares dir="rtl"
    expect(html).toContain('<table dir="rtl"');
    expect(html.indexOf("<th scope=\"col\">أول</th>")).toBeLessThan(
      html.indexOf("<th scope=\"col\">ثالث</th>"),
    );
  });

  it("tints continuously between the two tones", () => {
    const html = percentHeatmap(
      { rows: ["ص"], cols: ["أ", "ب", "ج"], values: [[0, 50, 100]] },
      { width: 400, height: 180, toneLow: "text", toneHigh: "primary" },
    );
    assertFigure(html);
    const overlays = [...html.matchAll(/fill="var\(--gold\)" fill-opacity="([\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    // 3 cells (then 5 legend swatches). Cells are EMITTED in logical column
    // order — RTL lives in the x coordinate, not the document order.
    expect(overlays.slice(0, 3)).toEqual([0, 0.5, 1]);
    expect(html).toContain('fill="var(--white)"');
    // …and the logical-first cell (value 0) really is the right-most one.
    const cellXs = [...html.matchAll(/<rect x="([\d.]+)"[^>]*fill="var\(--white\)"/g)]
      .map((m) => Number(m[1]))
      .slice(0, 3); // the remainder are the legend swatches
    expect(cellXs).toHaveLength(3);
    expect(cellXs[0]).toBeGreaterThan(cellXs[1]);
    expect(cellXs[1]).toBeGreaterThan(cellXs[2]);
  });

  it("renders a — cell for null / undefined / NaN values, never a fake 0%", () => {
    const html = percentHeatmap(
      {
        rows: ["ص"],
        cols: ["أ", "ب", "ج", "د"],
        values: [[null, undefined, Number.NaN, 0]],
      },
      { width: 400, height: 180 },
    );
    assertFigure(html);
    const dashes = [...html.matchAll(/>—<\/text>/g)];
    expect(dashes).toHaveLength(3); // three missing cells in the SVG
    expect(html).toContain(">0%<"); // the genuine zero still prints as 0%
    // missing cells get an outline, not a fill
    expect(html).toContain('fill="none" stroke="currentColor"');
    // and the sr table mirrors it
    expect(html).toContain("<td>—</td>");
    expect(html).toContain("<td>0%</td>");
  });

  it("handles a single cell", () => {
    const html = percentHeatmap({ rows: ["ص"], cols: ["ع"], values: [[42]] }, {
      width: 200,
      height: 140,
    });
    assertFigure(html);
    expect(html).toContain(">42%<");
  });

  it("handles all-identical values and a zero-width domain without dividing by zero", () => {
    const identical = percentHeatmap(
      {
        rows: ["أ", "ب"],
        cols: ["س", "ص"],
        values: [
          [55, 55],
          [55, 55],
        ],
      },
      { width: 380, height: 200 },
    );
    assertFigure(identical);
    expect((identical.match(/>55%<\/text>/g) ?? []).length).toBe(4);

    // an explicitly collapsed domain → every present cell at the midpoint tint
    const collapsed = percentHeatmap(
      { rows: ["أ"], cols: ["س", "ص"], values: [[55, 55]] },
      { width: 380, height: 200, domain: [55, 55], toneHigh: "primary" },
    );
    assertFigure(collapsed);
    const overlays = [...collapsed.matchAll(/fill="var\(--gold\)" fill-opacity="([\d.]+)"/g)].map(
      (m) => Number(m[1]),
    );
    expect(overlays.slice(0, 2)).toEqual([0.5, 0.5]);
  });

  it("renders a neutral empty state for empty / null input", () => {
    for (const html of [
      percentHeatmap({ rows: [], cols: [], values: [] }, { width: 300, height: 180, emptyNote: "لا بيانات" }),
      percentHeatmap({ rows: ["أ"], cols: [], values: [[]] }, { width: 300, height: 180, emptyNote: "لا بيانات" }),
      percentHeatmap(null, { width: 300, height: 180, emptyNote: "لا بيانات" }),
      percentHeatmap(undefined, { width: 300, height: 180, emptyNote: "لا بيانات" }),
    ]) {
      assertFigure(html);
      expect(html).toContain("—");
      expect(html).toContain("لا بيانات");
    }
  });

  it("survives a ragged values array (short rows / missing rows)", () => {
    const html = percentHeatmap(
      { rows: ["أ", "ب", "ج"], cols: ["س", "ص"], values: [[10]] },
      { width: 380, height: 220 },
    );
    assertFigure(html);
    expect(html).toContain(">10%<");
    expect((html.match(/>—<\/text>/g) ?? []).length).toBe(5); // 3×2 grid minus the one value
  });

  it("clamps out-of-range percentages into 0–100", () => {
    const html = percentHeatmap(
      { rows: ["أ"], cols: ["س", "ص"], values: [[180, -30]] },
      { width: 320, height: 180 },
    );
    assertFigure(html);
    expect(html).toContain(">100%<");
    expect(html).toContain(">0%<");
    expect(html).not.toContain("180%");
    expect(html).not.toContain("-30%");
  });

  it("switches to the compact tier for larger matrices", () => {
    const cols = ["ج1", "ج2", "ج3", "ج4", "ج5", "ج6", "ج7", "ج8"];
    const rows = ["ص1", "ص2", "ص3"];
    const big = percentHeatmap(
      { rows, cols, values: rows.map(() => cols.map((_, i) => i * 10)) },
      { width: 620, height: 240 },
    );
    assertFigure(big);
    expect(big).toContain('font-size="9"'); // TYPE.micro — compact tier
    const small = percentHeatmap(MATRIX, { width: 460, height: 220 });
    expect(small).toContain('font-size="11"'); // TYPE.caption — roomy tier
  });

  it("escapes injected markup in row/column labels and captions", () => {
    const html = percentHeatmap(
      {
        rows: [XSS_PAYLOADS.scriptTag],
        cols: [XSS_PAYLOADS.imgOnerror],
        values: [[50]],
      },
      {
        width: 320,
        height: 180,
        caption: XSS_PAYLOADS.svgOnload,
        rowHeader: XSS_PAYLOADS.attrBreak,
        legendHighLabel: XSS_PAYLOADS.structureBreak,
      },
    );
    expect(findLiveInjection(html)).toBeNull();
    expect(html).toContain(XSS_MARKER);
    expect(html).toContain("&lt;script&gt;");
  });

  it("never draws past the requested width/height box", () => {
    const w = 500;
    const h = 240;
    const html = percentHeatmap(MATRIX, { width: w, height: h });
    expect(html).toContain(`viewBox="0 0 ${w} ${h}"`);
    const xs = [...html.matchAll(/ (?:x|x1|x2|cx)="([-\d.]+)"/g)].map((m) => Number(m[1]));
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w);
    }
    const ys = [...html.matchAll(/ (?:y|y1|y2|cy)="([-\d.]+)"/g)].map((m) => Number(m[1]));
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(h);
    }
  });
});
