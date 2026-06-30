import { describe, expect, it } from "vitest";

import type { ExecutiveReportRow } from "../../executiveReportTypes";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import {
  buildDecisionRecords,
  buildImageComparisons,
  classifyOutcome,
} from "./decisionFactTable";
import { band, isRankable } from "./dataSufficiency";
import { buildAggregates } from "./aggregates";
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
