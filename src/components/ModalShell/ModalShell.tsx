import { useId, type ReactNode } from "react";
import { X } from "lucide-react";

import { useFocusTrap } from "../../hooks/useFocusTrap";
import { ModalPortal } from "../ModalPortal/ModalPortal";

/**
 * Shared shell for the app's full-screen task modals — the dialogs that are
 * *not* a simple yes/no question (those use `ConfirmDialog`) but a form the
 * user fills in: replace a sample, reassign to another employee, approve or
 * deny a referral, close/reopen a month, restore a backup.
 *
 * Six such dialogs each hand-rolled the identical five-part preamble:
 * `ModalPortal` → `useFocusTrap({ onEscape })` → a fixed backdrop carrying
 * `role="dialog" aria-modal="true"` → a panel → a header with a title and an
 * `X` close button. Centralising it means Escape handling, focus trap +
 * restore, the body scroll lock, the portal (needed because a tab wrapper's
 * `transform` would otherwise become the containing block for the backdrop's
 * `position: fixed`) and the accessible name are decided in one place instead
 * of six.
 *
 * Styling is deliberately *not* owned here. The app has exactly two modal
 * skins, defined in tab-scoped CSS: `ew-*` (EmployeeWorkspace.css) and `arc-*`
 * (Archive.css). `variant` selects between them, so the class names live in
 * one map rather than being retyped at each call site; the CSS itself is
 * untouched and every migrated dialog renders byte-identical markup apart from
 * the added `aria-labelledby`.
 *
 * Behaviour intentionally preserved from the hand-rolled originals: the
 * backdrop does **not** dismiss on click. Every one of these dialogs holds
 * unsaved user input (a reason, a note, a typed confirmation), so a stray
 * click outside must not discard it. Closing is via the `X`, the Cancel
 * button in the caller-supplied footer, or Escape.
 */

type ModalVariant = "ew" | "arc";

type VariantClasses = {
  backdrop: string;
  panel: string;
  header: string;
  close: string;
  /** Kicker class; absent for skins that have no kicker style (`ew`). */
  eyebrow?: string;
};

const VARIANT_CLASSES: Record<ModalVariant, VariantClasses> = {
  ew: {
    backdrop: "ew-modal-backdrop",
    panel: "ew-replace-modal",
    header: "ew-replace-header",
    close: "ew-modal-close",
  },
  arc: {
    backdrop: "arc-modal-backdrop",
    panel: "arc-restore-modal",
    header: "arc-restore-header",
    close: "arc-modal-close",
    eyebrow: "arc-panel-kicker",
  },
};

type ModalShellProps = {
  /** Which of the app's two modal skins to render. */
  variant: ModalVariant;
  /** Heading text. Rendered as `h3` for `ew`, `h2` for `arc` — matching the
   *  existing per-variant CSS — and wired to the dialog's `aria-labelledby`. */
  title: ReactNode;
  /** Small uppercase kicker above the title (`arc` dialogs only). */
  eyebrow?: ReactNode;
  /** Supporting line under the title. */
  subtitle?: ReactNode;
  /** Invoked by the `X` button and by Escape. */
  onClose: () => void;
  /** Accessible name of the close button. Defaults to the Arabic "إغلاق". */
  closeAriaLabel?: string;
  /** Panel body — everything below the header, including the actions row. */
  children: ReactNode;
};

export function ModalShell({
  variant,
  title,
  eyebrow,
  subtitle,
  onClose,
  closeAriaLabel = "إغلاق",
  children,
}: ModalShellProps) {
  const classes = VARIANT_CLASSES[variant];
  const titleId = useId();
  // Only mounted while open, so the hook's default `enabled: true` is correct.
  // The trap is attached to the backdrop, which contains the panel and so every
  // focusable control in the dialog.
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  return (
    <ModalPortal>
      <div
        ref={dialogRef}
        className={classes.backdrop}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={classes.panel}>
          <div className={classes.header}>
            <div>
              {eyebrow ? <span className={classes.eyebrow}>{eyebrow}</span> : null}
              {variant === "arc" ? (
                <h2 id={titleId}>{title}</h2>
              ) : (
                <h3 id={titleId}>{title}</h3>
              )}
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            <button
              type="button"
              className={classes.close}
              onClick={onClose}
              aria-label={closeAriaLabel}
            >
              <X size={16} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </ModalPortal>
  );
}
