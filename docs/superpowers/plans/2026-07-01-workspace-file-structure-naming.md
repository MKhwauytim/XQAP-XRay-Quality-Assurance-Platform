# Workspace File-Structure Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every folder/file name the app generates on disk follow one consistent convention (lowercase, numbered only where there's a real workflow order, dot-namespaced files), sourced from a single set of constants so it can't drift again.

**Architecture:** All folder/file name literals move into (or are re-exported from) `src/data/workspace/workspacePaths.ts` and `src/data/workspace/workspaceDefaults.ts`. Every storage module that currently hardcodes a folder name imports the constant instead. No data migration — confirmed greenfield, no production workspaces exist yet.

**Tech Stack:** TypeScript, Vitest (`node` environment), `createMemoryDirectory()` test double for `DirectoryHandleLike`.

## Global Constraints

- No backwards-compatibility fallback is added for the *old* title-case root names (`1-Population`, `3-User Data`, etc.) — this is a rename, not a new alias. The existing pre-numbering `LEGACY_ROOTS` (`Population/`, `.system/`, `templates/`) and the population-month legacy fallbacks (`sample`, `employee-answers`, `approvals`) are untouched — out of scope.
- Casing rule: lowercase, hyphenated multi-word tokens (`kebab-case`). No spaces, no title case, anywhere in the generated tree.
- Numbering rule: an `N-` prefix only on folders that form a real sequential workflow (the 6 roots; samples month `1-main/2-employees/3-approvals`; population month `1-raw/2-processed`). Independent peer buckets (`locks`, `audit`, `backups`, `powerbi-export`, `user-presets`, `feedback`, `designs`) get no number.
- File rule: `entity.qualifier[.sub].json`, dot-separated. Two renames only: `active.inspection-template.json` → `template.selection.json`, `auth-activity.log.json` → `activity.log.json`, plus `LISEZMOI.txt` → `README.txt`. All other files already conform — do not touch them.
- Run `npm run test:run`, `npm run lint`, and `npm run build` after the last task to confirm nothing broke.
- Every code edit must also get an entry in `docs/EDIT_LOG.md` per the project's edit-log rule (this plan's tasks each add one `## v{N}` entry — group them as directed in Task 10, don't add one per task).

---

### Task 1: Central subfolder-name constants in `workspacePaths.ts`

**Files:**
- Modify: `src/data/workspace/workspacePaths.ts`
- Create: `src/data/workspace/workspacePaths.test.ts`

**Interfaces:**
- Produces: `WORKSPACE_ROOTS` (existing export, values change to lowercase-kebab), `POPULATION_SUBFOLDERS: { raw: "1-raw", processed: "2-processed" }`, `SAMPLE_SUBFOLDERS: { main: "1-main", employees: "2-employees", approvals: "3-approvals" }`, `SYSTEM_FOLDER_NAMES: { locks: "locks", audit: "audit", backups: "backups", powerbiExport: "powerbi-export", userPresets: "user-presets", feedback: "feedback" }`, `REPORTS_SUBFOLDERS: { designs: "designs" }` — all new named exports from `workspacePaths.ts`.
- Consumes: nothing new (existing `DirectoryHandleLike` type).

- [ ] **Step 1: Write the failing test**

Create `src/data/workspace/workspacePaths.test.ts`:

```ts
import { expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  WORKSPACE_ROOTS,
  POPULATION_SUBFOLDERS,
  SAMPLE_SUBFOLDERS,
  SYSTEM_FOLDER_NAMES,
  REPORTS_SUBFOLDERS,
  getSampleMainDir,
  getSampleEmployeeDir,
  getSampleApprovalsDir,
} from "./workspacePaths";

test("WORKSPACE_ROOTS are lowercase kebab-case", () => {
  expect(WORKSPACE_ROOTS).toEqual({
    population: "1-population",
    samples: "2-samples",
    userData: "3-user-data",
    reports: "4-reports",
    system: "5-system",
    templates: "6-templates",
  });
});

test("POPULATION_SUBFOLDERS, SAMPLE_SUBFOLDERS, SYSTEM_FOLDER_NAMES, REPORTS_SUBFOLDERS are lowercase", () => {
  expect(POPULATION_SUBFOLDERS).toEqual({ raw: "1-raw", processed: "2-processed" });
  expect(SAMPLE_SUBFOLDERS).toEqual({
    main: "1-main",
    employees: "2-employees",
    approvals: "3-approvals",
  });
  expect(SYSTEM_FOLDER_NAMES).toEqual({
    locks: "locks",
    audit: "audit",
    backups: "backups",
    powerbiExport: "powerbi-export",
    userPresets: "user-presets",
    feedback: "feedback",
  });
  expect(REPORTS_SUBFOLDERS).toEqual({ designs: "designs" });
});

test("getSampleMainDir/EmployeeDir/ApprovalsDir create lowercase numbered subfolders", async () => {
  const root = createMemoryDirectory();

  const main = await getSampleMainDir(root, "5-may-2026", true);
  expect(main.name).toBe("1-main");

  const employees = await getSampleEmployeeDir(root, "5-may-2026", true);
  expect(employees.name).toBe("2-employees");

  const approvals = await getSampleApprovalsDir(root, "5-may-2026", true);
  expect(approvals.name).toBe("3-approvals");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/workspace/workspacePaths.test.ts`
Expected: FAIL — `WORKSPACE_ROOTS` values still title-case (`"1-Population"` etc.), and `POPULATION_SUBFOLDERS`/`SAMPLE_SUBFOLDERS`/`SYSTEM_FOLDER_NAMES`/`REPORTS_SUBFOLDERS` are not exported (import error).

- [ ] **Step 3: Update `workspacePaths.ts`**

Replace the top of the file:

```ts
export const WORKSPACE_ROOTS = {
  population: "1-Population",
  samples: "2-Samples",
  userData: "3-User Data",
  reports: "4-Reports",
  system: "5-System",
  templates: "6-Templates",
} as const;
```

with:

```ts
export const WORKSPACE_ROOTS = {
  population: "1-population",
  samples: "2-samples",
  userData: "3-user-data",
  reports: "4-reports",
  system: "5-system",
  templates: "6-templates",
} as const;

export const POPULATION_SUBFOLDERS = {
  raw: "1-raw",
  processed: "2-processed",
} as const;

export const SAMPLE_SUBFOLDERS = {
  main: "1-main",
  employees: "2-employees",
  approvals: "3-approvals",
} as const;

export const SYSTEM_FOLDER_NAMES = {
  locks: "locks",
  audit: "audit",
  backups: "backups",
  powerbiExport: "powerbi-export",
  userPresets: "user-presets",
  feedback: "feedback",
} as const;

export const REPORTS_SUBFOLDERS = {
  designs: "designs",
} as const;
```

Then update the three getters that hardcode subfolder names:

```ts
export async function getSampleMainDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  const monthDir = await getSampleMonthDir(directoryHandle, monthFolderName, create);
  return monthDir.getDirectoryHandle(SAMPLE_SUBFOLDERS.main, { create });
}

export async function getSampleEmployeeDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  const monthDir = await getSampleMonthDir(directoryHandle, monthFolderName, create);
  return monthDir.getDirectoryHandle(SAMPLE_SUBFOLDERS.employees, { create });
}

export async function getSampleApprovalsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  const monthDir = await getSampleMonthDir(directoryHandle, monthFolderName, create);
  return monthDir.getDirectoryHandle(SAMPLE_SUBFOLDERS.approvals, { create });
}
```

(Only the string literal inside each `getDirectoryHandle` call changes — `"1-Main"` → `SAMPLE_SUBFOLDERS.main`, `"2-Employees"` → `SAMPLE_SUBFOLDERS.employees`, `"3-Approvals"` → `SAMPLE_SUBFOLDERS.approvals`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/workspace/workspacePaths.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/data/workspace/workspacePaths.ts src/data/workspace/workspacePaths.test.ts
git commit -m "refactor(workspace): centralize + lowercase workspace folder-name constants"
```

---

### Task 2: Lowercase month folder names

**Files:**
- Modify: `src/data/population/monthFolder.ts`
- Modify: `src/data/population/monthFolder.test.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `formatMonthFolderName(month, year)` now returns lowercase (e.g. `"5-may-2026"` instead of `"5-May-2026"`). `parseMonthFolderName` behavior is unchanged (already case-insensitive).

- [ ] **Step 1: Update the test expectations first**

In `src/data/population/monthFolder.test.ts`, replace:

```ts
test("formatMonthFolderName produces MM-MonthName-YYYY", () => {
  expect(formatMonthFolderName(5, 2026)).toBe("5-May-2026");
  expect(formatMonthFolderName(12, 2025)).toBe("12-December-2025");
  expect(formatMonthFolderName(1, 2024)).toBe("1-January-2024");
});
```

with:

```ts
test("formatMonthFolderName produces MM-monthname-YYYY (lowercase)", () => {
  expect(formatMonthFolderName(5, 2026)).toBe("5-may-2026");
  expect(formatMonthFolderName(12, 2025)).toBe("12-december-2025");
  expect(formatMonthFolderName(1, 2024)).toBe("1-january-2024");
});
```

`parseMonthFolderName("5-May")`, `parseMonthFolderName("5-Xyz-2026")` etc. in the other two tests are unaffected — leave them as-is.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/population/monthFolder.test.ts`
Expected: FAIL — actual value is still `"5-May-2026"` (title case).

- [ ] **Step 3: Update `monthFolder.ts`**

Replace:

```ts
// Matches "5-May-2026", "12-December-2025", etc.
const MONTH_FOLDER_PATTERN = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/;
```

with:

```ts
// Matches "5-may-2026", "12-december-2025", etc.
const MONTH_FOLDER_PATTERN = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/;
```

Replace:

```ts
export function formatMonthFolderName(month: number, year: number): string {
  if (month < 1 || month > 12) {
    throw new RangeError(`Month must be 1–12, got ${month}`);
  }
  const monthName = MONTH_NAMES_EN[month - 1];
  return `${month}-${monthName}-${year}`;
}
```

with:

```ts
export function formatMonthFolderName(month: number, year: number): string {
  if (month < 1 || month > 12) {
    throw new RangeError(`Month must be 1–12, got ${month}`);
  }
  const monthName = MONTH_NAMES_EN[month - 1];
  return `${month}-${monthName.toLowerCase()}-${year}`;
}
```

`parseMonthFolderName` needs no change — it already lowercases both sides before comparing (`match[2].toLowerCase() !== monthName.toLowerCase()`), so it accepts either case.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/population/monthFolder.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/data/population/monthFolder.ts src/data/population/monthFolder.test.ts
git commit -m "refactor(population): lowercase generated month folder names"
```

---

### Task 3: Workspace init path — `fileSystemAccess.ts` + `workspaceDefaults.ts`

**Files:**
- Modify: `src/data/workspace/workspaceDefaults.ts`
- Modify: `src/data/storage/fileSystemAccess.ts`
- Modify: `src/data/storage/fileSystemAccess.test.ts`

**Interfaces:**
- Consumes: `WORKSPACE_ROOTS`, `SYSTEM_FOLDER_NAMES`, `SAMPLE_SUBFOLDERS` from `workspacePaths.ts` (Task 1).
- Produces: `createWorkspaceStructure()` now creates the lowercase tree; `WORKSPACE_FILE_NAMES.locksFolder/auditFolder/backupsFolder` values change to `"locks"/"audit"/"backups"`.

- [ ] **Step 1: Update the test expectations first**

In `src/data/storage/fileSystemAccess.test.ts`, replace the second test entirely:

```ts
test("createWorkspaceStructure creates numbered workspace folders", async () => {
  const dir = createMemoryDirectory();
  // createWorkspaceStructure calls ensureDirectoryPermission which calls queryPermission.
  // The memory double always returns "granted" so the permission gate passes.
  await createWorkspaceStructure(dir, "test-user");

  const population = await dir.getDirectoryHandle("1-Population", { create: false });
  expect(population.name).toBe("1-Population");

  const samples = await dir.getDirectoryHandle("2-Samples", { create: false });
  expect(samples.name).toBe("2-Samples");

  const userData = await dir.getDirectoryHandle("3-User Data", { create: false });
  expect(userData.name).toBe("3-User Data");

  const system = await dir.getDirectoryHandle("5-System", { create: false });
  const backups = await system.getDirectoryHandle("3-Backups", { create: false });
  expect(backups.name).toBe("3-Backups");

  const templates = await dir.getDirectoryHandle("6-Templates", { create: false });
  expect(templates.name).toBe("6-Templates");
});
```

with:

```ts
test("createWorkspaceStructure creates numbered workspace folders", async () => {
  const dir = createMemoryDirectory();
  // createWorkspaceStructure calls ensureDirectoryPermission which calls queryPermission.
  // The memory double always returns "granted" so the permission gate passes.
  await createWorkspaceStructure(dir, "test-user");

  const population = await dir.getDirectoryHandle("1-population", { create: false });
  expect(population.name).toBe("1-population");

  const samples = await dir.getDirectoryHandle("2-samples", { create: false });
  expect(samples.name).toBe("2-samples");

  const userData = await dir.getDirectoryHandle("3-user-data", { create: false });
  expect(userData.name).toBe("3-user-data");

  const system = await dir.getDirectoryHandle("5-system", { create: false });
  const backups = await system.getDirectoryHandle("backups", { create: false });
  expect(backups.name).toBe("backups");

  const templates = await dir.getDirectoryHandle("6-templates", { create: false });
  expect(templates.name).toBe("6-templates");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/storage/fileSystemAccess.test.ts`
Expected: FAIL — `createWorkspaceStructure` still creates the old title-case names.

- [ ] **Step 3: Update `workspaceDefaults.ts`**

Replace the imports and `WORKSPACE_FILE_NAMES` block:

```ts
import { WORKSPACE_ROOTS } from "./workspacePaths";

export const WORKSPACE_FILE_NAMES = {
  manifest: "workspace.manifest.json",
  usersPermissions: "users.permissions.json",
  dataRaw: "data.raw.json",
  dataProcessed: "data.processed.json",
  sampleMaster: "sample.master.json",
  sampleDistribution: "sample.distribution.json",
  employeeAnswersFolder: WORKSPACE_ROOTS.samples,
  systemFolder: WORKSPACE_ROOTS.system,
  locksFolder: "1-Locks",
  auditFolder: "2-Audit",
  backupsFolder: "3-Backups",
  templatesFolder: WORKSPACE_ROOTS.templates
} as const;
```

with:

```ts
import { SAMPLE_SUBFOLDERS, SYSTEM_FOLDER_NAMES, WORKSPACE_ROOTS } from "./workspacePaths";

export const WORKSPACE_FILE_NAMES = {
  manifest: "workspace.manifest.json",
  usersPermissions: "users.permissions.json",
  dataRaw: "data.raw.json",
  dataProcessed: "data.processed.json",
  sampleMaster: "sample.master.json",
  sampleDistribution: "sample.distribution.json",
  employeeAnswersFolder: WORKSPACE_ROOTS.samples,
  systemFolder: WORKSPACE_ROOTS.system,
  locksFolder: SYSTEM_FOLDER_NAMES.locks,
  auditFolder: SYSTEM_FOLDER_NAMES.audit,
  backupsFolder: SYSTEM_FOLDER_NAMES.backups,
  templatesFolder: WORKSPACE_ROOTS.templates
} as const;
```

Further down, in `createDefaultWorkspaceManifest`, replace:

```ts
        employeeAnswersFolder: `${WORKSPACE_ROOTS.samples}/{month}/2-Employees`,
```

with:

```ts
        employeeAnswersFolder: `${WORKSPACE_ROOTS.samples}/{month}/${SAMPLE_SUBFOLDERS.employees}`,
```

`SYSTEM_SUBFOLDERS` (the array export used for structure-check iteration, distinct from the new `SYSTEM_FOLDER_NAMES` object in `workspacePaths.ts`) already reads from `WORKSPACE_FILE_NAMES.locksFolder/auditFolder/backupsFolder` — no change needed to its own definition since it derives from the values just updated above.

- [ ] **Step 4: Update `fileSystemAccess.ts`**

Replace the import block:

```ts
import {
  getSystemRoot,
  getUserDataRoot,
} from "../workspace/workspacePaths";
```

with:

```ts
import {
  getSystemRoot,
  getUserDataRoot,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";
```

In `createWorkspaceStructure`, replace:

```ts
  await directoryHandle.getDirectoryHandle(
    WORKSPACE_FILE_NAMES.employeeAnswersFolder,
    { create: true }
  );

  await directoryHandle.getDirectoryHandle("1-Population", { create: true });
  await directoryHandle.getDirectoryHandle("3-User Data", { create: true });
  await directoryHandle.getDirectoryHandle("4-Reports", { create: true });
```

with:

```ts
  await directoryHandle.getDirectoryHandle(
    WORKSPACE_FILE_NAMES.employeeAnswersFolder,
    { create: true }
  );

  await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.population, { create: true });
  await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.userData, { create: true });
  await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.reports, { create: true });
```

And replace:

```ts
  const userDataHandle = await directoryHandle.getDirectoryHandle("3-User Data", {
    create: true
  });
```

with:

```ts
  const userDataHandle = await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.userData, {
    create: true
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/storage/fileSystemAccess.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/data/workspace/workspaceDefaults.ts src/data/storage/fileSystemAccess.ts src/data/storage/fileSystemAccess.test.ts
git commit -m "refactor(workspace): use central WORKSPACE_ROOTS/SYSTEM_FOLDER_NAMES in workspace init"
```

---

### Task 4: Population `raw`/`processed` subfolders — `populationStorage.ts`

**Files:**
- Modify: `src/data/population/populationStorage.ts`
- Modify: `src/data/population/populationStorage.test.ts`

**Interfaces:**
- Consumes: `POPULATION_SUBFOLDERS` from `workspacePaths.ts` (Task 1); lowercase `formatMonthFolderName` output (Task 2).
- Produces: population month folders now have `1-raw/` and `2-processed/` subfolders instead of `raw/`/`processed/`.

- [ ] **Step 1: Update the test file first**

In `src/data/population/populationStorage.test.ts`, apply these replacements (all occurrences):

- `"1-Population"` → `"1-population"` (5 occurrences: lines 33, 42, 61, 85, 100)
- `"5-May-2026"` → `"5-may-2026"` (test assertions at lines 30, 34, 35, 43, 62, 86, 101, and the manifest literal at line 105)
- `monthDir.getDirectoryHandle("raw", { create: false })` → `monthDir.getDirectoryHandle("1-raw", { create: false })` (lines 63, 87)
- `monthDir.getDirectoryHandle("processed", { create: false })` → `monthDir.getDirectoryHandle("2-processed", { create: false })` (line 64)

Do **not** change `monthDir.getDirectoryHandle("sample", { create: true })` at line 121 — that's the legacy pre-`2-Samples` fallback path, unrelated to this rename, and the test specifically exercises that legacy fallback.

The full updated file:

```ts
import { expect, it, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { saveMonthRun, loadAllSampleRows } from "./populationStorage";
import type { MonthManifestData, MonthRawData, PopulationFinalData } from "./monthTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";

const baseParams = {
  month: 5,
  year: 2026,
  username: "test-admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  riskRawRows: [{ id: "A001", port: "بري" }],
  biRawRows: [],
  processedRows: [{ xrayImageId: "A001", certScanStatus: "NonCertscan" }],
  certScanRows: 0,
  nonCertScanRows: 1
};

test("saveMonthRun creates month folder and manifest", async () => {
  const dir = createMemoryDirectory();
  const result = await saveMonthRun({ directoryHandle: dir, ...baseParams });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.monthFolderName).toBe("5-may-2026");

  // Verify folder structure
  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });
  expect(monthDir.name).toBe("5-may-2026");
});

test("saveMonthRun writes month.manifest.json with correct metadata", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });

  const manifest = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) return;

  expect(manifest.value.month).toBe(5);
  expect(manifest.value.year).toBe(2026);
  expect(manifest.value.processedBy).toBe("test-admin");
  expect(manifest.value.status).toBe("processed-saved");
  expect(manifest.value.totalRawRows).toBe(1);
  expect(manifest.value.totalProcessedRows).toBe(1);
});

test("saveMonthRun writes risk.raw.json and population.final.json", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });
  const rawDir = await monthDir.getDirectoryHandle("1-raw", { create: false });
  const processedDir = await monthDir.getDirectoryHandle("2-processed", { create: false });

  const riskRaw = await safeReadJson<MonthRawData>(rawDir, "risk.raw.json");
  expect(riskRaw.ok).toBe(true);
  if (riskRaw.ok) {
    expect(riskRaw.value.rows).toHaveLength(1);
    expect(riskRaw.value.importedBy).toBe("test-admin");
  }

  const finalData = await safeReadJson<PopulationFinalData>(processedDir, "population.final.json");
  expect(finalData.ok).toBe(true);
  if (finalData.ok) {
    expect(finalData.value.rows).toHaveLength(1);
    expect(finalData.value.nonCertScanRows).toBe(1);
  }
});

test("saveMonthRun does not write bi.raw.json when no BI rows", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams, biRawRows: [] });

  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });
  const rawDir = await monthDir.getDirectoryHandle("1-raw", { create: false });

  const biRaw = await safeReadJson(rawDir, "bi.raw.json");
  expect(biRaw.ok).toBe(false);
  expect((biRaw as { reason: string }).reason).toBe("missing");
});

it("loadAllSampleRows falls back to legacy sample path when getSampleMainDir throws", async () => {
  // Arrange: create legacy directory structure (1-population/{month}/sample/sample.master.json)
  // but no 2-samples folder — so getSampleMainDir will throw
  const root = createMemoryDirectory("root");

  // Build: 1-population/5-may-2026/month.manifest.json
  const populationDir = await root.getDirectoryHandle("1-population", { create: true });
  const monthDir = await populationDir.getDirectoryHandle("5-may-2026", { create: true });

  // Write a minimal manifest so listMonthFolders picks it up
  await safeWriteJson(monthDir, "month.manifest.json", {
    monthFolderName: "5-may-2026",
    month: 5,
    year: 2026,
    processedAt: new Date().toISOString(),
    processedBy: "test",
    riskFileName: null,
    biFileName: null,
    certScanUsed: false,
    templateVersion: null,
    rngSeed: null,
    totalRawRows: 0,
    totalProcessedRows: 1,
    status: "processed-saved",
  });

  // Write sample data in legacy location: 1-population/5-may-2026/sample/sample.master.json
  const sampleDir = await monthDir.getDirectoryHandle("sample", { create: true });
  const sampleData: Partial<SampleMasterData> = {
    rngSeed: "test-seed",
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "test",
    rows: [{ xrayImageId: "LEGACY001" } as never],
  };
  await safeWriteJson(sampleDir, "sample.master.json", sampleData);

  // Act: loadAllSampleRows should find rows via legacy path
  const rows = await loadAllSampleRows(root as never);

  // Assert
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].xrayImageId).toBe("LEGACY001");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/population/populationStorage.test.ts`
Expected: FAIL — `saveMonthRun` still creates `1-Population/5-May-2026/raw|processed`.

- [ ] **Step 3: Update `populationStorage.ts`**

Add `POPULATION_SUBFOLDERS` to the import from `workspacePaths.ts`:

```ts
import {
  getPopulationMonthDir,
  getPopulationRoot,
  getSampleMainDir,
} from "../workspace/workspacePaths";
```

becomes:

```ts
import {
  getPopulationMonthDir,
  getPopulationRoot,
  getSampleMainDir,
  POPULATION_SUBFOLDERS,
} from "../workspace/workspacePaths";
```

In `saveMonthRun`, replace:

```ts
    // Create month folder and subfolders
    const monthDir = await ensureFolder(populationDir, monthFolderName);
    const rawDir = await ensureFolder(monthDir, "raw");
    const processedDir = await ensureFolder(monthDir, "processed");
    await ensureFolder(monthDir, "sample");
    await ensureFolder(monthDir, "reports");
```

with:

```ts
    // Create month folder and subfolders
    const monthDir = await ensureFolder(populationDir, monthFolderName);
    const rawDir = await ensureFolder(monthDir, POPULATION_SUBFOLDERS.raw);
    const processedDir = await ensureFolder(monthDir, POPULATION_SUBFOLDERS.processed);
    await ensureFolder(monthDir, "sample");
    await ensureFolder(monthDir, "reports");
```

(`"sample"` and `"reports"` here are pre-existing, undocumented, unrelated stray folders — out of scope, left untouched.)

Further down in the same function, replace:

```ts
      processingSummaryFile: params.processingSummary ? "processed/processing.summary.json" : null,
```

with:

```ts
      processingSummaryFile: params.processingSummary
        ? `${POPULATION_SUBFOLDERS.processed}/processing.summary.json`
        : null,
```

Then replace every remaining `"raw"` / `"processed"` literal passed to `getDirectoryHandle`:

Line ~363 (`listMonthSummaries`):
```ts
        const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
```
→
```ts
        const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
```

Line ~439 (`loadAllPopulationRows`):
```ts
      const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
```
→
```ts
      const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
```

Line ~461 (`loadMonthPopulationFinal`):
```ts
    const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });
```
→
```ts
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
```

Line ~506 (`loadAllRawRows`):
```ts
      const rawDir = await monthDir.getDirectoryHandle("raw", { create: false });
```
→
```ts
      const rawDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: false });
```

Lines ~568/571/574 (`loadMonthForEditing`):
```ts
      monthDir.getDirectoryHandle("processed", { create: false })
        .then((dir) => safeReadJson<PopulationFinalData>(dir, "population.final.json"))
        .catch(() => null),
      monthDir.getDirectoryHandle("processed", { create: false })
        .then((dir) => safeReadJson<ProcessingSummaryData>(dir, "processing.summary.json"))
        .catch(() => null),
      monthDir.getDirectoryHandle("raw", { create: false })
```
→
```ts
      monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false })
        .then((dir) => safeReadJson<PopulationFinalData>(dir, "population.final.json"))
        .catch(() => null),
      monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false })
        .then((dir) => safeReadJson<ProcessingSummaryData>(dir, "processing.summary.json"))
        .catch(() => null),
      monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: false })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/population/populationStorage.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/data/population/populationStorage.ts src/data/population/populationStorage.test.ts
git commit -m "refactor(population): use POPULATION_SUBFOLDERS (1-raw/2-processed) instead of literals"
```

---

### Task 5: Auth activity audit folder + log file — `authActivityLog.ts`

**Files:**
- Modify: `src/auth/authActivityLog.ts`
- Modify: `src/auth/authActivityLog.test.ts`
- Modify: `src/components/Sidebar/Tabs/UserManagement/index.tsx`

**Interfaces:**
- Consumes: `SYSTEM_FOLDER_NAMES` from `workspacePaths.ts` (Task 1).
- Produces: audit log now lives at `5-system/audit/activity.log.json` (was `5-System/2-Audit/auth-activity.log.json`).

- [ ] **Step 1: Update the test file first**

In `src/auth/authActivityLog.test.ts`, replace:

```ts
    const systemDir = await getSystemRoot(root, false);
    const auditDir = await systemDir.getDirectoryHandle("2-Audit", { create: false });
    const result = await safeReadJson<AuthActivityLogFile>(auditDir, "auth-activity.log.json");
```

with:

```ts
    const systemDir = await getSystemRoot(root, false);
    const auditDir = await systemDir.getDirectoryHandle("audit", { create: false });
    const result = await safeReadJson<AuthActivityLogFile>(auditDir, "activity.log.json");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/auth/authActivityLog.test.ts`
Expected: FAIL — the third test can't find `audit` (still writes to `2-Audit`) / `activity.log.json` (still `auth-activity.log.json`).

- [ ] **Step 3: Update `authActivityLog.ts`**

Replace:

```ts
import { getSystemRoot } from "../data/workspace/workspacePaths";

const ACTIVITY_AUDIT_FOLDER = "2-Audit";
const ACTIVITY_LOG_FILE = "auth-activity.log.json";
```

with:

```ts
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../data/workspace/workspacePaths";

const ACTIVITY_LOG_FILE = "activity.log.json";
```

Replace the one use of `ACTIVITY_AUDIT_FOLDER`:

```ts
async function getActivityAuditDir(create: boolean): Promise<DirectoryHandleLike | null> {
  if (!workspaceHandle) return null;
  try {
    const systemDir = await getSystemRoot(workspaceHandle, create);
    return systemDir.getDirectoryHandle(ACTIVITY_AUDIT_FOLDER, { create });
  } catch {
    return null;
  }
}
```

with:

```ts
async function getActivityAuditDir(create: boolean): Promise<DirectoryHandleLike | null> {
  if (!workspaceHandle) return null;
  try {
    const systemDir = await getSystemRoot(workspaceHandle, create);
    return systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.audit, { create });
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Update the admin-facing UI text**

In `src/components/Sidebar/Tabs/UserManagement/index.tsx`, replace:

```tsx
          تعرض هذه الصفحة سجلات الدخول وساعات العمل المحفوظة داخل مساحة العمل في
          <strong> 5-System/2-Audit/auth-activity.log.json</strong>.
```

with:

```tsx
          تعرض هذه الصفحة سجلات الدخول وساعات العمل المحفوظة داخل مساحة العمل في
          <strong> 5-system/audit/activity.log.json</strong>.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/auth/authActivityLog.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/auth/authActivityLog.ts src/auth/authActivityLog.test.ts src/components/Sidebar/Tabs/UserManagement/index.tsx
git commit -m "refactor(auth): move audit log to 5-system/audit/activity.log.json"
```

---

### Task 6: Power BI export folder + LISEZMOI rename — `exportWriter.ts`

**Files:**
- Modify: `src/data/powerbiExport/exportWriter.ts`
- Modify: `src/data/powerbiExport/exportWriter.test.ts`
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx`

**Interfaces:**
- Consumes: `SYSTEM_FOLDER_NAMES` from `workspacePaths.ts` (Task 1).
- Produces: export root is now `5-system/powerbi-export/{month}/`; the instructions file is `README.txt` instead of `LISEZMOI.txt`.

- [ ] **Step 1: Update the test file first**

In `src/data/powerbiExport/exportWriter.test.ts`, replace:

```ts
    // navigate into 5-System/powerbi-export/5-May-2026/
    const sys = await root.getDirectoryHandle("5-System", { create: false });
```

with:

```ts
    // navigate into 5-system/powerbi-export/5-May-2026/
    const sys = await root.getDirectoryHandle("5-system", { create: false });
```

(Leave the `"5-May-2026"` month-string argument as-is in this file — it's an opaque parameter passed directly to `writeCsvExport`, not generated by `formatMonthFolderName`, so its casing has no bearing on correctness here.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/powerbiExport/exportWriter.test.ts`
Expected: FAIL — second test can't find `5-system` (still writes to `5-System`).

- [ ] **Step 3: Update `exportWriter.ts`**

Replace:

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSystemRoot } from "../workspace/workspacePaths";
import { toCsvString } from "./csvSerializer";
import type { ExportManifest, ExportFileResult } from "./exportTypes";

async function getExportDir(root: DirectoryHandleLike, month: string): Promise<DirectoryHandleLike> {
  const sys = await getSystemRoot(root, true);
  const expRoot = await sys.getDirectoryHandle("powerbi-export", { create: true });
  return expRoot.getDirectoryHandle(month, { create: true });
}
```

with:

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import { toCsvString } from "./csvSerializer";
import type { ExportManifest, ExportFileResult } from "./exportTypes";

async function getExportDir(root: DirectoryHandleLike, month: string): Promise<DirectoryHandleLike> {
  const sys = await getSystemRoot(root, true);
  const expRoot = await sys.getDirectoryHandle(SYSTEM_FOLDER_NAMES.powerbiExport, { create: true });
  return expRoot.getDirectoryHandle(month, { create: true });
}
```

Replace the instructions block (root casing + filename):

```ts
  const instructions = [
    "Power BI Data Export",
    "====================",
    "",
    "Arabic:",
    "لاستيراد هذه الملفات في Power BI Desktop:",
    "1. افتح Power BI Desktop",
    "2. الصفحة الرئيسية > الحصول على البيانات > نص/CSV",
    `3. انتقل إلى مجلد '5-System/powerbi-export/${month}/'`,
    "4. افتح كل ملف CSV واضغط 'تحميل'",
    "5. في نموذج البيانات، يمكنك إنشاء علاقات بين الجداول باستخدام عمود xrayImageId",
    "",
    "English:",
    "To import these files into Power BI Desktop:",
    "1. Open Power BI Desktop",
    "2. Home > Get Data > Text/CSV",
    `3. Browse to '5-System/powerbi-export/${month}/'`,
    "4. Open each CSV file and click 'Load'",
    "5. In the Data Model, create relationships between tables using the xrayImageId column",
    "",
    "Files in this export:",
    ...files.map((f) => `  - ${f.fileName} (${f.rowCount} rows)`),
    "",
    `Exported at: ${new Date().toISOString()}`,
  ].join("\n");

  await writeTextFile(dir, "LISEZMOI.txt", instructions);
```

with:

```ts
  const instructions = [
    "Power BI Data Export",
    "====================",
    "",
    "Arabic:",
    "لاستيراد هذه الملفات في Power BI Desktop:",
    "1. افتح Power BI Desktop",
    "2. الصفحة الرئيسية > الحصول على البيانات > نص/CSV",
    `3. انتقل إلى مجلد '5-system/powerbi-export/${month}/'`,
    "4. افتح كل ملف CSV واضغط 'تحميل'",
    "5. في نموذج البيانات، يمكنك إنشاء علاقات بين الجداول باستخدام عمود xrayImageId",
    "",
    "English:",
    "To import these files into Power BI Desktop:",
    "1. Open Power BI Desktop",
    "2. Home > Get Data > Text/CSV",
    `3. Browse to '5-system/powerbi-export/${month}/'`,
    "4. Open each CSV file and click 'Load'",
    "5. In the Data Model, create relationships between tables using the xrayImageId column",
    "",
    "Files in this export:",
    ...files.map((f) => `  - ${f.fileName} (${f.rowCount} rows)`),
    "",
    `Exported at: ${new Date().toISOString()}`,
  ].join("\n");

  await writeTextFile(dir, "README.txt", instructions);
```

- [ ] **Step 4: Update the UI hint in `Reports/index.tsx`**

Replace:

```tsx
            const relPath = `5-System\\powerbi-export\\${pbiResult.month}`;
```

with:

```tsx
            const relPath = `5-system\\powerbi-export\\${pbiResult.month}`;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/powerbiExport/exportWriter.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/data/powerbiExport/exportWriter.ts src/data/powerbiExport/exportWriter.test.ts src/components/Sidebar/Tabs/Reports/index.tsx
git commit -m "refactor(powerbi-export): lowercase system root, rename LISEZMOI.txt to README.txt"
```

---

### Task 7: Centralize unchanged-value folder names — user-presets, feedback, designs

**Files:**
- Modify: `src/data/preferences/browsePresetStorage.ts`
- Modify: `src/data/feedback/feedbackStorage.ts`
- Modify: `src/data/reportDesigner/storage/reportDesignStorage.ts`

**Interfaces:**
- Consumes: `SYSTEM_FOLDER_NAMES`, `REPORTS_SUBFOLDERS` from `workspacePaths.ts` (Task 1).
- Produces: no folder-name *value* changes (all three already matched the target convention) — only removes the duplicated local `const` definitions so the names have one source of truth.

- [ ] **Step 1: Update `browsePresetStorage.ts`**

Replace:

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { BrowseDatasetKind } from "../population/populationStorage";
import { getSystemRoot } from "../workspace/workspacePaths";

const USER_PRESETS_FOLDER = "user-presets";
const ADMIN_SHARED_PRESET_FILE = "admin-shared.browse-preset.json";
```

with:

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { BrowseDatasetKind } from "../population/populationStorage";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";

const ADMIN_SHARED_PRESET_FILE = "admin-shared.browse-preset.json";
```

Replace:

```ts
async function getPresetDir(
  directoryHandle: DirectoryHandleLike,
  create: boolean
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, create);
  return systemDir.getDirectoryHandle(USER_PRESETS_FOLDER, { create });
}
```

with:

```ts
async function getPresetDir(
  directoryHandle: DirectoryHandleLike,
  create: boolean
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, create);
  return systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.userPresets, { create });
}
```

- [ ] **Step 2: Update `feedbackStorage.ts`**

Replace:

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile, writeJsonFile } from "../storage/fileSystemAccess";
```

with:

```ts
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile, writeJsonFile } from "../storage/fileSystemAccess";
import { SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
```

Replace:

```ts
const FEEDBACK_FOLDER = "feedback";
const MESSAGES_FILE = "messages.json";

async function getFeedbackDir(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return dir.getDirectoryHandle(FEEDBACK_FOLDER, { create: true });
}
```

with:

```ts
const MESSAGES_FILE = "messages.json";

async function getFeedbackDir(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return dir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: true });
}
```

Note: `feedbackStorage.ts` calls `getFeedbackDir(dir)` where `dir` today is passed in already scoped — check the call sites still pass the **system root** (not the workspace root) so `SYSTEM_FOLDER_NAMES.feedback` resolves under `5-system/feedback/` as before. This function's contract (a `DirectoryHandleLike` scoped to wherever `feedback/` should live) is unchanged by this edit — only the constant's source moved.

- [ ] **Step 3: Update `reportDesignStorage.ts`**

Replace:

```ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { withResourceLock } from "../../storage/webLocks";
import { getReportsRoot } from "../../workspace/workspacePaths";
import type { ReportDocument } from "../reportTypes";

const INDEX_FILE = "designs.index.json";
```

with:

```ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { withResourceLock } from "../../storage/webLocks";
import { getReportsRoot, REPORTS_SUBFOLDERS } from "../../workspace/workspacePaths";
import type { ReportDocument } from "../reportTypes";

const INDEX_FILE = "designs.index.json";
```

Replace:

```ts
async function getDesignsDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  const reports = await getReportsRoot(directoryHandle, true);
  return reports.getDirectoryHandle("designs", { create: true });
}
```

with:

```ts
async function getDesignsDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  const reports = await getReportsRoot(directoryHandle, true);
  return reports.getDirectoryHandle(REPORTS_SUBFOLDERS.designs, { create: true });
}
```

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `npm run test:run`
Expected: All tests PASS — these three files have no dedicated test file and no folder-name value changed, so this step is a regression check, not new coverage.

- [ ] **Step 5: Commit**

```bash
git add src/data/preferences/browsePresetStorage.ts src/data/feedback/feedbackStorage.ts src/data/reportDesigner/storage/reportDesignStorage.ts
git commit -m "refactor: centralize user-presets/feedback/designs folder names, no value change"
```

---

### Task 8: Backups folder + templates root casing + selection file rename

**Files:**
- Modify: `src/data/backup/backupStorage.ts`
- Modify: `src/data/templates/templateStorage.test.ts`
- Modify: `src/data/templates/templateSelectionStorage.ts`

**Interfaces:**
- Consumes: `SYSTEM_FOLDER_NAMES` from `workspacePaths.ts` (Task 1).
- Produces: backups now live at `5-system/backups/` (was `5-System/3-Backups/`); template selection file renamed `active.inspection-template.json` → `template.selection.json`.

- [ ] **Step 1: Update `backupStorage.ts`**

Replace:

```ts
import {
  getPopulationMonthDir,
  getSampleMainDir,
  getSystemRoot,
  getTemplatesRoot,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";

const BACKUPS_FOLDER = "3-Backups";
```

with:

```ts
import {
  getPopulationMonthDir,
  getSampleMainDir,
  getSystemRoot,
  getTemplatesRoot,
  SYSTEM_FOLDER_NAMES,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";

const BACKUPS_FOLDER = SYSTEM_FOLDER_NAMES.backups;
```

(`BACKUPS_FOLDER` stays as a local alias since it's referenced at two call sites in the file — only its source changes from a literal to the central constant, so no other line in `backupStorage.ts` needs to change.)

- [ ] **Step 2: Update `templateStorage.test.ts`**

Replace:

```ts
    const templatesDir = await root.getDirectoryHandle("6-Templates", {
      create: false,
    });
```

with:

```ts
    const templatesDir = await root.getDirectoryHandle("6-templates", {
      create: false,
    });
```

- [ ] **Step 3: Run test to verify it fails, then update `templateSelectionStorage.ts`**

Run: `npx vitest run src/data/templates/templateStorage.test.ts`
Expected: FAIL — `deleteTemplate` still writes its backup under `6-Templates`.

Replace:

```ts
const SELECTION_FILE = "active.inspection-template.json";
```

with:

```ts
const SELECTION_FILE = "template.selection.json";
```

(This file has no dedicated test — `SELECTION_FILE` is only read/written internally via `loadInspectionTemplateSelection`/`saveInspectionTemplateSelection`, so renaming the constant's value is self-consistent and needs no other call-site change.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/templates/templateStorage.test.ts`
Expected: PASS (4 tests)

Run: `npm run test:run`
Expected: All tests PASS (confirms `backupStorage.ts`'s edit didn't break anything — it has no dedicated test file).

- [ ] **Step 5: Commit**

```bash
git add src/data/backup/backupStorage.ts src/data/templates/templateStorage.test.ts src/data/templates/templateSelectionStorage.ts
git commit -m "refactor: lowercase backups folder, rename template selection file"
```

---

### Task 9: Documentation — `data-system-report.md`, `CLAUDE.md`, `README.md`

**Files:**
- Modify: `docs/data-system-report.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/EDIT_LOG.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update `docs/data-system-report.md`**

Replace the "Workspace Folder Data" table:

```
| `1-Population/` | Monthly population runs, source import data, final processed population, processing summaries, population config. |
| `2-Samples/` | Sample master files, distribution log/current snapshot, main sample mirrors, per-employee sample mirrors, answers, referral/replacement requests, supervisor approval decisions. |
| `3-User Data/` | Workspace user/permission files when initialized through workspace defaults. |
| `4-Reports/` | Generated/report artifacts when report flows write to the workspace. |
| `5-System/` | Backups, browse/table presets, automatic-backup settings/state, activity audit log, internal system files. |
| `6-Templates/` | Inspection templates and template index/selection files. |
```

with:

```
| `1-population/` | Monthly population runs, source import data, final processed population, processing summaries, population config. |
| `2-samples/` | Sample master files, distribution log/current snapshot, main sample mirrors, per-employee sample mirrors, answers, referral/replacement requests, supervisor approval decisions. |
| `3-user-data/` | Workspace user/permission files when initialized through workspace defaults. |
| `4-reports/` | Generated/report artifacts when report flows write to the workspace. |
| `5-system/` | Backups, browse/table presets, automatic-backup settings/state, activity audit log, internal system files. |
| `6-templates/` | Inspection templates and template index/selection files. |
```

Replace the "Population And Sample Files" table rows (paths only — file names inside are unchanged except the two noted):

```
| `month.manifest.json` | `1-Population/{month}/` | Month metadata: month/year, processed counts, status, operator info. |
| `risk.raw.json` | `1-Population/{month}/raw/` or legacy month folder | Imported risk rows. |
| `bi.raw.json` | `1-Population/{month}/raw/` or legacy month folder | Imported BI rows when provided. |
| `population.final.json` | `1-Population/{month}/processed/` or legacy month folder | Final processed population rows used for sampling and reporting. |
| `processing.summary.json` | `1-Population/{month}/processed/` | Processing summary/validation data. |
| `sample.master.json` | `2-Samples/{month}/1-Main/` | Drawn sample rows and sample configuration/result metadata. |
| `distribution.log.json` | `2-Samples/{month}/1-Main/` | Append-only assignment event log. |
| `distribution.current.json` | `2-Samples/{month}/1-Main/` | Derived current distribution snapshot. |
| `main.samples.json` | `2-Samples/{month}/1-Main/` | Mirror of all assigned sample entries. |
| `{username}.samples.json` | `2-Samples/{month}/2-Employees/` | Per-employee sample mirror. |
| `{username}.answers.json` | `2-Samples/{month}/2-Employees/` | Employee answers plus referral/replacement requests for that employee. |
| `{supervisor}.decisions.json` | `2-Samples/{month}/3-Approvals/` | Supervisor referral/replacement decisions. |
| `auth-activity.log.json` | `5-System/2-Audit/` | Sign-in and working-hours audit log. |
```

with:

```
| `month.manifest.json` | `1-population/{month}/` | Month metadata: month/year, processed counts, status, operator info. |
| `risk.raw.json` | `1-population/{month}/1-raw/` or legacy month folder | Imported risk rows. |
| `bi.raw.json` | `1-population/{month}/1-raw/` or legacy month folder | Imported BI rows when provided. |
| `population.final.json` | `1-population/{month}/2-processed/` or legacy month folder | Final processed population rows used for sampling and reporting. |
| `processing.summary.json` | `1-population/{month}/2-processed/` | Processing summary/validation data. |
| `sample.master.json` | `2-samples/{month}/1-main/` | Drawn sample rows and sample configuration/result metadata. |
| `distribution.log.json` | `2-samples/{month}/1-main/` | Append-only assignment event log. |
| `distribution.current.json` | `2-samples/{month}/1-main/` | Derived current distribution snapshot. |
| `main.samples.json` | `2-samples/{month}/1-main/` | Mirror of all assigned sample entries. |
| `{username}.samples.json` | `2-samples/{month}/2-employees/` | Per-employee sample mirror. |
| `{username}.answers.json` | `2-samples/{month}/2-employees/` | Employee answers plus referral/replacement requests for that employee. |
| `{supervisor}.decisions.json` | `2-samples/{month}/3-approvals/` | Supervisor referral/replacement decisions. |
| `activity.log.json` | `5-system/audit/` | Sign-in and working-hours audit log. |
```

Update the month-folder pattern example. Replace:

```
Month folder names follow the pattern `{month}-{MonthName-en}-{year}` (e.g. `5-May-2026`).
```

with:

```
Month folder names follow the pattern `{month}-{monthname-en}-{year}`, lowercase (e.g. `5-may-2026`).
```

Replace the template-selection sentence:

```
The default template created from the Template Builder is named `نموذج ضمان جودة الأشعة`, version `1`. It covers employee inspection answers for each assigned X-ray sample. The template is saved as a normal template file in `6-Templates/{templateId}.json`, listed in `templates.index.json`, and can be selected through `inspection-template-selection.json`.
```

with:

```
The default template created from the Template Builder is named `نموذج ضمان جودة الأشعة`, version `1`. It covers employee inspection answers for each assigned X-ray sample. The template is saved as a normal template file in `6-templates/{templateId}.json`, listed in `templates.index.json`, and can be selected through `template.selection.json`.
```

Replace the "4-Reports/designs/" section header and its table:

```
## 4-Reports/designs/

Report Designer saves and loads user-created report designs under this sub-folder.

| File or Pattern | Location | Purpose |
| --- | --- | --- |
| `designs.index.json` | `4-Reports/designs/` | Index of all saved report designs (`JsonEnvelope<DesignIndex>`). Lists each design's `reportId`, `reportName`, `version`, and `updatedAt`. |
| `{reportId}.json` | `4-Reports/designs/` | Individual `ReportDocument` persisted as `JsonEnvelope<ReportDocument>`. Contains the full document: theme, pages, and all canvas elements (text, shape, image). |
```

with:

```
## 4-reports/designs/

Report Designer saves and loads user-created report designs under this sub-folder.

| File or Pattern | Location | Purpose |
| --- | --- | --- |
| `designs.index.json` | `4-reports/designs/` | Index of all saved report designs (`JsonEnvelope<DesignIndex>`). Lists each design's `reportId`, `reportName`, `version`, and `updatedAt`. |
| `{reportId}.json` | `4-reports/designs/` | Individual `ReportDocument` persisted as `JsonEnvelope<ReportDocument>`. Contains the full document: theme, pages, and all canvas elements (text, shape, image). |
```

Replace the "Templates, Preferences, Backups" table:

```
| `templates.index.json` | `6-Templates/` | Template list and latest versions. |
| `{templateId}.json` | `6-Templates/` | Inspection template schema and fields. |
| `inspection-template-selection.json` | `6-Templates/` | Selected active inspection template. |
| `admin-shared.browse-preset.json` | `5-System/user-presets/` | Shared/admin table column preferences. |
| `{username}.browse-preset.json` | `5-System/user-presets/` | User-specific table column preferences. |
| `backup.manifest.json` and copied data files | `5-System/3-Backups/{timestamp}/` | Manual/automatic backup snapshots. |
| `population.csv` | `5-System/powerbi-export/{month}/` | All `ExecutiveReportRow` records (UTF-8 BOM CSV, 26 columns). |
| `sample.csv` | `5-System/powerbi-export/{month}/` | `selectedInSample=true` subset of `population.csv`. |
| `LISEZMOI.txt` | `5-System/powerbi-export/{month}/` | Bilingual connection instructions (Arabic + English) for Power BI Desktop. |
```

with:

```
| `templates.index.json` | `6-templates/` | Template list and latest versions. |
| `{templateId}.json` | `6-templates/` | Inspection template schema and fields. |
| `template.selection.json` | `6-templates/` | Selected active inspection template. |
| `admin-shared.browse-preset.json` | `5-system/user-presets/` | Shared/admin table column preferences. |
| `{username}.browse-preset.json` | `5-system/user-presets/` | User-specific table column preferences. |
| `backup.manifest.json` and copied data files | `5-system/backups/{timestamp}/` | Manual/automatic backup snapshots. |
| `population.csv` | `5-system/powerbi-export/{month}/` | All `ExecutiveReportRow` records (UTF-8 BOM CSV, 26 columns). |
| `sample.csv` | `5-system/powerbi-export/{month}/` | `selectedInSample=true` subset of `population.csv`. |
| `README.txt` | `5-system/powerbi-export/{month}/` | Bilingual connection instructions (Arabic + English) for Power BI Desktop. |
```

Also update the legacy-folders line near the top of the doc. Replace:

```
Legacy folders still read when present: `Population/`, `.system/`, and `templates/`.
```

Leave this line unchanged — it correctly still describes the pre-numbering legacy fallback, which is untouched by this plan.

- [ ] **Step 2: Update `CLAUDE.md`**

In the "Disk layout (workspace folder)" section, replace:

```
1-Population/
  {month}-{MonthName-en}-{year}/   ← e.g. 5-May-2026 (legacy: files flat in folder)
    month.manifest.json
    raw/        risk.raw.json, bi.raw.json (BI only if present)
    processed/  population.final.json, processing.summary.json
2-Samples/
  {month}/1-Main/   sample.master.json, distribution.log.json (append-only),
                    distribution.current.json (derived), main.samples.json
  {month}/…        per-employee sample mirrors, answers, referral/replacement, approvals
3-User Data/       workspace user/permission files (when initialized via workspace defaults)
4-Reports/         generated report artifacts (when report flows write to disk)
5-System/          backups/, browse & table presets, auto-backup settings/state, activity audit log
6-Templates/       {templateId}.json, templates.index.json, template selection
```

with:

```
1-population/
  {month}-{monthname-en}-{year}/   ← e.g. 5-may-2026 (legacy: files flat in folder)
    month.manifest.json
    1-raw/       risk.raw.json, bi.raw.json (BI only if present)
    2-processed/ population.final.json, processing.summary.json
2-samples/
  {month}/1-main/   sample.master.json, distribution.log.json (append-only),
                    distribution.current.json (derived), main.samples.json
  {month}/…        per-employee sample mirrors, answers, referral/replacement, approvals
3-user-data/       workspace user/permission files (when initialized via workspace defaults)
4-reports/         generated report artifacts (when report flows write to disk)
5-system/          backups/, browse & table presets, auto-backup settings/state, activity audit log
6-templates/       {templateId}.json, templates.index.json, template selection
```

Replace:

```
Month folder names follow the pattern `{month}-{MonthName-en}-{year}` (e.g. `5-May-2026`).
```

with:

```
Month folder names follow the pattern `{month}-{monthname-en}-{year}`, lowercase (e.g. `5-may-2026`).
```

- [ ] **Step 3: Update `README.md`**

Replace the "Workspace Folder Layout" tree:

```
Root (user picks this folder)
├── 1-Population/
│   └── {MM-MonthName-YYYY}/          # One folder per processed month
│       ├── month.manifest.json
│       ├── risk.raw.json
│       ├── population.final.json
│       ├── bi.raw.json                # Optional, only if BI rows present
│       ├── sample/
│       │   └── sample.master.json
│       ├── distribution.log.json      # Append-only event log
│       ├── distribution.current.json  # Derived snapshot
│       └── employee-answers/
│           └── {username}.answers.json
├── 2-Samples/
│   └── {MM-MonthName-YYYY}/
│       ├── main.samples.json
│       └── {username}.samples.json
├── 3-User Data/
│   ├── users-permissions.json
│   └── managed-users.json
├── 6-Templates/
│   ├── {templateId}.json
│   └── templates.index.json
└── 5-System/
    └── backups/
        └── {YYYY-MM-DDTHH-MM-SS}/    # Backup snapshots
```

with:

```
Root (user picks this folder)
├── 1-population/
│   └── {MM-monthname-YYYY}/          # One folder per processed month
│       ├── month.manifest.json
│       ├── 1-raw/
│       │   ├── risk.raw.json
│       │   └── bi.raw.json            # Optional, only if BI rows present
│       ├── 2-processed/
│       │   └── population.final.json
│       ├── distribution.log.json      # Append-only event log
│       └── distribution.current.json  # Derived snapshot
├── 2-samples/
│   └── {MM-monthname-YYYY}/
│       ├── 1-main/
│       │   ├── sample.master.json
│       │   └── main.samples.json
│       └── 2-employees/
│           └── {username}.samples.json
├── 3-user-data/
│   ├── users-permissions.json
│   └── managed-users.json
├── 6-templates/
│   ├── {templateId}.json
│   └── templates.index.json
└── 5-system/
    └── backups/
        └── {YYYY-MM-DDTHH-MM-SS}/    # Backup snapshots
```

Replace:

```
Month folder names follow the pattern `{month}-{MonthName-en}-{year}` (e.g., `5-May-2026`).
```

with:

```
Month folder names follow the pattern `{month}-{monthname-en}-{year}`, lowercase (e.g., `5-may-2026`).
```

- [ ] **Step 4: Add the `docs/EDIT_LOG.md` entry**

Read the current top of `docs/EDIT_LOG.md` first to find the latest version number, then prepend one new entry (major bump — this is an architectural rename touching every storage module) in this shape:

```markdown
## v{N} — 2026-07-01 — Consistent workspace file-structure naming

**File:** `src/data/workspace/workspacePaths.ts`

**Before:**
```ts
export const WORKSPACE_ROOTS = {
  population: "1-Population",
  samples: "2-Samples",
  userData: "3-User Data",
  reports: "4-Reports",
  system: "5-System",
  templates: "6-Templates",
} as const;
```

**After:**
```ts
export const WORKSPACE_ROOTS = {
  population: "1-population",
  samples: "2-samples",
  userData: "3-user-data",
  reports: "4-reports",
  system: "5-system",
  templates: "6-templates",
} as const;

export const POPULATION_SUBFOLDERS = { raw: "1-raw", processed: "2-processed" } as const;
export const SAMPLE_SUBFOLDERS = { main: "1-main", employees: "2-employees", approvals: "3-approvals" } as const;
export const SYSTEM_FOLDER_NAMES = {
  locks: "locks", audit: "audit", backups: "backups",
  powerbiExport: "powerbi-export", userPresets: "user-presets", feedback: "feedback",
} as const;
export const REPORTS_SUBFOLDERS = { designs: "designs" } as const;
```

**File:** `src/data/population/monthFolder.ts`

**Before:**
```ts
return `${month}-${monthName}-${year}`;
```

**After:**
```ts
return `${month}-${monthName.toLowerCase()}-${year}`;
```

**File:** `src/data/templates/templateSelectionStorage.ts`

**Before:**
```ts
const SELECTION_FILE = "active.inspection-template.json";
```

**After:**
```ts
const SELECTION_FILE = "template.selection.json";
```

**File:** `src/auth/authActivityLog.ts`

**Before:**
```ts
const ACTIVITY_AUDIT_FOLDER = "2-Audit";
const ACTIVITY_LOG_FILE = "auth-activity.log.json";
```

**After:**
```ts
const ACTIVITY_LOG_FILE = "activity.log.json"; // folder now SYSTEM_FOLDER_NAMES.audit ("audit")
```

**File:** `src/data/powerbiExport/exportWriter.ts`

**Before:**
```ts
await writeTextFile(dir, "LISEZMOI.txt", instructions);
```

**After:**
```ts
await writeTextFile(dir, "README.txt", instructions);
```

Also touched (folder-name literals replaced with central constants, no behavior change beyond the rename): `workspaceDefaults.ts`, `fileSystemAccess.ts`, `populationStorage.ts`, `browsePresetStorage.ts`, `feedbackStorage.ts`, `reportDesignStorage.ts`, `backupStorage.ts`, and the corresponding `*.test.ts` files. No data migration — greenfield, no production workspaces existed with the old names. Full target tree documented in `docs/superpowers/specs/2026-07-01-workspace-file-structure-naming-design.md`.
```

- [ ] **Step 5: Commit**

```bash
git add docs/data-system-report.md CLAUDE.md README.md docs/EDIT_LOG.md
git commit -m "docs: reflect renamed workspace file structure"
```

---

### Task 10: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: All tests pass, zero failures.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors (no unused-import warnings from removed local `const`s like `USER_PRESETS_FOLDER`, `FEEDBACK_FOLDER`, `ACTIVITY_AUDIT_FOLDER`).

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: Succeeds, produces a single `dist/index.html`.

- [ ] **Step 4: Grep for leftover old-name literals**

Run:
```bash
grep -rnE '"1-Population"|"2-Samples"|"3-User Data"|"4-Reports"|"5-System"|"6-Templates"|"1-Main"|"2-Employees"|"3-Approvals"|"2-Audit"|"1-Locks"|"3-Backups"|LISEZMOI|inspection-template-selection|auth-activity\.log\.json' src/
```
Expected: No matches (except possibly inside `LEGACY_ROOTS`-adjacent comments, which don't use these exact old names — confirm any hit is investigated, not blindly ignored).

- [ ] **Step 5: Report completion**

No commit needed for this task — it's verification only. If any step fails, return to the relevant task and fix before proceeding.
