import { parseStudyMonth } from "../adhocImport/adhocMonthBinding";
import { classifyImageResult } from "../population/imageResult";
import { deriveRowAccuracy } from "../reporting/executiveReportData";
import type { ExecutiveReportRow } from "../reporting/executiveReportTypes";

export type MappingReport = {
  sheetsRead: { name: string; rows: number }[];
  totalRows: number; completed: number; incomplete: number;
  skippedNoId: number; skippedNoMonth: number; skippedBadResult: number;
  unmappedValues: Record<string, Record<string, number>>;
};
export type MappedWorkbookRow = { row: ExecutiveReportRow; month: string; sheet: string };

export const newMappingReport = (): MappingReport => ({
  sheetsRead: [], totalRows: 0, completed: 0, incomplete: 0,
  skippedNoId: 0, skippedNoMonth: 0, skippedBadResult: 0, unmappedValues: {},
});

const COMPLETED = "مكتمل";

/**
 * Header spellings used by the examined-sample layout (the «بناءً على فترة العينة»
 * workbook: S<MON> sheets) mapped to the canonical names this module reads.
 */
export const HEADER_ALIASES: Record<string, string> = {
  "رقم صورة الاشعة": "معرف الأشعة",
  "شهر الفحص": "الشهر",
  "نتيجة المستوى الأول للاشعة": "نتيجة المستوى الأول",
  "نتيجة المستوى الاول": "نتيجة المستوى الأول",
  "نتيجة المستوى الثاني للاشعة": "نتيجة المستوى الثاني",
};
export const canonicalHeader = (h: string): string => HEADER_ALIASES[h.trim()] ?? h;

/** Per-sheet options: `examined` = the sheet lists only examined samples and has no «الاكتمال» column. */
export type MapOptions = { examined?: boolean };

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
/** Year of an Excel date serial, or null when the cell is not a plausible serial. */
function yearOfSerial(raw: string | undefined): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 80000) return null;
  return new Date(EXCEL_EPOCH_UTC + Math.floor(n) * 86_400_000).getUTCFullYear();
}
/** The examined layout stores a bare month number (1–12); the year comes from the expert-review date. */
function resolveMonth(c: Record<string, string>, examined: boolean): string | null {
  const raw = (c["الشهر"] ?? "").trim();
  if (examined && /^(?:[1-9]|1[0-2])$/.test(raw)) {
    const year = yearOfSerial(c["تاريخ رصد الخبير"]);
    return year === null ? null : parseStudyMonth(`${raw}-${year}`);
  }
  return parseStudyMonth(c["الشهر"]);
}
const INVALID_ID = "معرف غير صحيح";
type Result = "سليمة" | "اشتباه";
type Level = "عالي" | "متوسط" | "منخفض";

function note(r: MappingReport, col: string, v: string) {
  const c = (r.unmappedValues[col] ??= {});
  c[v] = (c[v] ?? 0) + 1;
}
function result(r: MappingReport, col: string, v: string | undefined): Result | null {
  const s = v?.trim() ?? "";
  if (s === "") return null;
  if (s === "سليمة" || s === "اشتباه") return s;
  if (s === "سليمه") return "سليمة"; // common ه/ة spelling variant
  note(r, col, s);
  return null;
}
function level(r: MappingReport, col: string, v: string | undefined): Level | null {
  const s = v?.trim() ?? "";
  if (s === "") return null;
  if (s === "عالي" || s === "متوسط" || s === "منخفض") return s;
  note(r, col, s);
  return null;
}
const text = (v: string | undefined) => (v?.trim() ? v.trim() : null);

export function mapSampleRow(c: Record<string, string>, sheet: string, report: MappingReport, opts: MapOptions = {}): MappedWorkbookRow | null {
  report.totalRows++;
  const examined = opts.examined === true;
  if (!examined && (c["الاكتمال"] ?? "").trim() !== COMPLETED) { report.incomplete++; return null; }
  const id = text(c["معرف الأشعة"]);
  if (!id) { report.skippedNoId++; return null; }
  const month = resolveMonth(c, examined);
  if (!month) { report.skippedNoMonth++; return null; }
  const l1 = result(report, "نتيجة المستوى الأول", c["نتيجة المستوى الأول"]);
  const l2 = result(report, "نتيجة المستوى الثاني", c["نتيجة المستوى الثاني"]);
  if (!l1 || !l2) { report.skippedBadResult++; return null; }
  const expert = result(report, "صحة النتيجة", c["صحة النتيجة"]);
  const imageResult = classifyImageResult(l1, l2);
  const img = (c["هل يوجد صورة؟"] ?? "").trim();
  // Workbook rows are completed samples whatever the image column says: «لا» /
  // invalid id is recorded as the reason but never leaves the row out of the studied set.
  const imageAvailable = img === "نعم" ? true : null;
  const noImage = img === "لا" || img === INVALID_ID;
  if (img !== "" && img !== "نعم" && !noImage) note(report, "هل يوجد صورة؟", img);
  const mark = (c["هل يوجد تحديد؟"] ?? "").trim();
  if (mark !== "" && mark !== "نعم" && mark !== "لا") note(report, "هل يوجد تحديد؟", mark);
  const row: ExecutiveReportRow = {
    xrayImageId: id,
    portCode: text(c["رمز المنفذ"]), portName: text(c["اسم المنفذ"]), portType: text(c["نوع المنفذ"]),
    movementType: null, stage: text(c["المستوى"]),
    levelOneEmployeeId: null, levelTwoEmployeeId: null,
    levelOneResult: l1, levelTwoResult: l2, imageResult,
    selectedInSample: true, assignedTo: null, distributionStatus: null,
    expertResult: expert, imageAvailable,
    noImageReason: img === INVALID_ID ? img : null,
    hasMarking: mark === "نعم" ? true : mark === "لا" ? false : null,
    imageQuality: level(report, "مستوى جودة الصورة", c["مستوى جودة الصورة"]),
    lowQualityReason: text(c["أسباب انخفاض الجودة"]),
    suspicionLevel: level(report, "تقييم الاشتباه", c["تقييم الاشتباه"]),
    suspectedTypes: text(c["الاصناف المشبوهة"]), smuggleMethod: text(c["الية التهريب المحتملة"]),
    answerStatus: "submitted", assignedAt: null, submittedAt: null,
    ...deriveRowAccuracy(l1, l2, imageResult, expert),
    otherResults: {
      manual: { result: result(report, "نتيجة المعاين", c["نتيجة المعاين"]), employeeId: null },
      opposite: { result: result(report, "نتيجة المفتش المعاكس", c["نتيجة المفتش المعاكس"]), employeeId: null },
      liveMeans: { result: result(report, "نتيجة الوسائل الحية", c["نتيجة الوسائل الحية"]), employeeId: null },
    },
    notes: text(c["الملاحظات العامة"]),
  };
  report.completed++;
  return { row, month, sheet };
}
