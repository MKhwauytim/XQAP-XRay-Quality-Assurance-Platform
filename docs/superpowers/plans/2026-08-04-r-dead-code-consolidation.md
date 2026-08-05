# §R Dead Code Removal + Duplicate Consolidation Implementation Plan [DONE — shipped v59.172–v59.173]

> **STATUS: ✅ DONE.** Shipped v59.172–v59.173 (commits `bd1cbfc0`, `aef9745c`, `4a26375a`, `cce6ec96`, `6e6669a5`, `03ca9ae9`) — 15 confirmed-dead exports removed, `formatIssueDate` and `normalizeText`/`normalizeArabicText` duplicates consolidated.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §R from `docs/superpowers/specs/2026-08-03-distribution-performance-and-workflow-design.md` — remove 15 confirmed-dead exports (each independently re-verified against the CURRENT codebase, not just the source spec's weeks-old claim) and consolidate 2 sets of byte-identical duplicate functions.

**Architecture:** Two independent tasks. Task 1 (dead-code removal) touches 9 files, each a one-line-or-so deletion, zero behavior change by definition (dead code has no callers). Task 2 (consolidation) is scoped more narrowly than the source spec's literal text, per fresh verification — see Global Constraints.

**Tech Stack:** No new dependencies.

## Global Constraints

- **Every dead-code item below was independently re-verified against the current codebase** (not assumed from the source spec, which is several weeks old and predates multiple plans shipped this session). All 15 confirmed still dead, zero new usages appeared. If your own verification during implementation finds a genuinely different result (a new caller appeared since this plan was written), STOP and report it rather than removing something with a real usage — do not trust this plan's claim blindly, re-grep before each deletion.
- **Do NOT touch the 2 "needs owner confirmation" items**: `workspaceDefaults.ts`'s legacy-schema write-side constructors (`createDefaultWorkspaceManifest`/`createDefaultUsersPermissions`/`createDefaultRawData`/`createDefaultProcessedData`/`createDefaultSampleMaster`/`createDefaultSampleDistribution`, all in `src/data/workspace/workspaceDefaults.ts`), and `src/data/reporting/executive/deck/` (the v1 deck folder, confirmed NOT dead — kept alive by `src/dev/deckPreview.ts` and `executiveBuilders.xss.test.ts`, plus its `deck/shared`/`deck/deckTheme` submodules being imported by 3 other production files). These are explicitly owner decisions, not implementer calls — this plan does not investigate or remove either.
- **Consolidation scope correction (verified by research, deviating from the spec's literal "2 copies" claim):** `normalizeArabicText` currently has **6** definitions, not 2, split into two behaviorally DIFFERENT groups:
  - **Group A (2 copies, byte-identical, THIS is what the spec means to consolidate):** `src/components/Sidebar/Tabs/Population/processing/populationExporter.ts:22-27` and `.../processing/populationProcessor.ts:191-196`. Both: `normalizeText(value).replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")`.
  - **Group B (4 copies, byte-identical to each other, DO NOT TOUCH):** `Population/riskData/riskDataWorkbook.ts:11-20`, `.../riskData/riskDataNormalizer.ts:4-13`, `.../biData/biDataWorkbook.ts:11-20`, `.../biData/biDataNormalizer.ts:4-13`. These take `string` (not `unknown`), do their own inline trim/collapse instead of calling `normalizeText`, additionally strip the Arabic tatweel character (`ـ`), and **already lowercase internally** — Group B is NOT the same function as Group A and folding it in would silently change risk/BI data parsing behavior. **This task consolidates Group A only.**
  - **A 3rd, differently-named duplicate exists** (`certScanParser.ts:15-20`'s `normalizePortName`, byte-identical body to Group A) but is out of scope since the spec's consolidation is scoped to the literal identifier `normalizeArabicText` — leave `normalizePortName` alone.
  - `normalizeXrayId` is ALSO a 2-copy duplicate (`populationProcessor.ts:198-200`, exported; `populationExporter.ts:59-61`, module-private, NOT importing the exported one) — per the spec's explicit instruction, **do not merge this into the consolidation**, leave both copies exactly as they are.
- **No golden snapshot exists for either consolidation's full verification surface** (verified: `management/managementReport.ts` — one of the 2 `formatIssueDate` duplicates — has no snapshot test at all, only an XSS-payload test; `Population/`'s text-normalization functions have zero snapshot coverage anywhere in the repo). Where the spec says "golden snapshots must show zero deltas," treat this as: the ONE snapshot that does exist and does cover this change (`executiveReport.test.ts.snap`, which embeds `formatIssueDate()`'s frozen output) must show zero deltas; for everything else, rely on the existing (non-snapshot) unit test suites passing unchanged as the verification signal, since no stronger mechanism currently exists.
- Follow CLAUDE.md's edit-log requirement for every task (version bump, Before/After, `npm run count-lines -- --quiet` before/after, category prefix).

---

### Task 1: Remove 15 confirmed-dead exports

**Files (one deletion each, plus removing any now-unused surrounding imports if applicable):**
- `src/data/reporting/executive/primitives.ts` — remove `barRow` (line 40), `badgeHtml` (49), `heatCell` (63), `statPill` (69), `noticeBox` (85), `pagePanel` (89)
- `src/data/reporting/htmlReport.ts` — remove `buildReportHtml` (line 5), `formatNum` (174)
- `src/data/reporting/executiveReportData.ts` — remove `fmtK` (line 404)
- `src/data/feedback/feedbackStorage.ts` — remove `saveFeedback` (line 118)
- `src/data/reporting/executive/deck2/slideKit.ts` — remove `getActiveStyleChoices` (line 244)
- `src/data/storage/fileSystemAccess.ts` — remove `getStatusFromStructureResult` (line 452)
- `src/auth/userManagement.ts` — remove `DEFAULT_USER_TEMP_PASSWORD` (line 55) and `getPublicManagedUsers` (line 699)
- `src/branding/fonts.ts` — remove `ARABIC_FONT_FAMILY` (line 22)

**Interfaces:** none of these are consumed anywhere — that's the definition of dead code being removed here. No downstream signature changes.

**Context:** Each item was independently re-grepped against the current repo (including all test files) and confirmed to have exactly one hit — its own definition — with no other reference anywhere. `DEFAULT_USER_TEMP_PASSWORD` is a literal plaintext password (`"Xray@2026"`) shipped in the client bundle; removing it is a small security win beyond cleanup. `ARABIC_FONT_FAMILY` is safe to remove now since §Q (font dedup) already shipped this session and already stripped this constant's other former call sites.

- [ ] **Step 1: Re-verify each item is still dead**

Before deleting anything, run a fresh grep for each of the 15 identifier names across the whole repo (`grep -rn "<name>" src/` for each) and confirm exactly one hit (the definition itself). This plan's own research already did this once; re-confirming immediately before the edit protects against drift between plan-writing and implementation, especially in a repo with other concurrent sessions active. If any identifier now has more than one hit, STOP, do not delete it, and report the new usage instead.

- [ ] **Step 2: Delete each export**

For each of the 15 items, delete the function/constant definition (including its own doc comment if it has one that exists solely to describe it) from its file. Leave the rest of each file untouched. If removing an export leaves an import at the top of that same file unused (check each file's own imports after the deletion), remove that now-unused import too — but do not touch any import that's still used by something else in the file.

- [ ] **Step 3: Run the tests to verify nothing broke**

Run: `npm run test:run`
Expected: all PASS, zero change — these were unused exports, so no test should reference them either (if a test DOES reference one, that contradicts Step 1's re-verification; stop and investigate rather than deleting anyway).

Then typecheck and lint (an unused import left behind after a deletion is exactly the kind of thing `lint:ci`'s `no-unused-vars` rule catches):
Run: `npm run typecheck && npm run lint:ci`
Expected: clean.

- [ ] **Step 4: Edit log + commit**

```bash
git add src/data/reporting/executive/primitives.ts src/data/reporting/htmlReport.ts src/data/reporting/executiveReportData.ts src/data/feedback/feedbackStorage.ts src/data/reporting/executive/deck2/slideKit.ts src/data/storage/fileSystemAccess.ts src/auth/userManagement.ts src/branding/fonts.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Remove: 15 confirmed-dead exports (incl. a plaintext default-password constant)"
```

---

### Task 2: Consolidate `formatIssueDate` and `normalizeText`/`normalizeArabicText` (Group A only)

**Files:**
- Modify: `src/data/reporting/management/managementReport.ts` (delete local `formatIssueDate` at line 32-34, add import, keep the call site at line 360 unchanged)
- Modify: `src/data/reporting/executive/index.ts` (delete local `formatIssueDate` at line 18-20, add import, keep the call site at line 27 unchanged)
- Create: `src/components/Sidebar/Tabs/Population/processing/textNormalization.ts`
- Modify: `src/components/Sidebar/Tabs/Population/processing/populationExporter.ts` (delete local `normalizeText` at line 18 and Group-A `normalizeArabicText` at line 22-27, import both instead)
- Modify: `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts` (delete local `normalizeText` at line 187 and Group-A `normalizeArabicText` at line 191-196, import both instead)
- Test: run the existing test suites for all 4 modified files — no new test files needed for this consolidation (see Global Constraints re: no golden snapshot coverage exists for the Population side)

**Interfaces:**
- Consumes (for `formatIssueDate`): the already-canonical `formatIssueDate` export from `src/data/reporting/shared/reportChrome.ts:151-153` — this already exists and is already used by `sampleReport.ts`/`distributionReport.ts`, nothing new to create.
- Produces (for the text-normalization consolidation): `export function normalizeText(value: unknown): string` and `export function normalizeArabicText(value: unknown): string` from the new `src/components/Sidebar/Tabs/Population/processing/textNormalization.ts` — bodies byte-identical to the 4 duplicate definitions being deleted (2 `normalizeText` + 2 Group-A `normalizeArabicText`).

**Context:** `normalizeText` has 4 copies today (`reportDataBuilder.ts:116`, `certScanParser.ts:3`, `populationExporter.ts:18`, `populationProcessor.ts:187`) but the spec's consolidation target is only the 2 in `populationExporter.ts`/`populationProcessor.ts` (paired with Group-A `normalizeArabicText`, which calls `normalizeText` internally in both files) — leave `reportDataBuilder.ts`'s and `certScanParser.ts`'s own local `normalizeText` copies untouched, they're outside this consolidation's stated scope (the spec pairs the two functions together specifically because Group A's `normalizeArabicText` composes its file's local `normalizeText`).

- [ ] **Step 1: `formatIssueDate` — delete the 2 duplicates, import the canonical one**

In `src/data/reporting/management/managementReport.ts`: delete the local `function formatIssueDate(d = new Date()): string { ... }` (currently line 32-34), add `import { formatIssueDate } from "../shared/reportChrome";` near the file's other imports (verify this exact relative path against the file's actual location — it's one directory level from `reporting/shared/`). Leave the call site (`formatIssueDate()` inside `buildManagementReport`, currently line 360) exactly as-is — the call shape doesn't change, only where the function comes from.

In `src/data/reporting/executive/index.ts`: same treatment — delete the local definition (currently line 18-20), add `import { formatIssueDate } from "../shared/reportChrome";` (this file is one level deeper, verify the relative path), leave the call site (currently line 27, inside `buildExecutiveReport`) unchanged.

- [ ] **Step 2: Run the executive snapshot test to verify zero delta**

Run: `npx vitest run src/data/reporting/executiveReport.test.ts`
Expected: PASS with **zero snapshot delta** — the frozen-date test (`vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"))`) already embeds `formatIssueDate()`'s output (`"29 / 07 / 2026"`) in `executiveReport.test.ts.snap`; since both the canonical and the deleted duplicate produce byte-identical output, this must show no changes. If it shows ANY delta, stop — that means the two implementations were not actually identical and this consolidation needs to be re-examined, not forced through.

Run the management report's own test too (no snapshot exists for it, per Global Constraints, but its non-snapshot tests must still pass):
Run: `npx vitest run src/data/reporting/reportBuilders.xss.test.ts` (or wherever `buildManagementReport` is otherwise exercised — check for other test files if this one isn't the only coverage)
Expected: PASS.

- [ ] **Step 3: Create the shared text-normalization module**

Read `populationExporter.ts:18` and `:22-27`, and `populationProcessor.ts:187` and `:191-196` once more directly (to copy the exact current bodies, in case anything shifted since this plan was written) before creating:

`src/components/Sidebar/Tabs/Population/processing/textNormalization.ts`:

```ts
export function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeArabicText(value: unknown): string {
  return normalizeText(value)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}
```

(This must be byte-identical to both files' current Group-A bodies — verify against your direct read in this step, not just this plan's transcription, before creating the file.)

- [ ] **Step 4: Delete the duplicates and import the shared module**

In `src/components/Sidebar/Tabs/Population/processing/populationExporter.ts`: delete the local `function normalizeText(...)` (line 18) and local `function normalizeArabicText(...)` (line 22-27). Add `import { normalizeText, normalizeArabicText } from "./textNormalization";` near the file's other imports. Leave every call site of both functions in this file (research cites `normalizeText` at lines 130, 139, 161×2; `normalizeArabicText` at lines 42, 46, 50, 64) exactly as-is — do NOT touch `normalizeXrayId` (line 59-61) or its call site (line 64), which is explicitly excluded from this consolidation per Global Constraints.

In `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts`: same treatment — delete the local `normalizeText` (line 187) and local Group-A `normalizeArabicText` (line 191-196), add the same import (verify the relative path — same directory, so `./textNormalization`), leave every call site (research cites `normalizeText` at lines 192(inside the deleted function, now gone), 199, 203, 552; `normalizeArabicText` at lines 318, 427) exactly as-is. Do NOT touch `normalizeXrayId` (line 198-200, the EXPORTED copy) or its call sites (211, 369, 427, 720).

- [ ] **Step 5: Run the tests to verify everything passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/`
Expected: all PASS — this covers `populationExporter.test.ts`, `populationProcessor.test.ts`, and every other Population test, with zero behavior change (both consolidated functions are byte-identical to what they replace).

Then the whole suite, typecheck, lint:
Run: `npm run test:run && npm run typecheck && npm run lint:ci`
Expected: all clean.

- [ ] **Step 6: Edit log + commit**

```bash
git add src/data/reporting/management/managementReport.ts src/data/reporting/executive/index.ts src/components/Sidebar/Tabs/Population/processing/textNormalization.ts src/components/Sidebar/Tabs/Population/processing/populationExporter.ts src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Refactor (reporting/population): consolidate formatIssueDate + normalizeText/normalizeArabicText duplicates"
```

---

## Task Order

Task 1 and Task 2 touch entirely disjoint file sets (Task 1: `primitives.ts`, `htmlReport.ts`, `executiveReportData.ts`, `feedbackStorage.ts`, `slideKit.ts`, `fileSystemAccess.ts`, `userManagement.ts`, `branding/fonts.ts`; Task 2: `managementReport.ts`, `executive/index.ts`, `textNormalization.ts`, `populationExporter.ts`, `populationProcessor.ts`) — safe to run in parallel, using this session's established parallel-implementer protocol (skip the edit log and `package.json`; controller applies one combined commit per task afterward from each task's own diff).
