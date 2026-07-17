import type { ReactNode } from "react";
import { Inbox, AlertTriangle } from "lucide-react";

/**
 * Shared state-view surfaces for the three moments every data screen hits:
 * "nothing here yet" (EmptyState), "working…" (LoadingState), and
 * "something went wrong" (ErrorState). Centralising these keeps the empty /
 * loading / error moments visually identical across every tab — the moments
 * most visible during a live demonstration. Styles live in primitives.css
 * (.ui-state / .ui-spinner).
 */

type EmptyStateProps = {
  /** Optional icon; defaults to a neutral inbox glyph. */
  icon?: ReactNode;
  title: string;
  /** Optional supporting sentence describing the next step. */
  description?: ReactNode;
  /** Optional call-to-action(s) — typically a single primary button. */
  actions?: ReactNode;
  /** Render without the card chrome (transparent, borderless). */
  bare?: boolean;
};

export function EmptyState({
  icon,
  title,
  description,
  actions,
  bare = false
}: EmptyStateProps) {
  return (
    <div
      className={`ui-state${bare ? " ui-state--bare" : ""}`}
      role="status"
      dir="rtl"
    >
      <div className="ui-state__icon" aria-hidden="true">
        {icon ?? <Inbox />}
      </div>
      <h3 className="ui-state__title">{title}</h3>
      {description && <p className="ui-state__body">{description}</p>}
      {actions && <div className="ui-state__actions">{actions}</div>}
    </div>
  );
}

type LoadingStateProps = {
  /** Defaults to a neutral Arabic "loading" label. */
  label?: string;
  bare?: boolean;
};

export function LoadingState({
  label = "جارٍ التحميل…",
  bare = false
}: LoadingStateProps) {
  return (
    <div
      className={`ui-state${bare ? " ui-state--bare" : ""}`}
      role="status"
      aria-live="polite"
      dir="rtl"
    >
      <div className="ui-spinner ui-spinner--lg" aria-hidden="true" />
      <p className="ui-state__body">{label}</p>
    </div>
  );
}

type ErrorStateProps = {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  bare?: boolean;
};

export function ErrorState({
  title = "تعذّر عرض هذه البيانات",
  description,
  actions,
  bare = false
}: ErrorStateProps) {
  return (
    <div
      className={`ui-state ui-state--error${bare ? " ui-state--bare" : ""}`}
      role="alert"
      dir="rtl"
    >
      <div className="ui-state__icon" aria-hidden="true">
        <AlertTriangle />
      </div>
      <h3 className="ui-state__title">{title}</h3>
      {description && <p className="ui-state__body">{description}</p>}
      {actions && <div className="ui-state__actions">{actions}</div>}
    </div>
  );
}
