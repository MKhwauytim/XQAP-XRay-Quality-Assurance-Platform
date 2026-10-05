/* @vitest-environment jsdom */
// One assignee's unreadable answer chain must not blank the oversight queue.
//
// The reported incident: an employee working through their samples watched the
// whole queue become "0 samples" mid-session, then saw it come back after a
// page refresh. `loadOrDeriveDistributionCurrent` reports a failed read and an
// empty month identically (`null`), and this view's `?? []` turned the first
// into the second — committed with `setLoadState("ready")`, so nothing on
// screen said anything had gone wrong.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../auth/userManagement";
import { safeWriteJson } from "../../../../../data/storage/safeWrite";
import { getSampleEmployeeDir, getSampleMainDir } from "../../../../../data/workspace/workspacePaths";
import { appendAnswerEventSegment } from "../../../../../data/answers/answerEventStore";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import {
  appendDistributionEvents,
} from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
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

async function seedWorkspace(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root");
  await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-1")]));
  const appended = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-1", assignedTo: "emp-1", eventBy: "admin" }),
  ]);
  expect(appended.ok).toBe(true);
  // Deliberately NO `saveDistributionCurrent`: that also writes each employee's
  // sample mirror, and a current mirror is the fast path that answers the queue
  // without the workspace-wide derivation at all. These tests are about what
  // the view does when it DOES have to derive.
  return root;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  writeSession({ role: "admin", username: "admin", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});


/** A seedless answer chain whose legacy snapshot HAS items: the one case the
 *  fold still (deliberately) refuses, so emp-1's answers cannot be read. */
async function breakAssigneeAnswers(root: DirectoryHandleLike): Promise<void> {
  const employeeDir = await getSampleEmployeeDir(root, MONTH, true);
  await safeWriteJson(employeeDir, "emp-1.answers.json", {
    username: "emp-1",
    monthFolderName: MONTH,
    revision: 1,
    items: [
      {
        xrayImageId: "OLD",
        templateId: "t1",
        templateVersion: 1,
        answers: [],
        lastSavedAt: "2026-01-01T00:00:00.000Z",
        submittedAt: null,
        answeredBy: "emp-1",
        status: "draft",
      },
    ],
  });
  const mainDir = await getSampleMainDir(root, MONTH, true);
  await appendAnswerEventSegment(
    mainDir,
    [
      {
        eventId: "e1",
        eventType: "item-saved",
        eventAt: "2026-01-02T00:00:00.000Z",
        eventBy: "emp-1",
        authority: "self",
        xrayImageId: "IMG-1",
        templateId: "t1",
        templateVersion: 1,
        answers: [],
        status: "draft",
        lastSavedAt: "2026-01-02T00:00:00.000Z",
        answeredBy: "emp-1",
      },
    ],
    { deviceId: "dev", sessionId: "sess" }
  );
}

describe("XrayReferrals — oversight survives one assignee's unreadable answers", () => {
  it("control: with readable answers there is no warning", async () => {
    const root = await seedWorkspace();
    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.queryByText("جاري التحميل...")).not.toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByText(/تعذر قراءة إجابات/)).not.toBeInTheDocument();
    expect(screen.queryByText("تعذر تحميل البيانات.")).not.toBeInTheDocument();
  });

  it("renders the queue and names the employee whose answers could not be read", async () => {
    const root = await seedWorkspace();
    await breakAssigneeAnswers(root);

    render(<XrayReferrals directoryHandle={root} />);

    // Pre-fix the whole view showed the generic load-failure state instead.
    expect(await screen.findByText(/تعذر قراءة إجابات: emp-1/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("تعذر تحميل البيانات.")).not.toBeInTheDocument();
  });
});
