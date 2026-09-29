// C1 (2026-09-28 corrective plan): every stage grouping in the executive /
// distribution / management models keys by getStageKey(stage, workspace
// mappings), labels with the Arabic level label, and orders first→fourth with
// «غير محدد» last — never raw file aliases, never count or first-seen order.
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG, type ExecutiveReportInput } from "../../executiveReportTypes";
import { buildExecutiveReportRows } from "../../executiveReportData";
import { buildStageProfiles } from "../../executiveKpiProfiles";
import { makeDistribution, makeRow, makeSampleMaster } from "../../reportTestFixtures";
import { computeManagementModel } from "../../management/managementModel";
import { buildAggregates } from "./aggregates";
import { buildDecisionRecords } from "./decisionFactTable";
import { computeDistributionModel } from "./distributionCoverageModel";
import { buildReportModel } from "./reportModel";

const CANONICAL_KEYS = ["first", "second", "third", "fourth", "unknown"];
const CANONICAL_LABELS = [
  "المستوى الأول",
  "المستوى الثاني",
  "المستوى الثالث",
  "المستوى الرابع",
  "غير محدد",
];

function rawRows() {
  return [
    makeRow("SC-1", "منفذ أ", { stage: "FORTH_STAGE" }),
    makeRow("SC-2", "منفذ ب", { stage: "SECOND_STAG" }),
    makeRow("SC-3", "منفذ ب", {
      stage: "SECOND_STAG",
      xrayLevelOneResult: "اشتباه",
      xrayLevelTwoResult: "اشتباه",
    }),
    makeRow("SC-4", "منفذ ب", { stage: "SECOND_STAG" }),
    makeRow("SC-5", "منفذ أ", { stage: "FIRST_STAGE" }),
    makeRow("SC-6", "منفذ ب", { stage: "3" }),
    makeRow("SC-7", "منفذ أ", { stage: "LEVEL-X" }),
  ];
}

function input(overrides: Partial<ExecutiveReportInput> = {}): ExecutiveReportInput {
  const rows = rawRows();
  return {
    monthFolderName: "5-May-2026",
    populationRows: rows,
    sample: null,
    distribution: makeDistribution(
      rows.map((row, index) => ({
        id: row.xrayImageId,
        assignedTo: index % 2 === 0 ? "u1" : "u2",
        status: index === 2 ? ("completed" as const) : ("pending" as const),
        row,
      })),
      { monthFolderName: "5-May-2026" },
    ),
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
    ...overrides,
  };
}

describe("C1 — stage groupings are Arabic and canonically ordered", () => {
  it("population stage profiles (no sample): canonical keys, Arabic labels, first→fourth then unknown", () => {
    const model = buildReportModel(input());
    expect(model.population.byStage.map((s) => s.stageKey)).toEqual(CANONICAL_KEYS);
    expect(model.population.byStage.map((s) => s.stageLabel)).toEqual(CANONICAL_LABELS);
    expect(model.population.byStage.map((s) => s.population)).toEqual([1, 3, 1, 1, 1]);
  });

  it("population stage profiles (sample allocations): relabelled from the key and sorted", () => {
    const base = input();
    const sample = makeSampleMaster(base.populationRows, {
      stageAllocations: [
        { stageKey: "third", stageLabel: "المستوى الثالث", populationSize: 1, targetQuota: 1, actualDrawn: 1, certScanDrawn: 0, nonCertScanDrawn: 1 },
        { stageKey: "first", stageLabel: "FIRST_STAGE", populationSize: 1, targetQuota: 1, actualDrawn: 1, certScanDrawn: 0, nonCertScanDrawn: 1 },
      ],
    });
    // SC-5 (FIRST_STAGE) is answered: its allocation carries the raw label
    // "FIRST_STAGE", yet the studied count must still attribute it by key.
    const rows = buildExecutiveReportRows({ ...base, sample }).map((row) =>
      row.xrayImageId === "SC-5" ? { ...row, answerStatus: "submitted" as const, imageAvailable: true } : row,
    );
    const profiles = buildStageProfiles(rows, sample);
    expect(profiles.map((p) => p.stageKey)).toEqual(["first", "third"]);
    expect(profiles.map((p) => p.stageLabel)).toEqual(["المستوى الأول", "المستوى الثالث"]);
    expect(profiles.map((p) => p.studied)).toEqual([1, 0]);
  });

  it("honours the workspace stage alias table and exposes it on the model", () => {
    const rows = [makeRow("CU-1", "منفذ أ", { stage: "Level A" })];
    const model = buildReportModel({
      ...input(),
      populationRows: rows,
      distribution: null,
      stageMappings: { first: ["Level A"] },
    });
    expect(model.population.byStage.map((s) => s.stageLabel)).toEqual(["المستوى الأول"]);
    expect(model.stageMappings).toEqual({ first: ["Level A"] });
  });

  it("distribution coverage buckets: canonical keys, Arabic labels, canonical order", () => {
    const m = computeDistributionModel(input().distribution!, "5-May-2026");
    expect(m.byStage.map((b) => b.key)).toEqual(CANONICAL_KEYS);
    expect(m.byStage.map((b) => b.label)).toEqual(CANONICAL_LABELS);
  });

  it("management progress buckets: canonical keys, Arabic labels, canonical order", () => {
    const m = computeManagementModel(input().distribution!, "5-May-2026");
    expect(m.byStage.map((b) => b.key)).toEqual(CANONICAL_KEYS);
    expect(m.byStage.map((b) => b.label)).toEqual(CANONICAL_LABELS);
  });

  it("stage accuracy aggregates: Arabic label as key, canonical order", () => {
    const rows = buildExecutiveReportRows(input()).map((row) => ({
      ...row,
      expertResult: "سليمة" as const,
    }));
    const agg = buildAggregates(buildDecisionRecords(rows, "5-May-2026"), [], DEFAULT_EXEC_CONFIG);
    expect(agg.byStage.map((s) => s.key)).toEqual(CANONICAL_LABELS);
  });

  it("the report model threads the alias table into coverage and accountability", () => {
    const rows = [makeRow("CU-1", "منفذ أ", { stage: "Level A" })];
    const model = buildReportModel({
      ...input(),
      populationRows: rows,
      distribution: makeDistribution([{ id: "CU-1", assignedTo: "u1", status: "pending", row: rows[0]! }]),
      stageMappings: { first: ["Level A"] },
    });
    expect(model.distributionCoverage!.byStage.map((b) => b.label)).toEqual(["المستوى الأول"]);
    expect(model.accountabilityProgress!.byStage.map((b) => b.label)).toEqual(["المستوى الأول"]);
  });
});
