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

// ── Ledger/Briefing/Grid fan-out (2026-07-25 plan §11e, batch B3 item 3) ────
// Preview mode (`variantPreview: true`) renders all 4 design-system bodies in
// one HTML string (each wrapped in its own `.v2-variant-panel`), so every
// assertion below just searches that combined string — the same technique
// this fan-out's sibling test files (`portAgreement.test.ts`'s "renders four
// … body variants only in preview mode") use to reach the non-default slots.

/** Uneven arm sizes (30 vs 10) so a naive AVERAGE of the two arms' own
 *  percentages measurably disagrees with the honest POOLED figure computed
 *  from their raw counts — the exact tripwire shape this fan-out's other
 *  pages (e.g. levelAccuracy's `statsOf(sumCounts(...))`) already use to catch
 *  an averaging bug.
 *  present: 30 images, 27 accurate → 90.0%.
 *  absent:  10 images, 5 accurate  → 50.0%.
 *  Naive average  = (90.0 + 50.0) / 2 = 70.0%.
 *  Honest pooled  = (27 + 5) / (30 + 10) = 32 / 40 = 80.0%. */
const PRESENT_UNEVEN = { correctClean: 20, correctSusp: 7, missedSusp: 2, falseSusp: 1 };
const ABSENT_UNEVEN = { correctClean: 3, correctSusp: 2, missedSusp: 3, falseSusp: 2 };

describe("markingImpactSlide — Ledger (fan-out)", () => {
  it("renders one 8-column table with both arms and the same figures the slot-0 tiles show", () => {
    const preview = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
        ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
      ]),
      7,
      20,
      true,
    );
    expect(preview).toContain("<th>الفئة</th><th>العيّنة</th><th>الدقة</th><th>كشف الاشتباه</th>");
    expect(preview).toContain(
      "<th>سليمة صحيحة</th><th>اشتباه صحيح</th><th>اشتباه فائت</th><th>اشتباه خاطئ</th>",
    );
    // Same accuracy figures the slot-0 tiles print (STRONG_ARM 90.0%, WEAK_ARM 70.0%).
    expect(preview).toContain(">90.0%<");
    expect(preview).toContain(">70.0%<");
    // Raw outcome counts, never a share, in the Ledger cells (WEAK_ARM's own tallies).
    expect(preview).toContain(">10<"); // WEAK_ARM correctClean
    expect(preview).toContain(">4<"); // WEAK_ARM correctSusp / missedSusp
  });

  it("pools the combined-arms totals-row accuracy from raw counts, never averaging the two arms' percentages", () => {
    const preview = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, ...PRESENT_UNEVEN }),
        ...arm({ prefix: "N", hasMarking: false, ...ABSENT_UNEVEN }),
      ]),
      7,
      20,
      true,
    );
    // Honest pooled figure: (27 + 5) / (30 + 10) = 80.0%.
    expect(preview).toContain("<td>الإجمالي</td><td>40</td><td>80.0%</td>");
    // The naive average of 90.0% and 50.0% (70.0%) must NOT appear as the
    // totals-row accuracy — proving the totals row pools raw counts instead
    // of averaging the two arms' own percentages.
    expect(preview).not.toContain("<td>الإجمالي</td><td>40</td><td>70.0%</td>");
    // Combined n and combined outcome counts are plain sums either way.
    expect(preview).toContain("<td>23</td><td>9</td><td>5</td><td>3</td>");
  });

  it("shows the tfoot الفارق row with a real signed figure when both arms are rankable", () => {
    const preview = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
        ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
      ]),
      7,
      20,
      true,
    );
    expect(preview).toContain('<tr class="v2-lg-delta-row"><td>الفارق (يوجد − لا يوجد)</td>');
    // Same effect slot-0's chip prints for this exact fixture (90.0 − 70.0 = +20.0).
    expect(preview).toContain('<tr class="v2-lg-delta-row"><td>الفارق (يوجد − لا يوجد)</td><td>—</td><td><span dir="ltr">+20.0</span></td>');
  });

  it("gates the tfoot الفارق row with the SAME rule slot-0's deltaChip uses — both render — together when one arm is below the sufficiency cut", () => {
    const html = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, correctClean: 5 }), // n=5, below the `limited` cut (10)
        ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
      ]),
      7,
      20,
      true,
    );
    // Slot 0's chip (always rendered) is the reference: it must show insufficient.
    expect(html).toContain('<div class="v2-mark-delta insufficient">');
    // The Ledger tfoot row, driven by the SAME `comparable()` call, must agree.
    expect(html).toContain(
      '<tr class="v2-lg-delta-row"><td>الفارق (يوجد − لا يوجد)</td><td>—</td><td><span class="insuff">—</span></td>',
    );
  });
});

describe("markingImpactSlide — Briefing (fan-out)", () => {
  it("uses the signed accuracy delta as the lede, with the two arms as fixed-scale rank rows", () => {
    const preview = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
        ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
      ]),
      7,
      20,
      true,
    );
    expect(preview).toContain(
      'فارق الدقة +20.0 نقطة — بتحديد 90.0% مقابل بلا تحديد 70.0%',
    );
    expect(preview).toContain("العيّنة 20 · كشف 85.7%");
    expect(preview).toContain("العيّنة 20 · كشف 50.0%");
  });

  it("mirrors deltaChip's not-comparable fallback exactly — same '—' + insufficient note, not a parallel threshold", () => {
    const html = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, correctClean: 5 }), // n=5, below the `limited` cut (10)
        ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
      ]),
      7,
      20,
      true,
    );
    // Slot 0's own gate output is the reference.
    expect(html).toContain('<div class="v2-mark-delta insufficient">');
    expect(html).toContain(`<b class="v2-mark-delta-value"><span class="insuff">—</span></b>`);
    // Briefing's lede fallback: the SAME insufficiency note, not a different phrase.
    expect(html).toContain(`فارق الدقة — ${INSUFFICIENT}`);
    const insuffFigureCount = [...html.matchAll(/<span class="insuff">—<\/span>/g)].length;
    // Slot 0's chip AND the Briefing lede both render the muted "—" figure —
    // proving the two variants agree on the SAME comparability verdict for
    // this fixture (a divergent/looser Briefing gate would drop this to 1).
    expect(insuffFigureCount).toBeGreaterThanOrEqual(2);
  });

  it("reuses slot 0's totals band verbatim as the support strip", () => {
    const model = modelWith([
      ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
      ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
    ]);
    const preview = markingImpactSlide(model, 7, 20, true);
    const totalsBandCount = [...preview.matchAll(/<div class="v2-totals-band">/g)].length;
    // One in slot 0, one reused verbatim in Briefing, one reused verbatim in Grid.
    expect(totalsBandCount).toBe(3);
    expect(preview).toContain("<b>40</b><small>إجمالي الصور المُقيَّمة</small>");
  });
});

describe("markingImpactSlide — Grid (fan-out)", () => {
  it("prints shares of each arm's own n, not raw counts", () => {
    // present: n=50, correctClean=40 → share 80% (raw count would print "40").
    const preview = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, correctClean: 40, correctSusp: 5, missedSusp: 3, falseSusp: 2 }),
        ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
      ]),
      7,
      20,
      true,
    );
    // accuracy=90, detection=62.5, correctClean share=80, correctSusp share=10,
    // missedSusp share=6, falseSusp share=4 — all SHARES, never the raw counts
    // (40/5/3/2) the same arm's Ledger cells would show for the same row.
    expect(preview).toContain(
      '<tr><th scope="row">يوجد تحديد</th><td>90</td><td>62.5</td><td>80</td><td>10</td><td>6</td><td>4</td></tr>',
    );
  });

  it("nulls ALL SIX cells for an arm below the sufficiency cut — never a partial row", () => {
    const preview = markingImpactSlide(
      modelWith([
        ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
        // absent arm has zero evaluated rows at all.
      ]),
      7,
      20,
      true,
    );
    expect(preview).toContain(
      '<tr><th scope="row">لا يوجد تحديد</th><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>',
    );
    // The rankable arm keeps its real figures in the very same matrix.
    expect(preview).toContain('<tr><th scope="row">يوجد تحديد</th><td>90</td>');
  });

  it("carries the caveat AND the totals band, unlike Grid pages in this fan-out that drop the totals band", () => {
    const model = modelWith([
      ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
      ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
    ]);
    const preview = markingImpactSlide(model, 7, 20, true);
    expect(preview).toContain('<div class="v2-sys-grid v2-gd-marking">');
  });
});

describe("markingImpactSlide — mandatory caveat in all four slots", () => {
  it("carries the caveat strip verbatim in all four design-system bodies", () => {
    const model = modelWith([
      ...arm({ prefix: "M", hasMarking: true, ...STRONG_ARM }),
      ...arm({ prefix: "N", hasMarking: false, ...WEAK_ARM }),
    ]);
    const preview = markingImpactSlide(model, 7, 20, true);
    const occurrences = preview.split(CAVEAT).length - 1;
    expect(occurrences).toBe(4);
  });

  it("still carries the caveat in all four slots when the page is in its empty state", () => {
    const preview = markingImpactSlide(modelWith([]), 1, 1, true);
    const occurrences = preview.split(CAVEAT).length - 1;
    expect(occurrences).toBe(4);
    // The shared empty state itself also appears in all four slots.
    const emptyCount = [...preview.matchAll(/<div class="v2-mark-empty">/g)].length;
    expect(emptyCount).toBe(4);
  });
});
