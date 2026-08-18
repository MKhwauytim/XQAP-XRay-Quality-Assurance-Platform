/* @vitest-environment jsdom */
// Replacement-dialog exclusion-set freshness regression test.
//
// On the mirror fast path `loadData` never reads `sample.master.json` nor the
// workspace-wide derivation, so `openReplacementDialog` resolves both on demand
// through `ensureReplacementContext`. That function short-circuits on a non-null
// `sampleMaster` and returns component state `allEntries` alongside it — so the
// on-demand branch has to commit BOTH, not just the sample. Committing only the
// sample made the second open of the dialog pair a fresh sample master with the
// employee's mirror-only entry list, dropping every other employee's rows out of
// the exclusion set and offering rows they already own as replacements.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
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

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  lookupMock.mockReset().mockResolvedValue({ recommended: [], all: [] });
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

function idsOf(entries: readonly { xrayImageId: string }[]): string[] {
  return entries.map((e) => e.xrayImageId).sort();
}

describe("XrayReferrals — replacement dialog exclusion set", () => {
  it("keeps every employee's entries in the exclusion set when the dialog is reopened", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    // Two rows, two owners. emp-1's mirror knows only about IMG-1, so the fast
    // path paints a one-row queue and leaves sampleMaster null.
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1"), makeRow("IMG-2")]));
    const appended = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-2", eventBy: "admin" }),
    ]);
    expect(appended.ok).toBe(true);
    const log = await loadDistributionLog(root, MONTH);
    await saveDistributionCurrent(root, MONTH, {
      ...deriveCurrentDistribution(log, [makeRow("IMG-1"), makeRow("IMG-2")]),
      logRevision: log.revision,
    });

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    // Fast path confirmed: emp-2's row was never read into the queue.
    expect(screen.queryByText("IMG-2")).not.toBeInTheDocument();

    // ── First open: the on-demand read supplies the full entry set. ──
    fireEvent.click(screen.getByRole("button", { name: "طلب استبدال" }));
    await waitFor(() => expect(lookupMock).toHaveBeenCalledTimes(1));
    expect(idsOf(lookupMock.mock.calls[0][4])).toEqual(["IMG-1", "IMG-2"]);

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "إغلاق" })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // ── Second open: short-circuits on the cached sample master. The entry set
    //    must not collapse back to the mirror-only view. ──
    fireEvent.click(screen.getByRole("button", { name: "طلب استبدال" }));
    await waitFor(() => expect(lookupMock).toHaveBeenCalledTimes(2));
    expect(idsOf(lookupMock.mock.calls[1][3].rows)).toEqual(["IMG-1", "IMG-2"]);
    expect(idsOf(lookupMock.mock.calls[1][4])).toEqual(["IMG-1", "IMG-2"]);
  });
});
