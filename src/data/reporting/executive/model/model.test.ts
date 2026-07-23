import { describe, expect, it } from "vitest";

import type { ExecutiveReportRow } from "../../executiveReportTypes";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import {
  buildDecisionRecords,
  buildImageComparisons,
  classifyOutcome,
} from "./decisionFactTable";
import type { ImageResultComparison, ResultSource, ResultValue } from "./decisionFactTable";
import { band, isRankable } from "./dataSufficiency";
import { buildAggregates, buildCrossTeamMatrix } from "./aggregates";
import { buildReportModel } from "./reportModel";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";

const PERIOD = "مايو 2026";

function reportRow(overrides: Partial<ExecutiveReportRow> = {}): ExecutiveReportRow {
  return {
    xrayImageId: "XR-1",
    portCode: "P1",
    portName: "منفذ الاختبار",
    portType: "منفذ بري",
    movementType: "بري",
    stage: "المستوى الثاني",
    levelOneEmployeeId: "E-100",
    levelTwoEmployeeId: "E-200",
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: true,
    assignedTo: "reviewer-1",
    distributionStatus: "completed",
    expertResult: "سليمة",
    imageAvailable: true,
    noImageReason: null,
    hasMarking: true,
    imageQuality: "عالي",
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

describe("classifyOutcome — master §9 truth table", () => {
  it("clean / clean → correct-clean", () => {
    expect(classifyOutcome("سليمة", "سليمة")).toBe("correct-clean");
  });
  it("susp / susp → correct-suspicion", () => {
    expect(classifyOutcome("اشتباه", "اشتباه")).toBe("correct-suspicion");
  });
  it("clean / susp → missed-suspicion", () => {
    expect(classifyOutcome("سليمة", "اشتباه")).toBe("missed-suspicion");
  });
  it("susp / clean → false-suspicion", () => {
    expect(classifyOutcome("اشتباه", "سليمة")).toBe("false-suspicion");
  });
  it("null reviewer → null (not evaluable)", () => {
    expect(classifyOutcome("سليمة", null)).toBeNull();
    expect(classifyOutcome("اشتباه", null)).toBeNull();
  });
});

describe("buildDecisionRecords — fact-table explosion", () => {
  it("explodes each row into exactly two records (L1 + L2)", () => {
    const records = buildDecisionRecords([reportRow(), reportRow({ xrayImageId: "XR-2" })], PERIOD);
    expect(records).toHaveLength(4);
    expect(records.filter((r) => r.decisionLevel === "LEVEL_1")).toHaveLength(2);
    expect(records.filter((r) => r.decisionLevel === "LEVEL_2")).toHaveLength(2);
  });

  it("same employee at both levels still yields two distinct records", () => {
    const records = buildDecisionRecords(
      [reportRow({ levelOneEmployeeId: "E-SAME", levelTwoEmployeeId: "E-SAME" })],
      PERIOD
    );
    expect(records).toHaveLength(2);
    expect(records[0].decisionLevel).toBe("LEVEL_1");
    expect(records[1].decisionLevel).toBe("LEVEL_2");
    expect(records[0].inspectorId).toBe("E-SAME");
    expect(records[1].inspectorId).toBe("E-SAME");
    expect(records[0]).not.toBe(records[1]);
  });

  it("scores L1 and L2 independently against the reviewer", () => {
    // L1 says clean, L2 says suspicion, reviewer says suspicion.
    const records = buildDecisionRecords(
      [reportRow({ levelOneResult: "سليمة", levelTwoResult: "اشتباه", expertResult: "اشتباه" })],
      PERIOD
    );
    const l1 = records.find((r) => r.decisionLevel === "LEVEL_1")!;
    const l2 = records.find((r) => r.decisionLevel === "LEVEL_2")!;
    expect(l1.outcomeClass).toBe("missed-suspicion");
    expect(l2.outcomeClass).toBe("correct-suspicion");
  });

  it("maps reviewer (assignedTo) and inspector (levelXEmployeeId) onto separate fields", () => {
    const [l1] = buildDecisionRecords([reportRow()], PERIOD);
    expect(l1.inspectorId).toBe("E-100");
    expect(l1.reviewerId).toBe("reviewer-1");
    expect(l1.periodId).toBe(PERIOD);
  });
});

describe("decisionEvaluable rule (master §9)", () => {
  it("evaluable when image present + reviewer result + inspector id", () => {
    const [l1] = buildDecisionRecords([reportRow()], PERIOD);
    expect(l1.decisionEvaluable).toBe(true);
  });

  it("not evaluable when reviewer result missing", () => {
    const records = buildDecisionRecords([reportRow({ expertResult: null })], PERIOD);
    expect(records.every((r) => r.decisionEvaluable === false)).toBe(true);
  });

  it("not evaluable when image missing", () => {
    const records = buildDecisionRecords([reportRow({ imageAvailable: false })], PERIOD);
    expect(records.every((r) => r.decisionEvaluable === false)).toBe(true);
  });

  it("not evaluable for a level whose inspector id is null", () => {
    const records = buildDecisionRecords([reportRow({ levelOneEmployeeId: null })], PERIOD);
    const l1 = records.find((r) => r.decisionLevel === "LEVEL_1")!;
    const l2 = records.find((r) => r.decisionLevel === "LEVEL_2")!;
    expect(l1.decisionEvaluable).toBe(false);
    expect(l2.decisionEvaluable).toBe(true);
  });
});

describe("buildImageComparisons", () => {
  it("carries all six sources per image", () => {
    const [cmp] = buildImageComparisons([
      reportRow({
        levelOneResult: "سليمة",
        levelTwoResult: "اشتباه",
        expertResult: "اشتباه",
        otherResults: {
          manual: { result: "اشتباه", employeeId: null },
          opposite: { result: "سليمة", employeeId: "OP-1" },
          liveMeans: { result: null, employeeId: null },
        },
      }),
    ]);
    expect(cmp.results).toEqual({
      levelOne: "سليمة",
      levelTwo: "اشتباه",
      manual: "اشتباه",
      opposite: "سليمة",
      liveMeans: null,
      review: "اشتباه",
    });
  });

  it("sets agreesWithReview only when both source and reviewer have a result", () => {
    const [cmp] = buildImageComparisons([
      reportRow({
        levelOneResult: "اشتباه",
        levelTwoResult: "سليمة",
        expertResult: "اشتباه",
        otherResults: {
          manual: { result: "اشتباه", employeeId: null },
          opposite: { result: null, employeeId: null },
          liveMeans: { result: null, employeeId: null },
        },
      }),
    ]);
    expect(cmp.agreesWithReview.levelOne).toBe(true);
    expect(cmp.agreesWithReview.levelTwo).toBe(false);
    expect(cmp.agreesWithReview.manual).toBe(true);
    expect(cmp.agreesWithReview.opposite).toBeNull(); // opposite has no result
    expect(cmp.agreesWithReview.liveMeans).toBeNull();
  });

  it("agreesWithReview is null for every source when reviewer has no result", () => {
    const [cmp] = buildImageComparisons([
      reportRow({
        expertResult: null,
        otherResults: {
          manual: { result: "اشتباه", employeeId: null },
          opposite: { result: "سليمة", employeeId: null },
          liveMeans: { result: null, employeeId: null },
        },
      }),
    ]);
    expect(cmp.agreesWithReview.levelOne).toBeNull();
    expect(cmp.agreesWithReview.manual).toBeNull();
  });
});

describe("dataSufficiency bands — boundaries (0, 9, 10, 19, 20)", () => {
  it("0 → none", () => expect(band(0)).toBe("none"));
  it("1 → insufficient", () => expect(band(1)).toBe("insufficient"));
  it("9 → insufficient", () => expect(band(9)).toBe("insufficient"));
  it("10 → limited", () => expect(band(10)).toBe("limited"));
  it("19 → limited", () => expect(band(19)).toBe("limited"));
  it("20 → sufficient", () => expect(band(20)).toBe("sufficient"));
  it("respects config-overridden thresholds", () => {
    expect(band(5, { insufficient: 1, limited: 5, sufficient: 50 })).toBe("limited");
    expect(band(50, { insufficient: 1, limited: 5, sufficient: 50 })).toBe("sufficient");
  });
  it("isRankable only for limited/sufficient", () => {
    expect(isRankable("none")).toBe(false);
    expect(isRankable("insufficient")).toBe(false);
    expect(isRankable("limited")).toBe(true);
    expect(isRankable("sufficient")).toBe(true);
  });
});

describe("aggregates — cross-team agreement counted only when both present", () => {
  it("reviewer-agreement comparable counts only images where both have a result", () => {
    const rows = [
      // manual agrees with reviewer
      reportRow({
        xrayImageId: "A",
        expertResult: "اشتباه",
        otherResults: {
          manual: { result: "اشتباه", employeeId: null },
          opposite: { result: null, employeeId: null },
          liveMeans: { result: null, employeeId: null },
        },
      }),
      // manual disagrees with reviewer
      reportRow({
        xrayImageId: "B",
        expertResult: "سليمة",
        otherResults: {
          manual: { result: "اشتباه", employeeId: null },
          opposite: { result: null, employeeId: null },
          liveMeans: { result: null, employeeId: null },
        },
      }),
      // manual has no result → not comparable
      reportRow({
        xrayImageId: "C",
        expertResult: "اشتباه",
        otherResults: {
          manual: { result: null, employeeId: null },
          opposite: { result: null, employeeId: null },
          liveMeans: { result: null, employeeId: null },
        },
      }),
    ];
    const comparisons = buildImageComparisons(rows);
    const records = buildDecisionRecords(rows, PERIOD);
    const agg = buildAggregates(records, comparisons, DEFAULT_EXEC_CONFIG);
    const manual = agg.reviewerAgreement.find((r) => r.source === "manual")!;
    expect(manual.comparable).toBe(2);
    expect(manual.agree).toBe(1);
    expect(manual.disagree).toBe(1);
    expect(manual.agreementRate).toBe(50);
    expect(manual.teamFlaggedReviewerClean).toBe(1); // image B
  });

  it("cross-team matrix includes L1 vs L2 and counts only comparable images", () => {
    const rows = [
      reportRow({ xrayImageId: "A", levelOneResult: "سليمة", levelTwoResult: "سليمة" }),
      reportRow({ xrayImageId: "B", levelOneResult: "اشتباه", levelTwoResult: "سليمة" }),
    ];
    const comparisons = buildImageComparisons(rows);
    const agg = buildAggregates(buildDecisionRecords(rows, PERIOD), comparisons, DEFAULT_EXEC_CONFIG);
    const l1l2 = agg.crossTeamMatrix.find(
      (c) => c.sourceA === "levelOne" && c.sourceB === "levelTwo"
    )!;
    expect(l1l2.comparable).toBe(2); // both L1/L2 always present
    expect(l1l2.agree).toBe(1);
    expect(l1l2.disagree).toBe(1);
  });

  it("agreement rate is null (—) when no comparable images", () => {
    const rows = [
      reportRow({
        expertResult: "اشتباه",
        otherResults: {
          manual: { result: null, employeeId: null },
          opposite: { result: null, employeeId: null },
          liveMeans: { result: null, employeeId: null },
        },
      }),
    ];
    const agg = buildAggregates(
      buildDecisionRecords(rows, PERIOD),
      buildImageComparisons(rows),
      DEFAULT_EXEC_CONFIG
    );
    const manual = agg.reviewerAgreement.find((r) => r.source === "manual")!;
    expect(manual.comparable).toBe(0);
    expect(manual.agreementRate).toBeNull();
  });
});

describe("buildCrossTeamMatrix — single-pass rewrite exact equivalence (perf B2)", () => {
  // Independent "naive" oracle — a verbatim copy of the pre-optimization
  // per-pair full-array-scan algorithm (15 separate scans of `comparisons`,
  // one per source pair). Deliberately NOT imported from aggregates.ts: the
  // point is to prove the production single-pass rewrite (one pass over
  // `comparisons`, accumulating a Map<"sourceA|sourceB", {comparable,agree}>,
  // then materializing the 15 cells) produces byte-for-byte identical output
  // to the old approach — not merely that it is internally self-consistent.
  const REFERENCE_SOURCES: ResultSource[] = [
    "levelOne",
    "levelTwo",
    "manual",
    "opposite",
    "liveMeans",
    "review",
  ];

  function referenceRate(num: number, den: number): number | null {
    return den > 0 ? (num / den) * 100 : null;
  }

  function referenceCrossTeamMatrix(comparisons: ImageResultComparison[]): Array<{
    sourceA: ResultSource;
    sourceB: ResultSource;
    comparable: number;
    agree: number;
    disagree: number;
    agreementRate: number | null;
  }> {
    const cells: Array<{
      sourceA: ResultSource;
      sourceB: ResultSource;
      comparable: number;
      agree: number;
      disagree: number;
      agreementRate: number | null;
    }> = [];
    for (let i = 0; i < REFERENCE_SOURCES.length; i++) {
      for (let j = i + 1; j < REFERENCE_SOURCES.length; j++) {
        const sourceA = REFERENCE_SOURCES[i];
        const sourceB = REFERENCE_SOURCES[j];
        let comparable = 0;
        let agree = 0;
        for (const img of comparisons) {
          const a = img.results[sourceA];
          const b = img.results[sourceB];
          if (a === null || b === null) continue;
          comparable += 1;
          if (a === b) agree += 1;
        }
        cells.push({
          sourceA,
          sourceB,
          comparable,
          agree,
          disagree: comparable - agree,
          agreementRate: referenceRate(agree, comparable),
        });
      }
    }
    return cells;
  }

  const RESULT_CYCLE: (ResultValue | null)[] = ["سليمة", "اشتباه", null];

  function buildFixtureComparisons(count: number): ImageResultComparison[] {
    return Array.from({ length: count }, (_, idx) => {
      const results = {} as Record<ResultSource, ResultValue | null>;
      REFERENCE_SOURCES.forEach((source, sIdx) => {
        results[source] = RESULT_CYCLE[(idx + sIdx * 2) % RESULT_CYCLE.length];
      });
      return {
        xrayImageId: `FIX-${idx}`,
        portName: idx % 2 === 0 ? "منفذ أ" : "منفذ ب",
        results,
        agreesWithReview: {},
      };
    });
  }

  it("matches the naive reference implementation on a varied fixture (nulls + agree + disagree mixed)", () => {
    const comparisons = buildFixtureComparisons(25);
    const actual = buildCrossTeamMatrix(comparisons);
    const expected = referenceCrossTeamMatrix(comparisons);
    expect(actual).toHaveLength(15); // C(6,2) source pairs
    expect(actual).toEqual(expected);
  });

  it("matches the naive reference on an empty comparisons array", () => {
    expect(buildCrossTeamMatrix([])).toEqual(referenceCrossTeamMatrix([]));
  });

  it("matches the naive reference when every source is null (nothing comparable)", () => {
    const allNull: ImageResultComparison[] = [
      {
        xrayImageId: "N-1",
        portName: null,
        results: {
          levelOne: null,
          levelTwo: null,
          manual: null,
          opposite: null,
          liveMeans: null,
          review: null,
        },
        agreesWithReview: {},
      },
    ];
    const actual = buildCrossTeamMatrix(allNull);
    expect(actual).toEqual(referenceCrossTeamMatrix(allNull));
    expect(actual.every((c) => c.comparable === 0 && c.agreementRate === null)).toBe(true);
  });

  it("hand-verified case: one fully-populated image where only the reviewer disagrees", () => {
    const image: ImageResultComparison = {
      xrayImageId: "HAND-1",
      portName: "منفذ الاختبار",
      results: {
        levelOne: "سليمة",
        levelTwo: "سليمة",
        manual: "سليمة",
        opposite: "سليمة",
        liveMeans: "سليمة",
        review: "اشتباه",
      },
      agreesWithReview: {},
    };
    const cells = buildCrossTeamMatrix([image]);
    expect(cells).toHaveLength(15);
    for (const cell of cells) {
      expect(cell.comparable).toBe(1);
      if (cell.sourceA === "review" || cell.sourceB === "review") {
        expect(cell.agree).toBe(0);
        expect(cell.disagree).toBe(1);
        expect(cell.agreementRate).toBe(0);
      } else {
        expect(cell.agree).toBe(1);
        expect(cell.disagree).toBe(0);
        expect(cell.agreementRate).toBe(100);
      }
    }
    // 10 pairs among the 5 non-review sources + 5 pairs vs review = 15
    expect(cells.filter((c) => c.sourceA === "review" || c.sourceB === "review")).toHaveLength(5);
  });
});

describe("aggregate reconciliation — port + stage + movement evaluable totals match", () => {
  it("each grouping's evaluable total equals the total evaluable decision count", () => {
    const rows = [
      reportRow({ xrayImageId: "A", portName: "منفذ ١", stage: "المستوى الأول", movementType: "بري", expertResult: "سليمة" }),
      reportRow({ xrayImageId: "B", portName: "منفذ ٢", stage: "المستوى الثاني", movementType: "بحري", expertResult: "اشتباه", levelOneResult: "اشتباه", levelTwoResult: "اشتباه" }),
      reportRow({ xrayImageId: "C", portName: "منفذ ١", stage: "المستوى الأول", movementType: "افراد", expertResult: "اشتباه", levelOneResult: "سليمة", levelTwoResult: "اشتباه" }),
    ];
    const records = buildDecisionRecords(rows, PERIOD);
    const agg = buildAggregates(records, buildImageComparisons(rows), DEFAULT_EXEC_CONFIG);

    const totalEvaluableOutcomes = records.filter((r) => r.outcomeClass !== null).length;
    const sum = (xs: { evaluable: number }[]) => xs.reduce((a, b) => a + b.evaluable, 0);

    expect(sum(agg.byPort)).toBe(totalEvaluableOutcomes);
    expect(sum(agg.byStage)).toBe(totalEvaluableOutcomes);
    expect(sum(agg.byMovement)).toBe(totalEvaluableOutcomes);
  });
});

describe("employee-by-port-and-level keys on inspectorId", () => {
  it("groups records by inspector id + level + port, skipping null inspectors", () => {
    const rows = [
      reportRow({ xrayImageId: "A", levelOneEmployeeId: "E-1", levelTwoEmployeeId: "E-2" }),
      reportRow({ xrayImageId: "B", levelOneEmployeeId: "E-1", levelTwoEmployeeId: null }),
    ];
    const agg = buildAggregates(
      buildDecisionRecords(rows, PERIOD),
      buildImageComparisons(rows),
      DEFAULT_EXEC_CONFIG
    );
    const e1l1 = agg.employeeByPortAndLevel.find(
      (e) => e.inspectorId === "E-1" && e.level === "LEVEL_1"
    )!;
    expect(e1l1.evaluable).toBe(2);
    // null-inspector L2 on row B is skipped
    expect(agg.employeeByPortAndLevel.filter((e) => e.level === "LEVEL_2")).toHaveLength(1);
  });
});

// ---- ReportModel integration (uses the population → row bridge) ----

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

describe("buildReportModel", () => {
  it("flags inspector identity as unmapped when all inspector ids are null", () => {
    const model = buildReportModel(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(model.employeeOverview.inspectorIdentityMapped).toBe(false);
    expect(model.dataQuality.inspectorIdentityMapped).toBe(false);
    expect(model.employeeOverview.evaluatedCount).toBe(0);
  });

  it("flags inspector identity as mapped when BI provided inspector ids", () => {
    const model = buildReportModel(
      input([popRow({ levelOneEmployee: "E-1", levelTwoEmployee: "E-2" })])
    );
    expect(model.employeeOverview.inspectorIdentityMapped).toBe(true);
    expect(model.dataQuality.inspectorIdentityMapped).toBe(true);
  });

  it("produces two fact-table records per population row", () => {
    const model = buildReportModel(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(model.factTable).toHaveLength(4);
    expect(model.summary.periodId).toBe("مايو 2026");
  });

  it("bridges other-team results from the population row into comparisons", () => {
    const model = buildReportModel(
      input([
        popRow({
          otherResults: {
            manual: { result: "اشتباه", code: "M1", employeeId: null },
            opposite: { result: "سليمة", code: null, employeeId: "OP-1" },
            liveMeans: { result: null, code: null, employeeId: null },
          },
        }),
      ])
    );
    expect(model.resultComparison.images[0].results.manual).toBe("اشتباه");
    expect(model.resultComparison.images[0].results.opposite).toBe("سليمة");
    expect(model.resultComparison.images[0].results.liveMeans).toBeNull();
  });
});
