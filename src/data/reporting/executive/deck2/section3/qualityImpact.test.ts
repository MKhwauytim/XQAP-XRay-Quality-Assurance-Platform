// src/data/reporting/executive/deck2/section3/qualityImpact.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type {
  ExecutiveReportInput,
  ExecutiveReportRow,
  ReasonCount,
  VerificationCategory,
} from "../../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { buildReportModel } from "../../model/reportModel";
import type { ReportModel } from "../../model/reportModel";
import { XSS_COMBINED, XSS_MARKER, findLiveInjection } from "../../../xssPayloads";
import { QUALITY_IMPACT_CSS, qualityImpactSlide } from "./qualityImpact";

// ── Fixtures ────────────────────────────────────────────────────────────────

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

function reportRow(overrides: Partial<ExecutiveReportRow> = {}): ExecutiveReportRow {
  return {
    xrayImageId: "XR-1",
    portCode: "P1",
    portName: "منفذ الاختبار",
    portType: "منفذ بري",
    movementType: "بري",
    stage: "المستوى الثاني",
    levelOneEmployeeId: null,
    levelTwoEmployeeId: null,
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: true,
    assignedTo: null,
    distributionStatus: null,
    expertResult: "سليمة",
    imageAvailable: true,
    noImageReason: null,
    hasMarking: true,
    imageQuality: null,
    lowQualityReason: null,
    suspicionLevel: null,
    suspectedTypes: null,
    smuggleMethod: null,
    answerStatus: "submitted",
    assignedAt: null,
    submittedAt: null,
    imageResultAccurate: true,
    levelOneAccurate: true,
    levelTwoAccurate: true,
    verificationCategory: "correct-clean",
    otherResults: {
      manual: { result: null, employeeId: null },
      opposite: { result: null, employeeId: null },
      liveMeans: { result: null, employeeId: null },
    },
    notes: null,
    ...overrides,
  };
}

type OutcomeSpec = {
  correctClean?: number;
  correctSusp?: number;
  missedSusp?: number;
  excessSusp?: number;
};

/** `n` = sum of the spec; `accurate` = correctClean + correctSusp. Note the
 *  row-grain enum spellings (`excess-suspicious`, NOT `false-suspicion`). */
function strataRows(
  level: "عالي" | "متوسط" | "منخفض" | null,
  spec: OutcomeSpec,
  prefix: string,
): ExecutiveReportRow[] {
  const plan: Array<[VerificationCategory, boolean, number]> = [
    ["correct-clean", true, spec.correctClean ?? 0],
    ["correct-suspicious", true, spec.correctSusp ?? 0],
    ["missed-suspicious", false, spec.missedSusp ?? 0],
    ["excess-suspicious", false, spec.excessSusp ?? 0],
  ];
  const out: ExecutiveReportRow[] = [];
  for (const [category, accurate, count] of plan) {
    for (let i = 0; i < count; i += 1) {
      out.push(
        reportRow({
          xrayImageId: `${prefix}-${category}-${i}`,
          imageQuality: level,
          imageResultAccurate: accurate,
          verificationCategory: category,
        }),
      );
    }
  }
  return out;
}

/** Rows that carry a quality level but were never verified — they must be
 *  invisible to every denominator on the page. */
function unverifiedRows(level: "عالي" | "متوسط" | "منخفض", count: number): ExecutiveReportRow[] {
  return Array.from({ length: count }, (_v, i) =>
    reportRow({
      xrayImageId: `unver-${level}-${i}`,
      imageQuality: level,
      imageResultAccurate: null,
      verificationCategory: null,
    }),
  );
}

type ModelOpts = {
  acceptableQualityRate?: number | null;
  lowQualityCount?: number;
  mediumQualityCount?: number;
  lowQualityReasons?: ReasonCount[];
};

/** A real ReportModel with its row-grain inputs swapped for the fixture. Only
 *  the four fields this page reads are overridden; everything else stays as
 *  `buildReportModel` produced it. */
function modelOf(rows: ExecutiveReportRow[], opts: ModelOpts = {}): ReportModel {
  const base = buildReportModel(input([popRow()]));
  return {
    ...base,
    rows,
    imageQuality: {
      ...base.imageQuality,
      acceptableQualityRate: opts.acceptableQualityRate ?? null,
      lowQualityCount: opts.lowQualityCount ?? 0,
      mediumQualityCount: opts.mediumQualityCount ?? 0,
    },
    kpis: { ...base.kpis, lowQualityReasons: opts.lowQualityReasons ?? [] },
  };
}

function render(model: ReportModel, variantPreview = false): string {
  return qualityImpactSlide(model, 21, 30, variantPreview);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Three healthy, rankable strata: 95.0% / 85.0% / 70.0%. */
const THREE_STRATA: ExecutiveReportRow[] = [
  ...strataRows("عالي", { correctClean: 17, correctSusp: 2, missedSusp: 1 }, "hi"),
  ...strataRows("متوسط", { correctClean: 15, correctSusp: 2, missedSusp: 2, excessSusp: 1 }, "md"),
  ...strataRows("منخفض", { correctClean: 12, correctSusp: 2, missedSusp: 4, excessSusp: 2 }, "lo"),
];

/**
 * Uneven strata sizes (10 / 10 / 80) so a naive AVERAGE of the three strata's
 * own percentages measurably disagrees with the honest POOLED figure computed
 * from raw counts — the same tripwire shape this fan-out's sibling pages
 * (e.g. markingImpact's PRESENT_UNEVEN/ABSENT_UNEVEN) already use.
 *   عالي:   10 images, 10 accurate → 100.0%.
 *   متوسط:  10 images, 10 accurate → 100.0%.
 *   منخفض:  80 images, 20 accurate →  25.0%.
 *   Naive average = (100.0 + 100.0 + 25.0) / 3 = 75.0%.
 *   Honest pooled = (10 + 10 + 20) / (10 + 10 + 80) = 40 / 100 = 40.0%.
 */
const UNEVEN_STRATA: ExecutiveReportRow[] = [
  ...strataRows("عالي", { correctClean: 10 }, "hi"),
  ...strataRows("متوسط", { correctClean: 10 }, "md"),
  ...strataRows("منخفض", { correctClean: 20, missedSusp: 60 }, "lo"),
];

/**
 * عالي deliberately scores LOWEST of the three (40.0%), متوسط highest
 * (90.0%), منخفض in between (60.0%) — neither ascending nor descending in
 * fixed عالي→متوسط→منخفض display order, so a "sort ascending" OR a "sort
 * descending by accuracy" regression would both visibly reorder these rows
 * away from the fixed order the plan requires.
 */
const NONSORTED_STRATA: ExecutiveReportRow[] = [
  ...strataRows("عالي", { correctClean: 4, missedSusp: 6 }, "hi"), // 40.0%
  ...strataRows("متوسط", { correctClean: 9, missedSusp: 1 }, "md"), // 90.0%
  ...strataRows("منخفض", { correctClean: 6, missedSusp: 4 }, "lo"), // 60.0%
];

// ── Shell ───────────────────────────────────────────────────────────────────

describe("qualityImpactSlide — slide shell", () => {
  it("renders the agreed id, section, eyebrow, title and subhead", () => {
    const html = render(modelOf(THREE_STRATA));
    expect(html).toContain('id="slide-s3-quality"');
    expect(html).toContain('data-section="section3"');
    expect(html).toContain('data-title="أثر جودة الصورة على الدقة"');
    expect(html).toContain("القسم 3 — التحاليل المتقدمة");
    expect(html).toContain("دقة القرارات حسب مستوى جودة الصورة: عالي، متوسط، منخفض.");
  });

  it("renders one body in production and four design-system panels in preview", () => {
    const model = modelOf(THREE_STRATA);
    // Production (variantPreview=false) is slot 0 alone — its own markup is
    // unchanged by the fan-out below.
    expect(occurrences(render(model, false), "v2-qi-tiles")).toBe(1);
    const preview = render(model, true);
    // Preview renders all 4 design-system bodies now — Ledger/Briefing/Grid
    // each have their OWN markup (fan-out plan §11f, batch B3 item 4), so
    // only slot 0's own panel still carries "v2-qi-tiles"; the other three
    // are counted via the panel wrapper itself instead.
    expect(occurrences(preview, "v2-qi-tiles")).toBe(1);
    const panels = [...preview.matchAll(/<div class="v2-variant-panel(?: active)?" data-variant-index="\d"/g)];
    expect(panels.length).toBe(4);
    expect(preview).toContain('data-slide-id="slide-s3-quality"');
  });

  it("always carries the non-causal interpretation caveat", () => {
    for (const model of [modelOf(THREE_STRATA), modelOf([reportRow()])]) {
      expect(render(model)).toContain(
        "مقارنة وصفية بين مجموعات غير متكافئة؛ لا تُثبت أثرًا سببيًا لجودة الصورة.",
      );
    }
  });

  it("never emits NaN, Infinity or undefined, in either data state", () => {
    for (const model of [modelOf(THREE_STRATA), modelOf([reportRow()])]) {
      const html = render(model);
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("Infinity");
      expect(html).not.toContain("undefined");
    }
  });
});

// ── Empty state ─────────────────────────────────────────────────────────────

describe("qualityImpactSlide — no quality data at all", () => {
  const noQuality = modelOf([
    ...strataRows(null, { correctClean: 8, missedSusp: 2 }, "unk"),
    ...unverifiedRows("منخفض", 4),
  ]);

  it("renders a single honest Arabic empty state instead of the tiles", () => {
    const html = render(noQuality);
    expect(html).toContain("v2-qi-empty");
    expect(html).not.toContain("v2-qi-tiles");
    expect(html).not.toContain("v2-qi-step");
    expect(occurrences(html, "v2-qi-empty-icon")).toBe(1);
    expect(html).toContain("لم تُسجَّل أي صورة بمستوى جودة محدّد ضمن القرارات القابلة للتقييم");
  });

  it("never fabricates a 0% accuracy or a gradient", () => {
    const html = render(noQuality);
    expect(html).not.toContain("0.0%");
    expect(html).not.toContain("فارق عالي↔منخفض");
    expect(html).toContain('<span class="insuff">—</span>');
  });

  it("still reports the unverified/unassessed counts", () => {
    const html = render(noQuality);
    // 10 verified rows had no quality level; the 4 unverified rows are excluded
    // from every denominator on this page.
    expect(html).toContain("<b>10</b><small>صورة بلا تقييم لمستوى الجودة</small>");
    expect(html).toContain("<b>0</b><small>صورة بمستوى جودة محدّد ضمن التحليل</small>");
  });
});

// ── Populated strata ────────────────────────────────────────────────────────

describe("qualityImpactSlide — three populated strata", () => {
  const model = modelOf(THREE_STRATA, { acceptableQualityRate: 88.8 });
  const html = render(model);

  it("computes each stratum's accuracy at image grain", () => {
    expect(html).toContain("95.0%"); // عالي  19/20
    expect(html).toContain("85.0%"); // متوسط 17/20
    expect(html).toContain("70.0%"); // منخفض 14/20
  });

  it("prints n for every stratum, in both the tile and the trend strip", () => {
    expect(occurrences(html, "العيّنة 20")).toBe(6); // 3 tiles + 3 trend rows
  });

  it("computes the missed-suspicion rate from the confirmed-suspicious base only", () => {
    expect(html).toContain("33.3%"); // عالي  1/(2+1)
    expect(html).toContain("50.0%"); // متوسط 2/(2+2)
    expect(html).toContain("66.7%"); // منخفض 4/(2+4)
    expect(html).toContain("الاشتباه الفائت من 3");
    expect(html).toContain("الاشتباه الفائت من 6");
  });

  it("calls out a correctly signed high↔low gradient", () => {
    expect(html).toContain('فارق عالي↔منخفض: <span dir="ltr">+25.0</span> نقطة');
  });

  it("reports a negative gradient when low-quality images score higher", () => {
    const inverted = modelOf([
      ...strataRows("عالي", { correctClean: 14, correctSusp: 2, missedSusp: 4 }, "hi"),
      ...strataRows("متوسط", { correctClean: 17, correctSusp: 2, missedSusp: 1 }, "md"),
      ...strataRows("منخفض", { correctClean: 17, correctSusp: 2, missedSusp: 1 }, "lo"),
    ]);
    // Proper Unicode minus (U+2212), not an ASCII hyphen — 2026-07-28 fix (C4),
    // aligned with markingImpact.ts/levelAccuracy.ts's signed-delta glyph.
    expect(render(inverted)).toContain('فارق عالي↔منخفض: <span dir="ltr">−15.0</span> نقطة');
  });

  it("labels each stratum with its sufficiency band in words, not colour alone", () => {
    expect(occurrences(html, "بيانات كافية")).toBe(3);
    expect(html).toContain("كفاية البيانات");
  });

  it("excludes unverified rows from every denominator", () => {
    const withNoise = modelOf([...THREE_STRATA, ...unverifiedRows("منخفض", 200)]);
    const noisy = render(withNoise);
    expect(noisy).toContain("70.0%");
    expect(occurrences(noisy, "العيّنة 20")).toBe(6);
    expect(noisy).not.toContain("العيّنة 220");
  });

  it("keeps the submitted-answer acceptable-quality rate in its own labelled band", () => {
    expect(html).toContain("88.8%");
    expect(html).toContain("نسبة الجودة المقبولة · أساس مستقل: الإجابات المُسلَّمة");
    // the context band must not sit inside the strata tiles/trend strip
    const contextBand = html.slice(html.indexOf("v2-totals-band"));
    expect(contextBand).toContain("88.8%");
    expect(html.slice(0, html.indexOf("v2-totals-band"))).not.toContain("88.8%");
  });

  it("reports the unassessed count alongside the analysed total", () => {
    const mixed = modelOf([...THREE_STRATA, ...strataRows(null, { correctClean: 7 }, "unk")]);
    const withUnknown = render(mixed);
    expect(withUnknown).toContain("<b>7</b><small>صورة بلا تقييم لمستوى الجودة</small>");
    expect(withUnknown).toContain("<b>60</b><small>صورة بمستوى جودة محدّد ضمن التحليل</small>");
  });
});

// ── Thin stratum gating ─────────────────────────────────────────────────────

describe("qualityImpactSlide — thin منخفض stratum", () => {
  const thin = modelOf([
    ...strataRows("عالي", { correctClean: 17, correctSusp: 2, missedSusp: 1 }, "hi"),
    ...strataRows("متوسط", { correctClean: 15, correctSusp: 2, missedSusp: 2, excessSusp: 1 }, "md"),
    // n = 5 → band "insufficient" → never ranked, never rated.
    ...strataRows("منخفض", { correctClean: 2, correctSusp: 1, missedSusp: 2 }, "lo"),
  ]);
  const html = render(thin);

  it("renders — for the thin stratum instead of its raw 60% ratio", () => {
    expect(html).toContain("العيّنة 5");
    expect(html).toContain("بيانات غير كافية");
    expect(html).not.toContain("60.0%");
  });

  it("excludes the thin stratum from the gradient", () => {
    expect(html).toContain(`فارق عالي↔منخفض: <span class="insuff">—</span>`);
    expect(html).not.toContain("نقطة</div>");
  });

  it("excludes the thin stratum from the trend-bar scale", () => {
    // Only the two rankable accuracies (95.0 / 85.0) scale the bars, so the
    // best stratum's bar is full width and the thin one has none.
    expect(html).toContain('style="width:100.0%"');
    expect(html).toContain('style="width:0.0%"');
    expect(html).toContain('style="width:89.5%"'); // 85.0 / 95.0
  });

  it("still renders — with no bar when a stratum has zero rows", () => {
    const empty = modelOf([
      ...strataRows("عالي", { correctClean: 17, correctSusp: 2, missedSusp: 1 }, "hi"),
      ...strataRows("متوسط", { correctClean: 15, correctSusp: 2, missedSusp: 2, excessSusp: 1 }, "md"),
    ]);
    const emptyHtml = render(empty);
    expect(emptyHtml).toContain("العيّنة 0");
    expect(emptyHtml).toContain("لا توجد بيانات");
    expect(emptyHtml).toContain("الاشتباه الفائت من 0");
    expect(emptyHtml).toContain(`فارق عالي↔منخفض: <span class="insuff">—</span>`);
    expect(emptyHtml).not.toContain("NaN");
  });
});

// ── Low-quality reasons card ────────────────────────────────────────────────

describe("qualityImpactSlide — low-quality reasons card", () => {
  const reasons: ReasonCount[] = [
    { reason: "تشويش في الصورة", count: 12, percentage: 40 },
    { reason: "زاوية غير مناسبة", count: 9, percentage: 30 },
    { reason: "تعرض ضوئي منخفض", count: 6, percentage: 20 },
    { reason: "سبب رابع لا يُعرض", count: 3, percentage: 10 },
  ];

  it("renders only the top three reasons, over their own labelled base", () => {
    const html = render(
      modelOf(THREE_STRATA, { lowQualityReasons: reasons, lowQualityCount: 20, mediumQualityCount: 10 }),
    );
    expect(html).toContain("تشويش في الصورة");
    expect(html).toContain("زاوية غير مناسبة");
    expect(html).toContain("تعرض ضوئي منخفض");
    expect(html).not.toContain("سبب رابع لا يُعرض");
    expect(html).toContain("من الصور منخفضة/متوسطة الجودة (30)");
    expect(html).toContain("40.0%"); // 12 / 30
    expect(html).toContain("30.0%"); // 9 / 30
    expect(html).toContain("20.0%"); // 6 / 30
  });

  it("renders — rather than a percentage when the reasons base is empty", () => {
    const html = render(modelOf(THREE_STRATA, { lowQualityReasons: reasons }));
    expect(html).toContain("من الصور منخفضة/متوسطة الجودة (0)");
    expect(html).toContain("تشويش في الصورة");
    expect(html).not.toContain("NaN");
  });

  it("omits the card entirely when no reasons were recorded", () => {
    const html = render(modelOf(THREE_STRATA));
    expect(html).not.toContain("v2-qi-reasons");
    expect(html).not.toContain("أبرز أسباب انخفاض الجودة");
  });

  it("escapes reason strings coming from the answer data", () => {
    const html = render(
      modelOf(THREE_STRATA, {
        lowQualityReasons: [{ reason: XSS_COMBINED, count: 4, percentage: 100 }],
        lowQualityCount: 4,
      }),
    );
    expect(findLiveInjection(html)).toBeNull();
    expect(html).toContain(XSS_MARKER); // proves the field was rendered, escaped
    expect(html).toContain("&lt;script&gt;");
  });
});

// ── Purity ──────────────────────────────────────────────────────────────────

describe("qualityImpactSlide — determinism and CSS", () => {
  it("is byte-identical across repeated renders of the same model", () => {
    const model = modelOf(THREE_STRATA, {
      acceptableQualityRate: 88.8,
      lowQualityReasons: [{ reason: "تشويش", count: 3, percentage: 50 }],
      lowQualityCount: 6,
    });
    expect(render(model)).toBe(render(model));
  });

  it("is byte-identical for two independently built but equal models", () => {
    const rowsA = [...THREE_STRATA];
    const rowsB = [...THREE_STRATA];
    expect(render(modelOf(rowsA))).toBe(render(modelOf(rowsB)));
  });

  it("does not depend on row order within a stratum", () => {
    const reversed = [...THREE_STRATA].reverse();
    expect(render(modelOf(reversed))).toBe(render(modelOf(THREE_STRATA)));
  });

  it("exports CSS with no raw hex colour literals and no emoji", () => {
    expect(QUALITY_IMPACT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(QUALITY_IMPACT_CSS).toContain(".v2-risk-tile-grid.v2-qi-tiles");
    expect(QUALITY_IMPACT_CSS).toContain(".v2-qi .insuff");
  });
});

// ── Ledger/Briefing/Grid fan-out (2026-07-25 plan §11f, batch B3 item 4) ────
// Preview mode (`variantPreview: true`) renders all 4 design-system bodies in
// one HTML string (each wrapped in its own `.v2-variant-panel`), so every
// assertion below just searches that combined string — the same technique
// this fan-out's sibling test files (markingImpact.test.ts, etc.) use to
// reach the non-default slots. Panel boundaries are found via each system's
// own page-local hook (`v2-lg-quality` / `v2-bf-quality` / `v2-gd-quality`),
// which appear in that fixed order in the markup.

function preview(model: ReportModel): string {
  return qualityImpactSlide(model, 21, 30, true);
}

function ledgerPanel(html: string): string {
  return html.slice(html.indexOf("v2-lg-quality"), html.indexOf("v2-bf-quality"));
}
function briefingPanel(html: string): string {
  return html.slice(html.indexOf("v2-bf-quality"), html.indexOf("v2-gd-quality"));
}
function gridPanelOf(html: string): string {
  return html.slice(html.indexOf("v2-gd-quality"));
}

const CAVEAT_TEXT = "مقارنة وصفية بين مجموعات غير متكافئة؛ لا تُثبت أثرًا سببيًا لجودة الصورة.";

const REASONS: ReasonCount[] = [
  { reason: "تشويش في الصورة", count: 12, percentage: 40 },
  { reason: "زاوية غير مناسبة", count: 9, percentage: 30 },
  { reason: "تعرض ضوئي منخفض", count: 6, percentage: 20 },
];

describe("qualityImpactSlide — fan-out shell (all 4 panels present, caveat in each)", () => {
  it("renders a Ledger, a Briefing and a Grid panel alongside slot 0, in that order", () => {
    const html = preview(modelOf(THREE_STRATA));
    const lgIdx = html.indexOf("v2-lg-quality");
    const bfIdx = html.indexOf("v2-bf-quality");
    const gdIdx = html.indexOf("v2-gd-quality");
    expect(lgIdx).toBeGreaterThan(-1);
    expect(bfIdx).toBeGreaterThan(lgIdx);
    expect(gdIdx).toBeGreaterThan(bfIdx);
  });

  it("carries the non-causal caveat verbatim in the Ledger, Briefing and Grid panels", () => {
    const html = preview(modelOf(THREE_STRATA));
    expect(ledgerPanel(html)).toContain(CAVEAT_TEXT);
    expect(briefingPanel(html)).toContain(CAVEAT_TEXT);
    expect(gridPanelOf(html)).toContain(CAVEAT_TEXT);
  });

  it("shows the shared empty state (not a system-specific one) in all three new panels when no strata exist", () => {
    const html = preview(modelOf([reportRow({ imageQuality: null })]));
    expect(ledgerPanel(html)).toContain("v2-qi-empty");
    expect(briefingPanel(html)).toContain("v2-qi-empty");
    expect(gridPanelOf(html)).toContain("v2-qi-empty");
    expect(ledgerPanel(html)).toContain(CAVEAT_TEXT);
    expect(briefingPanel(html)).toContain(CAVEAT_TEXT);
    expect(gridPanelOf(html)).toContain(CAVEAT_TEXT);
  });
});

describe("qualityImpactSlide — Ledger (fan-out)", () => {
  it("renders two stacked tables: the strata table and the reasons table", () => {
    const html = preview(modelOf(THREE_STRATA, { lowQualityReasons: REASONS, lowQualityCount: 20, mediumQualityCount: 10 }));
    const ledger = ledgerPanel(html);
    expect(ledger).toContain('<div class="v2-lg-split stack">');
    expect(ledger).toContain("<th>المستوى</th><th>العيّنة</th><th>الدقة</th><th>الاشتباه الفائت</th>");
    expect(ledger).toContain("<th>أساس الاشتباه</th><th>كفاية البيانات</th>");
    expect(ledger).toContain("<th>السبب</th><th>العدد</th><th>النسبة</th>");
  });

  it("pools the totals row's accuracy from raw counts, never averaging the three strata's own percentages", () => {
    const html = preview(modelOf(UNEVEN_STRATA));
    const ledger = ledgerPanel(html);
    // Every stratum's own accuracy, unpooled.
    expect(ledger).toContain(">100.0%<");
    expect(ledger).toContain(">25.0%<");
    // Honest pooled totals-row figure: (10 + 10 + 20) / 100 = 40.0%.
    expect(ledger).toContain("<td>الإجمالي</td><td>100</td><td>40.0%</td>");
    // The naive average of 100.0%/100.0%/25.0% (75.0%) must NOT appear as the
    // totals-row accuracy.
    expect(ledger).not.toContain("<td>الإجمالي</td><td>100</td><td>75.0%</td>");
  });

  it("gives the reasons table a title matching the reasons card's own existing subtitle text", () => {
    const html = preview(
      modelOf(THREE_STRATA, { lowQualityReasons: REASONS, lowQualityCount: 20, mediumQualityCount: 10 }),
    );
    const ledger = ledgerPanel(html);
    // Same base (30), same phrasing, as reasonsPanel's own <small> subtitle.
    expect(ledger).toContain('<div class="v2-lg-table-card-title">من الصور منخفضة/متوسطة الجودة (30)</div>');
    expect(gridPanelOf(html)).toContain("<small>من الصور منخفضة/متوسطة الجودة (30)</small>");
  });
});

describe("qualityImpactSlide — Briefing (fan-out)", () => {
  it("keeps the three strata in FIXED عالي→متوسط→منخفض order even though sorting by accuracy would reorder them", () => {
    // عالي 40.0% (lowest), متوسط 90.0% (highest), منخفض 60.0% (middle) — not
    // sorted ascending or descending, so either sort direction would visibly
    // reorder these rows away from the fixed order.
    const html = preview(modelOf(NONSORTED_STRATA));
    const briefing = briefingPanel(html);
    const rankSection = briefing.slice(briefing.indexOf("v2-bf-rank"));
    const posHigh = rankSection.indexOf("40.0%");
    const posMid = rankSection.indexOf("90.0%");
    const posLow = rankSection.indexOf("60.0%");
    expect(posHigh).toBeGreaterThan(-1);
    expect(posMid).toBeGreaterThan(-1);
    expect(posLow).toBeGreaterThan(-1);
    expect(posHigh).toBeLessThan(posMid);
    expect(posMid).toBeLessThan(posLow);
    // Labels themselves are in the same fixed order too.
    const labelHigh = rankSection.indexOf(">عالي<");
    const labelMid = rankSection.indexOf(">متوسط<");
    const labelLow = rankSection.indexOf(">منخفض<");
    expect(labelHigh).toBeLessThan(labelMid);
    expect(labelMid).toBeLessThan(labelLow);
  });

  it("uses the accuracy gradient as the lede, mirroring trendPanel's own null gate when it's not publishable", () => {
    const thin = modelOf([
      ...strataRows("عالي", { correctClean: 17, correctSusp: 2, missedSusp: 1 }, "hi"),
      ...strataRows("متوسط", { correctClean: 15, correctSusp: 2, missedSusp: 2, excessSusp: 1 }, "md"),
      // n = 5 → "insufficient" → never rankable → accuracy null → gradient null.
      ...strataRows("منخفض", { correctClean: 2, correctSusp: 1, missedSusp: 2 }, "lo"),
    ]);
    const html = preview(thin);
    // Slot 0's own trendPanel gate renders the same "—" fallback for this model.
    expect(html).toContain('فارق عالي↔منخفض: <span class="insuff">—</span>');
    // Briefing's lede mirrors the SAME gate, not a parallel/looser one.
    const briefing = briefingPanel(html);
    expect(briefing).toContain("تدرّج الدقة — بيانات غير كافية لعالي أو منخفض الجودة");
    expect(briefing).toContain('<span class="insuff">—</span>');
  });

  it("prints the real signed gradient and the high/low figures when both ends are rankable", () => {
    const html = preview(modelOf(THREE_STRATA));
    const briefing = briefingPanel(html);
    // THREE_STRATA: عالي 95.0%, منخفض 70.0% → gradient +25.0.
    expect(briefing).toContain('<span dir="ltr">+25.0</span>');
    // The signed figure embedded in the label is ALSO bidi-isolated
    // (2026-07-28 fix, C4) — same dir="ltr" wrap as the standalone figure.
    expect(briefing).toContain(
      'تدرّج الدقة <span dir="ltr">+25.0</span> نقطة — عالي 95.0% مقابل منخفض 70.0%',
    );
  });

  it("Briefing body order is lede → support → rank, not lede → rank → support (2026-07-28 whole-branch-review fix, B1)", () => {
    const html = preview(modelOf(THREE_STRATA));
    const briefing = briefingPanel(html);
    const ledeIdx = briefing.indexOf('class="v2-bf-lede"');
    const supportIdx = briefing.indexOf('class="v2-totals-band"');
    const rankIdx = briefing.indexOf('class="v2-bf-rank ');
    expect(ledeIdx).toBeGreaterThan(-1);
    expect(supportIdx).toBeGreaterThan(-1);
    expect(rankIdx).toBeGreaterThan(-1);
    expect(ledeIdx).toBeLessThan(supportIdx);
    expect(supportIdx).toBeLessThan(rankIdx);
  });

  it("drops the reasons table entirely — one recall payload, not completeness", () => {
    const html = preview(
      modelOf(THREE_STRATA, { lowQualityReasons: REASONS, lowQualityCount: 20, mediumQualityCount: 10 }),
    );
    const briefing = briefingPanel(html);
    expect(briefing).not.toContain("أبرز أسباب انخفاض الجودة");
    expect(briefing).not.toContain("السبب");
    expect(briefing).not.toContain("تشويش في الصورة");
    // Confirms the reasons content genuinely exists elsewhere on the page (it
    // isn't just missing everywhere due to a fixture mistake).
    expect(ledgerPanel(html)).toContain("تشويش في الصورة");
    expect(gridPanelOf(html)).toContain("تشويش في الصورة");
  });

  it("reuses slot 0's totals band verbatim as the support strip", () => {
    const html = preview(modelOf(THREE_STRATA, { acceptableQualityRate: 88.8 }));
    const briefing = briefingPanel(html);
    expect(briefing).toContain("88.8%");
    expect(briefing).toContain("نسبة الجودة المقبولة");
  });
});

describe("qualityImpactSlide — Grid (fan-out)", () => {
  it("keeps a partially-insufficient stratum's real counts while nulling only its rate columns", () => {
    const thin = modelOf([
      ...strataRows("عالي", { correctClean: 17, correctSusp: 2, missedSusp: 1 }, "hi"),
      ...strataRows("متوسط", { correctClean: 15, correctSusp: 2, missedSusp: 2, excessSusp: 1 }, "md"),
      // n = 5 (insufficient), suspiciousBase = correctSusp(1) + missedSusp(2) = 3.
      ...strataRows("منخفض", { correctClean: 2, correctSusp: 1, missedSusp: 2 }, "lo"),
    ]);
    const html = preview(thin);
    const grid = gridPanelOf(html);
    // Screen-reader row: rate columns "—", count columns real (5 sample, 3 basis).
    expect(grid).toContain('<th scope="row">منخفض</th><td>—</td><td>—</td><td>5</td><td>3</td>');
  });

  it("renders one matrix beside the SAME reasons card, unchanged", () => {
    const html = preview(
      modelOf(THREE_STRATA, { lowQualityReasons: REASONS, lowQualityCount: 20, mediumQualityCount: 10 }),
    );
    const grid = gridPanelOf(html);
    expect(grid).toContain('<div class="v2-gd-split">');
    expect(grid).toContain("مصفوفة جودة الصورة");
    expect(grid).toContain("أبرز أسباب انخفاض الجودة");
    expect(grid).toContain("من الصور منخفضة/متوسطة الجودة (30)");
  });

  it("uses sequential-gold on all four columns, with the sample and basis columns on their own [0,max] domains", () => {
    const html = preview(modelOf(THREE_STRATA));
    const grid = gridPanelOf(html);
    expect(grid).toContain("الدقة");
    expect(grid).toContain("الاشتباه الفائت");
    expect(grid).toContain("العيّنة");
    expect(grid).toContain("أساس الاشتباه");
  });
});
