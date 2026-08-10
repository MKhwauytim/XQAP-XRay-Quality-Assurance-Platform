// Pure, worker-agnostic query engine for Population Browse (search → filter → sort → paginate).
//
// Extracted from `BrowseDataView.tsx`'s inline `rowMatchesSearch` / `rowMatchesColumnFilters` /
// `useMemo` chain (Phase B of docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md,
// section 5). Search and filter semantics are ported verbatim for behavioral parity; sort is new
// (no prior sort feature existed anywhere in this codebase to preserve).
//
// Zero React/worker/postMessage dependencies by design — importable from the main thread today and
// from a Web Worker once later Phase B tasks wire one up.

import { DATA_PAGE_SIZE, clampPage, pageSlice } from "../../utils/paginationUtils";

export type PopulationQuerySort = { column: string; direction: "asc" | "desc" } | null;

export type PopulationQueryParams = {
  search: string;
  columnFilters: Record<string, string[]>;
  sort: PopulationQuerySort;
  page: number;
};

export type PopulationQueryResult<T> = {
  pageRows: T[];
  totalRows: number;
  totalPages: number;
};

// Verbatim port of BrowseDataView's rowMatchesSearch: an all-key scan (including internal/hidden
// keys such as `_monthFolder`) — a row matches if ANY key's display value contains the normalized
// search string, case-insensitively.
function rowMatchesSearch<T>(
  row: T,
  normalizedSearch: string,
  displayValueGetter: (row: T, key: string) => string
): boolean {
  if (!normalizedSearch) {
    return true;
  }

  return Object.keys(row as object).some((key) =>
    displayValueGetter(row, key).toLowerCase().includes(normalizedSearch)
  );
}

// Verbatim port of BrowseDataView's rowMatchesColumnFilters: a row matches if, for every filtered
// column with at least one selected value, the row's display value for that column is one of the
// selected values. Columns with no selected values impose no constraint.
function rowMatchesColumnFilters<T>(
  row: T,
  filters: Record<string, string[]>,
  displayValueGetter: (row: T, key: string) => string
): boolean {
  return Object.entries(filters).every(([key, selectedValues]) => {
    if (selectedValues.length === 0) {
      return true;
    }

    return selectedValues.includes(displayValueGetter(row, key));
  });
}

// New sort comparator: numeric comparison when both display values parse as finite numbers,
// otherwise Arabic-aware locale string comparison (consistent with this file area's existing
// `compareBrowseFilterOptions` convention in BrowseDataView.tsx).
function compareQueryValues(first: string, second: string): number {
  const firstNumeric = Number(first);
  const secondNumeric = Number(second);
  const bothNumeric =
    first.trim() !== "" &&
    second.trim() !== "" &&
    Number.isFinite(firstNumeric) &&
    Number.isFinite(secondNumeric);

  if (bothNumeric) {
    return firstNumeric - secondNumeric;
  }

  return first.localeCompare(second, "ar");
}

// New: single-column stable sort. `null` sort is a no-op (original row order preserved). Stability
// is made explicit via an index tiebreaker rather than relied upon implicitly from the runtime's
// `Array.prototype.sort`, so equal keys always preserve their relative (pre-sort) order regardless
// of `direction`.
function sortRows<T>(
  rows: T[],
  sort: PopulationQuerySort,
  displayValueGetter: (row: T, key: string) => string
): T[] {
  if (!sort) {
    return rows;
  }

  const { column, direction } = sort;
  const decorated = rows.map((row, index) => ({
    row,
    index,
    value: displayValueGetter(row, column)
  }));

  decorated.sort((a, b) => {
    const primary = compareQueryValues(a.value, b.value);
    const directed = direction === "desc" ? -primary : primary;
    if (directed !== 0) {
      return directed;
    }
    return a.index - b.index;
  });

  return decorated.map((entry) => entry.row);
}

/**
 * Straight-line composition: search-filter → column-filter → sort → paginate.
 *
 * `rows` are assumed already scoped to whatever month/dataset selection the caller wants queried
 * (BrowseDataView's `monthFilteredRows` equivalent) — this function does not perform that scoping.
 */
export function runPopulationQuery<T extends Record<string, unknown>>(
  rows: T[],
  params: PopulationQueryParams,
  displayValueGetter: (row: T, key: string) => string
): PopulationQueryResult<T> {
  const normalizedSearch = params.search.trim().toLowerCase();
  const searchFilteredRows = normalizedSearch
    ? rows.filter((row) => rowMatchesSearch(row, normalizedSearch, displayValueGetter))
    : rows;

  const hasActiveColumnFilters = Object.values(params.columnFilters).some(
    (values) => values.length > 0
  );
  const filteredRows = hasActiveColumnFilters
    ? searchFilteredRows.filter((row) =>
        rowMatchesColumnFilters(row, params.columnFilters, displayValueGetter)
      )
    : searchFilteredRows;

  const sortedRows = sortRows(filteredRows, params.sort, displayValueGetter);

  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / DATA_PAGE_SIZE));
  const page = clampPage(params.page, totalRows, DATA_PAGE_SIZE);
  const pageRows = pageSlice(sortedRows, page, DATA_PAGE_SIZE);

  return { pageRows, totalRows, totalPages };
}
