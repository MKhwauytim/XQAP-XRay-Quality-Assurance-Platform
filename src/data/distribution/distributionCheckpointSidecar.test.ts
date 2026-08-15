// v85 storage-shape coverage for two changes that share one blast radius:
//
//  * the fold checkpoint moved OUT of `distribution.current.json` into its own
//    `distribution.checkpoint.json` sidecar, and
//  * `distribution.log.json` lost its event BODY, keeping only the CAS stamp
//    (`revision` + `_writeToken`) that the append protocol and
//    `readDistributionLogStamp` depend on.
//
// Both are storage-layer-only: the fold itself is untouched (its golden master
// is `distributionDerivation.golden.test.ts`). What is pinned here is that no
// event can be lost by the split — a checkpoint that does not belong to the
// cache it is being folded onto must be refused, and events that live ONLY in a
// legacy full-body projection must still be read and folded.
import { describe, expect, it, beforeEach } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { getSampleMainDir } from "../workspace/workspacePaths";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type {
  DistributionCurrentData,
  DistributionFoldCheckpoint,
  DistributionLog,
} from "./distributionTypes";
import { DERIVE_VERSION, buildAssignEvent } from "./distributionLog";
import {
  DISTRIBUTION_CHECKPOINT_FILE,
  __clearDeriveMemoForTests,
  appendDistributionEvent,
  appendDistributionEvents,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
  readDistributionLogStamp,
} from "./distributionStorage";

const MONTH = "5-May-2026";
const CURRENT_FILE = "distribution.current.json";
const LOG_FILE = "distribution.log.json";

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

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

async function assign(root: DirectoryHandleLike, imageId: string, at?: string): Promise<void> {
  const event = buildAssignEvent({
    xrayImageId: imageId,
    assignedTo: "alice",
    eventBy: "admin",
    eventAt: at,
  });
  const result = await appendDistributionEvent(root, MONTH, event);
  expect(result.ok).toBe(true);
}

async function readRaw<T>(root: DirectoryHandleLike, fileName: string): Promise<T | null> {
  const dir = await getSampleMainDir(root, MONTH, true);
  const result = await safeReadJson<T>(dir, fileName);
  return result.ok ? result.value : null;
}

/** Settle the fire-and-forget cache write inside loadOrDeriveDistributionCurrent. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("fold-checkpoint sidecar (v85)", () => {
  beforeEach(() => {
    __clearDeriveMemoForTests();
  });

  it("writes the checkpoint to distribution.checkpoint.json and keeps it out of the cache file", async () => {
    const root = makeRoot();
    await assign(root, "A1");

    const derived = await loadOrDeriveDistributionCurrent(root, MONTH, [makeRow("A1")], {
      awaitCachePersist: true,
    });
    expect(derived?.foldCheckpoint?.knownEventIds).toHaveLength(1);

    const cache = await readRaw<DistributionCurrentData>(root, CURRENT_FILE);
    const sidecar = await readRaw<DistributionFoldCheckpoint>(root, DISTRIBUTION_CHECKPOINT_FILE);

    // The in-memory result still carries the checkpoint; the cache FILE must not.
    expect(cache?.entries).toHaveLength(1);
    expect(cache?.foldCheckpoint).toBeUndefined();
    expect(sidecar?.knownEventIds).toEqual(derived?.foldCheckpoint?.knownEventIds);
    // The binding that makes the two files safe to write/delete independently.
    expect(sidecar?.eventSetId).toBe(cache?.eventSetId);
  });

  it("resumes from a sidecar and folds only the new events", async () => {
    const root = makeRoot();
    const rows = [makeRow("A1"), makeRow("A2")];
    await assign(root, "A1", "2026-05-01T08:00:00.000Z");
    await loadOrDeriveDistributionCurrent(root, MONTH, rows, { awaitCachePersist: true });

    await assign(root, "A2", "2026-05-01T09:00:00.000Z");
    __clearDeriveMemoForTests();
    const resumed = await loadOrDeriveDistributionCurrent(root, MONTH, rows, {
      awaitCachePersist: true,
    });

    expect(resumed?.entries.map((entry) => entry.xrayImageId).sort()).toEqual(["A1", "A2"]);
    const sidecar = await readRaw<DistributionFoldCheckpoint>(root, DISTRIBUTION_CHECKPOINT_FILE);
    expect(sidecar?.knownEventIds).toHaveLength(2);
  });

  it("still resumes from a LEGACY checkpoint embedded in distribution.current.json (no sidecar)", async () => {
    const root = makeRoot();
    const rows = [makeRow("A1"), makeRow("A2")];
    await assign(root, "A1", "2026-05-01T08:00:00.000Z");
    const warm = await loadOrDeriveDistributionCurrent(root, MONTH, rows, { awaitCachePersist: true });
    await settle();

    // Rewrite the pair the way a pre-v85 client did: checkpoint INSIDE the
    // cache, no sidecar on disk at all.
    const dir = await getSampleMainDir(root, MONTH, true);
    await safeWriteJson(dir, CURRENT_FILE, warm!);
    await dir.removeEntry!(DISTRIBUTION_CHECKPOINT_FILE);

    await assign(root, "A2", "2026-05-01T09:00:00.000Z");
    __clearDeriveMemoForTests();
    const resumed = await loadOrDeriveDistributionCurrent(root, MONTH, rows, {
      awaitCachePersist: true,
    });

    expect(resumed?.entries.map((entry) => entry.xrayImageId).sort()).toEqual(["A1", "A2"]);
  });

  it("REFUSES a sidecar whose eventSetId does not match the cache, and refolds without losing events", async () => {
    // The danger the binding exists for: a checkpoint whose segmentOffsets are
    // AHEAD of the entries in the cache it is folded onto. Resuming from it
    // reads no new bytes and returns the cache verbatim — every event in
    // between simply disappears, permanently, into an advancing checkpoint.
    const root = makeRoot();
    const rows = [makeRow("A1"), makeRow("A2"), makeRow("A3")];
    await assign(root, "A1", "2026-05-01T08:00:00.000Z");
    await assign(root, "A2", "2026-05-01T09:00:00.000Z");
    await assign(root, "A3", "2026-05-01T10:00:00.000Z");

    // A sidecar that has folded everything…
    await loadOrDeriveDistributionCurrent(root, MONTH, rows, { awaitCachePersist: true });
    await settle();
    const sidecar = await readRaw<DistributionFoldCheckpoint>(root, DISTRIBUTION_CHECKPOINT_FILE);
    expect(sidecar?.knownEventIds).toHaveLength(3);

    // …paired with a cache that reflects only ONE of the three events (what a
    // concurrent writer on an older build, or a half-landed pair of writes,
    // leaves behind).
    const stamp = await readDistributionLogStamp(root, MONTH);
    const dir = await getSampleMainDir(root, MONTH, true);
    await safeWriteJson(dir, CURRENT_FILE, {
      monthFolderName: MONTH,
      deriveVersion: DERIVE_VERSION,
      logRevision: stamp.revision,
      eventSetId: "d1:1:deadbeef:deadbeef",
      derivedAt: new Date().toISOString(),
      totalAssigned: 0,
      totalCompleted: 0,
      totalReplaced: 0,
      totalPending: 0,
      entries: [],
    } satisfies DistributionCurrentData);

    __clearDeriveMemoForTests();
    const result = await loadOrDeriveDistributionCurrent(root, MONTH, rows, {
      awaitCachePersist: true,
    });

    // All three events survive: the mismatched sidecar was refused and the
    // month was refolded from the event store instead of resumed.
    expect(result?.entries.map((entry) => entry.xrayImageId).sort()).toEqual(["A1", "A2", "A3"]);
    expect(result?.totalAssigned).toBe(3);
  });
});

describe("distribution.log.json is a CAS stamp, not an event body (v85)", () => {
  beforeEach(() => {
    __clearDeriveMemoForTests();
  });

  it("writes a body-less projection while keeping the revision/writeToken stamp intact", async () => {
    const root = makeRoot();
    await assign(root, "A1");
    await assign(root, "A2");

    const raw = await readRaw<DistributionLog>(root, LOG_FILE);
    expect(raw?.events).toEqual([]);
    // The stamp — the part the CAS protocol and the employee mirror-staleness
    // check actually read — must be unaffected.
    expect(raw?.revision).toBe(2);
    expect(raw?._writeToken).toBeTruthy();

    const stamp = await readDistributionLogStamp(root, MONTH);
    expect(stamp.revision).toBe(2);
    expect(stamp.writeToken).toBe(raw?._writeToken);

    // …and the events themselves are still all there, from the event store.
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.map((event) => event.xrayImageId).sort()).toEqual(["A1", "A2"]);
  });

  it("keeps a same-millisecond batch in its written order once the projection no longer stores one", async () => {
    // The projection's stored `events` array used to be the ordering base for
    // the merged log, and a bulk distribution stamps ONE shared eventAt across
    // the whole batch — so dropping the body without a stable tie-break would
    // reorder every bulk assignment by random UUID, which is what an employee's
    // queue is displayed in. See sortDistributionEventsForFold.
    const root = makeRoot();
    const sharedEventAt = "2026-05-01T08:00:00.000Z";
    const batch = ["IMG-1", "IMG-2", "IMG-3", "IMG-4", "IMG-5"].map((imageId) =>
      buildAssignEvent({ xrayImageId: imageId, assignedTo: "alice", eventBy: "admin", eventAt: sharedEventAt })
    );
    const appended = await appendDistributionEvents(root, MONTH, batch);
    expect(appended.ok).toBe(true);

    const raw = await readRaw<DistributionLog>(root, LOG_FILE);
    expect(raw?.events).toEqual([]);

    // Read back cold, from the event segments alone.
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.map((event) => event.xrayImageId)).toEqual([
      "IMG-1",
      "IMG-2",
      "IMG-3",
      "IMG-4",
      "IMG-5",
    ]);

    const derived = await loadOrDeriveDistributionCurrent(
      root,
      MONTH,
      batch.map((event) => makeRow(event.xrayImageId)),
      { awaitCachePersist: true }
    );
    expect(derived?.entries.map((entry) => entry.xrayImageId)).toEqual([
      "IMG-1",
      "IMG-2",
      "IMG-3",
      "IMG-4",
      "IMG-5",
    ]);
  });

  it("still reads and folds a LEGACY full-body projection with no immutable event files", async () => {
    const root = makeRoot();
    const dir = await getSampleMainDir(root, MONTH, true);
    const legacyEvent = buildAssignEvent({
      xrayImageId: "A1",
      assignedTo: "alice",
      eventBy: "admin",
      eventAt: "2026-05-01T08:00:00.000Z",
    });
    await safeWriteJson(dir, LOG_FILE, {
      monthFolderName: MONTH,
      revision: 7,
      _writeToken: "legacy-token",
      events: [legacyEvent],
    } satisfies DistributionLog);

    const log = await loadDistributionLog(root, MONTH);
    expect(log.events).toHaveLength(1);

    const derived = await loadOrDeriveDistributionCurrent(root, MONTH, [makeRow("A1")], {
      awaitCachePersist: true,
    });
    expect(derived?.entries.map((entry) => entry.xrayImageId)).toEqual(["A1"]);
  });

  it("never drops a legacy projection event that is not durable in the event store", async () => {
    // Nothing migrates data in place in this codebase, so a workspace old
    // enough to predate `distribution.events/` can hold events ONLY in the
    // projection. Emptying the body there would destroy them.
    const root = makeRoot();
    const dir = await getSampleMainDir(root, MONTH, true);
    const orphanEvent = buildAssignEvent({
      xrayImageId: "OLD",
      assignedTo: "alice",
      eventBy: "admin",
      eventAt: "2026-05-01T08:00:00.000Z",
    });
    await safeWriteJson(dir, LOG_FILE, {
      monthFolderName: MONTH,
      revision: 3,
      events: [orphanEvent],
    } satisfies DistributionLog);

    await assign(root, "NEW", "2026-05-02T08:00:00.000Z");

    const raw = await readRaw<DistributionLog>(root, LOG_FILE);
    // The projection-only event is carried forward verbatim; the newly
    // appended one is durable in the event store and so is NOT copied in.
    expect(raw?.events.map((event) => event.xrayImageId)).toEqual(["OLD"]);
    expect(raw?.revision).toBe(4);

    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.map((event) => event.xrayImageId).sort()).toEqual(["NEW", "OLD"]);

    const derived = await loadOrDeriveDistributionCurrent(root, MONTH, [makeRow("OLD"), makeRow("NEW")], {
      awaitCachePersist: true,
    });
    expect(derived?.entries.map((entry) => entry.xrayImageId).sort()).toEqual(["NEW", "OLD"]);
  });
});
