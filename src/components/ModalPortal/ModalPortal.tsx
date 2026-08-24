import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

let lockCount = 0;
let lockedElement: HTMLElement | null = null;
let previousOverflow: string | null = null;

/**
 * The app's scrollport. `document.body` no longer scrolls — `.app-workspace`
 * does (see `src/App.css`) — so locking the body would silently stop locking
 * anything and the page behind an open modal would keep scrolling. Falls back
 * to the body for the pre-login screens (AuthGate / WorkspacePicker), which
 * render before `.app-workspace` exists.
 */
function scrollportElement(): HTMLElement {
  return document.querySelector<HTMLElement>(".app-workspace") ?? document.body;
}

function acquireScrollLock(): void {
  if (lockCount === 0) {
    lockedElement = scrollportElement();
    previousOverflow = lockedElement.style.overflow;
    lockedElement.style.overflow = "hidden";
  }
  lockCount += 1;
}

function releaseScrollLock(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && lockedElement) {
    // Restore against the element that was actually locked, not a fresh
    // lookup: a tab switch between acquire and release could resolve a
    // different node and leave the original stuck at `overflow: hidden`.
    lockedElement.style.overflow = previousOverflow ?? "";
    lockedElement = null;
    previousOverflow = null;
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
 * Also applies a reference-counted scroll lock on the app's scrollport
 * (`.app-workspace`, falling back to `document.body` pre-login) for as
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
