/* @vitest-environment jsdom */
// Task 10: personal-scope Results serves a trusted sample mirror instead of
// reading the whole sample master + deriving the distribution.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import { createEmptyUserManagementState, writeUserManagementState } from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent, buildReassignEvent } from "../../../../../data/distribution/distributionLog";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import * as sampleStorage from "../../../../../data/sampling/sampleStorage";
import * as mirrorStorage from "../../../../../data/samples/sampleMirrorStorage";
import * as distributionStorage from "../../../../../data/distribution/distributionStorage";
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

async function seed(role: "employee" | "supervisor") {
  writeSession({ role, username: role === "employee" ? "emp-1" : "sup-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-A"), makeRow("IMG-B")]));
  const r = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-A", assignedTo: "emp-1", eventBy: "admin" }),
    buildAssignEvent({ xrayImageId: "IMG-B", assignedTo: "emp-1", eventBy: "admin" }),
  ]);
  if (!r.ok) throw new Error(r.error);
  return root;
}

/** A mirror projected from the derived distribution (emp-1's current entries). */
async function mirrorOf(root: DirectoryHandleLike) {
  const full = await distributionStorage.loadOrDeriveDistributionCurrentStrictForRead(
    root, MONTH, makeSample([makeRow("IMG-A"), makeRow("IMG-B")]).rows
  );
  const entries = full?.entries ?? [];
  expect(entries).toHaveLength(2);
  return {
    monthFolderName: MONTH, username: "emp-1", updatedAt: "", sourceLogRevision: 5, deriveVersion: 99,
    quota: { dailyQuota: 3, daysRemainingAtAssignment: 4, sampleCount: 2 }, entries,
  } as unknown as Awaited<ReturnType<typeof mirrorStorage.loadEmployeeSampleMirror>>;
}

function spies(trusted: boolean, mirror: Awaited<ReturnType<typeof mirrorOf>>) {
  const mirrorSpy = vi.spyOn(mirrorStorage, "loadEmployeeSampleMirror").mockResolvedValue(mirror);
  vi.spyOn(distributionStorage, "readDistributionLogStamp").mockResolvedValue({ revision: 5 } as never);
  vi.spyOn(mirrorStorage, "isMirrorTrustedForEvents").mockResolvedValue(trusted);
  const masterSpy = vi.spyOn(sampleStorage, "loadSampleMaster");
  const deriveSpy = vi.spyOn(distributionStorage, "loadOrDeriveDistributionCurrentStrictForRead");
  return { mirrorSpy, masterSpy, deriveSpy };
}

describe("XrayInspectionResults mirror fast path", () => {
  it("trusted mirror: serves mirror rows without reading the sample master or deriving", async () => {
    const root = await seed("employee");
    const mirror = await mirrorOf(root);
    const { masterSpy, deriveSpy } = spies(true, mirror);
    masterSpy.mockClear(); deriveSpy.mockClear();
    render(<XrayInspectionResults directoryHandle={root} initialTab="results" />);
    await waitFor(() => expect(screen.getAllByText("IMG-A").length).toBeGreaterThan(0));
    for (const e of mirror!.entries) expect(screen.getAllByText(e.xrayImageId).length).toBeGreaterThan(0);
    expect(masterSpy).not.toHaveBeenCalled();
    expect(deriveSpy).not.toHaveBeenCalled();
  });

  it("untrusted mirror: falls back to the full read", async () => {
    const root = await seed("employee");
    const mirror = await mirrorOf(root);
    const { masterSpy, deriveSpy } = spies(false, mirror);
    masterSpy.mockClear(); deriveSpy.mockClear();
    render(<XrayInspectionResults directoryHandle={root} initialTab="results" />);
    await waitFor(() => expect(screen.getAllByText("IMG-A").length).toBeGreaterThan(0));
    expect(masterSpy).toHaveBeenCalledTimes(1);
    expect(deriveSpy).toHaveBeenCalledTimes(1);
  });

  it("trusted mirror but user has a reassignment: full path keeps the moved-away row", async () => {
    const root = await seed("employee");
    const mirror = await mirrorOf(root);
    const moved = await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({ xrayImageId: "IMG-A", assignedTo: "emp-1", reassignedTo: "emp-2", eventBy: "admin" }),
    ]);
    if (!moved.ok) throw new Error(moved.error);
    const { masterSpy } = spies(true, mirror);
    masterSpy.mockClear();
    render(<XrayInspectionResults directoryHandle={root} initialTab="results" />);
    await waitFor(() => expect(screen.getAllByText("IMG-A").length).toBeGreaterThan(0));
    expect(masterSpy).toHaveBeenCalledTimes(1);
  });

  it("mirror loader rejects: falls back to the full path", async () => {
    const root = await seed("employee");
    const mirror = await mirrorOf(root);
    const { mirrorSpy, masterSpy } = spies(true, mirror);
    mirrorSpy.mockRejectedValue(new Error("corrupt mirror"));
    masterSpy.mockClear();
    render(<XrayInspectionResults directoryHandle={root} initialTab="results" />);
    await waitFor(() => expect(screen.getAllByText("IMG-A").length).toBeGreaterThan(0));
    expect(masterSpy).toHaveBeenCalledTimes(1);
  });

  it("canSeeAll: never reads the mirror, uses the full path", async () => {
    const root = await seed("supervisor");
    const mirror = await mirrorOf(root);
    const { mirrorSpy, masterSpy, deriveSpy } = spies(true, mirror);
    mirrorSpy.mockClear(); masterSpy.mockClear(); deriveSpy.mockClear();
    render(<XrayInspectionResults directoryHandle={root} initialTab="results" />);
    await waitFor(() => expect(screen.getAllByText("IMG-A").length).toBeGreaterThan(0));
    expect(mirrorSpy).not.toHaveBeenCalled();
    expect(masterSpy).toHaveBeenCalledTimes(1);
    expect(deriveSpy).toHaveBeenCalledTimes(1);
  });
});
