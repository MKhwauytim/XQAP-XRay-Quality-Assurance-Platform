import { describe, expect, it } from "vitest";

import type { DecisionRecord } from "./decisionFactTable";
import {
  buildPChart,
  buildReviewerKpis,
  percentile,
  P_CHART_MIN_N,
  type ReviewerReferralInput,
} from "./reviewerKpis";

// ── percentile (R-7 linear interpolation) ─────────────────────────────────────

describe("percentile", () => {
  it("returns null for an empty array", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("returns the single value for a one-element array", () => {
    expect(percentile([5], 0.5)).toBe(5);
    expect(percentile([5], 0.9)).toBe(5);
  });

  it("median of [2,4,6] is the middle value 4", () => {
    expect(percentile([2, 4, 6], 0.5)).toBe(4);
  });

  it("p90 of [2,4,6] interpolates to 5.6", () => {
    // rank = 0.9*(3-1) = 1.8 → 4 + 0.8*(6-4) = 5.6
    expect(percentile([2, 4, 6], 0.9)).toBeCloseTo(5.6, 10);
  });

  it("median of even-length [10,20] interpolates to 15", () => {
    expect(percentile([10, 20], 0.5)).toBe(15);
  });
});

// ── p-chart math ──────────────────────────────────────────────────────────────

describe("buildPChart — pooled centre + variable 3σ limits", () => {
  it("computes p̄ and per-group limits (n=10 each, p̄=0.5)", () => {
    const chart = buildPChart([
      { key: "A", n: 10, x: 2 },
      { key: "B", n: 10, x: 8 },
    ]);
    expect(chart.center).toBeCloseTo(0.5, 12);
    const a = chart.groups.find((g) => g.key === "A")!;
    // se = sqrt(0.25/10) = 0.15811388…, 3σ = 0.47434…
    expect(a.p).toBeCloseTo(0.2, 12);
    expect(a.ucl).toBeCloseTo(0.9743416490, 8);
    expect(a.lcl).toBeCloseTo(0.0256583510, 8);
    expect(a.outOfControl).toBe(false); // 0.2 inside [0.0257, 0.9743]
    expect(a.lowN).toBe(false);
  });

  it("flags out-of-control when tight limits (n=100) exclude the proportion", () => {
    const chart = buildPChart([
      { key: "A", n: 100, x: 10 },
      { key: "B", n: 100, x: 90 },
    ]);
    expect(chart.center).toBeCloseTo(0.5, 12);
    // se = sqrt(0.25/100)=0.05, 3σ=0.15 → limits [0.35, 0.65]
    const a = chart.groups.find((g) => g.key === "A")!;
    const b = chart.groups.find((g) => g.key === "B")!;
    expect(a.ucl).toBeCloseTo(0.65, 12);
    expect(a.lcl).toBeCloseTo(0.35, 12);
    expect(a.outOfControl).toBe(true); // 0.1 < 0.35
    expect(b.outOfControl).toBe(true); // 0.9 > 0.65
  });

  it("edge: p̄=0 → zero-width limits, every point in control", () => {
    const chart = buildPChart([
      { key: "A", n: 10, x: 0 },
      { key: "B", n: 20, x: 0 },
    ]);
    expect(chart.center).toBe(0);
    for (const g of chart.groups) {
      expect(g.ucl).toBe(0);
      expect(g.lcl).toBe(0);
      expect(g.outOfControl).toBe(false);
    }
  });

  it("edge: p̄=1 → limits pinned at 1, every point in control", () => {
    const chart = buildPChart([
      { key: "A", n: 8, x: 8 },
      { key: "B", n: 12, x: 12 },
    ]);
    expect(chart.center).toBe(1);
    for (const g of chart.groups) {
      expect(g.ucl).toBe(1);
      expect(g.lcl).toBe(1);
      expect(g.outOfControl).toBe(false);
    }
  });

  it("edge: single group is centred on itself and never out of control", () => {
    const chart = buildPChart([{ key: "solo", n: 10, x: 3 }]);
    expect(chart.center).toBeCloseTo(0.3, 12);
    const g = chart.groups[0]!;
    expect(g.p).toBeCloseTo(0.3, 12);
    // lcl = 0.3 - 3*sqrt(0.21/10) = -0.1347… → clamped to 0
    expect(g.lcl).toBe(0);
    expect(g.outOfControl).toBe(false);
  });

  it("clamps limits into [0,1]", () => {
    const chart = buildPChart([{ key: "A", n: 6, x: 5 }]);
    const g = chart.groups[0]!;
    expect(g.ucl).toBeLessThanOrEqual(1);
    expect(g.lcl).toBeGreaterThanOrEqual(0);
  });

  it("edge: zero-n groups are dropped", () => {
    const chart = buildPChart([
      { key: "A", n: 0, x: 0 },
      { key: "B", n: 5, x: 1 },
    ]);
    expect(chart.groups.map((g) => g.key)).toEqual(["B"]);
  });

  it("edge: all-zero-n → null centre and no groups", () => {
    const chart = buildPChart([{ key: "A", n: 0, x: 0 }]);
    expect(chart.center).toBeNull();
    expect(chart.groups).toEqual([]);
  });

  it("low-n groups (n < minN) are flagged and never signalled OOC", () => {
    const chart = buildPChart([
      { key: "big", n: 100, x: 50 },
      { key: "tiny", n: 2, x: 2 }, // p=1, but n<5
    ]);
    const tiny = chart.groups.find((g) => g.key === "tiny")!;
    expect(tiny.lowN).toBe(true);
    expect(tiny.outOfControl).toBe(false);
    expect(P_CHART_MIN_N).toBe(5);
  });
});

// ── reviewer KPIs over the fact table ─────────────────────────────────────────

function rec(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    periodId: "مايو 2026",
    xrayImageId: "XR-1",
    portCode: "P1",
    portName: "منفذ ١",
    portType: null,
    movementType: null,
    stage: null,
    decisionLevel: "LEVEL_1",
    inspectorId: "E-1",
    employeeDecision: "سليمة",
    studyReviewResult: "سليمة",
    imageAvailable: true,
    markingAvailable: null,
    imageQuality: null,
    reviewCompleted: true,
    decisionEvaluable: true,
    outcomeClass: "correct-clean",
    reviewerId: "R1",
    assignedAt: null,
    completedAt: null,
    sourceRowNumber: 1,
    dataSufficiencyGroup: null,
    ...overrides,
  };
}

/** Two records (L1 + L2) for one case, sharing all row-level fields. */
function caseRecs(o: Partial<DecisionRecord> = {}): DecisionRecord[] {
  return [
    rec({ ...o, decisionLevel: "LEVEL_1" }),
    rec({ ...o, decisionLevel: "LEVEL_2" }),
  ];
}

const H = 3_600_000; // ms per hour
const base = Date.parse("2026-05-01T00:00:00Z");
const at = (hoursFromBase: number) => new Date(base + hoursFromBase * H).toISOString();

describe("buildReviewerKpis", () => {
  it("collapses the two-per-case fact table (case counted once)", () => {
    const records = caseRecs({ xrayImageId: "XR-1", reviewerId: "R1" });
    const model = buildReviewerKpis(records);
    const r1 = model.rows.find((r) => r.reviewerId === "R1")!;
    expect(r1.assigned).toBe(1);
    expect(r1.completed).toBe(1);
  });

  it("computes workload, completion, turnaround, suspicion and referral rates", () => {
    const referral: ReviewerReferralInput = {
      requestCountByReviewer: new Map([["R1", 2]]),
      referredImageIds: new Set(["XR-2"]), // a سليمة case, folded into the numerator
    };
    const records: DecisionRecord[] = [
      ...caseRecs({ xrayImageId: "XR-1", reviewerId: "R1", portName: "P1", studyReviewResult: "اشتباه", reviewCompleted: true, assignedAt: at(0), completedAt: at(2) }),
      ...caseRecs({ xrayImageId: "XR-2", reviewerId: "R1", portName: "P1", studyReviewResult: "سليمة", reviewCompleted: true, assignedAt: at(0), completedAt: at(4) }),
      ...caseRecs({ xrayImageId: "XR-3", reviewerId: "R1", portName: "P2", studyReviewResult: "سليمة", reviewCompleted: true, assignedAt: at(0), completedAt: at(6) }),
      ...caseRecs({ xrayImageId: "XR-4", reviewerId: "R1", portName: "P1", studyReviewResult: null, reviewCompleted: false }),
    ];
    const model = buildReviewerKpis(records, referral);
    const r1 = model.rows.find((r) => r.reviewerId === "R1")!;

    expect(r1.assigned).toBe(4);
    expect(r1.completed).toBe(3);
    expect(r1.completionRate).toBeCloseTo(75, 12);
    // turnarounds [2,4,6] → median 4, p90 5.6
    expect(r1.turnaroundMedianHours).toBeCloseTo(4, 12);
    expect(r1.turnaroundP90Hours).toBeCloseTo(5.6, 10);
    // reviewed-with-verdict = 3 (XR-1/2/3); suspicious-or-referral = XR-1 (susp) + XR-2 (referred) = 2
    expect(r1.reviewedWithVerdict).toBe(3);
    expect(r1.suspiciousOrReferral).toBe(2);
    expect(r1.suspicionOrReferralRate).toBeCloseTo((2 / 3) * 100, 10);
    // referral rate = 2 requests / 3 completed
    expect(r1.referralCount).toBe(2);
    expect(r1.referralRate).toBeCloseTo((2 / 3) * 100, 10);
  });

  it("builds the reviewer p-chart (pooled centre over reviewers)", () => {
    const records: DecisionRecord[] = [
      ...caseRecs({ xrayImageId: "XR-1", reviewerId: "R1", studyReviewResult: "اشتباه" }),
      ...caseRecs({ xrayImageId: "XR-2", reviewerId: "R1", studyReviewResult: "سليمة" }),
      ...caseRecs({ xrayImageId: "XR-3", reviewerId: "R1", studyReviewResult: "سليمة" }),
      ...caseRecs({ xrayImageId: "XR-5", reviewerId: "R2", studyReviewResult: "اشتباه" }),
      ...caseRecs({ xrayImageId: "XR-6", reviewerId: "R2", studyReviewResult: "اشتباه" }),
    ];
    const model = buildReviewerKpis(records);
    // R1: n=3 x=1 ; R2: n=2 x=2 → centre = 3/5 = 0.6
    expect(model.reviewerPChart.center).toBeCloseTo(0.6, 12);
    const r1 = model.reviewerPChart.groups.find((g) => g.key === "R1")!;
    expect(r1.n).toBe(3);
    expect(r1.x).toBe(1);
  });

  it("builds the port p-chart across all reviewers", () => {
    const records: DecisionRecord[] = [
      ...caseRecs({ xrayImageId: "XR-1", reviewerId: "R1", portName: "P1", studyReviewResult: "اشتباه" }),
      ...caseRecs({ xrayImageId: "XR-2", reviewerId: "R1", portName: "P1", studyReviewResult: "سليمة" }),
      ...caseRecs({ xrayImageId: "XR-5", reviewerId: "R2", portName: "P2", studyReviewResult: "اشتباه" }),
    ];
    const model = buildReviewerKpis(records);
    const p1 = model.portPChart.groups.find((g) => g.key === "P1")!;
    const p2 = model.portPChart.groups.find((g) => g.key === "P2")!;
    expect(p1.n).toBe(2);
    expect(p1.x).toBe(1);
    expect(p2.n).toBe(1);
    expect(p2.x).toBe(1);
  });

  it("skips null-reviewer cases in reviewer rows but keeps them in the port chart", () => {
    const records: DecisionRecord[] = [
      ...caseRecs({ xrayImageId: "XR-1", reviewerId: null, portName: "P9", studyReviewResult: "اشتباه", reviewCompleted: true }),
    ];
    const model = buildReviewerKpis(records);
    expect(model.rows).toHaveLength(0);
    const p9 = model.portPChart.groups.find((g) => g.key === "P9")!;
    expect(p9.n).toBe(1);
    expect(p9.x).toBe(1);
  });

  it("throughput-vs-quota is null without quota data, computed with it", () => {
    const records = caseRecs({ xrayImageId: "XR-1", reviewerId: "R1", reviewCompleted: true });
    const noQuota = buildReviewerKpis(records);
    expect(noQuota.rows[0]!.throughputVsQuota).toBeNull();
    expect(noQuota.rows[0]!.quota).toBeNull();

    const withQuota = buildReviewerKpis(records, undefined, new Map([["R1", 4]]));
    expect(withQuota.rows[0]!.quota).toBe(4);
    expect(withQuota.rows[0]!.throughputVsQuota).toBeCloseTo(25, 12); // 1/4
  });

  it("empty fact table → empty rows and null-centre p-charts", () => {
    const model = buildReviewerKpis([]);
    expect(model.rows).toEqual([]);
    expect(model.reviewerPChart.center).toBeNull();
    expect(model.portPChart.center).toBeNull();
  });
});
