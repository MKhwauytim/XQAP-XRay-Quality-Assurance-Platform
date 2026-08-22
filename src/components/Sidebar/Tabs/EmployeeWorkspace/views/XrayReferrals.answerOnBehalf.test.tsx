/* @vitest-environment jsdom */
// Acting on the rows the oversight scope picker surfaces.
//
// The picker lets a supervisor open ONE employee's queue (someone on leave with
// hundreds of unfinished samples). Looking at it is useless without being able
// to act on it, so two capabilities meet here:
//
//  A. `answer-on-behalf` — author an answer for a sample assigned to someone
//     else. Deliberately narrow: it opens ONLY still-unanswered rows. An answer
//     the assignee already submitted must never be overwritable from this path
//     («إعادة فتح الإجابة» exists for that, and leaves a trail), and every
//     blocked case has to SAY why rather than render a dead read-only form.
//     The reader's own rows are untouched by all of it.
//
//  B. `bulk-reassign-referrals` — reassign ONE row straight from the panel, not
//     only in bulk. Reviewing one person's queue and moving a single sample out
//     of it is the natural gesture; allowing it in bulk while refusing it
//     singly was arbitrary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the sibling XrayReferrals suites: Vitest cannot run a real
// DedicatedWorker, and mounting this view stands the population query worker up.
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
  type FeaturePermission,
} from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { loadEmployeeAnswers, upsertItemAnswer } from "../../../../../data/answers/answerStorage";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import XrayReferrals from "./XrayReferrals";

const MONTH = "5-may-2026";
const L = getLabels();

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

const TEMPLATE_ID = "tmpl-on-behalf";

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

/** Mark a row as answered by its own assignee, the way the queue itself reads
 *  completion (`answersMap.get(\`${xrayImageId}::${assignedTo}\`)`). */
async function seedSubmittedAnswer(
  root: DirectoryHandleLike,
  assignee: string,
  xrayImageId: string
): Promise<void> {
  const answer: ItemAnswer = {
    xrayImageId,
    templateId: TEMPLATE_ID,
    templateVersion: 1,
    answers: [{ fieldId: "note", value: "إجابة الموظف نفسه" }],
    lastSavedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    answeredBy: assignee,
    status: "submitted",
  };
  const saved = await upsertItemAnswer(root, MONTH, assignee, answer);
  if (!saved.ok) throw new Error(`seed answer failed: ${saved.error}`);
}

/** A supervisor state with one feature flipped on or off. */
function supervisorWith(featureId: string, enabled: boolean) {
  const base = createEmptyUserManagementState();
  const featurePermissions: FeaturePermission[] = [
    ...base.featurePermissions.filter((f) => !(f.role === "supervisor" && f.featureId === featureId)),
    { role: "supervisor", featureId, enabled } as FeaturePermission,
  ];
  return { ...base, featurePermissions };
}

function scopePicker(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: L.ew_queue_scope_label }) as HTMLSelectElement;
}

function pickScope(value: string): void {
  fireEvent.change(scopePicker(), { target: { value } });
}

/** Render, then switch the oversight scope to `employee`'s queue and wait for
 *  `xrayImageId` to be on screen. The view opens on the READER's own rows, so
 *  another employee's row is never visible until the picker is moved. */
async function openEmployeeQueue(employee: string, xrayImageId: string): Promise<void> {
  await waitFor(() => scopePicker());
  pickScope(employee);
  await waitFor(() => expect(screen.getAllByText(xrayImageId).length).toBeGreaterThan(0));
}

/** The panel's submit button — present exactly when the form is editable. */
function submitButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "تقديم الفحص" });
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

describe("XrayReferrals — answering on another employee's behalf", () => {
  it("opens an UNANSWERED row of the picked employee for editing, and says whose answer it is", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(supervisorWith("answer-on-behalf", true), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-MINE", "sup-1"], ["IMG-THEIRS", "emp-a"]]);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-MINE").length).toBeGreaterThan(0));

    await openEmployeeQueue("emp-a", "IMG-THEIRS");

    // Editable — this is the capability the picker exists to make useful.
    await waitFor(() => expect(submitButton()).not.toBeNull());
    // …and the reader is told they are authoring for someone else, since the
    // answer lands in that employee's file, not theirs.
    expect(
      screen.getByText(L.ew_panel_on_behalf_notice.replace("{name}", "emp-a"))
    ).toBeInTheDocument();
  });

  it("files the on-behalf answer under the ASSIGNEE and records the supervisor as the real author", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(supervisorWith("answer-on-behalf", true), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-THEIRS", "emp-a"]]);

    render(<XrayReferrals directoryHandle={root} />);
    await openEmployeeQueue("emp-a", "IMG-THEIRS");

    const note = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(note, { target: { value: "أجاب المشرف نيابةً" } });
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "تقديم الفحص" })));

    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

    // The join key is `${xrayImageId}::${assignedTo}`, so `answeredBy` MUST stay
    // the assignee — moving it to the supervisor would render the row unanswered.
    const file = await loadEmployeeAnswers(root, MONTH, "emp-a");
    const item = file?.items.find((i) => i.xrayImageId === "IMG-THEIRS");
    expect(item).toBeDefined();
    expect(item!.answeredBy).toBe("emp-a");
    expect(item!.answeredOnBehalfBy).toBe("sup-1");
    expect(item!.history?.some((h) => h.action === "answered-on-behalf" && h.by === "sup-1")).toBe(true);
    // Nothing was written into the supervisor's own file.
    const ownFile = await loadEmployeeAnswers(root, MONTH, "sup-1");
    expect(ownFile?.items ?? []).toHaveLength(0);
  });

  it("refuses an ALREADY-ANSWERED row of another employee even WITH the feature, and explains why", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(supervisorWith("answer-on-behalf", true), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-DONE", "emp-a"]]);
    await seedSubmittedAnswer(root, "emp-a", "IMG-DONE");

    render(<XrayReferrals directoryHandle={root} />);
    await openEmployeeQueue("emp-a", "IMG-DONE");

    // The one thing the feature must never do: overwrite someone's submitted
    // answer. Reopening it is the auditable way to correct one.
    await waitFor(() =>
      expect(
        screen.getByText(L.ew_panel_locked_answered.replace("{name}", "emp-a"))
      ).toBeInTheDocument()
    );
    expect(submitButton()).toBeNull();
  });

  it("leaves another employee's row read-only WITHOUT the feature, and says so", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    // Off by default for every managed role — asserted explicitly all the same.
    writeUserManagementState(supervisorWith("answer-on-behalf", false), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-THEIRS", "emp-a"]]);

    render(<XrayReferrals directoryHandle={root} />);
    await openEmployeeQueue("emp-a", "IMG-THEIRS");

    await waitFor(() =>
      expect(
        screen.getByText(L.ew_panel_locked_no_permission.replace("{name}", "emp-a"))
      ).toBeInTheDocument()
    );
    expect(submitButton()).toBeNull();
  });

  it("does not change the reader's OWN rows — with the feature or without", async () => {
    for (const enabled of [true, false]) {
      writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
      writeUserManagementState(supervisorWith("answer-on-behalf", enabled), false);

      const root = createMemoryDirectory("root");
      await seedMonth(root, [["IMG-MINE", "sup-1"]]);

      render(<XrayReferrals directoryHandle={root} />);
      await waitFor(() => expect(screen.getAllByText("IMG-MINE").length).toBeGreaterThan(0));

      await waitFor(() => expect(submitButton()).not.toBeNull());
      // No notice at all: nothing unusual is happening on your own row, and the
      // on-behalf feature is irrelevant to it in either state.
      expect(screen.queryByText(/نيابةً عن/)).toBeNull();
      expect(screen.queryByText(/مسندة إلى/)).toBeNull();
      cleanup();
    }
  });

  it("still lets the reader revisit their OWN already-answered sample — the unanswered rule is only for other people's rows", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(supervisorWith("answer-on-behalf", true), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-MINE-DONE", "sup-1"]]);
    await seedSubmittedAnswer(root, "sup-1", "IMG-MINE-DONE");

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-MINE-DONE").length).toBeGreaterThan(0));

    // The submitted-answer view (with its reopen affordance) is what an employee
    // already gets on their own answered sample — unchanged. What must NOT
    // appear is the "another employee already answered this" lock, which would
    // mean the new restriction had leaked onto the reader's own work.
    await waitFor(() => expect(screen.getByText(/إجابة الموظف نفسه/)).toBeInTheDocument());
    expect(
      screen.queryByText(L.ew_panel_locked_answered.replace("{name}", "sup-1"))
    ).toBeNull();
    expect(screen.queryByText(/مسندة إلى/)).toBeNull();
  });
});

describe("XrayReferrals — reassigning one row from the panel", () => {
  it("offers «إسناد لموظف آخر» on ANOTHER employee's row for a holder of bulk-reassign-referrals", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-THEIRS", "emp-a"]]);

    render(<XrayReferrals directoryHandle={root} />);
    await openEmployeeQueue("emp-a", "IMG-THEIRS");

    // Previously gated on `assignedTo === username`, so reviewing someone's
    // queue and moving one sample out of it was impossible — while doing the
    // same thing in bulk was allowed.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "إسناد لموظف آخر" })).toBeInTheDocument()
    );
  });

  it("withholds it on another employee's row from a user who lacks the capability", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(supervisorWith("bulk-reassign-referrals", false), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [["IMG-THEIRS", "emp-a"]]);

    render(<XrayReferrals directoryHandle={root} />);
    await openEmployeeQueue("emp-a", "IMG-THEIRS");

    expect(screen.queryByRole("button", { name: "إسناد لموظف آخر" })).toBeNull();
  });
});
