import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Lock } from "lucide-react";

import { useGlobalMonth } from "../../data/month/useGlobalMonth";
import { usePermissions } from "../../auth/usePermissions";
import { useLabels } from "../../data/labels/useLabels";
import { formatMonthFolderShortLabel } from "../../data/population/monthFolder";

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

  const parsedYear = Number(newYearInput);
  const isYearValid = newYearInput !== "" && Number.isInteger(parsedYear)
    && parsedYear >= MIN_YEAR && parsedYear <= MAX_YEAR;

  // Escape key + outside-click dismissal for the "new month" popover.
  useEffect(() => {
    if (!pickerOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (popoverWrapRef.current && !popoverWrapRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pickerOpen]);

  // No workspace yet — the toolbar has nothing month-related to show.
  if (selection.kind === "none") return null;

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
            <div className="gms-popover" role="dialog" aria-label={labels.gm_new_month_title}>
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
