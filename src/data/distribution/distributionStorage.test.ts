import { describe, it, expect } from "vitest";
import { createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import {
  DISTRIBUTION_CHECKPOINT_FILE,
  __clearDeriveMemoForTests,
  appendDistributionEvent,
  appendDistributionEvents,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
  loadOrDeriveDistributionCurrentForRead,
  saveDistributionCurrent,
} from "./distributionStorage";
import {
  DERIVE_VERSION,
  buildAssignEvent,
  buildCompletedEvent,
  buildReassignEvent,
  deriveCurrentDistribution,
  sampleRowsFingerprint,
} from "./distributionLog";
import {
  appendDistributionEventSegment,
  distributionEventSetId,
  loadImmutableDistributionEvents,
  writeImmutableDistributionEvent,
} from "./distributionEventStore";
import type { DistributionCurrentData } from "./distributionTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";

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

async function makeRoot() {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

describe("distributionStorage", () => {
  it("starts with an empty log", async () => {
    const root = await makeRoot();
    const log = await loadDistributionLog(root, "5-May-2026");
    expect(log.events).toHaveLength(0);
  });

  it("appends a single event and reads it back", async () => {
    const root = await makeRoot();
    const evt = buildAssignEvent({
      xrayImageId: "img-001",
      assignedTo: "alice",
      eventBy: "admin",
    });
    await appendDistributionEvent(root, "5-May-2026", evt);
    const log = await loadDistributionLog(root, "5-May-2026");
    expect(log.events).toHaveLength(1);
    expect(log.events[0].xrayImageId).toBe("img-001");
  });

  it("appends multiple events sequentially", async () => {
    const root = await makeRoot();
    const evts = ["img-001", "img-002", "img-003"].map((id) =>
      buildAssignEvent({ xrayImageId: id, assignedTo: "alice", eventBy: "admin" })
    );
    for (const evt of evts) {
      await appendDistributionEvent(root, "5-May-2026", evt);
    }
    const log = await loadDistributionLog(root, "5-May-2026");
    expect(log.events).toHaveLength(3);
  });

  it("reports durable progress while appending a bulk event batch", async () => {
    const root = await makeRoot();
    const events = Array.from({ length: 9 }, (_, index) =>
      buildAssignEvent({
        xrayImageId: `bulk-${index}`,
        assignedTo: "alice",
        eventBy: "admin",
      })
    );
    const progress: Array<{ phase: string; completed: number; total: number }> = [];

    const result = await appendDistributionEvents(root, "5-May-2026", events, {
      onProgress: (update) => progress.push(update),
    });

    expect(result.ok).toBe(true);
    // The whole batch is durably written in ONE segment-file append (the
    // perf fix this task implements — see distributionEventStore.ts's
    // appendDistributionEventSegment), not one write per event, so progress
    // for the "events" phase is necessarily just a before/after pair rather
    // than one update per event. Fine-grained per-event progress is
    // structurally incompatible with writing the whole batch in a single
    // call — that's the whole point of the change.
    expect(progress.filter((update) => update.phase === "events").map((update) => update.completed))
      .toEqual([0, 9]);
    expect(progress.at(-1)).toEqual({ phase: "complete", completed: 9, total: 9 });
  });

  it("retains concurrent appends as distinct immutable events", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const first = buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" });
    const second = buildAssignEvent({ xrayImageId: "A2", assignedTo: "bob", eventBy: "admin" });

    const results = await Promise.all([
      appendDistributionEvent(root, month, first),
      appendDistributionEvent(root, month, second),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    const log = await loadDistributionLog(root, month);
    expect(log.events.map((event) => event.eventId).sort()).toEqual([first.eventId, second.eventId].sort());
    expect(log.eventSetId).toMatch(/^d1:2:/);
  });

  it("returns a log whose eventSetId reflects the just-appended events, not the pre-append state (finding 3)", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const first = buildAssignEvent({ xrayImageId: "img-200", assignedTo: "alice", eventBy: "admin" });

    const firstResult = await appendDistributionEvent(root, month, first);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;
    // Freshly appended into a log that started empty -- must NOT still read
    // as the pre-append (empty) eventSetId.
    expect(firstResult.log.eventSetId).toBe(distributionEventSetId(firstResult.log.events));
    // v85 digest shape: `d1:{count}:{xor}:{sum}`.
    expect(firstResult.log.eventSetId).toMatch(/^d1:1:/);

    const second = buildAssignEvent({ xrayImageId: "img-201", assignedTo: "bob", eventBy: "admin" });
    const secondResult = await appendDistributionEvent(root, month, second);
    expect(secondResult.ok).toBe(true);
    if (!secondResult.ok) return;
    // Must reflect BOTH events, not just the pre-append single-event state.
    expect(secondResult.log.eventSetId).toBe(distributionEventSetId(secondResult.log.events));
    expect(secondResult.log.eventSetId).toMatch(/^d1:2:/);
  });

  it("ignores a cached snapshot without deriveVersion and re-derives", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const evt = buildAssignEvent({
      xrayImageId: "A1",
      assignedTo: "alice",
      eventBy: "admin",
    });
    await appendDistributionEvent(root, month, evt);
    const log = await loadDistributionLog(root, month);

    // Simulate a cache written by pre-DERIVE_VERSION code: matching
    // logRevision, valid quotas (so only the version check can reject it),
    // no deriveVersion, and deliberately absurd totals.
    const staleCache: DistributionCurrentData = {
      monthFolderName: month,
      logRevision: log.revision,
      derivedAt: new Date().toISOString(),
      totalAssigned: 999,
      totalCompleted: 0,
      totalReplaced: 0,
      totalPending: 999,
      entries: [],
      quotas: {
        alice: {
          username: "alice",
          sampleCount: 1,
          dailyQuota: 1,
          daysRemainingAtAssignment: 1,
          assignedAt: evt.eventAt,
        },
      },
    };
    await saveDistributionCurrent(root, month, staleCache);

    const result = await loadOrDeriveDistributionCurrent(root, month, [makeRow("A1")]);

    // The stale cache must be bypassed in favor of a fresh derivation.
    expect(result?.deriveVersion).toBe(DERIVE_VERSION);
    expect(result?.totalAssigned).toBe(1);
    expect(result?.entries).toHaveLength(1);
    expect(result?.entries[0]?.xrayImageId).toBe("A1");
  });

  it("verifies a CAS write with a lightweight log-only read, not a full event-directory listing (§U)", async () => {
    const root = createMemoryDirectory("root", { trackReads: true }) as unknown as DirectoryHandleLike;
    const month = "5-May-2026";
    for (let i = 0; i < 5; i++) {
      await appendDistributionEvent(
        root,
        month,
        buildAssignEvent({ xrayImageId: `seed-${i}`, assignedTo: "alice", eventBy: "admin" })
      );
    }

    const before = getReadLog(root).length;
    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "final", assignedTo: "bob", eventBy: "admin" })
    );
    const newEntries = getReadLog(root).slice(before);

    // "distribution.events" is the immutable-event directory. Before this
    // task, the CAS loop's two verify reads each fully re-listed and
    // re-read every event file in it. After this task, verifying only reads
    // the compatibility log file (distribution.log.json) -- the event
    // directory itself should not appear in this append's read log at all,
    // since only the one legitimate "existing state" read (not exercised by
    // the verify steps) needs it.
    const eventDirectoryReads = newEntries.filter((path) => path.includes("distribution.events/"));
    expect(eventDirectoryReads.length).toBeLessThanOrEqual(
      // the one legitimate pre-write "existing state" read may still list
      // every seeded event file once
      6
    );
  });

  it("readDistributionLogStamp agrees with loadDistributionLog's revision/writeToken across fixtures", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";

    // Empty log.
    let full = await loadDistributionLog(root, month);
    expect(full.revision).toBe(0);

    // After one append.
    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "img-001", assignedTo: "alice", eventBy: "admin" })
    );
    full = await loadDistributionLog(root, month);
    expect(full.revision).toBe(1);

    // After a second append (revision must advance further, and the CAS
    // loop's own verify step -- which now uses the stamp reader -- must
    // still agree, or appendDistributionEvent itself would report failure).
    const second = await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "img-002", assignedTo: "bob", eventBy: "admin" })
    );
    expect(second.ok).toBe(true);
    full = await loadDistributionLog(root, month);
    expect(full.revision).toBe(2);
  });

  it("returns the up-to-date log on success, so callers don't need a fresh read (§U step 2)", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const result = await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "img-001", assignedTo: "alice", eventBy: "admin" })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const freshRead = await loadDistributionLog(root, month);
    expect(result.log.events).toEqual(freshRead.events);
    expect(result.log.revision).toBe(freshRead.revision);
  });

  it("deriving against an empty row set drops every event (Tier-1 Item H regression)", async () => {
    // Documents the data-layer behavior behind the refreshDistribution guard
    // in Population/index.tsx: deriveCurrentDistribution drops events whose
    // xrayImageId is not in the provided sample rows, so deriving with []
    // yields a ZEROED snapshot. Persisting that snapshot would wipe the
    // visible distribution state — the UI guard falls back to the on-disk
    // sample master and refuses to persist when no rows can be found.
    const root = await makeRoot();
    const month = "5-May-2026";
    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" })
    );
    const log = await loadDistributionLog(root, month);
    expect(log.events).toHaveLength(1);

    const zeroed = deriveCurrentDistribution(log, []);
    expect(zeroed.entries).toHaveLength(0);
    expect(zeroed.totalAssigned).toBe(0);
  });
});

describe("readCurrentDistributionSource via incremental cache (Task: §H Layer 2)", () => {
  it("produces the same merged, sorted event list on a warm cache as a cold read", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const dir = await getSampleMainDir(root, month, true);
    const e1 = { ...buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" }), eventAt: "2026-05-01T09:00:00.000Z" };
    const e2 = { ...buildAssignEvent({ xrayImageId: "A2", assignedTo: "bob", eventBy: "admin" }), eventAt: "2026-05-01T10:00:00.000Z" };
    await writeImmutableDistributionEvent(dir, e1);
    await writeImmutableDistributionEvent(dir, e2);

    const cold = await loadDistributionLog(root, month);
    // Second call is a warm-cache hit for e1/e2 -- add a third event first so
    // this call also exercises the "only new files read" incremental path.
    const e3 = { ...buildAssignEvent({ xrayImageId: "A3", assignedTo: "carol", eventBy: "admin" }), eventAt: "2026-05-01T08:00:00.000Z" }; // earlier than e1/e2
    await writeImmutableDistributionEvent(dir, e3);
    const warm = await loadDistributionLog(root, month);

    expect(warm.events.map((e) => e.eventId)).toEqual(
      [e3, e1, e2].map((e) => e.eventId) // sorted by eventAt: e3 (08:00) < e1 (09:00) < e2 (10:00)
    );
    expect(cold.events.map((e) => e.eventId).sort()).toEqual([e1.eventId, e2.eventId].sort());
  });
});

describe("loadOrDeriveDistributionCurrentForRead dedupe key (final-review Fix 3)", () => {
  it("two concurrent calls with different-length sampleRows for the same (root, month, epoch) do not share a result", async () => {
    // Regression for the final whole-branch review's Fix 3: the dedupe key used
    // to omit sampleRows entirely, so two overlapping ForRead callers racing on
    // the same (root, month, epoch) but with different sampleRows (e.g. one
    // caller's sample-master read transiently returned a narrower row set)
    // would collapse onto a single dedupeInFlight() promise -- the loser
    // silently receiving a result derived from the WINNER's sampleRows instead
    // of its own. Uses [A1] vs [A1, A2] rather than [] vs [A1] because an EMPTY
    // sampleRows set against a month that already has events now hits A6d's
    // entry gate (H3) and returns null by design -- a different, deliberate
    // behavior this suite covers separately; this test's own concern (row-
    // shape isolation between concurrent callers) doesn't need the empty case.
    const root = await makeRoot();
    const month = "5-May-2026";
    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" })
    );

    // Kicked off together (no await in between) so both hit dedupeInFlight
    // while the first call's read is still in flight -- exactly the race this
    // key is meant to guard against.
    const [withOneRow, withTwoRows] = await Promise.all([
      loadOrDeriveDistributionCurrentForRead(root, month, [makeRow("A1")]),
      loadOrDeriveDistributionCurrentForRead(root, month, [makeRow("A1"), makeRow("A2")]),
    ]);

    // Both callers see the same event (A1 assigned), regardless of which
    // extra, event-less row the other happened to carry -- proving the
    // wider key kept the two derivations from bleeding into each other.
    expect(withOneRow?.entries).toHaveLength(1);
    expect(withOneRow?.entries[0]?.xrayImageId).toBe("A1");
    expect(withOneRow?.totalAssigned).toBe(1);

    expect(withTwoRows?.entries).toHaveLength(1);
    expect(withTwoRows?.entries[0]?.xrayImageId).toBe("A1");
    expect(withTwoRows?.totalAssigned).toBe(1);
  });

  it("two concurrent calls with the SAME-length sampleRows still coalesce into one derivation (dedupe still works)", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    await appendDistributionEvent(
      root,
      month,
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" })
    );

    const [first, second] = await Promise.all([
      loadOrDeriveDistributionCurrentForRead(root, month, [makeRow("A1")]),
      loadOrDeriveDistributionCurrentForRead(root, month, [makeRow("A1")]),
    ]);

    // Same key (same length) -> same coalesced promise/result, per the whole
    // point of dedupeInFlight -- this fix only widens the key by row COUNT, it
    // must not defeat coalescing for the common same-shape-race case.
    expect(first).toBe(second);
    expect(first?.entries).toHaveLength(1);
  });
});

describe("segment-based event writes (perf: replaces one-file-per-event durability)", () => {
  it("writes a whole batch in a single segment file, not one file per event", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const events = Array.from({ length: 12 }, (_, i) =>
      buildAssignEvent({ xrayImageId: `img-${i}`, assignedTo: "alice", eventBy: "admin" })
    );

    const result = await appendDistributionEvents(root, month, events);
    expect(result.ok).toBe(true);

    const dir = await getSampleMainDir(root, month, true);
    const eventsDir = await dir.getDirectoryHandle("distribution.events", { create: false });
    const names: string[] = [];
    for await (const entry of (eventsDir as unknown as { values: () => AsyncIterable<{ name: string; kind: string }> }).values()) {
      names.push(entry.name);
    }
    const segmentFiles = names.filter((n) => n.endsWith(".ndjson"));
    const legacyFiles = names.filter((n) => n.endsWith(".json"));

    // The whole 12-event batch landed in ONE segment file, not 12 separate
    // per-event files -- this is the actual perf win under test.
    expect(segmentFiles).toHaveLength(1);
    expect(legacyFiles).toHaveLength(0);

    const log = await loadDistributionLog(root, month);
    expect(log.events).toHaveLength(12);
    expect(log.events.map((e) => e.xrayImageId).sort()).toEqual(events.map((e) => e.xrayImageId).sort());
  });

  it("still reads and merges legacy one-file-per-event immutable events alongside new segment writes", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const dir = await getSampleMainDir(root, month, true);

    const legacyEvent = buildAssignEvent({ xrayImageId: "legacy-1", assignedTo: "alice", eventBy: "admin" });
    await writeImmutableDistributionEvent(dir, legacyEvent);

    const segmentEvent = buildAssignEvent({ xrayImageId: "segment-1", assignedTo: "bob", eventBy: "admin" });
    await appendDistributionEventSegment(dir, [segmentEvent], { deviceId: "device-x", sessionId: "session-y" });

    const log = await loadDistributionLog(root, month);
    expect(log.events.map((e) => e.xrayImageId).sort()).toEqual(["legacy-1", "segment-1"]);

    // The legacy per-event file itself is untouched -- never rewritten or
    // deleted, since another machine on an older build may still read it.
    const legacyEvents = await loadImmutableDistributionEvents(dir);
    expect(legacyEvents).toEqual([legacyEvent]);
  });
});

describe("fold-checkpoint persistence (perf: O(new events) instead of O(all events) on a fresh load)", () => {
  it("a second load after new events only reads the new bytes, not every historical segment byte", async () => {
    const root = createMemoryDirectory("root", { trackReads: true }) as unknown as DirectoryHandleLike;
    const month = "5-May-2026";
    const rows: PreparedPopulationRow[] = Array.from({ length: 20 }, (_, i) => makeRow(`img-${i}`));

    for (let i = 0; i < 15; i++) {
      await appendDistributionEvent(
        root,
        month,
        buildAssignEvent({ xrayImageId: `img-${i}`, assignedTo: "alice", eventBy: "admin" })
      );
    }

    const first = await loadOrDeriveDistributionCurrent(root, month, rows);
    expect(first?.foldCheckpoint).toBeDefined();
    expect(first?.entries).toHaveLength(15);

    for (let i = 15; i < 20; i++) {
      await appendDistributionEvent(
        root,
        month,
        buildAssignEvent({ xrayImageId: `img-${i}`, assignedTo: "bob", eventBy: "admin" })
      );
    }

    const before = getReadLog(root).length;
    const second = await loadOrDeriveDistributionCurrent(root, month, rows);
    const newReads = getReadLog(root).slice(before);
    const eventDirectoryReads = newReads.filter((path) => path.includes("distribution.events/"));

    expect(second?.entries).toHaveLength(20);
    // Bounded by the small number of writer segments touched, not by the
    // (now 20) total historical events -- this is the actual perf claim
    // under test: a fresh derive after new events reads the NEW bytes, not
    // everything ever written.
    expect(eventDirectoryReads.length).toBeLessThanOrEqual(4);
  });

  it("an out-of-order event arriving after the checkpoint forces a full refold that still matches a from-scratch derivation", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const rows = [makeRow("A1"), makeRow("A2")];

    await appendDistributionEvent(
      root,
      month,
      { ...buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" }), eventAt: "2026-05-01T10:00:00.000Z" }
    );
    await appendDistributionEvent(
      root,
      month,
      { ...buildCompletedEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "alice" }), eventAt: "2026-05-01T11:00:00.000Z" }
    );

    const first = await loadOrDeriveDistributionCurrent(root, month, rows);
    expect(first?.entries.find((e) => e.xrayImageId === "A1")?.status).toBe("completed");

    // A straggling event from another machine surfaces with an eventAt
    // EARLIER than what the checkpoint already folded for A1 -- exactly the
    // scenario findLateEvent exists to catch on a shared network-share
    // workspace with several machines.
    const dir = await getSampleMainDir(root, month, true);
    const lateEvent = {
      ...buildAssignEvent({ xrayImageId: "A2", assignedTo: "carol", eventBy: "admin" }),
      eventAt: "2026-05-01T09:00:00.000Z",
    };
    await writeImmutableDistributionEvent(dir, lateEvent);
    // Backdate A1's own next event too, forcing the late-detection specifically
    // against an image the checkpoint already has an entry for.
    const straggler = {
      ...buildAssignEvent({ xrayImageId: "A1", assignedTo: "dave", eventBy: "admin" }),
      eventAt: "2026-05-01T05:00:00.000Z",
    };
    await writeImmutableDistributionEvent(dir, straggler);

    const second = await loadOrDeriveDistributionCurrent(root, month, rows);

    // The from-scratch fold of the FULL event set is the ground truth this
    // must match -- straggler (05:00, assign) predates A1's completion
    // (11:00), so it must NOT resurrect A1 to pending; it's still dropped by
    // the same terminal-state guard the golden-master test above exercises,
    // just reached via a forced full refold instead of a resumed one.
    const log = await loadDistributionLog(root, month);
    const groundTruth = deriveCurrentDistribution(log, rows);
    // Compare only the fold OUTCOME (entries/quotas/totals), not
    // volatile/storage-layer-only fields (derivedAt, foldCheckpoint,
    // eventSetId, logRevision) that legitimately differ between a bare
    // deriveCurrentDistribution call and loadOrDeriveDistributionCurrent's
    // stamped result.
    expect(second?.entries).toEqual(groundTruth.entries);
    expect(second?.quotas).toEqual(groundTruth.quotas);
    expect(second?.totalAssigned).toBe(groundTruth.totalAssigned);
    expect(second?.totalCompleted).toBe(groundTruth.totalCompleted);
    expect(second?.totalReplaced).toBe(groundTruth.totalReplaced);
    expect(second?.totalPending).toBe(groundTruth.totalPending);
    expect(second?.entries.find((e) => e.xrayImageId === "A1")?.status).toBe("completed");
  });

  it("cannot survive a DERIVE_VERSION bump: a v2-stamped cache AND its checkpoint both refold", async () => {
    // Guards the v3 bump (P2 quota-from-entries + P5 unknown-event drop). Both
    // change persisted derived output, so no v2 artifact may be reused: not the
    // cache, and not the checkpoint sidecar that would let the fast path patch
    // a v2 result forward forever without ever revisiting it.
    const root = await makeRoot();
    const month = "5-May-2026";
    const rows = [makeRow("A1"), makeRow("B2"), makeRow("C3")];
    __clearDeriveMemoForTests();
    await appendDistributionEvents(root, month, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "B2", assignedTo: "alice", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "C3", assignedTo: "bob", eventBy: "admin" }),
      buildReassignEvent({
        xrayImageId: "B2",
        assignedTo: "alice",
        reassignedTo: "bob",
        eventBy: "admin",
      }),
    ]);

    // A real derive, which also writes the cache and the checkpoint sidecar
    // (awaited, so both files are on disk before they are tampered with).
    const fresh = await loadOrDeriveDistributionCurrent(root, month, rows, {
      awaitCachePersist: true,
    });
    expect(fresh?.deriveVersion).toBe(DERIVE_VERSION);
    expect(fresh?.quotas?.alice?.sampleCount).toBe(1);
    expect(fresh?.quotas?.bob?.sampleCount).toBe(2);

    // Rewrite both artifacts as a v2 client would have left them: same
    // revision/eventSetId (so only the version check can reject them) and the
    // old, assign-event-counted quotas.
    const dir = await getSampleMainDir(root, month, true);
    const cache = ((await safeReadJson<DistributionCurrentData>(dir, "distribution.current.json")) as { value: DistributionCurrentData }).value;
    await safeWriteJson(dir, "distribution.current.json", {
      ...cache,
      deriveVersion: 2,
      quotas: {
        alice: { ...cache.quotas!.alice, sampleCount: 2, dailyQuota: 2 },
        bob: { ...cache.quotas!.bob, sampleCount: 1, dailyQuota: 1 },
      },
    });
    const sidecar = ((await safeReadJson<Record<string, unknown>>(dir, DISTRIBUTION_CHECKPOINT_FILE)) as { value: Record<string, unknown> }).value;
    await safeWriteJson(dir, DISTRIBUTION_CHECKPOINT_FILE, { ...sidecar, deriveVersion: 2 });
    __clearDeriveMemoForTests();

    const reloaded = await loadOrDeriveDistributionCurrent(root, month, rows);
    expect(reloaded?.deriveVersion).toBe(DERIVE_VERSION);
    // Refolded from the events, not patched forward from the v2 numbers.
    expect(reloaded?.quotas?.alice?.sampleCount).toBe(1);
    expect(reloaded?.quotas?.bob?.sampleCount).toBe(2);
  });

  it("cannot survive the v3 -> v4 bump either: a v3-stamped cache and its checkpoint both refold", async () => {
    // Same shape as the v2 test above, for the v4 bump (row-set fingerprint on
    // cache validity). A v3 artifact carries no `sampleRowsFingerprint` at all,
    // so it can never be accepted again; the bump is what turns that into ONE
    // refold per month rather than a cache that is silently rejected forever.
    const root = await makeRoot();
    const month = "5-May-2026";
    const rows = [makeRow("A1"), makeRow("B2")];
    __clearDeriveMemoForTests();
    await appendDistributionEvents(root, month, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "B2", assignedTo: "bob", eventBy: "admin" }),
    ]);
    await loadOrDeriveDistributionCurrent(root, month, rows, { awaitCachePersist: true });

    const dir = await getSampleMainDir(root, month, true);
    const cache = ((await safeReadJson<DistributionCurrentData>(dir, "distribution.current.json")) as { value: DistributionCurrentData }).value;
    // Exactly what a v3 client left behind: no fingerprint, and a marker total
    // no fold could produce, so serving it is unmistakable.
    const v3Cache: DistributionCurrentData = { ...cache, deriveVersion: 3, totalPending: 999 };
    delete v3Cache.sampleRowsFingerprint;
    await safeWriteJson(dir, "distribution.current.json", v3Cache);
    const sidecar = ((await safeReadJson<Record<string, unknown>>(dir, DISTRIBUTION_CHECKPOINT_FILE)) as { value: Record<string, unknown> }).value;
    await safeWriteJson(dir, DISTRIBUTION_CHECKPOINT_FILE, { ...sidecar, deriveVersion: 3 });
    __clearDeriveMemoForTests();

    const reloaded = await loadOrDeriveDistributionCurrent(root, month, rows);
    expect(reloaded?.deriveVersion).toBe(DERIVE_VERSION);
    expect(reloaded?.totalPending).toBe(2);
    expect(reloaded?.sampleRowsFingerprint).toBe(sampleRowsFingerprint(rows));
    // The constant is the versioned contract every workspace's stored caches
    // are stamped against, so pin it: changing it is a deliberate, documented
    // act (one refold per month per workspace on first load), never a drive-by.
    expect(DERIVE_VERSION).toBe(4);
  });
});

describe("distribution cache row-set fingerprint (v4)", () => {
  /** The exact snapshot shape refreshDistribution persists: a bare
   *  deriveCurrentDistribution (deriveVersion + sampleRowsFingerprint) plus
   *  logRevision and eventSetId. `totalPending` is overwritten with a marker no
   *  fold could produce, so "was this served from the cache?" is decidable from
   *  the returned value alone -- the same idiom the deriveVersion test above
   *  uses, and stronger than a spy: it proves the CONTENT came from disk. */
  async function writeWritePathCache(
    root: DirectoryHandleLike,
    month: string,
    rows: PreparedPopulationRow[],
    overrides: Partial<DistributionCurrentData> = {}
  ): Promise<void> {
    const log = await loadDistributionLog(root, month);
    const current: DistributionCurrentData = {
      ...deriveCurrentDistribution(log, rows),
      logRevision: log.revision,
      ...(log.eventSetId === undefined ? {} : { eventSetId: log.eventSetId }),
      totalPending: 999,
      ...overrides,
    };
    await saveDistributionCurrent(root, month, current);
  }

  async function seed(root: DirectoryHandleLike, month: string): Promise<void> {
    await appendDistributionEvents(root, month, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "B2", assignedTo: "alice", eventBy: "admin" }),
    ]);
  }

  it("serves a fully-stamped write-path cache on the fast path, with no refold", async () => {
    // Item 14: refreshDistribution now stamps all four validity fields, so the
    // cache it writes right after a distribution is actually accepted instead
    // of forcing a full refold at the most expensive possible moment.
    const root = await makeRoot();
    const month = "5-May-2026";
    const rows = [makeRow("A1"), makeRow("B2")];
    await seed(root, month);
    __clearDeriveMemoForTests();
    await writeWritePathCache(root, month, rows);
    __clearDeriveMemoForTests();

    const result = await loadOrDeriveDistributionCurrent(root, month, rows, {
      persistCache: false,
    });
    expect(result?.totalPending).toBe(999);
  });

  it("refolds a cache whose row fingerprint does not match the rows in hand", async () => {
    // The staleness window the fingerprint closes: a replacement appends a row
    // to sample.master.json without appending an event, so logRevision and
    // eventSetId are both unchanged while the row set the fold must run against
    // is not. Reordering is the same discriminator applied to the same ids --
    // the fold is not commutative, so a different order is a different fold.
    const root = await makeRoot();
    const month = "5-May-2026";
    const rows = [makeRow("A1"), makeRow("B2")];
    await seed(root, month);
    __clearDeriveMemoForTests();
    await writeWritePathCache(root, month, rows);
    __clearDeriveMemoForTests();

    const result = await loadOrDeriveDistributionCurrent(root, month, [rows[1]!, rows[0]!], {
      persistCache: false,
    });
    // Refolded: the marker is gone and the snapshot carries the fingerprint of
    // the rows actually handed in.
    expect(result?.totalPending).toBe(2);
    expect(result?.sampleRowsFingerprint).toBe(sampleRowsFingerprint([rows[1]!, rows[0]!]));
  });

  it("still refolds a legacy write-path cache that carries no eventSetId", async () => {
    const root = await makeRoot();
    const month = "5-May-2026";
    const rows = [makeRow("A1"), makeRow("B2")];
    await seed(root, month);
    __clearDeriveMemoForTests();
    const log = await loadDistributionLog(root, month);
    // Pre-item-14 shape: logRevision only, exactly what refreshDistribution
    // used to persist. Still rejected, so nothing about the old on-disk cache
    // becomes authoritative retroactively.
    await saveDistributionCurrent(root, month, {
      ...deriveCurrentDistribution(log, rows),
      logRevision: log.revision,
      totalPending: 999,
    });
    __clearDeriveMemoForTests();

    const result = await loadOrDeriveDistributionCurrent(root, month, rows, {
      persistCache: false,
    });
    expect(result?.totalPending).toBe(2);
  });

  it("does not share a derive memo entry between same-length row sets with different ids", async () => {
    // Item 17: the memo key used only sampleRows.length, so a replacement swap
    // (one row retired, one appended -- same count) collapsed two different row
    // sets onto one memo entry for the rest of the workspace epoch. No cache is
    // written here (persistCache: false), so the memo is the ONLY thing that
    // could serve the second call, and the stamped fingerprint on the result is
    // what says WHICH row set the returned derivation belongs to.
    const root = await makeRoot();
    const month = "5-May-2026";
    const rowsA = [makeRow("A1"), makeRow("B2")];
    const rowsB = [makeRow("A1"), makeRow("C3")];
    await appendDistributionEvents(root, month, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" }),
    ]);
    __clearDeriveMemoForTests();

    const first = await loadOrDeriveDistributionCurrent(root, month, rowsA, { persistCache: false });
    const second = await loadOrDeriveDistributionCurrent(root, month, rowsB, { persistCache: false });

    // Both are 2-row sets at the same (workspace, month, epoch); under the old
    // length-only key the second call was handed the FIRST call's derivation.
    expect(first?.sampleRowsFingerprint).toBe(sampleRowsFingerprint(rowsA));
    expect(second?.sampleRowsFingerprint).toBe(sampleRowsFingerprint(rowsB));
  });
});

