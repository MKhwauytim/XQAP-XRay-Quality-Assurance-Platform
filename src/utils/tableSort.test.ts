import { describe, expect, it } from "vitest";
import { compareTableValues, cycleTableSort, sortRowsBy, type TableSort } from "./tableSort";

describe("compareTableValues", () => {
  it("compares two numeric strings numerically, not lexicographically", () => {
    // A lexicographic sort puts "10" before "2"; this must not.
    expect(compareTableValues("2", "10")).toBeLessThan(0);
    expect(compareTableValues("10", "2")).toBeGreaterThan(0);
    expect(compareTableValues("7", "7")).toBe(0);
  });

  it("falls back to Arabic locale comparison when either side is not numeric", () => {
    expect(compareTableValues("ألف", "باء")).toBeLessThan(0);
    expect(compareTableValues("10", "باء")).not.toBe(0);
  });

  it("treats a blank string as non-numeric so '' never sorts as zero", () => {
    // Number("") is 0 and finite — without the explicit blank guard, an empty
    // cell would sort in among real zeros instead of as text.
    expect(compareTableValues("", "0")).not.toBe(0);
  });
});

describe("cycleTableSort", () => {
  it("starts a fresh column ascending", () => {
    expect(cycleTableSort(null, "a")).toEqual({ column: "a", direction: "asc" });
  });
  it("switches to a different column ascending, discarding the old direction", () => {
    expect(cycleTableSort({ column: "a", direction: "desc" }, "b")).toEqual({
      column: "b",
      direction: "asc",
    });
  });
  it("cycles asc → desc → null on the same column", () => {
    const asc: TableSort = { column: "a", direction: "asc" };
    const desc = cycleTableSort(asc, "a");
    expect(desc).toEqual({ column: "a", direction: "desc" });
    expect(cycleTableSort(desc, "a")).toBeNull();
  });
});

describe("sortRowsBy", () => {
  const rows = [
    { id: "r1", group: "b", n: "10" },
    { id: "r2", group: "a", n: "2" },
    { id: "r3", group: "b", n: "9" },
    { id: "r4", group: "a", n: "2" },
  ];
  const valueOf = (row: (typeof rows)[number], column: string) =>
    String((row as unknown as Record<string, string>)[column] ?? "");

  it("is a no-op for a null sort, preserving the caller's order", () => {
    expect(sortRowsBy(rows, null, valueOf)).toEqual(rows);
  });

  it("sorts numerically on a numeric column", () => {
    const out = sortRowsBy(rows, { column: "n", direction: "asc" }, valueOf);
    expect(out.map((r) => r.n)).toEqual(["2", "2", "9", "10"]);
  });

  it("is stable in BOTH directions — equal keys keep their original relative order", () => {
    const asc = sortRowsBy(rows, { column: "group", direction: "asc" }, valueOf);
    expect(asc.map((r) => r.id)).toEqual(["r2", "r4", "r1", "r3"]);
    const desc = sortRowsBy(rows, { column: "group", direction: "desc" }, valueOf);
    // The GROUPS reverse; ties within a group must not.
    expect(desc.map((r) => r.id)).toEqual(["r1", "r3", "r2", "r4"]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    sortRowsBy(input, { column: "n", direction: "asc" }, valueOf);
    expect(input).toEqual(rows);
  });
});
