/**
 * Selective backup restore — the ONE element catalog (Workstream D, 2026-09-28).
 *
 * A backup's `json/` tree mirrors the workspace root (createBackup copies every
 * `*.json` / `*.ndjson` under its workspace-relative path), so a backup-relative
 * path IS a workspace-relative path. This module answers, purely and from the
 * path alone, "which restorable element × month does this file belong to?".
 *
 * Every folder name comes from workspacePaths.ts (numbered roots AND their
 * legacy aliases) or from the owning module's exported constant.
 *
 * A path matching no element returns `null` and is NEVER restored by a
 * selective restore. Deliberately unmatched: `5-system/{backups,audit,locks,
 * system-errors,history,powerbi-export}/` (diagnostics, rolling snapshots and
 * exports), the `restore.inprogress.json` sentinel, and anything outside the
 * known roots. The full restore (no scope) never consults this.
 *
 * Element names cover what they hold: «نماذج الفحص وتفضيلات العرض» owns
 * everything under `6-templates/` (including the executive-deck preference
 * files) and «المستخدمون والصلاحيات والتسميات» everything under `3-user-data/`
 * (including `labels.snapshot.json`). An ad-hoc import's record
 * (`5-system/adhoc-imports/{id}.json`) follows its data month `adhoc-{id}`.
 *
 * Legacy pre-split `{user}.answers.json` files embed the referral queues; see
 * `answersFileEmbedsRequests` — content, not path, decides that.
 *
 * `derived: true` marks population artifacts a selective restore REBUILDS
 * rather than copies (the replacement-candidate index and the month
 * aggregate) — see selectiveRestore.ts.
 */
import type { LabelKey } from "../labels/labelsStore";
import { ANSWER_EVENTS_DIR } from "../answers/answerEventStore";
import { ANSWERS_SUFFIX, REQUESTS_SUFFIX } from "../answers/answerStorage";
import { DISTRIBUTION_EVENTS_DIR } from "../distribution/distributionEventStore";
import {
  DISTRIBUTION_CHECKPOINT_FILE,
  DISTRIBUTION_CURRENT_FILE,
  DISTRIBUTION_LOG_FILE,
} from "../distribution/distributionStorage";
import { adhocMonthFolder } from "../adhocImport/adhocImportModel";
import { ADHOC_IMPORT_INDEX_FILE } from "../adhocImport/adhocImportStorage";
import { POPULATION_AGGREGATE_FILE } from "../population/populationAggregate";
import { REPLACEMENT_INDEX_FOLDER } from "../population/replacementIndexStorage";
import { SAMPLE_MASTER_FILE } from "../sampling/sampleStorage";
import { SAMPLING_PLAN_FILE } from "../sampling/samplingPlanStorage";
import { SAMPLING_PROOF_FILE } from "../sampling/sampleTypes";
import { EMPLOYEE_MIRROR_INDEX_FILE, EMPLOYEE_MIRROR_SUFFIX } from "../samples/sampleMirrorStorage";
import {
  LEGACY_MONTH_SUBFOLDERS,
  LEGACY_WORKSPACE_ROOTS,
  SAMPLE_SUBFOLDERS,
  SYSTEM_FOLDER_NAMES,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";
import { RESTORE_INPROGRESS_FILE } from "./restoreSentinel";

export const RESTORE_ELEMENT_IDS = [
  "population",
  "sampleDistribution",
  "answers",
  "referralsApprovals",
  "populationSettings",
  "templates",
  "usersPermissions",
  "reportDesigns",
  "feedback",
  "systemSettings",
] as const;

export type RestoreElementId = (typeof RESTORE_ELEMENT_IDS)[number];

export type RestoreScope = {
  elements: RestoreElementId[];
  /** Month folder names exactly as on disk. Ignored by workspace-wide elements. */
  months: string[];
};

export type RestoreElementDefinition = {
  id: RestoreElementId;
  labelKey: LabelKey;
  monthScoped: boolean;
};

export const RESTORE_ELEMENTS: readonly RestoreElementDefinition[] = [
  { id: "population", labelKey: "restore_element_population", monthScoped: true },
  { id: "sampleDistribution", labelKey: "restore_element_sample_distribution", monthScoped: true },
  { id: "answers", labelKey: "restore_element_answers", monthScoped: true },
  { id: "referralsApprovals", labelKey: "restore_element_referrals_approvals", monthScoped: true },
  { id: "populationSettings", labelKey: "restore_element_population_settings", monthScoped: false },
  { id: "templates", labelKey: "restore_element_templates", monthScoped: false },
  { id: "usersPermissions", labelKey: "restore_element_users_permissions", monthScoped: false },
  { id: "reportDesigns", labelKey: "restore_element_report_designs", monthScoped: false },
  { id: "feedback", labelKey: "restore_element_feedback", monthScoped: false },
  { id: "systemSettings", labelKey: "restore_element_system_settings", monthScoped: false },
];

const MONTH_SCOPED_IDS: readonly RestoreElementId[] = RESTORE_ELEMENTS.filter(
  (element) => element.monthScoped
).map((element) => element.id);

export function isRestoreElementId(value: string): value is RestoreElementId {
  return (RESTORE_ELEMENT_IDS as readonly string[]).includes(value);
}

export function isMonthScopedElement(id: RestoreElementId): boolean {
  return MONTH_SCOPED_IDS.includes(id);
}

export type BackupPathClass = {
  element: RestoreElementId;
  /** Month folder for a month-scoped element; null for a workspace-wide one. */
  month: string | null;
  derived: boolean;
};

const POPULATION_ROOTS: ReadonlySet<string> = new Set([
  WORKSPACE_ROOTS.population,
  LEGACY_WORKSPACE_ROOTS.population,
]);
const SYSTEM_ROOTS: ReadonlySet<string> = new Set([WORKSPACE_ROOTS.system, LEGACY_WORKSPACE_ROOTS.system]);
const TEMPLATE_ROOTS: ReadonlySet<string> = new Set([
  WORKSPACE_ROOTS.templates,
  LEGACY_WORKSPACE_ROOTS.templates,
]);
const SYSTEM_CHILDREN_NEVER_RESTORED: ReadonlySet<string> = new Set([
  SYSTEM_FOLDER_NAMES.backups,
  SYSTEM_FOLDER_NAMES.audit,
  SYSTEM_FOLDER_NAMES.locks,
  SYSTEM_FOLDER_NAMES.systemErrors,
  // Rolling per-record pre-change snapshots and CSV exports are diagnostics /
  // outputs, not settings an admin restores from a backup.
  SYSTEM_FOLDER_NAMES.history,
  SYSTEM_FOLDER_NAMES.powerbiExport,
]);

/**
 * Sample/distribution FILE names that sat flat in a legacy month folder before
 * `2-samples/{month}/1-main/` existed. Listed only so a flat legacy copy is not
 * mistaken for population data; the owning modules keep their own names private.
 */
const LEGACY_FLAT_SAMPLE_FILES: ReadonlySet<string> = new Set([
  SAMPLE_MASTER_FILE,
  SAMPLING_PLAN_FILE,
  SAMPLING_PROOF_FILE,
  // Pre-`2-samples/` name with no remaining writer or owner constant (it survives
  // only in comments in populationTypes.ts / distributionTypes.ts).
  "main.samples.json",
  DISTRIBUTION_LOG_FILE,
  DISTRIBUTION_CURRENT_FILE,
  DISTRIBUTION_CHECKPOINT_FILE,
]);

function workspaceWide(element: RestoreElementId): BackupPathClass {
  return { element, month: null, derived: false };
}

function monthScoped(element: RestoreElementId, month: string, derived = false): BackupPathClass {
  return { element, month, derived };
}

/** The element a FIRST-LEVEL child (file or folder) of a population month folder belongs to. */
function populationMonthChildElement(name: string): RestoreElementId {
  if (
    name === LEGACY_MONTH_SUBFOLDERS.sample ||
    name === DISTRIBUTION_EVENTS_DIR ||
    LEGACY_FLAT_SAMPLE_FILES.has(name)
  ) {
    return "sampleDistribution";
  }
  if (name === LEGACY_MONTH_SUBFOLDERS.employeeAnswers || name === ANSWER_EVENTS_DIR) return "answers";
  if (name === LEGACY_MONTH_SUBFOLDERS.approvals) return "referralsApprovals";
  return "population";
}

function classifyPopulationPath(segments: readonly string[]): BackupPathClass {
  if (segments.length === 2) return workspaceWide("populationSettings");
  const month = segments[1];
  const element = populationMonthChildElement(segments[2]);
  const below = segments.slice(2);
  const derived =
    element === "population" &&
    (below.includes(REPLACEMENT_INDEX_FOLDER) || below[below.length - 1] === POPULATION_AGGREGATE_FILE);
  return monthScoped(element, month, derived);
}

function classifyEmployeeFile(fileName: string, month: string): BackupPathClass | null {
  if (fileName.endsWith(ANSWERS_SUFFIX)) return monthScoped("answers", month);
  if (fileName.endsWith(REQUESTS_SUFFIX)) return monthScoped("referralsApprovals", month);
  if (fileName.endsWith(EMPLOYEE_MIRROR_SUFFIX) || fileName === EMPLOYEE_MIRROR_INDEX_FILE) {
    return monthScoped("sampleDistribution", month);
  }
  return null;
}

function classifySamplesPath(segments: readonly string[]): BackupPathClass | null {
  if (segments.length < 4) return null;
  const month = segments[1];
  const sub = segments[2];
  if (sub === SAMPLE_SUBFOLDERS.main) {
    return monthScoped(segments[3] === ANSWER_EVENTS_DIR ? "answers" : "sampleDistribution", month);
  }
  if (sub === SAMPLE_SUBFOLDERS.employees) {
    return segments.length === 4 ? classifyEmployeeFile(segments[3], month) : null;
  }
  if (sub === SAMPLE_SUBFOLDERS.approvals) return monthScoped("referralsApprovals", month);
  return null;
}

function classifySystemPath(segments: readonly string[]): BackupPathClass | null {
  const child = segments[1];
  if (segments.length === 2) {
    return child === RESTORE_INPROGRESS_FILE ? null : workspaceWide("systemSettings");
  }
  if (child === SYSTEM_FOLDER_NAMES.feedback) return workspaceWide("feedback");
  if (SYSTEM_CHILDREN_NEVER_RESTORED.has(child)) return null;
  if (child === SYSTEM_FOLDER_NAMES.adhocImports && segments.length === 3) return classifyAdhocImportFile(segments[2]);
  return workspaceWide("systemSettings");
}

/**
 * `5-system/adhoc-imports/{importId}.json` is the import's own record, and its
 * data lives in `2-samples/adhoc-{importId}/`: the record therefore follows THAT
 * month (sample & distribution x `adhocMonthFolder(id)`), so restoring an
 * import's samples never leaves its record behind. The shared
 * `adhoc-imports.index.json` is only a rebuildable listing (see
 * adhocImportStorage.ts): it is `derived` — never copied selectively, and
 * self-repairing on the next ad-hoc write, with readers falling back to a live
 * `2-samples/` folder listing meanwhile. A FULL restore still copies it.
 */
function classifyAdhocImportFile(fileName: string): BackupPathClass {
  if (fileName === ADHOC_IMPORT_INDEX_FILE) return { element: "systemSettings", month: null, derived: true };
  if (!fileName.endsWith(".json") || fileName.length === ".json".length) return workspaceWide("systemSettings");
  return monthScoped("sampleDistribution", adhocMonthFolder(fileName.slice(0, -".json".length)));
}

/** Classify one backup-relative ("/"-joined) FILE path. */
export function classifyBackupPath(relativePath: string): BackupPathClass | null {
  const segments = relativePath.split("/");
  if (segments.length < 2 || segments.some((segment) => segment.length === 0)) return null;
  const root = segments[0];
  if (POPULATION_ROOTS.has(root)) return classifyPopulationPath(segments);
  if (root === WORKSPACE_ROOTS.samples) return classifySamplesPath(segments);
  if (root === WORKSPACE_ROOTS.userData) return workspaceWide("usersPermissions");
  if (root === WORKSPACE_ROOTS.reports) return workspaceWide("reportDesigns");
  if (TEMPLATE_ROOTS.has(root)) return workspaceWide("templates");
  if (SYSTEM_ROOTS.has(root)) return classifySystemPath(segments);
  // The legacy workspace-ROOT feedback folder (see getLegacyFeedbackDir).
  if (root === SYSTEM_FOLDER_NAMES.feedback) return workspaceWide("feedback");
  return null;
}

/**
 * Month folder names compare case-insensitively — `parseMonthFolderName`
 * accepts `5-May-2026` and `5-may-2026` alike, and on the Windows shares this
 * app runs against the two name one folder.
 */
export function sameMonthFolder(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isSelected(element: RestoreElementId, month: string | null, scope: RestoreScope): boolean {
  if (!scope.elements.includes(element)) return false;
  if (!isMonthScopedElement(element)) return true;
  // A directory ABOVE the month level: reachable when any month is chosen.
  if (month === null) return scope.months.length > 0;
  return scope.months.some((chosen) => sameMonthFolder(chosen, month));
}

export function isFileInRestoreScope(relativePath: string, scope: RestoreScope): boolean {
  const classified = classifyBackupPath(relativePath);
  if (!classified || classified.derived) return false;
  return isSelected(classified.element, classified.month, scope);
}

function candidatesUnderPopulationRoot(segments: readonly string[]): readonly RestoreElementId[] {
  // Only the LEGACY root ever holds sample/answers/approvals children of a
  // month folder; the numbered `1-population/` holds population data alone, so a
  // sample-only scope must not create an empty `1-population/{month}/`.
  const numbered = segments[0] === WORKSPACE_ROOTS.population;
  if (segments.length === 1) return numbered ? ["population", "populationSettings"] : [...MONTH_SCOPED_IDS, "populationSettings"];
  if (segments.length === 2) return numbered ? ["population"] : MONTH_SCOPED_IDS;
  if (segments.slice(2).includes(REPLACEMENT_INDEX_FOLDER)) return [];
  return [populationMonthChildElement(segments[2])];
}

function candidatesUnderSamplesRoot(segments: readonly string[]): readonly RestoreElementId[] {
  if (segments.length <= 2) return ["sampleDistribution", "answers", "referralsApprovals"];
  const sub = segments[2];
  if (sub === SAMPLE_SUBFOLDERS.main) {
    if (segments.length === 3) return ["sampleDistribution", "answers"];
    return [segments[3] === ANSWER_EVENTS_DIR ? "answers" : "sampleDistribution"];
  }
  // Mirrors in 2-employees are skip-derived, so only answers/requests can land there.
  if (sub === SAMPLE_SUBFOLDERS.employees) return ["answers", "referralsApprovals"];
  if (sub === SAMPLE_SUBFOLDERS.approvals) return ["referralsApprovals"];
  return [];
}

function candidatesUnderSystemRoot(segments: readonly string[]): readonly RestoreElementId[] {
  if (segments.length === 1) return ["feedback", "systemSettings"];
  const child = segments[1];
  if (child === SYSTEM_FOLDER_NAMES.feedback) return ["feedback"];
  if (SYSTEM_CHILDREN_NEVER_RESTORED.has(child)) return [];
  if (child === SYSTEM_FOLDER_NAMES.adhocImports) return ["sampleDistribution", "systemSettings"];
  return ["systemSettings"];
}

/** Every element a file somewhere under this directory could belong to. */
function candidateElementsForDirectory(segments: readonly string[]): readonly RestoreElementId[] {
  const root = segments[0];
  if (POPULATION_ROOTS.has(root)) return candidatesUnderPopulationRoot(segments);
  if (root === WORKSPACE_ROOTS.samples) return candidatesUnderSamplesRoot(segments);
  if (root === WORKSPACE_ROOTS.userData) return ["usersPermissions"];
  if (root === WORKSPACE_ROOTS.reports) return ["reportDesigns"];
  if (TEMPLATE_ROOTS.has(root)) return ["templates"];
  if (SYSTEM_ROOTS.has(root)) return candidatesUnderSystemRoot(segments);
  if (root === SYSTEM_FOLDER_NAMES.feedback) return ["feedback"];
  return [];
}

/**
 * Whether the restore walk should descend into (and therefore create on the
 * target side) this backup-relative DIRECTORY. A selective restore must never
 * create folders for elements the admin did not pick — in a legacy workspace an
 * empty `2-samples/` would flip layout detection to "mixed".
 */
export function isDirectoryInRestoreScope(relativeDirPath: string, scope: RestoreScope): boolean {
  const segments = relativeDirPath.split("/");
  const root = segments[0];
  const hasMonthLevel = POPULATION_ROOTS.has(root) || root === WORKSPACE_ROOTS.samples;
  const month = hasMonthLevel && segments.length >= 2 ? segments[1] : null;
  return candidateElementsForDirectory(segments).some((element) => isSelected(element, month, scope));
}

export type RestoreScopeProblem = "no-elements" | "unknown-element" | "no-months";

export function validateRestoreScope(scope: RestoreScope): RestoreScopeProblem | null {
  if (scope.elements.length === 0) return "no-elements";
  if (scope.elements.some((id) => !isRestoreElementId(id))) return "unknown-element";
  if (scope.elements.some((id) => isMonthScopedElement(id)) && scope.months.length === 0) return "no-months";
  return null;
}

export type RestoreScopeCell = { element: RestoreElementId; month: string | null };

/** Every (element, month) pair a scope selects: catalog order, then months as given. */
export function expandRestoreScope(scope: RestoreScope): RestoreScopeCell[] {
  const cells: RestoreScopeCell[] = [];
  for (const definition of RESTORE_ELEMENTS) {
    if (!scope.elements.includes(definition.id)) continue;
    if (!definition.monthScoped) {
      cells.push({ element: definition.id, month: null });
      continue;
    }
    for (const month of scope.months) cells.push({ element: definition.id, month });
  }
  return cells;
}

/**
 * Legacy pre-split `{user}.answers.json` files embed the employee's
 * referral / replacement / reopen queues (answerStorage.ts falls back to them
 * when no `{user}.requests.json` exists). Such a file belongs to BOTH the
 * Answers and the Referrals & approvals elements, but that cannot be told from
 * its PATH — only from its content — so `classifyBackupPath` files every
 * `*.answers.json` under Answers and the dependency plan
 * (`selectiveRestore.ts`) reads the backup's answer files with this predicate
 * and warns when exactly one of the two elements is selected: restoring Answers
 * alone also overwrites the embedded queues, and restoring Referrals alone does
 * not restore queues that only exist inside the answers files.
 */
export function answersFileEmbedsRequests(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return ["referralRequests", "replacementRequests", "reopenRequests"].some((key) => {
    const queue = record[key];
    return Array.isArray(queue) && queue.length > 0;
  });
}
