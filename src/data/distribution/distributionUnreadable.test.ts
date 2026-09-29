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
import { listDirectoryEntries } from "../storage/directoryScan";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { buildAssignEvent } from "./distributionLog";
import {
  DISTRIBUTION_EVENTS_DIR,
  __resetDistributionSessionIdForTests,
} from "./distributionEventStore";
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

/**
 * Seeds a month whose two `assigned` events land in TWO SEPARATE `.ndjson`
 * segments (one per writer session — `__resetDistributionSessionIdForTests`
 * forces the second append to a fresh session id, hence a fresh segment file
 * name). Lets a fault target exactly ONE segment by its exact name and prove
 * the OTHER segment's event still comes through — the genuinely partial-
 * tolerance shape a real "one machine's segment hasn't propagated across the
 * share yet" failure has, as opposed to a whole-month wipeout.
 */
async function seedAssignedMonthAcrossTwoSegments(): Promise<{
  root: ReturnType<typeof createMemoryDirectory>;
  rows: PreparedPopulationRow[];
  segmentNames: [string, string];
}> {
  const root = createMemoryDirectory("root");
  const rows = [makeRow("IMG-1"), makeRow("IMG-2")];
  const saved = await saveSampleMaster(root, MONTH, makeSample(rows));
  if (!saved.ok) throw new Error("seed sample failed");

  const first = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
  ]);
  if (!first.ok) throw new Error(`seed first assign failed: ${first.error}`);

  __resetDistributionSessionIdForTests();

  const second = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-2", eventBy: "admin" }),
  ]);
  if (!second.ok) throw new Error(`seed second assign failed: ${second.error}`);

  __clearDeriveMemoForTests();

  const dir = await getSampleMainDir(root, MONTH, true);
  const eventsDir = await dir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  const segmentNames = (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".ndjson"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (segmentNames.length !== 2) {
    throw new Error(`expected 2 distinct segments, got ${segmentNames.length}: ${segmentNames.join(", ")}`);
  }
  return { root, rows, segmentNames: [segmentNames[0]!, segmentNames[1]!] };
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

// F21 fix round 3 (controller ruling 2026-09-28): `strictSegments` must stay
// opt-in, per caller, not a blanket behavior change to
// `loadOrDeriveDistributionCurrentStrictForRead`. Every QUEUE-RENDERING
// employee view (XrayInspectionResults.tsx, XrayReferrals.tsx) calls this
// function with no 4th argument and must keep tolerating an ordinary skipped
// segment — the "another machine's segment isn't visible on the share yet"
// case `readSegmentTails` deliberately tolerates — exactly as it always has.
// Only `populationOverwriteGuard.ts` opts in with `{ strictSegments: true }`.
describe("distribution read: strictSegments stays opt-in per caller", () => {
  beforeEach(() => {
    __clearDeriveMemoForTests();
  });

  it("a view-path read (no strictSegments) tolerates one unreadable segment and still returns the other segment's data", async () => {
    const { root, rows, segmentNames } = await seedAssignedMonthAcrossTwoSegments();
    // ONLY the first segment file, by exact name — exactly the fault a
    // re-review found round 2's fix did not actually reach for this caller.
    // No directory-open fault, no distribution.log.json fault, and the SECOND
    // segment is left fully readable, so a real answer is still available.
    setSimulatedFaults(root, [
      { operation: "readFile", name: segmentNames[0], errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
      { operation: "getFile", name: segmentNames[0], errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    // The exact call shape every employee view makes: no options argument.
    const current = await loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows);
    expect(current).not.toBeNull();
    // Exactly one of the two assignments survives — the one whose segment
    // file was NOT faulted (segment/image pairing is nondeterministic here:
    // the session id, and therefore which segment sorts first, is random).
    // The unreadable segment's assignment is silently absent, the documented
    // "vanished" tolerance — proving this is a genuine PARTIAL read, not an
    // accidental empty-but-not-thrown result.
    expect(current?.entries).toHaveLength(1);
  });

  it("the guard's own read (strictSegments: true) refuses to tolerate the very same unreadable segment", async () => {
    const { root, rows, segmentNames } = await seedAssignedMonthAcrossTwoSegments();
    setSimulatedFaults(root, [
      { operation: "readFile", name: segmentNames[0], errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
      { operation: "getFile", name: segmentNames[0], errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    await expect(
      loadOrDeriveDistributionCurrentStrictForRead(root, MONTH, rows, { strictSegments: true })
    ).rejects.toBeInstanceOf(DistributionUnreadableError);
  });
});
