import { useEffect, useRef, type RefObject } from "react";

/**
 * Shared focus-trap hook for modal dialogs (E1 — accessibility pass).
 *
 * Attach the returned ref to the dialog container (the `role="dialog"` element,
 * or any wrapper that contains all of the dialog's interactive controls). While
 * the trap is active it:
 *
 *  - focuses the first focusable descendant when the dialog opens;
 *  - traps Tab inside the container — Tab from the last focusable wraps to the
 *    first, Shift+Tab from the first wraps to the last, and focus that has
 *    somehow escaped the container is pulled back in;
 *  - calls `onEscape` when Escape is pressed (wire this to the dialog's existing
 *    close handler — the hook only triggers it, it does not decide what closing
 *    does);
 *  - restores focus to whatever element was focused before the dialog opened
 *    when the dialog closes/unmounts.
 *
 * Two adoption patterns are supported:
 *  - Whole-component modals that only mount when open: call with no `enabled`
 *    (defaults to `true`); the trap activates on mount and tears down on unmount.
 *  - Modals rendered inline inside an always-mounted parent: pass `enabled` bound
 *    to the parent's open flag so the trap activates/deactivates with it.
 */
type FocusTrapOptions = {
  /** Invoked when Escape is pressed inside the trapped dialog. */
  onEscape?: () => void;
  /**
   * When `false` the trap is inert: no focus management, no key listener. Lets a
   * parent that renders the dialog inline gate the trap on its open flag.
   * Defaults to `true` (for components that only mount while open).
   */
  enabled?: boolean;
  /**
   * When `true` (default) focus is moved to the first focusable element on
   * activate and restored to the previously-focused element on deactivate.
   */
  restoreFocus?: boolean;
  /**
   * Extra value folded into the trap effect's dependencies. Needed when the
   * *same* hook instance is reused for a panel that is torn down and rebuilt
   * under a different DOM node while `enabled` stays `true` the whole time —
   * e.g. BrowseDataView's per-column filter menu, which lives inside the `th`
   * of whichever column is open. Switching column A → B never passes `enabled`
   * through `false`, so without a changing `resetKey` the effect keeps the
   * container it captured on A: Tab handling reads a detached node and focus
   * is never moved into B. Pass the identity of the thing being trapped
   * (the open column key, the open item id) here.
   */
  resetKey?: unknown;
};

/**
 * Activation-ordered stack of the containers of every currently-active trap.
 *
 * Each trap listens on `document` in the capture phase. Listeners registered on
 * the *same* node all fire regardless of `stopPropagation()` — propagation is
 * about node-to-node traversal, not about siblings on one node — so before this
 * stack a single Escape inside a nested dialog ran *both* handlers and closed
 * the nested dialog and its parent together.
 *
 * `stopImmediatePropagation()` is not a fix either: it only suppresses the
 * same-node listeners registered *after* the current one, and registration
 * order is not nesting order. A nested dialog opened from an already-open
 * parent registers *second*, so the parent's handler runs first and has already
 * closed the parent before the nested handler could stop anything. Effect order
 * (child-before-parent on a shared mount) and `enabled` toggles that
 * re-register a trap mid-life shuffle it further.
 *
 * So topmost-ness is decided explicitly instead: a trap handles a key only when
 * no other active trap sits above it, where "above" means nested inside it in
 * the DOM (portalled or not), or — for unrelated containers — activated later.
 */
const activeTrapStack: HTMLElement[] = [];

function isTopmostTrap(container: HTMLElement): boolean {
  const index = activeTrapStack.indexOf(container);
  if (index === -1) return false;
  for (let i = 0; i < activeTrapStack.length; i += 1) {
    if (i === index) continue;
    const other = activeTrapStack[i];
    // `other` is nested inside this trap → it is the inner dialog, it wins.
    if (container.contains(other)) return false;
    // This trap is nested inside `other` → this one is the inner dialog.
    if (other.contains(container)) continue;
    // Unrelated containers (siblings, or two portalled overlays): the one
    // activated later is on top.
    if (i > index) return false;
  }
  return true;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  options: FocusTrapOptions = {}
): RefObject<T | null> {
  const { onEscape, enabled = true, restoreFocus = true, resetKey } = options;
  const containerRef = useRef<T | null>(null);

  // Keep the latest onEscape without forcing the trap effect to re-subscribe
  // every render (the callback is usually recreated on each parent render, and
  // re-running the trap effect would re-capture the trigger and re-focus).
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    // Recorded before we move focus, so it points at the trigger, not the
    // dialog's own first control.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    // Move focus into the dialog. Fall back to the container itself (made
    // programmatically focusable) when it has no focusable descendants.
    const focusables = getFocusable();
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      if (!container.hasAttribute("tabindex")) {
        container.setAttribute("tabindex", "-1");
      }
      container.focus();
    }

    activeTrapStack.push(container);

    const handleKeyDown = (event: KeyboardEvent): void => {
      // Only the innermost/most recently opened trap reacts; every other active
      // trap's listener still fires (same node, same phase) but stays inert.
      if (!isTopmostTrap(container)) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const items = getFocusable();
      if (items.length === 0) {
        // Keep focus off the background even when nothing inside is focusable.
        event.preventDefault();
        container.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Focus escaped the container (e.g. a click moved it out) — pull it back.
      if (!container.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const stackIndex = activeTrapStack.indexOf(container);
      if (stackIndex !== -1) activeTrapStack.splice(stackIndex, 1);
      if (
        restoreFocus &&
        previouslyFocused &&
        typeof previouslyFocused.focus === "function"
      ) {
        previouslyFocused.focus();
      }
    };
  }, [enabled, restoreFocus, resetKey]);

  return containerRef;
}
