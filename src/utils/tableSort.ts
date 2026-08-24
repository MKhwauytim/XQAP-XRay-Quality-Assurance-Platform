// Shared, dependency-free table sort primitives.
//
// Moved verbatim out of two places that had independently grown the same
// semantics: src/data/population/populationQuery.ts (compareQueryValues,
// sortRows — the Population Browse query engine, also run inside
// src/workers/populationQueryWorker.ts) and
// src/components/Sidebar/Tabs/Population/BrowseDataView.tsx (cycleSort — the
// header caret's three-state click cycle). DataTable is the third consumer.
//
// ZERO imports, deliberately: populationQuery.ts runs inside a DedicatedWorker
// that must not acquire main-thread dependencies (see populationQueryWorker.ts's
// own comment on why it duplicates stageHelpers' logic rather than importing it).

export type TableSort = { column: string; direction: "asc" | "desc" } | null;

// Comparator: numeric comparison when both display values parse as finite
// non-blank numbers, otherwise Arabic-aware locale string comparison
// (consistent with this file area's existing `compareBrowseFilterOptions`
// convention in BrowseDataView.tsx). The blank-string guard is load-bearing:
// `Number("")` is `0` and finite, so without it an empty cell would sort in
// among real zeros instead of as text.
export function compareTableValues(first: string, second: string): number {
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

// Single-column sort cycle: none -> ascending -> descending -> none.
export function cycleTableSort(current: TableSort, column: string): TableSort {
  if (!current || current.column !== column) {
    return { column, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { column, direction: "desc" };
  }
  return null;
}

// Single-column stable sort. `null` sort is a no-op (original row order
// preserved). Stability is made explicit via an index tiebreaker rather than
// relied upon implicitly from the runtime's `Array.prototype.sort`, so equal
// keys always preserve their relative (pre-sort) order regardless of
// `direction`.
export function sortRowsBy<T>(
  rows: T[],
  sort: TableSort,
  valueOf: (row: T, column: string) => string
): T[] {
  if (!sort) {
    return rows;
  }

  const { column, direction } = sort;
  const decorated = rows.map((row, index) => ({
    row,
    index,
    value: valueOf(row, column)
  }));

  decorated.sort((a, b) => {
    const primary = compareTableValues(a.value, b.value);
    const directed = direction === "desc" ? -primary : primary;
    if (directed !== 0) {
      return directed;
    }
    return a.index - b.index;
  });

  return decorated.map((entry) => entry.row);
}
