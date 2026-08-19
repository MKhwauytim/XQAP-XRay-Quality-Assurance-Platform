/* @vitest-environment jsdom */
// T-16 regression: switching the global month used to discard a typed-but-unsaved
// inspection draft in complete silence.
//
// The background-refresh half of this hazard is already covered by
// XrayReferrals.draftRetention.test.tsx. This is the OTHER half: a deliberate
// month switch takes loadData's non-silent path, which clears selEntryId and
// dirtyEntryId outright, so the panel is re-pointed and the draft is gone. The
// fix registers a GlobalMonthProvider month-change guard (the same mechanism the
// Population wizard uses for its unsaved uploads) that returns a confirm message
// while the panel holds unsaved input.
//
// The load-bearing correction: the guard must fire ONLY while this view is
// actually on screen. App.tsx keeps up to three tabs mounted and
// EmployeeWorkspaceTab keeps visited sub-tabs mounted-but-`hidden`, so a
// background-mounted dirty view interrupting a month switch made from a
// different screen would put up a dialog whose context the user cannot see.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the sibling XrayReferrals suites: the replacement-confirm path stands a
// query worker up, and Vitest cannot run a real DedicatedWorker.
vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import { getLabels } from "../../../../../data/labels/labelsStore";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import XrayReferrals from "./XrayReferrals";

const MONTH = "5-may-2026";

type Guard = () => string | null;

// The real registry lives in GlobalMonthProvider; this mock is that registry, so
// the test can run the guards exactly the way confirmGuardedChange does.
const monthGuards = vi.hoisted(() => ({ registered: new Set<Guard>() }));

vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: MONTH }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: MONTH },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: (guard: Guard) => {
      monthGuards.registered.add(guard);
      return () => { monthGuards.registered.delete(guard); };
    },
  }),
}));

vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

/** Exactly GlobalMonthProvider.confirmGuardedChange's own loop: first non-null wins. */
function firstGuardMessage(): string | null {
  for (const guard of monthGuards.registered) {
    const message = guard();
    if (message) return message;
  }
  return null;
}

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

/** One free-text field, so the detail panel renders an input to type a draft into. */
async function seedDraftableTemplate(root: DirectoryHandleLike): Promise<void> {
  const template: TemplateSchema = {
    templateId: "tmpl-guard-test",
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

async function seedWorkspace(): Promise<DirectoryHandleLike> {
  writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await seedAssignedSamples(root, "emp-1", ["IMG-1", "IMG-2"]);
  await seedDraftableTemplate(root);
  return root;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  monthGuards.registered.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
  monthGuards.registered.clear();
});

describe("XrayReferrals — month switch vs. an unsaved inspection draft", () => {
  it("asks for confirmation when the visible panel holds unsaved answers", async () => {
    const root = await seedWorkspace();

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });

    // Before the fix this was null: no guard existed, so GlobalMonthProvider
    // switched the month without a word and loadData dropped the draft.
    expect(firstGuardMessage()).toBe(getLabels().gm_month_switch_draft_confirm);
  });

  it("does not interrupt the switch when nothing has been typed", async () => {
    const root = await seedWorkspace();

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));
    await waitFor(() => screen.getByLabelText("ملاحظة"));

    expect(firstGuardMessage()).toBeNull();
  });

  it("does not interrupt the switch when the dirty view is mounted but hidden", async () => {
    const root = await seedWorkspace();

    // Exactly how App.tsx / EmployeeWorkspaceTab park a background view: still
    // mounted, still holding its state, hidden behind a `hidden` ancestor.
    const { container } = render(
      <div hidden>
        <XrayReferrals directoryHandle={root} />
      </div>
    );
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });

    // The draft is real (same state the first case asserts on) — it just must
    // not put a dialog in front of a user looking at another screen.
    expect(container.querySelector("[hidden]")).not.toBeNull();
    expect(firstGuardMessage()).toBeNull();
  });
});
