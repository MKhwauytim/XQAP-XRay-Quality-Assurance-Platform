/* @vitest-environment jsdom */
// Audit cleanup batch for the referral queue's presentation layer:
//
//  1. Pending-row colouring for oversight users. `pendingReferralIds` /
//     `pendingReplacementIds` were short-circuited to empty sets whenever
//     `canSeeAll` held, so a supervisor's own outstanding referral/replacement
//     requests were the only rows in the app that lost their status colour. The
//     helpers already scope by username, so the short-circuit bought nothing.
//  2. The stats strip labelled itself "إحصائياتي" even in the "الكل" scope,
//     where every number it shows is workspace-wide. Since the scope control
//     became an EMPLOYEE PICKER there is a third case — one named other
//     employee — which is neither "mine" nor "everyone's" and gets its own
//     wording rather than being folded into either.
//  3. A zero-assignment queue rendered a bare empty table instead of the
//     shared EmptyState the sibling Employee Workspace views use.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { appendReferralRequest, appendReplacementRequest } from "../../../../../data/referral/referralStorage";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { QUEUE_SCOPE_ALL } from "./XrayReferrals/subComponents";
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

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
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

async function seedAssignedSample(
  root: DirectoryHandleLike,
  username: string,
  id = "IMG-1"
): Promise<void> {
  await saveSampleMaster(root, MONTH, makeSample([makeRow(id)]));
  const result = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: id, assignedTo: username, eventBy: "admin" }),
  ]);
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
}

const L = getLabels();

/** The oversight scope picker (`<select>`), by its accessible name. */
function scopePicker(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: L.ew_queue_scope_label }) as HTMLSelectElement;
}

/** Switch the queue to a username, or to `QUEUE_SCOPE_ALL`. */
function pickScope(value: string): void {
  fireEvent.change(scopePicker(), { target: { value } });
}

function findRowByXrayImageId(id: string): HTMLElement {
  const matches = screen.getAllByText(id);
  const row = matches.map((el) => el.closest("tr")).find((tr): tr is HTMLTableRowElement => tr !== null);
  if (!row) throw new Error(`no <tr> found containing "${id}"`);
  return row;
}

describe("XrayReferrals pending-row colouring for oversight users", () => {
  it("colours an oversight user's OWN pending referral row, which the canSeeAll short-circuit used to suppress", async () => {
    // supervisor => can("view-all-entries") by default => canSeeAll.
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "sup-1");
    const referral = await appendReferralRequest(root, MONTH, {
      requestId: "ref-1",
      monthFolderName: MONTH,
      fromEmployee: "sup-1",
      toEmployee: "emp-2",
      xrayImageIds: ["IMG-1"],
      reason: "test reason",
      requestedAt: new Date().toISOString(),
      requestedBy: "sup-1",
      status: "pending",
    });
    if (!referral.ok) throw new Error(`seed referral failed: ${referral.error}`);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    expect(findRowByXrayImageId("IMG-1")).toHaveClass("dt-tr--pending");
  });

  it("colours an oversight user's OWN pending replacement row", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "sup-1");
    const replacement = await appendReplacementRequest(root, MONTH, {
      requestId: "rep-1",
      monthFolderName: MONTH,
      employeeUsername: "sup-1",
      originalXrayImageId: "IMG-1",
      replacementXrayImageId: "IMG-9",
      reason: "test reason",
      requestedAt: new Date().toISOString(),
      requestedBy: "sup-1",
      status: "pending",
    });
    if (!replacement.ok) throw new Error(`seed replacement failed: ${replacement.error}`);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    expect(findRowByXrayImageId("IMG-1")).toHaveClass("dt-tr--pending");
  });
});

describe("XrayReferrals stats strip scope labelling", () => {
  it("names whose figures it shows: mine, everyone's, or one picked employee's", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1"), makeRow("IMG-2")]));
    const seeded = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "sup-1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-2", eventBy: "admin" }),
    ]);
    if (!seeded.ok) throw new Error(`seed failed: ${seeded.error}`);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    // The view still opens on the reader's own rows, as the old default did.
    expect(scopePicker().value).toBe("sup-1");
    expect(screen.getByLabelText("إحصائياتي")).toBeInTheDocument();

    pickScope(QUEUE_SCOPE_ALL);

    // Everyone's: the strip must stop claiming to be the reader's own figures.
    await waitFor(() => expect(screen.queryByLabelText("إحصائياتي")).not.toBeInTheDocument());
    expect(screen.getByLabelText("إحصائيات جميع الموظفين")).toBeInTheDocument();

    // One named OTHER employee is neither of the two — it must not be
    // mislabelled as the reader's own figures nor as the whole workspace's.
    pickScope("emp-2");
    const employeeAria = L.ew_queue_stats_employee_aria.replace("{name}", "emp-2");
    await waitFor(() => expect(screen.getByLabelText(employeeAria)).toBeInTheDocument());
    expect(screen.queryByLabelText("إحصائياتي")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("إحصائيات جميع الموظفين")).not.toBeInTheDocument();
  });
});

describe("XrayReferrals zero-assignment empty state", () => {
  it("renders the shared EmptyState instead of an empty table when the employee has no assignments", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    // A drawn sample exists for the month, but nothing is assigned to emp-1.
    await seedAssignedSample(root, "emp-2");

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() =>
      expect(screen.getByText("لا توجد عينات مسندة إليك في هذا الشهر")).toBeInTheDocument()
    );
    expect(document.querySelector("table")).toBeNull();
  });
});
