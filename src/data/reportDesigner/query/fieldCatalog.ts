export type FieldRole = "dimension" | "measure";
export type FieldType = "string" | "number" | "boolean";
export type FieldMeta = { field: string; label: string; role: FieldRole; type: FieldType };

// Mirrors ExecutiveReportRow (src/data/reporting/executiveReportTypes.ts:14).
// Booleans/strings = dimensions you can also count; numbers = measures.
export const FACT_FIELDS: FieldMeta[] = [
  { field: "xrayImageId", label: "رقم صورة الأشعة", role: "dimension", type: "string" },
  { field: "portName", label: "الميناء", role: "dimension", type: "string" },
  { field: "portType", label: "نوع الميناء", role: "dimension", type: "string" },
  { field: "stage", label: "المرحلة", role: "dimension", type: "string" },
  { field: "levelOneResult", label: "نتيجة المستوى الأول", role: "dimension", type: "string" },
  { field: "levelTwoResult", label: "نتيجة المستوى الثاني", role: "dimension", type: "string" },
  { field: "imageResult", label: "نتيجة الصورة", role: "dimension", type: "string" },
  { field: "selectedInSample", label: "ضمن العينة", role: "dimension", type: "boolean" },
  { field: "assignedTo", label: "مُسند إلى", role: "dimension", type: "string" },
  { field: "distributionStatus", label: "حالة التوزيع", role: "dimension", type: "string" },
  { field: "expertResult", label: "نتيجة الخبير", role: "dimension", type: "string" },
  { field: "imageAvailable", label: "الصورة متوفرة", role: "dimension", type: "boolean" },
  { field: "noImageReason", label: "سبب عدم وجود الصورة", role: "dimension", type: "string" },
  { field: "hasMarking", label: "يوجد تحديد", role: "dimension", type: "boolean" },
  { field: "imageQuality", label: "جودة الصورة", role: "dimension", type: "string" },
  { field: "lowQualityReason", label: "سبب انخفاض الجودة", role: "dimension", type: "string" },
  { field: "suspicionLevel", label: "مستوى الاشتباه", role: "dimension", type: "string" },
  { field: "suspectedTypes", label: "الأصناف المشبوهة", role: "dimension", type: "string" },
  { field: "smuggleMethod", label: "آلية التهريب", role: "dimension", type: "string" },
  { field: "answerStatus", label: "حالة الإجابة", role: "dimension", type: "string" },
  { field: "imageResultAccurate", label: "دقة نتيجة الصورة", role: "dimension", type: "boolean" },
  { field: "levelOneAccurate", label: "دقة المستوى الأول", role: "dimension", type: "boolean" },
  { field: "levelTwoAccurate", label: "دقة المستوى الثاني", role: "dimension", type: "boolean" },
  { field: "verificationCategory", label: "تصنيف التحقق", role: "dimension", type: "string" },
];

const BY_FIELD = new Map(FACT_FIELDS.map((f) => [f.field, f]));
export function getFieldMeta(field: string): FieldMeta | undefined {
  return BY_FIELD.get(field);
}
