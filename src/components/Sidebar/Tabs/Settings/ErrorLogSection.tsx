import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import {
  clearErrors,
  getRecentErrors,
  type ErrorEntry,
} from "../../../../data/storage/errorLogger";
import { usePermissions } from "../../../../auth/usePermissions";
import "./ErrorLogSection.css";

// Keeps the badge count (and, while expanded, the entry list) live even when
// nothing on screen triggers a re-render otherwise — matches the polling
// cadence already used for background refreshes elsewhere (NotificationBanner).
const REFRESH_INTERVAL_MS = 60_000;

export function ErrorLogSection() {
  const { can, canMutate } = usePermissions();
  const canView = can("view-error-log");
  const canClear = canMutate("view-error-log");
  const [isOpen, setIsOpen] = useState(false);
  const [errors, setErrors] = useState<ErrorEntry[]>(() => getRecentErrors());

  // Refresh on an interval instead of relying only on the one-time mount
  // snapshot, so the header's badge count (rendered whether or not the panel
  // is open) doesn't go stale for the rest of the session.
  useEffect(() => {
    if (!canView) return;
    const id = window.setInterval(() => setErrors(getRecentErrors()), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [canView]);

  // Always render the collapsed header when the user can view the log —
  // previously an empty log hid the whole section, so an admin had no way to
  // discover the feature exists (or to notice new errors arrive later, since
  // a hidden component never re-renders to pick them up).
  if (!canView) return null;

  function handleRefresh() {
    setErrors(getRecentErrors());
  }

  function handleClear() {
    if (!canClear) return;
    clearErrors();
    setErrors([]);
  }

  return (
    <div className="error-log-section" dir="rtl">
      <button
        type="button"
        className={`error-log-header${isOpen ? " is-open" : ""}`}
        onClick={() => {
          handleRefresh();
          setIsOpen((v) => !v);
        }}
        aria-expanded={isOpen}
      >
        <span className="error-log-icon"><AlertTriangle size={16} /></span>
        <span className="error-log-title">سجل الأخطاء الأخيرة</span>
        {errors.length > 0 && (
          <span className="error-log-badge">{errors.length}</span>
        )}
        <span className={`error-log-chevron${isOpen ? " open" : ""}`}><ChevronRight size={14} /></span>
      </button>

      {isOpen && (
        <div className="error-log-body">
          <div className="error-log-toolbar">
            <button
              type="button"
              className="error-log-clear-btn"
              onClick={handleClear}
              disabled={!canClear}
              title={!canClear ? "لا تملك صلاحية مسح سجل الأخطاء" : undefined}
            >
              مسح السجل
            </button>
            <button
              type="button"
              className="error-log-refresh-btn"
              onClick={handleRefresh}
            >
              تحديث
            </button>
          </div>

          {errors.length === 0 ? (
            <p className="error-log-empty">لا توجد أخطاء مسجّلة.</p>
          ) : (
            <ul className="error-log-list">
              {errors.map((e, i) => (
                <li key={i} className="error-log-entry">
                  <span className="error-log-ts">{e.timestamp.slice(0, 19).replace("T", " ")}</span>
                  <span className="error-log-ctx">[{e.context}]</span>
                  <span className="error-log-msg">{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
