// What happens when ONE month holds both immutable event layouts at once.
//
// Until the durable-append path gained its per-event fallback, a workspace was
// effectively pure: either every event sat in a `{eventId}.json` file (the old
// layout) or every event sat in an NDJSON segment (the current one). The
// fallback made a MIX reachable inside a single save — chunks 1..k land in a
// segment, then a chunk fails and every remaining chunk degrades to per-event
// files — and the fold has no timestamp to separate them, because a bulk
// distribution stamps ONE `eventAt` across the whole batch.
//
// So the tie order between the two layouts became load-bearing, and it was
// wrong: per-event files were concatenated FIRST, putting the fallback half of
// a batch ahead of the segment half it actually followed. This file pins the
// order for all three shapes (pure segment, pure legacy, mixed) so the two pure
// ones — which are deterministic-by-contract fold inputs — are provably
// untouched by the mixed-layout repair.
//
// It also covers the two other reachable-but-untested paths the same fallback
// opened: a duplicate event id straddling a fold checkpoint (retries and the
// fallback can each write an event twice), and the real `reopenDir` closure
// `distributionStorage` hands to the durable append.
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import { getRecentErrors, clearErrors } from "../storage/errorLogger";
import { listDirectoryEntries } from "../storage/directoryScan";
import { safeReadJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  __clearWorkspaceDirCacheForTests,
  getSampleMainDir,
} from "../workspace/workspacePaths";
import { __clearInFlightForTests } from "../storage/inFlightReads";
import { buildAssignEvent } from "./distributionLog";
import type { DistributionEvent, DistributionFoldCheckpoint } from "./distributionTypes";
import {
  DISTRIBUTION_EVENTS_DIR,
  __resetWrittenSegmentsForTests,
  appendDistributionEventSegment,
  appendDistributionEventsDurably,
  writeImmutableDistributionEvent,
} from "./distributionEventStore";
import {
  DISTRIBUTION_CHECKPOINT_FILE,
  __clearDeriveMemoForTests,
  appendDistributionEvents,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
} from "./distributionStorage";

const MONTH = "5-May-2026";
/** One shared timestamp, exactly as a bulk distribution stamps its whole batch. */
const BATCH_AT = "2026-05-01T08:00:00.000Z";

const DEVICE_UUID = "3c26ccb7-0eeb-4173-a880-0bdd31c80324";
const SESSION_UUID = "70dbde0f-3fc7-48a6-97d3-ac3d1248ec0b";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

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

/** An assign event with a caller-chosen id, so file-name order is predictable. */
function event(eventId: string, xrayImageId: string): DistributionEvent {
  return {
    ...buildAssignEvent({
      xrayImageId,
      assignedTo: "alice",
      eventBy: "admin",
      eventAt: BATCH_AT,
    }),
    eventId,
  };
}

async function foldOrder(root: DirectoryHandleLike): Promise<string[]> {
  const log = await loadDistributionLog(root, MONTH);
  return log.events.map((entry) => entry.eventId);
}

async function eventFileNames(root: DirectoryHandleLike): Promise<string[]> {
  const dir = await getSampleMainDir(root, MONTH, true);
  const eventsDir = await dir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  return (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

beforeEach(() => {
  __clearDeriveMemoForTests();
  __resetWrittenSegmentsForTests();
  __clearWorkspaceDirCacheForTests();
  __clearInFlightForTests();
  clearErrors();
});

describe("fold order within one shared eventAt, per storage layout", () => {
  it("PURE SEGMENTS: keeps append order (unchanged contract)", async () => {
    const root = makeRoot();
    const dir = await getSampleMainDir(root, MONTH, true);
    const batch = [event("s-3", "IMG-A"), event("s-1", "IMG-B"), event("s-2", "IMG-C")];

    await appendDistributionEventSegment(dir, batch, {
      deviceId: DEVICE_UUID,
      sessionId: SESSION_UUID,
    });

    // Append order, NOT id order — the ids are deliberately out of alphabetical
    // sequence so a regression to an id tie-break would be visible here.
    await expect(foldOrder(root)).resolves.toEqual(["s-3", "s-1", "s-2"]);
  });

  it("PURE LEGACY per-event files: keeps file-NAME order (unchanged contract)", async () => {
    const root = makeRoot();
    const dir = await getSampleMainDir(root, MONTH, true);

    // Written out of name order on purpose: per-event files carry no sequence,
    // so every reader discovers them by name and that IS the contract. This is
    // the pin the mixed-layout repair had to leave byte-identical.
    for (const id of ["l-3", "l-1", "l-2"]) {
      await writeImmutableDistributionEvent(dir, event(id, `IMG-${id}`));
    }

    await expect(foldOrder(root)).resolves.toEqual(["l-1", "l-2", "l-3"]);
  });

  it("MIXED: the segment half of a batch folds BEFORE the per-event fallback half", async () => {
    const root = makeRoot();
    const dir = await getSampleMainDir(root, MONTH, true);

    // The disk state a mid-batch degradation leaves behind: the earlier chunks
    // in a segment, the later ones as per-event files.
    await appendDistributionEventSegment(dir, [event("s-9", "IMG-1"), event("s-8", "IMG-2")], {
      deviceId: DEVICE_UUID,
      sessionId: SESSION_UUID,
    });
    for (const id of ["l-2", "l-1"]) {
      await writeImmutableDistributionEvent(dir, event(id, `IMG-${id}`));
    }

    // Before the fix this was ["l-1", "l-2", "s-9", "s-8"]: the fallback tail of
    // the batch jumped in front of the chunks it followed, and an employee's
    // queue was ordered accordingly.
    await expect(foldOrder(root)).resolves.toEqual(["s-9", "s-8", "l-1", "l-2"]);
  });

  it("MIXED, produced by the real degrading append path", async () => {
    // Proves the mixed shape is reachable rather than hypothetical: one save
    // lands in a segment, then `.ndjson` becomes unwritable and the next save
    // degrades to per-event files while the segment stays on disk and stays
    // part of the log.
    const root = makeRoot();
    const dir = await getSampleMainDir(root, MONTH, true);
    const writer = { deviceId: DEVICE_UUID, sessionId: SESSION_UUID };

    await appendDistributionEventsDurably(dir, [event("s-1", "IMG-1")], { writer });

    // Same tree, but every `.ndjson` write now fails the way a scanner-stripped
    // extension does. No `reopenDir`: one retry ladder is enough to degrade.
    setSimulatedFaults(root, [
      {
        operation: "createWritable",
        nameSuffix: ".ndjson",
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await expect(
      appendDistributionEventsDurably(dir, [event("l-1", "IMG-2")], { writer })
    ).resolves.toBe("verified");

    setSimulatedFaults(root, []);

    const names = await eventFileNames(root);
    expect(names.some((name) => name.endsWith(".ndjson"))).toBe(true);
    expect(names).toContain("l-1.json");

    // ...and the segment half still folds first.
    await expect(foldOrder(root)).resolves.toEqual(["s-1", "l-1"]);
  }, 60_000);
});

describe("a duplicate event id straddling a fold checkpoint", () => {
  async function seedCheckpoint(root: DirectoryHandleLike): Promise<DistributionEvent[]> {
    const batch = [event("dup-1", "IMG-1"), event("keep-2", "IMG-2")];
    const appended = await appendDistributionEvents(root, MONTH, batch);
    expect(appended.ok).toBe(true);

    const derived = await loadOrDeriveDistributionCurrent(
      root,
      MONTH,
      batch.map((entry) => makeRow(entry.xrayImageId)),
      { awaitCachePersist: true }
    );
    // The checkpoint that now exists on disk has folded both ids exactly once.
    expect(derived?.foldCheckpoint?.quotaFacts.assignmentCounts).toEqual({ alice: 2 });
    return batch;
  }

  async function readCheckpoint(
    root: DirectoryHandleLike
  ): Promise<DistributionFoldCheckpoint | null> {
    const dir = await getSampleMainDir(root, MONTH, true);
    const result = await safeReadJson<DistributionFoldCheckpoint>(
      dir,
      DISTRIBUTION_CHECKPOINT_FILE
    );
    return result.ok ? result.value : null;
  }

  it("is not re-folded when the second copy arrives as a per-event file", async () => {
    // The exact shape the fallback produces: an event already durable in a
    // segment is written AGAIN as `{eventId}.json`. The name is new, so the
    // checkpoint's name-diff offers it as brand-new work.
    const root = makeRoot();
    const batch = await seedCheckpoint(root);
    const dir = await getSampleMainDir(root, MONTH, true);
    await writeImmutableDistributionEvent(dir, batch[0]!);

    __clearDeriveMemoForTests();
    const resumed = await loadOrDeriveDistributionCurrent(
      root,
      MONTH,
      batch.map((entry) => makeRow(entry.xrayImageId)),
      { awaitCachePersist: true }
    );

    expect(resumed?.entries).toHaveLength(2);
    expect(resumed?.totalAssigned).toBe(2);
    // The load-bearing assertion. `findLateEvent` cannot catch a duplicate — it
    // has the same eventAt AND the same eventId as the entry it produced, so it
    // reads as "not late" — which left `knownEventIds` as the only defence, and
    // the segment/legacy sources were never checked against it. A second fold
    // of the same `assigned` event shows up here as alice: 3.
    const checkpoint = await readCheckpoint(root);
    expect(checkpoint?.quotaFacts.assignmentCounts).toEqual({ alice: 2 });
  });

  it("is not re-folded when the second copy arrives as new segment bytes", async () => {
    // The reopen-retry shape: the same chunk is appended to the writer's own
    // segment twice, so the duplicate line sits past the checkpoint's byte
    // offset and reads back as a delta.
    const root = makeRoot();
    const batch = await seedCheckpoint(root);
    const dir = await getSampleMainDir(root, MONTH, true);
    await appendDistributionEventsDurably(dir, [batch[0]!]);

    __clearDeriveMemoForTests();
    const resumed = await loadOrDeriveDistributionCurrent(
      root,
      MONTH,
      batch.map((entry) => makeRow(entry.xrayImageId)),
      { awaitCachePersist: true }
    );

    expect(resumed?.entries).toHaveLength(2);
    const checkpoint = await readCheckpoint(root);
    expect(checkpoint?.quotaFacts.assignmentCounts).toEqual({ alice: 2 });
  });
});

describe("the production reopenDir closure", () => {
  it("recovers a stale CHILD handle by re-resolving it from the root", async () => {
    // #70's own tests passed `reopenDir: async () => root` — the same handle —
    // which proves a second attempt happens and nothing about re-resolution
    // helping. This drives the REAL closure in `writeDistributionEventBatch`:
    // the cached `1-main` handle is poisoned, and only a handle re-resolved
    // after `invalidateWorkspaceDirCache` can complete the append.
    const root = makeRoot();
    const stale = await getSampleMainDir(root, MONTH, true);
    let staleHits = 0;
    // Poison THIS handle instance only. `getSampleMainDir` answers from the
    // workspace directory cache, so this is the object the append gets — until
    // the cache is purged and the tree hands out a fresh one.
    const realGetDirectoryHandle = stale.getDirectoryHandle.bind(stale);
    stale.getDirectoryHandle = async (
      name: string,
      options?: { create?: boolean }
    ): Promise<DirectoryHandleLike> => {
      if (name === DISTRIBUTION_EVENTS_DIR) {
        staleHits += 1;
        const error = new Error("directory handle no longer resolves");
        error.name = "NotFoundError";
        throw error;
      }
      return realGetDirectoryHandle(name, options);
    };

    const appended = await appendDistributionEvents(root, MONTH, [event("s-1", "IMG-1")]);

    expect(appended.ok).toBe(true);
    expect(staleHits).toBeGreaterThan(0);

    // Recovered through the SEGMENT path, not by degrading: a `.ndjson` file
    // means the re-resolved child handle worked. XQ-DIST-009 (the per-event
    // fallback) would mean it did not.
    const names = await eventFileNames(root);
    expect(names.some((name) => name.endsWith(".ndjson"))).toBe(true);
    expect(names.some((name) => name.endsWith(".json"))).toBe(false);
    const codes = getRecentErrors().map((entry) => entry.context);
    expect(codes.some((context) => context.includes("XQ-DIST-007"))).toBe(true);
    expect(codes.some((context) => context.includes("XQ-DIST-009"))).toBe(false);
    await expect(foldOrder(root)).resolves.toEqual(["s-1"]);
  });
});
