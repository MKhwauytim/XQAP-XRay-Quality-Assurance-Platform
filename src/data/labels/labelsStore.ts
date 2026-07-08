export const DEFAULT_LABELS = {
  // Sidebar
  sidebar_title:   "لوحة الإدارة",
  sidebar_subtitle: "مسارات العمل الرئيسية",

  // Settings page
  page_settings_eyebrow:  "System Settings",
  page_settings_title:    "إعدادات النظام",
  page_settings_subtitle: "تخصيص تسميات النظام — تُطبَّق فورياً في جميع أنحاء التطبيق",

  // Employee workspace pages
  page_xray_referrals_eyebrow:      "Inspection Workspace",
  page_xray_referrals_title:        "صور الأشعة المحالة",
  page_xray_referrals_subtitle_own: "اعرض العينات المسندة إليك وأكمل نموذج الفحص لكل صورة.",
  page_xray_referrals_subtitle_all: "عرض جميع صور الأشعة المحالة ومتابعة حالة الفحص.",
  page_xray_results_eyebrow:        "Inspection Results",
  page_xray_results_title:          "نتائج فحص الأشعة",
  page_xray_results_subtitle:       "جدول يجمع بيانات العينات الظاهرة مع إجابات نموذج الفحص.",

  // Shared table controls
  dt_search_placeholder:     "بحث في جميع الأعمدة...",
  dt_clear_filters:          "مسح التصفية",
  dt_export_xlsx:            "تصدير XLSX",
  dt_columns_button:         "الأعمدة",
  dt_columns_title:          "الأعمدة",
  dt_columns_hint:           "اسحب للترتيب · انقر لإخفاء/إظهار",
  dt_reset_default:          "إعادة الافتراضي",
  dt_done:                   "تم",
  dt_row_suffix:             "صف",
  dt_filter_clear:           "مسح",
  dt_filter_empty:           "لا توجد قيم",
  dt_filter_search:          "ابحث...",
  dt_filter_apply:           "تطبيق",
  dt_filter_specific_day:    "يوم محدد",
  dt_filter_range:           "نطاق",
  dt_filter_from:            "من",
  dt_filter_to:              "إلى",
  dt_date_badge:             "تاريخ",
  dt_show_column:            "إظهار",
  dt_hide_column:            "إخفاء",

  // Stage names
  stage_first:   "المستوى الأول",
  stage_second:  "المستوى الثاني",
  stage_third:   "المستوى الثالث",
  stage_fourth:  "المستوى الرابع",
  stage_unknown: "غير محدد",

  // CertScan
  certscan_name:    "نظام الأشعة المركزية (CertScan)",
  noncertscan_name: "غير المركزية (NonCertScan)",

  // X-ray table columns
  col_xray_image_id:             "معرف الأشعة",
  col_stage:                     "المستوى",
  col_xray_quality_expert:       "خبير جودة الأشعة",
  col_port_name:                 "المنفذ",
  col_xray_entry_date:           "تاريخ دخول صورة الأشعة",
  col_distribution_date:         "تاريخ التوزيع",
  col_expert_observation_date:   "تاريخ رصد الخبير",
  col_plate_or_container_number: "لوحة / حاوية",
  col_answer_status:             "الحالة",
  col_xray_l1_result:            "نتيجة L1",
  col_xray_l2_result:            "نتيجة L2",
  col_certscan_status:           "CertScan",
  col_declaration_number:        "رقم البيان",
  col_declaration_date:          "تاريخ البيان",
  col_chassis_number:            "رقم الهيكل",
  col_movement_type:             "نوع الحركة",
  col_port_code:                 "كود المنفذ",
  col_port_type:                 "نوع المنفذ",
  col_targeted_by_risk:          "مستهدف بالمخاطر",
  col_risk_message:              "رسالة المخاطر",
  col_bi_enrichment_status:      "حالة BI",
  col_report_number:             "رقم التقرير",

  // Common statuses and placeholders
  status_all:       "الكل",
  status_completed: "مكتملة",
  status_submitted: "مقدمة",
  status_draft:     "مسودة",
  status_pending:   "لم تُبدأ",
  status_replaced:  "مستبدلة",
  value_empty:      "—",
  label_month:      "الشهر",
  label_template:   "النموذج",

  // X-ray results messages
  xray_results_loading:   "جاري تحميل نتائج الفحص...",
  xray_results_error:     "تعذر تحميل نتائج فحص الأشعة.",
  xray_results_no_months: "لا توجد أشهر معالجة لعرض نتائج فحص الأشعة.",
  xray_results_no_rows:   "لا توجد نتائج فحص محفوظة للشهر المحدد.",

  // Population — sampling & processing guards
  sample_redraw_blocked: "لا يمكن إعادة سحب العينة بعد بدء التوزيع: يوجد سجل توزيع فعّال لهذا الشهر، وإعادة السحب ستؤدي إلى فقدان التعيينات والإجابات المسجلة.",
  population_reprocess_confirm_title: "إعادة معالجة شهر يحتوي عينة",
  population_reprocess_confirm_message: "توجد عينة مسحوبة لهذا الشهر بالفعل. حفظ نتائج المعالجة الجديدة سيجعل العينة الحالية غير متطابقة مع المجتمع الجديد. هل تريد المتابعة والحفظ؟",
  population_reprocess_cancelled: "تم إلغاء الحفظ — بقيت بيانات الشهر السابقة دون تغيير.",

  // Month close-out / lock (Tier-1 Item A)
  archive_close_month_btn:          "إقفال الشهر",
  archive_reopen_month_btn:         "إعادة فتح الشهر",
  archive_month_closed_badge:       "مُقفل",
  archive_close_month_confirm:      "سيتم إقفال الشهر ومنع أي تعديل على بياناته (العينات، التوزيع، الإجابات، الإحالات). هل أنت متأكد؟",
  archive_reopen_month_confirm:     "سيتم إعادة فتح الشهر والسماح بالتعديل مجدداً. يتطلب ذكر السبب.",
  archive_close_note_placeholder:   "ملاحظة الإقفال (اختياري)",
  archive_reopen_reason_placeholder: "سبب إعادة الفتح (إلزامي)",
  msg_month_closed_write_blocked:   "هذا الشهر مُقفل — لا يمكن حفظ أي تعديل. تواصل مع مدير النظام لإعادة فتحه.",
  msg_month_closed_banner:          "هذا الشهر مُقفل. البيانات للعرض فقط.",

  // User deletion guard (Tier-1 Item B)
  um_delete_checking:            "جاري التحقق من تعيينات المستخدم...",
  um_delete_blocked_assignments: "لا يمكن حذف المستخدم — لديه عينات نشطة معيّنة له. أعد توزيع عيناته أولاً من تبويب المجتمع والعينات.",
  um_delete_blocked_month_line:  "{month}: {count} عينة نشطة",
  um_delete_orphan_answers_warn: "تنبيه: توجد ملفات إجابات محفوظة لهذا المستخدم في أشهر سابقة. ستبقى محفوظة للتقارير ولن تُحذف.",
  um_delete_no_workspace_warn:   "لا يوجد مجلد عمل متصل — تعذر التحقق من تعيينات المستخدم قبل الحذف.",

  // Referral approval idempotency (Tier-1 Item C)
  msg_request_already_reviewed: "تمت مراجعة هذا الطلب مسبقاً — تم تحديث القائمة.",
  msg_referral_stale_ownership: "تعذر الاعتماد — بعض العينات لم تعد معيّنة للموظف الطالب: {ids}. حدّث الصفحة وراجع الطلب.",
  msg_referral_decision_retry:  "تم نقل العينات لكن تعذر حفظ قرار الاعتماد — اضغط اعتماد مرة أخرى لإكمال التسجيل (لن يتكرر النقل).",

  // Reopen-for-correction (Tier-1 Item D)
  ip_reopen_btn:                "إعادة فتح للتصحيح",
  ip_reopen_reason_placeholder: "سبب إعادة الفتح (إلزامي)",
  ip_reopen_confirm:            "سيتم إرجاع هذه الإجابة إلى مسودة ليتمكن الموظف من تصحيحها. يُسجل هذا الإجراء في سجل النظام.",
  msg_reopen_done:              "تمت إعادة فتح الإجابة للتصحيح.",
  feature_ew_reopen_answer:     "إعادة فتح الإجابات المقدمة",

  // Backup coverage + restore semantics (Tier-1 Items F/G)
  backup_import_users_labels_btn:  "استيراد المستخدمين والتسميات من النسخة",
  backup_import_users_labels_done: "تم استيراد المستخدمين والصلاحيات والتسميات من النسخة الاحتياطية.",
  backup_restore_merge_notice:     "ملاحظة: الاستعادة تُعيد كتابة الملفات الموجودة في النسخة فقط، ولا تحذف الملفات التي أُنشئت بعدها. البيانات الأحدث من النسخة ستبقى كما هي. تُنشأ نسخة رجوع تلقائية قبل الاستعادة.",

  // refreshDistribution guard (Tier-1 Item H)
  msg_distribution_refresh_no_sample: "تعذر تحديث حالة التوزيع — لم يتم العثور على عينة محفوظة لهذا الشهر.",

  // KPIs
  kpi_population:      "إجمالي المجتمع",
  kpi_sample:          "إجمالي العينة",
  kpi_completed:       "المدروسة",
  kpi_completion_rate: "نسبة الإنجاز",
  kpi_pending:         "قيد الانتظار",
  kpi_months:          "الأشهر المعالجة",

  // Executive view
  exec_report_title:        "التقرير التنفيذي",
  exec_chart_port:          "توزيع المجتمع حسب المنفذ",
  exec_chart_daily:         "توزيع المجتمع على حسب اليوم",
  exec_chart_stage:         "توزيع المجتمع حسب المستوى",
  exec_chart_stage_summary: "ملخص حسب المستوى",

  // Overview view
  ov_chart_trend:         "تطور المجتمع والعينة والإنجاز عبر الأشهر",
  ov_chart_certscan:      "توزيع نظام الأشعة المركزية / غير المركزية",
  ov_chart_dist_status:   "حالة التوزيع",
  ov_chart_stage_month:   "توزيع المجتمع حسب المستوى والشهر",
  ov_chart_rates:         "نسبة العينة ونسبة الإنجاز عبر الأشهر",
  ov_chart_top_ports:     "أعلى 10 منافذ من حيث حجم المجتمع والعينة",
  ov_chart_month_summary: "ملخص كل شهر",

  // ── Management report (تقرير الإدارة) — C2 (Batch 2) ──
  // Report output
  mgmt_report_title:            "تقرير الإدارة",
  mgmt_report_subtitle:         "ملخّص إداري موجز لأداء ضمان جودة الأشعة",
  mgmt_report_period_label:     "الفترة",
  mgmt_report_issued_label:     "تاريخ الإصدار",
  mgmt_report_print:            "طباعة / PDF",
  mgmt_report_generated_by:     "مُولّد آلياً من نظام ضمان جودة الأشعة",
  mgmt_report_kpi_accuracy:     "دقة الفحص الإجمالية",
  mgmt_report_kpi_detection:    "معدل كشف الاشتباه",
  mgmt_report_kpi_missed:       "الاشتباه الفائت (مخاطرة)",
  mgmt_report_kpi_completion:   "نسبة الإنجاز",
  mgmt_report_scope_title:      "النطاق والتغطية",
  mgmt_report_scope_population: "المجتمع",
  mgmt_report_scope_sample:     "العينة",
  mgmt_report_scope_coverage:   "التغطية",
  mgmt_report_scope_studied:    "المدروسة",
  mgmt_report_employees_title:  "أداء المراجعين والمقارنة بينهم",
  mgmt_report_col_reviewer:     "المراجع",
  mgmt_report_col_studied:      "المدروسة",
  mgmt_report_col_accuracy:     "الدقة",
  mgmt_report_col_detection:    "كشف الاشتباه",
  mgmt_report_col_missed:       "الاشتباه الفائت",
  mgmt_report_col_status:       "الحالة",
  mgmt_report_col_action:       "التوصية",
  mgmt_report_reviewers_empty:  "لا توجد بيانات مراجعين كافية لهذه الفترة.",
  mgmt_report_bi_unmapped:      "هوية المفتش غير مرتبطة (لم تتم مطابقة BI) — تُعرض أعباء عمل المراجعين ودقتهم فقط، لا دقة المفتشين الفرديين.",
  mgmt_report_ports_title:      "الدقة حسب المنفذ",
  mgmt_report_col_port:         "المنفذ",
  mgmt_report_col_evaluable:    "قابلة للتقييم",
  mgmt_report_col_sufficiency:  "الكفاية",
  mgmt_report_ports_empty:      "لا توجد بيانات منافذ قابلة للتقييم لهذه الفترة.",
  mgmt_report_actions_title:    "الأولويات والإجراءات",
  mgmt_report_actions_empty:    "لا توجد إجراءات ذات أولوية لهذه الفترة.",
  mgmt_report_dq_title:         "جودة البيانات",
  mgmt_report_dq_evaluable:     "قرارات قابلة للتقييم",
  mgmt_report_dq_total:         "إجمالي القرارات",
  mgmt_report_dq_bi_available:  "بيانات BI متاحة",
  mgmt_report_dq_bi_missing:    "بيانات BI غير متاحة",
  mgmt_report_status_reliable:      "موثوق",
  mgmt_report_status_insufficient:  "بيانات غير كافية",
  mgmt_report_band_sufficient:  "كافٍ",
  mgmt_report_band_limited:     "محدود",
  mgmt_report_band_insufficient: "غير كافٍ",
  mgmt_report_band_none:        "لا توجد بيانات",
  // Reports-tab card + toasts
  mgmt_card_desc:               "ملخّص إداري موجز للشهر المحدد — دقة الفحص، الاشتباه الفائت، ومقارنة أداء المراجعين، مع أولويات الإجراءات. جاهز للطباعة والمشاركة.",
  mgmt_card_badge_ready:        "جاهز",
  mgmt_card_tag_summary:        "ملخّص تنفيذي",
  mgmt_card_tag_compare:        "مقارنة المراجعين",
  mgmt_card_button:             "توليد التقرير",
  mgmt_card_generating:         "جاري…",
  mgmt_card_toast_opened:       "تم فتح تقرير الإدارة — استخدم طباعة/PDF.",
  mgmt_card_toast_no_population: "لم يتم العثور على بيانات المجتمع. يجب معالجة المجتمع أولاً.",

  // ── First-run admin checklist — C3 (Batch 2) ──
  firstrun_title:                    "خطوات البدء السريع",
  firstrun_subtitle:                 "أكمل الخطوات التالية لتجهيز النظام",
  firstrun_dismiss:                  "إخفاء",
  firstrun_progress_of:              "من",
  firstrun_step_structure_title:     "إنشاء بنية مساحة العمل",
  firstrun_step_structure_desc:      "تم إنشاء مجلدات النظام الأساسية.",
  firstrun_step_users_title:         "إضافة المستخدمين",
  firstrun_step_users_desc:          "أنشئ حسابات الموظفين والمشرفين والمدراء.",
  firstrun_step_users_action:        "إدارة المستخدمين",
  firstrun_step_permissions_title:   "ضبط الصلاحيات",
  firstrun_step_permissions_desc:    "خصّص صلاحيات الأدوار حسب احتياج فريقك.",
  firstrun_step_permissions_action:  "الصلاحيات",
  firstrun_step_month_title:         "استيراد أول شهر",
  firstrun_step_month_desc:          "استورد بيانات المخاطر/BI وعالِج أول مجتمع.",
  firstrun_step_month_action:        "معالجة البيانات",
  firstrun_demo_hint:                "لمعاينة النظام في وضع العرض التجريبي (قراءة فقط): من شاشة اختيار مساحة العمل، اضغط Alt+A ثم Alt+T.",
} as const;

export type LabelKey = keyof typeof DEFAULT_LABELS;
export type Labels = Record<LabelKey, string>;

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
const LABELS_STORAGE_KEY = "xray_custom_labels_v1";

let customLabels: Partial<Record<LabelKey, string>> = (() => {
  try {
    const raw = localStorage.getItem(LABELS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<LabelKey, string>>) : {};
  } catch {
    return {};
  }
})();

function persistLabels(): void {
  try {
    if (Object.keys(customLabels).length === 0) {
      localStorage.removeItem(LABELS_STORAGE_KEY);
    } else {
      localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(customLabels));
    }
  } catch {
    // non-fatal fallback
  }
}

export function getLabels(): Labels {
  return { ...DEFAULT_LABELS, ...customLabels } as Labels;
}

/** Read-only copy of the current custom-label overrides (Tier-1 Item F: backup snapshot). */
export function getCustomLabelOverrides(): Partial<Record<LabelKey, string>> {
  return { ...customLabels };
}

export function isCustomized(key: LabelKey): boolean {
  return key in customLabels;
}

export function setLabel(key: LabelKey, value: string): void {
  const trimmed = value.trim();
  if (!trimmed || trimmed === DEFAULT_LABELS[key]) {
    delete customLabels[key];
  } else {
    customLabels[key] = trimmed;
  }
  persistLabels();
  subscribers.forEach((fn) => fn());
}

export function resetLabel(key: LabelKey): void {
  delete customLabels[key];
  persistLabels();
  subscribers.forEach((fn) => fn());
}

export function resetAllLabels(): void {
  customLabels = {};
  persistLabels();
  subscribers.forEach((fn) => fn());
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
