/* @vitest-environment jsdom */
// P0 regression: a background refresh must never destroy an employee's typed,
// unsaved inspection answers.
//
// The trigger is ordinary. A supervisor reassigns the row the employee currently
// has open; 45 seconds later SyncTick's automatic sync broadcasts a data-refresh,
// XrayReferrals silently re-reads the queue, and the reassigned row is no longer
// in it. The auto-select effect then saw an invalid `selEntryId` and moved the
// selection to `displayEntries[0]` — a DIFFERENT x-ray. InspectionPanel is keyed
// on `xrayImageId` and seeds its answer state only at mount, so it remounted
// empty: the typed answers were gone, with no warning and no message.
//
// The fix keeps the panel (and the draft) on screen and explains why, instead of
// swapping it. These tests simulate the real trigger — the entry disappearing
// from the refreshed set while the panel holds unsaved input.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the sibling XrayReferrals suites: the replacement-confirm path stands a
// query worker up, and Vitest cannot run a real DedicatedWorker.
vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

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
import {
  appendDistributionEvents,
} from "../../../../../data/distribution/distributionStorage";
import {
  buildAssignEvent,
  buildReassignEvent,
} from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { broadcastDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import { getLabels } from "../../../../../data/labels/labelsStore";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
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

/** Seeds `ids` as pending assignments for `username` (no answers yet). */
async function seedAssignedSamples(
  root: DirectoryHandleLike,
  username: string,
  ids: string[]
): Promise<void> {
  await saveSampleMaster(root, MONTH, makeSample(ids.map(makeRow)));
  const result = await appendDistributionEvents(
    root,
    MONTH,
    ids.map((id) => buildAssignEvent({ xrayImageId: id, assignedTo: username, eventBy: "admin" }))
  );
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
}

/** One free-text field, so the detail panel renders an input to type a draft into. */
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

/** The QUEUE ROW for an id, or null. Deliberately not `queryByText`: the same id
 *  also renders inside the detail panel, which is exactly what must survive. */
function rowFor(id: string): HTMLElement | null {
  return (
    screen
      .queryAllByText(id)
      .map((el) => el.closest("tr"))
      .find((tr): tr is HTMLTableRowElement => tr !== null) ?? null
  );
}

/** The supervisor's action: IMG-1 leaves this employee's queue mid-edit. */
async function reassignAway(root: DirectoryHandleLike, id: string, from: string): Promise<void> {
  const result = await appendDistributionEvents(root, MONTH, [
    buildReassignEvent({
      xrayImageId: id,
      assignedTo: from,
      reassignedTo: "emp-2",
      eventBy: "sup-1",
    }),
  ]);
  if (!result.ok) throw new Error(`reassign failed: ${result.error}`);
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

describe("XrayReferrals — unsaved draft vs. a row reassigned out from under it", () => {
  it("keeps the open panel and its unsaved answers when the selected row disappears from the refreshed queue, instead of silently swapping to another x-ray", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    // Two rows: the panel opens on IMG-1 (auto-selected first) and IMG-2 is the
    // row the old code silently swapped to.
    await seedAssignedSamples(root, "emp-1", ["IMG-1", "IMG-2"]);
    await seedDraftableTemplate(root);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });
    expect(noteInput.value).toBe("مسودة غير محفوظة");

    // A supervisor reassigns IMG-1 elsewhere, then the 45s sync tick fires.
    await reassignAway(root, "IMG-1", "emp-1");
    act(() => {
      broadcastDataRefresh();
    });

    // Gate on the refresh having actually landed: IMG-1 has left the QUEUE.
    await waitFor(() => expect(rowFor("IMG-1")).toBeNull());

    // Before the fix: the auto-select effect moved the selection to IMG-2, the
    // xrayImageId-keyed InspectionPanel remounted, and the typed text was gone.
    const noteInputAfter = screen.getByLabelText("ملاحظة") as HTMLInputElement;
    expect(noteInputAfter.value).toBe("مسودة غير محفوظة");
    // And the employee is told why, instead of being left to notice it.
    expect(screen.getByText(getLabels().ew_draft_retained_notice)).toBeInTheDocument();
  });

  it("keeps the panel and its unsaved answers when the reassigned row was the employee's only one", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSamples(root, "emp-1", ["IMG-1"]);
    await seedDraftableTemplate(root);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });

    await reassignAway(root, "IMG-1", "emp-1");
    act(() => {
      broadcastDataRefresh();
    });

    await waitFor(() => expect(rowFor("IMG-1")).toBeNull());

    // The empty-queue state must not take over the panel while a draft is held.
    const noteInputAfter = screen.getByLabelText("ملاحظة") as HTMLInputElement;
    expect(noteInputAfter.value).toBe("مسودة غير محفوظة");
    expect(screen.getByText(getLabels().ew_draft_retained_notice)).toBeInTheDocument();
  });

  it("still auto-selects the next row when the vanished selection had NO unsaved input (unchanged behaviour)", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSamples(root, "emp-1", ["IMG-1", "IMG-2"]);
    await seedDraftableTemplate(root);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    await waitFor(() => screen.getByLabelText("ملاحظة"));

    await reassignAway(root, "IMG-1", "emp-1");
    act(() => {
      broadcastDataRefresh();
    });

    // Nothing was typed, so there is nothing to protect: the queue re-selects.
    await waitFor(() => expect(screen.queryAllByText("IMG-1")).toHaveLength(0));
    expect(screen.queryByText(getLabels().ew_draft_retained_notice)).not.toBeInTheDocument();
    expect(screen.getAllByText("IMG-2").length).toBeGreaterThan(0);
  });
});
