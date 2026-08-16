// `replacedRowIds` had exactly one reader — `appendSampleRow` itself.
//
// `sample.rows` is deliberately append-only: a replaced row stays as the audit
// trail and as the dedup set that stops it being drawn again. `totalActual` was
// already corrected to `rows.length - replacedRowIds.length`. But every OTHER
// consumer read `rows` whole, so after N replacements they carried N rows too
// many while `totalActual` did not.
//
// In the executive deck that lands on both sides of a ratio: retired rows were
// counted as `selectedInSample` (inflating the numerator) while `totalSample`
// used `totalActual` (not inflated) — so a heavily-replaced month could report
// a completion rate ABOVE 100 % and understate the remaining backlog. That is
// the phantom-backlog symptom the totalActual fix was meant to kill, moved into
// the ratio instead of removed.

import { describe, it, expect } from "vitest";

import { liveSampleRows } from "./sampleStorage";
import type { SampleMasterData } from "./sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";

const row = (id: string): PreparedPopulationRow =>
  ({ xrayImageId: id }) as unknown as PreparedPopulationRow;

function sample(
  ids: string[],
  replacedRowIds?: string[]
): Pick<SampleMasterData, "rows" | "replacedRowIds"> {
  return { rows: ids.map(row), ...(replacedRowIds ? { replacedRowIds } : {}) };
}

describe("liveSampleRows — retired rows are audit trail, not live sample", () => {
  it("excludes every replaced row", () => {
    const live = liveSampleRows(sample(["a", "b", "c", "d"], ["a", "c"]));

    expect(live.map((r) => r.xrayImageId)).toEqual(["b", "d"]);
  });

  it("agrees with totalActual, which is the whole point", () => {
    // The invariant the deck's ratio depends on: the row list the numerator is
    // built from and the count the denominator uses must describe the same set.
    const data = sample(["a", "b", "c", "d", "e"], ["a", "c"]);
    const totalActual = data.rows.length - (data.replacedRowIds?.length ?? 0);

    expect(liveSampleRows(data)).toHaveLength(totalActual);
  });

  it("returns the original array untouched when nothing was replaced", () => {
    // The overwhelmingly common case — it must not pay for a filter or a copy.
    const data = sample(["a", "b"]);

    expect(liveSampleRows(data)).toBe(data.rows);
  });

  it("treats an empty replacedRowIds the same as absent", () => {
    const data = sample(["a", "b"], []);

    expect(liveSampleRows(data)).toBe(data.rows);
  });

  it("handles a null sample", () => {
    expect(liveSampleRows(null)).toEqual([]);
    expect(liveSampleRows(undefined)).toEqual([]);
  });

  it("does not mutate the sample it is given", () => {
    // `rows` is the audit trail and must survive intact on disk.
    const data = sample(["a", "b", "c"], ["b"]);

    liveSampleRows(data);

    expect(data.rows.map((r) => r.xrayImageId)).toEqual(["a", "b", "c"]);
    expect(data.replacedRowIds).toEqual(["b"]);
  });
});
