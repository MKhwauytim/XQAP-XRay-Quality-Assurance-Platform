// src/data/reporting/executive/deck2/fanoutB2b.test.ts
//
// Tests for batch B2b of the deck2 three-system fan-out (docs/superpowers/specs/
// 2026-07-25-deck2-fanout-remaining-pages-plan.md §11a/§11b/§11c):
// slide-s3-workload, slide-s3-level-accuracy, slide-s3-port-agreement —
// "mechanical clones" of the port-population exemplar, each with its own
// correctness risk the plan calls out explicitly:
//   - s3-workload: Briefing ranks by WORKLOAD (not accuracy), in the page's
//     OWN existing land-then-sea concatenation order — it must NEVER re-sort,
//     unlike every other rank list in this fan-out. The CAVEAT strip must be
//     verbatim in all three new slots (Ledger/Briefing/Grid), not just one.
//   - s3-level-accuracy: الفارق is a genuinely SIGNED delta. Briefing sorts by
//     |delta| desc among rankable ports, tones each row green (positive) or
//     coral (negative) while always also printing the sign, and Grid's
//     diverging column needs a REVERSED domain [+m,-m] so a positive delta
//     (level 2 more accurate) tints GREEN — the exact polarity is verified
//     against real rendered fill colors, not just the domain array shape.
//   - s3-port-agreement: six Ledger columns, two different denominators
//     (population for اتفاق المستويين, sample for the two مطابقة columns)
//     that must never be visually conflated — Briefing's support strip labels
//     must say «على العيّنة» against the lede's «على المجتمع», and Grid drops
//     المجتمع as a column (it's column 1's denominator) while disclosing both
//     bases in the panel head sub instead.
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput, ExecutiveReportRow } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import type { EmployeeAnswerFile, ItemAnswer } from "../../../answers/answerTypes";
import { buildReportModel } from "../model/reportModel";
import type { ReportModel } from "../model/reportModel";
import { band } from "../model/dataSufficiency";
import type { KeyedAccuracy } from "../model/aggregates";
import { workloadAccuracyPageBuilders, workloadAccuracySlideBuilders } from "./section3/workloadAccuracy";
import { levelAccuracySlideBuilders } from "./section3/levelAccuracy";
import { portAgreementSlideBuilders } from "./section3/portAgreement";
import { fmtNum, fmtPct } from "../primitives";

/** Isolate one variant panel's HTML (data-variant-index="N" up to the next
 *  panel, or end-of-string for panel 3) — same technique fanoutB2a.test.ts /
 *  deck2.test.ts use. */
function panelSlice(html: string, index: 0 | 1 | 2 | 3): string {
  const start = html.indexOf(`data-variant-index="${index}"`);
  expect(start).toBeGreaterThan(-1);
  if (index === 3) return html.slice(start);
  const end = html.indexOf(`data-variant-index="${index + 1}"`);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

// ═══════════════════════════════════════════════════════════════════════════
// slide-s3-workload (fan-out plan §11a)
// ═══════════════════════════════════════════════════════════════════════════

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
    selectedInSample: false,
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

/** A real model (so every untouched field is realistic) with `rows` swapped
 *  for a controlled fixture — same technique fanoutB2a.test.ts uses. */
function modelWithAccuracy(rows: ExecutiveReportRow[], portAccuracy: KeyedAccuracy[]): ReportModel {
  return { ...buildReportModel(input([popRow()])), rows, portAccuracy };
}

function rate(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

type Counts = {
  evaluable: number;
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
};

function portAcc(key: string, c: Counts): KeyedAccuracy {
  const reviewerSuspicious = c.correctSuspicion + c.missedSuspicion;
  return {
    key,
    ...c,
    accuracyByDecision: rate(c.correctClean + c.correctSuspicion, c.evaluable),
    detectionRate: rate(c.correctSuspicion, reviewerSuspicious),
    missedSuspicionRateByDecision: rate(c.missedSuspicion, reviewerSuspicious),
    suspicionDecisionAccuracy: rate(c.correctSuspicion, c.correctSuspicion + c.falseSuspicion),
    falseSuspicionRate: rate(c.falseSuspicion, c.correctClean + c.falseSuspicion),
    band: band(c.evaluable),
  };
}

/** N population rows at one port (drives workload/land-sea, not accuracy). */
function workloadRows(port: string, portType: string, count: number, idPrefix: string): ExecutiveReportRow[] {
  return Array.from({ length: count }, (_, i) =>
    reportRow({ xrayImageId: `${idPrefix}-${i}`, portName: port, portType }),
  );
}

const WORKLOAD_CAVEAT = "ارتباط وصفي بين الحجم والدقة، لا يُقرأ كعلاقة سببية.";

// slide-s3-workload's Ledger/Briefing/Grid fan-out (this describe block's
// original §11a coverage) was REMOVED 2026-08-19 when the page was reworked
// into a correlation view (deviation-from-month-mean strip) and shipped
// disabled by default — see task-7 of
// .superpowers/sdd/2026-08-19-executive-report-section3-analytics/ and
// `SHOW_WORKLOAD_ACCURACY_SLIDE` in section3/workloadAccuracy.ts. Maintaining
// three separate hand-tuned designs for a page nobody currently sees was not
// a good use of the rework, so all four variant slots now render the SAME
// body (`[body, body, body, body]`) — the fan-out is deliberately collapsed,
// not forgotten. These tests assert that collapsed shape instead of three
// divergent designs; the old Ledger/Briefing/Grid-specific assertions
// (ordinal badges, workload-sorted rank list, the C3/2026-07-28 fold-order
// regression, the sequential-gold Grid matrix, foldRemainder's pooled-not-
// averaged accuracy) no longer apply because those systems no longer exist
// on this page.
describe("workloadAccuracySlideBuilders — single-variant body (2026-08-19 rework, dormant page)", () => {
  // منفذ أ (land, 10 rows → workload 10): accuracy 90%, rankable.
  // منفذ ب (sea, 50 rows → workload 50, THE BUSIEST): only 5 evaluable →
  // insufficient → NOT rankable, so its accuracy must render "—", never a
  // fabricated rate.
  function fixtureModel(): ReportModel {
    const rows = [
      ...workloadRows("منفذ أ", "منفذ بري", 10, "A"),
      ...workloadRows("منفذ ب", "منفذ بحري", 50, "B"),
    ];
    const portAccuracy: KeyedAccuracy[] = [
      portAcc("منفذ أ", { evaluable: 20, correctClean: 10, correctSuspicion: 8, missedSuspicion: 1, falseSuspicion: 1 }),
      portAcc("منفذ ب", { evaluable: 5, correctClean: 5, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 }),
    ];
    return modelWithAccuracy(rows, portAccuracy);
  }

  it("renders the identical body in all four variant slots", () => {
    const html = workloadAccuracyPageBuilders(fixtureModel(), true)[0](6, 20);
    // Bound the slice at the `.v2-wl-layout` wrapper's OWN closing `</div>`
    // (right after the caveat paragraph's `</p>`, the last thing the body
    // template renders) rather than at end-of-panel-slice: `panelSlice` for
    // the LAST index (3) runs to end-of-string (picking up v2Slide's own
    // trailing chrome — page-foot, `</section>`), while indices 0-2 instead
    // pick up the next panel's opening `<div class="v2-variant-panel"` prefix
    // — two different kinds of trailing junk that would otherwise make an
    // untrimmed comparison fail even though the four bodies are byte-identical.
    const bodyOf = (idx: 0 | 1 | 2 | 3) => {
      const panel = panelSlice(html, idx);
      const start = panel.indexOf('<div class="v2-wl-layout">');
      const afterCaveat = panel.indexOf("</p>", start) + "</p>".length;
      const closeIdx = panel.indexOf("</div>", afterCaveat) + "</div>".length;
      return panel.slice(start, closeIdx);
    };
    expect(bodyOf(0)).toBe(bodyOf(1));
    expect(bodyOf(1)).toBe(bodyOf(2));
    expect(bodyOf(2)).toBe(bodyOf(3));
    // The body is the real page content, not an empty stub — land/sea tables,
    // the deviation strip, and the mandatory caveat all present.
    expect(bodyOf(0)).toContain("v2-port-split");
    expect(bodyOf(0)).toContain("v2-wa-dev");
    expect(bodyOf(0)).toContain(WORKLOAD_CAVEAT);
  });

  it("the ungated page builder still renders full content while the flag is false — dormant, not deleted", () => {
    const builders = workloadAccuracyPageBuilders(fixtureModel(), false);
    expect(builders.length).toBeGreaterThan(0);
    expect(builders[0](1, 1)).toContain('id="slide-s3-workload"');
  });

  it("workloadAccuracySlideBuilders (the gated entry point) contributes nothing to the deck", () => {
    expect(workloadAccuracySlideBuilders(fixtureModel(), false)).toHaveLength(0);
  });

  it("empty state is shared verbatim across all four slots", () => {
    const html = workloadAccuracyPageBuilders(modelWithAccuracy([], []), true)[0](1, 1);
    for (const idx of [0, 1, 2, 3] as const) {
      expect(panelSlice(html, idx)).toContain("لا توجد بيانات منافذ لهذا الشهر");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// slide-s3-level-accuracy (fan-out plan §11b)
// ═══════════════════════════════════════════════════════════════════════════

type Verdict = "سليمة" | "اشتباه";

function levelPopRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return popRow({ levelOneEmployee: "E-100", levelTwoEmployee: "E-200", ...overrides });
}

function levelAnswerItem(xrayImageId: string, expert: Verdict): ItemAnswer {
  return {
    xrayImageId,
    templateId: "T-1",
    templateVersion: 1,
    answers: [{ fieldId: DEFAULT_EXEC_CONFIG.expertResultFieldId, value: expert }],
    lastSavedAt: "2026-05-10T00:00:00.000Z",
    submittedAt: "2026-05-10T00:00:00.000Z",
    answeredBy: "reviewer-1",
    status: "submitted",
  };
}

function levelAnswerFile(items: ItemAnswer[]): EmployeeAnswerFile {
  return { username: "reviewer-1", monthFolderName: "5-May-2026", items };
}

type PortSpec = {
  name: string;
  portType: string;
  images: Array<{ l1: Verdict; l2: Verdict; expert: Verdict | null }>;
};

function buildLevelModelWithAnswers(ports: PortSpec[]): ReportModel {
  const rows: PreparedPopulationRow[] = [];
  const items: ItemAnswer[] = [];
  let seq = 0;
  for (const port of ports) {
    for (const img of port.images) {
      seq += 1;
      const id = `XR-${seq}`;
      rows.push(
        levelPopRow({
          xrayImageId: id,
          portName: port.name,
          portType: port.portType,
          portCode: `P-${port.name}`,
          xrayLevelOneResult: img.l1,
          xrayLevelTwoResult: img.l2,
          sourceRowNumber: seq,
        }),
      );
      if (img.expert !== null) items.push(levelAnswerItem(id, img.expert));
    }
  }
  return buildReportModel({
    ...input(rows),
    employeeFiles: items.length > 0 ? [levelAnswerFile(items)] : [],
  });
}

/** N images where every level agrees with the reviewer's «سليمة». */
function cleanImages(n: number): PortSpec["images"] {
  return Array.from({ length: n }, () => ({ l1: "سليمة" as Verdict, l2: "سليمة" as Verdict, expert: "سليمة" as Verdict }));
}

describe("levelAccuracySlideBuilders — Ledger/Briefing/Grid (fan-out plan §11b, batch B2b)", () => {
  it("(a) Ledger: no chart, ordinal badges, five columns, deltaSpan kept for the signed figure", () => {
    const html = levelAccuracySlideBuilders(buildLevelModelWithAnswers([{ name: "منفذ ألف", portType: "منفذ بري", images: cleanImages(20) }]), true)[0](1, 1);
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain("v2-sys-ledger");
    expect(panel1).toContain("v2-lg-level-accuracy");
    expect(panel1).not.toContain("<figure");
    expect(panel1).toContain('<span class="v2-lg-idx">1</span>منفذ ألف');
    for (const th of ["<th>المنفذ</th>", "<th>دقة المستوى الأول</th>", "<th>دقة المستوى الثاني</th>", "الفارق", "<th>العيّنة</th>"]) {
      expect(panel1).toContain(th);
    }
    expect(panel1).toContain("v2-lvlacc-delta");
  });

  it("(b) Briefing: mixed positive/negative deltas — sorted by |الفارق| desc, per-row tone green/coral, sign always printed", () => {
    // منفذ عالي: level 2 MORE accurate than level 1 (positive delta, +40.0).
    //   20 images: level1 correct on 12 (60%, 8 false-suspicion errors),
    //   level2 correct on all 20 (100%).
    // منفذ منخفض: level 2 LESS accurate than level 1 (negative delta, -25.0).
    //   20 images: level1 correct on all 20 (100%), level2 correct on 15
    //   (75%, 5 false-suspicion errors).
    const model = buildLevelModelWithAnswers([
      {
        name: "منفذ عالي",
        portType: "منفذ بري",
        images: [
          ...Array.from({ length: 12 }, () => ({ l1: "سليمة" as Verdict, l2: "سليمة" as Verdict, expert: "سليمة" as Verdict })),
          ...Array.from({ length: 8 }, () => ({ l1: "اشتباه" as Verdict, l2: "سليمة" as Verdict, expert: "سليمة" as Verdict })),
        ],
      },
      {
        name: "منفذ منخفض",
        portType: "منفذ بحري",
        images: [
          ...Array.from({ length: 15 }, () => ({ l1: "سليمة" as Verdict, l2: "سليمة" as Verdict, expert: "سليمة" as Verdict })),
          ...Array.from({ length: 5 }, () => ({ l1: "سليمة" as Verdict, l2: "اشتباه" as Verdict, expert: "سليمة" as Verdict })),
        ],
      },
    ]);
    const html = levelAccuracySlideBuilders(model, true)[0](1, 1);
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain("v2-sys-brief");
    expect(panel2).toContain("v2-bf-level-accuracy");

    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(labels[0]).toBeDefined();
    // Whichever port has the larger |delta| ranks first — verify by tone/sign
    // rather than assuming which fixture number wins, since the exact
    // percentages depend on the counts above.
    const numSpans = [...panel2.matchAll(/<span class="v2-bf-rank-num[^"]*">/g)];
    expect(numSpans.length).toBeGreaterThanOrEqual(2);

    // One row's tone class is "green" (positive delta) and the other "coral"
    // (negative delta) — never the same tone for both, and the sign is
    // printed either way (never colour alone).
    const toneClasses = [...panel2.matchAll(/<span class="v2-bf-rank-num (\w+)">/g)].map((m) => m[1]);
    expect(toneClasses).toContain("green");
    expect(toneClasses).toContain("coral");
    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    // Every printed delta carries an explicit +/− sign inside its <span dir="ltr">.
    for (const v of values) {
      expect(v).toMatch(/^<span dir="ltr">[+−]/);
    }
  });

  it("(c) Briefing: an unrankable port (evaluable below the sufficiency cut) is excluded from ranking and folded into a bar-less remainder", () => {
    const model = buildLevelModelWithAnswers([
      { name: "منفذ كبير", portType: "منفذ بري", images: cleanImages(20) },
      // Only 5 evaluable → insufficient → NOT rankable.
      { name: "منفذ صغير", portType: "منفذ بحري", images: cleanImages(5) },
    ]);
    const html = levelAccuracySlideBuilders(model, true)[0](1, 1);
    const panel2 = panelSlice(html, 2);
    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(labels).toContain("منافذ دون حد الكفاية (1)");
    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values[values.length - 1]).toBe("—");
    const widths = [...panel2.matchAll(/class="v2-bf-rank-fill \w+" style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
    expect(widths[widths.length - 1]).toBe(0); // bar-less
  });

  it("(d) Grid: reversed-domain diverging column — positive delta tints GREEN, negative tints CORAL (P0's contract, verified against actual rendered fill colors)", () => {
    // منفذ موجب: delta = +40 (level 2 correct on all 20, level 1 correct on 12).
    // منفذ سالب: delta = -40 (level 1 correct on all 20, level 2 correct on 12).
    const model = buildLevelModelWithAnswers([
      {
        name: "منفذ موجب",
        portType: "منفذ بري",
        images: [
          ...Array.from({ length: 12 }, () => ({ l1: "سليمة" as Verdict, l2: "سليمة" as Verdict, expert: "سليمة" as Verdict })),
          ...Array.from({ length: 8 }, () => ({ l1: "اشتباه" as Verdict, l2: "سليمة" as Verdict, expert: "سليمة" as Verdict })),
        ],
      },
      {
        name: "منفذ سالب",
        portType: "منفذ بري",
        images: [
          ...Array.from({ length: 12 }, () => ({ l1: "سليمة" as Verdict, l2: "سليمة" as Verdict, expert: "سليمة" as Verdict })),
          ...Array.from({ length: 8 }, () => ({ l1: "سليمة" as Verdict, l2: "اشتباه" as Verdict, expert: "سليمة" as Verdict })),
        ],
      },
    ]);
    const html = levelAccuracySlideBuilders(model, true)[0](1, 1);
    const panel3 = panelSlice(html, 3);
    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-level-accuracy");
    for (const label of ["دقة الأول", "دقة الثاني", "الفارق", "العيّنة"]) {
      expect(panel3).toContain(label);
    }
    // Both rows are land, so they land in the SAME panel (single <figure>).
    // Both ports tie on evaluable (20), so `collectLevelAccuracyRows`'s
    // name-ascending (plain code-unit, not localeCompare) tiebreak decides
    // row order: "س" (U+0633) < "م" (U+0645), so منفذ سالب sorts BEFORE منفذ
    // موجب. Extract the tone sequence of ONLY the diverging column's fills by
    // relying on metricMatrix's own per-cell fill emission order (row-major,
    // one cell per column per row) and the fact this panel's other 3 columns
    // are sequential-gold (var(--gold)), so every var(--green)/var(--coral)
    // fill in this panel belongs to الفارق.
    const toneSequence = [...panel3.matchAll(/fill="var\(--(green|coral)\)" fill-opacity="[\d.]+"/g)].map((m) => m[1]);
    expect(toneSequence).toEqual(["coral", "green"]); // سالب (-40) coral, موجب (+40) green
  });

  it("(e) mandatory prose: no severity vocabulary and the inspection-axis disambiguation carry into all four slots", () => {
    const html = levelAccuracySlideBuilders(buildLevelModelWithAnswers([{ name: "منفذ ألف", portType: "منفذ بري", images: cleanImages(20) }]), true)[0](1, 1);
    for (const idx of [0, 1, 2, 3] as const) {
      const panel = panelSlice(html, idx);
      for (const word of ["منخفض", "متوسط", "مرتفع", "حرج"]) {
        expect(panel).not.toContain(word);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// slide-s3-port-agreement (fan-out plan §11c)
// ═══════════════════════════════════════════════════════════════════════════

type Result = "سليمة" | "اشتباه";

function agreePortRows(opts: {
  port: string;
  portType?: string;
  count: number;
  idPrefix: string;
  levelOne?: (i: number) => Result;
  levelTwo?: (i: number) => Result;
}): PreparedPopulationRow[] {
  const out: PreparedPopulationRow[] = [];
  for (let i = 0; i < opts.count; i++) {
    out.push(
      popRow({
        xrayImageId: `${opts.idPrefix}-${i + 1}`,
        portName: opts.port,
        portCode: opts.idPrefix,
        portType: opts.portType ?? "منفذ بري",
        xrayLevelOneResult: opts.levelOne ? opts.levelOne(i) : "سليمة",
        xrayLevelTwoResult: opts.levelTwo ? opts.levelTwo(i) : "سليمة",
        sourceRowNumber: i + 1,
      }),
    );
  }
  return out;
}

function agreeAnswerFile(verdicts: Array<[string, Result]>): EmployeeAnswerFile {
  return {
    username: "reviewer-1",
    monthFolderName: "5-May-2026",
    items: verdicts.map(([xrayImageId, value]) => ({
      xrayImageId,
      templateId: "t",
      templateVersion: 1,
      answers: [{ fieldId: "qualityImageResult", value }],
      lastSavedAt: "2026-05-10T00:00:00.000Z",
      submittedAt: "2026-05-10T00:00:00.000Z",
      answeredBy: "reviewer-1",
      status: "submitted" as const,
    })),
  };
}

function agreeModel(populationRows: PreparedPopulationRow[], employeeFiles: EmployeeAnswerFile[] = []): ReportModel {
  return buildReportModel({ ...input(populationRows), employeeFiles });
}

const SCOPE_NOTE_SNIPPET = "الأساسان مختلفان";

describe("portAgreementSlideBuilders — Ledger/Briefing/Grid (fan-out plan §11c, batch B2b)", () => {
  it("(a) Ledger: keeps ALL SIX columns + ordinal badges, and the .v2-lg-agree squeeze CSS is tighter than the default Ledger port-card sizing (no unscoped inherit-and-hope)", () => {
    const model = agreeModel(agreePortRows({ port: "منفذ أ", count: 12, idPrefix: "A" }));
    const html = portAgreementSlideBuilders(model, true)[0](1, 1);
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain("v2-sys-ledger");
    expect(panel1).toContain("v2-lg-agree");
    expect(panel1).not.toContain("<figure");
    expect(panel1).toContain('<span class="v2-lg-idx">1</span>منفذ أ');
    for (const th of [
      "<th>المنفذ</th>",
      "<th>اتفاق المستويين</th>",
      "<th>المجتمع</th>",
      "<th>مطابقة الأول للمراجع</th>",
      "<th>مطابقة الثاني للمراجع</th>",
      "<th>العيّنة</th>",
    ]) {
      expect(panel1).toContain(th);
    }
    expect(panel1).toContain(SCOPE_NOTE_SNIPPET);
  });

  it("(a2) the 6-column squeeze is actually scoped and actually tighter than the Ledger default (structural verification of the CSS shipped for this page)", async () => {
    const { PORT_AGREEMENT_CSS } = await import("./section3/portAgreement");
    expect(PORT_AGREEMENT_CSS).toContain(".v2-lg-agree .v2-lg-port-card .deck-table th");
    expect(PORT_AGREEMENT_CSS).toContain(".v2-lg-agree .v2-lg-port-card .deck-table td");
    expect(PORT_AGREEMENT_CSS).toContain(".v2-lg-agree .v2-lg-port-card.compact");
    // Base Ledger card (theme.ts): th/td padding 9px 12px, font .78rem. The
    // squeeze must be strictly narrower on both axes for both base and
    // compact tiers, or the 6th column will not fit a half-width card.
    const thBlock = PORT_AGREEMENT_CSS.match(/\.v2-lg-agree \.v2-lg-port-card \.deck-table th\{([^}]*)\}/);
    expect(thBlock).toBeTruthy();
    const fontMatch = thBlock?.[1].match(/font-size:([\d.]+)rem/);
    expect(fontMatch).toBeTruthy();
    expect(Number(fontMatch?.[1])).toBeLessThan(0.78);
    const padMatch = thBlock?.[1].match(/padding:(\d+)px (\d+)px/);
    expect(padMatch).toBeTruthy();
    expect(Number(padMatch?.[2])).toBeLessThan(12); // horizontal padding narrower than the 12px default
    expect(PORT_AGREEMENT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("(b) Briefing: lede is on the POPULATION basis, support strip's two match-rate items are explicitly labelled على العيّنة", () => {
    // 12 images at the port; only 10 carry a reviewer verdict — so المجتمع
    // (12) and العيّنة (10) genuinely differ, the exact scenario the basis
    // labels must not blur.
    const rows = agreePortRows({
      port: "منفذ بري أ",
      count: 12,
      idPrefix: "A",
      levelTwo: (i) => (i < 3 ? "اشتباه" : "سليمة"),
    });
    const verdicts: Array<[string, Result]> = [];
    for (let i = 0; i < 10; i++) verdicts.push([`A-${i + 1}`, i < 3 ? "اشتباه" : "سليمة"]);
    const html = portAgreementSlideBuilders(agreeModel(rows, [agreeAnswerFile(verdicts)]), true)[0](1, 1);
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain("v2-sys-brief");
    expect(panel2).toContain("v2-bf-agree");

    // Lede: 9/12 = 75.0% — the POPULATION basis, explicitly stated.
    expect(panel2).toContain(`اتفاق المستويين ${fmtPct(75)} — ${fmtNum(9)} من ${fmtNum(12)} صورة`);
    expect(panel2).toContain("أساس المجتمع");
    // Support strip: both match-rate items say على العيّنة, distinguishing
    // them from the lede's أساس المجتمع.
    expect(panel2).toContain("مطابقة الأول (على العيّنة)");
    expect(panel2).toContain("مطابقة الثاني (على العيّنة)");
    expect(panel2).toContain(SCOPE_NOTE_SNIPPET);
  });

  it("(c) Briefing: an unrankable port is excluded from ranking and folded into a bar-less remainder, pooled from summed counts", () => {
    const model = agreeModel([
      // 12 comparable → band "limited" → rankable.
      ...agreePortRows({ port: "منفذ كبير", count: 12, idPrefix: "BIG" }),
      // 5 comparable → band "insufficient" → NOT rankable.
      ...agreePortRows({ port: "منفذ صغير", count: 5, idPrefix: "SML" }),
    ]);
    const html = portAgreementSlideBuilders(model, true)[0](1, 1);
    const panel2 = panelSlice(html, 2);
    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(labels).toContain("منافذ دون حد الكفاية (1)");
    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values[values.length - 1]).toBe("—");
  });

  it("(c2) C3 regression: rank rows sort by agreement rate ASCENDING (disagreement-first) — the fold buckets the HIGHEST-agreement (least noteworthy) ports, never a land/sea artifact", () => {
    // 10 land ports, L1 always EQUALS L2 (100% agreement — boring, deserves
    // to be folded) + 8 sea ports, L1 always DIFFERS from L2 (0% agreement —
    // total disagreement, must stay named). 18 ports total, past
    // briefingRankPlan's 14-row no-fold cap → 13 named + 5 folded. Pre-fix,
    // the raw land-then-sea concatenation put all 10 (boring, 100%-agree)
    // land ports first, so the tail-sliced fold would have caught the 5
    // LEAST-agreeing (most important) sea ports instead of 5 boring land
    // ports — exactly the bug this test is built to catch.
    const landRows = Array.from({ length: 10 }, (_, i) =>
      agreePortRows({
        port: `منفذ ل${i + 1}`,
        portType: "منفذ بري",
        count: 12,
        idPrefix: `L${i + 1}`,
        levelOne: () => "سليمة",
        levelTwo: () => "سليمة", // L1 === L2 always → 100% agreement
      }),
    ).flat();
    const seaRows = Array.from({ length: 8 }, (_, i) =>
      agreePortRows({
        port: `منفذ ب${i + 1}`,
        portType: "منفذ بحري",
        count: 12,
        idPrefix: `S${i + 1}`,
        levelOne: () => "سليمة",
        levelTwo: () => "اشتباه", // L1 !== L2 always → 0% agreement
      }),
    ).flat();
    const model = agreeModel([...landRows, ...seaRows]);
    const html = portAgreementSlideBuilders(model, true)[0](1, 1);
    const panel2 = panelSlice(html, 2);

    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    // Every sea port (0% agreement, most disagreement) must have its OWN
    // named row — none of these may be folded away.
    for (let i = 1; i <= 8; i++) expect(labels).toContain(`منفذ ب${i}`);
    // Only 5 of the 10 (100%-agreement, tied) land ports may be folded; the
    // other 5 still get named rows alongside all 8 sea ports (13 named total
    // + 1 "بقية المنافذ" remainder row = 14 label spans).
    expect(labels.length).toBe(14);
    expect(labels).toContain("بقية المنافذ (5)");
    const landNamedCount = labels.filter((l) => l.startsWith("منفذ ل")).length;
    expect(landNamedCount).toBe(5);
  });

  it("(d) Grid: only FOUR columns (المجتمع dropped — it's column 1's denominator), both bases disclosed in the panel sub", () => {
    const model = agreeModel(agreePortRows({ port: "منفذ أ", count: 12, idPrefix: "A" }));
    const html = portAgreementSlideBuilders(model, true)[0](1, 1);
    const panel3 = panelSlice(html, 3);
    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-agree");
    for (const label of ["اتفاق المستويين", "مطابقة الأول", "مطابقة الثاني", "العيّنة"]) {
      expect(panel3).toContain(label);
    }
    // المجتمع never appears as its own column label in the Grid panel (only
    // disclosed in the panel sub-text, alongside العيّنة).
    expect(panel3).toContain("اتفاق المستويين على المجتمع، والمطابقة على العيّنة");
    expect(panel3).toContain(SCOPE_NOTE_SNIPPET);
  });

  it("(e) mandatory SCOPE_NOTE carries verbatim into all four body variants", () => {
    const model = agreeModel(agreePortRows({ port: "منفذ أ", count: 12, idPrefix: "A" }));
    const html = portAgreementSlideBuilders(model, true)[0](1, 1);
    for (const idx of [0, 1, 2, 3] as const) {
      expect(panelSlice(html, idx)).toContain(SCOPE_NOTE_SNIPPET);
    }
  });
});
