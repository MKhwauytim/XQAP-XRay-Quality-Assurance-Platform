// Shared ReportModel fixture for the KPI dashboard tests.
//
// `ReportModel` is the whole executive analytical artifact; the dashboard reads
// a well-defined slice of it. This builder fills exactly that slice with real,
// hand-checked numbers and casts the rest away — a full literal would be ~200
// lines of fields no assertion here ever touches.

import type { ReportModel } from "../../../../data/reporting/executive/model/reportModel";

type Overrides = Partial<{
  overallAccuracy: number | null;
  detectionRate: number | null;
  missedSuspicionRate: number | null;
  sampleTotal: number;
  sampleStudied: number;
  byStage: Array<{ stageKey: string; stageLabel: string; sampleSize: number; studied: number }>;
  ports: Array<{ key: string; evaluable: number; accuracy: number | null; band: string }>;
  rows: Array<{
    assignedTo: string | null;
    portName: string | null;
    expertResult: "سليمة" | "اشتباه" | null;
    answerStatus: "draft" | "submitted" | null;
  }>;
  factTable: Array<{ completedAt: string | null; outcomeClass: string | null }>;
  reviewers: Array<{ reviewerId: string; assigned: number; completed: number }>;
  pChartGroups: Array<{ key: string; lowN: boolean; outOfControl: boolean }>;
}>;

export function makeReportModel(overrides: Overrides = {}): ReportModel {
  const byStage = overrides.byStage ?? [
    { stageKey: "L1", stageLabel: "المستوى الأول", sampleSize: 100, studied: 90 },
    { stageKey: "L2", stageLabel: "المستوى الثاني", sampleSize: 100, studied: 50 },
  ];
  const ports = overrides.ports ?? [
    { key: "ميناء الأول", evaluable: 200, accuracy: 92, band: "sufficient" },
    { key: "ميناء الثاني", evaluable: 120, accuracy: 78, band: "limited" },
  ];
  const rows = overrides.rows ?? [
    { assignedTo: "u1", portName: "ميناء الأول", expertResult: "اشتباه", answerStatus: "submitted" },
    { assignedTo: "u1", portName: "ميناء الأول", expertResult: "سليمة", answerStatus: "submitted" },
    { assignedTo: "u1", portName: "ميناء الثاني", expertResult: null, answerStatus: null },
  ];
  const reviewers = overrides.reviewers ?? [{ reviewerId: "u1", assigned: 3, completed: 2 }];
  const pChartGroups = overrides.pChartGroups ?? [
    { key: "u1", lowN: false, outOfControl: false },
  ];

  const model = {
    summary: {
      periodId: "أبريل 2026",
      monthFolderName: "4-april-2026",
      findings: [],
      overallAccuracy:
        overrides.overallAccuracy === undefined ? 87.4 : overrides.overallAccuracy,
      detectionRate: overrides.detectionRate === undefined ? 79.5 : overrides.detectionRate,
      missedSuspicionRate:
        overrides.missedSuspicionRate === undefined ? 1.4 : overrides.missedSuspicionRate,
      falseSuspicionRate: 3.1,
      completionRate: 70,
    },
    population: {
      total: 1000,
      clean: 900,
      suspicious: 100,
      suspicionRate: 10,
      byPort: [],
      byStage: byStage.map((stage) => ({
        ...stage,
        population: 500,
        coverage: 20,
        completionRate: stage.sampleSize > 0 ? (stage.studied / stage.sampleSize) * 100 : 0,
      })),
    },
    sample: {
      total: overrides.sampleTotal ?? 200,
      coverage: 20,
      studied: overrides.sampleStudied ?? 140,
      remaining: (overrides.sampleTotal ?? 200) - (overrides.sampleStudied ?? 140),
      completionRate: 70,
    },
    distribution: { assigned: 200, completed: 140, pending: 60, replaced: 0 },
    distributionCoverage: null,
    accountabilityProgress: null,
    portAccuracy: ports.map((port) => ({
      key: port.key,
      evaluable: port.evaluable,
      correctClean: 100,
      correctSuspicion: 40,
      missedSuspicion: 5,
      falseSuspicion: 10,
      detectionRate: 88,
      suspicionDecisionAccuracy: 80,
      falseSuspicionRate: 9,
      band: port.band,
      accuracyByDecision: port.accuracy,
      missedSuspicionRateByDecision: port.accuracy == null ? null : 2.5,
    })),
    portAccuracyByLevel: [],
    imageQuality: {
      availabilityRate: null,
      markingRate: null,
      acceptableQualityRate: null,
      highQualityCount: 0,
      mediumQualityCount: 0,
      lowQualityCount: 0,
    },
    employeeOverview: {
      inspectorIdentityMapped: true,
      evaluatedCount: 1,
      totalDecisions: 2,
      evaluableDecisions: 2,
      reviewerProfiles: [],
      priorityReviewers: [],
      reviewerDisplayNames: {},
    },
    employeeByPort: [],
    errorAnalysis: {
      byPort: ports.map((port) => ({
        key: port.key,
        correctClean: 100,
        correctSuspicion: 40,
        missedSuspicion: 5,
        falseSuspicion: 10,
        evaluable: port.evaluable,
      })),
      totals: {
        correctClean: 200,
        correctSuspicion: 80,
        missedSuspicion: 10,
        falseSuspicion: 20,
        evaluable: 310,
      },
    },
    actions: [],
    exclusions: { note: "" },
    dataQuality: {
      biAvailable: true,
      inspectorIdentityMapped: true,
      totalDecisionRecords: 320,
      evaluableDecisionRecords: 310,
      overallBand: "sufficient",
    },
    resultComparison: {
      images: [],
      reviewerAgreement: [
        {
          source: "levelTwo",
          comparable: 100,
          agree: 89,
          disagree: 11,
          agreementRate: 89,
          teamFlaggedReviewerClean: 5,
          teamClearedReviewerFlagged: 6,
        },
        {
          source: "levelOne",
          comparable: 100,
          agree: 87,
          disagree: 13,
          agreementRate: 87,
          teamFlaggedReviewerClean: 6,
          teamClearedReviewerFlagged: 7,
        },
        {
          source: "opposite",
          comparable: 0,
          agree: 0,
          disagree: 0,
          agreementRate: null,
          teamFlaggedReviewerClean: 0,
          teamClearedReviewerFlagged: 0,
        },
      ],
      crossTeamMatrix: [],
    },
    reviewerKpis: {
      rows: reviewers.map((reviewer) => ({
        ...reviewer,
        completionRate:
          reviewer.assigned > 0 ? (reviewer.completed / reviewer.assigned) * 100 : null,
        quota: null,
        throughputVsQuota: null,
        turnaroundMedianHours: 3.5,
        turnaroundP90Hours: 6,
        reviewedWithVerdict: reviewer.completed,
        suspiciousOrReferral: 1,
        suspicionOrReferralRate: 12.5,
        referralCount: 0,
        referralRate: 0,
      })),
      reviewerPChart: {
        center: 0.2,
        minN: 5,
        groups: pChartGroups.map((group) => ({
          key: group.key,
          n: 10,
          x: 2,
          p: 0.2,
          center: 0.2,
          ucl: 0.6,
          lcl: 0,
          outOfControl: group.outOfControl,
          lowN: group.lowN,
        })),
      },
      portPChart: { center: 0.2, minN: 5, groups: [] },
    },
    dataSources: { riskRowCount: 1000, biProvided: true, biMatchedCount: 900 },
    factTable: (overrides.factTable ?? []).map((record) => ({
      ...record,
      periodId: "أبريل 2026",
      xrayImageId: "x",
    })),
    rows: rows.map((row) => ({ ...row, xrayImageId: "x" })),
    kpis: {},
  };
  return model as unknown as ReportModel;
}
