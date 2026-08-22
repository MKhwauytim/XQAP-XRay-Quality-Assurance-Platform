/* @vitest-environment jsdom */
// The three top-level case chips above the referral queue:
//   «جميع الحالات» · «مستهدف المؤشر» · «إحالات استثنائية»
//
// The owner's goal for the control is that an employee can "identify and reach"
// the targeted and the exceptional cases without hunting through per-column
// filters, so these tests hold four things honest:
//
//  1. the DEFAULT is «جميع الحالات» and hides nothing;
//  2. «مستهدف المؤشر» means the risk engine actually said YES — a blank or an
//     unrecognized value is "we do not know", and must NOT be shown as targeted
//     (the same rule the executive deck's risk-engine page enforces, now shared
//     from src/data/population/riskEngineVerdict.ts);
//  3. the count on each chip is the length of the list that chip opens, over the
//     same scope the reader is already in — which, since the oversight scope
//     control became an employee picker, may be one named employee's queue;
//  4. switching chips does NOT destroy an unsaved inspection draft. A chip that
//     filters the open row out is the same shape of event as a supervisor
//     reassigning it mid-edit, and the view's `dirtyEntryId`/`lastPanelEntry`
//     retention must absorb it identically.
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
} from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import {
  ensureAdhocSampleMaster,
  assignAdhocRowsToEmployee,
} from "../../../../../data/adhocImport/adhocImportAssignment";
import type {
  AdhocImportRecord,
  AdhocImportRow,
} from "../../../../../data/adhocImport/adhocImportTypes";
import type { NormalizedRiskRow } from "../../Population/riskData/riskDataTypes";
import { QUEUE_SCOPE_ALL } from "./XrayReferrals/subComponents";
import XrayReferrals from "./XrayReferrals";

const MONTH = "5-may-2026";
const IMPORT_ID = "adh-1";
const ADHOC_ID = "ADHOC-adh-1-XR-1";

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

function makeRow(xrayImageId: string, targetedByRiskEngine: string | null): PreparedPopulationRow {
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
    targetedByRiskEngine,
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

/** `[xrayImageId, rawRiskEngineValue, assignedTo]`. */
type Seed = [string, string | null, string];

async function seedMonth(root: DirectoryHandleLike, seeds: Seed[]): Promise<void> {
  await saveSampleMaster(root, MONTH, makeSample(seeds.map(([id, risk]) => makeRow(id, risk))));
  const result = await appendDistributionEvents(
    root,
    MONTH,
    seeds.map(([id, , assignedTo]) => buildAssignEvent({ xrayImageId: id, assignedTo, eventBy: "admin" }))
  );
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
}

function mappedAdhocRow(xrayImageId: string): NormalizedRiskRow {
  return {
    movementType: "s1",
    portCode: null,
    portName: "ميناء جدة",
    portType: "بحري",
    movementNumber: null,
    movementDate: null,
    movementHijriDate: null,
    declarationNumber: "DEC-1",
    transitDeclarationNumber: null,
    declarationDate: null,
    declarationHijriDate: null,
    manifestNumber: null,
    manifestType: null,
    manifestDate: null,
    plateOrContainerNumber: null,
    finalDestination: null,
    entryDate: null,
    exitDate: null,
    chassisNumber: null,
    reportNumber: null,
    hasReport: false,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "اشتباه",
    inspectorResult: null,
    oppositeInspectorResult: null,
    liveMeansResult: null,
    xrayImageId,
    xrayEntryDate: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    stage: "المستوى الأول",
    sourceSheetName: "s1",
    sourceRowNumber: 2,
  };
}

async function seedAdhocAssignment(root: DirectoryHandleLike, employee: string): Promise<void> {
  const row: AdhocImportRow = {
    rowKey: "s1:2",
    mapped: mappedAdhocRow("XR-1"),
    validation: { valid: true },
    excludedByAdmin: false,
    assigned: false,
    assignedTo: null,
    assignedAt: null,
    namespacedXrayImageId: null,
  };
  const record: AdhocImportRecord = {
    importId: IMPORT_ID,
    fileName: `${IMPORT_ID}.xlsx`,
    importedBy: "admin",
    importedAt: "2026-08-07T10:00:00.000Z",
    status: "open",
    rows: [row],
  };
  await ensureAdhocSampleMaster(root, record);
  const assigned = await assignAdhocRowsToEmployee(root, record, ["s1:2"], employee, "admin");
  if (!assigned.ok) throw new Error(`ad-hoc assign failed: ${assigned.error}`);
}

async function seedDraftableTemplate(root: DirectoryHandleLike): Promise<void> {
  const template: TemplateSchema = {
    templateId: "tmpl-case-filter",
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
  if (!savedSelection.ok) throw new Error(`seed selection failed: ${savedSelection.error}`);
}

/** The chip button carrying this label (its accessible name also has the count). */
function chip(label: string): HTMLElement {
  const found = screen
    .getAllByRole("button")
    .filter((el) => el.classList.contains("ew-view-seg") && el.textContent?.startsWith(label));
  if (found.length !== 1) throw new Error(`expected exactly one chip for "${label}", got ${found.length}`);
  return found[0];
}

/** The number printed on a chip. */
function chipCount(label: string): string {
  return chip(label).querySelector(".ew-case-filter-count")?.textContent ?? "";
}

/** The QUEUE ROW for an id, or null — deliberately not `queryByText`, since the
 *  same id also renders inside the detail panel. */
function rowFor(id: string): HTMLElement | null {
  return (
    screen
      .queryAllByText(id)
      .map((el) => el.closest("tr"))
      .find((tr): tr is HTMLTableRowElement => tr !== null) ?? null
  );
}

/** The oversight scope picker (`<select>`), by its accessible name. */
function scopePicker(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: L.ew_queue_scope_label }) as HTMLSelectElement;
}

/** Switch the queue to a username, or to `QUEUE_SCOPE_ALL`. */
function pickScope(value: string): void {
  fireEvent.change(scopePicker(), { target: { value } });
}

/** Every xrayImageId currently rendered as a queue row. */
function queueIds(candidates: string[]): string[] {
  return candidates.filter((id) => rowFor(id) !== null);
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

/** One employee, one of each interesting risk-column value, plus an ad-hoc row. */
const MIXED: Seed[] = [
  ["IMG-BLANK", null, "jalgahamdi"],
  ["IMG-YES", "نعم", "jalgahamdi"],
  ["IMG-NO", "لا", "jalgahamdi"],
  ["IMG-UNKNOWN", "ربما", "jalgahamdi"],
];
const ALL_IDS = ["IMG-BLANK", "IMG-YES", "IMG-NO", "IMG-UNKNOWN", ADHOC_ID];

async function renderMixedQueue(): Promise<void> {
  writeSession({ role: "employee", username: "jalgahamdi", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await seedMonth(root, MIXED);
  await seedAdhocAssignment(root, "jalgahamdi");
  render(<XrayReferrals directoryHandle={root} />);
  await waitFor(() => expect(rowFor(ADHOC_ID)).not.toBeNull());
}

describe("XrayReferrals case filter — the three chips", () => {
  it("is available to an ordinary employee and defaults to «جميع الحالات», showing every row", async () => {
    await renderMixedQueue();

    // The whole point of the control: an employee, not just an oversight user.
    expect(screen.getByRole("group", { name: L.ew_case_filter_aria })).toBeInTheDocument();
    // The scope picker stays oversight-only: an ordinary employee's queue is
    // already scoped to them, and offering them one would force the full
    // workspace read their sample-mirror fast path exists to avoid.
    expect(screen.queryByRole("combobox", { name: L.ew_queue_scope_label })).toBeNull();

    expect(chip(L.ew_case_filter_all)).toHaveAttribute("aria-pressed", "true");
    expect(chip(L.ew_case_filter_risk_targeted)).toHaveAttribute("aria-pressed", "false");
    expect(chip(L.ew_case_filter_adhoc)).toHaveAttribute("aria-pressed", "false");
    expect(queueIds(ALL_IDS)).toEqual(ALL_IDS);
  });

  it("prints a count on every chip that matches the rows that chip opens onto", async () => {
    await renderMixedQueue();

    expect(chipCount(L.ew_case_filter_all)).toBe("5");
    expect(chipCount(L.ew_case_filter_risk_targeted)).toBe("1");
    expect(chipCount(L.ew_case_filter_adhoc)).toBe("1");

    fireEvent.click(chip(L.ew_case_filter_risk_targeted));
    await waitFor(() => expect(queueIds(ALL_IDS)).toHaveLength(1));

    fireEvent.click(chip(L.ew_case_filter_adhoc));
    await waitFor(() => expect(queueIds(ALL_IDS)).toHaveLength(1));

    // Counts are over the scope, not over the active chip, so they do not
    // collapse to the filtered view once a chip is selected.
    expect(chipCount(L.ew_case_filter_all)).toBe("5");
  });

  it("«مستهدف المؤشر» shows only affirmative-engine rows — blank and unrecognized values are excluded", async () => {
    await renderMixedQueue();

    fireEvent.click(chip(L.ew_case_filter_risk_targeted));

    await waitFor(() => expect(rowFor("IMG-NO")).toBeNull());
    expect(queueIds(ALL_IDS)).toEqual(["IMG-YES"]);
    // The correctness core: a blank means "we do not know what the engine said",
    // never "the engine targeted it" — and neither does an unknown spelling.
    expect(rowFor("IMG-BLANK")).toBeNull();
    expect(rowFor("IMG-UNKNOWN")).toBeNull();
    expect(chip(L.ew_case_filter_risk_targeted)).toHaveAttribute("aria-pressed", "true");
    expect(chip(L.ew_case_filter_all)).toHaveAttribute("aria-pressed", "false");
  });

  it("«إحالات استثنائية» shows only ad-hoc-imported rows", async () => {
    await renderMixedQueue();

    fireEvent.click(chip(L.ew_case_filter_adhoc));

    await waitFor(() => expect(rowFor("IMG-YES")).toBeNull());
    expect(queueIds(ALL_IDS)).toEqual([ADHOC_ID]);
  });

  it("returns to the full queue when «جميع الحالات» is picked again", async () => {
    await renderMixedQueue();

    fireEvent.click(chip(L.ew_case_filter_adhoc));
    await waitFor(() => expect(rowFor("IMG-YES")).toBeNull());

    fireEvent.click(chip(L.ew_case_filter_all));
    await waitFor(() => expect(rowFor("IMG-YES")).not.toBeNull());
    expect(queueIds(ALL_IDS)).toEqual(ALL_IDS);
  });
});

describe("XrayReferrals case filter — composition with the scope picker", () => {
  it("filters within the active scope, and the counts follow the scope switch", async () => {
    // supervisor => can("view-all-entries") => the scope picker is rendered,
    // and the view opens on the reader's own rows.
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [
      ["IMG-MINE-YES", "نعم", "sup-1"],
      ["IMG-MINE-NO", "لا", "sup-1"],
      ["IMG-THEIRS-YES", "نعم", "emp-2"],
      ["IMG-THEIRS-BLANK", null, "emp-2"],
    ]);
    const ids = ["IMG-MINE-YES", "IMG-MINE-NO", "IMG-THEIRS-YES", "IMG-THEIRS-BLANK"];

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(rowFor("IMG-MINE-YES")).not.toBeNull());

    // Personal scope: counts describe this reviewer's own two rows only.
    expect(chipCount(L.ew_case_filter_all)).toBe("2");
    expect(chipCount(L.ew_case_filter_risk_targeted)).toBe("1");

    fireEvent.click(chip(L.ew_case_filter_risk_targeted));
    await waitFor(() => expect(rowFor("IMG-MINE-NO")).toBeNull());
    expect(queueIds(ids)).toEqual(["IMG-MINE-YES"]);

    // Widening the scope keeps the chip selected and re-counts over the wider
    // set — the case filter composes with the scope, it does not replace it.
    pickScope(QUEUE_SCOPE_ALL);
    await waitFor(() => expect(rowFor("IMG-THEIRS-YES")).not.toBeNull());
    expect(chip(L.ew_case_filter_risk_targeted)).toHaveAttribute("aria-pressed", "true");
    expect(queueIds(ids)).toEqual(["IMG-MINE-YES", "IMG-THEIRS-YES"]);
    expect(chipCount(L.ew_case_filter_all)).toBe("4");
    expect(chipCount(L.ew_case_filter_risk_targeted)).toBe("2");

    // …and narrowing to ONE named employee re-counts over just their queue.
    // This is the case the old two-option switcher could not express at all.
    pickScope("emp-2");
    await waitFor(() => expect(rowFor("IMG-MINE-YES")).toBeNull());
    expect(queueIds(ids)).toEqual(["IMG-THEIRS-YES"]);
    expect(chipCount(L.ew_case_filter_all)).toBe("2");
    expect(chipCount(L.ew_case_filter_risk_targeted)).toBe("1");
  });

  it("shows only the picked employee's rows, and «الكل» restores every row", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [
      ["IMG-MINE", null, "sup-1"],
      ["IMG-A-1", null, "emp-a"],
      ["IMG-A-2", null, "emp-a"],
      ["IMG-B-1", null, "emp-b"],
    ]);
    const ids = ["IMG-MINE", "IMG-A-1", "IMG-A-2", "IMG-B-1"];

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(rowFor("IMG-MINE")).not.toBeNull());

    // Default is unchanged: the reader's own rows, nobody else's.
    expect(scopePicker().value).toBe("sup-1");
    expect(queueIds(ids)).toEqual(["IMG-MINE"]);

    // The whole point of the control — open ONE employee's queue.
    pickScope("emp-a");
    await waitFor(() => expect(rowFor("IMG-A-1")).not.toBeNull());
    expect(queueIds(ids)).toEqual(["IMG-A-1", "IMG-A-2"]);

    pickScope("emp-b");
    await waitFor(() => expect(rowFor("IMG-A-1")).toBeNull());
    expect(queueIds(ids)).toEqual(["IMG-B-1"]);

    pickScope(QUEUE_SCOPE_ALL);
    await waitFor(() => expect(rowFor("IMG-MINE")).not.toBeNull());
    expect(queueIds(ids)).toEqual(ids);
  });

  it("offers everyone who holds a row, and counts each queue in the option", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [
      ["IMG-MINE", null, "sup-1"],
      ["IMG-A-1", null, "emp-a"],
      ["IMG-A-2", null, "emp-a"],
    ]);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(rowFor("IMG-MINE")).not.toBeNull());

    const optionTexts = [...scopePicker().options].map((o) => o.textContent ?? "");
    // «الكل» carries the unscoped total, each employee their own — so the size
    // of a queue is visible BEFORE switching into it.
    expect(optionTexts[0]).toBe(L.ew_queue_scope_all.replace("{count}", "3"));
    expect(optionTexts).toContain(
      L.ew_queue_scope_option.replace("{name}", "emp-a").replace("{count}", "2")
    );
    // The reader themselves is pickable and marked as such — unlike the
    // reassign dialog's roster, which excludes them.
    expect(optionTexts).toContain(
      L.ew_queue_scope_option_self.replace("{name}", "sup-1").replace("{count}", "1")
    );
  });

  it("keeps an unsaved draft when the picked employee excludes the open row", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedMonth(root, [
      ["IMG-MINE", null, "sup-1"],
      ["IMG-THEIRS", null, "emp-a"],
    ]);
    await seedDraftableTemplate(root);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(rowFor("IMG-MINE")).not.toBeNull());

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });

    // Switching to another employee takes the open row out of the queue — the
    // same shape of event as a chip filtering it out, or a supervisor
    // reassigning it mid-edit, and the render-derived retention must absorb it.
    pickScope("emp-a");

    await waitFor(() => expect(rowFor("IMG-MINE")).toBeNull());
    expect((screen.getByLabelText("ملاحظة") as HTMLInputElement).value).toBe("مسودة غير محفوظة");
    expect(screen.getByText(L.ew_draft_retained_notice)).toBeInTheDocument();
  });
});

describe("XrayReferrals case filter — zero results", () => {
  it("explains an empty result instead of leaving a bare table header", async () => {
    writeSession({ role: "employee", username: "jalgahamdi", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    // Nothing this employee owns was targeted by the engine.
    await seedMonth(root, [
      ["IMG-BLANK", null, "jalgahamdi"],
      ["IMG-NO", "لا", "jalgahamdi"],
    ]);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(rowFor("IMG-BLANK")).not.toBeNull());

    expect(chipCount(L.ew_case_filter_risk_targeted)).toBe("0");
    fireEvent.click(chip(L.ew_case_filter_risk_targeted));

    await waitFor(() => expect(screen.getByText(L.ew_case_filter_empty)).toBeInTheDocument());
    expect(rowFor("IMG-BLANK")).toBeNull();
    expect(rowFor("IMG-NO")).toBeNull();

    // And it is only shown while the active chip is the empty one.
    fireEvent.click(chip(L.ew_case_filter_all));
    await waitFor(() => expect(screen.queryByText(L.ew_case_filter_empty)).toBeNull());
  });
});

describe("XrayReferrals case filter — unsaved drafts", () => {
  it("keeps the open panel and its typed answers when a chip filters that row out of the queue", async () => {
    writeSession({ role: "employee", username: "jalgahamdi", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    // IMG-BLANK is assigned first, so it auto-selects into the panel; it is the
    // row «مستهدف المؤشر» will exclude.
    await seedMonth(root, [
      ["IMG-BLANK", null, "jalgahamdi"],
      ["IMG-YES", "نعم", "jalgahamdi"],
    ]);
    await seedDraftableTemplate(root);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(rowFor("IMG-BLANK")).not.toBeNull());

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "مسودة غير محفوظة" } });
    expect(noteInput.value).toBe("مسودة غير محفوظة");

    fireEvent.click(chip(L.ew_case_filter_risk_targeted));

    // The row has left the queue…
    await waitFor(() => expect(rowFor("IMG-BLANK")).toBeNull());
    // …and the panel is still on it, with the draft intact — the same behaviour
    // as a supervisor reassigning the row mid-edit, not a swap to IMG-YES.
    expect((screen.getByLabelText("ملاحظة") as HTMLInputElement).value).toBe("مسودة غير محفوظة");
    expect(screen.getByText(L.ew_draft_retained_notice)).toBeInTheDocument();
  });
});
