/* @vitest-environment jsdom */
// Regression test for the view-mode refetch optimization (synthesis medium + B4
// perf pass). XrayInspectionResults used to include `viewMode` in loadData's
// dependency array, so toggling بين النتائج/المستبدلة/المحالة re-read the sample
// master, distribution log, referral/replacement logs, AND every employee's
// answer file from the workspace folder on every click. loadData no longer
// depends on viewMode — auditRows is derived from state loadData already fetched
// via a pure useMemo filter (buildAuditRows takes `mode` as a plain filter). This
// test proves no additional directory reads happen when only the view mode changes.
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
import {
  appendReferralRequest,
  appendReplacementRequest,
} from "../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReplacementRequest } from "../../../../../data/referral/referralTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { loadEmployeeAnswers, upsertItemAnswer } from "../../../../../data/answers/answerStorage";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import { DEFAULT_LABELS } from "../../../../../data/labels/labelsStore";
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

// usePermissions() reads useWorkspace() only to gate canMutate on "is a workspace
// open" — unrelated to the memory directory passed as this test's directoryHandle prop.
vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

// jsdom has no ResizeObserver; DataTable observes its scroll container (mirrors DataTable/index.test.tsx).
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

describe("XrayInspectionResults view-mode toggle (no refetch regression)", () => {
  it("does not re-read the workspace folder when switching between النتائج / المستبدلة / المحالة", async () => {
    // Supervisor: view-all-entries is enabled by default, so every seeded row/
    // request is visible regardless of who it's assigned to (keeps the seed simple).
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-ACTIVE")]));
    const assignResult = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-ACTIVE", assignedTo: "emp-1", eventBy: "admin" }),
    ]);
    if (!assignResult.ok) throw new Error(`seed assign failed: ${assignResult.error}`);

    const referral: ReferralRequest = {
      requestId: "ref-1",
      monthFolderName: MONTH,
      fromEmployee: "emp-1",
      toEmployee: "emp-2",
      xrayImageIds: ["IMG-REFERRED"],
      reason: "سبب الإحالة",
      requestedAt: new Date().toISOString(),
      requestedBy: "emp-1",
      status: "pending",
    };
    const referralResult = await appendReferralRequest(root, MONTH, referral);
    if (!referralResult.ok) throw new Error(`seed referral failed: ${referralResult.error}`);

    const replacement: ReplacementRequest = {
      requestId: "rep-1",
      monthFolderName: MONTH,
      employeeUsername: "emp-1",
      originalXrayImageId: "IMG-REPLACED",
      replacementXrayImageId: "IMG-NEW",
      reason: "سبب الاستبدال",
      requestedAt: new Date().toISOString(),
      requestedBy: "emp-1",
      status: "pending",
    };
    const replacementResult = await appendReplacementRequest(root, MONTH, replacement);
    if (!replacementResult.ok) throw new Error(`seed replacement failed: ${replacementResult.error}`);

    render(<XrayInspectionResults directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-ACTIVE").length).toBeGreaterThan(0));

    // Snapshot the read-call count once the initial load (and the independent
    // browse-preset load) have both settled — from here on, no directory access
    // should happen purely from clicking the view-mode segmented control.
    const getDirectoryHandleSpy = vi.spyOn(root, "getDirectoryHandle");
    const getFileHandleSpy = vi.spyOn(root, "getFileHandle");

    fireEvent.click(screen.getByRole("button", { name: "المستبدلة" }));
    await waitFor(() => expect(screen.getAllByText("IMG-REPLACED").length).toBeGreaterThan(0));
    expect(getDirectoryHandleSpy).not.toHaveBeenCalled();
    expect(getFileHandleSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "المحالة/المنقولة" }));
    await waitFor(() => expect(screen.getAllByText("IMG-REFERRED").length).toBeGreaterThan(0));
    expect(getDirectoryHandleSpy).not.toHaveBeenCalled();
    expect(getFileHandleSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "النتائج" }));
    await waitFor(() => expect(screen.getAllByText("IMG-ACTIVE").length).toBeGreaterThan(0));
    expect(getDirectoryHandleSpy).not.toHaveBeenCalled();
    expect(getFileHandleSpy).not.toHaveBeenCalled();

    getDirectoryHandleSpy.mockRestore();
    getFileHandleSpy.mockRestore();
  });
});

// P2-2: writable quality-note control on an item's saved answer. Fully independent
// of the referral/replacement/reopen reviewNotes/DecisionEvent trail (no request/
// approval seeded or asserted here) — only exercises ItemAnswer.qualityNote via
// setItemQualityNote (indirectly, through the rendered control).
function makeAnswer(overrides?: Partial<ItemAnswer>): ItemAnswer {
  return {
    xrayImageId: "IMG-ACTIVE",
    templateId: "t1",
    templateVersion: 1,
    answers: [],
    lastSavedAt: new Date().toISOString(),
    submittedAt: null,
    answeredBy: "emp-1",
    status: "draft",
    ...overrides,
  };
}

async function seedActiveEntryWithAnswer(): Promise<ReturnType<typeof createMemoryDirectory>> {
  const root = createMemoryDirectory("root");
  await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-ACTIVE")]));
  const assignResult = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-ACTIVE", assignedTo: "emp-1", eventBy: "admin" }),
  ]);
  if (!assignResult.ok) throw new Error(`seed assign failed: ${assignResult.error}`);
  const answerResult = await upsertItemAnswer(root, MONTH, "emp-1", makeAnswer());
  if (!answerResult.ok) throw new Error(`seed answer failed: ${answerResult.error}`);
  return root;
}

describe("XrayInspectionResults quality note (P2-2)", () => {
  it("a supervisor (ew.reopenAnswer) can write a quality note that persists to the employee's answer file", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = await seedActiveEntryWithAnswer();
    render(<XrayInspectionResults directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-ACTIVE").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("row", { name: /IMG-ACTIVE/ }));

    const textarea = await screen.findByPlaceholderText(DEFAULT_LABELS.ew_quality_note_placeholder);
    fireEvent.change(textarea, { target: { value: "يرجى مراجعة زاوية التصوير." } });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.ew_quality_note_save }));

    await waitFor(async () => {
      const file = await loadEmployeeAnswers(root, MONTH, "emp-1");
      const item = file.items.find((i) => i.xrayImageId === "IMG-ACTIVE");
      expect(item?.qualityNote).toBe("يرجى مراجعة زاوية التصوير.");
    });

    // Independence: the write never touched referral/replacement/reopen requests.
    const file = await loadEmployeeAnswers(root, MONTH, "emp-1");
    expect(file.referralRequests ?? []).toHaveLength(0);
    expect(file.replacementRequests ?? []).toHaveLength(0);
    expect(file.reopenRequests ?? []).toHaveLength(0);
  });

  it("an employee (no ew.reopenAnswer) sees no writable control — permission-denied at the render boundary", async () => {
    // Default employee permissions: ew.reopenAnswer is disabled (FEATURE_DEFAULTS),
    // the same tier gating approve-referrals/approve-replacements.
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = await seedActiveEntryWithAnswer();
    render(<XrayInspectionResults directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-ACTIVE").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("row", { name: /IMG-ACTIVE/ }));

    await screen.findByText(DEFAULT_LABELS.ew_quality_note_empty_readonly);
    expect(screen.queryByPlaceholderText(DEFAULT_LABELS.ew_quality_note_placeholder)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.ew_quality_note_save })).not.toBeInTheDocument();

    // Data-layer confirmation: no note was ever persisted for this item.
    const file = await loadEmployeeAnswers(root, MONTH, "emp-1");
    const item = file.items.find((i) => i.xrayImageId === "IMG-ACTIVE");
    expect(item?.qualityNote).toBeUndefined();
  });
});
