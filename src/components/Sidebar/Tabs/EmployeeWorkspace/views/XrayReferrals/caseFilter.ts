// The case-queue's three top-level filters, as pure functions plus one tiny
// state hook. Lives outside XrayReferrals.tsx on purpose: that component is at
// its `max-lines-per-function` budget (see `npm run check:complexity`), and a
// predicate this load-bearing should be unit-testable without rendering a
// table, a panel and a workspace.
//
// The three buckets, exactly as the owner defined them:
//
//   • "all"           — «جميع الحالات». No filtering. The default.
//   • "risk-targeted" — «مستهدف المؤشر». Every row that reached this queue
//     through the regular monthly population process (إدارة بيانات الأشعة ›
//     معالجة البيانات) off the attached Risk file — i.e. every row that is
//     NOT an ad-hoc-imported exceptional case. Membership in the Risk file's
//     processed population is itself what makes a row "targeted by the
//     indicator"; this is the exact complement of "adhoc" below, not a
//     per-row column read.
//
//     Earlier revisions of this bucket instead read the row's own
//     `targetedByRiskEngine` value (via the risk-engine-agreement vocabulary
//     `engineVerdictOf` shares with the executive deck). The owner corrected
//     that: a blank/unrecognized value in that column is common and does NOT
//     mean the row is untargeted — every row from the regular pipeline IS the
//     indicator's target population by construction. `engineVerdictOf` still
//     exists and is still correct for its own job (the executive deck's
//     risk-engine agreement/accuracy figures, which genuinely need the real
//     per-row flag to measure agreement) — it is simply the wrong tool for
//     this chip.
//
//   • "adhoc"         — «حالات استثنائية». Rows assigned through an ad-hoc
//     import (ارفاق حالات استثنائية, `src/data/adhocImport/`) instead of the
//     regular monthly sampling pipeline, identified by `isAdhocEntry`.
//
// "risk-targeted" and "adhoc" are now an exact partition of "all": every row
// is exactly one or the other, never both, so their counts sum to `all`.
//
// Pure (apart from `useCaseFilter`'s `useState`): same input ⇒ same output.

import { useMemo, useState } from "react";
import { isAdhocEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";

export type CaseFilter = "all" | "risk-targeted" | "adhoc";

/** Render order of the chips. `all` is first because it is the default. */
export const CASE_FILTERS = ["all", "risk-targeted", "adhoc"] as const satisfies readonly CaseFilter[];

export type CaseFilterCounts = Record<CaseFilter, number>;

/**
 * Does this entry belong in the given bucket?
 *
 * The one predicate every part of the feature goes through — the visible rows,
 * the chip counts and the tests all call this, so a count can never disagree
 * with the list it labels.
 */
export function matchesCaseFilter(entry: DistributionEntry, filter: CaseFilter): boolean {
  switch (filter) {
    case "risk-targeted":
      // Every non-ad-hoc row — see the module header for why this is not a
      // read of the row's own risk-engine column.
      return !isAdhocEntry(entry);
    case "adhoc":
      return isAdhocEntry(entry);
    case "all":
      return true;
  }
}

/** The rows of `entries` in the given bucket. Identity-stable for "all". */
export function filterCases<T extends DistributionEntry>(entries: T[], filter: CaseFilter): T[] {
  return filter === "all" ? entries : entries.filter((entry) => matchesCaseFilter(entry, filter));
}

/**
 * How many rows each chip would show.
 *
 * Counted over whatever set is passed in — the caller passes the SAME
 * scope-filtered set the chips then filter, so the numbers always describe the
 * queue the reader is actually looking at rather than the whole workspace.
 */
export function countCaseFilters(entries: readonly DistributionEntry[]): CaseFilterCounts {
  const counts: CaseFilterCounts = { all: entries.length, "risk-targeted": 0, adhoc: 0 };
  for (const entry of entries) {
    if (matchesCaseFilter(entry, "risk-targeted")) counts["risk-targeted"] += 1;
    if (matchesCaseFilter(entry, "adhoc")) counts.adhoc += 1;
  }
  return counts;
}

export type CaseFilterState = {
  value: CaseFilter;
  setValue: (next: CaseFilter) => void;
  /** `scopedEntries` narrowed to the active bucket — what the table renders. */
  entries: DistributionEntry[];
  counts: CaseFilterCounts;
};

/**
 * The chips' state, memoized against the scope-filtered queue.
 *
 * Selection state deliberately lives OUTSIDE this hook (in XrayReferrals): a
 * filter switch must not re-point the inspection panel, so nothing here touches
 * the open row. A row the active filter excludes simply leaves `entries`, which
 * is the same shape of event as a supervisor reassigning it mid-edit — and the
 * view's existing `dirtyEntryId` / `lastPanelEntry` retention already keeps an
 * unsaved draft on screen for exactly that case.
 */
export function useCaseFilter(scopedEntries: DistributionEntry[]): CaseFilterState {
  const [value, setValue] = useState<CaseFilter>("all");
  const counts = useMemo(() => countCaseFilters(scopedEntries), [scopedEntries]);
  const entries = useMemo(() => filterCases(scopedEntries, value), [scopedEntries, value]);
  return { value, setValue, entries, counts };
}
