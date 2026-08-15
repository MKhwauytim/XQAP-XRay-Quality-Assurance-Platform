/* @vitest-environment jsdom */
// Render-vs-handler permission gating regression tests (synthesis medium).
//
// XrayReferrals.tsx computes `readonly` and the onReplace/onRequestReopen render
// conditions for InspectionPanel independently of the handlers those controls call
// (handleSave / openReplacementDialog / handleRequestReopen). Before this fix, a
// role that owns its own sample (e.g. a bulk-assigned supervisor) but lacks the
// underlying mutate permission could see an editable form / working-looking button
// that then rejected at the handler with a permission error. These tests render
// the real component against a memory workspace and assert the control is simply
// absent, not merely "would fail if clicked".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The replacement-confirm path resolves the chosen candidate's full population row
// through the query worker instead of parsing population.final.json on the main
// thread (item 1.12), so this suite has to stand a worker up. Same WORKER BOUNDARY
// limitation the Browse suites document: Vitest cannot run a real DedicatedWorker.
// The shared stub is used rather than a bespoke fake because it runs the REAL
// `handleWorkerMessage` on a macrotask, one message per tick — so the "load" then
// "rowById" pair this path posts is exercised for behavior AND ordering, not just
// stubbed out to a canned row.
vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { clearReadLog, createMemoryDirectory, getReadLog } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
  type FeaturePermission,
} from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { safeWriteJson } from "../../../../../data/storage/safeWrite";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../../../../../data/workspace/workspacePaths";
import { appendDistributionEvents, loadDistributionLog, saveDistributionCurrent } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent, buildCompletedEvent, buildReassignEvent, buildReplacedEvent, deriveCurrentDistribution } from "../../../../../data/distribution/distributionLog";
import { closeMonth, invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import type { MonthManifestData } from "../../../../../data/population/monthTypes";
import { upsertItemAnswer } from "../../../../../data/answers/answerStorage";
import {
  appendReferralRequest,
  appendReplacementRequest,
  loadReferralLog,
} from "../../../../../data/referral/referralStorage";
import { readWorkspaceActions } from "../../../../../data/audit/actionLog";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { clearErrors, getRecentErrors } from "../../../../../data/storage/errorLogger";
import { getReplacementCandidatesIndexed } from "../../../../../data/distribution/replacementCandidateLookup";
import { executeReplacement } from "../../../../../data/distribution/replacement";
import { broadcastDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
import {
  resetBootProgress,
  useBootProgress,
  type BootSourceEntry,
} from "../../../../../data/workspace/bootProgress";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import XrayReferrals from "./XrayReferrals";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { ensureAdhocSampleMaster, assignAdhocRowsToEmployee } from "../../../../../data/adhocImport/adhocImportAssignment";
import type { AdhocImportRecord, AdhocImportRow } from "../../../../../data/adhocImport/adhocImportTypes";
import { adhocMonthFolderName } from "../../../../../data/adhocImport/adhocImportTypes";
import { getSampleMainDir } from "../../../../../data/workspace/workspacePaths";
import type { NormalizedRiskRow } from "../../Population/riskData/riskDataTypes";

const MONTH = "5-may-2026";

vi.mock("../../../../../data/distribution/replacementCandidateLookup", () => ({
  getReplacementCandidatesIndexed: vi.fn(),
}));

const getReplacementCandidatesIndexedMock = vi.mocked(getReplacementCandidatesIndexed);

// Partial mock: every test below keeps the REAL executeReplacement (the spread
// plus the delegating vi.fn), so only a test that explicitly installs a
// `…Once` override sees different behaviour. Needed because handleReplace's
// missing error boundary can only be exercised by making the call throw rather
// than return `{ ok: false }` — and the throwing sites in distributionStorage
// (its month-lock gate and directory resolution, both outside the inner try)
// are not reachable through the memory workspace without also breaking the
// reads handleReplace performs first.
vi.mock("../../../../../data/distribution/replacement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../data/distribution/replacement")>();
  return {
    ...actual,
    executeReplacement: vi.fn((...args: Parameters<typeof actual.executeReplacement>) =>
      actual.executeReplacement(...args)
    ),
  };
});

const executeReplacementMock = vi.mocked(executeReplacement);

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
  // `readOnlyMode` is a module-global that outlives a test file in a shared
  // worker. If any earlier file leaves it true, every `canMutate`-gated control
  // here silently stops rendering and the failure reads as "unable to find
  // role=dialog" — nothing that points at the real cause. Establish the state
  // this file needs rather than inheriting whatever ran before it.
  setReadOnlyMode(false);
  // `monthLock` memoises open/closed state in a module-level cache. Tests here
  // close a month mid-file, so a cache entry left by a previous test makes the
  // month-lock assertions depend on execution order. Clear it so each test sees
  // the workspace it actually seeded.
  invalidateMonthLockCache();
  // Default: graceful, non-throwing lookup — individual tests override with
  // mockRejectedValueOnce where the error path itself is under test.
  getReplacementCandidatesIndexedMock.mockReset().mockResolvedValue({ recommended: [], all: [] });
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

/** Seeds one sample row assigned (pending, no answer yet) to `username`. */
/** Seeds population.final.json directly (bypassing the full saveMonthRun flow,
 *  which needs far more params than this test cares about) so
 *  handleReplace's post-selection full-row resolution has something to find. */
async function seedPopulationFinal(root: DirectoryHandleLike, rows: PreparedPopulationRow[]): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true });
  await safeWriteJson(processedDir, "population.final.json", {
    sourceMonthFolder: MONTH,
    processedAt: new Date().toISOString(),
    processedBy: "admin",
    totalRows: rows.length,
    certScanRows: rows.filter((r) => r.certScanStatus === "Certscan").length,
    nonCertScanRows: rows.filter((r) => r.certScanStatus === "NonCertscan").length,
    rows,
  });
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

describe("XrayReferrals permission gating (render vs handler)", () => {
  // Default supervisor permissions no longer disable submit-answers (a live
  // workspace's own permission edits, since reflected as the new default —
  // supervisor now CAN submit). Both tests below specifically exercise the
  // "bulk-assigned supervisor who cannot submit answers" shape from the
  // synthesis finding regardless of what the ambient default happens to be,
  // so they override submit-answers explicitly on top of the default base —
  // same pattern as the request-replacement override test further down.
  function supervisorCannotSubmitAnswersState() {
    const base = createEmptyUserManagementState();
    const featurePermissions: FeaturePermission[] = [
      ...base.featurePermissions.filter(
        (f) => !(f.role === "supervisor" && f.featureId === "submit-answers")
      ),
      { role: "supervisor", featureId: "submit-answers", enabled: false },
    ];
    return { ...base, featurePermissions };
  }

  it("keeps the inspection form read-only when the role cannot submit answers, even for the user's own sample (bulk-assigned supervisor)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(supervisorCannotSubmitAnswersState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "sup-1");

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    // Previously: readonly = canSeeAll && assignedTo !== username — false for the
    // user's own sample regardless of canSubmitAnswers, so the form stayed editable
    // and only rejected once "تقديم" was actually clicked. Now it must never render.
    expect(screen.queryByRole("button", { name: "تقديم" })).not.toBeInTheDocument();
  });

  it("hides the self-service reopen-request button when the role cannot submit answers", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(supervisorCannotSubmitAnswersState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "sup-1");
    const answer: ItemAnswer = {
      xrayImageId: "IMG-1",
      templateId: "tmpl-x",
      templateVersion: 1,
      answers: [],
      lastSavedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      answeredBy: "sup-1",
      status: "submitted",
    };
    const upserted = await upsertItemAnswer(root, MONTH, "sup-1", answer);
    if (!upserted.ok) throw new Error(`seed answer failed: ${upserted.error}`);

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    // Previously: onRequestReopen only checked `assignedTo === username`, so the
    // button rendered and rejected with a permission error only once clicked.
    expect(screen.queryByRole("button", { name: "طلب إعادة فتح الحالة" })).not.toBeInTheDocument();
  });

  it("hides the replace-sample button when submit-referrals is enabled but request-replacement is not", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    const base = createEmptyUserManagementState();
    const featurePermissions: FeaturePermission[] = [
      ...base.featurePermissions.filter(
        (f) => !(f.role === "employee" && f.featureId === "request-replacement")
      ),
      { role: "employee", featureId: "request-replacement", enabled: false },
    ];
    writeUserManagementState({ ...base, featurePermissions }, false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    // Previously: onReplace's render condition accepted (canRequestReplacement ||
    // canSubmitReferrals), so an employee with only submit-referrals enabled saw a
    // working-looking "استبدال العينة" button that openReplacementDialog itself
    // would reject (it only ever checks canRequestReplacement).
    // Sanity: the panel did render editable (submit-answers is enabled by default
    // for employee), so the button's absence checked below is specifically about
    // onReplace, not about the whole panel being read-only. Waited for explicitly:
    // the detail panel only appears once the auto-select-first-row effect commits
    // a re-render after "IMG-1" first appears in the list, one tick later.
    await waitFor(() => expect(screen.getByRole("button", { name: "تقديم" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "استبدال العينة" })).not.toBeInTheDocument();
  });
});

describe("XrayReferrals replacement-candidate lookup error handling", () => {
  beforeEach(() => {
    clearErrors();
  });

  it("logs the failure and still opens the dialog with empty candidates when the indexed lookup throws", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    getReplacementCandidatesIndexedMock.mockRejectedValueOnce(new Error("index read failed"));

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    // Waited for explicitly: the detail panel (and its "استبدال العينة" button)
    // only appears once the auto-select-first-row effect commits a re-render
    // after "IMG-1" first appears in the list, one tick later.
    const replaceButton = await waitFor(() =>
      screen.getByRole("button", { name: "استبدال العينة" })
    );
    fireEvent.click(replaceButton);

    // Previously: a bare `catch { candidates = { recommended: [], all: [] }; }`
    // swallowed the failure with no trace — nothing in the error ring buffer for
    // Settings > error log to surface, unlike every other catch in this file.
    await waitFor(() =>
      expect(
        getRecentErrors().some((e) => e.context === "xrayReferrals:getReplacementCandidatesIndexed")
      ).toBe(true)
    );
    // The dialog still opens gracefully with empty candidate lists rather than
    // hanging or crashing.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("الموصى بها (0)")).toBeInTheDocument();
    expect(screen.getByText("كل البدائل (0)")).toBeInTheDocument();
  });
});

describe("XrayReferrals background data-refresh vs. an open inspection form", () => {
  it("does not discard an in-progress, unsaved answer draft when the app-wide data-refresh signal fires (5-minute auto-refresh / manual toolbar button)", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");

    // Seed and select an inspection template with one free-text field so the
    // detail panel renders an editable input to type an unsaved draft into.
    const template: TemplateSchema = {
      templateId: "tmpl-draft-test",
      templateName: "قالب الاختبار",
      version: 1,
      createdAt: new Date().toISOString(),
      createdBy: "admin",
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
      fields: [{ fieldId: "note", label: "ملاحظة", type: "text", required: false, options: [] }],
    };
    const savedTpl = await saveTemplate(root, template);
    if (!savedTpl.ok) throw new Error(`seed template failed: ${savedTpl.error}`);
    const savedSelection = await saveInspectionTemplateSelection(root, {
      templateId: template.templateId,
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
    });
    if (!savedSelection.ok) throw new Error(`seed template selection failed: ${savedSelection.error}`);

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    // Waited for explicitly: the detail panel's field only appears once the
    // auto-select-first-row effect commits and the seeded template finishes loading.
    const noteInput = await waitFor(() => screen.getByLabelText("ملاحظة")) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });
    expect(noteInput.value).toBe("مسودة غير محفوظة");

    // Simulate the app-wide data-refresh signal (AuthGate's 5-minute timer or the
    // manual toolbar refresh button) firing while the form is still open and unsaved.
    act(() => {
      broadcastDataRefresh();
    });

    // Previously: loadData's unconditional setLoadState("loading") + setSelEntryId(null)
    // unmounted the whole detail-panel block, so the "جاري التحميل..." placeholder briefly
    // took over and the panel remounted from scratch afterward, wiping the draft above.
    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();

    // Let the silent refresh's async reload settle, then confirm the draft survived.
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    const noteInputAfter = screen.getByLabelText("ملاحظة") as HTMLInputElement;
    expect(noteInputAfter.value).toBe("مسودة غير محفوظة");
  });
});

// Locates the <tr> for a given xrayImageId's cell among possibly multiple text
// matches on the page (the same id can also render inside the detail panel).
function findRowByXrayImageId(id: string): HTMLElement {
  const matches = screen.getAllByText(id);
  const row = matches.map((el) => el.closest("tr")).find((tr): tr is HTMLTableRowElement => tr !== null);
  if (!row) throw new Error(`no <tr> found containing "${id}"`);
  return row;
}

describe("XrayReferrals pending/resolved row coloring (Task 6)", () => {
  it("shows a row with a pending referral request instead of hiding it (Task 6)", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");

    // Previously: getPendingReferralIds hid this row entirely from the queue.
    const referralResult = await appendReferralRequest(root, MONTH, {
      requestId: "ref-1",
      monthFolderName: MONTH,
      fromEmployee: "emp-1",
      toEmployee: "emp-2",
      xrayImageIds: ["IMG-1"],
      reason: "test reason",
      requestedAt: new Date().toISOString(),
      requestedBy: "emp-1",
      status: "pending",
    });
    if (!referralResult.ok) throw new Error(`seed referral failed: ${referralResult.error}`);

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const row = findRowByXrayImageId("IMG-1");
    expect(row).toHaveClass("dt-tr--pending");
  });

  it("shows a row with a pending replacement request instead of hiding it (Task 6)", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");

    // Non-recommended replace path — files a pending ReplacementRequest with no
    // equivalent filter existing before this task.
    const replacementResult = await appendReplacementRequest(root, MONTH, {
      requestId: "rep-1",
      monthFolderName: MONTH,
      employeeUsername: "emp-1",
      originalXrayImageId: "IMG-1",
      replacementXrayImageId: "IMG-2",
      reason: "blurry",
      requestedAt: new Date().toISOString(),
      requestedBy: "emp-1",
      status: "pending",
    });
    if (!replacementResult.ok) throw new Error(`seed replacement failed: ${replacementResult.error}`);

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const row = findRowByXrayImageId("IMG-1");
    expect(row).toHaveClass("dt-tr--pending");
  });

  it("shows a resolved (replaced) row with a distinct color, not hidden", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");

    // Previously: `all.filter(... e.status !== "replaced" ...)` hid this row
    // for the assigned employee entirely.
    const replaceEventResult = await appendDistributionEvents(root, MONTH, [
      buildReplacedEvent({
        xrayImageId: "IMG-1",
        assignedTo: "emp-1",
        replacedById: "IMG-2",
        eventBy: "emp-1",
      }),
    ]);
    if (!replaceEventResult.ok) throw new Error(`seed replaced event failed: ${replaceEventResult.error}`);

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const row = findRowByXrayImageId("IMG-1");
    expect(row).toHaveClass("dt-tr--resolved");
    expect(row).not.toHaveClass("dt-tr--pending");
  });
});

describe("XrayReferrals post-success reloads (Bug 1 regression)", () => {
  // Shared template + selection so the detail panel renders an editable input to
  // type an unsaved draft into — mirrors the existing background-refresh-vs-draft
  // test above, but exercises the *action's own* post-success reload instead of
  // the periodic/manual data-refresh signal.
  async function seedDraftableTemplate(root: DirectoryHandleLike): Promise<void> {
    const template: TemplateSchema = {
      templateId: "tmpl-draft-test",
      templateName: "قالب الاختبار",
      version: 1,
      createdAt: new Date().toISOString(),
      createdBy: "admin",
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
      fields: [{ fieldId: "note", label: "ملاحظة", type: "text", required: false, options: [] }],
    };
    const savedTpl = await saveTemplate(root, template);
    if (!savedTpl.ok) throw new Error(`seed template failed: ${savedTpl.error}`);
    const savedSelection = await saveInspectionTemplateSelection(root, {
      templateId: template.templateId,
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
    });
    if (!savedSelection.ok) throw new Error(`seed template selection failed: ${savedSelection.error}`);
  }

  it("does not flash the loading state or discard an unsaved draft after successfully submitting a reassignment ('إسناد لموظف آخر') request", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");
    await seedDraftableTemplate(root);

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });
    expect(noteInput.value).toBe("مسودة غير محفوظة");

    const reassignButton = await waitFor(() => screen.getByRole("button", { name: "إسناد لموظف آخر" }));
    fireEvent.click(reassignButton);

    const toEmployeeSelect = (await waitFor(() => screen.getByLabelText(/الموظف المستلم/))) as HTMLSelectElement;
    // Any default managed user other than "emp-1" works — "jalgahamdi" is one of
    // createEmptyUserManagementState's seeded default employees.
    fireEvent.change(toEmployeeSelect, { target: { value: "jalgahamdi" } });
    const reasonInput = screen.getByLabelText(/سبب الإحالة/);
    fireEvent.change(reasonInput, { target: { value: "بحاجة لمراجعة موظف آخر" } });
    await waitFor(() =>
      expect(screen.getByText(/سيتم إرسال طلب إحالة 1 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByLabelText(/أؤكد مراجعة الملخص/));
    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الإحالة" }));

    // Before the fix: the submit handler's post-success `await loadData()` (no
    // `{ silent: true }`) flipped loadState to "loading", unmounting the whole
    // detail-panel block and force-closing the just-typed draft above — the exact
    // "refresh that's supposed to be silent" the user reported.
    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText(/تم إرسال طلب إحالة 1 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    const noteInputAfter = screen.getByLabelText("ملاحظة") as HTMLInputElement;
    expect(noteInputAfter.value).toBe("مسودة غير محفوظة");
  });

  it("does not flash the loading state or discard an unsaved draft after successfully applying a recommended (auto-approved) sample replacement", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");
    await seedDraftableTemplate(root);

    const replacementRow = makeRow("IMG-2");
    getReplacementCandidatesIndexedMock.mockResolvedValue({ recommended: [replacementRow], all: [] });
    // The candidate lookup is mocked (this test targets loadData refresh timing,
    // not the lookup itself), but handleReplace's immediate-replace path now
    // resolves the FULL row from population.final.json by id before executing
    // (the candidate list only ever carries the slim replacement-index
    // projection) — so the chosen candidate must actually exist there.
    await seedPopulationFinal(root, [replacementRow]);

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });

    const replaceButton = await waitFor(() => screen.getByRole("button", { name: "استبدال العينة" }));
    fireEvent.click(replaceButton);

    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    fireEvent.change(within(dialog).getByLabelText(/سبب الاستبدال/), {
      target: { value: "صورة غير واضحة" },
    });
    // "الموصى بها" (recommended) tab is selected by default since state.recommended
    // is non-empty — its row action is "اختيار" and takes the immediate,
    // no-approval-needed branch of handleReplace (fromRecommended === true).
    fireEvent.click(within(dialog).getByRole("button", { name: "اختيار" }));

    // Before the fix: handleReplace's post-success `await loadData()` (no
    // `{ silent: true }`) flipped loadState to "loading", unmounting the whole
    // detail-panel block and force-closing the just-typed draft above.
    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("تم استبدال العينة وإسناد البديل.")).toBeInTheDocument()
    );
    // Deliberate selection change, not a bug: handleReplace intentionally moves
    // selEntryId onto the new replacement row afterward, so a fresh (empty) panel
    // for IMG-2 replacing IMG-1's is the correct outcome here — this test's job
    // is only to confirm that transition happens without ever flashing the
    // "loading" gate (checked above, and still true once everything settles).
    await waitFor(() => expect(screen.getAllByText("IMG-2").length).toBeGreaterThan(0));
    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();
  });

  // handleReplace used to be `try { … } finally { setReplacementBusy(false) }`
  // with no catch at all. executeReplacement can throw rather than return
  // `{ ok: false }` — its month-lock gate and its distribution-directory
  // resolution both sit outside appendDistributionEvents' inner try — and every
  // such throw became an unhandled promise rejection: the dialog simply went
  // quiet, with no message and no way to tell whether the replacement had been
  // applied. On a UNC share (the reported case) that was the common outcome.
  it("shows an Arabic error and logs the detail when executeReplacement throws instead of returning a failure result", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");
    await seedDraftableTemplate(root);

    const replacementRow = makeRow("IMG-2");
    getReplacementCandidatesIndexedMock.mockResolvedValue({ recommended: [replacementRow], all: [] });
    await seedPopulationFinal(root, [replacementRow]);

    clearErrors();
    const notFound = new Error(
      "A requested file or directory could not be found at the time an operation was processed."
    );
    notFound.name = "NotFoundError";
    executeReplacementMock.mockRejectedValueOnce(notFound);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "استبدال العينة" })));
    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    fireEvent.change(within(dialog).getByLabelText(/سبب الاستبدال/), {
      target: { value: "صورة غير واضحة" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "اختيار" }));

    // Arabic, generic, and shown — not silence, and not the raw DOMException.
    await waitFor(() =>
      expect(screen.getAllByText(/تعذّر إتمام العملية بسبب خطأ غير متوقع أثناء الحفظ/).length)
        .toBeGreaterThan(0)
    );
    expect(screen.queryByText(/could not be found at the time an operation/)).not.toBeInTheDocument();

    // The raw detail still reaches the admin error log for diagnosis.
    expect(
      getRecentErrors().some(
        (entry) =>
          entry.context === "xrayReferrals:handleReplace" &&
          entry.message.includes("could not be found")
      )
    ).toBe(true);
  });
});

// Boot-progress instrumentation: loadData's existing fetch pass (sample.master,
// referral/replacement requests, distribution, and this user's own sample-mirror
// / answers files) must report to the post-login source checklist (bootProgress.ts)
// on its initial mount pass only — never on a later month switch, post-action
// reload, or the { silent: true } periodic/manual data-refresh — without changing
// what loadData itself fetches. See referralsBootSources in XrayReferrals.tsx.
describe("XrayReferrals boot-progress reporting (initial load only)", () => {
  it("registers and marks loaded the referral-queue sources on the initial mount for a personal-scope employee", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");

    const { result } = renderHook(() => useBootProgress());
    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(result.current.allLoaded).toBe(true));

    const keys = result.current.entries.map((entry) => entry.key);
    expect(keys).toEqual([
      "referrals_sample_master",
      "referrals_requests",
      "referrals_distribution",
      "referrals_sample_mirror",
      "referrals_answers",
      "referrals_adhoc",
    ]);
    expect(result.current.entries.every((entry) => entry.status === "loaded")).toBe(true);
    // Real on-disk file names, not a "{username}" placeholder pattern.
    expect(result.current.entries.find((e) => e.key === "referrals_sample_mirror")?.labelEn).toBe(
      "emp-1.samples.json"
    );
    expect(result.current.entries.find((e) => e.key === "referrals_answers")?.labelEn).toBe(
      "emp-1.answers.json"
    );
  });

  it("omits referrals_sample_mirror for an oversight (view-all-entries) role, matching loadData's own canSeeAll branch", async () => {
    // Default supervisor permissions include view-all-entries: true (see the
    // permission-gating describe block above), which is what makes loadData skip
    // loadEmployeeSampleMirror entirely.
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "sup-1");

    const { result } = renderHook(() => useBootProgress());
    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(result.current.allLoaded).toBe(true));

    const keys = result.current.entries.map((entry) => entry.key);
    expect(keys).toEqual([
      "referrals_sample_master",
      "referrals_requests",
      "referrals_distribution",
      "referrals_answers",
      "referrals_adhoc",
    ]);
    expect(keys).not.toContain("referrals_sample_mirror");
  });

  it("never re-touches the boot-progress store on the silent background data-refresh, so a checklist the user is already past can't re-flicker", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1");

    // Records every entries snapshot this hook ever renders with — including
    // ones this test doesn't explicitly wait for — so a regression that removes
    // the initial-mount gate (letting the silent refresh call registerBootSources/
    // markBootSourceLoading again) shows up as extra history entries even if the
    // final terminal state happens to look identical to before.
    const history: BootSourceEntry[][] = [];
    renderHook(() => {
      const { entries } = useBootProgress();
      history.push(entries.map((entry) => ({ ...entry })));
      return entries;
    });
    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() =>
      expect(history[history.length - 1]?.every((entry) => entry.status === "loaded")).toBe(true)
    );
    const checkpoint = history.length;

    // Simulate the app-wide data-refresh signal (AuthGate's periodic timer or the
    // manual toolbar button) — XrayReferrals' own subscription always passes
    // { silent: true } to loadData for this signal (see the component).
    act(() => {
      broadcastDataRefresh();
    });
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    expect(history.length).toBe(checkpoint);
  });
});

// ── Bulk reassignment (oversight roles) ─────────────────────────────────────
// The capability gap this feature closes: a supervisor/manager filtering their
// queue to a category and reassigning all (or part) of it to another employee
// in one action, instead of one row at a time. Covers: select-all-filtered vs
// manual selection staying distinct, the reassignment going through the real
// distribution event log, month-lock rejection, permission gating, and
// partial-failure (skip) reporting.
describe("XrayReferrals bulk reassignment (oversight roles)", () => {
  beforeEach(() => {
    invalidateMonthLockCache();
  });

  /** Two rows, both assigned (pending) to `assignee` — distinct ids so the
   *  DataTable global search can filter down to just one of them. */
  async function seedTwoAssignedSamples(root: DirectoryHandleLike, assignee: string): Promise<void> {
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1"), makeRow("IMG-2")]));
    const result = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: assignee, eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: assignee, eventBy: "admin" }),
    ]);
    if (!result.ok) throw new Error(`seed failed: ${result.error}`);
  }

  function supervisorWithBulkReassignDisabled() {
    const base = createEmptyUserManagementState();
    const featurePermissions: FeaturePermission[] = [
      ...base.featurePermissions.filter(
        (f) => !(f.role === "supervisor" && f.featureId === "bulk-reassign-referrals")
      ),
      { role: "supervisor", featureId: "bulk-reassign-referrals", enabled: false },
    ];
    return { ...base, featurePermissions };
  }

  it("shows per-row checkboxes and the bulk-reassign bar for an oversight role with the feature enabled (default)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "sup-1");

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("IMG-2").length).toBeGreaterThan(0);

    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("0 محددة يدوياً")).toBeInTheDocument();
    // filteredCount comes from DataTable's onFilteredRowsChange, which commits
    // one tick after the rows themselves first render.
    await waitFor(() => expect(screen.getByText(/2 مطابقة للتصفية\/البحث الحالي/)).toBeInTheDocument());
  });

  it("hides per-row checkboxes and the bulk-reassign bar when bulk-reassign-referrals is disabled for the role (render-boundary permission gating)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(supervisorWithBulkReassignDisabled(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "sup-1");

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText(/محددة يدوياً/)).not.toBeInTheDocument();
  });

  it("select-all-filtered stays distinct from a manual page selection and reassigns only the filtered subset (select-all-filtered vs select-page + the reassignment event path)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "sup-1");

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    // Narrow the active filter to IMG-2 only.
    const search = screen.getByPlaceholderText("بحث في جميع الأعمدة...");
    fireEvent.change(search, { target: { value: "IMG-2" } });
    await waitFor(() => expect(screen.getByText(/1 مطابقة للتصفية\/البحث الحالي/)).toBeInTheDocument());

    // "تحديد الكل المطابق" must select exactly the filtered set (1), never both rows.
    fireEvent.click(screen.getByRole("button", { name: "تحديد الكل المطابق" }));
    await waitFor(() => expect(screen.getByText("1 محددة يدوياً")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "إسناد المحدد (1)" }));

    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    expect(within(dialog).getByText(/العينات المحددة يدوياً \(1\)/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/الموظف المستلم/), { target: { value: "jalgahamdi" } });
    await waitFor(() =>
      expect(within(dialog).getByText(/سيتم إرسال طلب إحالة 1 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    fireEvent.change(within(dialog).getByLabelText(/سبب الإحالة/), { target: { value: "إعادة توزيع العمل" } });
    fireEvent.click(within(dialog).getByLabelText(/أؤكد مراجعة الملخص/));
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }));

    await waitFor(() =>
      expect(screen.getByText(/تم إرسال طلب إحالة 1 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );

    // Nothing is applied until the request is approved — the record is the outcome.
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.filter((e) => e.eventType === "reassigned")).toHaveLength(0);

    const referrals = await loadReferralLog(root, MONTH);
    expect(referrals.requests).toHaveLength(1);
    expect(referrals.requests[0]!.status).toBe("pending");
    expect(referrals.requests[0]!.toEmployee).toBe("jalgahamdi");
    expect(referrals.requests[0]!.xrayImageIds).toEqual(["IMG-2"]);
  });

  it("counts only reassignable rows on the bar's buttons and never feeds a terminal row to the request (the button's number is what actually gets requested)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "sup-1");
    // IMG-1 is completed — terminal, must be excluded from the bulk reassignment.
    const completedResult = await appendDistributionEvents(root, MONTH, [
      buildCompletedEvent({ xrayImageId: "IMG-1", assignedTo: "sup-1", eventBy: "sup-1" }),
    ]);
    if (!completedResult.ok) throw new Error(`seed failed: ${completedResult.error}`);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-2").length).toBeGreaterThan(0));

    // Both rows match the filter, but only IMG-2 can move. The button must
    // promise 1, not 2 — a count the submit path would then quietly reduce is
    // exactly what made these buttons look broken. The raw filter total is
    // still disclosed next to it, so nothing is hidden.
    const filteredButton = await waitFor(() =>
      screen.getByRole("button", { name: "إسناد الكل المطابق للتصفية (1)" })
    );
    expect(screen.getByText(/2 مطابقة للتصفية\/البحث الحالي.*1 قابلة للإسناد/)).toBeInTheDocument();

    // "تحديد الكل المطابق" must not tick the completed row either.
    fireEvent.click(screen.getByRole("button", { name: "تحديد الكل المطابق" }));
    await waitFor(() => expect(screen.getByText("1 محددة يدوياً")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "إسناد المحدد (1)" })).toBeEnabled();

    fireEvent.click(filteredButton);

    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    fireEvent.change(within(dialog).getByLabelText(/الموظف المستلم/), { target: { value: "jalgahamdi" } });

    await waitFor(() =>
      expect(within(dialog).getByText(/سيتم إرسال طلب إحالة 1 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    // The terminal row never entered the id list, so there is nothing to skip
    // and no warning to show — the count on the button was already the truth.
    expect(within(dialog).queryByText(/لن يتم تضمين/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/كل العينات المطابقة للتصفية الحالية \(1\)/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/سبب الإحالة/), { target: { value: "إعادة توزيع العمل" } });
    fireEvent.click(within(dialog).getByLabelText(/أؤكد مراجعة الملخص/));
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }));

    await waitFor(() =>
      expect(screen.getByText(/تم إرسال طلب إحالة 1 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/تم تخطي/)).not.toBeInTheDocument();

    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.filter((e) => e.eventType === "reassigned")).toHaveLength(0);

    const referrals = await loadReferralLog(root, MONTH);
    expect(referrals.requests).toHaveLength(1);
    expect(referrals.requests[0]!.xrayImageIds).toEqual(["IMG-2"]);
  });

  it("keeps the skip report for what the bar's counts cannot know in advance — a row already owned by the chosen target", async () => {
    // The planner's skip machinery is still load-bearing: 'already-assigned-to-target'
    // depends on a target employee, which is only chosen inside the dialog, so it can
    // never be reflected in a button count. This pins that the warning still renders
    // and that the ineligible row is dropped from the written request.
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "sup-1");
    // IMG-1 already belongs to the employee we are about to reassign to.
    const moved = await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({
        xrayImageId: "IMG-1",
        assignedTo: "sup-1",
        reassignedTo: "jalgahamdi",
        eventBy: "sup-1",
      }),
    ]);
    if (!moved.ok) throw new Error(`seed failed: ${moved.error}`);

    render(<XrayReferrals directoryHandle={root} />);
    // IMG-1 now belongs to jalgahamdi, so it is outside the default
    // "المحالة لي" oversight view — widen to الكل to get both rows on screen.
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "الكل" })));
    await waitFor(() => expect(screen.getAllByText("IMG-2").length).toBeGreaterThan(0));

    // Both rows are pending, so the button legitimately counts 2 here.
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "إسناد الكل المطابق للتصفية (2)" })));

    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    fireEvent.change(within(dialog).getByLabelText(/الموظف المستلم/), { target: { value: "jalgahamdi" } });

    await waitFor(() =>
      expect(within(dialog).getByText(/سيتم إرسال طلب إحالة 1 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    expect(within(dialog).getByText(/لن يتم تضمين 1 عينة/)).toBeInTheDocument();
    expect(within(dialog).getByText(/معيّنة للموظف المستهدف بالفعل/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/سبب الإحالة/), { target: { value: "إعادة توزيع العمل" } });
    fireEvent.click(within(dialog).getByLabelText(/أؤكد مراجعة الملخص/));
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }));

    await waitFor(() =>
      expect(screen.getByText(/تم إرسال طلب إحالة 1 عينة إلى jalgahamdi.*تم تخطي 1 عينة/)).toBeInTheDocument()
    );

    const referrals = await loadReferralLog(root, MONTH);
    expect(referrals.requests).toHaveLength(1);
    expect(referrals.requests[0]!.xrayImageIds).toEqual(["IMG-2"]);
  });

  it("surfaces a closed month inside the modal instead of throwing, and writes nothing (month-lock rejection)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "sup-1");

    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    const manifest: MonthManifestData = {
      monthFolderName: MONTH, month: 5, year: 2026,
      processedAt: new Date().toISOString(), processedBy: "admin",
      riskFileName: null, biFileName: null, certScanUsed: false,
      templateVersion: null, rngSeed: null, totalRawRows: 0, totalProcessedRows: 2,
      status: "distributed",
    };
    await safeWriteJson(monthDir, "month.manifest.json", manifest);
    await closeMonth(root, MONTH, "admin");

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-2").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: /إسناد الكل المطابق للتصفية/ }));
    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    fireEvent.change(within(dialog).getByLabelText(/الموظف المستلم/), { target: { value: "jalgahamdi" } });
    await waitFor(() =>
      expect(within(dialog).getByText(/سيتم إرسال طلب إحالة 2 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    fireEvent.change(within(dialog).getByLabelText(/سبب الإحالة/), { target: { value: "إعادة توزيع العمل" } });
    fireEvent.click(within(dialog).getByLabelText(/أؤكد مراجعة الملخص/));
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }));

    await waitFor(() =>
      expect(within(dialog).getByText(/هذا الشهر مُقفل/)).toBeInTheDocument()
    );
    // Modal stays open (safely retryable), not silently closed.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.filter((e) => e.eventType === "reassigned")).toHaveLength(0);
  });

  it("keeps a manual bulk-reassign selection intact across an intervening silent background refresh (data-refresh signal fires between selection and click)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "sup-1");

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    // Wait for the filtered count to settle before selecting, same as the
    // other tests in this file — the filtered/selectable count itself commits
    // one tick after the rows first render.
    await waitFor(() => expect(screen.getByText(/2 مطابقة للتصفية\/البحث الحالي/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "تحديد الكل المطابق" }));
    await waitFor(() => expect(screen.getByText("2 محددة يدوياً")).toBeInTheDocument());

    // A background/periodic data-refresh signal fires here — e.g. the
    // 3-minute auto-refresh timer, or another tab/device writing a change —
    // strictly BETWEEN the user's selection and their click. loadData's
    // `silent` path (see XrayReferrals.tsx) must re-fetch and swap rows in
    // place without touching selectedIds; only the non-silent path (a real
    // month/user change) is allowed to reset the selection.
    await act(async () => {
      broadcastDataRefresh("periodic");
      await Promise.resolve();
      await Promise.resolve();
    });

    // The selection must have survived the silent refresh — the bar still
    // reports both rows selected, not zero.
    await waitFor(() => expect(screen.getByText("2 محددة يدوياً")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "إسناد المحدد (2)" }));

    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    expect(within(dialog).getByText(/العينات المحددة يدوياً \(2\)/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/الموظف المستلم/), { target: { value: "jalgahamdi" } });
    await waitFor(() =>
      expect(within(dialog).getByText(/سيتم إرسال طلب إحالة 2 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    fireEvent.change(within(dialog).getByLabelText(/سبب الإحالة/), { target: { value: "إعادة توزيع العمل" } });
    fireEvent.click(within(dialog).getByLabelText(/أؤكد مراجعة الملخص/));
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }));

    await waitFor(() =>
      expect(screen.getByText(/تم إرسال طلب إحالة 2 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );

    const log2 = await loadDistributionLog(root, MONTH);
    expect(log2.events.filter((e) => e.eventType === "reassigned")).toHaveLength(0);

    const referrals = await loadReferralLog(root, MONTH);
    expect(referrals.requests).toHaveLength(1);
    expect(referrals.requests[0]!.xrayImageIds.slice().sort()).toEqual(["IMG-1", "IMG-2"]);
  });

  it("opens the bulk-reassign-all-filtered dialog immediately once the filtered row set is on screen, with no race window where the button is unresponsive (regression for the DataTable filtered-rows notification lag)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "sup-1");

    render(<XrayReferrals directoryHandle={root} />);
    // Deliberately do NOT wait for the "N مطابقة للتصفية" count text — only
    // for the rows themselves to appear, then click immediately. Before the
    // DataTable fix (reporting filtered rows via a layout effect instead of a
    // passive effect), `selectableVisibleIds` could still be its stale/empty
    // initial value at this exact moment, leaving the button disabled or the
    // handler's internal empty-selection guard silently no-op the click.
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("IMG-2").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /إسناد الكل المطابق للتصفية/ }));

    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    expect(within(dialog).getByText(/كل العينات المطابقة للتصفية الحالية \(2\)/)).toBeInTheDocument();
  });

  it("produces the same request shape from all three sample-choosing methods (single sample, manual selection, whole filter)", async () => {
    // The point of the unification: إسناد لموظف آخر, إسناد المحدد and
    // إسناد الكل المطابق differ ONLY in how the id list is built. Any
    // divergence in what they write is a regression.
    async function submitVia(open: () => void, expectedIds: string[]) {
      writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
      writeUserManagementState(createEmptyUserManagementState(), false);
      const root = createMemoryDirectory("root");
      await seedTwoAssignedSamples(root, "sup-1");
      render(<XrayReferrals directoryHandle={root} />);
      await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
      await waitFor(() => expect(screen.getByText(/2 مطابقة للتصفية/)).toBeInTheDocument());

      open();

      const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
      fireEvent.change(within(dialog).getByLabelText(/الموظف المستلم/), { target: { value: "jalgahamdi" } });
      fireEvent.change(within(dialog).getByLabelText(/سبب الإحالة/), { target: { value: "توحيد المسار" } });
      await waitFor(() =>
        expect(within(dialog).getByText(/سيتم إرسال طلب إحالة/)).toBeInTheDocument()
      );
      fireEvent.click(within(dialog).getByLabelText(/أؤكد مراجعة الملخص/));
      fireEvent.click(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }));
      await waitFor(() => expect(screen.getByText(/تم إرسال طلب إحالة/)).toBeInTheDocument());

      const referrals = await loadReferralLog(root, MONTH);
      expect(referrals.requests).toHaveLength(1);
      const request = referrals.requests[0]!;
      expect(request.status).toBe("pending");
      expect(request.fromEmployee).toBe("sup-1");
      expect(request.toEmployee).toBe("jalgahamdi");
      expect(request.xrayImageIds.slice().sort()).toEqual(expectedIds);
      expect(request.reason).toContain("توحيد المسار");
      // No sample moves on submission, whichever entry point was used.
      const log = await loadDistributionLog(root, MONTH);
      expect(log.events.filter((e) => e.eventType === "reassigned")).toHaveLength(0);
      cleanup();
    }

    // 1. One sample, from the inspection panel.
    await submitVia(() => {
      fireEvent.click(screen.getByRole("button", { name: "إسناد لموظف آخر" }));
    }, ["IMG-1"]);

    // 2. A manual selection.
    await submitVia(() => {
      fireEvent.click(screen.getByRole("button", { name: "تحديد الكل المطابق" }));
      fireEvent.click(screen.getByRole("button", { name: /إسناد المحدد/ }));
    }, ["IMG-1", "IMG-2"]);

    // 3. Everything matching the current filter.
    await submitVia(() => {
      fireEvent.click(screen.getByRole("button", { name: /إسناد الكل المطابق للتصفية/ }));
    }, ["IMG-1", "IMG-2"]);
  });

  it("records the bulk-reassign submission in the workspace action log (governance trail)", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "sup-1");

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: /إسناد الكل المطابق للتصفية/ }));
    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    fireEvent.change(within(dialog).getByLabelText(/الموظف المستلم/), { target: { value: "jalgahamdi" } });
    await waitFor(() =>
      expect(within(dialog).getByText(/سيتم إرسال طلب إحالة 2 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    fireEvent.change(within(dialog).getByLabelText(/سبب الإحالة/), { target: { value: "إعادة توزيع العمل" } });
    fireEvent.click(within(dialog).getByLabelText(/أؤكد مراجعة الملخص/));
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }));

    await waitFor(() =>
      expect(screen.getByText(/تم إرسال طلب إحالة 2 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );

    // appendWorkspaceAction is fire-and-forget, so poll the log rather than
    // assuming it has landed by the time the status message renders.
    await waitFor(async () => {
      const actions = await readWorkspaceActions(root);
      const entry = actions.find((a) => a.action === "referral-requested");
      expect(entry).toBeDefined();
      expect(entry!.actor).toBe("sup-1");
      expect(entry!.target).toBe("jalgahamdi");
      expect(entry!.details?.samples).toBe(2);
    });
  });

  it("creates a pending request against the CURRENT owner of the samples, applying nothing — even for a supervisor who can approve it themselves", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "emp-a");

    render(<XrayReferrals directoryHandle={root} />);
    // The samples belong to another employee, so switch the oversight view off
    // "my samples only" before they are on screen at all.
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "الكل" })));
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: /إسناد الكل المطابق للتصفية/ }));
    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    fireEvent.change(within(dialog).getByLabelText(/الموظف المستلم/), { target: { value: "jalgahamdi" } });

    // The dialog must say the click submits a request, not that it moves samples.
    await waitFor(() =>
      expect(
        within(dialog).getByText(/سيتم إرسال طلب إحالة 2 عينة إلى jalgahamdi — بانتظار الاعتماد/)
      ).toBeInTheDocument()
    );
    fireEvent.change(within(dialog).getByLabelText(/سبب الإحالة/), { target: { value: "إعادة توزيع العمل" } });
    fireEvent.click(within(dialog).getByLabelText(/أؤكد مراجعة الملخص/));
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }));

    await waitFor(() =>
      expect(screen.getByText(/بانتظار موافقة المشرف/)).toBeInTheDocument()
    );

    // Nothing moved: the samples still belong to emp-a until someone approves.
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.filter((e) => e.eventType === "reassigned")).toHaveLength(0);

    const referrals = await loadReferralLog(root, MONTH);
    expect(referrals.requests).toHaveLength(1);
    expect(referrals.requests[0]!.status).toBe("pending");
    expect(referrals.requests[0]!.fromEmployee).toBe("emp-a");
    expect(referrals.requests[0]!.toEmployee).toBe("jalgahamdi");
    expect(referrals.requests[0]!.xrayImageIds.sort()).toEqual(["IMG-1", "IMG-2"]);

    await waitFor(async () => {
      const actions = await readWorkspaceActions(root);
      expect(actions.some((a) => a.action === "referral-requested")).toBe(true);
    });
  });

  it("gives a personal-scope employee the same one bar — including 'all matching the filter', which used to be an oversight-only capability", async () => {
    // There were two bars: a personal one offering ONLY a manual selection and
    // labelled إحالة المحدد, and an oversight one offering both methods under
    // إعادة تعيين... Same dialog, same request, three names, and an arbitrary
    // capability gap. One bar now serves both, so an employee can hand over a
    // filtered slice of their own queue in one action.
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedTwoAssignedSamples(root, "emp-1");

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    // The bar is visible with nothing selected (the old personal bar only
    // appeared after a row was ticked, hiding its own select-all affordance).
    expect(screen.getByText("0 محددة يدوياً")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إسناد المحدد (0)" })).toBeDisabled();

    const filteredButton = await waitFor(() =>
      screen.getByRole("button", { name: "إسناد الكل المطابق للتصفية (2)" })
    );
    fireEvent.click(filteredButton);

    const dialog = await waitFor(() => screen.getByRole("dialog"), { timeout: 5000 });
    expect(within(dialog).getByRole("heading", { name: "إسناد لموظف آخر" })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/الموظف المستلم/), { target: { value: "jalgahamdi" } });
    fireEvent.change(within(dialog).getByLabelText(/سبب الإحالة/), { target: { value: "إجازة" } });
    await waitFor(() =>
      expect(within(dialog).getByText(/سيتم إرسال طلب إحالة 2 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );
    fireEvent.click(within(dialog).getByLabelText(/أؤكد مراجعة الملخص/));
    fireEvent.click(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }));

    await waitFor(() =>
      expect(screen.getByText(/تم إرسال طلب إحالة 2 عينة إلى jalgahamdi/)).toBeInTheDocument()
    );

    const referrals = await loadReferralLog(root, MONTH);
    expect(referrals.requests).toHaveLength(1);
    expect(referrals.requests[0]!.status).toBe("pending");
    expect(referrals.requests[0]!.fromEmployee).toBe("emp-1");
    expect(referrals.requests[0]!.xrayImageIds.slice().sort()).toEqual(["IMG-1", "IMG-2"]);

    // Still a request only — an employee cannot move their own work unilaterally.
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.filter((e) => e.eventType === "reassigned")).toHaveLength(0);
  });
});

// ── THE GAP fix: ad-hoc-imported assignments must be visible here too ──────
// (see src/data/adhocImport/adhocImportEmployeeView.ts). These render the real
// component against a memory workspace exactly like the suites above, seeding
// an ad-hoc assignment through the SAME event-sourced path the AdhocImport tab
// uses (ensureAdhocSampleMaster + assignAdhocRowsToEmployee), not a stub.

function mappedAdhocRow(xrayImageId: string, sourceRowNumber = 2): NormalizedRiskRow {
  return {
    movementType: "s1",
    portCode: null, portName: "ميناء جدة", portType: "بحري",
    movementNumber: null, movementDate: null, movementHijriDate: null,
    declarationNumber: "DEC-1", transitDeclarationNumber: null, declarationDate: null, declarationHijriDate: null,
    manifestNumber: null, manifestType: null, manifestDate: null,
    plateOrContainerNumber: null, finalDestination: null,
    entryDate: null, exitDate: null,
    chassisNumber: null, reportNumber: null, hasReport: false,
    xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "اشتباه",
    inspectorResult: null, oppositeInspectorResult: null, liveMeansResult: null,
    xrayImageId, xrayEntryDate: null,
    targetedByRiskEngine: null, riskMessage: null, stage: "المستوى الأول",
    sourceSheetName: "s1", sourceRowNumber,
  };
}

function adhocImportRow(xrayImageId: string, sourceRowNumber = 2): AdhocImportRow {
  return {
    rowKey: `s1:${sourceRowNumber}`,
    mapped: mappedAdhocRow(xrayImageId, sourceRowNumber),
    validation: { valid: true },
    excludedByAdmin: false,
    assigned: false,
    assignedTo: null,
    assignedAt: null,
    namespacedXrayImageId: null,
  };
}

function makeAdhocRecord(importId: string, rows: AdhocImportRow[]): AdhocImportRecord {
  return {
    importId,
    fileName: `${importId}.xlsx`,
    importedBy: "admin",
    importedAt: "2026-08-07T10:00:00.000Z",
    status: "open",
    rows,
  };
}

describe("XrayReferrals — ad-hoc import visibility (THE GAP fix)", () => {
  it("shows an ad-hoc-imported assignment alongside the month's real samples, visually tagged as ad-hoc", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1", "IMG-1");

    const record = makeAdhocRecord("adh-1", [adhocImportRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);
    const assigned = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "emp-1", "admin");
    expect(assigned.ok).toBe(true);

    render(<XrayReferrals directoryHandle={root} />);

    // The real monthly sample renders...
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    // ...and the ad-hoc row appears too, carrying the visible "استيراد يدوي" badge —
    // exactly once (the real row above must NOT be tagged as ad-hoc).
    await waitFor(() => expect(screen.getAllByText("ADHOC-adh-1-XR-1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("استيراد يدوي")).toHaveLength(1);
  });

  it("does not show an ad-hoc row from an import with no assignment for the current user", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1", "IMG-1");

    const record = makeAdhocRecord("adh-2", [adhocImportRow("XR-9")]);
    await ensureAdhocSampleMaster(root, record);
    // Assigned to someone else entirely.
    await assignAdhocRowsToEmployee(root, record, ["s1:2"], "emp-2", "admin");

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    expect(screen.queryByText("ADHOC-adh-2-XR-9")).not.toBeInTheDocument();
  });

  it("still renders the month's real assignments when an ad-hoc store is corrupt (degrades, never blanks the page)", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "emp-1", "IMG-1");

    const record = makeAdhocRecord("adh-3", [adhocImportRow("XR-1")]);
    await ensureAdhocSampleMaster(root, record);
    const assigned = await assignAdhocRowsToEmployee(root, record, ["s1:2"], "emp-1", "admin");
    expect(assigned.ok).toBe(true);

    // Corrupt the ad-hoc import's sample.master.json with no valid .bak to recover from.
    const badDir = await getSampleMainDir(root, adhocMonthFolderName("adh-3"), true);
    const handle = await badDir.getFileHandle("sample.master.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{not valid json");
    await writable.close();

    render(<XrayReferrals directoryHandle={root} />);

    // The real month's own assignment must still render...
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    // ...and the load must not have fallen into the hard error state.
    expect(screen.queryByText("تعذر تحميل البيانات.")).not.toBeInTheDocument();
    // The corrupt ad-hoc row itself is simply absent, not crashing the page.
    expect(screen.queryByText("ADHOC-adh-3-XR-1")).not.toBeInTheDocument();
  });
});

/**
 * DESIGN B, STEP 3 — the employee read path is inverted onto the per-employee
 * mirror.
 *
 * `2-samples/{month}/2-employees/{username}.samples.json` is a projection of
 * the distribution log stamped with the `sourceLogRevision` it was derived
 * from. When that stamp matches the log's own revision, the mirror IS the
 * derivation for this employee, and loading `sample.master.json` (every drawn
 * row for the whole month) plus the workspace-wide
 * `distribution.current.json` on top of it is pure waste.
 *
 * What is pinned here:
 *   1. the fast path really is the WHOLE read — neither of those two files is
 *      opened at all;
 *   2. a stale mirror still renders, then the real derivation lands on top;
 *   3. a missing mirror falls back to the old path unchanged;
 *   4. oversight (`canSeeAll`) is untouched — it never reads a mirror and
 *      always reads the derived file.
 */
describe("XrayReferrals employee read path (Design B step 3)", () => {
  /** Assign + persist the derived distribution, which is what writes the mirror. */
  async function seedWithMirror(
    root: DirectoryHandleLike,
    username: string,
    ids: string[]
  ): Promise<void> {
    await saveSampleMaster(root, MONTH, makeSample(ids.map(makeRow)));
    const appended = await appendDistributionEvents(
      root,
      MONTH,
      ids.map((id) => buildAssignEvent({ xrayImageId: id, assignedTo: username, eventBy: "admin" }))
    );
    if (!appended.ok) throw new Error(`seed failed: ${appended.error}`);
    const log = await loadDistributionLog(root, MONTH);
    await saveDistributionCurrent(root, MONTH, {
      ...deriveCurrentDistribution(log, ids.map(makeRow)),
      logRevision: log.revision,
    });
  }

  it("reads ONLY the mirror when its revision matches the log — no sample.master, no distribution.current", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root", { trackReads: true });
    await seedWithMirror(root, "emp-1", ["IMG-1", "IMG-2"]);

    clearReadLog(root);
    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("IMG-2").length).toBeGreaterThan(0);

    const reads = getReadLog(root);
    // The mirror was read...
    expect(reads.some((p) => p.endsWith("emp-1.samples.json"))).toBe(true);
    // ...and the two whole-month files were not. This is the entire point of
    // the change; if either of these ever flips back, the inversion is gone
    // even though every rendering assertion above would still pass.
    expect(reads.filter((p) => p.endsWith("sample.master.json"))).toEqual([]);
    expect(reads.filter((p) => p.endsWith("distribution.current.json"))).toEqual([]);
  });

  it("paints a STALE mirror immediately and then re-derives on top of it", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedWithMirror(root, "emp-1", ["IMG-1"]);
    // A second assignment lands WITHOUT refreshing the mirror (another machine
    // appended the event; this client has not synced yet). The mirror is now
    // one revision behind and knows nothing about IMG-2.
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1"), makeRow("IMG-2")]));
    const appended = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-1", eventBy: "admin" }),
    ]);
    expect(appended.ok).toBe(true);

    render(<XrayReferrals directoryHandle={root} />);

    // The stale mirror's row renders...
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    // ...and the background re-derivation brings in the row it did not know about.
    await waitFor(() => expect(screen.getAllByText("IMG-2").length).toBeGreaterThan(0));
    expect(screen.queryByText("تعذر تحميل البيانات.")).not.toBeInTheDocument();
  });

  it("falls back to the workspace-wide derivation when no mirror exists at all", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root", { trackReads: true });
    // seedAssignedSample appends events but never persists the derived state,
    // so no mirror is written — the pre-Design-B shape.
    await seedAssignedSample(root, "emp-1", "IMG-1");

    clearReadLog(root);
    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    expect(getReadLog(root).some((p) => p.endsWith("sample.master.json"))).toBe(true);
  });

  it("leaves oversight (canSeeAll) on the derived file — it never reads a mirror", async () => {
    // Default supervisor permissions include view-all-entries.
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root", { trackReads: true });
    // A mirror DOES exist for sup-1 here, and is perfectly current — an
    // oversight user must still ignore it, because N mirrors are N round trips
    // for what one derived file already holds.
    await seedWithMirror(root, "sup-1", ["IMG-1"]);

    clearReadLog(root);
    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const reads = getReadLog(root);
    expect(reads.filter((p) => p.endsWith("sup-1.samples.json"))).toEqual([]);
    expect(reads.some((p) => p.endsWith("sample.master.json"))).toBe(true);
  });
});

/**
 * The one thing the mirror genuinely cannot answer. The replacement dialog
 * filters candidates against the whole month's drawn rows AND against every
 * employee's current entries — an exclusion set built from this employee's own
 * mirror would happily offer a row somebody else already owns. So the fast
 * path clears `sampleMaster`, and the dialog pays for both on demand.
 */
describe("XrayReferrals replacement dialog after the mirror fast path", () => {
  it("resolves the sample master and EVERY employee's entries on demand, not from the mirror", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    // Two rows, two owners. emp-1's mirror knows only about IMG-1.
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
    // Fast path really was taken: emp-2's row is nowhere in this employee's view.
    expect(screen.queryByText("IMG-2")).not.toBeInTheDocument();

    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "استبدال العينة" })));

    await waitFor(() => expect(getReplacementCandidatesIndexedMock).toHaveBeenCalled());
    const [, , , sampleArg, entriesArg] = getReplacementCandidatesIndexedMock.mock.calls[0];
    // The full drawn-row set, not the mirror's single row...
    expect(sampleArg.rows.map((r) => r.xrayImageId).sort()).toEqual(["IMG-1", "IMG-2"]);
    // ...and the exclusion set covers the OTHER employee's assignment too.
    expect(entriesArg.map((e) => e.xrayImageId).sort()).toEqual(["IMG-1", "IMG-2"]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
