import {
  createWorkspaceStructure,
  type DirectoryHandleLike
} from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { logError } from "../storage/errorLogger";
import { createDefaultManagedUsers } from "../../auth/userManagement";
import { formatMonthFolderName } from "../population/monthFolder";
import { saveMonthRun, updateMonthStatus } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { ProcessingSummaryData } from "../population/monthTypes";
import type { EmployeeStageAllocation, StageSamplingRule } from "../population/populationConfig";
import { drawSample } from "../sampling/sampleAlgorithm";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { calculateBulkAssignment } from "../distribution/bulkAssignment";
import { appendDistributionEvents } from "../distribution/distributionStorage";
import { buildCompletedEvent } from "../distribution/distributionLog";
import type { DistributionEvent } from "../distribution/distributionTypes";
import { saveEmployeeAnswers } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";

/**
 * Build a valid, "ready" in-memory workspace for the demo/viewer account.
 *
 * No real folder or File System Access permission is required — the handle is
 * backed by an in-memory tree, so nothing is ever written to the user's disk.
 * `createWorkspaceStructure` seeds the required folders plus the default
 * managed users, so User Management and role routing are populated out of the
 * box. `seedDemoMonth` (below) then layers one month of realistic population/
 * sample/distribution/answer data on top, built entirely through the real
 * domain writers so the seeded JSON never drifts from the production schema.
 */
/** Name of the in-memory demo directory handle — used to detect demo mode. */
export const DEMO_WORKSPACE_NAME = "Demo-Workspace";

export async function createDemoWorkspace(): Promise<DirectoryHandleLike> {
  const handle = createMemoryDirectory(DEMO_WORKSPACE_NAME);
  await createWorkspaceStructure(handle, "viewer");
  try {
    await seedDemoMonth(handle);
  } catch (error) {
    // Best-effort: a seeding failure must never block demo mode from opening
    // with at least the (still valid) empty workspace structure.
    logError("demoWorkspace:seed", error);
  }
  return handle;
}

// ─── Demo month seed ───────────────────────────────────────────────────────
// Internal-only testing aid (not showcase-polished): one small, realistic
// month so no screen in demo mode is blank. Every persisted shape is produced
// by the SAME writers/domain functions the real app uses — population save
// path (saveMonthRun), sampleAlgorithm (drawSample), and the distribution/
// answer writers — never a hand-rolled population.final.json / sample.master
// .json. The RNG seed is a fixed string so the draw (and therefore every
// downstream count) is identical across demo entries.

const DEMO_MONTH = 5;
const DEMO_YEAR = 2026;
const DEMO_USERNAME = "viewer";
const DEMO_RNG_SEED = "xray-demo-fixed-seed-v1";
const DEMO_TEMPLATE_ID = "demo-inspection-template";

type DemoPort = {
  name: string;
  code: string;
  portType: string;
  sheetName: string;
  count: number;
};

// Three ports summing to ~200 rows — enough for a stratified-looking draw
// without paying real-population-scale processing cost.
const DEMO_PORTS: DemoPort[] = [
  { name: "ميناء جدة الإسلامي", code: "JED", portType: "بحري", sheetName: "بحري", count: 90 },
  { name: "ميناء الدمام",       code: "DMM", portType: "بحري", sheetName: "بحري", count: 70 },
  { name: "منفذ البطحاء",       code: "BTH", portType: "بري",  sheetName: "بري",  count: 40 },
];

// Real sampling rules are calibrated for populations in the thousands; a
// direct copy would draw ~100% of this small demo population. Scale the
// stage-1 target down to a fraction so the demo shows a genuine sample <
// population, exactly like a real (small) monthly run would configure it.
const DEMO_SAMPLING_RULES: StageSamplingRule[] = [
  {
    stageKey: "first",
    method: "percentage",
    value: 30,
    isLocked: false,
    minRequiredCount: 0,
    certScanPercentage: 0,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred",
  },
];

// Four of the five default managed users are assignable (employee/supervisor);
// the fifth (manager) never receives direct assignments in the real UI either.
const DEMO_ALLOCATIONS: EmployeeStageAllocation[] = [
  { username: "jamila.ghamdi",   stageKey: "first", method: "percentage", value: 35, isActive: true },
  { username: "hatem.oraini",    stageKey: "first", method: "percentage", value: 30, isActive: true },
  { username: "salman.hajji",    stageKey: "first", method: "percentage", value: 20, isActive: true },
  { username: "mohammed.otaibi", stageKey: "first", method: "percentage", value: 15, isActive: true },
];

function buildDemoPopulationRow(seq: number, port: DemoPort): PreparedPopulationRow {
  const padded = String(seq).padStart(4, "0");
  const isSuspicious = seq % 8 === 0; // ~12.5% suspicious — deterministic, no RNG needed here
  const result: "سليمة" | "اشتباه" = isSuspicious ? "اشتباه" : "سليمة";
  const day = (seq % 28) + 1;
  const entryDate = `${DEMO_YEAR}-${String(DEMO_MONTH).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return {
    stage: "المستوى الأول",
    xrayImageId: `DEMO-${port.code}-${padded}`,
    xrayEntryDate: entryDate,

    portCode: port.code,
    portType: port.portType,
    portName: port.name,

    declarationNumber: `DEC-${port.code}-${padded}`,
    declarationDate: entryDate,

    plateOrContainerNumber: `PLT-${padded}`,
    chassisNumber: `CHS-${padded}`,

    xrayLevelOneResult: result,
    xrayLevelTwoResult: result,

    movementType: "استيراد",
    reportNumber: null,

    targetedByRiskEngine: isSuspicious ? "نعم" : "لا",
    riskMessage: isSuspicious ? "نمط استيراد غير معتاد" : null,

    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,

    levelOneEmployee: null,
    levelTwoEmployee: null,

    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,

    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],

    sourceSheetName: port.sheetName,
    sourceRowNumber: seq + 1,
  };
}

async function seedDemoMonth(handle: DirectoryHandleLike): Promise<void> {
  const monthFolderName = formatMonthFolderName(DEMO_MONTH, DEMO_YEAR);

  // ── 1. Population: ~200 rows across 3 ports, saved through the real writer ──
  const preparedRows: PreparedPopulationRow[] = [];
  const riskRawRows: Array<Record<string, unknown>> = [];
  let seq = 0;
  for (const port of DEMO_PORTS) {
    for (let i = 0; i < port.count; i++) {
      seq += 1;
      const row = buildDemoPopulationRow(seq, port);
      preparedRows.push(row);
      riskRawRows.push({
        "معرف الأشعة": row.xrayImageId,
        "اسم المنفذ": row.portName,
        "نوع المنفذ": row.portType,
        "المستوى": row.stage,
        "تاريخ دخول الأشعة": row.xrayEntryDate,
        "نتيجة المستوى الأول": row.xrayLevelOneResult,
        "نتيجة المستوى الثاني": row.xrayLevelTwoResult,
      });
    }
  }

  const totalRows = preparedRows.length;
  const processingSummary: Omit<ProcessingSummaryData, "savedAt"> = {
    removedRows: [],
    duplicateRows: [],
    invalidResultRows: [],
    summary: {
      riskOriginalRows: totalRows,
      validRiskIdRows: totalRows,
      invalidRiskIdRows: 0,
      duplicateRiskIdRows: 0,
      rowsAfterDeduplication: totalRows,
      removedInvalidResultRows: 0,
      finalPreparedPopulationRows: totalRows,
      certScanRows: 0,
      nonCertScanRows: totalRows,
      certScanPercentage: 0,
      nonCertScanPercentage: 100,
      biProvided: false,
      biMatchedRows: 0,
      biUnmatchedRows: 0,
      biMatchPercentage: 0,
      totalBiFilledFields: 0,
      biFieldFillSummary: [],
    },
  };

  const saveResult = await saveMonthRun({
    directoryHandle: handle,
    month: DEMO_MONTH,
    year: DEMO_YEAR,
    username: DEMO_USERNAME,
    riskFileName: "بيانات_مخاطر_تجريبية.xlsx",
    biFileName: null,
    certScanUsed: false,
    riskRawRows,
    biRawRows: [],
    processedRows: preparedRows as Array<Record<string, unknown>>,
    certScanRows: 0,
    nonCertScanRows: totalRows,
    processingSummary,
  });
  if (!saveResult.ok) return;

  // ── 2. Sample draw — fixed seed → identical draw every demo entry ──
  const drawResult = drawSample(
    preparedRows,
    { rngSeed: DEMO_RNG_SEED, samplingRules: DEMO_SAMPLING_RULES },
    DEMO_USERNAME
  );
  if (!drawResult.ok) return;
  const sampleSaveResult = await saveSampleMaster(handle, monthFolderName, drawResult.data);
  if (!sampleSaveResult.ok) return;
  await updateMonthStatus(handle, monthFolderName, "sampled");

  // ── 3. Distribution — deterministic Hamilton apportionment, no RNG ──
  const employees = createDefaultManagedUsers();
  const { events } = calculateBulkAssignment({
    rows: drawResult.data.rows,
    allocations: DEMO_ALLOCATIONS,
    employees,
    operatorUsername: DEMO_USERNAME,
    month: DEMO_MONTH,
    year: DEMO_YEAR,
  });
  if (events.length === 0) return;
  const assignResult = await appendDistributionEvents(handle, monthFolderName, events);
  if (!assignResult.ok) return;
  await updateMonthStatus(handle, monthFolderName, "distributed");

  // ── 4. Partial answers — ~40% submitted, ~20% draft, rest pending, per employee ──
  const assignedByEmployee = new Map<string, DistributionEvent[]>();
  for (const evt of events) {
    if (evt.eventType !== "assigned") continue;
    const list = assignedByEmployee.get(evt.assignedTo) ?? [];
    list.push(evt);
    assignedByEmployee.set(evt.assignedTo, list);
  }

  // xrayImageId → its own population row, so each seeded answer can carry a
  // "qualityImageResult" value derived from that row's real level-one result
  // (the reporting pipeline's ground-truth field — see executiveReportTypes.ts
  // `expertResultFieldId`). Without this, expertResult resolves to null for
  // every row and overallAccuracy/suspiciousDetectionRate/missedSuspicionRate
  // all render as "—" instead of real numbers.
  const rowsById = new Map<string, PreparedPopulationRow>();
  for (const row of preparedRows) {
    rowsById.set(row.xrayImageId, row);
  }

  const now = new Date().toISOString();
  const completedEvents: DistributionEvent[] = [];

  for (const [empUsername, assigned] of assignedByEmployee) {
    const items: ItemAnswer[] = [];
    assigned.forEach((evt, i) => {
      const bucket = i % 5;
      const row = rowsById.get(evt.xrayImageId);
      // Quality reviewer's call: agrees with the front-line decision on most
      // rows, but deterministically disagrees on ~1 in 15 (modulo on the row's
      // own sequence number, never Math.random — this file stays reproducible
      // by design) so missedSuspicionRate/falseSuspicionRate also get a
      // non-zero denominator instead of just overallAccuracy.
      const baseResult: "سليمة" | "اشتباه" = row?.xrayLevelOneResult ?? "سليمة";
      const seq = row ? row.sourceRowNumber - 1 : 0;
      const qualityResult: "سليمة" | "اشتباه" =
        seq % 15 === 0 ? (baseResult === "سليمة" ? "اشتباه" : "سليمة") : baseResult;
      if (bucket < 2) {
        items.push({
          xrayImageId: evt.xrayImageId,
          templateId: DEMO_TEMPLATE_ID,
          templateVersion: 1,
          answers: [
            { fieldId: "result", value: "سليمة" },
            { fieldId: "notes", value: "لا ملاحظات" },
            { fieldId: "qualityImageResult", value: qualityResult },
          ],
          lastSavedAt: now,
          submittedAt: now,
          answeredBy: empUsername,
          status: "submitted",
        });
        completedEvents.push(
          buildCompletedEvent({ xrayImageId: evt.xrayImageId, assignedTo: empUsername, eventBy: empUsername })
        );
      } else if (bucket === 2) {
        items.push({
          xrayImageId: evt.xrayImageId,
          templateId: DEMO_TEMPLATE_ID,
          templateVersion: 1,
          answers: [
            { fieldId: "result", value: "سليمة" },
            { fieldId: "qualityImageResult", value: qualityResult },
          ],
          lastSavedAt: now,
          submittedAt: null,
          answeredBy: empUsername,
          status: "draft",
        });
      }
      // bucket 3, 4: left pending — no answer record at all.
    });
    if (items.length > 0) {
      await saveEmployeeAnswers(handle, monthFolderName, empUsername, items);
    }
  }

  if (completedEvents.length > 0) {
    await appendDistributionEvents(handle, monthFolderName, completedEvents);
  }
}
