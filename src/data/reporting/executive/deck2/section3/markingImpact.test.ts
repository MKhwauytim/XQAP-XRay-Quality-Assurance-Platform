// src/data/reporting/executive/deck2/section3/markingImpact.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput, ExecutiveReportRow } from "../../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { buildReportModel } from "../../model/reportModel";
import type { ReportModel } from "../../model/reportModel";
import { MARKING_IMPACT_CSS, markingImpactSlide } from "./markingImpact";

// ── Fixtures (deck2.test.ts style) ──────────────────────────────────────────

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
    hasMarking: null,
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

/**
 * Build one marking arm with an exact outcome-class composition, so accuracy
 * (= (correctClean + correctSusp) / n) and detection (= correctSusp /
 * (correctSusp + missedSusp)) are known constants the assertions can name.
 */
function arm(opts: {
  prefix: string;
  hasMarking: boolean | null;
  correctClean: number;
  correctSusp?: number;
  missedSusp?: number;
  falseSusp?: number;
}): ExecutiveReportRow[] {
  const { prefix, hasMarking } = opts;
  const spec: Array<[ExecutiveReportRow["verificationCategory"], number, boolean]> = [
    ["correct-clean", opts.correctClean, true],
    ["correct-suspicious", opts.correctSusp ?? 0, true],
    ["missed-suspicious", opts.missedSusp ?? 0, false],
    // NOTE the enum: the ROW type calls the false-alarm class "excess-suspicious"
    // (the fact table's DecisionRecord calls the same idea "false-suspicion").
    ["excess-suspicious", opts.falseSusp ?? 0, false],
  ];
  const rows: ExecutiveReportRow[] = [];
  let i = 0;
  for (const [category, count, accurate] of spec) {
    for (let k = 0; k < count; k += 1) {
      i += 1;
      rows.push(
        reportRow({
          xrayImageId: `${prefix}-${i}`,
          hasMarking,
          verificationCategory: category,
          imageResultAccurate: accurate,
        }),
      );
    }
  }
  return rows;
}

/** A real ReportModel with its `rows` replaced — the page reads nothing else. */
function modelWith(rows: ExecutiveReportRow[]): ReportModel {
  return { ...buildReportModel(input([popRow()])), rows };
}

/** 20 images, 18 accurate → 90.0%; detection 6/(6+1) → 85.7%. */
const STRONG_ARM = { correctClean: 12, correctSusp: 6, missedSusp: 1, falseSusp: 1 };
/** 20 images, 14 accurate → 70.0%; detection 4/(4+4) → 50.0%. */
const WEAK_ARM = { correctClean: 10, correctSusp: 4, missedSusp: 4, falseSusp: 2 };

const CAVEAT = "مقارنة وصفية بين مجموعتين غير متكافئتين؛ لا تُثبت أثرًا سببيًا للتحديد.";
const INSUFFICIENT = "بيانات غير كافية للمقارنة";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("markingImpactSlide — slide shell", () => {
  it("renders the section-3 shell with the agreed id, section, title and subhead", () => {
    const html = markingImpactSlide(modelWith([]), 12, 24, false);
    expect(html).toContain('id="slide-s3-marking"');
    expect(html).toContain('data-section="section3"');
    expect(html).toContain('data-title="أثر وجود التحديد على الدقة"');
    expect(html).toContain("القسم 3 — التحاليل المتقدمة");
    expect(html).toContain("مقارنة دقة القرارات في الصور التي يوجد بها تحديد مقابل التي لا يوجد بها.");
    expect(html).toContain("12 / 24");
  });

  it("always carries the descriptive-comparison caveat, in every data state", () => {
    const empty = markingImpactSlide(modelWith([]), 1, 1, false);
    const full = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
        ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
      ]),
      1,
      1,
      false,
    );
    expect(empty).toContain(CAVEAT);
    expect(full).toContain(CAVEAT);
    // Never worded as a causal claim.
    expect(full).not.toContain("يحسّن");
    expect(full).not.toContain("يرفع الدقة");
  });

  it("renders only one body in production and four identical panels in preview", () => {
    const model = modelWith(arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }));
    expect(markingImpactSlide(model, 1, 1, false)).not.toContain('<div class="v2-variant-stack"');
    const preview = markingImpactSlide(model, 1, 1, true);
    const panels = [...preview.matchAll(/<div class="v2-variant-panel(?: active)?" data-variant-index="\d"/g)];
    expect(panels.length).toBe(4);
  });
});

describe("markingImpactSlide — no marking record at all", () => {
  // The realistic cause: the inspection template's «هل يوجد تحديد» field is
  // missing or was renamed, so `hasMarking` folds to null on every row.
  const rows = [
    ...arm({ prefix: "U", hasMarking: null, correctClean: 8, correctSusp: 2, missedSusp: 1, falseSusp: 1 }),
    // Not evaluated at all (no reviewer verdict) — out of scope for every figure.
    reportRow({ xrayImageId: "SKIP-1", hasMarking: true, verificationCategory: null, imageResultAccurate: null }),
    reportRow({ xrayImageId: "SKIP-2", hasMarking: false, verificationCategory: null, imageResultAccurate: null }),
  ];
  const html = markingImpactSlide(modelWith(rows), 5, 20, false);

  it("shows a single honest Arabic empty state instead of comparison tiles", () => {
    expect(html).toContain('<div class="v2-mark-empty">');
    expect(html).toContain("لا يوجد سجل لحالة التحديد في صور هذا الشهر");
    expect(html).toContain("«هل يوجد تحديد»");
    expect(html).not.toContain('<div class="v2-mark-compare">');
    expect(html).not.toContain('class="v2-risk-tile green"');
  });

  it("never fabricates a rate: no NaN, no 0%, no difference figure", () => {
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("0.0%");
    expect(html).not.toContain("نقطة مئوية");
    expect(html).not.toMatch(/\d+(\.\d+)?%/);
  });

  it("reports the markUnknown count as images with no marking record", () => {
    // 12 evaluated rows, all of them unrecorded; the two unevaluated rows are excluded.
    expect(html).toContain("<b>12</b><small>إجمالي الصور المُقيَّمة</small>");
    expect(html).toContain("<b>0</b><small>صور لها سجل لحالة التحديد</small>");
    expect(html).toContain("<b>12</b><small>صور بلا سجل لحالة التحديد</small>");
  });
});

describe("markingImpactSlide — both strata populated", () => {
  const html = markingImpactSlide(
    modelWith([
      ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
      ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
      ...arm({ prefix: "U", hasMarking: null, correctClean: 3 }),
    ]),
    7,
    20,
    false,
  );

  it("computes each arm's accuracy at IMAGE grain (n is never doubled)", () => {
    // 20 rows per arm — a decision-grain fold would have printed العيّنة 40.
    expect(html).toContain("<b>العيّنة 20</b>");
    expect(html).not.toContain("<b>العيّنة 40</b>");
    expect(html).toContain("<b>90.0%</b><span>دقة قرارات الفحص</span>");
    expect(html).toContain("<b>70.0%</b><span>دقة قرارات الفحص</span>");
  });

  it("renders the signed effect in percentage points", () => {
    expect(html).toContain('<div class="v2-mark-delta">');
    expect(html).toContain('<span dir="ltr">+20.0</span> نقطة مئوية');
    expect(html).not.toContain(INSUFFICIENT);
  });

  it("signs the effect negatively when the marked arm is the weaker one", () => {
    const flipped = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, ...WEAK_ARM }),
        ...arm({ prefix: "N", hasMarking: false, ...STRONG_ARM }),
      ]),
      7,
      20,
      false,
    );
    expect(flipped).toContain('<span dir="ltr">−20.0</span> نقطة مئوية');
  });

  it("prints the per-arm detection rate through the denominator-gated helper", () => {
    expect(html).toContain("<b>85.7%</b><small>كشف الاشتباه</small>");
    expect(html).toContain("<b>50.0%</b><small>كشف الاشتباه</small>");
  });

  it("renders a 100%-stacked outcome bar per arm plus one shared legend", () => {
    const bars = [...html.matchAll(/<div class="v2-prop-bar">/g)];
    expect(bars.length).toBe(2);
    expect(html).toContain('<div class="v2-prop-seg green" style="width:60.000%">');
    expect(html).toContain('<div class="v2-prop-seg coral" style="width:20.000%">');
    const legends = [...html.matchAll(/<div class="v2-prop-legend">/g)];
    expect(legends.length).toBe(1);
    expect(html).toContain("سليمة صحيحة");
    expect(html).toContain("اشتباه فائت");
    expect(html).toContain("اشتباه خاطئ");
  });

  it("reports the totals band including the markUnknown count", () => {
    expect(html).toContain("<b>43</b><small>إجمالي الصور المُقيَّمة</small>");
    expect(html).toContain("<b>40</b><small>صور لها سجل لحالة التحديد</small>");
    expect(html).toContain("<b>3</b><small>صور بلا سجل لحالة التحديد</small>");
  });

  it("emits no NaN anywhere", () => {
    expect(html).not.toContain("NaN");
  });
});

describe("markingImpactSlide — sufficiency suppression", () => {
  // 5 images in the marked arm is below the `limited` cut (10), so no figure
  // derived from it — including the difference — may be published.
  const html = markingImpactSlide(
    modelWith([
      ...arm({ prefix: "M", hasMarking: true, correctClean: 5 }),
      ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
    ]),
    7,
    20,
    false,
  );

  it("suppresses the difference figure and says so in Arabic", () => {
    expect(html).toContain('<div class="v2-mark-delta insufficient">');
    expect(html).toContain(INSUFFICIENT);
    expect(html).not.toContain("نقطة مئوية");
  });

  it("still prints both counts", () => {
    expect(html).toContain("<b>العيّنة 5</b>");
    expect(html).toContain("<b>العيّنة 20</b>");
    expect(html).toContain("<small>العيّنة 5</small>");
    expect(html).toContain("<small>العيّنة 20</small>");
  });

  it("shows the under-cut arm as — rather than a flattering 100%", () => {
    expect(html).toContain('<b><span class="insuff">—</span></b>');
    expect(html).not.toContain("100.0%");
    // ...while the sufficient arm keeps its figure.
    expect(html).toContain("<b>70.0%</b><span>دقة قرارات الفحص</span>");
  });

  it("suppresses the under-cut arm's composition bar too", () => {
    const bars = [...html.matchAll(/<div class="v2-prop-bar">/g)];
    expect(bars.length).toBe(1);
    expect(html).toContain('<div class="v2-prop-bar v2-mark-bar-empty">');
  });

  it("renders — instead of a rate when an arm has no evaluated images at all", () => {
    const oneSided = markingImpactSlide(
      modelWith(arm({ prefix: "M", hasMarking: true, ...STRONG_ARM })),
      7,
      20,
      false,
    );
    expect(oneSided).toContain("<b>العيّنة 0</b>");
    expect(oneSided).toContain("لا توجد صور مُقيَّمة");
    expect(oneSided).toContain(INSUFFICIENT);
    expect(oneSided).not.toContain("NaN");
  });
});

describe("markingImpactSlide — purity", () => {
  it("is deterministic: same model in, byte-identical HTML out", () => {
    const rows = [
      ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
      ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
      ...arm({ prefix: "U", hasMarking: null, correctClean: 3 }),
    ];
    const a = markingImpactSlide(modelWith(rows), 7, 20, false);
    const b = markingImpactSlide(modelWith(rows), 7, 20, false);
    expect(a).toBe(b);
    expect(a).not.toContain("undefined");
  });

  it("exports page-scoped CSS with no raw hex color literals", () => {
    expect(MARKING_IMPACT_CSS).toContain(".v2-mark-layout");
    expect(MARKING_IMPACT_CSS).toContain(".v2-mark-delta");
    expect(MARKING_IMPACT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
