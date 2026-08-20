/* @vitest-environment jsdom */
// Design handoff §3 — previous/next sample navigation in the inspection panel.
//
// Three properties are load-bearing and none of them is visible from reading the
// panel alone:
//
//  1. The chevrons move within the CURRENTLY FILTERED rows, not the raw queue.
//     The filtered set is DataTable's own post-search set across every page, so
//     a search that hides a row must take it out of the navigation order too.
//  2. Switching samples returns the phase stepper to phase 1. That falls out of
//     SampleDetailPanel's `key={entry.xrayImageId}` remount rather than from
//     any reset state — which is exactly why it needs a test: it would break
//     silently the moment somebody "optimised" that key away.
//  3. A switch must NOT silently destroy typed-but-unsaved answers. The panel
//     seeds its answers once at mount, so the remount in (2) is the same
//     mechanism the background-refresh retention (XrayReferrals.draftRetention)
//     exists to defend against. A refresh is involuntary and is absorbed
//     silently; a chevron click is deliberate, so it is confirmed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the sibling XrayReferrals suites: the replacement-confirm path stands a
// query worker up, and Vitest cannot run a real DedicatedWorker.
vi.mock("../../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../../data/workspace/bootProgress";
import { saveTemplate } from "../../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../../data/templates/templateTypes";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import XrayReferrals from "../XrayReferrals";

const MONTH = "5-may-2026";

vi.mock("../../../../../../data/month/useGlobalMonth", () => ({
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

vi.mock("../../../../../../data/workspace/useWorkspace", () => ({
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

/**
 * Two explicit phases, each with one optional free-text field.
 *
 * Optional on purpose: phase 2 must be reachable without filling anything, so
 * "the stepper went back to phase 1" is provably a reset and not the
 * completion gate refusing to leave phase 1 in the first place.
 */
async function seedTwoPhaseTemplate(root: DirectoryHandleLike): Promise<void> {
  const template: TemplateSchema = {
    templateId: "tmpl-nav-test",
    templateName: "قالب مرحلتين",
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: "admin",
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
    phases: [
      { phaseId: "p1", title: "المرحلة الأولى", order: 1 },
      { phaseId: "p2", title: "المرحلة الثانية", order: 2 },
    ],
    fields: [
      { fieldId: "note", phaseId: "p1", label: "ملاحظة", type: "text", required: false, options: [] },
      { fieldId: "note2", phaseId: "p2", label: "ملاحظة ثانية", type: "text", required: false, options: [] },
    ],
  };
  const savedTpl = await saveTemplate(root, template);
  if (!savedTpl.ok) throw new Error(`seed template failed: ${savedTpl.error}`);
  const savedSelection = await saveInspectionTemplateSelection(root, {
    templateId: template.templateId,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  });
  if (!savedSelection.ok) throw new Error(`seed selection failed: ${savedSelection.error}`);
}

/** The inspection panel's own root — the id inside it, never the queue row. */
function panel(): HTMLElement {
  const el = document.querySelector(".ip-panel");
  if (!el) throw new Error("inspection panel is not rendered");
  return el as HTMLElement;
}

function openSampleId(): string {
  const el = panel().querySelector(".ip-xray-id");
  return el?.textContent ?? "";
}

/**
 * The ids of the rows currently IN THE TABLE, in order.
 *
 * Deliberately read off the queue rather than off `queryAllByText`: the open
 * sample's id also renders inside the panel, and gating a filter assertion on
 * that would pass before the (debounced) search had actually been applied —
 * which is exactly how a navigation test can silently assert nothing.
 */
function queueRowIds(): string[] {
  return [...document.querySelectorAll(".dt-table tbody tr")]
    .map((tr) => tr.querySelector(".ew-xray-id-cell")?.textContent ?? "")
    .filter((id) => id.length > 0);
}

function nextBtn(): HTMLButtonElement {
  return within(panel()).getByRole("button", { name: getLabels().ip_next_sample_title }) as HTMLButtonElement;
}

function prevBtn(): HTMLButtonElement {
  return within(panel()).getByRole("button", { name: getLabels().ip_prev_sample_title }) as HTMLButtonElement;
}

async function renderQueue(ids: string[]): Promise<DirectoryHandleLike> {
  writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await seedAssignedSamples(root, "emp-1", ids);
  await seedTwoPhaseTemplate(root);
  render(<XrayReferrals directoryHandle={root} />);
  await waitFor(() => expect(openSampleId()).toBe(ids[0]));
  return root;
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

describe("XrayReferrals — previous/next sample navigation", () => {
  it("walks forward and back through the queue and disables each end", async () => {
    await renderQueue(["IMG-1", "IMG-2", "IMG-3"]);

    // First row: there is nothing before it.
    expect(prevBtn()).toBeDisabled();
    expect(nextBtn()).not.toBeDisabled();

    fireEvent.click(nextBtn());
    await waitFor(() => expect(openSampleId()).toBe("IMG-2"));

    fireEvent.click(nextBtn());
    await waitFor(() => expect(openSampleId()).toBe("IMG-3"));
    // Last row: there is nothing after it.
    expect(nextBtn()).toBeDisabled();

    fireEvent.click(prevBtn());
    await waitFor(() => expect(openSampleId()).toBe("IMG-2"));
  });

  it("moves within the FILTERED rows, skipping anything the search has hidden", async () => {
    // ZZZ-2 sits BETWEEN the two IMG rows in the unfiltered queue, so "next"
    // landing on IMG-3 can only be the filtered order, never the raw one.
    await renderQueue(["IMG-1", "ZZZ-2", "IMG-3"]);

    const search = screen.getByRole("textbox", { name: getLabels().dt_search_placeholder });
    fireEvent.change(search, { target: { value: "IMG" } });
    await waitFor(() => expect(queueRowIds()).toEqual(["IMG-1", "IMG-3"]));

    fireEvent.click(nextBtn());
    await waitFor(() => expect(openSampleId()).toBe("IMG-3"));
    // IMG-3 is the last row of the FILTERED set even though the raw queue has
    // nothing after it either — and prev must go back to IMG-1, not ZZZ-2.
    expect(nextBtn()).toBeDisabled();
    fireEvent.click(prevBtn());
    await waitFor(() => expect(openSampleId()).toBe("IMG-1"));
  });

  it("lands inside the filtered set when the open sample has been filtered out", async () => {
    await renderQueue(["IMG-1", "ZZZ-2", "IMG-3"]);

    const search = screen.getByRole("textbox", { name: getLabels().dt_search_placeholder });
    fireEvent.change(search, { target: { value: "ZZZ" } });
    await waitFor(() => expect(queueRowIds()).toEqual(["ZZZ-2"]));

    // The panel still holds IMG-1 — a search narrows the TABLE, it does not
    // close the open sample. "Next" must therefore step into the filtered set
    // rather than doing nothing at all.
    expect(openSampleId()).toBe("IMG-1");
    fireEvent.click(nextBtn());
    await waitFor(() => expect(openSampleId()).toBe("ZZZ-2"));
  });

  it("returns the phase stepper to phase 1 when the sample changes", async () => {
    await renderQueue(["IMG-1", "IMG-2"]);

    const phaseTwoTab = () => within(panel()).getByRole("tab", { name: /المرحلة الثانية/ });
    const phaseOneTab = () => within(panel()).getByRole("tab", { name: /المرحلة الأولى/ });

    fireEvent.click(phaseTwoTab());
    await waitFor(() => expect(phaseTwoTab()).toHaveAttribute("aria-selected", "true"));

    fireEvent.click(nextBtn());
    await waitFor(() => expect(openSampleId()).toBe("IMG-2"));
    expect(phaseOneTab()).toHaveAttribute("aria-selected", "true");
    expect(phaseTwoTab()).toHaveAttribute("aria-selected", "false");
  });
});

describe("XrayReferrals — unsaved-draft guard on sample switch", () => {
  it("asks before discarding typed answers, and keeps them when the switch is cancelled", async () => {
    await renderQueue(["IMG-1", "IMG-2"]);

    const noteInput = within(panel()).getByLabelText("ملاحظة") as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });

    fireEvent.click(nextBtn());

    // The switch has NOT happened yet — the panel is still on IMG-1 with its
    // text intact, and the user is asked first.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(getLabels().ew_sample_nav_draft_confirm)).toBeInTheDocument();
    expect(openSampleId()).toBe("IMG-1");

    fireEvent.click(within(dialog).getByRole("button", { name: getLabels().ew_sample_nav_draft_cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(openSampleId()).toBe("IMG-1");
    expect((within(panel()).getByLabelText("ملاحظة") as HTMLInputElement).value).toBe("مسودة غير محفوظة");
  });

  it("switches once the discard is confirmed, seeding the next sample empty", async () => {
    await renderQueue(["IMG-1", "IMG-2"]);

    fireEvent.change(within(panel()).getByLabelText("ملاحظة"), { target: { value: "مسودة" } });
    fireEvent.click(nextBtn());

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: getLabels().ew_sample_nav_draft_ok }));

    await waitFor(() => expect(openSampleId()).toBe("IMG-2"));
    expect((within(panel()).getByLabelText("ملاحظة") as HTMLInputElement).value).toBe("");
  });

  it("does not prompt when nothing has been typed", async () => {
    await renderQueue(["IMG-1", "IMG-2"]);
    // Gate on the form actually being mounted, so "no dialog" cannot be a
    // false pass from navigating before the template loaded.
    await waitFor(() => within(panel()).getByLabelText("ملاحظة"));

    fireEvent.click(nextBtn());

    await waitFor(() => expect(openSampleId()).toBe("IMG-2"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
