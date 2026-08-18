/* @vitest-environment jsdom */
// End-to-end regression coverage for the Population wizard's demand-gated loading
// (Large-Population Performance Proposal, Phase A steps 3c/3d). Unlike
// populationWorkflowHelpers.test.ts's unit coverage of the pure
// computeMonthLoadScope function, this renders the REAL PopulationTab and
// captures the actual MonthLoadScope argument reaching loadMonthForEditing, so a
// future change to how PopulationTab wires computeScope into useMonthLoad can't
// silently stop calling it, or call it with the wrong capability inputs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, waitFor, act, screen, fireEvent } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { MonthLoadScope } from "../../../../data/population/populationStorage";
import type { PreparedPopulationRow } from "../../../../data/population/populationTypes";

vi.mock("../../../../workers/workbookWorker?worker&inline", () => ({
  default: class WorkerStub {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  },
}));

// PopulationTab keeps BrowseDataView mounted, so this suite spawns the Browse
// query worker even though it asserts nothing about Browse's contents. It uses
// the SAME shared realistic stub as the BrowseDataView suites (macrotask reply,
// serial drain, real `handleWorkerMessage`) rather than a no-op: a no-op stub
// leaves Browse permanently awaiting a "loaded"/"result" that never arrives,
// which is a latent trap for whoever later adds a Browse assertion here.
vi.mock("../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import("./populationQueryWorkerTestStub");
  return { default: createPopulationQueryWorkerStubClass() };
});

const permissionsMock = vi.hoisted(() => ({
  // Defaults to a view-only role (no draw-sample/process-population) --
  // the exact population the original perf complaint targeted.
  // canViewBrowse defaults true; the two capability-holding tests below flip
  // it false so A1's landing rule (perf/sync enhancement 2026-08-12) --
  // can("view-browse") && (draw-sample || process-population) -- keeps them
  // on the "process" sub-tab, which is what this suite's computeScope
  // assertions are actually about (steps 3c/3d), not A1's landing choice
  // itself (covered separately by Population.landingSubTab.test.tsx).
  state: { canDrawSample: false, canProcessPopulation: false, canViewBrowse: true },
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
  state: {
    selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" } as MockSelection,
  },
}));

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: "5-may-2026" }],
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

vi.mock("../../../../data/population/populationStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/population/populationStorage")>();
  return {
    ...actual,
    loadMonthForEditing: (dir: DirectoryHandleLike, folderName: string, scope?: MonthLoadScope) => {
      capturedScopes.calls.push(scope);
      return actual.loadMonthForEditing(dir, folderName, scope);
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
  permissionsMock.state = { canDrawSample: false, canProcessPopulation: false, canViewBrowse: true };
  monthMock.state.selection = { kind: "existing", month: 5, year: 2026, folderName: FOLDER };
  workspaceMock.state.directoryHandle = null;
  capturedScopes.calls = [];
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

// Task 5: a single "first"-stage row is enough for drawSample to succeed (the
// other three stages simply draw 0 rows when their population is empty --
// see sampleAlgorithmInternals.ts's drawStageSample, which `continue`s past
// any stage with 0 available rows rather than erroring).
function makeSampleableRow(): PreparedPopulationRow {
  return {
    stage: "المستوى الأول",
    xrayImageId: "XR-1",
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    portName: "ميناء تجريبي",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: null,
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 2,
  };
}

async function seedProcessedMonthWithSampleableRow(): Promise<DirectoryHandleLike> {
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
    processedRows: [makeSampleableRow()],
    certScanRows: 0,
    nonCertScanRows: 1,
  });
  return dir;
}

describe("Population wizard — demand-gated load scope (Phase A steps 3c/3d)", () => {
  it("a view-only role (no draw/process capability) never requests population/raw", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    permissionsMock.state = { canDrawSample: false, canProcessPopulation: false, canViewBrowse: true };
    const dir = await seedProcessedMonth();
    workspaceMock.state.directoryHandle = dir;

    await act(async () => {
      render(<PopulationTab />);
      await Promise.resolve();
    });

    await waitFor(() => expect(capturedScopes.calls.length).toBeGreaterThan(0));
    expect(capturedScopes.calls[0]).toEqual({
      summary: true,
      sample: true,
      distribution: true,
      population: false,
      raw: false,
    });
  });

  it("a role with draw-sample capability DOES request population/raw", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // canViewBrowse: false -- otherwise A1's landing rule (perf/sync
    // enhancement 2026-08-12) would land this draw-sample-capable viewer on
    // "browse" by default, and computeMonthLoadScope only ever requests
    // population/raw for the "process" sub-tab (see populationWorkflowHelpers.ts).
    // A1's own landing behavior is covered by Population.landingSubTab.test.tsx;
    // this test is about the process-sub-tab + capability combination itself.
    permissionsMock.state = { canDrawSample: true, canProcessPopulation: false, canViewBrowse: false };
    const dir = await seedProcessedMonth();
    workspaceMock.state.directoryHandle = dir;

    await act(async () => {
      render(<PopulationTab />);
      await Promise.resolve();
    });

    await waitFor(() => expect(capturedScopes.calls.length).toBeGreaterThan(0));
    expect(capturedScopes.calls[0]).toEqual({
      summary: true,
      sample: true,
      distribution: true,
      population: true,
      raw: true,
    });
  });

  it("a role with process-population capability DOES request population/raw", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // canViewBrowse: false -- see the identical note on the draw-sample test above.
    permissionsMock.state = { canDrawSample: false, canProcessPopulation: true, canViewBrowse: false };
    const dir = await seedProcessedMonth();
    workspaceMock.state.directoryHandle = dir;

    await act(async () => {
      render(<PopulationTab />);
      await Promise.resolve();
    });

    await waitFor(() => expect(capturedScopes.calls.length).toBeGreaterThan(0));
    expect(capturedScopes.calls[0]?.population).toBe(true);
    expect(capturedScopes.calls[0]?.raw).toBe(true);
  });
});

function populationChipText(): string | null {
  const chip = Array.from(document.querySelectorAll(".pop-readiness-fact")).find((el) =>
    el.textContent?.includes("المجتمع")
  );
  return chip?.textContent ?? null;
}

describe("Population wizard — ensurePopulationLoaded top-up (Phase A step 3d)", () => {
  it("a draw-capable manager who loaded a month while on Browse still gets population on demand when switching to Process", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // canViewBrowse: false -- keeps activeSubTab's A1 (perf/sync enhancement
    // 2026-08-12) lazy initializer landing on "process" despite draw-sample
    // being held, so the very first auto-load effect firing on mount cannot
    // be made to see "browse" in time; deferring the real month selection
    // until after the manual subtab-switch dispatch below is the only way to
    // genuinely exercise a browse-scoped load.
    permissionsMock.state = { canDrawSample: true, canProcessPopulation: false, canViewBrowse: false };
    const dir = await seedProcessedMonth();
    workspaceMock.state.directoryHandle = dir;

    monthMock.state.selection = { kind: "none" };
    const { rerender } = render(<PopulationTab />);

    act(() => {
      window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId: "browse" } }));
    });

    monthMock.state.selection = { kind: "existing", month: 5, year: 2026, folderName: FOLDER };
    await act(async () => {
      rerender(<PopulationTab />);
      await Promise.resolve();
    });

    await waitFor(() => expect(capturedScopes.calls.length).toBe(1));
    expect(capturedScopes.calls[0]?.population).toBe(false); // browse-scoped: population deferred

    // Switch to Process -- the proactive top-up effect (currentPhase is already 3,
    // derived from manifest.status alone) should fire a second, population-focused load.
    act(() => {
      window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId: "process" } }));
    });

    await waitFor(() => expect(capturedScopes.calls.length).toBe(2));
    expect(capturedScopes.calls[1]).toEqual({ population: true, summary: true });

    // The merged-in result must reach the actual rendered status chip -- proving
    // ensurePopulationLoaded's reconstructedPopulation() merge, not just the fetch,
    // completed and reached React state.
    await waitFor(() => expect(populationChipText()).toContain("1 صف"));
  });
});

// Task 5 (2026-08-03-workflow-fixes): the sample dual-review approval gate is
// removed entirely -- Phase 3 -> Phase 4 must no longer block on an
// unapproved sample. This exercises the real end-to-end flow the removed gate
// used to guard: draw a sample in-session (leaving it unapproved, exactly
// like a fresh this-session draw always starts), then click "next phase".
describe("Population wizard — Phase 3 -> Phase 4 transition (Task 5: approval gate removed)", () => {
  it("moves from phase 3 to phase 4 even when the sample has not been approved", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // canViewBrowse: false so this test's process-phase UI (draw button, phase
    // stepper) is what activeSubTab lands on -- see the identical A1 note above.
    permissionsMock.state = { canDrawSample: true, canProcessPopulation: false, canViewBrowse: false };
    const dir = await seedProcessedMonthWithSampleableRow();
    workspaceMock.state.directoryHandle = dir;

    await act(async () => {
      render(<PopulationTab />);
      await Promise.resolve();
    });

    // Phase 3 -- draw a sample (this-session draw, never approved).
    const drawButton = await screen.findByRole("button", { name: "سحب العينات وحفظها" });
    await act(async () => {
      fireEvent.click(drawButton);
      await Promise.resolve();
    });

    // Confirms the draw actually completed (sampleDrawResult populated) before
    // moving on -- otherwise the unrelated "!sampleDrawResult" data-readiness
    // gate (kept intentionally) would be the thing blocking phase 4, not what
    // this test means to exercise.
    // 2026-08 handoff §5: the draw-result block is now the "نتيجة السحب" card.
    await screen.findByText("نتيجة السحب");

    // Click "next phase" -- this used to hit the four-eyes approval gate.
    const nextButton = screen.getByRole("button", { name: "← التالي" });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "المرحلة 4: توزيع العينة" })).toBeInTheDocument();
    });
    expect(
      screen.queryByText("يجب اعتماد العينة قبل الانتقال إلى مرحلة التوزيع.")
    ).not.toBeInTheDocument();
  });
});
