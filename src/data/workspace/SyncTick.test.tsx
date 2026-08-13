/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { GlobalMonthSelection } from "../month/globalMonthLogic";
import type { WorkspaceStatus } from "./workspaceTypes";

const MONTH = "5-May-2026";

// SyncTick is now nothing but the AUTOMATIC trigger of runSync() -- the probe
// itself is covered in workspaceSync.test.tsx. These tests assert the trigger's
// contract: one timer, installed under the right conditions, never running
// while the tab is hidden, and coalesced against the SHARED last-run stamp so a
// manual button press suppresses an immediately following focus run.
const mocks = vi.hoisted(() => ({
  workspace: {
    directoryHandle: { name: "root" } as unknown as DirectoryHandleLike | null,
    status: "ready" as WorkspaceStatus,
    refreshPermissions: vi.fn(async () => true),
  },
  selection: { kind: "existing", folderName: "5-May-2026", month: 5, year: 2026 } as GlobalMonthSelection,
  runSync: vi.fn(async (_options: { manual?: boolean; monthFolderName: string | null }) => ({
    ran: true,
    ok: true,
    changed: new Set<string>(),
    broadcast: false,
  })),
  lastSyncStartedAt: 0,
}));

vi.mock("./useWorkspace", () => ({
  useWorkspace: () => mocks.workspace,
}));
vi.mock("../month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({ selection: mocks.selection }),
}));
vi.mock("./workspaceSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspaceSync")>()),
  runSync: mocks.runSync,
  getLastSyncStartedAt: () => mocks.lastSyncStartedAt,
}));

import { SyncTick } from "./SyncTick";
import {
  SYNC_TICK_INTERVAL_MS,
  FOCUS_COALESCE_WINDOW_MS,
  refreshSyncIntervalFromDisk,
  __resetWorkspaceSyncStateForTests,
} from "./workspaceSync";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { saveSyncIntervalMs } from "./syncSettings";

function findTick(spy: { mock: { calls: unknown[][] } }): (() => void) | undefined {
  const call = spy.mock.calls.find((entry) => entry[1] === SYNC_TICK_INTERVAL_MS);
  return call?.[0] as (() => void) | undefined;
}

describe("SyncTick — the single automatic trigger", () => {
  beforeEach(() => {
    mocks.workspace.directoryHandle = { name: "root" } as unknown as DirectoryHandleLike;
    mocks.workspace.status = "ready";
    mocks.selection = { kind: "existing", folderName: MONTH, month: 5, year: 2026 } as GlobalMonthSelection;
    mocks.lastSyncStartedAt = 0;
    mocks.runSync.mockClear();
    mocks.workspace.refreshPermissions.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("registers a single interval at SYNC_TICK_INTERVAL_MS while a workspace and month are selected", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<SyncTick />);

    const matching = setIntervalSpy.mock.calls.filter((c) => c[1] === SYNC_TICK_INTERVAL_MS);
    expect(matching).toHaveLength(1);
  });

  it("still registers the interval with NO month selected — permission propagation must not depend on a month (the folded-in AuthGate interval)", () => {
    mocks.selection = { kind: "none" } as GlobalMonthSelection;
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<SyncTick />);

    const tick = findTick(setIntervalSpy);
    expect(tick).toBeDefined();

    tick!();
    expect(mocks.runSync).toHaveBeenCalledWith(
      expect.objectContaining({ monthFolderName: null, refreshPermissions: mocks.workspace.refreshPermissions })
    );
  });

  it("does not register an interval when the workspace is not ready", () => {
    mocks.workspace.status = "idle" as WorkspaceStatus;
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<SyncTick />);

    expect(findTick(setIntervalSpy)).toBeUndefined();
  });

  it("does not register an interval for a disabled (demo/viewer) session", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<SyncTick enabled={false} />);

    expect(findTick(setIntervalSpy)).toBeUndefined();
  });

  it("runs the shared runSync in AUTOMATIC mode, passing the selected month and refreshPermissions", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<SyncTick />);

    findTick(setIntervalSpy)!();

    expect(mocks.runSync).toHaveBeenCalledTimes(1);
    const options = mocks.runSync.mock.calls[0]![0];
    expect(options.manual).toBeUndefined();
    expect(options.monthFolderName).toBe(MONTH);
  });

  it("skips the automatic run entirely while the tab is hidden", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<SyncTick />);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    findTick(setIntervalSpy)!();

    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it("runs once on hidden->visible, but coalesces against the SHARED last-run stamp (a manual press suppresses it)", () => {
    render(<SyncTick />);

    // A run (of either trigger — e.g. the manual button) just happened.
    mocks.lastSyncStartedAt = Date.now();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.runSync).not.toHaveBeenCalled();

    // Outside the coalescing window, the focus run is allowed through.
    mocks.lastSyncStartedAt = Date.now() - FOCUS_COALESCE_WINDOW_MS - 1;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
  });

  it("tears the interval and the visibility listener down on unmount", () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const view = render(<SyncTick />);
    view.unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});

// ── admin-configurable cadence ────────────────────────────────────────────────
// The cadence is stored in the workspace (`syncSettings.ts`) and delivered to
// this component by the sync run itself, so these tests use a REAL memory
// workspace as the directory handle rather than the bare `{ name: "root" }`
// stub above.
describe("SyncTick — re-arms at the workspace's configured cadence", () => {
  beforeEach(() => {
    __resetWorkspaceSyncStateForTests();
    mocks.workspace.status = "ready";
    mocks.selection = { kind: "existing", folderName: MONTH, month: 5, year: 2026 } as GlobalMonthSelection;
    mocks.lastSyncStartedAt = 0;
    mocks.runSync.mockClear();
  });

  afterEach(() => {
    cleanup();
    __resetWorkspaceSyncStateForTests();
    vi.restoreAllMocks();
  });

  it("installs the timer at the stored cadence on mount, not at the 45s default", async () => {
    const root = createMemoryDirectory("cadence-root") as unknown as DirectoryHandleLike;
    await saveSyncIntervalMs(root, 120_000, "admin");
    mocks.workspace.directoryHandle = root;

    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<SyncTick />);
    // Let the on-mount disk read settle and React flush the re-render.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setIntervalSpy.mock.calls.some((call) => call[1] === 120_000)).toBe(true);
  });

  it("re-arms the IN-FLIGHT interval when another client changes the cadence mid-session — no remount, no page reload", async () => {
    const root = createMemoryDirectory("live-rearm-root") as unknown as DirectoryHandleLike;
    mocks.workspace.directoryHandle = root;

    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    render(<SyncTick />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Starts at the default, because nothing is stored yet.
    expect(setIntervalSpy.mock.calls.some((call) => call[1] === SYNC_TICK_INTERVAL_MS)).toBe(true);
    expect(setIntervalSpy.mock.calls.some((call) => call[1] === 300_000)).toBe(false);
    const clearsBefore = clearIntervalSpy.mock.calls.length;

    // Another admin, on another machine, writes a new cadence; this client
    // learns about it on its next sync run (here: driven directly, exactly as
    // the timer would).
    await saveSyncIntervalMs(root, 300_000, "other-admin");
    await act(async () => {
      await refreshSyncIntervalFromDisk(root);
    });

    expect(setIntervalSpy.mock.calls.some((call) => call[1] === 300_000)).toBe(true);
    // The old timer was torn down rather than left running alongside the new one.
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(clearsBefore);
  });

  it("keeps exactly one timer armed after a cadence change", async () => {
    const root = createMemoryDirectory("single-timer-root") as unknown as DirectoryHandleLike;
    mocks.workspace.directoryHandle = root;

    render(<SyncTick />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const setIntervalSpy = vi.spyOn(window, "setInterval");
    await saveSyncIntervalMs(root, 60_000, "admin");
    await act(async () => {
      await refreshSyncIntervalFromDisk(root);
    });

    // Exactly one new interval installed for the new cadence.
    expect(setIntervalSpy.mock.calls.filter((call) => call[1] === 60_000)).toHaveLength(1);
  });
});
