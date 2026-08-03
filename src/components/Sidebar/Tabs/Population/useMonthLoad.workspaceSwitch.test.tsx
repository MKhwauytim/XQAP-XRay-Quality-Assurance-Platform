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
import type { MonthEditData } from "../../../../data/population/populationStorage";

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

function existingSelection(): GlobalMonthSelection {
  return { kind: "existing", folderName: MONTH_FOLDER, month: 5, year: 2026 };
}

function renderMonthLoad(directoryHandle: DirectoryHandleLike) {
  return renderHook(
    (props: { directoryHandle: DirectoryHandleLike }) =>
      useMonthLoad({
        directoryHandle: props.directoryHandle,
        globalMonth: existingSelection(),
        registerMonthChangeGuard: () => () => {},
        computeScope: () => ({ summary: true, population: true, raw: false, sample: true, distribution: true }),
        applyLoadedState: () => {},
        resetWizardState: () => {},
        onLoadError: () => {},
      }),
    { initialProps: { directoryHandle } }
  );
}

describe("useMonthLoad — workspace-switch reload", () => {
  afterEach(() => {
    cleanup();
    loadCalls.list = [];
    vi.clearAllMocks();
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
