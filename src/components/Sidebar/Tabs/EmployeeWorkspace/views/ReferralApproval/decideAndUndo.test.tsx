/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
  type FeaturePermission,
} from "../../../../../../auth/userManagement";
import { appendReferralRequest, loadReferralLog } from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest } from "../../../../../../data/referral/referralTypes";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import type { SampleMasterData } from "../../../../../../data/sampling/sampleTypes";
import { saveSampleMaster } from "../../../../../../data/sampling/sampleStorage";
import { appendDistributionEvents, loadDistributionLog } from "../../../../../../data/distribution/distributionStorage";
import { buildAssignEvent, deriveCurrentDistribution } from "../../../../../../data/distribution/distributionLog";
import ReferralApproval from "./index";

const MONTH = "4-april-2026";

// Hoisted so the mock hands back the SAME array/object on every render.
// `useApprovalData`'s loader is a useCallback keyed on `months`, and its mount
// effect is keyed on that callback — a fresh array literal per render would
// re-run the load on every render and spin forever. The real provider keeps
// `months` in useState, so its identity is stable; the mock must match that.
const monthMock = vi.hoisted(() => ({
  months: [{ month: 4, year: 2026, folderName: "4-april-2026" }],
  selection: { kind: "existing" as const, month: 4, year: 2026, folderName: "4-april-2026" },
}));

vi.mock("../../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: monthMock.months,
    selection: monthMock.selection,
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

afterEach(() => {
  cleanup();
  clearSession();
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
    plateOrContainerNumber: "ABC-123",
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

const request: ReferralRequest = {
  requestId: "ref-1",
  monthFolderName: MONTH,
  fromEmployee: "emp1",
  toEmployee: "emp2",
  xrayImageIds: ["A1"],
  reason: "ضغط عمل على الموظف الأول",
  requestedAt: "2026-04-01T08:00:00.000Z",
  requestedBy: "emp1",
  status: "pending",
};

function setupSupervisor(): void {
  writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
  const base = createEmptyUserManagementState();
  const featurePermissions: FeaturePermission[] = [
    ...base.featurePermissions.filter(
      (f) => !(f.role === "supervisor" && f.featureId === "approve-referrals")
    ),
    { role: "supervisor", featureId: "approve-referrals", enabled: true },
  ];
  writeUserManagementState({ ...base, featurePermissions }, false);
}

async function seed(root: DirectoryHandleLike): Promise<void> {
  await saveSampleMaster(root, MONTH, makeSample([makeRow("A1")]));
  await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
  ]);
  await appendReferralRequest(root, MONTH, request);
}

async function ownerOfA1(root: DirectoryHandleLike): Promise<string | undefined> {
  const log = await loadDistributionLog(root, MONTH);
  const current = deriveCurrentDistribution(log, [makeRow("A1")]);
  return current.entries.find((entry) => entry.xrayImageId === "A1")?.assignedTo;
}

describe("اعتماد الطلبات — in-page decision and undo", () => {
  it("approves from the detail pane without a confirm dialog, then takes the decision back", async () => {
    setupSupervisor();
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    render(<ReferralApproval directoryHandle={root} />);

    // The queue selects its head, so the detail pane is populated with no click.
    await waitFor(() => expect(screen.getByRole("heading", { name: "emp1 ← emp2" })).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /موافقة/ }));

    await waitFor(() => expect(screen.getByText("تمت الموافقة على الطلب.")).toBeTruthy());
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("approved");
    expect(await ownerOfA1(root)).toBe("emp2");

    fireEvent.click(screen.getByRole("button", { name: /تراجع/ }));

    await waitFor(() =>
      expect(screen.getByText("تم التراجع عن القرار — عاد الطلب إلى قائمة الانتظار.")).toBeTruthy()
    );
    expect((await loadReferralLog(root, MONTH)).requests[0]!.status).toBe("pending");
    expect(await ownerOfA1(root)).toBe("emp1");
  });

  it("keeps both the decision and its revocation on the request timeline", async () => {
    setupSupervisor();
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    render(<ReferralApproval directoryHandle={root} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "emp1 ← emp2" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /رفض/ }));
    await waitFor(() => expect(screen.getByText("تم رفض الطلب.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /تراجع/ }));
    await waitFor(() =>
      expect(screen.getByText("تم التراجع عن القرار — عاد الطلب إلى قائمة الانتظار.")).toBeTruthy()
    );

    const history = (await loadReferralLog(root, MONTH)).requests[0]!.history ?? [];
    expect(history.map((event) => event.status)).toEqual(["denied", "reverted"]);
    // Both the denial and its revocation stay on the pane's timeline; the
    // request is pending again, so the detail pane re-renders it from the queue.
    await waitFor(() => {
      const timeline = document.querySelector(".ew-timeline") as HTMLElement;
      expect(timeline.textContent).toContain("تم الرفض");
      expect(timeline.textContent).toContain("تم التراجع عن القرار");
    });
  });
});
