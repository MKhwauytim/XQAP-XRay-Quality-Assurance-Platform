import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import "./ConfirmDialog.css";

/**
 * Shared confirmation dialog for destructive / irreversible actions (UIX-02).
 * Replaces native `window.confirm()` (LTR, browser-chrome buttons) with an
 * RTL, token-styled modal. Focus starts on the cancel button (safe default),
 * Tab is trapped inside the dialog, Escape and backdrop click cancel.
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onCancel]);

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
            ref={cancelRef}
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
