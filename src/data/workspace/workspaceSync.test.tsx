/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  clearOperationLog,
  clearSimulatedFaults,
  createMemoryDirectory,
  getOperationLog,
  getReadLog,
  setSimulatedFaults,
} from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import {
  getPopulationMonthDir,
  getSampleApprovalsDir,
  getSampleEmployeeDir,
  getSampleMainDir,
  getSystemRoot,
  SYSTEM_FOLDER_NAMES,
} from "./workspacePaths";
import { DISTRIBUTION_EVENTS_DIR } from "../distribution/distributionEventStore";
import { appendDistributionEvent } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import {
  ALL_DATA_REFRESH_FAMILIES,
  subscribeToDataChange,
  type DataRefreshDetail,
} from "./dataRefreshSignal";
import { __clearInFlightForTests } from "../storage/inFlightReads";
import {
  getSyncIntervalMs,
  runSync,
  subscribeToSyncInterval,
  __resetWorkspaceSyncStateForTests,
} from "./workspaceSync";
import {
  DEFAULT_SYNC_INTERVAL_MS,
  MIN_SYNC_INTERVAL_MS,
  MAX_SYNC_INTERVAL_MS,
  saveSyncIntervalMs,
  WORKSPACE_SETTINGS_FILE,
} from "./syncSettings";

async function writeRawFile(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const handle: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}

const MONTH = "5-May-2026";

function makeRoot(name = "sync-root", trackReads = false): DirectoryHandleLike {
  return createMemoryDirectory(name, { trackReads }) as unknown as DirectoryHandleLike;
}

async function seedNotification(root: DirectoryHandleLike): Promise<void> {
  const systemDir = await getSystemRoot(root, true);
  const notificationsDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.notifications, {
    create: true,
  });
  await safeWriteJson(notificationsDir, "notifications.json", {
    revision: 1,
    updatedAt: new Date().toISOString(),
    notifications: [
      { id: "n1", message: "hi", postedBy: "admin", postedAt: new Date().toISOString(), acceptances: [] },
    ],
  });
}

/** Collects every broadcast reaching an "everything" subscriber. */
function captureBroadcasts(): { details: DataRefreshDetail[]; stop: () => void } {
  const details: DataRefreshDetail[] = [];
  const stop = subscribeToDataChange(ALL_DATA_REFRESH_FAMILIES, (detail) => {
    details.push(detail);
  });
  return { details, stop };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  __clearInFlightForTests();
  __resetWorkspaceSyncStateForTests();
});

afterEach(() => {
  __resetWorkspaceSyncStateForTests();
  vi.restoreAllMocks();
});

describe("runSync — change-set probe (§4.2 / A7)", () => {
  it("the first probe for a (workspace, month) establishes a baseline and reports no change", async () => {
    const root = makeRoot();
    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(result.ran).toBe(true);
    expect(result.changed.size).toBe(0);
  });

  it("two consecutive automatic runs over a genuinely unchanged month report an empty change set", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(result.changed.size).toBe(0);
  });

  it("the staleness test: a posted notification AND an appended answers-file request are both detected, with NO distribution change", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH });

    await seedNotification(root);
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.answers.json", JSON.stringify({ requests: ["r1"] }));

    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(changed.has("notifications")).toBe(true);
    expect(changed.has("requests")).toBe(true);
    expect(changed.has("answers")).toBe(true);
    expect(changed.has("distribution")).toBe(false);
  });

  it("an appended request inside an EXISTING answers file (same name, larger size) is detected (F21)", async () => {
    const root = makeRoot();
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.answers.json", "short");
    await runSync({ directoryHandle: root, monthFolderName: MONTH });

    await writeRawFile(answersDir, "alice.answers.json", "a much longer body appended later");
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(changed.has("answers")).toBe(true);
    expect(changed.has("requests")).toBe(true);
  });

  it("a SAME-LENGTH rewrite of an existing answers file is detected (size alone cannot see it)", async () => {
    const root = makeRoot();
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    // The realistic shape: a JsonEnvelope whose metadata.revision goes 9 -> 10
    // while the file's byte length stays exactly the same.
    await writeRawFile(answersDir, "alice.answers.json", '{"revision":09,"answer":"aaa"}');
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    await writeRawFile(answersDir, "alice.answers.json", '{"revision":10,"answer":"bbb"}');
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(changed.has("answers")).toBe(true);
    expect(changed.has("requests")).toBe(true);
  });

  it("a SAME-LENGTH rewrite of a supervisor decisions file is detected too", async () => {
    const root = makeRoot();
    const approvalsDir = await getSampleApprovalsDir(root, MONTH, true);
    await writeRawFile(approvalsDir, "sup1.json", '{"revision":09,"decision":"aaa"}');
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    await writeRawFile(approvalsDir, "sup1.json", '{"revision":10,"decision":"bbb"}');
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(changed.has("requests")).toBe(true);
  });

  it("a distribution event append is reported as the distribution family only", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH });

    await appendDistributionEvent(
      root,
      MONTH,
      buildAssignEvent({ xrayImageId: "img-1", assignedTo: "alice", eventBy: "admin" })
    );
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect([...changed]).toEqual(["distribution"]);
  });

  it("a manifest revision change is reported as the manifest family", async () => {
    const root = makeRoot();
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH });
    await runSync({ directoryHandle: root, monthFolderName: MONTH });

    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH, locked: true });
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(changed.has("manifest")).toBe(true);
  });

  it("an approvals-dir change is reported as requests only, not answers", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH });

    const approvalsDir = await getSampleApprovalsDir(root, MONTH, true);
    await writeRawFile(approvalsDir, "supervisor1.json", JSON.stringify({ decisions: [] }));
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(changed.has("requests")).toBe(true);
    expect(changed.has("answers")).toBe(false);
  });

  it("round-trip budget: an unchanged automatic run stays within 2+1+2+N+M+1 read calls", async () => {
    const root = makeRoot("sync-budget", true);
    await seedNotification(root);
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.answers.json", "aaaa");
    await writeRawFile(answersDir, "bob.answers.json", "bbbb");
    const approvalsDir = await getSampleApprovalsDir(root, MONTH, true);
    await writeRawFile(approvalsDir, "carol.json", "cccc");
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH });

    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline, not measured

    const before = getReadLog(root).length;
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    const reads = getReadLog(root).length - before;

    expect(reads).toBeLessThanOrEqual(9);
  });
});

describe("runSync — manual vs automatic broadcast semantics", () => {
  it("an automatic run broadcasts nothing when the change set is empty", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const capture = captureBroadcasts();
    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    capture.stop();

    expect(result.broadcast).toBe(false);
    expect(capture.details).toHaveLength(0);
  });

  it("an automatic run broadcasts a periodic change set when something changed", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    await seedNotification(root);

    const capture = captureBroadcasts();
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    capture.stop();

    expect(capture.details).toHaveLength(1);
    expect(capture.details[0]).toEqual(
      expect.objectContaining({ source: "periodic", changed: expect.any(Set) })
    );
  });

  it("a MANUAL run always broadcasts \"manual\", even when the change set is empty", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const capture = captureBroadcasts();
    const result = await runSync({ manual: true, directoryHandle: root, monthFolderName: MONTH });
    capture.stop();

    expect(result.changed.size).toBe(0);
    expect(result.broadcast).toBe(true);
    expect(capture.details).toEqual([{ source: "manual" }]);
  });

  it("a MANUAL run broadcasts \"manual\" even with no month selected (nothing to probe)", async () => {
    const root = makeRoot();
    const capture = captureBroadcasts();
    const result = await runSync({ manual: true, directoryHandle: root, monthFolderName: null });
    capture.stop();

    expect(result.ran).toBe(true);
    expect(capture.details).toEqual([{ source: "manual" }]);
  });

  it("a MANUAL run still runs while the tab is hidden (the hidden-tab skip is automatic-only)", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline
    await seedNotification(root);

    const capture = captureBroadcasts();
    const result = await runSync({ manual: true, directoryHandle: root, monthFolderName: MONTH });
    capture.stop();

    expect(result.ran).toBe(true);
    expect(result.changed.has("notifications")).toBe(true);
    expect(capture.details).toEqual([{ source: "manual" }]);
  });
});

describe("runSync — permissions on both paths", () => {
  it("invokes refreshPermissions on the automatic path", async () => {
    const root = makeRoot();
    const refreshPermissions = vi.fn().mockResolvedValue(true);
    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH, refreshPermissions });
    expect(refreshPermissions).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("invokes refreshPermissions on the manual path and reports its failure as ok=false", async () => {
    const root = makeRoot();
    const refreshPermissions = vi.fn().mockResolvedValue(false);

    const capture = captureBroadcasts();
    const result = await runSync({
      manual: true,
      directoryHandle: root,
      monthFolderName: MONTH,
      refreshPermissions,
    });
    capture.stop();

    expect(refreshPermissions).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    // A failed permission sync must not swallow the data broadcast — the
    // button's red state is advisory, the refresh itself still happened.
    expect(capture.details).toEqual([{ source: "manual" }]);
  });

  it("reports ok=false when refreshPermissions throws, without throwing itself", async () => {
    const root = makeRoot();
    const refreshPermissions = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await runSync({
      manual: true,
      directoryHandle: root,
      monthFolderName: MONTH,
      refreshPermissions,
    });
    expect(result.ok).toBe(false);
  });
});

describe("runSync — the single shared in-flight guard", () => {
  it("coalesces an automatic run away while another run is in flight", async () => {
    const root = makeRoot();
    const gate = deferred<boolean>();
    const slowPermissions = vi.fn().mockReturnValue(gate.promise);
    const fastPermissions = vi.fn().mockResolvedValue(true);

    const first = runSync({
      directoryHandle: root,
      monthFolderName: MONTH,
      refreshPermissions: slowPermissions,
    });
    const second = await runSync({
      directoryHandle: root,
      monthFolderName: MONTH,
      refreshPermissions: fastPermissions,
    });

    expect(second.ran).toBe(false);
    expect(fastPermissions).not.toHaveBeenCalled();

    gate.resolve(true);
    expect((await first).ran).toBe(true);
  });

  it("a MANUAL run started during an in-flight automatic run waits for it, then runs its own forced pass", async () => {
    const root = makeRoot();
    const gate = deferred<boolean>();
    const slowPermissions = vi.fn().mockReturnValue(gate.promise);
    const manualPermissions = vi.fn().mockResolvedValue(true);

    const capture = captureBroadcasts();
    const automatic = runSync({
      directoryHandle: root,
      monthFolderName: MONTH,
      refreshPermissions: slowPermissions,
    });
    const manual = runSync({
      manual: true,
      directoryHandle: root,
      monthFolderName: MONTH,
      refreshPermissions: manualPermissions,
    });

    // The manual run must not have started while the automatic one is open.
    expect(manualPermissions).not.toHaveBeenCalled();

    gate.resolve(true);
    await automatic;
    const manualResult = await manual;
    capture.stop();

    expect(manualPermissions).toHaveBeenCalledTimes(1);
    expect(manualResult.ran).toBe(true);
    expect(capture.details).toEqual([{ source: "manual" }]);
  });

  it("two concurrent MANUAL runs execute one after the other, never overlapping", async () => {
    const root = makeRoot();
    let active = 0;
    let maxActive = 0;
    const permissions = vi.fn().mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return true;
    });

    const both = await Promise.all([
      runSync({ manual: true, directoryHandle: root, monthFolderName: MONTH, refreshPermissions: permissions }),
      runSync({ manual: true, directoryHandle: root, monthFolderName: MONTH, refreshPermissions: permissions }),
    ]);

    expect(permissions).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(both.every((result) => result.ran)).toBe(true);
  });
});

describe("runSync — the baseline hazard", () => {
  it("a manual run that establishes the very first baseline cannot swallow a change: it broadcasts anyway", async () => {
    const root = makeRoot();
    await seedNotification(root);

    const capture = captureBroadcasts();
    // First-ever probe for this (workspace, month) — the baseline is
    // established silently, so `changed` is empty by construction...
    const result = await runSync({ manual: true, directoryHandle: root, monthFolderName: MONTH });
    capture.stop();

    expect(result.changed.size).toBe(0);
    // ...but the manual broadcast still reaches every subscriber, so the
    // silently-established baseline cannot hide the pre-existing state.
    expect(capture.details).toEqual([{ source: "manual" }]);
  });

  it("a manual run leaves an accurate baseline: the NEXT automatic run reports only changes made after it", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    await seedNotification(root);
    const manual = await runSync({ manual: true, directoryHandle: root, monthFolderName: MONTH });
    expect(manual.changed.has("notifications")).toBe(true);

    // Nothing changed since the manual run — the baseline it stored must be
    // the post-notification state, not a stale one.
    const quiet = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(quiet.changed.size).toBe(0);

    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.answers.json", "later");
    const after = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(after.changed.has("answers")).toBe(true);
    expect(after.changed.has("notifications")).toBe(false);
  });

  it("a manual run does not consume a change that a concurrent automatic run would have reported", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline
    await seedNotification(root);

    const capture = captureBroadcasts();
    const [automatic, manual] = await Promise.all([
      runSync({ directoryHandle: root, monthFolderName: MONTH }),
      runSync({ manual: true, directoryHandle: root, monthFolderName: MONTH }),
    ]);
    capture.stop();

    // Exactly one of the two observed the notification delta (whichever probed
    // first), and the manual broadcast fired regardless — so no subscriber can
    // miss it.
    expect(automatic.changed.has("notifications") || manual.changed.has("notifications")).toBe(true);
    expect(capture.details.some((detail) => detail.source === "manual")).toBe(true);
  });
});

describe("runSync — the admin-configurable sync cadence rides along on the run", () => {
  it("starts at the 45s default before any run", () => {
    expect(getSyncIntervalMs()).toBe(DEFAULT_SYNC_INTERVAL_MS);
  });

  it("publishes the workspace's stored cadence as part of an ordinary automatic run", async () => {
    const root = makeRoot();
    await saveSyncIntervalMs(root, 120_000, "admin");

    await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(getSyncIntervalMs()).toBe(120_000);
  });

  it("notifies subscribers when — and only when — the cadence actually moves", async () => {
    const root = makeRoot();
    const seen: number[] = [];
    const stop = subscribeToSyncInterval((ms) => seen.push(ms));

    await saveSyncIntervalMs(root, 60_000, "admin");
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    // A second run with nothing changed must not re-notify.
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    // A change by another client, picked up on the next run.
    await saveSyncIntervalMs(root, 300_000, "other-admin");
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    stop();

    expect(seen).toEqual([60_000, 300_000]);
  });

  it("picks up the cadence even with NO month selected — it is workspace-wide, not month-scoped", async () => {
    const root = makeRoot();
    await saveSyncIntervalMs(root, 90_000, "admin");

    await runSync({ directoryHandle: root, monthFolderName: null });

    expect(getSyncIntervalMs()).toBe(90_000);
  });

  it("clamps a hand-edited out-of-range file before it can ever reach the timer", async () => {
    const root = makeRoot();
    const systemDir = await getSystemRoot(root, true);
    await safeWriteJson(systemDir, WORKSPACE_SETTINGS_FILE, {
      revision: 1,
      updatedAt: new Date().toISOString(),
      syncIntervalMs: 200,
    });

    await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(getSyncIntervalMs()).toBe(MIN_SYNC_INTERVAL_MS);
  });

  it("leaves the cadence at the default, and the run successful, when the settings file is malformed", async () => {
    const root = makeRoot();
    const systemDir = await getSystemRoot(root, true);
    await writeRawFile(systemDir, WORKSPACE_SETTINGS_FILE, "{{{ not json");

    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(result.ok).toBe(true);
    expect(getSyncIntervalMs()).toBe(DEFAULT_SYNC_INTERVAL_MS);
  });

  it("does NOT change what a manual refresh does — it still always broadcasts, whatever the cadence", async () => {
    const root = makeRoot();
    await saveSyncIntervalMs(root, MAX_SYNC_INTERVAL_MS, "admin");
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const capture = captureBroadcasts();
    const manual = await runSync({ manual: true, directoryHandle: root, monthFolderName: MONTH });
    capture.stop();

    expect(manual.ran).toBe(true);
    expect(manual.broadcast).toBe(true);
    expect(manual.changed.size).toBe(0);
    expect(capture.details.some((detail) => detail.source === "manual")).toBe(true);
  });
});

describe("runSync — per-tick round-trip budget (UNC/SMB cost regression guard)", () => {
  /**
   * The deployment target is a shared UNC/SMB folder: every getDirectoryHandle
   * / getFileHandle / getFile in a probe is a network round trip, paid by EVERY
   * client, EVERY tick, forever. These assertions exist so a future change
   * cannot quietly make the tick expensive again — if one of them fails,
   * something added recurring network cost, and that is the thing to justify.
   */
  async function seedWorkspace(root: DirectoryHandleLike, employees: number): Promise<void> {
    await seedNotification(root);
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    const approvalsDir = await getSampleApprovalsDir(root, MONTH, true);
    for (let index = 0; index < employees; index += 1) {
      await writeRawFile(answersDir, `emp${index}.answers.json`, JSON.stringify({ items: [] }));
      await writeRawFile(approvalsDir, `emp${index}.json`, JSON.stringify({ decisions: [] }));
    }
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH });
  }

  it("scales at ONE operation per answers/decisions file, not two", async () => {
    const root = createMemoryDirectory("op-root", { trackOperations: true });
    await seedWorkspace(root, 10);
    // Two warm-up runs, not one: the first settles the probe stamps, the
    // second settles the workspace-epoch bump that the first one's broadcast
    // triggers (which invalidates the month-scoped directory-handle cache).
    // Measuring on an unsettled cache would fold a one-off re-resolution into
    // the marginal cost being compared.
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    await runSync({ directoryHandle: root, monthFolderName: MONTH });

    clearOperationLog(root);
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    const ten = getOperationLog(root).length;

    // Add ten more employees and re-measure the marginal cost.
    await seedWorkspace(root, 20);
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    clearOperationLog(root);
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    const twenty = getOperationLog(root).length;

    // 10 more answers files + 10 more decisions files = 20 more files. One
    // operation each (the handle comes from the enumeration), so exactly 20
    // more operations — not 40, which is what a getFileHandle + getFile pair
    // per file would cost.
    expect(twenty - ten).toBe(20);
  });

  it("re-resolves each shared parent directory only once per run", async () => {
    const root = createMemoryDirectory("op-root", { trackOperations: true });
    await seedWorkspace(root, 0);
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline probe

    clearOperationLog(root);
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    const opens = getOperationLog(root).filter((entry) => entry.operation === "getDirectoryHandle");

    // Was nine (2-samples, {month}, 1-main, 2-employees, 3-approvals,
    // 1-population, {month}, 5-system, notifications), each exactly once —
    // itself down from sixteen. The workspacePaths directory-handle cache
    // (item 1.7) now serves every handle it hands out, so the five it owns
    // (both roots, both {month} dirs, 5-system) cost nothing on a warm tick.
    // What is left is the four this file resolves off an already-resolved
    // parent handle itself, outside those getters.
    expect(opens).toHaveLength(4);
    const distinct = new Set(opens.map((entry) => entry.name));
    expect(distinct.size).toBe(opens.length); // no directory opened twice
  });

  it("costs ONE operation to conclude the workspace has no stored cadence", async () => {
    const root = createMemoryDirectory("op-root", { trackOperations: true });
    await seedWorkspace(root, 0);
    await runSync({ directoryHandle: root, monthFolderName: null }); // baseline

    clearOperationLog(root);
    await runSync({ directoryHandle: root, monthFolderName: null });
    const log = getOperationLog(root);

    // With no month selected the ONLY disk work is the cadence read: one
    // getFileHandle that misses. safeReadJson would have probed .bak and .tmp
    // as well — two extra opens per tick per client, permanently, on every
    // workspace whose admin has never set a cadence (i.e. the default state).
    // The 5-system getDirectoryHandle that used to accompany it is now served
    // from the workspacePaths directory-handle cache (item 1.7).
    expect(log.filter((entry) => entry.operation === "getFileHandle")).toHaveLength(1);
    expect(log).toHaveLength(1);
    expect(getSyncIntervalMs()).toBe(DEFAULT_SYNC_INTERVAL_MS);
  });
});

describe("runSync — the distribution event segments are probed directly (restore visibility)", () => {
  /**
   * `distribution.log.json`'s CAS stamp covers the distribution family only
   * while the stamp and the durable events move together. Two real cases break
   * that: a RESTORE merges events into `distribution.events/` and deliberately
   * does not rewrite the projection (backupStorage's `restore-if-absent`), and
   * an append whose projection write failed leaves the events durable with the
   * stamp unmoved. Both used to be invisible to every other machine on the
   * share until someone happened to press the manual refresh button.
   */
  async function eventsDirFor(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
    const main = await getSampleMainDir(root, MONTH, true);
    return main.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: true });
  }

  const segment = (ids: string[]): string =>
    ids
      .map((id) =>
        `${JSON.stringify({
          eventId: id,
          eventType: "assigned",
          xrayImageId: `XR-${id}`,
          assignedTo: "alice",
          eventAt: "2026-05-01T08:00:00.000Z",
          eventBy: "admin",
        })}\n`
      )
      .join("");

  it("reports the distribution family when a segment gains events with the projection stamp untouched", async () => {
    const root = makeRoot();
    const eventsDir = await eventsDirFor(root);
    await writeRawFile(eventsDir, "devA-s1.ndjson", segment(["e01"]));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    // Exactly what a restore's mergeEventSegment does: the same segment name,
    // more lines, and not one byte written to distribution.log.json.
    await writeRawFile(eventsDir, "devA-s1.ndjson", segment(["e01", "e02"]));
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect([...changed]).toEqual(["distribution"]);
  });

  it("reports the distribution family when a restore puts a whole missing segment back", async () => {
    const root = makeRoot();
    const eventsDir = await eventsDirFor(root);
    await writeRawFile(eventsDir, "devA-s1.ndjson", segment(["e01"]));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    await writeRawFile(eventsDir, "devB-s9.ndjson", segment(["e02"]));
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect([...changed]).toEqual(["distribution"]);
  });

  it("reports the distribution family when only the restored projection stamp moved", async () => {
    const root = makeRoot();
    const mainDir = await getSampleMainDir(root, MONTH, true);
    await safeWriteJson(mainDir, "distribution.log.json", {
      monthFolderName: MONTH,
      revision: 7,
      _writeToken: "before-restore",
      events: [],
    });
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    // What restoreBackupSnapshot's stamp refresh does: same revision, new token.
    await safeWriteJson(mainDir, "distribution.log.json", {
      monthFolderName: MONTH,
      revision: 7,
      _writeToken: "after-restore",
      events: [],
    });
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect([...changed]).toEqual(["distribution"]);
  });

  it("produces an identical signature for an untouched month with segments present (no spurious refresh)", async () => {
    const root = makeRoot();
    const eventsDir = await eventsDirFor(root);
    await writeRawFile(eventsDir, "devA-s1.ndjson", segment(["e01"]));
    await writeRawFile(eventsDir, "devB-s9.ndjson", segment(["e02", "e03"]));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const capture = captureBroadcasts();
    try {
      const first = await runSync({ directoryHandle: root, monthFolderName: MONTH });
      const second = await runSync({ directoryHandle: root, monthFolderName: MONTH });
      expect(first.changed.size).toBe(0);
      expect(second.changed.size).toBe(0);
      expect(capture.details).toEqual([]);
    } finally {
      capture.stop();
    }
  });
});

describe("runSync — a failed family read carries its baseline forward (no double refresh)", () => {
  /**
   * A probe read that FAILS is not an observation. It used to be stored as the
   * new baseline anyway (revision -1, an empty signature), so the next healthy
   * tick differed from that placeholder and broadcast a change nobody made.
   * Every transient blip on the share therefore cost every client an extra
   * refresh — and a refresh can clobber unsaved draft state.
   */
  async function seedDistribution(root: DirectoryHandleLike): Promise<void> {
    const mainDir = await getSampleMainDir(root, MONTH, true);
    await safeWriteJson(mainDir, "distribution.log.json", {
      monthFolderName: MONTH,
      revision: 5,
      _writeToken: "steady",
      events: [],
    });
  }

  it("an unreadable distribution log, then a healthy tick over unchanged data, broadcasts nothing", async () => {
    const root = makeRoot();
    await seedDistribution(root);
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const capture = captureBroadcasts();
    try {
      setSimulatedFaults(root, [
        {
          operation: "getFile",
          name: "distribution.log.json",
          errorName: "NotReadableError",
          times: Number.POSITIVE_INFINITY,
        },
      ]);
      const blocked = await runSync({ directoryHandle: root, monthFolderName: MONTH });
      clearSimulatedFaults(root);
      const recovered = await runSync({ directoryHandle: root, monthFolderName: MONTH });

      expect(blocked.changed.size).toBe(0);
      expect(recovered.changed.size).toBe(0);
      expect(capture.details).toEqual([]);
    } finally {
      clearSimulatedFaults(root);
      capture.stop();
    }
  });

  it("an unreadable subdirectory open, then a healthy tick over unchanged data, broadcasts nothing", async () => {
    const root = makeRoot();
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.answers.json", JSON.stringify({ items: [] }));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const capture = captureBroadcasts();
    try {
      // A transient share failure on the DIRECTORY open, not on a file: every
      // family hanging off it used to probe as "empty" and become the baseline.
      setSimulatedFaults(root, [
        {
          operation: "getDirectoryHandle",
          name: "2-employees",
          errorName: "NotReadableError",
          times: Number.POSITIVE_INFINITY,
        },
      ]);
      const blocked = await runSync({ directoryHandle: root, monthFolderName: MONTH });
      clearSimulatedFaults(root);
      const recovered = await runSync({ directoryHandle: root, monthFolderName: MONTH });

      expect(blocked.changed.size).toBe(0);
      expect(recovered.changed.size).toBe(0);
      expect(capture.details).toEqual([]);
    } finally {
      clearSimulatedFaults(root);
      capture.stop();
    }
  });
});
