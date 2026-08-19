/**
 * Label keys for the phaseOne screen of the 2026-08 design-handoff redesign.
 *
 * Split out of `labelsStore.ts` so each redesigned screen owns exactly one
 * label file. They are spread back into `DEFAULT_LABELS` there, so every key
 * defined here behaves like any other label: overridable from the Settings tab,
 * persisted to `xray_custom_labels_v1`, and read via `getLabels()`/`useLabels()`.
 */
export const phaseOneLabels = {
  // ── BI source card (multi-file) ────────────────────────────────────────────
  phase_one_bi_title:        "بيانات ذكاء الأعمال",
  phase_one_bi_description:  "يُستخدم لتعبئة الخانات الفارغة فقط عند تطابق معرف الأشعة واسم المنفذ — لا يمنع المعالجة.",
  phase_one_bi_optional_badge: "اختياري",
  /** Header pill. `{count}` attached files, `{max}` the cap. */
  phase_one_bi_count_pill:   "{count} من {max} ملفات",
  phase_one_bi_list_aria:    "ملفات ذكاء الأعمال المرفقة",
  phase_one_bi_col_file:     "الملف",
  phase_one_bi_col_size:     "الحجم",
  phase_one_bi_col_accepted: "الصفوف المقبولة",
  phase_one_bi_remove_file:  "إزالة الملف",
  phase_one_bi_parsing:      "جارٍ القراءة…",
  phase_one_bi_pending:      "بانتظار القراءة",
  phase_one_bi_no_value:     "—",
  // Fix (population): a total worker failure (crash/OOM watchdog/messageerror)
  // used to silently reset an in-flight BI row back to "ready" with no
  // acceptedRows value, indistinguishable from an unparsed-but-fine row. This
  // key gives that failure an explicit error state instead.
  phase_one_bi_worker_failed: "تعذّرت قراءة الملفات — حاول مرة أخرى.",
  phase_one_bi_empty_list:   "لم يتم إرفاق أي ملف ذكاء أعمال بعد.",

  // ── Add-more zone ─────────────────────────────────────────────────────────
  phase_one_bi_add_title:    "أضف ملفاً آخر — يظهر كسطر جديد في القائمة",
  /** `{remaining}` slots left, `{max}` the cap. */
  phase_one_bi_add_hint:     "‎.xlsx أو ‎.xls أو ‎.csv · يمكن اختيار عدة ملفات معاً · بقي {remaining} من أصل {max}",
  phase_one_bi_add_button:   "اختيار ملفات",
  phase_one_bi_cap_reached:  "تم بلوغ الحد الأقصى ({max} ملفات). أزل ملفاً قبل إضافة غيره.",

  // ── Footer total (derived, never stored) ──────────────────────────────────
  phase_one_bi_total_label:  "إجمالي الصفوف المقبولة من ملفات ذكاء الأعمال:",

  // ── Errors ────────────────────────────────────────────────────────────────
  phase_one_bi_cap_error:    "لا يمكن إرفاق أكثر من {max} ملفات ذكاء أعمال. تم تجاهل الملفات الزائدة.",
  phase_one_unsupported_file: "صيغة الملف غير مدعومة. الرجاء اختيار ملف بصيغة XLSX أو XLS أو CSV.",
  /**
   * Raised when a file contributed zero rows because none of its sheet names
   * (for a CSV: the name derived from the file name) matched a configured
   * pattern — the "imports zero rows silently" failure this screen must make
   * explicit. `{sheets}` lists the unmatched names.
   */
  phase_one_bi_unclassified: "لم يتطابق أي اسم ورقة في هذا الملف مع أنماط الأوراق المُعرّفة ({sheets})، ولم يُقبل منه أي صف. أعد تسمية الملف باسم الورقة (مثل: بحري وارد) أو عدّل أنماط الأوراق في إعدادات الربط.",
  /**
   * PROD-1: the file imported normally, but no configured pattern matched its
   * sheet/file name, so the name itself was used as the source. A non-blocking
   * advisory — the row stays "ready" and its rows are in the population.
   * `{sheets}` lists the unmatched names.
   */
  phase_one_bi_unmatched_name: "تم استيراد الصفوف واستُخدم اسم الملف كمصدر ({sheets}) لأن الاسم لا يطابق أنماط الأوراق المُعرّفة.",
  /**
   * Fallback for a per-file failure whose thrown error carried no message —
   * the row used to render red with "—" as its only text.
   */
  phase_one_bi_unknown_error: "تعذّرت قراءة هذا الملف لسبب غير معروف. راجع سجل الأخطاء لمعرفة التفاصيل.",
  /** A file that parsed but yielded no usable row at all. */
  phase_one_bi_no_rows: "لم يُقرأ أي صف من هذا الملف. تحقّق من أن الملف يحتوي على صف عناوين وصفوف بيانات.",

  // ── Duplicate-normalizing header diagnostic (detection-only) ───────────────
  /**
   * Detection-only warning: two or more source column headers in `{sheet}`
   * normalize to the same internal key `{normalized}` (originals listed in
   * `{originals}`). The system silently keeps only the LAST matching column's
   * value for that field — this warning does not change that behavior, it only
   * surfaces it so the operator can see which columns collapsed together.
   */
  phase_one_duplicate_headers_warning:
    'تنبيه: في ورقة "{sheet}" يؤول أكثر من عمود إلى نفس المفتاح الموحّد "{normalized}" ({originals}). يعتمد النظام قيمة آخر عمود مطابق فقط لهذا الحقل — تحقّق من إعدادات تعيين الأعمدة إذا كانت هذه القيمة غير متوقعة.',
} as const;
