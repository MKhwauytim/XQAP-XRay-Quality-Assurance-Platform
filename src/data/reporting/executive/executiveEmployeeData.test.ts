import { describe, it, expect } from "vitest";
import { buildEmployeeProfiles, buildPriorityList } from "./executiveEmployeeData";
import type { ExecutiveReportRow } from "../executiveReportTypes";

function makeRow(overrides: Partial<ExecutiveReportRow>): ExecutiveReportRow {
  return {
    xrayImageId: "img1",
    portCode: null,
    portName: "منفذ أ",
    portType: "land",
    movementType: null,
    stage: "المستوى الأول",
    levelOneEmployeeId: null,
    levelTwoEmployeeId: null,
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: true,
    assignedTo: "user1",
    distributionStatus: "completed",
    expertResult: "سليمة",
    imageAvailable: true,
    noImageReason: null,
    hasMarking: false,
    imageQuality: "عالي",
    lowQualityReason: null,
    suspicionLevel: null,
    suspectedTypes: null,
    smuggleMethod: null,
    answerStatus: "submitted",
    assignedAt: "2026-05-01T08:00:00Z",
    submittedAt: "2026-05-01T09:00:00Z",
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

describe("buildEmployeeProfiles", () => {
  it("returns empty array for no submitted rows", () => {
    const rows = [makeRow({ answerStatus: "draft" })];
    expect(buildEmployeeProfiles(rows)).toEqual([]);
  });

  it("calculates overallAccuracy correctly", () => {
    const rows = [
      makeRow({ assignedTo: "u1", imageResultAccurate: true, verificationCategory: "correct-clean" }),
      makeRow({ xrayImageId: "img2", assignedTo: "u1", imageResultAccurate: false, verificationCategory: "missed-suspicious" }),
    ];
    const profiles = buildEmployeeProfiles(rows, 1);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].overallAccuracy).toBe(50);
  });

  it("marks employee as unreliable below threshold", () => {
    const rows = [makeRow({ assignedTo: "u1" })];
    const profiles = buildEmployeeProfiles(rows, 30);
    expect(profiles[0].reliable).toBe(false);
  });

  it("marks employee as reliable at threshold", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ xrayImageId: `img${i}`, assignedTo: "u1" })
    );
    const profiles = buildEmployeeProfiles(rows, 30);
    expect(profiles[0].reliable).toBe(true);
  });
});

describe("buildPriorityList", () => {
  it("returns only reliable profiles sorted by riskScore desc", () => {
    const rows = [
      makeRow({ assignedTo: "u1", imageResultAccurate: false, verificationCategory: "missed-suspicious" }),
      ...Array.from({ length: 30 }, (_, i) => makeRow({ xrayImageId: `r${i}`, assignedTo: "u1", imageResultAccurate: false, verificationCategory: "missed-suspicious" })),
    ];
    const profiles = buildEmployeeProfiles(rows, 30);
    const priority = buildPriorityList(profiles);
    expect(priority.length).toBeGreaterThan(0);
    expect(priority[0].riskScore).toBeGreaterThan(0);
  });
});
