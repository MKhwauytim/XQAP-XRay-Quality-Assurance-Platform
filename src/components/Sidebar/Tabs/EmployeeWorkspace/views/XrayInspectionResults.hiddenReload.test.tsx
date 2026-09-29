/* @vitest-environment jsdom */
// A1 (answer-save perf): «نتائج فحص الأشعة» stays mounted-but-hidden after its
// first visit, and used to run a FULL silent reload (sample master, distribution,
// referral/replacement logs, templates, answers + an IndexedDB backfill; ~142 ops,
// ~1.2 MB) on every data-refresh broadcast -- including the echo of the employee's
// OWN answer save made on the sibling sub-tab. While hidden it must do nothing but
// remember it is stale, and reload exactly once when shown.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import { createEmptyUserManagementState, writeUserManagementState } from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { notifyLocalDataChange, broadcastDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
import { TabActiveContext } from "../../../../../app/tabActiveContext";
import * as sampleStorage from "../../../../../data/sampling/sampleStorage";
import * as mirrorBackfill from "../../../../../data/answers/pendingAnswerReplay";
import XrayInspectionResults from "./XrayInspectionResults";

const MONTH = "5-may-2026";

vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: MONTH }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: MONTH },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));
vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id, portName: "بري", certScanStatus: "NonCertscan", stage: null, xrayEntryDate: null,
    portCode: null, portType: null, declarationNumber: null, declarationDate: null,
    plateOrContainerNumber: null, chassisNumber: null, xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة",
    movementType: "LAND", reportNumber: null, targetedByRiskEngine: null, riskMessage: null,
    levelOneEmployee: null, levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null, certScanSnippet: null, originalCertScanSnippet: null, biEnrichmentStatus: "BI Not Provided",
    biMatched: false, biFilledFields: [], sourceSheetName: "بري", sourceRowNumber: 1,
  };
}

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed", totalRequested: rows.length, totalActual: rows.length, certScanRequested: 0,
    nonCertScanRequested: 0, certScanActual: 0, nonCertScanActual: rows.length, portAllocations: [],
    stageAllocations: [], drawnAt: new Date().toISOString(), drawnBy: "admin", rows,
  };
}

async function seed() {
  writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-A"), makeRow("IMG-B")]));
  const r = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-A", assignedTo: "emp-1", eventBy: "admin" }),
  ]);
  if (!r.ok) throw new Error(r.error);
  return root;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((res) => setTimeout(res, 30));
  });
}

describe("XrayInspectionResults hidden-view reload gating", () => {
  it("a save broadcast while hidden triggers 0 loads; showing the view triggers exactly 1", async () => {
    const root = await seed();
    const loadSpy = vi.spyOn(sampleStorage, "loadSampleMaster");
    const backfillSpy = vi.spyOn(mirrorBackfill, "backfillAnswerMirror");

    const ui = (active: boolean) => <XrayInspectionResults directoryHandle={root} active={active} />;
    const { rerender } = render(ui(true));
    await waitFor(() => expect(screen.getAllByText("IMG-A").length).toBeGreaterThan(0));
    await flush();

    // Sub-tab goes hidden (still mounted), then a second row lands and the employee's
    // own save echoes through the local-change broadcast several times.
    rerender(ui(false));
    const second = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-B", assignedTo: "emp-1", eventBy: "admin" }),
    ]);
    if (!second.ok) throw new Error(second.error);
    loadSpy.mockClear();
    backfillSpy.mockClear();
    for (let i = 0; i < 3; i += 1) {
      act(() => notifyLocalDataChange(["answers"]));
    }
    act(() => broadcastDataRefresh("manual"));
    await flush();
    expect(loadSpy).toHaveBeenCalledTimes(0);
    expect(backfillSpy).toHaveBeenCalledTimes(0);
    expect(screen.queryByText("IMG-B")).not.toBeInTheDocument();

    // Shown again: one catch-up reload, and it picks up what changed while hidden.
    rerender(ui(true));
    await waitFor(() => expect(screen.getAllByText("IMG-B").length).toBeGreaterThan(0));
    await flush();
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it("does not reload on show when nothing broadcast while it was hidden", async () => {
    const root = await seed();
    const loadSpy = vi.spyOn(sampleStorage, "loadSampleMaster");
    const ui = (active: boolean) => <XrayInspectionResults directoryHandle={root} active={active} />;
    const { rerender } = render(ui(true));
    await waitFor(() => expect(screen.getAllByText("IMG-A").length).toBeGreaterThan(0));
    await flush();
    loadSpy.mockClear();
    rerender(ui(false));
    rerender(ui(true));
    await flush();
    expect(loadSpy).toHaveBeenCalledTimes(0);
  });

  it("is also gated when the whole top-level tab is hidden (TabActiveContext)", async () => {
    const root = await seed();
    const loadSpy = vi.spyOn(sampleStorage, "loadSampleMaster");
    const ui = (tabActive: boolean) => (
      <TabActiveContext.Provider value={tabActive}>
        <XrayInspectionResults directoryHandle={root} />
      </TabActiveContext.Provider>
    );
    const { rerender } = render(ui(true));
    await waitFor(() => expect(screen.getAllByText("IMG-A").length).toBeGreaterThan(0));
    await flush();
    rerender(ui(false));
    loadSpy.mockClear();
    act(() => notifyLocalDataChange(["answers"]));
    await flush();
    expect(loadSpy).toHaveBeenCalledTimes(0);
    rerender(ui(true));
    await flush();
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it("still reloads on a broadcast while visible (behaviour unchanged)", async () => {
    const root = await seed();
    const loadSpy = vi.spyOn(sampleStorage, "loadSampleMaster");
    render(<XrayInspectionResults directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-A").length).toBeGreaterThan(0));
    await flush();
    loadSpy.mockClear();
    act(() => notifyLocalDataChange(["answers"]));
    await flush();
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });
});
