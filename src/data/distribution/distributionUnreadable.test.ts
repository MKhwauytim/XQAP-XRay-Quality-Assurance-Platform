// An UNREADABLE distribution must not be presented as an empty one.
//
// Same principle T-08 already established for `population.final.json`
// (`PopulationUnreadableError`), one layer up. `loadOrDeriveDistributionCurrent`
// catches every failure and returns `null`, and `null` is ALSO how it reports
// the genuine "this month has no distribution events yet". Every queue-rendering
// caller reads that as `?? []` and paints an empty, authoritative-looking list:
// on the UNC/SMB share this app runs on, a transient `NotReadableError` storm
// therefore showed employees "0 samples" and a supervisor a month in which
// almost nobody had answered anything.
//
// These tests pin the distinction, not the fold.
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { buildAssignEvent } from "./distributionLog";
import {
  DistributionUnreadableError,
  __clearDeriveMemoForTests,
  appendDistributionEvents,
  loadOrDeriveDistributionCurrent,
  loadOrDeriveDistributionCurrentStrictForRead,
} from "./distributionStorage";

const MONTH = "5-may-2026";

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: null,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "2026-05-01T00:00:00.000Z",
    drawnBy: "admin",
    rows,
  };
}

async function seedAssignedMonth(): Promise<{
  root: ReturnType<typeof createMemoryDirectory>;
  rows: PreparedPopulationRow[];
}> {
  const root = createMemoryDirectory("root");
  const rows = [makeRow("IMG-1"), makeRow("IMG-2")];
  const saved = await saveSampleMaster(root, MONTH, makeSample(rows));
  if (!saved.ok) throw new Error("seed sample failed");
  const appended = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
    buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-2", eventBy: "admin" }),
  ]);
  if (!appended.ok) throw new Error(`seed assign failed: ${appended.error}`);
  __clearDeriveMemoForTests();
  return { root, rows };
}

describe("distribution read: unreadable is not empty", () => {
  beforeEach(() => {
    __clearDeriveMemoForTests();
  });

  it("throws DistributionUnreadableError when the month's events cannot be read", async () => {
    const { root, rows } = await seedAssignedMonth();
    setSimulatedFaults(root, [
      { operation: "readFile", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
      { operation: "getFile", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    await expect(
      loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows)
    ).rejects.toBeInstanceOf(DistributionUnreadableError);
  });

  it("keeps the legacy null contract for every existing caller", async () => {
    const { root, rows } = await seedAssignedMonth();
    setSimulatedFaults(root, [
      { operation: "readFile", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
      { operation: "getFile", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    await expect(
      loadOrDeriveDistributionCurrent(root, MONTH, rows, { persistCache: false })
    ).resolves.toBeNull();
  });

  it("returns null (absence is a fact) for a month with no distribution events", async () => {
    const root = createMemoryDirectory("root");
    const rows = [makeRow("IMG-1")];
    const saved = await saveSampleMaster(root, MONTH, makeSample(rows));
    if (!saved.ok) throw new Error("seed sample failed");
    __clearDeriveMemoForTests();

    await expect(
      loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows)
    ).resolves.toBeNull();
  });

  it("throws rather than returning null when events exist but the row set came back empty", async () => {
    const { root } = await seedAssignedMonth();

    // The shape a failed/partial `sample.master.json` read produces at the
    // caller: events on disk, no rows to fold them against. Folding that would
    // absorb every assignment and report a month with nothing in it.
    await expect(
      loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, [])
    ).rejects.toBeInstanceOf(DistributionUnreadableError);
  });
});
