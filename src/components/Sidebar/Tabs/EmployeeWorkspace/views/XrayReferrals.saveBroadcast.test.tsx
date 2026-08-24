/* @vitest-environment jsdom */
// Submitting an answer is a write like any other on this screen, and every
// other write here announces itself. This one did not, so the approval desk,
// «نتائج فحص الأشعة» and Reports — all of them mounted behind this sub-tab by
// the tab-mount LRU — kept showing the row as unanswered until the 45 s sync
// tick or the manual refresh button came round.
//
// The two halves are equally load-bearing:
//   • the broadcast happens, once, naming "answers" and nothing else;
//   • this page skips its OWN broadcast (setAnswers already reconciled it),
//     without the guard getting stuck and swallowing later ones.
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
import { createMemoryDirectory, clearReadLog, getReadLog } from "../../../../../data/storage/memoryDirectory";
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
import {
  broadcastDataRefresh,
  subscribeToDataChange,
  type DataRefreshDetail,
} from "../../../../../data/workspace/dataRefreshSignal";
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

const TEMPLATE_ID = "tmpl-save-broadcast";

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

describe("XrayReferrals — submit broadcasts a data refresh", () => {
  it("broadcasts an answers-only refresh exactly once when an answer is submitted", async () => {
    writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-001", "emp-a"]]);

    const seen: DataRefreshDetail[] = [];
    const stop = subscribeToDataChange(["answers"], (detail) => { seen.push(detail); });

    try {
      render(<XrayReferrals directoryHandle={root} />);
      await waitFor(() => expect(screen.getAllByText("IMG-001").length).toBeGreaterThan(0));

      const note = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
      fireEvent.change(note, { target: { value: "تمت المراجعة" } });
      fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "تقديم الفحص" })));
      await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

      // Once per completed user action, never per field or per render.
      expect(seen).toHaveLength(1);
      // "periodic" + a change set, NOT "manual": "manual" additionally means
      // "discard every cache", which directoryScan.ts and workspacePaths.ts
      // honour by dropping theirs wholesale. One answer file does not justify
      // that (see dataRefreshSignal.ts:110-117).
      const detail = seen[0]!;
      expect(detail.source).toBe("periodic");
      if (detail.source !== "periodic") throw new Error("unreachable — asserted above");
      expect([...detail.changed]).toEqual(["answers"]);
    } finally {
      stop();
    }
  });

  it("does not make this page re-read its own write, and does not swallow the next external refresh", async () => {
    writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root", { trackReads: true });
    await seedMonth(root, [["IMG-001", "emp-a"]]);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-001").length).toBeGreaterThan(0));

    const note = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(note, { target: { value: "تمت المراجعة" } });
    clearReadLog(root);
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "تقديم الفحص" })));
    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

    // The write itself reads (upsert reads-then-writes the answer file). What
    // must NOT appear is a whole second load pass: the derived distribution /
    // sample master / mirror reads loadData performs.
    const afterSave = getReadLog(root);
    expect(afterSave.some((path) => path.includes("sample.master.json"))).toBe(false);

    // …and the guard is not sticky. An EXTERNAL refresh landing afterwards must
    // still reload this view, or one submit would deafen the page for good.
    clearReadLog(root);
    broadcastDataRefresh("manual");
    await waitFor(() => {
      expect(getReadLog(root).some((path) => path.includes("sample.master.json"))).toBe(true);
    });
  });
});

describe("XrayReferrals — status banner dismiss button", () => {
  // Regression guard: the dismiss "×" used to be pinned with an inline
  // `style={{ float: "left" }}`, which is wrong in this RTL app — it sticks
  // the button to the physical-left edge regardless of Arabic reading
  // direction. The fix replicates ReferralApproval/index.tsx's
  // `.ew-msg-dismissible` / `.ew-msg-dismiss-btn` flex pattern instead
  // (EmployeeWorkspace.css), so this both bans the float style AND pins the
  // class names that carry the correct layout.
  it("dismisses via a flex-positioned button, not an inline float:left", async () => {
    writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-001", "emp-a"]]);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-001").length).toBeGreaterThan(0));

    const note = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(note, { target: { value: "تمت المراجعة" } });
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "تقديم الفحص" })));
    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

    const banner = screen.getByRole("status");
    expect(banner.className).toContain("ew-msg-dismissible");

    const dismissBtn = within(banner).getByRole("button", { name: "إغلاق" });
    expect(dismissBtn.className).toContain("ew-msg-dismiss-btn");
    // No inline positioning left on the element at all — the RTL-correct
    // placement now comes entirely from the stylesheet classes above.
    expect(dismissBtn.getAttribute("style")).toBeNull();

    fireEvent.click(dismissBtn);
    await waitFor(() => expect(screen.queryByText("تم التقديم.")).not.toBeInTheDocument());
  });
});
