import { describe, expect, it } from "vitest";
import { runPopulationQuery, type PopulationQueryParams } from "./populationQuery";
import { DATA_PAGE_SIZE } from "../../utils/paginationUtils";

type Row = Record<string, unknown>;

const displayValueGetter = (row: Row, key: string): string => {
  const value = row[key];
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return String(value);
};

function baseParams(overrides: Partial<PopulationQueryParams> = {}): PopulationQueryParams {
  return {
    search: "",
    columnFilters: {},
    sort: null,
    page: 1,
    ...overrides
  };
}

describe("runPopulationQuery — search", () => {
  it("matches on a non-visible/non-first key via an all-key scan (parity with rowMatchesSearch)", () => {
    const rows: Row[] = [
      { name: "Alpha", visibleCol: "one", _hiddenInternal: "needle-value" },
      { name: "Beta", visibleCol: "two", _hiddenInternal: "unrelated" }
    ];

    const result = runPopulationQuery(rows, baseParams({ search: "needle" }), displayValueGetter);

    expect(result.pageRows).toHaveLength(1);
    expect(result.pageRows[0]?.name).toBe("Alpha");
    expect(result.totalRows).toBe(1);
  });

  it("is case-insensitive and trims surrounding whitespace, matching the debounced-search normalization", () => {
    const rows: Row[] = [{ name: "Alpha" }, { name: "Beta" }];

    const result = runPopulationQuery(rows, baseParams({ search: "  ALPHA  " }), displayValueGetter);

    expect(result.pageRows.map((row) => row.name)).toEqual(["Alpha"]);
  });

  it("returns every row unmodified when search is empty", () => {
    const rows: Row[] = [{ name: "Alpha" }, { name: "Beta" }];

    const result = runPopulationQuery(rows, baseParams({ search: "" }), displayValueGetter);

    expect(result.pageRows.map((row) => row.name)).toEqual(["Alpha", "Beta"]);
    expect(result.totalRows).toBe(2);
  });
});

describe("runPopulationQuery — column filters", () => {
  it("keeps only rows whose display value is among the selected values for every active filter (AND across columns)", () => {
    const rows: Row[] = [
      { port: "Jeddah", stage: "1" },
      { port: "Jeddah", stage: "2" },
      { port: "Dammam", stage: "1" }
    ];

    const result = runPopulationQuery(
      rows,
      baseParams({ columnFilters: { port: ["Jeddah"], stage: ["1"] } }),
      displayValueGetter
    );

    expect(result.pageRows).toEqual([{ port: "Jeddah", stage: "1" }]);
    expect(result.totalRows).toBe(1);
  });

  it("imposes no constraint from a column with an empty selected-values array", () => {
    const rows: Row[] = [{ port: "Jeddah" }, { port: "Dammam" }];

    const result = runPopulationQuery(
      rows,
      baseParams({ columnFilters: { port: [] } }),
      displayValueGetter
    );

    expect(result.totalRows).toBe(2);
  });

  it("composes with search (search narrows first, then column filters narrow further)", () => {
    const rows: Row[] = [
      { name: "Alpha", port: "Jeddah" },
      { name: "Alpha2", port: "Dammam" },
      { name: "Beta", port: "Jeddah" }
    ];

    const result = runPopulationQuery(
      rows,
      baseParams({ search: "alpha", columnFilters: { port: ["Jeddah"] } }),
      displayValueGetter
    );

    expect(result.pageRows.map((row) => row.name)).toEqual(["Alpha"]);
  });
});

describe("runPopulationQuery — sort", () => {
  it("returns rows in original order when sort is null", () => {
    const rows: Row[] = [{ name: "Charlie" }, { name: "Alpha" }, { name: "Bravo" }];

    const result = runPopulationQuery(rows, baseParams({ sort: null }), displayValueGetter);

    expect(result.pageRows.map((row) => row.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  it("sorts a string column ascending and descending", () => {
    const rows: Row[] = [{ name: "Charlie" }, { name: "Alpha" }, { name: "Bravo" }];

    const asc = runPopulationQuery(
      rows,
      baseParams({ sort: { column: "name", direction: "asc" } }),
      displayValueGetter
    );
    expect(asc.pageRows.map((row) => row.name)).toEqual(["Alpha", "Bravo", "Charlie"]);

    const desc = runPopulationQuery(
      rows,
      baseParams({ sort: { column: "name", direction: "desc" } }),
      displayValueGetter
    );
    expect(desc.pageRows.map((row) => row.name)).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("sorts a numeric column ascending and descending using numeric comparison, not lexicographic", () => {
    const rows: Row[] = [{ count: 9 }, { count: 10 }, { count: 2 }];

    const asc = runPopulationQuery(
      rows,
      baseParams({ sort: { column: "count", direction: "asc" } }),
      displayValueGetter
    );
    // Lexicographic string sort would produce [10, 2, 9]; numeric sort must produce [2, 9, 10].
    expect(asc.pageRows.map((row) => row.count)).toEqual([2, 9, 10]);

    const desc = runPopulationQuery(
      rows,
      baseParams({ sort: { column: "count", direction: "desc" } }),
      displayValueGetter
    );
    expect(desc.pageRows.map((row) => row.count)).toEqual([10, 9, 2]);
  });

  it("is stable: rows with equal sort-key values preserve their relative original order, ascending and descending", () => {
    const rows: Row[] = [
      { group: "A", seq: 1 },
      { group: "B", seq: 2 },
      { group: "A", seq: 3 },
      { group: "A", seq: 4 },
      { group: "B", seq: 5 }
    ];

    const asc = runPopulationQuery(
      rows,
      baseParams({ sort: { column: "group", direction: "asc" } }),
      displayValueGetter
    );
    expect(asc.pageRows.map((row) => row.seq)).toEqual([1, 3, 4, 2, 5]);

    const desc = runPopulationQuery(
      rows,
      baseParams({ sort: { column: "group", direction: "desc" } }),
      displayValueGetter
    );
    // Descending reverses group order (B before A) but must NOT reverse ties within a group.
    expect(desc.pageRows.map((row) => row.seq)).toEqual([2, 5, 1, 3, 4]);
  });

  it("does not change totalRows or totalPages (sort runs after count-determining search+filter)", () => {
    const rows: Row[] = [{ name: "B" }, { name: "A" }];

    const result = runPopulationQuery(
      rows,
      baseParams({ sort: { column: "name", direction: "asc" } }),
      displayValueGetter
    );

    expect(result.totalRows).toBe(2);
    expect(result.totalPages).toBe(1);
  });
});

describe("runPopulationQuery — pagination", () => {
  function makeRows(count: number): Row[] {
    return Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
  }

  it("pages using the shared DATA_PAGE_SIZE, matching paginationUtils' pageSlice behavior", () => {
    const rows = makeRows(DATA_PAGE_SIZE * 2 + 10);

    const firstPage = runPopulationQuery(rows, baseParams({ page: 1 }), displayValueGetter);
    expect(firstPage.pageRows).toHaveLength(DATA_PAGE_SIZE);
    expect(firstPage.pageRows[0]?.id).toBe(1);
    expect(firstPage.pageRows.at(-1)?.id).toBe(DATA_PAGE_SIZE);
    expect(firstPage.totalRows).toBe(rows.length);
    expect(firstPage.totalPages).toBe(3);

    const lastPage = runPopulationQuery(rows, baseParams({ page: 3 }), displayValueGetter);
    expect(lastPage.pageRows).toHaveLength(10);
    expect(lastPage.pageRows[0]?.id).toBe(DATA_PAGE_SIZE * 2 + 1);
  });

  it("clamps an out-of-range page number down to the last page, matching clampPage", () => {
    const rows = makeRows(DATA_PAGE_SIZE + 5);

    const result = runPopulationQuery(rows, baseParams({ page: 999 }), displayValueGetter);

    expect(result.totalPages).toBe(2);
    expect(result.pageRows).toHaveLength(5);
  });

  it("clamps a zero or negative page number up to page 1, matching clampPage", () => {
    const rows = makeRows(5);

    const zero = runPopulationQuery(rows, baseParams({ page: 0 }), displayValueGetter);
    expect(zero.pageRows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);

    const negative = runPopulationQuery(rows, baseParams({ page: -3 }), displayValueGetter);
    expect(negative.pageRows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("runPopulationQuery — empty rows edge case", () => {
  it("returns an empty page, zero totalRows, and totalPages of 1 for an empty input", () => {
    const result = runPopulationQuery([], baseParams(), displayValueGetter);

    expect(result.pageRows).toEqual([]);
    expect(result.totalRows).toBe(0);
    expect(result.totalPages).toBe(1);
  });

  it("returns an empty result when search/filters eliminate every row", () => {
    const rows: Row[] = [{ name: "Alpha" }, { name: "Beta" }];

    const result = runPopulationQuery(
      rows,
      baseParams({ search: "no-such-value" }),
      displayValueGetter
    );

    expect(result.pageRows).toEqual([]);
    expect(result.totalRows).toBe(0);
    expect(result.totalPages).toBe(1);
  });
});

// --- Golden master (Slice 0) -----------------------------------------------
// runPopulationQuery feeds the Browse XLSX export, which is deterministic by
// contract: same rows + same params must yield the same rows in the same order,
// tie-breaks included. This pins the full ordered output for a fixed input so
// any semantic drift shows up as a diff rather than as a silently different
// export. Recorded BEFORE the pageSize change, and unchanged by it.

describe("runPopulationQuery — golden master", () => {
  // Deliberately includes duplicate sort keys (to exercise the index
  // tiebreaker), an empty value (to exercise the "—" display), and a numeric
  // column stored as strings (to exercise the numeric-vs-locale comparison).
  const goldenRows: Row[] = [
    { id: "r1", port: "بري", stage: "2", weight: "10" },
    { id: "r2", port: "جوي", stage: "1", weight: "9" },
    { id: "r3", port: "بري", stage: "2", weight: "100" },
    { id: "r4", port: "بحري", stage: "1", weight: "" },
    { id: "r5", port: "بري", stage: "1", weight: "9" },
  ];

  it("pins unsorted, unfiltered order", () => {
    const result = runPopulationQuery(goldenRows, baseParams(), displayValueGetter);
    expect(result.pageRows.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(result.totalRows).toBe(5);
  });

  it("pins numeric-aware ascending sort with a stable tiebreak", () => {
    const result = runPopulationQuery(
      goldenRows,
      baseParams({ sort: { column: "weight", direction: "asc" } }),
      displayValueGetter
    );
    // "" renders as "—", which is non-numeric, so it compares by locale against
    // the numeric strings and lands first. Among the numerics 9 < 10 < 100, and
    // the two 9s (r2, r5) keep their original relative order.
    expect(result.pageRows.map((r) => r.id)).toEqual(["r4", "r2", "r5", "r1", "r3"]);
  });

  it("pins descending sort (tiebreak stays ascending by original index)", () => {
    const result = runPopulationQuery(
      goldenRows,
      baseParams({ sort: { column: "weight", direction: "desc" } }),
      displayValueGetter
    );
    // Mirror of the ascending order EXCEPT the equal pair: r2 before r5 in both
    // directions, because the index tiebreaker is applied after the direction
    // flip rather than being reversed with it.
    expect(result.pageRows.map((r) => r.id)).toEqual(["r3", "r1", "r2", "r5", "r4"]);
  });

  it("pins search + column filter + sort composed together", () => {
    const result = runPopulationQuery(
      goldenRows,
      baseParams({
        columnFilters: { port: ["بري"] },
        sort: { column: "weight", direction: "asc" },
      }),
      displayValueGetter
    );
    expect(result.pageRows.map((r) => r.id)).toEqual(["r5", "r1", "r3"]);
    expect(result.totalRows).toBe(3);
  });
});

// --- Phase 1.6: pageSize ----------------------------------------------------

describe("runPopulationQuery — pageSize", () => {
  const rows: Row[] = Array.from({ length: 250 }, (_, i) => ({
    id: `r${i}`,
    port: i % 2 === 0 ? "بري" : "جوي",
  }));

  it("defaults to DATA_PAGE_SIZE when omitted", () => {
    const result = runPopulationQuery(rows, baseParams(), displayValueGetter);
    expect(result.pageRows).toHaveLength(DATA_PAGE_SIZE);
    expect(result.totalPages).toBe(3);
  });

  it("returns every matching row in one page when given a large pageSize", () => {
    const result = runPopulationQuery(
      rows,
      baseParams({ pageSize: Number.MAX_SAFE_INTEGER }),
      displayValueGetter
    );
    expect(result.pageRows).toHaveLength(250);
    expect(result.totalPages).toBe(1);
    expect(result.totalRows).toBe(250);
  });

  it("applies filters before paging, so a full page is the filtered set", () => {
    const result = runPopulationQuery(
      rows,
      baseParams({ columnFilters: { port: ["بري"] }, pageSize: Number.MAX_SAFE_INTEGER }),
      displayValueGetter
    );
    expect(result.pageRows).toHaveLength(125);
    expect(result.pageRows.every((r) => r.port === "بري")).toBe(true);
  });

  it("an Infinity pageSize would silently return nothing — guards the sentinel choice", () => {
    // `pageSlice` computes (page - 1) * pageSize; 0 * Infinity is NaN, and
    // Array.slice coerces NaN to 0 for both bounds. This documents exactly why
    // the export passes Number.MAX_SAFE_INTEGER instead.
    const result = runPopulationQuery(
      rows,
      baseParams({ pageSize: Infinity }),
      displayValueGetter
    );
    expect(result.pageRows).toHaveLength(0);
  });

  it("ignores a non-positive pageSize and falls back to the default", () => {
    for (const bad of [0, -1]) {
      const result = runPopulationQuery(
        rows,
        baseParams({ pageSize: bad }),
        displayValueGetter
      );
      expect(result.pageRows).toHaveLength(DATA_PAGE_SIZE);
    }
  });
});
