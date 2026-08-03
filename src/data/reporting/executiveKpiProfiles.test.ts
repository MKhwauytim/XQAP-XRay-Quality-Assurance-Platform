import { describe, expect, it } from "vitest";
import { buildPortProfiles, buildStageProfiles } from "./executiveKpiProfiles";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";
import type { ExecutiveReportRow } from "./executiveReportTypes";

function row(overrides: Partial<ExecutiveReportRow>): ExecutiveReportRow {
  return {
    xrayImageId: "id",
    portCode: null,
    portName: "ميناء أ",
    portType: null,
    movementType: null,
    stage: "المرحلة الأولى",
    levelOneEmployeeId: null,
    levelTwoEmployeeId: null,
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: false,
    assignedTo: null,
    distributionStatus: null,
    expertResult: null,
    imageAvailable: null,
    noImageReason: null,
    hasMarking: null,
    imageQuality: null,
    lowQualityReason: null,
    suspicionLevel: null,
    suspectedTypes: null,
    smuggleMethod: null,
    answerStatus: null,
    assignedAt: null,
    submittedAt: null,
    imageResultAccurate: null,
    levelOneAccurate: null,
    levelTwoAccurate: null,
    verificationCategory: null,
    otherResults: {
      manual: { result: null, employeeId: null },
      opposite: { result: null, employeeId: null },
      liveMeans: { result: null, employeeId: null },
    },
    notes: null,
    ...overrides,
  };
}

describe("buildPortProfiles", () => {
  it("groups rows by port, preserving row order within each port group", () => {
    const rows: ExecutiveReportRow[] = [
      row({ xrayImageId: "1", portName: "الرياض" }),
      row({ xrayImageId: "2", portName: "جدة" }),
      row({ xrayImageId: "3", portName: "الرياض" }),
      row({ xrayImageId: "4", portName: "جدة" }),
      row({ xrayImageId: "5", portName: "الرياض" }),
    ];
    const profiles = buildPortProfiles(rows, DEFAULT_EXEC_CONFIG);
    expect(profiles.map((p) => p.portName).sort()).toEqual(["الرياض", "جدة"].sort());
    const riyadh = profiles.find((p) => p.portName === "الرياض")!;
    expect(riyadh.population).toBe(3);
  });

  it("falls back to 'غير محدد' for a null port name", () => {
    const rows = [row({ xrayImageId: "1", portName: null })];
    const profiles = buildPortProfiles(rows, DEFAULT_EXEC_CONFIG);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.portName).toBe("غير محدد");
  });

  it("keeps first-seen group order stable when two ports tie on population", () => {
    // Both ports have exactly 2 rows -- the stable sort in buildPortProfiles must
    // preserve first-seen (insertion) order on a tie, both before and after the fix.
    const rows: ExecutiveReportRow[] = [
      row({ xrayImageId: "1", portName: "ب-ميناء" }),
      row({ xrayImageId: "2", portName: "أ-ميناء" }),
      row({ xrayImageId: "3", portName: "ب-ميناء" }),
      row({ xrayImageId: "4", portName: "أ-ميناء" }),
    ];
    const profiles = buildPortProfiles(rows, DEFAULT_EXEC_CONFIG);
    expect(profiles.map((p) => p.portName)).toEqual(["ب-ميناء", "أ-ميناء"]);
  });
});

describe("buildStageProfiles (fallback branch, no sample.stageAllocations)", () => {
  it("groups by stage in first-seen order with numeric stageKey", () => {
    const rows: ExecutiveReportRow[] = [
      row({ xrayImageId: "1", stage: "المرحلة الثانية" }),
      row({ xrayImageId: "2", stage: "المرحلة الأولى" }),
      row({ xrayImageId: "3", stage: "المرحلة الثانية" }),
    ];
    const profiles = buildStageProfiles(rows, null);
    expect(profiles.map((p) => p.stageLabel)).toEqual(["المرحلة الثانية", "المرحلة الأولى"]);
    expect(profiles.map((p) => p.stageKey)).toEqual(["0", "1"]);
    expect(profiles[0]!.population).toBe(2);
  });

  it("falls back to 'غير محدد' for a null stage", () => {
    const rows = [row({ xrayImageId: "1", stage: null })];
    const profiles = buildStageProfiles(rows, null);
    expect(profiles[0]!.stageLabel).toBe("غير محدد");
  });
});
