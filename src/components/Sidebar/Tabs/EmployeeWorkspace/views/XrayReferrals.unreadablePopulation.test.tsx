/* @vitest-environment jsdom */
// T-08 — an UNREADABLE population must not be presented as an empty one.
//
// `getReplacementCandidatesIndexed` used to fold a failed `population.final.json`
// read into an empty row list, so the replacement dialog opened claiming there
// is no eligible replacement in the month — a factual statement about the data
// made from a transient share failure. It now throws PopulationUnreadableError,
// and this view must surface that instead of opening the dialog.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  appendDistributionEvents,
  loadDistributionLog,
  saveDistributionCurrent,
} from "../../../../../data/distribution/distributionStorage";
import {
  buildAssignEvent,
  deriveCurrentDistribution,
} from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { PopulationUnreadableError } from "../../../../../data/population/populationStorage";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { getReplacementCandidatesIndexed } from "../../../../../data/distribution/replacementCandidateLookup";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import XrayReferrals from "./XrayReferrals";

const MONTH = "5-may-2026";

vi.mock("../../../../../data/distribution/replacementCandidateLookup", () => ({
  getReplacementCandidatesIndexed: vi.fn(),
}));
const lookupMock = vi.mocked(getReplacementCandidatesIndexed);

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
  const log = await loadDistributionLog(root, MONTH);
  await saveDistributionCurrent(root, MONTH, {
    ...deriveCurrentDistribution(log, [makeRow("IMG-1")]),
    logRevision: log.revision,
  });
  return root;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  lookupMock.mockReset();
  writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

describe("XrayReferrals — unreadable population blocks the replacement dialog (T-08)", () => {
  it("reports the read failure instead of opening a dialog that claims no candidates exist", async () => {
    lookupMock.mockRejectedValue(new PopulationUnreadableError(MONTH));
    const root = await seedWorkspace();

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "طلب استبدال" }));

    await screen.findByText(getLabels().msg_population_unreadable);
    // Pre-fix the dialog opened with an empty pool, which reads as "this month
    // has no eligible replacement" — a claim the failure cannot support.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("still opens the dialog when the candidate lookup succeeds with an empty pool", async () => {
    lookupMock.mockResolvedValue({ recommended: [], all: [] });
    const root = await seedWorkspace();

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "طلب استبدال" }));

    await screen.findByRole("dialog");
    expect(screen.queryByText(getLabels().msg_population_unreadable)).not.toBeInTheDocument();
  });
});
