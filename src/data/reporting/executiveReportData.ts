import type { SampleMasterData } from "../sampling/sampleTypes";
import type { FieldAnswer } from "../answers/answerTypes";
import type { TemplateSchema } from "../templates/templateTypes";
import type {
  ExecutiveReportRow,
  ExecutiveKPIs,
  ExecutiveReportConfig,
  ExecutiveReportInput,
  PortProfile,
  StageProfile,
} from "./executiveReportTypes";

type SubmittedAnswerInfo = {
  answers: FieldAnswer[];
  answerStatus: "draft" | "submitted";
  submittedAt: string | null;
};

function normalizeLabel(value: string): string {
  return value
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function createFieldResolver(template: TemplateSchema | null): Map<string, string> {
  const byLabel = new Map<string, string>();
  for (const field of template?.fields ?? []) {
    byLabel.set(normalizeLabel(field.label), field.fieldId);
  }
  return byLabel;
}

function answerValue(
  answers: FieldAnswer[],
  fieldIdsByLabel: Map<string, string>,
  label: string,
  fallbackFieldId?: string
): FieldAnswer["value"] | null {
  const fieldId = fieldIdsByLabel.get(normalizeLabel(label)) ?? fallbackFieldId;
  if (!fieldId) return null;
  return answers.find((answer) => answer.fieldId === fieldId)?.value ?? null;
}

function asText(value: FieldAnswer["value"]): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asYesNo(value: FieldAnswer["value"]): boolean | null {
  const text = asText(value);
  if (text === "نعم" || text === "yes" || text === "true") return true;
  if (text === "لا" || text === "no" || text === "false") return false;
  return null;
}

function asSuspicionResult(value: FieldAnswer["value"]): "سليمة" | "اشتباه" | null {
  const text = asText(value);
  return text === "سليمة" || text === "اشتباه" ? text : null;
}

function asQualityLevel(value: FieldAnswer["value"]): "عالي" | "متوسط" | "منخفض" | null {
  const text = asText(value);
  return text === "عالي" || text === "متوسط" || text === "منخفض" ? text : null;
}

function countReasons(values: Array<string | null>, denominator: number): ExecutiveKPIs["missingImageReasons"] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: denominator > 0 ? (count / denominator) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "ar"));
}

export function buildExecutiveReportRows(input: ExecutiveReportInput): ExecutiveReportRow[] {
  const { populationRows, sample, distribution, employeeFiles, config } = input;
  const fieldIdsByLabel = createFieldResolver(input.template);
  const fieldMap = config.fieldMappings;

  const sampleIds = new Set(sample?.rows.map((r) => r.xrayImageId) ?? []);

  const distMap = new Map(
    (distribution?.entries ?? []).map((e) => [e.xrayImageId, e])
  );

  // Build answer map: xrayImageId → submitted answer info
  // Submitted answers take priority over drafts
  const answerMap = new Map<
    string,
    SubmittedAnswerInfo
  >();

  for (const file of employeeFiles) {
    for (const item of file.items) {
      if (item.status === "submitted") {
        answerMap.set(item.xrayImageId, {
          answers: item.answers,
          answerStatus: "submitted",
          submittedAt: item.submittedAt,
        });
      } else if (!answerMap.has(item.xrayImageId)) {
        answerMap.set(item.xrayImageId, {
          answers: item.answers,
          answerStatus: "draft",
          submittedAt: null,
        });
      }
    }
  }

  return populationRows.map((pop): ExecutiveReportRow => {
    const levelOneResult = pop.xrayLevelOneResult;
    const levelTwoResult = pop.xrayLevelTwoResult;
    const imageResult: "سليمة" | "اشتباه" =
      levelOneResult === "اشتباه" || levelTwoResult === "اشتباه" ? "اشتباه" : "سليمة";

    const dist = distMap.get(pop.xrayImageId);
    const answer = answerMap.get(pop.xrayImageId);
    const answers = answer?.answers ?? [];
    const expertResult = asSuspicionResult(answerValue(
      answers,
      fieldIdsByLabel,
      fieldMap.resultValidityLabel,
      config.expertResultFieldId
    ));
    const imageAvailable = asYesNo(answerValue(answers, fieldIdsByLabel, fieldMap.hasImageLabel));
    const noImageReason = asText(answerValue(answers, fieldIdsByLabel, fieldMap.noImageReasonLabel));
    const hasMarking = asYesNo(answerValue(answers, fieldIdsByLabel, fieldMap.hasMarkingLabel));
    const imageQuality = asQualityLevel(answerValue(answers, fieldIdsByLabel, fieldMap.imageQualityLabel));
    const lowQualityReason = asText(answerValue(answers, fieldIdsByLabel, fieldMap.lowQualityReasonLabel));
    const suspicionLevel = asQualityLevel(answerValue(answers, fieldIdsByLabel, fieldMap.suspicionLevelLabel));
    const suspectedTypes = asText(answerValue(answers, fieldIdsByLabel, fieldMap.suspectedTypesLabel));
    const smuggleMethod = asText(answerValue(answers, fieldIdsByLabel, fieldMap.smuggleMethodLabel));

    let imageResultAccurate: boolean | null = null;
    let levelOneAccurate: boolean | null = null;
    let levelTwoAccurate: boolean | null = null;
    let verificationCategory: ExecutiveReportRow["verificationCategory"] = null;

    if (expertResult !== null) {
      imageResultAccurate = imageResult === expertResult;
      levelOneAccurate = levelOneResult === expertResult;
      levelTwoAccurate = levelTwoResult === expertResult;

      if (imageResult === "اشتباه" && expertResult === "اشتباه") verificationCategory = "correct-suspicious";
      else if (imageResult === "سليمة" && expertResult === "سليمة") verificationCategory = "correct-clean";
      else if (imageResult === "اشتباه" && expertResult === "سليمة") verificationCategory = "excess-suspicious";
      else verificationCategory = "missed-suspicious";
    }

    return {
      xrayImageId: pop.xrayImageId,
      portCode: pop.portCode,
      portName: pop.portName,
      portType: pop.portType,
      movementType: pop.movementType,
      stage: pop.stage,
      levelOneEmployeeId: pop.levelOneEmployee ?? null,
      levelTwoEmployeeId: pop.levelTwoEmployee ?? null,
      levelOneResult,
      levelTwoResult,
      imageResult,
      selectedInSample: sampleIds.has(pop.xrayImageId),
      assignedTo: dist?.assignedTo ?? null,
      distributionStatus: dist?.status ?? null,
      expertResult,
      imageAvailable,
      noImageReason,
      hasMarking,
      imageQuality,
      lowQualityReason,
      suspicionLevel,
      suspectedTypes,
      smuggleMethod,
      answerStatus: answer?.answerStatus ?? null,
      assignedAt: dist?.lastEventAt ?? null,
      submittedAt: answer?.submittedAt ?? null,
      imageResultAccurate,
      levelOneAccurate,
      levelTwoAccurate,
      verificationCategory,
      otherResults: {
        manual: { result: pop.otherResults.manual.result, employeeId: pop.otherResults.manual.employeeId },
        opposite: { result: pop.otherResults.opposite.result, employeeId: pop.otherResults.opposite.employeeId },
        liveMeans: { result: pop.otherResults.liveMeans.result, employeeId: pop.otherResults.liveMeans.employeeId },
      },
      notes: pop.notes,
    };
  });
}

export function calculateExecutiveKPIs(
  rows: ExecutiveReportRow[],
  sample: SampleMasterData | null,
  config: ExecutiveReportConfig
): ExecutiveKPIs {
  const totalPopulation = rows.length;
  const totalSample = sample?.totalActual ?? rows.filter((r) => r.selectedInSample).length;
  const sampleCoverage = totalPopulation > 0 ? (totalSample / totalPopulation) * 100 : 0;

  const suspiciousCount = rows.filter((r) => r.imageResult === "اشتباه").length;
  const cleanCount = rows.filter((r) => r.imageResult === "سليمة").length;
  const suspicionRate = rows.length > 0 ? (suspiciousCount / rows.length) * 100 : 0;

  const sampleRows = rows.filter((r) => r.selectedInSample);
  const studiedImages = sampleRows.filter((r) => r.answerStatus === "submitted").length;
  const remainingImages = Math.max(0, totalSample - studiedImages);
  const completionRate = totalSample > 0 ? (studiedImages / totalSample) * 100 : 0;

  // Verification categories (submitted answers only)
  const correctSuspicious = rows.filter((r) => r.verificationCategory === "correct-suspicious").length;
  const correctClean = rows.filter((r) => r.verificationCategory === "correct-clean").length;
  const missedSuspicious = rows.filter((r) => r.verificationCategory === "missed-suspicious").length;
  const excessSuspicious = rows.filter((r) => r.verificationCategory === "excess-suspicious").length;
  const validStudied = correctSuspicious + correctClean + missedSuspicious + excessSuspicious;

  const overallAccuracy = validStudied > 0 ? ((correctSuspicious + correctClean) / validStudied) * 100 : null;

  const expertSuspicious = correctSuspicious + missedSuspicious;
  const suspiciousDetectionRate = expertSuspicious > 0 ? (correctSuspicious / expertSuspicious) * 100 : null;
  const missedSuspicionRate = expertSuspicious > 0 ? (missedSuspicious / expertSuspicious) * 100 : null;

  const originalSuspicious = correctSuspicious + excessSuspicious;
  const suspicionPrecision = originalSuspicious > 0 ? (correctSuspicious / originalSuspicious) * 100 : null;

  const originalClean = correctClean + excessSuspicious;
  const cleanConfirmationRate = originalClean > 0 ? (correctClean / originalClean) * 100 : null;
  const excessSuspicionRate = originalSuspicious > 0 ? (excessSuspicious / originalSuspicious) * 100 : null;

  const balancedQualityScore =
    suspiciousDetectionRate !== null && cleanConfirmationRate !== null
      ? (suspiciousDetectionRate + cleanConfirmationRate) / 2
      : null;

  // Level accuracy
  const studiedWithExpert = rows.filter((r) => r.expertResult !== null);
  const levelOneCorrect = studiedWithExpert.filter((r) => r.levelOneAccurate === true).length;
  const levelTwoCorrect = studiedWithExpert.filter((r) => r.levelTwoAccurate === true).length;
  const levelOneAccuracy = validStudied > 0 ? (levelOneCorrect / validStudied) * 100 : null;
  const levelTwoAccuracy = validStudied > 0 ? (levelTwoCorrect / validStudied) * 100 : null;

  // Level disagreement (whole population, not just studied)
  const bothLevelsCount = rows.length;
  const disagreementCount = rows.filter((r) => r.levelOneResult !== r.levelTwoResult).length;
  const levelDisagreementRate = bothLevelsCount > 0 ? (disagreementCount / bothLevelsCount) * 100 : null;

  // L2 correction and regression rates
  const l1Wrong = studiedWithExpert.filter((r) => r.levelOneAccurate === false);
  const l1Right = studiedWithExpert.filter((r) => r.levelOneAccurate === true);
  const levelTwoCorrectionRate =
    l1Wrong.length > 0 ? (l1Wrong.filter((r) => r.levelTwoAccurate === true).length / l1Wrong.length) * 100 : null;
  const levelTwoRegressionRate =
    l1Right.length > 0 ? (l1Right.filter((r) => r.levelTwoAccurate === false).length / l1Right.length) * 100 : null;

  const submittedRows = rows.filter((r) => r.answerStatus === "submitted");
  const imagesWithSubmittedAnswers = submittedRows.length;
  const imageAvailableCount = submittedRows.filter((r) => r.imageAvailable === true).length;
  const imageMissingCount = submittedRows.filter((r) => r.imageAvailable === false).length;
  const imageAvailabilityDenominator = imageAvailableCount + imageMissingCount;
  const imageAvailabilityRate =
    imageAvailabilityDenominator > 0 ? (imageAvailableCount / imageAvailabilityDenominator) * 100 : null;

  const markingRows = submittedRows.filter((r) => r.hasMarking !== null);
  const markingPresentCount = markingRows.filter((r) => r.hasMarking === true).length;
  const markingMissingCount = markingRows.filter((r) => r.hasMarking === false).length;
  const markingRate = markingRows.length > 0 ? (markingPresentCount / markingRows.length) * 100 : null;

  const highQualityCount = submittedRows.filter((r) => r.imageQuality === "عالي").length;
  const mediumQualityCount = submittedRows.filter((r) => r.imageQuality === "متوسط").length;
  const lowQualityCount = submittedRows.filter((r) => r.imageQuality === "منخفض").length;
  const imageQualityEvaluatedCount = highQualityCount + mediumQualityCount + lowQualityCount;
  const acceptableQualityRate =
    imageQualityEvaluatedCount > 0 ? ((highQualityCount + mediumQualityCount) / imageQualityEvaluatedCount) * 100 : null;
  const missingImageReasons = countReasons(
    submittedRows.filter((r) => r.imageAvailable === false).map((r) => r.noImageReason),
    imageMissingCount
  );
  const lowQualityReasons = countReasons(
    submittedRows.filter((r) => r.imageQuality === "منخفض" || r.imageQuality === "متوسط").map((r) => r.lowQualityReason),
    Math.max(1, lowQualityCount + mediumQualityCount)
  );

  // Port profiles
  const portMap = new Map<string, ExecutiveReportRow[]>();
  for (const row of rows) {
    const key = row.portName ?? "غير محدد";
    const arr = portMap.get(key) ?? [];
    arr.push(row);
    portMap.set(key, arr);
  }

  const portProfiles: PortProfile[] = [];
  for (const [portName, portRows] of portMap) {
    const population = portRows.length;
    const clean = portRows.filter((r) => r.imageResult === "سليمة").length;
    const suspicious = portRows.filter((r) => r.imageResult === "اشتباه").length;
    const portSuspicionRate = population > 0 ? (suspicious / population) * 100 : 0;

    const samplePortRows = portRows.filter((r) => r.selectedInSample);
    const sampleSize = samplePortRows.length;
    const coverage = population > 0 ? (sampleSize / population) * 100 : 0;
    const studied = samplePortRows.filter((r) => r.answerStatus === "submitted").length;
    const completionRatePort = sampleSize > 0 ? (studied / sampleSize) * 100 : 0;

    const portValid = portRows.filter((r) => r.verificationCategory !== null);
    const portStudied = portValid.length;
    const isReliable = portStudied >= config.minimumReliableSampleSize;

    const portCorrect = portValid.filter((r) => r.imageResultAccurate === true).length;
    const accuracy = isReliable ? (portCorrect / portStudied) * 100 : null;

    const portExpertSusp = portValid.filter(
      (r) => r.verificationCategory === "correct-suspicious" || r.verificationCategory === "missed-suspicious"
    ).length;
    const portMissed = portValid.filter((r) => r.verificationCategory === "missed-suspicious").length;
    const portCorrectSusp = portValid.filter((r) => r.verificationCategory === "correct-suspicious").length;
    const suspiciousDetectionRatePort =
      isReliable && portExpertSusp > 0 ? (portCorrectSusp / portExpertSusp) * 100 : null;
    const missedSuspicionRatePort =
      isReliable && portExpertSusp > 0 ? (portMissed / portExpertSusp) * 100 : null;

    const portL1Correct = portValid.filter((r) => r.levelOneAccurate === true).length;
    const portL2Correct = portValid.filter((r) => r.levelTwoAccurate === true).length;
    const levelOneAccuracyPort = isReliable ? (portL1Correct / portStudied) * 100 : null;
    const levelTwoAccuracyPort = isReliable ? (portL2Correct / portStudied) * 100 : null;

    let status: PortProfile["status"] = "insufficient";
    if (isReliable && accuracy !== null && missedSuspicionRatePort !== null) {
      if (accuracy >= config.accuracyTarget + 3 && missedSuspicionRatePort <= config.maximumMissedSuspicionRate / 2) {
        status = "excellent";
      } else if (accuracy >= config.accuracyTarget && missedSuspicionRatePort <= config.maximumMissedSuspicionRate) {
        status = "stable";
      } else if (accuracy >= config.accuracyTarget - 5) {
        status = "monitor";
      } else {
        status = "priority";
      }
    } else if (isReliable && accuracy !== null) {
      status = accuracy >= config.accuracyTarget ? "stable" : "monitor";
    }

    portProfiles.push({
      portName,
      population,
      clean,
      suspicious,
      suspicionRate: portSuspicionRate,
      sampleSize,
      coverage,
      studied,
      completionRate: completionRatePort,
      accuracy,
      suspiciousDetectionRate: suspiciousDetectionRatePort,
      missedSuspicionRate: missedSuspicionRatePort,
      levelOneAccuracy: levelOneAccuracyPort,
      levelTwoAccuracy: levelTwoAccuracyPort,
      status,
    });
  }
  portProfiles.sort((a, b) => b.population - a.population);

  // Stage profiles
  const stageProfiles: StageProfile[] = [];
  if (sample?.stageAllocations && sample.stageAllocations.length > 0) {
    for (const alloc of sample.stageAllocations) {
      const stageStudied = rows.filter(
        (r) => r.selectedInSample && r.answerStatus === "submitted" && r.stage === alloc.stageLabel
      ).length;
      const completionRateStage = alloc.actualDrawn > 0 ? (stageStudied / alloc.actualDrawn) * 100 : 0;
      stageProfiles.push({
        stageKey: alloc.stageKey,
        stageLabel: alloc.stageLabel,
        population: alloc.populationSize,
        sampleSize: alloc.actualDrawn,
        coverage: alloc.populationSize > 0 ? (alloc.actualDrawn / alloc.populationSize) * 100 : 0,
        studied: stageStudied,
        completionRate: completionRateStage,
      });
    }
  } else {
    const stageMap = new Map<string, ExecutiveReportRow[]>();
    for (const row of rows) {
      const key = row.stage ?? "غير محدد";
      const arr = stageMap.get(key) ?? [];
      arr.push(row);
      stageMap.set(key, arr);
    }
    let i = 0;
    for (const [stageLabel, stageRows] of stageMap) {
      const sampleSize = stageRows.filter((r) => r.selectedInSample).length;
      const stageStudied = stageRows.filter((r) => r.selectedInSample && r.answerStatus === "submitted").length;
      stageProfiles.push({
        stageKey: String(i++),
        stageLabel,
        population: stageRows.length,
        sampleSize,
        coverage: stageRows.length > 0 ? (sampleSize / stageRows.length) * 100 : 0,
        studied: stageStudied,
        completionRate: sampleSize > 0 ? (stageStudied / sampleSize) * 100 : 0,
      });
    }
  }

  return {
    totalPopulation,
    totalSample,
    sampleCoverage,
    studiedImages,
    remainingImages,
    completionRate,
    suspiciousCount,
    cleanCount,
    suspicionRate,
    overallAccuracy,
    suspiciousDetectionRate,
    missedSuspicionRate,
    suspicionPrecision,
    cleanConfirmationRate,
    excessSuspicionRate,
    balancedQualityScore,
    levelOneAccuracy,
    levelTwoAccuracy,
    levelDisagreementRate,
    levelTwoCorrectionRate,
    levelTwoRegressionRate,
    correctSuspicious,
    correctClean,
    missedSuspicious,
    excessSuspicious,
    validStudied,
    imagesWithSubmittedAnswers,
    imageAvailableCount,
    imageMissingCount,
    imageAvailabilityRate,
    markingPresentCount,
    markingMissingCount,
    markingRate,
    highQualityCount,
    mediumQualityCount,
    lowQualityCount,
    imageQualityEvaluatedCount,
    acceptableQualityRate,
    missingImageReasons,
    lowQualityReasons,
    monthlyTarget: config.monthlyTarget,
    portProfiles,
    stageProfiles,
  };
}

export function generateNarrativeFindings(
  kpis: ExecutiveKPIs,
  config: ExecutiveReportConfig
): string[] {
  const findings: string[] = [];

  // Achievement or completion risk
  if (
    kpis.overallAccuracy !== null &&
    kpis.overallAccuracy >= config.accuracyTarget &&
    kpis.completionRate >= config.completionTarget
  ) {
    findings.push(
      `تجاوز أداء الإدارة المستهدفين الرئيسيين: الدقة ${fmtPct(kpis.overallAccuracy)} والإنجاز ${fmtPct(kpis.completionRate)}، ويعكس ذلك مستوى جودة مستقراً ينبغي الحفاظ عليه.`
    );
  } else if (kpis.completionRate < config.completionTarget && config.completionTarget > 0) {
    findings.push(
      `تبلغ نسبة الإنجاز ${fmtPct(kpis.completionRate)} وهي دون المستهدف ${fmtPct(config.completionTarget)}، ويستدعي ذلك تسريع وتيرة الدراسة لاستكمال العينة خلال الفترة المتبقية من الشهر.`
    );
  }

  // Quality risk
  if (kpis.missedSuspicionRate !== null && kpis.missedSuspicionRate > config.maximumMissedSuspicionRate) {
    findings.push(
      `تجاوزت نسبة الاشتباه الفائت ${fmtPct(kpis.missedSuspicionRate)} الحد المقبول (${fmtPct(config.maximumMissedSuspicionRate)})، وهو مؤشر خطر يستوجب مراجعة الحالات المصنفة سليمة والتحقق من دقتها.`
    );
  }

  // Port intervention
  const priorityPorts = kpis.portProfiles.filter((p) => p.status === "priority");
  if (priorityPorts.length > 0) {
    const names = priorityPorts
      .slice(0, 2)
      .map((p) => p.portName)
      .join(" و");
    findings.push(
      `${priorityPorts.length > 1 ? `${priorityPorts.length} منافذ تحتاج` : "منفذ يحتاج"} تدخلاً عاجلاً: ${names}. تتميز بانخفاض في الدقة ومعدل مرتفع للاشتباه الفائت؛ يُوصى بمراجعة مركزة وخطة تصحيحية.`
    );
  }

  if (findings.length === 0) {
    findings.push(
      `تم استلام وتحليل بيانات الشهر. إجمالي المجتمع ${fmtNum(kpis.totalPopulation)} صورة، تم اختيار عينة ${fmtNum(kpis.totalSample)} صورة للدراسة.`
    );
  }

  return findings.slice(0, 3);
}

// Formatting helpers used by the data module and re-exported for the HTML builder
export function fmtNum(n: number): string {
  return n.toLocaleString("ar-SA-u-nu-latn");
}

export function fmtPct(n: number | null, decimals = 1): string {
  if (n === null) return "—";
  return `${n.toFixed(decimals)}%`;
}

export function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
