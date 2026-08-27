import {
  createFieldId,
  createPhaseId,
  createTemplateId
} from "./templateStorage";
import type { TemplateSchema } from "./templateTypes";

/**
 * The template a brand-new workspace's inspector actually fills in.
 *
 * Canonical home for this data (moved from
 * `components/Sidebar/Tabs/TemplateBuilder/defaultTemplate.ts`, which now just
 * re-exports it) so a data-layer consumer — `data/workspace/demoWorkspace.ts`'s
 * demo seed — can use the exact same default template without importing
 * TemplateBuilder's lazy tab boundary (`eslint.config.js`'s
 * `no-restricted-imports`: nothing outside EmployeeWorkspace/TemplateBuilder
 * may import `**\/TemplateBuilder/*` directly). Its structure is asserted by
 * `TemplateBuilder/defaultTemplate.test.ts`.
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
  const fNoImageReasonOther = createFieldId();
  const fHasMarking     = createFieldId();
  const fImageQuality   = createFieldId();
  const fQualityReason  = createFieldId();
  const fQualityOther   = createFieldId();
  const fCanViewDeclaration = createFieldId();
  const fDeclarationType   = createFieldId();
  const fDeclarationTypeOther = createFieldId();
  const fDeclaredNature    = createFieldId();
  const fDeclaredNatureOther = createFieldId();
  const fObservedNature    = createFieldId();
  const fObservedNatureOther = createFieldId();
  const fMatchesDeclaration = createFieldId();
  const fMismatchReasons   = createFieldId();
  const fMismatchReasonsOther = createFieldId();
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
        options: ["المعرف غير صحيح", "لا يوجد رقم لوحة", "لا يوجد مستند فحص الصورة", "مؤرشف لفترات سابقة", "أخرى"],
        placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "لا" },
        order: 2,
      },
      {
        fieldId: fNoImageReasonOther, phaseId: phase1Id, label: "سبب عدم وجود الصورة (أخرى)",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر سبب عدم وجود الصورة...",
        condition: { sourceFieldId: fNoImageReason, operator: "equals", value: "أخرى" },
        order: 3,
      },
      {
        fieldId: fHasMarking, phaseId: phase1Id, label: "هل يوجد تحديد",
        type: "dropdown", required: true,
        options: ["نعم", "لا"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 4,
      },
      {
        fieldId: fImageQuality, phaseId: phase1Id, label: "مستوى جودة الصورة",
        type: "dropdown", required: true,
        options: ["عالي", "متوسط", "منخفض"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 5,
      },
      {
        fieldId: fQualityReason, phaseId: phase1Id, label: "اسباب انخفاض جودة الصورة",
        type: "dropdown", required: false,
        options: ["الأرسالية غير كاملة", "جودة التقاط الصورة منخفضة", "يوجد تموجات في الصورة", "أخرى"],
        placeholder: "",
        condition: { sourceFieldId: fImageQuality, operator: "notEquals", value: "عالي" },
        order: 6,
      },
      {
        fieldId: fQualityOther, phaseId: phase1Id, label: "سبب انخفاض الجودة (أخرى)",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر سبب انخفاض الجودة...",
        condition: { sourceFieldId: fQualityReason, operator: "equals", value: "أخرى" },
        order: 7,
      },
      // ── Phase 2 — تحليل البيان الجمركي ───────────────────────────────────────
      // Sits between "is there a usable image?" and "is the result sound?" so
      // the reviewer has read what the shipment is DECLARED to be before
      // judging what the scan shows.
      //
      // The phase opens with its own gate rather than repeating the phase-1
      // image gate on every field. A reviewer who cannot pull up the customs
      // declaration answers ONE question and the phase is finished: nothing
      // below is visible, so nothing below is required, so the phase counts as
      // complete and the stepper moves on. Everything else hangs off this gate,
      // and `isFieldVisible` walks a condition's source field recursively — so
      // gating on the gate keeps the original "no image ⇒ no declaration work"
      // rule intact without stating it eleven times.
      {
        fieldId: fCanViewDeclaration, phaseId: phase2Id, label: "هل يمكن الاطلاع على البيان",
        type: "dropdown", required: true,
        options: ["نعم", "لا"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" },
        order: 1,
      },
      {
        fieldId: fDeclarationType, phaseId: phase2Id, label: "نوع البيان",
        type: "dropdown", required: true,
        options: ["استيراد", "تصدير", "إعادة تصدير", "عبور", "إدخال مؤقت", "أخرى"],
        placeholder: "",
        condition: { sourceFieldId: fCanViewDeclaration, operator: "equals", value: "نعم" },
        order: 2,
      },
      // Every "أخرى" option in this template is paired with its own free-text
      // companion, revealed by picking it and hidden (and therefore dropped
      // from the saved answer, since `collect()` persists visible fields only)
      // when it is unpicked. Without one, "أخرى" records that the reviewer had
      // something to say and not what it was.
      {
        fieldId: fDeclarationTypeOther, phaseId: phase2Id, label: "نوع البيان (أخرى)",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر نوع البيان...",
        condition: { sourceFieldId: fDeclarationType, operator: "equals", value: "أخرى" },
        order: 3,
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
        condition: { sourceFieldId: fCanViewDeclaration, operator: "equals", value: "نعم" },
        order: 4,
      },
      // `equals` against a multiselect source asks "is this option among the
      // picked ones?" (see evaluateCondition), so this box survives the
      // reviewer picking a second category alongside "أخرى".
      {
        fieldId: fDeclaredNatureOther, phaseId: phase2Id, label: "طبيعة البضاعة المصرح بها (أخرى)",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر طبيعة البضاعة المصرح بها...",
        condition: { sourceFieldId: fDeclaredNature, operator: "equals", value: "أخرى" },
        order: 5,
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
        condition: { sourceFieldId: fCanViewDeclaration, operator: "equals", value: "نعم" },
        order: 6,
      },
      {
        fieldId: fObservedNatureOther, phaseId: phase2Id, label: "طبيعة البضاعة الظاهرة بالأشعة (أخرى)",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر طبيعة البضاعة الظاهرة بالأشعة...",
        condition: { sourceFieldId: fObservedNature, operator: "equals", value: "أخرى" },
        order: 7,
      },
      // One verdict field, not a "is there a difference?" flag AND a separate
      // match result — two fields carrying one judgment can disagree with each
      // other inside the same submitted answer. Two options, so InspectionPanel
      // renders it as a segmented control rather than a <select>.
      {
        fieldId: fMatchesDeclaration, phaseId: phase2Id, label: "هل الوارد مطابق للبيان الجمركي",
        type: "dropdown", required: true,
        options: ["نعم", "لا"], placeholder: "",
        condition: { sourceFieldId: fCanViewDeclaration, operator: "equals", value: "نعم" },
        order: 8,
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
        order: 9,
      },
      {
        fieldId: fMismatchReasonsOther, phaseId: phase2Id, label: "أسباب عدم المطابقة (أخرى)",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر سبب عدم المطابقة...",
        condition: { sourceFieldId: fMismatchReasons, operator: "equals", value: "أخرى" },
        order: 10,
      },
      // Optional and ungated by the verdict: a matching declaration can still
      // be worth a remark. The per-option "أخرى" boxes above cover the "what
      // did they mean by other?" case, so this is free-form commentary only.
      {
        fieldId: fDeclarationNotes, phaseId: phase2Id, label: "ملاحظات على البيان الجمركي",
        type: "textarea", required: false,
        options: [], placeholder: "أي ملاحظات على البيان أو على المقارنة...",
        condition: { sourceFieldId: fCanViewDeclaration, operator: "equals", value: "نعم" },
        order: 11,
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
