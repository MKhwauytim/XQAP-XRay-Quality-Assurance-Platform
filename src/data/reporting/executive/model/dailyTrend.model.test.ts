import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import { buildAggregates } from "./aggregates";
import { buildDecisionRecords, buildImageComparisons } from "./decisionFactTable";
import { buildReportModel } from "./reportModel";
import type { ExecutiveReportRow } from "../../executiveReportTypes";

function reportRow(overrides: Partial<ExecutiveReportRow> = {}): ExecutiveReportRow {
  return {
    xrayImageId: "XR-1",
    portCode: "P1",
    portName: "منفذ الاختبار",
    portType: "منفذ بري",
    movementType: "بري",
    stage: "المستوى الأول",
    levelOneEmployeeId: "E1",
    levelTwoEmployeeId: "E2",
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: true,
    assignedTo: "rev1",
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
    entryDay: 5,
    hasReport: false,
    targetedByRiskEngine: null,
    ...overrides,
  };
}

function aggregatesFor(rows: ExecutiveReportRow[]) {
  const facts = buildDecisionRecords(rows, "مايو 2026");
  return buildAggregates(facts, buildImageComparisons(rows), DEFAULT_EXEC_CONFIG);
}

describe("byEntryDay", () => {
  it("buckets decisions by day, ascending, with days absent rather than zero-filled", () => {
    const agg = aggregatesFor([
      reportRow({ xrayImageId: "A", entryDay: 3 }),
      reportRow({ xrayImageId: "B", entryDay: 1 }),
      reportRow({ xrayImageId: "C", entryDay: 3 }),
    ]);
    expect(agg.byEntryDay.map((d) => d.day)).toEqual([1, 3]);
    // two decision records per image (L1 + L2)
    expect(agg.byEntryDay[0].evaluable).toBe(2);
    expect(agg.byEntryDay[1].evaluable).toBe(4);
  });

  it("routes undated decisions to their own bucket, never to a day", () => {
    const agg = aggregatesFor([
      reportRow({ xrayImageId: "A", entryDay: 7 }),
      reportRow({ xrayImageId: "B", entryDay: null }),
    ]);
    expect(agg.byEntryDay.map((d) => d.day)).toEqual([7]);
    expect(agg.undatedAccuracy.evaluable).toBe(2);
  });

  it("reconciles: dated + undated evaluable equals the month total", () => {
    const rows = [
      reportRow({ xrayImageId: "A", entryDay: 1 }),
      reportRow({ xrayImageId: "B", entryDay: null }),
      reportRow({ xrayImageId: "C", entryDay: 9 }),
    ];
    const agg = aggregatesFor(rows);
    const dated = agg.byEntryDay.reduce((s, d) => s + d.evaluable, 0);
    const total = agg.byPort.reduce((s, p) => s + p.evaluable, 0);
    expect(dated + agg.undatedAccuracy.evaluable).toBe(total);
  });

  it("counts the four outcome classes per day", () => {
    const agg = aggregatesFor([
      reportRow({
        xrayImageId: "A",
        entryDay: 2,
        levelOneResult: "سليمة",
        levelTwoResult: "سليمة",
        expertResult: "اشتباه",
      }),
    ]);
    expect(agg.byEntryDay[0].missedSuspicion).toBe(2);
    expect(agg.byEntryDay[0].accuracy).toBe(0);
  });
});

describe("dailyTrend.datedShare", () => {
  it("is the share of evaluable decisions carrying a usable date", () => {
    const model = buildReportModel({
      monthFolderName: "5-may-2026",
      populationRows: [],
      sample: null,
      distribution: null,
      employeeFiles: [],
      template: null,
      config: DEFAULT_EXEC_CONFIG,
    });
    expect(model.dailyTrend.datedShare).toBeNull();
    expect(model.dailyTrend.days).toEqual([]);
  });
});
