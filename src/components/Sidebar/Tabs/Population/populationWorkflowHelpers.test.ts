// Golden-fixture characterization for `loadMonthForEditing` + `buildLoadedMonthState`
// (Large-Population Performance Proposal, Phase A — see
// docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md and the
// 2026-08-01 architect review that revised Phase A's plan). This pins the exact
// contract the demand-gating refactor (loader extraction, opt-in MonthLoadScope,
// wizard scoping) must reproduce byte-for-byte when no scope is requested, and
// must not silently break for a sampled/distributed month once scoping is added.
import { expect, test } from "vitest";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { saveMonthRun, loadMonthForEditing } from "../../../../data/population/populationStorage";
import { saveSampleMaster } from "../../../../data/sampling/sampleStorage";
import { appendDistributionEvent, loadOrDeriveDistributionCurrent } from "../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../data/distribution/distributionLog";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import { buildLoadedMonthState, computeMonthLoadScope } from "./populationWorkflowHelpers";

const baseParams = {
  month: 5,
  year: 2026,
  username: "test-admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  riskRawRows: [{ id: "A001", port: "بري" }],
  biRawRows: [],
  processedRows: [{ xrayImageId: "A001", certScanStatus: "NonCertscan" }],
  certScanRows: 0,
  nonCertScanRows: 1,
};

function makeSample(): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "2026-05-10T00:00:00.000Z",
    drawnBy: "admin",
    rows: [{ xrayImageId: "A001" } as never],
  };
}

test("golden fixture: processed-but-not-sampled month — full loadMonthForEditing shape + phase 3", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const data = await loadMonthForEditing(dir, "5-may-2026");

  expect(data.populationRows).toEqual([{ xrayImageId: "A001", certScanStatus: "NonCertscan" }]);
  expect(data.certScanRows).toBe(0);
  expect(data.nonCertScanRows).toBe(1);
  expect(data.riskRawRows).toEqual([]); // manifest.status is processed-saved -> raw skip (A1)
  expect(data.biRawRows).toEqual([]);
  expect(data.sampleData).toBeNull();
  expect(data.distributionCurrent).toBeNull();
  expect(data.manifest?.status).toBe("processed-saved");

  const loaded = buildLoadedMonthState(data);
  expect(loaded.phase).toEqual({ current: 3, completed: [1, 2] });
  expect(loaded.population?.preparedRows).toHaveLength(1);
  expect(loaded.sample).toBeNull();
  expect(loaded.distribution).toBeNull();
});

test("golden fixture: sampled-and-distributed month — full loadMonthForEditing shape + phase 4", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });
  await saveSampleMaster(dir, "5-may-2026", makeSample());
  await appendDistributionEvent(
    dir,
    "5-may-2026",
    buildAssignEvent({ xrayImageId: "A001", assignedTo: "employee-1", eventBy: "admin" }),
  );

  const data = await loadMonthForEditing(dir, "5-may-2026");

  expect(data.sampleData?.rows).toEqual([{ xrayImageId: "A001" }]);
  expect(data.distributionCurrent).not.toBeNull();
  expect(data.distributionCurrent?.entries.some((e) => e.xrayImageId === "A001" && e.assignedTo === "employee-1")).toBe(true);
  expect(data.manifest?.status).toBe("processed-saved"); // saveMonthRun/saveSampleMaster don't themselves advance status

  const loaded = buildLoadedMonthState(data);
  expect(loaded.phase).toEqual({ current: 4, completed: [1, 2, 3] });

  // Re-derive independently via loadOrDeriveDistributionCurrent to prove
  // loadMonthForEditing's embedded distribution derivation agrees with the
  // standalone helper Reports/index.tsx uses for the distribution report path.
  //
  // `derivedAt` is deliberately excluded. The cache write is fire-and-forget
  // (it is ~18.8 MB for a real month, so awaiting it put a multi-megabyte
  // write on the hot path — see distributionStorage.ts), which means a second
  // immediate call may re-derive rather than read the just-persisted cache and
  // therefore stamps a fresh timestamp, typically 1 ms later. That is the
  // documented wasteful-but-correct race. What this test actually pins is that
  // the two derivations agree on the *distribution state itself*, not that
  // they happened in the same millisecond.
  const independentDistribution = await loadOrDeriveDistributionCurrent(dir, "5-may-2026", data.sampleData!.rows);
  const withoutDerivedAt = ({ derivedAt, ...rest }: { derivedAt?: string }) => {
    void derivedAt;
    return rest;
  };
  expect(withoutDerivedAt(data.distributionCurrent!)).toEqual(
    withoutDerivedAt(independentDistribution!),
  );
});

// Regression pin for the "phase-derivation trap" the 2026-08-01 architect review flagged:
// buildLoadedMonthState must not regress an already-processed/sampled month to phase 1
// just because a scoped load (Phase A) didn't request populationRows/sampleData.
test("buildLoadedMonthState phase survives a scoped load that omits populationRows/sampleData", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });
  await saveSampleMaster(dir, "5-may-2026", makeSample());
  await appendDistributionEvent(
    dir,
    "5-may-2026",
    buildAssignEvent({ xrayImageId: "A001", assignedTo: "employee-1", eventBy: "admin" }),
  );

  // A scope that loads only manifest+summary -- exactly what a "process" sub-tab view
  // with no draw-sample capability and an already-sampled month would request.
  const data = await loadMonthForEditing(dir, "5-may-2026", { summary: true });
  expect(data.populationRows).toBeNull();
  expect(data.sampleData).toBeNull();
  expect(data.distributionCurrent).toBeNull();
  expect(data.manifest?.status).toBe("processed-saved"); // saveSampleMaster alone doesn't advance status

  // Even with sample/distribution/population all unloaded, and the manifest status not
  // yet advanced past "processed-saved" (a real, if rare, partial-failure shape -- see
  // populationWorkflowHelpers.ts's derivePhase comment), the month must not be reported
  // as phase 1/2. Phase 3 (not 4) is the correct, conservative answer here: nothing in
  // THIS particular load actually proves a sample exists.
  const loaded = buildLoadedMonthState(data);
  expect(loaded.phase).toEqual({ current: 3, completed: [1, 2] });
});

test("golden fixture: raw-saved (unprocessed) month — no population, phase left for Phase 1/2 to derive", async () => {
  const dir = createMemoryDirectory();
  // A month with only an uploaded workbook (Phase 1) has no manifest yet at all in the
  // real app flow, but loadMonthForEditing itself has no month folder to read either --
  // characterizing the pure "nothing on disk yet" case here.
  const data = await loadMonthForEditing(dir, "6-june-2026");

  expect(data.populationRows).toBeNull();
  expect(data.manifest).toBeNull();
  expect(data.sampleData).toBeNull();
  expect(data.distributionCurrent).toBeNull();

  const loaded = buildLoadedMonthState(data);
  expect(loaded.phase).toBeNull();
  expect(loaded.population).toBeNull();
});

// computeMonthLoadScope (Phase A step 3) — pure, no I/O.
test("computeMonthLoadScope: browse sub-tab never requests population/raw regardless of capability", () => {
  expect(
    computeMonthLoadScope({ activeSubTab: "browse", canDrawSample: true, canProcessPopulation: true }),
  ).toEqual({ summary: true, sample: true, distribution: true, population: false, raw: false });
});

test("computeMonthLoadScope: process sub-tab, view-only viewer (no draw/process capability) skips population/raw", () => {
  expect(
    computeMonthLoadScope({ activeSubTab: "process", canDrawSample: false, canProcessPopulation: false }),
  ).toEqual({ summary: true, sample: true, distribution: true, population: false, raw: false });
});

test("computeMonthLoadScope: process sub-tab + canDrawSample requests population/raw", () => {
  expect(
    computeMonthLoadScope({ activeSubTab: "process", canDrawSample: true, canProcessPopulation: false }),
  ).toEqual({ summary: true, sample: true, distribution: true, population: true, raw: true });
});

test("computeMonthLoadScope: process sub-tab + canProcessPopulation requests population/raw", () => {
  expect(
    computeMonthLoadScope({ activeSubTab: "process", canDrawSample: false, canProcessPopulation: true }),
  ).toEqual({ summary: true, sample: true, distribution: true, population: true, raw: true });
});
