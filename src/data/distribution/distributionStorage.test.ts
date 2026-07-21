import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  appendDistributionEvent,
  appendDistributionEvents,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
  saveDistributionCurrent,
} from "./distributionStorage";
import { DERIVE_VERSION, buildAssignEvent, deriveCurrentDistribution } from "./distributionLog";
import type { DistributionCurrentData } from "./distributionTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

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

    expect(result).toEqual({ ok: true });
    expect(progress.filter((update) => update.phase === "events").map((update) => update.completed))
      .toEqual(Array.from({ length: 10 }, (_, index) => index));
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
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    const log = await loadDistributionLog(root, month);
    expect(log.events.map((event) => event.eventId).sort()).toEqual([first.eventId, second.eventId].sort());
    expect(log.eventSetId).toMatch(/^2:/);
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
