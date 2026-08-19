import {
  createFieldId,
  createPhaseId,
  createTemplateId
} from "../../../../data/templates/templateStorage";
import type { TemplateSchema } from "../../../../data/templates/templateTypes";

/**
 * The template a brand-new workspace's inspector actually fills in.
 *
 * Lives outside TabView.tsx because it is data, not a component: exporting it
 * from the tab module breaks react-refresh, and its structure is asserted by
 * defaultTemplate.test.ts.
 *
 * Editing this changes NEW templates only. Field ids are freshly generated on
 * every call, so a workspace whose template already exists on disk keeps the
 * structure it was created with, and its recorded answers keep resolving.
 */
export function buildDefaultInspectionTemplate(username: string): TemplateSchema {
  const now = new Date().toISOString();
  const phase1Id = createPhaseId();
  const phase2Id = createPhaseId();
  const phase3Id = createPhaseId();

  const fHasImage       = createFieldId();
  const fNoImageReason  = createFieldId();
  const fHasMarking     = createFieldId();
  const fImageQuality   = createFieldId();
  const fQualityReason  = createFieldId();
  const fQualityOther   = createFieldId();
  const fDeclarationType   = createFieldId();
  const fDeclaredNature    = createFieldId();
  const fObservedNature    = createFieldId();
  const fMatchesDeclaration = createFieldId();
  const fMismatchReasons   = createFieldId();
  const fDeclarationNotes  = createFieldId();
  const fResultValidity    = createFieldId();
  const fSuspicionLevel    = createFieldId();
  const fSuspicionLocation = createFieldId();
  const fSuspectedTypes    = createFieldId();
  const fSmuggleMethod     = createFieldId();
  const fNotes             = createFieldId();

  return {
    templateId: createTemplateId(),
    templateName: "نموذج ضمان جودة الأشعة",
    version: 1,
    createdAt: now,
    createdBy: username,
    updatedAt: now,
    updatedBy: username,
    phases: [
      { phaseId: phase1Id, title: "ضمان جودة الصورة",   description: "", order: 1 },
      { phaseId: phase2Id, title: "تحليل البيان الجمركي", description: "", order: 2 },
      { phaseId: phase3Id, title: "ضمان جودة النتيجة",  description: "", order: 3 },
    ],
    fields: [
      // ── Phase 1 ──────────────────────────────────────────────────────────────
      {
        fieldId: fHasImage, phaseId: phase1Id, label: "هل يوجد صورة",
        type: "dropdown", required: true,
        options: ["نعم", "لا"], placeholder: "", condition: null, order: 1,
      },
      {
        fieldId: fNoImageReason, phaseId: phase1Id, label: "سبب عدم وجود الصورة",
        type: "dropdown", required: false,
        options: ["المعرف غير صحيح", "لا يوجد رقم لوحة", "لا يوجد مستند فحص الصورة", "مؤرشف لفترات سابقة"],
        placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "لا" },
        order: 2,
      },
      {
        fieldId: fHasMarking, phaseId: phase1Id, label: "هل يوجد تحديد",
        type: "dropdown", required: true,
        options: ["نعم", "لا"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 3,
      },
      {
        fieldId: fImageQuality, phaseId: phase1Id, label: "مستوى جودة الصورة",
        type: "dropdown", required: true,
        options: ["عالي", "متوسط", "منخفض"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 4,
      },
      {
        fieldId: fQualityReason, phaseId: phase1Id, label: "اسباب انخفاض جودة الصورة",
        type: "dropdown", required: false,
        options: ["الأرسالية غير كاملة", "جودة التقاط الصورة منخفضة", "يوجد تموجات في الصورة", "اخرى"],
        placeholder: "",
        condition: { sourceFieldId: fImageQuality, operator: "notEquals", value: "عالي" },
        order: 5,
      },
      {
        fieldId: fQualityOther, phaseId: phase1Id, label: "سبب انخفاض الجودة (أخرى)",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر سبب انخفاض الجودة...",
        condition: { sourceFieldId: fQualityReason, operator: "equals", value: "اخرى" },
        order: 6,
      },
      // ── Phase 2 — تحليل البيان الجمركي ───────────────────────────────────────
      // Sits between "is there a usable image?" and "is the result sound?" so
      // the reviewer has read what the shipment is DECLARED to be before
      // judging what the scan shows. Every field is gated on an image existing:
      // with no image there is nothing to compare the declaration against.
      {
        fieldId: fDeclarationType, phaseId: phase2Id, label: "نوع البيان",
        type: "dropdown", required: true,
        options: ["استيراد", "تصدير", "إعادة تصدير", "عبور", "إدخال مؤقت", "أخرى"],
        placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" },
        order: 1,
      },
      // Declared and observed share ONE vocabulary on purpose. Two different
      // lists (a commercial one for the declaration, a visual one for the scan)
      // would make the two answers incomparable, and comparing them is the
      // whole point of this phase. The categories are therefore the ones an
      // X-ray can actually distinguish — density, homogeneity, shape — rather
      // than customs-tariff families.
      {
        fieldId: fDeclaredNature, phaseId: phase2Id, label: "طبيعة البضاعة المصرح بها",
        type: "multiselect", required: true,
        options: [
          "سوائل أو سائب في صهاريج",
          "مساحيق أو حبيبات",
          "طرود متجانسة (كراتين أو أكياس متكررة)",
          "بضائع معدنية كثيفة (آلات ومعدات وقطع غيار)",
          "مركبات",
          "أخرى",
        ],
        placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" },
        order: 2,
      },
      // Same list plus two answers that only the scan can produce: a load whose
      // contents do not separate into categories, and one the image cannot
      // resolve at all. "Mixed" is not offered on the declared side — picking
      // several options already says that.
      {
        fieldId: fObservedNature, phaseId: phase2Id, label: "طبيعة البضاعة الظاهرة بالأشعة",
        type: "multiselect", required: true,
        options: [
          "سوائل أو سائب في صهاريج",
          "مساحيق أو حبيبات",
          "طرود متجانسة (كراتين أو أكياس متكررة)",
          "بضائع معدنية كثيفة (آلات ومعدات وقطع غيار)",
          "مركبات",
          "حمولة غير متجانسة",
          "لا يمكن التحديد",
          "أخرى",
        ],
        placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" },
        order: 3,
      },
      // One verdict field, not a "is there a difference?" flag AND a separate
      // match result — two fields carrying one judgment can disagree with each
      // other inside the same submitted answer. Two options, so InspectionPanel
      // renders it as a segmented control rather than a <select>.
      {
        fieldId: fMatchesDeclaration, phaseId: phase2Id, label: "هل الوارد مطابق للبيان الجمركي",
        type: "dropdown", required: true,
        options: ["نعم", "لا"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" },
        order: 4,
      },
      {
        fieldId: fMismatchReasons, phaseId: phase2Id, label: "أسباب عدم المطابقة",
        type: "multiselect", required: false,
        options: [
          "صنف بضاعة مختلف عن المصرح به",
          "وجود بضاعة غير مصرح بها",
          "عدد أو كمية الطرود لا تتوافق ظاهرياً",
          "شكل أو طبيعة الحمولة لا تتوافق مع الوصف",
          "وجود أجسام أو مواد غير مذكورة",
          "اختلاف واضح في توزيع الحمولة",
          "وجود فراغات أو إخفاء غير معتاد",
          "اختلاف في نوع العبوات",
          "أخرى",
        ],
        placeholder: "",
        condition: { sourceFieldId: fMatchesDeclaration, operator: "equals", value: "لا" },
        order: 5,
      },
      // Optional and ungated by the verdict: it is the only place an "أخرى"
      // pick in either nature field can be written down, and that can happen on
      // a fully matching declaration too.
      {
        fieldId: fDeclarationNotes, phaseId: phase2Id, label: "ملاحظات على البيان الجمركي",
        type: "textarea", required: false,
        options: [], placeholder: "أي ملاحظات على البيان أو على المقارنة...",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" },
        order: 6,
      },
      // ── Phase 3 — ضمان جودة النتيجة ──────────────────────────────────────────
      {
        fieldId: fResultValidity, phaseId: phase3Id, label: "صحة النتيجة",
        type: "dropdown", required: true,
        options: ["سليمة", "اشتباه"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 1,
      },
      {
        fieldId: fSuspicionLevel, phaseId: phase3Id, label: "تقييم الاشتباه",
        type: "dropdown", required: false,
        options: ["عالي", "متوسط", "منخفض"], placeholder: "",
        condition: { sourceFieldId: fResultValidity, operator: "equals", value: "اشتباه" },
        order: 2,
      },
      {
        fieldId: fSuspicionLocation, phaseId: phase3Id, label: "موقع الاشتباه",
        type: "combobox", required: false,
        options: ["الكبينة", "الحمولة", "العجلات", "الإطارات", "الباب الخلفي", "السقف", "الأرضية", "الخزان", "الجانب الأيمن", "الجانب الأيسر"],
        placeholder: "اكتب أو اختر موقع الاشتباه...",
        condition: { sourceFieldId: fResultValidity, operator: "equals", value: "اشتباه" },
        order: 3,
      },
      {
        fieldId: fSuspectedTypes, phaseId: phase3Id, label: "الاصناف المشبوهة",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر الاصناف المشبوهة...",
        condition: { sourceFieldId: fResultValidity, operator: "equals", value: "اشتباه" },
        order: 4,
      },
      {
        fieldId: fSmuggleMethod, phaseId: phase3Id, label: "الية التهريب المحتملة",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر الية التهريب المحتملة...",
        condition: { sourceFieldId: fResultValidity, operator: "equals", value: "اشتباه" },
        order: 5,
      },
      {
        fieldId: fNotes, phaseId: phase3Id, label: "الملاحظات العامة",
        type: "textarea", required: false,
        options: [], placeholder: "أي ملاحظات إضافية...",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 6,
      },
    ],
  };
}
