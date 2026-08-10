/* @vitest-environment jsdom */
// Regression coverage for the Sync-extension periodic/manual background-refresh
// subscriber added to useMonthLoad (Task 6 of the 2026-08-04
// boot-splash-and-sync-extension plan): Population was the only major
// workspace-reading view with zero subscription to dataRefreshSignal.ts
// (src/data/workspace/) -- a sample redraw, distribution action, or
// replacement made elsewhere never showed up without navigating away and
// back. These tests exercise the hook directly (renderHook), mirroring
// useMonthLoad.workspaceSwitch.test.tsx's shape, rather than mounting the
// full PopulationTab -- the behavior under test lives entirely inside the hook.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { GlobalMonthSelection } from "../../../../data/month/globalMonthLogic";
import type { MonthEditData } from "../../../../data/population/populationStorage";
import type { DistributionCurrentData } from "../../../../data/distribution/distributionTypes";
import { broadcastDataRefresh } from "../../../../data/workspace/dataRefreshSignal";
import { resetBootProgress, useBootProgress } from "../../../../data/workspace/bootProgress";

const MONTH_FOLDER = "5-May-2026";

const loadMock = vi.hoisted(() => ({ fn: vi.fn() }));

const emptyMonthEditData: MonthEditData = {
  populationRows: null,
  certScanRows: 0,
  nonCertScanRows: 0,
  riskRawRows: [],
  biRawRows: [],
  processingSummary: null,
  sampleData: null,
  distributionCurrent: null,
  manifest: null,
  populationLocked: false,
  populationAggregate: null,
};

// A distinguishable snapshot whose distributionCurrent presence derives phase
// 4 (see derivePhase, populationWorkflowHelpers.ts) -- used to prove a SILENT
// reload's applyLoadedState call strips phase (never snaps the wizard's step
// navigation back), unlike a real load of the exact same data would.
const distributionCurrentData: DistributionCurrentData = {
  monthFolderName: MONTH_FOLDER,
  derivedAt: new Date().toISOString(),
  totalAssigned: 1,
  totalCompleted: 0,
  totalReplaced: 0,
  totalPending: 1,
  entries: [],
};
const phaseFourEditData: MonthEditData = {
  ...emptyMonthEditData,
  distributionCurrent: distributionCurrentData,
};

vi.mock("../../../../data/population/populationStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/population/populationStorage")>();
  return {
    ...actual,
    loadMonthForEditing: loadMock.fn,
  };
});

import { useMonthLoad } from "./useMonthLoad";

function makeDirectoryHandle(name: string): DirectoryHandleLike {
  return {
    kind: "directory",
    name,
    getFileHandle: async () => {
      throw new Error("not used in this test");
    },
    getDirectoryHandle: async () => {
      throw new Error("not used in this test");
    },
  };
}

const EXISTING_SELECTION: GlobalMonthSelection = { kind: "existing", folderName: MONTH_FOLDER, month: 5, year: 2026 };

function renderMonthLoad(directoryHandle: DirectoryHandleLike, overrides?: { isWizardBusyRef?: { current: boolean } }) {
  const applyLoadedState = vi.fn();
  const hookResult = renderHook(() =>
    useMonthLoad({
      directoryHandle,
      globalMonth: EXISTING_SELECTION,
      registerMonthChangeGuard: () => () => {},
      computeScope: () => ({ summary: true, population: false, raw: false, sample: true, distribution: true }),
      applyLoadedState,
      resetWizardState: () => {},
      onLoadError: () => {},
      isWizardBusyRef: overrides?.isWizardBusyRef,
    })
  );
  return { ...hookResult, applyLoadedState };
}

describe("useMonthLoad — periodic/manual background refresh (Sync extension, Task 6)", () => {
  afterEach(() => {
    cleanup();
    loadMock.fn.mockReset();
    resetBootProgress();
  });

  it("reloads the currently-loaded month, silently, when a periodic data-refresh event fires", async () => {
    loadMock.fn.mockResolvedValue(emptyMonthEditData);
    const workspace = makeDirectoryHandle("ws-periodic");
    const { result, applyLoadedState } = renderMonthLoad(workspace);

    await waitFor(() => expect(loadMock.fn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoadingMonthData).toBe(false));

    loadMock.fn.mockResolvedValue(phaseFourEditData);
    act(() => {
      broadcastDataRefresh("periodic");
    });

    await waitFor(() => expect(loadMock.fn).toHaveBeenCalledTimes(2));
    // Never flips the loading flag -- a real (non-silent) load always does,
    // which would withdraw every mutating capability and show the
    // "جاري تحميل بيانات الشهر" banner across the wizard (index.tsx).
    expect(result.current.isLoadingMonthData).toBe(false);

    // The silent call's applyLoadedState must NOT carry the phase 4 the fresh
    // distributionCurrent snapshot on its own would derive -- proven by
    // seeding a snapshot that WOULD derive phase 4 and confirming it's
    // stripped to null on this (second, silent) call specifically. The
    // underlying distribution data itself IS still refreshed in place.
    await waitFor(() => expect(applyLoadedState).toHaveBeenCalledTimes(2));
    expect(applyLoadedState.mock.calls[1][0].phase).toBeNull();
    expect(applyLoadedState.mock.calls[1][0].distribution).toEqual(distributionCurrentData);
  });

  // The subscriber's own in-flight-load guard (loadInFlightRef, useMonthLoad.ts)
  // legitimately drops a refresh tick that arrives while a load is still in
  // flight -- so this test must wait for the INITIAL load to fully settle
  // (isLoadingMonthData back to false) before broadcasting, exactly like the
  // sibling "periodic" test above already does. Skipping that wait made the
  // test race real, deterministic application logic and lose intermittently;
  // that was once misdiagnosed as CPU-contention flakiness and "fixed" by
  // widening both timeouts (since reverted -- widened timeouts only hid the
  // race and would have made a genuine future regression take 10s to fail).
  it("also reloads on a 'manual' source event (matches XrayReferrals.tsx/XrayInspectionResults.tsx: neither view distinguishes the two sources)", async () => {
    loadMock.fn.mockResolvedValue(emptyMonthEditData);
    const workspace = makeDirectoryHandle("ws-manual");
    const { result } = renderMonthLoad(workspace);

    await waitFor(() => expect(loadMock.fn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoadingMonthData).toBe(false));

    act(() => {
      broadcastDataRefresh("manual");
    });

    await waitFor(() => expect(loadMock.fn).toHaveBeenCalledTimes(2));
  });

  it("skips the tick entirely while unsaved in-session work (parsed uploads not yet auto-saved) is pending", async () => {
    loadMock.fn.mockResolvedValue(emptyMonthEditData);
    const workspace = makeDirectoryHandle("ws-unsaved");
    const { result } = renderMonthLoad(workspace);

    await waitFor(() => expect(loadMock.fn).toHaveBeenCalledTimes(1));

    result.current.hasUnsavedSessionWorkRef.current = true;
    act(() => {
      broadcastDataRefresh("periodic");
    });

    // Give any (incorrect) reload a chance to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(loadMock.fn).toHaveBeenCalledTimes(1);
  });

  it("skips the tick entirely while the caller reports the wizard busy (e.g. Phase 3's draw-sample flow writing its own not-yet-persisted result)", async () => {
    loadMock.fn.mockResolvedValue(emptyMonthEditData);
    const workspace = makeDirectoryHandle("ws-busy");
    const isWizardBusyRef = { current: false };
    renderMonthLoad(workspace, { isWizardBusyRef });

    await waitFor(() => expect(loadMock.fn).toHaveBeenCalledTimes(1));

    isWizardBusyRef.current = true;
    act(() => {
      broadcastDataRefresh("periodic");
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(loadMock.fn).toHaveBeenCalledTimes(1);
  });

  it("skips the tick while a real (foreground) load for this month is already in flight, so it can never win the latest-wins token race against it", async () => {
    const releaseGateRef: { current: (() => void) | null } = { current: null };
    const gate = new Promise<void>((resolve) => {
      releaseGateRef.current = resolve;
    });
    loadMock.fn.mockImplementationOnce(async () => {
      await gate;
      return emptyMonthEditData;
    });
    const workspace = makeDirectoryHandle("ws-inflight");
    const { result } = renderMonthLoad(workspace);

    // The initial load is blocked on the gate -- isLoadingMonthData must be true.
    await waitFor(() => expect(result.current.isLoadingMonthData).toBe(true));
    expect(loadMock.fn).toHaveBeenCalledTimes(1);

    act(() => {
      broadcastDataRefresh("periodic");
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Still just the one (still in-flight) call -- the periodic tick must not
    // have queued a second, competing call while the first hasn't resolved.
    expect(loadMock.fn).toHaveBeenCalledTimes(1);

    releaseGateRef.current?.();
    await waitFor(() => expect(result.current.isLoadingMonthData).toBe(false));
  });

  it("never re-touches the boot-progress store on a silent tick, so a checklist the user is already past can't re-flicker", async () => {
    loadMock.fn.mockResolvedValue(emptyMonthEditData);
    const workspace = makeDirectoryHandle("ws-boot");
    const { result: bootResult } = renderHook(() => useBootProgress());
    renderMonthLoad(workspace);

    await waitFor(() => expect(loadMock.fn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(bootResult.current.allLoaded).toBe(true));
    const keysBefore = bootResult.current.entries.map((entry) => entry.key);

    act(() => {
      broadcastDataRefresh("periodic");
    });
    await waitFor(() => expect(loadMock.fn).toHaveBeenCalledTimes(2));

    // Give the store's subscribers a tick to react, if they were (incorrectly) touched.
    await act(async () => {
      await Promise.resolve();
    });
    expect(bootResult.current.entries.map((entry) => entry.key)).toEqual(keysBefore);
    expect(bootResult.current.entries.every((entry) => entry.status === "loaded")).toBe(true);
  });
});
