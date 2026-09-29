/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  clearOperationLog,
  clearSimulatedFaults,
  createMemoryDirectory,
  getOperationLog,
  getReadLog,
  clearReadLog,
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
  NOTIFICATIONS_SUBFOLDERS,
  SYSTEM_FOLDER_NAMES,
  __clearWorkspaceDirCacheForTests,
} from "./workspacePaths";
import { invalidateMonthLockCache, isMonthClosed } from "../population/monthLock";
import { DISTRIBUTION_EVENTS_DIR } from "../distribution/distributionEventStore";
import { ANSWER_EVENTS_DIR } from "../answers/answerEventStore";
import { loadAllEmployeeRequestFiles, readAllAnswerEventsForMonth, upsertItemAnswer, __clearAnswerEventsCacheForTests } from "../answers/answerStorage";
import { __resetAppendOnlyEventLogMemosForTests } from "../storage/appendOnlyEventLog";
import { __resetAnswerSegmentChainMemoForTests } from "../answers/answerSegmentChain";
import { getSealedAnswerSegmentsEpoch } from "../answers/answerSealedSegments";
import { clearSession, writeSession } from "../../auth/authSession";
import type { ItemAnswer } from "../answers/answerTypes";
import {
  acceptNotification,
  loadNotifications,
  postNotification,
} from "../notifications/notificationStorage";
import { appendDistributionEvent } from "../distribution/distributionStorage";
import { loadFeedback, replyToFeedback, submitFeedback } from "../feedback/feedbackStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import {
  ALL_DATA_REFRESH_FAMILIES,
  answersMayConcern,
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
  __clearWorkspaceDirCacheForTests();
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

  it("A2: a probed manifest change drops the cached month-lock verdict (closed month enforced within one tick)", async () => {
    const root = makeRoot();
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH, status: "distributed" });
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline
    invalidateMonthLockCache();
    expect(await isMonthClosed(root, MONTH)).toBe(false); // primes the (5 min) cache

    // Another machine closes the month.
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH, status: "closed" });
    expect(await isMonthClosed(root, MONTH)).toBe(false); // still cached
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(changed.has("manifest")).toBe(true);
    expect(await isMonthClosed(root, MONTH)).toBe(true);
  });

  it("A2: the first probe (baseline) and a manual refresh also drop the cached verdict", async () => {
    const root = makeRoot();
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH, status: "distributed" });
    invalidateMonthLockCache();
    expect(await isMonthClosed(root, MONTH)).toBe(false);
    // Closed by someone else before this tab's first probe: the baseline probe
    // sees no revision delta, so it must still invalidate.
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH, status: "closed" });
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(await isMonthClosed(root, MONTH)).toBe(true);

    // Manual refresh: unconditional.
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH, status: "distributed" });
    await runSync({ directoryHandle: root, monthFolderName: MONTH, manual: true });
    expect(await isMonthClosed(root, MONTH)).toBe(false);
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

/**
 * Acknowledgements live in one file per employee under
 * `5-system/notifications/acks/`, so nothing an ack touches moves
 * `notifications.json`'s revision — the only thing this probe used to compare
 * for the `notifications` family. The manager's "who acknowledged" roster
 * reloads on the refresh signal, so without the signature below it silently went
 * stale until somebody pressed refresh by hand.
 */
describe("runSync — the per-employee acknowledgement signature", () => {
  /**
   * Wraps every `getDirectoryHandle` down the tree so the acks folder can be
   * made unreadable AFTER a healthy baseline has been established — which
   * fixed-at-construction fault injection cannot express.
   */
  function withAcksFailure(
    handle: DirectoryHandleLike,
    fail: { on: boolean }
  ): DirectoryHandleLike {
    return new Proxy(handle, {
      get(target, property, receiver) {
        if (property === "getDirectoryHandle") {
          return async (name: string, options?: { create?: boolean }) => {
            if (name === NOTIFICATIONS_SUBFOLDERS.acks && fail.on) {
              const error = new Error("simulated share failure");
              error.name = "NotReadableError";
              throw error;
            }
            return withAcksFailure(await target.getDirectoryHandle(name, options), fail);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? (value as () => unknown).bind(target) : value;
      },
    }) as DirectoryHandleLike;
  }

  async function seedBroadcast(root: DirectoryHandleLike): Promise<string> {
    await postNotification(root, { message: "تعميم", postedBy: "manager1" });
    const [posted] = await loadNotifications(root);
    return posted!.id;
  }

  it("an acknowledgement by one employee moves the baseline, so the next tick broadcasts notifications", async () => {
    const root = makeRoot();
    const notificationId = await seedBroadcast(root);
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    // Writes ONLY 5-system/notifications/acks/employee_b.acks.json — the shared
    // broadcast file's revision is untouched (pinned in notificationAckStorage.test.ts).
    await acceptNotification(root, notificationId, "employee_b");

    const capture = captureBroadcasts();
    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    capture.stop();

    expect(result.changed.has("notifications")).toBe(true);
    expect(result.broadcast).toBe(true);
    expect(capture.details).toHaveLength(1);
  });

  it("a second acknowledgement by a DIFFERENT employee moves it again (a new file, not a bigger one)", async () => {
    const root = makeRoot();
    const notificationId = await seedBroadcast(root);
    await acceptNotification(root, notificationId, "employee_a");
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    await acceptNotification(root, notificationId, "employee_b");
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect(changed.has("notifications")).toBe(true);
  });

  it("an untouched workspace re-probes to an identical baseline and broadcasts nothing", async () => {
    const root = makeRoot();
    const notificationId = await seedBroadcast(root);
    await acceptNotification(root, notificationId, "employee_a");
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const capture = captureBroadcasts();
    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    capture.stop();

    expect(result.changed.size).toBe(0);
    expect(result.broadcast).toBe(false);
    expect(capture.details).toHaveLength(0);
  });

  it("an UNREADABLE acks folder carries the baseline forward instead of faking a change", async () => {
    const fail = { on: false };
    const root = withAcksFailure(makeRoot(), fail);
    const notificationId = await seedBroadcast(root);
    await acceptNotification(root, notificationId, "employee_a");
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // healthy baseline

    fail.on = true;
    const capture = captureBroadcasts();
    const blipped = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    capture.stop();

    // A failed read is not an observation: neither "changed" now…
    expect(blipped.changed.size).toBe(0);
    expect(capture.details).toHaveLength(0);

    // …nor "changed" on the next healthy tick, which is what storing the
    // failure's placeholder as the new baseline would have produced.
    fail.on = false;
    const recovered = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(recovered.changed.size).toBe(0);
    expect(recovered.broadcast).toBe(false);

    // The carried baseline is still the real one: a genuine ack is detected.
    await acceptNotification(root, notificationId, "employee_b");
    const after = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(after.changed.has("notifications")).toBe(true);
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
    // `1-main` must exist for this fixture to be representative: the segments
    // probe hangs off it, so a workspace without it silently skips one of the
    // opens the budget below is meant to pin.
    await getSampleMainDir(root, MONTH, true);
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
    // What is left is the eight this file resolves off an already-resolved
    // parent handle itself, outside those getters: 1-main, 2-employees,
    // 3-approvals, 1-main/distribution.events, 1-main/answers.events,
    // notifications, notifications/acks, and feedback.
    //
    // Four of those were added by later signals — the acknowledgement
    // signature, the distribution segments signature, the answers.events
    // segments signature (§6 of the answer-save append-only rewrite), and the
    // feedback log's revision (the unread-dot signal) — one open each per
    // tick, and the point of all four is that they do NOT grow with the
    // number of employees or with a month's history (the listings they feed
    // are bounded, see boundedSizeSignature; the feedback probe reads one
    // file's envelope revision, never its body).
    expect(opens).toHaveLength(8);
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

/**
 * The feedback ("chat") log is shared by every user on every machine, and the
 * unread dot on both widget triggers is driven by it. Without a probe of its
 * own, a message or a reply posted elsewhere stayed invisible until someone
 * pressed refresh by hand — which is exactly the staleness the change-set probe
 * exists to remove.
 */
describe("runSync — the shared feedback log is its own family", () => {
  it("a submitted message, then a reply, each report the feedback family", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    await submitFeedback(root, {
      from: "emp-1",
      role: "employee",
      category: "issue",
      text: "الجهاز لا يعمل",
    });
    const afterSubmit = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(afterSubmit.changed.has("feedback")).toBe(true);
    // The feedback log lives under 5-system and touches no month data.
    expect(afterSubmit.changed.has("distribution")).toBe(false);
    expect(afterSubmit.changed.has("answers")).toBe(false);

    const [message] = await loadFeedback(root);
    await replyToFeedback(
      root,
      message.id,
      { from: "admin", role: "admin", text: "تم الاطلاع", timestamp: new Date().toISOString() },
      false
    );
    const afterReply = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(afterReply.changed.has("feedback")).toBe(true);
  });

  it("reports nothing when the feedback log has not moved", async () => {
    const root = makeRoot();
    await submitFeedback(root, {
      from: "emp-1",
      role: "employee",
      category: "inquiry",
      text: "سؤال",
    });
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline
    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(result.changed.has("feedback")).toBe(false);
  });

  it("reports the feedback family for a reply to a thread nobody resolved", async () => {
    const root = makeRoot();
    await submitFeedback(root, { from: "emp-1", role: "employee", category: "issue", text: "الجهاز لا يعمل" });
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const [message] = await loadFeedback(root);
    await replyToFeedback(
      root,
      message.id,
      { from: "admin", role: "admin", text: "تم الاطلاع", timestamp: new Date().toISOString() },
      false // NOT resolved -- so threads.index.json is deliberately untouched
    );

    const after = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(after.changed.has("feedback")).toBe(true);
  });
});

describe("runSync — §6 of the answer-save proposal: the answers.events segments are probed directly", () => {
  /**
   * `answersSignature` (the legacy per-employee `.answers.json`/`.requests.json`
   * name+size listing) covers request-queue and pre-migration item files, but
   * an employee whose answers now live entirely in `answers.events/` moves
   * nothing that listing can see — mirrors the exact gap `segmentsSignature`
   * closes for distribution (see the describe block above), applied to
   * answers' own flat event directory. Zero new writes: this is a read-only,
   * bounded (top-N by name) directory listing, the same primitive distribution
   * already uses for exactly this purpose.
   */
  async function answerEventsDirFor(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
    const main = await getSampleMainDir(root, MONTH, true);
    return main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
  }

  const answerSegment = (ids: string[]): string =>
    ids
      .map((id) =>
        `${JSON.stringify({
          eventId: id,
          eventType: "item-saved",
          eventAt: "2026-05-01T08:00:00.000Z",
          eventBy: "emp1",
          authority: "self",
          xrayImageId: `XR-${id}`,
          answers: [{ fieldId: "f1", value: "v" }],
          status: "draft",
          answeredBy: "emp1",
        })}\n`
      )
      .join("");

  it("reports the answers family when an answer segment gains events", async () => {
    const root = makeRoot();
    const eventsDir = await answerEventsDirFor(root);
    await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01"]));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01", "e02"]));
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    // A9: event segments hold answers only, so this no longer also marks "requests"
    // (a colleague saving their own answer is not a request change).
    expect([...changed].sort()).toEqual(["answers"]);
  });

  it("reports the answers family when a whole new writer's answer segment appears", async () => {
    const root = makeRoot();
    const eventsDir = await answerEventsDirFor(root);
    await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01"]));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    await writeRawFile(eventsDir, "a1-ans-devB-s9.ndjson", answerSegment(["e02"]));
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });

    expect([...changed].sort()).toEqual(["answers"]);
  });

  it("A9: the broadcast names whose answers the moved segments gained (owners peek)", async () => {
    const root = makeRoot();
    const eventsDir = await answerEventsDirFor(root);
    await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01"]));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline
    const { details, stop } = captureBroadcasts();
    try {
      // a colleague's own answer (answeredBy emp1 in the fixture) grows a segment...
      await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01", "e02"]));
      await runSync({ directoryHandle: root, monthFolderName: MONTH });
      // ...and a supervisor's on-behalf answer for emp7 lands in a new chain
      await writeRawFile(
        eventsDir,
        "b1-ans-devS-s2.ndjson",
        `${JSON.stringify({ eventId: "obo1", eventType: "item-saved", eventAt: "2026-05-01T09:00:00.000Z", eventBy: "sup1", authority: "supervisor", xrayImageId: "XR-9", answers: [], status: "draft", answeredBy: "EMP7", answeredOnBehalfBy: "sup1" })}\n`
      );
      await runSync({ directoryHandle: root, monthFolderName: MONTH });
    } finally {
      stop();
    }
    const owners = details.map((d) => (d.source === "periodic" ? [...(d.answerOwners ?? ["<unknown>"])].sort() : ["manual"]));
    expect(owners).toEqual([["emp1"], ["emp7"]]);
  });

  const obo = (id: string, owner: string, by = "sup1"): string =>
    `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: by, authority: "supervisor", xrayImageId: `XR-${id}`, answers: [], status: "draft", answeredBy: owner, answeredOnBehalfBy: by })}\n`;

  it("A9: a chain that rotates inside one tick never yields a wrong non-null owner set", async () => {
    const root = makeRoot();
    const eventsDir = await answerEventsDirFor(root);
    for (let c = 0; c < 30; c += 1) {
      const b = `z${String(c).padStart(2, "0")}-ans-dev${c}-s${c}`;
      await writeRawFile(eventsDir, `${b}.ndjson`, answerSegment([`c${c}a`]));
      await writeRawFile(eventsDir, `${b}-1.ndjson`, answerSegment([`c${c}b`]));
      await writeRawFile(eventsDir, `${b}-2.ndjson`, answerSegment([`c${c}c`]));
    }
    const sup = "a00-ans-devS-sS";
    await writeRawFile(eventsDir, `${sup}.ndjson`, obo("s1", "empx"));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline: sup seq 0 is a sized head
    const { details, stop } = captureBroadcasts();
    try {
      await writeRawFile(eventsDir, `${sup}.ndjson`, obo("s1", "empx") + obo("s2", "empA"));
      await writeRawFile(eventsDir, `${sup}-1.ndjson`, obo("s3", "empB"));
      await runSync({ directoryHandle: root, monthFolderName: MONTH });
    } finally {
      stop();
    }
    expect(details).toHaveLength(1);
    const d = details[0]!;
    expect(d.source === "periodic" && answersMayConcern(d, "empA")).toBe(true);
  });

  it("A9: with more live chain heads than the stat budget the owners are reported unknown", async () => {
    const root = makeRoot();
    const eventsDir = await answerEventsDirFor(root);
    for (let c = 0; c < 70; c += 1) {
      await writeRawFile(eventsDir, `m${String(c).padStart(3, "0")}-ans-dev${c}-s${c}.ndjson`, answerSegment([`h${c}`]));
    }
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    const { details, stop } = captureBroadcasts();
    try {
      await writeRawFile(eventsDir, "m069-ans-dev69-s69.ndjson", answerSegment(["h69"]) + obo("x1", "empA"));
      await runSync({ directoryHandle: root, monthFolderName: MONTH });
    } finally {
      stop();
    }
    expect(details).toHaveLength(1);
    expect(details[0]!.source === "periodic" && details[0]!.answerOwners).toBeNull();
    // ...so an employee who is NOT named by the (unattributable) growth still reloads
    expect(answersMayConcern(details[0]!, "empZ")).toBe(true);
  });

  it("A9: an unclassifiable change leaves the owners unknown (null), never a guess", async () => {
    const root = makeRoot();
    const eventsDir = await answerEventsDirFor(root);
    await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01"]));
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    const { details, stop } = captureBroadcasts();
    try {
      await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01"]) + "not json\n");
      await runSync({ directoryHandle: root, monthFolderName: MONTH });
    } finally {
      stop();
    }
    expect(details).toHaveLength(1);
    expect(details[0]!.source === "periodic" && details[0]!.answerOwners).toBeNull();
  });

  it("A10: an answers-only tick keeps every employee's request queues memoized; a requests change does not", async () => {
    const root = makeRoot("rq-memo", true);
    const eventsDir = await answerEventsDirFor(root);
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.requests.json", JSON.stringify({ username: "alice", referralRequests: [] }));
    await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01"]));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline
    await loadAllEmployeeRequestFiles(root, MONTH);

    await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01", "e02"]));
    const answersTick = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect([...answersTick.changed]).toEqual(["answers"]);
    clearReadLog(root);
    await loadAllEmployeeRequestFiles(root, MONTH);
    expect(getReadLog(root).length).toBe(0);

    await writeRawFile(answersDir, "alice.requests.json", JSON.stringify({ username: "alice", referralRequests: [{ requestId: "r9" }] }));
    const requestsTick = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(requestsTick.changed.has("requests")).toBe(true);
    const fresh = await loadAllEmployeeRequestFiles(root, MONTH);
    expect(fresh[0]!.referralRequests).toHaveLength(1);
  });

  it("A11: growth of a chain head is detected even when it sorts outside the last 64 segment names", async () => {
    const root = makeRoot();
    const eventsDir = await answerEventsDirFor(root);
    // 40 chains x (sealed seq 0 + head seq 1) = 80 names; the oldest chain sorts FIRST.
    const name = (c: number, seq: number): string => `m${String(c).padStart(2, "0")}-ans-dev${c}-s${c}${seq ? `-${seq}` : ""}.ndjson`;
    for (let c = 0; c < 40; c += 1) {
      await writeRawFile(eventsDir, name(c, 0), answerSegment([`c${c}a`]));
      await writeRawFile(eventsDir, name(c, 1), answerSegment([`c${c}b`]));
    }
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline
    // a colleague appends to the OLDEST chain's head (name sorts before the last 64)
    await writeRawFile(eventsDir, name(0, 1), answerSegment(["c0b", "c0-new"]));
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(changed.has("answers")).toBe(true);
    // ...and a later growth of a NEWEST head is still seen, at every tick
    await writeRawFile(eventsDir, name(39, 1), answerSegment(["c39b", "c39-new"]));
    expect((await runSync({ directoryHandle: root, monthFolderName: MONTH })).changed.has("answers")).toBe(true);
  });

  it("A11: the answer-segment probe stays bounded in stats however many segments exist", async () => {
    const root = makeRoot("probe-bound", true);
    const eventsDir = await answerEventsDirFor(root);
    for (let c = 0; c < 150; c += 1) {
      await writeRawFile(eventsDir, `m${String(c).padStart(3, "0")}-ans-dev${c}-s${c}.ndjson`, answerSegment([`x${c}`]));
    }
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    clearReadLog(root);
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    const opened = getReadLog(root).filter((e) => e.includes("answers.events") && e.endsWith(".ndjson")).length;
    expect(opened).toBeLessThanOrEqual(64);
  });

  it("A10: a request written between the memo read and the baseline probe is not hidden by carried answers-only ticks", async () => {
    __clearAnswerEventsCacheForTests();
    const root = makeRoot();
    const eventsDir = await answerEventsDirFor(root);
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.requests.json", JSON.stringify({ username: "alice", referralRequests: [] }));
    await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01"]));
    await loadAllEmployeeRequestFiles(root, MONTH); // view mounts BEFORE the first probe
    await writeRawFile(answersDir, "alice.requests.json", JSON.stringify({ username: "alice", referralRequests: [{ requestId: "r-remote" }] }));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // silent baseline swallows the change
    for (const ids of [["e01", "e02"], ["e01", "e02", "e03"]]) {
      await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(ids));
      expect([...(await runSync({ directoryHandle: root, monthFolderName: MONTH })).changed]).toEqual(["answers"]);
    }
    const files = await loadAllEmployeeRequestFiles(root, MONTH);
    expect(files.find((f) => f.username === "alice")?.referralRequests?.map((r) => r.requestId)).toContain("r-remote");
  });

  it("A9: a per-employee requests file change is reported as requests (it had no probe of its own)", async () => {
    const root = makeRoot();
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.requests.json", "[]");
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    await writeRawFile(answersDir, "alice.requests.json", '[{"requestId":"r1"}]');
    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect([...changed]).toEqual(["requests"]);
  });

  it("reports nothing on a tick where the answer segments genuinely did not change", async () => {
    const root = makeRoot();
    const eventsDir = await answerEventsDirFor(root);
    await writeRawFile(eventsDir, "a1-ans-devA-s1.ndjson", answerSegment(["e01"]));
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    const { changed } = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(changed.size).toBe(0);
  });
});

describe("runSync — this session's own answer appends do not report the answers family (A1)", () => {
  function answer(xrayImageId: string): ItemAnswer {
    return {
      xrayImageId,
      templateId: "tpl",
      templateVersion: 1,
      answers: [{ fieldId: "f1", value: "v" }],
      lastSavedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      answeredBy: "emp1",
      status: "submitted",
    };
  }

  beforeEach(() => {
    // Storage is cleared between tests but the chain memo is module-level: reset it
    // so each test mints its chain into (and reloads it from) the same storage.
    __resetAnswerSegmentChainMemoForTests();
    writeSession({ role: "employee", username: "emp1", loginAt: new Date().toISOString() });
  });
  afterEach(() => clearSession());

  it("stays quiet for an own save, and still reports another writer's segment", async () => {
    const root = makeRoot();
    // First save also freezes the legacy shell (answerStorage section 8), so do
    // it before the baseline: only the event append is under test.
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-2"))).ok).toBe(true);
    const own = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(own.changed.has("answers")).toBe(false);

    const main = await getSampleMainDir(root, MONTH, true);
    const eventsDir = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    await writeRawFile(
      eventsDir,
      "zz-ans-otherdev-s9.ndjson",
      `${JSON.stringify({ eventId: "other-1", eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: "emp2", authority: "self", xrayImageId: "XR-9", answers: [], status: "draft", answeredBy: "emp2" })}\n`
    );
    const epochBefore = getSealedAnswerSegmentsEpoch();
    const other = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(other.changed.has("answers")).toBe(true);
    // A4: a colleague's NEW segment unseals nothing, so it must not make the
    // reader forget every sealed confirmation any more (that made the next save
    // re-stat every sealed segment of the month).
    expect(getSealedAnswerSegmentsEpoch()).toBe(epochBefore);
  });

  it("A4: a probed size change of a segment invalidates exactly that name; a sealed segment that grows is re-opened", async () => {
    const root = makeRoot("sealed-names", true);
    const main = await getSampleMainDir(root, MONTH, true);
    const eventsDir = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    const ev = (id: string): string =>
      `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: "emp2", authority: "self", xrayImageId: `XR-${id}`, answers: [], status: "draft", answeredBy: "emp2" })}\n`;
    for (const chain of ["a", "b"]) {
      await writeRawFile(eventsDir, `ans-dev-${chain}-s${chain}.ndjson`, ev(`${chain}0`));
      await writeRawFile(eventsDir, `ans-dev-${chain}-s${chain}-1.ndjson`, ev(`${chain}1`));
    }
    await readAllAnswerEventsForMonth(root, MONTH);
    await readAllAnswerEventsForMonth(root, MONTH); // both seq0 confirmed sealed
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    // Bytes land in a confirmed-sealed segment (the late-append hazard).
    const before = await (await (await eventsDir.getFileHandle("ans-dev-a-sa.ndjson")).getFile()).text();
    await writeRawFile(eventsDir, "ans-dev-a-sa.ndjson", before + ev("LATE"));
    const epochBefore = getSealedAnswerSegmentsEpoch();
    const tick = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(tick.changed.has("answers")).toBe(true);
    expect(getSealedAnswerSegmentsEpoch()).toBe(epochBefore); // not a wholesale wipe...
    clearReadLog(root);
    expect((await readAllAnswerEventsForMonth(root, MONTH)).map((e) => e.eventId)).toContain("LATE"); // ...yet not missed
    const reads = getReadLog(root);
    expect(reads.some((e) => e.endsWith("ans-dev-a-sa.ndjson"))).toBe(true);
    expect(reads.some((e) => e.endsWith("ans-dev-b-sb.ndjson"))).toBe(false); // untouched sealed segment stays skipped
  });

  it("a manual refresh also forgets sealed-segment confirmations", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH });
    const epochBefore = getSealedAnswerSegmentsEpoch();
    await runSync({ directoryHandle: root, monthFolderName: MONTH, manual: true });
    expect(getSealedAnswerSegmentsEpoch()).toBeGreaterThan(epochBefore);
  });

  it("after a RELOAD the first own save is still quiet (the stable chain outlives the page)", async () => {
    const root = makeRoot();
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    // A page reload: every module-level memo is gone, the persisted chain is not.
    __resetAppendOnlyEventLogMemosForTests();
    __resetAnswerSegmentChainMemoForTests();
    __clearAnswerEventsCacheForTests();
    __resetWorkspaceSyncStateForTests();
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-2"))).ok).toBe(true);
    const own = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(own.changed.has("answers")).toBe(false);
  });

  it("a rotation of this user's stable chain from an earlier page load is excluded too", async () => {
    const root = makeRoot();
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    const main = await getSampleMainDir(root, MONTH, true);
    const eventsDir = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    const names: string[] = [];
    for await (const handle of (eventsDir as unknown as { values(): AsyncIterable<{ name: string }> }).values()) names.push(handle.name);
    const seq0 = names.find((n) => n.endsWith(".ndjson"))!;
    const rotated = seq0.replace(/\.ndjson$/, "-1.ndjson");
    __resetAppendOnlyEventLogMemosForTests();
    __resetAnswerSegmentChainMemoForTests();
    __resetWorkspaceSyncStateForTests();
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline
    await writeRawFile(eventsDir, rotated, `${JSON.stringify({ eventId: "rot-1", eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: "emp1", authority: "self", xrayImageId: "XR-3", answers: [], status: "draft", answeredBy: "emp1" })}\n`);
    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(result.changed.has("answers")).toBe(false);
  });

  it("another user's chain on the same browser is still reported to this user", async () => {
    const root = makeRoot();
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline
    expect((await upsertItemAnswer(root, MONTH, "someone-else", { ...answer("XR-7"), answeredBy: "someone-else" })).ok).toBe(true);
    const result = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(result.changed.has("answers")).toBe(true);
  });
});
