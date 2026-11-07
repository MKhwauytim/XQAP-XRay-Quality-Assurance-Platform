import type { EngineIssue } from "./errors";

export type MessageKey =
  | "schema.invalid" | "type.errors" | "formula.syntax" | "formula.notAllowed"
  | "formula.tooDeep" | "formula.tooLong" | "measure.unknown" | "well.invalid" | "literal.number"
  | "limit.rows" | "limit.slides" | "limit.visuals" | "limit.time"
  | "fit.tooLong" | "gate.figureParity" | "gate.layoutParity" | "gate.lint"
  | "gate.reconcile" | "gate.ooxml" | "recipe.hashMismatch" | "recipe.invalid"
  | "resolve.keyConflict" | "theme.invalid"
  | "xlsx.names" | "xlsx.columnClash" | "xlsx.pivotField"
  | "catalog.unknownNumber"
  | "catalog.planned"
  | "catalog.retired"
  | "picks.empty"
  | "picks.notNumber"
  | "picks.repeated"
  | "picks.tooMany";

export const MESSAGES_AR: Record<MessageKey, string> = {
  "schema.invalid": "بنية التقرير غير صالحة",
  "type.errors": "في العمود قيم لا تطابق نوعه المعلن",
  "formula.syntax": "صيغة الحساب غير صحيحة",
  "formula.notAllowed": "الصيغة تستخدم عنصرا غير مسموح به",
  "formula.tooDeep": "الصيغة متداخلة أكثر من الحد المسموح",
  "formula.tooLong": "الصيغة أطول من الحد المسموح",
  "measure.unknown": "المقياس غير معرف",
  "well.invalid": "حقل الرسم غير صالح",
  "literal.number": "لا يجوز كتابة رقم داخل النص، استخدم مقياسا",
  "limit.rows": "عدد الصفوف يتجاوز الحد المسموح",
  "limit.slides": "عدد الشرائح يتجاوز الحد المسموح",
  "limit.visuals": "عدد العناصر المرئية في الصفحة يتجاوز الحد المسموح",
  "limit.time": "تجاوز الإصدار الوقت المسموح",
  "fit.tooLong": "العنوان أطول من المساحة",
  "gate.figureParity": "الأرقام لا تتطابق بين صيغ المخرجات",
  "gate.layoutParity": "التخطيط لا يتطابق بين HTML وPowerPoint",
  "gate.lint": "فشل فحص الجودة البصرية",
  "gate.reconcile": "الصفوف الخام لا تطابق الصفوف المعالجة",
  "gate.ooxml": "ملف PowerPoint غير سليم",
  "recipe.hashMismatch": "ملف البيانات تغير منذ إصدار الوصفة",
  "recipe.invalid": "الوصفة غير صالحة",
  "resolve.keyConflict": "رقمان مختلفان يحملان المفتاح نفسه",
  "theme.invalid": "قيمة غير صالحة في ألوان القالب أو خطه",
  "xlsx.names": "اسم ظاهر في المصنف يشبه رمزا داخليا أو رقم خطوة، استخدم اسما عربيا واضحا",
  "xlsx.columnClash": "عمودان يحملان الاسم نفسه في إكسل (يتجاهل إكسل حالة الأحرف والهمزة على الألف)",
  "xlsx.pivotField": "الجدول المحوري يشير إلى عمود غير موجود في جدوله",
  "catalog.unknownNumber": "رقم التصميم غير موجود في الكتالوج",
  "catalog.planned": "التصميم مخطط له ولم يصدر بعد",
  "catalog.retired": "التصميم متقاعد ولم يعد متاحا",
  "picks.empty": "لم تحدد أي رقم تصميم",
  "picks.notNumber": "القيمة المكتوبة ليست رقم تصميم",
  "picks.repeated": "رقم التصميم مكرر",
  "picks.tooMany": "عدد التصاميم المختارة يتجاوز الحد المسموح",
};

export function formatIssue(
  issue: EngineIssue,
  messages?: Partial<Record<MessageKey, string>>,
): string {
  const text = messages?.[issue.rule] ?? MESSAGES_AR[issue.rule];
  const parts = [text];
  if (issue.page !== undefined) parts.push(`الصفحة ${issue.page}`);
  if (issue.visual !== undefined) parts.push(`العنصر ${issue.visual}`);
  if (issue.path !== undefined) parts.push(issue.path);
  if (issue.detail !== undefined) parts.push(issue.detail);
  parts.push(`(${issue.rule})`);
  return parts.join(" | ");
}
