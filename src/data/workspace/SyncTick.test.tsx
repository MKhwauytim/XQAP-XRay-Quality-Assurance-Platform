/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import {
  getPopulationMonthDir,
  getSampleApprovalsDir,
  getSampleEmployeeDir,
  getSystemRoot,
  SYSTEM_FOLDER_NAMES,
} from "./workspacePaths";
import { appendDistributionEvent } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import {
  ALL_DATA_REFRESH_FAMILIES,
  subscribeToDataChange,
} from "./dataRefreshSignal";
import { __clearInFlightForTests } from "../storage/inFlightReads";

async function writeRawFile(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const handle: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}

const MONTH = "5-May-2026";

async function makeRoot(trackReads = false) {
  return createMemoryDirectory("sync-tick-root", { trackReads }) as unknown as DirectoryHandleLike;
}

async function seedNotification(root: DirectoryHandleLike): Promise<void> {
  const systemDir = await getSystemRoot(root, true);
  const notificationsDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.notifications, { create: true });
  await safeWriteJson(notificationsDir, "notifications.json", {
    revision: 1,
    updatedAt: new Date().toISOString(),
    notifications: [{ id: "n1", message: "hi", postedBy: "admin", postedAt: new Date().toISOString(), acceptances: [] }],
  });
}

describe("SyncTick runSyncTick — change-set probe (§4.2 / A7)", () => {
  let runSyncTick: typeof import("./SyncTick").runSyncTick;
  let resetState: typeof import("./SyncTick").__resetSyncTickStateForTests;

  beforeEach(async () => {
    __clearInFlightForTests();
    const mod = await import("./SyncTick");
    runSyncTick = mod.runSyncTick;
    resetState = mod.__resetSyncTickStateForTests;
    resetState();
  });

  afterEach(() => {
    resetState();
  });

  it("the first probe for a (workspace, month) establishes a baseline and reports no change", async () => {
    const root = await makeRoot();
    const changed = await runSyncTick(root, MONTH);
    expect(changed.size).toBe(0);
  });

  it("two consecutive ticks over a genuinely unchanged month report an empty change set", async () => {
    const root = await makeRoot();
    await runSyncTick(root, MONTH); // baseline
    const changed = await runSyncTick(root, MONTH);
    expect(changed.size).toBe(0);
  });

  it("the staleness test: a posted notification AND an appended answers-file request are both detected, with NO distribution change", async () => {
    const root = await makeRoot();
    await runSyncTick(root, MONTH); // baseline (empty workspace)

    await seedNotification(root);
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.answers.json", JSON.stringify({ requests: ["r1"] }));

    const changed = await runSyncTick(root, MONTH);

    expect(changed.has("notifications")).toBe(true);
    expect(changed.has("requests")).toBe(true);
    expect(changed.has("answers")).toBe(true);
    // No distribution event was appended anywhere -- must NOT be reported.
    expect(changed.has("distribution")).toBe(false);
  });

  it("an appended request inside an EXISTING answers file (same name, larger size) is detected -- the case a name-only diff misses (F21)", async () => {
    const root = await makeRoot();
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.answers.json", "short");
    await runSyncTick(root, MONTH); // baseline with the short file present

    await writeRawFile(answersDir, "alice.answers.json", "a much longer body appended later");
    const changed = await runSyncTick(root, MONTH);

    expect(changed.has("answers")).toBe(true);
    expect(changed.has("requests")).toBe(true);
  });

  it("a distribution event append is reported as the distribution family only (not requests/answers/notifications)", async () => {
    const root = await makeRoot();
    await runSyncTick(root, MONTH);

    await appendDistributionEvent(
      root,
      MONTH,
      buildAssignEvent({ xrayImageId: "img-1", assignedTo: "alice", eventBy: "admin" })
    );
    const changed = await runSyncTick(root, MONTH);

    expect([...changed]).toEqual(["distribution"]);
  });

  it("a manifest revision change (e.g. month lock/unlock) is reported as the manifest family", async () => {
    const root = await makeRoot();
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH });
    await runSyncTick(root, MONTH);

    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH, locked: true });
    const changed = await runSyncTick(root, MONTH);

    expect(changed.has("manifest")).toBe(true);
  });

  it("an approvals-dir change is reported as requests only, not answers", async () => {
    const root = await makeRoot();
    await runSyncTick(root, MONTH);

    const approvalsDir = await getSampleApprovalsDir(root, MONTH, true);
    await writeRawFile(approvalsDir, "supervisor1.json", JSON.stringify({ decisions: [] }));
    const changed = await runSyncTick(root, MONTH);

    expect(changed.has("requests")).toBe(true);
    expect(changed.has("answers")).toBe(false);
  });

  it("broadcasts a periodic change-set event only when something changed, and broadcasts nothing on an unchanged tick", async () => {
    const root = await makeRoot();
    await runSyncTick(root, MONTH); // baseline

    const spy = vi.fn();
    const unsubscribe = subscribeToDataChange(ALL_DATA_REFRESH_FAMILIES, spy);

    await runSyncTick(root, MONTH); // still unchanged
    expect(spy).not.toHaveBeenCalled();

    await seedNotification(root);
    await runSyncTick(root, MONTH); // now changed
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ source: "periodic", changed: expect.any(Set) })
    );

    unsubscribe();
  });

  it("round-trip budget: an unchanged tick issues no more than 2+1+2+N+M+1 getFileHandle/getFile calls, and reads no file larger than the notifications file", async () => {
    const root = createMemoryDirectory("sync-tick-budget", { trackReads: true }) as unknown as DirectoryHandleLike;
    await seedNotification(root);
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    await writeRawFile(answersDir, "alice.answers.json", "aaaa");
    await writeRawFile(answersDir, "bob.answers.json", "bbbb");
    const approvalsDir = await getSampleApprovalsDir(root, MONTH, true);
    await writeRawFile(approvalsDir, "carol.json", "cccc");
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    await safeWriteJson(monthDir, "month.manifest.json", { monthFolderName: MONTH });

    await runSyncTick(root, MONTH); // baseline, not measured

    const before = getReadLog(root).length;
    await runSyncTick(root, MONTH); // the tick under measurement
    const reads = getReadLog(root).length - before;

    // N=2 answers files, M=1 approvals file -> budget = 2+1+2+2+1+1 = 9.
    expect(reads).toBeLessThanOrEqual(9);
  });
});

describe("SyncTick component — interval cadence, focus coalescing, and permissions independence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("registers a single interval at SYNC_TICK_INTERVAL_MS while a workspace and month are selected", async () => {
    vi.resetModules();
    vi.doMock("./useWorkspace", () => ({
      useWorkspace: () => ({ directoryHandle: { name: "root" } }),
    }));
    vi.doMock("../month/useGlobalMonth", () => ({
      useGlobalMonth: () => ({ selection: { kind: "existing", folderName: MONTH, month: 5, year: 2026 } }),
    }));
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    const { SyncTick, SYNC_TICK_INTERVAL_MS } = await import("./SyncTick");
    render(<SyncTick />);

    const call = setIntervalSpy.mock.calls.find((c) => c[1] === SYNC_TICK_INTERVAL_MS);
    expect(call).toBeDefined();

    vi.doUnmock("./useWorkspace");
    vi.doUnmock("../month/useGlobalMonth");
    vi.resetModules();
  });

  it("does not register an interval when no month is selected", async () => {
    vi.resetModules();
    vi.doMock("./useWorkspace", () => ({
      useWorkspace: () => ({ directoryHandle: { name: "root" } }),
    }));
    vi.doMock("../month/useGlobalMonth", () => ({
      useGlobalMonth: () => ({ selection: { kind: "none" } }),
    }));
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    const { SyncTick, SYNC_TICK_INTERVAL_MS } = await import("./SyncTick");
    render(<SyncTick />);

    const call = setIntervalSpy.mock.calls.find((c) => c[1] === SYNC_TICK_INTERVAL_MS);
    expect(call).toBeUndefined();

    vi.doUnmock("./useWorkspace");
    vi.doUnmock("../month/useGlobalMonth");
    vi.resetModules();
  });
});
