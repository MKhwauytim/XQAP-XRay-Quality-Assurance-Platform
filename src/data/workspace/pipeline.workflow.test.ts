// D1 (Batch 3) — end-to-end workflow tests: one happy-path + one failure-path per stage
// across import → process → sample → distribute → answer → report, driven through the real
// domain functions and an in-memory workspace (`createMemoryDirectory`). The happy path runs
// the whole pipeline once in `beforeAll` and each stage asserts on the shared artifacts; the
// failure blocks build their own minimal bad input.
//
// WORKER BOUNDARY (import stage): in production the Excel import runs inside a DedicatedWorker
// (`src/workers/workbookWorker.ts`), which Vitest's node env cannot execute. The worker is a thin
// message-passing wrapper whose only real work is delegating to `processRiskWorkbook` /
// `processBiWorkbook`; this file tests that delegate parse/mapping function directly with a real
// in-memory .xlsx. It does NOT cover the postMessage plumbing of the worker wrapper itself.

import { beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { processRiskWorkbook } from "../../components/Sidebar/Tabs/Population/riskData/riskDataWorkbook";
import type { RiskWorkbookResult } from "../../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import { processPopulation } from "../../components/Sidebar/Tabs/Population/processing/populationProcessor";
import type { PopulationProcessingResult } from "../../components/Sidebar/Tabs/Population/processing/populationProcessingTypes";
import { saveMonthRun, loadMonthPopulationFinal } from "../population/populationStorage";
import { formatMonthFolderName } from "../population/monthFolder";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { StageSamplingRule, EmployeeStageAllocation } from "../population/populationConfig";
import { drawSample } from "../sampling/sampleAlgorithm";
import { saveSampleMaster, loadSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { calculateBulkAssignment } from "../distribution/bulkAssignment";
import {
  appendDistributionEvents,
  loadOrDeriveDistributionCurrent,
} from "../distribution/distributionStorage";
import type { DistributionCurrentData, DistributionEvent } from "../distribution/distributionTypes";
import { createDefaultManagedUsers } from "../../auth/userManagement";
import {
  saveEmployeeAnswers,
  loadEmployeeAnswers,
  loadAllEmployeeFiles,
} from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import { buildExecutiveReport } from "../reporting/executiveReport";
import { buildManagementReport } from "../reporting/management/managementReport";
import { DEFAULT_EXEC_CONFIG } from "../reporting/executiveReportTypes";

const MONTH = 5;
const YEAR = 2026;
const MONTH_FOLDER = formatMonthFolderName(MONTH, YEAR); // "5-may-2026"
const PORT_A = "ميناء جدة الإسلامي";
const PORT_B = "منفذ البطحاء";
const RNG_SEED = "workflow-fixed-seed-v1";

const RISK_HEADERS = [
  "اسم المنفذ",
  "نوع المنفذ",
  "المستوى",
  "نتيجة المستوى الأول",
  "نتيجة المستوى الثاني",
  "معرف الأشعة",
];

function riskRow(port: string, portType: string, result: string, xrayId: string): string[] {
  return [port, portType, "المستوى الأول", result, result, xrayId];
}

/** Eight valid rows across two ports (mixed clean/suspicious) — enough for a stratified draw. */
const VALID_RISK_ROWS: string[][] = [
  riskRow(PORT_A, "بحري", "سليمة", "XR-001"),
  riskRow(PORT_A, "بحري", "اشتباه", "XR-002"),
  riskRow(PORT_A, "بحري", "سليمة", "XR-003"),
  riskRow(PORT_A, "بحري", "سليمة", "XR-004"),
  riskRow(PORT_B, "بري", "سليمة", "XR-005"),
  riskRow(PORT_B, "بري", "اشتباه", "XR-006"),
  riskRow(PORT_B, "بري", "سليمة", "XR-007"),
  riskRow(PORT_B, "بري", "سليمة", "XR-008"),
];

/** Build a real .xlsx File (single sheet) in memory — exactly what the import worker parses. */
function buildRiskWorkbookFile(sheetName: string, dataRows: string[][]): File {
  const ws = XLSX.utils.aoa_to_sheet([RISK_HEADERS, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "risk.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const SAMPLING_RULES: StageSamplingRule[] = [
  {
    stageKey: "first",
    method: "percentage",
    value: 50,
    isLocked: false,
    minRequiredCount: 0,
    certScanPercentage: 0,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred",
  },
];

const ALLOCATIONS: EmployeeStageAllocation[] = [
  { username: "jamila.ghamdi", stageKey: "first", method: "percentage", value: 50, isActive: true },
  { username: "hatem.oraini", stageKey: "first", method: "percentage", value: 50, isActive: true },
];

type Artifacts = {
  handle: DirectoryHandleLike;
  riskResult: RiskWorkbookResult;
  processResult: PopulationProcessingResult;
  preparedRows: PreparedPopulationRow[];
  sample: SampleMasterData;
  events: DistributionEvent[];
  distribution: DistributionCurrentData;
  answerUsername: string;
  answerXrayId: string;
};

/** Run the whole happy pipeline once; individual stage tests assert on the result. */
async function runHappyPipeline(): Promise<Artifacts> {
  const handle = createMemoryDirectory("workflow-root");
  await createWorkspaceStructure(handle, "viewer");

  // 1. import — parse the real workbook through the worker's delegate.
  const riskFile = buildRiskWorkbookFile("بري", [
    ...VALID_RISK_ROWS,
    riskRow(PORT_A, "بحري", "سليمة", ""), // missing xray id → excluded
  ]);
  const riskResult = await processRiskWorkbook(riskFile);

  // 2. process — merge/validate/dedup into the prepared population.
  const processResult = await processPopulation({
    riskWorkbookResult: riskResult,
    biWorkbookResult: null,
    certScanPasteText: "",
  });
  const preparedRows = processResult.preparedRows;

  // Persist the processed population (process-stage persistence round-trip).
  await saveMonthRun({
    directoryHandle: handle,
    month: MONTH,
    year: YEAR,
    username: "tester",
    riskFileName: "risk.xlsx",
    biFileName: null,
    certScanUsed: false,
    riskRawRows: riskResult.rows as unknown as Array<Record<string, unknown>>,
    biRawRows: [],
    processedRows: preparedRows as unknown as Array<Record<string, unknown>>,
    certScanRows: 0,
    nonCertScanRows: preparedRows.length,
  });

  // 3. sample — deterministic draw + persist.
  const drawResult = drawSample(
    preparedRows,
    { rngSeed: RNG_SEED, samplingRules: SAMPLING_RULES },
    "tester",
  );
  if (!drawResult.ok) throw new Error(`sample draw failed: ${drawResult.reason}`);
  const sample = drawResult.data;
  await saveSampleMaster(handle, MONTH_FOLDER, sample);

  // 4. distribute — assign the sample and fold into current state.
  const employees = createDefaultManagedUsers();
  const { events } = calculateBulkAssignment({
    rows: sample.rows,
    allocations: ALLOCATIONS,
    employees,
    operatorUsername: "tester",
    month: MONTH,
    year: YEAR,
  });
  await appendDistributionEvents(handle, MONTH_FOLDER, events);
  const distribution = await loadOrDeriveDistributionCurrent(handle, MONTH_FOLDER, preparedRows);
  if (!distribution) throw new Error("distribution derive returned null");

  // 5. answer — submit an answer for the first assigned image.
  const firstAssigned = events.find((e) => e.eventType === "assigned");
  if (!firstAssigned) throw new Error("no assigned event produced");
  const answerUsername = firstAssigned.assignedTo;
  const answerXrayId = firstAssigned.xrayImageId;
  const now = new Date().toISOString();
  const items: ItemAnswer[] = [
    {
      xrayImageId: answerXrayId,
      templateId: "t",
      templateVersion: 1,
      answers: [{ fieldId: "qualityImageResult", value: "سليمة" }],
      lastSavedAt: now,
      submittedAt: now,
      answeredBy: answerUsername,
      status: "submitted",
    },
  ];
  await saveEmployeeAnswers(handle, MONTH_FOLDER, answerUsername, items);

  return {
    handle,
    riskResult,
    processResult,
    preparedRows,
    sample,
    events,
    distribution,
    answerUsername,
    answerXrayId,
  };
}

let a: Artifacts;

beforeAll(async () => {
  a = await runHappyPipeline();
});

// ── Stage 1: import ─────────────────────────────────────────────────────────
describe("workflow · import (processRiskWorkbook — worker delegate)", () => {
  it("happy: parses a valid workbook into normalized rows", () => {
    expect(a.riskResult.totalNormalizedRows).toBe(VALID_RISK_ROWS.length);
    expect(a.riskResult.rows).toHaveLength(VALID_RISK_ROWS.length);
    expect(a.riskResult.rows[0].xrayImageId).toBe("XR-001");
    expect(a.riskResult.rows[0].portName).toBe(PORT_A);
    // The row missing an xray id was excluded (surfaced in the count, not merged blindly).
    expect(a.riskResult.totalExcludedMissingXrayIdCount).toBe(1);
  });

  it("failure: rows missing the xray id are excluded, not crashed", async () => {
    const badFile = buildRiskWorkbookFile("بري", [
      riskRow(PORT_A, "بحري", "سليمة", ""),
      riskRow(PORT_B, "بري", "اشتباه", ""),
    ]);
    const result = await processRiskWorkbook(badFile);
    expect(result.totalNormalizedRows).toBe(0);
    expect(result.rows).toHaveLength(0);
    expect(result.totalExcludedMissingXrayIdCount).toBeGreaterThan(0);
  });
});

// ── Stage 2: process ────────────────────────────────────────────────────────
describe("workflow · process (processPopulation + persistence)", () => {
  it("happy: builds and persists the prepared population", async () => {
    expect(a.processResult.preparedRows.length).toBe(VALID_RISK_ROWS.length);
    expect(a.processResult.summary.finalPreparedPopulationRows).toBe(VALID_RISK_ROWS.length);

    const persisted = await loadMonthPopulationFinal(a.handle, MONTH_FOLDER);
    expect(persisted).not.toBeNull();
    expect(persisted?.rows.length).toBe(VALID_RISK_ROWS.length);
  });

  it("failure: duplicate xray ids are surfaced, not silently merged", async () => {
    const withDuplicate: RiskWorkbookResult = {
      ...a.riskResult,
      rows: [...a.riskResult.rows, a.riskResult.rows[0]],
    };
    const result = await processPopulation({
      riskWorkbookResult: withDuplicate,
      biWorkbookResult: null,
      certScanPasteText: "",
    });
    expect(result.duplicateRows.length).toBe(1);
    expect(result.summary.duplicateRiskIdRows).toBe(1);
    // The duplicate is dropped from the final population, not doubled.
    expect(result.preparedRows.length).toBe(VALID_RISK_ROWS.length);
  });
});

// ── Stage 3: sample ─────────────────────────────────────────────────────────
describe("workflow · sample (drawSample + persistence)", () => {
  it("happy: draws a deterministic sample and round-trips it", async () => {
    expect(a.sample.rows.length).toBeGreaterThan(0);
    expect(a.sample.rows.length).toBeLessThan(a.preparedRows.length);

    // Deterministic: a second draw with the same seed picks the identical ids.
    const second = drawSample(
      a.preparedRows,
      { rngSeed: RNG_SEED, samplingRules: SAMPLING_RULES },
      "tester",
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      const idsA = a.sample.rows.map((r) => r.xrayImageId).sort();
      const idsB = second.data.rows.map((r) => r.xrayImageId).sort();
      expect(idsB).toEqual(idsA);
    }

    const loaded = await loadSampleMaster(a.handle, MONTH_FOLDER);
    expect(loaded).not.toBeNull();
    expect(loaded?.rows.length).toBe(a.sample.rows.length);
  });

  it("failure: drawing from an empty population is rejected with a reason", () => {
    const result = drawSample([], { rngSeed: RNG_SEED, samplingRules: SAMPLING_RULES }, "tester");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ── Stage 4: distribute ─────────────────────────────────────────────────────
describe("workflow · distribute (calculateBulkAssignment + event log)", () => {
  it("happy: assigns every sampled row and folds into current state", () => {
    const assigned = a.events.filter((e) => e.eventType === "assigned");
    expect(assigned.length).toBe(a.sample.rows.length);
    expect(a.distribution.totalAssigned).toBeGreaterThan(0);
    expect(a.distribution.entries.length).toBe(a.sample.rows.length);
  });

  it("failure: no allocations produces no assignment events (no crash)", () => {
    const employees = createDefaultManagedUsers();
    const { events } = calculateBulkAssignment({
      rows: a.sample.rows,
      allocations: [],
      employees,
      operatorUsername: "tester",
      month: MONTH,
      year: YEAR,
    });
    expect(events).toHaveLength(0);
  });
});

// ── Stage 5: answer ─────────────────────────────────────────────────────────
describe("workflow · answer (saveEmployeeAnswers + read-back)", () => {
  it("happy: persists and reads back a submitted answer", async () => {
    const file = await loadEmployeeAnswers(a.handle, MONTH_FOLDER, a.answerUsername);
    expect(file.items).toHaveLength(1);
    expect(file.items[0].xrayImageId).toBe(a.answerXrayId);
    expect(file.items[0].status).toBe("submitted");

    const all = await loadAllEmployeeFiles(a.handle, MONTH_FOLDER);
    expect(all.some((f) => f.username === a.answerUsername)).toBe(true);
  });

  it("failure: loading answers for an unknown employee returns an empty file, not a throw", async () => {
    const file = await loadEmployeeAnswers(a.handle, MONTH_FOLDER, "ghost-user-xyz");
    expect(file.items).toHaveLength(0);
    expect(file.username).toBe("ghost-user-xyz");
  });
});

// ── Stage 6: report ─────────────────────────────────────────────────────────
describe("workflow · report (buildExecutiveReport + buildManagementReport)", () => {
  it("happy: builds Arabic RTL reports carrying the pipeline data", () => {
    const input = {
      monthFolderName: "5-May-2026",
      populationRows: a.preparedRows,
      sample: a.sample,
      distribution: a.distribution,
      employeeFiles: [] as never[],
      template: null,
      config: DEFAULT_EXEC_CONFIG,
    };
    const exec = buildExecutiveReport(input);
    const mgmt = buildManagementReport(input);

    expect(exec.length).toBeGreaterThan(1000);
    expect(exec).toContain('dir="rtl"');
    expect(exec).toContain(PORT_A);
    expect(mgmt).toContain('dir="rtl"');
    // Population total surfaces in the management scope KPIs.
    expect(mgmt).toContain(String(a.preparedRows.length));
  });

  it("failure: an empty population renders without throwing (empty-state)", () => {
    const emptyInput = {
      monthFolderName: "5-May-2026",
      populationRows: [] as PreparedPopulationRow[],
      sample: null,
      distribution: null,
      employeeFiles: [] as never[],
      template: null,
      config: DEFAULT_EXEC_CONFIG,
    };
    expect(() => buildExecutiveReport(emptyInput)).not.toThrow();
    expect(() => buildManagementReport(emptyInput)).not.toThrow();
    expect(buildExecutiveReport(emptyInput).length).toBeGreaterThan(500);
  });
});
