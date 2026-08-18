import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Lock } from "lucide-react";

import { useGlobalMonth } from "../../data/month/useGlobalMonth";
import { usePermissions } from "../../auth/usePermissions";
import { useLabels } from "../../data/labels/useLabels";
import { formatMonthFolderName, formatMonthFolderShortLabel } from "../../data/population/monthFolder";
import { useFocusTrap } from "../../hooks/useFocusTrap";

import "./GlobalMonthSelector.css";

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const MIN_YEAR = 2020;
const MAX_YEAR = 2100;

type GlobalMonthSelectorProps = {
  /** False in demo mode: the read-only workspace never creates months. */
  allowCreate: boolean;
  /**
   * Where this instance is rendered. Purely a styling hook -- both variants run
   * the exact same selection/creation logic, so the month context stays a
   * single implementation (nav 1b moved the control out of the toolbar and into
   * the sidebar's context card; it is NOT a second copy).
   *
   * - `toolbar` (default): the original inline row, one cell of
   *   `.auth-admin-toolbar`'s 4-track grid.
   * - `sidebar`: the stacked context card in the nav rail -- label + state pill
   *   on one row, month select + "شهر جديد" beneath.
   */
  variant?: "toolbar" | "sidebar";
};

export function GlobalMonthSelector({ allowCreate, variant = "toolbar" }: GlobalMonthSelectorProps) {
  const { months, selection, isSelectedMonthClosed, setSelectedMonth, startNewMonth } = useGlobalMonth();
  const { can, canMutate } = usePermissions();
  const labels = useLabels();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newMonth, setNewMonth] = useState(() => new Date().getMonth() + 1);
  // Raw string state (not a number) so the field can be cleared while typing
  // without silently coercing to 0; validated against MIN_YEAR/MAX_YEAR below.
  const [newYearInput, setNewYearInput] = useState(() => String(new Date().getFullYear()));
  const popoverWrapRef = useRef<HTMLDivElement>(null);
  const popoverFocusTrapRef = useFocusTrap<HTMLDivElement>({
    onEscape: () => setPickerOpen(false),
    enabled: pickerOpen,
  });

  const parsedYear = Number(newYearInput);
  const isYearValid = newYearInput !== "" && Number.isInteger(parsedYear)
    && parsedYear >= MIN_YEAR && parsedYear <= MAX_YEAR;

  // Outside-click dismissal. Escape and Tab-trapping are handled by
  // useFocusTrap (popoverFocusTrapRef), attached to the popover element below.
  useEffect(() => {
    if (!pickerOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (popoverWrapRef.current && !popoverWrapRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [pickerOpen]);

  const isSidebar = variant === "sidebar";
  const rootClassName = `gms-root${isSidebar ? " gms-sidebar" : ""}`;

  // No workspace / month list still loading — render an empty stable placeholder
  // so .auth-admin-toolbar's 4-track grid always has 4 children (returning null
  // would collapse a track, pull the actions cluster inward, and cause a layout
  // jump when the async month-list load completes). The sidebar variant is not
  // in that grid, so it says plainly that no month is selected instead.
  if (selection.kind === "none") {
    return isSidebar ? (
      <div className={rootClassName} dir="rtl">
        <span className="gms-label">{labels.gm_label}</span>
        <span className="gms-sidebar-empty">{labels.gm_no_months}</span>
      </div>
    ) : (
      <div className="gms-root" aria-hidden />
    );
  }

  const canCreate = allowCreate && can("process-population");
  const isPending = selection.kind === "pending";

  return (
    <div className={rootClassName} dir="rtl">
      <label className="gms-label" htmlFor="global-month-select">{labels.gm_label}</label>
      {isSidebar && (
        <span className={`gms-state-pill${isSelectedMonthClosed ? " is-closed" : ""}`}>
          {isSelectedMonthClosed ? labels.gm_locked_badge : labels.gm_open_badge}
        </span>
      )}
      <select
        id="global-month-select"
        className="gms-select"
        value={selection.folderName}
        onChange={(event) => setSelectedMonth(event.target.value)}
      >
        {isPending && (
          <option value={selection.folderName}>
            {formatMonthFolderShortLabel(selection.folderName)} {labels.gm_pending_suffix}
          </option>
        )}
        {months.length === 0 && !isPending && (
          <option value={selection.folderName}>{labels.gm_no_months}</option>
        )}
        {months.map((entry) => (
          <option key={entry.folderName} value={entry.folderName}>
            {formatMonthFolderShortLabel(entry.folderName)}
          </option>
        ))}
      </select>

      {/* Toolbar only: the sidebar variant already states open/closed in its
          state pill above, so a second lock badge would just repeat it. */}
      {isSelectedMonthClosed && !isSidebar && (
        <span className="gms-locked" title={labels.msg_month_closed_banner}>
          <Lock size={12} aria-hidden /> {labels.gm_locked_badge}
        </span>
      )}

      {canCreate && (
        <div className="gms-new-wrap" ref={popoverWrapRef}>
          <button
            type="button"
            className="gms-new-btn"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
          >
            <CalendarPlus size={14} aria-hidden /> {labels.gm_new_month_btn}
          </button>
          {pickerOpen && (
            <div className="gms-popover" role="dialog" aria-label={labels.gm_new_month_title} ref={popoverFocusTrapRef}>
              <strong className="gms-popover-title">{labels.gm_new_month_title}</strong>
              <div className="gms-month-grid" role="group">
                {ARABIC_MONTHS.map((name, idx) => (
                  <button
                    key={idx + 1}
                    type="button"
                    className={`gms-month-btn${newMonth === idx + 1 ? " active" : ""}`}
                    onClick={() => setNewMonth(idx + 1)}
                    aria-pressed={newMonth === idx + 1}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <label className="gms-year-label">
                {labels.gm_year_label}
                <input
                  type="number"
                  className="gms-year-input"
                  min={MIN_YEAR}
                  max={MAX_YEAR}
                  value={newYearInput}
                  onChange={(event) => {
                    const raw = event.target.value;
                    // Allow clearing the field while typing; only ever store digit strings.
                    if (raw === "" || /^\d+$/.test(raw)) setNewYearInput(raw);
                  }}
                />
              </label>
              <div className="gms-popover-actions">
                <button
                  type="button"
                  className="gms-confirm"
                  disabled={!isYearValid}
                  onClick={() => {
                    if (!isYearValid) return;
                    // Picked the already-selected month — nothing to change, just close.
                    if (formatMonthFolderName(newMonth, parsedYear) === selection.folderName) {
                      setPickerOpen(false);
                      return;
                    }
                    // Handler-time re-check: canCreate (render gate above) only requires
                    // `can("process-population")` -- view-level tab access -- so a role with
                    // view-but-not-edit access on the population tab could otherwise still
                    // reach this button and call startNewMonth with zero mutation guard.
                    // Matches the canMutate defense-in-depth pattern established for the
                    // Reports export handlers.
                    if (!canMutate("process-population")) return;
                    const applied = startNewMonth(newMonth, parsedYear);
                    if (applied) setPickerOpen(false);
                  }}
                >
                  {labels.gm_confirm}
                </button>
                <button type="button" className="gms-cancel" onClick={() => setPickerOpen(false)}>
                  {labels.gm_cancel}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
