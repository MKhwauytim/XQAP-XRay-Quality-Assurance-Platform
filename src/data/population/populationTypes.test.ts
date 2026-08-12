import { describe, expect, test } from "vitest";

import {
  attachLazyRawRow,
  stripRawRow,
  type PreparedPopulationRow
} from "./populationTypes";

// B7 (OOM fix, 2026-08-12): a 130k-row risk sheet plus a 247k-row BI sheet
// are both legitimately resident in memory at once now that the BI
// truthiness bug (301e84d4) is fixed. `attachLazyRawRow` exists specifically
// so `PreparedPopulationRow.rawRow` never eagerly duplicates the full raw
// row for every BI-matched row, and `stripRawRow` exists so bulk strip
// operations (writing to disk, drawing a sample) never force that
// lazily-deferred merge across the whole population. These tests pin both
// guarantees mechanically so a future edit can't silently reintroduce the
// eager copy / eager materialization that caused the OOM.

function makeBareRow(): PreparedPopulationRow {
  // Only the fields these tests touch matter; the rest are irrelevant to
  // the rawRow-memory contract being pinned here.
  return {} as PreparedPopulationRow;
}

describe("attachLazyRawRow", () => {
  test("with no extras, rawRow is the SAME object reference as base (never copied)", () => {
    const base = { a: "1", b: "2" };
    const row = makeBareRow();

    attachLazyRawRow(row, base, null);

    expect(row.rawRow).toBe(base);
  });

  test("with empty extras object, rawRow is still the SAME object reference as base", () => {
    const base = { a: "1" };
    const row = makeBareRow();

    attachLazyRawRow(row, base, {});

    expect(row.rawRow).toBe(base);
  });

  test("with extras, rawRow merges base + extras (extras win) without mutating base", () => {
    const base = { a: "1", b: "2" };
    const extras = { b: "overridden", c: "3" };
    const row = makeBareRow();

    attachLazyRawRow(row, base, extras);

    expect(row.rawRow).toEqual({ a: "1", b: "overridden", c: "3" });
    // base must stay untouched -- the merge is computed fresh, not applied in place.
    expect(base).toEqual({ a: "1", b: "2" });
  });

  test("merge is recomputed on every read, not cached on the row (no standing extra allocation)", () => {
    const base = { a: "1" };
    const extras = { c: "3" };
    const row = makeBareRow();

    attachLazyRawRow(row, base, extras);

    const first = row.rawRow;
    const second = row.rawRow;

    // Same content...
    expect(first).toEqual(second);
    // ...but NOT the same object: proves the getter recomputes rather than
    // memoizing a merged copy that would sit in memory for the row's whole
    // lifetime after the first read.
    expect(first).not.toBe(second);
  });

  test("base is undefined and extras present still produces the extras-only merge", () => {
    const row = makeBareRow();

    attachLazyRawRow(row, undefined, { onlyKey: "value" });

    expect(row.rawRow).toEqual({ onlyKey: "value" });
  });
});

describe("stripRawRow", () => {
  test("removes rawRow from a plain data-property row", () => {
    const row = { rawRow: { x: "1" }, xrayImageId: "IMG1" } as unknown as PreparedPopulationRow;

    const stripped = stripRawRow(row);

    expect(stripped).not.toHaveProperty("rawRow");
    expect((stripped as unknown as { xrayImageId: string }).xrayImageId).toBe("IMG1");
  });

  test("returns the row unchanged (same reference) when it has no rawRow property at all", () => {
    const row = { xrayImageId: "IMG1" } as unknown as PreparedPopulationRow;

    expect(stripRawRow(row)).toBe(row);
  });

  test("never invokes the rawRow accessor's getter (would force the lazy BI-merge across the whole population)", () => {
    const row = makeBareRow();
    let getterCalls = 0;

    Object.defineProperty(row, "rawRow", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("stripRawRow must not read rawRow's value");
      }
    });
    (row as unknown as { xrayImageId: string }).xrayImageId = "IMG1";

    expect(() => stripRawRow(row)).not.toThrow();
    expect(getterCalls).toBe(0);

    const stripped = stripRawRow(row);
    expect(stripped).not.toHaveProperty("rawRow");
    expect((stripped as unknown as { xrayImageId: string }).xrayImageId).toBe("IMG1");
  });

  test("stripping a lazily-merged (attachLazyRawRow) row drops rawRow without materializing the merge", () => {
    const base = { a: "1" };
    const row = makeBareRow();
    (row as unknown as { xrayImageId: string }).xrayImageId = "IMG1";
    attachLazyRawRow(row, base, { b: "2" });

    const stripped = stripRawRow(row);

    expect(stripped).not.toHaveProperty("rawRow");
    expect((stripped as unknown as { xrayImageId: string }).xrayImageId).toBe("IMG1");
  });
});
