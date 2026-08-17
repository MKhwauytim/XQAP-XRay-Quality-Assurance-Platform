export const DEFAULT_LABELS = {
  // App identity
  app_display_name:                    "نظام متابعة أعمال فحص صور الأشعة",

  // Sidebar
  sidebar_title:   "لوحة الإدارة",
  sidebar_subtitle: "مسارات العمل الرئيسية",
  sidebar_aria_label:        "القائمة الجانبية",
  sidebar_logo_alt:          "هيئة الزكاة والضريبة والجمارك",
  sidebar_kicker:            "نظام جودة الأشعة",
  sidebar_mobile_close_aria: "إغلاق قائمة التنقل",
  sidebar_expand_label:      "توسيع القائمة",
  sidebar_collapse_label:    "طي القائمة",
  sidebar_nav_aria:          "تبويبات النظام",
  sidebar_nav_heading:       "إدارة النظام",

  // Tab lazy-loading
  app_tab_loading: "جارٍ التحميل…",

  // AdminToolbar (P3-6) — first-ever label wiring for this file
  toolbar_role_admin:         "الإدارة",
  toolbar_role_manager:       "المدير",
  toolbar_role_supervisor:    "المشرف",
  toolbar_role_employee:      "الموظف",
  toolbar_role_guest:         "ضيف",
  toolbar_mode_kicker:        "الوضع الحالي",
  toolbar_mode_demo:          "وضع العرض (قراءة فقط)",
  toolbar_mode_value:         "وضع {role}",
  toolbar_preview_flag:       "معاينة",
  toolbar_workspace_title:    "مساحة العمل: {name}",
  toolbar_preview_role_label: "معاينة الدور",
  toolbar_preview_role_aria:  "معاينة الأدوار",
  toolbar_user_title:         "المستخدم: {name}",
  toolbar_feedback_label:     "التواصل والاقتراحات",
  toolbar_refresh_btn:        "تحديث",
  toolbar_refresh_label:      "تحديث كل البيانات (العينات، الإحالات، الإشعارات، الصلاحيات) من مساحة العمل",
  toolbar_refresh_running:    "جارٍ التحديث...",
  toolbar_refresh_success:    "تم التحديث",
  toolbar_refresh_failed:     "تعذر التحديث",
  toolbar_logout_btn:         "تسجيل الخروج",

  // Settings page
  page_settings_eyebrow:  "إدارة النظام",
  page_settings_title:    "إعدادات النظام",
  page_settings_subtitle: "تخصيص تسميات النظام — تُطبَّق فورياً في جميع أنحاء التطبيق",

  // Settings → automatic sync interval (admin only)
  settings_sync_title:           "فترة المزامنة التلقائية",
  settings_sync_note:            "تحدد كل كم ثانية يقوم النظام تلقائياً بإعادة قراءة الصلاحيات والبيانات من مساحة العمل. يُحفظ الإعداد في مساحة العمل، فينطبق على كل الأجهزة التي تفتح المجلد نفسه.",
  settings_sync_current:         "الفترة الحالية: {seconds} ثانية",
  settings_sync_field:           "الفترة (بالثواني)",
  settings_sync_range_hint:      "القيمة المسموحة من {min} إلى {max} ثانية.",
  settings_sync_invalid:         "قيمة غير صالحة — أدخل عدداً صحيحاً من {min} إلى {max} ثانية.",
  settings_sync_save:            "حفظ الفترة",
  settings_sync_saving:          "جارٍ الحفظ…",
  settings_sync_saved:           "تم حفظ فترة المزامنة — ستُطبَّق على بقية الأجهزة خلال دورة مزامنة واحدة.",
  settings_sync_save_failed:     "تعذّر حفظ فترة المزامنة في مساحة العمل.",
  settings_sync_no_workspace:    "لا توجد مساحة عمل متصلة لحفظ هذا الإعداد.",
  settings_sync_no_permission:   "لا تملك صلاحية تعديل فترة المزامنة.",
  settings_sync_manual_note:     "لا يؤثر هذا الإعداد على زر التحديث اليدوي — يظل يعمل فوراً عند الضغط عليه.",

  // Employee workspace pages
  page_xray_referrals_eyebrow:      "مساحة عمل الفحص",
  page_xray_referrals_title:        "صور الأشعة المحالة",
  page_xray_referrals_subtitle_own: "اعرض العينات المسندة إليك وأكمل نموذج الفحص لكل صورة.",
  page_xray_referrals_subtitle_all: "عرض جميع صور الأشعة المحالة ومتابعة حالة الفحص.",
  page_xray_results_eyebrow:        "نتائج الفحص",
  page_xray_results_title:          "نتائج فحص الأشعة",
  page_xray_results_subtitle:       "جدول يجمع بيانات العينات الظاهرة مع إجابات نموذج الفحص.",

  // Shared table controls
  dt_search_placeholder:     "بحث في جميع الأعمدة...",
  dt_clear_filters:          "مسح التصفية",
  dt_export_xlsx:            "تصدير XLSX",
  dt_exporting:              "جارٍ التصدير...",
  msg_export_not_permitted:  "لا تملك صلاحية تصدير التقارير.",
  // The demo/viewer session is read-only (getMutationCapability reason
  // "read-only-mode") — distinct from msg_export_not_permitted, which covers
  // an actual missing-permission rejection.
  msg_export_read_only_demo: "وضع العرض التجريبي للقراءة فقط — لا يمكن تصدير التقارير من هذه الجلسة.",
  dt_autofit_title:          "ملاءمة عرض الأعمدة المرئية حسب المحتوى",
  dt_autofit_button:         "ملاءمة الأعمدة",
  dt_resize_handle_title:    "اسحب لتغيير العرض، أو انقر مرتين للملاءمة التلقائية",
  dt_no_results:             "لا توجد نتائج مطابقة",
  dt_filter_button_prefix:   "تصفية",
  dt_last_visible_column_hint: "يجب أن يبقى عمود واحد ظاهرًا على الأقل",
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
  // Ad-hoc import visibility badge (EmployeeWorkspace views) — distinguishes a
  // row that came from an admin's one-off Excel import (2-samples/adhoc-{id}/)
  // from a row drawn by the real monthly sampling pipeline.
  badge_adhoc_import:       "استيراد يدوي",
  badge_adhoc_import_title: "من ملف مستورد يدوياً",
  label_month:      "الشهر",
  // Global month selector (top toolbar)
  gm_label:                "الشهر",
  gm_new_month_btn:        "شهر جديد",
  gm_new_month_title:      "بدء شهر جديد",
  gm_year_label:           "السنة",
  gm_confirm:              "اختيار",
  gm_cancel:               "إلغاء",
  gm_pending_suffix:       "(جديد)",
  gm_locked_badge:         "مُقفل",
  gm_no_months:            "لا توجد أشهر",
  gm_all_months:           "كل الأشهر",
  gm_month_switch_confirm: "توجد بيانات غير محفوظة في معالجة المجتمع — تغيير الشهر سيتجاهلها ويحمّل بيانات الشهر المحدد. هل تريد المتابعة؟",
  label_template:   "النموذج",

  // X-ray results messages
  xray_results_loading:   "جاري تحميل نتائج الفحص...",
  xray_results_error:     "تعذر تحميل نتائج فحص الأشعة.",
  xray_results_no_months: "لا توجد أشهر معالجة لعرض نتائج فحص الأشعة.",
  xray_results_no_rows:   "لا توجد نتائج فحص محفوظة للشهر المحدد.",

  // Supervisor quality note on an item answer (P2-2) — independent of the
  // referral/replacement/reopen reviewNotes/DecisionEvent approval trail.
  col_quality_note:                "ملاحظة الجودة",
  ew_quality_note_add:             "إضافة ملاحظة",
  ew_quality_note_panel_title:     "ملاحظة الجودة (إشراف)",
  ew_quality_note_hint:            "ملاحظة إشرافية مستقلة لأغراض التوجيه — لا تُستخدم لاعتماد أو رفض أي طلب.",
  ew_quality_note_placeholder:     "أضف ملاحظة إشرافية اختيارية حول جودة هذه العينة...",
  ew_quality_note_save:            "حفظ الملاحظة",
  ew_quality_note_saving:          "جارٍ الحفظ...",
  ew_quality_note_saved:           "تم حفظ ملاحظة الجودة.",
  ew_quality_note_no_answer:       "لا توجد إجابة محفوظة بعد لإضافة ملاحظة عليها.",
  ew_quality_note_empty_readonly:  "لا توجد ملاحظة جودة لهذه العينة.",
  ew_quality_note_denied:          "لا تملك صلاحية إضافة ملاحظات الجودة، أو أن مساحة العمل للقراءة فقط.",

  // Shown when the open inspection panel's sample left this user's queue (a
  // supervisor reassigned or replaced it) while unsaved answers were typed in.
  // The panel is deliberately kept open instead of being swapped to another
  // x-ray — losing typed work to a background refresh is never acceptable.
  // Deleting an inspection template removes it from disk irreversibly. Until the
  // overlay audit this fired with no confirmation at all -- the only unconfirmed
  // destructive action in the app.
  // The message previously reassured the reader about the SAFE consequence only
  // (saved inspections are unaffected) and omitted the dangerous one:
  // deleteTemplate() clears template.selection.json whenever it points at the
  // template being deleted, which blanks the active inspection form for every
  // employee workspace-wide until a new template is chosen. `{name}` is
  // interpolated by the caller so the confirmation names its actual target.
  tb_delete_confirm_title:         "حذف النموذج",
  tb_delete_confirm_message:       "سيتم حذف النموذج «{name}» نهائياً من مساحة العمل، ولا يمكن التراجع عن هذا الإجراء. عمليات التفتيش المحفوظة سابقاً بهذا النموذج تبقى كما هي دون تأثير. لكن إذا كان هذا هو النموذج المُفعّل حالياً في استمارة الفحص، فسيؤدي حذفه إلى مسح اختيار النموذج على مستوى مساحة العمل بالكامل، وستظهر استمارة الفحص فارغة لدى جميع الموظفين إلى أن يتم اختيار نموذج آخر.",
  tb_delete_confirm_ok:            "حذف نهائي",
  ew_draft_retained_notice:        "تم نقل هذه العينة من قائمتك (إحالة أو استبدال أثناء العمل عليها). إجاباتك غير المحفوظة لا تزال معروضة هنا — انسخها قبل الانتقال إلى عينة أخرى.",

  // Population — sampling & processing guards
  sample_redraw_blocked: "لا يمكن إعادة سحب العينة بعد بدء التوزيع: يوجد سجل توزيع فعّال لهذا الشهر، وإعادة السحب ستؤدي إلى فقدان التعيينات والإجابات المسجلة.",

  // Four-eyes sample release gate (B1)
  sample_approval_section_title: "اعتماد العينة (مبدأ ازدواجية المراجعة)",
  sample_approval_intro:         "قبل بدء التوزيع، يجب اعتماد العينة المسحوبة من مسؤول (مشرف/مدير/مدير نظام) غير الشخص الذي سحبها.",
  sample_approval_pending:       "بانتظار الاعتماد — لا يمكن بدء توزيع هذه العينة قبل اعتمادها.",
  sample_approval_state:         "مُعتمدة بواسطة {user} ({role}) — {date}",
  sample_approval_note_label:    "ملاحظة الاعتماد",
  sample_approval_legacy_note:   "عينة سابقة بدون سجل اعتماد — تُعامل كمعتمدة سلفاً (توافق رجعي).",
  sample_approve_btn:            "اعتماد العينة",
  sample_approving:              "جارٍ الاعتماد...",
  sample_approve_self_blocked:   "لا يمكنك اعتماد عينة سحبتها بنفسك — يلزم اعتماد مسؤول آخر.",
  sample_approve_admin_self_note: "اعتماد ذاتي من مدير النظام (واقع فريق من 9 أشخاص) — سُجّلت ملاحظة تحذيرية بذلك.",
  sample_approve_no_permission:  "لا تملك صلاحية اعتماد العينة — تتطلب دور مشرف أو مدير أو مدير نظام.",
  sample_approve_done:           "تم اعتماد العينة بنجاح.",
  sample_approve_no_sample:      "لا توجد عينة مسحوبة للاعتماد.",
  sample_gate_blocked:           "يجب اعتماد العينة قبل الانتقال إلى مرحلة التوزيع.",

  // Switching-rule advisory (B4) — ISO 2859-1 / Z1.4 tightened/normal signal
  switching_advisory_title:      "توصية استرشادية (قاعدة التبديل)",
  switching_advisory_rate:       "معدل الاشتباه للشهر السابق ({month}): {rate}",
  switching_advisory_normal:     "التوصية: فحص عادي — معدل الاشتباه ضمن الحد المعتاد.",
  switching_advisory_tightened:  "التوصية: مراجعة مشددة — تجاوز معدل الاشتباه للشهر السابق حد التنبيه (5%). هذه إشارة استرشادية فقط ولا تُغيّر الحصص تلقائياً.",
  switching_advisory_disclaimer: "استرشادية فقط: القرار النهائي لتشديد المعاينة يعود للجهة المختصة.",
  population_reprocess_confirm_title: "إعادة معالجة شهر يحتوي عينة",
  population_reprocess_confirm_message: "توجد عينة مسحوبة لهذا الشهر بالفعل. حفظ نتائج المعالجة الجديدة سيجعل العينة الحالية غير متطابقة مع المجتمع الجديد. هل تريد المتابعة والحفظ؟",
  population_reprocess_cancelled: "تم إلغاء الحفظ — بقيت بيانات الشهر السابقة دون تغيير.",
  population_locked_summary_corrupt: "الشهر مُقفل والملخص المحفوظ لهذا الشهر تالف — لا يمكن عرض التقرير دون إعادة معالجة المجتمع بعد إعادة فتح الشهر.",
  population_locked_summary_missing: "الشهر مُقفل ولا يوجد ملخص محفوظ لهذا الشهر (شهر أقدم من هذه الميزة) — لا يمكن عرض التقرير دون إعادة معالجة المجتمع بعد إعادة فتح الشهر.",
  population_locked_report_notice: "الشهر مُقفل — هذا التقرير مبني على الملخص المحفوظ فقط، دون قراءة بيانات المجتمع الكاملة.",

  // Month close-out / lock (Tier-1 Item A)
  archive_close_month_btn:          "إقفال الشهر",
  archive_reopen_month_btn:         "إعادة فتح الشهر",
  archive_month_action_kicker:      "إدارة الشهر",
  archive_month_closed_badge:       "مُقفل",
  archive_close_month_confirm:      "سيتم إقفال الشهر ومنع أي تعديل على بياناته (العينات، التوزيع، الإجابات، الإحالات). هل أنت متأكد؟",
  archive_close_month_confirm_pending: "تنبيه: لا يزال هناك {pending} تعييناً غير مكتمل في توزيع هذا الشهر. سيتم إقفال الشهر رغم ذلك ومنع أي تعديل على بياناته.",
  archive_reopen_month_confirm:     "سيتم إعادة فتح الشهر والسماح بالتعديل مجدداً. يتطلب ذكر السبب.",
  archive_distribution_completed_label: "مكتمل",
  archive_distribution_pending_label:   "معلّق",
  archive_close_note_placeholder:   "ملاحظة الإقفال (اختياري)",
  archive_reopen_reason_placeholder: "سبب إعادة الفتح (إلزامي)",
  msg_month_closed_write_blocked:   "هذا الشهر مُقفل — لا يمكن حفظ أي تعديل. تواصل مع مدير النظام لإعادة فتحه.",
  msg_month_closed_banner:          "هذا الشهر مُقفل. البيانات للعرض فقط.",
  msg_month_closed_note_auto_lock:  "— أُقفل تلقائياً بعد اكتمال دراسة كل عناصر العينة.",
  msg_month_auto_lock_reason:       "إقفال تلقائي بعد اكتمال دراسة كل عناصر العينة.",
  msg_month_closed_note_closed_by:  "— أُقفل بواسطة {user}.",
  archive_reopen_month_in_progress: "جاري إعادة الفتح...",

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
  referral_review_saving:       "جارٍ حفظ القرار…",

  // Approval request list — explicit sort-order indicator (the pending queue
  // sorts oldest-first so nothing waits unseen, decided tabs sort newest-first
  // for a recent-activity feed; both are visible now instead of silent).
  approval_sort_oldest_first: "الأقدم أولاً",
  approval_sort_newest_first: "الأحدث أولاً",

  // Generic write-failure message. Domain-level failures carry their own Arabic
  // text via the result.ok === false branch; this covers thrown exceptions,
  // whose messages are internal English (e.g. safeWrite validation text).
  msg_unexpected_write_error: "تعذّر إتمام العملية بسبب خطأ غير متوقع أثناء الحفظ. أعد المحاولة، وإن تكرر الخطأ فأبلغ المسؤول.",

  // Feedback widget
  fb_category_suggestion:   "اقتراح",
  fb_category_issue:        "مشكلة",
  fb_category_inquiry:      "استفسار",
  fb_subtitle_manager:      "إدارة الرسائل والردود",
  fb_subtitle_user:         "أرسل ملاحظاتك للإدارة",
  fb_close_aria:            "إغلاق",
  fb_tab_new:               "إرسال رسالة",
  fb_tab_all:               "كل الرسائل",
  fb_filter_open:           "مفتوحة",
  fb_filter_resolved:       "مغلقة",
  fb_filter_all:            "الكل",
  fb_success_title:         "تم الإرسال بنجاح",
  fb_success_body:          "سيتم مراجعة رسالتك من قبل الإدارة",
  fb_success_send_another:  "إرسال رسالة أخرى",
  fb_message_type_label:    "نوع الرسالة",
  fb_message_label:         "الرسالة",
  fb_message_placeholder:   "اكتب رسالتك هنا...",
  fb_submit_btn:            "إرسال",
  fb_submitting:            "جاري الإرسال...",
  fb_submit_error_generic:  "تعذّر حفظ الملاحظة — أعد المحاولة.",
  fb_reply_error_generic:   "تعذّر حفظ الرد — أعد المحاولة.",
  fb_my_messages_label:     "رسائلي السابقة",
  fb_loading:               "جاري التحميل...",
  fb_empty:                 "لا توجد رسائل",
  fb_reply_placeholder:     "رد...",
  fb_reply_btn:             "رد",
  fb_reply_sending:         "...",
  fb_resolve_btn:           "إغلاق",
  fb_resolved_badge:        "مغلقة",

  // Login screen (AuthGate) — the first screen every user sees
  auth_tagline:                 "منصة فحص صور الأشعة",
  auth_login_title:             "تسجيل الدخول",
  auth_login_subtitle:          "أدخل بياناتك للمتابعة",
  auth_username_label:          "اسم المستخدم",
  auth_username_placeholder:    "أدخل اسم المستخدم",
  auth_password_label:          "كلمة المرور",
  auth_password_placeholder:    "أدخل كلمة المرور",
  auth_password_toggle_aria:    "إظهار أو إخفاء كلمة المرور",
  auth_login_btn:               "دخول",
  auth_lockout_wait:            "يُرجى الانتظار ({seconds}ث)",
  auth_no_active_users:         "لا يوجد مستخدمون مفعلون حالياً.",
  auth_change_folder_btn:       "تغيير المجلد",
  auth_clear_session_btn:       "مسح الجلسة",
  auth_forget_user_btn:         "نسيان المستخدم",
  auth_admin_modal_title:       "دخول مسؤول النظام",
  auth_admin_modal_desc:        "أدخل رمز دخول مسؤول النظام.",
  auth_admin_passcode_aria:     "رمز مسؤول النظام",
  auth_admin_passcode_placeholder: "رمز مسؤول النظام",
  // Login status messages
  auth_msg_invalid_credentials: "اسم المستخدم غير موجود أو كلمة المرور غير صحيحة.",
  auth_msg_user_inactive:       "هذا المستخدم غير مفعل.",
  auth_msg_login_success:       "تم الدخول بنجاح.",
  auth_msg_bad_admin_passcode:  "رمز مسؤول النظام غير صحيح.",
  auth_msg_permissions_updated: "تم تحديث صلاحياتك، يرجى تسجيل الدخول مجدداً",
  auth_msg_session_expired:     "انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً",

  // Shared pagination control (used by every list/table view)
  pg_nav_aria:        "التنقل بين صفحات البيانات",
  pg_summary:         "عرض {from} إلى {to} من {total} {item}",
  pg_first_label:     "الأولى",
  pg_first_aria:      "الصفحة الأولى",
  pg_prev_label:      "السابق",
  pg_prev_aria:       "الصفحة السابقة",
  pg_page_label:      "الصفحة",
  pg_page_number_aria: "رقم الصفحة",
  pg_of_label:        "من {total}",
  pg_next_label:      "التالي",
  pg_next_aria:       "الصفحة التالية",
  pg_last_label:      "الأخيرة",
  pg_last_aria:       "الصفحة الأخيرة",

  // Shared app chrome — crash screen, access denial, data-view states, confirms
  errbound_title:               "حدث خطأ غير متوقع",
  errbound_retry_btn:           "المحاولة مجدداً",
  errbound_reload_btn:          "إعادة تحميل الصفحة",
  access_denied_title:          "غير مصرح",
  access_denied_body:           "لا تملك صلاحية الوصول إلى هذا القسم.",
  access_denied_hint:           "تواصل مع مسؤول النظام إذا كنت بحاجة لهذا الوصول.",
  state_error_default_title:    "تعذّر عرض هذه البيانات",
  confirm_dialog_default_title: "تأكيد الإجراء",
  confirm_dialog_default_ok:    "تأكيد",
  confirm_dialog_default_cancel: "إلغاء",

  // Inspection panel — form chrome and validation
  ip_submit_btn:                "تقديم",
  ip_submitting:                "جارٍ التقديم…",
  ip_next_phase_btn:            "المرحلة التالية",
  ip_msg_missing_required_submit: "أكمل جميع الحقول الإلزامية قبل التقديم.",
  ip_msg_missing_required_phase:  "أكمل الحقول الإلزامية في هذه المرحلة قبل الانتقال.",
  ip_no_template_msg:           "اختر نموذجاً لعرض حقول الفحص.",
  ip_no_visible_fields_msg:     "لا توجد حقول ظاهرة في هذه المرحلة.",
  ip_select_placeholder:        "اختر...",
  ip_field_required_error:      "هذا الحقل إلزامي.",

  // Reopen-for-correction (Tier-1 Item D)
  ip_reopen_btn:                "إعادة فتح للتصحيح",
  ip_reopen_reason_placeholder: "سبب إعادة الفتح (إلزامي)",
  ip_reopen_confirm:            "سيتم إرجاع هذه الإجابة إلى مسودة ليتمكن الموظف من تصحيحها. يُسجل هذا الإجراء في سجل النظام.",
  msg_reopen_done:              "تمت إعادة فتح الإجابة للتصحيح.",
  feature_ew_reopen_answer:     "إعادة فتح الإجابات المقدمة",

  // Employee self-service reopen-case request (Batch B)
  ew_reopen_request_btn:        "طلب إعادة فتح الحالة",
  ew_reopen_request_confirm:    "سيتم إرسال طلب لإعادة فتح هذه الحالة. إذا كانت صلاحيتك تسمح بالفتح الفوري فسيُطبَّق مباشرة، وإلا فسيُحوَّل للمشرف للاعتماد.",
  msg_reopen_request_sent:      "تم إرسال طلب إعادة فتح الحالة — بانتظار موافقة المشرف.",

  // Backup coverage + restore semantics (Tier-1 Items F/G)
  backup_import_users_labels_btn:  "استيراد المستخدمين والتسميات من النسخة",
  backup_import_users_labels_done: "تم استيراد المستخدمين والصلاحيات والتسميات من النسخة الاحتياطية.",
  backup_restore_merge_notice:     "ملاحظة: الاستعادة تُعيد كتابة الملفات الموجودة في النسخة فقط، ولا تحذف الملفات التي أُنشئت بعدها. البيانات الأحدث من النسخة ستبقى كما هي. تُنشأ نسخة رجوع تلقائية قبل الاستعادة.",
  backup_include_xlsx_option:      "إضافة ملفات XLSX اختيارية (أبطأ)",
  backup_include_xlsx_hint:        "نسخة JSON كاملة وقابلة للاستعادة دائماً. فعّل هذا الخيار فقط إذا احتجت جداول XLSX إضافية للبيانات الصغيرة.",

  // refreshDistribution guard (Tier-1 Item H)
  msg_distribution_refresh_no_sample: "تعذر تحديث حالة التوزيع — لم يتم العثور على عينة محفوظة لهذا الشهر.",

  // Phase 4 stale-snapshot guards: a row/batch computed against this tab's
  // snapshot may already be owned on disk (assigned from another machine on a
  // shared folder). Assigning it anyway silently transfers ownership.
  msg_assign_row_already_owned: "تعذر التعيين — هذا الصف معيّن بالفعل للموظف {assignee} (ربما من جهاز آخر). تم تحديث العرض بالحالة الأحدث.",
  msg_bulk_assign_stale_skipped: "تم تخطي {count} صفاً كان قد عُيّن من جهاز آخر أثناء عملك — لم يُعاد تعيينه.",
  msg_bulk_assign_all_taken: "لم يُحفظ أي تعيين جديد — جميع الصفوف المحسوبة عُيّنت بالفعل من جهاز آخر. تم تحديث العرض بالحالة الأحدث.",
  msg_row_state_changed_on_disk: "تعذر تنفيذ الإجراء — حالة هذا الصف تغيّرت من جهاز آخر منذ آخر تحديث. تم تحديث العرض بالحالة الأحدث.",

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
  exec_deck_fullscreen_enter: "ملء الشاشة",
  exec_deck_fullscreen_exit:  "إنهاء ملء الشاشة",
  exec_deck_slideshow_prev:   "الشريحة السابقة",
  exec_deck_slideshow_next:   "الشريحة التالية",

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
  mgmt_report_print_hint:       "اختر «حفظ كـ PDF» من المتصفح عند الطباعة، وليس «Microsoft Print to PDF»، لضمان الحجم والجودة الصحيحين",
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

  // ── App shell — C6 (Batch 2) label coverage audit ──
  app_demo_banner:           "وضع العرض التجريبي — للقراءة فقط (التعديل والحفظ معطّلان، والتصدير متاح)",
  app_bak_recovered_warning: "تم استرداد الملف \"{fileName}\" من النسخة الاحتياطية — قد تكون البيانات غير مكتملة، يُرجى المراجعة.",
  app_close_aria:            "إغلاق",
  app_auto_backup_running:   "جاري إنشاء النسخة الاحتياطية التلقائية...",
  app_auto_backup_done:      "تم إنشاء النسخة الاحتياطية التلقائية: {folderName}",
  app_auto_backup_failed:    "تعذر إنشاء النسخة الاحتياطية التلقائية: {error}",
  app_unknown_error:         "خطأ غير معروف",
  app_workspace_aria:        "مساحة العمل",
  app_no_tabs_title:         "لا توجد تبويبات متاحة",
  app_no_tabs_desc_prefix:   "لا توجد صفحات مفعلة لهذا الدور حالياً:",
  app_mobile_nav_aria:       "فتح قائمة التنقل",
  app_mobile_nav_label:      "القائمة",

  // ── WorkspaceGate — C6 (Batch 2) label coverage audit ──
  wsgate_view_passcode_error:  "رمز غير صحيح.",
  wsgate_unsupported_title:    "متصفح غير مدعوم",
  wsgate_unsupported_prefix:   "هذا التطبيق يتطلب",
  wsgate_unsupported_or:       "أو",
  wsgate_unsupported_suffix:   "على سطح المكتب للوصول المباشر إلى الملفات.",
  wsgate_unsupported_retry:    "يُرجى فتح التطبيق في متصفح مدعوم والمحاولة مجدداً.",
  wsgate_picker_title:         "اختر مساحة العمل",
  wsgate_picker_reconnect_msg: "تم العثور على مساحة عمل سابقة. انقر على «إعادة الاتصال» للمتابعة، أو اختر مجلداً جديداً.",
  wsgate_picker_select_msg:    "حدد مجلد مساحة العمل للقراءة. سيطلب المتصفح إذن الكتابة عند تنفيذ أول تعديل فقط.",
  wsgate_reconnect_btn:        "إعادة الاتصال بمساحة العمل",
  wsgate_pick_folder_btn:      "اختيار مجلد",
  wsgate_view_modal_title:     "وضع العرض",
  wsgate_view_modal_desc:      "أدخل رمز الدخول لعرض النظام للقراءة فقط.",
  wsgate_view_passcode_label:  "رمز وضع العرض",
  wsgate_cancel_btn:           "إلغاء",
  wsgate_enter_btn:            "دخول",
  wsgate_missing_title:        "مساحة العمل غير مهيأة",
  wsgate_missing_desc:         "المجلد المحدد لا يحتوي على بنية النظام المطلوبة. يمكنك إنشاؤها الآن.",
  wsgate_create_structure_btn: "إنشاء بنية مساحة العمل",
  wsgate_wrong_address_title:  "عنوان خاطئ",
  wsgate_wrong_address_desc:   "المجلد المحدد لا يحتوي على بنية نظام صالحة. تأكد من اختيار المجلد الصحيح، أو تواصل مع مسؤول النظام لإعداد مساحة العمل.",
  wsgate_pick_another_btn:     "اختيار مجلد آخر",
  wsgate_invalid_title:        "ملفات مساحة العمل تالفة أو غير متوافقة",
  wsgate_invalid_desc:         "تم العثور على المجلد لكن بعض ملفات النظام تالفة أو بإصدار غير متوافق. يمكنك إصلاح البنية الآن — لن تتأثر بيانات السكان والعينات في المجلدات المرقمة.",
  wsgate_invalid_warning:      "قد تحتاج إلى إعادة إضافة حسابات الموظفين بعد الإصلاح.",
  wsgate_repair_btn:           "إصلاح بنية مساحة العمل",
  wsgate_error_title:          "تعذر فتح مساحة العمل",

  // ── Notification center — E (feature-batch) ──
  notif_accept_btn:            "قبول",
  notif_banner_more:           "و{count} إشعار آخر بانتظار الاطّلاع",
  notif_banner_aria:           "إشعار مثبّت",
  notif_mgr_eyebrow:           "مركز الإشعارات",
  notif_mgr_title:             "مركز الإشعارات",
  notif_mgr_subtitle:          "انشر إشعاراً لجميع الموظفين والمشرفين وتابع من اطّلع عليه",
  notif_mgr_post_label:        "نص الإشعار الجديد",
  notif_mgr_post_placeholder:  "اكتب نص الإشعار هنا...",
  notif_mgr_post_btn:          "نشر الإشعار",
  notif_mgr_posting:           "جاري النشر...",
  notif_mgr_post_success:      "تم نشر الإشعار.",
  notif_mgr_empty_title:       "لا توجد إشعارات",
  notif_mgr_empty_desc:        "لم يتم نشر أي إشعار بعد.",
  notif_mgr_posted_by:         "بواسطة {user}",
  notif_mgr_accepted_summary:  "{accepted} من {total} اطّلعوا",
  notif_mgr_accepted:          "اطّلع",
  notif_mgr_pending:           "لم يطّلع بعد",
  notif_mgr_audience_none:     "لا يوجد موظفون أو مشرفون نشطون في قائمة الاستهداف.",

  // ── Per-reviewer KPI upgrade + SPC p-charts (Tier-2 / research gap #18) ──
  rk_section_title:            "أداء المراجعين ولوحات الضبط الإحصائي",
  rk_section_desc:             "أعباء العمل والإنتاجية وزمن الإنجاز ومعدلات الإحالة لكل مراجع، مع لوحات ضبط (p-chart) توفّر مرجعاً موثّقاً لمعرفة ما إذا كان معدل هذا الشهر ضمن الحدود المقبولة بدلاً من التقدير بالنظر.",
  rk_toggle_reviewer:          "حسب المراجع",
  rk_toggle_port:              "حسب المنفذ",
  rk_empty_title:              "لا توجد إجابات مراجعة بعد لهذا الشهر",
  rk_empty_desc:               "تظهر مؤشرات المراجعين ولوحات الضبط بمجرد تسجيل أول مراجعة مكتملة.",
  rk_table_caption:            "مؤشرات الأداء لكل مراجع",
  rk_pchart_sr_col_group:      "المجموعة",
  rk_pchart_sr_col_proportion: "النسبة",
  rk_pchart_sr_col_cases:      "عدد الحالات",
  rk_pchart_sr_col_status:     "الحالة",
  rk_col_reviewer:             "المراجع",
  rk_col_assigned:             "المُسندة",
  rk_col_completed:            "المكتملة",
  rk_col_completion:           "نسبة الإنجاز",
  rk_col_throughput:           "الإنتاجية مقابل الحصة",
  rk_col_turnaround_median:    "زمن الإنجاز (وسيط · ساعة)",
  rk_col_turnaround_p90:       "زمن الإنجاز (p90 · ساعة)",
  rk_col_suspicion_rate:       "معدل الاشتباه/الإحالة",
  rk_col_referral_rate:        "معدل الإحالة",
  rk_pchart_reviewer_title:    "لوحة ضبط معدل الاشتباه/الإحالة — حسب المراجع",
  rk_pchart_port_title:        "لوحة ضبط معدل الاشتباه/الإحالة — حسب المنفذ",
  rk_pchart_desc:              "الخط المتقطّع = المتوسط العام (p̄)؛ النطاق الرمادي = حدود الضبط ±٣ انحرافات معيارية لكل مجموعة. النقاط الحمراء (بحلقة) خارج حدود الضبط وتستدعي المراجعة.",
  rk_pchart_empty:             "لا توجد صور مكتملة كافية لرسم لوحة الضبط.",
  rk_axis_proportion:          "النسبة (%)",
  rk_legend_center:            "المتوسط العام (p̄)",
  rk_legend_limits:            "حدود الضبط (UCL/LCL)",
  rk_legend_in_control:        "ضمن الضبط",
  rk_legend_out_of_control:    "خارج الضبط",
  rk_legend_low_n:             "عيّنة صغيرة",
  rk_tooltip_cases:            "عدد الصور",
  rk_tooltip_proportion:       "النسبة",
  rk_tooltip_center:           "المتوسط العام",
  rk_tooltip_ucl:              "الحد الأعلى للضبط",
  rk_tooltip_lcl:              "الحد الأدنى للضبط",
  rk_tooltip_status:           "الحالة",
  rk_status_out_of_control:    "خارج الضبط",
  rk_status_low_n:             "عيّنة صغيرة (n < {n})",
  rk_status_in_control:        "ضمن الضبط",

  // ── UserManagement — governance actions log viewer (C-15) ──
  um_actions_tab_label:        "سجل الإجراءات",
  um_actions_desc:             "سجل الإجراءات الإدارية المحفوظ داخل مساحة العمل في",
  um_actions_refresh_btn:      "تحديث السجل",
  um_actions_loading:          "جاري تحميل السجل...",
  um_actions_empty:            "لا توجد إجراءات مسجلة بعد.",
  um_actions_count_suffix:     "سجل",
  um_actions_col_time:         "الوقت",
  um_actions_col_actor:        "المستخدم",
  um_actions_col_role:         "الدور",
  um_actions_col_action:       "الإجراء",
  um_actions_col_target:       "الهدف",
  um_actions_col_month:        "الشهر",
  um_actions_col_details:      "تفاصيل",
  // Display labels for WorkspaceActionType (src/data/audit/actionLog.ts) — verified
  // against the real 16-value union before finalizing this list (2026-07-17).
  um_action_type_user_deleted:               "حذف مستخدم",
  um_action_type_user_created:               "إنشاء مستخدم",
  um_action_type_permission_changed:         "تغيير صلاحية صفحة",
  um_action_type_feature_permission_changed: "تغيير صلاحية ميزة",
  um_action_type_sample_drawn:               "سحب عينة",
  um_action_type_distribution_bulk_assigned: "توزيع جماعي",
  um_action_type_referral_requested:          "طلب إحالة",
  um_action_type_referral_approved:          "اعتماد إحالة",
  um_action_type_referral_denied:            "رفض إحالة",
  um_action_type_replacement_approved:       "اعتماد استبدال",
  um_action_type_replacement_denied:         "رفض استبدال",
  um_action_type_reopen_approved:            "اعتماد إعادة فتح",
  um_action_type_reopen_denied:              "رفض إعادة فتح",
  um_action_type_answer_reopened:            "إعادة فتح إجابة",
  um_action_type_month_closed:               "إقفال شهر",
  um_action_type_month_reopened:             "إعادة فتح شهر",
  um_action_type_backup_restored:            "استرجاع نسخة احتياطية",

  // ── ReportDesigner — label-system integration (P2-4) ──
  // index.tsx / EditorHost
  rd_edit_denied_msg:        "لا تملك صلاحية تعديل تصاميم التقارير، أو أن مساحة العمل للقراءة فقط.",
  rd_new_element_name:       "عنصر جديد",
  rd_default_text_content:   "نص",
  rd_default_image_name:     "صورة",
  rd_page_default_name:      "صفحة {n}",
  rd_list_edit_denied_title: "يتطلب تعديل التصاميم صلاحية التعديل ومساحة عمل قابلة للكتابة.",
  rd_index_load_error:       "خطأ غير متوقع عند تحميل القائمة.",
  rd_page_title:             "مصمم التقارير",
  rd_no_workspace_msg:       "الرجاء اختيار مجلد العمل أولاً.",
  rd_name_required_error:    "الرجاء إدخال اسم للتقرير.",
  rd_open_error:             "تعذّر تحميل التقرير. ربما تم حذف الملف.",
  rd_page_eyebrow:           "تصميم التقارير",
  rd_page_subtitle:          "صمّم تقارير مخصصة — صفحات وعناصر ومخططات من بيانات الشهر المعالج.",
  rd_new_report_btn:         "+ تقرير جديد",
  rd_report_name_placeholder: "اسم التقرير",
  rd_creating_label:         "جاري الإنشاء...",
  rd_create_btn:             "إنشاء",
  rd_cancel_btn:             "إلغاء",
  rd_empty_title:            "لا توجد تقارير محفوظة بعد",
  rd_empty_desc:             "أنشئ أول تقرير مخصص لبدء تصميم صفحاته وعناصره.",
  rd_open_aria:              "فتح {name}",
  rd_thumb_loading:          "جاري التحميل…",
  rd_ellipsis:               "…",
  rd_open_btn:                "فتح",
  rd_delete_btn:              "حذف",
  rd_delete_dialog_title:    "حذف التقرير",
  rd_delete_dialog_message:  "هل أنت متأكد من حذف هذا التقرير؟ لا يمكن التراجع عن هذا الإجراء.",

  // Shared aggregation-type labels (FieldDropDialog picker options, Inspector's KPI
  // aggregation select, and KpiRenderer's own AGG_LABELS where the wording matches).
  rd_agg_none:              "بدون تجميع",
  rd_agg_count:             "عدد",
  rd_agg_distinct_count:    "عدد مميز",
  rd_agg_sum:               "مجموع",
  rd_agg_avg:               "متوسط",
  rd_agg_min:               "أدنى قيمة",
  rd_agg_max:               "أقصى قيمة",
  rd_agg_percent_of_total:  "نسبة من الإجمالي",
  // KpiRenderer's compact aggregation badge uses shorter wording for min/max/percent
  // than the picker/inspector options above — kept as distinct keys, not a dedup.
  rd_agg_badge_min:         "أدنى",
  rd_agg_badge_max:         "أقصى",
  rd_agg_badge_percent:     "نسبة",
  rd_agg_heading:           "التجميع",
  rd_role_dimension:        "بُعد",
  rd_role_measure:          "مقياس",

  // FieldDropDialog
  rd_field_dialog_aria: "إعدادات الحقل: {field}",
  rd_add_btn:           "إضافة",

  // Inspector
  rd_insp_heading_element:     "العنصر",
  rd_insp_label_name:          "الاسم",
  rd_insp_heading_geometry:    "الموضع والحجم",
  rd_insp_label_x:             "س",
  rd_insp_label_y:             "ص",
  rd_insp_label_w:             "عرض",
  rd_insp_label_h:             "ارتفاع",
  rd_insp_heading_style:       "المظهر",
  rd_insp_label_fill:          "لون الخلفية",
  rd_insp_label_border_color:  "لون الحدود",
  rd_insp_label_border_width:  "سمك الحدود",
  rd_insp_label_text_color:    "لون النص",
  rd_insp_label_font_size:     "حجم الخط",
  rd_insp_label_font_weight:   "وزن الخط",
  rd_insp_label_padding:       "حشوة",
  rd_insp_label_opacity:       "شفافية (0–1)",
  rd_insp_label_text_align:    "محاذاة النص",
  rd_align_right:              "يمين",
  rd_align_center:             "وسط",
  rd_align_left:               "يسار",
  rd_insp_heading_content:     "المحتوى",
  rd_insp_label_text:          "النص",
  rd_insp_label_shape_type:    "نوع الشكل",
  rd_shape_rect:               "مستطيل",
  rd_shape_line:               "خط",
  rd_shape_ellipse:            "بيضاوي",
  rd_shape_divider:            "فاصل",
  rd_insp_image_note:          "صورة — لا يمكن تغييرها من هنا.",
  rd_insp_label_bound_field:   "الحقل المرتبط",
  rd_insp_label_group_by:      "التقسيم حسب",
  rd_remove_btn:               "إزالة",
  rd_insp_coming_soon:         "سيتم الدعم في مرحلة لاحقة.",

  // Ribbon
  rd_back_title:            "العودة للقائمة",
  rd_back_btn:              "رجوع",
  rd_page_size_label:       "حجم الصفحة",
  rd_page_word:             "الصفحة",
  rd_toggle_fields_title:   "إظهار/إخفاء لوحة الحقول",
  rd_fields_label:          "الحقول",
  rd_toggle_format_title:   "إظهار/إخفاء لوحة التنسيق",
  rd_format_label:          "التنسيق",
  rd_saving_label:          "جاري الحفظ...",
  rd_autosave_failed:       "تعذّر الحفظ التلقائي",
  rd_save_btn:              "حفظ",
  rd_print_btn:             "طباعة",

  // PagesBar
  rd_delete_page_aria:  "حذف {name}",
  rd_delete_page_title: "حذف الصفحة",
  rd_add_page_title:    "إضافة صفحة",
  rd_add_page_btn:      "+ صفحة",

  // VizPanel
  rd_viz_label_text:  "نص",
  rd_viz_label_shape: "شكل",
  rd_viz_label_image: "صورة",
  rd_viz_panel_title: "التصورات",

  // KpiRenderer
  rd_bool_yes:    "نعم",
  rd_bool_no:     "لا",
  rd_more_suffix: "أخرى",

  // ExecutiveRowsProvider — surfaced when the shared KPI-tile data load rejects
  // (previously an unhandled rejection left every tile at a perpetual "loading"
  // state with no way to tell a real failure from a still-loading month).
  rd_kpi_rows_load_error: "تعذّر تحميل بيانات مؤشرات الأداء لهذا الشهر. حاول تحديث الصفحة أو التحقق من الاتصال بمساحة العمل.",

  // FieldsPanel
  rd_fields_search_placeholder: "بحث في الحقول...",
  rd_fields_search_aria:        "بحث في الحقول",
  rd_fields_dimensions_label:   "أبعاد ({count})",
  rd_fields_measures_label:     "مقاييس ({count})",
  rd_fields_no_match:           "لا توجد حقول مطابقة",

  // Sampling running total (Phase 3) — shown before the draw is triggered
  sampling_running_total_label:      "إجمالي العينة المتوقع (كل المستويات)",
  sampling_running_total_note:       "هذا الإجمالي يعكس القيم الفعلية بعد تطبيق أي حد أدنى، وليس القيم المُدخلة فقط.",
  sampling_floor_override_warning:   "تنبيه: {stage} — القيمة المُدخلة تُنتج {entered} سجلاً فقط، لكن تم رفعها إلى {effective} بسبب الحد الأدنى المطلوب ({minRequired}). هذا الفارق مُضاف إلى الإجمالي الكلي أدناه.",

  // CertScan shortfall (Phase 3 pre-draw estimate + post-draw report). A stratum
  // short on CertScan under-fills rather than silently substituting NonCertscan
  // rows — these labels make that under-fill visible instead of invisible.
  sampling_certscan_shortfall_predraw_title:  "تنبيه: نقص متوقع في سجلات CertScan",
  sampling_certscan_shortfall_predraw_row:    "{stage}: مطلوب {requested} سجل CertScan لكن المتاح فعلياً {available} فقط — سيتم سحب {available} كحد أقصى ولن يُعوَّض النقص من سجلات عادية.",
  sampling_certscan_shortfall_result_title:   "نقص في سجلات CertScan (لم يتم التعويض)",
  sampling_certscan_shortfall_result_intro:   "الأعداد التالية أقل من المطلوب لأن عدد سجلات CertScan المتاحة كان غير كافٍ. لم يتم سحب سجلات عادية بدلاً منها للحفاظ على دقة تكوين العينة.",
  sampling_certscan_shortfall_result_row_port:  "{stage} — ميناء {port}: المطلوب {requested}، المسحوب فعلياً {actual}، المتاح {available}.",
  sampling_certscan_shortfall_result_row_stage: "{stage} (على مستوى المرحلة كاملة): المطلوب {requested}، المسحوب فعلياً {actual}، المتاح {available}.",

  // Unmapped-stage exclusion warning (P4, 2026-08): rows whose raw "stage" value
  // matched none of the four configured stage aliases are excluded from the draw
  // entirely. This makes that exclusion visible on the post-draw success path
  // instead of silently vanishing with no trace.
  sampling_unmapped_stage_warning_title: "تنبيه: تم استبعاد سجلات من السحب بسبب عدم تطابق قيمة \"المستوى\"",
  sampling_unmapped_stage_warning_intro: "تم استبعاد {count} سجل من مجتمع البيانات من عملية السحب لأن قيمة عمود \"المستوى\" فيها لم تُطابق أياً من المستويات الأربعة المُهيأة في إعداد \"تعيين المستويات\" (Stage Mapping). هذه السجلات لم تُدخل في السحب الإحصائي إطلاقاً.",
  sampling_unmapped_stage_warning_values_label: "أمثلة على القيم غير المتطابقة:",

  // Ad-hoc import tab (owner requirement, 2026-08) — a separate admin-only page for
  // uploading a one-off Excel file (not the regular monthly Population pipeline) and
  // assigning its rows to employees. See src/data/adhocImport/.
  page_adhoc_import_eyebrow:        "استيراد خارج المسار المعتاد",
  page_adhoc_import_title:          "استيراد بيانات مخصص",
  page_adhoc_import_subtitle:       "ارفع ملف إكسل مستقل خارج مسار معالجة المجتمع المعتاد وعيّن صفوفه للموظفين مباشرة.",
  adhoc_import_upload_label:        "اختر ملف إكسل",
  adhoc_import_upload_button:       "رفع ومعالجة",
  adhoc_import_uploading:           "جارٍ المعالجة...",
  adhoc_import_no_workspace:        "اختر مساحة عمل أولاً.",
  adhoc_import_denied:              "لا تملك صلاحية استخدام هذه الصفحة.",
  adhoc_import_choose_file_first:   "اختر ملفاً أولاً.",
  adhoc_import_parse_failed:        "تعذّرت قراءة الملف: {error}",
  adhoc_import_save_failed:         "تعذّر حفظ الاستيراد: {error}",
  adhoc_import_list_title:          "عمليات الاستيراد السابقة",
  adhoc_import_list_empty:          "لا توجد عمليات استيراد بعد.",
  adhoc_import_col_file_name:       "اسم الملف",
  adhoc_import_col_imported_by:     "بواسطة",
  adhoc_import_col_imported_at:     "تاريخ الاستيراد",
  adhoc_import_col_status:          "الحالة",
  adhoc_import_col_total_rows:      "إجمالي الصفوف",
  adhoc_import_col_valid_rows:      "صفوف صالحة",
  adhoc_import_col_assigned_rows:   "صفوف مُعيَّنة",
  adhoc_import_status_open:         "مفتوح",
  adhoc_import_status_closed:       "مُغلق",
  adhoc_import_close_button:        "إغلاق الاستيراد",
  adhoc_import_reopen_button:       "إعادة فتح",
  adhoc_import_close_confirm:       "إغلاق الاستيراد يمنع أي تعيين جديد لصفوفه. متابعة؟",
  adhoc_import_back_to_list:        "رجوع للقائمة",
  adhoc_import_review_title:        "مراجعة الصفوف — {fileName}",
  adhoc_import_review_note:         "الأعمدة مطابقة تلقائياً حسب إعدادات مطابقة الأعمدة في إدارة بيانات الأشعة. الصفوف غير الصالحة (بلا معرّف أشعة أو نتيجة مستوى غير صحيحة) مستبعدة تلقائياً ولا يمكن تعيينها.",
  adhoc_import_col_row_key:         "الصف المصدر",
  adhoc_import_col_validation:      "الصلاحية",
  adhoc_import_col_excluded:        "استبعاد",
  adhoc_import_col_assigned_to:     "مُعيَّن إلى",
  adhoc_import_validation_valid:    "صالح",
  adhoc_import_validation_invalid:  "غير صالح: {reason}",
  adhoc_import_assigned_badge:      "مُعيَّن",
  adhoc_import_select_all:          "تحديد كل الصفوف الصالحة غير المعيَّنة",
  adhoc_import_clear_selection:     "إلغاء التحديد",
  adhoc_import_selected_count:      "المحدد: {count}",
  adhoc_import_assign_to_label:     "تعيين إلى موظف",
  adhoc_import_assign_button:       "تعيين المحدد",
  adhoc_import_assigning:           "جارٍ التعيين...",
  adhoc_import_assign_choose_employee: "اختر موظفاً أولاً.",
  adhoc_import_assign_choose_rows:     "حدد صفاً واحداً على الأقل.",
  adhoc_import_assign_closed:          "هذا الاستيراد مُغلق.",
  adhoc_import_assign_failed:          "تعذّر التعيين: {error}",
  adhoc_import_assign_success:         "تم تعيين {count} صف بنجاح.",
  adhoc_import_assign_skipped:         "({count} صف كان مُعيَّناً بالفعل وتم تجاوزه.)",
  adhoc_import_scope_note:             "لا يُكتب أي شيء داخل مجلد الشهر المعالج الحقيقي (1-population) — بيانات هذا الاستيراد معزولة تماماً عن مجتمع الأشهر الرسمية.",
  storage_handle_lost_title:           "تم فقد الارتباط بمجلد العمل",
  storage_handle_lost_body:            "لم يعد المتصفح يحتفظ بالإذن للوصول إلى مجلد العمل المحفوظ. لم يتم حذف أي بيانات — الملفات على القرص كما هي. اختر المجلد مرة أخرى للمتابعة.",
  storage_handle_unknown_title:        "اختيار مجلد العمل",
  storage_handle_unknown_body:         "إذا كنت قد استخدمت هذا التطبيق من قبل على هذا الجهاز، فإن بياناتك محفوظة كما هي على القرص ولم يُحذف منها شيء — يكفي اختيار المجلد نفسه مرة أخرى. وإذا كانت هذه أول مرة، فقط اختر المجلد الذي تريد حفظ البيانات فيه.",
  storage_labels_lost_title:           "تم فقد التسميات المخصصة",
  storage_labels_lost_body:            "لم تعد التسميات المخصصة موجودة في هذا المتصفح، لكن توجد نسخة محفوظة في مجلد العمل.",
  storage_labels_restore_button:       "استعادة التسميات من مجلد العمل",
  storage_labels_restore_failed:       "تعذرت استعادة التسميات — لم يتم العثور على نسخة صالحة في مجلد العمل، أو تعذرت قراءتها. راجع سجل الأخطاء الأخيرة لمزيد من التفاصيل.",
  storage_section_title:               "حالة التخزين في المتصفح",
  storage_quota_label:                 "المساحة المستخدمة",
  storage_persistence_granted:         "التخزين دائم — لن يحذفه المتصفح تلقائياً.",
  storage_persistence_denied:          "التخزين مؤقت — قد يحذفه المتصفح عند امتلاء القرص.",
  storage_persistence_unsupported:     "المتصفح لا يدعم التخزين الدائم.",
  storage_shared_origin_warning:       "التطبيق يعمل من ملف محلي، ويشارك مساحة التخزين مع أي صفحة محلية أخرى على هذا الجهاز. مسح بيانات المتصفح من أي تطبيق آخر سيمسح إعدادات هذا التطبيق أيضاً. بيانات العمل في مجلد العمل على القرص غير متأثرة.",
  storage_owned_keys_title:            "ما يحفظه هذا التطبيق",
  storage_foreign_dbs_title:           "قواعد بيانات تخص تطبيقات أخرى",
  storage_foreign_dbs_note:            "هذه لا تخص هذا التطبيق ولن يتم المساس بها.",
  storage_reset_button:                "مسح إعدادات التطبيق",
  storage_reset_confirm:               "سيتم مسح الجلسة والتسميات المخصصة وارتباط مجلد العمل. لن يتم حذف أي ملف من مجلد العمل على القرص. هل تريد المتابعة؟",
  storage_reset_partial_failure:       "تم مسح بعض إعدادات التطبيق، لكن تعذر مسح ارتباط مجلد العمل بالكامل. راجع سجل الأخطاء الأخيرة لمزيد من التفاصيل.",
  storage_reset_denied_title:          "لا تملك صلاحية مسح إعدادات التطبيق",

  // ── About section — author attribution (design spec §5.2) ──
  about_author_label:                  "المطوّر",
  about_author_name:                   "محمد الخويتم — Mkhuwaytim",

  // ── Error-code catalog sentences (src/data/storage/errorCodes.ts) ──
  // One key per XQ-<AREA>-<NNN> entry that does not reuse a key defined above.
  // The code itself is appended by formatUserError, so these stay pure prose.
  // Sentences carried over from an existing inline message are copied verbatim.
  err_ws_001_unsupported_browser:      "المتصفح الحالي لا يدعم File System Access API.",
  err_ws_002_picker_dismissed:         "لم يتم اختيار مجلد مساحة العمل.",
  err_ws_003_select_failed:            "حدث خطأ أثناء اختيار أو فحص مجلد مساحة العمل.",
  err_ws_004_no_handle_for_create:     "يجب اختيار مجلد مساحة العمل قبل إنشاء البنية.",
  err_ws_005_create_structure_step:    "تعذر إنشاء بنية مساحة العمل أثناء إنشاء المجلدات والملفات.",
  err_ws_006_check_structure_step:     "تم إنشاء بنية مساحة العمل، لكن تعذر فحصها بعد الإنشاء.",
  err_ws_007_load_files_step:          "تم إنشاء بنية مساحة العمل، لكن تعذر تحميل ملفاتها.",
  err_ws_008_no_remembered_workspace:  "اختر مجلد مساحة العمل يدوياً للمتابعة.",
  err_ws_011_no_handle_for_reload:     "لم يتم اختيار مساحة العمل بعد.",
  err_ws_012_reload_failed:            "حدث خطأ أثناء إعادة تحميل مساحة العمل.",
  err_ws_013_refresh_permissions_failed: "تعذر تحديث الصلاحيات من مساحة العمل.",
  err_ws_014_restore_failed:           "لم يتم اختيار مساحة العمل بعد.",
  err_ws_016_demo_failed:              "تعذر تحضير وضع العرض التجريبي.",
  err_ws_017_permission_lost:          "فُقد إذن الوصول إلى مساحة العمل. أعد اختيار المجلد لاستعادة الاتصال.",
  err_ws_018_create_unclassified:      "تعذر إنشاء بنية مساحة العمل.",

  err_fs_001_picker_unavailable:       "المتصفح الحالي لا يدعم File System Access API.",
  err_fs_002_read_permission_denied:   "لم يتم منح صلاحية قراءة مجلد مساحة العمل.",
  err_fs_003_missing_structure:        "لم يتم العثور على بنية مساحة العمل المطلوبة. يمكن لمسؤول النظام إنشاء البنية.",
  err_fs_004_invalid_structure:        "تم العثور على ملفات مساحة العمل، ولكن بعض الملفات غير صالحة أو غير متوافقة.",
  err_fs_005_write_permission_denied:  "لم يتم منح صلاحية الكتابة لإنشاء بنية مساحة العمل.",
  err_fs_006_create_top_folders:       "تعذر إنشاء المجلدات الرئيسية لمساحة العمل.",
  err_fs_007_create_system_folders:    "تعذر إنشاء مجلدات النظام الفرعية داخل مساحة العمل.",
  err_fs_008_write_manifest:           "تعذر كتابة ملف بيان مساحة العمل.",
  err_fs_009_write_users_permissions:  "تعذر كتابة ملف المستخدمين والصلاحيات.",
  err_fs_010_schema_stamp:             "تعذر تحديد أو تسجيل مخطط مساحة العمل.",
  err_fs_011_file_missing:             "الملف {file} غير موجود.",
  err_fs_012_invalid_json:             "الملف {file} ليس ملف JSON صالح.",
  err_fs_013_read_permission_denied:   "لا توجد صلاحية كافية لقراءة الملف {file}.",
  err_fs_014_read_failed:              "تعذر قراءة الملف {file}.",

  err_io_001_no_createwritable:            "المتصفح الحالي لا يسمح بالكتابة على هذا الملف.",
  err_io_002_no_createwritable_stream:     "المتصفح الحالي لا يسمح بالكتابة على هذا الملف.",
  err_io_003_no_createwritable_binary:     "المتصفح الحالي لا يسمح بالكتابة على هذا الملف.",
  err_io_004_copy_source_missing:          "تعذر نسخ الملف لأن الملف المصدر غير موجود.",
  err_io_005_copy_bytes_source_missing:    "تعذر نسخ الملف لأن الملف المصدر غير موجود.",
  err_io_006_staging_failed:               "فشل التحقق من الملف المؤقت قبل الحفظ النهائي، ولم يتم تعديل الملف الأصلي.",
  err_io_007_staging_failed_streamed:      "فشل التحقق من الملف المؤقت قبل الحفظ النهائي، ولم يتم تعديل الملف الأصلي.",
  err_io_008_staging_failed_compressed:    "فشل التحقق من الملف المؤقت قبل الحفظ النهائي، ولم يتم تعديل الملف الأصلي.",
  err_io_009_commit_rolled_back:           "فشل التحقق بعد الحفظ، وتمت الاستعادة إلى النسخة السابقة.",
  err_io_010_commit_tmp_kept:              "فشل التحقق بعد الحفظ، وتم الاحتفاظ بالنسخة المرحلية في ملف مؤقت.",
  err_io_011_commit_rolled_back_compressed: "فشل التحقق بعد الحفظ، وتمت الاستعادة إلى النسخة السابقة.",
  err_io_012_commit_tmp_kept_compressed:   "فشل التحقق بعد الحفظ، وتم الاحتفاظ بالنسخة المرحلية في ملف مؤقت.",
  err_io_013_restore_invalid_json:         "لا يمكن استعادة ملف JSON غير صالح.",
  err_io_014_restore_staging_failed:       "فشل التحقق من الملف المؤقت أثناء الاستعادة.",
  err_io_015_restore_commit_failed:        "فشل التحقق بعد الاستعادة.",
  err_io_016_read_only_mode:               "لا يمكن حفظ التغييرات في وضع العرض للقراءة فقط.",
  err_io_017_write_permission_unavailable: "يلزم السماح بالكتابة على مساحة العمل لإكمال هذا الإجراء.",
  err_io_018_not_readable:                 "تعذر قراءة الملف من مساحة العمل بعد عدة محاولات.",
  err_io_019_string_length_ceiling:        "حجم البيانات تجاوز الحد الأقصى للنص، وتم استخدام الحفظ المتدفق.",
  err_io_020_quota_exceeded:               "لا توجد مساحة تخزين كافية لإتمام الحفظ.",
  err_io_021_compressed_damaged:           "ملف مضغوط تالف — تعذر فك ضغط محتواه.",
  err_io_022_compressed_no_body:           "ملف مضغوط ناقص — لا يحتوي على بيانات بعد سطر الترويسة.",
  err_io_023_compressed_head_newline:      "ترويسة الملف المضغوط تحتوي على سطر جديد غير مسموح به.",
  err_io_024_compressed_head_too_large:    "ترويسة الملف المضغوط أكبر من الحد المسموح به.",
  err_io_025_compression_unsupported:      "هذا المتصفح لا يدعم ضغط الملفات المطلوب.",
  err_io_026_no_createwritable_compressed: "المتصفح الحالي لا يسمح بالكتابة على هذا الملف.",
  err_io_027_not_found:                    "الملف أو المجلد المطلوب غير موجود.",
  err_io_029_unreadable_not_absent:        "تعذّرت قراءة ملف موجود، وأُلغيت العملية بدلاً من الكتابة فوق بياناته.",
  err_io_030_workspace_unreachable:        "لم يعد مجلد مساحة العمل متاحًا — يُرجّح أنه نُقل أو أُعيدت تسميته أو أُنشئ من جديد. أعد اختيار مجلد مساحة العمل ثم أعد المحاولة؛ إعادة المحاولة وحدها لن تنجح.",
  err_io_033_extension_blocked:            "المجلد يقبل الكتابة، لكن الملفات من نوع هذا الملف تُحذف بعد كتابتها مباشرة — غالبًا بسبب مضاد الفيروسات أو برنامج المزامنة. إعادة المحاولة لن تنجح؛ يلزم استثناء مجلد مساحة العمل من الفحص.",
  err_io_032_cas_write_failed:             "تعذّر حفظ التغيير بعد عدة محاولات بسبب خطأ في الوصول إلى الملف، وليس بسبب تعارض مع مستخدم آخر. راجع سجل الأخطاء لمعرفة السبب.",
  err_io_031_share_lost_entry:             "تعذّر الوصول إلى الملف على الشبكة رغم عدة محاولات، والمجلد نفسه يعمل. أعد المحاولة بعد قليل.",

  err_auth_006_rehash_failed:          "تعذر تحديث تشفير كلمة المرور، وتم الإبقاء على التشفير السابق.",
  err_auth_007_rehash_persist_failed:  "تعذر حفظ تشفير كلمة المرور المحدّث في مساحة العمل.",

  err_pop_001_picker_fallback:         "تعذر فتح نافذة اختيار الملف. سيتم استخدام طريقة الرفع البديلة.",
  err_pop_002_worker_unavailable:      "تعذر تهيئة معالج البيانات.",
  err_pop_003_workbook_parse_failed:   "تعذر قراءة ملف بيانات وكالة المخاطر. تأكد من أن الملف بصيغة Excel وأن الصف الأول يحتوي على العناوين.",
  err_pop_004_processing_failed:       "تعذر تنفيذ معالجة المجتمع. تحقق من بيانات CertScan أو من بنية البيانات المقروءة.",
  err_pop_005_save_returned_error:     "فشل الحفظ: {detail}",
  err_pop_007_worker_died:                 "توقف معالج البيانات أثناء العمل، غالبًا بسبب حجم البيانات الكبير. أعد المحاولة، وإن تكرر الخطأ فقسّم البيانات على شهور أصغر.",
  err_pop_006_save_threw:              "حدث خطأ غير متوقع أثناء الحفظ.",

  err_dist_002_duplicate_event_id:     "معرّف حدث مكرر: {eventId}",
  err_dist_003_append_threw:           "تعذر تسجيل أحداث التوزيع.",
  err_dist_004_replacement_bad_state:  "لا يمكن استبدال هذه العينة — الحالة الحالية: {status}.",
  err_dist_005_replacement_partial:    "تمت إضافة البديل للعينة لكن فشل تسجيل الحدث — يُرجى المحاولة مرة أخرى: {detail}",
  err_dist_007_write_unconfirmed:          "تم تسجيل الأحداث لكن تعذّر تأكيدها فورًا بسبب بطء الشبكة. لا حاجة لإعادة المحاولة.",
  err_dist_008_segment_size_mismatch:      "فشل التحقق من ملف أحداث التوزيع بعد الكتابة: الحجم غير مطابق. لم يكتمل الحفظ بشكل سليم.",
  err_dist_006_no_createwritable:      "المتصفح الحالي لا يسمح بالكتابة على هذا الملف.",

  err_smp_001_no_population_rows:      "لا توجد صفوف مجتمع للسحب منها.",
  err_smp_002_sample_size_zero:        "حجم العينة يجب أن يكون أكبر من صفر.",
  err_smp_003_no_stage_match:          "لم يتم العثور على أي صف مطابق لأحد المستويات الأربعة المُهيأة. تحقق من إعداد \"تعيين المستويات\" (Stage Mapping) في الإعدادات ومطابقته لقيم عمود المستوى الفعلية في بيانات المجتمع.",
  err_smp_004_draw_saved_failed:       "تم سحب العينة ولكن فشل الحفظ: {detail}",
  err_smp_005_draw_threw:              "حدث خطأ غير متوقع أثناء سحب العينة.",
  err_smp_006_no_sample_for_month:     "لا توجد بيانات عينة للشهر المحدد.",
  err_smp_007_save_master_threw:       "تعذر حفظ ملف العينة الرئيسي.",
  err_smp_008_substitution_conflict:   "هذا الصف المستبدَل سبق أن استُبدل بصف آخر لم يكتمل حفظ تعييناته. أعد محاولة الاستبدال الأصلية نفسها لإكمالها بدلاً من اختيار صف جديد.",

  // Report Designer — print preview overlay (accessible name of the dialog).
  rd_print_view_aria:                  "معاينة الطباعة",
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

/** Hard cap on a custom label override's length — generously above the longest
 * built-in default (~210 chars) but bounded so a pasted wall of text (or a
 * corrupted/malicious snapshot import) can't blow up layout or storage. */
const MAX_LABEL_LENGTH = 500;

/** Unicode bidirectional control characters (explicit marks, embeddings,
 * overrides, isolates). Stripped from every label override so a pasted or
 * imported value can't spoof reading direction/order (Trojan-Source-style)
 * in RTL UI text. */
const BIDI_CONTROL_CHARS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function stripBidiControls(value: string): string {
  return value.replace(BIDI_CONTROL_CHARS, "");
}

export function setLabel(key: LabelKey, value: string): void {
  const trimmed = stripBidiControls(value.trim()).trim().slice(0, MAX_LABEL_LENGTH);
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
