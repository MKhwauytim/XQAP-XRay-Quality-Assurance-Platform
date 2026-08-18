/**
 * Label keys for the inspectionPanel screen of the 2026-08 design-handoff redesign.
 *
 * Split out of `labelsStore.ts` so each redesigned screen owns exactly one
 * label file. They are spread back into `DEFAULT_LABELS` there, so every key
 * defined here behaves like any other label: overridable from the Settings tab,
 * persisted to `xray_custom_labels_v1`, and read via `getLabels()`/`useLabels()`.
 */
export const inspectionPanelLabels = {
  // ── Header ────────────────────────────────────────────────────────────────
  ip_state_editing:            "قيد التحرير",
  ip_state_submitted:          "مقدم",
  ip_state_replaced:           "مستبدلة",
  ip_close_panel_title:        "إغلاق اللوحة",
  ip_close_panel_aria:         "إغلاق",
  ip_certscan_yes:             "CertScan",
  ip_certscan_no:              "غير CertScan",
  /** `{filled}` / `{total}` are substituted with Latin numerals. */
  ip_required_progress:        "{filled} من {total} حقول مطلوبة",
  ip_required_progress_aria:   "تقدّم الحقول المطلوبة",

  // ── Stepper ───────────────────────────────────────────────────────────────
  ip_stepper_aria:             "مراحل النموذج",

  // ── Segmented verdict control ─────────────────────────────────────────────
  ip_segmented_group_aria:     "اختيار الإجابة",

  // ── Footer ────────────────────────────────────────────────────────────────
  /**
   * NOTE (design handoff §7): the approved mock labels the primary action
   * "تقديم الفحص" and the replacement action "طلب استبدال". Both strings are
   * asserted verbatim by EmployeeWorkspace regression tests that this screen's
   * owner may not edit, so the existing copy is preserved here. Overriding
   * these two keys from the Settings tab already produces the mock's wording.
   */
  ip_replace_btn:              "طلب استبدال",
  ip_reassign_btn:             "إسناد لموظف آخر",
  ip_cancel_btn:               "إلغاء",
} as const;
