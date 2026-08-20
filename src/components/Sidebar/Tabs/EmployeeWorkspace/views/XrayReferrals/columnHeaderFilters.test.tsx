/* @vitest-environment jsdom */
// Design handoff §3 — "التصفية داخل رؤوس الأعمدة": a filter control in every
// column header, free text for the x-ray id and a value list for the
// categorical columns, each with its own «مسح» clear action, and an active
// treatment on the button while a filter is set.
//
// The mechanism itself lives in the shared DataTable, which this screen may not
// edit — so these are the tests that pin the behaviour AS THIS SCREEN USES IT.
// That is not redundant with DataTable's own suite: what reaches the header
// here depends on this screen's column set, its `DEFAULT_VISIBLE` list, and its
// `stage` accessor override (which filters on the FORMATTED «المستوى» label,
// not on the raw "1"/"2" token stored on the row). All three are XrayReferrals'
// own, and all three can break the handoff's requirement without DataTable
// changing at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function makeRow(id: string, stage: string, portName: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName,
    certScanStatus: "NonCertscan",
    stage,
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
    sourceSheetName: portName,
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

/** Row ids currently rendered in the QUEUE (never the panel), in order. */
function queueRowIds(): string[] {
  return [...document.querySelectorAll(".dt-table tbody tr")]
    .map((tr) => tr.querySelector(".ew-xray-id-cell")?.textContent ?? "")
    .filter((id) => id.length > 0);
}

function filterBtn(columnLabel: string): HTMLButtonElement {
  return screen.getByRole("button", {
    name: `${getLabels().dt_filter_button_prefix}: ${columnLabel}`,
  }) as HTMLButtonElement;
}

/** The open header dropdown. */
function filterMenu(): HTMLElement {
  const el = document.querySelector(".dt-filter-menu");
  if (!el) throw new Error("no column filter menu is open");
  return el as HTMLElement;
}

async function renderQueue(rows: PreparedPopulationRow[]): Promise<void> {
  writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await saveSampleMaster(root, MONTH, makeSample(rows));
  const appended = await appendDistributionEvents(
    root,
    MONTH,
    rows.map((row) =>
      buildAssignEvent({ xrayImageId: row.xrayImageId, assignedTo: "emp-1", eventBy: "admin" })
    )
  );
  if (!appended.ok) throw new Error(`seed failed: ${appended.error}`);
  render(<XrayReferrals directoryHandle={root} />);
  await waitFor(() => expect(queueRowIds()).toEqual(rows.map((r) => r.xrayImageId)));
}

const SAMPLE_ROWS = [
  makeRow("IMG-1", "1", "ميناء جدة"),
  makeRow("IMG-2", "2", "مطار الرياض"),
  makeRow("IMG-3", "1", "ميناء جدة"),
];

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

describe("XrayReferrals — per-column header filtering", () => {
  it("filters the x-ray id column by free text and clears it again", async () => {
    await renderQueue(SAMPLE_ROWS);

    const button = filterBtn(getLabels().col_xray_image_id);
    expect(button.className).not.toContain("active");

    fireEvent.click(button);
    fireEvent.change(within(filterMenu()).getByPlaceholderText(getLabels().dt_filter_search), {
      target: { value: "IMG-2" },
    });
    fireEvent.click(within(filterMenu()).getByRole("button", { name: getLabels().dt_filter_apply }));

    await waitFor(() => expect(queueRowIds()).toEqual(["IMG-2"]));
    // Handoff §3: the header button carries an active treatment while a filter
    // is set, so an unexpectedly short queue is never unexplained.
    expect(filterBtn(getLabels().col_xray_image_id).className).toContain("active");

    fireEvent.click(filterBtn(getLabels().col_xray_image_id));
    fireEvent.click(within(filterMenu()).getByRole("button", { name: getLabels().dt_filter_clear }));

    await waitFor(() => expect(queueRowIds()).toEqual(["IMG-1", "IMG-2", "IMG-3"]));
    expect(filterBtn(getLabels().col_xray_image_id).className).not.toContain("active");
  });

  it("filters المستوى by its FORMATTED label, not the raw stage token", async () => {
    await renderQueue(SAMPLE_ROWS);

    fireEvent.click(filterBtn(getLabels().col_stage));
    // The options are the labels a reader actually sees in the column — proof
    // that this screen's `stage` accessor override reaches the filter menu. A
    // regression to the raw accessor would offer "1"/"2" here instead.
    const menu = filterMenu();
    expect(within(menu).getByText("المستوى الأول")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("checkbox", { name: "المستوى الثاني" }));

    await waitFor(() => expect(queueRowIds()).toEqual(["IMG-2"]));

    fireEvent.click(within(filterMenu()).getByRole("button", { name: getLabels().dt_filter_clear }));
    await waitFor(() => expect(queueRowIds()).toEqual(["IMG-1", "IMG-2", "IMG-3"]));
  });

  it("filters المنفذ and combines with another column's filter", async () => {
    await renderQueue(SAMPLE_ROWS);

    fireEvent.click(filterBtn(getLabels().col_port_name));
    fireEvent.click(within(filterMenu()).getByRole("checkbox", { name: "ميناء جدة" }));
    await waitFor(() => expect(queueRowIds()).toEqual(["IMG-1", "IMG-3"]));
    // The value list stays open so several values can be ticked; its own
    // "done" button carries a live count, hence the prefix match.
    fireEvent.click(
      within(filterMenu()).getByRole("button", {
        name: (name: string) => name.trim().startsWith(getLabels().dt_done),
      })
    );

    // A second column narrows further rather than replacing the first.
    fireEvent.click(filterBtn(getLabels().col_xray_image_id));
    fireEvent.change(within(filterMenu()).getByPlaceholderText(getLabels().dt_filter_search), {
      target: { value: "IMG-3" },
    });
    fireEvent.click(within(filterMenu()).getByRole("button", { name: getLabels().dt_filter_apply }));

    await waitFor(() => expect(queueRowIds()).toEqual(["IMG-3"]));
  });
});
