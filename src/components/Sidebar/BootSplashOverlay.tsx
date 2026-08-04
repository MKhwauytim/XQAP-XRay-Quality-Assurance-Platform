import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
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
  /**
   * Floor on how long the checklist stays visible once it first appears,
   * even if every source finishes loading sooner. Without this, the always-
   * registered sources (month.manifest.json, processing.summary.json,
   * sample.master.json, distribution.current.json -- all small, already-
   * optimized reads) routinely finish in well under 100ms, so the checklist
   * flashes and is gone before a user can read a single line of it -- the
   * app then just looks like it opened instantly, with nothing shown. This
   * was confirmed directly (not assumed): instrumented tracing of a real
   * sign-in showed registration through every source finishing loaded in
   * one synchronous burst, with no perceptible gap in between. Re-armed per
   * boot session, same as `timeoutMs`.
   */
  minVisibleMs?: number;
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
   * Also what `showOverlay` itself is keyed on (not `!allLoaded` directly --
   * see there for why): a one-way latch that, once true, stays true even
   * after `allLoaded` flips back to true, which is what lets the minimum-
   * visible-duration floor below hold the overlay open past the moment
   * loading genuinely finishes.
   */
  shown: boolean;
  /**
   * `resetGeneration` (bootProgress.ts) observed at the moment this latch was
   * armed -- on EVERY arm, not just a session change: `BootSplashOverlay`
   * itself can remount with the shared store already holding a PREVIOUS
   * session's data (the admin role-preview switch remounts `AppContent` via
   * `key={session.role}`; logout->login remounts it via AuthGate), so "this
   * is the very first arm, nothing to guard against" is never actually true
   * in production, only in a from-scratch app load with an empty store --
   * and arming with the CURRENT generation handles that case identically
   * anyway (there's nothing stale to wait out, so the very next reset, which
   * App.tsx's layout effect fires unconditionally on every mount, clears the
   * gate almost immediately). Step 1/2 below stay inert until
   * `resetGeneration` exceeds this -- see their gating comment for why a
   * plain "does entries look stale" check isn't enough on its own.
   */
  staleGeneration: number;
};

function armLatch(key: string, staleGeneration: number): BootSessionLatch {
  return { key, timedOut: false, dismissed: false, shown: false, staleGeneration };
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
 * `minVisibleMs` floors how soon "run its course" can retire it -- the
 * always-registered sources are small, fast reads that routinely finish
 * before a user could read a single line, so without a floor the checklist
 * would functionally never be visible at all despite rendering correctly
 * (confirmed directly via instrumented tracing, not assumed).
 *
 * The `timeoutMs` timer is the safety valve for a source that never reaches a
 * terminal status -- one stuck file can't lock the user out of the app --
 * mirroring the "error is terminal" allLoaded semantics in bootProgress.ts.
 * It is armed per boot session (keyed on `bootSessionKey`), not per mount.
 * This component DOES remount in real usage -- the admin role-preview switch
 * remounts `AppContent` via `key={session.role}` (App.tsx), and a logout ->
 * login cycle remounts it via AuthGate -- and a genuine remount already gets
 * a fresh timer for free (a brand-new `useState`/`useEffect` instance). The
 * per-session (not per-mount) re-arming below is what covers a session
 * change that does NOT happen to remount the component -- currently a
 * defensive contract guarantee more than a proven-reachable production path,
 * but the component's correctness must not depend on "a remount will always
 * bail us out" holding forever.
 */
export function BootSplashOverlay({
  children,
  bootSessionKey,
  timeoutMs = 8000,
  minVisibleMs = 600,
}: BootSplashOverlayProps): ReactElement {
  const { entries, allLoaded, resetGeneration } = useBootProgress();
  // Armed with the CURRENT resetGeneration, not a `null`/"no guard needed"
  // sentinel -- see the `staleGeneration` field's doc comment for why even
  // this component's very first mount can't assume the store is this
  // session's own.
  const [latch, setLatch] = useState<BootSessionLatch>(() => armLatch(bootSessionKey, resetGeneration));
  // `shownAt` deliberately lives in a ref, not `latch` state: it only needs
  // to be READ later (by the dismissal effect below), never to itself
  // trigger a re-render, and a ref lets the stamping effect avoid a
  // synchronous setState call in its own body (react-hooks/set-state-in-
  // effect) entirely, rather than needing an eslint-disable to route around
  // it. Keyed by BOTH `bootSessionKey` and `staleGeneration` -- the key
  // string alone is not unique across genuinely distinct sessions (a
  // workspace switch A -> B -> A within one login regenerates the identical
  // `username:loginAt:workspaceName` string), which would let a returning
  // session silently reuse a stale timestamp and bypass the floor entirely.
  // `staleGeneration` is a fresh, monotonically-increasing value captured at
  // every arm, so it disambiguates even a string collision.
  const shownAtRef = useRef<{ key: string; staleGeneration: number; shownAt: number } | null>(null);

  // The session-arming transition (below) is derived during render, on state
  // THIS component owns, so a stale `dismissed`/`timedOut` from the PREVIOUS
  // session can never suppress the new session's checklist even for a single
  // frame. (This is React's documented "adjusting state during render"
  // pattern. It does NOT have the defect App.tsx's removed copy had: that one
  // reached through resetBootProgress() into *another* already-mounted
  // component's state.) `dismissed` itself is set later, from an effect --
  // see there for why.
  let session = latch.key === bootSessionKey ? latch : armLatch(bootSessionKey, resetGeneration);

  // `dataIsFresh` gates ALL of Step 1/2 below, not just the dismissal check.
  // A naive "does `latch.key` already match `bootSessionKey`" check is NOT
  // enough on its own: React can re-render this component multiple times
  // within the same commit before ANY effect runs (the "adjusting state
  // during render" pattern above does exactly that), so `latch.key` can
  // already equal the new `bootSessionKey` on a render where `entries`/
  // `allLoaded` STILL reflect the previous session -- the actual reset call
  // lives in App.tsx's useLayoutEffect, a separate, later commit. That stale
  // data can take either shape, and both are wrong to act on: fully loaded
  // (allLoaded=true) would incorrectly satisfy `ranItsCourse` for a session
  // that hasn't started; still mid-load (allLoaded=false, e.g. one source
  // stuck loading forever) would incorrectly satisfy `visibleNow` and latch
  // `shown` true off data that isn't this session's own. `resetGeneration`
  // (bootProgress.ts) is incremented ONLY inside `resetBootProgress` itself,
  // so comparing against the generation observed at the moment this latch
  // was (re)armed is the one check that can't be fooled by same-commit
  // render timing -- it stays false across as many renders as it takes,
  // however many that turns out to be, until the real reset call actually
  // runs. Applies uniformly to every arm, including this component's very
  // first mount (`staleGeneration` doc comment explains why that mount
  // can't skip the guard either).
  const dataIsFresh = resetGeneration > session.staleGeneration;

  // Step 1: has this session's overlay actually been visible at least once?
  // Uses the exact same predicate as `showOverlay` below -- deliberately NOT
  // gated on `entries.length`, since this asks "would the user have seen
  // it," not "has real loading genuinely started." Pure boolean derivation
  // only -- `shownAt` itself is stamped in an effect further down, not here:
  // `Date.now()` is an impure call and React requires render to stay pure/
  // idempotent (react-hooks/purity lint rule), so it can't be called during
  // render at all, StrictMode double-render or not.
  const visibleNow = dataIsFresh && !session.dismissed && !session.timedOut && !allLoaded;
  if (visibleNow && !session.shown) {
    session = { ...session, shown: true };
  }

  if (session !== latch) setLatch(session);

  // Stamps `shownAtRef` the first moment `shown` is true for this session --
  // see the comment on Step 1 above for why this can't happen during render
  // instead. A ref write, not a `setLatch` call, so this effect body has no
  // synchronous setState to trip react-hooks/set-state-in-effect on -- there
  // is nothing here for React to re-render in response to; the dismissal
  // effect below simply reads the ref fresh whenever IT runs. The gap
  // between the render that flips `shown` and this effect running is a
  // single commit, well under a millisecond in practice -- negligible
  // against `minVisibleMs`'s multi-hundred-millisecond scale.
  useEffect(() => {
    if (!session.shown) return;
    if (shownAtRef.current?.key !== bootSessionKey || shownAtRef.current?.staleGeneration !== session.staleGeneration) {
      shownAtRef.current = { key: bootSessionKey, staleGeneration: session.staleGeneration, shownAt: Date.now() };
    }
  }, [bootSessionKey, session.shown, session.staleGeneration]);

  // Dismisses once the session has (a) actually been shown, (b) run its
  // course, AND (c) been visible for at least `minVisibleMs` -- see the
  // prop's doc comment for why (c) exists: without it, the always-registered
  // sources finish loading fast enough that the checklist is gone before a
  // user can read it. Runs entirely in an effect, for the same purity reason
  // as the stamping effect above -- measuring elapsed time needs Date.now().
  // `entries.length > 0` is load-bearing on its own too: an empty registry
  // reports `allLoaded` vacuously true, which is precisely the state at the
  // very start of every boot, before the landing tab's own mount effect has
  // registered anything. The `setLatch` call is always routed through
  // `window.setTimeout` -- even when the floor has already elapsed and the
  // delay is 0 -- so this effect never calls setState synchronously in its
  // own body (react-hooks/set-state-in-effect); a 0ms timer still defers to
  // a macrotask, which is what the rule is actually asking for.
  useEffect(() => {
    if (session.dismissed) return;
    const shownAt =
      shownAtRef.current?.key === bootSessionKey && shownAtRef.current?.staleGeneration === session.staleGeneration
        ? shownAtRef.current.shownAt
        : null;
    if (shownAt === null) return;
    const ranItsCourse = session.timedOut || (allLoaded && entries.length > 0);
    if (!ranItsCourse) return;
    const remaining = Math.max(0, minVisibleMs - (Date.now() - shownAt));
    const timer = window.setTimeout(() => {
      setLatch((current) =>
        current.key === bootSessionKey && !current.dismissed ? { ...current, dismissed: true } : current
      );
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [
    bootSessionKey,
    session.shown,
    session.dismissed,
    session.timedOut,
    session.staleGeneration,
    allLoaded,
    entries,
    minVisibleMs,
  ]);

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

  // Deliberately NOT `!allLoaded` here (that was the pre-floor formula): once
  // real loading finishes, `allLoaded` flips true immediately, regardless of
  // whether the floor has elapsed -- checking it directly would hide the
  // overlay the instant data is ready, silently bypassing `minVisibleMs`
  // entirely. `session.shown` is the right term instead: a one-way latch that
  // only ever becomes true once there was genuinely something to show (same
  // "before any registration, stay hidden" guarantee `visibleNow` already
  // provided), and -- unlike `allLoaded` -- doesn't flip back off the moment
  // loading completes, leaving `dismissed` (which DOES already account for
  // the floor) as the sole thing that hides it again.
  const showOverlay = session.shown && !session.dismissed && !session.timedOut;

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
