import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

let lockCount = 0;
let previousBodyOverflow: string | null = null;

function acquireScrollLock(): void {
  if (lockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
}

function releaseScrollLock(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousBodyOverflow ?? "";
    previousBodyOverflow = null;
  }
}

type ModalPortalProps = {
  children: ReactNode;
};

/**
 * Portals modal content to `document.body`, escaping the tab wrapper's own
 * box.
 *
 * Why this exists: every tab's content wrapper (`.app-workspace > div` in
 * `src/App.css`) animates `transform` once on mount (`view-enter`). Per the
 * CSS spec, an element with a `transform` becomes the containing block for
 * descendant `position: fixed` elements — so a modal backdrop rendered
 * inline inside a tab is trapped inside that tab's own box (viewport width
 * minus the sidebar, height limited to content) instead of covering the
 * whole screen. Rendering through `createPortal` into `document.body`
 * removes the backdrop from that DOM subtree entirely, so `position: fixed;
 * inset: 0` on it covers the true viewport regardless of scroll position,
 * sidebar width, or which tab is active.
 *
 * Also applies a reference-counted scroll lock on `document.body` for as
 * long as any `ModalPortal` is mounted, so nested modals (e.g. a
 * `ConfirmDialog` opened from inside another dialog) don't re-enable
 * scrolling when the inner one closes.
 *
 * This component only relocates + locks scroll; it intentionally does not
 * own focus-trap, Escape, or backdrop-click behavior — callers keep using
 * `useFocusTrap` and their existing backdrop markup/classes unchanged.
 */
export function ModalPortal({ children }: ModalPortalProps) {
  useEffect(() => {
    acquireScrollLock();
    return () => releaseScrollLock();
  }, []);

  return createPortal(children, document.body);
}
