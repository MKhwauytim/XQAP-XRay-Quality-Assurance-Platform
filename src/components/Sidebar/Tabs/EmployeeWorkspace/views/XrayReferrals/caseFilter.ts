// The case-queue's three top-level filters, as pure functions plus one tiny
// state hook. Lives outside XrayReferrals.tsx on purpose: that component is at
// its `max-lines-per-function` budget (see `npm run check:complexity`), and a
// predicate this load-bearing should be unit-testable without rendering a
// table, a panel and a workspace.
//
// The three buckets, exactly as the owner defined them:
//
//   • "all"           — «جميع الحالات». No filtering. The default.
//   • "risk-targeted" — «مستهدف المؤشر». The customs risk engine actually said
//     YES for this image. Read straight off the normal pipeline output:
//     `DistributionEntry.row` is an `EmployeeMirrorRowStub` and already carries
//     `targetedByRiskEngine` (it is in `EMPLOYEE_MIRROR_STUB_FIELDS`), so this
//     costs no extra disk read. The raw value is classified through the SHARED
//     `engineVerdictOf` — the same vocabulary the executive deck's risk-engine
//     page uses — so the two can never drift apart.
//
//     The blank rule matters here as much as it does on that deck page: a blank
//     or an unrecognized value is «we do not know what the engine said», so it
//     is NOT counted as targeted. That makes this chip an UNDER-count whenever
//     the month's risk column is sparsely populated or uses a spelling the
//     vocabulary has not learned yet — the safe direction, since the opposite
//     would put un-flagged cases in front of a reviewer as if the engine had
//     flagged them.
//
//   • "adhoc"         — «حالات استثنائية». Rows assigned through an ad-hoc
//     import (`src/data/adhocImport/`) instead of the regular monthly sampling
//     pipeline, identified by `isAdhocEntry`.
//
// The buckets are deliberately NOT mutually exclusive: an ad-hoc row whose
// risk column says «نعم» is counted by both chips. They are three independent
// lenses on one queue, not a partition, so the counts do not sum to `all`.
//
// Pure (apart from `useCaseFilter`'s `useState`): same input ⇒ same output.

import { useMemo, useState } from "react";
import { isAdhocEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { engineVerdictOf } from "../../../../../../data/population/riskEngineVerdict";

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
      // Strictly "the engine said yes". `null` (blank OR unrecognized) and
      // "سليمة" both fall out here — see the module header.
      return engineVerdictOf(entry.row.targetedByRiskEngine) === "اشتباه";
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
