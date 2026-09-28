# Workstream D — Selective Backup Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin restore chosen elements (population, sample & distribution, answers, referrals & approvals, and the workspace-wide families) for chosen months out of one backup, with the same safety guarantees as today's full restore, plus a dependency check that refuses a population restore that would orphan live sampled ids.

**Architecture:** One pure element catalog (`src/data/backup/restoreScope.ts`) classifies every backup-relative path to `(element, month)`. `restoreBackupSnapshot` gains an optional `scope`; the existing walk prunes out-of-scope directories and files and otherwise runs unchanged (`assertBackupComplete` → full `pre-restore` rollback backup → sentinel → `restoreActionFor` semantics). A new orchestration module (`src/data/backup/selectiveRestore.ts`) adds the preview (file counts per element × month), the dependency plan (A2's coverage rule through Workstream A's `populationOverwriteGuard`, sample/answers warnings, empty selections), and the scoped run (derived-cache rebuild through Workstream A's `rebuildPopulationDerivedFiles` + post-restore integrity scan). The Archive tab's restore dialog gets a full/selective mode switch backed by a new `SelectiveRestorePanel`, and Workstream A's «استعادة المجتمع السابق» tool gains backup snapshots as `source: "backup"` candidates restored through the same engine.

**Tech Stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), Vite, Vitest (`node` default, jsdom per file), File System Access API through `DirectoryHandleLike`, in-memory test directories (`createMemoryDirectory`).

**Spec:** `docs/superpowers/specs/2026-09-28-corrective-plan-design.md` — section "Workstream D — Selective backup restore (item 10)"; A2 section for the coverage rule and the recovery tool.

---

## Global Constraints

These apply to every task. A task's text repeats the ones it depends on, but these win on any conflict.

- **Node** `>=22 <23`. TypeScript strict with `erasableSyntaxOnly` (no enums, no parameter properties, no namespaces). Use `import type` for type-only imports.
- **Arabic UI strings only through label keys** in `DEFAULT_LABELS` (`src/data/labels/labelsStore.ts`), read with `getLabels()` / `useLabels()`. No new inline Arabic in components.
- **Folder names only through `src/data/workspace/workspacePaths.ts`** (numbered roots and their legacy aliases) or an owning module's exported constant. Never spell a folder name in new code.
- **`scope` is optional everywhere.** Absent means today's full restore, byte-for-byte the same behaviour. Every existing backup/restore test must keep passing unmodified.
- **Every restore — full or selective — keeps its safety net:** `assertBackupComplete`, a full `pre-restore` rollback backup, and the `restore.inprogress.json` sentinel (written before the walk, left behind on failure, removed only on success).
- **Selective restore is admin-only** (`session.role === "admin"`), enforced at the render boundary (the mode switch is hidden) and at the handler boundary (`handleRestore` refuses a scope from a non-admin), on top of the existing `canMutate("archive.restoreBackup")`.
- **Writes go through `safeWriteJson` / `safeWriteJsonText` / `safeRemoveJson`** — never a raw `removeEntry` (ESLint bans it outside an allowlist), never an unguarded `createWritable`.
- **Tests:** Vitest with `globals: false` — import `describe`/`it`/`expect`/`vi` from `vitest`. Disk tests use `createMemoryDirectory`. A component test starts with `/* @vitest-environment jsdom */` on line 1.
- **Workstream A lands before this workstream, and D builds on its A2 contracts instead of re-implementing them** (`docs/superpowers/plans/2026-09-28-workstream-a-data-safety.md`): the coverage rule `loadPopulationOverwriteImpact` / `assessPopulationOverwrite` (`src/data/population/populationOverwriteGuard.ts`, A Task 3), the post-restore rebuild `rebuildPopulationDerivedFiles` and the candidate type `PopulationRecoveryCandidate` (`src/data/population/populationRecovery.ts`, A Task 8), and the admin UI `PopulationRecoverySection` (A Task 9). Tasks 4, 5 and 7 start with a grep that stops the task as BLOCKED if the contract they consume is missing. Line numbers quoted below are from `main` at 2026-09-28 and may have shifted; always locate an edit by the quoted text, not the number. If a quoted import block has gained names from Workstream A, keep those names and add yours.
- **Edit log, per task, after the change is applied:** `npm run editlog -- --tier=N --append --sync-package "<Category (scope): title>"`, then fill in the prose (`Why:` + `What changed:` at tier 2+; before/after snippets at tier 2+). Never create a second file for the same date.
- **Branch:** `claude/beautiful-einstein-y1ouot`. Commit at the end of each task. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
  ```

- `npm run build` is mandatory before any push (Task 8 does it; do not push from earlier tasks).

---

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `src/data/backup/restoreScope.ts` | Create (Task 1) | Pure element catalog: element ids, labels, month-scoped flag, `classifyBackupPath`, `isFileInRestoreScope`, `isDirectoryInRestoreScope`, `validateRestoreScope`, `expandRestoreScope`. |
| `src/data/backup/restoreScope.test.ts` | Create (Task 1) | Classifier table over numbered, legacy and mixed paths; scope predicates. |
| `src/data/workspace/workspacePaths.ts` | Modify (Task 1) | Add `LEGACY_MONTH_SUBFOLDERS`. |
| `src/data/answers/answerStorage.ts` | Modify (Task 1) | Export `ANSWERS_SUFFIX`, `REQUESTS_SUFFIX`; use `LEGACY_MONTH_SUBFOLDERS.employeeAnswers`. |
| `src/data/sampling/sampleStorage.ts` | Modify (Task 1) | Use `LEGACY_MONTH_SUBFOLDERS.sample`. |
| `src/data/population/populationStorage.ts` | Modify (Task 1) | Use `LEGACY_MONTH_SUBFOLDERS.sample`. |
| `src/data/approvals/approvalStorage.ts` | Modify (Task 1) | Use `LEGACY_MONTH_SUBFOLDERS.approvals`. |
| `src/data/population/populationAggregate.ts` | Modify (Tasks 1, 5) | Export `POPULATION_AGGREGATE_FILE`; add `discardPopulationAggregate`. |
| `src/data/population/replacementIndexStorage.ts` | Modify (Tasks 1, 5) | Export `REPLACEMENT_INDEX_FOLDER`; add `discardReplacementIndexManifest`. |
| `src/data/labels/labelsStore.ts` | Modify (Tasks 1, 6, 7) | Element-name labels, scope-error label, dialog labels, backup-candidate labels for the A2 section. |
| `src/data/backup/backupStorage.ts` | Modify (Tasks 1, 2, 3) | Legacy subfolder constants; `scope` through `collectJsonRestoreEntries` / `restoreJsonTree` / `restoreBackupSnapshot`; export `isSnapshotPayloadFile`, `restoreActionFor`, `BACKUP_JSON_FOLDER`, `openCompleteBackupJsonDir`. |
| `src/data/backup/selectiveRestoreTestKit.ts` | Create (Task 2) | Test-only helpers (seed hand-built backups with nested paths). Never imported by app code. |
| `src/data/backup/selectiveRestoreEngine.test.ts` | Create (Task 2) | Scoped engine tests. |
| `src/data/backup/selectiveRestore.ts` | Create (Task 3), extend (Tasks 4, 5, 7) | Preview, dependency plan (via A's overwrite guard), scoped run (via A's derived-file rebuild), A2 backup candidates. |
| `src/data/backup/selectiveRestorePreview.test.ts` | Create (Task 3) | Preview tests. |
| `src/data/backup/selectiveRestorePlan.test.ts` | Create (Task 4) | Coverage / warnings / empty-selection tests. |
| `src/data/backup/selectiveRestoreRun.test.ts` | Create (Task 5) | Run, rebuild, integrity tests. |
| `src/data/backup/selectiveRestorePopulationRecovery.test.ts` | Create (Task 7) | A2 hand-off tests. |
| `src/data/population/populationRecovery.ts` (Workstream A) | Modify (Task 7) | `PopulationRecoveryCandidate.source` gains `"backup"`. |
| `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx` (Workstream A) | Modify (Task 7) | Lists backup candidates and restores them through D's engine. |
| `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx` (Workstream A) | Modify (Task 7) | Mocks D's module; two backup-candidate tests. |
| `src/components/Sidebar/Tabs/Archive/selectiveRestoreText.ts` | Create (Task 6) | Label-template formatting for the dialog (and the moved `fillTemplate`). |
| `src/components/Sidebar/Tabs/Archive/SelectiveRestorePanel.tsx` | Create (Task 6) | Element/month pickers, preview, plan messages. Default export only (plus a type). |
| `src/components/Sidebar/Tabs/Archive/index.tsx` | Modify (Task 6) | Mode switch in `RestoreDialog`; `handleRestore` selective branch. |
| `src/components/Sidebar/Tabs/Archive/Archive.css` | Modify (Task 6) | Styles for the selective panel (CSS variables only, no hex literals). |
| `src/components/Sidebar/Tabs/Archive/SelectiveRestore.test.tsx` | Create (Task 6) | jsdom dialog tests. |
| `src/components/Sidebar/Tabs/Archive/index.test.tsx` | Modify (Task 6) | Mock the new `selectiveRestore` module. |
| `docs/architecture/data-system-report.md` | Modify (Task 8) | Document selective-restore semantics. |

### Verified file → element mapping (against `createBackup`'s real tree)

`createBackup` copies every `*.json` and `*.ndjson` in the workspace (skipping `5-system/backups/` and `.system/backups/`) into `5-system/backups/{folder}/json/` **under its workspace-relative path**. So a backup path is a workspace path. The catalog below is what Task 1 encodes.

| Element (id) | Month-scoped | Numbered paths | Legacy / mixed aliases |
|---|---|---|---|
| Population (`population`) | yes | `1-population/{m}/month.manifest.json`, `1-population/{m}/1-raw/**`, `1-population/{m}/2-processed/**` | `Population/{m}/**` (incl. `raw/`, `processed/`, flat files) — except the sample/answers/approvals children below |
| ↳ derived, rebuilt not copied | | `…/2-processed/replacement-index/**`, `…/2-processed/population.aggregate.json` | same under `Population/` |
| Sample & distribution (`sampleDistribution`) | yes | `2-samples/{m}/1-main/**` except `answers.events/`; `2-samples/{m}/2-employees/*.samples.json`, `_index.json` (both already `skip-derived`) | `Population/{m}/sample/**`, `Population/{m}/distribution.events/**`, flat `sample.master.json`, `sampling.plan.json`, `sampling-proof.json`, `main.samples.json`, `distribution.log.json`, `distribution.current.json`, `distribution.checkpoint.json` |
| Answers (`answers`) | yes | `2-samples/{m}/1-main/answers.events/**`, `2-samples/{m}/2-employees/*.answers.json` | `Population/{m}/employee-answers/**`, `Population/{m}/answers.events/**` |
| Referrals & approvals (`referralsApprovals`) | yes | `2-samples/{m}/2-employees/*.requests.json`, `2-samples/{m}/3-approvals/**` | `Population/{m}/approvals/**` |
| Population settings (`populationSettings`) | no | `1-population/config.json`, `1-population/certscan.global.json` (any file directly in the population root) | `Population/*.json` |
| Templates (`templates`) | no | `6-templates/**` | `templates/**` |
| Users & permissions (`usersPermissions`) | no | `3-user-data/**` | — |
| Report designs (`reportDesigns`) | no | `4-reports/**` | — |
| Feedback (`feedback`) | no | `5-system/feedback/**` | `.system/feedback/**`, root `feedback/**` |
| System settings (`systemSettings`) | no | `5-system/**` except the rows below | `.system/**` likewise |
| **Never restored selectively** | — | `5-system/{backups,audit,locks,system-errors}/**`, `5-system/restore.inprogress.json`, any other root, `2-samples/*.json`, `2-samples/{m}/*.json`, `2-samples/{m}/{unknown}/**`, unknown files in `2-employees/` | `.system/` likewise |

`{m}` is any direct child folder of the population or samples root, including ad-hoc import stores (`2-samples/adhoc-*`). The full restore (no scope) is unaffected by this table.

---

## Task 1: Element catalog and path classifier

**Files:**
- Create: `src/data/backup/restoreScope.ts`
- Create: `src/data/backup/restoreScope.test.ts`
- Modify: `src/data/workspace/workspacePaths.ts` (after the `LEGACY_WORKSPACE_ROOTS` block, ~line 128–132)
- Modify: `src/data/answers/answerStorage.ts` (workspacePaths import ~lines 60–65; `ANSWERS_FOLDER` ~line 69; suffix constants ~lines 97–98)
- Modify: `src/data/sampling/sampleStorage.ts` (import line 9; `getLegacySampleDir` ~line 27)
- Modify: `src/data/population/populationStorage.ts` (workspacePaths import ~lines 40–45; `resolveSampleDir` ~line 634)
- Modify: `src/data/approvals/approvalStorage.ts` (import line 15; `getLegacyApprovalsDir` ~line 53)
- Modify: `src/data/backup/backupStorage.ts` (workspacePaths import lines 37–45; `loadMonthJson` legacy folder ~lines 1343–1348)
- Modify: `src/data/population/populationAggregate.ts` (line 39 and its two uses)
- Modify: `src/data/population/replacementIndexStorage.ts` (line 29)
- Modify: `src/data/labels/labelsStore.ts` (after `archive_integrity_show_more`)

**Interfaces:**
- Consumes: `WORKSPACE_ROOTS`, `LEGACY_WORKSPACE_ROOTS`, `SAMPLE_SUBFOLDERS`, `SYSTEM_FOLDER_NAMES` (workspacePaths); `ANSWER_EVENTS_DIR` (`answers/answerEventStore`); `DISTRIBUTION_EVENTS_DIR` (`distribution/distributionEventStore`); `DISTRIBUTION_CHECKPOINT_FILE` (`distribution/distributionStorage`); `EMPLOYEE_MIRROR_SUFFIX`, `EMPLOYEE_MIRROR_INDEX_FILE` (`samples/sampleMirrorStorage`); `RESTORE_INPROGRESS_FILE` (`backup/restoreSentinel`); `LabelKey` (labelsStore).
- Produces:
  - `export const LEGACY_MONTH_SUBFOLDERS: { raw: "raw"; processed: "processed"; sample: "sample"; employeeAnswers: "employee-answers"; approvals: "approvals" }` (workspacePaths)
  - `export const ANSWERS_SUFFIX = ".answers.json"`, `export const REQUESTS_SUFFIX = ".requests.json"` (answerStorage)
  - `export const POPULATION_AGGREGATE_FILE = "population.aggregate.json"` (populationAggregate)
  - `export const REPLACEMENT_INDEX_FOLDER = "replacement-index"` (replacementIndexStorage)
  - From `restoreScope.ts`:
    - `export const RESTORE_ELEMENT_IDS: readonly ["population","sampleDistribution","answers","referralsApprovals","populationSettings","templates","usersPermissions","reportDesigns","feedback","systemSettings"]`
    - `export type RestoreElementId`
    - `export type RestoreScope = { elements: RestoreElementId[]; months: string[] }`
    - `export type RestoreElementDefinition = { id: RestoreElementId; labelKey: LabelKey; monthScoped: boolean }`
    - `export const RESTORE_ELEMENTS: readonly RestoreElementDefinition[]`
    - `export function isMonthScopedElement(id: RestoreElementId): boolean`
    - `export function isRestoreElementId(value: string): value is RestoreElementId`
    - `export type BackupPathClass = { element: RestoreElementId; month: string | null; derived: boolean }`
    - `export function classifyBackupPath(relativePath: string): BackupPathClass | null`
    - `export function isFileInRestoreScope(relativePath: string, scope: RestoreScope): boolean`
    - `export function isDirectoryInRestoreScope(relativeDirPath: string, scope: RestoreScope): boolean`
    - `export type RestoreScopeProblem = "no-elements" | "unknown-element" | "no-months"`
    - `export function validateRestoreScope(scope: RestoreScope): RestoreScopeProblem | null`
    - `export type RestoreScopeCell = { element: RestoreElementId; month: string | null }`
    - `export function expandRestoreScope(scope: RestoreScope): RestoreScopeCell[]`
  - Label keys: `restore_element_population`, `restore_element_sample_distribution`, `restore_element_answers`, `restore_element_referrals_approvals`, `restore_element_population_settings`, `restore_element_templates`, `restore_element_users_permissions`, `restore_element_report_designs`, `restore_element_feedback`, `restore_element_system_settings`, `restore_scope_invalid`.

- [ ] **Step 1: Write the failing test** — create `src/data/backup/restoreScope.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getLabels } from "../labels/labelsStore";
import {
  classifyBackupPath,
  expandRestoreScope,
  isDirectoryInRestoreScope,
  isFileInRestoreScope,
  isMonthScopedElement,
  RESTORE_ELEMENT_IDS,
  RESTORE_ELEMENTS,
  validateRestoreScope,
  type BackupPathClass,
  type RestoreScope,
} from "./restoreScope";

const M1 = "5-may-2026";
const M2 = "6-june-2026";

function monthly(element: BackupPathClass["element"], month: string, derived = false): BackupPathClass {
  return { element, month, derived };
}

function wide(element: BackupPathClass["element"]): BackupPathClass {
  return { element, month: null, derived: false };
}

describe("RESTORE_ELEMENTS catalog", () => {
  it("lists every element id once, in catalog order, each with a non-empty Arabic label", () => {
    expect(RESTORE_ELEMENTS.map((element) => element.id)).toEqual([...RESTORE_ELEMENT_IDS]);
    const labels = getLabels();
    for (const element of RESTORE_ELEMENTS) {
      expect(labels[element.labelKey].trim().length).toBeGreaterThan(0);
    }
  });

  it("marks exactly the four per-month elements as month-scoped", () => {
    expect(RESTORE_ELEMENT_IDS.filter((id) => isMonthScopedElement(id))).toEqual([
      "population",
      "sampleDistribution",
      "answers",
      "referralsApprovals",
    ]);
  });
});

describe("classifyBackupPath — numbered layout", () => {
  const cases: Array<[string, BackupPathClass]> = [
    ["1-population/config.json", wide("populationSettings")],
    ["1-population/certscan.global.json", wide("populationSettings")],
    [`1-population/${M1}/month.manifest.json`, monthly("population", M1)],
    [`1-population/${M1}/1-raw/risk.raw.json`, monthly("population", M1)],
    [`1-population/${M1}/1-raw/risk.raw.2026-05-01T00-00-00.superseded.json`, monthly("population", M1)],
    [`1-population/${M1}/2-processed/population.final.json`, monthly("population", M1)],
    [`1-population/${M1}/2-processed/processing.summary.json`, monthly("population", M1)],
    [`1-population/${M1}/2-processed/population.aggregate.json`, monthly("population", M1, true)],
    [`1-population/${M1}/2-processed/replacement-index/index.manifest.json`, monthly("population", M1, true)],
    [`1-population/${M1}/2-processed/replacement-index/certscan.first.json`, monthly("population", M1, true)],
    [`2-samples/${M1}/1-main/sample.master.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/sampling.plan.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/distribution.log.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/distribution.events/evt-1.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/answers.events/devA-s1.ndjson`, monthly("answers", M1)],
    [`2-samples/${M1}/2-employees/employee01.answers.json`, monthly("answers", M1)],
    [`2-samples/${M1}/2-employees/employee01.requests.json`, monthly("referralsApprovals", M1)],
    [`2-samples/${M1}/2-employees/employee01.samples.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/2-employees/_index.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/3-approvals/sup01.decisions.json`, monthly("referralsApprovals", M1)],
    ["2-samples/adhoc-imp1/1-main/sample.master.json", monthly("sampleDistribution", "adhoc-imp1")],
    ["3-user-data/users.permissions.json", wide("usersPermissions")],
    ["3-user-data/labels.snapshot.json", wide("usersPermissions")],
    ["4-reports/designs/designs.index.json", wide("reportDesigns")],
    ["6-templates/templates.index.json", wide("templates")],
    ["5-system/feedback/threads/t1.json", wide("feedback")],
    ["5-system/feedback/threads.index.json", wide("feedback")],
    ["5-system/notifications/notifications.json", wide("systemSettings")],
    ["5-system/user-presets/admin-shared.browse-preset.json", wide("systemSettings")],
    ["5-system/adhoc-imports/adhoc-imports.index.json", wide("systemSettings")],
    ["5-system/workspace.schema.json", wide("systemSettings")],
  ];

  it.each(cases)("%s", (path, expected) => {
    expect(classifyBackupPath(path)).toEqual(expected);
  });
});

describe("classifyBackupPath — legacy and mixed layouts", () => {
  const cases: Array<[string, BackupPathClass]> = [
    ["Population/config.json", wide("populationSettings")],
    [`Population/${M1}/month.manifest.json`, monthly("population", M1)],
    [`Population/${M1}/raw/risk.raw.json`, monthly("population", M1)],
    [`Population/${M1}/processed/population.final.json`, monthly("population", M1)],
    [`Population/${M1}/population.final.json`, monthly("population", M1)],
    [`Population/${M1}/sample/sample.master.json`, monthly("sampleDistribution", M1)],
    [`Population/${M1}/sample.master.json`, monthly("sampleDistribution", M1)],
    [`Population/${M1}/distribution.log.json`, monthly("sampleDistribution", M1)],
    [`Population/${M1}/distribution.events/evt-1.json`, monthly("sampleDistribution", M1)],
    [`Population/${M1}/employee-answers/employee01.answers.json`, monthly("answers", M1)],
    [`Population/${M1}/approvals/sup01.decisions.json`, monthly("referralsApprovals", M1)],
    ["templates/templates.index.json", wide("templates")],
    [".system/notifications/notifications.json", wide("systemSettings")],
    [".system/feedback/messages.json", wide("feedback")],
    ["feedback/messages.json", wide("feedback")],
  ];

  it.each(cases)("%s", (path, expected) => {
    expect(classifyBackupPath(path)).toEqual(expected);
  });
});

describe("classifyBackupPath — never restored selectively", () => {
  it.each([
    "5-system/audit/actions/admin.actions.json",
    "5-system/audit/actions.log.json",
    "5-system/system-errors/admin.errors.json",
    "5-system/locks/some.lock.json",
    "5-system/backups/old/backup.manifest.json",
    ".system/audit/activity.log.json",
    "5-system/restore.inprogress.json",
    "top-level.json",
    "unknown-root/x.json",
    "2-samples/stray.json",
    `2-samples/${M1}/stray.json`,
    `2-samples/${M1}/9-other/x.json`,
    `2-samples/${M1}/2-employees/notes.json`,
  ])("%s → null", (path) => {
    expect(classifyBackupPath(path)).toBeNull();
  });
});

describe("isFileInRestoreScope", () => {
  const populationM1: RestoreScope = { elements: ["population"], months: [M1] };

  it("selects only the chosen element for the chosen month", () => {
    expect(isFileInRestoreScope(`1-population/${M1}/2-processed/population.final.json`, populationM1)).toBe(true);
    expect(isFileInRestoreScope(`Population/${M1}/processed/population.final.json`, populationM1)).toBe(true);
    expect(isFileInRestoreScope(`1-population/${M2}/2-processed/population.final.json`, populationM1)).toBe(false);
    expect(isFileInRestoreScope(`2-samples/${M1}/1-main/sample.master.json`, populationM1)).toBe(false);
    expect(isFileInRestoreScope("1-population/config.json", populationM1)).toBe(false);
  });

  it("never selects a derived population artifact", () => {
    expect(isFileInRestoreScope(`1-population/${M1}/2-processed/population.aggregate.json`, populationM1)).toBe(false);
    expect(
      isFileInRestoreScope(`1-population/${M1}/2-processed/replacement-index/index.manifest.json`, populationM1)
    ).toBe(false);
  });

  it("ignores months for a workspace-wide element", () => {
    const templates: RestoreScope = { elements: ["templates"], months: [] };
    expect(isFileInRestoreScope("6-templates/templates.index.json", templates)).toBe(true);
    expect(isFileInRestoreScope("templates/templates.index.json", templates)).toBe(true);
  });

  it("selects nothing month-scoped when no month is chosen", () => {
    expect(
      isFileInRestoreScope(`1-population/${M1}/2-processed/population.final.json`, { elements: ["population"], months: [] })
    ).toBe(false);
  });
});

describe("isDirectoryInRestoreScope", () => {
  it("prunes everything a population-only scope cannot reach", () => {
    const scope: RestoreScope = { elements: ["population"], months: [M1] };
    expect(isDirectoryInRestoreScope("1-population", scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`1-population/${M1}`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`1-population/${M1}/2-processed`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`1-population/${M2}`, scope)).toBe(false);
    expect(isDirectoryInRestoreScope(`1-population/${M1}/2-processed/replacement-index`, scope)).toBe(false);
    expect(isDirectoryInRestoreScope("2-samples", scope)).toBe(false);
    expect(isDirectoryInRestoreScope(`Population/${M1}/sample`, scope)).toBe(false);
    expect(isDirectoryInRestoreScope("6-templates", scope)).toBe(false);
    expect(isDirectoryInRestoreScope("5-system", scope)).toBe(false);
  });

  it("keeps the sample and answer folders for a sample + answers scope", () => {
    const scope: RestoreScope = { elements: ["sampleDistribution", "answers"], months: [M1] };
    expect(isDirectoryInRestoreScope("2-samples", scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`2-samples/${M1}/1-main`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`2-samples/${M1}/1-main/answers.events`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`2-samples/${M1}/2-employees`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`2-samples/${M1}/3-approvals`, scope)).toBe(false);
    expect(isDirectoryInRestoreScope(`Population/${M1}/sample`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`Population/${M1}/employee-answers`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`Population/${M1}/approvals`, scope)).toBe(false);
  });

  it("walks only the feedback subtree for a feedback scope", () => {
    const scope: RestoreScope = { elements: ["feedback"], months: [] };
    expect(isDirectoryInRestoreScope("5-system", scope)).toBe(true);
    expect(isDirectoryInRestoreScope("5-system/feedback", scope)).toBe(true);
    expect(isDirectoryInRestoreScope("5-system/feedback/threads", scope)).toBe(true);
    expect(isDirectoryInRestoreScope("5-system/audit", scope)).toBe(false);
    expect(isDirectoryInRestoreScope("5-system/notifications", scope)).toBe(false);
    expect(isDirectoryInRestoreScope("feedback", scope)).toBe(true);
    expect(isDirectoryInRestoreScope("1-population", scope)).toBe(false);
  });

  it("enters the population root but no month folder for a population-settings scope", () => {
    const scope: RestoreScope = { elements: ["populationSettings"], months: [] };
    expect(isDirectoryInRestoreScope("1-population", scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`1-population/${M1}`, scope)).toBe(false);
  });
});

describe("validateRestoreScope / expandRestoreScope", () => {
  it("names what is wrong with an unusable scope", () => {
    expect(validateRestoreScope({ elements: [], months: [M1] })).toBe("no-elements");
    expect(validateRestoreScope({ elements: ["population"], months: [] })).toBe("no-months");
    expect(
      validateRestoreScope({ elements: ["nope" as unknown as "population"], months: [M1] })
    ).toBe("unknown-element");
    expect(validateRestoreScope({ elements: ["templates"], months: [] })).toBeNull();
    expect(validateRestoreScope({ elements: ["population", "templates"], months: [M1] })).toBeNull();
  });

  it("expands a scope into catalog-ordered element × month cells", () => {
    expect(
      expandRestoreScope({ elements: ["templates", "answers", "population"], months: [M1, M2] })
    ).toEqual([
      { element: "population", month: M1 },
      { element: "population", month: M2 },
      { element: "answers", month: M1 },
      { element: "answers", month: M2 },
      { element: "templates", month: null },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/backup/restoreScope.test.ts`
Expected: FAIL — `Failed to resolve import "./restoreScope"` (the module does not exist yet).

- [ ] **Step 3: Add the shared constants the catalog consumes**

3a. `src/data/workspace/workspacePaths.ts` — replace:

```ts
export const LEGACY_WORKSPACE_ROOTS = {
  population: "Population",
  system: ".system",
  templates: "templates",
} as const;
```

with:

```ts
export const LEGACY_WORKSPACE_ROOTS = {
  population: "Population",
  system: ".system",
  templates: "templates",
} as const;

/**
 * Children of a LEGACY population month folder that predate the numbered
 * layout (`raw/`/`processed/` before `1-raw/`/`2-processed/`, and the
 * sample/answers/approvals folders from before `2-samples/{month}/` existed).
 * Read-only fallbacks — nothing new is ever written under these names. Named
 * once here so every legacy reader and the selective-restore catalog
 * (`backup/restoreScope.ts`) agree on them.
 */
export const LEGACY_MONTH_SUBFOLDERS = {
  raw: "raw",
  processed: "processed",
  sample: "sample",
  employeeAnswers: "employee-answers",
  approvals: "approvals",
} as const;
```

3b. `src/data/answers/answerStorage.ts` — in the import block from `"../workspace/workspacePaths"` (currently `getPopulationMonthDir, getSampleEmployeeDir, getSampleMainDir, safeWorkspaceFilePart`) add `LEGACY_MONTH_SUBFOLDERS` so it reads:

```ts
import {
  getPopulationMonthDir,
  getSampleEmployeeDir,
  getSampleMainDir,
  LEGACY_MONTH_SUBFOLDERS,
  safeWorkspaceFilePart,
} from "../workspace/workspacePaths";
```

Replace `const ANSWERS_FOLDER = "employee-answers";` with `const ANSWERS_FOLDER = LEGACY_MONTH_SUBFOLDERS.employeeAnswers;`.

Replace:

```ts
const ANSWERS_SUFFIX = ".answers.json";
const REQUESTS_SUFFIX = ".requests.json";
```

with:

```ts
/** Exported for the selective-restore catalog (`backup/restoreScope.ts`). */
export const ANSWERS_SUFFIX = ".answers.json";
/** Exported for the selective-restore catalog (`backup/restoreScope.ts`). */
export const REQUESTS_SUFFIX = ".requests.json";
```

3c. `src/data/sampling/sampleStorage.ts` — replace `import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";` with `import { getPopulationMonthDir, getSampleMainDir, LEGACY_MONTH_SUBFOLDERS } from "../workspace/workspacePaths";`, and in `getLegacySampleDir` replace `return monthDir.getDirectoryHandle("sample", { create: false });` with `return monthDir.getDirectoryHandle(LEGACY_MONTH_SUBFOLDERS.sample, { create: false });`.

3d. `src/data/population/populationStorage.ts` — in the import block from `"../workspace/workspacePaths"` (currently `getPopulationMonthDir, getPopulationRoot, getSampleMainDir, POPULATION_SUBFOLDERS`) add `LEGACY_MONTH_SUBFOLDERS`. In `resolveSampleDir` replace `return await monthDir.getDirectoryHandle("sample", { create: false });` with `return await monthDir.getDirectoryHandle(LEGACY_MONTH_SUBFOLDERS.sample, { create: false });`.

3e. `src/data/approvals/approvalStorage.ts` — replace `import { getPopulationMonthDir, getSampleApprovalsDir, safeWorkspaceFilePart } from "../workspace/workspacePaths";` with `import { getPopulationMonthDir, getSampleApprovalsDir, LEGACY_MONTH_SUBFOLDERS, safeWorkspaceFilePart } from "../workspace/workspacePaths";`, and in `getLegacyApprovalsDir` replace `return monthDir.getDirectoryHandle("approvals", { create: false });` with `return monthDir.getDirectoryHandle(LEGACY_MONTH_SUBFOLDERS.approvals, { create: false });`.

3f. `src/data/backup/backupStorage.ts` — in the import block from `"../workspace/workspacePaths"` add `LEGACY_MONTH_SUBFOLDERS` (alphabetically after `getTemplatesRoot`). In `loadMonthJson` replace:

```ts
  const legacyFolder =
    path[0] === POPULATION_SUBFOLDERS.raw
      ? "raw"
      : path[0] === POPULATION_SUBFOLDERS.processed
        ? "processed"
        : null;
```

with:

```ts
  const legacyFolder =
    path[0] === POPULATION_SUBFOLDERS.raw
      ? LEGACY_MONTH_SUBFOLDERS.raw
      : path[0] === POPULATION_SUBFOLDERS.processed
        ? LEGACY_MONTH_SUBFOLDERS.processed
        : null;
```

3g. `src/data/population/populationAggregate.ts` — replace `const AGGREGATE_FILE = "population.aggregate.json";` with:

```ts
/** Exported for the selective-restore catalog, which rebuilds rather than copies it. */
export const POPULATION_AGGREGATE_FILE = "population.aggregate.json";
```

and replace both remaining uses of `AGGREGATE_FILE` in that file (`safeWriteJson(processedDir, AGGREGATE_FILE, aggregate)` and `safeReadJson<PopulationAggregate>(processedDir, AGGREGATE_FILE)`) with `POPULATION_AGGREGATE_FILE`. Confirm with `grep -n "AGGREGATE_FILE" src/data/population/populationAggregate.ts` that only `POPULATION_AGGREGATE_FILE` remains.

3h. `src/data/population/replacementIndexStorage.ts` — replace `const REPLACEMENT_INDEX_FOLDER = "replacement-index";` with:

```ts
/** Exported for the selective-restore catalog, which rebuilds rather than copies it. */
export const REPLACEMENT_INDEX_FOLDER = "replacement-index";
```

3i. `src/data/labels/labelsStore.ts` — after the line `  archive_integrity_show_more:       "و{count} أخرى",` insert:

```ts

  // Selective backup restore (Workstream D) — element names + engine refusal.
  restore_element_population:            "المجتمع",
  restore_element_sample_distribution:   "العينة والتوزيع",
  restore_element_answers:               "الإجابات",
  restore_element_referrals_approvals:   "الإحالات والاعتمادات",
  restore_element_population_settings:   "إعدادات المجتمع",
  restore_element_templates:             "نماذج الفحص",
  restore_element_users_permissions:     "المستخدمون والصلاحيات",
  restore_element_report_designs:        "تصاميم التقارير",
  restore_element_feedback:              "الملاحظات",
  restore_element_system_settings:       "إعدادات النظام",
  restore_scope_invalid:                 "نطاق الاستعادة الانتقائية غير صالح: اختر عنصراً واحداً على الأقل، وشهراً واحداً على الأقل عند اختيار عناصر شهرية.",
```

- [ ] **Step 4: Write the catalog** — create `src/data/backup/restoreScope.ts`:

```ts
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
 * system-errors}/`, the `restore.inprogress.json` sentinel, and anything
 * outside the known roots. The full restore (no scope) never consults this.
 *
 * `derived: true` marks population artifacts a selective restore REBUILDS
 * rather than copies (the replacement-candidate index and the month
 * aggregate) — see selectiveRestore.ts.
 */
import type { LabelKey } from "../labels/labelsStore";
import { ANSWER_EVENTS_DIR } from "../answers/answerEventStore";
import { ANSWERS_SUFFIX, REQUESTS_SUFFIX } from "../answers/answerStorage";
import { DISTRIBUTION_EVENTS_DIR } from "../distribution/distributionEventStore";
import { DISTRIBUTION_CHECKPOINT_FILE } from "../distribution/distributionStorage";
import { POPULATION_AGGREGATE_FILE } from "../population/populationAggregate";
import { REPLACEMENT_INDEX_FOLDER } from "../population/replacementIndexStorage";
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
]);

/**
 * Sample/distribution FILE names that sat flat in a legacy month folder before
 * `2-samples/{month}/1-main/` existed. Listed only so a flat legacy copy is not
 * mistaken for population data; the owning modules keep their own names private.
 */
const LEGACY_FLAT_SAMPLE_FILES: ReadonlySet<string> = new Set([
  "sample.master.json",
  "sampling.plan.json",
  "sampling-proof.json",
  "main.samples.json",
  "distribution.log.json",
  "distribution.current.json",
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
  return workspaceWide("systemSettings");
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

function isSelected(element: RestoreElementId, month: string | null, scope: RestoreScope): boolean {
  if (!scope.elements.includes(element)) return false;
  if (!isMonthScopedElement(element)) return true;
  // A directory ABOVE the month level: reachable when any month is chosen.
  if (month === null) return scope.months.length > 0;
  return scope.months.includes(month);
}

export function isFileInRestoreScope(relativePath: string, scope: RestoreScope): boolean {
  const classified = classifyBackupPath(relativePath);
  if (!classified || classified.derived) return false;
  return isSelected(classified.element, classified.month, scope);
}

function candidatesUnderPopulationRoot(segments: readonly string[]): readonly RestoreElementId[] {
  if (segments.length === 1) return [...MONTH_SCOPED_IDS, "populationSettings"];
  if (segments.length === 2) return MONTH_SCOPED_IDS;
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/data/backup/restoreScope.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green. The legacy-literal replacements (3c–3f) must not change any existing test result.

- [ ] **Step 7: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (backup): selective-restore element catalog and path classifier"`
Fill in `Why:` (Workstream D needs one definition of which backup file belongs to which element × month, covering legacy layouts) and `What changed:` (new `restoreScope.ts`; `LEGACY_MONTH_SUBFOLDERS` replaces four inline legacy folder literals; three constants exported for the catalog; element labels). Add before/after snippets for 3b and 3f.

- [ ] **Step 8: Commit**

```bash
git add src/data/backup/restoreScope.ts src/data/backup/restoreScope.test.ts src/data/workspace/workspacePaths.ts src/data/answers/answerStorage.ts src/data/sampling/sampleStorage.ts src/data/population/populationStorage.ts src/data/approvals/approvalStorage.ts src/data/backup/backupStorage.ts src/data/population/populationAggregate.ts src/data/population/replacementIndexStorage.ts src/data/labels/labelsStore.ts "docs/edit logs/" package.json
git commit -m "$(cat <<'EOF'
Add (backup): selective-restore element catalog and path classifier

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
EOF
)"
```

---

## Task 2: Thread `scope` through the restore engine

**Files:**
- Create: `src/data/backup/selectiveRestoreTestKit.ts`
- Create: `src/data/backup/selectiveRestoreEngine.test.ts`
- Modify: `src/data/backup/backupStorage.ts` — imports (~line 17), `collectJsonRestoreEntries` (~lines 953–1014), `restoreJsonTree` (~lines 1164–1182), `restoreBackupSnapshot` (~lines 1778–1824)

**Interfaces:**
- Consumes (Task 1): `RestoreScope`, `isDirectoryInRestoreScope(relativeDirPath, scope)`, `isFileInRestoreScope(relativePath, scope)`, `validateRestoreScope(scope)`, label `restore_scope_invalid`.
- Produces:
  - `restoreBackupSnapshot(params: { directoryHandle: DirectoryHandleLike; months: MonthFolderInfo[]; backupFolderName: string; username: string; scope?: RestoreScope }): Promise<RestoreResult>` — unchanged when `scope` is absent.
  - Test kit (`selectiveRestoreTestKit.ts`): `TEST_BACKUP`, `M1`, `M2`, `makeRoot()`, `dirAt(base, segments)`, `writeJsonAt(base, path, value)`, `writeRawAt(base, path, text)`, `openDir(base, segments)`, `readJsonAt<T>(base, path)`, `readRawAt(base, path)`, `listNames(dir)`, `ndjson(events)`, `distEvent(id, xrayImageId?)`, `type SeedBackupOptions = { folderName?: string; complete?: boolean; createdAt?: string }`, `seedBackup(root, files, rawFiles?, options?)`, `backupFolderNames(root)`, `sentinelExists(root)`.

- [ ] **Step 1: Create the test kit** — `src/data/backup/selectiveRestoreTestKit.ts`:

```ts
/**
 * Test-only helpers for the selective-restore suites (Workstream D). Never
 * imported by app code. Builds hand-made backup folders directly under
 * `5-system/backups/{folder}/json/` with nested workspace-relative paths, so a
 * test controls the restore source exactly (the same idea as
 * backupStorage.test.ts's seedBackupJsonFiles, generalised to nested trees).
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import { RESTORE_INPROGRESS_FILE } from "./restoreSentinel";

export const TEST_BACKUP = "2026-05-31T10-00-00-manual-test";
export const M1 = "5-may-2026";
export const M2 = "6-june-2026";

/** The backup folder's workspace-mirror child — kept in step with backupStorage. */
const BACKUP_MIRROR_FOLDER = "json";

export function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: string }).name === "NotFoundError");
}

export async function dirAt(base: DirectoryHandleLike, segments: readonly string[]): Promise<DirectoryHandleLike> {
  let current = base;
  for (const segment of segments) current = await current.getDirectoryHandle(segment, { create: true });
  return current;
}

export async function writeJsonAt(base: DirectoryHandleLike, path: string, value: unknown): Promise<void> {
  const segments = path.split("/");
  const dir = await dirAt(base, segments.slice(0, -1));
  await safeWriteJson(dir, segments[segments.length - 1], value);
}

/** Raw bytes, no envelope — how NDJSON segments are written. */
export async function writeRawAt(base: DirectoryHandleLike, path: string, text: string): Promise<void> {
  const segments = path.split("/");
  const dir = await dirAt(base, segments.slice(0, -1));
  const handle = await dir.getFileHandle(segments[segments.length - 1], { create: true });
  if (!handle.createWritable) throw new Error(`test kit cannot write ${path}: no createWritable`);
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function openDir(
  base: DirectoryHandleLike,
  segments: readonly string[]
): Promise<DirectoryHandleLike | null> {
  let current = base;
  try {
    for (const segment of segments) current = await current.getDirectoryHandle(segment, { create: false });
    return current;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function readJsonAt<T>(base: DirectoryHandleLike, path: string): Promise<T | null> {
  const segments = path.split("/");
  const dir = await openDir(base, segments.slice(0, -1));
  if (!dir) return null;
  const result = await safeReadJson<T>(dir, segments[segments.length - 1]);
  return result.ok ? result.value : null;
}

export async function readRawAt(base: DirectoryHandleLike, path: string): Promise<string | null> {
  const segments = path.split("/");
  const dir = await openDir(base, segments.slice(0, -1));
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(segments[segments.length - 1], { create: false });
    return await (await handle.getFile()).text();
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function listNames(dir: DirectoryHandleLike): Promise<string[]> {
  const iterable = (dir as DirectoryHandleLike & { values: () => AsyncIterable<{ name: string }> }).values();
  const names: string[] = [];
  for await (const entry of iterable) names.push(entry.name);
  return names.sort();
}

export function ndjson(events: ReadonlyArray<Record<string, unknown>>): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

export function distEvent(id: string, xrayImageId = `XR-${id}`): Record<string, unknown> {
  return {
    eventId: id,
    eventType: "assigned",
    xrayImageId,
    assignedTo: "employee01",
    eventAt: "2026-05-01T08:00:00.000Z",
    eventBy: "admin",
  };
}

export type SeedBackupOptions = {
  folderName?: string;
  /** false = omit backup.complete.json (an interrupted backup). */
  complete?: boolean;
  createdAt?: string;
};

export async function seedBackup(
  root: DirectoryHandleLike,
  files: Record<string, unknown>,
  rawFiles: Record<string, string> = {},
  options: SeedBackupOptions = {}
): Promise<void> {
  const folderName = options.folderName ?? TEST_BACKUP;
  const createdAt = options.createdAt ?? "2026-05-31T10:00:00.000Z";
  const systemDir = await getSystemRoot(root, true);
  const backupDir = await dirAt(systemDir, [SYSTEM_FOLDER_NAMES.backups, folderName]);
  const mirrorDir = await dirAt(backupDir, [BACKUP_MIRROR_FOLDER]);
  for (const [path, value] of Object.entries(files)) await writeJsonAt(mirrorDir, path, value);
  for (const [path, text] of Object.entries(rawFiles)) await writeRawAt(mirrorDir, path, text);
  await safeWriteJson(backupDir, "backup.manifest.json", {
    createdAt,
    createdBy: "admin",
    mode: "manual",
    monthsFolders: [],
    jsonFilesBackedUp: [],
    xlsxFilesBackedUp: [],
    datasets: [],
    rowLimitPerWorkbookPart: 25_000,
    excelSheetRowLimit: 1_048_576,
  });
  if (options.complete === false) return;
  await safeWriteJson(backupDir, "backup.complete.json", { completedAt: createdAt });
}

export async function backupFolderNames(root: DirectoryHandleLike): Promise<string[]> {
  const systemDir = await getSystemRoot(root, false);
  return listNames(await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.backups, { create: false }));
}

export async function sentinelExists(root: DirectoryHandleLike): Promise<boolean> {
  const systemDir = await getSystemRoot(root, false);
  try {
    await systemDir.getFileHandle(RESTORE_INPROGRESS_FILE, { create: false });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
```

- [ ] **Step 2: Write the failing test** — `src/data/backup/selectiveRestoreEngine.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getLabels } from "../labels/labelsStore";
import { restoreBackupSnapshot } from "./backupStorage";
import type { RestoreScope } from "./restoreScope";
import {
  backupFolderNames,
  distEvent,
  M1,
  M2,
  makeRoot,
  ndjson,
  openDir,
  readJsonAt,
  readRawAt,
  seedBackup,
  sentinelExists,
  TEST_BACKUP,
  writeJsonAt,
  writeRawAt,
} from "./selectiveRestoreTestKit";

function restore(root: DirectoryHandleLike, scope?: RestoreScope) {
  return restoreBackupSnapshot({
    directoryHandle: root,
    months: [],
    backupFolderName: TEST_BACKUP,
    username: "admin",
    ...(scope ? { scope } : {}),
  });
}

/** Wrap a memory root so creating `fileName` anywhere below it throws. */
function failWritesOf(real: DirectoryHandleLike, fileName: string): DirectoryHandleLike {
  return {
    ...real,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (options?.create && name === fileName) throw new Error(`Simulated write failure for ${name}`);
      return real.getFileHandle(name, options);
    },
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
      failWritesOf(await real.getDirectoryHandle(name, options), fileName),
  };
}

describe("restoreBackupSnapshot — scope absent (full restore unchanged)", () => {
  it("restores every payload file, including ones no element owns", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`1-population/${M1}/2-processed/population.final.json`]: { rows: [{ xrayImageId: "A" }] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [{ xrayImageId: "A" }] },
      "5-system/audit/actions/admin.actions.json": { entries: [] },
      "unowned/extra.json": { value: 1 },
    });

    const result = await restore(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.restoredFiles].sort()).toEqual(
      [
        `1-population/${M1}/2-processed/population.final.json`,
        `2-samples/${M1}/1-main/sample.master.json`,
        "5-system/audit/actions/admin.actions.json",
        "unowned/extra.json",
      ].sort()
    );
  });
});

describe("restoreBackupSnapshot — scoped", () => {
  it("restores only the selected month's population files for a population-only scope", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`1-population/${M1}/month.manifest.json`]: { monthFolderName: M1, source: "backup" },
      [`1-population/${M1}/2-processed/population.final.json`]: { source: "backup", rows: [] },
      [`1-population/${M1}/2-processed/population.aggregate.json`]: { source: "backup" },
      [`1-population/${M1}/2-processed/replacement-index/index.manifest.json`]: { source: "backup" },
      [`1-population/${M2}/2-processed/population.final.json`]: { source: "backup", rows: [] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { source: "backup", rows: [] },
      "6-templates/templates.index.json": { source: "backup" },
    });
    for (const path of [
      `1-population/${M1}/2-processed/population.final.json`,
      `1-population/${M2}/2-processed/population.final.json`,
      `2-samples/${M1}/1-main/sample.master.json`,
      "6-templates/templates.index.json",
    ]) {
      await writeJsonAt(root, path, { source: "live", rows: [] });
    }

    const result = await restore(root, { elements: ["population"], months: [M1] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.restoredFiles].sort()).toEqual([
      `1-population/${M1}/2-processed/population.final.json`,
      `1-population/${M1}/month.manifest.json`,
    ]);
    type Tagged = { source: string };
    expect((await readJsonAt<Tagged>(root, `1-population/${M1}/2-processed/population.final.json`))?.source).toBe("backup");
    expect((await readJsonAt<Tagged>(root, `1-population/${M2}/2-processed/population.final.json`))?.source).toBe("live");
    expect((await readJsonAt<Tagged>(root, `2-samples/${M1}/1-main/sample.master.json`))?.source).toBe("live");
    expect((await readJsonAt<Tagged>(root, "6-templates/templates.index.json"))?.source).toBe("live");
    // Derived population artifacts are rebuilt later, never copied.
    expect(await readJsonAt(root, `1-population/${M1}/2-processed/population.aggregate.json`)).toBeNull();
    expect(await openDir(root, ["1-population", M1, "2-processed", "replacement-index"])).toBeNull();
  });

  it("does not create folders for elements the scope leaves out", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`1-population/${M1}/2-processed/population.final.json`]: { rows: [] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [] },
      "4-reports/designs/designs.index.json": { designs: [] },
    });

    const result = await restore(root, { elements: ["population"], months: [M1] });

    expect(result.ok).toBe(true);
    expect(await openDir(root, ["2-samples"])).toBeNull();
    expect(await openDir(root, ["4-reports"])).toBeNull();
  });

  it("still union-merges distribution event segments for a sample-only scope and leaves answers alone", async () => {
    const root = makeRoot();
    const segmentPath = `2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`;
    const answersPath = `2-samples/${M1}/1-main/answers.events/devA-s1.ndjson`;
    await seedBackup(root, {}, {
      [segmentPath]: ndjson([distEvent("e01"), distEvent("e02")]),
      [answersPath]: ndjson([{ eventId: "a01", eventType: "saved" }]),
    });
    await writeRawAt(root, segmentPath, ndjson([distEvent("e02"), distEvent("e03")]));

    const result = await restore(root, { elements: ["sampleDistribution"], months: [M1] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.restoredFiles).toEqual([segmentPath]);
    const ids = ((await readRawAt(root, segmentPath)) ?? "")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => (JSON.parse(line) as { eventId: string }).eventId);
    // Live order is the base; only the id the live segment lacked is appended.
    expect(ids).toEqual(["e02", "e03", "e01"]);
    expect(await readRawAt(root, answersPath)).toBeNull();
  });

  it("selects the unnumbered legacy month folder for a population scope", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`Population/${M1}/processed/population.final.json`]: { source: "backup", rows: [] },
      [`Population/${M1}/sample/sample.master.json`]: { source: "backup", rows: [] },
    });

    const result = await restore(root, { elements: ["population"], months: [M1] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.restoredFiles).toEqual([`Population/${M1}/processed/population.final.json`]);
    expect(await openDir(root, ["Population", M1, "sample"])).toBeNull();
  });

  it("refuses an unusable scope before any rollback backup or sentinel is written", async () => {
    const root = makeRoot();
    await seedBackup(root, { [`1-population/${M1}/2-processed/population.final.json`]: { rows: [] } });

    const result = await restore(root, { elements: ["population"], months: [] });

    expect(result).toEqual({ ok: false, error: getLabels().restore_scope_invalid });
    expect(await backupFolderNames(root)).toEqual([TEST_BACKUP]);
    expect(await sentinelExists(root)).toBe(false);
  });

  it("creates the pre-restore rollback backup and clears the sentinel for a scoped restore", async () => {
    const root = makeRoot();
    await seedBackup(root, { "6-templates/templates.index.json": { source: "backup" } });

    const result = await restore(root, { elements: ["templates"], months: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rollbackFolderName).toContain("pre-restore");
    expect(await backupFolderNames(root)).toContain(result.rollbackFolderName);
    expect(await sentinelExists(root)).toBe(false);
  });

  it("leaves the sentinel behind when a scoped restore fails partway", async () => {
    const root = makeRoot();
    // Live has no population.final.json, so the rollback backup never touches
    // the failing name — only the restore walk does.
    await seedBackup(root, { [`1-population/${M1}/2-processed/population.final.json`]: { rows: [] } });

    const result = await restore(failWritesOf(root, "population.final.json"), {
      elements: ["population"],
      months: [M1],
    });

    expect(result.ok).toBe(false);
    expect(await sentinelExists(root)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/data/backup/selectiveRestoreEngine.test.ts`
Expected: FAIL — the five scope-specific tests ("restores only the selected month's population files…", "does not create folders…", "still union-merges…", "selects the unnumbered legacy…", "refuses an unusable scope…") fail because `scope` is ignored today; the full-restore, rollback and sentinel tests already pass.

- [ ] **Step 4: Implement** in `src/data/backup/backupStorage.ts`.

4a. Imports — after `import { RESTORE_INPROGRESS_FILE } from "./restoreSentinel";` add:

```ts
import {
  isDirectoryInRestoreScope,
  isFileInRestoreScope,
  validateRestoreScope,
  type RestoreScope,
} from "./restoreScope";
import { getLabels } from "../labels/labelsStore";
```

4b. `collectJsonRestoreEntries` signature — replace:

```ts
  /** Inherited from the `*.events/` directory's own NAME; null everywhere else. */
  eventsDirName: string | null;
}): Promise<{ pending: PendingJsonRestore[]; skippedPaths: string[] }> {
```

with:

```ts
  /** Inherited from the `*.events/` directory's own NAME; null everywhere else. */
  eventsDirName: string | null;
  /**
   * Workstream D: when non-null, only what the selective-restore catalog
   * (restoreScope.ts) places inside this scope is walked. A pruned directory is
   * never created on the target side. `null` is the full restore, unchanged.
   */
  scope: RestoreScope | null;
}): Promise<{ pending: PendingJsonRestore[]; skippedPaths: string[] }> {
```

4c. Directory branch — replace:

```ts
    if (entry.kind === "directory") {
      const relativePath = params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name;
      const sourceChild = await tryGetDirectory(params.sourceDir, entry.name);
```

with:

```ts
    if (entry.kind === "directory") {
      const relativePath = params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name;
      if (params.scope && !isDirectoryInRestoreScope(relativePath, params.scope)) continue;
      const sourceChild = await tryGetDirectory(params.sourceDir, entry.name);
```

4d. Recursive call — replace:

```ts
        cacheDir: isEventsDir ? params.targetDir : params.cacheDir,
        eventsDirName: isEventsDir ? entry.name : params.eventsDirName,
      });
```

with:

```ts
        cacheDir: isEventsDir ? params.targetDir : params.cacheDir,
        eventsDirName: isEventsDir ? entry.name : params.eventsDirName,
        scope: params.scope,
      });
```

4e. File branch — replace (this two-line text is unique to the restore walk):

```ts
    if (entry.kind !== "file" || !isSnapshotPayloadFile(entry.name)) continue;
    const action = restoreActionFor(entry.name);
```

with:

```ts
    if (entry.kind !== "file" || !isSnapshotPayloadFile(entry.name)) continue;
    const fileRelativePath = params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name;
    if (params.scope && !isFileInRestoreScope(fileRelativePath, params.scope)) continue;
    const action = restoreActionFor(entry.name);
```

4f. `restoreJsonTree` — replace:

```ts
  skipped: string[];
}): Promise<void> {
  const { pending, skippedPaths } = await collectJsonRestoreEntries({
    sourceDir: params.sourceDir,
    targetDir: params.targetDir,
    sourcePath: params.sourcePath,
    cacheDir: null,
    eventsDirName: null,
  });
```

with:

```ts
  skipped: string[];
  /** Workstream D — absent means the full restore, byte-for-byte unchanged. */
  scope?: RestoreScope;
}): Promise<void> {
  const { pending, skippedPaths } = await collectJsonRestoreEntries({
    sourceDir: params.sourceDir,
    targetDir: params.targetDir,
    sourcePath: params.sourcePath,
    cacheDir: null,
    eventsDirName: null,
    scope: params.scope ?? null,
  });
```

4g. `restoreBackupSnapshot` params — replace:

```ts
export async function restoreBackupSnapshot(params: {
  directoryHandle: DirectoryHandleLike;
  months: MonthFolderInfo[];
  backupFolderName: string;
  username: string;
}): Promise<RestoreResult> {
```

with:

```ts
export async function restoreBackupSnapshot(params: {
  directoryHandle: DirectoryHandleLike;
  months: MonthFolderInfo[];
  backupFolderName: string;
  username: string;
  /**
   * Workstream D selective restore: only these elements × months are put
   * back. Absent = the full restore, unchanged. The rollback backup is always
   * a FULL backup and the sentinel contract is identical either way.
   */
  scope?: RestoreScope;
}): Promise<RestoreResult> {
```

4h. Scope validation — replace:

```ts
      await assertBackupComplete(sourceBackupDir, params.backupFolderName);
      const jsonDir = await sourceBackupDir.getDirectoryHandle("json", { create: false });
```

with:

```ts
      await assertBackupComplete(sourceBackupDir, params.backupFolderName);
      // Workstream D: an unusable scope is refused BEFORE the rollback backup
      // and the sentinel — nothing has been touched, so there is nothing to
      // roll back and nothing to flag as interrupted.
      if (params.scope && validateRestoreScope(params.scope) !== null) {
        return { ok: false, error: getLabels().restore_scope_invalid };
      }
      const jsonDir = await sourceBackupDir.getDirectoryHandle("json", { create: false });
```

4i. Walk call — replace:

```ts
      await restoreJsonTree({
        sourceDir: jsonDir,
        targetDir: params.directoryHandle,
        sourcePath: "",
        restored,
        skipped,
      });
```

with:

```ts
      await restoreJsonTree({
        sourceDir: jsonDir,
        targetDir: params.directoryHandle,
        sourcePath: "",
        restored,
        skipped,
        scope: params.scope,
      });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/backup/selectiveRestoreEngine.test.ts src/data/backup/backupStorage.test.ts src/data/backup/backupSegments.test.ts src/data/backup/backupAnswersSegments.test.ts`
Expected: PASS — the new suite, and the existing full-restore suites unchanged.

- [ ] **Step 6: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 7: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (backup): optional restore scope for selective element x month restore"`
`Why:` owners need to restore one element or one month without rolling back the whole workspace. `What changed:` optional `scope` on `restoreBackupSnapshot` → `restoreJsonTree` → `collectJsonRestoreEntries`; out-of-scope directories are pruned before they are created; unusable scope refused before rollback/sentinel; full restore untouched. Include before/after for 4c and 4e.

- [ ] **Step 8: Commit**

```bash
git add src/data/backup/backupStorage.ts src/data/backup/selectiveRestoreTestKit.ts src/data/backup/selectiveRestoreEngine.test.ts "docs/edit logs/" package.json
git commit -m "$(cat <<'EOF'
Add (backup): optional restore scope for selective element x month restore

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
EOF
)"
```

---

## Task 3: Backup preview — file counts per element × month

**Files:**
- Create: `src/data/backup/selectiveRestore.ts`
- Create: `src/data/backup/selectiveRestorePreview.test.ts`
- Modify: `src/data/backup/backupStorage.ts` — constants (~line 68), `isSnapshotPayloadFile` (~line 462), `RestoreAction`/`restoreActionFor` (~lines 888–890), `copyAllJsonFiles` (~line 802), `restoreBackupSnapshot` (`"json"` literal), new `openCompleteBackupJsonDir` before `restoreBackupSnapshot`
- Modify: `src/data/backup/selectiveRestoreTestKit.ts` (use `BACKUP_JSON_FOLDER`)

**Interfaces:**
- Consumes (Task 1): `classifyBackupPath`, `RESTORE_ELEMENT_IDS`, `RestoreElementId`. From population: `parseMonthFolderName(name): MonthFolderInfo | null`. From storage: `listDirectoryEntries(dir): Promise<{ name: string; kind: "file" | "directory" }[]>`.
- Produces:
  - From `backupStorage.ts`: `export const BACKUP_JSON_FOLDER = "json"`; `export function isSnapshotPayloadFile(name: string): boolean`; `export type RestoreAction = "replace" | "merge-events" | "restore-if-absent" | "skip-derived"`; `export function restoreActionFor(fileName: string): RestoreAction`; `export async function openCompleteBackupJsonDir(directoryHandle: DirectoryHandleLike, backupFolderName: string): Promise<DirectoryHandleLike>` (throws the same Arabic "غير مكتملة" error as `assertBackupComplete`).
  - From `selectiveRestore.ts`:
    - `export type RestorePreviewCell = { element: RestoreElementId; month: string | null; fileCount: number }`
    - `export type RestorePreview = { backupFolderName: string; months: string[]; cells: RestorePreviewCell[]; unclassifiedCount: number }`
    - `export function compareMonthFolderNames(a: string, b: string): number`
    - `export async function previewSelectiveRestore(directoryHandle: DirectoryHandleLike, backupFolderName: string): Promise<RestorePreview>`
    - `export function countPreviewFiles(preview: RestorePreview, element: RestoreElementId, month: string | null): number`

- [ ] **Step 1: Write the failing test** — `src/data/backup/selectiveRestorePreview.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  compareMonthFolderNames,
  countPreviewFiles,
  previewSelectiveRestore,
} from "./selectiveRestore";
import { distEvent, M1, M2, makeRoot, ndjson, seedBackup, TEST_BACKUP } from "./selectiveRestoreTestKit";

describe("compareMonthFolderNames", () => {
  it("orders real months chronologically and anything else after them by name", () => {
    expect(["adhoc-b", "6-june-2026", "12-december-2025", "adhoc-a", "5-may-2026"].sort(compareMonthFolderNames)).toEqual([
      "12-december-2025",
      "5-may-2026",
      "6-june-2026",
      "adhoc-a",
      "adhoc-b",
    ]);
  });
});

describe("previewSelectiveRestore", () => {
  it("counts restorable files per element × month, leaving out derived and non-payload files", async () => {
    const root = makeRoot();
    await seedBackup(
      root,
      {
        "1-population/config.json": {},
        [`1-population/${M1}/month.manifest.json`]: {},
        [`1-population/${M1}/2-processed/population.final.json`]: { rows: [] },
        [`1-population/${M1}/2-processed/population.aggregate.json`]: {},
        [`1-population/${M1}/2-processed/replacement-index/index.manifest.json`]: {},
        [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [] },
        [`2-samples/${M1}/1-main/distribution.current.json`]: {},
        [`2-samples/${M1}/2-employees/employee01.answers.json`]: {},
        [`2-samples/${M1}/2-employees/employee01.requests.json`]: {},
        [`2-samples/${M1}/2-employees/employee01.samples.json`]: {},
        [`2-samples/${M1}/3-approvals/sup01.decisions.json`]: {},
        [`Population/${M2}/processed/population.final.json`]: { rows: [] },
        "2-samples/adhoc-imp1/1-main/sample.master.json": { rows: [] },
        "6-templates/templates.index.json": {},
        "3-user-data/users.permissions.json": {},
        "5-system/feedback/threads/t1.json": {},
        "5-system/notifications/notifications.json": {},
        "5-system/audit/actions/admin.actions.json": {},
      },
      {
        [`2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`]: ndjson([distEvent("e01")]),
        [`2-samples/${M1}/1-main/answers.events/devA-s1.ndjson`]: ndjson([{ eventId: "a01" }]),
        [`2-samples/${M1}/1-main/sample.master.json.bak`]: "{}",
      }
    );

    const preview = await previewSelectiveRestore(root, TEST_BACKUP);

    expect(preview.backupFolderName).toBe(TEST_BACKUP);
    expect(preview.months).toEqual([M1, M2, "adhoc-imp1"]);
    expect(countPreviewFiles(preview, "population", M1)).toBe(2);
    expect(countPreviewFiles(preview, "population", M2)).toBe(1);
    expect(countPreviewFiles(preview, "sampleDistribution", M1)).toBe(2);
    expect(countPreviewFiles(preview, "sampleDistribution", "adhoc-imp1")).toBe(1);
    expect(countPreviewFiles(preview, "answers", M1)).toBe(2);
    expect(countPreviewFiles(preview, "referralsApprovals", M1)).toBe(2);
    expect(countPreviewFiles(preview, "populationSettings", null)).toBe(1);
    expect(countPreviewFiles(preview, "templates", null)).toBe(1);
    expect(countPreviewFiles(preview, "usersPermissions", null)).toBe(1);
    expect(countPreviewFiles(preview, "feedback", null)).toBe(1);
    expect(countPreviewFiles(preview, "systemSettings", null)).toBe(1);
    expect(countPreviewFiles(preview, "reportDesigns", null)).toBe(0);
    expect(preview.unclassifiedCount).toBe(1);
  });

  it("refuses an interrupted backup exactly as the restore does", async () => {
    const root = makeRoot();
    await seedBackup(root, { "6-templates/templates.index.json": {} }, {}, { complete: false });

    await expect(previewSelectiveRestore(root, TEST_BACKUP)).rejects.toThrow(/غير مكتملة/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/backup/selectiveRestorePreview.test.ts`
Expected: FAIL — `Failed to resolve import "./selectiveRestore"`.

- [ ] **Step 3: Export the walk primitives from `backupStorage.ts`**

3a. After `const BACKUP_COMPLETE_FILE = "backup.complete.json";` add:

```ts
/** The backup-folder child holding the restorable mirror of the workspace tree. */
export const BACKUP_JSON_FOLDER = "json";
```

3b. Replace `const jsonDir = await ensureDir(backupDir, "json");` with `const jsonDir = await ensureDir(backupDir, BACKUP_JSON_FOLDER);`.

3c. Replace `const jsonDir = await sourceBackupDir.getDirectoryHandle("json", { create: false });` with `const jsonDir = await sourceBackupDir.getDirectoryHandle(BACKUP_JSON_FOLDER, { create: false });`.

3d. Replace `function isSnapshotPayloadFile(name: string): boolean {` with `export function isSnapshotPayloadFile(name: string): boolean {`.

3e. Replace:

```ts
type RestoreAction = "replace" | "merge-events" | "restore-if-absent" | "skip-derived";

function restoreActionFor(fileName: string): RestoreAction {
```

with:

```ts
export type RestoreAction = "replace" | "merge-events" | "restore-if-absent" | "skip-derived";

/** Exported for the selective-restore preview, which must count exactly what the walk would restore. */
export function restoreActionFor(fileName: string): RestoreAction {
```

3f. Immediately before `export async function restoreBackupSnapshot(params: {` insert:

```ts
/**
 * Open a backup's `json/` mirror for READING, refusing an unfinished backup
 * exactly as restoreBackupSnapshot does. Creates nothing (getBackupsDir is a
 * writer's helper and would). Used by the selective-restore preview and plan.
 */
export async function openCompleteBackupJsonDir(
  directoryHandle: DirectoryHandleLike,
  backupFolderName: string
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, false);
  const backupsDir = await systemDir.getDirectoryHandle(BACKUPS_FOLDER, { create: false });
  const backupDir = await backupsDir.getDirectoryHandle(backupFolderName, { create: false });
  await assertBackupComplete(backupDir, backupFolderName);
  return backupDir.getDirectoryHandle(BACKUP_JSON_FOLDER, { create: false });
}

```

3g. In `src/data/backup/selectiveRestoreTestKit.ts` replace:

```ts
/** The backup folder's workspace-mirror child — kept in step with backupStorage. */
const BACKUP_MIRROR_FOLDER = "json";
```

with nothing (delete both lines), add `import { BACKUP_JSON_FOLDER } from "./backupStorage";` to its imports, and replace `const mirrorDir = await dirAt(backupDir, [BACKUP_MIRROR_FOLDER]);` with `const mirrorDir = await dirAt(backupDir, [BACKUP_JSON_FOLDER]);`.

- [ ] **Step 4: Create `src/data/backup/selectiveRestore.ts`**

```ts
/**
 * Selective backup restore — preview, dependency plan and scoped run
 * (Workstream D, 2026-09-28). The element catalog lives in restoreScope.ts; the
 * copy walk is backupStorage.ts's restoreBackupSnapshot with a `scope`. This
 * module never copies a workspace file itself.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { parseMonthFolderName } from "../population/monthFolder";
import { isSnapshotPayloadFile, openCompleteBackupJsonDir, restoreActionFor } from "./backupStorage";
import { classifyBackupPath, RESTORE_ELEMENT_IDS, type RestoreElementId } from "./restoreScope";

export type RestorePreviewCell = {
  element: RestoreElementId;
  month: string | null;
  fileCount: number;
};

export type RestorePreview = {
  backupFolderName: string;
  /** Month folders the backup holds restorable month-scoped files for, oldest first. */
  months: string[];
  cells: RestorePreviewCell[];
  /** Payload files no element owns — only a FULL restore puts these back. */
  unclassifiedCount: number;
};

/** Real `{m}-{month}-{yyyy}` folders chronologically, then anything else (ad-hoc stores) by name. */
export function compareMonthFolderNames(a: string, b: string): number {
  const left = parseMonthFolderName(a);
  const right = parseMonthFolderName(b);
  if (left && right) return left.year - right.year || left.month - right.month;
  if (left) return -1;
  if (right) return 1;
  return a.localeCompare(b);
}

/** Every path the restore walk would act on: payload files that are not skip-derived. */
async function listRestorablePaths(dir: DirectoryHandleLike, prefix: string, out: string[]): Promise<void> {
  for (const entry of await listDirectoryEntries(dir)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await listRestorablePaths(await dir.getDirectoryHandle(entry.name, { create: false }), path, out);
      continue;
    }
    if (isSnapshotPayloadFile(entry.name) && restoreActionFor(entry.name) !== "skip-derived") out.push(path);
  }
}

const ELEMENT_ORDER: ReadonlyMap<RestoreElementId, number> = new Map(
  RESTORE_ELEMENT_IDS.map((id, index) => [id, index] as const)
);

/** Names only — no file is read. */
export async function previewSelectiveRestore(
  directoryHandle: DirectoryHandleLike,
  backupFolderName: string
): Promise<RestorePreview> {
  const jsonDir = await openCompleteBackupJsonDir(directoryHandle, backupFolderName);
  const paths: string[] = [];
  await listRestorablePaths(jsonDir, "", paths);

  const cells = new Map<string, RestorePreviewCell>();
  const months = new Set<string>();
  let unclassifiedCount = 0;
  for (const path of paths) {
    const classified = classifyBackupPath(path);
    if (!classified) {
      unclassifiedCount += 1;
      continue;
    }
    if (classified.derived) continue;
    const key = `${classified.element}|${classified.month ?? ""}`;
    const cell = cells.get(key) ?? { element: classified.element, month: classified.month, fileCount: 0 };
    cell.fileCount += 1;
    cells.set(key, cell);
    if (classified.month !== null) months.add(classified.month);
  }

  const orderedCells = [...cells.values()].sort(
    (a, b) =>
      (ELEMENT_ORDER.get(a.element) ?? 0) - (ELEMENT_ORDER.get(b.element) ?? 0) ||
      compareMonthFolderNames(a.month ?? "", b.month ?? "")
  );
  return {
    backupFolderName,
    months: [...months].sort(compareMonthFolderNames),
    cells: orderedCells,
    unclassifiedCount,
  };
}

export function countPreviewFiles(
  preview: RestorePreview,
  element: RestoreElementId,
  month: string | null
): number {
  return preview.cells.find((cell) => cell.element === element && cell.month === month)?.fileCount ?? 0;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/backup/selectiveRestorePreview.test.ts src/data/backup/selectiveRestoreEngine.test.ts src/data/backup/backupStorage.test.ts`
Expected: PASS.

- [ ] **Step 6: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 7: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (backup): selective-restore preview of files per element and month"`
`Why:` the admin must see what a selection would restore (and that a selection is empty) before confirming. `What changed:` new `selectiveRestore.ts` preview; `backupStorage.ts` exports the payload predicate, `restoreActionFor`, `BACKUP_JSON_FOLDER` and a read-only `openCompleteBackupJsonDir`. Snippets for 3e and 3f.

- [ ] **Step 8: Commit**

```bash
git add src/data/backup/backupStorage.ts src/data/backup/selectiveRestore.ts src/data/backup/selectiveRestorePreview.test.ts src/data/backup/selectiveRestoreTestKit.ts "docs/edit logs/" package.json
git commit -m "$(cat <<'EOF'
Add (backup): selective-restore preview of files per element and month

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
EOF
)"
```

---

## Task 4: Dependency plan — population coverage block, sample/answers warnings, empty selections

**Files:**
- Modify: `src/data/backup/selectiveRestore.ts` (replace the import block; append)
- Create: `src/data/backup/selectiveRestorePlan.test.ts`

**Interfaces:**
- Consumes:
  - Task 1 `expandRestoreScope`, `validateRestoreScope`, `RestoreScope`, `RestoreScopeCell`, `RestoreScopeProblem`; Task 3 `previewSelectiveRestore`, `countPreviewFiles`, `RestorePreview`, `openCompleteBackupJsonDir`.
  - **Workstream A (Task 3 of its plan), `src/data/population/populationOverwriteGuard.ts`** — the A2 coverage rule, reused here rather than re-implemented:
    - `type PopulationOverwriteImpact = { sampleExists: boolean; liveSampledIds: string[]; distributionCount: number; answerCount: number }`
    - `type PopulationOverwriteAssessment = PopulationOverwriteImpact & { missingCount: number; missingExamples: string[]; blocked: boolean }` (`blocked` = the month has a distribution or any answer AND some live sampled id is missing from the new rows; `missingExamples` capped at 10, in sample order)
    - `loadPopulationOverwriteImpact(directoryHandle, monthFolderName): Promise<PopulationOverwriteImpact>` (throws when the live sample exists but cannot be read)
    - `assessPopulationOverwrite(impact, newRows: ReadonlyArray<Record<string, unknown>>): PopulationOverwriteAssessment`
  - `liveSampleRows(sample)` (`sampling/sampleStorage`); `safeReadJson` (`storage/safeWrite`); `isNotFoundError` (`storage/transientFileErrors`); `WORKSPACE_ROOTS`, `LEGACY_WORKSPACE_ROOTS`, `POPULATION_SUBFOLDERS`, `SAMPLE_SUBFOLDERS`, `LEGACY_MONTH_SUBFOLDERS` (workspacePaths).
- Produces:
  - `export type SelectiveRestoreSelection = RestoreScopeCell & { fileCount: number }`
  - `export type SelectiveRestoreBlock = { month: string; sampledCount: number; missingCount: number; missingExamples: string[] }`
  - `export type SelectiveRestoreWarning = { kind: "sample-without-answers" | "answers-without-sample"; month: string }`
  - `export type SelectiveRestorePlan = { scope: RestoreScope; invalidReason: RestoreScopeProblem | null; selections: SelectiveRestoreSelection[]; selectedFileCount: number; emptySelections: RestoreScopeCell[]; blocked: SelectiveRestoreBlock[]; warnings: SelectiveRestoreWarning[]; canConfirm: boolean }`
  - `export async function planSelectiveRestore(params: { directoryHandle: DirectoryHandleLike; backupFolderName: string; scope: RestoreScope; preview?: RestorePreview }): Promise<SelectiveRestorePlan>`
  - Module-private helpers reused by Task 7 in the same file: `readFirstInTree<T>`, `backupPopulationCandidates(month)`, `backupSampleCandidates(month)`.

- [ ] **Step 0: Confirm Workstream A's guard has landed**

Run: `grep -n "export async function loadPopulationOverwriteImpact\|export function assessPopulationOverwrite" src/data/population/populationOverwriteGuard.ts`
Expected: both lines print. If the file or either export is missing, stop and report `BLOCKED: Workstream A Task 3 (populationOverwriteGuard.ts) has not landed` — do not re-implement the rule here.

- [ ] **Step 1: Write the failing test** — `src/data/backup/selectiveRestorePlan.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { RestoreScope } from "./restoreScope";
import { planSelectiveRestore } from "./selectiveRestore";
import {
  distEvent,
  M1,
  makeRoot,
  ndjson,
  seedBackup,
  TEST_BACKUP,
  writeJsonAt,
  writeRawAt,
} from "./selectiveRestoreTestKit";

function plan(root: DirectoryHandleLike, scope: RestoreScope, backupFolderName = TEST_BACKUP) {
  return planSelectiveRestore({ directoryHandle: root, backupFolderName, scope });
}

async function seedLiveMonth(
  root: DirectoryHandleLike,
  options: { withDistribution: boolean; replacedRowIds?: string[] }
): Promise<void> {
  await writeJsonAt(root, `2-samples/${M1}/1-main/sample.master.json`, {
    rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }],
    ...(options.replacedRowIds ? { replacedRowIds: options.replacedRowIds } : {}),
  });
  if (options.withDistribution) {
    await writeRawAt(root, `2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`, ndjson([distEvent("e01", "A")]));
  }
}

const POP_M1 = `1-population/${M1}/2-processed/population.final.json`;

describe("planSelectiveRestore — population coverage (A2 rule)", () => {
  it("blocks a population restore that would orphan a live sampled id in a distributed month", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: true });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }] } });

    const result = await plan(root, { elements: ["population"], months: [M1] });

    expect(result.blocked).toEqual([{ month: M1, sampledCount: 2, missingCount: 1, missingExamples: ["B"] }]);
    expect(result.canConfirm).toBe(false);
  });

  it("allows it when the backup population is a superset of the live sample", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: true });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }, { xrayImageId: "C" }] } });

    const result = await plan(root, { elements: ["population"], months: [M1] });

    expect(result.blocked).toEqual([]);
    expect(result.canConfirm).toBe(true);
  });

  it("does not apply the rule to a month with no distribution and no answers", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: false });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }] } });

    const result = await plan(root, { elements: ["population"], months: [M1] });

    expect(result.blocked).toEqual([]);
    expect(result.canConfirm).toBe(true);
  });

  it("checks against the backup's own sample when Sample & distribution is restored in the same scope", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: true });
    await seedBackup(root, {
      [POP_M1]: { rows: [{ xrayImageId: "A" }] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [{ xrayImageId: "A" }] },
    });

    const result = await plan(root, { elements: ["population", "sampleDistribution"], months: [M1] });

    expect(result.blocked).toEqual([]);
  });

  it("treats replaced (retired) sample rows as not live", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: true, replacedRowIds: ["B"] });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }] } });

    const result = await plan(root, { elements: ["population"], months: [M1] });

    expect(result.blocked).toEqual([]);
  });
});

describe("planSelectiveRestore — selections and warnings", () => {
  it("reports a selected element the backup does not contain and disables confirm", async () => {
    const root = makeRoot();
    await seedBackup(root, { [POP_M1]: { rows: [] } });

    const result = await plan(root, { elements: ["population", "templates"], months: [M1] });

    expect(result.selections).toEqual([
      { element: "population", month: M1, fileCount: 1 },
      { element: "templates", month: null, fileCount: 0 },
    ]);
    expect(result.selectedFileCount).toBe(1);
    expect(result.emptySelections).toEqual([{ element: "templates", month: null }]);
    expect(result.canConfirm).toBe(false);
  });

  it("warns when Sample & distribution is restored without Answers, and vice versa", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [] },
      [`2-samples/${M1}/2-employees/employee01.answers.json`]: { items: [] },
    });

    const sampleOnly = await plan(root, { elements: ["sampleDistribution"], months: [M1] });
    expect(sampleOnly.warnings).toEqual([{ kind: "sample-without-answers", month: M1 }]);
    expect(sampleOnly.canConfirm).toBe(true);

    const answersOnly = await plan(root, { elements: ["answers"], months: [M1] });
    expect(answersOnly.warnings).toEqual([{ kind: "answers-without-sample", month: M1 }]);

    const both = await plan(root, { elements: ["sampleDistribution", "answers"], months: [M1] });
    expect(both.warnings).toEqual([]);
  });

  it("returns the scope problem without opening the backup for an unusable scope", async () => {
    const root = makeRoot();

    const result = await plan(root, { elements: [], months: [] }, "no-such-backup");

    expect(result.invalidReason).toBe("no-elements");
    expect(result.canConfirm).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/backup/selectiveRestorePlan.test.ts`
Expected: FAIL — `planSelectiveRestore is not a function` (not exported yet).

- [ ] **Step 3: Implement** in `src/data/backup/selectiveRestore.ts`.

3a. Replace the import statements at the top of the file (the block from `import type { DirectoryHandleLike } from "../storage/fileSystemAccess";` through the `./restoreScope` import) with:

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { safeReadJson } from "../storage/safeWrite";
import { isNotFoundError } from "../storage/transientFileErrors";
import { parseMonthFolderName } from "../population/monthFolder";
import type { PopulationFinalData } from "../population/monthTypes";
import { assessPopulationOverwrite, loadPopulationOverwriteImpact } from "../population/populationOverwriteGuard";
import { liveSampleRows } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import {
  LEGACY_MONTH_SUBFOLDERS,
  LEGACY_WORKSPACE_ROOTS,
  POPULATION_SUBFOLDERS,
  SAMPLE_SUBFOLDERS,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";
import { isSnapshotPayloadFile, openCompleteBackupJsonDir, restoreActionFor } from "./backupStorage";
import {
  classifyBackupPath,
  expandRestoreScope,
  RESTORE_ELEMENT_IDS,
  validateRestoreScope,
  type RestoreElementId,
  type RestoreScope,
  type RestoreScopeCell,
  type RestoreScopeProblem,
} from "./restoreScope";
```

3b. Append to the end of the file:

```ts
/* ───────────── reading single files out of a backup's json/ mirror ───────────── */

type TreeRead<T> = { state: "ok"; value: T } | { state: "missing" } | { state: "corrupt" };

async function readJsonInTree<T>(base: DirectoryHandleLike, segments: readonly string[]): Promise<TreeRead<T>> {
  let dir = base;
  try {
    for (const segment of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(segment, { create: false });
    const result = await safeReadJson<T>(dir, segments[segments.length - 1]);
    return result.ok ? { state: "ok", value: result.value } : { state: result.reason };
  } catch (error) {
    if (isNotFoundError(error)) return { state: "missing" };
    throw error;
  }
}

/** First candidate that exists wins — numbered layout first, then its legacy aliases. */
async function readFirstInTree<T>(
  base: DirectoryHandleLike,
  candidates: ReadonlyArray<readonly string[]>
): Promise<TreeRead<T>> {
  for (const candidate of candidates) {
    const read = await readJsonInTree<T>(base, candidate);
    if (read.state !== "missing") return read;
  }
  return { state: "missing" };
}

const POPULATION_ROOT_NAMES = [WORKSPACE_ROOTS.population, LEGACY_WORKSPACE_ROOTS.population] as const;

function backupPopulationCandidates(month: string): string[][] {
  return POPULATION_ROOT_NAMES.flatMap((root) => [
    [root, month, POPULATION_SUBFOLDERS.processed, "population.final.json"],
    [root, month, LEGACY_MONTH_SUBFOLDERS.processed, "population.final.json"],
    [root, month, "population.final.json"],
  ]);
}

function backupSampleCandidates(month: string): string[][] {
  return [
    [WORKSPACE_ROOTS.samples, month, SAMPLE_SUBFOLDERS.main, "sample.master.json"],
    ...POPULATION_ROOT_NAMES.flatMap((root) => [
      [root, month, LEGACY_MONTH_SUBFOLDERS.sample, "sample.master.json"],
      [root, month, "sample.master.json"],
    ]),
  ];
}

/* ───────────── the dependency plan ───────────── */

export type SelectiveRestoreSelection = RestoreScopeCell & { fileCount: number };

export type SelectiveRestoreBlock = {
  month: string;
  sampledCount: number;
  missingCount: number;
  missingExamples: string[];
};

export type SelectiveRestoreWarning = {
  kind: "sample-without-answers" | "answers-without-sample";
  month: string;
};

export type SelectiveRestorePlan = {
  scope: RestoreScope;
  invalidReason: RestoreScopeProblem | null;
  selections: SelectiveRestoreSelection[];
  selectedFileCount: number;
  /** Selected element × month cells the backup holds no file for. */
  emptySelections: RestoreScopeCell[];
  /** Months whose population restore would orphan live sampled ids (A2's rule). */
  blocked: SelectiveRestoreBlock[];
  warnings: SelectiveRestoreWarning[];
  canConfirm: boolean;
};

/**
 * The sampled ids that will be LIVE once the restore lands: the backup's own
 * sample when this restore also puts back Sample & distribution for the month
 * (and the backup has one), otherwise the live ones A2's impact already holds.
 */
async function sampledIdsAfterRestore(
  jsonDir: DirectoryHandleLike,
  month: string,
  restoresSample: boolean,
  liveSampledIds: string[]
): Promise<string[]> {
  if (!restoresSample) return liveSampledIds;
  const backupSample = await readFirstInTree<SampleMasterData>(jsonDir, backupSampleCandidates(month));
  return backupSample.state === "ok"
    ? liveSampleRows(backupSample.value).map((row) => row.xrayImageId)
    : liveSampledIds;
}

/**
 * A2's rule, through Workstream A's own guard: a population restore for a month
 * with a distribution or any answer is allowed only if every sampled id exists
 * in the backup's population. A corrupt backup population covers nothing.
 */
async function populationCoverageBlocks(
  directoryHandle: DirectoryHandleLike,
  backupFolderName: string,
  scope: RestoreScope
): Promise<SelectiveRestoreBlock[]> {
  if (!scope.elements.includes("population")) return [];
  const jsonDir = await openCompleteBackupJsonDir(directoryHandle, backupFolderName);
  const restoresSample = scope.elements.includes("sampleDistribution");
  const blocks: SelectiveRestoreBlock[] = [];
  for (const month of scope.months) {
    const backupPopulation = await readFirstInTree<PopulationFinalData>(jsonDir, backupPopulationCandidates(month));
    // No population.final.json in the backup: the live one is not replaced, so nothing can be orphaned.
    if (backupPopulation.state === "missing") continue;
    const impact = await loadPopulationOverwriteImpact(directoryHandle, month);
    const liveSampledIds = await sampledIdsAfterRestore(jsonDir, month, restoresSample, impact.liveSampledIds);
    const newRows =
      backupPopulation.state === "ok" && Array.isArray(backupPopulation.value.rows) ? backupPopulation.value.rows : [];
    const assessment = assessPopulationOverwrite({ ...impact, liveSampledIds }, newRows);
    if (assessment.blocked) {
      blocks.push({
        month,
        sampledCount: liveSampledIds.length,
        missingCount: assessment.missingCount,
        missingExamples: assessment.missingExamples,
      });
    }
  }
  return blocks;
}

function dependencyWarnings(scope: RestoreScope): SelectiveRestoreWarning[] {
  const hasSample = scope.elements.includes("sampleDistribution");
  const hasAnswers = scope.elements.includes("answers");
  if (hasSample === hasAnswers) return [];
  const kind = hasSample ? "sample-without-answers" : "answers-without-sample";
  return scope.months.map((month) => ({ kind, month }));
}

export async function planSelectiveRestore(params: {
  directoryHandle: DirectoryHandleLike;
  backupFolderName: string;
  scope: RestoreScope;
  /** Reuse an already-loaded preview of the SAME backup (the dialog's). */
  preview?: RestorePreview;
}): Promise<SelectiveRestorePlan> {
  const { scope } = params;
  const invalidReason = validateRestoreScope(scope);
  if (invalidReason) {
    return {
      scope,
      invalidReason,
      selections: [],
      selectedFileCount: 0,
      emptySelections: [],
      blocked: [],
      warnings: [],
      canConfirm: false,
    };
  }
  const preview =
    params.preview && params.preview.backupFolderName === params.backupFolderName
      ? params.preview
      : await previewSelectiveRestore(params.directoryHandle, params.backupFolderName);
  const selections = expandRestoreScope(scope).map((cell) => ({
    ...cell,
    fileCount: countPreviewFiles(preview, cell.element, cell.month),
  }));
  const emptySelections = selections
    .filter((selection) => selection.fileCount === 0)
    .map(({ element, month }) => ({ element, month }));
  const selectedFileCount = selections.reduce((sum, selection) => sum + selection.fileCount, 0);
  const blocked = await populationCoverageBlocks(params.directoryHandle, params.backupFolderName, scope);
  return {
    scope,
    invalidReason: null,
    selections,
    selectedFileCount,
    emptySelections,
    blocked,
    warnings: dependencyWarnings(scope),
    canConfirm: selectedFileCount > 0 && emptySelections.length === 0 && blocked.length === 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/backup/selectiveRestorePlan.test.ts src/data/backup/selectiveRestorePreview.test.ts`
Expected: PASS. If "does not apply the rule to a month with no distribution and no answers" fails, the cause is in Workstream A's `loadPopulationOverwriteImpact` counts (it must report `distributionCount: 0, answerCount: 0` for a month with no events and no answer items) — report it; do not weaken the test or bypass A's guard.

- [ ] **Step 5: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 6: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (backup): dependency plan for selective restore (A2 coverage block, warnings)"`
`Why:` restoring an old population under a live distribution silently orphans answers (spec A2/D). `What changed:` `planSelectiveRestore` computes per-selection file counts, empty selections, A2 coverage blocks through Workstream A's `populationOverwriteGuard` (the backup's own sample is used when it is restored together), and sample/answers warnings. Snippet of `populationCoverageBlocks`.

- [ ] **Step 7: Commit**

```bash
git add src/data/backup/selectiveRestore.ts src/data/backup/selectiveRestorePlan.test.ts "docs/edit logs/" package.json
git commit -m "$(cat <<'EOF'
Add (backup): dependency plan for selective restore (A2 coverage block, warnings)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
EOF
)"
```

---

## Task 5: Scoped run — rebuild derived caches and scan integrity

**Files:**
- Modify: `src/data/backup/selectiveRestore.ts` (replace the import block; append)
- Modify: `src/data/population/replacementIndexStorage.ts` (imports + new export after `loadReplacementIndexManifest`)
- Modify: `src/data/population/populationAggregate.ts` (imports + new export after `savePopulationAggregate`)
- Create: `src/data/backup/selectiveRestoreRun.test.ts`

**Interfaces:**
- Consumes:
  - Task 2 `restoreBackupSnapshot({ …, scope })`; Task 4 `planSelectiveRestore`, `SelectiveRestorePlan`; Task 1 `classifyBackupPath`, `isMonthScopedElement`.
  - **Workstream A (Task 8 of its plan), `src/data/population/populationRecovery.ts`:** `rebuildPopulationDerivedFiles(directoryHandle: DirectoryHandleLike, monthFolderName: string, processedDir: DirectoryHandleLike, rows: PreparedPopulationRow[], username: string): Promise<void>` — best-effort; rebuilds the replacement-candidate index keyed on `population.final.json`'s live envelope revision, and the month aggregate when `processing.summary.json` exists. A's plan exports it precisely so D routes its post-restore rebuild through it.
  - `readMonthPopulationFinal(dir, month): Promise<{ status: "loaded"; value: PopulationFinalData } | { status: "absent" } | { status: "unreadable" }>` (`populationStorage`); `invalidateMonthLockCache(month)` (`monthLock`); `invalidateDistributionCacheForFieldEdit(dir, month)`, `refreshDistributionCacheAfterWrite(dir, month, sampleRows)` (`distributionStorage`, both best-effort, never throw); `loadSampleMaster(dir, month)`; `runMonthIntegrityScan(dir, month): Promise<OrphanScanResult>` (`integrity/orphanScanLoader`); `getPopulationMonthDir`, `POPULATION_SUBFOLDERS` (workspacePaths); `safeRemoveJson` (`storage/safeWrite`).
- Produces:
  - `export async function discardReplacementIndexManifest(directoryHandle: DirectoryHandleLike, monthFolderName: string): Promise<void>` (replacementIndexStorage)
  - `export async function discardPopulationAggregate(directoryHandle: DirectoryHandleLike, monthFolderName: string): Promise<void>` (populationAggregate)
  - `export type SelectiveRestoreIntegrity = { month: string; result: OrphanScanResult | null; error: string | null }`
  - `export type SelectiveRestoreOutcome = { ok: true; restoredFiles: string[]; rollbackFolderName: string; integrity: SelectiveRestoreIntegrity[] } | { ok: false; reason: "plan-rejected"; plan: SelectiveRestorePlan } | { ok: false; reason: "restore-failed"; error: string }`
  - `export async function runSelectiveRestore(params: { directoryHandle: DirectoryHandleLike; months: MonthFolderInfo[]; backupFolderName: string; username: string; scope: RestoreScope }): Promise<SelectiveRestoreOutcome>`

**Why the two discard helpers exist even though A's rebuild is reused:** A's own restore writes the chosen population through `safeWriteJson`, which bumps the envelope revision, so its index rebuild always sees a NEWER revision. The backup engine writes through `safeWriteJsonText`, which keeps the backup's OLDER revision; `rebuildReplacementIndex`'s monotonic guard (`isRebuildRedundant`) would then keep the live, newer-revision index forever. Discarding the manifest first lets A's rebuild publish. The aggregate is discarded so a month whose backup has no `processing.summary.json` shows the explicit "missing aggregate" recovery prompt instead of the previous population's figures.

- [ ] **Step 0: Confirm Workstream A's recovery module has landed**

Run: `grep -n "export async function rebuildPopulationDerivedFiles" src/data/population/populationRecovery.ts`
Expected: one line. If missing, stop and report `BLOCKED: Workstream A Task 8 (populationRecovery.ts) has not landed`.

- [ ] **Step 1: Write the failing test** — `src/data/backup/selectiveRestoreRun.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadPopulationAggregate } from "../population/populationAggregate";
import { loadReplacementIndexManifest } from "../population/replacementIndexStorage";
import type { RestoreScope } from "./restoreScope";
import { runSelectiveRestore } from "./selectiveRestore";
import {
  backupFolderNames,
  distEvent,
  M1,
  makeRoot,
  ndjson,
  readJsonAt,
  seedBackup,
  TEST_BACKUP,
  writeJsonAt,
  writeRawAt,
} from "./selectiveRestoreTestKit";

const POP_M1 = `1-population/${M1}/2-processed/population.final.json`;
const PROCESSED_M1 = `1-population/${M1}/2-processed`;

function run(root: DirectoryHandleLike, scope: RestoreScope) {
  return runSelectiveRestore({ directoryHandle: root, months: [], backupFolderName: TEST_BACKUP, username: "admin", scope });
}

function populationRow(id: string): Record<string, unknown> {
  return { xrayImageId: id, certScanStatus: "NonCertscan", stage: "المرحلة الأولى", portName: "ميناء" };
}

async function seedStaleDerived(root: DirectoryHandleLike): Promise<void> {
  await writeJsonAt(root, `${PROCESSED_M1}/replacement-index/index.manifest.json`, {
    formatVersion: 1,
    monthFolderName: M1,
    sourceRevision: 999,
    stageMappingsHash: "stale",
    builtAt: "2026-06-01T00:00:00.000Z",
    builtBy: "stale",
    totalIndexedRows: 0,
    buckets: [],
  });
  await writeJsonAt(root, `${PROCESSED_M1}/population.aggregate.json`, {
    schemaVersion: 1,
    monthFolderName: M1,
    computedAt: "2026-06-01T00:00:00.000Z",
    computedBy: "stale",
    summary: {},
    previewRows: [],
  });
}

describe("runSelectiveRestore", () => {
  it("refuses a plan that cannot be confirmed and never creates a rollback backup", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `2-samples/${M1}/1-main/sample.master.json`, { rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }] });
    await writeRawAt(root, `2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`, ndjson([distEvent("e01", "A")]));
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }] } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("plan-rejected");
    expect(await backupFolderNames(root)).toEqual([TEST_BACKUP]);
  });

  it("rebuilds the replacement index and aggregate from the restored (older-revision) population", async () => {
    const root = makeRoot();
    // Live population is NEWER (revision 2) than the backup's (revision 1).
    await writeJsonAt(root, POP_M1, { rows: [populationRow("A")] });
    await writeJsonAt(root, POP_M1, { rows: [populationRow("A")] });
    await seedStaleDerived(root);
    await seedBackup(root, {
      [POP_M1]: { rows: [populationRow("A"), populationRow("C")] },
      [`${PROCESSED_M1}/processing.summary.json`]: {
        summary: { totalRows: 2 },
        removedRows: [],
        duplicateRows: [],
        invalidResultRows: [],
        savedAt: "2026-05-31T10:00:00.000Z",
      },
    });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    const manifest = await loadReplacementIndexManifest(root, M1);
    expect(manifest?.sourceRevision).toBe(1);
    expect(manifest?.totalIndexedRows).toBe(2);
    const aggregate = await loadPopulationAggregate(root, M1);
    expect(aggregate.status).toBe("ok");
    if (aggregate.status !== "ok") return;
    expect(aggregate.aggregate.computedBy).toBe("admin");
  });

  it("discards a stale aggregate when the restored month has no processing summary", async () => {
    const root = makeRoot();
    await writeJsonAt(root, POP_M1, { rows: [populationRow("A")] });
    await seedStaleDerived(root);
    await seedBackup(root, { [POP_M1]: { rows: [populationRow("A")] } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    expect((await loadPopulationAggregate(root, M1)).status).toBe("missing");
  });

  it("rebuilds distribution.current.json for a restored Sample & distribution month", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `2-samples/${M1}/1-main/distribution.current.json`, {
      monthFolderName: M1,
      entries: [{ xrayImageId: "STALE" }],
    });
    await seedBackup(
      root,
      { [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [{ xrayImageId: "XR-e01", portName: "ميناء" }] } },
      { [`2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`]: ndjson([distEvent("e01")]) }
    );

    // Sample & distribution only: selecting Answers too would be an EMPTY
    // selection (the backup holds none) and the plan would refuse to confirm.
    const outcome = await run(root, { elements: ["sampleDistribution"], months: [M1] });

    expect(outcome.ok).toBe(true);
    const current = await readJsonAt<{ entries: Array<{ xrayImageId: string }> }>(
      root,
      `2-samples/${M1}/1-main/distribution.current.json`
    );
    expect(current?.entries.map((entry) => entry.xrayImageId)).toEqual(["XR-e01"]);
  });

  it("runs the integrity scan for every selected month and reports it", async () => {
    const root = makeRoot();
    await seedBackup(root, { [POP_M1]: { rows: [populationRow("A")] } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.integrity).toHaveLength(1);
    expect(outcome.integrity[0]?.month).toBe(M1);
    expect(outcome.integrity[0]?.error).toBeNull();
    expect(outcome.integrity[0]?.result?.clean).toBe(true);
  });

  it("reports an interrupted backup as a failed run", async () => {
    const root = makeRoot();
    await seedBackup(root, { [POP_M1]: { rows: [] } }, {}, { complete: false });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== "restore-failed") return;
    expect(outcome.error).toMatch(/غير مكتملة/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/backup/selectiveRestoreRun.test.ts`
Expected: FAIL — `runSelectiveRestore is not a function`.

- [ ] **Step 3: Add the two discard helpers**

3a. `src/data/population/replacementIndexStorage.ts` — add to imports (skip either line if Workstream A already added it):

```ts
import { logError } from "../storage/errorLogger";
import { isNotFoundError } from "../storage/transientFileErrors";
```

and insert directly after the `loadReplacementIndexManifest` function:

```ts
/**
 * Drop the published manifest so the NEXT rebuild is not refused by the
 * monotonic guard. A selective backup restore (Workstream D) puts back an OLDER
 * population.final.json — a lower envelope revision — than the one the live
 * index was built from; `isRebuildRedundant` would then read the live manifest
 * as "a newer index already won" and keep the stale index forever. Without a
 * manifest the replacement flow uses its existing full-scan fallback until the
 * rebuild publishes a fresh one. Best-effort: never throws.
 */
export async function discardReplacementIndexManifest(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<void> {
  try {
    const dir = await getReplacementIndexDir(directoryHandle, monthFolderName, false);
    await safeRemoveJson(dir, MANIFEST_FILE);
  } catch (error) {
    if (!isNotFoundError(error)) logError("population:discard-replacement-index", error);
  }
}
```

3b. `src/data/population/populationAggregate.ts` — change `import { safeReadJson, safeWriteJson } from "../storage/safeWrite";` to `import { safeReadJson, safeRemoveJson, safeWriteJson } from "../storage/safeWrite";`, add `import { isNotFoundError } from "../storage/transientFileErrors";`, and insert directly after `savePopulationAggregate`:

```ts
/**
 * Remove a month's aggregate so the Population tab shows its explicit
 * "missing aggregate" recovery prompt instead of stale figures. Used by a
 * selective backup restore (Workstream D) before the rebuild, so a month whose
 * backup has no processing summary is not left showing the replaced
 * population's numbers. Best-effort: never throws.
 */
export async function discardPopulationAggregate(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<void> {
  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    await safeRemoveJson(processedDir, POPULATION_AGGREGATE_FILE);
  } catch (error) {
    if (!isNotFoundError(error)) logError("population:discard-aggregate", error);
  }
}
```

- [ ] **Step 4: Implement the run** in `src/data/backup/selectiveRestore.ts`.

4a. Replace the import statements at the top of the file (from `import type { DirectoryHandleLike } from "../storage/fileSystemAccess";` through the `./restoreScope` import) with:

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { safeReadJson } from "../storage/safeWrite";
import { isNotFoundError } from "../storage/transientFileErrors";
import { logError } from "../storage/errorLogger";
import {
  invalidateDistributionCacheForFieldEdit,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import type { OrphanScanResult } from "../integrity/orphanScan";
import { runMonthIntegrityScan } from "../integrity/orphanScanLoader";
import { parseMonthFolderName, type MonthFolderInfo } from "../population/monthFolder";
import { invalidateMonthLockCache } from "../population/monthLock";
import type { PopulationFinalData } from "../population/monthTypes";
import { discardPopulationAggregate } from "../population/populationAggregate";
import { assessPopulationOverwrite, loadPopulationOverwriteImpact } from "../population/populationOverwriteGuard";
import { rebuildPopulationDerivedFiles } from "../population/populationRecovery";
import { readMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { discardReplacementIndexManifest } from "../population/replacementIndexStorage";
import { liveSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import {
  getPopulationMonthDir,
  LEGACY_MONTH_SUBFOLDERS,
  LEGACY_WORKSPACE_ROOTS,
  POPULATION_SUBFOLDERS,
  SAMPLE_SUBFOLDERS,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";
import {
  isSnapshotPayloadFile,
  openCompleteBackupJsonDir,
  restoreActionFor,
  restoreBackupSnapshot,
} from "./backupStorage";
import {
  classifyBackupPath,
  expandRestoreScope,
  isMonthScopedElement,
  RESTORE_ELEMENT_IDS,
  validateRestoreScope,
  type RestoreElementId,
  type RestoreScope,
  type RestoreScopeCell,
  type RestoreScopeProblem,
} from "./restoreScope";
```

4b. Append to the end of the file:

```ts
/* ───────────── the scoped run ───────────── */

export type SelectiveRestoreIntegrity = {
  month: string;
  result: OrphanScanResult | null;
  error: string | null;
};

export type SelectiveRestoreOutcome =
  | { ok: true; restoredFiles: string[]; rollbackFolderName: string; integrity: SelectiveRestoreIntegrity[] }
  | { ok: false; reason: "plan-rejected"; plan: SelectiveRestorePlan }
  | { ok: false; reason: "restore-failed"; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Months the engine actually wrote files of `element` into — read off its own restoredFiles. */
function restoredMonthsFor(restoredFiles: readonly string[], element: RestoreElementId): Set<string> {
  const months = new Set<string>();
  for (const path of restoredFiles) {
    const classified = classifyBackupPath(path);
    if (classified && classified.element === element && classified.month !== null) months.add(classified.month);
  }
  return months;
}

/**
 * The replacement-candidate index and the month aggregate were deliberately
 * NOT copied (restoreScope marks them derived). Rebuild them through Workstream
 * A's `rebuildPopulationDerivedFiles` — the single post-restore rebuild A2
 * exported for D — after clearing what would block or mislead it (see Task 5's
 * note on the monotonic guard). Best-effort: the restored data is already on
 * disk, so a failure here is logged, never reported as a failed restore.
 */
async function rebuildPopulationDerived(
  directoryHandle: DirectoryHandleLike,
  month: string,
  username: string
): Promise<void> {
  // month.manifest.json (status/lock) may have come back with the population.
  invalidateMonthLockCache(month);
  await discardReplacementIndexManifest(directoryHandle, month);
  await discardPopulationAggregate(directoryHandle, month);
  try {
    const outcome = await readMonthPopulationFinal(directoryHandle, month);
    if (outcome.status !== "loaded") return;
    const monthDir = await getPopulationMonthDir(directoryHandle, month, false);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    await rebuildPopulationDerivedFiles(
      directoryHandle,
      month,
      processedDir,
      outcome.value.rows as unknown as PreparedPopulationRow[],
      username
    );
  } catch (error) {
    logError("backup:selective-rebuild-population", error);
  }
}

/** distribution.current.json + checkpoint + employee mirrors, refolded from the restored events. */
async function rebuildDistributionDerived(directoryHandle: DirectoryHandleLike, month: string): Promise<void> {
  try {
    await invalidateDistributionCacheForFieldEdit(directoryHandle, month);
    const sample = await loadSampleMaster(directoryHandle, month);
    await refreshDistributionCacheAfterWrite(directoryHandle, month, sample?.rows ?? []);
  } catch (error) {
    logError("backup:selective-rebuild-distribution", error);
  }
}

/**
 * Selective restore, end to end. Re-plans from disk first (never trusts the
 * dialog's earlier plan), then runs the SAME engine as a full restore with a
 * scope — assertBackupComplete, full pre-restore rollback backup, sentinel,
 * restoreActionFor semantics — then rebuilds derived caches for the months it
 * actually touched and runs the B3 integrity scan for every selected month.
 */
export async function runSelectiveRestore(params: {
  directoryHandle: DirectoryHandleLike;
  months: MonthFolderInfo[];
  backupFolderName: string;
  username: string;
  scope: RestoreScope;
}): Promise<SelectiveRestoreOutcome> {
  let plan: SelectiveRestorePlan;
  try {
    plan = await planSelectiveRestore({
      directoryHandle: params.directoryHandle,
      backupFolderName: params.backupFolderName,
      scope: params.scope,
    });
  } catch (error) {
    return { ok: false, reason: "restore-failed", error: errorText(error) };
  }
  if (!plan.canConfirm) return { ok: false, reason: "plan-rejected", plan };

  const result = await restoreBackupSnapshot({
    directoryHandle: params.directoryHandle,
    months: params.months,
    backupFolderName: params.backupFolderName,
    username: params.username,
    scope: params.scope,
  });
  if (!result.ok) return { ok: false, reason: "restore-failed", error: result.error };

  for (const month of restoredMonthsFor(result.restoredFiles, "population")) {
    await rebuildPopulationDerived(params.directoryHandle, month, params.username);
  }
  for (const month of restoredMonthsFor(result.restoredFiles, "sampleDistribution")) {
    await rebuildDistributionDerived(params.directoryHandle, month);
  }

  const integrity: SelectiveRestoreIntegrity[] = [];
  const scannedMonths = params.scope.elements.some((element) => isMonthScopedElement(element))
    ? params.scope.months
    : [];
  for (const month of scannedMonths) {
    try {
      integrity.push({ month, result: await runMonthIntegrityScan(params.directoryHandle, month), error: null });
    } catch (error) {
      integrity.push({ month, result: null, error: errorText(error) });
    }
  }

  return {
    ok: true,
    restoredFiles: result.restoredFiles,
    rollbackFolderName: result.rollbackFolderName,
    integrity,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/backup/selectiveRestoreRun.test.ts src/data/backup/selectiveRestorePlan.test.ts src/data/population/replacementIndexStorage.test.ts src/data/population/populationRecovery.test.ts`
Expected: PASS. If "rebuilds distribution.current.json…" fails, check whether `refreshDistributionCacheAfterWrite` persisted the cache (it logs, never throws — inspect `getRecentErrors()`) before touching the assertion.

- [ ] **Step 6: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 7: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (backup): run selective restore with derived-cache rebuild and integrity scan"`
`Why:` derived caches must follow restored data (spec: rebuilt, not copied) and the admin must see whether the restore left orphans. `What changed:` `runSelectiveRestore` (re-plan → scoped engine → A's `rebuildPopulationDerivedFiles` and the distribution refold for touched months → integrity scan); `discardReplacementIndexManifest` gets past the monotonic rebuild guard for an older restored revision; `discardPopulationAggregate`. Snippet of `rebuildPopulationDerived`.

- [ ] **Step 8: Commit**

```bash
git add src/data/backup/selectiveRestore.ts src/data/backup/selectiveRestoreRun.test.ts src/data/population/replacementIndexStorage.ts src/data/population/populationAggregate.ts "docs/edit logs/" package.json
git commit -m "$(cat <<'EOF'
Add (backup): run selective restore with derived-cache rebuild and integrity scan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
EOF
)"
```

---

## Task 6: Archive restore dialog — full / selective mode

**Files:**
- Create: `src/components/Sidebar/Tabs/Archive/selectiveRestoreText.ts`
- Create: `src/components/Sidebar/Tabs/Archive/SelectiveRestorePanel.tsx`
- Create: `src/components/Sidebar/Tabs/Archive/SelectiveRestore.test.tsx`
- Modify: `src/components/Sidebar/Tabs/Archive/index.tsx` — imports (lines 1–45), `fillTemplate` (~lines 72–75), `isSupervisorPlus` (~line 91), `handleRestore` (~lines 283–334), `<RestoreDialog …/>` usage (~lines 797–805), `RestoreDialog` (~line 945 to end of file)
- Modify: `src/components/Sidebar/Tabs/Archive/Archive.css` (append)
- Modify: `src/components/Sidebar/Tabs/Archive/index.test.tsx` (add one `vi.mock`)
- Modify: `src/data/labels/labelsStore.ts` (after `restore_scope_invalid`)

**Interfaces:**
- Consumes: Task 1 `RESTORE_ELEMENTS`, `RestoreElementId`, `RestoreScope`, `RestoreScopeCell`; Task 3 `previewSelectiveRestore`, `RestorePreview`; Task 4 `planSelectiveRestore`, `SelectiveRestorePlan`, `SelectiveRestoreBlock`, `SelectiveRestoreWarning`; Task 5 `runSelectiveRestore`, `SelectiveRestoreIntegrity`, `SelectiveRestoreOutcome`; `formatMonthFolderShortLabel` (`population/monthFolder`); `formatNumber` (`utils/formatting`); `useLabels` (`labels/useLabels`).
- Produces:
  - `selectiveRestoreText.ts`: `fillTemplate(template: string, vars: Record<string, string>): string`; `restoreElementLabel(labels: Labels, element: RestoreElementId): string`; `describeSelectionCount(labels: Labels, cell: RestoreScopeCell & { fileCount: number }): string`; `describeBlock(labels: Labels, block: SelectiveRestoreBlock): string`; `describeWarning(labels: Labels, warning: SelectiveRestoreWarning): string`; `describeIntegrity(labels: Labels, entry: SelectiveRestoreIntegrity): string`; `describeSelectiveRestoreSuccess(labels: Labels, params: { folderName: string; restoredCount: number; rollbackFolderName: string; integrity: SelectiveRestoreIntegrity[] }): string`.
  - `SelectiveRestorePanel.tsx`: `export type SelectiveRestoreSelection = { scope: RestoreScope; plan: SelectiveRestorePlan }`; default export `SelectiveRestorePanel(props: { directoryHandle: DirectoryHandleLike; backupFolderName: string; onSelectionChange: (selection: SelectiveRestoreSelection | null) => void })`.
  - `RestoreDialog` props gain `allowSelective: boolean`, `directoryHandle: DirectoryHandleLike | null`, and `onConfirm: (scope: RestoreScope | null) => void`.
  - Label keys listed in Step 3.

- [ ] **Step 1: Write the failing test** — `src/components/Sidebar/Tabs/Archive/SelectiveRestore.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// Workstream D — the Archive restore dialog's full/selective mode switch.
// Same mocking strategy as index.test.tsx: the data layer is mocked; auth and
// permissions are real and driven through a real session.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { clearSession, writeSession } from "../../../../auth/authSession";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { getLabels } from "../../../../data/labels/labelsStore";
import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import { formatNumber } from "../../../../utils/formatting";
import type { AutoBackupSettings, BackupHistoryItem } from "../../../../data/backup/backupStorage";
import type { RestorePreview, SelectiveRestorePlan } from "../../../../data/backup/selectiveRestore";
import { fillTemplate } from "./selectiveRestoreText";

const testDir: DirectoryHandleLike = createMemoryDirectory("archive-selective-root");

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: testDir, status: "ready" }),
}));

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({ refreshMonths: async () => {} }),
}));

vi.mock("../../../../data/backup/backupStorage", () => ({
  createBackup: vi.fn(),
  loadArchiveStatus: vi.fn(),
  loadAutoBackupSettings: vi.fn(),
  loadAutoBackupState: vi.fn(),
  loadBackupHistory: vi.fn(),
  restoreBackupSnapshot: vi.fn(),
  saveAutoBackupSettings: vi.fn(),
}));

vi.mock("../../../../data/backup/selectiveRestore", () => ({
  previewSelectiveRestore: vi.fn(),
  planSelectiveRestore: vi.fn(),
  runSelectiveRestore: vi.fn(),
}));

vi.mock("../../../../data/population/populationStorage", () => ({
  listMonthFolders: vi.fn(),
}));

vi.mock("../../../../data/population/monthLock", () => ({
  closeMonth: vi.fn(),
  reopenMonth: vi.fn(),
}));

vi.mock("../../../../data/audit/actionLog", () => ({
  appendWorkspaceAction: vi.fn(),
  recordAction: vi.fn(),
}));

vi.mock("../../../../data/integrity/orphanScanLoader", () => ({
  runMonthIntegrityScan: vi.fn(),
}));

vi.mock("../../../../data/workspace/dataRefreshSignal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/workspace/dataRefreshSignal")>();
  return { ...actual, broadcastDataRefresh: vi.fn() };
});

import ArchiveTab from "./index";
import { broadcastDataRefresh } from "../../../../data/workspace/dataRefreshSignal";
import {
  loadArchiveStatus,
  loadAutoBackupSettings,
  loadAutoBackupState,
  loadBackupHistory,
  restoreBackupSnapshot,
} from "../../../../data/backup/backupStorage";
import {
  planSelectiveRestore,
  previewSelectiveRestore,
  runSelectiveRestore,
} from "../../../../data/backup/selectiveRestore";
import { listMonthFolders } from "../../../../data/population/populationStorage";

const L = getLabels();
const FOLDER = "2026-05-20T09-00-00-manual-sel1";
const M1 = "5-may-2026";
const M1_LABEL = formatMonthFolderShortLabel(M1);

const SETTINGS: AutoBackupSettings = { frequency: "daily", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "system" };

const HISTORY_ITEM: BackupHistoryItem = {
  folderName: FOLDER,
  createdAt: "2026-05-20T09:00:00.000Z",
  createdBy: "admin",
  mode: "manual",
  monthsCount: 1,
  jsonFilesCount: 10,
  xlsxFilesCount: 0,
  totalRows: 120,
  status: "complete",
  failedFilesCount: 0,
};

const PREVIEW: RestorePreview = {
  backupFolderName: FOLDER,
  months: [M1],
  cells: [{ element: "population", month: M1, fileCount: 3 }],
  unclassifiedCount: 0,
};

function makePlan(overrides: Partial<SelectiveRestorePlan> = {}): SelectiveRestorePlan {
  return {
    scope: { elements: ["population"], months: [M1] },
    invalidReason: null,
    selections: [{ element: "population", month: M1, fileCount: 3 }],
    selectedFileCount: 3,
    emptySelections: [],
    blocked: [],
    warnings: [],
    canConfirm: true,
    ...overrides,
  };
}

function renderArchiveTab() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ArchiveTab />
    </QueryClientProvider>
  );
}

async function openSelectiveDialog(): Promise<HTMLElement> {
  writeSession({ role: "admin", username: "test-user", loginAt: new Date().toISOString() });
  renderArchiveTab();
  fireEvent.click(await screen.findByRole("button", { name: "استعادة" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("radio", { name: L.archive_restore_mode_selective }));
  await within(dialog).findByRole("checkbox", { name: L.restore_element_population });
  return dialog;
}

/** Month first, then element — so the only plan request carries both. */
function pickPopulationForM1(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByRole("checkbox", { name: M1_LABEL }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: L.restore_element_population }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadArchiveStatus).mockResolvedValue([]);
  vi.mocked(loadBackupHistory).mockResolvedValue([HISTORY_ITEM]);
  vi.mocked(loadAutoBackupState).mockResolvedValue(null);
  vi.mocked(loadAutoBackupSettings).mockResolvedValue(SETTINGS);
  vi.mocked(listMonthFolders).mockResolvedValue([]);
  vi.mocked(previewSelectiveRestore).mockResolvedValue(PREVIEW);
  vi.mocked(planSelectiveRestore).mockResolvedValue(makePlan());
  vi.mocked(runSelectiveRestore).mockResolvedValue({
    ok: true,
    restoredFiles: ["a", "b", "c"],
    rollbackFolderName: "rollback-1",
    integrity: [
      {
        month: M1,
        result: { answersOrphans: [], approvalsOrphans: [], sampleOrphans: [], distributionOrphans: [], clean: true },
        error: null,
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  clearSession();
});

describe("Archive restore dialog — selective mode (Workstream D)", () => {
  it("offers an admin the full/selective switch, defaulting to a full restore", async () => {
    writeSession({ role: "admin", username: "test-user", loginAt: new Date().toISOString() });
    renderArchiveTab();
    fireEvent.click(await screen.findByRole("button", { name: "استعادة" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByRole("radio", { name: L.archive_restore_mode_full })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: L.archive_restore_mode_selective })).not.toBeChecked();
    expect(within(dialog).queryByRole("checkbox", { name: L.restore_element_population })).toBeNull();
    expect(vi.mocked(previewSelectiveRestore)).not.toHaveBeenCalled();
  });

  it("previews the backup, plans the chosen element × month and runs the scoped restore", async () => {
    const dialog = await openSelectiveDialog();
    expect(vi.mocked(previewSelectiveRestore)).toHaveBeenCalledWith(testDir, FOLDER);

    pickPopulationForM1(dialog);

    await waitFor(() => {
      expect(vi.mocked(planSelectiveRestore)).toHaveBeenLastCalledWith(
        expect.objectContaining({ backupFolderName: FOLDER, scope: { elements: ["population"], months: [M1] } })
      );
    });
    const row = fillTemplate(L.archive_restore_preview_row, {
      element: L.restore_element_population,
      month: M1_LABEL,
      count: formatNumber(3),
    });
    expect(await within(dialog).findByText(row)).toBeInTheDocument();

    const next = within(dialog).getByRole("button", { name: "متابعة التحقق" });
    expect(next).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    expect(next).not.toBeDisabled();
    fireEvent.click(next);

    fireEvent.change(within(dialog).getByPlaceholderText(FOLDER), { target: { value: FOLDER } });
    fireEvent.click(within(dialog).getByRole("button", { name: "استعادة الآن" }));

    await waitFor(() => {
      expect(vi.mocked(runSelectiveRestore)).toHaveBeenCalledWith(
        expect.objectContaining({
          backupFolderName: FOLDER,
          username: "test-user",
          scope: { elements: ["population"], months: [M1] },
        })
      );
    });
    expect(vi.mocked(restoreBackupSnapshot)).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(vi.mocked(broadcastDataRefresh)).toHaveBeenCalledWith("manual");
    });
    const integrityLine = fillTemplate(L.archive_restore_integrity_clean, { month: M1_LABEL });
    await waitFor(() => {
      expect(document.body.textContent).toContain(integrityLine);
    });
  });

  it("explains a blocked population restore and keeps continue disabled", async () => {
    vi.mocked(planSelectiveRestore).mockResolvedValue(
      makePlan({
        canConfirm: false,
        blocked: [{ month: M1, sampledCount: 40, missingCount: 2, missingExamples: ["X1", "X2"] }],
      })
    );
    const dialog = await openSelectiveDialog();
    pickPopulationForM1(dialog);

    const blocked = fillTemplate(L.archive_restore_blocked_population, {
      month: M1_LABEL,
      missing: formatNumber(2),
      sampled: formatNumber(40),
      examples: "X1، X2",
    });
    expect(await within(dialog).findByText(blocked)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    expect(within(dialog).getByRole("button", { name: "متابعة التحقق" })).toBeDisabled();
  });

  it("marks a selection the backup does not contain and keeps continue disabled", async () => {
    vi.mocked(planSelectiveRestore).mockResolvedValue(
      makePlan({
        canConfirm: false,
        scope: { elements: ["templates"], months: [] },
        selections: [{ element: "templates", month: null, fileCount: 0 }],
        selectedFileCount: 0,
        emptySelections: [{ element: "templates", month: null }],
      })
    );
    const dialog = await openSelectiveDialog();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: L.restore_element_templates }));

    const missing = fillTemplate(L.archive_restore_not_present_workspace, { element: L.restore_element_templates });
    expect(await within(dialog).findByText(missing)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    expect(within(dialog).getByRole("button", { name: "متابعة التحقق" })).toBeDisabled();
  });

  it("keeps a failed selective restore's reason inside the dialog", async () => {
    vi.mocked(runSelectiveRestore).mockResolvedValue({ ok: false, reason: "restore-failed", error: "boom" });
    const dialog = await openSelectiveDialog();
    pickPopulationForM1(dialog);
    await within(dialog).findByText(
      fillTemplate(L.archive_restore_preview_row, { element: L.restore_element_population, month: M1_LABEL, count: formatNumber(3) })
    );
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /أفهم أن الاستعادة/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "متابعة التحقق" }));
    fireEvent.change(within(dialog).getByPlaceholderText(FOLDER), { target: { value: FOLDER } });
    fireEvent.click(within(dialog).getByRole("button", { name: "استعادة الآن" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveTextContent(`${L.archive_restore_failed_prefix}: boom`);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Archive/SelectiveRestore.test.tsx`
Expected: FAIL — `Failed to resolve import "./selectiveRestoreText"`.

- [ ] **Step 3: Labels** — in `src/data/labels/labelsStore.ts`, after the `restore_scope_invalid:` line added in Task 1, insert:

```ts
  // Archive restore dialog — selective mode (Workstream D).
  archive_restore_mode_label:                   "نوع الاستعادة",
  archive_restore_mode_full:                    "استعادة كاملة",
  archive_restore_mode_selective:               "استعادة انتقائية",
  archive_restore_selective_intro:              "اختر العناصر والأشهر المراد استعادتها فقط. تُطبَّق ضمانات الاستعادة الكاملة نفسها: نسخة رجوع كاملة قبل البدء وعلامة استعادة جارية.",
  archive_restore_elements_heading:             "العناصر",
  archive_restore_months_heading:               "الأشهر الموجودة في النسخة",
  archive_restore_months_none:                  "لا توجد بيانات شهرية في هذه النسخة.",
  archive_restore_preview_loading:              "جاري قراءة محتوى النسخة...",
  archive_restore_preview_error:                "تعذرت قراءة محتوى النسخة: {error}",
  archive_restore_preview_heading:              "الملفات التي ستُستعاد",
  archive_restore_preview_row:                  "{element} — {month}: {count} ملف",
  archive_restore_preview_row_workspace:        "{element}: {count} ملف",
  archive_restore_not_present:                  "{element} — {month}: غير موجود في هذه النسخة",
  archive_restore_not_present_workspace:        "{element}: غير موجود في هذه النسخة",
  archive_restore_blocked_population:           "لا يمكن استعادة المجتمع لشهر {month}: {missing} من أصل {sampled} معرّفاً في العينة غير موجودة في مجتمع النسخة (أمثلة: {examples}). الشهر يحتوي على توزيع أو إجابات، واستعادة هذا المجتمع ستفصلها عن بياناتها.",
  archive_restore_warning_sample_without_answers: "تنبيه: استعادة العينة والتوزيع لشهر {month} دون الإجابات قد تترك إجابات بلا سجل توزيع. سيُجرى فحص السلامة بعد الاستعادة.",
  archive_restore_warning_answers_without_sample: "تنبيه: استعادة الإجابات لشهر {month} دون العينة والتوزيع قد تترك إجابات بلا سجل توزيع. سيُجرى فحص السلامة بعد الاستعادة.",
  archive_restore_select_prompt:                "اختر عنصراً واحداً على الأقل، وشهراً واحداً على الأقل للعناصر الشهرية.",
  archive_restore_planning:                     "جاري التحقق من الاعتماديات...",
  archive_restore_selective_done:               "تمت الاستعادة الانتقائية من {folder} ({count} ملف). نسخة الرجوع: {rollback}.",
  archive_restore_integrity_clean:              "فحص السلامة لشهر {month}: لا توجد صفوف يتيمة.",
  archive_restore_integrity_orphans:            "فحص السلامة لشهر {month}: {count} صفاً يتيماً — راجع قسم فحص السلامة المرجعية.",
  archive_restore_integrity_failed:             "تعذر فحص السلامة لشهر {month}: {error}",
  archive_restore_plan_rejected:                "تغيّر محتوى النسخة أو بيانات الشهر منذ المعاينة، ولم يعد الاختيار صالحاً. أعد فتح نافذة الاستعادة.",
  archive_restore_failed_prefix:                "فشلت الاستعادة",
```

- [ ] **Step 4: Create `src/components/Sidebar/Tabs/Archive/selectiveRestoreText.ts`**

```ts
import type { Labels } from "../../../../data/labels/labelsStore";
import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import {
  RESTORE_ELEMENTS,
  type RestoreElementId,
  type RestoreScopeCell,
} from "../../../../data/backup/restoreScope";
import type {
  SelectiveRestoreBlock,
  SelectiveRestoreIntegrity,
  SelectiveRestoreWarning,
} from "../../../../data/backup/selectiveRestore";
import { formatNumber } from "../../../../utils/formatting";

/** {var}-placeholder interpolation for label templates (the Archive tab's one copy). */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? `{${key}}`);
}

export function restoreElementLabel(labels: Labels, element: RestoreElementId): string {
  const definition = RESTORE_ELEMENTS.find((item) => item.id === element);
  return definition ? labels[definition.labelKey] : element;
}

export function describeSelectionCount(
  labels: Labels,
  cell: RestoreScopeCell & { fileCount: number }
): string {
  const vars = {
    element: restoreElementLabel(labels, cell.element),
    month: cell.month ? formatMonthFolderShortLabel(cell.month) : "",
    count: formatNumber(cell.fileCount),
  };
  if (cell.fileCount === 0) {
    return fillTemplate(cell.month ? labels.archive_restore_not_present : labels.archive_restore_not_present_workspace, vars);
  }
  return fillTemplate(cell.month ? labels.archive_restore_preview_row : labels.archive_restore_preview_row_workspace, vars);
}

export function describeBlock(labels: Labels, block: SelectiveRestoreBlock): string {
  return fillTemplate(labels.archive_restore_blocked_population, {
    month: formatMonthFolderShortLabel(block.month),
    missing: formatNumber(block.missingCount),
    sampled: formatNumber(block.sampledCount),
    examples: block.missingExamples.join("، "),
  });
}

export function describeWarning(labels: Labels, warning: SelectiveRestoreWarning): string {
  const template =
    warning.kind === "sample-without-answers"
      ? labels.archive_restore_warning_sample_without_answers
      : labels.archive_restore_warning_answers_without_sample;
  return fillTemplate(template, { month: formatMonthFolderShortLabel(warning.month) });
}

export function describeIntegrity(labels: Labels, entry: SelectiveRestoreIntegrity): string {
  const month = formatMonthFolderShortLabel(entry.month);
  if (!entry.result) return fillTemplate(labels.archive_restore_integrity_failed, { month, error: entry.error ?? "" });
  if (entry.result.clean) return fillTemplate(labels.archive_restore_integrity_clean, { month });
  const { answersOrphans, approvalsOrphans, sampleOrphans, distributionOrphans } = entry.result;
  const count = answersOrphans.length + approvalsOrphans.length + sampleOrphans.length + distributionOrphans.length;
  return fillTemplate(labels.archive_restore_integrity_orphans, { month, count: formatNumber(count) });
}

export function describeSelectiveRestoreSuccess(
  labels: Labels,
  params: { folderName: string; restoredCount: number; rollbackFolderName: string; integrity: SelectiveRestoreIntegrity[] }
): string {
  const head = fillTemplate(labels.archive_restore_selective_done, {
    folder: params.folderName,
    count: formatNumber(params.restoredCount),
    rollback: params.rollbackFolderName,
  });
  return [head, ...params.integrity.map((entry) => describeIntegrity(labels, entry))].join(" ");
}
```

- [ ] **Step 5: Create `src/components/Sidebar/Tabs/Archive/SelectiveRestorePanel.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";

import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { useLabels } from "../../../../data/labels/useLabels";
import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import {
  RESTORE_ELEMENTS,
  type RestoreElementId,
  type RestoreScope,
} from "../../../../data/backup/restoreScope";
import {
  planSelectiveRestore,
  previewSelectiveRestore,
  type RestorePreview,
  type SelectiveRestorePlan,
} from "../../../../data/backup/selectiveRestore";
import { describeBlock, describeSelectionCount, describeWarning, fillTemplate } from "./selectiveRestoreText";

export type SelectiveRestoreSelection = { scope: RestoreScope; plan: SelectiveRestorePlan };

type SelectiveRestorePanelProps = {
  directoryHandle: DirectoryHandleLike;
  backupFolderName: string;
  /** Called with null while nothing confirmable is selected or a plan is still being computed. */
  onSelectionChange: (selection: SelectiveRestoreSelection | null) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function SelectiveRestorePanel({
  directoryHandle,
  backupFolderName,
  onSelectionChange,
}: SelectiveRestorePanelProps) {
  const labels = useLabels();
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [elements, setElements] = useState<RestoreElementId[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [plan, setPlan] = useState<SelectiveRestorePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  // Only the LATEST plan request may commit: a slow earlier plan must never
  // overwrite the answer for the admin's newer selection.
  const planTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    previewSelectiveRestore(directoryHandle, backupFolderName).then(
      (value) => {
        if (!cancelled) setPreview(value);
      },
      (error: unknown) => {
        if (!cancelled) setPreviewError(errorMessage(error));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [directoryHandle, backupFolderName]);

  function requestPlan(nextElements: RestoreElementId[], nextMonths: string[]): void {
    const token = ++planTokenRef.current;
    setPlan(null);
    setPlanError(null);
    onSelectionChange(null);
    if (!preview || nextElements.length === 0) {
      setIsPlanning(false);
      return;
    }
    const scope: RestoreScope = { elements: nextElements, months: nextMonths };
    setIsPlanning(true);
    planSelectiveRestore({ directoryHandle, backupFolderName, scope, preview }).then(
      (nextPlan) => {
        if (token !== planTokenRef.current) return;
        setIsPlanning(false);
        setPlan(nextPlan);
        onSelectionChange(nextPlan.canConfirm ? { scope, plan: nextPlan } : null);
      },
      (error: unknown) => {
        if (token !== planTokenRef.current) return;
        setIsPlanning(false);
        setPlanError(errorMessage(error));
      }
    );
  }

  function toggleElement(id: RestoreElementId): void {
    const next = elements.includes(id) ? elements.filter((item) => item !== id) : [...elements, id];
    setElements(next);
    requestPlan(next, months);
  }

  function toggleMonth(month: string): void {
    const next = months.includes(month) ? months.filter((item) => item !== month) : [...months, month];
    setMonths(next);
    requestPlan(elements, next);
  }

  if (previewError) {
    return (
      <div className="arc-modal-error" role="alert">
        {fillTemplate(labels.archive_restore_preview_error, { error: previewError })}
      </div>
    );
  }
  if (!preview) {
    return <p className="arc-restore-selective-status">{labels.archive_restore_preview_loading}</p>;
  }

  return (
    <div className="arc-restore-selective">
      <p className="arc-restore-selective-intro">{labels.archive_restore_selective_intro}</p>

      <fieldset className="arc-restore-fieldset">
        <legend>{labels.archive_restore_elements_heading}</legend>
        {RESTORE_ELEMENTS.map((definition) => (
          <label key={definition.id} className="arc-restore-option">
            <input
              type="checkbox"
              checked={elements.includes(definition.id)}
              onChange={() => toggleElement(definition.id)}
            />
            <span>{labels[definition.labelKey]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="arc-restore-fieldset">
        <legend>{labels.archive_restore_months_heading}</legend>
        {preview.months.length === 0 ? (
          <p className="arc-restore-selective-status">{labels.archive_restore_months_none}</p>
        ) : (
          preview.months.map((month) => (
            <label key={month} className="arc-restore-option">
              <input type="checkbox" checked={months.includes(month)} onChange={() => toggleMonth(month)} />
              <span>{formatMonthFolderShortLabel(month)}</span>
            </label>
          ))
        )}
      </fieldset>

      <div className="arc-restore-plan" aria-live="polite">
        {elements.length === 0 || plan?.invalidReason ? (
          <p className="arc-restore-selective-status">{labels.archive_restore_select_prompt}</p>
        ) : null}
        {isPlanning ? <p className="arc-restore-selective-status">{labels.archive_restore_planning}</p> : null}
        {planError ? (
          <div className="arc-modal-error" role="alert">
            {planError}
          </div>
        ) : null}
        {plan && !plan.invalidReason ? (
          <>
            <h4>{labels.archive_restore_preview_heading}</h4>
            <ul className="arc-restore-plan-list">
              {plan.selections.map((cell) => (
                <li key={`${cell.element}:${cell.month ?? ""}`} className={cell.fileCount === 0 ? "is-missing" : undefined}>
                  {describeSelectionCount(labels, cell)}
                </li>
              ))}
            </ul>
            {plan.blocked.map((block) => (
              <div key={`blocked:${block.month}`} className="arc-restore-warning is-danger">
                <p>{describeBlock(labels, block)}</p>
              </div>
            ))}
            {plan.warnings.map((warning) => (
              <div key={`${warning.kind}:${warning.month}`} className="arc-restore-warning">
                <p>{describeWarning(labels, warning)}</p>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire it into `src/components/Sidebar/Tabs/Archive/index.tsx`**

6a. Imports. Replace `import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";` with `import { formatMonthFolderShortLabel, type MonthFolderInfo } from "../../../../data/population/monthFolder";`. Replace `import { readJsonFile, type ReadJsonResult } from "../../../../data/storage/fileSystemAccess";` with `import { readJsonFile, type DirectoryHandleLike, type ReadJsonResult } from "../../../../data/storage/fileSystemAccess";`. After `import "./Archive.css";` add:

```ts
import type { RestoreScope } from "../../../../data/backup/restoreScope";
import { runSelectiveRestore } from "../../../../data/backup/selectiveRestore";
import SelectiveRestorePanel, { type SelectiveRestoreSelection } from "./SelectiveRestorePanel";
import { describeSelectiveRestoreSuccess, fillTemplate } from "./selectiveRestoreText";
```

6b. Remove the local helper (it now lives in `selectiveRestoreText.ts`; every existing `fillTemplate(...)` call in this file keeps working through the import):

```ts
/** {var}-placeholder interpolation — mirrors PhaseThreeSampling.tsx's local helper (no shared utility exists yet). */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? `{${key}}`);
}
```

6c. After

```ts
  const isSupervisorPlus =
    session?.role === "supervisor" || session?.role === "manager" || session?.role === "admin";
```

add:

```ts
  // Selective restore is admin-only (Workstream D), on top of canRestoreBackup.
  const isAdmin = session?.role === "admin";
```

6d. Replace the whole `handleRestore` function — from `  async function handleRestore(folderName: string): Promise<void> {` through its closing `  }` just before `  async function handleImportUsersLabels(): Promise<void> {` — with:

```ts
  async function applySelectiveRestore(
    folderName: string,
    scope: RestoreScope,
    months: MonthFolderInfo[]
  ): Promise<void> {
    if (!directoryHandle) return;
    const outcome = await runSelectiveRestore({ directoryHandle, months, backupFolderName: folderName, username, scope });
    if (!outcome.ok) {
      const reason = outcome.reason === "plan-rejected" ? getLabels().archive_restore_plan_rejected : outcome.error;
      const text = `${getLabels().archive_restore_failed_prefix}: ${reason}`;
      setMessage({ type: "error", text });
      setDialogError(text);
      return;
    }
    recordAction(directoryHandle, username, session?.role ?? "unknown", "backup-restored", {
      target: folderName,
      details: {
        rollbackFolderName: outcome.rollbackFolderName,
        selective: true,
        elements: scope.elements.join(","),
        months: scope.months.join(","),
        restoredFiles: outcome.restoredFiles.length,
      },
    });
    setRestoreTarget(null);
    // The users/labels import offer only makes sense when 3-user-data came back.
    setJustRestored(scope.elements.includes("usersPermissions"));
    setMessage({
      type: "ok",
      text: describeSelectiveRestoreSuccess(getLabels(), {
        folderName,
        restoredCount: outcome.restoredFiles.length,
        rollbackFolderName: outcome.rollbackFolderName,
        integrity: outcome.integrity,
      }),
    });
    await refresh();
    // Same reasoning as the full restore below: a restore bypasses every normal write path.
    broadcastDataRefresh("manual");
  }

  async function handleRestore(folderName: string, scope: RestoreScope | null): Promise<void> {
    if (!directoryHandle || !canRestoreBackup) return;
    // Re-checked here, not only by hiding the mode switch (canMutate at both boundaries).
    if (scope && !isAdmin) return;
    setIsBackingUp(true);
    setMessage(null);
    setDialogError(null);
    try {
      const months = await queryClient.fetchQuery(monthFoldersQueryOptions(directoryHandle));
      if (scope) {
        await applySelectiveRestore(folderName, scope, months);
        return;
      }
      const result = await restoreBackupSnapshot({
        directoryHandle,
        months,
        backupFolderName: folderName,
        username,
      });
      if (result.ok) {
        // `backup-restored` has been a declared WorkspaceActionType with no call
        // site since it was introduced — the single most consequential
        // operation in the app (it overwrites live months from a snapshot) left
        // no trace in the very log meant to record it.
        recordAction(directoryHandle, username, session?.role ?? "unknown", "backup-restored", {
          target: folderName,
          details: { rollbackFolderName: result.rollbackFolderName, months: months.length },
        });
        setRestoreTarget(null);
        setJustRestored(true);
        setMessage({
          type: "ok",
          text: `تمت الاستعادة من ${folderName}. تم إنشاء نسخة رجوع قبل الاستعادة: ${result.rollbackFolderName}`,
        });
        await refresh();
        // A restore overwrites live months directly on disk, bypassing every
        // normal write path (no writer bumps its epoch, no notifyLocalDataChange
        // fires) — so every OTHER mounted view (distribution, referrals,
        // answers, ...) would otherwise keep showing pre-restore state until
        // the next 45s sync tick, and even that tick's bounded-signature probe
        // is not guaranteed to catch every family a restore can touch (e.g.
        // answers.events, which has no persisted checkpoint of its own — see
        // backupStorage.ts's restore-scope comment). "manual" is the same
        // full-cache-discard signal the admin toolbar's refresh button sends,
        // which is the correct scope for the single most consequential
        // operation in the app.
        broadcastDataRefresh("manual");
      } else {
        // Item 1: see the matching comment in handleMonthLockConfirm — the
        // restore dialog also stays open on failure and sits under the same
        // modal backdrop, so the failure needs its own in-modal rendering.
        const text = `${getLabels().archive_restore_failed_prefix}: ${result.error}`;
        setMessage({ type: "error", text });
        setDialogError(text);
      }
    } finally {
      setIsBackingUp(false);
    }
  }
```

(The full-restore branch is the existing code verbatim except the failure text now comes from `archive_restore_failed_prefix`, whose value "فشلت الاستعادة" keeps the rendered string identical — the existing test asserting `"فشلت الاستعادة: …"` must still pass.)

6e. Replace:

```tsx
        <RestoreDialog
          target={restoreTarget}
          busy={isBackingUp}
          error={dialogError}
          onClose={() => setRestoreTarget(null)}
          onConfirm={() => { void handleRestore(restoreTarget.folderName); }}
        />
```

with:

```tsx
        <RestoreDialog
          target={restoreTarget}
          busy={isBackingUp}
          error={dialogError}
          allowSelective={isAdmin}
          directoryHandle={directoryHandle}
          onClose={() => setRestoreTarget(null)}
          onConfirm={(scope) => { void handleRestore(restoreTarget.folderName, scope); }}
        />
```

6f. Replace the whole `RestoreDialog` function — from `function RestoreDialog({` to the end of the file — with:

```tsx
function RestoreDialog({
  target,
  busy,
  error,
  allowSelective,
  directoryHandle,
  onClose,
  onConfirm,
}: {
  target: BackupHistoryItem;
  busy: boolean;
  error: string | null;
  /** Selective restore is admin-only (Workstream D). */
  allowSelective: boolean;
  directoryHandle: DirectoryHandleLike | null;
  onClose: () => void;
  onConfirm: (scope: RestoreScope | null) => void;
}) {
  const L = getLabels();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<"full" | "selective">("full");
  const [selection, setSelection] = useState<SelectiveRestoreSelection | null>(null);
  const [typedName, setTypedName] = useState("");
  const [checked, setChecked] = useState(false);
  const canChooseMode = allowSelective && directoryHandle !== null;
  const selective = canChooseMode && mode === "selective";
  const canContinue = checked && (!selective || selection !== null);
  const canRestore = typedName.trim() === target.folderName && !busy && (!selective || selection !== null);

  function chooseMode(next: "full" | "selective"): void {
    setMode(next);
    setSelection(null);
  }

  return (
    <ModalShell
      variant="arc"
      eyebrow="استعادة النسخة"
      title="استعادة نسخة احتياطية"
      onClose={onClose}
    >
      {error ? (
        <div className="arc-modal-error" role="alert">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <>
          {canChooseMode ? (
            <fieldset className="arc-restore-mode">
              <legend>{L.archive_restore_mode_label}</legend>
              <label className="arc-restore-option">
                <input
                  type="radio"
                  name="arc-restore-mode"
                  checked={mode === "full"}
                  onChange={() => chooseMode("full")}
                />
                <span>{L.archive_restore_mode_full}</span>
              </label>
              <label className="arc-restore-option">
                <input
                  type="radio"
                  name="arc-restore-mode"
                  checked={mode === "selective"}
                  onChange={() => chooseMode("selective")}
                />
                <span>{L.archive_restore_mode_selective}</span>
              </label>
            </fieldset>
          ) : null}
          <div className="arc-restore-warning">
            <strong>{target.folderName}</strong>
            <p>
              سيتم إنشاء نسخة رجوع من النظام الحالي أولاً، ثم استعادة ملفات JSON من النسخة المحددة.
              يمكنك الرجوع لاحقاً من نسخة الرجوع التي ستظهر في السجل باسم قبل الاستعادة.
            </p>
            <p>{L.backup_restore_merge_notice}</p>
          </div>
        </>
      ) : null}

      {/* Kept mounted (just hidden) across step 2 so "رجوع" returns to the same selection. */}
      {selective && directoryHandle ? (
        <div hidden={step !== 1}>
          <SelectiveRestorePanel
            directoryHandle={directoryHandle}
            backupFolderName={target.folderName}
            onSelectionChange={setSelection}
          />
        </div>
      ) : null}

      {step === 1 ? (
        <>
          <label className="arc-restore-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>أفهم أن الاستعادة ستستبدل ملفات النظام الحالية بالقيم الموجودة في هذه النسخة.</span>
          </label>
          <div className="arc-restore-actions">
            <button type="button" className="arc-btn-secondary" onClick={onClose}>إلغاء</button>
            <button
              type="button"
              className="arc-btn-primary"
              disabled={!canContinue}
              onClick={() => setStep(2)}
            >
              متابعة التحقق
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="arc-restore-warning is-danger">
            <p>للتأكيد النهائي، اكتب اسم مجلد النسخة كما هو:</p>
            <code>{target.folderName}</code>
          </div>
          <input
            className="arc-restore-input"
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            placeholder={target.folderName}
            dir="ltr"
            autoFocus
          />
          <div className="arc-restore-actions">
            <button type="button" className="arc-btn-secondary" onClick={() => setStep(1)} disabled={busy}>
              رجوع
            </button>
            <button
              type="button"
              className="arc-btn-primary arc-btn-danger"
              disabled={!canRestore}
              onClick={() => onConfirm(selective ? selection?.scope ?? null : null)}
            >
              {busy ? "جاري الاستعادة..." : "استعادة الآن"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
```

(The Arabic strings inside `RestoreDialog` above are pre-existing inline text carried over unchanged; every NEW string comes from a label key.)

6g. `src/components/Sidebar/Tabs/Archive/index.test.tsx` — directly after its `vi.mock("../../../../data/backup/backupStorage", …)` block, add:

```ts
vi.mock("../../../../data/backup/selectiveRestore", () => ({
  previewSelectiveRestore: vi.fn(),
  planSelectiveRestore: vi.fn(),
  runSelectiveRestore: vi.fn(),
}));
```

- [ ] **Step 7: Styles** — append to `src/components/Sidebar/Tabs/Archive/Archive.css` (CSS variables only; `check:hex-literals` rejects new hex colours):

```css
/* Workstream D — selective restore */
.arc-restore-mode,
.arc-restore-fieldset {
  margin: 0 18px 14px;
  padding: 10px 12px;
  border: 1px solid var(--c-border-2);
  border-radius: 8px;
}

.arc-restore-mode legend,
.arc-restore-fieldset legend {
  padding: 0 6px;
  color: var(--c-navy);
  font-size: 13px;
  font-weight: 850;
}

.arc-restore-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-block: 4px;
  margin-inline-end: 16px;
  color: var(--c-ink-2);
  font-size: 13px;
  font-weight: 700;
}

.arc-restore-selective-intro,
.arc-restore-selective-status {
  margin: 0 18px 12px;
  color: var(--c-ink-3);
  font-size: 13px;
  line-height: 1.7;
}

.arc-restore-plan h4 {
  margin: 0 18px 8px;
  color: var(--c-navy);
  font-size: 13px;
  font-weight: 850;
}

.arc-restore-plan-list {
  margin: 0 18px 12px;
  padding-inline-start: 18px;
  color: var(--c-ink-2);
  font-size: 13px;
  line-height: 1.8;
}

.arc-restore-plan-list li.is-missing {
  color: var(--c-danger);
  font-weight: 750;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/Archive/SelectiveRestore.test.tsx src/components/Sidebar/Tabs/Archive/index.test.tsx`
Expected: PASS — including every pre-existing Archive test (full mode still shows exactly one checkbox and the same failure text).

- [ ] **Step 9: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:hex-literals`
Expected: all green.

- [ ] **Step 10: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (archive): selective restore mode in the backup restore dialog"`
`Why:` item 10 — admins need to restore one element or month from the Archive tab. `What changed:` admin-only full/selective switch; `SelectiveRestorePanel` (preview, element/month pickers, plan rows, block/warning messages); `handleRestore` selective branch with audit details and integrity summary; `fillTemplate` moved to `selectiveRestoreText.ts`; labels + CSS. Snippets for 6d and 6f's `canContinue`/`onConfirm`.

- [ ] **Step 11: Commit**

```bash
git add src/components/Sidebar/Tabs/Archive/ src/data/labels/labelsStore.ts "docs/edit logs/" package.json
git commit -m "$(cat <<'EOF'
Add (archive): selective restore mode in the backup restore dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
EOF
)"
```

---

## Task 7: A2 hand-off — backup snapshots as «استعادة المجتمع السابق» candidates

Workstream A's plan (Task 8) ships `src/data/population/populationRecovery.ts` with candidates from the month's own `2-processed/` folder only (`source: "superseded" | "bak"`), states that "Workstream D adds `backup`", and deliberately writes no code that reads `5-system/backups/*`. Its Task 9 ships the admin UI `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx`. This task adds backup snapshots as `source: "backup"` candidates whose restore runs D's scoped engine with `{ elements: ["population"], months: [month] }` (spec: "A2 link"), and whose post-restore rebuild already goes through A's `rebuildPopulationDerivedFiles` (Task 5).

The listing/dispatch lives in D's module and the Settings component — **not** inside `populationRecovery.ts` — because D's module already imports `populationRecovery.ts` (Task 5); importing back the other way would create a module cycle.

**Files:**
- Modify: `src/data/population/populationRecovery.ts` (the `source` field of `PopulationRecoveryCandidate`)
- Modify: `src/data/backup/selectiveRestore.ts` (replace the import block; append)
- Create: `src/data/backup/selectiveRestorePopulationRecovery.test.ts`
- Modify: `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx`
- Modify: `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx`
- Modify: `src/data/labels/labelsStore.ts` (after `population_recovery_failed`)

**Interfaces:**
- Consumes:
  - Workstream A: `type PopulationRecoveryCandidate = { fileName: string; source: "superseded" | "bak"; rowCount: number; processedAt: string | null; coveredSampledIds: number; totalSampledIds: number }`, `listPopulationRecoveryCandidates(dir, month)`, `restorePopulationCandidate(dir, month, fileName, username): Promise<PopulationRestoreResult>` (`populationRecovery.ts`); `loadPopulationOverwriteImpact` (`populationOverwriteGuard.ts`); `PopulationRecoverySection` and its test; labels `population_recovery_*`.
  - D: Task 4 `readFirstInTree`, `backupPopulationCandidates`; Task 5 `runSelectiveRestore`, `SelectiveRestoreOutcome`; Task 3 `openCompleteBackupJsonDir`; `loadBackupHistory(dir): Promise<BackupHistoryItem[]>` (newest first); `listMonthFolders(dir): Promise<MonthFolderInfo[]>` (`populationStorage`); `broadcastDataRefresh("manual")` (`workspace/dataRefreshSignal`).
- Produces:
  - `PopulationRecoveryCandidate.source` becomes `"superseded" | "bak" | "backup"`; for `"backup"`, `fileName` is the backup folder name.
  - `export async function listBackupPopulationCandidates(directoryHandle: DirectoryHandleLike, month: string): Promise<PopulationRecoveryCandidate[]>`
  - `export async function restorePopulationMonthFromBackup(params: { directoryHandle: DirectoryHandleLike; backupFolderName: string; month: string; username: string }): Promise<SelectiveRestoreOutcome>`
  - Labels: `population_recovery_source_backup`, `population_recovery_backup_restored`, `population_recovery_backup_blocked`.

- [ ] **Step 0: Confirm Workstream A's recovery tool has landed**

Run:

```bash
grep -n "source: \"superseded\" | \"bak\"" src/data/population/populationRecovery.ts
grep -n "export function PopulationRecoverySection" src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx
```

Expected: one line each. If either is missing, stop and report `BLOCKED: Workstream A Tasks 8/9 (population recovery) have not landed`. If the shipped code differs textually from the snippets quoted below (A's implementer may have adjusted it), make the equivalent change and note the difference in the edit log.

- [ ] **Step 1: Write the failing data-layer test** — `src/data/backup/selectiveRestorePopulationRecovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { listBackupPopulationCandidates, restorePopulationMonthFromBackup } from "./selectiveRestore";
import { M1, M2, makeRoot, readJsonAt, seedBackup, TEST_BACKUP, writeJsonAt } from "./selectiveRestoreTestKit";

const POP_M1 = `1-population/${M1}/2-processed/population.final.json`;

describe("listBackupPopulationCandidates (A2 recovery tool)", () => {
  it("lists every complete backup holding the month's population, newest first, with sampled-id coverage", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `2-samples/${M1}/1-main/sample.master.json`, {
      rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }],
    });
    await seedBackup(root, { [POP_M1]: { processedAt: "2026-05-01T09:00:00.000Z", rows: [{ xrayImageId: "A" }] } }, {}, {
      folderName: "older",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }] } }, {}, {
      folderName: "newer",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    await seedBackup(root, { [`1-population/${M2}/2-processed/population.final.json`]: { rows: [] } }, {}, {
      folderName: "other-month",
      createdAt: "2026-06-02T00:00:00.000Z",
    });
    await seedBackup(root, { [POP_M1]: { rows: [] } }, {}, {
      folderName: "interrupted",
      createdAt: "2026-06-03T00:00:00.000Z",
      complete: false,
    });

    const candidates = await listBackupPopulationCandidates(root, M1);

    expect(candidates).toEqual([
      { fileName: "newer", source: "backup", rowCount: 2, processedAt: null, coveredSampledIds: 2, totalSampledIds: 2 },
      {
        fileName: "older",
        source: "backup",
        rowCount: 1,
        processedAt: "2026-05-01T09:00:00.000Z",
        coveredSampledIds: 1,
        totalSampledIds: 2,
      },
    ]);
  });
});

describe("restorePopulationMonthFromBackup (A2 recovery tool)", () => {
  it("restores only that month's population through the scoped engine", async () => {
    const root = makeRoot();
    await writeJsonAt(root, POP_M1, { source: "live", rows: [] });
    await writeJsonAt(root, `2-samples/${M1}/1-main/sample.master.json`, { source: "live", rows: [] });
    await seedBackup(root, {
      [POP_M1]: { source: "backup", rows: [] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { source: "backup", rows: [] },
    });

    const outcome = await restorePopulationMonthFromBackup({
      directoryHandle: root,
      backupFolderName: TEST_BACKUP,
      month: M1,
      username: "admin",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.restoredFiles.every((path) => path.startsWith(`1-population/${M1}/`))).toBe(true);
    expect(outcome.rollbackFolderName).toContain("pre-restore");
    expect((await readJsonAt<{ source: string }>(root, POP_M1))?.source).toBe("backup");
    expect((await readJsonAt<{ source: string }>(root, `2-samples/${M1}/1-main/sample.master.json`))?.source).toBe("live");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/backup/selectiveRestorePopulationRecovery.test.ts`
Expected: FAIL — `listBackupPopulationCandidates is not a function`.

- [ ] **Step 3: Extend A's candidate type** — in `src/data/population/populationRecovery.ts`, inside `export type PopulationRecoveryCandidate`, replace:

```ts
  /** Workstream D extends this with "backup". */
  source: "superseded" | "bak";
```

with:

```ts
  /**
   * "superseded" / "bak": a copy beside the live file (this module restores it).
   * "backup": a `5-system/backups/{folder}` snapshot — `fileName` is the backup
   * FOLDER name, listed and restored by Workstream D's scoped engine
   * (`backup/selectiveRestore.ts`), never by `restorePopulationCandidate`.
   */
  source: "superseded" | "bak" | "backup";
```

(`restorePopulationCandidate` needs no change: its `isCandidateName` check already refuses a backup folder name with `invalid-candidate`.)

- [ ] **Step 4: Implement in `src/data/backup/selectiveRestore.ts`**

4a. In the import block, replace `import { rebuildPopulationDerivedFiles } from "../population/populationRecovery";` with:

```ts
import { rebuildPopulationDerivedFiles, type PopulationRecoveryCandidate } from "../population/populationRecovery";
```

replace `import { readMonthPopulationFinal } from "../population/populationStorage";` with:

```ts
import { listMonthFolders, readMonthPopulationFinal } from "../population/populationStorage";
```

and replace the `./backupStorage` import with:

```ts
import {
  isSnapshotPayloadFile,
  loadBackupHistory,
  openCompleteBackupJsonDir,
  restoreActionFor,
  restoreBackupSnapshot,
} from "./backupStorage";
```

4b. Append to the end of the file:

```ts
/* ───────────── A2 hand-off: backup snapshots as «استعادة المجتمع السابق» candidates ───────────── */

function rowIdSet(rows: ReadonlyArray<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = row["xrayImageId"];
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/**
 * Every COMPLETE backup holding a population.final.json for `month`, newest
 * first (loadBackupHistory's order), in A2's own candidate shape with
 * `source: "backup"` and the backup FOLDER as `fileName`. Coverage is counted
 * exactly as A2 counts its local candidates (live sampled ids present in the
 * candidate). An interrupted backup is skipped, never offered.
 */
export async function listBackupPopulationCandidates(
  directoryHandle: DirectoryHandleLike,
  month: string
): Promise<PopulationRecoveryCandidate[]> {
  const history = await loadBackupHistory(directoryHandle);
  const impact = await loadPopulationOverwriteImpact(directoryHandle, month);
  const candidates: PopulationRecoveryCandidate[] = [];
  for (const item of history) {
    if (item.status !== "complete") continue;
    let jsonDir: DirectoryHandleLike;
    try {
      jsonDir = await openCompleteBackupJsonDir(directoryHandle, item.folderName);
    } catch (error) {
      logError("backup:population-candidate-open", error);
      continue;
    }
    const population = await readFirstInTree<PopulationFinalData>(jsonDir, backupPopulationCandidates(month));
    if (population.state !== "ok" || !Array.isArray(population.value.rows)) continue;
    const ids = rowIdSet(population.value.rows);
    candidates.push({
      fileName: item.folderName,
      source: "backup",
      rowCount: population.value.rows.length,
      processedAt: population.value.processedAt ?? null,
      coveredSampledIds: impact.liveSampledIds.filter((id) => ids.has(id)).length,
      totalSampledIds: impact.liveSampledIds.length,
    });
  }
  return candidates;
}

/**
 * A2's restore action for a backup candidate: the scoped engine with
 * `{ elements: ["population"], months: [month] }` — never a hand copy and never
 * the whole-workspace restore — so it gets the completeness check, the full
 * pre-restore rollback backup, the sentinel, A2's coverage block, and A's
 * derived-file rebuild.
 */
export async function restorePopulationMonthFromBackup(params: {
  directoryHandle: DirectoryHandleLike;
  backupFolderName: string;
  month: string;
  username: string;
}): Promise<SelectiveRestoreOutcome> {
  const months = await listMonthFolders(params.directoryHandle);
  return runSelectiveRestore({
    directoryHandle: params.directoryHandle,
    months,
    backupFolderName: params.backupFolderName,
    username: params.username,
    scope: { elements: ["population"], months: [params.month] },
  });
}
```

- [ ] **Step 5: Run the data-layer test to verify it passes**

Run: `npx vitest run src/data/backup/selectiveRestorePopulationRecovery.test.ts src/data/population/populationRecovery.test.ts`
Expected: PASS.

- [ ] **Step 6: Labels** — in `src/data/labels/labelsStore.ts`, after the `population_recovery_failed:` line, insert:

```ts
  population_recovery_source_backup:    "نسخة احتياطية",
  population_recovery_backup_restored:  "تمت استعادة المجتمع من النسخة الاحتياطية {folder}. نسخة الرجوع: {rollback}.",
  population_recovery_backup_blocked:   "لا يمكن استعادة هذه النسخة: {missing} من صور العينة الحالية غير موجودة في مجتمعها، ولهذا الشهر توزيع أو إجابات.",
```

- [ ] **Step 7: Write the failing UI test** — edit `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx`:

7a. Change the vitest import line `import { afterEach, describe, expect, it, vi } from "vitest";` to `import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";`.

7b. After the `const recovery = vi.hoisted(...)` block add:

```ts
const backups = vi.hoisted(() => ({
  list: vi.fn<() => Promise<PopulationRecoveryCandidate[]>>(),
  restore: vi.fn(),
}));
```

7c. After the `vi.mock("../../../../data/population/populationRecovery", …)` block add:

```ts
vi.mock("../../../../data/backup/selectiveRestore", () => ({
  listBackupPopulationCandidates: backups.list,
  restorePopulationMonthFromBackup: backups.restore,
}));
vi.mock("../../../../data/workspace/dataRefreshSignal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/workspace/dataRefreshSignal")>();
  return { ...actual, broadcastDataRefresh: vi.fn() };
});
```

7d. After the `import { PopulationRecoverySection } from "./PopulationRecoverySection";` line add:

```ts
import { broadcastDataRefresh } from "../../../../data/workspace/dataRefreshSignal";

beforeEach(() => {
  backups.list.mockResolvedValue([]);
});
```

and inside the existing `afterEach` add `backups.list.mockReset();` and `backups.restore.mockReset();`.

7e. Inside `describe("PopulationRecoverySection", …)`, after the existing tests, add:

```tsx
  it("offers backup snapshots and restores one through the selective-restore engine", async () => {
    const BACKUP: PopulationRecoveryCandidate = {
      fileName: "2026-09-01T08-00-00-manual-ab12",
      source: "backup",
      rowCount: 290,
      processedAt: null,
      coveredSampledIds: 40,
      totalSampledIds: 40,
    };
    recovery.list.mockResolvedValue([]);
    backups.list.mockResolvedValue([BACKUP]);
    backups.restore.mockResolvedValue({ ok: true, restoredFiles: ["x"], rollbackFolderName: "rb-1", integrity: [] });
    render(<PopulationRecoverySection />);

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_title }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_scan_btn }));
    await waitFor(() => expect(screen.getByText("40 / 40")).toBeInTheDocument());
    expect(screen.getByText(new RegExp(DEFAULT_LABELS.population_recovery_source_backup))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_restore_btn }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok }));

    await waitFor(() =>
      expect(backups.restore).toHaveBeenCalledWith({
        directoryHandle: expect.anything(),
        backupFolderName: BACKUP.fileName,
        month: "5-may-2026",
        username: "admin",
      })
    );
    expect(recovery.restore).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        DEFAULT_LABELS.population_recovery_backup_restored
          .replace("{folder}", BACKUP.fileName)
          .replace("{rollback}", "rb-1")
      )
    );
    expect(vi.mocked(broadcastDataRefresh)).toHaveBeenCalledWith("manual");
  });

  it("explains a backup candidate refused by the coverage rule", async () => {
    const BACKUP: PopulationRecoveryCandidate = {
      fileName: "2026-09-01T08-00-00-manual-cd34",
      source: "backup",
      rowCount: 10,
      processedAt: null,
      coveredSampledIds: 30,
      totalSampledIds: 40,
    };
    recovery.list.mockResolvedValue([]);
    backups.list.mockResolvedValue([BACKUP]);
    backups.restore.mockResolvedValue({
      ok: false,
      reason: "plan-rejected",
      plan: {
        scope: { elements: ["population"], months: ["5-may-2026"] },
        invalidReason: null,
        selections: [],
        selectedFileCount: 1,
        emptySelections: [],
        blocked: [{ month: "5-may-2026", sampledCount: 40, missingCount: 10, missingExamples: [] }],
        warnings: [],
        canConfirm: false,
      },
    });
    render(<PopulationRecoverySection />);

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_title }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_scan_btn }));
    await waitFor(() => expect(screen.getByText("30 / 40")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_restore_btn }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        DEFAULT_LABELS.population_recovery_backup_blocked.replace("{missing}", "10")
      )
    );
  });
```

Run: `npx vitest run src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx`
Expected: FAIL — the two new tests (the section does not list or dispatch backup candidates yet); A's original tests still pass.

- [ ] **Step 8: Wire the Settings section** — in `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx`:

8a. Imports — after the `populationRecovery` import block add:

```ts
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import {
  listBackupPopulationCandidates,
  restorePopulationMonthFromBackup,
} from "../../../../data/backup/selectiveRestore";
import { broadcastDataRefresh } from "../../../../data/workspace/dataRefreshSignal";
```

8b. In `scan()`, replace:

```ts
      setCandidates(await listPopulationRecoveryCandidates(directoryHandle, month));
```

with:

```ts
      // Local copies (A2) first, then backup snapshots (Workstream D), newest first within each.
      const [local, backups] = await Promise.all([
        listPopulationRecoveryCandidates(directoryHandle, month),
        listBackupPopulationCandidates(directoryHandle, month),
      ]);
      setCandidates([...local, ...backups]);
```

8c. Directly above `async function restore(candidate: PopulationRecoveryCandidate): Promise<void> {` add:

```ts
  /** A backup snapshot goes through D's scoped engine, never through restorePopulationCandidate. */
  async function restoreFromBackup(
    handle: DirectoryHandleLike,
    monthFolderName: string,
    backupFolderName: string
  ): Promise<Notice> {
    const outcome = await restorePopulationMonthFromBackup({
      directoryHandle: handle,
      backupFolderName,
      month: monthFolderName,
      username,
    });
    if (outcome.ok) {
      // A backup restore bypasses every normal write path — same signal the Archive restore sends.
      broadcastDataRefresh("manual");
      return {
        kind: "ok",
        text: L.population_recovery_backup_restored
          .replace("{folder}", backupFolderName)
          .replace("{rollback}", outcome.rollbackFolderName),
      };
    }
    if (outcome.reason === "plan-rejected" && outcome.plan.blocked.length > 0) {
      return {
        kind: "error",
        text: L.population_recovery_backup_blocked.replace("{missing}", String(outcome.plan.blocked[0].missingCount)),
      };
    }
    const detail = outcome.reason === "restore-failed" ? outcome.error : L.archive_restore_plan_rejected;
    return { kind: "error", text: L.population_recovery_failed.replace("{error}", detail) };
  }

```

8d. In `restore(candidate)`, replace:

```ts
      const result = await restorePopulationCandidate(directoryHandle, month, candidate.fileName, username);
      setNotice(
        result.ok
          ? { kind: "ok", text: L.population_recovery_restored.replace("{archived}", result.archivedAs ?? "—") }
          : { kind: "error", text: L.population_recovery_failed.replace("{error}", result.detail ?? result.reason) }
      );
```

with:

```ts
      if (candidate.source === "backup") {
        setNotice(await restoreFromBackup(directoryHandle, month, candidate.fileName));
      } else {
        const result = await restorePopulationCandidate(directoryHandle, month, candidate.fileName, username);
        setNotice(
          result.ok
            ? { kind: "ok", text: L.population_recovery_restored.replace("{archived}", result.archivedAs ?? "—") }
            : { kind: "error", text: L.population_recovery_failed.replace("{error}", result.detail ?? result.reason) }
        );
      }
```

8e. In the table body, replace:

```tsx
                  <tr key={candidate.fileName}>
                    <td title={candidate.fileName}>
                      {candidate.source === "bak" ? L.population_recovery_source_bak : L.population_recovery_source_superseded}
```

with:

```tsx
                  <tr key={`${candidate.source}:${candidate.fileName}`}>
                    <td title={candidate.fileName}>
                      {candidate.source === "backup"
                        ? `${L.population_recovery_source_backup} ${candidate.fileName}`
                        : candidate.source === "bak"
                          ? L.population_recovery_source_bak
                          : L.population_recovery_source_superseded}
```

(`archive_restore_plan_rejected` is the Task 6 label; reusing it keeps one wording for "the plan changed since you looked".)

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx src/data/backup/ src/data/population/populationRecovery.test.ts`
Expected: PASS — A's original section tests included.

- [ ] **Step 10: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 11: Edit log**

Run: `npm run editlog -- --tier=2 --append --sync-package "Change (population): population recovery offers backup snapshots through the selective-restore engine"`
`Why:` spec D "A2 link" — one restore engine, one set of guarantees; A2's tool promised the `backup` source. `What changed:` `PopulationRecoveryCandidate.source` gains `"backup"`; `listBackupPopulationCandidates` / `restorePopulationMonthFromBackup` in `selectiveRestore.ts`; the Settings section merges and dispatches by source; three labels. Snippets for 8b and 8d.

- [ ] **Step 12: Commit**

```bash
git add src/data/population/populationRecovery.ts src/data/backup/selectiveRestore.ts src/data/backup/selectiveRestorePopulationRecovery.test.ts src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx src/data/labels/labelsStore.ts "docs/edit logs/" package.json
git commit -m "$(cat <<'EOF'
Change (population): population recovery offers backup snapshots through the selective-restore engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
EOF
)"
```

---

## Task 8: Documentation and final gate sweep

**Files:**
- Modify: `docs/architecture/data-system-report.md` ("Backup retention policy (A8)" section, the "Restore semantics" bullet)

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Document selective restore** — in `docs/architecture/data-system-report.md`, directly after the bullet that begins `- **Restore semantics (merge, not prune):**` (and its continuation lines ending `…it is never applied automatically.`), add:

```markdown
- **Selective restore (Workstream D, admin only):** the Archive restore dialog's
  «استعادة انتقائية» mode restores chosen elements × months instead of the whole
  `json/` tree. The element catalog is `src/data/backup/restoreScope.ts` (one definition,
  numbered and legacy paths): Population, Sample & distribution, Answers, Referrals &
  approvals (per month), and Population settings, Templates, Users & permissions, Report
  designs, Feedback, System settings (workspace-wide). `5-system/{backups,audit,locks,
  system-errors}/`, `restore.inprogress.json`, and any file matching no element are never
  restored selectively. `restoreBackupSnapshot` takes the optional `scope`; absent, it is the
  full restore above, unchanged. A selective restore keeps every guarantee of a full one —
  `assertBackupComplete`, a FULL `pre-restore` rollback backup, the sentinel, and the same
  per-file `restoreActionFor` semantics (event segments still merge) — and never creates
  folders for unselected elements. Before confirming, the dialog previews file counts per
  element × month (an empty selection disables confirm) and runs the dependency plan
  (`src/data/backup/selectiveRestore.ts`): a population restore for a month with a live
  distribution or answers is refused unless every live sampled `xrayImageId` exists in the
  backup's population (A2's rule); Sample & distribution without Answers (or the reverse) is
  allowed with a warning. After the restore the replacement-candidate index, the month
  aggregate and `distribution.current.json` are rebuilt for the months actually restored
  (never copied), and the B3 integrity scan runs for every selected month. A2's "restore
  previous population" tool (Settings, admin) lists every complete backup holding the
  month's population as a `source: "backup"` candidate and restores it through this
  engine with `{ elements: ["population"], months: [month] }`.
```

- [ ] **Step 2: Full release gate sweep**

Run each and require success:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run check:complexity
npm run check:hex-literals
npm run check:vendor
npm run build
npm run check:bundle-size
```

Expected: all pass. If `check:complexity` flags a function touched in this workstream, split it (do not raise the budget). If `check:bundle-size` fails, report the raw/gzip numbers rather than trimming unrelated code.

- [ ] **Step 3: Edit log (tier 3 — the workstream's release entry)**

Run: `npm run editlog -- --tier=3 --append --sync-package "Docs (backup): selective backup restore — data-system report and release sweep"`
Prose: summary of Workstream D (tasks 1–7), the migration/rollback note (no workspace file changes shape; `scope` is an optional parameter and older builds ignore nothing because nothing new is written; rollback = revert the PR), and the gate results. Include the whole-repo line total the script prints.

- [ ] **Step 4: Release consistency check**

Run: `npm run check:release`
Expected: PASS (package.json version matches the newest edit-log entry).

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/data-system-report.md "docs/edit logs/" package.json
git commit -m "$(cat <<'EOF'
Docs (backup): selective backup restore — data-system report and release sweep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
EOF
)"
```

- [ ] **Step 6: Push**

Run: `git push -u origin claude/beautiful-einstein-y1ouot` (only after Step 2's `npm run build` passed).

---

## Self-Review

**Spec coverage (Workstream D):**

| Spec requirement | Where |
|---|---|
| Element catalog in `restoreScope.ts`, one definition, `workspacePaths` names, legacy aliases | Task 1 (`RESTORE_ELEMENTS`, `classifyBackupPath`, `LEGACY_MONTH_SUBFOLDERS`) |
| Month-scoped: Population, Sample & distribution, Answers, Referrals & approvals | Task 1 |
| Workspace-wide: Templates, Users & permissions, Report designs, Feedback, System settings (5-system minus backups/audit/locks/system-errors) | Task 1 (`SYSTEM_CHILDREN_NEVER_RESTORED`) |
| File-to-element mapping verified against the real tree | "Verified file → element mapping" table; Task 1 tests |
| A file matching no element is never restored selectively | Task 1 (`null` → `isFileInRestoreScope` false); Task 2 test 1 vs. scoped tests |
| `restoreBackupSnapshot` optional `scope: { elements; months }`; absent = unchanged | Task 2 (4g–4i); existing suites re-run in Task 2 Step 5 |
| Walk skips unselected paths; same `assertBackupComplete`, rollback, sentinel, `restoreActionFor` | Task 2 (4b–4e, tests 2–8) |
| Preview: file count per element × month; "not present" disables confirm | Task 3 (`previewSelectiveRestore`), Task 4 (`emptySelections`, `canConfirm`), Task 6 (UI rows) |
| Population with live distribution/answers → A2 coverage rule, blocked with missing count | Task 4 (`populationCoverageBlocks`), Task 6 (`describeBlock`) |
| Sample without Answers (or vice versa) → warning; post-restore `scanReferentialIntegrity` shown | Task 4 (`dependencyWarnings`), Task 5 (`runMonthIntegrityScan`), Task 6 (success message) |
| Derived caches rebuilt, not copied (distribution current, replacement index) | Task 1 (`derived`), Task 5 (`rebuildPopulationDerived`, `rebuildDistributionDerived`) |
| UI: mode switch «استعادة كاملة / استعادة انتقائية», element checkboxes, month multi-select, preview, warnings, admin only, label keys | Task 6 |
| A2 backup candidates call the engine with `{ elements: ["population"], months: [month] }` | Task 7 |
| Tests: scope absent identical; population-only one month; merge-events on sample-only; blocked on mismatch; preview counts; rollback always; sentinel on partial failure | Task 2 (1, 2, 4, 7, 8), Task 4 (blocked), Task 3 (counts), Task 5 (plan-rejected leaves no rollback) |

**Placeholder scan:** no "TBD", "TODO", "similar to Task N", or unspecified code. The edits to Workstream A's files (Tasks 4, 5, 7) quote A's planned code verbatim from its plan; each of those tasks opens with a grep that stops as BLOCKED if A has not landed, and tells the implementer to make the equivalent change if A's shipped text drifted from its plan.

**Name consistency (checked across tasks):** `RestoreScope`, `RestoreElementId`, `RestoreScopeCell`, `RestoreScopeProblem`, `classifyBackupPath`, `isFileInRestoreScope`, `isDirectoryInRestoreScope`, `validateRestoreScope`, `expandRestoreScope`, `isMonthScopedElement` (Task 1) ↔ used in Tasks 2–6. `BACKUP_JSON_FOLDER`, `openCompleteBackupJsonDir`, `isSnapshotPayloadFile`, `restoreActionFor` (Task 3) ↔ Tasks 4, 5, 7. `previewSelectiveRestore`/`countPreviewFiles`/`RestorePreview` (Task 3) ↔ Tasks 4, 6. `planSelectiveRestore`/`SelectiveRestorePlan`/`SelectiveRestoreBlock`/`SelectiveRestoreWarning` and the private `readFirstInTree`/`backupPopulationCandidates`/`backupSampleCandidates` (Task 4) ↔ Tasks 5, 6, 7. Workstream A names consumed: `loadPopulationOverwriteImpact`, `assessPopulationOverwrite` (Tasks 4, 7), `rebuildPopulationDerivedFiles` (Task 5), `PopulationRecoveryCandidate`, `listPopulationRecoveryCandidates`, `restorePopulationCandidate`, `PopulationRecoverySection` (Task 7). `listBackupPopulationCandidates`/`restorePopulationMonthFromBackup` (Task 7) ↔ the Settings section. `runSelectiveRestore`/`SelectiveRestoreOutcome`/`SelectiveRestoreIntegrity` (Task 5) ↔ Tasks 6, 7. `discardReplacementIndexManifest`, `discardPopulationAggregate` (Task 5). Test kit names (Task 2) ↔ Tasks 3, 4, 5, 7. Label keys added in Task 1 (`restore_element_*`, `restore_scope_invalid`) and Task 6 (`archive_restore_*`) match every use in code and tests.
