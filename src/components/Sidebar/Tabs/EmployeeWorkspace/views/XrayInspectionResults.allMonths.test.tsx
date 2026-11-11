/* @vitest-environment jsdom */
// «جميع النتائج في النظام»: the results table shows the rows of every month, and
// a write on a row lands in the month that row came from, not the selected one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import { createEmptyUserManagementState, writeUserManagementState } from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { loadEmployeeAnswers, upsertItemAnswer } from "../../../../../data/answers/answerStorage";
import { DEFAULT_LABELS } from "../../../../../data/labels/labelsStore";
import XrayInspectionResults from "./XrayInspectionResults";

const APRIL = "4-april-2026";
const MAY = "5-may-2026";

vi.mock("../../../../../data/month/useGlobalMonth", () => {
  // One array for every render, as the real provider keeps its month list.
  const months = [
    { month: 4, year: 2026, folderName: "4-april-2026" },
    { month: 5, year: 2026, folderName: "5-may-2026" },
  ];
  return {
    useGlobalMonth: () => ({
      months,
      selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" },
      isSelectedMonthClosed: false,
      setSelectedMonth: () => true,
      startNewMonth: () => true,
      refreshMonths: async () => {},
      registerMonthChangeGuard: () => () => {},
    }),
  };
});

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
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
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

async function seedMonth(root: DirectoryHandleLike, month: string, id: string): Promise<void> {
  await saveSampleMaster(root, month, makeSample([makeRow(id)]));
  const assigned = await appendDistributionEvents(root, month, [
    buildAssignEvent({ xrayImageId: id, assignedTo: "emp-1", eventBy: "admin" }),
  ]);
  if (!assigned.ok) throw new Error(`seed assign failed: ${assigned.error}`);
  const answered = await upsertItemAnswer(root, month, "emp-1", {
    xrayImageId: id,
    templateId: "t1",
    templateVersion: 1,
    answers: [],
    lastSavedAt: new Date().toISOString(),
    submittedAt: null,
    answeredBy: "emp-1",
    status: "draft",
  });
  if (!answered.ok) throw new Error(`seed answer failed: ${answered.error}`);
}

async function renderWithTwoMonths(): Promise<DirectoryHandleLike> {
  writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await seedMonth(root, APRIL, "IMG-APRIL");
  await seedMonth(root, MAY, "IMG-MAY");
  render(<XrayInspectionResults directoryHandle={root} initialTab="results" />);
  await waitFor(() => expect(screen.getAllByText("IMG-MAY").length).toBeGreaterThan(0));
  return root;
}

const allMonthsButton = () => screen.getByRole("button", { name: DEFAULT_LABELS.xray_results_all_months });

describe("XrayInspectionResults — جميع النتائج في النظام", () => {
  it("shows only the selected month until the option is on, then every month", async () => {
    await renderWithTwoMonths();
    expect(screen.queryByText("IMG-APRIL")).toBeNull();

    fireEvent.click(allMonthsButton());
    await waitFor(() => expect(screen.getAllByText("IMG-APRIL").length).toBeGreaterThan(0));
    expect(screen.getAllByText("IMG-MAY").length).toBeGreaterThan(0);
    expect(screen.getAllByText(DEFAULT_LABELS.xray_results_col_month).length).toBeGreaterThan(0);

    fireEvent.click(allMonthsButton());
    await waitFor(() => expect(screen.queryByText("IMG-APRIL")).toBeNull());
  });

  it("writes a quality note on a row from another month into that month", async () => {
    const root = await renderWithTwoMonths();
    fireEvent.click(allMonthsButton());
    await waitFor(() => expect(screen.getAllByText("IMG-APRIL").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("row", { name: /IMG-APRIL/ }));
    const textarea = await screen.findByPlaceholderText(DEFAULT_LABELS.ew_quality_note_placeholder);
    fireEvent.change(textarea, { target: { value: "ملاحظة أبريل" } });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.ew_quality_note_save }));

    await waitFor(async () => {
      const april = await loadEmployeeAnswers(root, APRIL, "emp-1");
      expect(april.items.find((item) => item.xrayImageId === "IMG-APRIL")?.qualityNote).toBe("ملاحظة أبريل");
    });
    const may = await loadEmployeeAnswers(root, MAY, "emp-1");
    expect(may.items.every((item) => item.qualityNote === undefined)).toBe(true);
  });
});
