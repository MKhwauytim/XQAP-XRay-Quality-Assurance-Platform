/* @vitest-environment jsdom */
// DEFECT 8 regression: a SUPERSEDED first load must still resolve the boot-progress
// checklist entries it registered.
//
// `loadData` reports to bootProgress only on the very first fetching pass of the
// component's lifetime (`bootReportedRef`). If that first pass is superseded — a
// permission broadcast lands mid-load, `canSeeAll` flips, `loadData`'s identity
// changes and the mount effect re-runs, bumping `loadTokenRef` — the first pass
// used to bail at its staleness check WITHOUT marking its six registered sources
// terminal, and the newer pass reports nothing (its `isInitialLoad` is already
// false). The checklist was then stranded in "loading" until BootSplashOverlay's
// 8 s timeout.
//
// The fix marks the sources terminal BEFORE the staleness check and gates only
// `commit()` on the token, so the superseded pass still never writes rows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Gate the ad-hoc read (one of loadData's Phase-1 `Promise.all` members) so the
// first load can be parked mid-flight, deterministically, while the permission
// broadcast that supersedes it is dispatched. Partial mock: `monthFolderForEntry`
// is used by the component's write routing and must stay real.
let releaseFirstAdhocRead: (() => void) | null = null;
let adhocReadCalls = 0;
vi.mock("../../../../../data/adhocImport/adhocImportEmployeeView", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../../data/adhocImport/adhocImportEmployeeView")>();
  return {
    ...actual,
    loadAdhocEntriesForEmployeeView: vi.fn(async () => {
      adhocReadCalls += 1;
      if (adhocReadCalls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstAdhocRead = resolve;
        });
      }
      return [];
    }),
  };
});

import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
  type FeaturePermission,
} from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { resetBootProgress, useBootProgress } from "../../../../../data/workspace/bootProgress";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
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

// jsdom has no ResizeObserver; DataTable observes its scroll container.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  adhocReadCalls = 0;
  releaseFirstAdhocRead = null;
});

afterEach(() => {
  // Release any still-parked load so a failing assertion can't leave a pending
  // promise wedged for the next test in this file.
  releaseFirstAdhocRead?.();
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

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

async function seedAssignedSample(root: DirectoryHandleLike, username: string): Promise<void> {
  await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1")]));
  const result = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: username, eventBy: "admin" }),
  ]);
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
}

/** Grants `view-all-entries` to the employee role — the flip that changes
 *  `canSeeAll`, and with it `loadData`'s identity, mid-load. */
function employeeWithViewAllEntriesState() {
  const base = createEmptyUserManagementState();
  const featurePermissions: FeaturePermission[] = [
    ...base.featurePermissions.filter(
      (f) => !(f.role === "employee" && f.featureId === "view-all-entries")
    ),
    { role: "employee", featureId: "view-all-entries", enabled: true },
  ];
  return { ...base, featurePermissions };
}

describe("XrayReferrals boot-progress: superseded first load", () => {
  it("leaves no boot source stranded in 'loading' when a permission broadcast supersedes the initial load", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");

    const { result } = renderHook(() => useBootProgress());
    render(<XrayReferrals directoryHandle={root} />);

    // The initial (personal-scope) pass registered its six sources and is now
    // parked inside its Phase-1 reads.
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(6);
      expect(result.current.entries.every((entry) => entry.status === "loading")).toBe(true);
    });
    await waitFor(() => expect(adhocReadCalls).toBe(1));

    // A permission broadcast lands mid-load: canSeeAll flips true, loadData's
    // identity changes, the mount effect re-runs and bumps the load token. This
    // second pass runs to completion (its ad-hoc read is not gated) and reports
    // nothing to bootProgress, because bootReportedRef was already consumed.
    act(() => {
      writeUserManagementState(employeeWithViewAllEntriesState());
    });
    await waitFor(() => expect(adhocReadCalls).toBe(2));

    // Now let the superseded first pass resume and hit its staleness check.
    await act(async () => {
      releaseFirstAdhocRead?.();
      releaseFirstAdhocRead = null;
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.entries.every((entry) => entry.status !== "loading")).toBe(true);
    });
    expect(result.current.allLoaded).toBe(true);
  });
});
