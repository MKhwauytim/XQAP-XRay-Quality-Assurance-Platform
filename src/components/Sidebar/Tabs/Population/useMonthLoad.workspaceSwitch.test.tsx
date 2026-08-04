/* @vitest-environment jsdom */
// Regression test for the workspace-switch data leak: the reload guard
// previously keyed only on month-folder NAME, so connecting to a different
// workspace whose current month folder happens to share a name with the
// previous workspace's would skip reloading, leaving the prior workspace's
// data on screen under the new workspace's identity.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { GlobalMonthSelection } from "../../../../data/month/globalMonthLogic";
import type { MonthEditData, MonthLoadScope } from "../../../../data/population/populationStorage";
import { resetBootProgress, useBootProgress } from "../../../../data/workspace/bootProgress";

const MONTH_FOLDER = "5-May-2026";

const loadCalls = vi.hoisted(() => ({ list: [] as DirectoryHandleLike[] }));

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
};

vi.mock("../../../../data/population/populationStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/population/populationStorage")>();
  return {
    ...actual,
    loadMonthForEditing: vi.fn(async (dir: DirectoryHandleLike) => {
      loadCalls.list.push(dir);
      return emptyMonthEditData;
    }),
  };
});

import { loadMonthForEditing } from "../../../../data/population/populationStorage";
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

// A stable object reference (not recreated on every render) -- mirrors the
// real GlobalMonthProvider, whose `selection` is `useState`-backed and only
// gets a new reference when the selection itself actually changes, never on
// an unrelated re-render (e.g. useMonthLoad's own isLoadingMonthData flips).
// A fresh object per render would make useMonthLoad's effect (keyed on
// [directoryHandle, globalMonth]) re-run on every such re-render too --
// harmless while a load succeeds (the loadedRef guard short-circuits it), but
// it would race the boot-progress-error test below against the hook's
// intentional retry-on-failure behavior (loadedRef.current is cleared after a
// failed load specifically so re-selecting the month retries it).
const EXISTING_SELECTION: GlobalMonthSelection = { kind: "existing", folderName: MONTH_FOLDER, month: 5, year: 2026 };

function renderMonthLoad(
  directoryHandle: DirectoryHandleLike,
  overrides?: {
    computeScope?: () => MonthLoadScope;
    onLoadError?: (message: string) => void;
  }
) {
  return renderHook(
    (props: { directoryHandle: DirectoryHandleLike }) =>
      useMonthLoad({
        directoryHandle: props.directoryHandle,
        globalMonth: EXISTING_SELECTION,
        registerMonthChangeGuard: () => () => {},
        computeScope:
          overrides?.computeScope ??
          (() => ({ summary: true, population: true, raw: false, sample: true, distribution: true })),
        applyLoadedState: () => {},
        resetWizardState: () => {},
        onLoadError: overrides?.onLoadError ?? (() => {}),
      }),
    { initialProps: { directoryHandle } }
  );
}

describe("useMonthLoad — workspace-switch reload", () => {
  afterEach(() => {
    cleanup();
    loadCalls.list = [];
    vi.clearAllMocks();
    resetBootProgress();
  });

  it("reloads when the workspace changes even though the month folder name is unchanged", async () => {
    const workspaceA = makeDirectoryHandle("workspace-a");
    const workspaceB = makeDirectoryHandle("workspace-b");

    const { rerender } = renderMonthLoad(workspaceA);
    await waitFor(() => expect(loadCalls.list).toHaveLength(1));
    expect(loadCalls.list[0]).toBe(workspaceA);

    // Same month folder name (MONTH_FOLDER), but a DIFFERENT workspace handle.
    act(() => rerender({ directoryHandle: workspaceB }));

    await waitFor(() => expect(loadCalls.list).toHaveLength(2));
    expect(loadCalls.list[1]).toBe(workspaceB);
  });

  it("does not reload when neither the workspace nor the month folder changed", async () => {
    const workspaceA = makeDirectoryHandle("workspace-a");
    const { rerender } = renderMonthLoad(workspaceA);
    await waitFor(() => expect(loadCalls.list).toHaveLength(1));

    act(() => rerender({ directoryHandle: workspaceA }));
    // Give any accidental async reload a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadCalls.list).toHaveLength(1);
  });
});

// Boot-progress instrumentation: useMonthLoad's existing loadMonthForEditing
// call must report to the post-login source checklist (bootProgress.ts)
// without changing what it actually loads. See computeMonthLoadScope
// (populationWorkflowHelpers.ts) for the summary/sample/distribution-always,
// population/raw-conditional scope this mirrors.
describe("useMonthLoad — boot-progress reporting", () => {
  afterEach(() => {
    cleanup();
    loadCalls.list = [];
    vi.clearAllMocks();
    resetBootProgress();
  });

  const ALWAYS_KEYS = [
    "population_manifest",
    "population_summary",
    "population_sample",
    "population_distribution",
  ];

  it("registers and marks loaded the always-on sources plus population_final when scope.population is true", async () => {
    const workspaceA = makeDirectoryHandle("workspace-a");
    const { result } = renderHook(() => useBootProgress());

    renderMonthLoad(workspaceA, {
      computeScope: () => ({ summary: true, population: true, raw: false, sample: true, distribution: true }),
    });

    await waitFor(() => expect(loadCalls.list).toHaveLength(1));
    await waitFor(() => expect(result.current.allLoaded).toBe(true));

    const keys = result.current.entries.map((entry) => entry.key);
    expect(keys).toEqual(expect.arrayContaining([...ALWAYS_KEYS, "population_final"]));
    expect(keys).not.toContain("population_raw");
    expect(result.current.entries.every((entry) => entry.status === "loaded")).toBe(true);
  });

  it("registers and marks loaded population_raw (in addition to population_final) when scope.raw is also true", async () => {
    const workspaceA = makeDirectoryHandle("workspace-a");
    const { result } = renderHook(() => useBootProgress());

    renderMonthLoad(workspaceA, {
      computeScope: () => ({ summary: true, population: true, raw: true, sample: true, distribution: true }),
    });

    await waitFor(() => expect(loadCalls.list).toHaveLength(1));
    await waitFor(() => expect(result.current.allLoaded).toBe(true));

    const keys = result.current.entries.map((entry) => entry.key);
    expect(keys).toEqual(expect.arrayContaining([...ALWAYS_KEYS, "population_final", "population_raw"]));
    expect(result.current.entries.every((entry) => entry.status === "loaded")).toBe(true);
  });

  it("omits population_final and population_raw when scope excludes both (e.g. a Browse-only viewer)", async () => {
    const workspaceA = makeDirectoryHandle("workspace-a");
    const { result } = renderHook(() => useBootProgress());

    renderMonthLoad(workspaceA, {
      computeScope: () => ({ summary: true, population: false, raw: false, sample: true, distribution: true }),
    });

    await waitFor(() => expect(loadCalls.list).toHaveLength(1));
    await waitFor(() => expect(result.current.allLoaded).toBe(true));

    const keys = result.current.entries.map((entry) => entry.key);
    expect(keys).toEqual(expect.arrayContaining(ALWAYS_KEYS));
    expect(keys).not.toContain("population_final");
    expect(keys).not.toContain("population_raw");
    expect(result.current.entries).toHaveLength(ALWAYS_KEYS.length);
  });

  it("marks every registered source as error, carrying the failure message, when the load rejects", async () => {
    const workspaceA = makeDirectoryHandle("workspace-a");
    const failure = new Error("disk read failed");
    vi.mocked(loadMonthForEditing).mockRejectedValueOnce(failure);

    const { result } = renderHook(() => useBootProgress());
    const onLoadError = vi.fn();

    renderMonthLoad(workspaceA, {
      computeScope: () => ({ summary: true, population: true, raw: false, sample: true, distribution: true }),
      onLoadError,
    });

    // The existing failure handling (logError + resetForNewMonth + onLoadError)
    // must still fire unchanged -- confirms the rethrow in the new catch block
    // didn't swallow or alter the original error path.
    await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
    expect(onLoadError).toHaveBeenCalledWith("تعذر تحميل بيانات الشهر — أعد المحاولة");
    // markBootSourceError's Map update is synchronous, but the store's React
    // subscribers re-render on their own tick -- wait for that before reading
    // `result.current` (error is terminal too, so allLoaded flips to true).
    await waitFor(() => expect(result.current.allLoaded).toBe(true));

    const keys = result.current.entries.map((entry) => entry.key);
    expect(keys).toEqual(expect.arrayContaining([...ALWAYS_KEYS, "population_final"]));
    expect(result.current.entries.every((entry) => entry.status === "error")).toBe(true);
    expect(result.current.entries.every((entry) => entry.error === "disk read failed")).toBe(true);
  });
});
