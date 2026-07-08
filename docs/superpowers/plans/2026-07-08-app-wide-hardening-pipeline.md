# App-Wide Hardening Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is orchestration-shaped (each task dispatches or IS a review/verification action), not a conventional code-diff plan — the concrete code plan for Stage 4 is *produced* by Task 3 and does not exist until then.

**Goal:** Finish the 22 tracked items (B4–B6, C1–C6, D1–D8 minus D8, E1–E5) in `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md` via the Fable-reviewed 10-dispatch pipeline (status-check → plan → triage → 5 batched implementation dispatches → 2 QA passes), landing on a dedicated branch with nothing merged to `main` without explicit user sign-off.

**Architecture:** A five-stage pipeline where each of the first three stages produces one markdown artifact consumed by the next (status table → unified plan → approved plan). Stage 4 dispatches 5 implementation-batch agents against the approved plan, each gated by lint/test. Stage 5 has Fable review the diffs in two passes. All work lives on branch `hardening-2026-07-08`.

**Tech Stack:** React 19 + TypeScript + Vite, Vitest (`node` env, `createMemoryDirectory()`), ESLint, Testing Library (to be added for D1). Agent dispatch via the `Agent` tool with `model: sonnet | opus | fable`.

## Global Constraints

- Every code edit must get an entry in `docs/EDIT_LOG.md` per `CLAUDE.md`'s mandatory edit-log format (Version/Date/What changed/Before/After).
- All Stage 4+ work happens on branch `hardening-2026-07-08`, created from current `main`. No merge to `main` without explicit user approval at the end.
- Decisions already made (do not re-litigate): C2 تقرير الإدارة is **built now**, not hidden. C5 EDIT_LOG-in-bundle is **truncated to recent versions at build time**, not shipped in full or excluded. Demo mode (C1) targets **internal-only** use — minimal seed data, static passcode.
- Every batch runs `npm run lint` and `npm run test:run` before being marked done; full `npm run build` runs once at the end of Stage 5.
- D8 (oversized-file refactor) is explicitly deferred — do not attempt it in this pipeline.
- Follow existing repo conventions: Arabic UI strings via label keys (`src/data/labels/labelsStore.ts`), `import type` for type-only imports, plain CSS co-located per component, tests in `node` env with `createMemoryDirectory()`.

---

## Task 1: Create the hardening branch

**Files:** none (git operation only)

- [ ] **Step 1: Confirm working tree is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean` (branch `main`)

- [ ] **Step 2: Create and switch to the hardening branch**

Run: `git checkout -b hardening-2026-07-08`
Expected: `Switched to a new branch 'hardening-2026-07-08'`

- [ ] **Step 3: Create the artifacts directory for pipeline outputs**

Run: `mkdir -p docs/audit/hardening-2026-07-08`

---

## Task 2: Stage 1 — Sonnet status-check dispatch

**Files:**
- Create: `docs/audit/hardening-2026-07-08/01-status-table.md`

**Interfaces:**
- Consumes: `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md` (§3 Milestones), `docs/audit/TIER1_SPEC_2026-07-05.md`, `docs/audit/TIER3_SPECS_2026-07-07.md`, current repo state, `docs/EDIT_LOG.md` tail
- Produces: `docs/audit/hardening-2026-07-08/01-status-table.md` — a markdown table, one row per roadmap item (B4, B5, B6, C1, C3, C4, C6, D1, D2, D3, D4, D5, D6, D7, E1, E2 — 16 code/doc items; C2 and C5 are decided, not status-checked; D8 excluded; E3–E5 are orchestrator-inline, not status-checked here), columns: `Item | Status (fixed/partial/open) | Evidence (file:line or command output) | Notes`

- [ ] **Step 1: Dispatch the Sonnet status-check agent**

Use the `Agent` tool with `model: sonnet`, `run_in_background: false`, prompt:

```
Read docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md section 3 (Milestones B4-E) in
the repo at the current working directory, plus docs/audit/TIER1_SPEC_2026-07-05.md
and docs/audit/TIER3_SPECS_2026-07-07.md if they contain detail on any of these
items. For each of these 16 items — B4, B5, B6, C1, C3, C4, C6, D1, D2, D3, D4,
D5, D6, D7, E1, E2 — determine its CURRENT status against the actual code in this
repo (the audit is ~40 commits stale; check git log and docs/EDIT_LOG.md's tail
for what has already landed, e.g. the Tier-1 W1-W9 work and the referral-approval
rework). Do not trust the audit's prose alone — grep/read the relevant files
yourself for each item.

For each item, report: Status (fixed / partially fixed / open), Evidence (exact
file:line citations or command output proving the status), and Notes (anything
a planner would need to know — e.g. "half-done, only 2 of 5 CSS files converted").

Write your findings as a single markdown table to
docs/audit/hardening-2026-07-08/01-status-table.md with columns:
Item | Status | Evidence | Notes

This is a read-only investigation. Do not edit any source files. Report back
a summary of what you found (under 300 words) plus confirmation the file was written.
```

- [ ] **Step 2: Verify the artifact was written**

Run: `cat docs/audit/hardening-2026-07-08/01-status-table.md`
Expected: a markdown table with 16 rows, one per item listed above.

- [ ] **Step 3: Commit**

```bash
git add docs/audit/hardening-2026-07-08/01-status-table.md
git commit -m "docs(hardening): stage 1 status-check table"
```

---

## Task 3: Stage 2 — Opus unified plan dispatch

**Files:**
- Create: `docs/audit/hardening-2026-07-08/02-unified-plan.md`

**Interfaces:**
- Consumes: `docs/audit/hardening-2026-07-08/01-status-table.md` (Task 2 output), `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md`
- Produces: `docs/audit/hardening-2026-07-08/02-unified-plan.md` — one section per implementation batch (Visual System, Product Completeness, Tests, Release Engineering, Polish), each listing: exact items covered, files likely touched, sequencing/dependency notes, acceptance criteria, and a draft importance/difficulty rating (Opus's first pass — Fable finalizes in Task 4)

- [ ] **Step 1: Dispatch the Opus planning agent**

Use the `Agent` tool with `model: opus`, `run_in_background: false`, prompt:

```
Read docs/audit/hardening-2026-07-08/01-status-table.md (ground-truth status of
16 roadmap items) and docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md section 3 for
full item descriptions. Trust the status table — only read source code yourself
to resolve items the table marks "partial" or "unclear."

Also incorporate these three already-decided product decisions into your plan
(do not re-question them):
- C2 (تقرير الإدارة management report): build it now — add it as explicit scope
  in the batch that covers C1/C3/C4/C6.
- C5 (EDIT_LOG-in-bundle): truncate docs/EDIT_LOG.md to recent versions at build
  time (implementer picks a reasonable cutoff, e.g. last 20 versions or last 90
  days) rather than shipping full history or excluding it.
- Demo mode (C1): internal-only testing aid — minimal seed data, static passcode,
  no rotation logic needed.

Produce ONE unified plan, organized into exactly these 5 implementation batches
(do not restructure the batching):

1. Visual System — B4 (CSS token sweep, one file per commit, screenshot-diff
   before/after, worst offenders first: EmployeeWorkspace, Reports, DataTable),
   B5 (table polish — header truncation, number alignment, filter row
   consistency), B6 (spacing-rhythm pass).
2. Product Completeness — C1 (demo seed data, internal-only), C2 (finish
   تقرير الإدارة), C3 (first-run admin checklist), C4 (surface error ring buffer
   via getRecentErrors()/clearErrors() from src/data/storage/errorLogger.ts in a
   Settings diagnostics panel), C6 (label coverage audit for hard-coded strings
   in App.tsx/WorkspaceGate).
3. Tests — D1 (component/workflow tests using Testing Library +
   createMemoryDirectory() from src/data/storage/memoryDirectory.ts; one
   happy-path + one failure-path per workflow: import→process→sample→
   distribute→answer→report; characterization tests for DataTable and the
   Population wizard), D2 (XSS-escaping tests for the report builders in
   src/data/reporting/), D3 (import-mapping edge-case tests).
4. Release Engineering — D4 (CI workflow, OPS-01), D5 (vendor the SheetJS CDN
   xlsx tarball instead of fetching at install time), D7 (version stamp /
   release checklist), plus C5's EDIT_LOG truncation-at-build implementation.
5. Polish — E1 (accessibility pass), E2 (print/report CSS).

For each batch, write a section with: exact items covered, files you expect
will need changes (be as specific as the status table and audit allow), any
sequencing/dependency notes (e.g. "B4 must land before B5 to avoid conflicting
CSS diffs"), concrete acceptance criteria per item, and a draft
importance (low/med/high) and difficulty (low/med/high) rating per item —
these ratings are a first pass; a Fable review will finalize them next.

Write the full plan to docs/audit/hardening-2026-07-08/02-unified-plan.md.
This is a planning task — do not edit any source files. Report back a summary
(under 300 words) plus confirmation the file was written.
```

- [ ] **Step 2: Verify the artifact was written**

Run: `cat docs/audit/hardening-2026-07-08/02-unified-plan.md`
Expected: 5 sections (one per batch), each with items/files/sequencing/acceptance-criteria/ratings.

- [ ] **Step 3: Commit**

```bash
git add docs/audit/hardening-2026-07-08/02-unified-plan.md
git commit -m "docs(hardening): stage 2 unified plan (opus)"
```

---

## Task 4: Stage 3 — Fable triage review dispatch

**Files:**
- Create: `docs/audit/hardening-2026-07-08/03-approved-plan.md`

**Interfaces:**
- Consumes: `docs/audit/hardening-2026-07-08/02-unified-plan.md`, `docs/audit/hardening-2026-07-08/01-status-table.md` (docs-only — no repo reads)
- Produces: `docs/audit/hardening-2026-07-08/03-approved-plan.md` — same 5-batch structure as Task 3's output, with Fable's enhancements folded in and a finalized `Assigned model: Sonnet|Opus` per item. **This file is what gets shown to the user for final sign-off in Task 5.**

- [ ] **Step 1: Dispatch the Fable triage agent**

Use the `Agent` tool with `model: fable`, `run_in_background: false`, prompt:

```
You are doing a professional review/triage pass, docs-only — do not read any
other repository files beyond the two given here.

Read docs/audit/hardening-2026-07-08/02-unified-plan.md (Opus's unified 5-batch
plan) and docs/audit/hardening-2026-07-08/01-status-table.md (the ground-truth
status table it was built from).

Review the plan as a senior engineer would: check it's complete against the
status table (every non-open item accounted for), check the batching and
sequencing make sense, and add any enhancement ideas you think improve the
outcome (e.g. a better acceptance criterion, a risk you'd flag, an ordering
tweak). Then finalize, for every single item in every batch, which model
should implement it: Sonnet (mechanical, well-scoped, lower-stakes) or Opus
(higher correctness stakes, ambiguous scope, or cross-cutting risk) — the
draft plan already suggests Opus for the Tests batch as a whole, but confirm
or override per-item if warranted.

Write the finalized plan to docs/audit/hardening-2026-07-08/03-approved-plan.md,
same 5-batch section structure as the input, with your enhancements folded in
and an explicit "Assigned model: Sonnet" or "Assigned model: Opus" line per
item. This file will be shown to the end user as the final execution plan, so
it should be clean and self-contained (a reader should not need to re-open the
unified plan to understand it).

Report back a summary of your key changes/enhancements versus the draft plan
(under 300 words) plus confirmation the file was written.
```

- [ ] **Step 2: Verify the artifact was written**

Run: `cat docs/audit/hardening-2026-07-08/03-approved-plan.md`
Expected: 5 sections, each item has an explicit `Assigned model:` line.

- [ ] **Step 3: Commit**

```bash
git add docs/audit/hardening-2026-07-08/03-approved-plan.md
git commit -m "docs(hardening): stage 3 fable-approved execution plan"
```

---

## Task 5: Human checkpoint — present approved plan for sign-off

**Files:** none

- [ ] **Step 1: Summarize `03-approved-plan.md` for the user**

Present the 5 batches, item-to-model assignments, and any notable enhancements Fable added. Ask explicitly: proceed with Stage 4 implementation as approved, or adjust first?

- [ ] **Step 2: Wait for explicit user go-ahead before starting Task 6**

Do not dispatch any Stage 4 implementation agent until the user confirms. This is the last checkpoint before code changes begin.

---

## Task 6: Stage 4, Batch 1 — Visual System (Sonnet)

**Files:**
- Modify: CSS files identified in `03-approved-plan.md` §1 (expected candidates per the audit: `src/components/Sidebar/Tabs/EmployeeWorkspace/**/*.css`, `src/components/Sidebar/Tabs/Reports/**/*.css`, `src/components/DataTable/*.css`)
- Modify: `docs/EDIT_LOG.md` (one entry per file changed, per CLAUDE.md format)

**Interfaces:**
- Consumes: `docs/audit/hardening-2026-07-08/03-approved-plan.md` §1 (Visual System)
- Produces: committed CSS changes on `hardening-2026-07-08`; no code interface produced for other batches (CSS-only)

- [ ] **Step 1: Dispatch the Batch 1 implementation agent**

Use the `Agent` tool with `model` per `03-approved-plan.md` §1's assignment (expected: `sonnet`), `run_in_background: true` (can run while Task 7 is prepared), prompt:

```
You are implementing Batch 1 (Visual System) of the app-wide hardening plan for
x-ray-quality-app-v1, on git branch hardening-2026-07-08 (already checked out —
confirm with `git branch --show-current` before starting).

Read docs/audit/hardening-2026-07-08/03-approved-plan.md section "1. Visual
System" for your exact scope, files, and acceptance criteria — it is the
authoritative spec for this batch. Also read CLAUDE.md in the repo root for
project conventions (RTL Arabic UI, plain CSS co-located per component, no
CSS framework).

Implement B4 (CSS token sweep — replace raw hex literals with var(--...) design
tokens, one file per commit, worst offenders first), B5 (table polish), and B6
(spacing rhythm) exactly as scoped in that section.

CRITICAL: before every single edit, add an entry to docs/EDIT_LOG.md following
the exact format CLAUDE.md specifies (Version bump per semver-lite — this is a
bug-fix/polish pass so bump the decimal, e.g. v42.13, v42.14, ...; Date;
File; Before; After).

After each file's changes: run `npm run lint` and `npm run test:run`, and fix
any failures you introduced before moving to the next file.

When done with all files in this batch, run `npm run lint` and
`npm run test:run` one final time and report PASS/FAIL, then report a summary
of every file changed and every EDIT_LOG entry added.
```

- [ ] **Step 2: On completion, verify gates passed**

Run: `npm run lint && npm run test:run`
Expected: both exit 0.

- [ ] **Step 3: Verify EDIT_LOG entries exist for every changed file**

Run: `git diff --stat main...hardening-2026-07-08 -- docs/EDIT_LOG.md`
Expected: non-empty diff showing new entries.

---

## Task 7: Stage 4, Batch 2 — Product Completeness (Sonnet)

**Files:**
- Modify/Create: files identified in `03-approved-plan.md` §2 (expected candidates: `src/data/demo/demoWorkspace.ts` or similar demo-seed module, `src/components/Sidebar/Tabs/Reports/**` for تقرير الإدارة, a new first-run checklist component, `src/components/Sidebar/Tabs/Settings/**` for the error ring-buffer diagnostics panel, `src/data/labels/labelsStore.ts` for new label keys, `App.tsx` / `WorkspaceGate` for label-key conversions)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `docs/audit/hardening-2026-07-08/03-approved-plan.md` §2 (Product Completeness); `getRecentErrors()`, `clearErrors()` from `src/data/storage/errorLogger.ts`; `getLabels()`/`useLabels()` from `src/data/labels/labelsStore.ts`
- Produces: demo seed data, finished management report, first-run checklist, diagnostics panel — no interfaces consumed by other batches

- [ ] **Step 1: Dispatch the Batch 2 implementation agent**

Use the `Agent` tool with `model` per `03-approved-plan.md` §2's assignment (expected: `sonnet`), `run_in_background: true`, prompt:

```
You are implementing Batch 2 (Product Completeness) of the app-wide hardening
plan for x-ray-quality-app-v1, on git branch hardening-2026-07-08 (already
checked out — confirm with `git branch --show-current`).

Read docs/audit/hardening-2026-07-08/03-approved-plan.md section "2. Product
Completeness" for exact scope, files, and acceptance criteria. Also read
CLAUDE.md for project conventions — in particular: all user-facing strings
must be Arabic label keys added to src/data/labels/labelsStore.ts's
DEFAULT_LABELS, not hard-coded strings; components read labels via
getLabels()/useLabels().

Implement, per that section: C1 (demo seed data — internal-only tier: one
realistic month with population, drawn sample, partial answers; minimal, not
showcase-polished; static passcode, no rotation), C2 (finish تقرير الإدارة —
build it out, do not hide it), C3 (first-run admin checklist for an empty
workspace: create structure → add users → set permissions → import month), C4
(admin diagnostics panel in Settings surfacing getRecentErrors() from
src/data/storage/errorLogger.ts with a copy-to-clipboard button and a
clearErrors() action), C6 (label coverage audit — find hard-coded Arabic
strings in App.tsx and the WorkspaceGate component, convert them to label
keys).

CRITICAL: before every edit, add an entry to docs/EDIT_LOG.md per CLAUDE.md's
format (bump the decimal version per edit).

After each logical change: run `npm run lint` and `npm run test:run`, fix any
regressions before continuing.

When done, run `npm run lint` and `npm run test:run` one final time, report
PASS/FAIL, and report a summary of every file changed and EDIT_LOG entries
added.
```

- [ ] **Step 2: On completion, verify gates passed**

Run: `npm run lint && npm run test:run`
Expected: both exit 0.

---

## Task 8: Stage 4, Batch 3 — Tests (Opus)

**Files:**
- Create: new test files per `03-approved-plan.md` §3 (expected: workflow integration tests using `createMemoryDirectory()`, XSS-escaping tests under `src/data/reporting/`, import-mapping edge-case tests under `src/data/population/` or wherever Excel import mapping lives)
- Modify: `package.json` (if Testing Library needs adding — check first, per CLAUDE.md's dependency gotchas: don't casually swap the `xlsx` CDN-tarball dependency)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `docs/audit/hardening-2026-07-08/03-approved-plan.md` §3 (Tests); `createMemoryDirectory()` from `src/data/storage/memoryDirectory.ts`
- Produces: test suites — no interface consumed by other batches, but must not break any file touched by Batches 1/2/4/5

- [ ] **Step 1: Dispatch the Batch 3 implementation agent**

Use the `Agent` tool with `model` per `03-approved-plan.md` §3's assignment (expected: `opus`, per the design's rationale that this is the highest correctness-stakes batch), `run_in_background: true`, prompt:

```
You are implementing Batch 3 (Tests) of the app-wide hardening plan for
x-ray-quality-app-v1, on git branch hardening-2026-07-08 (already checked out
— confirm with `git branch --show-current`).

Read docs/audit/hardening-2026-07-08/03-approved-plan.md section "3. Tests"
for exact scope, files, and acceptance criteria. Also read CLAUDE.md for
testing conventions: Vitest with `node` environment, createMemoryDirectory()
helper (src/data/storage/memoryDirectory.ts) implementing DirectoryHandleLike
in memory for any test needing file I/O.

Implement, per that section: D1 (component/workflow tests — add Testing
Library if not already a dependency, check package.json first; one
happy-path + one failure-path test per workflow: import→process→sample→
distribute→answer→report; characterization tests for DataTable and the
Population wizard), D2 (XSS-escaping tests for the HTML report builders in
src/data/reporting/ — verify user-controlled strings are properly escaped in
generated report HTML), D3 (import-mapping edge-case tests — malformed
columns, missing required fields, type mismatches in the Excel import flow).

CRITICAL: before every edit (including new test files and any package.json
change), add an entry to docs/EDIT_LOG.md per CLAUDE.md's format.

Run `npm run test:run` after each new test file to confirm it passes (or, for
tests that reveal a real bug, document the failure clearly rather than
silently weakening the test — report any such findings back explicitly, do
not fix production code in this batch unless the fix is trivial and directly
required to make a legitimate test pass).

When done, run `npm run lint` and `npm run test:run` one final time, report
PASS/FAIL and test count added, and report a summary of every file changed,
every EDIT_LOG entry added, and any production bugs discovered by the new
tests that were NOT part of this batch's fix scope (flag these for follow-up).
```

- [ ] **Step 2: On completion, verify gates passed**

Run: `npm run lint && npm run test:run`
Expected: both exit 0, test count increased vs. Task 1's baseline.

---

## Task 9: Stage 4, Batch 4 — Release Engineering (Sonnet)

**Files:**
- Create: `.github/workflows/ci.yml` (or per `03-approved-plan.md` §4's exact path)
- Modify: `package.json` (vendoring the xlsx tarball reference — do not change it to the stale npm package, per CLAUDE.md's explicit warning)
- Modify: build config for EDIT_LOG truncation (likely `vite.config.ts`, wherever the `?raw` import of `docs/EDIT_LOG.md` happens per CLAUDE.md)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `docs/audit/hardening-2026-07-08/03-approved-plan.md` §4 (Release Engineering)
- Produces: CI pipeline, vendored dependency, build-time truncation — no interface consumed by other batches

- [ ] **Step 1: Dispatch the Batch 4 implementation agent**

Use the `Agent` tool with `model` per `03-approved-plan.md` §4's assignment (expected: `sonnet`), `run_in_background: true`, prompt:

```
You are implementing Batch 4 (Release Engineering) of the app-wide hardening
plan for x-ray-quality-app-v1, on git branch hardening-2026-07-08 (already
checked out — confirm with `git branch --show-current`).

Read docs/audit/hardening-2026-07-08/03-approved-plan.md section "4. Release
Engineering" for exact scope, files, and acceptance criteria. Also read
CLAUDE.md's "Build & dependency gotchas" section carefully — in particular:
the xlsx dependency is installed from a SheetJS CDN tarball
(https://cdn.sheetjs.com/xlsx-0.20.3/...), NOT the npm registry; do not
"upgrade" it to the stale npm package when vendoring it.

Implement, per that section: D4 (CI workflow — lint, test:run, and build on
push/PR), D5 (vendor the SheetJS CDN xlsx tarball into the repo so installs
don't depend on live CDN access — keep the exact same version and package
contents, just change the fetch source), D7 (version stamp / release
checklist doc), and the C5 decision (truncate docs/EDIT_LOG.md's `?raw` import
to the most recent versions at build time — find where the ChangeLog tab
imports the raw file and add a build-time or import-time truncation step that
keeps the full file in git but caps what ships in the bundle; pick a
reasonable cutoff such as the last 20 version entries and document your choice
in the EDIT_LOG entry).

CRITICAL: before every edit, add an entry to docs/EDIT_LOG.md per CLAUDE.md's
format.

After each change: run `npm run lint`, `npm run test:run`, and `npm run build`
(the build is the actual proof the EDIT_LOG truncation and vendored xlsx work
correctly), fixing any regressions before continuing.

When done, run `npm run lint`, `npm run test:run`, and `npm run build` one
final time, report PASS/FAIL plus the resulting dist/index.html size, and
report a summary of every file changed and EDIT_LOG entries added.
```

- [ ] **Step 2: On completion, verify gates passed**

Run: `npm run lint && npm run test:run && npm run build`
Expected: all exit 0; note the reported `dist/index.html` size for the Task 14 final report.

---

## Task 10: Stage 4, Batch 5 — Polish (Sonnet)

**Files:**
- Modify: files identified in `03-approved-plan.md` §5 (expected: components lacking ARIA labels/focus states per an a11y pass, `src/data/reporting/**` print CSS `@media print` rules)
- Modify: `docs/EDIT_LOG.md`

**Interfaces:**
- Consumes: `docs/audit/hardening-2026-07-08/03-approved-plan.md` §5 (Polish)
- Produces: a11y + print-CSS fixes — no interface consumed by other batches

- [ ] **Step 1: Dispatch the Batch 5 implementation agent**

Use the `Agent` tool with `model` per `03-approved-plan.md` §5's assignment (expected: `sonnet`), `run_in_background: true`, prompt:

```
You are implementing Batch 5 (Polish) of the app-wide hardening plan for
x-ray-quality-app-v1, on git branch hardening-2026-07-08 (already checked out
— confirm with `git branch --show-current`).

Read docs/audit/hardening-2026-07-08/03-approved-plan.md section "5. Polish"
for exact scope, files, and acceptance criteria. Also read CLAUDE.md for
conventions (RTL Arabic layout, dir="rtl", plain CSS co-located per component).

Implement, per that section: E1 (accessibility pass — semantic HTML, ARIA
labels where missing, visible focus states, keyboard navigation for
interactive elements, tap-target sizing) and E2 (print/report CSS — ensure
generated reports and any print-relevant screens have correct @media print
rules).

CRITICAL: before every edit, add an entry to docs/EDIT_LOG.md per CLAUDE.md's
format.

After each file's changes: run `npm run lint` and `npm run test:run`, fix any
regressions before continuing.

When done, run `npm run lint` and `npm run test:run` one final time, report
PASS/FAIL, and report a summary of every file changed and EDIT_LOG entries
added.
```

- [ ] **Step 2: On completion, verify gates passed**

Run: `npm run lint && npm run test:run`
Expected: both exit 0.

---

## Task 11: Stage 5, QA pass 1 — Fable reviews Batches 1+2

**Files:**
- Create: `docs/audit/hardening-2026-07-08/qa-review-1.md`

**Interfaces:**
- Consumes: `git diff main...hardening-2026-07-08` scoped to Batch 1 + Batch 2 files, `docs/audit/hardening-2026-07-08/03-approved-plan.md` §1–§2
- Produces: `docs/audit/hardening-2026-07-08/qa-review-1.md` — approve, or a list of concrete rework items with file:line citations

- [ ] **Step 1: Generate the diff for review**

Run: `git diff main...hardening-2026-07-08 -- '*.css' 'src/data/demo' 'src/components/Sidebar/Tabs/Settings' 'src/data/labels' > docs/audit/hardening-2026-07-08/batch-1-2.diff`

(Adjust paths to match whatever Batches 1–2 actually touched, per their reported file summaries from Tasks 6–7.)

- [ ] **Step 2: Dispatch the Fable QA agent**

Use the `Agent` tool with `model: fable`, `run_in_background: false`, prompt:

```
Review docs/audit/hardening-2026-07-08/batch-1-2.diff (the visual-system and
product-completeness changes from the app-wide hardening pipeline) against
the acceptance criteria in docs/audit/hardening-2026-07-08/03-approved-plan.md
sections 1 and 2. This is the highest regression-risk part of the pipeline by
diff volume (a CSS token sweep touching many files) — look specifically for:
visual regressions implied by the diff (e.g. a hex value replaced with the
wrong token), any hard-coded Arabic string that should have become a label
key but wasn't, missing docs/EDIT_LOG.md entries for changed files, and
whether every acceptance criterion in sections 1-2 is actually met.

Write your findings to docs/audit/hardening-2026-07-08/qa-review-1.md: either
"APPROVED" with a one-paragraph summary, or a numbered list of concrete
rework items, each with a file:line citation and what's wrong.
```

- [ ] **Step 3: Act on the review**

If `qa-review-1.md` says APPROVED, proceed to Task 12. If it lists rework items, dispatch a follow-up Sonnet agent (same pattern as Task 6/7) scoped only to those specific items, then re-run this task's Step 2 against the updated diff.

---

## Task 12: Stage 5, QA pass 2 — Fable final review of Batches 3–5 + whole branch

**Files:**
- Create: `docs/audit/hardening-2026-07-08/qa-review-2.md`

**Interfaces:**
- Consumes: `git diff main...hardening-2026-07-08` (full branch diff), `docs/audit/hardening-2026-07-08/03-approved-plan.md` (all sections), `docs/audit/hardening-2026-07-08/qa-review-1.md`
- Produces: `docs/audit/hardening-2026-07-08/qa-review-2.md` — final approve or rework list

- [ ] **Step 1: Generate the full branch diff**

Run: `git diff main...hardening-2026-07-08 --stat > docs/audit/hardening-2026-07-08/full-branch.diffstat`

- [ ] **Step 2: Dispatch the Fable final QA agent**

Use the `Agent` tool with `model: fable`, `run_in_background: false`, prompt:

```
This is the final QA pass over the entire app-wide hardening branch
(hardening-2026-07-08) before it goes back to the human owner for a merge
decision. Batches 1-2 already passed a QA review
(docs/audit/hardening-2026-07-08/qa-review-1.md); focus your attention on
Batches 3-5 (Tests, Release Engineering, Polish) plus a final sanity check of
the whole branch.

Read docs/audit/hardening-2026-07-08/full-branch.diffstat for an overview of
everything changed, then review the diffs for Batches 3-5 against
docs/audit/hardening-2026-07-08/03-approved-plan.md sections 3-5. Specifically
check: do the new tests (D1-D3) actually test meaningful behavior, or are they
shallow/tautological? Does the CI workflow (D4) actually run lint+test+build?
Was the xlsx tarball vendored correctly without silently switching to the
stale npm package? Does the EDIT_LOG truncation (C5) actually reduce bundle
size without breaking the ChangeLog tab? Are accessibility and print-CSS
changes (E1-E2) real fixes, not cosmetic-only?

Write your findings to docs/audit/hardening-2026-07-08/qa-review-2.md: either
"APPROVED — ready for final verification" with a summary, or a numbered
rework list with file:line citations.
```

- [ ] **Step 3: Act on the review**

If APPROVED, proceed to Task 13. If rework items exist, dispatch targeted follow-up agents per item (matching the model each batch used), then re-run Step 2.

---

## Task 13: Orchestrator inline items (no agent dispatch)

**Files:**
- Create: `docs/SECURITY_MODEL.md`

**Interfaces:**
- Consumes: the existing "Security model — advisory only" note in `CLAUDE.md`'s auth section
- Produces: `docs/SECURITY_MODEL.md` (D6); performance and UAT notes appended to the final report in Task 14

- [ ] **Step 1: Write D6's security model doc**

Create `docs/SECURITY_MODEL.md` expanding on CLAUDE.md's existing advisory-only note: no backend, all role/permission checks run client-side, business data is plain JSON on disk, a determined user can edit `localStorage` or workspace JSON files directly to self-elevate or tamper, the bootstrap admin hash ships in the client bundle (must be a strong, offline-crack-resistant passcode), and this app is not a defense against malicious insiders — it's a UX/role-routing guard only.

- [ ] **Step 2: Commit**

```bash
git add docs/SECURITY_MODEL.md
git commit -m "docs(hardening): D6 security model doc"
```

- [ ] **Step 3: E3 — performance validation**

Start the dev server, import a large (~300k row) test dataset if available (or the largest realistic sample on hand), and time: import duration, processing duration, and table interaction latency (scrolling/filtering/sorting in `DataTable` with a large row count). Record the numbers — these go in the Task 14 final report, not a separate file.

- [ ] **Step 4: E4 — UAT walkthrough**

Using the preview tools, walk through the golden path end-to-end: log in → import population → process → draw sample → distribute → answer as an employee → generate a report. Note any friction or regressions found during Batches 1-5.

- [ ] **Step 5: E5 — final readiness re-rating**

Re-read `docs/audit/MASTER_AUDIT_REPORT.md`'s readiness criteria and re-rate the app against them given everything landed in this pipeline. This feeds directly into Task 14's report.

---

## Task 14: Final verification and merge decision

**Files:** none (verification + reporting only)

- [ ] **Step 1: Run the full gate suite on the hardening branch**

Run: `npm run lint && npm run test:run && npm run build`
Expected: all three exit 0.

- [ ] **Step 2: Confirm EDIT_LOG completeness**

Run: `git diff main...hardening-2026-07-08 --name-only | grep -v EDIT_LOG` then cross-check every listed source file has a corresponding entry in `docs/EDIT_LOG.md`'s diff. Any gap must be filled before proceeding.

- [ ] **Step 3: Report to the user**

Summarize: which of the 22 roadmap items are now done (all except D8, which stays explicitly deferred), the final `dist/index.html` size, lint/test/build status, the E3 performance numbers and E4 UAT findings from Task 13, and the E5 readiness re-rating.

- [ ] **Step 4: Invoke the finishing-a-development-branch skill**

Use `superpowers:finishing-a-development-branch` to present the user with merge/PR/cleanup options for `hardening-2026-07-08`. Do not merge to `main` without their explicit choice.
