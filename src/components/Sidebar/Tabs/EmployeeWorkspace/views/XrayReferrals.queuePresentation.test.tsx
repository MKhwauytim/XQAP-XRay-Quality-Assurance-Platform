/* @vitest-environment jsdom */
// Audit cleanup batch for the referral queue's presentation layer:
//
//  1. Pending-row colouring for oversight users. `pendingReferralIds` /
//     `pendingReplacementIds` were short-circuited to empty sets whenever
//     `canSeeAll` held, so a supervisor's own outstanding referral/replacement
//     requests were the only rows in the app that lost their status colour. The
//     helpers already scope by username, so the short-circuit bought nothing.
//  2. The stats strip labelled itself "إحصائياتي" even in the "الكل" scope,
//     where every number it shows is workspace-wide. Since the scope control
//     became an EMPLOYEE PICKER there is a third case — one named other
//     employee — which is neither "mine" nor "everyone's" and gets its own
//     wording rather than being folded into either.
//  3. A zero-assignment queue rendered a bare empty table instead of the
//     shared EmptyState the sibling Employee Workspace views use.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { appendReferralRequest, appendReplacementRequest } from "../../../../../data/referral/referralStorage";
import { upsertItemAnswer } from "../../../../../data/answers/answerStorage";
import type { ItemAnswer } from "../../../../../data/answers/answerTypes";
import { HAS_IMAGE_FIELD_LABEL } from "../../../../../data/answers/noImageAnswer";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { QUEUE_SCOPE_ALL } from "./XrayReferrals/subComponents";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
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

async function seedAssignedSample(
  root: DirectoryHandleLike,
  username: string,
  id = "IMG-1"
): Promise<void> {
  await saveSampleMaster(root, MONTH, makeSample([makeRow(id)]));
  const result = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: id, assignedTo: username, eventBy: "admin" }),
  ]);
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
}

const L = getLabels();

/** The oversight scope picker (`<select>`), by its accessible name. */
function scopePicker(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: L.ew_queue_scope_label }) as HTMLSelectElement;
}

/** Switch the queue to a username, or to `QUEUE_SCOPE_ALL`. */
function pickScope(value: string): void {
  fireEvent.change(scopePicker(), { target: { value } });
}

function findRowByXrayImageId(id: string): HTMLElement {
  const matches = screen.getAllByText(id);
  const row = matches.map((el) => el.closest("tr")).find((tr): tr is HTMLTableRowElement => tr !== null);
  if (!row) throw new Error(`no <tr> found containing "${id}"`);
  return row;
}

describe("XrayReferrals pending-row colouring for oversight users", () => {
  it("colours an oversight user's OWN pending referral row, which the canSeeAll short-circuit used to suppress", async () => {
    // supervisor => can("view-all-entries") by default => canSeeAll.
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "sup-1");
    const referral = await appendReferralRequest(root, MONTH, {
      requestId: "ref-1",
      monthFolderName: MONTH,
      fromEmployee: "sup-1",
      toEmployee: "emp-2",
      xrayImageIds: ["IMG-1"],
      reason: "test reason",
      requestedAt: new Date().toISOString(),
      requestedBy: "sup-1",
      status: "pending",
    });
    if (!referral.ok) throw new Error(`seed referral failed: ${referral.error}`);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    expect(findRowByXrayImageId("IMG-1")).toHaveClass("dt-tr--pending");
  });

  it("colours an oversight user's OWN pending replacement row", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await seedAssignedSample(root, "sup-1");
    const replacement = await appendReplacementRequest(root, MONTH, {
      requestId: "rep-1",
      monthFolderName: MONTH,
      employeeUsername: "sup-1",
      originalXrayImageId: "IMG-1",
      replacementXrayImageId: "IMG-9",
      reason: "test reason",
      requestedAt: new Date().toISOString(),
      requestedBy: "sup-1",
      status: "pending",
    });
    if (!replacement.ok) throw new Error(`seed replacement failed: ${replacement.error}`);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    expect(findRowByXrayImageId("IMG-1")).toHaveClass("dt-tr--pending");
  });
});

describe("XrayReferrals stats strip scope labelling", () => {
  it("names whose figures it shows: mine, everyone's, or one picked employee's", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1"), makeRow("IMG-2")]));
    const seeded = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "sup-1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-2", eventBy: "admin" }),
    ]);
    if (!seeded.ok) throw new Error(`seed failed: ${seeded.error}`);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    // The view still opens on the reader's own rows, as the old default did.
    expect(scopePicker().value).toBe("sup-1");
    expect(screen.getByLabelText("إحصائياتي")).toBeInTheDocument();

    pickScope(QUEUE_SCOPE_ALL);

    // Everyone's: the strip must stop claiming to be the reader's own figures.
    await waitFor(() => expect(screen.queryByLabelText("إحصائياتي")).not.toBeInTheDocument());
    expect(screen.getByLabelText("إحصائيات جميع الموظفين")).toBeInTheDocument();

    // One named OTHER employee is neither of the two — it must not be
    // mislabelled as the reader's own figures nor as the whole workspace's.
    pickScope("emp-2");
    const employeeAria = L.ew_queue_stats_employee_aria.replace("{name}", "emp-2");
    await waitFor(() => expect(screen.getByLabelText(employeeAria)).toBeInTheDocument());
    expect(screen.queryByLabelText("إحصائياتي")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("إحصائيات جميع الموظفين")).not.toBeInTheDocument();
  });
});

describe("XrayReferrals zero-assignment empty state", () => {
  it("renders the shared EmptyState instead of an empty table when the employee has no assignments", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    // A drawn sample exists for the month, but nothing is assigned to emp-1.
    await seedAssignedSample(root, "emp-2");

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() =>
      expect(screen.getByText("لا توجد عينات مسندة إليك في هذا الشهر")).toBeInTheDocument()
    );
    expect(document.querySelector("table")).toBeNull();
  });
});

describe("XrayReferrals stats strip — معلقة (on-hold) bucket", () => {
  it("counts a submitted لا يوجد صورة answer as معلقة, distinct from a real مكتملة completion", async () => {
    writeSession({ role: "employee", username: "emp-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1"), makeRow("IMG-2"), makeRow("IMG-3")]));
    const seeded = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "IMG-2", assignedTo: "emp-1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "IMG-3", assignedTo: "emp-1", eventBy: "admin" }),
    ]);
    if (!seeded.ok) throw new Error(`seed failed: ${seeded.error}`);

    const template: TemplateSchema = {
      templateId: "tmpl-stats-test",
      templateName: "قالب الاختبار",
      version: 1,
      createdAt: new Date().toISOString(),
      createdBy: "admin",
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
      fields: [
        { fieldId: "f-has-image", label: HAS_IMAGE_FIELD_LABEL, type: "dropdown", required: true, options: ["نعم", "لا"] },
      ],
    };
    const savedTpl = await saveTemplate(root, template);
    if (!savedTpl.ok) throw new Error(`seed template failed: ${savedTpl.error}`);
    const savedSelection = await saveInspectionTemplateSelection(root, {
      templateId: template.templateId,
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
    });
    if (!savedSelection.ok) throw new Error(`seed template selection failed: ${savedSelection.error}`);

    function makeAnswer(xrayImageId: string, hasImage: "نعم" | "لا"): ItemAnswer {
      return {
        xrayImageId,
        templateId: template.templateId,
        templateVersion: 1,
        answers: [{ fieldId: "f-has-image", value: hasImage }],
        lastSavedAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        answeredBy: "emp-1",
        status: "submitted",
      };
    }
    // IMG-1: a real completion (نعم). IMG-2: no image (لا) — must count as
    // معلقة, not مكتملة. IMG-3: left untouched — لم تبدأ.
    const answer1 = await upsertItemAnswer(root, MONTH, "emp-1", makeAnswer("IMG-1", "نعم"));
    if (!answer1.ok) throw new Error(`seed answer1 failed: ${answer1.error}`);
    const answer2 = await upsertItemAnswer(root, MONTH, "emp-1", makeAnswer("IMG-2", "لا"));
    if (!answer2.ok) throw new Error(`seed answer2 failed: ${answer2.error}`);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-1").length).toBeGreaterThan(0));

    await waitFor(() => {
      const doneToken = screen.getByText("مكتملة").closest(".ew-ref-stat-token");
      expect(doneToken).toHaveTextContent("1");
    });
    const holdToken = screen.getByText("معلقة").closest(".ew-ref-stat-token");
    expect(holdToken).toHaveTextContent("1");
    const notStartedToken = screen.getByText("لم تبدأ").closest(".ew-ref-stat-token");
    expect(notStartedToken).toHaveTextContent("1");
  });
});
