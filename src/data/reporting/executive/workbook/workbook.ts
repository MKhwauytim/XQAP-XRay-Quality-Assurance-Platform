import * as XLSX from "xlsx";

import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildReportModel } from "../model/reportModel";
import type { ReportModel } from "../model/reportModel";
import type { DecisionRecord, ResultSource } from "../model/decisionFactTable";
import {
  sourceRevisionsSheetAoa,
  SOURCE_REVISIONS_SHEET_NAME_AR,
  hasSourceRevisions,
} from "../../sourceRevisions";
import { yieldToMain } from "../../../storage/yieldToMain";

// Population-scale sheet builders (rowSheet, rawRiskSheet, resultComparisonSheet)
// chunk their row-array construction with a main-thread yield between chunks
// (same idiom as distributionReport.ts/sampleReport.ts) so a large population
// doesn't block the UI thread for the whole build.
const EXPORT_CHUNK_SIZE = 1000;

/**
 * Deliverable C — The Workbook (design spec §7).
 *
 * Expands the legacy 6-sheet `buildExecutiveXlsx` into the full
 * raw → processed → analytical chain, all sourced from the single `ReportModel`
 * (built ONCE here) plus the raw `populationRows` for the as-ingested sheets.
 * Renderers display; they never recompute (governing principle, design §2).
 *
 * Honesty discipline (§3.7): an empty denominator renders as a blank cell
 * (`""`), never `0%`; a missing value renders `—`; a true zero renders `0`.
 */

// ─── Cell / value helpers (missing / zero / N-A discipline, §3.7) ────────────

type Cell = string | number;

/** Em-dash placeholder for a missing value (§3.7). */
const DASH = "—";

/** Percentage cell: blank when the denominator was empty (null), never `0%`. */
function pct(value: number | null | undefined): Cell {
  return value === null || value === undefined ? "" : Number(value.toFixed(2));
}

/** Plain text cell: `—` when missing/blank, otherwise the trimmed value. */
function text(value: string | null | undefined): Cell {
  if (value === null || value === undefined) return DASH;
  const trimmed = value.trim();
  return trimmed === "" ? DASH : trimmed;
}

/** A result value (سليمة / اشتباه) or `—` when the source did not act. */
function result(value: "سليمة" | "اشتباه" | null | undefined): Cell {
  return value === null || value === undefined ? DASH : value;
}

/** A boolean (نعم / لا) or blank when unknown (null). */
function yesNo(value: boolean | null | undefined): Cell {
  if (value === null || value === undefined) return "";
  return value ? "نعم" : "لا";
}

/** An ID cell: `—` when unmapped (e.g. inspector id null because BI did not match). */
function id(value: string | null | undefined): Cell {
  return value === null || value === undefined || value === "" ? DASH : value;
}

// ─── Source / level labels ───────────────────────────────────────────────────

const SOURCE_LABELS: Record<ResultSource, string> = {
  levelOne: "المستوى الأول",
  levelTwo: "المستوى الثاني",
  manual: "التفتيش اليدوي",
  opposite: "التفتيش المعاكس",
  liveMeans: "الوسائل الحية",
  review: "نتيجة المراجعة",
};

const ALL_SOURCES: ResultSource[] = [
  "levelOne",
  "levelTwo",
  "manual",
  "opposite",
  "liveMeans",
  "review",
];

const NON_REVIEW_SOURCES: Array<Exclude<ResultSource, "review">> = [
  "levelOne",
  "levelTwo",
  "manual",
  "opposite",
  "liveMeans",
];

function levelLabel(level: DecisionRecord["decisionLevel"]): string {
  return level === "LEVEL_1" ? "المستوى الأول" : "المستوى الثاني";
}

function bandLabel(band: string | null): string {
  switch (band) {
    case "sufficient":
      return "كافية";
    case "limited":
      return "محدودة";
    case "insufficient":
      return "غير كافية";
    case "none":
      return "لا يوجد";
    default:
      return DASH;
  }
}

function outcomeLabel(outcome: DecisionRecord["outcomeClass"]): string {
  switch (outcome) {
    case "correct-clean":
      return "سليمة مؤكدة";
    case "correct-suspicion":
      return "اشتباه مكتشف";
    case "missed-suspicion":
      return "اشتباه فائت";
    case "false-suspicion":
      return "اشتباه زائد";
    default:
      return DASH;
  }
}

// ─── Sheet name constants (kept short — Excel caps names at 31 chars) ─────────

export const SHEET_NAMES = {
  kpi: "الملخص التنفيذي",
  ports: "المنافذ والعينة",
  stages: "مستويات الدراسة",
  imageQuality: "جودة الصور",
  resultQuality: "نتائج الفحص",
  rows: "بيانات الصور",
  rawRisk: "البيانات الخام - المخاطر",
  rawBi: "البيانات الخام - BI",
  exclusions: "الصفوف المستبعدة",
  factTable: "جدول القرارات",
  resultComparison: "مقارنة النتائج",
  employeeByPort: "الموظفون حسب المنفذ",
  errorAnalysis: "تحليل الأخطاء",
  crossTeam: "توافق الفرق",
} as const;

// ─── Sheet builders ───────────────────────────────────────────────────────────

function kpiSheet(model: ReportModel): Cell[][] {
  const k = model.kpis;
  return [
    ["مؤشر", "القيمة"],
    ["الشهر", model.summary.monthFolderName],
    ["الفترة", model.summary.periodId],
    [],
    ["إجمالي المجتمع", k.totalPopulation],
    ["إجمالي العينة", k.totalSample],
    ["تغطية المجتمع%", pct(k.sampleCoverage)],
    ["مدروسة", k.studiedImages],
    ["متبقية", k.remainingImages],
    ["إنجاز العينة%", pct(k.completionRate)],
    [],
    ["سليمة", k.cleanCount],
    ["اشتباه", k.suspiciousCount],
    ["نسبة الاشتباه%", pct(k.suspicionRate)],
    [],
    ["دقة نتيجة الصورة%", pct(k.overallAccuracy)],
    ["قوة اكتشاف الاشتباه%", pct(k.suspiciousDetectionRateByImage)],
    ["اشتباه فائت%", pct(k.missedSuspicionRateByImage)],
    ["دقة الاشتباه (الخصوصية)%", pct(k.suspicionPrecision)],
    ["مؤشر الجودة المتوازن%", pct(k.balancedQualityScore)],
    ["دقة المستوى الأول%", pct(k.levelOneAccuracy)],
    ["دقة المستوى الثاني%", pct(k.levelTwoAccuracy)],
    [],
    ["اشتباه مكتشف", k.correctSuspicious],
    ["سليمة مؤكدة", k.correctClean],
    ["اشتباه فائت (عدد)", k.missedSuspicious],
    ["اشتباه زائد", k.excessSuspicious],
    ["صور بتحقق صالح", k.validStudied],
    [],
    ["توفر الصور%", pct(k.imageAvailabilityRate)],
    ["صور متاحة", k.imageAvailableCount],
    ["صور غير متاحة", k.imageMissingCount],
    ["وجود التحديد%", pct(k.markingRate)],
    ["جودة عالية", k.highQualityCount],
    ["جودة متوسطة", k.mediumQualityCount],
    ["جودة منخفضة", k.lowQualityCount],
    ["الجودة المقبولة%", pct(k.acceptableQualityRate)],
    [],
    ["هوية المفتش مرتبطة (BI)", model.dataQuality.inspectorIdentityMapped ? "نعم" : "لا"],
    ["كفاية البيانات الإجمالية", bandLabel(model.dataQuality.overallBand)],
    ["إجمالي قرارات الجدول", model.dataQuality.totalDecisionRecords],
    ["قرارات قابلة للتقييم", model.dataQuality.evaluableDecisionRecords],
  ];
}

/**
 * Population columns (المجتمع..إنجاز%) come from `model.population.byPort`
 * (IMAGE grain — a population-scope description). دقة%/اكتشاف الاشتباه%/
 * اشتباه فائت% and دقة م.أول%/دقة م.ثاني% come from `model.portAccuracy` and
 * `model.portAccuracyByLevel` (DECISION grain) instead — they used to read
 * `PortProfile.accuracyByImage`/`suspiciousDetectionRateByImage`/`missedSuspicionRateByImage`/
 * `levelOneAccuracy`/`levelTwoAccuracy`, the image grain's OWN structurally
 * different figures. That is precisely the bug this sheet used to ship: the
 * SAME port could read "90% دقة" here and a different number on the
 * document's/deck's port-accuracy pages in the SAME generation run (see the
 * 2026-08-07 edit log's golden-master fixture). التصنيف (`status`) is
 * unaffected by this change — `buildPortProfiles` already derives it from the
 * decision grain internally (see `executiveKpiProfiles.ts`).
 */
function portSheet(model: ReportModel): Cell[][] {
  const decisionByPort = new Map(model.portAccuracy.map((p) => [p.key, p]));
  const levelByPort = new Map<string, { l1?: number | null; l2?: number | null }>();
  for (const entry of model.portAccuracyByLevel) {
    const cur = levelByPort.get(entry.portName) ?? {};
    if (entry.level === "LEVEL_1") cur.l1 = entry.accuracyByDecisionLevel;
    else cur.l2 = entry.accuracyByDecisionLevel;
    levelByPort.set(entry.portName, cur);
  }

  return [
    [
      "المنفذ", "المجتمع", "سليمة", "اشتباه", "نسبة الاشتباه%", "العينة", "التغطية%",
      "مدروسة", "إنجاز%", "دقة%", "اكتشاف الاشتباه%", "اشتباه فائت%",
      "دقة م.أول%", "دقة م.ثاني%", "التصنيف",
    ],
    ...model.population.byPort.map((p) => {
      const dec = decisionByPort.get(p.portName);
      const lvl = levelByPort.get(p.portName);
      return [
        text(p.portName),
        p.population,
        p.clean,
        p.suspicious,
        pct(p.suspicionRate),
        p.sampleSize,
        pct(p.coverage),
        p.studied,
        pct(p.completionRate),
        pct(dec?.accuracyByDecision ?? null),
        pct(dec?.detectionRate ?? null),
        pct(dec?.missedSuspicionRateByDecision ?? null),
        pct(lvl?.l1 ?? null),
        pct(lvl?.l2 ?? null),
        text(p.status),
      ];
    }),
  ];
}

function stageSheet(model: ReportModel): Cell[][] {
  return [
    ["المرحلة", "المجتمع", "العينة", "التغطية%", "مدروسة", "إنجاز%"],
    ...model.population.byStage.map((s) => [
      text(s.stageLabel),
      s.population,
      s.sampleSize,
      pct(s.coverage),
      s.studied,
      pct(s.completionRate),
    ]),
  ];
}

function imageQualitySheet(model: ReportModel): Cell[][] {
  const k = model.kpis;
  return [
    ["المؤشر", "القيمة"],
    ["إجابات مكتملة", k.imagesWithSubmittedAnswers],
    ["صور متاحة", k.imageAvailableCount],
    ["صور غير متاحة", k.imageMissingCount],
    ["توفر الصور%", pct(k.imageAvailabilityRate)],
    ["يوجد تحديد", k.markingPresentCount],
    ["لا يوجد تحديد", k.markingMissingCount],
    ["نسبة التحديد%", pct(k.markingRate)],
    ["جودة عالية", k.highQualityCount],
    ["جودة متوسطة", k.mediumQualityCount],
    ["جودة منخفضة", k.lowQualityCount],
    ["الجودة المقبولة%", pct(k.acceptableQualityRate)],
    [],
    ["أسباب عدم وجود الصورة", "العدد", "النسبة%"],
    ...k.missingImageReasons.map((item) => [text(item.reason), item.count, pct(item.percentage)]),
    [],
    ["أسباب انخفاض الجودة", "العدد", "النسبة%"],
    ...k.lowQualityReasons.map((item) => [text(item.reason), item.count, pct(item.percentage)]),
  ];
}

function resultQualitySheet(model: ReportModel): Cell[][] {
  const k = model.kpis;
  return [
    ["المؤشر", "القيمة"],
    ["دقة نتيجة الصورة%", pct(k.overallAccuracy)],
    ["قوة اكتشاف الاشتباه%", pct(k.suspiciousDetectionRateByImage)],
    ["اشتباه فائت%", pct(k.missedSuspicionRateByImage)],
    ["دقة الاشتباه%", pct(k.suspicionPrecision)],
    ["اشتباه مكتشف", k.correctSuspicious],
    ["سليمة مؤكدة", k.correctClean],
    ["اشتباه فائت", k.missedSuspicious],
    ["اشتباه زائد", k.excessSuspicious],
  ];
}

/** Resolve a reviewer (app user) username to its display name (§3.4). */
function reviewerName(model: ReportModel, username: string | null): Cell {
  if (username === null || username === "") return DASH;
  return model.employeeOverview.reviewerDisplayNames[username] ?? username;
}

/**
 * All image rows (processed). Inspector columns carry IDs; the reviewer column
 * carries the display name (§3.4). Other-team columns carry result + employee id.
 */
async function rowSheet(model: ReportModel): Promise<Cell[][]> {
  const header: Cell[] = [
    "رقم الأشعة", "المنفذ", "المرحلة",
    "م.أول (مفتش)", "م.ثاني (مفتش)", "نتيجة م.أول", "نتيجة م.ثاني", "نتيجة الصورة",
    "في العينة", "المراجع (اسم)", "حالة التوزيع", "نتيجة المراجعة", "حالة الإجابة",
    "يدوي (نتيجة)", "معاكس (نتيجة)", "معاكس (موظف)", "وسائل حية (نتيجة)", "وسائل حية (موظف)",
    "هل يوجد صورة", "سبب عدم وجود الصورة", "هل يوجد تحديد", "مستوى جودة الصورة",
    "سبب انخفاض الجودة", "تقييم الاشتباه", "الأصناف المشبوهة", "آلية التهريب المحتملة",
    "تاريخ التعيين", "تاريخ التسليم",
    "دقيق", "م.أول دقيق", "م.ثاني دقيق", "تصنيف التحقق",
  ];

  const body: Cell[][] = [];
  for (let i = 0; i < model.rows.length; i += EXPORT_CHUNK_SIZE) {
    const chunk = model.rows.slice(i, i + EXPORT_CHUNK_SIZE);
    for (const r of chunk) {
      body.push([
        r.xrayImageId,
        text(r.portName),
        text(r.stage),
        id(r.levelOneEmployeeId),
        id(r.levelTwoEmployeeId),
        result(r.levelOneResult),
        result(r.levelTwoResult),
        result(r.imageResult),
        r.selectedInSample ? "نعم" : "لا",
        reviewerName(model, r.assignedTo),
        text(r.distributionStatus),
        result(r.expertResult),
        text(r.answerStatus),
        result(r.otherResults.manual.result),
        result(r.otherResults.opposite.result),
        id(r.otherResults.opposite.employeeId),
        result(r.otherResults.liveMeans.result),
        id(r.otherResults.liveMeans.employeeId),
        yesNo(r.imageAvailable),
        text(r.noImageReason),
        yesNo(r.hasMarking),
        text(r.imageQuality),
        text(r.lowQualityReason),
        text(r.suspicionLevel),
        text(r.suspectedTypes),
        text(r.smuggleMethod),
        text(r.assignedAt),
        text(r.submittedAt),
        yesNo(r.imageResultAccurate),
        yesNo(r.levelOneAccurate),
        yesNo(r.levelTwoAccurate),
        text(r.verificationCategory),
      ]);
    }
    if (model.rows.length > EXPORT_CHUNK_SIZE) await yieldToMain();
  }

  return [header, ...body];
}

/**
 * Raw — Risk. The population `rawRow`s exactly as ingested, plus the source
 * sheet name / row number for traceability. Column order is the union of all
 * raw keys encountered (stable first-seen order).
 */
async function rawRiskSheet(rows: PreparedPopulationRow[]): Promise<Cell[][]> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.rawRow) continue;
    for (const key of Object.keys(row.rawRow)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  if (keys.length === 0) {
    return [["لا توجد بيانات خام محفوظة لهذه الفترة"]];
  }

  const header: Cell[] = ["ورقة المصدر", "رقم صف المصدر", ...keys];
  const body: Cell[][] = [];
  for (let i = 0; i < rows.length; i += EXPORT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + EXPORT_CHUNK_SIZE);
    for (const row of chunk) {
      const raw = row.rawRow ?? {};
      body.push([
        text(row.sourceSheetName),
        row.sourceRowNumber,
        ...keys.map((key): Cell => {
          const value = raw[key];
          if (value === null || value === undefined || value === "") return "";
          if (typeof value === "number") return value;
          if (typeof value === "boolean") return value ? "نعم" : "لا";
          return String(value);
        }),
      ]);
    }
    if (rows.length > EXPORT_CHUNK_SIZE) await yieldToMain();
  }

  return [header, ...body];
}

/**
 * Raw — BI. BI source rows are NOT carried on `ExecutiveReportInput` (the BI
 * enrichment is already folded into the population rows: inspector ids,
 * other-team results/codes/employees). Threading raw BI rows through would
 * require changing the input type + every caller, so per §7 we emit the
 * spec-compliant unavailable note rather than fabricating data.
 */
function rawBiSheet(): Cell[][] {
  return [["بيانات BI غير متاحة لهذه الفترة"]];
}

/**
 * Exclusions. The processing result (dropped rows + reasons + source row) is
 * not reachable from `ExecutiveReportInput`; it lives in
 * `processing.summary.json` / the processing result. Per §7 we emit the
 * unavailable note pointing at the authoritative artifact.
 */
function exclusionsSheet(): Cell[][] {
  return [
    ["الصف المستبعد", "السبب", "ورقة المصدر", "رقم صف المصدر"],
    ["الصفوف المستبعدة غير متاحة من مدخلات التقرير التنفيذي — راجع تقرير معالجة المجتمع (processing.summary.json)."],
  ];
}

/** Decision Fact Table — the analytical spine (§3.1). */
function factTableSheet(model: ReportModel): Cell[][] {
  return [
    [
      "الفترة", "رقم الأشعة", "رمز المنفذ", "المنفذ", "نوع المنفذ", "نوع الحركة", "المرحلة",
      "مستوى القرار", "معرّف المفتش", "قرار الموظف", "نتيجة المراجعة",
      "صورة متاحة", "تحديد متاح", "جودة الصورة", "اكتملت المراجعة",
      "قابل للتقييم", "تصنيف النتيجة", "المراجع (اسم)",
      "تاريخ التعيين", "تاريخ التسليم", "رقم صف المصدر", "كفاية البيانات",
    ],
    ...model.factTable.map((rec) => [
      text(rec.periodId),
      rec.xrayImageId,
      text(rec.portCode),
      text(rec.portName),
      text(rec.portType),
      text(rec.movementType),
      text(rec.stage),
      levelLabel(rec.decisionLevel),
      id(rec.inspectorId),
      result(rec.employeeDecision),
      result(rec.studyReviewResult),
      yesNo(rec.imageAvailable),
      yesNo(rec.markingAvailable),
      text(rec.imageQuality),
      rec.reviewCompleted ? "نعم" : "لا",
      rec.decisionEvaluable ? "نعم" : "لا",
      outcomeLabel(rec.outcomeClass),
      reviewerName(model, rec.reviewerId),
      text(rec.assignedAt),
      text(rec.completedAt),
      rec.sourceRowNumber,
      bandLabel(rec.dataSufficiencyGroup),
    ]),
  ];
}

/**
 * Result Comparison — per image: all six sources (سليمة/اشتباه/—) + each
 * non-review team's agreement-with-reviewer. Codes are pulled from the raw
 * population row (the report-row type drops codes); employee ids from the row.
 */
async function resultComparisonSheet(
  model: ReportModel,
  popById: Map<string, PreparedPopulationRow>
): Promise<Cell[][]> {
  const header: Cell[] = [
    "رقم الأشعة",
    "المنفذ",
    ...ALL_SOURCES.map((s) => `${SOURCE_LABELS[s]} (نتيجة)`),
    "يدوي (رمز)",
    "معاكس (رمز)",
    "معاكس (موظف)",
    "وسائل حية (رمز)",
    "وسائل حية (موظف)",
    ...NON_REVIEW_SOURCES.map((s) => `توافق ${SOURCE_LABELS[s]} مع المراجعة`),
  ];

  const images = model.resultComparison.images;
  const body: Cell[][] = [];
  for (let i = 0; i < images.length; i += EXPORT_CHUNK_SIZE) {
    const chunk = images.slice(i, i + EXPORT_CHUNK_SIZE);
    for (const img of chunk) {
      const pop = popById.get(img.xrayImageId);
      const other = pop?.otherResults;
      body.push([
        img.xrayImageId,
        text(img.portName),
        ...ALL_SOURCES.map((s) => result(img.results[s])),
        text(other?.manual.code ?? null),
        text(other?.opposite.code ?? null),
        id(other?.opposite.employeeId ?? null),
        text(other?.liveMeans.code ?? null),
        id(other?.liveMeans.employeeId ?? null),
        ...NON_REVIEW_SOURCES.map((s): Cell => {
          const agrees = img.agreesWithReview[s];
          if (agrees === null || agrees === undefined) return DASH;
          return agrees ? "متوافق" : "مختلف";
        }),
      ]);
    }
    if (images.length > EXPORT_CHUNK_SIZE) await yieldToMain();
  }

  return [header, ...body];
}

/** Employee by Port/Level — inspector accuracy keyed on inspector ID (§3.4). */
function employeeByPortSheet(model: ReportModel): Cell[][] {
  if (!model.employeeOverview.inspectorIdentityMapped) {
    return [
      ["معرّف المفتش", "المستوى", "المنفذ", "قابل للتقييم", "دقة%"],
      ["هوية المفتش غير مرتبطة (لم تتم مطابقة BI) — لا يمكن حساب دقة المفتشين لهذه الفترة."],
    ];
  }
  return [
    [
      "معرّف المفتش", "المستوى", "المنفذ", "قابل للتقييم",
      "سليمة مؤكدة", "اشتباه مكتشف", "اشتباه فائت", "اشتباه زائد",
      "دقة%", "اكتشاف الاشتباه%", "اشتباه فائت%", "دقة قرار الاشتباه%", "كفاية البيانات",
    ],
    ...model.employeeByPort.map((e) => [
      id(e.inspectorId),
      levelLabel(e.level),
      text(e.portName),
      e.evaluable,
      e.correctClean,
      e.correctSuspicion,
      e.missedSuspicion,
      e.falseSuspicion,
      pct(e.accuracy),
      pct(e.detectionRate),
      pct(e.missedSuspicionRate),
      pct(e.suspicionDecisionAccuracy),
      bandLabel(e.band),
    ]),
  ];
}

/** Error Analysis — error-type mix by port. */
function errorAnalysisSheet(model: ReportModel): Cell[][] {
  const totals = model.errorAnalysis.totals;
  return [
    ["المنفذ", "سليمة مؤكدة", "اشتباه مكتشف", "اشتباه فائت", "اشتباه زائد", "قابل للتقييم"],
    ...model.errorAnalysis.byPort.map((e) => [
      text(e.key),
      e.correctClean,
      e.correctSuspicion,
      e.missedSuspicion,
      e.falseSuspicion,
      e.evaluable,
    ]),
    [],
    [
      "الإجمالي",
      totals.correctClean,
      totals.correctSuspicion,
      totals.missedSuspicion,
      totals.falseSuspicion,
      totals.evaluable,
    ],
  ];
}

/** Cross-team Agreement — N×N matrix + reviewer-focused rows (§3.1). */
function crossTeamSheet(model: ReportModel): Cell[][] {
  const reviewerHeader: Cell[] = [
    "كل فريق مقابل المراجعة",
    "قابل للمقارنة", "متوافق", "مختلف", "نسبة التوافق%",
    "اشتباه زائد للفريق (المراجعة سليمة)", "اشتباه فائت للفريق (المراجعة اشتباه)",
  ];
  const reviewerRows: Cell[][] = model.resultComparison.reviewerAgreement.map((row) => [
    SOURCE_LABELS[row.source],
    row.comparable,
    row.agree,
    row.disagree,
    pct(row.agreementRate),
    row.teamFlaggedReviewerClean,
    row.teamClearedReviewerFlagged,
  ]);

  const matrixHeader: Cell[] = [
    "المصفوفة الكاملة (فريق × فريق)", "", "قابل للمقارنة", "متوافق", "مختلف", "نسبة التوافق%",
  ];
  const matrixRows: Cell[][] = model.resultComparison.crossTeamMatrix.map((cell) => [
    SOURCE_LABELS[cell.sourceA],
    SOURCE_LABELS[cell.sourceB],
    cell.comparable,
    cell.agree,
    cell.disagree,
    pct(cell.agreementRate),
  ]);

  return [reviewerHeader, ...reviewerRows, [], matrixHeader, ...matrixRows];
}

// ─── Workbook assembly ─────────────────────────────────────────────────────────

/**
 * Build the executive workbook in-memory and return the SheetJS workbook. Pure;
 * does no I/O. `buildExecutiveWorkbook` wraps it and writes the file.
 */
export async function buildExecutiveWorkbookObject(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {}
): Promise<XLSX.WorkBook> {
  const model = buildReportModel(input, employeeDisplayNames);
  const popById = new Map<string, PreparedPopulationRow>();
  for (const row of input.populationRows) {
    popById.set(row.xrayImageId, row);
  }

  const wb = XLSX.utils.book_new();
  const append = (name: string, aoa: Cell[][]): void => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  };

  // Processed / aggregate sheets (ported from the legacy builder, now from ReportModel).
  append(SHEET_NAMES.kpi, kpiSheet(model));
  append(SHEET_NAMES.ports, portSheet(model));
  append(SHEET_NAMES.stages, stageSheet(model));
  append(SHEET_NAMES.imageQuality, imageQualitySheet(model));
  append(SHEET_NAMES.resultQuality, resultQualitySheet(model));
  append(SHEET_NAMES.rows, await rowSheet(model));

  // Raw → analytical chain (§7).
  append(SHEET_NAMES.rawRisk, await rawRiskSheet(input.populationRows));
  append(SHEET_NAMES.rawBi, rawBiSheet());
  append(SHEET_NAMES.exclusions, exclusionsSheet());
  append(SHEET_NAMES.factTable, factTableSheet(model));
  append(SHEET_NAMES.resultComparison, await resultComparisonSheet(model, popById));
  append(SHEET_NAMES.employeeByPort, employeeByPortSheet(model));
  append(SHEET_NAMES.errorAnalysis, errorAnalysisSheet(model));
  append(SHEET_NAMES.crossTeam, crossTeamSheet(model));

  // B2: report-to-revision linkage — cite the exact source-file revisions used.
  if (hasSourceRevisions(input.sourceRevisions)) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sourceRevisionsSheetAoa(input.sourceRevisions)),
      SOURCE_REVISIONS_SHEET_NAME_AR
    );
  }

  return wb;
}

/**
 * Build and download the executive workbook (`.xlsx`). Replaces the legacy
 * `buildExecutiveXlsx`; the Reports tab calls through the re-exported name.
 */
export async function buildExecutiveWorkbook(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {}
): Promise<void> {
  const wb = await buildExecutiveWorkbookObject(input, employeeDisplayNames);
  XLSX.writeFile(wb, `التقرير_التنفيذي_${input.monthFolderName}.xlsx`);
}
