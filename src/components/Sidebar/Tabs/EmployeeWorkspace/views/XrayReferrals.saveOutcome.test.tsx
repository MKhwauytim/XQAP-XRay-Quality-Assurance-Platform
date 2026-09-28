/* @vitest-environment jsdom */
// The inspection panel shows the answer-save outcome inline (A1): saved, not
// saved yet and queued for background retry, or failed with its XQ code. Each
// must appear INSIDE the panel next to the submit button, not only in the
// page-top banner, and a save that is not verified must never clear the draft.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the sibling XrayReferrals suites: Vitest cannot run a real
// DedicatedWorker, and mounting this view stands the population query worker up.
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
import { createEmptyUserManagementState, writeUserManagementState } from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import * as answerStorage from "../../../../../data/answers/answerStorage";
import * as answerDraftStore from "../../../../../data/answers/answerDraftStore";
import * as answerLocalMirror from "../../../../../data/answers/answerLocalMirror";
import { DEFAULT_LABELS } from "../../../../../data/labels/labelsStore";
import XrayReferrals from "./XrayReferrals";

const MONTH = "5-may-2026";

vi.mock("../../../../../data/answers/answerStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../data/answers/answerStorage")>()),
  upsertItemAnswer: vi.fn(),
}));
vi.mock("../../../../../data/answers/answerDraftStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../data/answers/answerDraftStore")>();
  return { ...actual, clearAnswerDraftAndLegacy: vi.fn(actual.clearAnswerDraftAndLegacy) };
});
vi.mock("../../../../../data/answers/answerLocalMirror", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../data/answers/answerLocalMirror")>()),
  isAnswerQueuedPending: vi.fn(),
}));

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

function makeRow(xrayImageId: string): PreparedPopulationRow {
  return {
    xrayImageId,
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

const TEMPLATE_ID = "tmpl-save-outcome";

async function seedTemplate(root: DirectoryHandleLike): Promise<void> {
  const template: TemplateSchema = {
    templateId: TEMPLATE_ID,
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
    templateId: TEMPLATE_ID,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  });
  if (!savedSelection.ok) throw new Error(`seed selection failed: ${savedSelection.error}`);
}

/** `[xrayImageId, assignedTo]`. */
type Seed = [string, string];

async function seedMonth(root: DirectoryHandleLike, seeds: Seed[]): Promise<void> {
  await saveSampleMaster(root, MONTH, makeSample(seeds.map(([id]) => makeRow(id))));
  const result = await appendDistributionEvents(
    root,
    MONTH,
    seeds.map(([id, assignedTo]) => buildAssignEvent({ xrayImageId: id, assignedTo, eventBy: "admin" }))
  );
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
  await seedTemplate(root);
}

beforeEach(() => {
  vi.mocked(answerDraftStore.clearAnswerDraftAndLegacy).mockClear();
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


const CODED_ERROR = "تعذّر العثور على ملف بديل يمكن الوثوق به (XQ-IO-038).";

async function mountAndSubmit(): Promise<HTMLElement> {
  writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await seedMonth(root, [["IMG-001", "emp-a"]]);
  render(<XrayReferrals directoryHandle={root} />);
  await waitFor(() => expect(screen.getAllByText("IMG-001").length).toBeGreaterThan(0));
  const note = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
  fireEvent.change(note, { target: { value: "تمت المراجعة" } });
  const button = await waitFor(() => screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn }));
  fireEvent.click(button);
  return button;
}

/** The inline status line, found as a sibling-of-the-form element, never inside the banner. */
function inlineStatus(text: string): HTMLElement {
  const el = screen.getAllByText(text).find((node) => node.classList.contains("ip-save-status"));
  if (!el) throw new Error(`no inline status with text: ${text}`);
  return el;
}

describe("XrayReferrals — inline save outcome next to the panel (A1)", () => {
  it("shows saved inline on a verified save", async () => {
    vi.mocked(answerStorage.upsertItemAnswer).mockResolvedValue({ ok: true });
    await mountAndSubmit();
    await waitFor(() => expect(inlineStatus(DEFAULT_LABELS.ip_save_status_saved).closest(".ip-panel")).not.toBeNull());
    // Only a verified save clears the draft.
    expect(answerDraftStore.clearAnswerDraftAndLegacy).toHaveBeenCalled();
    // The panel's own status is not the page banner.
    expect(within(screen.getByRole("status")).queryByText(DEFAULT_LABELS.ip_save_status_saved)).toBeNull();
  });

  it("shows not-saved-will-retry inline when the failed answer is queued pending", async () => {
    vi.mocked(answerStorage.upsertItemAnswer).mockResolvedValue({ ok: false, error: CODED_ERROR });
    vi.mocked(answerLocalMirror.isAnswerQueuedPending).mockResolvedValue(true);
    await mountAndSubmit();
    await waitFor(() => expect(inlineStatus(DEFAULT_LABELS.ip_save_status_queued_coded.replace("{code}", "XQ-IO-038")).closest(".ip-panel")).not.toBeNull());
    expect(within(screen.getByRole("status")).queryByText(DEFAULT_LABELS.ip_save_status_queued_coded.replace("{code}", "XQ-IO-038"))).toBeNull();
    // Not a verified save: no draft is cleared, no success text.
    expect(screen.queryByText("تم التقديم.")).toBeNull();
    expect(answerDraftStore.clearAnswerDraftAndLegacy).not.toHaveBeenCalled();
  });

  it("shows the failure with its XQ code inline, next to the submit button, and keeps the answer", async () => {
    vi.mocked(answerStorage.upsertItemAnswer).mockResolvedValue({ ok: false, error: CODED_ERROR });
    vi.mocked(answerLocalMirror.isAnswerQueuedPending).mockResolvedValue(false);
    const button = await mountAndSubmit();
    const line = await waitFor(() =>
      inlineStatus(DEFAULT_LABELS.ip_save_status_failed.replace("{message}", CODED_ERROR))
    );
    expect(line.textContent).toContain("XQ-IO-038");
    // Inside the inspection panel (with the submit button), not only the page banner.
    const panel = button.closest(".ip-panel");
    expect(panel).not.toBeNull();
    expect(panel).toContainElement(line);
    expect(screen.getByRole("status")).not.toContainElement(line);
    expect((screen.getByLabelText("ملاحظة") as HTMLInputElement).value).toBe("تمت المراجعة");
    expect(answerDraftStore.clearAnswerDraftAndLegacy).not.toHaveBeenCalled();
  });
});
