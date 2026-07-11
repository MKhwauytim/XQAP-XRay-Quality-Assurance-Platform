import { type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { useFocusTrap } from "../../hooks/useFocusTrap";
import "./ConfirmDialog.css";

/**
 * Shared confirmation dialog for destructive / irreversible actions (UIX-02).
 * Replaces native `window.confirm()` (LTR, browser-chrome buttons) with an
 * RTL, token-styled modal. Focus management (first-focus = cancel button,
 * Tab-trap, Escape-to-cancel, focus-restore) is handled by the shared
 * `useFocusTrap` hook; backdrop click also cancels.
 */
type ConfirmDialogProps = {
  open: boolean;
  /** Short question heading. Defaults to a generic Arabic confirm title. */
  title?: string;
  /** The consequence being confirmed — full sentence(s). */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red styling for destructive confirms (delete, replace, reset). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title = "تأكيد الإجراء",
  message,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const dialogRef = useFocusTrap<HTMLElement>({ onEscape: onCancel, enabled: open });

  if (!open) return null;

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className={`confirm-dialog${danger ? " confirm-dialog--danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmDialogTitle"
        dir="rtl"
      >
        <h2 id="confirmDialogTitle" className="confirm-dialog__title">
          {danger && (
            <span className="confirm-dialog__icon" aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
          )}
          {title}
        </h2>
        <div className="confirm-dialog__message">{message}</div>
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
