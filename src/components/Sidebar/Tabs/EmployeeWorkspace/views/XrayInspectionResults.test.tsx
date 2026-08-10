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
import {
  appendReferralRequest,
  appendReplacementRequest,
} from "../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReplacementRequest } from "../../../../../data/referral/referralTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { loadEmployeeAnswers, upsertItemAnswer } from "../../../../../data/answers/answerStorage";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import { DEFAULT_LABELS } from "../../../../../data/labels/labelsStore";
import { broadcastDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
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

describe("XrayInspectionResults background data-refresh vs. an open quality-note editor", () => {
  it("does not discard an in-progress, unsaved quality note when the app-wide data-refresh signal fires (5-minute auto-refresh / manual toolbar button)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = await seedActiveEntryWithAnswer();
    render(<XrayInspectionResults directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-ACTIVE").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("row", { name: /IMG-ACTIVE/ }));

    const textarea = await screen.findByPlaceholderText(DEFAULT_LABELS.ew_quality_note_placeholder);
    fireEvent.change(textarea, { target: { value: "مسودة ملاحظة غير محفوظة" } });
    expect((textarea as HTMLTextAreaElement).value).toBe("مسودة ملاحظة غير محفوظة");

    // Simulate the app-wide data-refresh signal (AuthGate's 5-minute timer or the
    // manual toolbar refresh button) firing while the quality-note editor is still
    // open with an unsaved draft.
    act(() => {
      broadcastDataRefresh();
    });

    // Previously: loadData's unconditional setLoadState("loading") + setExpandedRowKey(null)
    // unmounted the whole results table (replacing it with the loading placeholder) and
    // collapsed the expanded row, so QualityNoteEditor's local draft state was destroyed.
    expect(screen.queryByText(DEFAULT_LABELS.xray_results_loading)).not.toBeInTheDocument();

    // Let the silent refresh's async reload settle, then confirm the row is still
    // expanded and the draft survived untouched.
    await waitFor(() => expect(screen.getAllByText("IMG-ACTIVE").length).toBeGreaterThan(0));
    const textareaAfter = await screen.findByPlaceholderText(DEFAULT_LABELS.ew_quality_note_placeholder);
    expect((textareaAfter as HTMLTextAreaElement).value).toBe("مسودة ملاحظة غير محفوظة");

    // Data-layer confirmation: the unsaved draft was never persisted by the refresh.
    const file = await loadEmployeeAnswers(root, MONTH, "emp-1");
    const item = file.items.find((i) => i.xrayImageId === "IMG-ACTIVE");
    expect(item?.qualityNote).toBeUndefined();
  });
});

// ── THE GAP fix: ad-hoc-imported assignments must be visible in results too ──
// (see src/data/adhocImport/adhocImportEmployeeView.ts).
describe("XrayInspectionResults — ad-hoc import visibility (THE GAP fix)", () => {
  it("shows an ad-hoc-imported assignment tagged with the ad-hoc badge, alongside the month's real results", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-ACTIVE")]));
    const assignResult = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-ACTIVE", assignedTo: "emp-1", eventBy: "admin" }),
    ]);
    if (!assignResult.ok) throw new Error(`seed assign failed: ${assignResult.error}`);

    const { ensureAdhocSampleMaster, assignAdhocRowsToEmployee } = await import(
      "../../../../../data/adhocImport/adhocImportAssignment"
    );
    const record = {
      importId: "adh-1",
      fileName: "adh-1.xlsx",
      importedBy: "admin",
      importedAt: new Date().toISOString(),
      status: "open" as const,
      rows: [
        {
          rowKey: "s1:2",
          mapped: {
            movementType: "s1",
            portCode: null, portName: "ميناء جدة", portType: "بحري",
            movementNumber: null, movementDate: null, movementHijriDate: null,
            declarationNumber: "DEC-1", transitDeclarationNumber: null, declarationDate: null, declarationHijriDate: null,
            manifestNumber: null, manifestType: null, manifestDate: null,
            plateOrContainerNumber: null, finalDestination: null,
            entryDate: null, exitDate: null,
            chassisNumber: null, reportNumber: null, hasReport: false,
            xrayLevelOneResult: "سليمة" as const, xrayLevelTwoResult: "اشتباه" as const,
            inspectorResult: null, oppositeInspectorResult: null, liveMeansResult: null,
            xrayImageId: "XR-1", xrayEntryDate: null,
            targetedByRiskEngine: null, riskMessage: null, stage: "المستوى الأول",
            sourceSheetName: "s1", sourceRowNumber: 2,
          },
          validation: { valid: true as const },
          excludedByAdmin: false,
          assigned: false,
          assignedTo: null,
          assignedAt: null,
          namespacedXrayImageId: null,
        },
      ],
    };
    await ensureAdhocSampleMaster(root, record);
    const assigned = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "emp-1", "admin");
    expect(assigned.ok).toBe(true);

    render(<XrayInspectionResults directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-ACTIVE").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText("ADHOC-adh-1-XR-1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("استيراد يدوي")).toHaveLength(1);
  });
});
