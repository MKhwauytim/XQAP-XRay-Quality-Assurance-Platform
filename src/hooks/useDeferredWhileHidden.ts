import { useState } from "react";

/**
 * Holds a value steady while a view is hidden, and catches up the moment it
 * becomes visible again.
 *
 * The problem this solves (Phase 1.2): a view that is kept mounted-but-hidden
 * so that switching away and back does not re-load still receives prop changes
 * while hidden, and a load effect keyed on one of those props will re-run for a
 * view nobody is looking at. In the Population tab that meant a full month
 * re-read on every distribution mutation during a Manual Review session —
 * roughly 25 multi-hundred-MB reads for data that was off screen the whole time.
 *
 * Deferring is preferred over unmounting because unmounting would throw away
 * the loaded dataset and re-read it on every visit, which is the cost the
 * mounted-but-hidden design exists to avoid. Nothing is skipped: the reload is
 * moved from "whenever anything changes" to "when the user actually looks",
 * so the view never renders stale data.
 *
 * Uses the render-phase state adjustment React documents for deriving state
 * from props, rather than an effect, so the caller never renders one frame with
 * the stale value.
 */
export function useDeferredWhileHidden<T>(value: T, isVisible: boolean): T {
  const [applied, setApplied] = useState<T>(value);

  if (isVisible && applied !== value) {
    setApplied(value);
    return value;
  }

  return isVisible ? value : applied;
}
