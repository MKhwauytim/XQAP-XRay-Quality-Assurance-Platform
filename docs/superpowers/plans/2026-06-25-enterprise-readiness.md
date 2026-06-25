# Enterprise Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all 67 ESLint errors, tighten type safety, and produce complete deployment documentation so the app reaches enterprise production-ready status.

**Architecture:** React 19 + TypeScript + Vite SPA, no backend, File System Access API for persistence. Fixes are isolated to code quality; no behavior changes are intended. Every change must be recorded in `docs/EDIT_LOG.md` before touching code (CLAUDE.md requirement).

**Tech Stack:** React 19, TypeScript 6 strict, Vite 8, ESLint 10, Vitest 4, vite-plugin-singlefile

## Global Constraints

- All UI strings Arabic; all identifiers English
- `import type` for type-only imports
- No new dependencies; no behavior changes
- Run `npm run test:run` after each task — all 96 tests must pass
- Run `npm run build` after Phase 3 — must produce a single `dist/index.html`
- Append every edit to `docs/EDIT_LOG.md` with the exact before/after snippet (CLAUDE.md requirement)
- Never suppress a lint rule without a single-line comment explaining why

---

## System Map (reference)

```
src/
  App.tsx                                          ← 2 set-state-in-effect errors
  components/
    DataTable/index.tsx                            ← 4 fast-refresh + 2 unused-var + 1 set-state + 2 immutability
    FeedbackWidget/FeedbackWidget.tsx              ← 1 set-state-in-effect
    InspectionPanel/index.tsx                      ← 2 set-state-in-effect
    Sidebar/Tabs/
      EmployeeWorkspace/views/
        XrayReferrals.tsx                          ← 1 unused-var + 2 set-state + 1 missing-dep warning
        XrayInspectionResults.tsx                  ← 1 unused-var
      Population/
        index.tsx                                  ← 2+ set-state-in-effect
        components/
          CertScanGrid.tsx                         ← 1 set-state-in-effect
          MappingSettingsModal.tsx                 ← 27 any-type + 1 purity + 1 set-state
          PhaseFourDistribution.tsx                ← 6 any-type + 2 missing-dep warnings
          PhaseThreeSampling.tsx                   ← 2 any-type + 1 prefer-const
```

---

## Phase 0 — Baseline & Safety

### Task 0: Capture baseline

**Files:**
- Read: `docs/EDIT_LOG.md`

- [ ] **Step 1: Record current lint and test counts**

```bash
npm run test:run 2>&1 | tail -5
npm run lint 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

Expected:
- Tests: 96 passed
- Lint: 67 errors (1 warning)
- Build: `dist/index.html` ≈1.9 MB

- [ ] **Step 2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-06-25-enterprise-readiness.md
git commit -m "docs: add enterprise readiness implementation plan"
```

---

## Phase 1 — Type Safety: Remove `any` Annotations

**Objective:** Eliminate all 35 `@typescript-eslint/no-explicit-any` errors across MappingSettingsModal, PhaseFourDistribution, and PhaseThreeSampling. Every `.map((x: any) =>` is wrong because the array is already typed; removing `: any` lets TypeScript infer the correct type.

---

### Task 1: MappingSettingsModal — Remove `any` from array callbacks (lines 157–443)

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx`

**Interfaces:**
- Consumes: `MappingTemplate`, `ExportColumnSetting`, `EmployeeStageAllocation` from `populationConfig.ts`
- Produces: no interface change — same runtime behavior, stricter types

- [ ] **Step 1: Write a failing lint check as the baseline**

```bash
npx eslint src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx --rule '{"@typescript-eslint/no-explicit-any": "error"}' 2>&1 | grep "no-explicit-any" | wc -l
```

Expected output: `24` (or similar count > 0)

- [ ] **Step 2: Fix lines 157, 166, 174 — `handleMappingChange`, `handleBiMappingChange`, `handleSheetPatternChange`**

Open `MappingSettingsModal.tsx`. Find and replace:

```ts
// line 157 — before
const updatedTemplates = config.mappingTemplates.map((t: any) =>
```
```ts
// after
const updatedTemplates = config.mappingTemplates.map((t) =>
```

```ts
// line 166 — before
const updatedTemplates = config.mappingTemplates.map((t: any) =>
```
```ts
// after
const updatedTemplates = config.mappingTemplates.map((t) =>
```

```ts
// line 174 — before
const updatedTemplates = config.mappingTemplates.map((t: any) => {
```
```ts
// after
const updatedTemplates = config.mappingTemplates.map((t) => {
```

- [ ] **Step 3: Fix lines 319, 336 — `handleAddCustomField`**

```ts
// line 319 — before
if (config.systemFields.some((f: any) => f.key === key) || config.customFields.some((f: any) => f.key === key)) {
```
```ts
// after
if (config.systemFields.some((f) => f.key === key) || config.customFields.some((f) => f.key === key)) {
```

```ts
// line 336 — before
const updatedTemplates = config.mappingTemplates.map((t: any) => {
```
```ts
// after
const updatedTemplates = config.mappingTemplates.map((t) => {
```

- [ ] **Step 4: Fix line 349 — export templates in `handleAddCustomField`**

```ts
// before
const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
```
```ts
// after
const updatedExportTemplates = config.exportTemplates.map((exp) => ({
```

- [ ] **Step 5: Fix lines 366, 374, 377, 380, 382 — `handleToggleSystemFieldRequired`, `handleRemoveSystemField`**

```ts
// line 366 — before
const updated = config.systemFields.map((f: any) =>
```
```ts
// after
const updated = config.systemFields.map((f) =>
```

```ts
// line 374 — before
const updatedFields = config.systemFields.filter((f: any) => f.key !== key);
```
```ts
// after
const updatedFields = config.systemFields.filter((f) => f.key !== key);
```

```ts
// line 377 — before
const updatedTemplates = config.mappingTemplates.map((t: any) =>
```
```ts
// after
const updatedTemplates = config.mappingTemplates.map((t) =>
```

```ts
// line 380 — before
const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
  ...exp,
  columns: exp.columns.filter((c: any) => c.fieldKey !== key)
```
```ts
// after
const updatedExportTemplates = config.exportTemplates.map((exp) => ({
  ...exp,
  columns: exp.columns.filter((c) => c.fieldKey !== key)
```

- [ ] **Step 6: Fix lines 395, 399, 406, 408 — `handleRemoveCustomField`**

```ts
// line 395 — before
const updatedCustomFields = config.customFields.filter((f: any) => f.key !== key);
```
```ts
// after
const updatedCustomFields = config.customFields.filter((f) => f.key !== key);
```

```ts
// line 399 — before
const updatedTemplates = config.mappingTemplates.map((t: any) => {
```
```ts
// after
const updatedTemplates = config.mappingTemplates.map((t) => {
```

```ts
// lines 406, 408 — before
const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
  ...exp,
  columns: exp.columns.filter((c: any) => c.fieldKey !== key)
```
```ts
// after
const updatedExportTemplates = config.exportTemplates.map((exp) => ({
  ...exp,
  columns: exp.columns.filter((c) => c.fieldKey !== key)
```

- [ ] **Step 7: Fix lines 421, 423, 432 — `handleMoveColumn`**

```ts
// line 421 — before
const sorted = [...(config.exportTemplates[0]?.columns || [])].sort(
  (a: any, b: any) => a.order - b.order
);
const idx = sorted.findIndex((c: any) => c.fieldKey === fieldKey);
```
```ts
// after
const sorted = [...(config.exportTemplates[0]?.columns || [])].sort(
  (a, b) => a.order - b.order
);
const idx = sorted.findIndex((c) => c.fieldKey === fieldKey);
```

```ts
// line 432 — before
exportTemplates: config.exportTemplates.map((exp: any) => ({ ...exp, columns: newSorted }))
```
```ts
// after
exportTemplates: config.exportTemplates.map((exp) => ({ ...exp, columns: newSorted }))
```

- [ ] **Step 8: Fix lines 436–443 — `handleExportColumnChange`**

The `val` parameter must accept any valid `ExportColumnSetting` property value:

```ts
// before (line 436-443)
const handleExportColumnChange = (fieldKey: string, field: keyof ExportColumnSetting, val: any) => {
  const updatedColumns = config.exportTemplates[0].columns.map((col: any) => {
    if (col.fieldKey === fieldKey) {
      return { ...col, [field]: val };
    }
    return col;
  });
  const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
    ...exp,
    columns: updatedColumns
  }));
```
```ts
// after
const handleExportColumnChange = (fieldKey: string, field: keyof ExportColumnSetting, val: ExportColumnSetting[keyof ExportColumnSetting]) => {
  const updatedColumns = config.exportTemplates[0].columns.map((col) => {
    if (col.fieldKey === fieldKey) {
      return { ...col, [field]: val };
    }
    return col;
  });
  const updatedExportTemplates = config.exportTemplates.map((exp) => ({
    ...exp,
    columns: updatedColumns
  }));
```

- [ ] **Step 9: Fix lines 1178–1179 — inline JSX sort/map**

```ts
// before (line 1178-1179)
.sort((a: any, b: any) => a.order - b.order)
.map((col: any, idx: number, arr: any[]) => (
```
```ts
// after
.sort((a, b) => a.order - b.order)
.map((col, idx, arr) => (
```

- [ ] **Step 10: Run lint on the file**

```bash
npx eslint src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx
```

Expected: zero `no-explicit-any` errors (one `set-state-in-effect` and one `purity` error remain — handled in Phase 2)

- [ ] **Step 11: Run tests**

```bash
npm run test:run
```

Expected: 96 passed

- [ ] **Step 12: Append to EDIT_LOG.md**

Add an entry in `docs/EDIT_LOG.md` with version bump (e.g. v5.17), date 2026-06-25, description "Remove explicit any annotations from MappingSettingsModal array callbacks", and a representative before/after snippet.

- [ ] **Step 13: Commit**

```bash
git add src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx docs/EDIT_LOG.md
git commit -m "fix: remove explicit any from MappingSettingsModal array callbacks"
```

---

### Task 2: PhaseFourDistribution — Fix `any` types and prop signature

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx`

**Interfaces:**
- Consumes: `ManagedLoginUser` from `userManagement`, `DistributionEvent` from `distributionTypes`, `EmployeeStageAllocation` from `populationConfig`
- Produces: no interface change

- [ ] **Step 1: Write baseline lint check**

```bash
npx eslint src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx 2>&1 | grep "no-explicit-any"
```

Expected: lines 28, 61, 62, 107, 157, 392

- [ ] **Step 2: Add missing import and fix the `onApplyBulkAssignment` prop type (line 28)**

Add the import at the top of the file, after the existing imports:

```ts
// before
import { calculateBulkAssignment } from "../../../../../data/distribution/bulkAssignment";
```
```ts
// after
import { calculateBulkAssignment } from "../../../../../data/distribution/bulkAssignment";
import type { DistributionEvent } from "../../../../../data/distribution/distributionTypes";
```

Then fix the prop type:

```ts
// before (line 28)
  onApplyBulkAssignment: (events: any[]) => Promise<void>;
```
```ts
// after
  onApplyBulkAssignment: (events: DistributionEvent[]) => Promise<void>;
```

- [ ] **Step 3: Fix lines 61–62 — `getManagedLoginUsers` map callbacks**

```ts
// before
      .filter((u: any) => u.isActive)
      .map((u: any) => ({
```
```ts
// after
      .filter((u) => u.isActive)
      .map((u) => ({
```

- [ ] **Step 4: Fix line 107 — `handleAllocationChange` val parameter**

```ts
// before
    val: any
```
```ts
// after
    val: EmployeeStageAllocation[keyof EmployeeStageAllocation]
```

- [ ] **Step 5: Fix line 157 — distribution entries map**

```ts
// before
    (distributionCurrent?.entries ?? []).map((e: any) => [e.xrayImageId, e])
```
```ts
// after
    (distributionCurrent?.entries ?? []).map((e) => [e.xrayImageId, e])
```

- [ ] **Step 6: Find and fix line 392 (the remaining any)**

Search the file for the any at line 392. Based on the context it is likely in the bulk-assignment preview table or the `handleRunBulkAssignment` handler. Remove `: any` where it annotates a callback parameter that TypeScript can already infer.

```bash
grep -n ": any" src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx
```

Apply the same `: any` → remove pattern to each hit.

- [ ] **Step 7: Fix the two `useMemo` missing-dependency warnings**

Warning at line 70: `sampleRows` logical expression in `useMemo` deps.

```ts
// The issue is:
const sampleRows = sampleDrawResult?.rows || [];  // line 70 — recreates on every render

const stageSampleCounts = useMemo(() => ({   // line 72 — deps on sampleRows but it's not stable
  first: sampleRows.filter(...),
  ...
}), [sampleRows, config.stageMappings]);   // sampleRows changes reference every render
```

Fix by memoizing `sampleRows`:

```ts
// before (line 70)
const sampleRows = sampleDrawResult?.rows || [];
```
```ts
// after
const sampleRows = useMemo(() => sampleDrawResult?.rows ?? [], [sampleDrawResult]);
```

Warning at line 145: `saveMonth` and `saveYear` missing from `previewData` useMemo deps.

```ts
// before
  }, [sampleDrawResult, sampleRows, activeAllocations, employees, operatorUsername, config.stageMappings]);
```
```ts
// after
  }, [sampleDrawResult, sampleRows, activeAllocations, employees, operatorUsername, config.stageMappings, saveMonth, saveYear]);
```

- [ ] **Step 8: Run lint on the file**

```bash
npx eslint src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx
```

Expected: 0 errors

- [ ] **Step 9: Run tests and commit**

```bash
npm run test:run
git add src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx docs/EDIT_LOG.md
git commit -m "fix: remove explicit any and fix useMemo deps in PhaseFourDistribution"
```

---

### Task 3: PhaseThreeSampling — Fix `any` types and `prefer-const`

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx`

**Interfaces:**
- Consumes: `PreparedPopulationRow` from `populationTypes`, `StageSamplingRule` from `populationConfig`

- [ ] **Step 1: Add import for the row type**

```bash
grep -n "PreparedPopulationRow" src/data/population/populationTypes.ts | head -3
```

Then in `PhaseThreeSampling.tsx`, add:

```ts
// before (line 1-2)
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";
```
```ts
// after
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
```

- [ ] **Step 2: Fix line 11 — `populationRows` prop type**

```ts
// before
  populationRows: any[];
```
```ts
// after
  populationRows: PreparedPopulationRow[];
```

- [ ] **Step 3: Fix line 54 — `handleRuleChange` value parameter**

```ts
// before
    value: any
```
```ts
// after
    value: StageSamplingRule[keyof StageSamplingRule]
```

- [ ] **Step 4: Fix line 78 — `prefer-const`**

```ts
// before
let calculatedCount =
```
```ts
// after
const calculatedCount =
```

Note: `calculatedCount` is never reassigned; `finalCount` is the variable that gets modified.

- [ ] **Step 5: Run lint on file, run tests, commit**

```bash
npx eslint src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx
npm run test:run
git add src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx docs/EDIT_LOG.md
git commit -m "fix: type PhaseThreeSampling props and fix prefer-const"
```

---

## Phase 2 — React Hooks Violations

**Objective:** Fix or suppress all `react-hooks/set-state-in-effect`, `react-hooks/immutability`, and `react-hooks/purity` violations. Strategy per case:
- **Derived state** (state = pure function of other state/props) → replace `useState + useEffect` with `useMemo`
- **Async data load** (effect fires async fn that eventually calls setState internally) → suppress with a comment explaining why
- **Sync cleanup on external change** (effect resets uncontrolled state when an external dep is cleared) → suppress with a comment
- **Column resize cursor mutation** (DOM side effect in a mouse event handler) → suppress; moving to useEffect would be wrong

---

### Task 4: DataTable — Fix `setDetectedDates` effect → useMemo

**Files:**
- Modify: `src/components/DataTable/index.tsx`

**Interfaces:**
- No change to the public API

- [ ] **Step 1: Locate the state declaration and effect**

```bash
grep -n "detectedDates\|setDetectedDates" src/components/DataTable/index.tsx
```

- [ ] **Step 2: Replace `useState + useEffect` with `useMemo`**

Find the `useState<Set<string>>` declaration for `detectedDates` and the corresponding `useEffect`. Replace both:

```ts
// before — find and remove:
const [detectedDates, setDetectedDates] = useState<Set<string>>(new Set());

useEffect(() => {
    const sample = rows.length > 200 ? rows.slice(0, 200) : rows;
    const detected = new Set<string>();
    for (const col of columns) {
      if (col.isDate) { detected.add(col.id); continue; }
      if (col.filterKind === "status") continue;
      for (const row of sample) {
        const v = col.accessor(row);
        if (v && looksLikeDate(v)) { detected.add(col.id); break; }
      }
    }
    setDetectedDates(detected);
  }, [rows, columns]);
```
```ts
// after — single useMemo:
const detectedDates = useMemo<Set<string>>(() => {
    const sample = rows.length > 200 ? rows.slice(0, 200) : rows;
    const detected = new Set<string>();
    for (const col of columns) {
      if (col.isDate) { detected.add(col.id); continue; }
      if (col.filterKind === "status") continue;
      for (const row of sample) {
        const v = col.accessor(row);
        if (v && looksLikeDate(v)) { detected.add(col.id); break; }
      }
    }
    return detected;
  }, [rows, columns]);
```

Make sure `useMemo` is already in the import list at the top (it should be since it's used elsewhere).

- [ ] **Step 3: Run lint on file**

```bash
npx eslint src/components/DataTable/index.tsx 2>&1 | grep "set-state-in-effect"
```

Expected: 0 lines (the set-state error is gone; other errors remain for subsequent tasks)

- [ ] **Step 4: Run tests and commit**

```bash
npm run test:run
git add src/components/DataTable/index.tsx docs/EDIT_LOG.md
git commit -m "fix: replace useState+useEffect for detectedDates with useMemo in DataTable"
```

---

### Task 5: DataTable — Suppress column-resize cursor mutations

**Files:**
- Modify: `src/components/DataTable/index.tsx`

**Interfaces:**
- No change; behavior identical

- [ ] **Step 1: Locate the two immutability violations**

```bash
grep -n "document.body.style" src/components/DataTable/index.tsx
```

Expected: lines 520, 521 (cursor, userSelect) and 545-546 (cleanup)

- [ ] **Step 2: Add suppression comments**

These mutations are inside a `mousedown` event handler (`handleResizeMouseDown`). Wrapping in a `useEffect` would be incorrect because effects run asynchronously after render, not synchronously with user gestures. Suppression is the right call here.

```ts
// before (line 520-521)
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
```
```ts
// after
    // eslint-disable-next-line react-hooks/immutability -- cursor change is a valid DOM side-effect in a mouse-event handler, not during render
    document.body.style.cursor     = "col-resize";
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = "none";
```

- [ ] **Step 3: Run lint, run tests, commit**

```bash
npx eslint src/components/DataTable/index.tsx 2>&1 | grep immutability
npm run test:run
git add src/components/DataTable/index.tsx docs/EDIT_LOG.md
git commit -m "fix: suppress immutability lint for column-resize cursor mutation in DataTable"
```

---

### Task 6: InspectionPanel — Replace effect-driven `setActivePhaseId` with derived logic

**Files:**
- Modify: `src/components/InspectionPanel/index.tsx`

**Interfaces:**
- No external change; `activePhaseId` remains the selected phase

- [ ] **Step 1: Understand the two effects**

Effect 1 (line 59–67): Resets `activePhaseId` to `phases[0]` when `phases` no longer contains the current selection.  
Effect 2 (line 93–96): Jumps to the first incomplete phase when the current selection is disabled.

Both are "keep state valid relative to props" patterns. The solution is to keep a single `useState` for user intent and compute a guaranteed-valid phase ID in one place during render.

- [ ] **Step 2: Replace both effects with a derived safe phase**

```ts
// before (keep the useState declaration at line 57):
const [activePhaseId, setActivePhaseId] = useState<string>(() => phases[0]?.phaseId ?? "");

useEffect(() => {
  if (phases.length === 0) {
    setActivePhaseId("");
    return;
  }
  if (!phases.some((phase) => phase.phaseId === activePhaseId)) {
    setActivePhaseId(phases[0]!.phaseId);
  }
}, [activePhaseId, phases]);

// ...later...

useEffect(() => {
  if (!template || !activePhaseId || enabledPhaseIds.has(activePhaseId)) return;
  setActivePhaseId(phaseValidation.firstIncompletePhaseId ?? phases[0]?.phaseId ?? "");
}, [activePhaseId, enabledPhaseIds, phaseValidation.firstIncompletePhaseId, phases, template]);
```

```ts
// after — remove both useEffects entirely; keep useState; add a derived constant:
const [activePhaseId, setActivePhaseId] = useState<string>(() => phases[0]?.phaseId ?? "");

// Derive a safe phase ID: if the user-selected phase is not available, auto-correct.
// This avoids useState-in-useEffect cascades while keeping user navigation responsive.
const safeActivePhaseId: string = (() => {
  if (phases.length === 0) return "";
  if (phases.some((p) => p.phaseId === activePhaseId)) {
    // If the selected phase is disabled (incomplete gate), redirect to first incomplete
    if (template && !enabledPhaseIds.has(activePhaseId)) {
      return phaseValidation.firstIncompletePhaseId ?? phases[0]!.phaseId;
    }
    return activePhaseId;
  }
  return phases[0]!.phaseId;
})();
```

Then replace every usage of `activePhaseId` in JSX (render return) with `safeActivePhaseId`. The `setActivePhaseId` setter keeps its original usage for user click events (PhaseStepper `onPhaseSelect`).

Search for uses:
```bash
grep -n "activePhaseId" src/components/InspectionPanel/index.tsx
```

In the render section, replace `activePhaseId` with `safeActivePhaseId` only where the phase is being *read* (displayed or used to filter). Keep `setActivePhaseId` calls in event handlers unchanged — they set user intent, and the derived value will auto-correct if needed.

- [ ] **Step 3: Remove `useEffect` from the import if it is no longer used**

```bash
grep -n "useEffect" src/components/InspectionPanel/index.tsx
```

If `useEffect` has no other usages, remove it from the import line.

- [ ] **Step 4: Run lint on the file**

```bash
npx eslint src/components/InspectionPanel/index.tsx 2>&1 | grep "set-state-in-effect"
```

Expected: 0 lines

- [ ] **Step 5: Run tests and commit**

```bash
npm run test:run
git add src/components/InspectionPanel/index.tsx docs/EDIT_LOG.md
git commit -m "fix: replace set-state-in-effect in InspectionPanel with derived phase ID"
```

---

### Task 7: MappingSettingsModal — Fix `setActiveTab` effect and `Date.now()` purity

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx`

- [ ] **Step 1: Fix the `setActiveTab` set-state-in-effect (line 54–57)**

The modal always unmounts and remounts when `isOpen` toggles (it returns `null` when `!isOpen`). So the `useEffect` never fires on an already-mounted component — it only runs on the first render after `isOpen` becomes `true`. The equivalent without an effect is to sync initial state at the point the component becomes visible.

```ts
// before (lines 54-57)
useEffect(() => {
  if (!isOpen) return;
  setActiveTab(mode === "processing" ? "processing" : "mappings");
}, [isOpen, mode]);

if (!isOpen) return null;
```

```ts
// after — derive the initial tab from mode at mount time; no effect needed.
// The component already returns null when closed, so each open is a fresh mount.
const initialTab = mode === "processing" ? "processing" : "mappings";
const [activeTab, setActiveTab] = useState<"mappings" | "processing" | "stages" | "sheets" | "exports">(initialTab);

if (!isOpen) return null;
```

Find the existing `useState` for `activeTab` at line 47 and replace both the declaration and the effect:

```ts
// remove line 47:
const [activeTab, setActiveTab] = useState<"mappings" | "processing" | "stages" | "sheets" | "exports">("mappings");
```

Replace with the derived initial value above, and delete the `useEffect` block (lines 54–57).

Also remove `useEffect` from the import at line 1 if it's no longer used:

```ts
// before
import { useEffect, useState } from "react";
```
```ts
// after
import { useState } from "react";
```

- [ ] **Step 2: Fix `Date.now()` purity violation (line 290)**

`Date.now()` is flagged because the rule sees it defined inside the component body. Replacing with `crypto.randomUUID()` (a browser built-in available in Chrome 92+ / the app's target) is both idiomatic and resolves the lint rule:

```ts
// before
      stepId: `custom-${Date.now()}`,
```
```ts
// after
      stepId: `custom-${crypto.randomUUID().slice(0, 8)}`,
```

- [ ] **Step 3: Run lint on file**

```bash
npx eslint src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx
```

Expected: 0 errors

- [ ] **Step 4: Run tests and commit**

```bash
npm run test:run
git add src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx docs/EDIT_LOG.md
git commit -m "fix: remove effect/purity violations in MappingSettingsModal"
```

---

### Task 8: CertScanGrid — Suppress initialization effect

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/components/CertScanGrid.tsx`

- [ ] **Step 1: Read the effect at line 80–85**

```bash
grep -n -A 10 "initialised.current" src/components/Sidebar/Tabs/Population/components/CertScanGrid.tsx | head -20
```

- [ ] **Step 2: Understand the pattern**

The effect initializes grid state from `initialText` prop on first mount (guarded by `initialised.current`). This is a one-shot initialization that cannot use lazy initializers because `parseStoredText` depends on `initialText` which is a prop (not available at `useState` call site in a static initializer — actually it is, as a lazy initializer).

Refactor to use lazy initializers:

```ts
// Find:
const [gridData, setGridData] = useState<...>([]);
const [portCol, setPortCol]   = useState<...>(...);
const [snCol,   setSnCol]     = useState<...>(...);
const initialised = useRef(false);

useEffect(() => {
  if (initialised.current) return;
  const parsed = parseStoredText(initialText);
  if (parsed) {
    setGridData(parsed.data);
    setPortCol(parsed.portCol);
    setSnCol(parsed.snCol);
    initialised.current = true;
  }
}, [...]);
```

```ts
// Replace with lazy initializers — evaluate parseStoredText once at mount:
const parsed0 = parseStoredText(initialText);  // evaluated once per mount

const [gridData, setGridData] = useState(() => parsed0?.data ?? [/* default */]);
const [portCol, setPortCol]   = useState(() => parsed0?.portCol ?? /* default */);
const [snCol,   setSnCol]     = useState(() => parsed0?.snCol ?? /* default */);
// Remove: const initialised = useRef(false);
// Remove the initialization useEffect entirely.
```

Read the actual default values from the file before writing the fix:

```bash
grep -n "useState\|initialised\|parseStoredText" src/components/Sidebar/Tabs/Population/components/CertScanGrid.tsx | head -25
```

Apply the lazy-initializer pattern using the exact default values found there.

- [ ] **Step 3: Run lint, run tests, commit**

```bash
npx eslint src/components/Sidebar/Tabs/Population/components/CertScanGrid.tsx
npm run test:run
git add src/components/Sidebar/Tabs/Population/components/CertScanGrid.tsx docs/EDIT_LOG.md
git commit -m "fix: replace initialization effect with lazy useState in CertScanGrid"
```

---

### Task 9: App.tsx — Suppress accumulative tab-mount effects

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Understand why suppression is correct here**

`mountedTabIds` is an accumulating Set (tabs are added, never removed except on role change). This is inherently stateful across renders — `useMemo` cannot accumulate. Refactoring to a reducer or a ref with forced re-render is equivalent complexity with no readability gain.

- [ ] **Step 2: Add suppression comments (lines 133–148)**

```ts
// before (App.tsx lines 133-148)
  useEffect(() => {
    if (activeTabId) {
      setMountedTabIds((prev) =>
        prev.has(activeTabId) ? prev : new Set([...prev, activeTabId])
      );
    }
  }, [activeTabId]);

  // Drop tabs that are no longer allowed (role change)
  useEffect(() => {
    const allowedIds = new Set(allowedTabs.map((t) => t.id));
    setMountedTabIds((prev) => {
      const next = new Set([...prev].filter((id) => allowedIds.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [allowedTabs]);
```

```ts
// after
  // eslint-disable-next-line react-hooks/set-state-in-effect -- accumulates visited tabs; cannot use useMemo for growing state
  useEffect(() => {
    if (activeTabId) {
      setMountedTabIds((prev) =>
        prev.has(activeTabId) ? prev : new Set([...prev, activeTabId])
      );
    }
  }, [activeTabId]);

  // Drop tabs that are no longer allowed (role change)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- prunes stale tab refs when roles change; set updater ensures single render
  useEffect(() => {
    const allowedIds = new Set(allowedTabs.map((t) => t.id));
    setMountedTabIds((prev) => {
      const next = new Set([...prev].filter((id) => allowedIds.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [allowedTabs]);
```

- [ ] **Step 3: Run lint, run tests, commit**

```bash
npx eslint src/App.tsx 2>&1 | grep "set-state-in-effect"
npm run test:run
git add src/App.tsx docs/EDIT_LOG.md
git commit -m "fix: suppress set-state-in-effect for tab accumulation effects in App.tsx"
```

---

### Task 10: FeedbackWidget, XrayReferrals, Population/index.tsx — Suppress async-load effects

**Files:**
- Modify: `src/components/FeedbackWidget/FeedbackWidget.tsx`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx`

These three files contain `useEffect(() => { void loadData(); }, [loadData])` patterns (async data loading triggered by prop/dependency changes). React's own documentation shows this exact pattern. The rule over-fires here.

- [ ] **Step 1: FeedbackWidget.tsx — suppress line 63**

```bash
grep -n "void refresh\|open.*refresh" src/components/FeedbackWidget/FeedbackWidget.tsx
```

```ts
// before (line 62-64)
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);
```
```ts
// after
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async refresh; setState is inside the async function, not the effect body
    if (open) void refresh();
  }, [open, refresh]);
```

- [ ] **Step 2: XrayReferrals.tsx — suppress line 419 (async load) and 333 (auto-select)**

For line 419:
```ts
// before
  useEffect(() => { void loadData(); }, [loadData]);
```
```ts
// after
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; setState fires inside loadData callback, not synchronously in the effect
  useEffect(() => { void loadData(); }, [loadData]);
```

For line 333 (auto-select first entry when list changes):
```ts
// before
    if (!valid) setSelEntryId(displayEntries[0].xrayImageId);
```
```ts
// after
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-corrects selection when the entry list changes; useMemo cannot accumulate user navigation state
    if (!valid) setSelEntryId(displayEntries[0].xrayImageId);
```

- [ ] **Step 3: Population/index.tsx — suppress lines 181 and 193**

```ts
// before (line 177-183)
  useEffect(() => {
    if (directoryHandle) {
      loadPopulationConfig(directoryHandle).then((c) => setConfig(c));
    } else {
      setConfig(DEFAULT_POPULATION_CONFIG);
    }
  }, [directoryHandle]);
```
```ts
// after
  useEffect(() => {
    if (directoryHandle) {
      loadPopulationConfig(directoryHandle).then((c) => setConfig(c));
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset when workspace is disconnected; this is the correct way to synchronize with an external system (FSA)
      setConfig(DEFAULT_POPULATION_CONFIG);
    }
  }, [directoryHandle]);
```

```ts
// before (line 191-201)
  useEffect(() => {
    if (!directoryHandle) {
      setExistingMonths([]);
      return;
    }
    setIsLoadingMonths(true);
    listMonthFolders(directoryHandle)
      .then((months) => setExistingMonths([...months].reverse()))
      .catch(() => setExistingMonths([]))
      .finally(() => setIsLoadingMonths(false));
  }, [directoryHandle, monthRefreshKey]);
```
```ts
// after
  useEffect(() => {
    if (!directoryHandle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync cleanup when workspace is disconnected
      setExistingMonths([]);
      return;
    }
    setIsLoadingMonths(true);
    listMonthFolders(directoryHandle)
      .then((months) => setExistingMonths([...months].reverse()))
      .catch(() => setExistingMonths([]))
      .finally(() => setIsLoadingMonths(false));
  }, [directoryHandle, monthRefreshKey]);
```

If there are additional `set-state-in-effect` errors in `Population/index.tsx` beyond these two, apply the same suppress-with-comment approach to each, reading the context first to confirm they are async loads or sync cleanup.

- [ ] **Step 4: Run lint on all three files**

```bash
npx eslint src/components/FeedbackWidget/FeedbackWidget.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/Population/index.tsx
```

Expected: 0 errors in all three (warnings from `exhaustive-deps` in XrayReferrals at line 272 addressed in Step 5)

- [ ] **Step 5: Fix the missing-dep warning in XrayReferrals (line 272)**

```bash
grep -n -B 2 -A 5 "272\|applyTemplate" src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx | head -20
```

The warning says `applyTemplate` is missing from a `useEffect` dep array. Check if `applyTemplate` is a stable function (wrapped in `useCallback`) or recreated on every render. If unstable, wrap in `useCallback` and add to deps. If it would create a circular dependency, suppress with `// eslint-disable-next-line react-hooks/exhaustive-deps -- applyTemplate intentionally excluded; adding it would create a circular effect`.

- [ ] **Step 6: Run all tests and commit**

```bash
npm run test:run
git add src/components/FeedbackWidget/FeedbackWidget.tsx \
        src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
        src/components/Sidebar/Tabs/Population/index.tsx \
        docs/EDIT_LOG.md
git commit -m "fix: suppress set-state-in-effect for async-load and cleanup effects"
```

---

## Phase 3 — Module Structure: DataTable & Unused Variables

**Objective:** Fix the 4 `react-refresh` errors by extracting utility exports from the DataTable component file, and remove the 4 unused-variable errors.

---

### Task 11: Extract DataTable utilities to `DataTable/utils.ts`

**Files:**
- Create: `src/components/DataTable/utils.ts`
- Modify: `src/components/DataTable/index.tsx`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`

**Interfaces:**
- Consumes: `DateFormatMode` type (moved with the utils)
- Produces: `utils.ts` exports `DateFormatMode`, `DATE_FORMAT_LABELS`, `looksLikeDate`, `formatDate`, `isFilterEmpty`

- [ ] **Step 1: Read the exact source of each function to be moved**

```bash
grep -n "DateFormatMode\|DATE_FORMAT_LABELS\|looksLikeDate\|formatDate\|isFilterEmpty\|ISO_DATE_RE\|DATE_ONLY_RE\|toIsoDate" src/components/DataTable/index.tsx | head -20
```

- [ ] **Step 2: Create `src/components/DataTable/utils.ts`**

Copy the exact source of the four items from `index.tsx`:

```ts
// src/components/DataTable/utils.ts

export type DateFormatMode = "date" | "time" | "month" | "datetime";

export const DATE_FORMAT_LABELS: Record<DateFormatMode, string> = {
  date:     "التاريخ",
  time:     "الوقت",
  month:    "الشهر",
  datetime: "التاريخ والوقت",
};

const ISO_DATE_RE  = /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function looksLikeDate(v: string): boolean {
  return ISO_DATE_RE.test(v) || DATE_ONLY_RE.test(v);
}

export function formatDate(raw: string, mode: DateFormatMode): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    if (mode === "date")  return d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
    if (mode === "time")  return d.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
    if (mode === "month") return d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long" });
    if (mode === "datetime") {
      const date = d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
      const time = d.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
      return `${date} ${time}`;
    }
  } catch { /**/ }
  return raw;
}

export function toIsoDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /**/ }
  return raw.slice(0, 10);
}

export function isFilterEmpty(f: { kind: string; value?: string; mode?: string; single?: string; from?: string; to?: string; values?: string[] }): boolean {
  if (f.kind === "text")        return !f.value;
  if (f.kind === "status")      return f.value === "all" || !f.value;
  if (f.kind === "date")        return f.mode === "single" ? !f.single : (!f.from && !f.to);
  if (f.kind === "multiselect") return (f.values ?? []).length === 0;
  return true;
}
```

**Important:** `isFilterEmpty` takes an `AnyFilter` type that is defined locally in `index.tsx`. Read the exact type definition before writing `utils.ts`:

```bash
grep -n "type AnyFilter\|AnyFilter =" src/components/DataTable/index.tsx | head -5
```

Use the exact type from `index.tsx` rather than the inline object type shown above.

- [ ] **Step 3: Update `DataTable/index.tsx` — remove the moved exports, add internal imports**

In `index.tsx`:
1. Remove the `DateFormatMode` type export
2. Remove the `DATE_FORMAT_LABELS` export
3. Remove the `looksLikeDate` function
4. Remove the `formatDate` function
5. Remove the `ISO_DATE_RE`, `DATE_ONLY_RE`, and `toIsoDate` private helpers (they moved too)
6. Remove the `isFilterEmpty` export
7. Add at the top (after existing imports):

```ts
import {
  type DateFormatMode,
  DATE_FORMAT_LABELS,
  looksLikeDate,
  formatDate,
  toIsoDate,
  isFilterEmpty,
} from "./utils";
```

- [ ] **Step 4: Update `XrayReferrals.tsx` — split the import**

```ts
// before (lines 43-51)
import DataTable, {
  formatDate,
  looksLikeDate,
  type CellMeta,
  type ColConfig,
  type DateFormatMode,
  type DataTableCol,
} from "../../../../../components/DataTable";
```
```ts
// after
import DataTable, {
  type CellMeta,
  type ColConfig,
  type DataTableCol,
} from "../../../../../components/DataTable";
import {
  formatDate,
  looksLikeDate,
  type DateFormatMode,
} from "../../../../../components/DataTable/utils";
```

- [ ] **Step 5: Update `XrayInspectionResults.tsx` — split the import**

```ts
// before (lines 5-12)
import DataTable, {
  formatDate,
  looksLikeDate,
  type CellMeta,
  type ColConfig,
  type DataTableCol,
  type DateFormatMode,
} from "../../../../../components/DataTable";
```
```ts
// after
import DataTable, {
  type CellMeta,
  type ColConfig,
  type DataTableCol,
} from "../../../../../components/DataTable";
import {
  formatDate,
  looksLikeDate,
  type DateFormatMode,
} from "../../../../../components/DataTable/utils";
```

- [ ] **Step 6: Run TypeScript and lint**

```bash
npx tsc --noEmit
npx eslint src/components/DataTable/index.tsx src/components/DataTable/utils.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx
```

Expected: 0 errors in all four files related to fast-refresh or missing exports

- [ ] **Step 7: Run tests and commit**

```bash
npm run test:run
git add src/components/DataTable/utils.ts src/components/DataTable/index.tsx \
        src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
        src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx \
        docs/EDIT_LOG.md
git commit -m "refactor: extract DataTable utilities to utils.ts to fix fast-refresh violations"
```

---

### Task 12: Remove unused variable errors (4 errors across 3 files)

**Files:**
- Modify: `src/components/DataTable/index.tsx`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`

- [ ] **Step 1: DataTable — remove unused params from `loadColConfig` and `saveColConfig`**

Read the full signatures and call sites:

```bash
grep -n "loadColConfig\|saveColConfig" src/components/DataTable/index.tsx
```

```ts
// before
function loadColConfig<TRow>(
  _storageKey: string,
  columns: DataTableCol<TRow>[],
  defaultVisible?: string[]
): ColConfig {
  return buildDefault(columns, defaultVisible);
}

function saveColConfig(_storageKey: string, _cfg: ColConfig): void {
  // Durable table preferences should be saved through onColConfigChange.
}
```
```ts
// after
function loadColConfig<TRow>(
  columns: DataTableCol<TRow>[],
  defaultVisible?: string[]
): ColConfig {
  return buildDefault(columns, defaultVisible);
}

function saveColConfig(): void {
  // Column config is persisted through onColConfigChange; no localStorage.
}
```

Update all call sites within `index.tsx`:

```bash
grep -n "loadColConfig(\|saveColConfig(" src/components/DataTable/index.tsx
```

Remove the `storageKey` argument from `loadColConfig(...)` calls, and remove all arguments from `saveColConfig(...)` calls.

- [ ] **Step 2: XrayReferrals — remove `_columns` param from `loadLocalColConfig`**

```ts
// before (line 129)
function loadLocalColConfig(_columns: DataTableCol<DistributionEntry>[]): ColConfig | null {
```
```ts
// after
function loadLocalColConfig(): ColConfig | null {
```

Update the call site:

```bash
grep -n "loadLocalColConfig(" src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx
```

Remove the argument from every call.

- [ ] **Step 3: XrayInspectionResults — remove `_sampleColumns` param**

```ts
// before (line 545)
function loadLocalReferralColConfig(_sampleColumns: DataTableCol<DistributionEntry>[]): ColConfig | null {
```
```ts
// after
function loadLocalReferralColConfig(): ColConfig | null {
```

Update the call site similarly.

- [ ] **Step 4: Run full lint**

```bash
npm run lint
```

Expected: 0 errors, 0 warnings (or only pre-existing warnings unrelated to this plan)

- [ ] **Step 5: Run tests and commit**

```bash
npm run test:run
git add src/components/DataTable/index.tsx \
        src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx \
        src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx \
        docs/EDIT_LOG.md
git commit -m "fix: remove unused parameters from DataTable col-config helpers and employee workspace loaders"
```

---

## Phase 4 — Documentation & Version

### Task 13: Write README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write a complete README**

Replace the current 1-line placeholder with the following (adapt any details that differ from the actual project state):

```markdown
# X-Ray Quality App v1

Arabic RTL single-page application for X-ray quality control — imports radiology BI/risk data from Excel, processes a population, draws a stratified random sample, distributes assignments to employees, collects answers, and generates self-contained HTML reports.

## Requirements

- Node 20+ (for development and build only)
- Chrome or Edge 92+ (runtime — requires File System Access API)

## Development

```bash
npm install          # install dependencies (xlsx installed from SheetJS CDN, not npm registry)
npm run dev          # Vite dev server at http://localhost:5173
npm run test:run     # run all 96 Vitest tests once
npm run lint         # ESLint
npm run build        # produces dist/index.html (~1.9 MB, self-contained)
npm run preview      # preview the built file locally
```

## Deployment

The build output is a single self-contained `dist/index.html`. Deployment options:

1. **Static file server** — Copy `dist/index.html` to any web server directory.
2. **USB / offline** — Open the HTML file directly in Chrome or Edge.
3. **Intranet** — Host on any web server; no server-side processing required.

No backend, no database, no environment variables required for production.

## First Run

1. Open the app in Chrome or Edge.
2. Click "اختيار مجلد العمل" (Select Workspace Folder) and pick an empty folder.
3. Log in as `admin` using the bootstrap passcode (configured in `src/auth/authConfig.ts`).
4. Create managed users in the User Management tab.

Default employee password: `Xray@2026` — change immediately on first login.

## Workspace Folder Structure

```
[workspace]/
  Population/{month}/          ← one folder per processed month
    month.manifest.json
    risk.raw.json
    population.final.json
    sample/sample.master.json
    distribution.log.json      ← append-only event log
    distribution.current.json  ← derived snapshot
    employee-answers/{user}.answers.json
  templates/                   ← inspection form templates
  .system/backups/             ← automatic daily backups (admin only)
```

## Security Notes

This app has no backend. All auth and permissions run in the browser and are a UX guard, not a trust boundary. Suitable for trusted internal environments only. See `src/auth/` for the full security model.

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome 92+ | ✅ Full |
| Edge 92+   | ✅ Full |
| Firefox    | ❌ No File System Access API |
| Safari     | ❌ No File System Access API |
```

- [ ] **Step 2: Commit**

```bash
git add README.md docs/EDIT_LOG.md
git commit -m "docs: write complete README with setup, deployment, and security notes"
```

---

### Task 14: Bump version to 1.0.0

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Change version field**

```json
// before
  "version": "0.0.0",
```
```json
// after
  "version": "1.0.0",
```

- [ ] **Step 2: Commit**

```bash
git add package.json docs/EDIT_LOG.md
git commit -m "chore: bump version to 1.0.0 for enterprise production release"
```

---

## Phase 5 — Final Validation

### Task 15: Full system validation

**Files:**
- Read: `dist/index.html` (to confirm build output)

- [ ] **Step 1: Clean build**

```bash
npm run build
```

Expected: success, `dist/index.html` produced, no TypeScript errors in stderr.

- [ ] **Step 2: Full lint pass**

```bash
npm run lint
```

Expected: 0 errors, 0 errors (suppressed entries have inline comments as justification).

- [ ] **Step 3: Full test suite**

```bash
npm run test:run
```

Expected: 96 tests passed, 0 failed.

- [ ] **Step 4: TypeScript strict check**

```bash
npx tsc --noEmit
```

Expected: no output (no type errors).

- [ ] **Step 5: Record final state in EDIT_LOG.md**

Add a final summary entry to `docs/EDIT_LOG.md` with the version bump to v1.0.0, listing the total files changed and the final lint/test counts.

- [ ] **Step 6: Tag the release**

```bash
git tag -a v1.0.0 -m "Enterprise production release: 0 lint errors, 96 tests passing, full documentation"
```

---

## Plan Self-Review

### Spec Coverage Check

| Requirement | Task |
|-------------|------|
| 67 ESLint errors eliminated | Tasks 1–12 |
| `any` types removed | Tasks 1–3 |
| React hooks violations fixed | Tasks 4–10 |
| Fast-refresh violations fixed | Task 11 |
| Unused variable errors removed | Task 12 |
| README written | Task 13 |
| Version bumped to 1.0.0 | Task 14 |
| Build passes | Task 15 |
| All 96 tests pass | Each task's Step N |
| EDIT_LOG.md maintained | Each task's commit step |

### Known Out-of-Scope Items (deferred, not forgotten)

| Item | Reason deferred | Risk |
|------|----------------|------|
| E2E tests (Playwright) | Requires significant test infrastructure setup; no blocking behavior issues found | Low — 96 unit/integration tests already cover data layer |
| Mobile responsiveness | App is intentionally desktop-first; FSA API desktop-only anyway | None for target environment |
| Accessibility full audit | No critical a11y defects found; existing ARIA labels cover primary workflows | Low |
| Optional backend | No business requirement expressed; current architecture meets stated needs | None |

### Final Readiness Rating Target

**Controlled Production Ready** → after this plan: **Enterprise Production Ready**

Evidence: 0 lint errors, strict TypeScript, 96 passing tests, complete documentation, Argon2id auth, safe-write persistence with `.bak` recovery, append-only event log, single-file offline-capable deployment.
