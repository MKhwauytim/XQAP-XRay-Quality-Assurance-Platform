// Data-correctness tests for the sample report lineage model (Wave 3). The three
// renderers (document / deck / xlsx) all read `computeSampleLineage`, so proving
// the model is correct proves the numbers every output shows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import { computeSampleLineage, buildSampleDocument, buildSampleDeck, buildSampleXlsx, type SampleReportInput } from "./sampleReport";
import { makeRow, makeManifest, makeSampleMaster } from "./reportTestFixtures";
import { yieldToMain } from "../storage/yieldToMain";
import type { PortAllocation } from "../sampling/sampleTypes";

// The vendored xlsx module namespace is frozen (ESM), so `vi.spyOn` can't
// replace writeFile. Partial-mock the module: keep the real `utils` (the
// export builds a real workbook) but stub `writeFile` so no download is
// attempted in the test environment and the built workbook can be inspected.
// Same idiom as DataTable/index.test.tsx.
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

// Wrap the real `yieldToMain` in a spy (keep its actual setTimeout-based
// behavior) so tests below can assert the chunked XLSX export actually
// yields the main thread for a population above EXPORT_CHUNK_SIZE.
vi.mock("../storage/yieldToMain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/yieldToMain")>();
  return { ...actual, yieldToMain: vi.fn(actual.yieldToMain) };
});

function input(): SampleReportInput {
  const rows = [
    makeRow("IMG-1", "منفذ أ", { biEnrichmentStatus: "BI Matched", certScanStatus: "Certscan" }),
    makeRow("IMG-2", "منفذ أ", { biEnrichmentStatus: "BI Matched", certScanStatus: "NonCertscan" }),
    makeRow("IMG-3", "منفذ ب", { biEnrichmentStatus: "BI Not Provided", certScanStatus: "Certscan" }),
  ];
  const alloc: PortAllocation = {
    portName: "منفذ أ", populationSize: 2, certScanCount: 1, nonCertScanCount: 1,
    allocatedQuota: 2, certScanQuota: 1, nonCertScanQuota: 1,
    actualCertScanDrawn: 1, actualNonCertScanDrawn: 1, actualTotalDrawn: 2,
  };
  const sample = makeSampleMaster([rows[0]!, rows[1]!], {
    totalRequested: 4, totalActual: 2, certScanActual: 1, nonCertScanActual: 1,
    portAllocations: [alloc],
  });
  return { monthFolderName: "6-June-2026", manifest: makeManifest(), populationRows: rows, sample };
}

describe("computeSampleLineage", () => {
  it("folds raw → processed → strata → drawn counts correctly", () => {
    const m = computeSampleLineage(input());
    expect(m.rawRows).toBe(5);
    expect(m.processedRows).toBe(3);
    expect(m.removed).toBe(2);
    expect(m.biCount).toBe(2);
    expect(m.riskCount).toBe(1);
    expect(m.certCount).toBe(2);
    expect(m.nonCertCount).toBe(1);
    expect(m.totalActual).toBe(2);
    expect(m.totalRequested).toBe(4);
  });

  it("sorts ports by population desc and carries per-port sample + allocation", () => {
    const m = computeSampleLineage(input());
    expect(m.ports.map((p) => p.portName)).toEqual(["منفذ أ", "منفذ ب"]);
    const portA = m.ports[0]!;
    expect(portA.population).toBe(2);
    expect(portA.sample).toBe(2); // both port-A rows were drawn
    expect(portA.allocatedQuota).toBe(2);
    const portB = m.ports[1]!;
    expect(portB.sample).toBe(0);
    expect(portB.allocatedQuota).toBeNull(); // no allocation entry for port ب
  });

  it("computes coverage as drawn/processed and fulfillment as drawn/requested", () => {
    const m = computeSampleLineage(input());
    expect(m.coverage).toBeCloseTo((2 / 3) * 100, 5);
    expect(m.fulfillment).toBeCloseTo((2 / 4) * 100, 5);
  });

  it("returns null coverage when the processed denominator is empty", () => {
    const empty: SampleReportInput = {
      monthFolderName: "6-June-2026",
      manifest: makeManifest({ totalRawRows: 0, totalProcessedRows: 0 }),
      populationRows: [],
      sample: makeSampleMaster([], { totalActual: 0, totalRequested: 0, portAllocations: [], stageAllocations: [] }),
    };
    const m = computeSampleLineage(empty);
    expect(m.coverage).toBeNull();
    expect(m.fulfillment).toBeNull();
  });
});

describe("sample renderers", () => {
  it("document renders the drawn image ids and is a self-contained HTML doc", async () => {
    const html = await buildSampleDocument(input());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("IMG-1");
    expect(html).toContain("تقرير العينة");
  });

  it("deck renders slides with the RNG seed and month label", async () => {
    const html = await buildSampleDeck(input());
    expect(html).toContain("class=\"slide");
    expect(html).toContain("seed-1");
    expect(html).toContain("يونيو 2026");
  });
});

// ─── Golden snapshot (P3-7) ────────────────────────────────────────────────────
// Byte-identical proof that adding `await yieldToMain()` breaks inside these
// builders (main-thread chunking, P3-7) changed ONLY timing, never output.
// If either snapshot ever needs updating for a real content change, that
// change must be deliberate and reviewed on its own — never used to paper
// over an unintended regression introduced by a chunking edit.
describe("sample renderers — golden snapshot (P3-7 chunking safety)", () => {
  // formatIssueDate() defaults to `new Date()` (today's real date), so this
  // byte-identity pin is only reproducible if the clock is frozen to the
  // instant the snapshot was actually captured — otherwise it silently
  // breaks on every day rollover (2026-07-30 CI run vs the 2026-07-29
  // capture date). Frozen at UTC noon so local-timezone date rollover
  // doesn't shift the captured calendar day either.
  beforeEach(() => {
    // toFake: ["Date"] only — these builders themselves `await yieldToMain()`
    // (a real `setTimeout`) as part of P3-7's chunking; faking `setTimeout`
    // too would hang those awaits forever without an explicit timer advance.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("document output is byte-identical", async () => {
    expect(await buildSampleDocument(input())).toMatchSnapshot();
  });

  it("deck output is byte-identical", async () => {
    expect(await buildSampleDeck(input())).toMatchSnapshot();
  });
});

// ─── buildSampleXlsx chunked yielding (Task 2, P3-7 follow-up) ────────────────
// Proves the "1 · الاستلام" (Sheet 2) row loop actually yields the main
// thread for a population above EXPORT_CHUNK_SIZE, and that chunking the
// row-array build didn't drop or duplicate any rows across a chunk boundary.
describe("buildSampleXlsx — chunked yielding", () => {
  function bigInput(n: number): SampleReportInput {
    const rows = Array.from({ length: n }, (_, i) => makeRow(`IMG-${i + 1}`, "منفذ أ"));
    const sample = makeSampleMaster(rows.slice(0, 10), { totalRequested: 10, totalActual: 10 });
    return {
      monthFolderName: "6-June-2026",
      manifest: makeManifest({ totalRawRows: n, totalProcessedRows: n }),
      populationRows: rows,
      sample,
    };
  }

  beforeEach(() => {
    vi.mocked(XLSX.writeFile).mockClear();
    vi.mocked(yieldToMain).mockClear();
  });

  it("yields the main thread at least once for a population above EXPORT_CHUNK_SIZE", async () => {
    await buildSampleXlsx(bigInput(1500));
    expect(vi.mocked(yieldToMain).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(XLSX.writeFile)).toHaveBeenCalledTimes(1);
  });

  it("does not yield for a population at or below EXPORT_CHUNK_SIZE", async () => {
    await buildSampleXlsx(bigInput(1000));
    expect(vi.mocked(yieldToMain).mock.calls.length).toBe(0);
  });

  it("chunked row-build output has no drops/duplicates across the chunk boundary", async () => {
    const n = 2500; // spans 3 chunks of EXPORT_CHUNK_SIZE (1000)
    await buildSampleXlsx(bigInput(n));
    const wb = vi.mocked(XLSX.writeFile).mock.calls[0]![0] as XLSX.WorkBook;
    const sheet = wb.Sheets["1 · الاستلام"]!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    expect(rows.length).toBe(n + 1); // header + n data rows, no drops/dupes
    expect(rows[1]![0]).toBe("IMG-1");
    expect(rows[1000]![0]).toBe("IMG-1000"); // last row of chunk 1
    expect(rows[1001]![0]).toBe("IMG-1001"); // first row of chunk 2
    expect(rows[n]![0]).toBe(`IMG-${n}`); // last row overall
    const ids = rows.slice(1).map((r) => (r as unknown[])[0]);
    expect(new Set(ids).size).toBe(n); // no duplicate xrayImageId
  });
});
