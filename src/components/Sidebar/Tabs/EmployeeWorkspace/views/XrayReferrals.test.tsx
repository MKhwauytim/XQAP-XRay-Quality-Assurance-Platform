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
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
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
import { buildAssignEvent, buildReplacedEvent } from "../../../../../data/distribution/distributionLog";
import { upsertItemAnswer } from "../../../../../data/answers/answerStorage";
import {
  appendReferralRequest,
  appendReplacementRequest,
} from "../../../../../data/referral/referralStorage";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { clearErrors, getRecentErrors } from "../../../../../data/storage/errorLogger";
import { getReplacementCandidatesIndexed } from "../../../../../data/distribution/replacementCandidateLookup";
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

const MONTH = "5-may-2026";

vi.mock("../../../../../data/distribution/replacementCandidateLookup", () => ({
  getReplacementCandidatesIndexed: vi.fn(),
}));

const getReplacementCandidatesIndexedMock = vi.mocked(getReplacementCandidatesIndexed);

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
  it("keeps the inspection form read-only when the role cannot submit answers, even for the user's own sample (bulk-assigned supervisor)", async () => {
    // Default supervisor permissions: submit-answers is disabled while
    // view-all-entries/request-replacement/ew.reopenAnswer remain enabled — the
    // exact "bulk-assigned supervisor" shape from the synthesis finding.
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

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
    writeUserManagementState(createEmptyUserManagementState(), false);

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
    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الإحالة" }));

    // Before the fix: handleReferralRequest's post-success `await loadData()` (no
    // `{ silent: true }`) flipped loadState to "loading", unmounting the whole
    // detail-panel block and force-closing the just-typed draft above — the exact
    // "refresh that's supposed to be silent" the user reported.
    expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText(/تم إرسال طلب الإحالة لـ jalgahamdi/)).toBeInTheDocument()
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

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });

    const replaceButton = await waitFor(() => screen.getByRole("button", { name: "استبدال العينة" }));
    fireEvent.click(replaceButton);

    const dialog = await waitFor(() => screen.getByRole("dialog"));
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
