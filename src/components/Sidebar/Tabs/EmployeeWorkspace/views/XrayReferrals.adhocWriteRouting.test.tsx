/* @vitest-environment jsdom */
// Ad-hoc write-routing regression tests.
//
// Every write XrayReferrals performs on a selected row must target the store the
// ROW came from, resolved through `folderForRow` — never the globally-selected
// month. Ad-hoc-imported rows live in a synthetic `2-samples/adhoc-{importId}/`
// folder (see adhocImportTypes.ts), so routing an ad-hoc row's write on
// `selMonth` writes into a real month's immutable audit trail: a `replaced`
// event for an `ADHOC-*` id that the real month's fold can never interpret, a
// real population row appended to an already-drawn `sample.master.json`, and a
// reopen request filed in a queue whose approver has no matching answer.
//
// The answer-save path (handleSave) already routed correctly; these cover the
// three that did not — handleReplace, handleRequestReopen and handleReopenAnswer.
//
// The final describe covers the READ side of the same contract: a write routed
// to the ad-hoc store is worthless if the view only ever reads the selected
// month back, which is exactly what it used to do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { safeWriteJson } from "../../../../../data/storage/safeWrite";
import {
  getPopulationMonthDir,
  POPULATION_SUBFOLDERS,
} from "../../../../../data/workspace/workspacePaths";
import {
  appendDistributionEvents,
  loadDistributionLog,
} from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { getReplacementCandidatesIndexed } from "../../../../../data/distribution/replacementCandidateLookup";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import {
  ensureAdhocSampleMaster,
  assignAdhocRowsToEmployee,
} from "../../../../../data/adhocImport/adhocImportAssignment";
import type {
  AdhocImportRecord,
  AdhocImportRow,
} from "../../../../../data/adhocImport/adhocImportTypes";
import { adhocMonthFolderName } from "../../../../../data/adhocImport/adhocImportTypes";
import { loadEmployeeAnswers } from "../../../../../data/answers/answerStorage";
import { loadReopenLog } from "../../../../../data/referral/referralStorage";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import type { NormalizedRiskRow } from "../../Population/riskData/riskDataTypes";
import XrayReferrals from "./XrayReferrals";

const MONTH = "5-may-2026";
const IMPORT_ID = "adh-1";
const ADHOC_FOLDER = adhocMonthFolderName(IMPORT_ID);
const ADHOC_ID = "ADHOC-adh-1-XR-1";

vi.mock("../../../../../data/distribution/replacementCandidateLookup", () => ({
  getReplacementCandidatesIndexed: vi.fn(),
}));
const lookupMock = vi.mocked(getReplacementCandidatesIndexed);

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

async function seedPopulationFinal(
  root: DirectoryHandleLike,
  rows: PreparedPopulationRow[]
): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, {
    create: true,
  });
  await safeWriteJson(processedDir, "population.final.json", {
    sourceMonthFolder: MONTH,
    processedAt: new Date().toISOString(),
    processedBy: "admin",
    totalRows: rows.length,
    certScanRows: 0,
    nonCertScanRows: rows.length,
    rows,
  });
}

function mappedAdhocRow(xrayImageId: string, sourceRowNumber = 2): NormalizedRiskRow {
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
    sourceRowNumber,
  };
}

function adhocImportRow(xrayImageId: string, sourceRowNumber = 2): AdhocImportRow {
  return {
    rowKey: `s1:${sourceRowNumber}`,
    mapped: mappedAdhocRow(xrayImageId, sourceRowNumber),
    validation: { valid: true },
    excludedByAdmin: false,
    assigned: false,
    assignedTo: null,
    assignedAt: null,
    namespacedXrayImageId: null,
  };
}

function makeAdhocRecord(importId: string, rows: AdhocImportRow[]): AdhocImportRecord {
  return {
    importId,
    fileName: `${importId}.xlsx`,
    importedBy: "admin",
    importedAt: "2026-08-07T10:00:00.000Z",
    status: "open",
    rows,
  };
}

/**
 * Real month with one row owned by another employee (so the ad-hoc row is the
 * only thing our employee owns and therefore auto-selects), plus one spare
 * population row the mocked candidate lookup can offer as a replacement.
 */
async function seedRealMonth(root: DirectoryHandleLike): Promise<void> {
  await seedPopulationFinal(root, [makeRow("IMG-1"), makeRow("IMG-9")]);
  await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1")]));
  const seeded = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-other", eventBy: "admin" }),
  ]);
  if (!seeded.ok) throw new Error(seeded.error);
}

async function seedAdhocAssignment(root: DirectoryHandleLike, employee: string): Promise<void> {
  const record = makeAdhocRecord(IMPORT_ID, [adhocImportRow("XR-1")]);
  await ensureAdhocSampleMaster(root, record);
  const assigned = await assignAdhocRowsToEmployee(root, record, ["s1:2"], employee, "admin");
  if (!assigned.ok) throw new Error("ad-hoc assign failed");
}

async function seedTemplate(root: DirectoryHandleLike): Promise<void> {
  const template: TemplateSchema = {
    templateId: "tmpl-adhoc-routing",
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

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  lookupMock.mockReset().mockResolvedValue({ recommended: [], all: [] });
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

describe("XrayReferrals — ad-hoc rows never write into the selected real month", () => {
  it("replaces an ad-hoc row inside the ad-hoc store, leaving the real month's event log untouched", async () => {
    writeSession({ role: "employee", username: "jalgahamdi", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedRealMonth(root);
    await seedAdhocAssignment(root, "jalgahamdi");

    lookupMock.mockResolvedValue({
      recommended: [
        {
          xrayImageId: "IMG-9",
          portName: "بري",
          stage: null,
          certScanStatus: "NonCertscan",
          xrayEntryDate: null,
          plateOrContainerNumber: null,
        } as never,
      ],
      all: [],
    });

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText(ADHOC_ID).length).toBeGreaterThan(0));

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: "طلب استبدال" }))
    );
    const dlg = await waitFor(() => screen.getByRole("dialog"));
    fireEvent.change(within(dlg).getByLabelText(/سبب الاستبدال/), { target: { value: "سبب" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "اختيار" }));

    // Wait for the write to land somewhere — either store.
    await waitFor(async () => {
      const adhocLog = await loadDistributionLog(root, ADHOC_FOLDER);
      const realLog = await loadDistributionLog(root, MONTH);
      expect(adhocLog.events.length + realLog.events.length).toBeGreaterThan(2);
    });

    const realLog = await loadDistributionLog(root, MONTH);
    const adhocLog = await loadDistributionLog(root, ADHOC_FOLDER);

    // The real month's immutable log must carry no trace of the ad-hoc row.
    expect(realLog.events.some((e) => e.xrayImageId === ADHOC_ID)).toBe(false);
    // …and it must not have gained an assignment for the replacement candidate
    // either: the whole transaction belongs to the ad-hoc store.
    expect(realLog.events.some((e) => e.xrayImageId === "IMG-9")).toBe(false);
    expect(realLog.events.map((e) => e.xrayImageId)).toEqual(["IMG-1"]);

    // The ad-hoc row is retired in its own store, so the employee stops owning it.
    expect(
      adhocLog.events.some((e) => e.xrayImageId === ADHOC_ID && e.eventType === "replaced")
    ).toBe(true);
  });

  it("files an employee reopen REQUEST for an ad-hoc row against the ad-hoc store", async () => {
    writeSession({ role: "employee", username: "jalgahamdi", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedRealMonth(root);
    await seedAdhocAssignment(root, "jalgahamdi");
    await seedTemplate(root);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText(ADHOC_ID).length).toBeGreaterThan(0));

    // Submit the answer through the real UI path (handleSave → folderForRow),
    // which already routed correctly — confirmed so the setup isn't in doubt.
    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "ملاحظة الفحص" } });
    fireEvent.click(screen.getByRole("button", { name: "تقديم الفحص" }));
    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

    const adhocAnswers = await loadEmployeeAnswers(root, ADHOC_FOLDER, "jalgahamdi");
    expect(adhocAnswers.items.find((i) => i.xrayImageId === ADHOC_ID)?.status).toBe("submitted");
    const realMonthAnswers = await loadEmployeeAnswers(root, MONTH, "jalgahamdi");
    expect(realMonthAnswers.items.some((i) => i.xrayImageId === ADHOC_ID)).toBe(false);

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: "طلب إعادة فتح الحالة" }))
    );
    fireEvent.change(
      await waitFor(() => screen.getByPlaceholderText("سبب إعادة الفتح (إلزامي)")),
      { target: { value: "بحاجة لتصحيح" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "طلب إعادة فتح الحالة" }));
    await waitFor(() =>
      expect(
        screen.getByText("تم إرسال طلب إعادة فتح الحالة — بانتظار موافقة المشرف.")
      ).toBeInTheDocument()
    );

    // The request must sit in the same store as the answer its approver will
    // reopen; filed against the real month, approval fails with "no saved answer".
    const adhocReopenLog = await loadReopenLog(root, ADHOC_FOLDER);
    const realReopenLog = await loadReopenLog(root, MONTH);
    expect(adhocReopenLog.requests.some((r) => r.xrayImageId === ADHOC_ID)).toBe(true);
    expect(realReopenLog.requests.some((r) => r.xrayImageId === ADHOC_ID)).toBe(false);
  });

  it("applies a supervisor's DIRECT reopen of an ad-hoc row against the ad-hoc store", async () => {
    // A supervisor holds ew.reopenAnswer, so InspectionPanel renders the direct
    // reopen button (handleReopenAnswer) rather than the request button.
    writeSession({ role: "supervisor", username: "malrogi", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedRealMonth(root);
    await seedAdhocAssignment(root, "malrogi");
    await seedTemplate(root);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText(ADHOC_ID).length).toBeGreaterThan(0));
    // Oversight scope shows both rows; select the ad-hoc one explicitly.
    fireEvent.click(screen.getAllByText(ADHOC_ID)[0]);

    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "ملاحظة الفحص" } });
    fireEvent.click(screen.getByRole("button", { name: "تقديم الفحص" }));
    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: "إعادة فتح للتصحيح" }))
    );
    fireEvent.change(
      await waitFor(() => screen.getByPlaceholderText("سبب إعادة الفتح (إلزامي)")),
      { target: { value: "بحاجة لتصحيح" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "إعادة فتح للتصحيح" }));

    // Routed on selMonth, the answer lookup happens in the real month, finds
    // nothing, and the reopen fails outright.
    await waitFor(() =>
      expect(screen.getByText("تمت إعادة فتح الإجابة للتصحيح.")).toBeInTheDocument()
    );

    const adhocAnswers = await loadEmployeeAnswers(root, ADHOC_FOLDER, "malrogi");
    expect(adhocAnswers.items.find((i) => i.xrayImageId === ADHOC_ID)?.status).toBe("draft");

    const realLog = await loadDistributionLog(root, MONTH);
    expect(realLog.events.some((e) => e.xrayImageId === ADHOC_ID)).toBe(false);
  });
});

describe("XrayReferrals — ad-hoc answers are read back from the store they were written to", () => {
  it("still shows a submitted ad-hoc answer as submitted after a remount", async () => {
    // Every ad-hoc WRITE is routed through folderForRow, but every answer READ
    // used to be hard-wired to the globally selected month — so a submitted
    // ad-hoc answer was correct on disk and invisible to the app. The row came
    // back as an unanswered, fully editable form with a live "تقديم الفحص"
    // button, and re-submitting overwrote the stored answer with whatever the
    // employee retyped into the blank form.
    writeSession({ role: "employee", username: "jalgahamdi", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedRealMonth(root);
    await seedAdhocAssignment(root, "jalgahamdi");
    await seedTemplate(root);

    const first = render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText(ADHOC_ID).length).toBeGreaterThan(0));
    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "ملاحظة الفحص" } });
    fireEvent.click(screen.getByRole("button", { name: "تقديم الفحص" }));
    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

    const stored = await loadEmployeeAnswers(root, ADHOC_FOLDER, "jalgahamdi");
    expect(stored.items.find((i) => i.xrayImageId === ADHOC_ID)?.status).toBe("submitted");

    first.unmount();
    resetBootProgress();

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText(ADHOC_ID).length).toBeGreaterThan(0));

    // Read-only submitted view: the saved value is on screen and the submit
    // button is gone, exactly as for a real month's row.
    await waitFor(() => expect(screen.getByText("ملاحظة الفحص")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "تقديم الفحص" })).toBeNull();
  });

  it("surfaces an ad-hoc answer to an oversight user, who never reads a personal mirror", async () => {
    writeSession({ role: "supervisor", username: "malrogi", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedRealMonth(root);
    await seedAdhocAssignment(root, "malrogi");
    await seedTemplate(root);

    const first = render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText(ADHOC_ID).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(ADHOC_ID)[0]);
    const noteInput = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(noteInput, { target: { value: "ملاحظة المشرف" } });
    fireEvent.click(screen.getByRole("button", { name: "تقديم الفحص" }));
    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());

    first.unmount();
    resetBootProgress();

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText(ADHOC_ID).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(ADHOC_ID)[0]);
    await waitFor(() => expect(screen.getByText("ملاحظة المشرف")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "تقديم الفحص" })).toBeNull();
  });
});
