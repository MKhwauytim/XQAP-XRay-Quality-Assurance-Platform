import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";

import { useBootProgress, type BootSourceEntry } from "../../data/workspace/bootProgress";

import "./BootSplashOverlay.css";

type BootSplashOverlayProps = {
  children: ReactNode;
  /**
   * Identity of the current boot session -- `username:loginAt:workspaceName`
   * (App.tsx), i.e. the exact value that already distinguishes "a genuinely
   * new login / workspace switch" from "the same session continuing". Every
   * per-session latch below re-arms when this changes.
   *
   * Deliberately a normal prop and NOT a React `key` on this component: a key
   * would unmount and remount `children` -- the entire real app -- on every
   * session change, discarding all component state and re-triggering every
   * child's loads, which is the opposite of what this feature is for.
   */
  bootSessionKey: string;
  /**
   * Safety valve -- hides the overlay even if some registered source never
   * reaches a terminal status, so one stuck source can never lock the user
   * out of the app for good. Re-armed per boot session.
   */
  timeoutMs?: number;
};

/**
 * Per-boot-session latches. `key` stamps which session they belong to, so a
 * change of `bootSessionKey` retires the whole set at once rather than needing
 * each flag reset individually (and makes a stale async setter -- the timeout
 * below -- trivially detectable).
 */
type BootSessionLatch = {
  key: string;
  /** This session's grace period elapsed before every source finished. */
  timedOut: boolean;
  /** This session's checklist already ran its course; it must never return. */
  dismissed: boolean;
  /**
   * This session's overlay has actually been visibly rendered at least once.
   * Required before `dismissed` can latch true -- see the render-time logic
   * below for why: at the exact render where `bootSessionKey` changes, the
   * shared bootProgress store still holds the PREVIOUS session's (usually
   * fully-loaded) entries, since the reset that clears it (App.tsx's
   * useLayoutEffect) hasn't run yet. Without this gate, a brand-new session's
   * freshly-armed latch would read that stale "everything loaded" data and
   * dismiss itself on the spot, before its own landing tab ever got a chance
   * to register anything -- silently reproducing the original never-shows
   * bug, just relocated from the store to this component.
   */
  shown: boolean;
};

function armLatch(key: string): BootSessionLatch {
  return { key, timedOut: false, dismissed: false, shown: false };
}

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
 * schedule whether or not the checklist is still showing. While showing, an
 * opaque checklist covers the tab-content area, listing each registered
 * source's Arabic label plus its real on-disk file name (`labelEn`) with a
 * per-source status mark.
 *
 * EXACTLY ONCE PER BOOT SESSION. The checklist is a post-login courtesy, not a
 * general-purpose loading indicator, and popping it back up over a live app the
 * user is working in would re-create the very "frozen mid-task" sensation the
 * feature exists to prevent. Two things would otherwise do exactly that, since
 * the store behind `useBootProgress` is app-wide and long-lived:
 *   - `useMonthLoad.ts` re-registers its sources on every non-silent load, i.e.
 *     on any genuine month switch, not just the first load of a session;
 *   - `XrayReferrals.tsx` registers on its own first mount, which for many
 *     roles is whenever they first navigate to Employee Workspace -- typically
 *     long after login.
 * So the checklist is retired for the session (`dismissed`) as soon as it has
 * run its course, and any later re-registration is ignored until
 * `bootSessionKey` says a genuinely new session has begun.
 *
 * The `timeoutMs` timer is the safety valve for a source that never reaches a
 * terminal status -- one stuck file can't lock the user out of the app --
 * mirroring the "error is terminal" allLoaded semantics in bootProgress.ts.
 * It is armed per boot session, not per mount: this component mounts once for
 * the whole app session and is never remounted on login/workspace switch, so a
 * mount-scoped timer could only ever fire once and every later session would
 * inherit a permanently-spent safety valve.
 */
export function BootSplashOverlay({ children, bootSessionKey, timeoutMs = 8000 }: BootSplashOverlayProps): ReactElement {
  const { entries, allLoaded } = useBootProgress();
  const [latch, setLatch] = useState<BootSessionLatch>(() => armLatch(bootSessionKey));

  // Both transitions are derived during render, on state THIS component owns,
  // so `showOverlay` below already reads the settled values -- a stale
  // dismissed/timedOut from the PREVIOUS session can never suppress the new
  // session's checklist even for a single frame. (This is React's documented
  // "adjusting state during render" pattern. It does NOT have the defect
  // App.tsx's removed copy had: that one reached through resetBootProgress()
  // into *another* already-mounted component's state.)
  let session = latch.key === bootSessionKey ? latch : armLatch(bootSessionKey);

  // Step 1: has this session's overlay actually been visible at least once?
  // Uses the exact same predicate as `showOverlay` below -- deliberately NOT
  // gated on `entries.length`, since this asks "would the user have seen it,"
  // not "has real loading genuinely started."
  const visibleNow = !session.dismissed && !session.timedOut && !allLoaded;
  if (visibleNow && !session.shown) {
    session = { ...session, shown: true };
  }

  // Step 2: retire the session once it has BOTH actually been shown AND has
  // now run its course. `entries.length > 0` is load-bearing on its own too:
  // an empty registry reports `allLoaded` vacuously true, which is precisely
  // the state at the very start of every boot, before the landing tab's own
  // mount effect has registered anything -- without this, `ranItsCourse`
  // alone could still be satisfied by a genuinely empty, fresh registry.
  // Requiring `session.shown` first is what stops a brand-new session's
  // just-armed latch from reading the PREVIOUS session's stale, not-yet-reset
  // store (see the `shown` field's doc comment above) and dismissing itself
  // before its own landing tab ever got a chance to register anything.
  const ranItsCourse = session.timedOut || (allLoaded && entries.length > 0);
  if (session.shown && !session.dismissed && ranItsCourse) {
    session = { ...session, dismissed: true };
  }

  if (session !== latch) setLatch(session);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLatch((current) =>
        current.key === bootSessionKey && !current.timedOut
          ? { ...current, timedOut: true }
          : current // a newer session already re-armed this latch -- stale timer, ignore
      );
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [bootSessionKey, timeoutMs]);

  const showOverlay = !session.dismissed && !session.timedOut && !allLoaded;

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
