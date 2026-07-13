// Data-correctness tests for the sample report lineage model (Wave 3). The three
// renderers (document / deck / xlsx) all read `computeSampleLineage`, so proving
// the model is correct proves the numbers every output shows.

import { describe, expect, it } from "vitest";

import { computeSampleLineage, buildSampleDocument, buildSampleDeck, type SampleReportInput } from "./sampleReport";
import { makeRow, makeManifest, makeSampleMaster } from "./reportTestFixtures";
import type { PortAllocation } from "../sampling/sampleTypes";

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
  it("document renders the drawn image ids and is a self-contained HTML doc", () => {
    const html = buildSampleDocument(input());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("IMG-1");
    expect(html).toContain("تقرير العينة");
  });

  it("deck renders slides with the RNG seed and month label", () => {
    const html = buildSampleDeck(input());
    expect(html).toContain("class=\"slide");
    expect(html).toContain("seed-1");
    expect(html).toContain("يونيو 2026");
  });
});
