/**
 * Label keys for the phaseThreeFour screen of the 2026-08 design-handoff redesign.
 *
 * Split out of `labelsStore.ts` so each redesigned screen owns exactly one
 * label file. They are spread back into `DEFAULT_LABELS` there, so every key
 * defined here behaves like any other label: overridable from the Settings tab,
 * persisted to `xray_custom_labels_v1`, and read via `getLabels()`/`useLabels()`.
 *
 * Covers المرحلة 3 (اختيار العينة, design panel `4b`) and المرحلة 4
 * (توزيع العينة, design panel `5c`). Pre-existing keys that already said the
 * same thing (`sampling_running_total_*`, `sampling_floor_override_warning`,
 * `switching_advisory_*`) are deliberately NOT duplicated here — the redesign
 * regroups those strings, it does not restate them.
 */
export const phaseThreeFourLabels = {
  // ── المرحلة 3 — الإجمالي المتوقع card ────────────────────────────────
  p3_total_share_of_population: "{percent}% من المجتمع",

  // ── المرحلة 3 — grouped alerts card ─────────────────────────────────
  p3_alerts_title_none: "لا توجد تنبيهات قبل السحب",
  p3_alerts_title_one: "تنبيه واحد قبل السحب",
  p3_alerts_title_two: "تنبيهان قبل السحب",
  p3_alerts_title_many: "{count} تنبيهات قبل السحب",
  p3_alerts_caption: "لا تمنع السحب — لكنها تُغيّر النتيجة",
  p3_alerts_edit_link: "تعديل",
  p3_alert_tag_floor: "حد أدنى",
  p3_alert_tag_certscan: "CertScan",
  p3_alert_tag_advisory: "استرشادي",
  p3_alert_tag_population: "المجتمع",
  p3_alert_certscan_satisfied:
    "كوتا CertScan متاحة بالكامل في كل المستويات — {available} سجلاً متوفراً مقابل {requested} مطلوباً.",
  p3_alert_population_insufficient:
    "{stage}: المجتمع المتاح ({size}) أقل من الحد الأدنى المطلوب ({minRequired}) — سيتم سحب المجتمع كاملاً.",

  // ── المرحلة 3 — خطة السحب حسب المستوى ───────────────────────────────
  p3_plan_title: "خطة السحب حسب المستوى",
  p3_plan_caption: "عدّل الطريقة والقيمة وكوتا CertScan مباشرة في الجدول",
  p3_plan_col_stage: "المستوى",
  p3_plan_col_population: "المجتمع",
  p3_plan_col_method: "طريقة السحب",
  p3_plan_col_value: "القيمة المطلوبة",
  p3_plan_col_certscan_method: "كوتا CertScan",
  p3_plan_col_certscan_value: "قيمة كوتا CertScan",
  p3_plan_col_expected: "المتوقع",
  p3_plan_col_status: "الحالة",
  p3_plan_method_percentage: "نسبة مئوية (%)",
  p3_plan_method_exact: "عدد محدد",
  p3_plan_field_aria: "{field} — {stage}",
  p3_plan_status_ok: "سليم",
  p3_plan_status_locked: "مقفل",
  p3_plan_status_unlocked: "مفتوح",
  p3_plan_status_floor: "حد أدنى {minRequired}",
  p3_plan_status_insufficient: "المجتمع غير كافٍ",
  p3_plan_expected_instead_of: "بدل {entered}",
  p3_plan_totals_label: "الإجمالي",

  // ── المرحلة 3 — نتيجة السحب ─────────────────────────────────────────
  p3_result_title: "نتيجة السحب",
  p3_result_saved_pill: "محفوظة",
  p3_result_redraw: "إعادة السحب",
  p3_result_seed_label: "رمز التوزيع العشوائي",
  p3_result_seed_hint: "يُعدَّل من إعدادات المعالجة",
  p3_result_tile_actual: "المسحوب فعلياً",
  p3_result_tile_target: "المستهدف الكلي",
  p3_result_tile_certscan: "CertScan",
  p3_result_tile_normal: "سجلات عادية",
  p3_result_tile_actual_note_match: "مطابق للمستهدف بالكامل",
  p3_result_tile_actual_note_short: "أقل من المستهدف بـ {diff}",
  p3_result_tile_target_note: "حسب خطة السحب أعلاه",
  p3_result_tile_share_note: "{percent}% من العينة",
  p3_result_col_diff: "الفارق",
  p3_result_diff_complete: "مكتمل",
  p3_result_diff_short: "ناقص {diff} — السجلات المتاحة غير كافية",

  // ── المرحلة 4 — حالة التوزيع ────────────────────────────────────────
  p4_state_title: "حالة التوزيع",
  p4_state_headline_sub: "{assigned} من {total}",
  p4_state_completed: "مكتملة",
  p4_state_pending: "قيد الانتظار",
  p4_state_replaced: "مستبدلة",
  p4_state_unassigned: "غير معينة",

  // ── المرحلة 4 — التوزيع الجماعي ─────────────────────────────────────
  p4_bulk_title: "التوزيع الجماعي الذكي",
  p4_bulk_description:
    "يوزّع الصفوف غير المعينة فقط — {count} صفاً — حسب الحصص أدناه؛ الصفوف المعينة مسبقاً لا تتغيّر.",
  p4_bulk_apply: "تطبيق وحفظ التوزيع",
  p4_bulk_applying: "جاري توزيع وحفظ التعيينات...",
  p4_bulk_preview_info:
    "الحصص أدناه تُنتج {count} تعييناً جديداً موزّعة على {experts} من الخبراء — أي فارق يظهر فوراً في عمود «الجديد» قبل الحفظ.",
  p4_bulk_license_tag: "ترخيص",
  p4_bulk_license_warning:
    "{names} غير مرخّص لـ CertScan — لن تصل صفوف CertScan إليه في أي مستوى، وستُعاد حصته إلى بقية الخبراء.",

  // ── المرحلة 4 — حصص الخبراء عبر المستويات ───────────────────────────
  p4_matrix_title: "حصص الخبراء عبر المستويات",
  p4_matrix_caption: "الحصة لكل مستوى · صفر يستبعد الخبير من ذلك المستوى",
  p4_matrix_col_expert: "الخبير",
  p4_matrix_col_license: "ترخيص CertScan",
  p4_matrix_col_normal: "عادية",
  p4_matrix_col_certscan: "CertScan",
  p4_matrix_col_new: "الجديد",
  p4_matrix_col_normal_hint:
    "السجلات العادية المعيَّنة لهذا الخبير من هذه العينة — المعيَّن حالياً بالإضافة إلى ما سيضيفه التوزيع التالي.",
  p4_matrix_col_certscan_hint:
    "سجلات CertScan المعيَّنة لهذا الخبير من هذه العينة — المعيَّن حالياً بالإضافة إلى ما سيضيفه التوزيع التالي.",
  p4_matrix_col_new_hint:
    "ما سيضيفه التوزيع التالي فقط. صفر يعني أن كل صفوف هذا المستوى معيَّنة مسبقاً ولا يوجد ما يُوزَّع.",
  p4_matrix_field_aria: "حصة {expert} في {stage}",
  // Fix (population, 2026-08-18): a config saved before this matrix existed
  // could have a stage the admin had disabled (the old per-stage checkbox)
  // with a value left on file from before that. That cell now looks like any
  // other nonzero share, but it contributes NOTHING to the distribution until
  // the admin edits it (any edit sets isActive from the value). This note is
  // the only signal that a visibly nonzero cell is actually inert.
  p4_matrix_cell_inactive_note:
    "هذه الحصة معطّلة من إعداد سابق ولا تُحتسب — عدّل القيمة لتفعيلها",
  p4_matrix_license_yes: "مرخّص",
  p4_matrix_license_no: "غير مرخّص",
  p4_matrix_row_excluded: "مستبعدة",
  p4_matrix_totals_label: "الإجمالي",
  p4_matrix_totals_stage_ok: "مجموع حصص {stage} = {sum}",
  p4_matrix_totals_stage_warn: "مجموع حصص {stage} = {sum} — المتوقع 100",
  // Fix (population, 2026-08-18): the matrix dropped the per-cell method
  // select, so a legacy `exact`-method allocation (a row-count target, not a
  // percentage) now shares the same input as `percentage` allocations. Summing
  // the two together and comparing to 100 is meaningless, so a stage that mixes
  // methods gets this neutral note instead of a misleading ok/warn verdict.
  p4_matrix_totals_stage_mixed:
    "مجموع حصص {stage} = {sum} — تضم حصة بعدد محدد وليس نسبة، فلا ينطبق فحص 100%",

  // T-14: rows whose stage no longer resolves through the stage mappings are
  // skipped by bulk assignment. Silent before — the operator read "distributed"
  // as "the whole month is assigned" while these rows stayed unowned.
  p4_bulk_unmapped_warning: "تنبيه: {count} صفاً لم يُوزَّع لأن مستواه غير مطابق لإعدادات المستويات. راجع مطابقة المستويات ثم أعد التوزيع، أو عيّن هذه الصفوف يدوياً.",
  p4_bulk_unmapped_warning_stages: "تنبيه: {count} صفاً لم يُوزَّع لأن مستواه غير مطابق لإعدادات المستويات ({stages}). راجع مطابقة المستويات ثم أعد التوزيع، أو عيّن هذه الصفوف يدوياً.",

  // ── المرحلة 4 — pill switch + المراجعة اليدوية ──────────────────────
  p4_tab_bulk: "التوزيع الجماعي",
  p4_tab_manual: "المراجعة اليدوية",
  p4_manual_title: "المراجعة اليدوية",
  p4_manual_caption: "تعيين أو استبدال صف بعينه · {unassigned} غير معينة · {replacement} طلب استبدال",
  p4_manual_expand_hint: "اضغط للعرض",
  p4_manual_collapse_hint: "اضغط للإخفاء",
  p4_manual_search_placeholder: "بحث بمعرف الأشعة…",
  p4_manual_all_experts: "كل الخبراء",
  p4_manual_unassigned_option: "غير معينة",
  p4_manual_clear_filters: "مسح الفلاتر",
  p4_manual_empty: "لا توجد نتائج مطابقة للفلاتر الحالية.",
  p4_manual_col_xray: "معرف الأشعة",
  p4_manual_col_port: "المنفذ",
  p4_manual_col_certscan: "CertScan",
  p4_manual_col_status: "الحالة",
  p4_manual_col_expert: "خبير جودة الأشعة",
  p4_manual_col_action: "الإجراء",

  // ── المرحلة 4 — per-row actions ─────────────────────────────────────
  p4_row_select_expert: "اختر خبيراً…",
  p4_row_reassign_to: "إعادة التعيين إلى…",
  p4_row_assign: "تعيين",
  p4_row_reassign: "إعادة تعيين",
  p4_row_complete: "مكتمل",
  p4_row_replace: "استبدال",
  // No approve/reject buttons here on purpose — that decision has one home,
  // the اعتماد الطلبات sub-tab. See DistributionRow's module comment.
  p4_row_replacement_elsewhere:
    "بانتظار البت في طلب الاستبدال من صفحة اعتماد الطلبات في مساحة العمل.",
  p4_row_no_action: "لا إجراء — النتيجة مسجّلة",
  p4_row_expert_aria: "الخبير المستلم للصف {xrayImageId}",
} as const;
