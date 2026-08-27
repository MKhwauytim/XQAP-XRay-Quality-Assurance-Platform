import {
  createWorkspaceStructure,
  type DirectoryHandleLike
} from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { logError } from "../storage/errorLogger";
import {
  createDefaultManagedUsers,
  createEmptyUserManagementState,
  normalizeUsername,
  type ManagedLoginUser,
} from "../../auth/userManagement";
import { syncUserManagementToDisk } from "./userSync";
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
import type { FieldAnswer, ItemAnswer } from "../answers/answerTypes";
import { saveTemplate } from "../templates/templateStorage";
import { saveInspectionTemplateSelection } from "../templates/templateSelectionStorage";
import type { TemplateSchema } from "../templates/templateTypes";

/**
 * Build a valid, "ready" in-memory workspace for the demo account (demo/demo).
 *
 * No real folder or File System Access permission is required — the handle is
 * backed by an in-memory tree, so nothing is ever written to the user's disk,
 * and the demo works even in browsers without the File System Access API.
 * `createWorkspaceStructure` seeds the required folders plus the default
 * managed users; the roster is then extended with the demo's own `demo`
 * employee account (so the demo user has an assigned queue of its own in the
 * employee workspace, distinct from the other seeded employees').
 * `seedWorkspaceMonth` (below) then layers one month of realistic
 * population/sample/distribution/answer data on top, built entirely through the
 * real domain writers so the seeded JSON never drifts from the production
 * schema. The demo is WRITABLE (2026-08-26): answering, reassignment and every
 * other mutation runs for real against the in-memory tree and evaporates on
 * logout.
 */
/** Name of the in-memory demo directory handle — used to detect demo mode. */
export const DEMO_WORKSPACE_NAME = "Demo-Workspace";

export async function createDemoWorkspace(): Promise<DirectoryHandleLike> {
  const handle = createMemoryDirectory(DEMO_WORKSPACE_NAME);
  await createWorkspaceStructure(handle, DEMO_SEED_PROFILE.username);
  try {
    // Overwrites the default roster written by createWorkspaceStructure with
    // the same defaults plus the demo employee account — before the month
    // seed, which assigns part of the sample to that account.
    const roster = buildDemoManagedUsers();
    await syncUserManagementToDisk(
      handle,
      { ...createEmptyUserManagementState(), users: roster },
      DEMO_SEED_PROFILE.username
    );
    await seedWorkspaceMonth(handle, { ...DEMO_SEED_PROFILE, employees: roster });
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
  /**
   * Roster handed to `calculateBulkAssignment` — the accounts assignments can
   * land on. Defaults to the shipped default users; the demo profile extends
   * it with the demo account so `demo` gets a queue of its own.
   */
  employees?: ManagedLoginUser[];
  /**
   * Overrides the seeded inspection template. Defaults to `buildSeedTemplate`
   * (the small 3-field template the dev-only simulated workspace still relies
   * on — see `simWorkspace.test.ts`'s frozen field-id assertion). The demo
   * profile overrides this with `buildDemoInspectionTemplate` so the demo
   * shows the SAME template a brand-new real workspace gets, not a bespoke
   * demo-only form.
   */
  templateBuilder?: (profile: WorkspaceSeedProfile) => TemplateSchema | Promise<TemplateSchema>;
  /**
   * Overrides how each seeded answer's field values are built. Defaults to
   * `buildDefaultSeedAnswerFields` (the `result`/`notes`/`qualityImageResult`
   * shape the simulated workspace's template expects). Must stay paired with
   * `templateBuilder` — the field ids each produces have to agree.
   */
  answerFieldsBuilder?: (args: SeedAnswerFieldsArgs) => FieldAnswer[];
};

export type SeedAnswerFieldsArgs = {
  qualityResult: "سليمة" | "اشتباه";
  isDraft: boolean;
  seq: number;
};

const DEMO_MONTH = 5;
const DEMO_YEAR = 2026;
const DEMO_OPERATOR_USERNAME = "demo";

/** Exported so the seeded answers, the seeded template and any test agree on one id. */
export const DEMO_TEMPLATE_ID = "demo-inspection-template";

/**
 * The demo's own employee account, appended to the default roster in the demo
 * workspace only (never in `createDefaultManagedUsers` itself). This is what
 * lets the demo user open الموظف view and find an assigned queue of their own,
 * distinct from the other seeded employees' queues — the reassignment showcase
 * (demo → supervisor and back) needs both sides populated.
 */
export function buildDemoManagedUsers(): ManagedLoginUser[] {
  const defaults = createDefaultManagedUsers();
  const demoUser: ManagedLoginUser = {
    id: "demo-user-demo",
    username: normalizeUsername(DEMO_OPERATOR_USERNAME),
    displayName: "الحساب التجريبي",
    role: "employee",
    // Cloned from the defaults rather than re-derived: hashing is async, and a
    // seed must not depend on WASM Argon2 being available.
    passwordHash: { ...defaults[0].passwordHash },
    isActive: true,
    hasCertScanLicense: false,
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
  };
  return [...defaults, demoUser];
}

// Five ports summing to 400 rows — enough for a ~100-row sample (the owner's
// demo target) with a real-looking land/sea stratification, while still
// seeding in well under a second.
const DEMO_PORTS: WorkspaceSeedPort[] = [
  { name: "ميناء جدة الإسلامي", code: "JED", portType: "بحري", sheetName: "بحري", count: 110 },
  { name: "ميناء الدمام",       code: "DMM", portType: "بحري", sheetName: "بحري", count: 90 },
  { name: "منفذ البطحاء",       code: "BTH", portType: "بري",  sheetName: "بري",  count: 90 },
  { name: "منفذ الحديثة",       code: "HDT", portType: "بري",  sheetName: "بري",  count: 60 },
  { name: "منفذ الرقعي",        code: "RQI", portType: "بري",  sheetName: "بري",  count: 50 },
];

// Real sampling rules are calibrated for populations in the thousands; a
// direct copy would draw ~100% of this small demo population. 25% of the
// 400-row population draws the ~100-image sample the owner asked the demo to
// carry — a genuine sample < population, like a real (small) monthly run.
const DEMO_SAMPLING_RULES: StageSamplingRule[] = [
  {
    stageKey: "first",
    method: "percentage",
    value: 25,
    isLocked: false,
    minRequiredCount: 0,
    certScanPercentage: 0,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred",
  },
];

// The demo account takes the largest share (its queue is the one the demo
// walks through), the supervisor gets a slice too so "the supervisor's queue
// differs from the employee's" is visibly true, and reassignment demo →
// supervisor has a populated target.
const DEMO_ALLOCATIONS: EmployeeStageAllocation[] = [
  { username: "demo",        stageKey: "first", method: "percentage", value: 35, isActive: true },
  { username: "jalgahamdi",  stageKey: "first", method: "percentage", value: 25, isActive: true },
  { username: "hihaloraini", stageKey: "first", method: "percentage", value: 20, isActive: true },
  { username: "saalhijji",   stageKey: "first", method: "percentage", value: 10, isActive: true },
  { username: "malrogi",     stageKey: "first", method: "percentage", value: 10, isActive: true },
];

/**
 * The demo workspace's own seed configuration. `"binary"` keeps the demo's
 * risk column simple (نعم/لا); the four-way vocabulary spread belongs to the
 * dev-only simulated workspace.
 */
export const DEMO_SEED_PROFILE: WorkspaceSeedProfile = {
  month: DEMO_MONTH,
  year: DEMO_YEAR,
  username: DEMO_OPERATOR_USERNAME,
  riskFileName: "بيانات_مخاطر_تجريبية.xlsx",
  rngSeed: "xray-demo-fixed-seed-v1",
  templateId: DEMO_TEMPLATE_ID,
  // Same name a brand-new real workspace's template gets (buildDefaultInspectionTemplate)
  // — the demo's template is linked to that real default, not a bespoke one.
  templateName: "نموذج ضمان جودة الأشعة",
  ports: DEMO_PORTS,
  samplingRules: DEMO_SAMPLING_RULES,
  allocations: DEMO_ALLOCATIONS,
  seededAt: "2026-06-01T08:00:00.000Z",
  riskEngineSpread: "binary",
  // NOTE: no `employees` here — the demo roster is attached at call time in
  // createDemoWorkspace. A module-scope buildDemoManagedUsers() call would run
  // createDefaultManagedUsers() at import time, which breaks every test that
  // module-mocks auth/userManagement (demoWorkspace is imported transitively
  // by AuthGate).
  templateBuilder: buildDemoInspectionTemplate,
  answerFieldsBuilder: buildDemoAnswerFields,
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
 * The DEFAULT seeded inspection template — small and bespoke, 3 fields.
 *
 * This is the fallback used only when a profile does not supply its own
 * `templateBuilder` (currently: the dev-only simulated workspace, whose test
 * pins this exact 3-field shape — see `simWorkspace.test.ts`). The demo
 * profile overrides this with `buildDemoInspectionTemplate` below, so the
 * demo's own template is the real "new workspace" default, not this one.
 *
 * Without a template the seeded `ItemAnswer.templateId` would point at a
 * template that does not exist anywhere in the workspace, so the inspection
 * form would have nothing to render. `qualityImageResult` is the reporting
 * pipeline's ground-truth field (`executiveReportTypes.ts` →
 * `expertResultFieldId`) and must keep that exact id.
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

// ─── Demo-only: the REAL default template, not a bespoke one ───────────────
// Owner request (2026-08-27): the demo's inspection template must be the same
// one a brand-new real workspace gets (`buildDefaultInspectionTemplate`),
// never a separate demo-only form that can drift from it.

/**
 * The one field both the seeded answers and the executive report key on by a
 * literal id. `DEFAULT_EXEC_CONFIG.expertResultFieldId` (executiveReportTypes.ts)
 * is a fixed, app-wide constant — not a per-workspace setting — so seeded
 * answers can only drive the executive report's expert-accuracy numbers if a
 * field with exactly this id exists. In `buildDefaultInspectionTemplate` this
 * is the "صحة النتيجة" field; canonicalization below pins its id here instead
 * of a random one.
 */
const DEMO_RESULT_FIELD_LABEL = "صحة النتيجة";
const DEMO_RESULT_FIELD_ID = "qualityImageResult";

/**
 * Stable, readable ids for every field of `buildDefaultInspectionTemplate`,
 * keyed by its (fixed) Arabic label. A label with no entry here falls back to
 * a positional id (`demo-field-N`) rather than throwing, so a future edit to
 * that template that adds/renames a field degrades gracefully instead of
 * breaking the demo seed.
 */
const DEMO_FIELD_ID_BY_LABEL: Record<string, string> = {
  "هل يوجد صورة": "hasImage",
  "سبب عدم وجود الصورة": "noImageReason",
  "هل يوجد تحديد": "hasMarking",
  "مستوى جودة الصورة": "imageQuality",
  "اسباب انخفاض جودة الصورة": "qualityReason",
  "سبب انخفاض الجودة (أخرى)": "qualityOther",
  "هل يمكن الاطلاع على البيان": "canViewDeclaration",
  "نوع البيان": "declarationType",
  "نوع البيان (أخرى)": "declarationTypeOther",
  "طبيعة البضاعة المصرح بها": "declaredNature",
  "طبيعة البضاعة المصرح بها (أخرى)": "declaredNatureOther",
  "طبيعة البضاعة الظاهرة بالأشعة": "observedNature",
  "طبيعة البضاعة الظاهرة بالأشعة (أخرى)": "observedNatureOther",
  "هل الوارد مطابق للبيان الجمركي": "matchesDeclaration",
  "أسباب عدم المطابقة": "mismatchReasons",
  "أسباب عدم المطابقة (أخرى)": "mismatchReasonsOther",
  "ملاحظات على البيان الجمركي": "declarationNotes",
  [DEMO_RESULT_FIELD_LABEL]: DEMO_RESULT_FIELD_ID,
  "تقييم الاشتباه": "suspicionLevel",
  "موقع الاشتباه": "suspicionLocation",
  "الاصناف المشبوهة": "suspectedTypes",
  "الية التهريب المحتملة": "smuggleMethod",
  "الملاحظات العامة": "notes",
};

/**
 * `buildDefaultInspectionTemplate` is intentionally non-deterministic — every
 * phase/field id comes from `createFieldId()`/`createPhaseId()`
 * (`Date.now()` + `Math.random()`), because it exists to give a real,
 * brand-new workspace fresh ids on every call. This file's seed, by
 * contract, may not depend on either, so this remaps every id (and every
 * `condition.sourceFieldId` reference to it) to the fixed table above right
 * after generation — the CONTENT (labels, options, phases, conditions) is
 * untouched, only the ids become stable.
 */
function canonicalizeTemplate(template: TemplateSchema): TemplateSchema {
  const phases = template.phases ?? [];
  const phaseIdMap = new Map<string, string>();
  phases.forEach((phase, index) => phaseIdMap.set(phase.phaseId, `demo-phase-${index + 1}`));

  const fieldIdMap = new Map<string, string>();
  template.fields.forEach((field, index) => {
    fieldIdMap.set(field.fieldId, DEMO_FIELD_ID_BY_LABEL[field.label] ?? `demo-field-${index + 1}`);
  });

  return {
    ...template,
    phases: phases.map((phase) => ({
      ...phase,
      phaseId: phaseIdMap.get(phase.phaseId) ?? phase.phaseId,
    })),
    fields: template.fields.map((field) => ({
      ...field,
      fieldId: fieldIdMap.get(field.fieldId) ?? field.fieldId,
      phaseId: field.phaseId ? phaseIdMap.get(field.phaseId) ?? field.phaseId : field.phaseId,
      condition: field.condition
        ? {
            ...field.condition,
            sourceFieldId: fieldIdMap.get(field.condition.sourceFieldId) ?? field.condition.sourceFieldId,
          }
        : field.condition,
    })),
  };
}

/**
 * The demo's actual inspection template: the real default study template
 * (`buildDefaultInspectionTemplate`), canonicalized for determinism, restamped
 * with this profile's id/name/authorship. Same phases, fields, labels,
 * options and conditional logic a genuine new workspace's inspector fills in
 * — never a separate demo-only form.
 *
 * Loaded via a dynamic `import()` rather than a static one: `demoWorkspace.ts`
 * is reachable from `AuthGate` (see the module doc above), which every
 * session loads, so a static import of the ~300-line template definition
 * would ship it in the MAIN bundle for every user instead of only when a demo
 * session actually seeds itself. This mirrors why TemplateBuilder itself is a
 * lazy tab boundary (`eslint.config.js`) — same bundle-size reasoning, applied
 * to its underlying data.
 */
async function buildDemoInspectionTemplate(profile: WorkspaceSeedProfile): Promise<TemplateSchema> {
  const { buildDefaultInspectionTemplate } = await import("../templates/defaultInspectionTemplate");
  const canonical = canonicalizeTemplate(buildDefaultInspectionTemplate(profile.username));
  return {
    ...canonical,
    templateId: profile.templateId,
    templateName: profile.templateName,
    createdAt: profile.seededAt,
    createdBy: profile.username,
    updatedAt: profile.seededAt,
    updatedBy: profile.username,
  };
}

/** Default seeded answer shape, paired with `buildSeedTemplate` above (the
 *  simulated workspace's 3-field template). */
function buildDefaultSeedAnswerFields({ qualityResult, isDraft }: SeedAnswerFieldsArgs): FieldAnswer[] {
  if (isDraft) {
    return [
      { fieldId: "result", value: "سليمة" },
      { fieldId: "qualityImageResult", value: qualityResult },
    ];
  }
  return [
    { fieldId: "result", value: "سليمة" },
    { fieldId: "notes", value: "لا ملاحظات" },
    { fieldId: DEMO_RESULT_FIELD_ID, value: qualityResult },
  ];
}

/**
 * The demo's seeded answer shape, paired with `buildDemoInspectionTemplate`
 * above: fills a representative slice of all three real phases (image
 * quality, customs-declaration analysis, result) instead of just the one
 * ground-truth field, so opening a seeded answer in the real inspection form
 * shows a genuinely filled-in inspection. Every choice is a function of
 * `seq`/`qualityResult` only — no `Math.random()` — so the seed stays
 * reproducible.
 */
function buildDemoAnswerFields({ qualityResult, isDraft, seq }: SeedAnswerFieldsArgs): FieldAnswer[] {
  const isSuspicion = qualityResult === "اشتباه";
  const imageQuality = seq % 5 === 0 ? "منخفض" : seq % 3 === 0 ? "متوسط" : "عالي";
  const declaredNature =
    seq % 2 === 0
      ? "طرود متجانسة (كراتين أو أكياس متكررة)"
      : "بضائع معدنية كثيفة (آلات ومعدات وقطع غيار)";
  const observedNature = isSuspicion ? "حمولة غير متجانسة" : declaredNature;

  const fields: FieldAnswer[] = [
    { fieldId: "hasImage", value: "نعم" },
    { fieldId: "hasMarking", value: isSuspicion ? "نعم" : "لا" },
    { fieldId: "imageQuality", value: imageQuality },
  ];
  if (imageQuality !== "عالي") {
    fields.push({ fieldId: "qualityReason", value: "جودة التقاط الصورة منخفضة" });
  }
  fields.push(
    { fieldId: "canViewDeclaration", value: "نعم" },
    { fieldId: "declarationType", value: "استيراد" },
    { fieldId: "declaredNature", value: declaredNature },
    { fieldId: "observedNature", value: observedNature },
    { fieldId: "matchesDeclaration", value: isSuspicion ? "لا" : "نعم" }
  );
  if (isSuspicion) {
    fields.push(
      { fieldId: "mismatchReasons", value: "وجود أجسام أو مواد غير مذكورة" },
      { fieldId: DEMO_RESULT_FIELD_ID, value: qualityResult },
      { fieldId: "suspicionLevel", value: "متوسط" },
      { fieldId: "suspicionLocation", value: "الحمولة" },
      { fieldId: "suspectedTypes", value: "بضائع غير مصرح بها ضمن الحمولة" },
      { fieldId: "smuggleMethod", value: "إخفاء داخل الحمولة الظاهرة" }
    );
  } else {
    fields.push({ fieldId: DEMO_RESULT_FIELD_ID, value: qualityResult });
  }
  if (!isDraft) {
    fields.push({
      fieldId: "notes",
      value: isSuspicion ? "يستدعي المراجعة اليدوية" : "لا ملاحظات",
    });
  }
  return fields;
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
  const template = await (profile.templateBuilder ?? buildSeedTemplate)(profile);
  await saveTemplate(handle, template);
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
  const employees = profile.employees ?? createDefaultManagedUsers();
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
      const buildAnswerFields = profile.answerFieldsBuilder ?? buildDefaultSeedAnswerFields;
      if (bucket < 2) {
        items.push({
          xrayImageId: evt.xrayImageId,
          templateId: profile.templateId,
          templateVersion: 1,
          answers: buildAnswerFields({ qualityResult, isDraft: false, seq }),
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
          answers: buildAnswerFields({ qualityResult, isDraft: true, seq }),
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
