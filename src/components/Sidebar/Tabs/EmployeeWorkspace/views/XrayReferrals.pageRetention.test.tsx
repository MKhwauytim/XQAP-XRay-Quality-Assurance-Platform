/* @vitest-environment jsdom */
// T-17, end-to-end through a real consumer.
//
// DataTable/pageRetention.test.tsx pins the component contract; this pins that a
// real screen actually gets it. The trigger is the ordinary one: an employee is
// reading page 2 of their queue when the 45s sync tick fires, and a supervisor
// has meanwhile assigned them one more x-ray. The refreshed queue is one row
// longer, which used to change DataTable's internal rows digest and snap the
// employee back to page 1 mid-read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the sibling XrayReferrals suites: the replacement-confirm path stands a
// query worker up, and Vitest cannot run a real DedicatedWorker.
vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { broadcastDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import XrayReferrals from "./XrayReferrals";

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

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: null,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows,
  };
}

/** Zero-padded so the queue's own ordering is stable and readable. */
function imageId(index: number): string {
  return `IMG-${String(index).padStart(3, "0")}`;
}

async function assign(root: DirectoryHandleLike, ids: string[]): Promise<void> {
  const result = await appendDistributionEvents(
    root,
    MONTH,
    ids.map((id) => buildAssignEvent({ xrayImageId: id, assignedTo: "emp-1", eventBy: "admin" }))
  );
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
}

function summary(): string {
  return document.querySelector(".data-pagination-summary")?.textContent ?? "";
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

describe("XrayReferrals — the queue keeps its page across a background refresh", () => {
  it("stays on page 2 when the sync tick brings in one more assigned x-ray", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    // 150 rows in the sample master, 120 of them assigned to this employee, so
    // the extra one the supervisor assigns later already exists in the sample.
    const allIds = Array.from({ length: 150 }, (_, index) => imageId(index + 1));
    await saveSampleMaster(root, MONTH, makeSample(allIds.map(makeRow)));
    await assign(root, allIds.slice(0, 120));

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(summary()).toMatch(/من 120 صف/));

    const pageInput = screen.getByLabelText("رقم الصفحة");
    fireEvent.change(pageInput, { target: { value: "2" } });
    fireEvent.blur(pageInput);
    expect(summary()).toMatch(/عرض 101 إلى 120 من 120 صف/);

    // The supervisor's action, then the 45s sync tick.
    await assign(root, [imageId(121)]);
    act(() => {
      broadcastDataRefresh();
    });

    // Before the fix: "عرض 1 إلى 100 من 121 صف" — the employee was thrown back
    // to the top of the queue by a refresh they never asked for.
    await waitFor(() => expect(summary()).toMatch(/من 121 صف/));
    expect(summary()).toMatch(/عرض 101 إلى 121 من 121 صف/);
  });
});
