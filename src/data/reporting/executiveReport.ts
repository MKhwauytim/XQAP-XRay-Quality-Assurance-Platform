import * as XLSX from "xlsx";

import type { ExecutiveReportInput } from "./executiveReportTypes";
import {
  buildExecutiveReportRows,
  calculateExecutiveKPIs,
} from "./executiveReportData";

// ─── Main builder (re-exported from the new dark-navy viewer module) ──────────
export { buildExecutiveReport, openExecutiveReport } from "./executive/index";

export function buildExecutiveXlsx(input: ExecutiveReportInput): void {
  const execRows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(execRows, input.sample, input.config);

  // Sheet 1: KPI summary
  const kpiSheet = [
    ["مؤشر", "القيمة"],
    ["الشهر", input.monthFolderName],
    [],
    ["إجمالي المجتمع", kpis.totalPopulation],
    ["إجمالي العينة", kpis.totalSample],
    ["تغطية المجتمع%", kpis.sampleCoverage?.toFixed(2) ?? ""],
    ["مدروسة", kpis.studiedImages],
    ["متبقية", kpis.remainingImages],
    ["إنجاز العينة%", kpis.completionRate?.toFixed(2) ?? ""],
    [],
    ["سليمة", kpis.cleanCount],
    ["اشتباه", kpis.suspiciousCount],
    ["نسبة الاشتباه%", kpis.suspicionRate?.toFixed(2) ?? ""],
    [],
    ["دقة نتيجة الصورة%", kpis.overallAccuracy?.toFixed(2) ?? ""],
    ["قوة اكتشاف الاشتباه%", kpis.suspiciousDetectionRate?.toFixed(2) ?? ""],
    ["اشتباه فائت%", kpis.missedSuspicionRate?.toFixed(2) ?? ""],
    ["دقة الاشتباه (الخصوصية)%", kpis.suspicionPrecision?.toFixed(2) ?? ""],
    ["مؤشر الجودة المتوازن%", kpis.balancedQualityScore?.toFixed(2) ?? ""],
    ["دقة المستوى الأول%", kpis.levelOneAccuracy?.toFixed(2) ?? ""],
    ["دقة المستوى الثاني%", kpis.levelTwoAccuracy?.toFixed(2) ?? ""],
    [],
    ["اشتباه مكتشف", kpis.correctSuspicious],
    ["سليمة مؤكدة", kpis.correctClean],
    ["اشتباه فائت (عدد)", kpis.missedSuspicious],
    ["اشتباه زائد", kpis.excessSuspicious],
    ["صور بتحقق صالح", kpis.validStudied],
    [],
    ["توفر الصور%", kpis.imageAvailabilityRate?.toFixed(2) ?? ""],
    ["صور متاحة", kpis.imageAvailableCount],
    ["صور غير متاحة", kpis.imageMissingCount],
    ["وجود التحديد%", kpis.markingRate?.toFixed(2) ?? ""],
    ["جودة عالية", kpis.highQualityCount],
    ["جودة متوسطة", kpis.mediumQualityCount],
    ["جودة منخفضة", kpis.lowQualityCount],
    ["الجودة المقبولة%", kpis.acceptableQualityRate?.toFixed(2) ?? ""],
  ];

  // Sheet 2: Port profiles
  const portSheet = [
    ["المنفذ", "المجتمع", "سليمة", "اشتباه", "نسبة الاشتباه%", "العينة", "التغطية%",
      "مدروسة", "إنجاز%", "دقة%", "اكتشاف الاشتباه%", "اشتباه فائت%",
      "دقة م.أول%", "دقة م.ثاني%", "التصنيف"],
    ...kpis.portProfiles.map((p) => [
      p.portName,
      p.population,
      p.clean,
      p.suspicious,
      p.suspicionRate?.toFixed(2) ?? "",
      p.sampleSize,
      p.coverage?.toFixed(2) ?? "",
      p.studied,
      p.completionRate?.toFixed(2) ?? "",
      p.accuracy?.toFixed(2) ?? "",
      p.suspiciousDetectionRate?.toFixed(2) ?? "",
      p.missedSuspicionRate?.toFixed(2) ?? "",
      p.levelOneAccuracy?.toFixed(2) ?? "",
      p.levelTwoAccuracy?.toFixed(2) ?? "",
      p.status,
    ]),
  ];

  // Sheet 3: Stage profiles
  const stageSheet = [
    ["المرحلة", "المجتمع", "العينة", "التغطية%", "مدروسة", "إنجاز%"],
    ...kpis.stageProfiles.map((s) => [
      s.stageLabel,
      s.population,
      s.sampleSize,
      s.coverage?.toFixed(2) ?? "",
      s.studied,
      s.completionRate?.toFixed(2) ?? "",
    ]),
  ];

  // Sheet 4: Image quality
  const imageQualitySheet = [
    ["المؤشر", "القيمة"],
    ["إجابات مكتملة", kpis.imagesWithSubmittedAnswers],
    ["صور متاحة", kpis.imageAvailableCount],
    ["صور غير متاحة", kpis.imageMissingCount],
    ["توفر الصور%", kpis.imageAvailabilityRate?.toFixed(2) ?? ""],
    ["يوجد تحديد", kpis.markingPresentCount],
    ["لا يوجد تحديد", kpis.markingMissingCount],
    ["نسبة التحديد%", kpis.markingRate?.toFixed(2) ?? ""],
    ["جودة عالية", kpis.highQualityCount],
    ["جودة متوسطة", kpis.mediumQualityCount],
    ["جودة منخفضة", kpis.lowQualityCount],
    ["الجودة المقبولة%", kpis.acceptableQualityRate?.toFixed(2) ?? ""],
    [],
    ["أسباب عدم وجود الصورة", "العدد", "النسبة%"],
    ...kpis.missingImageReasons.map((item) => [item.reason, item.count, item.percentage.toFixed(2)]),
    [],
    ["أسباب انخفاض الجودة", "العدد", "النسبة%"],
    ...kpis.lowQualityReasons.map((item) => [item.reason, item.count, item.percentage.toFixed(2)]),
  ];

  // Sheet 5: Result quality
  const resultQualitySheet = [
    ["المؤشر", "القيمة"],
    ["دقة نتيجة الصورة%", kpis.overallAccuracy?.toFixed(2) ?? ""],
    ["قوة اكتشاف الاشتباه%", kpis.suspiciousDetectionRate?.toFixed(2) ?? ""],
    ["اشتباه فائت%", kpis.missedSuspicionRate?.toFixed(2) ?? ""],
    ["دقة الاشتباه%", kpis.suspicionPrecision?.toFixed(2) ?? ""],
    ["اشتباه مكتشف", kpis.correctSuspicious],
    ["سليمة مؤكدة", kpis.correctClean],
    ["اشتباه فائت", kpis.missedSuspicious],
    ["اشتباه زائد", kpis.excessSuspicious],
  ];

  // Sheet 6: All individual image rows
  const rowSheet = [
    [
      "رقم الأشعة", "المنفذ", "المرحلة", "م.أول", "م.ثاني", "نتيجة الصورة",
      "في العينة", "الموظف", "حالة التوزيع", "نتيجة الخبير", "حالة الإجابة",
      "هل يوجد صورة", "سبب عدم وجود الصورة", "هل يوجد تحديد", "مستوى جودة الصورة",
      "سبب انخفاض الجودة", "تقييم الاشتباه", "الأصناف المشبوهة", "آلية التهريب المحتملة",
      "تاريخ التعيين", "تاريخ التسليم",
      "دقيق", "م.أول دقيق", "م.ثاني دقيق", "تصنيف التحقق",
    ],
    ...execRows.map((r) => [
      r.xrayImageId,
      r.portName ?? "",
      r.stage ?? "",
      r.levelOneResult,
      r.levelTwoResult,
      r.imageResult,
      r.selectedInSample ? "نعم" : "لا",
      r.assignedTo ?? "",
      r.distributionStatus ?? "",
      r.expertResult ?? "",
      r.answerStatus ?? "",
      r.imageAvailable === null ? "" : r.imageAvailable ? "نعم" : "لا",
      r.noImageReason ?? "",
      r.hasMarking === null ? "" : r.hasMarking ? "نعم" : "لا",
      r.imageQuality ?? "",
      r.lowQualityReason ?? "",
      r.suspicionLevel ?? "",
      r.suspectedTypes ?? "",
      r.smuggleMethod ?? "",
      r.assignedAt ?? "",
      r.submittedAt ?? "",
      r.imageResultAccurate === null ? "" : r.imageResultAccurate ? "نعم" : "لا",
      r.levelOneAccurate === null ? "" : r.levelOneAccurate ? "نعم" : "لا",
      r.levelTwoAccurate === null ? "" : r.levelTwoAccurate ? "نعم" : "لا",
      r.verificationCategory ?? "",
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiSheet), "الملخص التنفيذي");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(portSheet), "المنافذ والعينة");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stageSheet), "مستويات الدراسة");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(imageQualitySheet), "جودة الصور");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resultQualitySheet), "نتائج الفحص");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowSheet), "بيانات الصور");

  XLSX.writeFile(wb, `التقرير_التنفيذي_${input.monthFolderName}.xlsx`);
}


