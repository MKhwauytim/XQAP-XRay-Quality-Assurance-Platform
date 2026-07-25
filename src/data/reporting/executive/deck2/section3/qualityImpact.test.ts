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

  it("renders one body in production and four variant panels in preview", () => {
    const model = modelOf(THREE_STRATA);
    expect(occurrences(render(model, false), "v2-qi-tiles")).toBe(1);
    const preview = render(model, true);
    expect(occurrences(preview, "v2-qi-tiles")).toBe(4);
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
    expect(render(inverted)).toContain('فارق عالي↔منخفض: <span dir="ltr">-15.0</span> نقطة');
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
