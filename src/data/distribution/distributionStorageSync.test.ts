import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import {
  appendDistributionEvent,
  loadOrDeriveDistributionCurrent,
  loadOrDeriveDistributionCurrentForRead,
  readDistributionLogStamp,
  refreshDistributionCacheAfterWrite,
  saveDistributionCurrent,
  __clearDeriveMemoForTests,
} from "./distributionStorage";
import { buildAssignEvent, DERIVE_VERSION } from "./distributionLog";
import type { DistributionCurrentData } from "./distributionTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";

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
      liveMeans: { result: null, code: null, employeeId: null }
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1
  };
}

async function makeRoot(trackReads = false) {
  return createMemoryDirectory("root", { trackReads }) as unknown as DirectoryHandleLike;
}

/** Test-only recursive wrapper: counts every createWritable() call reached
 *  through the returned handle, at any depth. Used to prove "zero writes"
 *  claims that plain read-log tracking (memoryDirectory's trackReads) can't
 *  express, since trackReads only instruments getFile(), not writes. */
function withWriteCounter(dir: DirectoryHandleLike, counter: { writes: number }): DirectoryHandleLike {
  return new Proxy(dir, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "getFileHandle") {
        const original = value as (name: string, options?: { create?: boolean }) => Promise<FileHandleLike>;
        return async (name: string, options?: { create?: boolean }) => {
          const handle = await original.call(target, name, options);
          return new Proxy(handle, {
            get(fileTarget, fileProp, fileReceiver) {
              const fileValue = Reflect.get(fileTarget, fileProp, fileReceiver);
              if (fileProp === "createWritable") {
                const originalCreateWritable = fileValue as FileHandleLike["createWritable"];
                return async (...args: unknown[]) => {
                  counter.writes += 1;
                  return (originalCreateWritable as (...a: unknown[]) => unknown).apply(fileTarget, args);
                };
              }
              return fileValue;
            },
          });
        };
      }
      if (prop === "getDirectoryHandle") {
        const original = value as (name: string, options?: { create?: boolean }) => Promise<DirectoryHandleLike>;
        return async (name: string, options?: { create?: boolean }) => {
          const sub = await original.call(target, name, options);
          return withWriteCounter(sub, counter);
        };
      }
      return value;
    },
  });
}

describe("A9 — readDistributionLogStamp is exported and load-bearing", () => {
  it("revision does not change after saveDistributionCurrent, and does change after appendDistributionEvents", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";

    const before = await readDistributionLogStamp(root, month);
    expect(before.revision).toBe(0);

    // A cache-only write must NOT move the stamp -- F4's whole point.
    const emptyCache: DistributionCurrentData = {
      monthFolderName: month,
      logRevision: 0,
      derivedAt: new Date().toISOString(),
      totalAssigned: 0,
      totalCompleted: 0,
      totalReplaced: 0,
      totalPending: 0,
      entries: [],
    };
    await saveDistributionCurrent(root, month, emptyCache);
    const afterCacheWrite = await readDistributionLogStamp(root, month);
    expect(afterCacheWrite.revision).toBe(0);

    // A real event append DOES move the stamp.
    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" })
    );
    const afterAppend = await readDistributionLogStamp(root, month);
    expect(afterAppend.revision).toBe(1);
  });
});

describe("A6a — reads never write", () => {
  it("loadOrDeriveDistributionCurrentForRead on a month with a valid checkpoint performs zero writes", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const rows = [makeRow("A1")];

    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" })
    );
    // Warm the on-disk cache/checkpoint via a persisting call (write path shape).
    const warm = await loadOrDeriveDistributionCurrent(root, month, rows);
    expect(warm?.foldCheckpoint).toBeDefined();
    // Allow the fire-and-forget cache write above to settle before measuring.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const counter = { writes: 0 };
    const tracked = withWriteCounter(root, counter);
    const read = await loadOrDeriveDistributionCurrentForRead(tracked, month, rows);

    expect(read?.entries).toHaveLength(1);
    expect(counter.writes).toBe(0);
  });

  it("two consecutive ForRead calls with deriveVersion forced stale perform zero event-segment reads on the second call (A6c memo, not the disk cache)", async () => {
    __clearDeriveMemoForTests();
    const root = createMemoryDirectory("root", { trackReads: true }) as unknown as DirectoryHandleLike;
    const month = "5-May-2026";
    const rows = [makeRow("A1")];

    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" })
    );

    // Force the on-disk cache to look pre-DERIVE_VERSION so it's unusable on
    // every call (canResume stays false), which is what makes the memo the
    // only thing standing between this and a full log re-read every time.
    const staleCache: DistributionCurrentData = {
      monthFolderName: month,
      logRevision: 1,
      derivedAt: new Date().toISOString(),
      totalAssigned: 0,
      totalCompleted: 0,
      totalReplaced: 0,
      totalPending: 0,
      entries: [],
      // deliberately no deriveVersion / foldCheckpoint -> canResume is false.
    };
    await saveDistributionCurrent(root, month, staleCache);

    const first = await loadOrDeriveDistributionCurrentForRead(root, month, rows);
    expect(first?.deriveVersion).toBe(DERIVE_VERSION);

    const before = getReadLog(root).length;
    const second = await loadOrDeriveDistributionCurrentForRead(root, month, rows);
    const newReads = getReadLog(root).slice(before);
    const eventDirectoryReads = newReads.filter((path) => path.includes("distribution.events/"));

    expect(second).toEqual(first);
    expect(eventDirectoryReads).toHaveLength(0);
  });
});

describe("A6d/H3 — entry gate on empty sampleRows", () => {
  beforeEach(() => {
    __clearDeriveMemoForTests();
  });

  it("returns null, performs zero writes, and leaves the checkpoint's knownEventIds/segmentOffsets on disk unchanged when events exist but sampleRows is empty", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const rows = [makeRow("A1"), makeRow("A2")];

    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" })
    );
    // Warm a real checkpoint first (write path).
    const warm = await loadOrDeriveDistributionCurrent(root, month, rows);
    expect(warm?.foldCheckpoint?.knownEventIds).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dir = await getSampleMainDir(root, month, true);
    const readText = async (name: string) => (await (await dir.getFileHandle(name)).getFile()).text();
    const beforeText = await readText("distribution.current.json");
    // v85: the checkpoint (knownEventIds/segmentOffsets) lives in its own
    // sidecar now, so the gate has to be proven against THAT file as well —
    // the cache alone no longer contains the state this test is about.
    const beforeCheckpoint = await readText("distribution.checkpoint.json");

    const counter = { writes: 0 };
    const tracked = withWriteCounter(root, counter);
    const result = await loadOrDeriveDistributionCurrent(tracked, month, []);

    expect(result).toBeNull();
    expect(counter.writes).toBe(0);

    // Both on-disk files must be byte-identical -- nothing advanced past the gate.
    expect(await readText("distribution.current.json")).toBe(beforeText);
    expect(await readText("distribution.checkpoint.json")).toBe(beforeCheckpoint);
  });

  it("sampleRows: [] on a month with NO events (revision 0) still returns normally, not an error state", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";

    const result = await loadOrDeriveDistributionCurrent(root, month, []);

    // No events at all -> the pre-existing "empty log" contract (null, no
    // gate gate/log noise) applies; a fresh month must not be treated as the
    // no-sample-rows failure case.
    expect(result).toBeNull();
  });
});

describe("A6b — refreshDistributionCacheAfterWrite (write-path helper)", () => {
  it("persists a fresh cache derivation that a subsequent read-only call observes", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const rows = [makeRow("A1")];

    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" })
    );

    await refreshDistributionCacheAfterWrite(root, month, rows);
    // Give the internal fire-and-forget saveDistributionCurrent a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dir = await getSampleMainDir(root, month, true);
    const raw = await (await dir.getFileHandle("distribution.current.json")).getFile();
    const text = await raw.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("A1");
  });

  it("swallows a rejection (e.g. a closed month) rather than throwing", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    // No sample.master / distribution dir set up at all is fine -- the point
    // is that a failure inside the derive/save chain must not propagate.
    await expect(refreshDistributionCacheAfterWrite(root, month, [])).resolves.toBeUndefined();
  });
});
