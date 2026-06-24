import { useState } from "react";
import {
  clearErrors,
  getRecentErrors,
  type ErrorEntry,
} from "../../../../data/storage/errorLogger";
import { usePermissions } from "../../../../auth/usePermissions";
import "./ErrorLogSection.css";

export function ErrorLogSection() {
  const { role } = usePermissions();
  const [isOpen, setIsOpen] = useState(false);
  const [errors, setErrors] = useState<ErrorEntry[]>(() => getRecentErrors());

  if (role !== "admin") return null;
  if (errors.length === 0 && !isOpen) return null;

  function handleRefresh() {
    setErrors(getRecentErrors());
  }

  function handleClear() {
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
        <span className="error-log-icon">⚠️</span>
        <span className="error-log-title">سجل الأخطاء الأخيرة</span>
        {errors.length > 0 && (
          <span className="error-log-badge">{errors.length}</span>
        )}
        <span className={`error-log-chevron${isOpen ? " open" : ""}`}>›</span>
      </button>

      {isOpen && (
        <div className="error-log-body">
          <div className="error-log-toolbar">
            <button
              type="button"
              className="error-log-clear-btn"
              onClick={handleClear}
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
