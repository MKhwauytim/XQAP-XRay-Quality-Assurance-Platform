// The queue table's row-selection helpers (the checkbox column, the toolbar's
// "select every filtered row" and "clear"), as one factory over the single
// `selectedIds` state setter.
//
// Lives outside XrayReferrals.tsx for the same two reasons caseFilter.ts and
// answerStatusFilter.ts do: that component sits on the
// `max-lines-per-function` budget enforced by `npm run check:complexity`, and
// a set-transition that three separate call sites depend on is worth testing
// without rendering a table.
//
// Deliberately NOT memoized, matching the plain function declarations this
// replaces: nothing downstream keys off these identities (`createRenderCell`
// is itself rebuilt every render), so a `useCallback` here would buy nothing
// and change the behaviour of the code it is standing in for.
//
// `toggleSelect` uses the functional updater rather than reading the current
// set, so a burst of toggles inside one React batch cannot drop any of them.

import type { Dispatch, SetStateAction } from "react";

export type QueueSelection = {
  /** Add or remove one row id. */
  toggleSelect: (id: string, checked: boolean) => void;
  /** Replace the whole selection (the toolbar's "select all filtered"). */
  selectAll: (ids: string[]) => void;
  /** Drop the selection entirely. */
  clearSelection: () => void;
};

export function createQueueSelection(
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>
): QueueSelection {
  return {
    toggleSelect: (id, checked) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
    },
    selectAll: (ids) => setSelectedIds(new Set(ids)),
    clearSelection: () => setSelectedIds(new Set()),
  };
}
