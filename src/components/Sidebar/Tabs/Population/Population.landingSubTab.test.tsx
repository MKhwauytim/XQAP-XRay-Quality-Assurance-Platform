/* @vitest-environment jsdom */
// A1 regression coverage (perf/sync enhancement 2026-08-12,
// docs/architecture/PERF_SYNC_ENHANCEMENT_2026-08-12.md §A1): the Population
// tab's landing sub-tab must be exactly
//
//   can("view-browse") && (canMutate("draw-sample") || canMutate("process-population"))
//     ? "browse" : "process"
//
// -- both clauses load-bearing. Without can("view-browse") the user lands on
// the "غير مصرح" placeholder instead of a usable page. Without the capability
// clause, a view-only employee/guest would pay BrowseDataView's unconditional
// full population.final read on mount (BrowseDataView.tsx has no
// already-loaded guard on its load effect), which computeMonthLoadScope
// (populationWorkflowHelpers.ts) never requests for them on the "process"
// sub-tab. This is the exact matrix cited by A1's own DONE criteria.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { MonthLoadScope } from "../../../../data/population/populationStorage";

vi.mock("../../../../workers/workbookWorker?worker&inline", () => ({
  default: class WorkerStub {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  },
}));

// BrowseDataView is mocked to a bare marker so this suite can assert purely
// on WHETHER/WHEN it mounts (and never touches the real query worker), the
// same pattern Population.browseMountPreservation.test.tsx already uses.
const browseMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./BrowseDataView", () => ({
  default: () => {
    browseMounts.count += 1;
    return <div data-testid="view-browse" />;
  },
}));

const permissionsMock = vi.hoisted(() => ({
  state: { canViewBrowse: true, canDrawSample: false, canProcessPopulation: false },
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: (featureId: string) => (featureId === "view-browse" ? permissionsMock.state.canViewBrowse : true),
    canMutate: (featureId: string) => {
      if (featureId === "draw-sample") return permissionsMock.state.canDrawSample;
      if (featureId === "process-population") return permissionsMock.state.canProcessPopulation;
      return true;
    },
  }),
}));

const FOLDER = "5-may-2026";

type MockSelection =
  | { kind: "existing"; month: number; year: number; folderName: string }
  | { kind: "none" };

const monthMock = vi.hoisted(() => ({
  state: { selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" } as MockSelection },
}));

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: FOLDER }],
    selection: monthMock.state.selection,
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

const workspaceMock = vi.hoisted(() => ({ state: { directoryHandle: null as unknown } }));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspaceMock.state.directoryHandle }),
}));

const capturedScopes = vi.hoisted(() => ({ calls: [] as Array<MonthLoadScope | undefined> }));
const rawTextCalls = vi.hoisted(() => ({ count: 0 }));
const browseRowsCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../../../data/population/populationStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/population/populationStorage")>();
  return {
    ...actual,
    loadMonthForEditing: (dir: DirectoryHandleLike, folderName: string, scope?: MonthLoadScope) => {
      capturedScopes.calls.push(scope);
      return actual.loadMonthForEditing(dir, folderName, scope);
    },
    loadMonthPopulationFinalRawText: (...args: Parameters<typeof actual.loadMonthPopulationFinalRawText>) => {
      rawTextCalls.count += 1;
      return actual.loadMonthPopulationFinalRawText(...args);
    },
    loadBrowseRows: (...args: Parameters<typeof actual.loadBrowseRows>) => {
      browseRowsCalls.count += 1;
      return actual.loadBrowseRows(...args);
    },
  };
});

import { saveMonthRun } from "../../../../data/population/populationStorage";
import PopulationTab from "./index";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  permissionsMock.state = { canViewBrowse: true, canDrawSample: false, canProcessPopulation: false };
  monthMock.state.selection = { kind: "existing", month: 5, year: 2026, folderName: FOLDER };
  workspaceMock.state.directoryHandle = null;
  capturedScopes.calls = [];
  rawTextCalls.count = 0;
  browseRowsCalls.count = 0;
  browseMounts.count = 0;
});

async function seedProcessedMonth(): Promise<DirectoryHandleLike> {
  const dir = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  await saveMonthRun({
    directoryHandle: dir,
    month: 5,
    year: 2026,
    username: "tester",
    riskFileName: null,
    biFileName: null,
    certScanUsed: false,
    riskRawRows: [],
    biRawRows: [],
    processedRows: [{ xrayImageId: "A001" }],
    certScanRows: 0,
    nonCertScanRows: 1,
  });
  return dir;
}

function hasPhaseStepper(): boolean {
  return document.querySelector(".phase-stepper") !== null;
}

describe("PopulationTab — A1 conditional landing sub-tab (perf/sync enhancement 2026-08-12)", () => {
  it("an employee session (no draw-sample, no process-population) lands on process, never mounts Browse, and triggers no Browse read", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    permissionsMock.state = { canViewBrowse: true, canDrawSample: false, canProcessPopulation: false };
    const dir = await seedProcessedMonth();
    workspaceMock.state.directoryHandle = dir;

    await act(async () => {
      render(<PopulationTab />);
      await Promise.resolve();
    });

    await waitFor(() => expect(capturedScopes.calls.length).toBeGreaterThan(0));
    expect(hasPhaseStepper()).toBe(true);
    expect(browseMounts.count).toBe(0);
    expect(rawTextCalls.count).toBe(0);
    expect(browseRowsCalls.count).toBe(0);
  });

  it("a manager session (view-browse + draw-sample) lands on browse, with population deferred", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    permissionsMock.state = { canViewBrowse: true, canDrawSample: true, canProcessPopulation: false };
    const dir = await seedProcessedMonth();
    workspaceMock.state.directoryHandle = dir;

    await act(async () => {
      render(<PopulationTab />);
      await Promise.resolve();
    });

    expect(browseMounts.count).toBe(1);
    expect(hasPhaseStepper()).toBe(false);

    await waitFor(() => expect(capturedScopes.calls.length).toBeGreaterThan(0));
    expect(capturedScopes.calls[0]?.population).toBe(false);
  });

  it("a session holding draw-sample but WITHOUT view-browse lands on process, not the unauthorized placeholder", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    permissionsMock.state = { canViewBrowse: false, canDrawSample: true, canProcessPopulation: false };
    const dir = await seedProcessedMonth();
    workspaceMock.state.directoryHandle = dir;

    await act(async () => {
      render(<PopulationTab />);
      await Promise.resolve();
    });

    await waitFor(() => expect(capturedScopes.calls.length).toBeGreaterThan(0));
    expect(hasPhaseStepper()).toBe(true);
    expect(browseMounts.count).toBe(0);
    expect(document.querySelector(".placeholder-phase")).toBeNull();
  });
});
