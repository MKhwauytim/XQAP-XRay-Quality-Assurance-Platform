# Workstream A — Data Safety & Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five field-reported data-safety and correctness defects of Workstream A: submitted answers that flip back or appear lost (A1), a population re-process that orphans the month's sample (A2), unequal monthly totals under port restrictions (A3), a boot self-check false alarm on the deck-preference files (A4), and a «متابعة العمل» strip that ignores the case chips (A5).

**Architecture:** Every fix lands at the layer that owns the defect: the pure data layer (`src/data/**`) gets the rule and its tests first (population overwrite guard, bulk-assignment month targets, append-only log deadline and stable chain, template scan exclusions), and the React views are then changed only to consume the new contracts (save outcome, overwrite assessment, shortfall warnings, case-filtered stats). No existing workspace file changes shape: the new on-disk artefacts are additive (`*.superseded.*` archives, answer segments under a stable per-user/month chain name that the existing suffix-glob readers already fold).

**Tech Stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), Vite, Vitest (`globals: false`, node env by default, jsdom per file), File System Access API through `DirectoryHandleLike`, `createMemoryDirectory` for tests.

**Spec:** `docs/superpowers/specs/2026-09-28-corrective-plan-design.md` (Workstream A only).

## Global Constraints

- Node `>=22 <23`.
- TypeScript strict with `erasableSyntaxOnly` (no `enum`, no parameter properties, no namespaces); `import type` for type-only imports.
- Arabic UI strings only through `labelsStore` keys (`DEFAULT_LABELS` in `src/data/labels/labelsStore.ts`, or a labels sub-file spread into it); read with `getLabels()` / `useLabels()`. No new inline Arabic in components.
- All workspace I/O goes through `safeWriteJson` / `safeReadJson` / `copyFileBytes` and paths from `src/data/workspace/workspacePaths.ts`; never call `getFileHandle`/`createWritable` directly in new app code (guard `createWritable`, it is optional).
- No on-disk shape change of any existing workspace file. New files are additive only.
- Deterministic outputs (sampling, distribution folding, report/export builders, `calculateBulkAssignment`) are snapshotted **before** they are changed.
- One edit-log entry per task, generated after the change: `npm run editlog -- --tier=N --append --sync-package "Category (scope): …"`, then fill in the prose (tier 2+: `Why:` + `What changed:` + Before/After snippets). Task 1 also passes `--bump=major` (opens v140.0); every later task uses the default minor bump — tier-3 tasks pass `--bump=minor` explicitly so they do not open a new major each.
- Tier gates before claiming a task done: tier 1 = `npm run lint`, `npm run typecheck`, the affected test file; tier 2 and tier 3 = `npm run lint`, `npm run typecheck`, `npm run test:run`. Any task touching `XrayReferrals.tsx`, `Population/index.tsx`, `PhaseFourDistribution.tsx` or `Reports/TabView.tsx` also runs `npm run check:complexity`. The full release sweep runs once, in the final task.
- Work on branch `claude/beautiful-einstein-y1ouot`. Commit per task; push only in the final task, after `npm run build`.
- **Complexity budget warning.** `check:complexity` enforces `max-lines-per-function: 1450` (outer function lines include nested closures). Measured on 2026-09-28: `XrayReferrals` = **1447** (3 lines headroom), `PopulationTab` = 1407, `ReportsContent` = 1050, `PhaseFourDistribution` = 870. Every task that edits `XrayReferrals` states its net line delta; keep it at or below the stated number.

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/data/templates/templateFileRecovery.ts` | Modify | Scan excludes the named non-template files; readable JSON without `templateId` is `not-a-template`, never `corrupt`. |
| `src/data/templates/templateStorage.ts` | Modify | Export `TEMPLATES_INDEX_FILE`. |
| `src/data/templates/templateSelectionStorage.ts` | Modify | Export `TEMPLATE_SELECTION_FILE`. |
| `src/data/reporting/executive/deckEditionPreference.ts` | Modify | Export `DECK_EDITION_PREFERENCE_FILE`. |
| `src/data/reporting/executive/deck2/styleChoices.ts` | Modify | Export `DECK_STYLE_CHOICES_FILE`. |
| `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` | Modify | Stats from `caseFilter.entries`; local-submission guard; save outcome; canonical draft key; last-open restore. |
| `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx` | Modify | Strip title suffix for the active chip. |
| `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/localSubmissions.ts` | Create | Pure merge rule + `useLocalSubmissionGuard` hook (A1 stale-reload guard). |
| `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/answerRouting.ts` | Create | `panelDraftKey` / `answerFolderForEntry` from the row object, never from an id lookup. |
| `src/data/population/populationOverwriteGuard.ts` | Create | Load impact (sample / distribution / answers) and assess a new population against it. |
| `src/data/population/populationStorage.ts` | Modify | Guard in `saveMonthRunLocked`; versioned `*.superseded.*` archives; `sampleOrphanCount` on success. |
| `src/data/population/populationTestFixtures.ts` | Create | Test-only row/sample builders shared by the A2 tests. |
| `src/data/population/populationRecovery.ts` | Create | Admin recovery: list `*.superseded.json` + `.bak` candidates with coverage; restore one. |
| `src/components/ConfirmDialog/ConfirmDialog.tsx` | Modify | Optional `hideConfirm`. |
| `src/components/Sidebar/Tabs/Population/components/ReprocessConfirmDialog.tsx` | Create | Reprocess dialog with counts and blocked mode. |
| `src/components/Sidebar/Tabs/Population/index.tsx` | Modify | Use assessment pre-check + new dialog; save-time orphan warning. |
| `src/data/reporting/executiveReportTypes.ts` | Modify | `fromSampleSnapshot?: true` on `ExecutiveReportRow`. |
| `src/data/reporting/executiveReportData.ts` | Modify | Emit snapshot rows for sampled ids missing from the population; population-wide KPIs exclude them. |
| `src/components/SampleSnapshotBanner/SampleSnapshotBanner.tsx` (+ `.css`) | Create | Label-keyed warning banner with the count. |
| `src/components/Sidebar/Tabs/Reports/TabView.tsx` | Modify | Banner from the loaded exec input; Power BI banner. |
| `src/components/Sidebar/Tabs/ReportDesigner/renderers/ExecutiveRowsProvider.tsx` | Modify | Banner from flagged rows. |
| `src/data/powerbiExport/exportManager.ts` | Modify | `population.csv` excludes snapshot rows; return `snapshotRowCount`. |
| `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx` | Create | Admin UI for the recovery tool. |
| `src/components/Sidebar/Tabs/Settings/index.tsx` | Modify | Mount the recovery section. |
| `src/data/storage/directoryScan.ts` | Modify | Parallel `readSegmentTails`; `boundedSizeSignature` exclude set. |
| `src/data/storage/transientFileErrors.ts` | Modify | `retryTransientWrite` honours a deadline. |
| `src/data/storage/appendOnlyEventLog.ts` | Modify | Deadline threading; stable-chain known-segment rule; `segmentNamesWrittenThisSession`. |
| `src/data/answers/answerEventStore.ts` | Modify | `appendAnswerEventSegment` options; `ownAnswerSegmentNames`. |
| `src/data/answers/answerSegmentChain.ts` | Create | Stable per-(device, month, user) chain id + persisted time prefix. |
| `src/data/answers/answerStorage.ts` | Modify | Stable writer identity; one deadline per action threaded into the append. |
| `src/data/workspace/workspaceSync.ts` | Modify | Answers probe excludes this session's own segments. |
| `src/data/storage/storageRegistry.ts` | Modify | Register the chain key and the last-open-sample key. |
| `src/data/answers/answerTypes.ts` | Modify | `AnswerSaveOutcome`. |
| `src/components/InspectionPanel/index.tsx` (+ `.css`) | Modify | Inline save status from the outcome; draft-persist warning. |
| `src/data/answers/answerLocalMirror.ts` | Modify | `loadPendingAnswerRecords`. |
| `src/data/answers/pendingAnswerReplay.ts` | Create | Replay every pending answer (all months, ad-hoc folders). |
| `src/data/answers/PendingAnswerReplayRunner.tsx` | Create | Headless app-level runner (30 s, visibility-gated) + draft prune at start. |
| `src/auth/AuthGate.tsx` | Modify | Mount the runner. |
| `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` | Modify | Drop its own replay interval (count-only refresh). |
| `src/data/answers/answerDraftStore.ts` | Modify | `saveAnswerDraft` reports failure; health subscription. |
| `src/data/answers/lastOpenSampleStore.ts` | Create | Per-user last-open sample in sessionStorage. |
| `src/data/distribution/bulkAssignment.ts` | Modify | Month targets, cross-stage carry-over, ownership, shortfall report (restricted mode only). |
| `src/data/distribution/bulkAssignment.snapshot.test.ts` | Create | Snapshot of current outputs before any change. |
| `src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx` | Modify | Shortfall warning in preview and run. |
| `src/data/labels/labelsStore.ts`, `src/data/labels/labels.phaseThreeFour.ts` | Modify | New label keys (listed per task). |

---

## Task 1: A4 — Boot self-check ignores the non-template files in `6-templates`

**Tier:** 2 (first code task of the PR — passes `--bump=major`, opening v140.0).

**Root cause (verified 2026-09-28):** `inspectAllTemplateFiles` (`src/data/templates/templateFileRecovery.ts:317-331`) treats every `*.json` in `6-templates` as a template except two hard-coded names. `executive-deck-edition.json` (`deckEditionPreference.ts:7`) and `deck2.style-choices.json` (`deck2/styleChoices.ts:7`) live there with no `templateId`/`fields`, so `classifyLive` returns `corrupt` (`:132`), no sibling qualifies, `recoverTemplateFile` returns `unrecoverable` (`:256`), and `bootIntegrityScan.ts:148-175` reports a `needs-attention` finding on every admin sign-in.

**Files:**
- Modify: `src/data/templates/templateStorage.ts:126` (export the index file name)
- Modify: `src/data/templates/templateSelectionStorage.ts:7` (export the selection file name)
- Modify: `src/data/reporting/executive/deckEditionPreference.ts:7` (export the file name)
- Modify: `src/data/reporting/executive/deck2/styleChoices.ts:7` (export the file name)
- Modify: `src/data/templates/templateFileRecovery.ts:44-51, 113-135, 304-339`
- Test: `src/data/integrity/bootIntegrityScan.test.ts` (append), `src/data/templates/templateFileRecovery.test.ts` (append)

**Interfaces:**
- Consumes: `saveDeckEditionPreference(directoryHandle, edition: "v2" | "v3", updatedBy: string): Promise<{ok:true}|{ok:false;error:string}>`, `saveDeckStyleChoices(directoryHandle, choices: Record<string, number>, updatedBy: string)` (note: the spec calls it `saveStyleChoices`; the real name is `saveDeckStyleChoices`), `runBootIntegrityScan(root, { now })`.
- Produces:
  - `export const TEMPLATES_INDEX_FILE = "templates.index.json";` (templateStorage.ts)
  - `export const TEMPLATE_SELECTION_FILE = "template.selection.json";` (templateSelectionStorage.ts)
  - `export const DECK_EDITION_PREFERENCE_FILE = "executive-deck-edition.json";`
  - `export const DECK_STYLE_CHOICES_FILE = "deck2.style-choices.json";`
  - `TemplateCandidate` gains `| { kind: "not-a-template" }`.
  - `export function isNonTemplateFile(fileName: string): boolean` (templateFileRecovery.ts).

- [ ] **Step 1: Write the failing tests**

Append to `src/data/integrity/bootIntegrityScan.test.ts` (inside the existing `describe("admin boot integrity scan", …)` block, after the first `it`), and add the two imports at the top of the file:

```ts
import { saveDeckEditionPreference } from "../reporting/executive/deckEditionPreference";
import { saveDeckStyleChoices } from "../reporting/executive/deck2/styleChoices";
```

```ts
  // Field report (2026-09-28): the admin boot dialog flagged
  // executive-deck-edition.json as "unrecoverable" on every sign-in. It is a
  // healthy preference file that merely lives beside the templates.
  it("does not report the executive-deck preference files that live in 6-templates", async () => {
    const root = createMemoryDirectory("workspace");
    const dir = await getTemplatesRoot(root, true);
    await safeWriteJson(dir, "tmpl-ok.json", makeTemplate("tmpl-ok", "fine"));
    expect((await saveDeckEditionPreference(root, "v3", "admin")).ok).toBe(true);
    expect((await saveDeckStyleChoices(root, { cover: 1 }, "admin")).ok).toBe(true);

    const report = await runBootIntegrityScan(root, { now: NOW });

    expect(report.findings).toEqual([]);
    expect(report.hasFindings).toBe(false);
  });

  it("still flags a genuinely torn template next to the preference files", async () => {
    const root = createMemoryDirectory("workspace");
    const dir = await getTemplatesRoot(root, true);
    await safeWriteJson(dir, "tmpl-torn.json", makeTemplate("tmpl-torn", "v1"));
    expect((await saveDeckEditionPreference(root, "v2", "admin")).ok).toBe(true);
    const handle = await dir.getFileHandle("tmpl-torn.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{ torn");
    await writable.close();

    const report = await runBootIntegrityScan(root, { now: NOW });

    expect(report.findings.map((finding) => finding.subject)).toEqual(["tmpl-torn.json"]);
    expect(report.findings[0]!.problem).toBe("damaged");
  });
```

Append to `src/data/templates/templateFileRecovery.test.ts` (end of file):

```ts
describe("non-template JSON in the templates root", () => {
  it("classifies readable JSON without a templateId as not-a-template, never corrupt", async () => {
    const dir = await getTemplatesRoot(root, true);
    const handle = await dir.getFileHandle("some-preference.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write(JSON.stringify({ edition: "v3" }));
    await writable.close();

    const report = await inspectTemplateFile(root, "some-preference");

    expect(report.live.kind).toBe("not-a-template");
    expect(report.needsRepair).toBe(false);
    expect(report.recoverableFrom).toBeNull();
  });

  it("leaves not-a-template files out of the full scan", async () => {
    await saveTemplate(root, makeTemplate());
    const dir = await getTemplatesRoot(root, true);
    const handle = await dir.getFileHandle("unknown-prefs.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write(JSON.stringify({ choices: {} }));
    await writable.close();

    const reports = await inspectAllTemplateFiles(root);

    expect(reports.map((report) => report.templateId)).toEqual([TEMPLATE_ID]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/integrity/bootIntegrityScan.test.ts src/data/templates/templateFileRecovery.test.ts`
Expected: FAIL — "does not report the executive-deck preference files…" gets two findings (`executive-deck-edition.json`, `deck2.style-choices.json`, outcome `needs-attention`); "classifies readable JSON…" gets `corrupt`; "leaves not-a-template files out…" lists `unknown-prefs` too. The torn-template test passes already (regression guard).

- [ ] **Step 3: Export the file-name constants from their owning modules**

Rename each module-private constant to its exported name everywhere in that one file (word-boundary rename, no other file affected):

```bash
sed -i 's/\bPREFERENCE_FILE\b/DECK_EDITION_PREFERENCE_FILE/g' src/data/reporting/executive/deckEditionPreference.ts
sed -i 's/^const DECK_EDITION_PREFERENCE_FILE =/export const DECK_EDITION_PREFERENCE_FILE =/' src/data/reporting/executive/deckEditionPreference.ts
sed -i 's/\bCHOICES_FILE\b/DECK_STYLE_CHOICES_FILE/g' src/data/reporting/executive/deck2/styleChoices.ts
sed -i 's/^const DECK_STYLE_CHOICES_FILE =/export const DECK_STYLE_CHOICES_FILE =/' src/data/reporting/executive/deck2/styleChoices.ts
sed -i 's/\bSELECTION_FILE\b/TEMPLATE_SELECTION_FILE/g' src/data/templates/templateSelectionStorage.ts
sed -i 's/^const TEMPLATE_SELECTION_FILE =/export const TEMPLATE_SELECTION_FILE =/' src/data/templates/templateSelectionStorage.ts
sed -i 's/\bINDEX_FILE\b/TEMPLATES_INDEX_FILE/g' src/data/templates/templateStorage.ts
sed -i 's/^const TEMPLATES_INDEX_FILE =/export const TEMPLATES_INDEX_FILE =/' src/data/templates/templateStorage.ts
grep -n "export const \(DECK_EDITION_PREFERENCE_FILE\|DECK_STYLE_CHOICES_FILE\|TEMPLATE_SELECTION_FILE\|TEMPLATES_INDEX_FILE\)" src/data/reporting/executive/deckEditionPreference.ts src/data/reporting/executive/deck2/styleChoices.ts src/data/templates/templateSelectionStorage.ts src/data/templates/templateStorage.ts
```
Expected: four matching lines, one per file.

- [ ] **Step 4: Teach `templateFileRecovery.ts` about non-template files**

4a. Add imports after line 42 (`import type { TemplateSchema } …`):

```ts
import { TEMPLATES_INDEX_FILE } from "./templateStorage";
import { TEMPLATE_SELECTION_FILE } from "./templateSelectionStorage";
import { DECK_EDITION_PREFERENCE_FILE } from "../reporting/executive/deckEditionPreference";
import { DECK_STYLE_CHOICES_FILE } from "../reporting/executive/deck2/styleChoices";
```

4b. Extend the candidate union (lines 45-51) with one new member, placed after `corrupt`:

```ts
  /**
   * Readable JSON that is not a template at all (no `templateId`) — e.g. a
   * preference file another module owns. Not damaged, never repaired.
   */
  | { kind: "not-a-template" }
```

4c. In `classifyLive`, replace line 132

```ts
  if (!isTemplateFile(read.value)) return { candidate: { kind: "corrupt" }, healedBySibling: false };
```
with

```ts
  if (!isTemplateFile(read.value)) {
    // A readable file with no templateId is someone else's JSON, not a torn
    // template: reporting it as corrupt is what made the boot scan flag the
    // deck-edition preference as unrecoverable on every admin sign-in.
    const hasTemplateId =
      typeof read.value === "object" &&
      read.value !== null &&
      typeof (read.value as { templateId?: unknown }).templateId === "string";
    return {
      candidate: hasTemplateId ? { kind: "corrupt" } : { kind: "not-a-template" },
      healedBySibling: false,
    };
  }
```

4d. Replace lines 304-305 (`const TEMPLATE_SUFFIX …` / `const NON_TEMPLATE_SUFFIXES …`) with:

```ts
const TEMPLATE_SUFFIX = ".json";
const NON_TEMPLATE_SUFFIXES = [".deleted.bak.json", ".bak.json", ".tmp.json"];

/**
 * Files other modules own in the templates root. Each name is imported from
 * its owning module (one place, one name); built on first use rather than at
 * module evaluation so an import cycle can never observe an uninitialised
 * binding.
 */
let nonTemplateFiles: ReadonlySet<string> | null = null;

export function isNonTemplateFile(fileName: string): boolean {
  nonTemplateFiles ??= new Set([
    TEMPLATES_INDEX_FILE,
    TEMPLATE_SELECTION_FILE,
    DECK_EDITION_PREFERENCE_FILE,
    DECK_STYLE_CHOICES_FILE,
  ]);
  return nonTemplateFiles.has(fileName);
}
```

4e. In `inspectAllTemplateFiles`, replace the two hard-coded name checks

```ts
        entry.name !== "templates.index.json" &&
        entry.name !== "template.selection.json" &&
```
with

```ts
        !isNonTemplateFile(entry.name) &&
```

and replace the loop body `reports.push(await inspectTemplateFile(directoryHandle, templateId));` with

```ts
    const report = await inspectTemplateFile(directoryHandle, templateId);
    // Readable JSON another module owns — not a template, not a finding.
    if (report.live.kind !== "not-a-template") reports.push(report);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/integrity/bootIntegrityScan.test.ts src/data/templates/templateFileRecovery.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 6: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 7: Edit-log entry**

Run: `npm run editlog -- --tier=2 --bump=major --append --sync-package "Fix (integrity): boot self-check no longer flags the deck-preference files in 6-templates as unrecoverable"`
Then fill the generated entry in today's `docs/edit logs/YYYY-MM-DD.md`: **Why** (the boot dialog reported a healthy `executive-deck-edition.json` as unrecoverable on every admin sign-in because the scan treated every `*.json` in `6-templates` as a template); **What changed** (owning modules export their file names, one `isNonTemplateFile` set, readable JSON without `templateId` is `not-a-template`); Before/After of the two `inspectAllTemplateFiles` filter lines and of `classifyLive`'s non-template branch.

- [ ] **Step 8: Commit**

```bash
git add src/data/templates/templateFileRecovery.ts src/data/templates/templateStorage.ts src/data/templates/templateSelectionStorage.ts src/data/reporting/executive/deckEditionPreference.ts src/data/reporting/executive/deck2/styleChoices.ts src/data/integrity/bootIntegrityScan.test.ts src/data/templates/templateFileRecovery.test.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (integrity): boot self-check ignores non-template files in 6-templates

The deck-edition and deck2 style-choice preference files live beside the
templates and were classified as corrupt templates, so every admin sign-in
reported a healthy file as unrecoverable.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 2: A5 — «متابعة العمل» follows the case-filter chips

**Tier:** 2. **XrayReferrals net line delta: −2** (frees budget for Tasks 9 and 17).

**Root cause (verified):** `computePersonalStats` (`XrayReferrals.tsx:754-790`) reads `scopedEntries` (before the chips) for oversight users and re-filters `allEntries` by username for employees; the call site is `XrayReferrals.tsx:1221-1224`. For an employee `entries` is already their own rows (`:1377`) and `scopedEntries === entries` (`:1056-1061`), so `caseFilter.entries` (`:1073-1074`) is already "the user's own entries, narrowed by the chip" — the spec's "feed caseFilter the user's own entries" needs no extra code.

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx:749-790, 1221-1224, 2219-2238`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx:743-808, 1253-1285`
- Modify: `src/data/labels/labelsStore.ts` (after line 293, `ew_case_filter_empty`)
- Test: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.caseFilter.test.tsx` (append)

**Interfaces:**
- Consumes: `useCaseFilter(scopedEntries): { value: CaseFilter; entries: DistributionEntry[]; counts }` (unchanged).
- Produces:
  - `computePersonalStats(input: { source: DistributionEntry[]; answersMap: Map<string, ItemAnswer>; template: TemplateSchema | null; templatesById?: ReadonlyMap<string, TemplateSchema> }): PersonalStats`
  - `ReferralStatsStrip` prop `caseFilter?: CaseFilter` (default `"all"`).
  - Labels: `ew_stats_case_suffix`, `ew_stats_case_risk_targeted`, `ew_stats_case_adhoc`.

- [ ] **Step 1: Write the failing tests**

Append to `XrayReferrals.caseFilter.test.tsx` (end of file; every helper used — `renderMixedQueue`, `chip`, `pickScope`, `seedMonth`, `seedAdhocAssignment`, `rowFor`, `L` — is already defined in that file):

```tsx
/** A figure in the «متابعة العمل» strip. `done` is the first done-tone token, «مكتملة». */
function statValue(tone: "total" | "done" | "pending"): string {
  return document.querySelector(`.ew-ref-stat-token--${tone} strong`)?.textContent ?? "";
}

function stripTitle(): string {
  return document.querySelector(".ew-ref-stats-title strong")?.textContent ?? "";
}

describe("XrayReferrals case filter — the «متابعة العمل» strip follows the chips", () => {
  it("re-counts an employee's strip, and renames it, when a chip is picked", async () => {
    await renderMixedQueue();

    expect(statValue("total")).toBe("5");
    expect(statValue("pending")).toBe("5");
    expect(stripTitle()).toBe("متابعة العمل");

    fireEvent.click(chip(L.ew_case_filter_risk_targeted));
    await waitFor(() => expect(statValue("total")).toBe("4"));
    expect(statValue("pending")).toBe("4");
    expect(stripTitle()).toBe(
      `متابعة العمل${L.ew_stats_case_suffix.replace("{filter}", L.ew_stats_case_risk_targeted)}`
    );

    fireEvent.click(chip(L.ew_case_filter_adhoc));
    await waitFor(() => expect(statValue("total")).toBe("1"));
    expect(stripTitle()).toBe(
      `متابعة العمل${L.ew_stats_case_suffix.replace("{filter}", L.ew_stats_case_adhoc)}`
    );

    fireEvent.click(chip(L.ew_case_filter_all));
    await waitFor(() => expect(statValue("total")).toBe("5"));
    expect(stripTitle()).toBe("متابعة العمل");
  });

  it("re-counts an oversight user's whole-workspace strip when a chip is picked", async () => {
    writeSession({ role: "supervisor", username: "malrogi", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    const root = createMemoryDirectory("root");
    await seedMonth(root, [
      ["IMG-MINE-REGULAR", null, "malrogi"],
      ["IMG-THEIRS-REGULAR", null, "emp-2"],
    ]);
    await seedAdhocAssignment(root, "malrogi");

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(rowFor("IMG-MINE-REGULAR")).not.toBeNull());
    pickScope(QUEUE_SCOPE_ALL);
    await waitFor(() => expect(rowFor("IMG-THEIRS-REGULAR")).not.toBeNull());
    expect(statValue("total")).toBe("3");

    fireEvent.click(chip(L.ew_case_filter_adhoc));
    await waitFor(() => expect(statValue("total")).toBe("1"));
    expect(stripTitle()).toBe(
      `متابعة العمل — جميع الموظفين${L.ew_stats_case_suffix.replace("{filter}", L.ew_stats_case_adhoc)}`
    );

    fireEvent.click(chip(L.ew_case_filter_risk_targeted));
    await waitFor(() => expect(statValue("total")).toBe("2"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.caseFilter.test.tsx`
Expected: FAIL — typecheck-free Vitest reports `L.ew_stats_case_suffix` as `undefined` (the `.replace` throws `TypeError: Cannot read properties of undefined`), and before that the employee strip stays at total `5` after the chip click.

- [ ] **Step 3: Add the label keys**

In `src/data/labels/labelsStore.ts`, directly after the `ew_case_filter_empty:` line (line 293), add:

```ts
  /** Appended to the «متابعة العمل» strip title while a case chip other than «جميع الحالات» is active. */
  ew_stats_case_suffix:            " — {filter}",
  ew_stats_case_risk_targeted:     "الحالات المستهدفة",
  ew_stats_case_adhoc:             "الحالات الاستثنائية",
```

- [ ] **Step 4: Compute the stats from the rows the table shows**

In `XrayReferrals.tsx`, replace the whole `computePersonalStats` docblock + function (lines 749-790) with:

```ts
/**
 * The «متابعة العمل» figures, over EXACTLY the rows the queue table shows: the
 * picked scope (everyone, one named employee, or the reader's own rows)
 * narrowed by the active case chip. It used to read the scope BEFORE the chips
 * (and, for employees, re-filter every row by username), so picking
 * «حالات استثنائية» changed the table but not the strip — field report
 * 2026-09-28. The daily-quota tile is not derived here: it is a property of
 * the whole assignment and stays unfiltered. Module-level so the component
 * body stays inside the repo's `max-lines-per-function` budget.
 */
function computePersonalStats(input: {
  source: DistributionEntry[];
  answersMap: Map<string, ItemAnswer>;
  template: TemplateSchema | null;
  templatesById?: ReadonlyMap<string, TemplateSchema>;
}): PersonalStats {
  const { source, answersMap, template, templatesById } = input;
  const onHold = source.filter((entry) => isOnHoldEntry(entry, answersMap, template, templatesById)).length;
  // isStudyCompleted counts a "لا يوجد صورة" submission as completed too — it
  // answers "is this row touched/done in a generic sense" for row styling, not
  // "is this a real completion". Subtracting onHold here is what keeps this
  // strip's "مكتملة" figure from double-counting them.
  const submitted = source.filter((entry) => isStudyCompleted(entry, answersMap)).length - onHold;
  const replaced = source.filter((entry) => entry.status === "replaced").length;
  const notStarted = Math.max(0, source.length - submitted - onHold - replaced);
  return {
    assigned: source.length,
    submitted,
    onHold,
    notStarted,
    replaced,
    active: Math.max(0, source.length - replaced),
    completionPct: pct(submitted, source.length),
  };
}
```

Replace the call site (lines 1221-1224, the four lines starting `const personalStats = useMemo<PersonalStats>(`) with exactly two lines:

```ts
  const personalStats = useMemo<PersonalStats>(() => computePersonalStats({ source: displayEntries, answersMap, template: activeTpl, templatesById }),
    [displayEntries, answersMap, activeTpl, templatesById]);
```

(`displayEntries` is `caseFilter.entries`, declared at line 1074, above this point.)

- [ ] **Step 5: Name the active chip in the strip title**

In `subComponents.tsx`, `ReferralStatsStrip` (line 743): add `caseFilter = "all",` to the destructured props after `scopeEmployeeName = "",`, and add to the props type after `scopeEmployeeName?: string;`:

```ts
  /** The active case chip; the title names it so the reader knows the figures are narrowed. */
  caseFilter?: CaseFilter;
```

After the line `const named = (key: string): string => key.replace("{name}", scopeEmployeeName);` add:

```ts
  const caseSuffix =
    caseFilter === "risk-targeted"
      ? L.ew_stats_case_suffix.replace("{filter}", L.ew_stats_case_risk_targeted)
      : caseFilter === "adhoc"
        ? L.ew_stats_case_suffix.replace("{filter}", L.ew_stats_case_adhoc)
        : "";
```

Replace the title `<strong>` body (lines 806-808)

```tsx
          {scope === "employee"
            ? named(L.ew_queue_stats_employee_title)
            : isAllScope ? "متابعة العمل — جميع الموظفين" : "متابعة العمل"}
```
with

```tsx
          {scope === "employee"
            ? named(L.ew_queue_stats_employee_title)
            : isAllScope ? "متابعة العمل — جميع الموظفين" : "متابعة العمل"}
          {caseSuffix}
```

In `ReferralWorkspaceShell` (line 1278), add `caseFilter={caseFilterValue}` to the `<ReferralStatsStrip … />` props. Update the stale doc comment at `subComponents.tsx:753-757` ("An oversight user switched to the "الكل" view feeds this strip the WHOLE workspace's entries") to end with: "narrowed by the active case chip (see `computePersonalStats`)".

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.caseFilter.test.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.test.ts`
Expected: PASS.

- [ ] **Step 7: Tier-2 gates + complexity**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`
Expected: all green; `XrayReferrals` now 1445 lines.

- [ ] **Step 8: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (referrals): the «متابعة العمل» strip follows the case-filter chips"`
Prose — **Why:** the strip counted the scope before the chips (oversight) or every own row (employees), so it disagreed with the table. **What changed:** stats from `caseFilter.entries`; title names the active chip via three label keys; the daily-quota tile is untouched. Before/After of the `computePersonalStats` source selection.

- [ ] **Step 9: Commit**

```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx src/data/labels/labelsStore.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.caseFilter.test.tsx "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (referrals): work-progress strip follows the case-filter chips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 3: A2 — Data-layer overwrite guard in `saveMonthRun`

**Tier:** 2.

**Root cause (verified):** `saveMonthRunLocked` (`src/data/population/populationStorage.ts:305-316`) only re-checks for a sample when `confirmedOverwrite` is false; `confirmedOverwrite: true` bypasses the data layer entirely, so a month with a distribution and answers can be overwritten by a population that shares none of the sampled ids. Reports key on `xrayImageId` (`executiveReportData.ts:127-135`), so every sampled id missing from the new population vanishes from them.

**Owner rule:** if the month has a distribution **or** any answers, the save is allowed only if every live sampled `xrayImageId` (`liveSampleRows(sample)`) exists in the new population — whatever the caller confirmed. A month with a sample but no distribution/answers keeps today's confirm (`sampleExists`).

**Files:**
- Create: `src/data/population/populationTestFixtures.ts` (test-only builders, reused by Tasks 4, 6, 8)
- Create: `src/data/population/populationOverwriteGuard.ts`
- Modify: `src/data/population/populationStorage.ts:1-45 (imports), 223-232 (result type), 302-316 (guard)`
- Modify: `src/data/labels/labelsStore.ts` (after line 405, `population_reprocess_cancelled`)
- Test: `src/data/population/populationOverwriteGuard.test.ts`

**Interfaces:**
- Consumes: `loadSampleMaster(dir, month): Promise<SampleMasterData | null>` (throws when unreadable), `liveSampleRows(sample)`, `loadOrDeriveDistributionCurrentForRead(dir, month, sampleRows)`, `loadAllEmployeeFiles(dir, month): Promise<EmployeeAnswerFile[]>`.
- Produces (`populationOverwriteGuard.ts`):
  ```ts
  export const OVERWRITE_MISSING_EXAMPLE_LIMIT = 10;
  export type PopulationOverwriteImpact = { sampleExists: boolean; liveSampledIds: string[]; distributionCount: number; answerCount: number };
  export type PopulationOverwriteAssessment = PopulationOverwriteImpact & { missingCount: number; missingExamples: string[]; blocked: boolean };
  export async function loadPopulationOverwriteImpact(directoryHandle: DirectoryHandleLike, monthFolderName: string): Promise<PopulationOverwriteImpact>;
  export function assessPopulationOverwrite(impact: PopulationOverwriteImpact, newRows: ReadonlyArray<Record<string, unknown>>): PopulationOverwriteAssessment;
  ```
- Produces (`populationStorage.ts`): `SaveMonthRunResult`'s failure arm gains `overwriteBlocked?: { missingCount: number; missingExamples: string[]; distributionCount: number; answerCount: number }`.
- Produces (fixtures): `makePopulationRow(xrayImageId: string, portName?: string): PreparedPopulationRow`, `makeSampleMaster(rows: PreparedPopulationRow[]): SampleMasterData`.
- Label: `population_overwrite_blocked_error` (`{missing}` placeholder).

- [ ] **Step 1: Create the shared test fixtures**

Create `src/data/population/populationTestFixtures.ts`:

```ts
/**
 * Test-only builders shared by the population overwrite / archive / recovery
 * and report-fallback suites. Never imported by app code.
 */
import type { PreparedPopulationRow } from "./populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";

export function makePopulationRow(xrayImageId: string, portName = "بري"): PreparedPopulationRow {
  return {
    xrayImageId,
    portName,
    certScanStatus: "NonCertscan",
    stage: "FIRST_STAGE",
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

export function makeSampleMaster(rows: PreparedPopulationRow[]): SampleMasterData {
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
    drawnAt: "2026-05-01T08:00:00.000Z",
    drawnBy: "admin",
    rows,
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/data/population/populationOverwriteGuard.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { appendDistributionEvents } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { upsertItemAnswer } from "../answers/answerStorage";
import { formatMonthFolderName } from "./monthFolder";
import { invalidateMonthLockCache } from "./monthLock";
import { loadMonthPopulationFinal, saveMonthRun } from "./populationStorage";
import { makePopulationRow, makeSampleMaster } from "./populationTestFixtures";
import {
  OVERWRITE_MISSING_EXAMPLE_LIMIT,
  assessPopulationOverwrite,
  loadPopulationOverwriteImpact,
} from "./populationOverwriteGuard";

const MONTH = formatMonthFolderName(5, 2026);

const baseParams = {
  month: 5,
  year: 2026,
  username: "admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  riskRawRows: [{ id: "raw-1" }],
  biRawRows: [],
  certScanRows: 0,
  nonCertScanRows: 1,
};

function rowsFor(ids: string[]): Array<Record<string, unknown>> {
  return ids.map((id) => makePopulationRow(id) as unknown as Record<string, unknown>);
}

async function seedMonth(
  root: DirectoryHandleLike,
  options: { distributed: boolean; answered: boolean }
): Promise<void> {
  const first = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["A1", "A2", "A3"]) });
  if (!first.ok) throw new Error(`seed population failed: ${first.error}`);
  const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster([makePopulationRow("A1"), makePopulationRow("A2")]));
  if (!sampled.ok) throw new Error(`seed sample failed: ${sampled.error}`);
  if (options.distributed) {
    const assigned = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
    ]);
    if (!assigned.ok) throw new Error(`seed distribution failed: ${assigned.error}`);
  }
  if (options.answered) {
    const saved = await upsertItemAnswer(root, MONTH, "emp1", {
      xrayImageId: "A1",
      templateId: "tpl",
      templateVersion: 1,
      answers: [],
      lastSavedAt: "2026-05-02T08:00:00.000Z",
      submittedAt: "2026-05-02T08:00:00.000Z",
      answeredBy: "emp1",
      status: "submitted",
    });
    if (!saved.ok) throw new Error(`seed answer failed: ${saved.error}`);
  }
}

async function populationIds(root: DirectoryHandleLike): Promise<string[]> {
  const final = await loadMonthPopulationFinal(root, MONTH);
  return (final?.rows ?? []).map((row) => String(row["xrayImageId"]));
}

beforeEach(() => {
  invalidateMonthLockCache();
});

describe("saveMonthRun — overwrite guard (A2)", () => {
  test("refuses, even with confirmedOverwrite, when a distributed month would lose a sampled id", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: true, answered: false });

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["A1", "B9"]),
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.overwriteBlocked).toEqual({
      missingCount: 1,
      missingExamples: ["A2"],
      distributionCount: 1,
      answerCount: 0,
    });
    expect(await populationIds(root)).toEqual(["A1", "A2", "A3"]);
  });

  test("refuses when the month has answers even without a distribution", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: true });

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["Z1"]),
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.overwriteBlocked?.missingCount).toBe(2);
    expect(result.overwriteBlocked?.answerCount).toBe(1);
  });

  test("allows a confirmed overwrite whose ids are a superset of the sample", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: true, answered: true });

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["A1", "A2", "A9"]),
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(true);
    expect(await populationIds(root)).toEqual(["A1", "A2", "A9"]);
  });

  test("keeps today's confirm for a month with a sample but no distribution or answers", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: false });

    const unconfirmed = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["Z1"]) });
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) {
      expect(unconfirmed.sampleExists).toBe(true);
      expect(unconfirmed.overwriteBlocked).toBeUndefined();
    }

    const confirmed = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["Z1"]),
      confirmedOverwrite: true,
    });
    expect(confirmed.ok).toBe(true);
  });
});

describe("assessPopulationOverwrite", () => {
  test("caps the example ids and reports the full missing count", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `S${String(i).padStart(2, "0")}`);
    const assessment = assessPopulationOverwrite(
      { sampleExists: true, liveSampledIds: ids, distributionCount: 25, answerCount: 0 },
      rowsFor(["S00"])
    );
    expect(assessment.missingCount).toBe(24);
    expect(assessment.missingExamples).toHaveLength(OVERWRITE_MISSING_EXAMPLE_LIMIT);
    expect(assessment.missingExamples[0]).toBe("S01");
    expect(assessment.blocked).toBe(true);
  });

  test("never blocks a month with no distribution and no answers", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: false });
    const impact = await loadPopulationOverwriteImpact(root, MONTH);
    expect(impact).toEqual({ sampleExists: true, liveSampledIds: ["A1", "A2"], distributionCount: 0, answerCount: 0 });
    expect(assessPopulationOverwrite(impact, rowsFor(["Z1"])).blocked).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/data/population/populationOverwriteGuard.test.ts`
Expected: FAIL — `Failed to resolve import "./populationOverwriteGuard"`.

- [ ] **Step 4: Implement the guard module**

Create `src/data/population/populationOverwriteGuard.ts`:

```ts
/**
 * A2 (owner decision 2026-09-28): a re-processed population must never orphan
 * a month's sample once work has been done on it.
 *
 * Reports drive from the population and look up sample/answer data by
 * `xrayImageId`, so any live sampled id absent from a new population silently
 * vanishes from every report — the field case was a re-process with a file
 * from the wrong period that shared NO ids with the sample (0 answers shown).
 *
 * The rule is enforced in the data layer (`saveMonthRunLocked`), whatever the
 * caller confirmed; the Population tab calls the same two functions before the
 * save only to show the counts in its dialog.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { liveSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import { loadOrDeriveDistributionCurrentForRead } from "../distribution/distributionStorage";
import { loadAllEmployeeFiles } from "../answers/answerStorage";

/** How many missing ids a refusal names (the full count is always reported). */
export const OVERWRITE_MISSING_EXAMPLE_LIMIT = 10;

export type PopulationOverwriteImpact = {
  sampleExists: boolean;
  /** `liveSampleRows(sample)` ids — retired-by-replacement rows excluded. */
  liveSampledIds: string[];
  distributionCount: number;
  answerCount: number;
};

export type PopulationOverwriteAssessment = PopulationOverwriteImpact & {
  missingCount: number;
  missingExamples: string[];
  /** True when the save must be refused whatever the user confirms. */
  blocked: boolean;
};

/**
 * What a population overwrite of this month would put at risk. Throws when the
 * sample exists but cannot be read (`loadSampleMaster`'s v93 contract) — a
 * guard that cannot see the sample must refuse, not guess.
 */
export async function loadPopulationOverwriteImpact(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<PopulationOverwriteImpact> {
  const sample = await loadSampleMaster(directoryHandle, monthFolderName);
  if (!sample) {
    return { sampleExists: false, liveSampledIds: [], distributionCount: 0, answerCount: 0 };
  }
  const [distribution, employeeFiles] = await Promise.all([
    loadOrDeriveDistributionCurrentForRead(directoryHandle, monthFolderName, sample.rows),
    loadAllEmployeeFiles(directoryHandle, monthFolderName),
  ]);
  return {
    sampleExists: true,
    liveSampledIds: liveSampleRows(sample).map((row) => row.xrayImageId),
    distributionCount: distribution?.entries.length ?? 0,
    answerCount: employeeFiles.reduce((total, file) => total + file.items.length, 0),
  };
}

/** Pure: which live sampled ids the new rows lack, and whether that blocks the save. */
export function assessPopulationOverwrite(
  impact: PopulationOverwriteImpact,
  newRows: ReadonlyArray<Record<string, unknown>>
): PopulationOverwriteAssessment {
  const newIds = new Set<string>();
  for (const row of newRows) {
    const id = row["xrayImageId"];
    if (typeof id === "string") newIds.add(id);
  }
  const missing = impact.liveSampledIds.filter((id) => !newIds.has(id));
  const hasWork = impact.distributionCount > 0 || impact.answerCount > 0;
  return {
    ...impact,
    missingCount: missing.length,
    missingExamples: missing.slice(0, OVERWRITE_MISSING_EXAMPLE_LIMIT),
    blocked: hasWork && missing.length > 0,
  };
}
```

- [ ] **Step 5: Add the label**

In `src/data/labels/labelsStore.ts`, after `population_reprocess_cancelled:` (line 405):

```ts
  population_overwrite_blocked_error: "رُفض الحفظ: {missing} من صور العينة الحالية غير موجودة في المجتمع الجديد، ولهذا الشهر توزيع أو إجابات محفوظة. تأكّد أن الملف يخص الشهر نفسه — بقيت بيانات الشهر السابقة دون تغيير.",
```

- [ ] **Step 6: Enforce the rule in `saveMonthRunLocked`**

6a. In `populationStorage.ts` imports, add:

```ts
import { assessPopulationOverwrite, loadPopulationOverwriteImpact } from "./populationOverwriteGuard";
import { getLabels } from "../labels/labelsStore";
```

6b. Extend the failure arm of `SaveMonthRunResult` (lines 223-232) — after `sampleExists?: true;` add:

```ts
  /**
   * A2: the month has a distribution or answers and the new population lacks
   * live sampled ids. Refused regardless of `confirmedOverwrite`.
   */
  overwriteBlocked?: {
    missingCount: number;
    missingExamples: string[];
    distributionCount: number;
    answerCount: number;
  };
```

6c. Replace the TOCTOU block (lines 302-316, from the comment `// TOCTOU guard: re-check under the lock …` through the closing `}` of `if (!confirmedOverwrite) { … }`) with:

```ts
    // A2 overwrite rule (owner decision 2026-09-28), enforced HERE, under the
    // manifest lock, whatever the caller confirmed: once a month has a
    // distribution or answers, a population that lacks any live sampled id is
    // refused — it would orphan that work in every report.
    const impact = await loadPopulationOverwriteImpact(directoryHandle, monthFolderName);
    const assessment = assessPopulationOverwrite(impact, processedRows);
    if (assessment.blocked) {
      return {
        ok: false,
        error: getLabels().population_overwrite_blocked_error.replace("{missing}", String(assessment.missingCount)),
        overwriteBlocked: {
          missingCount: assessment.missingCount,
          missingExamples: assessment.missingExamples,
          distributionCount: assessment.distributionCount,
          answerCount: assessment.answerCount,
        },
      };
    }

    // TOCTOU guard: re-check under the lock that no sample was drawn since the
    // caller's pre-check. Overwriting the population while a sample exists
    // needs the user's explicit confirmation.
    if (!confirmedOverwrite && impact.sampleExists) {
      return {
        ok: false,
        error: `يوجد سحب عينة لهذا الشهر (${monthFolderName}) — تأكيد الاستبدال مطلوب قبل إعادة الحفظ.`,
        sampleExists: true,
      };
    }
```

(`loadSampleMaster` is still imported and used elsewhere in the file; leave the import.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/data/population/populationOverwriteGuard.test.ts src/data/population/rawSupersede.test.ts src/data/population/populationStorage.test.ts`
Expected: PASS.

- [ ] **Step 8: Tier-2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 9: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (population): refuse a population overwrite that would orphan a worked sample"`
Prose — **Why:** `confirmedOverwrite: true` bypassed the data layer; a wrong-period re-process orphaned every sampled id (reports showed 0 answers). **What changed:** `populationOverwriteGuard.ts` (impact + pure assessment), enforced in `saveMonthRunLocked` regardless of confirmation; typed `overwriteBlocked` result. Before/After of the TOCTOU block.

- [ ] **Step 10: Commit**

```bash
git add src/data/population/populationOverwriteGuard.ts src/data/population/populationOverwriteGuard.test.ts src/data/population/populationTestFixtures.ts src/data/population/populationStorage.ts src/data/labels/labelsStore.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (population): refuse an overwrite that would orphan a worked sample

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 4: A2 — Versioned archives before a population overwrite

**Tier:** 3 (new on-disk artefacts; pass `--bump=minor`).

**Root cause (verified):** `population.final.json` is overwritten in place with only safeWrite's single `.bak` (`populationStorage.ts:401-410`), and `risk.source.*` / `bi.source.*` are overwritten by `saveBinaryFile` with no backup (`:85-100`, `:340-360`). Only `risk.raw.json`/`bi.raw.json` get `*.superseded.json` archives (`archiveExistingRaw`, `:251-278`).

**Design:** before each overwrite, byte-copy the live file to `{stem}.{ISO-ts without colons}.superseded{ext}` in the same folder (mirrors `archiveExistingRaw`'s naming). `population.final.json`'s archive is **mandatory** — if it cannot be written the save is refused rather than overwriting without a copy; source-file archives are best-effort (logged), like the raw archive.

**Files:**
- Modify: `src/data/population/populationStorage.ts` (new helpers after `archiveExistingRaw`, line 278; calls inside `saveMonthRunLocked` Promise.all branches and before the `population.final.json` write)
- Test: `src/data/population/populationArchive.test.ts`

**Interfaces:**
- Consumes: `copyFileBytes(sourceDir, sourceName, targetDir, targetName): Promise<number>`, `isNotFoundError(error)` from `../storage/transientFileErrors`.
- Produces:
  ```ts
  export function supersedeStamp(now?: Date): string; // "2026-09-28T101500.123Z"
  export function supersededFileName(liveName: string, stamp: string): string;
  // "population.final.json" → "population.final.{stamp}.superseded.json"; "risk.source.xlsx" → "risk.source.{stamp}.superseded.xlsx"
  export async function archiveBeforeOverwrite(dir: DirectoryHandleLike, liveName: string, stamp: string, options?: { required?: boolean }): Promise<string | null>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/data/population/populationArchive.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { safeReadJson } from "../storage/safeWrite";
import { formatMonthFolderName } from "./monthFolder";
import { invalidateMonthLockCache } from "./monthLock";
import { saveMonthRun, supersededFileName } from "./populationStorage";
import type { PopulationFinalData } from "./monthTypes";
import { makePopulationRow } from "./populationTestFixtures";

const MONTH = formatMonthFolderName(5, 2026);

const baseParams = {
  month: 5,
  year: 2026,
  username: "admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  riskRawRows: [{ id: "raw-1" }],
  biRawRows: [],
  certScanRows: 0,
  nonCertScanRows: 1,
};

async function monthSubdir(root: DirectoryHandleLike, sub: "1-raw" | "2-processed"): Promise<DirectoryHandleLike> {
  const population = await root.getDirectoryHandle("1-population", { create: false });
  const month = await population.getDirectoryHandle(MONTH, { create: false });
  return month.getDirectoryHandle(sub, { create: false });
}

async function fileNames(dir: DirectoryHandleLike): Promise<string[]> {
  return (await listDirectoryEntries(dir)).filter((entry) => entry.kind === "file").map((entry) => entry.name);
}

beforeEach(() => {
  invalidateMonthLockCache();
});

describe("supersededFileName", () => {
  test("inserts the stamp before the extension", () => {
    expect(supersededFileName("population.final.json", "T1")).toBe("population.final.T1.superseded.json");
    expect(supersededFileName("risk.source.xlsx", "T1")).toBe("risk.source.T1.superseded.xlsx");
    expect(supersededFileName("bi.source.2.xlsb", "T1")).toBe("bi.source.2.T1.superseded.xlsb");
  });
});

describe("saveMonthRun archives before it overwrites (A2)", () => {
  test("the first save archives nothing", async () => {
    const root = createMemoryDirectory("root");
    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
      riskSourceFile: new File(["first-bytes"], "risk.xlsx"),
    });
    expect(result.ok).toBe(true);
    expect((await fileNames(await monthSubdir(root, "2-processed"))).filter((n) => n.includes(".superseded."))).toEqual([]);
    expect((await fileNames(await monthSubdir(root, "1-raw"))).filter((n) => n.startsWith("risk.source.") && n.includes(".superseded."))).toEqual([]);
  });

  test("a re-save keeps the previous population.final.json and risk source as superseded copies", async () => {
    const root = createMemoryDirectory("root");
    const first = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
      riskSourceFile: new File(["first-bytes"], "risk.xlsx"),
    });
    expect(first.ok).toBe(true);

    const second = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("B1") as unknown as Record<string, unknown>],
      riskSourceFile: new File(["second-bytes"], "risk.xlsx"),
    });
    expect(second.ok).toBe(true);

    const processed = await monthSubdir(root, "2-processed");
    const archives = (await fileNames(processed)).filter((n) => /^population\.final\..+\.superseded\.json$/.test(n));
    expect(archives).toHaveLength(1);
    expect(archives[0]).not.toContain(":");
    const archived = await safeReadJson<PopulationFinalData>(processed, archives[0]!);
    expect(archived.ok).toBe(true);
    if (archived.ok) {
      expect(archived.value.rows.map((row) => row["xrayImageId"])).toEqual(["A1"]);
    }
    const live = await safeReadJson<PopulationFinalData>(processed, "population.final.json");
    expect(live.ok && live.value.rows.map((row) => row["xrayImageId"])).toEqual(["B1"]);

    const raw = await monthSubdir(root, "1-raw");
    const sourceArchives = (await fileNames(raw)).filter((n) => /^risk\.source\..+\.superseded\.xlsx$/.test(n));
    expect(sourceArchives).toHaveLength(1);
    const archivedSource = await (await (await raw.getFileHandle(sourceArchives[0]!)).getFile()).text();
    expect(archivedSource).toBe("first-bytes");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/population/populationArchive.test.ts`
Expected: FAIL — `supersededFileName` is not exported (`TypeError: supersededFileName is not a function`), and the re-save test finds 0 archives.

- [ ] **Step 3: Implement the helpers**

In `populationStorage.ts`, add the import `import { isNotFoundError } from "../storage/transientFileErrors";` and, directly after `archiveExistingRaw` (after line 278), add:

```ts
/** Filename-safe ISO timestamp — the same stamp shape `archiveExistingRaw` uses. */
export function supersedeStamp(now: Date = new Date()): string {
  return now.toISOString().replace(/:/g, "");
}

/** `population.final.json` → `population.final.{stamp}.superseded.json`; `risk.source.xlsx` → `risk.source.{stamp}.superseded.xlsx`. */
export function supersededFileName(liveName: string, stamp: string): string {
  const dot = liveName.lastIndexOf(".");
  return dot <= 0
    ? `${liveName}.${stamp}.superseded`
    : `${liveName.slice(0, dot)}.${stamp}.superseded${liveName.slice(dot)}`;
}

/**
 * A2: byte-copy `liveName` aside before it is overwritten. Returns the archive
 * name, or null when there was nothing to archive. A byte copy, like the
 * compressed-raw branch of `archiveExistingRaw`: the archive is the original
 * record, and `safeReadJson`'s dual read opens it whichever framing it has.
 *
 * `required: true` (population.final.json) turns an archive failure into a
 * thrown error, so the caller's save is refused rather than overwriting the
 * only full copy; otherwise failures are logged and the save proceeds.
 */
export async function archiveBeforeOverwrite(
  dir: DirectoryHandleLike,
  liveName: string,
  stamp: string,
  options: { required?: boolean } = {}
): Promise<string | null> {
  try {
    await dir.getFileHandle(liveName, { create: false });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    if (options.required) throw error;
    logError("population:archive-superseded", error);
    return null;
  }
  const archiveName = supersededFileName(liveName, stamp);
  try {
    await copyFileBytes(dir, liveName, dir, archiveName);
    return archiveName;
  } catch (error) {
    if (options.required) throw error;
    logError("population:archive-superseded", error);
    return null;
  }
}
```

- [ ] **Step 4: Call the helpers in `saveMonthRunLocked`**

4a. Immediately after `await ensureFolder(monthDir, "reports");` (inside `withWorkspaceWriteAccess`), add:

```ts
      // A2: one stamp per save, shared by every archive this save writes, so
      // the population and the sources it was built from stay pairable.
      const stamp = supersedeStamp(new Date(now));
      // Mandatory, and BEFORE anything is overwritten: without this copy a
      // re-process leaves only safeWrite's single `.bak` of the population.
      await archiveBeforeOverwrite(processedDir, "population.final.json", stamp, { required: true });
```

4b. In the risk-source branch, replace

```ts
          await saveBinaryFile(rawDir, `risk.source.${ext}`, buf);
```
with

```ts
          await archiveBeforeOverwrite(rawDir, `risk.source.${ext}`, stamp);
          await saveBinaryFile(rawDir, `risk.source.${ext}`, buf);
```

4c. In the BI-source loop, replace

```ts
            const name = single ? `bi.source.${ext}` : `bi.source.${index + 1}.${ext}`;
            await saveBinaryFile(rawDir, name, buf);
```
with

```ts
            const name = single ? `bi.source.${ext}` : `bi.source.${index + 1}.${ext}`;
            await archiveBeforeOverwrite(rawDir, name, stamp);
            await saveBinaryFile(rawDir, name, buf);
```

(`now` is the ISO string declared earlier in the function; `new Date(now)` reproduces the same instant.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/population/populationArchive.test.ts src/data/population/rawSupersede.test.ts src/data/population/populationOverwriteGuard.test.ts`
Expected: PASS.

- [ ] **Step 6: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green. (A test that lists `2-processed/` names and now sees a `*.superseded.json` must be updated to expect it — record any such change in the edit log.)

- [ ] **Step 7: Edit-log entry**

Run: `npm run editlog -- --tier=3 --bump=minor --append --sync-package "Add (population): keep a superseded copy of population.final.json and the source workbooks before a re-process overwrites them"`
Prose — **Why**, **What changed**, Before/After of the risk-source write, plus **Migration:** none — new files only, no existing file changes shape. **Rollback:** revert; the extra `*.superseded.*` files are inert (nothing reads them except the Task 8 recovery tool).

- [ ] **Step 8: Commit**

```bash
git add src/data/population/populationStorage.ts src/data/population/populationArchive.test.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (population): archive population.final.json and sources before overwrite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 5: A2 — Reprocess dialog shows the impact and cannot continue when blocked

**Tier:** 2. **PopulationTab net line delta: ≤ +5** (headroom 43).

**Root cause (verified):** the only UI guard is a generic confirm (`Population/index.tsx:1568-1590`, label `population_reprocess_confirm_message`) opened by `performSaveToDisk`'s sample-only pre-check (`:981-1002`); it shows no counts and always offers «متابعة».

**Files:**
- Modify: `src/components/ConfirmDialog/ConfirmDialog.tsx:16-28, 30-39, 70-84` (optional `hideConfirm`)
- Create: `src/components/Sidebar/Tabs/Population/components/ReprocessConfirmDialog.tsx`
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx:34, 75, 525-534, 981-1002, 1087-1095, 1568-1590`
- Modify: `src/data/labels/labelsStore.ts` (after `population_overwrite_blocked_error`)
- Test: `src/components/Sidebar/Tabs/Population/components/ReprocessConfirmDialog.test.tsx`

**Interfaces:**
- Consumes (Task 3): `loadPopulationOverwriteImpact`, `assessPopulationOverwrite`, `PopulationOverwriteAssessment`; `SaveMonthRunResult.overwriteBlocked`.
- Produces:
  ```ts
  // ConfirmDialog
  hideConfirm?: boolean; // omits the confirm button; the cancel button remains
  // ReprocessConfirmDialog.tsx
  export function ReprocessConfirmDialog(props: {
    open: boolean;
    assessment: PopulationOverwriteAssessment | null;
    onConfirm: () => void;
    onCancel: () => void;
  }): React.JSX.Element | null;
  ```
- Labels: `population_reprocess_impact_counts` (`{answers}`, `{distribution}`, `{missing}`), `population_reprocess_missing_examples` (`{ids}`), `population_reprocess_blocked_title`, `population_reprocess_blocked_message`, `population_reprocess_blocked_close`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Sidebar/Tabs/Population/components/ReprocessConfirmDialog.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../../../../data/labels/labelsStore";
import type { PopulationOverwriteAssessment } from "../../../../../data/population/populationOverwriteGuard";
import { ReprocessConfirmDialog } from "./ReprocessConfirmDialog";

afterEach(cleanup);

function assessment(overrides: Partial<PopulationOverwriteAssessment>): PopulationOverwriteAssessment {
  return {
    sampleExists: true,
    liveSampledIds: ["A1", "A2"],
    distributionCount: 2,
    answerCount: 1,
    missingCount: 0,
    missingExamples: [],
    blocked: false,
    ...overrides,
  };
}

describe("ReprocessConfirmDialog", () => {
  it("shows the answer, distribution and missing counts and lets the user continue", () => {
    const onConfirm = vi.fn();
    render(<ReprocessConfirmDialog open assessment={assessment({})} onConfirm={onConfirm} onCancel={() => {}} />);

    expect(screen.getByText(DEFAULT_LABELS.population_reprocess_confirm_title)).toBeInTheDocument();
    expect(
      screen.getByText(
        DEFAULT_LABELS.population_reprocess_impact_counts
          .replace("{answers}", "1")
          .replace("{distribution}", "2")
          .replace("{missing}", "0")
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("explains a blocked save, lists example ids, and offers no way to continue", () => {
    const onCancel = vi.fn();
    render(
      <ReprocessConfirmDialog
        open
        assessment={assessment({ missingCount: 2, missingExamples: ["A1", "A2"], blocked: true })}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText(DEFAULT_LABELS.population_reprocess_blocked_title)).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_LABELS.population_reprocess_blocked_message)).toBeInTheDocument();
    expect(
      screen.getByText(DEFAULT_LABELS.population_reprocess_missing_examples.replace("{ids}", "A1، A2"))
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_reprocess_blocked_close }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without an assessment", () => {
    const { container } = render(
      <ReprocessConfirmDialog open={false} assessment={null} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(container.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/components/ReprocessConfirmDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./ReprocessConfirmDialog"`.

- [ ] **Step 3: Add the labels**

In `labelsStore.ts`, after `population_overwrite_blocked_error`:

```ts
  population_reprocess_impact_counts: "إجابات محفوظة: {answers} · صور موزعة: {distribution} · صور من العينة غير موجودة في المجتمع الجديد: {missing}",
  population_reprocess_missing_examples: "أمثلة على الصور المفقودة: {ids}",
  population_reprocess_blocked_title: "لا يمكن حفظ المجتمع الجديد",
  population_reprocess_blocked_message: "لهذا الشهر توزيع أو إجابات محفوظة، والمجتمع الجديد لا يحتوي بعض صور العينة الحالية. الحفظ سيُخفي هذه الصور وإجاباتها من التقارير، لذلك تم إيقافه. تأكّد أن الملفات تخص الشهر نفسه ثم أعد المعالجة.",
  population_reprocess_blocked_close: "إغلاق",
```

- [ ] **Step 4: `ConfirmDialog` — optional `hideConfirm`**

In `ConfirmDialog.tsx`: add to `ConfirmDialogProps` after `danger?: boolean;`:

```ts
  /** Omit the confirm button — for an explanation the user can only dismiss. */
  hideConfirm?: boolean;
```
add `hideConfirm = false,` to the destructured parameters after `danger = false,`, and wrap the confirm `<button …confirm-dialog__btn--confirm…>` element in `{!hideConfirm && ( … )}`.

- [ ] **Step 5: Create the dialog component**

Create `src/components/Sidebar/Tabs/Population/components/ReprocessConfirmDialog.tsx`:

```tsx
import { ConfirmDialog } from "../../../../ConfirmDialog/ConfirmDialog";
import { useLabels } from "../../../../../data/labels/useLabels";
import type { PopulationOverwriteAssessment } from "../../../../../data/population/populationOverwriteGuard";

const count = (value: number): string => value.toLocaleString("ar-SA-u-nu-latn");

/**
 * The re-process confirmation (A2). Shows what the overwrite puts at risk —
 * answers, distributed rows, and live sampled ids the new population lacks —
 * and, when the data layer would refuse the save anyway (`blocked`), explains
 * why and offers no way to continue.
 */
export function ReprocessConfirmDialog({
  open,
  assessment,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  assessment: PopulationOverwriteAssessment | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const L = useLabels();
  if (!assessment) return null;
  const counts = L.population_reprocess_impact_counts
    .replace("{answers}", count(assessment.answerCount))
    .replace("{distribution}", count(assessment.distributionCount))
    .replace("{missing}", count(assessment.missingCount));
  return (
    <ConfirmDialog
      open={open}
      danger
      hideConfirm={assessment.blocked}
      title={assessment.blocked ? L.population_reprocess_blocked_title : L.population_reprocess_confirm_title}
      cancelLabel={assessment.blocked ? L.population_reprocess_blocked_close : undefined}
      message={
        <>
          <p>{assessment.blocked ? L.population_reprocess_blocked_message : L.population_reprocess_confirm_message}</p>
          <p>{counts}</p>
          {assessment.missingExamples.length > 0 && (
            <p>{L.population_reprocess_missing_examples.replace("{ids}", assessment.missingExamples.join("، "))}</p>
          )}
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
```

(`cancelLabel={undefined}` falls back to `ConfirmDialog`'s default parameter.)

- [ ] **Step 6: Wire it into the Population tab**

6a. Imports: change line 34 to `import { saveSampleMaster } from "../../../../data/sampling/sampleStorage";` (its only other use, `loadSampleMaster`, is removed in 6c); delete line 75 (`import { ConfirmDialog } …` — its single use is replaced in 6e); add

```ts
import {
  assessPopulationOverwrite,
  loadPopulationOverwriteImpact,
  type PopulationOverwriteAssessment,
} from "../../../../data/population/populationOverwriteGuard";
import { ReprocessConfirmDialog } from "./components/ReprocessConfirmDialog";
```

6b. `pendingReprocessSave` state (lines 530-534): add `assessment: PopulationOverwriteAssessment;` to the object type after `monthFolderName: string;`.

6c. In `performSaveToDisk`, replace from `let existingSample: Awaited<ReturnType<typeof loadSampleMaster>>;` through the closing `}` of `if (existingSample) { … }` with:

```ts
    let assessment: PopulationOverwriteAssessment;
    try {
      assessment = assessPopulationOverwrite(
        await loadPopulationOverwriteImpact(directoryHandle, monthFolderName),
        processingResult.preparedRows as unknown as Array<Record<string, unknown>>
      );
    } catch (error) {
      // The sample exists but could not be read (v93 contract) — a SAVE-step
      // failure: keep the processing result, name the real cause, let the
      // user retry the save.
      const code = resolveErrorCode(error) ?? "XQ-POP-006";
      logCodedError("population:save-precheck", code, error);
      setSaveToDiskMessage({ type: "error", text: codedMessage(code) });
      return;
    }
    if (assessment.sampleExists) {
      setPendingReprocessSave({ processingResult, riskResult, monthFolderName, assessment });
      return;
    }
```

6d. In `commitSaveToDisk`, replace the `} else if (result.sampleExists) { … }` branch (the comment plus the `setPendingReprocessSave({ … })` call) with:

```ts
      } else if (result.sampleExists || result.overwriteBlocked) {
        // A sample or distribution appeared since the pre-check (TOCTOU), or the
        // data layer refused the overwrite: re-assess and re-open the dialog,
        // which shows the refusal (and hides «متابعة») when blocked.
        void performSaveToDisk(processingResult, riskResult);
```

6e. Replace the whole `<ConfirmDialog open={pendingReprocessSave !== null && activeSubTab === "process"} … />` element (lines 1568-1590) with:

```tsx
      <ReprocessConfirmDialog
        open={pendingReprocessSave !== null && activeSubTab === "process"}
        assessment={pendingReprocessSave?.assessment ?? null}
        onConfirm={() => {
          const pending = pendingReprocessSave;
          setPendingReprocessSave(null);
          if (!pending || pending.assessment.blocked) return;
          // The month changed under the open dialog — confirming now would
          // write the OLD month's population into the newly selected month.
          if (pending.monthFolderName !== formatMonthFolderName(saveMonth, saveYear)) {
            setSaveToDiskMessage({ type: "error", text: getLabels().population_reprocess_cancelled });
            return;
          }
          void commitSaveToDisk(pending.processingResult, pending.riskResult, true);
        }}
        onCancel={() => {
          setPendingReprocessSave(null);
          setSaveToDiskMessage({ type: "error", text: getLabels().population_reprocess_cancelled });
        }}
      />
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/components/ReprocessConfirmDialog.test.tsx src/components/ConfirmDialog`
Expected: PASS.

- [ ] **Step 8: Gates + complexity**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`
Expected: all green. Any Population-tab test that mocked `loadSampleMaster` to drive the old confirm must now drive `loadPopulationOverwriteImpact` (or seed a real sample) — adjust it and say so in the edit log.

- [ ] **Step 9: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Change (population): the re-process dialog shows answers, distribution and missing-sample counts, and cannot continue when the save would orphan work"`
Prose with Before/After of the `performSaveToDisk` pre-check.

- [ ] **Step 10: Commit**

```bash
git add src/components/ConfirmDialog/ConfirmDialog.tsx src/components/Sidebar/Tabs/Population/components/ReprocessConfirmDialog.tsx src/components/Sidebar/Tabs/Population/components/ReprocessConfirmDialog.test.tsx src/components/Sidebar/Tabs/Population/index.tsx src/data/labels/labelsStore.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Change (population): re-process dialog shows impact and blocks orphaning saves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 6: A2 — Report rows fall back to the sample snapshot for sampled ids missing from the population

**Tier:** 2. Deterministic builder — **snapshot first**.

**Root cause (verified):** `buildExecutiveReportRows` (`src/data/reporting/executiveReportData.ts:89-210`) maps only `populationRows`; a live sampled id absent from the population produces no row at all, so its distribution/answer data disappear from every report.

**Design:** after the population rows, emit one row per live sampled row (`liveSampleRows(sample)`) whose id is absent from the population, built from the `sample.master.json` snapshot row and flagged `fromSampleSnapshot: true`. The flag is spread **last and only when true**, so a month without orphans produces byte-identical rows. Population-wide KPIs (`totalPopulation`, `sampleCoverage`, suspicious/clean counts, `suspicionRate`, level disagreement) exclude flagged rows; sample-scoped KPIs include them.

**Files:**
- Modify: `src/data/reporting/executiveReportTypes.ts:86` (new optional field after `targetedByRiskEngine`)
- Modify: `src/data/reporting/executiveReportData.ts:1, 89-210, 214-226, 263-266`
- Test: `src/data/reporting/executiveReportData.snapshotRows.test.ts`

**Interfaces:**
- Consumes: `liveSampleRows(sample)` (already imported), `ExecutiveReportInput`.
- Produces:
  ```ts
  // ExecutiveReportRow
  /** A2: built from the sample.master.json snapshot because the id is missing from the month's population. Absent otherwise. */
  fromSampleSnapshot?: true;
  // executiveReportData.ts
  export function sampleRowsMissingFromPopulation(populationRows: readonly PreparedPopulationRow[], sample: SampleMasterData | null): PreparedPopulationRow[];
  ```

- [ ] **Step 1: Snapshot the current output (before any change)**

Create `src/data/reporting/executiveReportData.snapshotRows.test.ts` with ONLY this content first:

```ts
import { describe, expect, it } from "vitest";

import type { EmployeeAnswerFile } from "../answers/answerTypes";
import { makePopulationRow, makeSampleMaster } from "../population/populationTestFixtures";
import { buildExecutiveReportRows, calculateExecutiveKPIs } from "./executiveReportData";
import { DEFAULT_EXEC_CONFIG, type ExecutiveReportInput } from "./executiveReportTypes";

const MONTH = "5-May-2026";

function answered(xrayImageId: string): EmployeeAnswerFile {
  return {
    username: "emp1",
    monthFolderName: MONTH,
    items: [
      {
        xrayImageId,
        templateId: "tpl",
        templateVersion: 1,
        answers: [{ fieldId: DEFAULT_EXEC_CONFIG.expertResultFieldId, value: "سليمة" }],
        lastSavedAt: "2026-05-02T08:00:00.000Z",
        submittedAt: "2026-05-02T08:00:00.000Z",
        answeredBy: "emp1",
        status: "submitted",
      },
    ],
  };
}

function input(sampleIds: string[], answeredId: string): ExecutiveReportInput {
  return {
    monthFolderName: MONTH,
    populationRows: ["P1", "P2", "P3"].map((id) => makePopulationRow(id)),
    sample: makeSampleMaster(sampleIds.map((id) => makePopulationRow(id))),
    distribution: null,
    employeeFiles: [answered(answeredId)],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("buildExecutiveReportRows — deterministic output for a month with no orphans", () => {
  it("matches the pre-change snapshot", () => {
    expect(buildExecutiveReportRows(input(["P1", "P2"], "P1"))).toMatchSnapshot();
  });
});
```

Run: `npx vitest run src/data/reporting/executiveReportData.snapshotRows.test.ts`
Expected: PASS, writing `src/data/reporting/__snapshots__/executiveReportData.snapshotRows.test.ts.snap`. Commit the snapshot now, before touching the builder:

```bash
git add src/data/reporting/executiveReportData.snapshotRows.test.ts src/data/reporting/__snapshots__/executiveReportData.snapshotRows.test.ts.snap
git commit -m "$(cat <<'MSG'
Chore (reporting): snapshot executive report rows before the A2 fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

- [ ] **Step 2: Write the failing tests**

Append to the same file:

```ts
describe("buildExecutiveReportRows — sampled ids missing from the population (A2)", () => {
  it("emits a flagged row from the sample snapshot, carrying its answer", () => {
    const rows = buildExecutiveReportRows(input(["P1", "S9"], "S9"));

    expect(rows.map((row) => row.xrayImageId)).toEqual(["P1", "P2", "P3", "S9"]);
    const orphan = rows.find((row) => row.xrayImageId === "S9")!;
    expect(orphan.fromSampleSnapshot).toBe(true);
    expect(orphan.selectedInSample).toBe(true);
    expect(orphan.answerStatus).toBe("submitted");
    expect(rows.filter((row) => row.fromSampleSnapshot)).toHaveLength(1);
    expect("fromSampleSnapshot" in rows[0]!).toBe(false);
  });

  it("keeps population-wide KPI denominators unchanged", () => {
    const rows = buildExecutiveReportRows(input(["P1", "S9"], "S9"));
    const sample = makeSampleMaster(["P1", "S9"].map((id) => makePopulationRow(id)));

    const kpis = calculateExecutiveKPIs(rows, sample, DEFAULT_EXEC_CONFIG);

    expect(kpis.totalPopulation).toBe(3);
    expect(kpis.cleanCount).toBe(3);
    expect(kpis.suspiciousCount).toBe(0);
    expect(kpis.studiedImages).toBe(1);
  });
});
```

Run: `npx vitest run src/data/reporting/executiveReportData.snapshotRows.test.ts`
Expected: FAIL — the ids are `["P1","P2","P3"]` (no S9 row); `totalPopulation` is irrelevant until then.

- [ ] **Step 3: Add the row flag**

In `executiveReportTypes.ts`, after `targetedByRiskEngine?: string | null;` (line 86):

```ts
  /**
   * A2: this row was built from the `sample.master.json` snapshot because its
   * id is missing from the month's population (the population was re-processed
   * under the sample). Present only when true; population-wide KPIs exclude it.
   */
  fromSampleSnapshot?: true;
```

- [ ] **Step 4: Emit snapshot rows**

In `executiveReportData.ts`:

4a. Add `import type { PreparedPopulationRow } from "../population/populationTypes";` to the imports.

4b. Before `export function buildExecutiveReportRows`, add:

```ts
/**
 * A2: live sampled rows whose id is absent from the population — the sample
 * outlived a re-processed population. Order: the sample's own row order.
 */
export function sampleRowsMissingFromPopulation(
  populationRows: readonly PreparedPopulationRow[],
  sample: SampleMasterData | null
): PreparedPopulationRow[] {
  if (!sample) return [];
  const populationIds = new Set(populationRows.map((row) => row.xrayImageId));
  return liveSampleRows(sample).filter((row) => !populationIds.has(row.xrayImageId));
}
```

4c. In `buildExecutiveReportRows`, replace `return populationRows.map((pop): ExecutiveReportRow => {` with:

```ts
  const snapshotRows = sampleRowsMissingFromPopulation(populationRows, sample);
  const snapshotIds = new Set(snapshotRows.map((row) => row.xrayImageId));
  const sourceRows = snapshotRows.length > 0 ? [...populationRows, ...snapshotRows] : populationRows;

  return sourceRows.map((pop): ExecutiveReportRow => {
```

4d. In the returned object literal, after the last property `targetedByRiskEngine: pop.targetedByRiskEngine ?? null,` add:

```ts
      // Spread only when true, so a month without orphans stays byte-identical.
      ...(snapshotIds.has(pop.xrayImageId) ? { fromSampleSnapshot: true as const } : {}),
```

- [ ] **Step 5: Keep population-wide KPIs on population rows**

In `calculateExecutiveKPIs`, replace lines 219-225:

```ts
  const totalPopulation = rows.length;
  const totalSample = sample?.totalActual ?? rows.filter((r) => r.selectedInSample).length;
  const sampleCoverage = totalPopulation > 0 ? (totalSample / totalPopulation) * 100 : 0;

  const suspiciousCount = rows.filter((r) => r.imageResult === "اشتباه").length;
  const cleanCount = rows.filter((r) => r.imageResult === "سليمة").length;
  const suspicionRate = rows.length > 0 ? (suspiciousCount / rows.length) * 100 : 0;
```
with

```ts
  // A2: rows rebuilt from the sample snapshot are not part of the population;
  // every population-wide denominator is taken over the population alone.
  const populationRows = rows.some((r) => r.fromSampleSnapshot) ? rows.filter((r) => !r.fromSampleSnapshot) : rows;
  const totalPopulation = populationRows.length;
  const totalSample = sample?.totalActual ?? rows.filter((r) => r.selectedInSample).length;
  const sampleCoverage = totalPopulation > 0 ? (totalSample / totalPopulation) * 100 : 0;

  const suspiciousCount = populationRows.filter((r) => r.imageResult === "اشتباه").length;
  const cleanCount = populationRows.filter((r) => r.imageResult === "سليمة").length;
  const suspicionRate = populationRows.length > 0 ? (suspiciousCount / populationRows.length) * 100 : 0;
```

and replace the level-disagreement pair

```ts
  const bothLevelsCount = rows.length;
  const disagreementCount = rows.filter((r) => r.levelOneResult !== r.levelTwoResult).length;
```
with

```ts
  const bothLevelsCount = populationRows.length;
  const disagreementCount = populationRows.filter((r) => r.levelOneResult !== r.levelTwoResult).length;
```

(Port/stage profiles, accuracy and answer-derived figures keep using `rows`: they are sample-scoped and the orphaned rows' answers are exactly what the fallback exists to keep.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/data/reporting/executiveReportData.snapshotRows.test.ts src/data/reporting/executiveReportData.test.ts src/data/powerbiExport/exportManager.golden.test.ts`
Expected: PASS — the Step-1 snapshot is unchanged (no `-u`).

- [ ] **Step 7: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green; no deck/document/workbook snapshot changes (none of their fixtures has an orphaned sampled id). If any snapshot changes, STOP and report instead of updating it.

- [ ] **Step 8: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (reporting): sampled images missing from a re-processed population stay in reports from the sample snapshot"`
Prose + Before/After of the `return populationRows.map(` line and of the KPI population block.

- [ ] **Step 9: Commit**

```bash
git add src/data/reporting/executiveReportTypes.ts src/data/reporting/executiveReportData.ts src/data/reporting/executiveReportData.snapshotRows.test.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (reporting): keep orphaned sampled images via the sample snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 7: A2 — Snapshot-row warning banner in Reports / KPI / Report Designer / Power BI, and at population save

**Tier:** 2.

**Design:** one shared banner component, fed a count. Reports + KPI: the count comes from `sampleRowsMissingFromPopulation` over the exec input `loadExecInput` already loads (no extra I/O). Report Designer: count of flagged rows `ExecutiveRowsProvider` already builds. Power BI: `runPowerBiExport` returns the count; `population.csv` excludes flagged rows (population-wide file), `sample.csv` includes them. Population save: `saveMonthRun`'s success result carries `sampleOrphanCount` (the Task-3 assessment's `missingCount`, which can be non-zero only for a sample-without-work month) and the Population tab shows a warning when it is non-zero. This is the spec's "integrity check at save and at report time" (the `sampleOrphans` definition of `scanReferentialIntegrity` — sample ids absent from the population — computed from data already in memory rather than by re-reading every family from disk).

**Files:**
- Create: `src/components/SampleSnapshotBanner/SampleSnapshotBanner.tsx`, `src/components/SampleSnapshotBanner/SampleSnapshotBanner.css`
- Modify: `src/data/powerbiExport/exportManager.ts:23-56`
- Modify: `src/components/Sidebar/Tabs/Reports/TabView.tsx:239 (state), 320-359 (loadExecInput), 596-597 (pbi), 876 (render)`
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/renderers/ExecutiveRowsProvider.tsx:50-51, 79-90, 105-110`
- Modify: `src/data/population/populationStorage.ts` (success arm of `SaveMonthRunResult`; `return { ok: true, monthFolderName }`)
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx` (the `if (result.ok) {` branch of `commitSaveToDisk`)
- Modify: `src/data/labels/labelsStore.ts`
- Test: `src/components/SampleSnapshotBanner/SampleSnapshotBanner.test.tsx`, `src/data/powerbiExport/exportManager.snapshotRows.test.ts`, append to `src/data/population/populationOverwriteGuard.test.ts`

**Interfaces:**
- Consumes (Task 6): `sampleRowsMissingFromPopulation`, `ExecutiveReportRow.fromSampleSnapshot`.
- Produces:
  ```ts
  export function SampleSnapshotBanner(props: { count: number }): React.JSX.Element | null;
  export type PowerBiExportResult = ExportManifest & { snapshotRowCount: number }; // exportManager.ts
  export async function runPowerBiExport(root, month): Promise<PowerBiExportResult>;
  // SaveMonthRunResult success arm: { ok: true; monthFolderName: string; sampleOrphanCount: number }
  ```
- Labels: `report_sample_snapshot_banner` (`{count}`), `population_save_sample_orphans_warning` (`{month}`, `{count}`).

- [ ] **Step 1: Write the failing tests**

Create `src/components/SampleSnapshotBanner/SampleSnapshotBanner.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../data/labels/labelsStore";
import { SampleSnapshotBanner } from "./SampleSnapshotBanner";

afterEach(cleanup);

describe("SampleSnapshotBanner", () => {
  it("renders nothing for a zero count", () => {
    const { container } = render(<SampleSnapshotBanner count={0} />);
    expect(container.textContent).toBe("");
  });

  it("names the count in an alert", () => {
    render(<SampleSnapshotBanner count={12} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      DEFAULT_LABELS.report_sample_snapshot_banner.replace("{count}", "12")
    );
  });
});
```

Create `src/data/powerbiExport/exportManager.snapshotRows.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { saveMonthRun } from "../population/populationStorage";
import { formatMonthFolderName } from "../population/monthFolder";
import { invalidateMonthLockCache } from "../population/monthLock";
import { makePopulationRow, makeSampleMaster } from "../population/populationTestFixtures";
import { runPowerBiExport } from "./exportManager";

const MONTH = formatMonthFolderName(5, 2026);

beforeEach(() => {
  invalidateMonthLockCache();
});

describe("runPowerBiExport — sampled ids missing from the population (A2)", () => {
  it("keeps orphaned sample rows out of population.csv, in sample.csv, and reports their count", async () => {
    const root = createMemoryDirectory("root");
    const saved = await saveMonthRun({
      directoryHandle: root,
      month: 5,
      year: 2026,
      username: "admin",
      riskFileName: "risk.xlsx",
      biFileName: null,
      certScanUsed: false,
      riskRawRows: [{ id: "raw-1" }],
      biRawRows: [],
      processedRows: ["P1", "P2"].map((id) => makePopulationRow(id) as unknown as Record<string, unknown>),
      certScanRows: 0,
      nonCertScanRows: 2,
    });
    expect(saved.ok).toBe(true);
    const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster([makePopulationRow("P1"), makePopulationRow("S9")]));
    expect(sampled.ok).toBe(true);

    const result = await runPowerBiExport(root, MONTH);

    expect(result.snapshotRowCount).toBe(1);
    expect(result.files.find((file) => file.fileName === "population.csv")?.rowCount).toBe(2);
    expect(result.files.find((file) => file.fileName === "sample.csv")?.rowCount).toBe(2);
  });
});
```

Append to `src/data/population/populationOverwriteGuard.test.ts`, inside `describe("saveMonthRun — overwrite guard (A2)", …)`:

```ts
  test("reports how many sampled ids a permitted overwrite leaves behind", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: false });

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["A1", "Z1"]),
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sampleOrphanCount).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/SampleSnapshotBanner src/data/powerbiExport/exportManager.snapshotRows.test.ts src/data/population/populationOverwriteGuard.test.ts`
Expected: FAIL — banner module missing; `snapshotRowCount` undefined and `population.csv` has 3 rows; `sampleOrphanCount` undefined.

- [ ] **Step 3: Labels**

In `labelsStore.ts`, after `population_reprocess_blocked_close`:

```ts
  population_save_sample_orphans_warning: "تم حفظ شهر {month}، لكن {count} من صور العينة غير موجودة في المجتمع الجديد. ستظهر في التقارير من نسخة العينة المحفوظة مع تنبيه.",
  report_sample_snapshot_banner: "تنبيه: {count} من صور العينة لم تعد موجودة في مجتمع هذا الشهر (أُعيدت معالجة المجتمع). تُعرض من نسخة العينة المحفوظة، ولا تدخل في مقامات المجتمع.",
```

- [ ] **Step 4: Banner component**

Create `src/components/SampleSnapshotBanner/SampleSnapshotBanner.tsx`:

```tsx
import { AlertTriangle } from "lucide-react";

import { useLabels } from "../../data/labels/useLabels";
import "./SampleSnapshotBanner.css";

/**
 * A2: some sampled images are shown from the sample snapshot because the month's
 * population no longer contains them. One component for every report surface.
 */
export function SampleSnapshotBanner({ count }: { count: number }) {
  const L = useLabels();
  if (count <= 0) return null;
  return (
    <div className="sample-snapshot-banner" role="alert" dir="rtl">
      <AlertTriangle size={14} aria-hidden />
      <span>{L.report_sample_snapshot_banner.replace("{count}", count.toLocaleString("ar-SA-u-nu-latn"))}</span>
    </div>
  );
}
```

Create `src/components/SampleSnapshotBanner/SampleSnapshotBanner.css`:

```css
.sample-snapshot-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 0;
  padding: 8px 12px;
  border: 1px solid var(--c-warning-border);
  border-radius: 8px;
  background: var(--c-warning-bg);
  color: var(--c-warning);
  font-size: 13px;
}
```

(`toLocaleString("ar-SA-u-nu-latn")` prints Latin digits, so `12` renders as `12`.)

- [ ] **Step 5: Power BI export**

In `exportManager.ts`: add `export type PowerBiExportResult = ExportManifest & { snapshotRowCount: number };`, change the return type to `Promise<PowerBiExportResult>`, and replace from `const allRows: Record<string, unknown>[] = …` to the end of the function with:

```ts
  // A2: rows rebuilt from the sample snapshot are not population rows —
  // population.csv stays the population; sample.csv keeps them so their
  // answers are not lost.
  const snapshotRowCount = execRows.filter((r) => r.fromSampleSnapshot).length;
  const allRows: Record<string, unknown>[] = execRows.map((r) => r as Record<string, unknown>);
  const populationRowsOut = snapshotRowCount > 0 ? allRows.filter((r) => r["fromSampleSnapshot"] !== true) : allRows;
  const sampleRowsOut = allRows.filter((r) => r["selectedInSample"] === true);

  const manifest = await writeCsvExport(root, month, [
    { fileName: "population.csv", headers: POPULATION_HEADERS, rows: populationRowsOut },
    { fileName: "sample.csv", headers: POPULATION_HEADERS, rows: sampleRowsOut },
  ]);
  return { ...manifest, snapshotRowCount };
}
```

(`POPULATION_HEADERS` is unchanged, so no CSV gains a column; the golden test stays byte-identical.)

- [ ] **Step 6: Reports tab**

In `Reports/TabView.tsx`:
- imports: `import { SampleSnapshotBanner } from "../../../SampleSnapshotBanner/SampleSnapshotBanner";` and add `sampleRowsMissingFromPopulation` to the existing `executiveReportData` import (or add `import { sampleRowsMissingFromPopulation } from "../../../../data/reporting/executiveReportData";`).
- after `const [pbiResult, setPbiResult] = useState<ExportManifest | null>(null);` (line 239) add `const [snapshotRowCount, setSnapshotRowCount] = useState(0);`
- in `loadExecInput`, right after `if (!populationFinal) return null;` add:
  ```ts
    setSnapshotRowCount(sampleRowsMissingFromPopulation(populationFinal.rows as unknown as PreparedPopulationRow[], sample ?? null).length);
  ```
- in `handlePbiExport`, after `setPbiResult(manifest);` add `setSnapshotRowCount(manifest.snapshotRowCount);`
- directly after the closing `</div>` of `<div className="rh-header">…</div>` add `<SampleSnapshotBanner count={snapshotRowCount} />`.
- add a month-reset effect next to the other `selectedMonth` effects: `useEffect(() => { setSnapshotRowCount(0); }, [selectedMonth]);` with the same `// eslint-disable-next-line react-hooks/set-state-in-effect -- reset the per-month banner when the month changes` comment style used in this file.

- [ ] **Step 7: Report Designer**

In `ExecutiveRowsProvider.tsx`: import `SampleSnapshotBanner`; add `const [snapshotCount, setSnapshotCount] = useState(0);` after `loadError`'s state; after `const execRows = buildExecutiveReportRows({ … });` add `if (!cancelled) setSnapshotCount(execRows.filter((row) => row.fromSampleSnapshot).length);`; in the returned JSX, directly after the `{loadError && ( … )}` block add `<SampleSnapshotBanner count={snapshotCount} />`.

- [ ] **Step 8: Population save result + warning**

In `populationStorage.ts`: change the success arm of `SaveMonthRunResult` to

```ts
  ok: true;
  monthFolderName: string;
  /** A2: live sampled ids the saved population lacks (non-zero only for a sample-without-work month). */
  sampleOrphanCount: number;
```
and change `return { ok: true, monthFolderName };` to `return { ok: true, monthFolderName, sampleOrphanCount: assessment.missingCount };` (`assessment` is the Task-3 value in scope). Fix any other `{ ok: true, monthFolderName }` literal typed as `SaveMonthRunResult` that `npm run typecheck` reports (tests/mocks: add `sampleOrphanCount: 0`).

In `Population/index.tsx`, inside `if (result.ok) {` replace the `setSaveToDiskMessage({ type: "ok", text: … });` call with:

```ts
        setSaveToDiskMessage(result.sampleOrphanCount > 0
          ? { type: "error", text: getLabels().population_save_sample_orphans_warning.replace("{month}", result.monthFolderName).replace("{count}", String(result.sampleOrphanCount)) }
          : { type: "ok", text: `تم حفظ شهر ${result.monthFolderName} على القرص بنجاح.` });
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/components/SampleSnapshotBanner src/data/powerbiExport src/data/population/populationOverwriteGuard.test.ts`
Expected: PASS (including `exportManager.golden.test.ts`, unchanged).

- [ ] **Step 10: Gates + complexity**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity && npm run check:hex-literals`
Expected: all green.

- [ ] **Step 11: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (reporting): warn wherever sampled images are shown from the sample snapshot, and at population save"`

- [ ] **Step 12: Commit**

```bash
git add src/components/SampleSnapshotBanner src/data/powerbiExport/exportManager.ts src/data/powerbiExport/exportManager.snapshotRows.test.ts src/components/Sidebar/Tabs/Reports/TabView.tsx src/components/Sidebar/Tabs/ReportDesigner/renderers/ExecutiveRowsProvider.tsx src/data/population/populationStorage.ts src/data/population/populationOverwriteGuard.test.ts src/components/Sidebar/Tabs/Population/index.tsx src/data/labels/labelsStore.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (reporting): sample-snapshot warning banner and save-time orphan warning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 8: A2 — Population recovery engine (superseded archives + `.bak`)

**Tier:** 3 (restores a workspace file; pass `--bump=minor`).

**Scope boundary — Workstream D hand-off.** This task handles **only** the candidates inside the month's own `2-processed/` folder: `population.final.*.superseded.json` (Task 4) and `population.final.json.bak`. It writes **no** code that reads or copies from `5-system/backups/*`. Workstream D (selective element × month backup restore, PR 2) adds backup snapshots as further candidates by calling its own scoped restore engine; to make that a pure addition, the candidate type carries a `source` discriminant that D extends with `"backup"`, and `restorePopulationCandidate` is the single restore entry point D's candidates must route through for the post-restore rebuild (`rebuildPopulationDerivedFiles` is exported for that reason). Never call the whole-workspace `restoreBackupSnapshot` here.

**Files:**
- Create: `src/data/population/populationRecovery.ts`
- Test: `src/data/population/populationRecovery.test.ts`

**Interfaces:**
- Consumes: Task 3 `loadPopulationOverwriteImpact`; Task 4 `archiveBeforeOverwrite`, `supersedeStamp`; `loadProcessingSummary(dir, month)`, `loadPopulationConfig(dir)`, `rebuildReplacementIndex(dir, month, rows, stageMappings, sourceRevision, builtBy)`, `buildPopulationAggregate`, `savePopulationAggregate`, `readEnvelopeRevision(dir, name)`, `ensureMonthWritable`, `manifestLockKey`, `withResourceLock`, `withWorkspaceWriteAccess`.
- Produces:
  ```ts
  export type PopulationRecoveryCandidate = {
    fileName: string;
    source: "superseded" | "bak"; // Workstream D adds "backup"
    rowCount: number;
    processedAt: string | null;
    coveredSampledIds: number;
    totalSampledIds: number;
  };
  export type PopulationRestoreResult =
    | { ok: true; archivedAs: string | null; rowCount: number }
    | { ok: false; reason: "invalid-candidate" | "unreadable" | "failed"; detail?: string };
  export async function listPopulationRecoveryCandidates(directoryHandle: DirectoryHandleLike, monthFolderName: string): Promise<PopulationRecoveryCandidate[]>;
  export async function restorePopulationCandidate(directoryHandle: DirectoryHandleLike, monthFolderName: string, fileName: string, username: string): Promise<PopulationRestoreResult>;
  export async function rebuildPopulationDerivedFiles(directoryHandle: DirectoryHandleLike, monthFolderName: string, processedDir: DirectoryHandleLike, rows: PreparedPopulationRow[], username: string): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/data/population/populationRecovery.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { readEnvelopeRevision } from "../storage/safeWrite";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { formatMonthFolderName } from "./monthFolder";
import { invalidateMonthLockCache } from "./monthLock";
import { loadMonthPopulationFinal, saveMonthRun } from "./populationStorage";
import { loadReplacementIndexManifest } from "./replacementIndexStorage";
import { makePopulationRow, makeSampleMaster } from "./populationTestFixtures";
import { listPopulationRecoveryCandidates, restorePopulationCandidate } from "./populationRecovery";

const MONTH = formatMonthFolderName(5, 2026);

const baseParams = {
  month: 5,
  year: 2026,
  username: "admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  riskRawRows: [{ id: "raw-1" }],
  biRawRows: [],
  certScanRows: 0,
  nonCertScanRows: 1,
};

function rowsFor(ids: string[]): Array<Record<string, unknown>> {
  return ids.map((id) => makePopulationRow(id) as unknown as Record<string, unknown>);
}

async function processedDir(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const population = await root.getDirectoryHandle("1-population", { create: false });
  const month = await population.getDirectoryHandle(MONTH, { create: false });
  return month.getDirectoryHandle("2-processed", { create: false });
}

/** Month with sample A1+A2, whose population was then overwritten by a Z1-only one. */
async function seedOverwrittenMonth(root: DirectoryHandleLike): Promise<void> {
  const first = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["A1", "A2", "A3"]) });
  if (!first.ok) throw new Error(first.error);
  const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster([makePopulationRow("A1"), makePopulationRow("A2")]));
  if (!sampled.ok) throw new Error(sampled.error);
  const second = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["Z1"]), confirmedOverwrite: true });
  if (!second.ok) throw new Error(second.error);
}

beforeEach(() => {
  invalidateMonthLockCache();
});

describe("population recovery (A2)", () => {
  test("lists the superseded archive and the .bak with their sampled-id coverage", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);

    const candidates = await listPopulationRecoveryCandidates(root, MONTH);

    expect(candidates.map((c) => c.source)).toEqual(["superseded", "bak"]);
    expect(candidates[0]!.fileName).toMatch(/^population\.final\..+\.superseded\.json$/);
    for (const candidate of candidates) {
      expect(candidate.rowCount).toBe(3);
      expect(candidate.coveredSampledIds).toBe(2);
      expect(candidate.totalSampledIds).toBe(2);
    }
  });

  test("restores the chosen candidate, archives the current file, and rebuilds the replacement index", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);
    const [archive] = await listPopulationRecoveryCandidates(root, MONTH);

    const result = await restorePopulationCandidate(root, MONTH, archive!.fileName, "admin");

    expect(result).toMatchObject({ ok: true, rowCount: 3 });
    const live = await loadMonthPopulationFinal(root, MONTH);
    expect((live?.rows ?? []).map((row) => row["xrayImageId"])).toEqual(["A1", "A2", "A3"]);

    const dir = await processedDir(root);
    const archives = (await listDirectoryEntries(dir))
      .map((entry) => entry.name)
      .filter((name) => /^population\.final\..+\.superseded\.json$/.test(name));
    expect(archives).toHaveLength(2);

    const revision = await readEnvelopeRevision(dir, "population.final.json");
    const manifest = await loadReplacementIndexManifest(root, MONTH);
    expect(manifest?.sourceRevision).toBe(revision);
  });

  test("refuses a file name that is not a recovery candidate", async () => {
    const root = createMemoryDirectory("root");
    await seedOverwrittenMonth(root);

    const result = await restorePopulationCandidate(root, MONTH, "processing.summary.json", "admin");

    expect(result).toEqual({ ok: false, reason: "invalid-candidate" });
    const live = await loadMonthPopulationFinal(root, MONTH);
    expect((live?.rows ?? []).map((row) => row["xrayImageId"])).toEqual(["Z1"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/population/populationRecovery.test.ts`
Expected: FAIL — `Failed to resolve import "./populationRecovery"`.

- [ ] **Step 3: Implement the engine**

Create `src/data/population/populationRecovery.ts`:

```ts
/**
 * A2 admin recovery: put a previous `population.final.json` back.
 *
 * Candidates are ONLY the month's own copies in `2-processed/`: the
 * `population.final.{stamp}.superseded.json` archives a save writes before it
 * overwrites (populationStorage.ts `archiveBeforeOverwrite`) and safeWrite's
 * `population.final.json.bak`. Backup snapshots under `5-system/backups/` are
 * Workstream D's: it adds them as `source: "backup"` candidates through its own
 * scoped restore engine and routes the post-restore rebuild through
 * `rebuildPopulationDerivedFiles` below. Never the whole-workspace restore.
 *
 * Restoring archives the current file first (the same mandatory archive a save
 * takes), so a restore is itself undoable from this list.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { readEnvelopeRevision, safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { withResourceLock } from "../storage/webLocks";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
import { logError } from "../storage/errorLogger";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { ensureMonthWritable, manifestLockKey } from "./monthLock";
import { archiveBeforeOverwrite, loadProcessingSummary, supersedeStamp } from "./populationStorage";
import { loadPopulationOverwriteImpact } from "./populationOverwriteGuard";
import { loadPopulationConfig } from "./populationConfig";
import { rebuildReplacementIndex } from "./replacementIndexStorage";
import { buildPopulationAggregate, savePopulationAggregate } from "./populationAggregate";
import type { PopulationFinalData } from "./monthTypes";
import type { PreparedPopulationRow } from "./populationTypes";

const LIVE_FILE = "population.final.json";
const BAK_FILE = `${LIVE_FILE}.bak`;
const SUPERSEDED_PATTERN = /^population\.final\..+\.superseded\.json$/;

export type PopulationRecoveryCandidate = {
  fileName: string;
  /** Workstream D extends this with "backup". */
  source: "superseded" | "bak";
  rowCount: number;
  processedAt: string | null;
  /** Live sampled ids present in this candidate. */
  coveredSampledIds: number;
  totalSampledIds: number;
};

export type PopulationRestoreResult =
  | { ok: true; archivedAs: string | null; rowCount: number }
  | { ok: false; reason: "invalid-candidate" | "unreadable" | "failed"; detail?: string };

function isCandidateName(fileName: string): boolean {
  return fileName === BAK_FILE || SUPERSEDED_PATTERN.test(fileName);
}

async function openProcessedDir(directoryHandle: DirectoryHandleLike, monthFolderName: string): Promise<DirectoryHandleLike> {
  const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
  return monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
}

function rowIds(data: PopulationFinalData): Set<string> {
  const ids = new Set<string>();
  for (const row of data.rows) {
    const id = row["xrayImageId"];
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/**
 * Every candidate, newest archive first, then the `.bak`. Reads each candidate
 * in full to measure coverage — an on-demand admin action, one file at a time.
 */
export async function listPopulationRecoveryCandidates(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<PopulationRecoveryCandidate[]> {
  const processedDir = await openProcessedDir(directoryHandle, monthFolderName);
  const names = (await listDirectoryEntries(processedDir))
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.name);
  const ordered = [
    ...names.filter((name) => SUPERSEDED_PATTERN.test(name)).sort((a, b) => b.localeCompare(a)),
    ...(names.includes(BAK_FILE) ? [BAK_FILE] : []),
  ];
  const impact = await loadPopulationOverwriteImpact(directoryHandle, monthFolderName);
  const candidates: PopulationRecoveryCandidate[] = [];
  for (const fileName of ordered) {
    const read = await safeReadJson<PopulationFinalData>(processedDir, fileName).catch((error: unknown) => {
      logError("population:recovery-read", error);
      return null;
    });
    if (!read?.ok || !Array.isArray(read.value.rows)) continue;
    const ids = rowIds(read.value);
    candidates.push({
      fileName,
      source: fileName === BAK_FILE ? "bak" : "superseded",
      rowCount: read.value.rows.length,
      processedAt: read.value.processedAt ?? null,
      coveredSampledIds: impact.liveSampledIds.filter((id) => ids.has(id)).length,
      totalSampledIds: impact.liveSampledIds.length,
    });
  }
  return candidates;
}

/**
 * Rebuild what a population save derives from `population.final.json`: the
 * replacement-candidate index (keyed on the new envelope revision) and the
 * month aggregate. Best-effort, logged — the same contract saveMonthRun gives
 * both. The aggregate reuses the month's `processing.summary.json` (not
 * versioned), so its summary block describes the most recent processing run.
 */
export async function rebuildPopulationDerivedFiles(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  processedDir: DirectoryHandleLike,
  rows: PreparedPopulationRow[],
  username: string
): Promise<void> {
  try {
    const revision = await readEnvelopeRevision(processedDir, LIVE_FILE);
    if (revision !== null) {
      const config = await loadPopulationConfig(directoryHandle);
      const rebuilt = await rebuildReplacementIndex(
        directoryHandle,
        monthFolderName,
        rows,
        config.stageMappings,
        revision,
        username
      );
      if (!rebuilt.ok) logError("population:recovery-index", new Error(rebuilt.error));
    }
  } catch (error) {
    logError("population:recovery-index", error);
  }
  try {
    const summary = await loadProcessingSummary(directoryHandle, monthFolderName);
    if (summary) {
      await savePopulationAggregate(
        directoryHandle,
        monthFolderName,
        buildPopulationAggregate({ monthFolderName, computedBy: username, summary: summary.summary, preparedRows: rows })
      );
    }
  } catch (error) {
    logError("population:recovery-aggregate", error);
  }
}

export async function restorePopulationCandidate(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  fileName: string,
  username: string
): Promise<PopulationRestoreResult> {
  if (!isCandidateName(fileName)) return { ok: false, reason: "invalid-candidate" };
  await ensureMonthWritable(directoryHandle, monthFolderName);
  return withResourceLock(manifestLockKey(monthFolderName), () =>
    withWorkspaceWriteAccess(directoryHandle, async (): Promise<PopulationRestoreResult> => {
      try {
        const processedDir = await openProcessedDir(directoryHandle, monthFolderName);
        const read = await safeReadJson<PopulationFinalData>(processedDir, fileName);
        if (!read.ok || !Array.isArray(read.value.rows)) return { ok: false, reason: "unreadable" };
        // Mandatory: the file being replaced is kept, so this restore can itself be undone.
        const archivedAs = await archiveBeforeOverwrite(processedDir, LIVE_FILE, supersedeStamp(), { required: true });
        await safeWriteJson(processedDir, LIVE_FILE, read.value);
        await rebuildPopulationDerivedFiles(
          directoryHandle,
          monthFolderName,
          processedDir,
          read.value.rows as unknown as PreparedPopulationRow[],
          username
        );
        return { ok: true, archivedAs, rowCount: read.value.rows.length };
      } catch (error) {
        logError("population:recovery-restore", error);
        return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
      }
    })
  );
}
```

Check before running: `loadProcessingSummary` and `ProcessingSummaryData.summary` exist in `populationStorage.ts`/`monthTypes.ts` (they do: `saveMonthRunLocked` writes `summary`); `rebuildReplacementIndex`'s `stageMappings` parameter is `Partial<StageAliasMappings> | undefined` and `loadPopulationConfig(...).stageMappings` is what `saveMonthRunLocked` already passes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/population/populationRecovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 6: Edit-log entry**

Run: `npm run editlog -- --tier=3 --bump=minor --append --sync-package "Add (population): recovery engine that restores a previous population.final.json from its superseded archive or .bak"`
Prose: Why, What changed, Before/After (n/a for a new module — show the public signatures), **Migration:** none. **Rollback:** revert; restored files are ordinary `population.final.json` writes. State the Workstream D hand-off (backup candidates are D's).

- [ ] **Step 7: Commit**

```bash
git add src/data/population/populationRecovery.ts src/data/population/populationRecovery.test.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (population): recovery engine for superseded and .bak populations

Backup-snapshot candidates are left to Workstream D's scoped restore engine.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 9: A2 — «استعادة المجتمع السابق» admin section in Settings

**Tier:** 2.

**Files:**
- Create: `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx`
- Modify: `src/components/Sidebar/Tabs/Settings/index.tsx:53 (import), 611 (mount after <TemplateRepairSection />)`
- Modify: `src/data/labels/labelsStore.ts` (after `template_repair_scan_failed`, line 1517)
- Test: `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx`

**Interfaces:**
- Consumes (Task 8): `listPopulationRecoveryCandidates`, `restorePopulationCandidate`, `PopulationRecoveryCandidate`; `usePermissions()` → `{ role }`; `useWorkspace()` → `{ directoryHandle }`; `useGlobalMonth()` → `{ selection }` (`selection.kind === "existing"` carries `folderName`); `ConfirmDialog`.
- Produces: `export function PopulationRecoverySection(): React.JSX.Element | null` — renders only for `role === "admin"`.
- Labels: `population_recovery_title`, `population_recovery_hint`, `population_recovery_scan_btn`, `population_recovery_none`, `population_recovery_col_file`, `population_recovery_col_rows`, `population_recovery_col_coverage`, `population_recovery_restore_btn`, `population_recovery_confirm`, `population_recovery_restored`, `population_recovery_failed`, `population_recovery_source_superseded`, `population_recovery_source_bak`, `population_recovery_no_month`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import type { PopulationRecoveryCandidate } from "../../../../data/population/populationRecovery";

const permissions = vi.hoisted(() => ({ role: "admin" }));
const recovery = vi.hoisted(() => ({
  list: vi.fn<() => Promise<PopulationRecoveryCandidate[]>>(),
  restore: vi.fn(),
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({ role: permissions.role, username: "admin" }),
}));
vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: { kind: "directory", name: "root" }, status: "ready" }),
}));
vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({ selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" } }),
}));
vi.mock("../../../../data/population/populationRecovery", () => ({
  listPopulationRecoveryCandidates: recovery.list,
  restorePopulationCandidate: recovery.restore,
}));

import { PopulationRecoverySection } from "./PopulationRecoverySection";

afterEach(() => {
  cleanup();
  permissions.role = "admin";
  recovery.list.mockReset();
  recovery.restore.mockReset();
});

const ARCHIVE: PopulationRecoveryCandidate = {
  fileName: "population.final.2026-09-28T101500.000Z.superseded.json",
  source: "superseded",
  rowCount: 300,
  processedAt: "2026-09-27T08:00:00.000Z",
  coveredSampledIds: 40,
  totalSampledIds: 40,
};

describe("PopulationRecoverySection", () => {
  it("is not rendered for a non-admin", () => {
    permissions.role = "manager";
    const { container } = render(<PopulationRecoverySection />);
    expect(container.textContent).toBe("");
  });

  it("lists candidates with coverage and restores the chosen one after confirmation", async () => {
    recovery.list.mockResolvedValue([ARCHIVE]);
    recovery.restore.mockResolvedValue({ ok: true, archivedAs: "population.final.x.superseded.json", rowCount: 300 });
    render(<PopulationRecoverySection />);

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_title }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_scan_btn }));
    await waitFor(() => expect(screen.getByText("40 / 40")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_recovery_restore_btn }));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok }));

    await waitFor(() => expect(recovery.restore).toHaveBeenCalledWith(
      expect.anything(), "5-may-2026", ARCHIVE.fileName, "admin"
    ));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        DEFAULT_LABELS.population_recovery_restored.replace("{archived}", "population.final.x.superseded.json")
      )
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx`
Expected: FAIL — `Failed to resolve import "./PopulationRecoverySection"`.

- [ ] **Step 3: Labels**

In `labelsStore.ts`, after `template_repair_scan_failed:` (line 1517):

```ts
  population_recovery_title:        "استعادة المجتمع السابق",
  population_recovery_hint:         "يعرض النسخ السابقة من مجتمع الشهر المحدد المحفوظة قبل إعادة المعالجة، مع عدد صور العينة الموجودة في كل نسخة. الاستعادة تحفظ النسخة الحالية أولاً ولا تحذف أي ملف.",
  population_recovery_scan_btn:     "عرض النسخ السابقة",
  population_recovery_none:         "لا توجد نسخ سابقة لمجتمع هذا الشهر.",
  population_recovery_no_month:     "اختر شهراً محفوظاً من شريط الأدوات أولاً.",
  population_recovery_col_file:     "النسخة",
  population_recovery_col_rows:     "عدد الصفوف",
  population_recovery_col_coverage: "صور العينة الموجودة",
  population_recovery_source_superseded: "نسخة محفوظة قبل إعادة المعالجة",
  population_recovery_source_bak:   "النسخة الاحتياطية الأخيرة (.bak)",
  population_recovery_restore_btn:  "استعادة هذه النسخة",
  population_recovery_confirm:      "سيُستبدل مجتمع الشهر الحالي بهذه النسخة بعد حفظ النسخة الحالية كنسخة سابقة. هل تريد المتابعة؟",
  population_recovery_restored:     "تمت الاستعادة. حُفظت النسخة السابقة باسم {archived}.",
  population_recovery_failed:       "تعذّرت الاستعادة: {error}",
```

- [ ] **Step 4: Component**

Create `src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx`:

```tsx
import { useState } from "react";
import { AlertTriangle, ChevronRight, History } from "lucide-react";

import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";
import { useLabels } from "../../../../data/labels/useLabels";
import { logError } from "../../../../data/storage/errorLogger";
import {
  listPopulationRecoveryCandidates,
  restorePopulationCandidate,
  type PopulationRecoveryCandidate,
} from "../../../../data/population/populationRecovery";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import "./TemplateRepairSection.css";

type Notice = { kind: "ok" | "error"; text: string };

/**
 * A2 admin tool: restore a previous `population.final.json` for the selected
 * month from the copies kept beside it. Admin only — it replaces the month's
 * population. Backup-snapshot candidates arrive with Workstream D.
 */
export function PopulationRecoverySection() {
  const { role, username } = usePermissions();
  const { directoryHandle } = useWorkspace();
  const { selection } = useGlobalMonth();
  const L = useLabels();
  const [isOpen, setIsOpen] = useState(false);
  const [candidates, setCandidates] = useState<PopulationRecoveryCandidate[] | null>(null);
  const [pending, setPending] = useState<PopulationRecoveryCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (role !== "admin") return null;
  const month = selection.kind === "existing" ? selection.folderName : "";

  async function scan(): Promise<void> {
    if (!directoryHandle || !month) return;
    setBusy(true);
    try {
      setCandidates(await listPopulationRecoveryCandidates(directoryHandle, month));
    } catch (error) {
      logError("settings:population-recovery-scan", error);
      setCandidates([]);
    } finally {
      setBusy(false);
    }
  }

  async function restore(candidate: PopulationRecoveryCandidate): Promise<void> {
    if (!directoryHandle || !month) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await restorePopulationCandidate(directoryHandle, month, candidate.fileName, username);
      setNotice(
        result.ok
          ? { kind: "ok", text: L.population_recovery_restored.replace("{archived}", result.archivedAs ?? "—") }
          : { kind: "error", text: L.population_recovery_failed.replace("{error}", result.detail ?? result.reason) }
      );
    } catch (error) {
      logError("settings:population-recovery-restore", error);
      setNotice({ kind: "error", text: L.population_recovery_failed.replace("{error}", String(error)) });
    } finally {
      setBusy(false);
    }
    await scan();
  }

  return (
    <section className="template-repair-section" dir="rtl">
      <button type="button" className="template-repair-header" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
        <ChevronRight size={16} className={isOpen ? "template-repair-chevron-open" : ""} />
        <History size={16} />
        <span>{L.population_recovery_title}</span>
      </button>
      {isOpen && (
        <div className="template-repair-body">
          <p className="template-repair-hint">{L.population_recovery_hint}</p>
          {!month && <p className="template-repair-empty">{L.population_recovery_no_month}</p>}
          <div className="template-repair-controls">
            <button type="button" className="ew-btn-secondary" onClick={() => void scan()} disabled={busy || !directoryHandle || !month}>
              {L.population_recovery_scan_btn}
            </button>
          </div>
          {notice && (
            <p className={`template-repair-notice template-repair-notice-${notice.kind}`} role="status">
              {notice.kind === "error" && <AlertTriangle size={14} />}
              {notice.text}
            </p>
          )}
          {candidates !== null && candidates.length === 0 && <p className="template-repair-empty">{L.population_recovery_none}</p>}
          {candidates !== null && candidates.length > 0 && (
            <table className="template-repair-table">
              <thead>
                <tr>
                  <th>{L.population_recovery_col_file}</th>
                  <th>{L.population_recovery_col_rows}</th>
                  <th>{L.population_recovery_col_coverage}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.fileName}>
                    <td title={candidate.fileName}>
                      {candidate.source === "bak" ? L.population_recovery_source_bak : L.population_recovery_source_superseded}
                      {candidate.processedAt ? ` — ${candidate.processedAt.slice(0, 16).replace("T", " ")}` : ""}
                    </td>
                    <td>{candidate.rowCount.toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td>{`${candidate.coveredSampledIds} / ${candidate.totalSampledIds}`}</td>
                    <td>
                      <button type="button" className="ew-btn-secondary" disabled={busy} onClick={() => setPending(candidate)}>
                        {L.population_recovery_restore_btn}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <ConfirmDialog
        open={pending !== null}
        danger
        title={L.population_recovery_title}
        message={L.population_recovery_confirm}
        onConfirm={() => {
          const chosen = pending;
          setPending(null);
          if (chosen) void restore(chosen);
        }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
```

(If `lucide-react` has no `History` export in the installed version, use `RotateCcw`; check with `grep -c "History" node_modules/lucide-react/dist/lucide-react.d.ts`.)

- [ ] **Step 5: Mount it**

In `Settings/index.tsx`, import `import { PopulationRecoverySection } from "./PopulationRecoverySection";` beside the `TemplateRepairSection` import (line 53) and render `<PopulationRecoverySection />` directly after `<TemplateRepairSection />` (line 611).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx src/components/Sidebar/Tabs/Settings`
Expected: PASS.

- [ ] **Step 7: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 8: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (settings): admin «استعادة المجتمع السابق» section"`

- [ ] **Step 9: Commit**

```bash
git add src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.tsx src/components/Sidebar/Tabs/Settings/PopulationRecoverySection.test.tsx src/components/Sidebar/Tabs/Settings/index.tsx src/data/labels/labelsStore.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (settings): admin population recovery section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 10: A1 — A stale background reload can never downgrade a just-submitted answer

**Tier:** 2. **XrayReferrals net line delta: +2** (headroom after Task 2: 5 → 3).

**Root cause (verified):** `XrayReferrals` re-runs `loadData({ silent: true })` on every refresh broadcast (`XrayReferrals.tsx:1506-1510`); the 45 s tick marks `answers` changed whenever any segment in `answers.events/` moved (`workspaceSync.ts:631-645`). A silent load that read the employee's answers (`loadEmployeeAnswers`, `:1325`) before a submit's write and resolves after it calls `setAnswers(answerItems)` wholesale (`commit`, `:1382`) with pre-write data, and `handleSave` (`createSaveAnswerHandler`, `:450-575`) leaves in-flight loads alone. The row flips back to pending.

**Design:** a save generation counter plus a map of this tab's own submissions. Each load captures the generation at its start; when it commits, any submission recorded at a **newer** generation replaces a loaded copy that is missing or older (`lastSavedAt`). A committing load prunes submissions at or below its own generation (it started after them, so disk is authoritative).
**Deviation from the spec (deliberate):** the spec also says `handleSave` bumps `loadTokenRef`. It does not here: `loadTokenRef` also guards non-silent month-switch loads, and bumping it mid-load would strand the view in `loading` with no load left to finish it. The generation merge alone covers the stale-reload case.

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/localSubmissions.ts`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx:450-478 (factory deps), 525-528 (ok branch), 1227 (hook), 1258-1262 (loadData start), 1382 (commit), 1473 (deps), 1522-1526 (handler call)`
- Test: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/localSubmissions.test.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.staleReload.test.tsx`

**Interfaces:**
- Produces (`localSubmissions.ts`):
  ```ts
  export type LocalSubmission = { generation: number; item: ItemAnswer };
  export function localSubmissionKey(item: Pick<ItemAnswer, "xrayImageId" | "answeredBy">): string;
  export function mergeLocalSubmissions(loaded: ItemAnswer[], local: ReadonlyMap<string, LocalSubmission>, loadGeneration: number): ItemAnswer[];
  export function pruneLocalSubmissions(local: Map<string, LocalSubmission>, loadGeneration: number): void;
  export type LocalSubmissionGuard = { record: (item: ItemAnswer) => void; beginLoad: () => number; settle: (loaded: ItemAnswer[], loadGeneration: number) => ItemAnswer[] };
  export function useLocalSubmissionGuard(): LocalSubmissionGuard;
  ```
- `createSaveAnswerHandler` deps gain `recordLocalSubmission: (item: ItemAnswer) => void`.

- [ ] **Step 1: Write the failing unit test**

Create `XrayReferrals/localSubmissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import {
  localSubmissionKey,
  mergeLocalSubmissions,
  pruneLocalSubmissions,
  type LocalSubmission,
} from "./localSubmissions";

function item(id: string, lastSavedAt: string, status: ItemAnswer["status"] = "submitted"): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "tpl",
    templateVersion: 1,
    answers: [],
    lastSavedAt,
    submittedAt: status === "submitted" ? lastSavedAt : null,
    answeredBy: "emp1",
    status,
  };
}

function local(entries: Array<[number, ItemAnswer]>): Map<string, LocalSubmission> {
  return new Map(entries.map(([generation, answer]) => [localSubmissionKey(answer), { generation, item: answer }]));
}

describe("mergeLocalSubmissions", () => {
  it("keeps a submission newer than the load over a missing or older loaded copy", () => {
    const submitted = item("XR-1", "2026-09-28T10:00:05.000Z");
    const merged = mergeLocalSubmissions(
      [item("XR-1", "2026-09-28T09:00:00.000Z", "draft"), item("XR-2", "2026-09-28T09:00:00.000Z")],
      local([[1, submitted]]),
      0
    );
    expect(merged.find((answer) => answer.xrayImageId === "XR-1")).toBe(submitted);
    expect(merged).toHaveLength(2);

    const added = mergeLocalSubmissions([], local([[1, submitted]]), 0);
    expect(added).toEqual([submitted]);
  });

  it("trusts a load that started after the submission", () => {
    const loaded = [item("XR-1", "2026-09-28T09:00:00.000Z", "draft")];
    expect(mergeLocalSubmissions(loaded, local([[1, item("XR-1", "2026-09-28T10:00:00.000Z")]]), 1)).toBe(loaded);
  });

  it("never replaces a loaded copy that is as new or newer", () => {
    const newer = item("XR-1", "2026-09-28T11:00:00.000Z", "draft");
    const merged = mergeLocalSubmissions([newer], local([[2, item("XR-1", "2026-09-28T10:00:00.000Z")]]), 1);
    expect(merged).toEqual([newer]);
  });
});

describe("pruneLocalSubmissions", () => {
  it("drops submissions a committing load already covers", () => {
    const map = local([[1, item("XR-1", "a")], [3, item("XR-2", "b")]]);
    pruneLocalSubmissions(map, 2);
    expect([...map.keys()]).toEqual([localSubmissionKey(item("XR-2", "b"))]);
  });
});
```

- [ ] **Step 2: Write the failing view test**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.staleReload.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// A1 field report (2026-09-28): an employee submits, the row stays pending,
// submits again, "same thing". A silent background reload that read the
// answers BEFORE the submit's write landed and committed AFTER it replaced the
// just-submitted answer with the pre-write copy. This pins that such a stale
// reload can no longer downgrade the row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

/** Holds ONE loadEmployeeAnswers result (already read from disk) until released. */
const gate = vi.hoisted(() => ({
  armed: false,
  held: 0,
  release: null as null | (() => void),
}));

vi.mock("../../../../../data/answers/answerStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../data/answers/answerStorage")>();
  return {
    ...actual,
    loadEmployeeAnswers: async (...args: Parameters<typeof actual.loadEmployeeAnswers>) => {
      const result = await actual.loadEmployeeAnswers(...args);
      if (gate.armed) {
        gate.armed = false;
        gate.held += 1;
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      }
      return result;
    },
  };
});

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import { createEmptyUserManagementState, writeUserManagementState } from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import { broadcastDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
import { makePopulationRow, makeSampleMaster } from "../../../../../data/population/populationTestFixtures";
import XrayReferrals from "./XrayReferrals";

const MONTH = "5-may-2026";

vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: MONTH }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: MONTH },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

async function seed(root: DirectoryHandleLike): Promise<void> {
  const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster([makePopulationRow("IMG-001")]));
  if (!sampled.ok) throw new Error(sampled.error);
  const assigned = await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "IMG-001", assignedTo: "emp-a", eventBy: "admin" }),
  ]);
  if (!assigned.ok) throw new Error(assigned.error);
  const template = {
    templateId: "tmpl-stale",
    templateName: "قالب الاختبار",
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: "admin",
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
    fields: [{ fieldId: "note", label: "ملاحظة", type: "text" as const, required: false, options: [] }],
  };
  const savedTpl = await saveTemplate(root, template);
  if (!savedTpl.ok) throw new Error(savedTpl.error);
  const selected = await saveInspectionTemplateSelection(root, {
    templateId: template.templateId,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  });
  if (!selected.ok) throw new Error(selected.error);
}

function doneCount(): string {
  return document.querySelector(".ew-ref-stat-token--done strong")?.textContent ?? "";
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  gate.armed = false;
  gate.held = 0;
  gate.release = null;
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

describe("XrayReferrals — a stale background reload after a submit", () => {
  it("does not flip the submitted row back to pending", async () => {
    writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    const root = createMemoryDirectory("root");
    await seed(root);

    render(<XrayReferrals directoryHandle={root} />);
    await waitFor(() => expect(screen.getAllByText("IMG-001").length).toBeGreaterThan(0));
    const note = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(note, { target: { value: "تمت المراجعة" } });

    // A background refresh starts and reads the answers BEFORE the submit…
    gate.armed = true;
    act(() => broadcastDataRefresh("manual"));
    await waitFor(() => expect(gate.held).toBe(1));

    // …the submit then lands…
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "تقديم الفحص" })));
    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());
    await waitFor(() => expect(doneCount()).toBe("1"));

    // …and only THEN does the stale reload commit.
    await act(async () => {
      gate.release?.();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(doneCount()).toBe("1");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/localSubmissions.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.staleReload.test.tsx`
Expected: FAIL — `localSubmissions` cannot be resolved; the view test ends with `doneCount()` = `"0"` (the stale reload downgraded the row).

- [ ] **Step 4: Implement the pure rule and the hook**

Create `XrayReferrals/localSubmissions.ts`:

```ts
// A1: this tab's own submissions, protected against a background reload that
// started before the write and commits after it. Pure rule + one tiny hook, out
// of XrayReferrals.tsx for its `max-lines-per-function` budget.
import { useCallback, useMemo, useRef } from "react";

import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";

export type LocalSubmission = { generation: number; item: ItemAnswer };

export function localSubmissionKey(item: Pick<ItemAnswer, "xrayImageId" | "answeredBy">): string {
  return `${item.xrayImageId}::${item.answeredBy}`;
}

/**
 * The loaded answers, with every local submission recorded at a generation
 * NEWER than the load's start put back over a loaded copy that is missing or
 * older. Returns `loaded` itself when nothing applies.
 */
export function mergeLocalSubmissions(
  loaded: ItemAnswer[],
  local: ReadonlyMap<string, LocalSubmission>,
  loadGeneration: number
): ItemAnswer[] {
  const newer = [...local.values()].filter((submission) => submission.generation > loadGeneration);
  if (newer.length === 0) return loaded;
  const byKey = new Map(loaded.map((answer) => [localSubmissionKey(answer), answer]));
  let changed = false;
  for (const { item } of newer) {
    const key = localSubmissionKey(item);
    const onDisk = byKey.get(key);
    if (!onDisk || onDisk.lastSavedAt < item.lastSavedAt) {
      byKey.set(key, item);
      changed = true;
    }
  }
  return changed ? [...byKey.values()] : loaded;
}

/** Forget submissions a load that started after them has already seen on disk. */
export function pruneLocalSubmissions(local: Map<string, LocalSubmission>, loadGeneration: number): void {
  for (const [key, submission] of local) {
    if (submission.generation <= loadGeneration) local.delete(key);
  }
}

export type LocalSubmissionGuard = {
  /** Called by the submit handler after a successful write. */
  record: (item: ItemAnswer) => void;
  /** Called at the start of a load; pass the result to `settle`. */
  beginLoad: () => number;
  /** Called with the loaded answers right before they are committed. */
  settle: (loaded: ItemAnswer[], loadGeneration: number) => ItemAnswer[];
};

export function useLocalSubmissionGuard(): LocalSubmissionGuard {
  const generationRef = useRef(0);
  const submissionsRef = useRef(new Map<string, LocalSubmission>());
  const record = useCallback((item: ItemAnswer): void => {
    generationRef.current += 1;
    submissionsRef.current.set(localSubmissionKey(item), { generation: generationRef.current, item });
  }, []);
  const beginLoad = useCallback((): number => generationRef.current, []);
  const settle = useCallback((loaded: ItemAnswer[], loadGeneration: number): ItemAnswer[] => {
    const merged = mergeLocalSubmissions(loaded, submissionsRef.current, loadGeneration);
    pruneLocalSubmissions(submissionsRef.current, loadGeneration);
    return merged;
  }, []);
  return useMemo(() => ({ record, beginLoad, settle }), [record, beginLoad, settle]);
}
```

- [ ] **Step 5: Wire it into `XrayReferrals.tsx` (net +2 lines)**

5a. Import: `import { useLocalSubmissionGuard } from "./XrayReferrals/localSubmissions";` next to the other `./XrayReferrals/*` imports.

5b. `createSaveAnswerHandler` (module-level, not in the component budget): add to the deps type after `setDirtyEntryId: (id: string | null) => void;`

```ts
  /** A1: remember this successful submit so a stale in-flight reload cannot downgrade it. */
  recordLocalSubmission: (item: ItemAnswer) => void;
```
add `recordLocalSubmission` to the destructuring, and in the `if (result.ok) {` branch insert `recordLocalSubmission(item);` on the line directly before `setAnswers((prev) => [`.

5c. In the component, directly after `const loadTokenRef = useRef(0);` add (+1):

```ts
  const localSubmissions = useLocalSubmissionGuard();
```

5d. In `loadData`, directly after `const token = ++loadTokenRef.current;` add (+1):

```ts
    const loadGeneration = localSubmissions.beginLoad();
```

5e. In `commit`, change `setAnswers(answerItems);` to `setAnswers(localSubmissions.settle(answerItems, loadGeneration));` (0).

5f. Change `loadData`'s dependency array `}, [directoryHandle, selMonth, username, canSeeAll]);` to `}, [directoryHandle, selMonth, username, canSeeAll, localSubmissions]);` (0).

5g. In the `createSaveAnswerHandler({ … })` call, change the line `ownBroadcastRef: ownAnswerBroadcastRef, setDirtyEntryId,` to `ownBroadcastRef: ownAnswerBroadcastRef, setDirtyEntryId, recordLocalSubmission: localSubmissions.record,` (0).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/localSubmissions.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.staleReload.test.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx`
Expected: PASS.

- [ ] **Step 7: Gates + complexity**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`
Expected: all green; `XrayReferrals` at 1447.

- [ ] **Step 8: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (referrals): a background reload that started before a submit can no longer flip the submitted row back to pending"`
Prose: Why, What changed (generation guard, merge rule), the deliberate `loadTokenRef` deviation, Before/After of `commit`'s `setAnswers`.

- [ ] **Step 9: Commit**

```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/localSubmissions.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/localSubmissions.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.staleReload.test.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (referrals): stale reload can no longer downgrade a submitted answer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 11: A1 — The sync tick ignores this session's own answer segments

**Tier:** 2.

**Root cause (verified):** `safeAnswerSegmentsSignature` (`workspaceSync.ts:444-452`) signs every `answers.events/*.ndjson` name+size, so the employee's own append moves the signature and the next 45 s tick broadcasts `answers` back to the employee who wrote it (`:631-645`), triggering the very silent reload Task 10 defends against.

**Files:**
- Modify: `src/data/storage/appendOnlyEventLog.ts` (new export after `__resetAppendOnlyEventLogMemosForTests`, ~line 588)
- Modify: `src/data/answers/answerEventStore.ts` (new export after `ANSWER_EVENT_LOG`, line 197)
- Modify: `src/data/storage/directoryScan.ts:597-604` (`boundedSizeSignature` exclude set)
- Modify: `src/data/workspace/workspaceSync.ts:44-58 (imports), 444-452`
- Test: `src/data/workspace/workspaceSync.test.tsx` (append a describe)

**Interfaces:**
- Produces:
  ```ts
  export function segmentNamesWrittenThisSession(consumerNamespace: string): ReadonlySet<string>; // appendOnlyEventLog.ts
  export function ownAnswerSegmentNames(): ReadonlySet<string>; // answerEventStore.ts
  export async function boundedSizeSignature(dir, suffix, maxStats?: number, exclude?: ReadonlySet<string>): Promise<string>;
  ```

- [ ] **Step 1: Write the failing test**

Append to `src/data/workspace/workspaceSync.test.tsx`, and add the imports `import { upsertItemAnswer } from "../answers/answerStorage";` and `import type { ItemAnswer } from "../answers/answerTypes";` at the top:

```tsx
describe("runSync — this session's own answer appends do not report the answers family (A1)", () => {
  function answer(xrayImageId: string): ItemAnswer {
    return {
      xrayImageId,
      templateId: "tpl",
      templateVersion: 1,
      answers: [{ fieldId: "f1", value: "v" }],
      lastSavedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      answeredBy: "emp1",
      status: "submitted",
    };
  }

  it("stays quiet for an own save, and still reports another writer's segment", async () => {
    const root = makeRoot();
    // First save also freezes the legacy shell (answerStorage §8) — do it
    // before the baseline so only the event append is under test.
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    await runSync({ directoryHandle: root, monthFolderName: MONTH }); // baseline

    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-2"))).ok).toBe(true);
    const own = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(own.changed.has("answers")).toBe(false);

    const main = await getSampleMainDir(root, MONTH, true);
    const eventsDir = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    await writeRawFile(
      eventsDir,
      "zz-ans-otherdev-s9.ndjson",
      `${JSON.stringify({ eventId: "other-1", eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: "emp2", authority: "self", xrayImageId: "XR-9", answers: [], status: "draft", answeredBy: "emp2" })}\n`
    );
    const other = await runSync({ directoryHandle: root, monthFolderName: MONTH });
    expect(other.changed.has("answers")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/workspace/workspaceSync.test.tsx -t "own answer appends"`
Expected: FAIL — `own.changed.has("answers")` is `true`.

- [ ] **Step 3: Expose this session's own segment names**

In `appendOnlyEventLog.ts`, after `__resetAppendOnlyEventLogMemosForTests` add:

```ts
/**
 * File names of every segment THIS session has written for one consumer, across
 * every scope. Read-only view of `writtenSegmentsThisSession` for the sync
 * probe (A1): a writer's own appends are already reflected locally, so they
 * must not come back to it as "someone changed the answers".
 */
export function segmentNamesWrittenThisSession(consumerNamespace: string): ReadonlySet<string> {
  const prefix = `${consumerNamespace}|`;
  const names = new Set<string>();
  for (const key of writtenSegmentsThisSession) {
    // Key shape: `{namespace}|{scopeId}|{fileName}`; scopeId may itself contain
    // "|", file names never do.
    if (key.startsWith(prefix)) names.add(key.slice(key.lastIndexOf("|") + 1));
  }
  return names;
}
```

In `answerEventStore.ts`, add `segmentNamesWrittenThisSession` to its existing import from `../storage/appendOnlyEventLog`, and after `export const ANSWER_EVENT_LOG … ;` add:

```ts
/** Answer segments this session wrote — see `segmentNamesWrittenThisSession`. */
export function ownAnswerSegmentNames(): ReadonlySet<string> {
  return segmentNamesWrittenThisSession(ANSWER_EVENT_LOG.consumerNamespace);
}
```

- [ ] **Step 4: Let the bounded signature skip names**

In `directoryScan.ts`, change `boundedSizeSignature`'s signature and first line:

```ts
export async function boundedSizeSignature(
  dir: DirectoryHandleLike,
  suffix: string,
  maxStats: number = DEFAULT_SIZE_SIGNATURE_STAT_BUDGET,
  /** Names left out entirely (neither listed nor probed) — e.g. this session's own segments. */
  exclude?: ReadonlySet<string>
): Promise<string> {
  const listed = await listMatchingFileEntries(dir, suffix);
  const matched = exclude && exclude.size > 0 ? listed.filter((entry) => !exclude.has(entry.name)) : listed;
```
(the rest of the function is unchanged and keeps using `matched`).

- [ ] **Step 5: Use it in the answers probe**

In `workspaceSync.ts`: add `DEFAULT_SIZE_SIGNATURE_STAT_BUDGET` to the existing `../storage/directoryScan` import and `ownAnswerSegmentNames` to the `../answers/answerEventStore` import; in `safeAnswerSegmentsSignature` replace

```ts
    return await boundedSizeSignature(dir, ANSWER_EVENT_SEGMENT_SUFFIX);
```
with

```ts
    // A1: this session's own appends are already reflected locally (the saving
    // view updated its own state and broadcast a local change). Signing them
    // made every save come back to its author as a remote change 45 s later and
    // triggered the stale reload that downgraded the row.
    return await boundedSizeSignature(
      dir,
      ANSWER_EVENT_SEGMENT_SUFFIX,
      DEFAULT_SIZE_SIGNATURE_STAT_BUDGET,
      ownAnswerSegmentNames()
    );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/data/workspace/workspaceSync.test.tsx src/data/storage/directoryScan.notFound.test.ts`
Expected: PASS.

- [ ] **Step 7: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green (`appendOnlyEventLog.ts` has two consumers — the whole suite is mandatory).

- [ ] **Step 8: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (sync): an employee's own answer saves no longer come back as a remote answers change"`

- [ ] **Step 9: Commit**

```bash
git add src/data/storage/appendOnlyEventLog.ts src/data/answers/answerEventStore.ts src/data/storage/directoryScan.ts src/data/workspace/workspaceSync.ts src/data/workspace/workspaceSync.test.tsx "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (sync): skip this session's own answer segments in the answers probe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 12: A1 — Read segment tails with bounded concurrency

**Tier:** 2 (shared module — whole suite).

**Root cause (verified):** `readSegmentTails` (`src/data/storage/directoryScan.ts:660-706`) opens every matched segment one after another; every answer-save attempt (`readAllAnswerEventsForMonth` → `readAnswerEventDelta` → `readSegmentTails`) therefore pays one share round trip per segment in the month. The sibling readers already use `forEachBounded(…, DIRECTORY_READ_CONCURRENCY, …)` (`:520`, `:607`).

**Files:**
- Modify: `src/data/storage/directoryScan.ts:672-704`
- Test: `src/data/storage/directoryScan.segmentTailsConcurrency.test.ts`

**Interfaces:** unchanged — `readSegmentTails(dir, { suffix, knownOffsets }): Promise<SegmentTailResult>`; output ordering unchanged (results committed in name order).

- [ ] **Step 1: Write the failing test**

Create `src/data/storage/directoryScan.segmentTailsConcurrency.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "./fileSystemAccess";
import { DIRECTORY_READ_CONCURRENCY, readSegmentTails } from "./directoryScan";

/** A directory whose every `getFile()` takes 20 ms and records how many overlap. */
function slowDirectory(names: string[]): { dir: DirectoryHandleLike; maxInFlight: () => number } {
  let inFlight = 0;
  let maxInFlight = 0;
  const files = names.map((name) => ({
    kind: "file" as const,
    name,
    async getFile(): Promise<File> {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return new File([`${name}\n`], name);
    },
  }));
  const dir = {
    kind: "directory",
    name: "answers.events",
    async getFileHandle(name: string) {
      const file = files.find((candidate) => candidate.name === name);
      if (!file) throw new DOMException("missing", "NotFoundError");
      return file;
    },
    async getDirectoryHandle() {
      throw new DOMException("missing", "NotFoundError");
    },
    async *values() {
      yield* files;
    },
  } as unknown as DirectoryHandleLike;
  return { dir, maxInFlight: () => maxInFlight };
}

describe("readSegmentTails — bounded concurrency (A1)", () => {
  it("reads segments in parallel, up to the shared concurrency cap, with unchanged output", async () => {
    const names = Array.from({ length: 16 }, (_, i) => `seg-${String(i).padStart(2, "0")}.ndjson`).reverse();
    const { dir, maxInFlight } = slowDirectory(names);

    const result = await readSegmentTails(dir, { suffix: ".ndjson", knownOffsets: {} });

    expect(maxInFlight()).toBeGreaterThan(1);
    expect(maxInFlight()).toBeLessThanOrEqual(DIRECTORY_READ_CONCURRENCY);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(result.matchedNames).toEqual(sorted);
    expect([...result.tailTextByName.keys()]).toEqual(sorted);
    expect(result.tailTextByName.get("seg-03.ndjson")).toBe("seg-03.ndjson\n");
    expect(result.sizeByName.get("seg-03.ndjson")).toBe("seg-03.ndjson\n".length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/storage/directoryScan.segmentTailsConcurrency.test.ts`
Expected: FAIL — `expected 1 to be greater than 1`.

- [ ] **Step 3: Parallelise the loop**

In `readSegmentTails`, replace from `const vanished: string[] = [];` through the end of the `for (const entry of matched) { … }` loop with:

```ts
  const vanished: string[] = [];
  const reads: ({ size: number; tail: string | null } | null)[] = new Array(matched.length).fill(null);

  // Bounded-parallel, like the sized listing and the bounded signature above:
  // on the share every open is a round trip, and a sequential walk made each
  // answer-save attempt pay one per segment in the month (A1). Results are
  // committed below in `matched` (name) order, so the output is identical to
  // the sequential walk; the vanish budget object is shared and decremented
  // on one JS thread, so it remains a total across all segments.
  await forEachBounded(matched.length, DIRECTORY_READ_CONCURRENCY, async (index) => {
    const entry = matched[index]!;
    const knownOffset = options.knownOffsets[entry.name] ?? 0;
    reads[index] = await readListedEntry(
      dir,
      entry,
      async (file) => ({
        size: file.size,
        // A shrunk or unchanged file yields no tail — never a negative-length read.
        tail: file.size > knownOffset ? await file.slice(knownOffset).text() : null,
      }),
      budget
    );
  });

  for (let index = 0; index < matched.length; index += 1) {
    const name = matched[index]!.name;
    const read = reads[index] ?? null;
    if (read === null) {
      // Deliberately no sizeByName entry: callers persist sizeByName as the
      // next call's knownOffsets, and recording a size for a segment whose
      // bytes were never read would mark unread events as already consumed.
      vanished.push(name);
      continue;
    }
    sizeByName.set(name, read.size);
    if (read.tail !== null) tailTextByName.set(name, read.tail);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/storage/directoryScan.segmentTailsConcurrency.test.ts src/data/storage/directoryScan.notFound.test.ts src/data/answers/answerEventsCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 6: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (storage): read answer/distribution segment tails in parallel"`

- [ ] **Step 7: Commit**

```bash
git add src/data/storage/directoryScan.ts src/data/storage/directoryScan.segmentTailsConcurrency.test.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (storage): read segment tails with bounded concurrency

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 13: A1 — Thread the save's deadline into the append ladders

**Tier:** 2 (shared module — whole suite).

**Root cause (verified):** the answer casLoop carries a 30 s `deadline` (`answerStorage.ts:636-637, 861-862, 1249-1250`), but `casLoop` only consults it before starting a *new* attempt (`casLoop.ts:161`). Inside one attempt, `appendEventSegment` (`appendOnlyEventLog.ts:760-866`) runs three unbounded ladders: the pre-append re-read (`readExistingSegment`, `:596-620`, up to `VERIFY_READBACK_RETRY_DELAYS_MS` ≈ 11 s), the write (`retryTransientWrite(..., VERIFY_READBACK_RETRY_DELAYS_MS)`, `:832-848`), and the post-close verify (`verifySegmentSize`, `:655-714`). One attempt can therefore outlive the whole budget. `operationDeadline.ts` already provides `nextRetryDelayMs` (used the same way by `safeWrite.ts`).

**Files:**
- Modify: `src/data/storage/transientFileErrors.ts:496-528` (`retryTransientWrite` deadline)
- Modify: `src/data/storage/appendOnlyEventLog.ts:19-35 (imports), 590-632 (readExistingSegment), 655-714 (verifySegmentSize), 760-866 (appendEventSegment)`
- Modify: `src/data/answers/answerEventStore.ts:24-40, 209-217` (`appendAnswerEventSegment` options)
- Modify: `src/data/answers/answerStorage.ts:47-56 (import), 775-870 (performAnswerWrite), 1152-1255 (performOnBehalfWrite)`
- Test: `src/data/storage/appendOnlyEventLog.deadline.test.ts`

**Interfaces:**
- Consumes: `OperationDeadline`, `createDeadline(budgetMs, label)`, `nextRetryDelayMs(delayMs, deadline): number | null`.
- Produces:
  ```ts
  export async function retryTransientWrite<T>(operation, diagnostics?, delays?, deadline?: OperationDeadline): Promise<T>;
  export type AppendEventSegmentOptions = { deadline?: OperationDeadline };
  export async function appendEventSegment<TEvent>(parentDir, events, writer, config, options?: AppendEventSegmentOptions): Promise<SegmentVerification>;
  export async function appendAnswerEventSegment(parentDir, events, writer, config?: AppendOnlyEventLogConfig, options?: AppendEventSegmentOptions): Promise<SegmentVerification>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/data/storage/appendOnlyEventLog.deadline.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import { createDeadline } from "./operationDeadline";
import { retryTransientWrite } from "./transientFileErrors";
import {
  __resetAppendOnlyEventLogMemosForTests,
  appendEventSegment,
  type AppendOnlyEventLogConfig,
} from "./appendOnlyEventLog";

const CONFIG: AppendOnlyEventLogConfig = {
  consumerNamespace: "tst",
  eventsDirName: "test.events",
  segmentSuffix: ".ndjson",
  diagnostics: {
    writeContext: "test:write",
    rereadContext: "test:reread",
    verifyContext: "test:verify",
    cannotWriteCode: "XQ-ANS-001",
    unverifiedCode: "XQ-ANS-002",
    sizeMismatchCode: "XQ-ANS-003",
    segmentParseError: (name) => `bad segment ${name}`,
    verificationFailedError: (fileName, expected, observed) => `${fileName}: ${expected} != ${observed}`,
  },
};

beforeEach(() => {
  __resetAppendOnlyEventLogMemosForTests();
});

describe("retryTransientWrite with a deadline", () => {
  it("stops retrying once the operation's budget is spent", async () => {
    const started = Date.now();
    let attempts = 0;
    await expect(
      retryTransientWrite(
        async () => {
          attempts += 1;
          throw new DOMException("busy", "NotReadableError");
        },
        undefined,
        [20, 60, 150, 400, 800, 1600, 3000, 5000],
        createDeadline(100, "test")
      )
    ).rejects.toMatchObject({ name: "NotReadableError" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(attempts).toBeGreaterThan(1);
  });
});

describe("appendEventSegment with a deadline (A1)", () => {
  it("gives up within the budget instead of riding the ~11 s write ladder", async () => {
    const root = createMemoryDirectory("root");
    setSimulatedFaults(root, [
      { operation: "createWritable", nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);
    const started = Date.now();

    await expect(
      appendEventSegment(
        root,
        [{ id: "e1" }],
        { deviceId: "device-a", sessionId: "session-a", scopeId: "scope" },
        CONFIG,
        { deadline: createDeadline(150, "test") }
      )
    ).rejects.toMatchObject({ name: "NotReadableError" });

    expect(Date.now() - started).toBeLessThan(2_000);
  }, 20_000);

  it("without a deadline keeps today's behaviour (the append still succeeds normally)", async () => {
    const root = createMemoryDirectory("root");
    await expect(
      appendEventSegment(root, [{ id: "e1" }], { deviceId: "device-a", sessionId: "session-b" }, CONFIG)
    ).resolves.toBe("verified");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/storage/appendOnlyEventLog.deadline.test.ts`
Expected: FAIL — the retry test takes ~11 s (`expected 11xxx to be less than 1000`), the append test ~11 s (`expected 11xxx to be less than 2000`).

- [ ] **Step 3: `retryTransientWrite` honours a deadline**

In `transientFileErrors.ts`, add `import { nextRetryDelayMs, type OperationDeadline } from "./operationDeadline";` and change `retryTransientWrite`:

```ts
export async function retryTransientWrite<T>(
  operation: () => Promise<T>,
  diagnostics?: { context: string; dir: DirectoryHandleLike; fileName: string },
  delays: readonly number[] = TRANSIENT_WRITE_RETRY_DELAYS_MS,
  /**
   * The user action's total budget (operationDeadline.ts). A retry that would
   * start after it is spent is not taken — the failure already in hand is
   * reported instead. Omitted, the ladder runs in full exactly as before.
   */
  deadline?: OperationDeadline
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isTransientWriteError(error) && attempt < delays.length) {
        const delay = nextRetryDelayMs(delays[attempt]!, deadline);
        if (delay !== null) {
          await waitFor(delay);
          continue;
        }
      }
      if (isNotFoundError(error) && diagnostics) {
        await logExhaustedNotFound(
          diagnostics.context,
          diagnostics.dir,
          diagnostics.fileName,
          attempt + 1,
          error
        );
      }
      throw error;
    }
  }
}
```

(`operationDeadline.ts` has no imports, so this adds no cycle.)

- [ ] **Step 4: Thread the deadline through `appendEventSegment`**

In `appendOnlyEventLog.ts`:

4a. Add `import { nextRetryDelayMs, type OperationDeadline } from "./operationDeadline";`, and after the `SegmentWriterIdentity` type add:

```ts
/** Per-call options for `appendEventSegment`. */
export type AppendEventSegmentOptions = {
  /**
   * The user action's total budget. Every inner ladder (pre-append re-read,
   * write, post-close verify) stops sleeping once it is spent, so ONE attempt
   * can no longer outlive the whole action (A1). Omitted: unbounded, as before.
   */
  deadline?: OperationDeadline;
};
```

4b. `readExistingSegment`: add a final parameter `deadline: OperationDeadline | undefined` and replace

```ts
      if (transient && attempt < ladder.length) {
        await waitFor(ladder[attempt]!);
        continue;
      }
```
with

```ts
      if (transient && attempt < ladder.length) {
        const delay = nextRetryDelayMs(ladder[attempt]!, deadline);
        if (delay !== null) {
          await waitFor(delay);
          continue;
        }
      }
```

4c. `verifySegmentSize`: add a final parameter `deadline: OperationDeadline | undefined`; replace the first line of the loop body `const retriesLeft = attempt < VERIFY_READBACK_RETRY_DELAYS_MS.length;` with

```ts
    const ladderDelay =
      attempt < VERIFY_READBACK_RETRY_DELAYS_MS.length ? VERIFY_READBACK_RETRY_DELAYS_MS[attempt]! : null;
    const delay = ladderDelay === null ? null : nextRetryDelayMs(ladderDelay, deadline);
    const retriesLeft = delay !== null;
```
and replace BOTH `await waitFor(VERIFY_READBACK_RETRY_DELAYS_MS[attempt]!);` lines with `await waitFor(delay ?? 0);` (both are only reached when `retriesLeft` is true).

4d. `appendEventSegment`: add the parameter `options: AppendEventSegmentOptions = {}` after `config: AppendOnlyEventLogConfig`, add `const { deadline } = options;` after the destructuring of `config`, pass `deadline` as the new last argument to all three `readExistingSegment(…)` calls and to `verifySegmentSize(…)`, and pass it as the fourth argument of `retryTransientWrite(…)` (after `VERIFY_READBACK_RETRY_DELAYS_MS`).

- [ ] **Step 5: Answers pass their action's deadline**

5a. `answerEventStore.ts`: add `type AppendEventSegmentOptions,` to the type imports from `../storage/appendOnlyEventLog` and change `appendAnswerEventSegment` to:

```ts
export async function appendAnswerEventSegment(
  parentDir: DirectoryHandleLike,
  events: AnswerEvent[],
  writer: SegmentWriterIdentity,
  config: AppendOnlyEventLogConfig = ANSWER_EVENT_LOG,
  options: AppendEventSegmentOptions = {}
): Promise<SegmentVerification> {
  return appendEventSegment<AnswerEvent>(parentDir, events, writer, config, options);
}
```

5b. `answerStorage.ts`: add `ANSWER_EVENT_LOG,` to the `./answerEventStore` import. In `performAnswerWrite`, directly after `const writer = answerWriterIdentity(directoryHandle, monthFolderName);` add

```ts
  // ONE budget for the whole user action, shared by casLoop (new attempts) and
  // the append's inner ladders (A1) — see operationDeadline.ts.
  const deadline = createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "answers:interactive-write");
```
change `await appendAnswerEventSegment(mainDir, batch, writer);` to `await appendAnswerEventSegment(mainDir, batch, writer, ANSWER_EVENT_LOG, { deadline });`, and in its casLoop options replace `deadline: createDeadline(INTERACTIVE_WRITE_DEADLINE_MS, "answers:interactive-write"),` with `deadline,`. Make the same three edits in `performOnBehalfWrite` (its `writer` line, its `appendAnswerEventSegment(mainDir, batch, writer)` call, and its casLoop `deadline:` option). Leave `updateEmployeeRequestsFile`'s own deadline as is.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/data/storage/appendOnlyEventLog.deadline.test.ts src/data/storage/appendOnlyEventLog.test.ts src/data/answers`
Expected: PASS.

- [ ] **Step 7: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 8: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (answers): one save attempt can no longer outlive the 30 s budget"`
Before/After of `retryTransientWrite`'s retry branch.

- [ ] **Step 9: Commit**

```bash
git add src/data/storage/transientFileErrors.ts src/data/storage/appendOnlyEventLog.ts src/data/storage/appendOnlyEventLog.deadline.test.ts src/data/answers/answerEventStore.ts src/data/answers/answerStorage.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (answers): thread the save deadline into the append retry ladders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 14: A1 — One stable answer-segment chain per (browser, month, user)

**Tier:** 3 (changes which segment files new writes land in; pass `--bump=minor`).

**Root cause (verified):** answer writers use `sessionId: getDistributionSessionId()` (`answerStorage.ts:694-699`), fresh per page load (`distributionEventStore.ts:117-122`), and the segment name also carries a time prefix fixed at module load (`answerEventStore.ts:171-197`). Every reload therefore starts a new segment file, and since every save attempt reads every segment of the month, every reload makes every later save slower.

**Design:** the writer's chain id becomes `chain|{month}|{actor}` and the time prefix becomes the chain's persisted creation minute, stored per `(month, actor)` in localStorage key `xray_answer_segment_chain_v1` (registered). The existing persisted per-browser `getDistributionDeviceId()` (`xray_distribution_device_id_v1`, already in `storageRegistry.ts`) stays the device part, so two browsers of the same user never share a segment. Old per-session segments stay readable (readers glob by suffix). Safety: a stable chain can already exist on disk when this page first touches it (an earlier page load, or a second tab of the same browser — Web Locks serialise those), so for a `stable` writer a segment **listed in the directory** is treated as already-written: a stale NotFound then takes the patient ladder and, if still unreadable, rotates away (existing `!existing.reliable` branch) instead of rewriting it. Non-stable writers (distribution) are unchanged.
**Deviation:** the spec asks for a new registered deviceId; one already exists (`getDistributionDeviceId`), so it is reused rather than duplicated (one place, one name). **Known residual:** two tabs of the same user and month each exclude only the segment names they themselves wrote from the sync probe (Task 11), so tab B may notice tab A's appends to a shared segment only after a rotation or the manual refresh.

**Files:**
- Create: `src/data/answers/answerSegmentChain.ts`
- Modify: `src/data/storage/appendOnlyEventLog.ts:49-53 (SegmentWriterIdentity), 596-632 (readExistingSegment), 760-866 (appendEventSegment)`
- Modify: `src/data/answers/answerStorage.ts:43-46 (imports), 682-700 (answerWriterIdentity), performAnswerWrite + performOnBehalfWrite call sites`
- Modify: `src/data/storage/storageRegistry.ts` (new entry after `xray_distribution_device_id_v1`)
- Test: `src/data/answers/answerSegmentChain.test.ts`

**Interfaces:**
- Consumes: `buildAnswerEventLogConfig(nowMs?: number): AppendOnlyEventLogConfig`, `getDistributionDeviceId()`, Task 13's `appendAnswerEventSegment(…, config, { deadline })`.
- Produces:
  ```ts
  // SegmentWriterIdentity
  stable?: boolean;
  // answerSegmentChain.ts
  export const ANSWER_SEGMENT_CHAIN_STORAGE_KEY = "xray_answer_segment_chain_v1";
  export type AnswerSegmentChain = { chainId: string; config: AppendOnlyEventLogConfig };
  export function stableAnswerChain(monthFolderName: string, actor: string, nowMs?: number): AnswerSegmentChain;
  export function __resetAnswerSegmentChainMemoForTests(): void;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/data/answers/answerSegmentChain.test.ts`:

```ts
/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { __resetAppendOnlyEventLogMemosForTests } from "../storage/appendOnlyEventLog";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { __resetDistributionSessionIdForTests } from "../distribution/distributionEventStore";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import { __resetAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import { __resetAnswerSegmentChainMemoForTests } from "./answerSegmentChain";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-May-2026";

function answer(xrayImageId: string): ItemAnswer {
  return {
    xrayImageId,
    templateId: "tpl",
    templateVersion: 1,
    answers: [],
    lastSavedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    answeredBy: "emp1",
    status: "submitted",
  };
}

/** Everything a page reload forgets; localStorage survives it. */
function simulateReload(): void {
  __resetAppendOnlyEventLogMemosForTests();
  __resetAnswerSegmentChainMemoForTests();
  __resetDistributionSessionIdForTests();
  __resetAnswerEventsCacheForTests();
}

async function segmentNames(root: DirectoryHandleLike): Promise<string[]> {
  const main = await getSampleMainDir(root, MONTH, false);
  const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: false });
  return (await listDirectoryEntries(events))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".ndjson"))
    .map((entry) => entry.name);
}

beforeEach(() => {
  localStorage.clear();
  simulateReload();
});

describe("stable answer segment chain (A1)", () => {
  it("keeps appending to the same segment across page reloads", async () => {
    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    simulateReload();
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-2"))).ok).toBe(true);

    expect(await segmentNames(root)).toHaveLength(1);
    const file = await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(file.items.map((item) => item.xrayImageId).sort()).toEqual(["XR-1", "XR-2"]);
  });

  it("gives a different browser (device id) its own segment", async () => {
    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1"))).ok).toBe(true);
    simulateReload();
    localStorage.setItem("xray_distribution_device_id_v1", "another-browser");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-2"))).ok).toBe(true);

    expect(await segmentNames(root)).toHaveLength(2);
    const file = await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(file.items.map((item) => item.xrayImageId).sort()).toEqual(["XR-1", "XR-2"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/answers/answerSegmentChain.test.ts`
Expected: FAIL — `Failed to resolve import "./answerSegmentChain"`; after creating an empty stub module it would fail with `expected [ 'x', 'y' ] to have a length of 1`.

- [ ] **Step 3: The chain module**

Create `src/data/answers/answerSegmentChain.ts`:

```ts
/**
 * A1: one answer-segment chain per (browser, month, answering user), kept
 * across page loads.
 *
 * The chain used to be keyed on the per-page-load session id, and the segment
 * name also carries a creation-minute prefix fixed at module load — so every
 * reload started a new segment file, and because each save reads every segment
 * of the month, every reload made every later save slower. Here the chain id
 * is derived from (month, user) and the prefix is the chain's persisted
 * creation minute; the device part stays `getDistributionDeviceId()` (already
 * persisted per browser), so two browsers never share a segment.
 *
 * Losing the stored minute (cleared site data, private window) only starts a
 * new chain — every reader folds every segment, so nothing is lost.
 */
import type { AppendOnlyEventLogConfig } from "../storage/appendOnlyEventLog";
import { buildAnswerEventLogConfig } from "./answerEventStore";

export const ANSWER_SEGMENT_CHAIN_STORAGE_KEY = "xray_answer_segment_chain_v1";

export type AnswerSegmentChain = { chainId: string; config: AppendOnlyEventLogConfig };

/** In-page memo; also the fallback when localStorage is unavailable. */
const createdAtByChain = new Map<string, number>();

function readStoredChains(): Record<string, number> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(ANSWER_SEGMENT_CHAIN_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeStoredChains(chains: Record<string, number>): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ANSWER_SEGMENT_CHAIN_STORAGE_KEY, JSON.stringify(chains));
    }
  } catch {
    // The in-page memo still keeps the chain stable for this page load.
  }
}

export function stableAnswerChain(
  monthFolderName: string,
  actor: string,
  nowMs: number = Date.now()
): AnswerSegmentChain {
  const key = `${monthFolderName}|${actor}`;
  let createdAtMs = createdAtByChain.get(key);
  if (createdAtMs === undefined) {
    const stored = readStoredChains();
    const candidate = stored[key];
    createdAtMs = typeof candidate === "number" && Number.isFinite(candidate) ? candidate : nowMs;
    if (candidate !== createdAtMs) writeStoredChains({ ...stored, [key]: createdAtMs });
    createdAtByChain.set(key, createdAtMs);
  }
  return { chainId: `chain|${key}`, config: buildAnswerEventLogConfig(createdAtMs) };
}

/** @internal test-only — forget the in-page memo (a page reload does the same). */
export function __resetAnswerSegmentChainMemoForTests(): void {
  createdAtByChain.clear();
}
```

- [ ] **Step 4: Stable writers treat listed segments as their own**

In `appendOnlyEventLog.ts`:

4a. `SegmentWriterIdentity` — add after `scopeId?: string;`:

```ts
  /**
   * True for a chain that outlives the page (answers, A1): its segments may
   * already exist on disk before this session writes them. See `knownFor` in
   * `appendEventSegment`. Omitted/false (distribution) keeps the per-session
   * rules exactly as they were.
   */
  stable?: boolean;
```

4b. `readExistingSegment`: replace the parameter `writtenKey: string,` with `knownWritten: boolean,` and delete its first line `const knownWritten = writtenSegmentsThisSession.has(writtenKey);`.

4c. `appendEventSegment`: after `const memoKeyFor = …;` add

```ts
  // Has THIS chain already written `name`? For a per-session writer only this
  // session's memo can say so. A stable writer's chain may predate the page (or
  // be shared with another tab of the same browser, serialised by the lock
  // below), so a name the directory LISTS is treated as written: a stale
  // NotFound then takes the patient ladder and rotates away instead of
  // rewriting the file without its lines. A listing failure is treated as
  // "written" — the conservative answer.
  const knownFor = async (name: string): Promise<boolean> => {
    if (writtenSegmentsThisSession.has(memoKeyFor(name))) return true;
    if (!writer.stable) return false;
    try {
      return (await listDirectoryEntries(eventsDir)).some((entry) => entry.kind === "file" && entry.name === name);
    } catch {
      return true;
    }
  };
```
and change each of the three `readExistingSegment(eventsDir, fileName, memoKeyFor(fileName), diagnostics, deadline)` calls to `readExistingSegment(eventsDir, fileName, await knownFor(fileName), diagnostics, deadline)`.

- [ ] **Step 5: Answers use the stable chain**

In `answerStorage.ts`:

5a. Change the import `import { getDistributionDeviceId, getDistributionSessionId } from "../distribution/distributionEventStore";` to import only `getDistributionDeviceId`; add `import { stableAnswerChain } from "./answerSegmentChain";` and `import type { SegmentWriterIdentity } from "../storage/appendOnlyEventLog";`; remove `ANSWER_EVENT_LOG,` from the `./answerEventStore` import if Task 13 added it and nothing else uses it.

5b. Replace `answerWriterIdentity` and its docblock (lines 682-700) with:

```ts
/**
 * The writer chain for one (month, actor) on this browser — STABLE across page
 * loads (A1, see answerSegmentChain.ts). `deviceId` is the persisted per-browser
 * id distribution also uses; `consumerNamespace: "ans"` keeps the two
 * consumers' module-level memos apart (appendOnlyEventLog's `segmentMemoKey`).
 * `actor` is whoever writes the event: the employee, or the supervisor
 * answering on their behalf.
 */
function answerWriterIdentity(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  actor: string
): { writer: SegmentWriterIdentity; config: AppendOnlyEventLogConfig } {
  const chain = stableAnswerChain(monthFolderName, actor);
  return {
    writer: {
      deviceId: getDistributionDeviceId(),
      sessionId: chain.chainId,
      scopeId: `${workspaceScopeId(directoryHandle)}|${monthFolderName}`,
      stable: true,
    },
    config: chain.config,
  };
}
```
(add `type AppendOnlyEventLogConfig` to the same `import type` from `../storage/appendOnlyEventLog`).

5c. In `performAnswerWrite` replace `const writer = answerWriterIdentity(directoryHandle, monthFolderName);` with `const { writer, config: segmentConfig } = answerWriterIdentity(directoryHandle, monthFolderName, username);` and the append call with `await appendAnswerEventSegment(mainDir, batch, writer, segmentConfig, { deadline });`. In `performOnBehalfWrite` do the same with `author` as the actor.

- [ ] **Step 6: Register the storage key**

In `storageRegistry.ts`, after the `xray_distribution_device_id_v1` entry:

```ts
  {
    id: "xray_answer_segment_chain_v1",
    layer: "local",
    purpose:
      "Creation minute of this browser's answer-segment chain per (month, user), so every page load keeps appending to the same answers.events segment instead of starting a new file.",
    lossConsequence: "The next save starts a new segment chain. No data at risk — every segment is still read.",
  },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/data/answers src/data/storage/appendOnlyEventLog.test.ts src/data/storage/storageKeyCoverage.test.ts`
Expected: PASS. If an existing answers test asserted that a new page load writes a new segment file, update it to the new contract and name it in the edit log.

- [ ] **Step 8: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 9: Edit-log entry**

Run: `npm run editlog -- --tier=3 --bump=minor --append --sync-package "Change (answers): answer saves keep one segment chain per browser, month and user across page reloads"`
Prose: Why, What changed, Before/After of `answerWriterIdentity`, **Migration:** none — new writes land in a stably-named segment beside the old per-session ones; the fold already reads every segment. **Rollback:** revert; older builds write per-session segments again and still read these.

- [ ] **Step 10: Commit**

```bash
git add src/data/answers/answerSegmentChain.ts src/data/answers/answerSegmentChain.test.ts src/data/storage/appendOnlyEventLog.ts src/data/answers/answerStorage.ts src/data/storage/storageRegistry.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Change (answers): one stable segment chain per browser, month and user

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 15: A1 — The inspection panel shows the save outcome inline

**Tier:** 2. **XrayReferrals net line delta: 0** (changes are inside the module-level `createSaveAnswerHandler`).

**Root cause (verified):** `handleSave` reports success/failure only through the page-top banner (`XrayReferrals.tsx:484-575`, rendered at `:1969`), and resolves `void` either way; the panel's `catch` (`InspectionPanel/index.tsx:239-256`) never runs for a real failure, so the employee sees no outcome where they clicked.

**Files:**
- Modify: `src/data/answers/answerTypes.ts` (new type at end of file)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx:480-574` (`handleSave` returns an outcome)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx:~610` (`SampleDetailPanel` `onSave` type)
- Modify: `src/components/InspectionPanel/index.tsx:27 (Props.onSave), 116-119 (state), 222-257 (submitStudy), 413 (render)`
- Modify: `src/components/InspectionPanel/InspectionPanel.css` (append)
- Modify: `src/data/labels/labelsStore.ts` (after `ip_msg_save_failed_generic`, line 623)
- Test: `src/components/InspectionPanel/InspectionPanel.test.tsx` (append)

**Interfaces:**
- Produces: `export type AnswerSaveOutcome = { ok: true } | { ok: false; message: string };` (answerTypes.ts); `InspectionPanel` prop `onSave: (ans: FieldAnswer[]) => Promise<AnswerSaveOutcome | void>`; `handleSave(...) : Promise<AnswerSaveOutcome>`.
- Labels: `ip_save_status_saving`, `ip_save_status_saved`, `ip_save_status_failed` (`{message}`).

- [ ] **Step 1: Write the failing test**

In `src/components/InspectionPanel/InspectionPanel.test.tsx`, add `act` to the `@testing-library/react` import and `import type { AnswerSaveOutcome } from "../../data/answers/answerTypes";`, then append:

```tsx
describe("InspectionPanel — inline save status (A1)", () => {
  const template = makeTemplate([field({ fieldId: "n1", label: "ملاحظة", type: "text", required: false })]);

  function renderWith(onSave: () => Promise<AnswerSaveOutcome | void>) {
    return render(
      <InspectionPanel
        entry={makeEntry()}
        template={template}
        savedAnswer={null}
        readonly={false}
        onClose={() => {}}
        onSave={onSave}
      />
    );
  }

  it("shows saving, then submitted, from a successful outcome", async () => {
    let resolve!: (outcome: AnswerSaveOutcome) => void;
    renderWith(() => new Promise<AnswerSaveOutcome>((done) => { resolve = done; }));

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn }));
    expect(await screen.findByText(DEFAULT_LABELS.ip_save_status_saving)).toBeInTheDocument();

    await act(async () => {
      resolve({ ok: true });
    });
    expect(await screen.findByText(DEFAULT_LABELS.ip_save_status_saved)).toBeInTheDocument();
  });

  it("shows why the save failed and leaves the submit button as the retry", async () => {
    renderWith(async () => ({ ok: false, message: "تعذّر الوصول إلى مجلد العمل." }));

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn }));

    expect(
      await screen.findByText(
        DEFAULT_LABELS.ip_save_status_failed.replace("{message}", "تعذّر الوصول إلى مجلد العمل.")
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn })).not.toBeDisabled();
  });

  it("shows no status for a legacy onSave that resolves nothing", async () => {
    renderWith(async () => {});
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.ip_submit_btn }));
    await screen.findByRole("button", { name: DEFAULT_LABELS.ip_submit_btn });
    expect(screen.queryByText(DEFAULT_LABELS.ip_save_status_saved)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/InspectionPanel/InspectionPanel.test.tsx`
Expected: FAIL — `findByText(undefined)` / no element with the saving text (labels and status line do not exist).

- [ ] **Step 3: Outcome type and labels**

Append to `src/data/answers/answerTypes.ts`:

```ts
/** What one answer submit produced — drives the inspection panel's inline status (A1). */
export type AnswerSaveOutcome = { ok: true } | { ok: false; message: string };
```

In `labelsStore.ts`, after `ip_msg_save_failed_generic:` (line 623):

```ts
  ip_save_status_saving:         "جارٍ الحفظ…",
  ip_save_status_saved:          "تم التقديم ✓",
  ip_save_status_failed:         "لم يُحفظ — {message} الإجابة ما زالت هنا، أعد المحاولة بنفس الزر.",
```

- [ ] **Step 4: The panel renders the outcome**

In `InspectionPanel/index.tsx`:
- add `import type { AnswerSaveOutcome } from "../../data/answers/answerTypes";` (merge into the existing `answerTypes` type import);
- `Props.onSave` becomes `onSave: (ans: FieldAnswer[]) => Promise<AnswerSaveOutcome | void>;`
- after `const [validationMsg, setValidationMsg] = useState<string | null>(null);` add

```ts
  // A1: the outcome of the last submit, shown where the employee clicked —
  // the page banner alone was easy to miss. `void` from a legacy caller shows
  // nothing (it carries no outcome).
  const [saveStatus, setSaveStatus] = useState<
    { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string } | null
  >(null);
```
- in `submitStudy`, replace

```ts
    setSubmitting(true);
    try {
      await onSave(collect());
    } catch {
```
with

```ts
    setSubmitting(true);
    setSaveStatus({ kind: "saving" });
    try {
      const outcome = await onSave(collect());
      setSaveStatus(outcome ? (outcome.ok ? { kind: "saved" } : { kind: "failed", message: outcome.message }) : null);
    } catch {
      setSaveStatus(null);
```
(keep the existing comment and `setValidationMsg(getLabels().ip_msg_save_failed_generic);` inside the catch);
- directly before `{!isSubmitted && (!readonly || onReplace || onReassign) && (` insert

```tsx
      {saveStatus && (
        // Not role="status": the page banner already owns that role, and two
        // would make every `getByRole("status")` in the view ambiguous.
        <p className={`ip-save-status ip-save-status--${saveStatus.kind}`} aria-live="polite">
          {saveStatus.kind === "saving"
            ? getLabels().ip_save_status_saving
            : saveStatus.kind === "saved"
              ? getLabels().ip_save_status_saved
              : getLabels().ip_save_status_failed.replace("{message}", saveStatus.message)}
        </p>
      )}
```

Append to `InspectionPanel.css`:

```css
.ip-save-status {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: var(--fw-bold);
}

.ip-save-status--saving {
  color: var(--c-navy-soft);
}

.ip-save-status--saved {
  color: var(--c-success);
}

.ip-save-status--failed {
  color: var(--c-danger);
}
```

In `subComponents.tsx`, the `SampleDetailPanel` props type: `onSave: (ans: FieldAnswer[]) => Promise<void>;` → `onSave: (ans: FieldAnswer[]) => Promise<AnswerSaveOutcome | void>;` (import the type from `../../../../../../data/answers/answerTypes`).

- [ ] **Step 5: `handleSave` returns the outcome**

In `XrayReferrals.tsx` `createSaveAnswerHandler`: import `type AnswerSaveOutcome` beside `FieldAnswer, ItemAnswer`; change the returned function's return type to `Promise<AnswerSaveOutcome>` and make every exit return an outcome:

```ts
    if (!canSubmitAnswers) {
      const text = "لا تملك صلاحية تقديم الإجابات، أو أن مساحة العمل للقراءة فقط.";
      setStatusMsg({ type: "error", text });
      return { ok: false, message: text };
    }
    // (comment unchanged)
    if (forUser !== username && !canAnswerOnBehalf) {
      const text = getLabels().msg_answer_on_behalf_denied;
      setStatusMsg({ type: "error", text });
      return { ok: false, message: text };
    }
    // (comment unchanged)
    if (!activeTpl || !selMonth) return { ok: false, message: getLabels().ip_msg_save_failed_generic };
```
in the ok branch, after the `try { notifyLocalDataChange(["answers"]); } finally { … }` block add `return { ok: true };`; replace the `else` and `catch` bodies with

```ts
      } else {
        const text = userFacingErrorText(result.error, "xrayReferrals:result");
        setStatusMsg({ type: "error", text });
        return { ok: false, message: text };
      }
    } catch (error) {
      const text = thrownWriteErrorText(error);
      setStatusMsg({ type: "error", text });
      return { ok: false, message: text };
    }
```

(The `onSave={(ans) => handleSave(…)}` arrow in the component already returns this promise — no change there.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/InspectionPanel src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.saveBroadcast.test.tsx`
Expected: PASS.

- [ ] **Step 7: Gates + complexity + hex**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity && npm run check:hex-literals`
Expected: all green.

- [ ] **Step 8: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (inspection): the panel shows saving / submitted / not-saved inline from the save's real outcome"`

- [ ] **Step 9: Commit**

```bash
git add src/data/answers/answerTypes.ts src/components/InspectionPanel src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx src/data/labels/labelsStore.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (inspection): inline save outcome in the inspection panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 16: A1 — App-level replay of pending (unsaved) answers

**Tier:** 2.

**Root cause (verified):** a failed save is queued in IndexedDB (`markAnswerPendingLocally`, `answerStorage.ts:882-890`), but it is replayed only by `XrayInspectionResults` (`XrayInspectionResults.tsx:276-279, 349-351, 422-428`): only while that sub-tab is mounted, only for the selected month, never for ad-hoc folders, and a successful replay neither notifies other views nor clears the draft.

**Design:** a pure `replayPendingAnswers` over **every** pending record of the signed-in user (all months, ad-hoc `adhoc-*` folders included, since the record's `month` is the folder the failed write targeted). Per month: read the employee's answers once; an item already on disk as new or newer is marked synced; otherwise it is appended through the normal `upsertItemAnswer` path, and on success its draft is cleared. One local `answers` change is broadcast when anything landed. A headless `PendingAnswerReplayRunner` runs it once at mount and every 30 s while the tab is visible, mounted once in `AuthGate` beside `WorkspaceErrorSink`; it also runs `pruneAnswerDrafts()` once at start (A1 draft robustness: "wired at app start"). `XrayInspectionResults` keeps its on-load reconcile but its 30 s interval only refreshes the pending count.

**Files:**
- Modify: `src/data/answers/answerLocalMirror.ts` (new export after `countPendingAnswers`)
- Create: `src/data/answers/pendingAnswerReplay.ts`, `src/data/answers/PendingAnswerReplayRunner.tsx`
- Modify: `src/auth/AuthGate.tsx:70 (import), 731 (mount)`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx:415-428`
- Test: `src/data/answers/pendingAnswerReplay.test.ts`, `src/data/answers/PendingAnswerReplayRunner.test.tsx`

**Interfaces:**
- Consumes: `upsertItemAnswer`, `loadEmployeeAnswers`, `mirrorAnswerLocally(month, username, item)`, `answerDraftKey`, `clearAnswerDraft`, `pruneAnswerDrafts`, `notifyLocalDataChange(families)`, `useWorkspace()`.
- Produces:
  ```ts
  export async function loadPendingAnswerRecords(username: string): Promise<Array<{ month: string; item: ItemAnswer }>>; // answerLocalMirror.ts
  export type PendingReplayDeps = { loadPending: (username: string) => Promise<Array<{ month: string; item: ItemAnswer }>>; markSynced: (month: string, username: string, item: ItemAnswer) => Promise<void> };
  export type PendingReplaySummary = { replayed: number; alreadyOnDisk: number; failed: number };
  export async function replayPendingAnswers(directoryHandle: DirectoryHandleLike, username: string, deps?: PendingReplayDeps): Promise<PendingReplaySummary>;
  export const PENDING_REPLAY_INTERVAL_MS = 30_000;
  export function PendingAnswerReplayRunner(props: { username: string; enabled?: boolean }): null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/data/answers/pendingAnswerReplay.test.ts`:

```ts
/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { subscribeToDataChange, type DataRefreshDetail } from "../workspace/dataRefreshSignal";
import { answerDraftKey, loadAnswerDraft, saveAnswerDraft } from "./answerDraftStore";
import { __resetAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";
import { replayPendingAnswers } from "./pendingAnswerReplay";

const MONTH = "5-May-2026";
const ADHOC = "adhoc-imp-1";

function answer(xrayImageId: string, lastSavedAt = "2026-09-28T10:00:00.000Z"): ItemAnswer {
  return {
    xrayImageId,
    templateId: "tpl",
    templateVersion: 1,
    answers: [{ fieldId: "note", value: "ok" }],
    lastSavedAt,
    submittedAt: lastSavedAt,
    answeredBy: "emp1",
    status: "submitted",
  };
}

beforeEach(() => {
  localStorage.clear();
  __resetAnswerEventsCacheForTests();
});

describe("replayPendingAnswers (A1)", () => {
  it("replays every pending answer — any month, ad-hoc folders too — clears its draft, and announces it once", async () => {
    const root = createMemoryDirectory("root");
    const adhocId = "ADHOC-imp-1-XR-2";
    saveAnswerDraft(answerDraftKey(MONTH, "XR-1", "emp1"), { note: "ok" });
    saveAnswerDraft(answerDraftKey(ADHOC, adhocId, "emp1"), { note: "ok" });
    const seen: DataRefreshDetail[] = [];
    const stop = subscribeToDataChange(["answers"], (detail) => { seen.push(detail); });

    const summary = await replayPendingAnswers(root, "emp1", {
      loadPending: async () => [
        { month: MONTH, item: answer("XR-1") },
        { month: ADHOC, item: answer(adhocId) },
      ],
      markSynced: vi.fn(async () => {}),
    });
    stop();

    expect(summary).toEqual({ replayed: 2, alreadyOnDisk: 0, failed: 0 });
    expect(loadAnswerDraft(answerDraftKey(MONTH, "XR-1", "emp1"))).toBeNull();
    expect(loadAnswerDraft(answerDraftKey(ADHOC, adhocId, "emp1"))).toBeNull();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((item) => item.xrayImageId)).toEqual(["XR-1"]);
    expect((await loadEmployeeAnswers(root, ADHOC, "emp1")).items.map((item) => item.xrayImageId)).toEqual([adhocId]);
    expect(seen).toHaveLength(1);
  });

  it("marks an answer already on disk (as new or newer) synced without writing it again", async () => {
    const root = createMemoryDirectory("root");
    expect((await upsertItemAnswer(root, MONTH, "emp1", answer("XR-1", "2026-09-28T10:00:00.000Z"))).ok).toBe(true);
    __resetAnswerEventsCacheForTests();
    const markSynced = vi.fn(async () => {});

    const summary = await replayPendingAnswers(root, "emp1", {
      loadPending: async () => [{ month: MONTH, item: answer("XR-1", "2026-09-28T09:00:00.000Z") }],
      markSynced,
    });

    expect(summary).toEqual({ replayed: 0, alreadyOnDisk: 1, failed: 0 });
    expect(markSynced).toHaveBeenCalledWith(MONTH, "emp1", expect.objectContaining({ xrayImageId: "XR-1" }));
  });

  it("does nothing and announces nothing when the queue is empty", async () => {
    const root = createMemoryDirectory("root");
    const seen: DataRefreshDetail[] = [];
    const stop = subscribeToDataChange(["answers"], (detail) => { seen.push(detail); });
    const summary = await replayPendingAnswers(root, "emp1", { loadPending: async () => [], markSynced: vi.fn(async () => {}) });
    stop();
    expect(summary).toEqual({ replayed: 0, alreadyOnDisk: 0, failed: 0 });
    expect(seen).toHaveLength(0);
  });
});
```

Create `src/data/answers/PendingAnswerReplayRunner.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const replay = vi.hoisted(() => vi.fn(async () => ({ replayed: 0, alreadyOnDisk: 0, failed: 0 })));
const prune = vi.hoisted(() => vi.fn());

vi.mock("./pendingAnswerReplay", () => ({ replayPendingAnswers: replay }));
vi.mock("./answerDraftStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./answerDraftStore")>()),
  pruneAnswerDrafts: prune,
}));
vi.mock("../workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: { kind: "directory", name: "root" }, status: "ready" }),
}));

import { PENDING_REPLAY_INTERVAL_MS, PendingAnswerReplayRunner } from "./PendingAnswerReplayRunner";

beforeEach(() => {
  vi.useFakeTimers();
  replay.mockClear();
  prune.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PendingAnswerReplayRunner", () => {
  it("prunes old drafts once, replays at mount, and again every interval", async () => {
    render(<PendingAnswerReplayRunner username="emp1" />);
    expect(prune).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith(expect.anything(), "emp1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_REPLAY_INTERVAL_MS);
    });
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it("does not replay when disabled", () => {
    render(<PendingAnswerReplayRunner username="emp1" enabled={false} />);
    expect(replay).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/answers/pendingAnswerReplay.test.ts src/data/answers/PendingAnswerReplayRunner.test.tsx`
Expected: FAIL — neither module resolves.

- [ ] **Step 3: Pending records from the mirror**

In `answerLocalMirror.ts`, after `countPendingAnswers`:

```ts
/** Every answer of this user still queued (`synced: false`), across ALL months and ad-hoc folders. */
export async function loadPendingAnswerRecords(
  username: string
): Promise<Array<{ month: string; item: ItemAnswer }>> {
  const all = await readAllRecords();
  return all
    .filter((record) => record.username === username && !record.synced)
    .map((record) => ({ month: record.month, item: record.item }));
}
```

- [ ] **Step 4: The replay**

Create `src/data/answers/pendingAnswerReplay.ts`:

```ts
/**
 * A1: land every answer this browser still holds as "not saved yet".
 *
 * Replaces the replay that only ran while «نتائج فحص الأشعة» was mounted, and
 * only for the selected month: a pending record's `month` is the folder its
 * failed write targeted (a real month or an `adhoc-*` store), so replaying
 * record-by-record covers every month and every ad-hoc import. Writes go
 * through `upsertItemAnswer` — the same conflict-safe append a real save uses.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import { notifyLocalDataChange } from "../workspace/dataRefreshSignal";
import { answerDraftKey, clearAnswerDraft } from "./answerDraftStore";
import { loadPendingAnswerRecords, mirrorAnswerLocally } from "./answerLocalMirror";
import { loadEmployeeAnswers, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

export type PendingReplayDeps = {
  loadPending: (username: string) => Promise<Array<{ month: string; item: ItemAnswer }>>;
  markSynced: (month: string, username: string, item: ItemAnswer) => Promise<void>;
};

export type PendingReplaySummary = { replayed: number; alreadyOnDisk: number; failed: number };

const DEFAULT_DEPS: PendingReplayDeps = {
  loadPending: loadPendingAnswerRecords,
  markSynced: mirrorAnswerLocally,
};

export async function replayPendingAnswers(
  directoryHandle: DirectoryHandleLike,
  username: string,
  deps: PendingReplayDeps = DEFAULT_DEPS
): Promise<PendingReplaySummary> {
  const summary: PendingReplaySummary = { replayed: 0, alreadyOnDisk: 0, failed: 0 };
  const byMonth = new Map<string, ItemAnswer[]>();
  for (const { month, item } of await deps.loadPending(username)) {
    const items = byMonth.get(month);
    if (items) items.push(item);
    else byMonth.set(month, [item]);
  }

  for (const month of [...byMonth.keys()].sort((a, b) => a.localeCompare(b))) {
    const items = byMonth.get(month)!;
    let onDisk: Map<string, ItemAnswer>;
    try {
      const file = await loadEmployeeAnswers(directoryHandle, month, username);
      onDisk = new Map(file.items.map((item) => [item.xrayImageId, item]));
    } catch (error) {
      logError("answers:pending-replay-read", error);
      summary.failed += items.length;
      continue;
    }
    for (const item of items) {
      const current = onDisk.get(item.xrayImageId);
      if (current && current.lastSavedAt >= item.lastSavedAt) {
        // The workspace already holds this answer (or a newer one): only the
        // queue entry is stale. The draft is left alone — it may hold edits
        // made after the failed save.
        await deps.markSynced(month, username, current);
        summary.alreadyOnDisk += 1;
        continue;
      }
      const result = await upsertItemAnswer(directoryHandle, month, username, item);
      if (result.ok) {
        clearAnswerDraft(answerDraftKey(month, item.xrayImageId, username));
        summary.replayed += 1;
      } else {
        summary.failed += 1;
      }
    }
  }

  if (summary.replayed + summary.alreadyOnDisk > 0) notifyLocalDataChange(["answers"]);
  return summary;
}
```

- [ ] **Step 5: The runner**

Create `src/data/answers/PendingAnswerReplayRunner.tsx`:

```tsx
/**
 * Headless, mounted once under the workspace (AuthGate, beside
 * WorkspaceErrorSink): replays this user's pending answers at sign-in and every
 * 30 s while the tab is visible, on every page — not only while «نتائج فحص
 * الأشعة» is open. Also prunes expired answer drafts once at start.
 */
import { useEffect } from "react";

import { useWorkspace } from "../workspace/useWorkspace";
import { logError } from "../storage/errorLogger";
import { pruneAnswerDrafts } from "./answerDraftStore";
import { replayPendingAnswers } from "./pendingAnswerReplay";

export const PENDING_REPLAY_INTERVAL_MS = 30_000;

export function PendingAnswerReplayRunner({
  username,
  enabled = true,
}: {
  /** The REAL signed-in username — never a previewed role's identity. */
  username: string;
  enabled?: boolean;
}): null {
  const { directoryHandle, status } = useWorkspace();

  useEffect(() => {
    pruneAnswerDrafts();
  }, []);

  useEffect(() => {
    if (!enabled || status !== "ready" || !directoryHandle) return;
    let running = false;
    let disposed = false;
    const tick = (): void => {
      if (running || disposed) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      running = true;
      void replayPendingAnswers(directoryHandle, username)
        .catch((error: unknown) => logError("answers:pending-replay", error))
        .finally(() => {
          running = false;
        });
    };
    tick();
    const interval = window.setInterval(tick, PENDING_REPLAY_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [enabled, status, directoryHandle, username]);

  return null;
}
```

- [ ] **Step 6: Mount it and retire the per-view replay tick**

`AuthGate.tsx`: add `import { PendingAnswerReplayRunner } from "../data/answers/PendingAnswerReplayRunner";` next to the `SyncTick` import (line 70) and, directly after `<WorkspaceErrorSink username={session.username} enabled />`, add:

```tsx
        {/* A1: replays answers that never reached the shared folder, on every
            page, for every month and ad-hoc import. Keyed on the REAL user. */}
        <PendingAnswerReplayRunner username={session.username} enabled />
```

`XrayInspectionResults.tsx`: replace the comment + `useEffect` at lines 415-428 with

```tsx
  // The 30 s REPLAY of unsynced answers now runs app-wide
  // (PendingAnswerReplayRunner, mounted in AuthGate). This tick only keeps the
  // "not saved yet" count on this view current.
  useEffect(() => {
    if (canSeeAll || !selectedMonth) return;
    const interval = window.setInterval(() => {
      void countPendingAnswers(selectedMonth, username).then(setPendingSyncCount);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [canSeeAll, selectedMonth, username]);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/data/answers/pendingAnswerReplay.test.ts src/data/answers/PendingAnswerReplayRunner.test.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views src/auth/AuthGate.test.tsx`
Expected: PASS.

- [ ] **Step 8: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 9: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (answers): unsaved answers are replayed app-wide for every month and ad-hoc import, and a successful replay clears the draft"`

- [ ] **Step 10: Commit**

```bash
git add src/data/answers/answerLocalMirror.ts src/data/answers/pendingAnswerReplay.ts src/data/answers/pendingAnswerReplay.test.ts src/data/answers/PendingAnswerReplayRunner.tsx src/data/answers/PendingAnswerReplayRunner.test.tsx src/auth/AuthGate.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (answers): app-level replay of pending answers for every month

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 17: A1 — Draft robustness: canonical draft key and a visible warning when the draft cannot be kept

**Tier:** 2. **XrayReferrals net line delta: −6** (headroom after Task 10: 3 → 9).

**Root cause (verified):** the panel's `draftKey` and `handleSave`'s write folder both come from `folderForRow(xrayImageId)` (`XrayReferrals.tsx:1031-1034`, used at `:508` and `:2169-2173`), which looks the id up in `entriesById` and **falls back to the selected month** when the row is no longer in `entries` — exactly the retained-draft case (`:1126-1151`, a row reassigned away mid-edit). For an ad-hoc row that silently changes the draft key and the save target. `saveAnswerDraft` swallows every `setItem` failure (`answerDraftStore.ts:94-106`), so a browser that cannot keep the draft gives no sign of it. (`pruneAnswerDrafts` at app start is wired by Task 16's runner.)

**Design:** derive the folder from the ROW OBJECT the panel is rendering (`monthFolderForEntry(entry, selMonth)` — an ad-hoc row carries its `adhocImportId`), for both the draft key and the save. `saveAnswerDraft` reports success and keeps a module-level health flag the panel subscribes to (`useSyncExternalStore`), showing a label-keyed warning while drafts cannot be persisted.

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/answerRouting.ts`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx:15, 450-548, 1522-1526, 2169-2176`
- Modify: `src/data/answers/answerDraftStore.ts:88-106` (+ new exports)
- Modify: `src/components/InspectionPanel/index.tsx` (health subscription + warning)
- Modify: `src/data/labels/labelsStore.ts` (after `ip_save_status_failed`)
- Test: `XrayReferrals/answerRouting.test.ts`, `src/data/answers/answerDraftStore.test.ts` (append), `src/components/InspectionPanel/InspectionPanel.test.tsx` (append)

**Interfaces:**
- Produces:
  ```ts
  export function answerFolderForEntry(entry: DistributionEntry, selectedMonth: string): string; // answerRouting.ts
  export function panelDraftKey(entry: DistributionEntry, selectedMonth: string): string;
  export function saveAnswerDraft(key: string, values: AnswerDraftValues): boolean; // was void
  export function subscribeAnswerDraftHealth(listener: () => void): () => void;
  export function isAnswerDraftPersistFailing(): boolean;
  export function __resetAnswerDraftHealthForTests(): void;
  // handleSave(entry: DistributionEntry, ans: FieldAnswer[]): Promise<AnswerSaveOutcome>
  ```
- Label: `ip_msg_draft_not_persisted`.

- [ ] **Step 1: Write the failing tests**

Create `XrayReferrals/answerRouting.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { answerDraftKey } from "../../../../../../data/answers/answerDraftStore";
import { adhocMonthFolder } from "../../../../../../data/adhocImport/adhocImportModel";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { answerFolderForEntry, panelDraftKey } from "./answerRouting";

const base: DistributionEntry = {
  xrayImageId: "IMG-1",
  assignedTo: "emp1",
  status: "pending",
  replacedById: null,
  lastEventAt: "2026-09-28T08:00:00.000Z",
};

describe("answer routing is derived from the row itself (A1)", () => {
  it("routes a real row to the selected month", () => {
    expect(answerFolderForEntry(base, "5-may-2026")).toBe("5-may-2026");
    expect(panelDraftKey(base, "5-may-2026")).toBe(answerDraftKey("5-may-2026", "IMG-1", "emp1"));
  });

  it("routes an ad-hoc row to its own store whatever month is selected", () => {
    const adhoc = { ...base, xrayImageId: "ADHOC-imp-1-XR-9", adhocImportId: "imp-1", adhocFileName: "f.xlsx" } as DistributionEntry;
    expect(answerFolderForEntry(adhoc, "5-may-2026")).toBe(adhocMonthFolder("imp-1"));
    expect(panelDraftKey(adhoc, "6-june-2026")).toBe(answerDraftKey(adhocMonthFolder("imp-1"), "ADHOC-imp-1-XR-9", "emp1"));
  });
});
```

Append to `src/data/answers/answerDraftStore.test.ts` (add `afterEach` and `vi` to its `vitest` import, and `isAnswerDraftPersistFailing, subscribeAnswerDraftHealth, __resetAnswerDraftHealthForTests` to its `./answerDraftStore` import):

```ts
describe("draft persistence health (A1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetAnswerDraftHealthForTests();
  });

  it("reports a refused write, notifies subscribers, and recovers on the next successful write", async () => {
    const listener = vi.fn();
    const stop = subscribeAnswerDraftHealth(listener);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(saveAnswerDraft("xray_answer_draft_v1:m::IMG-1::emp1", { note: "x" })).toBe(false);
    expect(isAnswerDraftPersistFailing()).toBe(true);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
    expect(saveAnswerDraft("xray_answer_draft_v1:m::IMG-1::emp1", { note: "x" })).toBe(true);
    expect(isAnswerDraftPersistFailing()).toBe(false);
    stop();
  });
});
```

Append to `src/components/InspectionPanel/InspectionPanel.test.tsx` (add `vi` to its `vitest` import and `import { __resetAnswerDraftHealthForTests } from "../../data/answers/answerDraftStore";`):

```tsx
describe("InspectionPanel — draft that cannot be kept (A1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetAnswerDraftHealthForTests();
  });

  it("warns that the typed answer will not survive a reload", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const template = makeTemplate([field({ fieldId: "n1", label: "ملاحظة", type: "text" })]);
    const { container } = render(
      <InspectionPanel
        entry={makeEntry()}
        template={template}
        savedAnswer={null}
        readonly={false}
        onClose={() => {}}
        onSave={async () => {}}
        draftKey="xray_answer_draft_v1:m::IMG-001::emp1"
      />
    );

    fireEvent.change(container.querySelector<HTMLInputElement>("#ipf-n1")!, { target: { value: "نص" } });

    expect(await screen.findByText(DEFAULT_LABELS.ip_msg_draft_not_persisted)).toBeInTheDocument();
  });
});
```

(`InspectionPanel.test.tsx` is a jsdom file, so `Storage.prototype` exists there.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/answerRouting.test.ts src/data/answers/answerDraftStore.test.ts src/components/InspectionPanel/InspectionPanel.test.tsx`
Expected: FAIL — `./answerRouting` unresolved; `saveAnswerDraft` returns `undefined`; the warning text is not found.

- [ ] **Step 3: Routing helpers**

Create `XrayReferrals/answerRouting.ts`:

```ts
// A1: where a row's answer (and its local draft) lives, derived from the ROW the
// panel is rendering. The id-lookup it replaces (`folderForRow`) fell back to the
// selected month whenever the row had left the queue — the retained-draft case —
// which moved an ad-hoc row's draft key and save target to the wrong store.
import { monthFolderForEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import { answerDraftKey } from "../../../../../../data/answers/answerDraftStore";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";

export function answerFolderForEntry(entry: DistributionEntry, selectedMonth: string): string {
  return monthFolderForEntry(entry, selectedMonth);
}

export function panelDraftKey(entry: DistributionEntry, selectedMonth: string): string {
  return answerDraftKey(answerFolderForEntry(entry, selectedMonth), entry.xrayImageId, entry.assignedTo);
}
```

- [ ] **Step 4: Draft health in `answerDraftStore.ts`**

Replace `saveAnswerDraft` (lines 88-106, docblock included) with:

```ts
let draftPersistFailing = false;
const draftHealthListeners = new Set<() => void>();

function setDraftPersistFailing(next: boolean): void {
  if (draftPersistFailing === next) return;
  draftPersistFailing = next;
  // Deferred: saveAnswerDraft runs inside a React state updater, and notifying
  // a subscriber synchronously there would update a component mid-render.
  queueMicrotask(() => {
    for (const listener of draftHealthListeners) listener();
  });
}

/** Subscribe to "drafts can / cannot currently be kept in this browser". */
export function subscribeAnswerDraftHealth(listener: () => void): () => void {
  draftHealthListeners.add(listener);
  return () => {
    draftHealthListeners.delete(listener);
  };
}

/** True after the last draft write was refused (and until one succeeds). */
export function isAnswerDraftPersistFailing(): boolean {
  return draftPersistFailing;
}

/** @internal test-only */
export function __resetAnswerDraftHealthForTests(): void {
  draftPersistFailing = false;
}

/**
 * Persist the current values. Never throws — a browser that refuses storage
 * (private mode, a full quota, a cleared `file://` bucket) must not break the
 * form being typed in — but no longer silent either (A1): the result is
 * returned and the health flag above lets the panel warn that the typed answer
 * will not survive a reload.
 */
export function saveAnswerDraft(key: string, values: AnswerDraftValues): boolean {
  const store = readStore();
  if (!store) {
    setDraftPersistFailing(true);
    return false;
  }
  try {
    if (Object.keys(values).length === 0) {
      store.removeItem(key);
    } else {
      store.setItem(key, JSON.stringify({ savedAt: Date.now(), values } satisfies StoredDraft));
    }
    setDraftPersistFailing(false);
    return true;
  } catch {
    setDraftPersistFailing(true);
    return false;
  }
}
```

- [ ] **Step 5: The panel warns**

In `InspectionPanel/index.tsx`: change `import { useMemo, useState } from "react";` to `import { useMemo, useState, useSyncExternalStore } from "react";`; extend the `answerDraftStore` import with `isAnswerDraftPersistFailing, subscribeAnswerDraftHealth`; after the `saveStatus` state (Task 15) add

```ts
  const draftPersistFailing = useSyncExternalStore(subscribeAnswerDraftHealth, isAnswerDraftPersistFailing);
```
and directly before the Task-15 `{saveStatus && (` block insert

```tsx
      {draftKey && draftPersistFailing && !readonly && (
        <p className="ip-validation-msg" role="alert">{getLabels().ip_msg_draft_not_persisted}</p>
      )}
```

Label in `labelsStore.ts`, after `ip_save_status_failed`:

```ts
  ip_msg_draft_not_persisted:    "تعذّر حفظ مسودة الإجابة في هذا المتصفح — لن تبقى الإجابة بعد إعادة تحميل الصفحة. قدّم الإجابة قبل مغادرة الصفحة.",
```

- [ ] **Step 6: Route the save and the draft from the row (net −6 in the component)**

In `XrayReferrals.tsx`:
- line 15: `import { clearAnswerDraft } from "../../../../../data/answers/answerDraftStore";` (drop `answerDraftKey` — no other use remains after this step); add `import { answerFolderForEntry, panelDraftKey } from "./XrayReferrals/answerRouting";`.
- `createSaveAnswerHandler`: delete the `folderForRow: (xrayImageId: string) => string;` dep and `folderForRow` from its destructuring; change the returned function's parameters to `(entry: DistributionEntry, ans: FieldAnswer[])` and add as its first two lines:
  ```ts
    const xrayImageId = entry.xrayImageId;
    const forUser = entry.assignedTo;
  ```
  replace `const folder = folderForRow(xrayImageId);` with `const folder = answerFolderForEntry(entry, selMonth);` and `clearAnswerDraft(answerDraftKey(folder, xrayImageId, forUser));` with `clearAnswerDraft(panelDraftKey(entry, selMonth));`.
- the `createSaveAnswerHandler({` call: remove `folderForRow, ` from `directoryHandle, folderForRow, username, role, activeTpl, selMonth,`.
- replace the five-line `draftKey={answerDraftKey( … )}` prop with `draftKey={panelDraftKey(panelEntry, selMonth)}`, and the three-line `onSave={(ans) => handleSave(panelEntry.xrayImageId, ans, panelEntry.assignedTo) }` prop with `onSave={(ans) => handleSave(panelEntry, ans)}`.

(`folderForRow` itself stays: the reopen/replacement/reassign handlers still use it.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views src/data/answers/answerDraftStore.test.ts src/components/InspectionPanel`
Expected: PASS (including `XrayReferrals.adhocWriteRouting.test.tsx` and `XrayReferrals.draftRetention.test.tsx`).

- [ ] **Step 8: Gates + complexity**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`
Expected: all green; `XrayReferrals` at 1441.

- [ ] **Step 9: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (referrals): an answer's draft key and save target come from the row itself, and a draft the browser cannot keep is flagged"`

- [ ] **Step 10: Commit**

```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/answerRouting.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/answerRouting.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/data/answers/answerDraftStore.ts src/data/answers/answerDraftStore.test.ts src/components/InspectionPanel src/data/labels/labelsStore.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (referrals): canonical draft key and visible draft-persistence failure

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 18: A1 — Reopen the sample the employee was on after a reload

**Tier:** 2. **XrayReferrals net line delta: +1**.

**Root cause (verified):** after a reload the auto-select effect opens `displayEntries[0]` (`XrayReferrals.tsx:1153-1165`), not the sample the user was working on, so their restored draft (keyed on that sample) is not what they see and reads as "lost".

**Files:**
- Create: `src/data/answers/lastOpenSampleStore.ts`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx:1153-1165`
- Modify: `src/data/storage/storageRegistry.ts` (session entry after `xray_global_month_v1`)
- Test: `src/data/answers/lastOpenSampleStore.test.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.lastOpenSample.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const LAST_OPEN_SAMPLE_KEY_PREFIX = "xray_last_open_sample_v1:";
  export function rememberLastOpenSample(username: string, monthFolderName: string, xrayImageId: string): void;
  export function readLastOpenSample(username: string, monthFolderName: string): string | null;
  export function pickAutoSelectId(displayEntries: readonly { xrayImageId: string }[], remembered: string | null): string | null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/data/answers/lastOpenSampleStore.test.ts`:

```ts
/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";

import { pickAutoSelectId, readLastOpenSample, rememberLastOpenSample } from "./lastOpenSampleStore";

beforeEach(() => {
  sessionStorage.clear();
});

describe("last-open sample (A1)", () => {
  it("remembers per user and month", () => {
    rememberLastOpenSample("emp1", "5-may-2026", "IMG-3");
    expect(readLastOpenSample("emp1", "5-may-2026")).toBe("IMG-3");
    expect(readLastOpenSample("emp1", "6-june-2026")).toBeNull();
    expect(readLastOpenSample("emp2", "5-may-2026")).toBeNull();
  });

  it("prefers the remembered sample only while it is in the list", () => {
    const rows = [{ xrayImageId: "IMG-1" }, { xrayImageId: "IMG-3" }];
    expect(pickAutoSelectId(rows, "IMG-3")).toBe("IMG-3");
    expect(pickAutoSelectId(rows, "IMG-9")).toBe("IMG-1");
    expect(pickAutoSelectId(rows, null)).toBe("IMG-1");
    expect(pickAutoSelectId([], "IMG-3")).toBeNull();
  });
});
```

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.lastOpenSample.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { cleanup, render, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import { createEmptyUserManagementState, writeUserManagementState } from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import { makePopulationRow, makeSampleMaster } from "../../../../../data/population/populationTestFixtures";
import { rememberLastOpenSample } from "../../../../../data/answers/lastOpenSampleStore";
import XrayReferrals from "./XrayReferrals";

const MONTH = "5-may-2026";
const IDS = ["IMG-001", "IMG-002", "IMG-003"];

vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: MONTH }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: MONTH },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

async function seed(root: DirectoryHandleLike): Promise<void> {
  const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster(IDS.map((id) => makePopulationRow(id))));
  if (!sampled.ok) throw new Error(sampled.error);
  const assigned = await appendDistributionEvents(
    root,
    MONTH,
    IDS.map((id) => buildAssignEvent({ xrayImageId: id, assignedTo: "emp-a", eventBy: "admin" }))
  );
  if (!assigned.ok) throw new Error(assigned.error);
  const template = {
    templateId: "tmpl-last-open",
    templateName: "قالب الاختبار",
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: "admin",
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
    fields: [{ fieldId: "note", label: "ملاحظة", type: "text" as const, required: false, options: [] }],
  };
  const savedTpl = await saveTemplate(root, template);
  if (!savedTpl.ok) throw new Error(savedTpl.error);
  const selected = await saveInspectionTemplateSelection(root, {
    templateId: template.templateId,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  });
  if (!selected.ok) throw new Error(selected.error);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

describe("XrayReferrals — reopens the last sample after a reload (A1)", () => {
  it("opens the remembered sample instead of the first row", async () => {
    writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    const root = createMemoryDirectory("root");
    await seed(root);
    rememberLastOpenSample("emp-a", MONTH, "IMG-003");

    render(<XrayReferrals directoryHandle={root} />);

    await waitFor(() => expect(document.querySelector(".ip-xray-id")?.textContent).toBe("IMG-003"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/answers/lastOpenSampleStore.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.lastOpenSample.test.tsx`
Expected: FAIL — `./lastOpenSampleStore` unresolved (and, once it exists, the view opens `IMG-001`).

- [ ] **Step 3: The store**

Create `src/data/answers/lastOpenSampleStore.ts`:

```ts
/**
 * A1: which sample the employee last had open, per (user, month), for THIS tab
 * (sessionStorage — survives a reload, not a new tab). After a reload the queue
 * reopens it, so the draft restored for that sample is the one on screen.
 * Registered in storageRegistry.ts. Every access is guarded: storage that
 * throws or is absent degrades to "open the first row", the old behaviour.
 */
export const LAST_OPEN_SAMPLE_KEY_PREFIX = "xray_last_open_sample_v1:";

type Stored = { month: string; xrayImageId: string };

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function rememberLastOpenSample(username: string, monthFolderName: string, xrayImageId: string): void {
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(
      `${LAST_OPEN_SAMPLE_KEY_PREFIX}${username}`,
      JSON.stringify({ month: monthFolderName, xrayImageId } satisfies Stored)
    );
  } catch {
    // Convenience only.
  }
}

export function readLastOpenSample(username: string, monthFolderName: string): string | null {
  const store = sessionStore();
  if (!store) return null;
  try {
    const raw = store.getItem(`${LAST_OPEN_SAMPLE_KEY_PREFIX}${username}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return parsed.month === monthFolderName && typeof parsed.xrayImageId === "string" ? parsed.xrayImageId : null;
  } catch {
    return null;
  }
}

/** The remembered sample while it is still in the list, else the first row. */
export function pickAutoSelectId(
  displayEntries: readonly { xrayImageId: string }[],
  remembered: string | null
): string | null {
  if (remembered && displayEntries.some((entry) => entry.xrayImageId === remembered)) return remembered;
  return displayEntries[0]?.xrayImageId ?? null;
}
```

Register it in `storageRegistry.ts`, after the `xray_global_month_v1` entry:

```ts
  {
    id: "xray_last_open_sample_v1:",
    layer: "session",
    prefix: true,
    purpose: "The sample each user last had open on «صور الأشعة المحالة», for this tab, so a reload reopens it.",
    lossConsequence: "After a reload the queue opens its first sample instead. No data at risk.",
  },
```

- [ ] **Step 4: Use it in the auto-select effect (net +1)**

In `XrayReferrals.tsx`: import `{ pickAutoSelectId, readLastOpenSample, rememberLastOpenSample }` from `"../../../../../data/answers/lastOpenSampleStore"`. In the auto-select effect replace

```ts
    setSelEntryId(displayEntries[0].xrayImageId);
  }, [displayEntries, selEntryId, dirtyEntryId]);
```
with

```ts
    setSelEntryId(pickAutoSelectId(displayEntries, readLastOpenSample(username, selMonth)));
  }, [displayEntries, selEntryId, dirtyEntryId, username, selMonth]);
  useEffect(() => { if (selEntryId) rememberLastOpenSample(username, selMonth, selEntryId); }, [username, selMonth, selEntryId]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/answers/lastOpenSampleStore.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views src/data/storage/storageKeyCoverage.test.ts`
Expected: PASS.

- [ ] **Step 6: Gates + complexity**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`
Expected: all green; `XrayReferrals` at 1442.

- [ ] **Step 7: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (referrals): a reload reopens the sample the employee was working on"`

- [ ] **Step 8: Commit**

```bash
git add src/data/answers/lastOpenSampleStore.ts src/data/answers/lastOpenSampleStore.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.lastOpenSample.test.tsx src/data/storage/storageRegistry.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (referrals): reopen the last sample after a reload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 19: A3 — Snapshot the current bulk-assignment outputs (before any change)

**Tier:** 1 (test-only).

`calculateBulkAssignment` is deterministic by contract (event ids and timestamps aside). This task pins today's outputs so Tasks 20-22 can prove the **no-restriction** path is byte-identical and review every **port-restricted** change deliberately.

**Files:**
- Create: `src/data/distribution/bulkAssignment.snapshot.test.ts` (+ its generated `__snapshots__/bulkAssignment.snapshot.test.ts.snap`)

**Interfaces:** consumes `calculateBulkAssignment(params)`; no production code changes.

- [ ] **Step 1: Write the snapshot test**

Create `src/data/distribution/bulkAssignment.snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeePortRestriction, EmployeeStageAllocation } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { PasswordHashRecord } from "../../auth/passwordCrypto";
import type { DistributionEntry } from "./distributionTypes";
import { makePopulationRow } from "../population/populationTestFixtures";
import { calculateBulkAssignment, type BulkAssignmentResult } from "./bulkAssignment";

// Titles carry a "[no-restriction]" or "[port-restricted]" tag so a later task
// can update ONLY the restricted snapshots with `-t "port-restricted" -u`.

function user(username: string, licensed = false): ManagedLoginUser {
  return {
    id: username,
    username,
    displayName: username,
    role: "employee",
    passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
    isActive: true,
    hasCertScanLicense: licensed,
    createdAt: "",
    updatedAt: "",
  };
}

function row(id: string, stage: string, port: string, cert: "Certscan" | "NonCertscan" = "NonCertscan"): PreparedPopulationRow {
  return { ...makePopulationRow(id, port), stage, certScanStatus: cert };
}

function rows(prefix: string, count: number, stage: string, port: string): PreparedPopulationRow[] {
  return Array.from({ length: count }, (_, i) => row(`${prefix}-${String(i).padStart(4, "0")}`, stage, port));
}

function alloc(username: string, stageKey: EmployeeStageAllocation["stageKey"], value: number, method: EmployeeStageAllocation["method"] = "percentage"): EmployeeStageAllocation {
  return { username, stageKey, method, value, isActive: true };
}

/** Everything deterministic about a result (event ids / timestamps excluded). */
function fullProjection(result: BulkAssignmentResult) {
  return {
    events: result.events.map((e) => [e.xrayImageId, e.assignedTo, e.notes ?? null, e.dailyQuota ?? null]),
    errors: result.errors,
    skipped: result.skipped,
    unmapped: result.unmapped,
  };
}

/** Per-employee, per-port totals — for large fixtures. */
function totalsProjection(result: BulkAssignmentResult, source: PreparedPopulationRow[]) {
  const portById = new Map(source.map((r) => [r.xrayImageId, r.portName ?? ""]));
  const totals: Record<string, Record<string, number>> = {};
  for (const e of result.events) {
    const port = portById.get(e.xrayImageId) ?? "";
    totals[e.assignedTo] ??= {};
    totals[e.assignedTo]![port] = (totals[e.assignedTo]![port] ?? 0) + 1;
  }
  return { totals, errors: result.errors, skipped: result.skipped, eventCount: result.events.length };
}

const EMPLOYEES = ["a", "b", "c", "d"].map((name) => user(name, name === "a"));

describe("calculateBulkAssignment snapshots", () => {
  it("[no-restriction] two stages with CertScan rows", () => {
    const source = [
      row("c1", "FIRST_STAGE", "P1", "Certscan"),
      row("c2", "FIRST_STAGE", "P1", "Certscan"),
      ...rows("f", 8, "FIRST_STAGE", "P1"),
      ...rows("s", 9, "SECOND_STAGE", "P2"),
    ];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: [alloc("a", "first", 50), alloc("b", "first", 50), alloc("b", "second", 40), alloc("c", "second", 60)],
      employees: EMPLOYEES,
      operatorUsername: "op",
    });
    expect(fullProjection(result)).toMatchSnapshot();
  });

  it("[no-restriction] re-run skips owned rows", () => {
    const source = rows("r", 6, "SECOND_STAGE", "P1");
    const owned: DistributionEntry[] = ["r-0000", "r-0001"].map((id) => ({
      xrayImageId: id,
      assignedTo: "b",
      status: "pending",
      replacedById: null,
      lastEventAt: "",
    }));
    const result = calculateBulkAssignment({
      rows: source,
      allocations: [alloc("b", "second", 50), alloc("c", "second", 50)],
      employees: EMPLOYEES,
      operatorUsername: "op",
      existingEntries: owned,
    });
    expect(fullProjection(result)).toMatchSnapshot();
  });

  it("[no-restriction] exact-count allocations", () => {
    const source = rows("x", 7, "THIRD_STAGE", "P1");
    const result = calculateBulkAssignment({
      rows: source,
      allocations: [alloc("b", "third", 5, "exact"), alloc("c", "third", 2, "exact")],
      employees: EMPLOYEES,
      operatorUsername: "op",
    });
    expect(fullProjection(result)).toMatchSnapshot();
  });

  it("[port-restricted] four ports, one employee restricted", () => {
    const source = [
      ...rows("huge", 400, "SECOND_STAGE", "port-huge"),
      ...rows("big", 300, "SECOND_STAGE", "port-big"),
      ...rows("medium", 200, "SECOND_STAGE", "port-medium"),
      ...rows("small", 100, "SECOND_STAGE", "port-small"),
    ];
    const portRestrictions: EmployeePortRestriction[] = [
      { username: "d", restricted: true, enabledPorts: ["port-big", "port-medium", "port-small"] },
    ];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: ["a", "b", "c", "d"].map((u) => alloc(u, "second", 25)),
      employees: EMPLOYEES,
      operatorUsername: "op",
      portRestrictions,
    });
    expect(totalsProjection(result, source)).toMatchSnapshot();
  });

  it("[port-restricted] trapped employee", () => {
    const source = [...rows("big", 900, "SECOND_STAGE", "port-big"), ...rows("small", 100, "SECOND_STAGE", "port-small")];
    const portRestrictions: EmployeePortRestriction[] = [
      { username: "b", restricted: true, enabledPorts: ["port-big"] },
      { username: "c", restricted: true, enabledPorts: ["port-big"] },
      { username: "d", restricted: true, enabledPorts: ["port-small"] },
    ];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: ["a", "b", "c", "d"].map((u) => alloc(u, "second", 25)),
      employees: EMPLOYEES,
      operatorUsername: "op",
      portRestrictions,
    });
    expect(totalsProjection(result, source)).toMatchSnapshot();
  });

  it("[port-restricted] cross-stage shortfall", () => {
    const source = [
      ...rows("s1a", 360, "FIRST_STAGE", "port-A"),
      ...rows("s1b", 40, "FIRST_STAGE", "port-B"),
      ...rows("s2b", 400, "SECOND_STAGE", "port-B"),
    ];
    const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-B"] }];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: ["a", "b", "c", "d"].flatMap((u) => [alloc(u, "first", 25), alloc(u, "second", 25)]),
      employees: EMPLOYEES,
      operatorUsername: "op",
      portRestrictions,
    });
    expect(totalsProjection(result, source)).toMatchSnapshot();
  });
});
```

(`makePopulationRow` is the Task-3 fixture; no `month`/`year` is passed, so no event carries a time-dependent `dailyQuota`.)

- [ ] **Step 2: Record the snapshots**

Run: `npx vitest run src/data/distribution/bulkAssignment.snapshot.test.ts`
Expected: PASS, "6 snapshots written". Open the `.snap` file and confirm the `[port-restricted] cross-stage shortfall` entry shows `a`, `b`, `c` at 220 and `d` at 140 (the defect Task 20 fixes).

- [ ] **Step 3: Tier-1 gates**

Run: `npm run lint && npm run typecheck`
Expected: green.

- [ ] **Step 4: Edit-log entry**

Run: `npm run editlog -- --tier=1 --append --sync-package "Chore (distribution): snapshot bulk-assignment outputs before the A3 equal-totals change"`
(1–2 sentences, no `Why:`.)

- [ ] **Step 5: Commit**

```bash
git add src/data/distribution/bulkAssignment.snapshot.test.ts src/data/distribution/__snapshots__/bulkAssignment.snapshot.test.ts.snap "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Chore (distribution): snapshot bulk-assignment outputs before A3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 20: A3 — Month-level targets with cross-stage carry-over (port-restricted mode only)

**Tier:** 2. Deterministic builder — snapshots from Task 19 are the reference.

**Root cause (verified):** with a restriction active, `calculateBulkAssignment` computes each employee's target **per stage** (`bulkAssignment.ts:383-388`). When a restricted employee's allowed rows in a stage are fewer than their share, the surplus goes to others and nothing compensates in other stages (Task 19's cross-stage fixture: 220/220/220/140 instead of 200 each). CertScan branches can also override the exact per-port values (`:161-177`, `:203-214`), so the last port can break totals.

**Design (owner decision: make-up comes from other stages):** per-stage targets are summed into a month target per employee. After the stage pass, a deterministic rebalance moves individual NEW events from employees above their month target to employees below it, only where the receiver has an active allocation in that row's stage, is port-eligible, and (for a CertScan row) is licensed; events carrying daily-quota metadata never move. Walking events from the last generated backwards makes the make-up come from the latest stage the receiver can work. Runs with no restriction never enter this code (asserted by the Task-19 snapshots).

**Files:**
- Modify: `src/data/distribution/bulkAssignment.ts:83-92 (types), 320-330 (setup), 383-388 (stage targets), 484-487 (rebalance + return)`
- Test: `src/data/distribution/bulkAssignment.test.ts` (append), snapshot file (restricted entries only)

**Interfaces:**
- Produces (module-private): `function rebalanceTowardMonthTargets(params: { events: DistributionEvent[]; targets: ReadonlyMap<string, number>; owned: ReadonlyMap<string, number>; canTake: (username: string, xrayImageId: string) => boolean }): DistributionEvent[]`.
- `calculateBulkAssignment` signature unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/data/distribution/bulkAssignment.test.ts`:

```ts
test("A3: an employee short in one stage because of a port restriction is made up in another stage", () => {
  const rowsFor = (prefix: string, count: number, stage: string, port: string) =>
    Array.from({ length: count }, (_, i) => makeRow(`${prefix}-${i}`, stage, "NonCertscan", port));
  const rows: PreparedPopulationRow[] = [
    ...rowsFor("s1a", 360, "FIRST_STAGE", "port-A"),
    ...rowsFor("s1b", 40, "FIRST_STAGE", "port-B"),
    ...rowsFor("s2b", 400, "SECOND_STAGE", "port-B"),
  ];
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].flatMap((username) => [
    { username, stageKey: "first", method: "percentage", value: 25, isActive: true },
    { username, stageKey: "second", method: "percentage", value: 25, isActive: true },
  ]);
  const employees = ["a", "b", "c", "d"].map((username) => makeUser(username, "employee"));
  const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-B"] }];

  const result = calculateBulkAssignment({ rows, allocations, employees, operatorUsername: "test", portRestrictions });

  expect(result.errors).toHaveLength(0);
  expect(result.events).toHaveLength(800);
  const totals = new Map<string, number>();
  for (const e of result.events) totals.set(e.assignedTo, (totals.get(e.assignedTo) ?? 0) + 1);
  for (const username of ["a", "b", "c", "d"]) {
    expect(Math.abs((totals.get(username) ?? 0) - 200)).toBeLessThanOrEqual(1);
  }
  // "d" never receives a port-A row.
  expect(result.events.filter((e) => e.assignedTo === "d" && e.xrayImageId.startsWith("s1a-"))).toHaveLength(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/distribution/bulkAssignment.test.ts -t "A3: an employee short"`
Expected: FAIL — `expected 20 to be less than or equal to 1` (totals 220/220/220/140).

- [ ] **Step 3: Implement month targets + rebalance**

In `bulkAssignment.ts`:

3a. After `function allocWeight(…) { … }` (line 92) add:

```ts
/**
 * A3 (owner decision 2026-09-28): move NEW events from employees above their
 * month target to employees below it, where the receiver may take the row.
 * Deterministic: receivers by largest shortfall then username; events from the
 * last generated backwards, so the make-up comes from the latest stage the
 * receiver can work and earlier stages keep what the stage pass gave them.
 * Events carrying the donor's daily-quota stamp never move.
 */
function rebalanceTowardMonthTargets(params: {
  events: DistributionEvent[];
  targets: ReadonlyMap<string, number>;
  owned: ReadonlyMap<string, number>;
  canTake: (username: string, xrayImageId: string) => boolean;
}): DistributionEvent[] {
  const events = [...params.events];
  const totals = new Map<string, number>(params.owned);
  for (const event of events) totals.set(event.assignedTo, (totals.get(event.assignedTo) ?? 0) + 1);
  const shortfall = (username: string): number => (params.targets.get(username) ?? 0) - (totals.get(username) ?? 0);
  const receivers = [...params.targets.keys()]
    .filter((username) => shortfall(username) > 0)
    .sort((a, b) => shortfall(b) - shortfall(a) || a.localeCompare(b));
  for (const receiver of receivers) {
    for (let index = events.length - 1; index >= 0 && shortfall(receiver) > 0; index -= 1) {
      const event = events[index]!;
      const donor = event.assignedTo;
      if (donor === receiver || shortfall(donor) >= 0) continue;
      if (event.dailyQuota !== undefined || event.daysRemainingAtAssignment !== undefined) continue;
      if (!params.canTake(receiver, event.xrayImageId)) continue;
      events[index] = { ...event, assignedTo: receiver };
      totals.set(donor, (totals.get(donor) ?? 0) - 1);
      totals.set(receiver, (totals.get(receiver) ?? 0) + 1);
    }
  }
  return events;
}
```

3b. After `const anyPortRestricted = hasAnyPortRestriction(portRestrictions);` add:

```ts
  // A3: month target per employee (sum of their per-stage targets) and who is
  // allocated in each stage — filled by the restricted branch below only.
  const monthTargets = new Map<string, number>();
  const stageUsernames = new Map<string, Set<string>>();
```

3c. In the restricted branch, replace

```ts
    const remainingNeed = new Map(
      hamiltonApportionment(
        stageAllocs.map((a) => ({ key: a.username, size: allocWeight(a) })),
        stageRows.length
      ).map((q) => [q.key, q.allocated])
    );
```
with

```ts
    const stageTarget = new Map(
      hamiltonApportionment(
        stageAllocs.map((a) => ({ key: a.username, size: allocWeight(a) })),
        stageRows.length
      ).map((q) => [q.key, q.allocated])
    );
    for (const [username, target] of stageTarget) {
      monthTargets.set(username, (monthTargets.get(username) ?? 0) + target);
    }
    stageUsernames.set(stageKey, new Set(stageAllocs.map((a) => a.username)));
    const remainingNeed = new Map(stageTarget);
```

(The existing big comment above it stays; append one line to it: "A3: these per-stage targets are also summed into `monthTargets` for the cross-stage rebalance after the loop.")

3d. Replace the final `return { events, errors, skipped, unmapped };` with:

```ts
  if (!anyPortRestricted) return { events, errors, skipped, unmapped };

  const rowById = new Map(assignableRows.map((r) => [r.xrayImageId, r]));
  const licensed = new Set(assignableEmployees.filter((e) => e.hasCertScanLicense).map((e) => e.username));
  const canTake = (username: string, xrayImageId: string): boolean => {
    const target = rowById.get(xrayImageId);
    if (!target) return false;
    if (!stageUsernames.get(getStageKey(target.stage, stageMappings))?.has(username)) return false;
    if (!isPortEligible(username, normalizePortName(target.portName), portRestrictions)) return false;
    return target.certScanStatus !== "Certscan" || licensed.has(username);
  };
  const balanced = rebalanceTowardMonthTargets({ events, targets: monthTargets, owned: new Map(), canTake });
  return { events: balanced, errors, skipped, unmapped };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/data/distribution/bulkAssignment.test.ts`
Expected: PASS (all existing tests too: the trapped employee cannot take any other row, so nothing moves there; the 4-port and unequal-percentage cases stay within their asserted bounds).

Run: `npx vitest run src/data/distribution/bulkAssignment.snapshot.test.ts`
Expected: every `[no-restriction]` snapshot PASSES unchanged; `[port-restricted] cross-stage shortfall` FAILS (now 200 each) and `[port-restricted] four ports, one employee restricted` may fail (totals tightened toward 250). `[port-restricted] trapped employee` must PASS unchanged.

- [ ] **Step 5: Update ONLY the restricted snapshots, then review them**

Run: `npx vitest run src/data/distribution/bulkAssignment.snapshot.test.ts -t "port-restricted" -u`
Then run `git diff src/data/distribution/__snapshots__/bulkAssignment.snapshot.test.ts.snap` and confirm: no `[no-restriction]` entry changed; the cross-stage entry now reads 200 for each of `a`,`b`,`c`,`d`; any change in the four-port entry only moves totals closer to 250. Re-run `npx vitest run src/data/distribution/bulkAssignment.snapshot.test.ts` → PASS.

- [ ] **Step 6: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`
Expected: all green (`PhaseFourDistribution.evenSplit.test.tsx` and `.portRestrictions.test.tsx` included).

- [ ] **Step 7: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (distribution): with port restrictions, a stage shortfall is made up in the employee's other stages so monthly totals stay equal"`
Prose: Why, What changed, Before/After of the `remainingNeed` block and the return, and the snapshot diff summary (which restricted fixtures moved, and that no unrestricted fixture did).

- [ ] **Step 8: Commit**

```bash
git add src/data/distribution/bulkAssignment.ts src/data/distribution/bulkAssignment.test.ts src/data/distribution/__snapshots__/bulkAssignment.snapshot.test.ts.snap "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (distribution): month-level targets with cross-stage carry-over

Only port-restricted runs change; unrestricted outputs are byte-identical
to the pre-change snapshots.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 21: A3 — Rows an employee already owns count toward their target

**Tier:** 2.

**Root cause (verified):** re-runs ignore rows already owned (`bulkAssignment.ts:296-301` removes them from the pool, and the per-stage Hamilton is over the unassigned rows only), so each re-run splits the remainder as if nobody owned anything and totals drift apart.

**Design (restricted mode only, like Task 20):** per stage, the target is apportioned over `unassigned + owned-in-stage` rows; each employee's remaining need is `max(0, target − owned-in-stage)`; month targets include owned rows, and the rebalance receives the owned totals. Owned = `existingEntries` whose status is not `replaced`, located in a stage through the full `rows` list.

**Files:**
- Modify: `src/data/distribution/bulkAssignment.ts` (restricted-branch stage target; rebalance `owned` argument)
- Test: `src/data/distribution/bulkAssignment.test.ts` (append)

**Interfaces:** unchanged.

- [ ] **Step 1: Write the failing test**

Append to `bulkAssignment.test.ts`:

```ts
test("A3: a re-run with prior ownership balances the unassigned rows toward equal totals", () => {
  const rows: PreparedPopulationRow[] = Array.from({ length: 400 }, (_, i) =>
    makeRow(`r-${i}`, "SECOND_STAGE", "NonCertscan", "port-P")
  );
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].map((username) => ({
    username,
    stageKey: "second",
    method: "percentage",
    value: 25,
    isActive: true,
  }));
  const employees = ["a", "b", "c", "d"].map((username) => makeUser(username, "employee"));
  // A restriction that excludes nothing still switches on restricted mode.
  const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-P"] }];
  const existingEntries: DistributionEntry[] = rows.slice(0, 100).map((r) => ({
    xrayImageId: r.xrayImageId,
    assignedTo: "a",
    status: "pending",
    replacedById: null,
    lastEventAt: "",
  }));

  const result = calculateBulkAssignment({ rows, allocations, employees, operatorUsername: "test", portRestrictions, existingEntries });

  expect(result.skipped).toBe(100);
  const fresh = new Map<string, number>();
  for (const e of result.events) fresh.set(e.assignedTo, (fresh.get(e.assignedTo) ?? 0) + 1);
  expect(fresh.get("a") ?? 0).toBe(0);
  for (const username of ["b", "c", "d"]) expect(fresh.get(username)).toBe(100);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/distribution/bulkAssignment.test.ts -t "prior ownership"`
Expected: FAIL — `expected 75 to be +0` (a receives 75 new rows).

- [ ] **Step 3: Count ownership in restricted mode**

3a. After the Task-20 declarations (`monthTargets`, `stageUsernames`) add:

```ts
  // A3: live rows each employee already owns, per stage — restricted mode only,
  // so an unrestricted run stays byte-identical.
  const ownedByStage = new Map<string, Map<string, number>>();
  const ownedTotals = new Map<string, number>();
  if (anyPortRestricted && existingEntries && existingEntries.length > 0) {
    const stageOfRow = new Map(rows.map((r) => [r.xrayImageId, getStageKey(r.stage, stageMappings)]));
    for (const entry of existingEntries) {
      if (entry.status === "replaced") continue;
      const stage = stageOfRow.get(entry.xrayImageId);
      if (!stage || stage === "unknown") continue;
      const perStage = ownedByStage.get(stage) ?? new Map<string, number>();
      perStage.set(entry.assignedTo, (perStage.get(entry.assignedTo) ?? 0) + 1);
      ownedByStage.set(stage, perStage);
      ownedTotals.set(entry.assignedTo, (ownedTotals.get(entry.assignedTo) ?? 0) + 1);
    }
  }
```

3b. In the restricted branch, change the Task-20 `stageTarget` block to apportion over owned + unassigned and derive `remainingNeed` from it:

```ts
    const ownedInStage = ownedByStage.get(stageKey) ?? new Map<string, number>();
    const ownedInStageCount = [...ownedInStage.values()].reduce((sum, n) => sum + n, 0);
    const stageTarget = new Map(
      hamiltonApportionment(
        stageAllocs.map((a) => ({ key: a.username, size: allocWeight(a) })),
        stageRows.length + ownedInStageCount
      ).map((q) => [q.key, q.allocated])
    );
    for (const [username, target] of stageTarget) {
      monthTargets.set(username, (monthTargets.get(username) ?? 0) + target);
    }
    stageUsernames.set(stageKey, new Set(stageAllocs.map((a) => a.username)));
    const remainingNeed = new Map(
      [...stageTarget].map(([username, target]) => [username, Math.max(0, target - (ownedInStage.get(username) ?? 0))])
    );
```

3c. In the final rebalance call, change `owned: new Map()` to `owned: ownedTotals`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/distribution/bulkAssignment.test.ts src/data/distribution/bulkAssignment.snapshot.test.ts`
Expected: PASS, with **no** snapshot change (no snapshot fixture combines a restriction with ownership). If any snapshot changes, STOP and report.

- [ ] **Step 5: Gates**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`
Expected: all green. (`check:complexity` caps a function's cyclomatic complexity at 60 — if `calculateBulkAssignment` crosses it, move the 3a block into a module-level `collectOwnedRowsByStage(rows, existingEntries, stageMappings)` returning `{ ownedByStage, ownedTotals }` and call it when `anyPortRestricted`.)

- [ ] **Step 6: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (distribution): rows an employee already owns count toward their target on a restricted re-run"`

- [ ] **Step 7: Commit**

```bash
git add src/data/distribution/bulkAssignment.ts src/data/distribution/bulkAssignment.test.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (distribution): existing ownership counts toward restricted targets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 22: A3 — Warn when an employee cannot reach their target

**Tier:** 2.

**Design:** with a restriction active, an employee whose **allowed** rows (owned + unassigned rows whose stage they are allocated in, whose port they may work, and — for CertScan — they are licensed for) are fewer than their month target cannot be made equal; this is the only case totals stay unequal. `calculateBulkAssignment` reports these in `targetShortfalls`; the Phase-4 preview and the run message show a label-keyed warning.

**Files:**
- Modify: `src/data/distribution/bulkAssignment.ts:73-78 (result type), final return`
- Modify: `src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx:268-306 (preview), 464-493 (run), 629-633 (render)`
- Modify: `src/data/labels/labels.phaseThreeFour.ts` (after `p4_bulk_unmapped_warning_stages`, line 136)
- Test: `src/data/distribution/bulkAssignment.test.ts` (append), `src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.portRestrictions.test.tsx` (append)

**Interfaces:**
- Produces:
  ```ts
  export type EmployeeTargetShortfall = { username: string; target: number; allowed: number };
  // BulkAssignmentResult gains: targetShortfalls: EmployeeTargetShortfall[]  ([] when no restriction is active)
  ```
- Labels: `p4_bulk_target_shortfall_warning` (`{names}`), `p4_bulk_target_shortfall_item` (`{name}`, `{allowed}`, `{target}`).

- [ ] **Step 1: Write the failing tests**

Append to `bulkAssignment.test.ts`:

```ts
test("A3: reports an employee whose allowed rows cannot reach their target", () => {
  const rows: PreparedPopulationRow[] = [
    ...Array.from({ length: 900 }, (_, i) => makeRow(`big-${i}`, "SECOND_STAGE", "NonCertscan", "port-big")),
    ...Array.from({ length: 100 }, (_, i) => makeRow(`small-${i}`, "SECOND_STAGE", "NonCertscan", "port-small")),
  ];
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].map((username) => ({
    username,
    stageKey: "second",
    method: "percentage",
    value: 25,
    isActive: true,
  }));
  const employees = ["a", "b", "c", "d"].map((username) => makeUser(username, "employee"));
  const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-small"] }];

  const result = calculateBulkAssignment({ rows, allocations, employees, operatorUsername: "test", portRestrictions });

  expect(result.targetShortfalls).toEqual([{ username: "d", target: 250, allowed: 100 }]);
});

test("A3: no shortfall report without port restrictions", () => {
  const rows = [makeRow("img-1", "SECOND_STAGE", "NonCertscan")];
  const result = calculateBulkAssignment({
    rows,
    allocations: [{ username: "emp", stageKey: "second", method: "percentage", value: 100, isActive: true }],
    employees: [makeUser("emp", "employee")],
    operatorUsername: "test",
  });
  expect(result.targetShortfalls).toEqual([]);
});
```

Append to `PhaseFourDistribution.portRestrictions.test.tsx` (inside its `describe`; add `import { DEFAULT_LABELS } from "../../../../../data/labels/labelsStore";` at the top):

```tsx
  it("warns in the preview when a restricted expert cannot reach their share", () => {
    const config: PopulationConfig = {
      ...DEFAULT_POPULATION_CONFIG,
      // A port with no sample rows at all: employee.one can take nothing.
      employeePortRestrictions: [{ username: "employee.one", restricted: true, enabledPorts: ["ميناء ينبع"] }],
    };
    render(<PhaseFourDistribution {...baseProps({ config })} />);

    const expected = DEFAULT_LABELS.p4_bulk_target_shortfall_item
      .replace("{name}", "الموظف الأول")
      .replace("{allowed}", "0")
      .replace("{target}", "1");
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes(expected))).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/distribution/bulkAssignment.test.ts -t "A3: reports" src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.portRestrictions.test.tsx`
Expected: FAIL — `targetShortfalls` is `undefined`; no alert contains the shortfall text.

- [ ] **Step 3: Report shortfalls**

In `bulkAssignment.ts`:
- after the `UnmappedStageReport` type add:
  ```ts
  /** A3: an employee who cannot reach their month target — the only case totals stay unequal. */
  export type EmployeeTargetShortfall = { username: string; target: number; allowed: number };
  ```
- add `targetShortfalls: EmployeeTargetShortfall[];` to `BulkAssignmentResult` after `unmapped`;
- change the early return `if (!anyPortRestricted) return { events, errors, skipped, unmapped };` to `… return { events, errors, skipped, unmapped, targetShortfalls: [] };`
- replace the final `return { events: balanced, errors, skipped, unmapped };` with:

```ts
  const targetShortfalls: EmployeeTargetShortfall[] = [];
  for (const username of [...monthTargets.keys()].sort((a, b) => a.localeCompare(b))) {
    const target = monthTargets.get(username) ?? 0;
    let allowed = ownedTotals.get(username) ?? 0;
    for (const candidate of assignableRows) {
      if (canTake(username, candidate.xrayImageId)) allowed += 1;
    }
    if (allowed < target) targetShortfalls.push({ username, target, allowed });
  }
  return { events: balanced, errors, skipped, unmapped, targetShortfalls };
```

Fix any other object literal `npm run typecheck` reports as a `BulkAssignmentResult` missing `targetShortfalls` (add `targetShortfalls: []`).

- [ ] **Step 4: Labels**

In `labels.phaseThreeFour.ts`, after `p4_bulk_unmapped_warning_stages:`:

```ts
  p4_bulk_target_shortfall_warning: "تنبيه: لن تتساوى الإجماليات — المنافذ والمستويات المسموحة لا تكفي لبلوغ حصة: {names}. عدّل قيود المنافذ أو النسب إن أردت التساوي.",
  p4_bulk_target_shortfall_item: "{name} (المتاح {allowed} من {target})",
```

- [ ] **Step 5: Show it in Phase 4**

In `PhaseFourDistribution.tsx`:
- preview (`previewData` memo): destructure `targetShortfalls` from `calculateBulkAssignment(…)` and return it: `return { summaryMap, errors, skipped, newAssignments: events.length, targetShortfalls };`
- add, above `previewData`, a helper inside the component:
  ```ts
  const shortfallText = (shortfalls: EmployeeTargetShortfall[]): string =>
    fillTemplate(L.p4_bulk_target_shortfall_warning, {
      names: shortfalls
        .map((s) => fillTemplate(L.p4_bulk_target_shortfall_item, {
          name: employees.find((e) => e.username === s.username)?.displayName ?? s.username,
          allowed: formatNumber(s.allowed),
          target: formatNumber(s.target),
        }))
        .join("، "),
    });
  ```
  (import `type EmployeeTargetShortfall` from `../../../../../data/distribution/bulkAssignment` next to `calculateBulkAssignment`);
- render, directly after the `{previewData && previewData.errors.length > 0 && ( … )}` block:
  ```tsx
          {previewData && previewData.targetShortfalls.length > 0 && (
            <div className="p4-alert warn dist-err-block" role="alert">
              <AlertTriangle size={14} aria-hidden /> {shortfallText(previewData.targetShortfalls)}
            </div>
          )}
  ```
- in `handleRunBulkAssignment`, destructure `targetShortfalls` too and after the `unmapped` message block add `if (targetShortfalls.length > 0) messages.push(shortfallText(targetShortfalls));`.

(`formatNumber` prints Latin digits, so the test's `"0"`/`"1"` match.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/data/distribution src/components/Sidebar/Tabs/Population/components`
Expected: PASS, snapshots unchanged.

- [ ] **Step 7: Gates + complexity**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`
Expected: all green.

- [ ] **Step 8: Edit-log entry**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (distribution): warn in the preview when a port restriction makes equal totals impossible"`

- [ ] **Step 9: Commit**

```bash
git add src/data/distribution/bulkAssignment.ts src/data/distribution/bulkAssignment.test.ts src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.portRestrictions.test.tsx src/data/labels/labels.phaseThreeFour.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (distribution): warn when equal totals are infeasible

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 23: Full gate sweep, build, push

**Tier:** release sweep for the whole Workstream A PR.

- [ ] **Step 1: Every gate**

Run, in order, and fix anything red before continuing (a fix is its own small commit with its own edit-log entry):

```bash
npm run lint
npm run typecheck
npm run test:run
npm run check:complexity
npm run check:hex-literals
npm run check:release
npm run check:vendor
npm run build
npm run check:bundle-size
```
Expected: all pass; `dist/index.html` is rebuilt; `check:release` confirms `package.json` matches the newest edit-log version (every task used `--sync-package`).

- [ ] **Step 2: Whole-repo line count for the tier-3 entries**

Run: `npm run count-lines -- --quiet` and add the total as a `**Lines (repo):**` line to the newest tier-3 entry in today's edit log (Tasks 4, 8 and 14 are tier 3); commit that doc change:

```bash
git add "docs/edit logs"
git commit -m "$(cat <<'MSG'
Docs (edit log): whole-repo line count for Workstream A

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

- [ ] **Step 3: Keep the architecture doc in sync**

Add to `docs/architecture/data-system-report.md`, under the population month layout, the new `2-processed/population.final.{stamp}.superseded.json` and `1-raw/{risk|bi}.source[.n].{stamp}.superseded.{ext}` archives, and under answers the stable segment chain name (`{creationMinute}-ans-{deviceHash}-{chainHash}[-seq].ndjson`, one chain per browser × month × user). Commit it with message `Docs (architecture): Workstream A additive artefacts` and the two attribution lines.

- [ ] **Step 4: Push**

```bash
git status --short
git push -u origin claude/beautiful-einstein-y1ouot
```
Expected: clean tree before the push; push succeeds.

---

## Spec deviations found while reading the code (2026-09-28)

1. **A4 — function name.** The spec's test names `saveStyleChoices`; the real export is `saveDeckStyleChoices` (`deck2/styleChoices.ts:40`). Task 1 uses the real name.
2. **A5 — employees already feed `caseFilter` their own rows.** For a non-oversight user `entries` is already filtered to the user (`XrayReferrals.tsx:1377`) and `scopedEntries === entries`, so no extra plumbing is needed; only the stats source changes.
3. **A2 — line numbers drifted** (guard at `populationStorage.ts:305-316`, not `:317-329`; dialog at `Population/index.tsx:1568-1590`). Semantics as described.
4. **A2 — "integrity check" is computed from data already in memory.** `scanReferentialIntegrity`'s `sampleOrphans` is "sample ids absent from the population"; Tasks 3/7 compute exactly that set from the rows the save / report load already holds (`assessPopulationOverwrite`, `sampleRowsMissingFromPopulation`) instead of calling `runMonthIntegrityScan`, which would re-read population, sample, distribution and every answer file on each Reports visit. The Reports banner appears once the exec input is loaded (KPI dashboard or a report generation), not on the lightweight month-meta load.
5. **A2 — `population.final.json` archive is mandatory.** `archiveExistingRaw` is best-effort; the population archive refuses the save if it cannot be written (source-workbook archives stay best-effort).
6. **A2 — denominators.** `calculateExecutiveKPIs` excludes snapshot rows from every population-wide figure; `population.csv` excludes them; `sample.csv`, the KPI sample figures, the deck's row-level fact table and Report Designer rows include them (their answers are the point of the fallback). Deck aggregates beyond `calculateExecutiveKPIs` were not audited individually for population denominators — a month with orphaned sampled ids will show them in deck per-port/per-stage breakdowns. Months without orphans are byte-identical (Task 6 snapshot + Power BI golden test).
7. **A2 — recovery scope.** Per the coordinator's update, the recovery tool handles only `*.superseded.json` and `population.final.json.bak`; `5-system/backups/*` candidates are Workstream D's (Task 8 hand-off). `processing.summary.json` is not versioned, so a restored population's rebuilt aggregate reuses the latest summary block.
8. **A1 — no `loadTokenRef` bump in `handleSave`.** Bumping it would also cancel a non-silent month-switch load and strand the view in `loading`; the generation merge (Task 10) covers the stale-reload case on its own.
9. **A1 — deviceId already exists.** `getDistributionDeviceId()` is persisted (`xray_distribution_device_id_v1`) and registered; Task 14 reuses it. Only the chain's creation minute is newly persisted (`xray_answer_segment_chain_v1`) — the segment name's time prefix (`answerEventStore.ts:148-197`) would otherwise still change on every reload even with a stable chain id.
10. **A1 — a stable chain needs a new safety rule.** Per-session chains relied on "absence is the expected answer on a first append". A chain that outlives the page cannot, so Task 14 treats a segment the directory lists as already written (patient ladder, rotate-away on an unreadable baseline). Residual: two tabs of the same user and month exclude only their own written names from the sync probe (Task 11), so one tab may see the other's appends only after a rotation or a manual refresh.
11. **A1 — the answer save already had a 30 s deadline at casLoop level** (`answerStorage.ts:636-637`, landed in #172); what was missing is threading it into the append's inner ladders (Task 13).
12. **Complexity budget.** `XrayReferrals` is at 1447/1450 lines; Tasks 2 and 17 free lines so Tasks 10 and 18 fit (running totals are stated per task).

## Self-review

**Spec coverage (Workstream A):**

| Spec requirement | Task |
|---|---|
| A1 save generation guard / stale load never downgrades (jsdom test) | 10 |
| A1 own-write suppression in the sync delta | 11 |
| A1 parallel segment read (concurrency test) | 12 |
| A1 deadline threaded into append/verify ladders (deadline test) | 13 |
| A1 stable per-(month, user, device) chain, old segments readable (two-session test) | 14 |
| A1 in-panel `saving → submitted ✓` / `not saved — retry` from a real result contract | 15 |
| A1 app-level replay, all months + ad-hoc, broadcast + clear draft on success (test) | 16 |
| A1 draft key from the row's canonical folder (ad-hoc/retained test); `setItem` failure warning; `pruneAnswerDrafts` at start | 17 (+16 for prune) |
| A1 last-open sample restored after reload | 18 |
| A2 data-layer block regardless of `confirmedOverwrite`, typed error with `missingCount` + ≤10 examples; sample-only month keeps confirm | 3 |
| A2 versioned archive of `population.final.json` and `risk/bi.source.*` | 4 |
| A2 dialog with answer / distribution / missing counts; blocked → no continue | 5 |
| A2 report fallback rows flagged `fromSampleSnapshot`; population denominators unchanged | 6 |
| A2 banner in Reports / KPI / Report Designer / Power BI; check at save and report time | 7 |
| A2 admin recovery: superseded + `.bak` candidates with coverage; restore archives current, rebuilds index + aggregate; never whole-workspace restore; backups → Workstream D | 8, 9 |
| A3 snapshot first; unrestricted byte-identical | 19, 20 |
| A3 month-level targets, make-up from other stages, CertScan/port reconciliation | 20 |
| A3 existing ownership counts; re-run converges | 21 |
| A3 infeasible preview warning | 22 |
| A4 owning modules export names → `NON_TEMPLATE_FILES`; `not-a-template` never `corrupt`; torn template still flagged | 1 |
| A5 strip from `caseFilter.entries`, title names chip, quota tile unfiltered, comment updated | 2 |
| Tier-3 entries + full sweep + build before push | 4, 8, 14, 23 |

**Placeholder scan:** no "TBD"/"TODO"/"similar to Task N"/"add error handling" steps; every code step shows the code or the exact before/after region. Line numbers are as read on 2026-09-28 and are given with the surrounding text so an edit can be located even after earlier tasks shift lines.

**Type/name consistency:** `PopulationOverwriteAssessment` / `loadPopulationOverwriteImpact` / `assessPopulationOverwrite` (Tasks 3, 5, 7, 8); `supersedeStamp` / `supersededFileName` / `archiveBeforeOverwrite` (Tasks 4, 8); `sampleRowsMissingFromPopulation` + `fromSampleSnapshot` (Tasks 6, 7); `AnswerSaveOutcome` (Tasks 15, 17); `AppendEventSegmentOptions` (Tasks 13, 14); `SegmentWriterIdentity.stable` (Task 14); `segmentNamesWrittenThisSession` / `ownAnswerSegmentNames` (Task 11); `panelDraftKey` / `answerFolderForEntry` (Task 17); `EmployeeTargetShortfall` / `targetShortfalls` (Task 22); `makePopulationRow` / `makeSampleMaster` fixtures (Tasks 3, 4, 6, 7, 8, 10, 18, 19).
