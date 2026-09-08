/* @vitest-environment jsdom */
// An UNREADABLE distribution must not be presented as an empty queue.
//
// The reported incident: an employee working through their samples watched the
// whole queue become "0 samples" mid-session, then saw it come back after a
// page refresh. `loadOrDeriveDistributionCurrent` reports a failed read and an
// empty month identically (`null`), and this view's `?? []` turned the first
// into the second — committed with `setLoadState("ready")`, so nothing on
// screen said anything had gone wrong.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import {
  DistributionUnreadableError,
  appendDistributionEvents,
  loadOrDeriveDistributionCurrentStrictForRead,
} from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import XrayReferrals from "./XrayReferrals";

const MONTH = "5-may-2026";

/** The unmocked implementation, so a test can put the real read back.
 *  `vi.hoisted` because `vi.mock`'s factory is hoisted above every ordinary
 *  top-level binding in this file. */
const real = vi.hoisted(() => ({
  strictRead: null as
    | null
    | ((
        ...args: Parameters<
          typeof import("../../../../../data/distribution/distributionStorage").loadOrDeriveDistributionCurrentStrictForRead
        >
      ) => ReturnType<
        typeof import("../../../../../data/distribution/distributionStorage").loadOrDeriveDistributionCurrentStrictForRead
      >),
}));

vi.mock("../../../../../data/distribution/distributionStorage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../../data/distribution/distributionStorage")>();
  real.strictRead = actual.loadOrDeriveDistributionCurrentStrictForRead;
  return {
    ...actual,
    loadOrDeriveDistributionCurrentStrictForRead: vi.fn(
      actual.loadOrDeriveDistributionCurrentStrictForRead
    ),
  };
});
const strictReadMock = vi.mocked(loadOrDeriveDistributionCurrentStrictForRead);

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

async function seedWorkspace(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root");
  await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1")]));
  const appended = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
  ]);
  expect(appended.ok).toBe(true);
  // Deliberately NO `saveDistributionCurrent`: that also writes each employee's
  // sample mirror, and a current mirror is the fast path that answers the queue
  // without the workspace-wide derivation at all. These tests are about what
  // the view does when it DOES have to derive.
  return root;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  strictReadMock.mockReset();
  strictReadMock.mockImplementation((...args) => real.strictRead!(...args));
  writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

describe("XrayReferrals — an unreadable distribution is not an empty queue", () => {
  it("shows the load-failure state instead of a queue that says there is no work", async () => {
    strictReadMock.mockRejectedValue(new DistributionUnreadableError(MONTH));
    const root = await seedWorkspace();

    render(<XrayReferrals directoryHandle={root} />);

    await screen.findByText("تعذر تحميل البيانات.");
    // Pre-fix: `?? []` produced a fully "ready" queue with nothing in it — the
    // employee-facing "0 samples" that started this.
    expect(screen.queryByText("IMG-1")).not.toBeInTheDocument();
  });

  it("still renders the queue when the read succeeds", async () => {
    const root = await seedWorkspace();

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0), {
      timeout: 4000,
    });
    expect(screen.queryByText("تعذر تحميل البيانات.")).not.toBeInTheDocument();
  });
});
