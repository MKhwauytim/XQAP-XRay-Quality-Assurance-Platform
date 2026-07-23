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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { upsertItemAnswer } from "../../../../../data/answers/answerStorage";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { clearErrors, getRecentErrors } from "../../../../../data/storage/errorLogger";
import { getReplacementCandidatesIndexed } from "../../../../../data/distribution/replacementCandidateLookup";
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
