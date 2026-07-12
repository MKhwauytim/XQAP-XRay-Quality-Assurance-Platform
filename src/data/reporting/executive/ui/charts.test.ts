import { describe, it, expect } from "vitest";
import {
  rankedBar,
  donut,
  gauge,
  groupedBars,
  stackedBars,
  quadrantScatter,
  heatmap,
  sparkline,
} from "./charts";
import { XSS_PAYLOADS, XSS_MARKER, findLiveInjection } from "../../xssPayloads";

// See icons.test.ts — combining/ZWJ/keycap joiners kept out of the character
// class to satisfy no-misleading-character-class.
const EMOJI_RE = new RegExp(
  "[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{1F1E6}-\\u{1F1FF}]" +
    "|\\u{FE0F}|\\u{200D}|\\u{20E3}",
  "u",
);

const VIEWBOX_RE = /viewBox="0 0 [\d.]+ [\d.]+"/;

function assertSvg(svg: string): void {
  expect(typeof svg).toBe("string");
  expect(svg).toContain("<svg");
  expect(svg).toContain("</svg>");
  expect(svg).toMatch(VIEWBOX_RE);
  expect(EMOJI_RE.test(svg)).toBe(false);
}

describe("rankedBar", () => {
  it("renders HTML bars with legible labels", () => {
    // rankedBar renders HTML/CSS (not SVG) so RTL Arabic labels shape reliably.
    const html = rankedBar(
      [
        { label: "ميناء أ", value: 95 },
        { label: "ميناء ب", value: 60 },
      ],
      {},
    );
    expect(typeof html).toBe("string");
    expect(html).toContain("<div");
    expect(html).toContain("ميناء أ");
    expect(html).not.toMatch(EMOJI_RE);
  });

  it("handles empty data with a neutral placeholder", () => {
    const svg = rankedBar([], {});
    assertSvg(svg);
    expect(svg).toContain("—");
  });

  it("does not divide by zero when all values are zero", () => {
    const html = rankedBar([{ label: "x", value: 0 }], {});
    expect(html).toContain("<div");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("renders an axis reference row for the shared 0→max scale", () => {
    const html = rankedBar(
      [
        { label: "ميناء أ", value: 95 },
        { label: "ميناء ب", value: 60 },
      ],
      {},
    );
    expect(html).toContain("justify-content:space-between");
    expect(html).toContain(">95<"); // ceiling tick = the shared max
  });

  it("omits the axis row when every value is zero (nothing to scale)", () => {
    const html = rankedBar([{ label: "x", value: 0 }], {});
    expect(html).not.toContain("justify-content:space-between");
  });
});

describe("donut", () => {
  it("renders segments for valid data", () => {
    const svg = donut(
      [
        { label: "سليمة", value: 70 },
        { label: "اشتباه", value: 30 },
      ],
      {},
    );
    assertSvg(svg);
  });

  it("handles empty / zero-total data", () => {
    const svg = donut([], {});
    assertSvg(svg);
    expect(svg).toContain("—");
    expect(svg).not.toContain("NaN");
  });

  it("renders a category legend for multi-segment data", () => {
    const svg = donut(
      [
        { label: "سليمة", value: 70 },
        { label: "اشتباه", value: 30 },
      ],
      {},
    );
    expect(svg).toContain("سليمة");
    expect(svg).toContain("اشتباه");
    expect(svg).toContain("70%");
  });

  it("omits the legend for a single-category donut", () => {
    const svg = donut([{ label: "الكل", value: 10 }], {});
    assertSvg(svg);
    expect(svg).not.toContain("الكل");
  });

  it("escapes injected markup in a category label", () => {
    const svg = donut(
      [
        { label: XSS_PAYLOADS.scriptTag, value: 70 },
        { label: "طبيعي", value: 30 },
      ],
      {},
    );
    expect(findLiveInjection(svg)).toBeNull();
    expect(svg).toContain(XSS_MARKER);
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("gauge", () => {
  it("renders a single percentage", () => {
    const svg = gauge(82.5, {});
    assertSvg(svg);
    expect(svg).not.toContain("NaN");
  });

  it("clamps percentages above 100", () => {
    const svg = gauge(150, { width: 200, height: 120 });
    assertSvg(svg);
    // the rendered percentage label is clamped to 100%
    expect(svg).toContain("100%");
    expect(svg).not.toContain("150%");
  });

  it("clamps percentages below 0", () => {
    const svg = gauge(-20, { width: 200, height: 120 });
    assertSvg(svg);
    expect(svg).toContain("0%");
    expect(svg).not.toContain("-20");
  });

  it("renders a placeholder for null", () => {
    const svg = gauge(null, {});
    assertSvg(svg);
    expect(svg).toContain("—");
  });

  it("renders 0%/100% axis-reference ticks at the ends of the dial", () => {
    const svg = gauge(60, {});
    expect(svg).toContain(">0%<");
    expect(svg).toContain(">100%<");
  });
});

describe("groupedBars", () => {
  it("renders grouped series", () => {
    const svg = groupedBars(
      {
        groups: ["ميناء أ", "ميناء ب"],
        series: [
          { label: "L1", values: [80, 60] },
          { label: "L2", values: [70, 90] },
        ],
      },
      {},
    );
    assertSvg(svg);
  });

  it("handles empty data", () => {
    const svg = groupedBars({ groups: [], series: [] }, {});
    assertSvg(svg);
    expect(svg).toContain("—");
  });

  it("does not divide by zero when all values zero", () => {
    const svg = groupedBars(
      { groups: ["a"], series: [{ label: "L1", values: [0] }] },
      {},
    );
    assertSvg(svg);
    expect(svg).not.toContain("NaN");
  });

  it("renders a series legend distinguishing L1/L2", () => {
    const svg = groupedBars(
      {
        groups: ["ميناء أ", "ميناء ب"],
        series: [
          { label: "L1", values: [80, 60] },
          { label: "L2", values: [70, 90] },
        ],
      },
      {},
    );
    expect(svg).toContain(">L1<");
    expect(svg).toContain(">L2<");
  });

  it("omits the legend for a single series", () => {
    const svg = groupedBars(
      { groups: ["a"], series: [{ label: "فقط", values: [10] }] },
      {},
    );
    expect(svg).not.toContain("فقط");
  });

  it("escapes injected markup in a series label", () => {
    const svg = groupedBars(
      {
        groups: ["g"],
        series: [
          { label: XSS_PAYLOADS.scriptTag, values: [10] },
          { label: "عادي", values: [20] },
        ],
      },
      {},
    );
    expect(findLiveInjection(svg)).toBeNull();
    expect(svg).toContain(XSS_MARKER);
  });
});

describe("stackedBars", () => {
  it("renders stacked series", () => {
    const svg = stackedBars(
      {
        groups: ["ميناء أ", "ميناء ب"],
        series: [
          { label: "نظيف", values: [40, 30] },
          { label: "مشتبه", values: [10, 20] },
        ],
      },
      {},
    );
    assertSvg(svg);
  });

  it("handles empty data", () => {
    const svg = stackedBars({ groups: [], series: [] }, {});
    assertSvg(svg);
    expect(svg).toContain("—");
  });

  it("handles all-zero stacks without divide-by-zero", () => {
    const svg = stackedBars(
      { groups: ["a"], series: [{ label: "s", values: [0] }] },
      {},
    );
    assertSvg(svg);
    expect(svg).not.toContain("NaN");
  });

  it("renders a series legend distinguishing stacked segments", () => {
    const svg = stackedBars(
      {
        groups: ["ميناء أ"],
        series: [
          { label: "نظيف", values: [40] },
          { label: "مشتبه", values: [10] },
        ],
      },
      {},
    );
    expect(svg).toContain("نظيف");
    expect(svg).toContain("مشتبه");
  });
});

describe("quadrantScatter", () => {
  it("renders points across four quadrants", () => {
    const svg = quadrantScatter(
      [
        { label: "1", x: 90, y: 80 },
        { label: "2", x: 30, y: 20 },
      ],
      {},
    );
    assertSvg(svg);
  });

  it("handles empty data", () => {
    const svg = quadrantScatter([], {});
    assertSvg(svg);
    expect(svg).toContain("—");
  });

  it("clamps out-of-range coordinates", () => {
    const svg = quadrantScatter([{ label: "x", x: 999, y: -50 }], {});
    assertSvg(svg);
    expect(svg).not.toContain("NaN");
  });
});

describe("heatmap", () => {
  it("renders an N×N matrix", () => {
    const svg = heatmap(
      {
        rows: ["ميناء أ", "ميناء ب"],
        cols: ["نوع 1", "نوع 2"],
        values: [
          [10, 5],
          [0, 8],
        ],
      },
      {},
    );
    assertSvg(svg);
  });

  it("handles empty data", () => {
    const svg = heatmap({ rows: [], cols: [], values: [] }, {});
    assertSvg(svg);
    expect(svg).toContain("—");
  });

  it("handles all-zero matrix without divide-by-zero", () => {
    const svg = heatmap(
      { rows: ["a"], cols: ["b"], values: [[0]] },
      {},
    );
    assertSvg(svg);
    expect(svg).not.toContain("NaN");
  });

  it("renders a placeholder cell for null values", () => {
    const svg = heatmap(
      { rows: ["a"], cols: ["b"], values: [[null]] },
      {},
    );
    assertSvg(svg);
    expect(svg).not.toContain("NaN");
  });

  it("renders an intensity legend when values vary", () => {
    const svg = heatmap(
      {
        rows: ["ميناء أ"],
        cols: ["نوع 1", "نوع 2"],
        values: [[10, 4]],
      },
      {},
    );
    expect(svg).toContain("الأعلى");
    expect(svg).toContain("أقل");
  });
});

describe("sparkline", () => {
  it("renders a trend line", () => {
    const svg = sparkline([10, 12, 9, 15, 20], {});
    assertSvg(svg);
  });

  it("handles empty data", () => {
    const svg = sparkline([], {});
    assertSvg(svg);
    expect(svg).toContain("—");
  });

  it("handles a single point", () => {
    const svg = sparkline([5], {});
    assertSvg(svg);
    expect(svg).not.toContain("NaN");
  });

  it("handles a flat line (no range) without divide-by-zero", () => {
    const svg = sparkline([7, 7, 7], {});
    assertSvg(svg);
    expect(svg).not.toContain("NaN");
  });
});
