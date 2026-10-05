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

export function mapSampleRow(c: Record<string, string>, sheet: string, report: MappingReport): MappedWorkbookRow | null {
  report.totalRows++;
  if ((c["الاكتمال"] ?? "").trim() !== COMPLETED) { report.incomplete++; return null; }
  const id = text(c["معرف الأشعة"]);
  if (!id) { report.skippedNoId++; return null; }
  const month = parseStudyMonth(c["الشهر"]);
  if (!month) { report.skippedNoMonth++; return null; }
  const l1 = result(report, "نتيجة المستوى الأول", c["نتيجة المستوى الأول"]);
  const l2 = result(report, "نتيجة المستوى الثاني", c["نتيجة المستوى الثاني"]);
  if (!l1 || !l2) { report.skippedBadResult++; return null; }
  const expert = result(report, "صحة النتيجة", c["صحة النتيجة"]);
  const imageResult = classifyImageResult(l1, l2);
  const img = (c["هل يوجد صورة؟"] ?? "").trim();
  const imageAvailable = img === "نعم" ? true : img === "" ? null : false;
  if (img !== "" && img !== "نعم" && img !== "لا" && img !== "معرف غير صحيح") note(report, "هل يوجد صورة؟", img);
  const mark = (c["هل يوجد تحديد؟"] ?? "").trim();
  const row: ExecutiveReportRow = {
    xrayImageId: id,
    portCode: text(c["رمز المنفذ"]), portName: text(c["اسم المنفذ"]), portType: text(c["نوع المنفذ"]),
    movementType: null, stage: text(c["المستوى"]),
    levelOneEmployeeId: null, levelTwoEmployeeId: null,
    levelOneResult: l1, levelTwoResult: l2, imageResult,
    selectedInSample: true, assignedTo: null, distributionStatus: null,
    expertResult: expert, imageAvailable,
    noImageReason: imageAvailable === false ? (img === "لا" ? "لا توجد صورة" : img) : null,
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
