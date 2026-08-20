import { describe, expect, it } from "vitest";

import type { EmployeeAnswerFile, ItemAnswer } from "../../../../answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import type { SampleMasterData } from "../../../../sampling/sampleTypes";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import { buildReportModel } from "../../model/reportModel";
import type { ReportModel } from "../../model/reportModel";
import { RISK_ENGINE_CSS, engineVerdictOf, riskEngineAgreementSlide } from "./riskEngineAgreement";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Same pattern `levelAccuracy.test.ts`/`dailyTrend.test.ts` use: `employeeFiles`
// must be non-empty (with an answer keyed on `DEFAULT_EXEC_CONFIG.expertResultFieldId`)
// for `expertResult` to ever be non-null on a built row — an all-`employeeFiles: []`
// fixture silently exercises only the empty-state branch of this page (its
// headline row and the المستوى الثاني disagreement breakdown both key off
// `expertResult`). The numeric test below deliberately builds a model through
// `employeeFiles`, not a hand-shaped model literal, so it genuinely walks the
// populated branch.

type Verdict = "سليمة" | "اشتباه";

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الأول",
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
    levelOneEmployee: "E-100",
    levelTwoEmployee: "E-200",
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

/** A submitted reviewer answer carrying only the verdict field the report reads. */
function answerItem(xrayImageId: string, expert: Verdict): ItemAnswer {
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

function answerFile(items: ItemAnswer[]): EmployeeAnswerFile {
  return { username: "reviewer-1", monthFolderName: "5-May-2026", items };
}

/** A minimal, valid `SampleMasterData` carrying exactly the given rows as the
 *  drawn sample — same pattern `sourceAgreement.test.ts`'s `sampleOf` uses. */
function sampleOf(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: rows.length,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "2026-05-01T00:00:00.000Z",
    drawnBy: "admin",
    rows,
  };
}

function input(
  rows: PreparedPopulationRow[],
  files: EmployeeAnswerFile[] = [],
  sampledRows: PreparedPopulationRow[] | null = null,
): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows: rows,
    sample: sampledRows ? sampleOf(sampledRows) : null,
    distribution: null,
    employeeFiles: files,
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

function modelWith(
  rows: PreparedPopulationRow[],
  files: EmployeeAnswerFile[] = [],
  sampledRows: PreparedPopulationRow[] | null = null,
): ReportModel {
  return buildReportModel(input(rows, files, sampledRows));
}

// ── engineVerdictOf ─────────────────────────────────────────────────────────

describe("engineVerdictOf", () => {
  it("maps recognized affirmatives to اشتباه", () => {
    for (const v of ["نعم", "مستهدف", "Y", "YES", "TRUE", "1"]) {
      expect(engineVerdictOf(v)).toBe("اشتباه");
    }
  });

  it("maps recognized negatives to سليمة", () => {
    for (const v of ["لا", "غير مستهدف", "N", "NO", "FALSE", "0"]) {
      expect(engineVerdictOf(v)).toBe("سليمة");
    }
  });

  it("NEVER maps a blank to سليمة — blank means unknown", () => {
    expect(engineVerdictOf(null)).toBeNull();
    expect(engineVerdictOf("")).toBeNull();
    expect(engineVerdictOf("   ")).toBeNull();
  });

  it("maps an unrecognized value to null rather than guessing", () => {
    expect(engineVerdictOf("ربما")).toBeNull();
    expect(engineVerdictOf("xyz")).toBeNull();
  });

  it("ignores surrounding whitespace and case", () => {
    expect(engineVerdictOf("  yes  ")).toBe("اشتباه");
    expect(engineVerdictOf(" نعم ")).toBe("اشتباه");
  });
});

// ── riskEngineAgreementSlide ─────────────────────────────────────────────────

describe("riskEngineAgreementSlide", () => {
  it("renders the slide shell", () => {
    const html = riskEngineAgreementSlide(modelWith([popRow()]), 8, 20, false);
    expect(html).toContain('id="slide-s3-risk-engine"');
    expect(html).toContain('data-section="section3"');
  });

  it("prints the recognized / unrecognized / blank counts so the vocabulary is discoverable", () => {
    // Distinct counts per bucket (2/3/4, never equal) so this test cannot
    // pass with the buckets swapped — a 1/1/1 fixture can't tell "recognized
    // read as blank" apart from "blank read as recognized". Each count is
    // asserted against its OWN labelled `<b>N</b><small>LABEL` markup pair
    // (the exact shape `coverageBlock`'s `briefingSupport` call renders),
    // not merely "a number appears somewhere on the page".
    const rows = [
      // 2 recognized (one affirmative, one negative — both count toward
      // "recognized", never split by verdict).
      popRow({ xrayImageId: "R1", targetedByRiskEngine: "نعم" }),
      popRow({ xrayImageId: "R2", targetedByRiskEngine: "لا" }),
      // 3 unrecognized — non-blank values outside the known vocabulary.
      popRow({ xrayImageId: "U1", targetedByRiskEngine: "ربما" }),
      popRow({ xrayImageId: "U2", targetedByRiskEngine: "xyz" }),
      popRow({ xrayImageId: "U3", targetedByRiskEngine: "unknown-code" }),
      // 4 blank — null or whitespace-only.
      popRow({ xrayImageId: "B1", targetedByRiskEngine: null }),
      popRow({ xrayImageId: "B2", targetedByRiskEngine: "" }),
      popRow({ xrayImageId: "B3", targetedByRiskEngine: "   " }),
      popRow({ xrayImageId: "B4", targetedByRiskEngine: null }),
    ];
    const html = riskEngineAgreementSlide(modelWith(rows), 8, 20, false);
    expect(html).toContain("v2-re-coverage");
    expect(html).toContain("<b>2</b><small>قيم معروفة");
    expect(html).toContain("<b>3</b><small>قيم غير معروفة");
    expect(html).toContain("<b>4</b><small>بلا قيمة");
  });

  it("carries all three mandatory footnotes (2026-08-20 whole-branch-review fix)", () => {
    const html = riskEngineAgreementSlide(modelWith([popRow()]), 8, 20, false);
    expect(html).toContain("v2-re-caveat");
    // Scope footnote — reused verbatim from sourceAgreement.ts's SCOPE_FOOTNOTE
    // (Important 2: the headline row is sample-scoped, the rows beneath it
    // are population-scoped).
    expect(html).toContain(
      "المقارنات التي تشمل «المراجع» تقتصر على صور العيّنة المدروسة؛ وما عداها يشمل مجتمع الشهر كاملًا.",
    );
    // Level-axis footnote — المستوى الثاني means two different things on this
    // one page (Important 1).
    expect(html).toContain("معنى مختلف تمامًا لنفس الاسم");
    // The definitional-overlap caveat is now scoped explicitly to the
    // disagreement block, never to the agreement table above it.
    expect(html).toContain("مجموعة الاختلاف أدناه: المستوى الثاني هنا هو مستوى المخاطر");
  });

  it("renders an empty state when no row carries a usable engine value", () => {
    const html = riskEngineAgreementSlide(
      modelWith([popRow({ targetedByRiskEngine: null })]),
      8,
      20,
      false,
    );
    expect(html).toContain("v2-re-empty");
  });

  it("is deterministic", () => {
    const model = modelWith([popRow({ targetedByRiskEngine: "نعم" })]);
    expect(riskEngineAgreementSlide(model, 8, 20, false)).toBe(
      riskEngineAgreementSlide(model, 8, 20, false),
    );
  });

  it("ships scoped CSS", () => {
    expect(RISK_ENGINE_CSS).toContain(".v2-re-");
  });

  // ── The populated path, with real, non-zero, hand-checked numbers ──────────
  //
  // 22 rows, all with a RECOGNIZED engine value ("نعم" → اشتباه), split two ways:
  //   • 12 "المستوى الثاني" rows (raw alias "SECOND_STAG", matched through
  //     getStageKey — never a hard-coded canonical label, per the module's own
  //     stage-matching note): L1/L2 both سليمة (the level-2 definition — engine
  //     flagged, screening cleared). Reviewer verdict: 8 اشتباه (confirmed), 2
  //     سليمة (cleared), 2 unanswered (pending) → reviewed=10, confirmedRate=8/10=80%.
  //   • 10 rows carrying a محضر (hasReport=true): L1 اشتباه for 9/10, L2 اشتباه
  //     for 10/10, reviewer اشتباه for 9/10 → l1Rate=90%, l2Rate=100%, reviewRate=90%.
  //
  // Hand-computed month-wide agreement (block 1, over all 22 rows):
  //   • engine vs L1: agree=9 (only the 9 report rows with L1=اشتباه), n=22 → 9/22=40.9%
  //   • engine vs L2: agree=10 (all 10 report rows, L2=اشتباه), n=22 → 10/22=45.5%
  //   • engine vs المراجع (headline): comparable=20 (12 stage-2 minus 2 pending,
  //     plus 10 report rows, all answered), agree=8+9=17 → 17/20=85.0%
  type RowSpec = {
    id: string;
    stage: string;
    l1: Verdict;
    l2: Verdict;
    expert: Verdict | null;
    hasReport?: boolean;
  };

  const STAGE_TWO_ROWS: RowSpec[] = [
    { id: "S1", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "اشتباه" },
    { id: "S2", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "اشتباه" },
    { id: "S3", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "اشتباه" },
    { id: "S4", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "اشتباه" },
    { id: "S5", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "اشتباه" },
    { id: "S6", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "اشتباه" },
    { id: "S7", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "اشتباه" },
    { id: "S8", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "اشتباه" },
    { id: "S9", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "سليمة" },
    { id: "S10", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: "سليمة" },
    { id: "S11", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: null },
    { id: "S12", stage: "SECOND_STAG", l1: "سليمة", l2: "سليمة", expert: null },
  ];

  const REPORT_ROWS: RowSpec[] = [
    { id: "R1", stage: "FIRST_STAGE", l1: "سليمة", l2: "اشتباه", expert: "اشتباه", hasReport: true },
    { id: "R2", stage: "FIRST_STAGE", l1: "اشتباه", l2: "اشتباه", expert: "اشتباه", hasReport: true },
    { id: "R3", stage: "FIRST_STAGE", l1: "اشتباه", l2: "اشتباه", expert: "اشتباه", hasReport: true },
    { id: "R4", stage: "FIRST_STAGE", l1: "اشتباه", l2: "اشتباه", expert: "اشتباه", hasReport: true },
    { id: "R5", stage: "FIRST_STAGE", l1: "اشتباه", l2: "اشتباه", expert: "اشتباه", hasReport: true },
    { id: "R6", stage: "FIRST_STAGE", l1: "اشتباه", l2: "اشتباه", expert: "اشتباه", hasReport: true },
    { id: "R7", stage: "FIRST_STAGE", l1: "اشتباه", l2: "اشتباه", expert: "اشتباه", hasReport: true },
    { id: "R8", stage: "FIRST_STAGE", l1: "اشتباه", l2: "اشتباه", expert: "اشتباه", hasReport: true },
    { id: "R9", stage: "FIRST_STAGE", l1: "اشتباه", l2: "اشتباه", expert: "سليمة", hasReport: true },
    { id: "R10", stage: "FIRST_STAGE", l1: "اشتباه", l2: "اشتباه", expert: "اشتباه", hasReport: true },
  ];

  function buildNumericModel(): ReportModel {
    const specs = [...STAGE_TWO_ROWS, ...REPORT_ROWS];
    const rows: PreparedPopulationRow[] = [];
    const items: ItemAnswer[] = [];
    specs.forEach((spec, i) => {
      rows.push(
        popRow({
          xrayImageId: spec.id,
          stage: spec.stage,
          xrayLevelOneResult: spec.l1,
          xrayLevelTwoResult: spec.l2,
          targetedByRiskEngine: "نعم",
          reportNumber: spec.hasReport ? "MZ-1000" : null,
          sourceRowNumber: i + 1,
        }),
      );
      if (spec.expert !== null) items.push(answerItem(spec.id, spec.expert));
    });
    return modelWith(rows, [answerFile(items)]);
  }

  it("computes real, non-zero, hand-checked figures against a populated model — not the empty state", () => {
    const html = riskEngineAgreementSlide(buildNumericModel(), 8, 20, false);

    // Proves the POPULATED branch renders, not the empty state.
    expect(html).not.toContain("v2-re-empty");
    expect(html).toContain("v2-re-agree");
    expect(html).toContain("v2-re-disagree");
    expect(html).toContain("v2-re-report");

    // Block 1 — month-wide agreement, all three rows.
    expect(html).toContain("40.9%"); // engine vs المستوى الأول: 9/22
    expect(html).toContain("45.5%"); // engine vs المستوى الثاني: 10/22
    expect(html).toContain("85.0%"); // headline: engine vs المراجع: 17/20
    expect(html).toContain("v2-re-headline");

    // Block 2 — المستوى الثاني disagreement set: what the reviewer found.
    expect(html).toContain("80.0%"); // confirmedRate: 8/10 reviewed

    // Block 3 — محضر breakdown: what L1/L2/المراجع concluded.
    expect(html).toContain("90.0%"); // l1Rate 9/10 and reviewRate 9/10
    expect(html).toContain("100.0%"); // l2Rate 10/10
  });

  it("never lets a blank engine value dilute or inflate a rate's own denominator", () => {
    // 12 rows with a RECOGNIZED engine value that all agree with المستوى الأول
    // (n=12, agree=12 → 100%), plus 12 more rows with a BLANK engine value
    // whose المستوى الأول also happens to match what a (wrongly) blank-as-سليمة
    // mapping would predict. If engineVerdictOf ever mapped blank to سليمة,
    // these 12 rows would silently join the denominator and n would read 24
    // instead of 12 — this is the page-level guard for the unit-level rule
    // already proven above.
    const rows: PreparedPopulationRow[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push(popRow({ xrayImageId: `Y${i}`, targetedByRiskEngine: "نعم", xrayLevelOneResult: "اشتباه" }));
    }
    for (let i = 0; i < 12; i++) {
      rows.push(popRow({ xrayImageId: `Z${i}`, targetedByRiskEngine: "   ", xrayLevelOneResult: "سليمة" }));
    }
    const html = riskEngineAgreementSlide(modelWith(rows), 8, 20, false);
    expect(html).toContain("100.0%"); // L1 agreement stays 100%, never diluted
    expect(html).toContain("<td>12</td>"); // n stays 12
    expect(html).not.toContain("<td>24</td>"); // never doubles from the blank rows
  });

  // ── Important 3 (2026-08-20 whole-branch-review fix) ───────────────────────
  //
  // The unreviewed remainder of the المستوى الثاني set used to be labelled
  // «بلا حكم مراجع بعد» ("no reviewer verdict YET") for every row lacking
  // `expertResult` — including rows never drawn into the studied sample at
  // all, which by design can never carry a reviewer verdict and are not
  // "pending" anything. This fixture puts one stage-2 row IN the sample
  // (genuinely awaiting review) and one OUTSIDE it (never drawn), so the two
  // must be counted and labelled separately.
  it('splits the unreviewed المستوى الثاني remainder into "outside the sample" vs "sampled, awaiting review" — never a blanket "not yet"', () => {
    const inSampleRow = popRow({
      xrayImageId: "P-IN",
      stage: "SECOND_STAG",
      targetedByRiskEngine: "نعم",
    });
    const outsideSampleRow = popRow({
      xrayImageId: "P-OUT",
      stage: "SECOND_STAG",
      targetedByRiskEngine: "نعم",
    });
    const html = riskEngineAgreementSlide(
      modelWith([inSampleRow, outsideSampleRow], [], [inSampleRow]),
      8,
      20,
      false,
    );

    // The old, misleading "not yet" label for the WHOLE remainder must be gone.
    expect(html).not.toContain("بلا حكم مراجع بعد");
    // The genuinely-pending, in-sample row gets its own honest label and count.
    expect(html).toContain("<b>1</b><small>ضمن العيّنة، بانتظار إجابة المراجع");
    // The never-sampled row is disclosed in the block's own subtitle, scoped
    // to the population total, not folded into "pending review".
    expect(html).toContain(
      "إجمالي صور مجتمع الشهر: 2؛ خارج العيّنة المدروسة (لم تُسحب أصلًا): 1.",
    );
  });
});
