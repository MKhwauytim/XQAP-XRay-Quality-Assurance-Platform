import type {
  ExecutiveKPIs,
  ExecutiveReportInput,
  ExecutiveReportRow,
  PortProfile,
  StageProfile,
} from "../../executiveReportTypes";
import {
  buildExecutiveReportRows,
  calculateExecutiveKPIs,
  generateNarrativeFindings,
} from "../../executiveReportData";
import { buildEmployeeProfiles, buildPriorityList } from "../executiveEmployeeData";
import type { EmployeeProfile } from "../executiveEmployeeData";
import {
  buildDecisionRecords,
  buildImageComparisons,
} from "./decisionFactTable";
import type { DecisionRecord, ImageResultComparison } from "./decisionFactTable";
import { buildAggregates } from "./aggregates";
import type { Aggregates } from "./aggregates";
import { buildReviewerKpis } from "./reviewerKpis";
import type { ReviewerKpiModel, ReviewerReferralInput } from "./reviewerKpis";
import { band } from "./dataSufficiency";
import type { DataSufficiencyBand } from "./dataSufficiency";
import { formatMonthFolderShortLabel } from "../../../population/monthFolder";

/**
 * The single typed analytical artifact (design spec §3.6) — the in-memory
 * equivalent of the master §14 `report.*.json` files. Built ONCE per generation
 * and passed to every renderer; renderers display, they never recompute.
 */
export type ReportModel = {
  summary: {
    periodId: string;
    monthFolderName: string;
    findings: string[];
    overallAccuracy: number | null;
    detectionRate: number | null;
    missedSuspicionRate: number | null;
    falseSuspicionRate: number | null;
    completionRate: number;
  };
  population: {
    total: number;
    clean: number;
    suspicious: number;
    suspicionRate: number;
    byPort: PortProfile[];
    byStage: StageProfile[];
  };
  sample: {
    total: number;
    coverage: number;
    studied: number;
    remaining: number;
    completionRate: number;
  };
  distribution: {
    assigned: number;
    completed: number;
    pending: number;
    replaced: number;
  };
  portAccuracy: Aggregates["byPort"];
  imageQuality: {
    availabilityRate: number | null;
    markingRate: number | null;
    acceptableQualityRate: number | null;
    highQualityCount: number;
    mediumQualityCount: number;
    lowQualityCount: number;
  };
  employeeOverview: {
    /** §3.4: false when `inspectorId` is null for every decision (BI unmapped).
     *  Renderers must show the "not mapped" empty state, never reviewer data. */
    inspectorIdentityMapped: boolean;
    evaluatedCount: number;
    totalDecisions: number;
    evaluableDecisions: number;
    /** Reviewer-keyed workload profiles (display names) — workload context only. */
    reviewerProfiles: EmployeeProfile[];
    priorityReviewers: EmployeeProfile[];
    /** username → display name for reviewers (app users), resolved from the
     *  caller-supplied map. Reviewers are shown by name; inspectors never are (§3.4). */
    reviewerDisplayNames: Record<string, string>;
  };
  employeeByPort: Aggregates["employeeByPortAndLevel"];
  errorAnalysis: {
    byPort: Aggregates["errorTypeByPort"];
    totals: {
      correctClean: number;
      correctSuspicion: number;
      missedSuspicion: number;
      falseSuspicion: number;
      evaluable: number;
    };
  };
  actions: string[];
  exclusions: {
    note: string;
  };
  dataQuality: {
    biAvailable: boolean;
    inspectorIdentityMapped: boolean;
    totalDecisionRecords: number;
    evaluableDecisionRecords: number;
    overallBand: DataSufficiencyBand;
  };
  resultComparison: {
    images: ImageResultComparison[];
    reviewerAgreement: Aggregates["reviewerAgreement"];
    crossTeamMatrix: Aggregates["crossTeamMatrix"];
  };
  /** Per-reviewer KPI upgrade (Tier-2): workload, throughput, turnaround, referral
   *  rate + SPC p-charts (suspicion-or-referral rate per reviewer / per port). */
  reviewerKpis: ReviewerKpiModel;
  /** Which upload sources fed this month (from data processing): the risk-agency
   *  file is the required base (every row comes from it); BI is the optional
   *  supporting file, detected from the rows' enrichment flags. */
  dataSources: {
    riskRowCount: number;
    biProvided: boolean;
    biMatchedCount: number;
  };
  /** Raw analytical primitives, exposed for renderers/workbook that need detail. */
  factTable: DecisionRecord[];
  rows: ExecutiveReportRow[];
  kpis: ExecutiveKPIs;
};

export function buildReportModel(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {}
): ReportModel {
  const periodId = formatMonthFolderShortLabel(input.monthFolderName);

  const rows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(rows, input.sample, input.config);

  const factTable = buildDecisionRecords(rows, periodId);
  const comparisons = buildImageComparisons(rows);
  const aggregates = buildAggregates(factTable, comparisons, input.config);

  // Stamp each record's sufficiency group from its inspector's evaluable count.
  const evaluableByInspector = new Map<string, number>();
  for (const rec of factTable) {
    if (rec.inspectorId !== null && rec.decisionEvaluable) {
      evaluableByInspector.set(rec.inspectorId, (evaluableByInspector.get(rec.inspectorId) ?? 0) + 1);
    }
  }
  for (const rec of factTable) {
    rec.dataSufficiencyGroup =
      rec.inspectorId === null
        ? null
        : band(evaluableByInspector.get(rec.inspectorId) ?? 0, input.config.dataSufficiencyThresholds);
  }

  // Employee identity (§3.4): inspector accuracy keys on inspectorId. If BI never
  // mapped, inspectorId is null everywhere → expose an explicit unmapped flag.
  const inspectorIdentityMapped = factTable.some((r) => r.inspectorId !== null);

  // Reviewer-keyed workload profiles (display names) — NOT inspector accuracy.
  const reviewerProfiles = buildEmployeeProfiles(rows, input.config.minimumReliableSampleSize);
  const priorityReviewers = buildPriorityList(reviewerProfiles);
  const reviewerDisplayNames: Record<string, string> = {};
  for (const profile of reviewerProfiles) {
    reviewerDisplayNames[profile.username] = employeeDisplayNames[profile.username] ?? profile.username;
  }

  // Error-type totals across the fact table (per-decision).
  const errorTotals = factTable.reduce(
    (acc, rec) => {
      switch (rec.outcomeClass) {
        case "correct-clean":
          acc.correctClean += 1;
          acc.evaluable += 1;
          break;
        case "correct-suspicion":
          acc.correctSuspicion += 1;
          acc.evaluable += 1;
          break;
        case "missed-suspicion":
          acc.missedSuspicion += 1;
          acc.evaluable += 1;
          break;
        case "false-suspicion":
          acc.falseSuspicion += 1;
          acc.evaluable += 1;
          break;
        default:
          break;
      }
      return acc;
    },
    { correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0, evaluable: 0 }
  );

  const evaluableDecisionRecords = factTable.filter((r) => r.decisionEvaluable).length;

  // Reviewer KPIs (Tier-2): fold the month's referral requests (from the answer
  // files) into a storage-agnostic signal, then compute over the fact table.
  const referral: ReviewerReferralInput = { requestCountByReviewer: new Map(), referredImageIds: new Set() };
  for (const file of input.employeeFiles) {
    for (const req of file.referralRequests ?? []) {
      referral.requestCountByReviewer.set(
        req.fromEmployee,
        (referral.requestCountByReviewer.get(req.fromEmployee) ?? 0) + 1
      );
      for (const id of req.xrayImageIds) referral.referredImageIds.add(id);
    }
  }
  const reviewerKpis = buildReviewerKpis(factTable, referral);

  // Source attribution (owner request 2026-07-14): risk-agency data is the
  // required base file — every population row originates from it. BI is the
  // optional supporting file; its presence is detected from the enrichment
  // flags the processor stamped on the rows.
  const biMatchedCount = input.populationRows.filter((r) => r.biMatched).length;
  const dataSources = {
    riskRowCount: input.populationRows.length,
    biProvided:
      biMatchedCount > 0 ||
      input.populationRows.some((r) => r.biEnrichmentStatus !== "BI Not Provided"),
    biMatchedCount,
  };

  const dist = input.distribution;

  return {
    summary: {
      periodId,
      monthFolderName: input.monthFolderName,
      findings: generateNarrativeFindings(kpis, input.config),
      overallAccuracy: kpis.overallAccuracy,
      detectionRate: kpis.suspiciousDetectionRate,
      missedSuspicionRate: kpis.missedSuspicionRate,
      falseSuspicionRate: kpis.excessSuspicionRate,
      completionRate: kpis.completionRate,
    },
    population: {
      total: kpis.totalPopulation,
      clean: kpis.cleanCount,
      suspicious: kpis.suspiciousCount,
      suspicionRate: kpis.suspicionRate,
      byPort: kpis.portProfiles,
      byStage: kpis.stageProfiles,
    },
    sample: {
      total: kpis.totalSample,
      coverage: kpis.sampleCoverage,
      studied: kpis.studiedImages,
      remaining: kpis.remainingImages,
      completionRate: kpis.completionRate,
    },
    distribution: {
      assigned: dist?.totalAssigned ?? 0,
      // Completion derives from submitted answers (kpis.studiedImages — the
      // same source as the fact table and sample.studied) so every completion
      // figure in the report agrees. assigned/pending/replaced stay
      // event-derived: they describe distribution state, not study progress.
      completed: kpis.studiedImages,
      pending: dist?.totalPending ?? 0,
      replaced: dist?.totalReplaced ?? 0,
    },
    portAccuracy: aggregates.byPort,
    imageQuality: {
      availabilityRate: kpis.imageAvailabilityRate,
      markingRate: kpis.markingRate,
      acceptableQualityRate: kpis.acceptableQualityRate,
      highQualityCount: kpis.highQualityCount,
      mediumQualityCount: kpis.mediumQualityCount,
      lowQualityCount: kpis.lowQualityCount,
    },
    employeeOverview: {
      inspectorIdentityMapped,
      evaluatedCount: new Set(
        factTable.filter((r) => r.inspectorId !== null).map((r) => r.inspectorId)
      ).size,
      totalDecisions: factTable.length,
      evaluableDecisions: evaluableDecisionRecords,
      reviewerProfiles,
      priorityReviewers,
      reviewerDisplayNames,
    },
    employeeByPort: aggregates.employeeByPortAndLevel,
    errorAnalysis: {
      byPort: aggregates.errorTypeByPort,
      totals: errorTotals,
    },
    actions: generateNarrativeFindings(kpis, input.config),
    exclusions: {
      note: "الصفوف المستبعدة موثّقة في تقرير معالجة المجتمع (processing.summary.json).",
    },
    dataQuality: {
      biAvailable: rows.some((r) => r.levelOneEmployeeId !== null || r.levelTwoEmployeeId !== null),
      inspectorIdentityMapped,
      totalDecisionRecords: factTable.length,
      evaluableDecisionRecords,
      overallBand: band(evaluableDecisionRecords, input.config.dataSufficiencyThresholds),
    },
    resultComparison: {
      images: comparisons,
      reviewerAgreement: aggregates.reviewerAgreement,
      crossTeamMatrix: aggregates.crossTeamMatrix,
    },
    reviewerKpis,
    dataSources,
    factTable,
    rows,
    kpis,
  };
}
