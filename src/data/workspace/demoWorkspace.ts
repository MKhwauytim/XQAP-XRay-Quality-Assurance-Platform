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
import { saveTemplate } from "../templates/templateStorage";
import { saveInspectionTemplateSelection } from "../templates/templateSelectionStorage";
import type { TemplateSchema } from "../templates/templateTypes";

/**
 * Build a valid, "ready" in-memory workspace for the demo/viewer account.
 *
 * No real folder or File System Access permission is required — the handle is
 * backed by an in-memory tree, so nothing is ever written to the user's disk.
 * `createWorkspaceStructure` seeds the required folders plus the default
 * managed users, so User Management and role routing are populated out of the
 * box. `seedWorkspaceMonth` (below) then layers one month of realistic
 * population/sample/distribution/answer data on top, built entirely through the
 * real domain writers so the seeded JSON never drifts from the production
 * schema.
 */
/** Name of the in-memory demo directory handle — used to detect demo mode. */
export const DEMO_WORKSPACE_NAME = "Demo-Workspace";

export async function createDemoWorkspace(): Promise<DirectoryHandleLike> {
  const handle = createMemoryDirectory(DEMO_WORKSPACE_NAME);
  await createWorkspaceStructure(handle, DEMO_SEED_PROFILE.username);
  try {
    await seedWorkspaceMonth(handle, DEMO_SEED_PROFILE);
  } catch (error) {
    // Best-effort: a seeding failure must never block demo mode from opening
    // with at least the (still valid) empty workspace structure.
    logError("demoWorkspace:seed", error);
  }
  return handle;
}

// ─── Workspace month seed ──────────────────────────────────────────────────
// Internal-only testing aid (not showcase-polished): one small, realistic
// month so no screen is blank. Every persisted shape is produced by the SAME
// writers/domain functions the real app uses — population save path
// (saveMonthRun), sampleAlgorithm (drawSample), the template writer, and the
// distribution/answer writers — never a hand-rolled population.final.json /
// sample.master.json.
//
// The seeder is PARAMETERIZED (WorkspaceSeedProfile) rather than hard-coded so
// the read-only demo/viewer workspace and the dev-only simulated workspace
// (src/dev/simWorkspace.ts, excluded from production builds) share one
// implementation instead of two copies that drift.
//
// DETERMINISM IS A CONTRACT. The RNG seed is a fixed string, so the draw — and
// therefore every downstream count — is identical on every run. Nothing in this
// file may call `Math.random()`, and no seeded *value* may come from
// `Date.now()`: answer timestamps come from `profile.seededAt`. (The envelope
// metadata the real writers stamp — `writtenAt`, event ids — is still
// wall-clock/UUID, because those writers are the production ones and are not
// forked for seeding. Counts, ids and field values are what tests assert.)

export type WorkspaceSeedPort = {
  name: string;
  code: string;
  portType: string;
  sheetName: string;
  count: number;
};

/**
 * How the seeded `targetedByRiskEngine` column is populated.
 *
 * - `"binary"` — every row is `"نعم"` or `"لا"`. The original demo behaviour.
 * - `"vocabulary"` — a four-way spread over the categories `engineVerdictOf`
 *   (population/riskEngineVerdict.ts) actually distinguishes: recognized
 *   affirmative, recognized negative, blank, and unrecognized. A blank and an
 *   unrecognized value BOTH map to `null` ("we do not know what the engine
 *   said"), never to سليمة — so a seed that only ever emits نعم/لا cannot
 *   exercise the «مستهدف المؤشر» filter or the executive deck's agreement
 *   denominators against the case they are built to get right.
 */
export type RiskEngineSeedSpread = "binary" | "vocabulary";

export type WorkspaceSeedProfile = {
  month: number;
  year: number;
  /** Operator username stamped on the seeded population/sample/distribution writes. */
  username: string;
  /** Name recorded as the source risk workbook in the month manifest. */
  riskFileName: string;
  /** Fixed RNG seed string handed to `drawSample` — never randomized. */
  rngSeed: string;
  templateId: string;
  templateName: string;
  ports: readonly WorkspaceSeedPort[];
  samplingRules: StageSamplingRule[];
  allocations: EmployeeStageAllocation[];
  /** Fixed ISO timestamp stamped on every seeded answer. Never `Date.now()`. */
  seededAt: string;
  riskEngineSpread: RiskEngineSeedSpread;
};

const DEMO_MONTH = 5;
const DEMO_YEAR = 2026;
const DEMO_USERNAME = "viewer";

/** Exported so the seeded answers, the seeded template and any test agree on one id. */
export const DEMO_TEMPLATE_ID = "demo-inspection-template";

// Three ports summing to ~200 rows — enough for a stratified-looking draw
// without paying real-population-scale processing cost.
const DEMO_PORTS: WorkspaceSeedPort[] = [
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

// Four of the six default managed users are assignable (employee/supervisor);
// the other two (manager) never receive direct assignments in the real UI either.
const DEMO_ALLOCATIONS: EmployeeStageAllocation[] = [
  { username: "jalgahamdi",  stageKey: "first", method: "percentage", value: 35, isActive: true },
  { username: "hihaloraini", stageKey: "first", method: "percentage", value: 30, isActive: true },
  { username: "saalhijji",   stageKey: "first", method: "percentage", value: 20, isActive: true },
  { username: "malrogi",     stageKey: "first", method: "percentage", value: 15, isActive: true },
];

/**
 * The viewer/demo workspace's own seed configuration. Kept `"binary"` so the
 * shipped demo's numbers are unchanged by the parameterization.
 */
export const DEMO_SEED_PROFILE: WorkspaceSeedProfile = {
  month: DEMO_MONTH,
  year: DEMO_YEAR,
  username: DEMO_USERNAME,
  riskFileName: "بيانات_مخاطر_تجريبية.xlsx",
  rngSeed: "xray-demo-fixed-seed-v1",
  templateId: DEMO_TEMPLATE_ID,
  templateName: "نموذج فحص الجودة (تجريبي)",
  ports: DEMO_PORTS,
  samplingRules: DEMO_SAMPLING_RULES,
  allocations: DEMO_ALLOCATIONS,
  seededAt: "2026-06-01T08:00:00.000Z",
  riskEngineSpread: "binary",
};

/** A value that `engineVerdictOf` does NOT recognize — neither affirmative nor negative. */
const UNRECOGNIZED_RISK_VALUE = "قيد المراجعة";

/**
 * The seeded `targetedByRiskEngine` cell for one row.
 *
 * `"vocabulary"` cycles the four categories on `seq % 4` so every category has
 * a predictable, assertable share of the population. `seq % 8 === 0` (the
 * suspicious rows) is a subset of `seq % 4 === 0`, so every suspicious row is
 * also engine-affirmative — the realistic correlation — while the rest of the
 * affirmative bucket is not suspicious.
 */
function seedRiskEngineValue(
  seq: number,
  isSuspicious: boolean,
  spread: RiskEngineSeedSpread
): string | null {
  if (spread === "binary") return isSuspicious ? "نعم" : "لا";
  switch (seq % 4) {
    case 0: return "نعم";                     // recognized affirmative → اشتباه
    case 1: return "لا";                      // recognized negative   → سليمة
    case 2: return null;                      // blank                 → null
    default: return UNRECOGNIZED_RISK_VALUE;  // unrecognized          → null
  }
}

function buildSeedPopulationRow(
  seq: number,
  port: WorkspaceSeedPort,
  profile: WorkspaceSeedProfile
): PreparedPopulationRow {
  const padded = String(seq).padStart(4, "0");
  const isSuspicious = seq % 8 === 0; // ~12.5% suspicious — deterministic, no RNG needed here
  const result: "سليمة" | "اشتباه" = isSuspicious ? "اشتباه" : "سليمة";
  const day = (seq % 28) + 1;
  const entryDate = `${profile.year}-${String(profile.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const riskValue = seedRiskEngineValue(seq, isSuspicious, profile.riskEngineSpread);

  return {
    stage: "المستوى الأول",
    xrayImageId: `DEMO-${port.code}-${padded}`,
    xrayEntryDate: entryDate,

    portCode: port.code,
    portType: port.portType,
    portName: port.name,

    declarationNumber: `DEC-${port.code}-${padded}`,
    transitDeclarationNumber: null,
    declarationDate: entryDate,
    declarationHijriDate: null,

    manifestNumber: null,
    manifestType: null,
    manifestDate: null,

    plateOrContainerNumber: `PLT-${padded}`,
    chassisNumber: `CHS-${padded}`,
    finalDestination: null,

    xrayLevelOneResult: result,
    xrayLevelTwoResult: result,

    movementType: "استيراد",
    movementNumber: null,
    movementDate: null,
    movementHijriDate: null,
    reportNumber: null,

    entryDate: null,
    exitDate: null,

    targetedByRiskEngine: riskValue,
    riskMessage: riskValue === "نعم" ? "نمط استيراد غير معتاد" : null,

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

/**
 * The inspection template the seeded answers reference.
 *
 * Without this the seeded `ItemAnswer.templateId` pointed at a template that
 * did not exist anywhere in the workspace, so the inspection form had nothing
 * to render. `qualityImageResult` is the reporting pipeline's ground-truth
 * field (`executiveReportTypes.ts` → `expertResultFieldId`) and must keep that
 * exact id.
 */
function buildSeedTemplate(profile: WorkspaceSeedProfile): TemplateSchema {
  const phaseId = "phase-quality-review";
  return {
    templateId: profile.templateId,
    templateName: profile.templateName,
    version: 1,
    createdAt: profile.seededAt,
    createdBy: profile.username,
    updatedAt: profile.seededAt,
    updatedBy: profile.username,
    phases: [
      { phaseId, title: "مراجعة جودة الصورة", order: 1 },
    ],
    fields: [
      {
        fieldId: "qualityImageResult",
        phaseId,
        label: "نتيجة مراجعة الصورة",
        type: "dropdown",
        required: true,
        options: ["سليمة", "اشتباه"],
        order: 1,
      },
      {
        fieldId: "result",
        phaseId,
        label: "نتيجة التفتيش",
        type: "dropdown",
        required: true,
        options: ["سليمة", "اشتباه"],
        order: 2,
      },
      {
        fieldId: "notes",
        phaseId,
        label: "ملاحظات",
        type: "textarea",
        required: false,
        options: [],
        order: 3,
      },
    ],
  };
}

/**
 * Seed one complete month — population → sample → distribution → answers —
 * plus the inspection template those answers reference, into `handle`.
 *
 * Exported so `src/dev/simWorkspace.ts` (dev-only) can seed a larger, writable
 * variant of the same shapes without duplicating any of this.
 */
export async function seedWorkspaceMonth(
  handle: DirectoryHandleLike,
  profile: WorkspaceSeedProfile
): Promise<void> {
  const monthFolderName = formatMonthFolderName(profile.month, profile.year);

  // ── 0. Inspection template + active selection ──
  await saveTemplate(handle, buildSeedTemplate(profile));
  await saveInspectionTemplateSelection(handle, {
    templateId: profile.templateId,
    updatedAt: profile.seededAt,
    updatedBy: profile.username,
  });

  // ── 1. Population: rows across the profile's ports, saved through the real writer ──
  const preparedRows: PreparedPopulationRow[] = [];
  const riskRawRows: Array<Record<string, unknown>> = [];
  let seq = 0;
  for (const port of profile.ports) {
    for (let i = 0; i < port.count; i++) {
      seq += 1;
      const row = buildSeedPopulationRow(seq, port, profile);
      preparedRows.push(row);
      riskRawRows.push({
        "معرف الأشعة": row.xrayImageId,
        "اسم المنفذ": row.portName,
        "نوع المنفذ": row.portType,
        "المستوى": row.stage,
        "تاريخ دخول الأشعة": row.xrayEntryDate,
        "نتيجة المستوى الأول": row.xrayLevelOneResult,
        "نتيجة المستوى الثاني": row.xrayLevelTwoResult,
        "مستهدف من محرك المخاطر": row.targetedByRiskEngine,
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
    month: profile.month,
    year: profile.year,
    username: profile.username,
    riskFileName: profile.riskFileName,
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

  // ── 2. Sample draw — fixed seed → identical draw every run ──
  const drawResult = drawSample(
    preparedRows,
    { rngSeed: profile.rngSeed, samplingRules: profile.samplingRules },
    profile.username
  );
  if (!drawResult.ok) return;
  const sampleSaveResult = await saveSampleMaster(handle, monthFolderName, drawResult.data);
  if (!sampleSaveResult.ok) return;
  await updateMonthStatus(handle, monthFolderName, "sampled");

  // ── 3. Distribution — deterministic Hamilton apportionment, no RNG ──
  const employees = createDefaultManagedUsers();
  const { events } = calculateBulkAssignment({
    rows: drawResult.data.rows,
    allocations: profile.allocations,
    employees,
    operatorUsername: profile.username,
    month: profile.month,
    year: profile.year,
  });
  if (events.length === 0) return;
  const assignResult = await appendDistributionEvents(handle, monthFolderName, events);
  if (!assignResult.ok) return;
  await updateMonthStatus(handle, monthFolderName, "distributed");

  // ── 4. Partial answers — ~40% submitted, ~20% draft, rest pending, per employee ──
  await seedAnswers(handle, monthFolderName, profile, preparedRows, events);
}

async function seedAnswers(
  handle: DirectoryHandleLike,
  monthFolderName: string,
  profile: WorkspaceSeedProfile,
  preparedRows: PreparedPopulationRow[],
  events: DistributionEvent[]
): Promise<void> {
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

  // Fixed, profile-supplied timestamp — NOT Date.now(). A seeded workspace has
  // to be byte-comparable across runs for the values a test asserts.
  const now = profile.seededAt;
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
          templateId: profile.templateId,
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
          templateId: profile.templateId,
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
