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
};

export function GlobalMonthSelector({ allowCreate }: GlobalMonthSelectorProps) {
  const { months, selection, isSelectedMonthClosed, setSelectedMonth, startNewMonth } = useGlobalMonth();
  const { can } = usePermissions();
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

  // No workspace / month list still loading — render an empty stable placeholder
  // so .auth-admin-toolbar's 4-track grid always has 4 children (returning null
  // would collapse a track, pull the actions cluster inward, and cause a layout
  // jump when the async month-list load completes).
  if (selection.kind === "none") return <div className="gms-root" aria-hidden />;

  const canCreate = allowCreate && can("process-population");
  const isPending = selection.kind === "pending";

  return (
    <div className="gms-root" dir="rtl">
      <label className="gms-label" htmlFor="global-month-select">{labels.gm_label}</label>
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

      {isSelectedMonthClosed && (
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
