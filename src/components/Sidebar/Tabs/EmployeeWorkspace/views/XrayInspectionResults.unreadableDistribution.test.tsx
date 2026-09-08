/* @vitest-environment jsdom */
// نتائج الفحص: an UNREADABLE distribution must not be presented as a month in
// which nothing was assigned.
//
// This is the page the incident was diagnosed FROM. During a share outage a
// supervisor opened it, saw almost no completed work, and concluded the
// employees' answers had been lost. The reads had failed;
// `loadOrDeriveDistributionCurrent` reported that as `null`, the `?? []` below
// it turned `null` into an empty row set, and `setLoadState("ready")` presented
// the result as a finished, successful load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { DEFAULT_LABELS } from "../../../../../data/labels/labelsStore";
import XrayInspectionResults from "./XrayInspectionResults";

const MONTH = "5-may-2026";

/** See the sibling XrayReferrals test for why `vi.hoisted` is required here. */
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
  return root;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  strictReadMock.mockReset();
  strictReadMock.mockImplementation((...args) => real.strictRead!(...args));
  writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

describe("XrayInspectionResults — an unreadable distribution is not an empty month", () => {
  it("shows the load-failure state instead of a month with no assigned work", async () => {
    strictReadMock.mockRejectedValue(new DistributionUnreadableError(MONTH));
    const root = await seedWorkspace();

    render(<XrayInspectionResults directoryHandle={root} />);

    await screen.findByText(DEFAULT_LABELS.xray_results_error);
    expect(screen.queryByText("IMG-1")).not.toBeInTheDocument();
  });

  it("still renders the month's rows when the read succeeds", async () => {
    const root = await seedWorkspace();

    render(<XrayInspectionResults directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0), {
      timeout: 4000,
    });
    expect(screen.queryByText(DEFAULT_LABELS.xray_results_error)).not.toBeInTheDocument();
  });
});
