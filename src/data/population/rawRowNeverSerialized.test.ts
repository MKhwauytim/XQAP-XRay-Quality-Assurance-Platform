// The save-path OOM on a real month.
//
// `rawRow` is attached as a LAZY accessor (B7) so the BI merge is deferred, and
// the save path defended against it reaching disk by copying every row through
// `stripRawRow`. That copy worked — and cost a second full population in
// memory, while React still held the first. Measured on a realistic 45-field
// row: ~626 MB for 300k prepared rows, plus ~490 MB for the copy, i.e. roughly
// 1.8 GB at 500k rows, both arrays live simultaneously across the whole of
// `saveMonthRun`. A Chrome tab dies well before that.
//
// The accessor is now non-enumerable, which every serializer in this repo
// already respects — so the guarantee holds with no copy at all.
//
// These tests pin the two halves of that claim: `rawRow` still WORKS for its
// readers, and it never reaches disk. The second one fails if anyone flips
// `enumerable` back to true.

import { describe, it, expect } from "vitest";

import { attachLazyRawRow, stripRawRow } from "./populationTypes";
import type { PreparedPopulationRow } from "./populationTypes";
import { streamJsonStringify } from "../storage/jsonEnvelope";

function rowWithLazyRawRow(): PreparedPopulationRow {
  const row = { xrayImageId: "XR-0001", portName: "PortA" } as unknown as PreparedPopulationRow;
  attachLazyRawRow(row, { "رقم الصورة": "XR-0001", Extra: "from-risk" }, { BiField: "from-bi" });
  return row;
}

describe("rawRow is readable but never serialized", () => {
  it("is still directly readable — the exporter depends on it", () => {
    // populationExporter.ts and columnMappingHints.ts read `row.rawRow`.
    // Enumerability governs enumeration, not reads, so this must be unaffected.
    const row = rowWithLazyRawRow();

    expect(row.rawRow).toBeTruthy();
    expect(row.rawRow?.Extra).toBe("from-risk");
    // The lazily merged BI keys are the whole point of the accessor.
    expect(row.rawRow?.BiField).toBe("from-bi");
  });

  it("never appears in JSON.stringify output", () => {
    const row = rowWithLazyRawRow();

    const json = JSON.stringify(row);

    expect(json).toContain("XR-0001");
    expect(json).not.toContain("rawRow");
    expect(json).not.toContain("from-bi");
  });

  it("never appears in the streaming serializer either", () => {
    // This is the one that actually writes population.final.json, and it
    // enumerates with Object.keys — the same rule.
    const row = rowWithLazyRawRow();

    const streamed = [...streamJsonStringify({ rows: [row] })].join("");

    expect(streamed).toContain("XR-0001");
    expect(streamed).not.toContain("rawRow");
    expect(streamed).not.toContain("from-bi");
  });

  it("is invisible to Object.keys, so no copy is needed to hide it", () => {
    // The property that makes dropping `.map(stripRawRow)` safe. If someone
    // sets `enumerable: true` again, this fails and the OOM comes back with it.
    const row = rowWithLazyRawRow();

    expect(Object.keys(row)).not.toContain("rawRow");
    expect(Object.prototype.hasOwnProperty.call(row, "rawRow")).toBe(true);
  });

  it("stripRawRow still removes an ENUMERABLE rawRow, for rows built elsewhere", () => {
    // Kept as a real function, not a no-op: rows that carry a plain data
    // `rawRow` (draft rows, fixtures, legacy callers) still need stripping, and
    // the helper has other call sites.
    const plain = { xrayImageId: "XR-0002", rawRow: { A: "1" } } as unknown as PreparedPopulationRow;

    const stripped = stripRawRow(plain);

    expect(Object.prototype.hasOwnProperty.call(stripped, "rawRow")).toBe(false);
    expect(stripped.xrayImageId).toBe("XR-0002");
  });
});
