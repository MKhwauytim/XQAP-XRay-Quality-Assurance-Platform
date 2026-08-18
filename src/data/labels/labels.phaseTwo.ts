/**
 * Label keys for the phaseTwo screen of the 2026-08 design-handoff redesign.
 *
 * Split out of `labelsStore.ts` so each redesigned screen owns exactly one
 * label file. They are spread back into `DEFAULT_LABELS` there, so every key
 * defined here behaves like any other label: overridable from the Settings tab,
 * persisted to `xray_custom_labels_v1`, and read via `getLabels()`/`useLabels()`.
 *
 * `{placeholder}` slots are filled with `.replace("{name}", value)` at the call
 * site, matching the convention already used across `labelsStore.ts`.
 */
export const phaseTwoLabels = {
  // ── Verdict row · دقة البيانات الكلية card ────────────────────────────────
  p2_accuracy_title:                "دقة البيانات الكلية",
  p2_accuracy_comparisons:          "من {count} مقارنة",
  p2_accuracy_worst_sentence:       "{mismatched} من {total} أعمدة بها اختلافات — أكبرها {column} بدقة {accuracy}%.",
  p2_accuracy_all_match_sentence:   "كل أعمدة المقارنة الـ{total} متطابقة بالكامل بين وكالة المخاطر و BI.",
  p2_accuracy_matched_ids:          "معرّفات المقارنة",
  p2_accuracy_only_in_risk:         "فقط في المخاطر",
  p2_accuracy_rows_with_mismatch:   "سجلات بها اختلاف",

  // ── Verdict row · نتيجة المعالجة card ─────────────────────────────────────
  p2_result_title:                  "نتيجة المعالجة",
  p2_result_subtitle:               "شهر {month} · CertScan من إعدادات المعالجة",
  p2_result_saved_note:             "حُفظ في مساحة العمل",
  p2_result_export_excel:           "تصدير Excel",
  p2_result_reprocess:              "إعادة المعالجة",
  p2_result_process:                "معالجة المجتمع",
  p2_tile_final_population:         "المجتمع النهائي",
  p2_tile_final_population_caption: "{percent} من الأصلية",
  p2_tile_excluded:                 "المستبعد بعد المعالجة",
  p2_tile_excluded_caption:         "{duplicates} مكرر · {invalidResults} نتيجة · {invalidIds} معرف",
  p2_tile_certscan_split:           "CertScan / NonCertScan",
  p2_tile_certscan_caption:         "{certScan} · {nonCertScan}",
  p2_tile_certscan_unavailable:     "لم تُوفَّر قائمة CertScan",
  p2_tile_bi_fill:                  "تعبئة من BI",
  p2_tile_bi_fill_caption:          "خانة في {count} أعمدة",
  p2_strip_bi_match:                "{percent} من صفوف المخاطر لا يقابلها معرّف في BI — طبيعي حين تُغطي ملفات BI منافذ محددة فقط، لكنه يحد من تعبئة الخانات.",
  p2_strip_bi_missing:              "لم يتم رفع ملف BI لهذا التشغيل — لم تُنفَّذ أي تعبئة للخانات من BI.",
  p2_strip_certscan_missing:        "لم يتم توفير قائمة أجهزة CertScan لهذا التشغيل — القيمة صفر لأن المطابقة لم تُجرَ أصلاً، وليست لأن المطابقة فشلت. أضف قائمة CertScan من إعدادات المعالجة لتفعيل التصنيف.",

  // ── الأعمدة التي بها اختلاف ───────────────────────────────────────────────
  p2_mismatch_columns_title:        "الأعمدة التي بها اختلاف",
  // Fix (population, 2026-08-18): shown only on the defensive async fallback
  // path inside DataAccuracyReport (a caller that doesn't hoist its own
  // comparison) — the production Phase 2 path never reaches it.
  p2_accuracy_computing:             "جارٍ حساب مقارنة الدقة…",
  p2_mismatch_columns_badge:        "{mismatched} من {total}",
  p2_mismatch_columns_show_matched: "إظهار الأعمدة المتطابقة ({count})",
  p2_mismatch_columns_hide_matched: "إخفاء الأعمدة المتطابقة",
  p2_mismatch_columns_none:         "لا يوجد عمود به اختلاف — كل الأعمدة متطابقة.",
  p2_col_header_column:             "العمود",
  p2_col_header_matched:            "متطابق",
  p2_col_header_mismatched:         "مختلف",
  p2_col_header_accuracy:           "دقة",
  p2_col_inspect:                   "فحص",

  // ── تفاصيل الاختلافات ─────────────────────────────────────────────────────
  p2_details_title:                 "تفاصيل الاختلافات",
  // Owner request (2026-08-18): the details table is collapsed by default,
  // same disclosure pattern as معاينة المجتمع النهائي at the end of the page.
  p2_details_summary:               "{count} اختلاف مسجّل",
  p2_details_search_placeholder:    "بحث بمعرف الأشعة أو القيمة…",
  p2_details_search_aria:           "بحث بمعرف الأشعة أو القيمة",
  p2_details_chips_aria:            "تصفية الاختلافات حسب العمود",
  p2_details_chip_all:              "كل الأعمدة",
  p2_details_normalization_note:    "أعمدة النتائج مُوحَّدة — تُعرض القيمة النهائية فقط: «سليمة» أو «اشتباه»؛ الأكواد والصيغ الأصلية («1»، «2»، «يمكن فسحها»، «مشتبه») تُترجم تلقائياً.",
  p2_details_empty_all_match:       "لا توجد اختلافات — البيانات متطابقة بالكامل",
  p2_details_empty_filtered:        "لا توجد نتائج تطابق الفلتر المحدد",
  p2_details_header_id:             "معرف الأشعة",
  p2_details_header_column:         "العمود",
  p2_details_header_risk:           "قيمة وكالة المخاطر",
  p2_details_header_bi:             "قيمة BI",
  p2_value_empty_in_bi:             "— فارغ في BI",
  p2_value_empty:                   "—",
  p2_result_clean:                  "سليمة",
  p2_result_suspect:                "اشتباه",

  // ── تعبئة الخانات من BI ───────────────────────────────────────────────────
  p2_bi_fill_title:                 "تعبئة الخانات من BI",
  p2_bi_fill_total:                 "{count} خانة معبّأة",
  p2_bi_fill_header_column:         "العمود",
  p2_bi_fill_header_empty_before:   "فارغ قبل",
  p2_bi_fill_header_filled:         "معبّأ",
  p2_bi_fill_header_percent:        "نسبة التعبئة",
  p2_bi_fill_empty:                 "لا توجد أعمدة قابلة للتعبئة من BI في هذا التشغيل.",

  // ── الصفوف المستبعدة ──────────────────────────────────────────────────────
  p2_excluded_title:                "الصفوف المستبعدة",
  p2_excluded_duplicates:           "مكررات مستبعدة",
  p2_excluded_invalid_results:      "نتائج مستوى غير صالحة",
  p2_excluded_invalid_ids:          "معرفات غير صالحة",
  p2_excluded_top_reasons_title:    "أكثر أسباب استبعاد نتائج المستوى",
  p2_excluded_rows_unit:            "{count} صف",
  p2_excluded_examples:             "أمثلة: {examples}",
  p2_excluded_more_rows:            "+{count} صفاً إضافياً — التصدير الكامل متاح عبر زر تصدير Excel أعلاه.",
  p2_excluded_header_id:            "معرف الأشعة",
  p2_excluded_header_port:          "اسم المنفذ",
  p2_excluded_header_source_row:    "رقم الصف المصدر",
  p2_excluded_header_source_sheet:  "الورقة المصدر",
  p2_excluded_header_reason:        "السبب",

  // ── معاينة المجتمع النهائي ────────────────────────────────────────────────
  p2_preview_title:                 "معاينة المجتمع النهائي",
  p2_preview_summary:              "{rows} صف · CertScan {certScan} · NonCertScan {nonCertScan}",
  p2_preview_expand_hint:           "اضغط للعرض",
  p2_preview_collapse_hint:         "اضغط للإخفاء",
  p2_preview_header_id:             "معرف الأشعة",
  p2_preview_header_port:           "اسم المنفذ",
  p2_preview_header_stage:          "المستوى",
  p2_preview_header_level_one:      "المستوى الأول",
  p2_preview_header_level_two:      "المستوى الثاني",
  p2_preview_header_certscan:       "CertScan",
} as const;
