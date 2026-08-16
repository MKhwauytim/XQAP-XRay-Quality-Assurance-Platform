import { describe, expect, it } from "vitest";

import type { SampleMasterData } from "../sampling/sampleTypes";
import { calculateExecutiveKPIs } from "./executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";
import type { ExecutiveReportRow } from "./executiveReportTypes";

/**
 * GOLDEN MASTER (Slice 0) — `calculateExecutiveKPIs`.
 *
 * Every number the executive report (deck2 / document / workbook / viewer)
 * renders comes out of this one function, so it is deterministic by contract:
 * fixed rows + fixed sample + fixed config must produce the exact same KPI
 * object. Recorded as OBSERVED; the comments flag the values that are
 * counter-intuitive rather than "fixing" them.
 *
 * No Date.now(), no randomness, no I/O.
 */

function row(over: Partial<ExecutiveReportRow> & { xrayImageId: string }): ExecutiveReportRow {
  return {
    portCode: "P1",
    portName: "بري",
    portType: "بري",
    movementType: "LAND",
    stage: "1",
    levelOneEmployeeId: "L1",
    levelTwoEmployeeId: "L2",
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
    ...over,
  };
}

/**
 * 10 rows: one per verification category, plus an unsampled clean row, a
 * sampled-but-unanswered row, a draft answer, and a second port so the port
 * profiles have something to separate.
 */
const GOLDEN_ROWS: ExecutiveReportRow[] = [
  // correct-clean, high quality, marked, image available
  row({
    xrayImageId: "img-1",
    selectedInSample: true,
    answerStatus: "submitted",
    expertResult: "سليمة",
    imageResult: "سليمة",
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    levelOneAccurate: true,
    levelTwoAccurate: true,
    imageResultAccurate: true,
    verificationCategory: "correct-clean",
    imageAvailable: true,
    hasMarking: true,
    imageQuality: "عالي",
    assignedTo: "emp-a",
  }),
  // correct-suspicious, L1 wrong / L2 right (feeds the correction rate)
  row({
    xrayImageId: "img-2",
    selectedInSample: true,
    answerStatus: "submitted",
    expertResult: "اشتباه",
    imageResult: "اشتباه",
    levelOneResult: "سليمة",
    levelTwoResult: "اشتباه",
    levelOneAccurate: false,
    levelTwoAccurate: true,
    imageResultAccurate: true,
    verificationCategory: "correct-suspicious",
    imageAvailable: true,
    hasMarking: false,
    imageQuality: "متوسط",
    lowQualityReason: "ضوضاء",
    assignedTo: "emp-a",
  }),
  // missed-suspicious, L1 right / L2 wrong (feeds the regression rate)
  row({
    xrayImageId: "img-3",
    selectedInSample: true,
    answerStatus: "submitted",
    expertResult: "اشتباه",
    imageResult: "سليمة",
    levelOneResult: "اشتباه",
    levelTwoResult: "سليمة",
    levelOneAccurate: true,
    levelTwoAccurate: false,
    imageResultAccurate: false,
    verificationCategory: "missed-suspicious",
    imageAvailable: false,
    noImageReason: "الصورة محذوفة",
    imageQuality: "منخفض",
    lowQualityReason: "ضوضاء",
    assignedTo: "emp-b",
    portName: "بحري",
    portCode: "P2",
  }),
  // excess-suspicious
  row({
    xrayImageId: "img-4",
    selectedInSample: true,
    answerStatus: "submitted",
    expertResult: "سليمة",
    imageResult: "اشتباه",
    levelOneResult: "اشتباه",
    levelTwoResult: "اشتباه",
    levelOneAccurate: false,
    levelTwoAccurate: false,
    imageResultAccurate: false,
    verificationCategory: "excess-suspicious",
    imageAvailable: false,
    noImageReason: "خطأ في النظام",
    assignedTo: "emp-b",
    portName: "بحري",
    portCode: "P2",
  }),
  // sampled, assigned, no answer yet
  row({ xrayImageId: "img-5", selectedInSample: true, assignedTo: "emp-a", distributionStatus: "pending" }),
  // sampled, draft answer only (never counts as studied)
  row({
    xrayImageId: "img-6",
    selectedInSample: true,
    answerStatus: "draft",
    assignedTo: "emp-a",
    imageAvailable: true,
    imageQuality: "عالي",
  }),
  // unsampled population rows
  row({ xrayImageId: "img-7" }),
  row({ xrayImageId: "img-8", levelOneResult: "اشتباه", levelTwoResult: "اشتباه", imageResult: "اشتباه" }),
  row({ xrayImageId: "img-9", portName: "بحري", portCode: "P2" }),
  // level disagreement without any expert review
  row({ xrayImageId: "img-10", levelOneResult: "اشتباه", levelTwoResult: "سليمة", imageResult: "اشتباه" }),
];

const SAMPLE: SampleMasterData = {
  rngSeed: "golden",
  samplingAlgorithmVersion: "1.0",
  totalRequested: 6,
  totalActual: 6,
  certScanRequested: 0,
  nonCertScanRequested: 6,
  certScanActual: 0,
  nonCertScanActual: 6,
  portAllocations: [],
  stageAllocations: [],
  certScanShortfalls: [],
  drawnAt: "2026-05-01T00:00:00.000Z",
  drawnBy: "admin",
  rows: [],
};

describe("calculateExecutiveKPIs — golden master", () => {
  const kpis = calculateExecutiveKPIs(GOLDEN_ROWS, SAMPLE, DEFAULT_EXEC_CONFIG);

  it("pins the population / sample / completion block", () => {
    expect({
      totalPopulation: kpis.totalPopulation,
      totalSample: kpis.totalSample,
      sampleCoverage: kpis.sampleCoverage,
      studiedImages: kpis.studiedImages,
      remainingImages: kpis.remainingImages,
      completionRate: kpis.completionRate,
      suspiciousCount: kpis.suspiciousCount,
      cleanCount: kpis.cleanCount,
      suspicionRate: kpis.suspicionRate,
      monthlyTarget: kpis.monthlyTarget,
    }).toEqual({
      totalPopulation: 10,
      // Sourced from sample.totalActual, NOT from counting selectedInSample.
      totalSample: 6,
      sampleCoverage: 60,
      studiedImages: 4,
      remainingImages: 2,
      completionRate: (4 / 6) * 100,
      suspiciousCount: 4,
      cleanCount: 6,
      suspicionRate: 40,
      monthlyTarget: DEFAULT_EXEC_CONFIG.monthlyTarget,
    });
  });

  it("pins the verification-category block and the accuracy ratios derived from it", () => {
    expect({
      correctSuspicious: kpis.correctSuspicious,
      correctClean: kpis.correctClean,
      missedSuspicious: kpis.missedSuspicious,
      excessSuspicious: kpis.excessSuspicious,
      validStudied: kpis.validStudied,
      overallAccuracy: kpis.overallAccuracy,
      suspiciousDetectionRateByImage: kpis.suspiciousDetectionRateByImage,
      missedSuspicionRateByImage: kpis.missedSuspicionRateByImage,
      suspicionPrecision: kpis.suspicionPrecision,
      cleanConfirmationRate: kpis.cleanConfirmationRate,
      excessSuspicionRate: kpis.excessSuspicionRate,
      balancedQualityScore: kpis.balancedQualityScore,
    }).toEqual({
      correctSuspicious: 1,
      correctClean: 1,
      missedSuspicious: 1,
      excessSuspicious: 1,
      validStudied: 4,
      overallAccuracy: 50,
      suspiciousDetectionRateByImage: 50,
      missedSuspicionRateByImage: 50,
      suspicionPrecision: 50,
      // SURPRISE: `originalClean` is computed as correctClean + excessSuspicious
      // (executiveReportData.ts:238). An "excess-suspicious" image is one the
      // department called suspicious and the expert called clean — so it is NOT
      // an image the department originally called clean. The denominator here
      // therefore mixes two different "original" verdicts.
      cleanConfirmationRate: 50,
      excessSuspicionRate: 50,
      balancedQualityScore: 50,
    });
  });

  it("pins the level-accuracy block", () => {
    expect({
      levelOneAccuracy: kpis.levelOneAccuracy,
      levelTwoAccuracy: kpis.levelTwoAccuracy,
      levelDisagreementRate: kpis.levelDisagreementRate,
      levelTwoCorrectionRate: kpis.levelTwoCorrectionRate,
      levelTwoRegressionRate: kpis.levelTwoRegressionRate,
    }).toEqual({
      levelOneAccuracy: 50, // 2 of 4 valid-studied
      levelTwoAccuracy: 50,
      // Whole population (10 rows), not just the studied ones: img-2, img-3
      // and img-10 disagree between L1 and L2.
      levelDisagreementRate: 30,
      levelTwoCorrectionRate: 50, // of 2 L1-wrong rows, 1 was fixed by L2
      levelTwoRegressionRate: 50, // of 2 L1-right rows, 1 was broken by L2
    });
  });

  it("pins the image-quality / availability / marking block", () => {
    expect({
      imagesWithSubmittedAnswers: kpis.imagesWithSubmittedAnswers,
      imageAvailableCount: kpis.imageAvailableCount,
      imageMissingCount: kpis.imageMissingCount,
      imageAvailabilityRate: kpis.imageAvailabilityRate,
      markingPresentCount: kpis.markingPresentCount,
      markingMissingCount: kpis.markingMissingCount,
      markingRate: kpis.markingRate,
      highQualityCount: kpis.highQualityCount,
      mediumQualityCount: kpis.mediumQualityCount,
      lowQualityCount: kpis.lowQualityCount,
      imageQualityEvaluatedCount: kpis.imageQualityEvaluatedCount,
      acceptableQualityRate: kpis.acceptableQualityRate,
    }).toEqual({
      // Only `submitted` rows count — the draft row (img-6) is excluded even
      // though it carries imageAvailable/imageQuality answers.
      imagesWithSubmittedAnswers: 4,
      imageAvailableCount: 2,
      imageMissingCount: 2,
      imageAvailabilityRate: 50,
      markingPresentCount: 1,
      markingMissingCount: 1,
      markingRate: 50,
      highQualityCount: 1,
      mediumQualityCount: 1,
      lowQualityCount: 1,
      imageQualityEvaluatedCount: 3,
      acceptableQualityRate: (2 / 3) * 100,
    });
  });

  it("pins the reason breakdowns, including the medium-quality denominator quirk", () => {
    expect(kpis.missingImageReasons).toEqual([
      { reason: "الصورة محذوفة", count: 1, percentage: 50 },
      { reason: "خطأ في النظام", count: 1, percentage: 50 },
    ]);
    // SURPRISE: lowQualityReasons is collected from BOTH منخفض and متوسط rows
    // but its denominator is `Math.max(1, lowQualityCount + mediumQualityCount)`
    // (executiveReportData.ts:289-292), which never falls back to the number of
    // rows that actually had a reason — so the percentages are shares of the
    // quality-flagged population, not of the reasons collected.
    expect(kpis.lowQualityReasons).toEqual([{ reason: "ضوضاء", count: 2, percentage: 100 }]);
  });

  it("pins the port profiles (sorted by population desc) and the reliability gate", () => {
    expect(kpis.portProfiles).toEqual([
      {
        portName: "بري",
        population: 7,
        clean: 4,
        suspicious: 3,
        suspicionRate: (3 / 7) * 100,
        sampleSize: 4,
        coverage: (4 / 7) * 100,
        studied: 2,
        completionRate: 50,
        // SURPRISE: all three accuracy figures are hard-nulled — not "computed
        // from a small sample" — because `reliable` gates on
        // minimumReliableSampleSize (30) while this port has 2 evaluable
        // images. Any month with fewer than 30 reviewed images per port
        // renders a port table of dashes, and `status` collapses to
        // "insufficient" for every port regardless of the real accuracy.
        accuracyByImage: null,
        suspiciousDetectionRateByImage: null,
        missedSuspicionRateByImage: null,
        status: "insufficient",
      },
      {
        portName: "بحري",
        population: 3,
        clean: 2,
        suspicious: 1,
        suspicionRate: (1 / 3) * 100,
        sampleSize: 2,
        coverage: (2 / 3) * 100,
        studied: 2,
        completionRate: 100,
        accuracyByImage: null,
        suspiciousDetectionRateByImage: null,
        missedSuspicionRateByImage: null,
        status: "insufficient",
      },
    ]);
  });

  it("SURPRISE: with no stageAllocations, stage profiles key on the ARRAY INDEX and label with the raw stage value", () => {
    // executiveKpiProfiles.ts (buildStageProfiles fallback branch) emits
    // `stageKey: String(index)` and uses the raw `row.stage` string as the
    // label — so a month whose sample master carries no stageAllocations
    // produces stage keys ("0", "1", …) that match nothing else in the app and
    // an un-localized label.
    expect(kpis.stageProfiles).toEqual([
      {
        stageKey: "0",
        stageLabel: "1",
        population: 10,
        sampleSize: 6,
        coverage: 60,
        studied: 4,
        completionRate: (4 / 6) * 100,
      },
    ]);
  });

  it("pins the stageAllocations-driven stage profiles (the normal path)", () => {
    const withStages = calculateExecutiveKPIs(
      GOLDEN_ROWS,
      {
        ...SAMPLE,
        stageAllocations: [
          {
            stageKey: "first",
            stageLabel: "المستوى الأول",
            populationSize: 10,
            targetQuota: 6,
            actualDrawn: 6,
            certScanDrawn: 0,
            nonCertScanDrawn: 6,
          },
        ],
      },
      DEFAULT_EXEC_CONFIG
    );
    expect(withStages.stageProfiles).toEqual([
      {
        stageKey: "first",
        stageLabel: "المستوى الأول",
        population: 10,
        sampleSize: 6,
        coverage: 60,
        // `studied` matches rows whose formatStageLabel(row.stage) equals the
        // allocation label — the fixture rows carry stage "1", which the
        // DEFAULT stage mappings resolve to "المستوى الأول".
        studied: 4,
        completionRate: (4 / 6) * 100,
      },
    ]);
  });

  it("SURPRISE: with no sample master, totalSample falls back to counting selectedInSample", () => {
    const noSample = calculateExecutiveKPIs(GOLDEN_ROWS, null, DEFAULT_EXEC_CONFIG);
    expect(noSample.totalSample).toBe(6);
    // And a sample master whose totalActual disagrees with the rows WINS —
    // coverage/completion are then computed against a number no row supports.
    const inflated = calculateExecutiveKPIs(
      GOLDEN_ROWS,
      { ...SAMPLE, totalActual: 100 },
      DEFAULT_EXEC_CONFIG
    );
    expect(inflated.totalSample).toBe(100);
    expect(inflated.sampleCoverage).toBe(1000);
    expect(inflated.remainingImages).toBe(96);
  });

  it("pins the empty-input shape (every ratio null, every count zero)", () => {
    const empty = calculateExecutiveKPIs([], null, DEFAULT_EXEC_CONFIG);
    expect({
      totalPopulation: empty.totalPopulation,
      totalSample: empty.totalSample,
      sampleCoverage: empty.sampleCoverage,
      completionRate: empty.completionRate,
      suspicionRate: empty.suspicionRate,
      overallAccuracy: empty.overallAccuracy,
      suspiciousDetectionRateByImage: empty.suspiciousDetectionRateByImage,
      missedSuspicionRateByImage: empty.missedSuspicionRateByImage,
      suspicionPrecision: empty.suspicionPrecision,
      cleanConfirmationRate: empty.cleanConfirmationRate,
      excessSuspicionRate: empty.excessSuspicionRate,
      balancedQualityScore: empty.balancedQualityScore,
      levelOneAccuracy: empty.levelOneAccuracy,
      levelTwoAccuracy: empty.levelTwoAccuracy,
      // SURPRISE: every other ratio degrades to null on empty input, but
      // levelDisagreementRate degrades to null too — while sampleCoverage,
      // completionRate and suspicionRate degrade to 0 instead. The report has
      // to handle both "no data" encodings.
      levelDisagreementRate: empty.levelDisagreementRate,
      levelTwoCorrectionRate: empty.levelTwoCorrectionRate,
      levelTwoRegressionRate: empty.levelTwoRegressionRate,
      acceptableQualityRate: empty.acceptableQualityRate,
      imageAvailabilityRate: empty.imageAvailabilityRate,
      markingRate: empty.markingRate,
      missingImageReasons: empty.missingImageReasons,
      lowQualityReasons: empty.lowQualityReasons,
      portProfiles: empty.portProfiles,
      stageProfiles: empty.stageProfiles,
    }).toEqual({
      totalPopulation: 0,
      totalSample: 0,
      sampleCoverage: 0,
      completionRate: 0,
      suspicionRate: 0,
      overallAccuracy: null,
      suspiciousDetectionRateByImage: null,
      missedSuspicionRateByImage: null,
      suspicionPrecision: null,
      cleanConfirmationRate: null,
      excessSuspicionRate: null,
      balancedQualityScore: null,
      levelOneAccuracy: null,
      levelTwoAccuracy: null,
      levelDisagreementRate: null,
      levelTwoCorrectionRate: null,
      levelTwoRegressionRate: null,
      acceptableQualityRate: null,
      imageAvailabilityRate: null,
      markingRate: null,
      missingImageReasons: [],
      lowQualityReasons: [],
      portProfiles: [],
      stageProfiles: [],
    });
  });

  it("is stable across repeated invocations", () => {
    expect(calculateExecutiveKPIs(GOLDEN_ROWS, SAMPLE, DEFAULT_EXEC_CONFIG)).toEqual(kpis);
  });
});
