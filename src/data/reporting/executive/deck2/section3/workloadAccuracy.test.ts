// src/data/reporting/executive/deck2/section3/workloadAccuracy.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { buildReportModel } from "../../model/reportModel";
import type { ReportModel } from "../../model/reportModel";
import { band } from "../../model/dataSufficiency";
import type { KeyedAccuracy } from "../../model/aggregates";
import { WORKLOAD_ACCURACY_CSS, workloadAccuracySlideBuilders } from "./workloadAccuracy";

// ── Fixtures (same shape as deck2/deck2.test.ts) ────────────────────────────

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId: "XR-1",
    xrayEntryDate: null,
    portCode: "P1",
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "بري",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

function input(populationRows: PreparedPopulationRow[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

type Counts = {
  evaluable: number;
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
};

function rate(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

/** A `model.portAccuracy` entry with fully consistent derived rates, so the
 *  fixture can never disagree with what the real aggregate would produce. */
function portAcc(key: string, c: Counts): KeyedAccuracy {
  const reviewerSuspicious = c.correctSuspicion + c.missedSuspicion;
  return {
    key,
    ...c,
    accuracy: rate(c.correctClean + c.correctSuspicion, c.evaluable),
    detectionRate: rate(c.correctSuspicion, reviewerSuspicious),
    missedSuspicionRate: rate(c.missedSuspicion, reviewerSuspicious),
    suspicionDecisionAccuracy: rate(c.correctSuspicion, c.correctSuspicion + c.falseSuspicion),
    falseSuspicionRate: rate(c.falseSuspicion, c.correctClean + c.falseSuspicion),
    band: band(c.evaluable),
  };
}

/** A real model (so every untouched field is realistic) with the two inputs this
 *  page actually reads swapped for a controlled fixture. */
function modelWith(
  populationRows: PreparedPopulationRow[],
  portAccuracy: KeyedAccuracy[],
): ReportModel {
  return { ...buildReportModel(input(populationRows)), portAccuracy };
}

const CAVEAT = "ارتباط وصفي بين الحجم والدقة، لا يُقرأ كعلاقة سببية.";
const MUTED_CELL = '<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>';

/**
 * The right-hand table card only, with the `--w:` bar-width style attributes
 * stripped — those are layout geometry, not reported figures, so stripping them
 * lets a "no percentage here" assertion test the rendered TEXT. (A naive
 * `not.toContain("0.0%")` on the whole slide is useless: "100.0%" contains it.)
 */
function tableText(html: string): string {
  const start = html.indexOf('<table class="deck-table">');
  const end = html.indexOf("</table>", start);
  return html.slice(start, end === -1 ? undefined : end).replace(/ style="--w:[^"]*"/g, "");
}

/** Render page N (1-indexed) of this slide — most tests only care about the
 *  single page a small fixture produces. */
function render(model: ReportModel, num = 1, total = 2, variantPreview = false, page = 0): string {
  return workloadAccuracySlideBuilders(model, variantPreview)[page](num, total);
}

/** All pages, rendered in order. */
function renderAll(model: ReportModel, variantPreview = false): string[] {
  return workloadAccuracySlideBuilders(model, variantPreview).map((b, i) => b(i + 1, 99));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("workloadAccuracySlide — shell", () => {
  it("renders the required slide identity", () => {
    const html = render(modelWith([popRow()], []), 12, 30, false);
    expect(html).toContain('id="slide-s3-workload"');
    expect(html).toContain('data-section="section3"');
    expect(html).toContain("الأداء حسب حجم الأعمال");
    expect(html).toContain("القسم 3 — التحاليل المتقدمة");
    expect(html).toContain(
      "هل يرتبط انخفاض دقة المنفذ بارتفاع حجم صوره؟ مقارنة الدقة بحجم مجتمع كل منفذ.",
    );
    expect(html).toContain("12 / 30");
  });

  it("renders one variant panel in production and four in preview", () => {
    const model = modelWith([popRow()], []);
    expect(render(model, 1, 2, false)).not.toContain('class="v2-variant-stack"');
    const preview = render(model, 1, 2, true);
    expect(preview).toContain('data-slide-id="slide-s3-workload"');
    expect(preview.match(/v2-variant-panel/g)).toHaveLength(4);
  });
});

describe("workloadAccuracySlide — honesty", () => {
  it("always carries the association-not-causation caveat", () => {
    expect(render(modelWith([], []), 1, 2, false)).toContain(CAVEAT);
    expect(
      render(
        modelWith([popRow()], [portAcc("منفذ الاختبار", {
          evaluable: 40,
          correctClean: 30,
          correctSuspicion: 6,
          missedSuspicion: 2,
          falseSuspicion: 2,
        })]),
        1,
        2,
        false,
      ),
    ).toContain(CAVEAT);
  });

  it("never words the page as causation", () => {
    const html = render(modelWith([popRow()], []), 1, 2, false);
    expect(html).not.toContain("يسبب");
    expect(html).not.toContain("بسبب");
    expect(html).not.toContain("يؤدي");
  });
});

describe("workloadAccuracySlide — empty input", () => {
  const html = render(modelWith([], []), 1, 2, false);

  it("renders an explicit Arabic empty state, not an empty card", () => {
    expect(html).toContain("لا توجد بيانات منافذ لهذا الشهر");
    expect(html).toContain("v2-wl-empty");
    expect(html).not.toContain("v2-port-split");
  });

  it("emits no NaN and no fabricated zero percentages", () => {
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("0.0%");
    expect(html).not.toContain("undefined");
  });
});

describe("workloadAccuracySlide — computation", () => {
  const rows = [
    popRow({ xrayImageId: "A1" }),
    popRow({ xrayImageId: "A2" }),
    popRow({ xrayImageId: "A3" }),
    popRow({ xrayImageId: "B1", portName: "ميناء الاختبار", portType: "منفذ بحري", portCode: "P2" }),
  ];

  it("prints a known port's accuracy and missed-suspicion rate", () => {
    // 36 correct of 40 evaluable → 90.0%; 2 missed of (8 + 2) flagged → 20.0%.
    const html = render(
      modelWith(rows, [
        portAcc("منفذ الاختبار", {
          evaluable: 40,
          correctClean: 28,
          correctSuspicion: 8,
          missedSuspicion: 2,
          falseSuspicion: 2,
        }),
      ]),
      1,
      2,
      false,
    );
    expect(html).toContain("90.0%");
    expect(html).toContain("20.0%");
    // `ن` is printed alongside, so no percentage appears without its base.
    expect(html).toContain("<td>40</td>");
  });

  it("lists ports present in only one of the two sources", () => {
    const html = render(
      modelWith(rows, [
        portAcc("منفذ لا صور له", {
          evaluable: 30,
          correctClean: 30,
          correctSuspicion: 0,
          missedSuspicion: 0,
          falseSuspicion: 0,
        }),
      ]),
      1,
      2,
      false,
    );
    // population-only ports (no accuracy entry) …
    expect(html).toContain("منفذ الاختبار");
    expect(html).toContain("ميناء الاختبار");
    // … and accuracy-only ports (workload 0) both appear. Land now carries two
    // ports (منفذ الاختبار + the accuracy-only منفذ لا صور له, land by default
    // since it has no population row to derive a port type from), sea carries
    // one (ميناء الاختبار) — every port is still counted, split by group.
    expect(html).toContain("منفذ لا صور له");
    expect(html).toContain("2 منفذ");
    expect(html).toContain("1 منفذ");
  });

  it("renders a null-denominator rate as the muted dash, never 0%", () => {
    // 30 evaluable (rankable) but the reviewer flagged nothing → missed rate has
    // no denominator at all.
    const html = render(
      modelWith(rows, [
        portAcc("منفذ الاختبار", {
          evaluable: 30,
          correctClean: 30,
          correctSuspicion: 0,
          missedSuspicion: 0,
          falseSuspicion: 0,
        }),
      ]),
      1,
      2,
      false,
    );
    // the accuracy itself is real …
    expect(html).toContain('<td class="v2-bar-cell ok" style="--w:100.0%">100.0%</td>');
    // … but the missed rate has no denominator, so it is "—", never 0%.
    expect(tableText(html)).not.toMatch(/(?<![\d.])0\.0%/);
    expect(html).toContain(MUTED_CELL);
  });

  it("suppresses every rate for a port below the sufficiency cut", () => {
    // 5 evaluable → band "insufficient" → not rankable. 5/5 would be 100.0%;
    // the totals row is gated on the same summed base, so nothing prints it.
    const html = render(
      modelWith([popRow()], [
        portAcc("منفذ الاختبار", {
          evaluable: 5,
          correctClean: 5,
          correctSuspicion: 0,
          missedSuspicion: 0,
          falseSuspicion: 0,
        }),
      ]),
      1,
      2,
      false,
    );
    // No percentage text survives anywhere in the table — neither on the port
    // row nor on the totals row, which is gated on the same summed base.
    expect(tableText(html)).not.toMatch(/\d+\.\d%/);
    expect(html).toContain(MUTED_CELL);
    expect(html).toContain('<span class="insuff">—</span>');
    // the port and its base are still listed — it is hidden from ranking, not
    // hidden from the page.
    expect(html).toContain("منفذ الاختبار");
    expect(html).toContain("<td>5</td>");
  });

  it("paginates a land group over the row budget (11 ports, no fixed top-N drop)", () => {
    // Overflow of 4 rows (11 - BASE_ROWS_PER_PAGE 7) exceeds COMPRESS_OVERFLOW_MAX
    // (3), so this is real pagination, not the compact tier — the SAME
    // planPortPages decision every other land/sea page in the deck makes at
    // this exact overflow. No port is silently dropped: 7 on page 1, 4 on page 2.
    const many = Array.from({ length: 11 }, (_, i) =>
      popRow({ xrayImageId: `X${i}`, portCode: `P${i}`, portName: `منفذ ${i}` }),
    );
    const pages = renderAll(modelWith(many, []));
    expect(pages).toHaveLength(2);

    const page1Rows = pages[0].match(/<tr><td>منفذ /g) ?? [];
    expect(page1Rows).toHaveLength(7);
    expect(pages[0]).toContain('id="slide-s3-workload"');
    expect(pages[0]).not.toContain("تابع");
    expect(pages[0]).toContain("الإجمالي");
    expect(pages[0]).toContain('class="v2-fill-row"');

    const page2Rows = pages[1].match(/<tr><td>منفذ /g) ?? [];
    expect(page2Rows).toHaveLength(4);
    expect(pages[1]).toContain('id="slide-s3-workload-2"');
    expect(pages[1]).toContain("(تابع)");
    expect(pages[1]).toContain("الإجمالي");

    // Every one of the 11 ports appears exactly once across the two pages.
    const allNames = [...pages[0].matchAll(/<tr><td>(منفذ \d+)<\/td>/g), ...pages[1].matchAll(/<tr><td>(منفذ \d+)<\/td>/g)].map(
      (m) => m[1],
    );
    expect(new Set(allNames).size).toBe(11);
  });

  it("stays on one page in the compact tier when overflow is small (does not paginate at 8)", () => {
    // Overflow of 1 row (8 - 7) is within COMPRESS_OVERFLOW_MAX — compact tier,
    // one page, all 8 ports shown. This is the exact case that used to silently
    // drop the 8th port under the old fixed top-7 cutoff.
    const eight = Array.from({ length: 8 }, (_, i) =>
      popRow({ xrayImageId: `X${i}`, portCode: `P${i}`, portName: `منفذ ${i}` }),
    );
    const pages = renderAll(modelWith(eight, []));
    expect(pages).toHaveLength(1);
    const rows = pages[0].match(/<tr><td>منفذ /g) ?? [];
    expect(rows).toHaveLength(8);
    expect(pages[0]).toContain('class="v2-port-col land compact"');
  });
});

describe("workloadAccuracySlide — land/sea table layout (no chart)", () => {
  const rows = [
    popRow({ xrayImageId: "A1", portName: "منفذ بر", portType: "منفذ بري" }),
    popRow({ xrayImageId: "B1", portName: "ميناء بحر", portType: "منفذ بحري", portCode: "P2" }),
  ];
  const html = render(modelWith(rows, []), 1, 2, false);

  it("renders both land and sea as standard .v2-port-col tables built on the shared shell", () => {
    expect(html).toContain('<div class="v2-port-split v2-wl-split">');
    // Tint comes from `variant` alone (the shared .v2-port-col.land/.sea rules
    // in theme.ts) — no bespoke green/blue extraClass. A page-invented tint
    // class was the exact bug reported: "it look nothing like others".
    expect(html).toContain('class="v2-port-col land"');
    expect(html).toContain('class="v2-port-col sea"');
    expect(html).not.toContain('"v2-port-col land green"');
    expect(html).not.toContain('"v2-port-col sea blue"');
    // Each table carries the deck's standard shell markup — head + deck-table.
    expect(html.match(/v2-port-col-head/g)).toHaveLength(2);
    expect(html.match(/<table class="deck-table">/g)).toHaveLength(2);
  });

  it("prints the five required columns on both tables", () => {
    for (const th of ["<th>المنفذ</th>", "<th>حجم الصور</th>", "<th>الدقة</th>", "<th>الاشتباه الفائت</th>", "<th>العيّنة</th>"]) {
      expect(html.match(new RegExp(th.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(2);
    }
  });

  it("no longer renders a scatter chart of any kind", () => {
    // Icon glyphs still render as inline <svg> (badge icons, the caveat's alert
    // glyph) — what must be gone is the bubble-scatter chart well and its markup.
    expect(html).not.toContain("v2-wl-chart");
    expect(html).not.toContain("bubble");
    expect(html).not.toContain("<figure");
    expect(html).not.toContain("viewBox=\"0 0 470 330\"");
  });
});

describe("workloadAccuracySlide — safety and determinism", () => {
  it("escapes port names", () => {
    const html = render(
      modelWith([popRow({ portName: '<script>alert("x")</script>' })], []),
      1,
      2,
      false,
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("is byte-identical for identical input", () => {
    const rows = [
      popRow({ xrayImageId: "A1" }),
      popRow({ xrayImageId: "B1", portName: "ميناء الاختبار", portType: "منفذ بحري" }),
    ];
    const acc = [
      portAcc("منفذ الاختبار", {
        evaluable: 40,
        correctClean: 28,
        correctSuspicion: 8,
        missedSuspicion: 2,
        falseSuspicion: 2,
      }),
    ];
    const a = render(modelWith(rows, acc), 9, 24, false);
    const b = render(modelWith(rows, acc), 9, 24, false);
    expect(a).toBe(b);
  });

  it("exports a scoped, hex-free stylesheet", () => {
    expect(WORKLOAD_ACCURACY_CSS).toContain(".v2-wl-caveat");
    expect(WORKLOAD_ACCURACY_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
