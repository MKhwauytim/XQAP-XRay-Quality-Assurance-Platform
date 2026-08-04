import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";

import { useBootProgress, type BootSourceEntry } from "../../data/workspace/bootProgress";

import "./BootSplashOverlay.css";

type BootSplashOverlayProps = {
  children: ReactNode;
  /**
   * Safety valve -- hides the overlay even if some registered source never
   * reaches a terminal status, so one stuck source can never lock the user
   * out of the app for good.
   */
  timeoutMs?: number;
};

const STATUS_TITLE: Record<BootSourceEntry["status"], string> = {
  pending: "بانتظار الدور",
  loading: "جارٍ التحميل…",
  loaded: "تم التحميل",
  error: "تعذّر التحميل",
};

function StatusMark({ status }: { status: BootSourceEntry["status"] }) {
  if (status === "loaded") return <Check size={14} aria-hidden />;
  if (status === "error") return <AlertTriangle size={14} aria-hidden />;
  if (status === "loading") return <span className="ui-spinner ui-spinner--sm" aria-hidden="true" />;
  return <span className="boot-splash-item-dot" aria-hidden="true" />;
}

/**
 * Post-login "data source checklist" overlay (Task 2 of the boot-splash
 * plan; the pub/sub state it reads lives in bootProgress.ts, Task 1).
 *
 * `children` (the real app) is ALWAYS mounted underneath -- this is a purely
 * visual overlay, not a gate -- so the landing tab's own effects run on
 * schedule whether or not the checklist is still showing. While
 * `!allLoaded && !timedOut` an opaque checklist covers the app, listing each
 * registered source's Arabic label plus its real on-disk file name
 * (`labelEn`) with a per-source status mark. A `timeoutMs`-duration timer
 * started on mount hides the overlay regardless of `allLoaded` once it
 * elapses, so a single source that never finishes can't freeze the user out
 * of the app indefinitely -- mirrors the "error is terminal" allLoaded
 * semantics from bootProgress.ts, which already treat one failed source as
 * non-blocking.
 */
export function BootSplashOverlay({ children, timeoutMs = 8000 }: BootSplashOverlayProps): ReactElement {
  const { entries, allLoaded } = useBootProgress();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [timeoutMs]);

  const showOverlay = !allLoaded && !timedOut;

  return (
    <>
      {children}
      {showOverlay && (
        <div
          className="boot-splash-overlay"
          dir="rtl"
          role="status"
          aria-live="polite"
          aria-label="جارٍ تحميل بيانات النظام"
          data-testid="boot-splash-overlay"
        >
          <div className="boot-splash-card">
            <strong className="boot-splash-title">جارٍ تحميل بيانات النظام…</strong>
            <ul className="boot-splash-list">
              {entries.map((entry) => (
                <li key={entry.key} className={`boot-splash-item boot-splash-item--${entry.status}`}>
                  <span className="boot-splash-item-mark" title={STATUS_TITLE[entry.status]}>
                    <StatusMark status={entry.status} />
                  </span>
                  <div className="boot-splash-item-body">
                    <strong>{entry.labelAr}</strong>
                    <span dir="ltr">{entry.labelEn}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
