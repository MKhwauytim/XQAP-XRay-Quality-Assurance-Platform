/* @vitest-environment jsdom */
// Design handoff §3 — the fluid two-column grid, and the select column's
// eligibility gating.
//
// The grid's whole point is expressed in CSS, which jsdom does not compute — so
// what is testable, and what actually breaks it, is the DOM SHAPE the CSS
// depends on. `XrayReferrals.css` places the toolbar at `grid-column: 1 / -1`
// and the queue/panel in tracks 1 and 2 by explicit line number, which only
// works while all of them are SIBLINGS under the grid container: DataTable
// renders a Fragment, so wrapping its output in a div (the obvious "tidy-up")
// would silently drop the search bar back inside one column and undo the
// redesign with every test still green. Likewise the `--with-bar` modifier is
// passed from React precisely because the selection bar is conditional and
// auto-placement would re-flow the panel underneath the pagination without it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
import {
  buildAssignEvent,
  buildCompletedEvent,
} from "../../../../../../data/distribution/distributionLog";
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

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: "1",
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

function grid(): HTMLElement {
  const el = document.querySelector(".ew-xr-grid");
  if (!el) throw new Error("the queue grid is not rendered");
  return el as HTMLElement;
}

/** True when `selector` matches a DIRECT child of the grid container. */
function isDirectGridChild(selector: string): boolean {
  return [...grid().children].some((child) => child.matches(selector));
}

async function renderQueue(ids: string[], completedIds: string[] = []): Promise<void> {
  writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await saveSampleMaster(root, MONTH, makeSample(ids.map(makeRow)));
  const assigned = await appendDistributionEvents(
    root,
    MONTH,
    ids.map((id) => buildAssignEvent({ xrayImageId: id, assignedTo: "emp-1", eventBy: "admin" }))
  );
  if (!assigned.ok) throw new Error(`seed failed: ${assigned.error}`);
  if (completedIds.length > 0) {
    const done = await appendDistributionEvents(
      root,
      MONTH,
      completedIds.map((id) =>
        buildCompletedEvent({ xrayImageId: id, assignedTo: "emp-1", eventBy: "emp-1" })
      )
    );
    if (!done.ok) throw new Error(`seed completed failed: ${done.error}`);
  }
  render(<XrayReferrals directoryHandle={root} />);
  await waitFor(() => expect(document.querySelector(".ew-xr-grid")).not.toBeNull());
  await waitFor(() => expect(screen.getAllByText(ids[0]!).length).toBeGreaterThan(0));
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

describe("XrayReferrals — two-column queue grid", () => {
  it("keeps the search toolbar, the table and the panel as siblings of the grid", async () => {
    await renderQueue(["IMG-1", "IMG-2"]);

    // The search bar spans both columns, so it must not be nested inside the
    // queue column.
    expect(isDirectGridChild(".dt-toolbar")).toBe(true);
    expect(isDirectGridChild(".dt-table-wrap")).toBe(true);
    expect(isDirectGridChild(".ew-xr-panel-col")).toBe(true);
    // The panel lives in the second column, inside that wrapper.
    expect(grid().querySelector(".ew-xr-panel-col .ip-panel")).not.toBeNull();
    // And the old fixed-width split wrapper is gone for good.
    expect(document.querySelector(".ew-split")).toBeNull();
  });

  it("marks the grid as carrying a selection bar exactly when one is rendered", async () => {
    await renderQueue(["IMG-1"]);

    // An employee holds `submit-referrals` by default, so the bar renders and
    // every row below it shifts down one track.
    expect(isDirectGridChild(".ew-selection-bar")).toBe(true);
    expect(grid().className).toContain("ew-xr-grid--with-bar");
  });
});

describe("XrayReferrals — select column eligibility", () => {
  it("disables the checkbox of a completed row and leaves a pending one usable", async () => {
    await renderQueue(["IMG-1", "IMG-2"], ["IMG-2"]);

    const pending = await screen.findByRole("checkbox", { name: "تحديد IMG-1" });
    expect(pending).not.toBeDisabled();

    // A completed row can never be reassigned (planReassignment's
    // "terminal-completed"), so its checkbox is present but inert — and says
    // why, rather than just refusing to tick.
    const completed = screen.getByRole("checkbox", {
      name: getLabels().ew_row_select_blocked_aria.replace("{id}", "IMG-2"),
    });
    expect(completed).toBeDisabled();
  });
});
