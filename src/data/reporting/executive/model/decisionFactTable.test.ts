import { describe, expect, it } from "vitest";
import { buildDecisionRecords } from "./decisionFactTable";
import type { ExecutiveReportRow } from "../../executiveReportTypes";

function row(overrides: Partial<ExecutiveReportRow>): ExecutiveReportRow {
  return {
    xrayImageId: "id",
    portCode: null,
    portName: "ميناء أ",
    portType: null,
    movementType: null,
    stage: "المرحلة الأولى",
    levelOneEmployeeId: "L1",
    levelTwoEmployeeId: "L2",
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: false,
    assignedTo: "emp-1",
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

describe("buildDecisionRecords — reviewCompleted", () => {
  it("is true for a submitted answer with an available image", () => {
    const [l1, l2] = buildDecisionRecords(
      [row({ answerStatus: "submitted", imageAvailable: true, expertResult: "سليمة" })],
      "p1"
    );
    expect(l1!.reviewCompleted).toBe(true);
    expect(l2!.reviewCompleted).toBe(true);
  });

  it("is false for a submitted لا يوجد صورة answer — a valid submission, not a completed study", () => {
    const [l1, l2] = buildDecisionRecords(
      [row({ answerStatus: "submitted", imageAvailable: false, expertResult: null })],
      "p1"
    );
    expect(l1!.reviewCompleted).toBe(false);
    expect(l2!.reviewCompleted).toBe(false);
    // decisionEvaluable already required imageAvailable === true — unaffected
    // by this fix, but pinned here so the two guards are never confused.
    expect(l1!.decisionEvaluable).toBe(false);
  });

  it("is false for a draft (not yet submitted) answer", () => {
    const [l1] = buildDecisionRecords(
      [row({ answerStatus: "draft", imageAvailable: true })],
      "p1"
    );
    expect(l1!.reviewCompleted).toBe(false);
  });

  it("never scores a level whose result is neither سليمة nor اشتباه (levelOneOther), yet keeps the other level", () => {
    const records = buildDecisionRecords(
      [row({ levelOneOther: "11", imageAvailable: true, expertResult: "اشتباه", levelOneResult: "سليمة", levelTwoResult: "اشتباه" })],
      "p1"
    );
    const l1 = records.find((r) => r.decisionLevel === "LEVEL_1")!;
    const l2 = records.find((r) => r.decisionLevel === "LEVEL_2")!;
    expect(l1.decisionOther).toBe(true);
    expect(l1.outcomeClass).toBeNull();
    expect(l1.decisionEvaluable).toBe(false);
    expect(l2.decisionOther).toBeUndefined();
    expect(l2.outcomeClass).toBe("correct-suspicion");
  });
});
