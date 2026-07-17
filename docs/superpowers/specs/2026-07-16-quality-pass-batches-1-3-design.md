# Quality Pass — Batches 1-3 (Correctness, Test-Truth, A11y) Design Spec [DONE — merged to main]

- **Date:** 2026-07-16
- **Status:** ✅ DONE — implemented (9 tasks), reviewed (2 rounds: task-level + whole-branch, catching 1 Critical regression + 1 Important gap along the way), and merged to main via [PR #21](https://github.com/MKhwauytim/XQAP-XRay-Quality-Assurance-Platform/pull/21) (2026-07-17). Implementation plan: `docs/superpowers/plans/2026-07-16-quality-pass-batches-1-3.md`.
- **Scope:** Fix the 7 real, evidence-backed findings from `.superpowers/sdd/app-quality-survey.md` that the survey itself scoped as safe for an unattended fix pass (Batches 1-3), plus one carried-over follow-up (I-2) from the just-merged global-month-selector feature's final review. Batch 4 (date-parsing locale policy, governance-log viewer, component splitting, hardcoded-Arabic sweep) is explicitly excluded — the survey labels those as product/scope decisions requiring owner input, not overnight fixes, and this spec respects that boundary.

## Background

A read-only agent survey (2026-07-16) cross-referenced three prior audit documents (`docs/audit/MASTER_AUDIT_2026-07-13.md`, `docs/audit/hardening-2026-07-08/*`) against current source and ran a direct codebase scan (error-swallowing, type-safety erosion, dead code, missing tests, async-race patterns, a11y spot-checks, hardcoded strings). Result: zero Critical findings, everything from prior audits already fixed except deliberately-deferred product decisions, and a short list of 1 Important + 6 Minor new findings — evidence for each already gathered (file:line, concrete failure scenario). This spec turns that evidence-backed list into implementation scope; no further discovery work is needed.

## Findings in scope

### I-1 (Important) — Reports month-summary chips can show a stale month's numbers

`src/components/Sidebar/Tabs/Reports/index.tsx:183-213`. The `monthMeta` load effect has no cancellation/staleness guard, unlike the KPI-model effect immediately below it (`:255-261`, which uses `let cancelled = false`). Rapid month switching (select A → slow load starts → switch to B → B's load starts → A's load resolves after B's) lets `setMonthMeta({folderName: A, ...})` land last, showing month A's population/sample/studied counts while month B is selected — persists until the next switch. Cosmetic-but-wrong (only the three summary chips; exports and the KPI dashboard are unaffected — the KPI effect already guards correctly).

**Fix:** apply the same `let cancelled = false` pattern the KPI effect already uses, immediately below in the same file — this is a proven, in-file precedent, not a new pattern.

### I-2 (Important, carried over from the global-month-selector final review) — Overlapping-load race in Population's `handleLoadExistingMonth`

`src/components/Sidebar/Tabs/Population/index.tsx:287-438`. The auto-load effect (`:414-438`) calls `handleLoadExistingMonth` whenever the global month selection changes to an existing folder, with no per-call token — so a rapid double-switch (select month A → load starts → before it resolves, select month B → load B starts) can race:
- The shared `isLoadingMonthData` boolean gets cleared by whichever call's `finally` runs first — if A's slower load finishes loading but B's is still in flight, A's `finally { setIsLoadingMonthData(false) }` drops the flag early, reopening the write-guard window (`canDrawSample`/`canDistributeSamples`/`canBulkAssign`, and the explicit `isLoadingMonthData` checks in `handleProcessPopulation`/exports/`handleApproveSample`) while B's data still doesn't match `saveMonth`/`saveYear`.
- The `.catch()` handler's `resetForNewMonth()` (`:425-433`) runs unconditionally on ANY rejection — if load A's promise rejects *after* load B has already resolved successfully and populated the screen with B's legitimate data, A's catch wipes it, turning "stale data left visible" into "valid newer data destroyed."

Narrower than the original bug this final-review round fixed (needs two switches within one load's duration, not just one), and was explicitly logged as a non-blocking follow-up when the global-month-selector branch merged.

**Fix:** apply the same load-token pattern already used in `useApprovalData.ts`/`XrayInspectionResults.tsx`/`XrayReferrals.tsx` this session. Concretely: add a `loadMonthTokenRef` next to the existing `loadedFolderRef`; the auto-load effect captures `const token = ++loadMonthTokenRef.current;` right before calling `handleLoadExistingMonth`, now passed as a second parameter; inside `handleLoadExistingMonth`, check `token === loadMonthTokenRef.current` once, immediately after the `await loadMonthForEditing(...)` resolves — if stale, return before touching any state — and gate the `finally`'s `setIsLoadingMonthData(false)` on the same check; the effect's `.catch()` handler checks the same token before applying `resetForNewMonth()`, so a superseded rejection becomes a no-op instead of wiping newer data.

### M-1 (Minor) — Management document report has no XSS test; its own comment claims it does

`src/data/reporting/management/managementReport.ts:9-12` states it's "part of the D2 XSS test set," but `src/data/reporting/reportBuilders.xss.test.ts` only imports/asserts `buildManagementDeck` (`:16,:121`), never `buildManagementReport`/`openManagementReport`. The builder does route all interpolated values through `esc()` (51 sites) — real risk is low — but the claimed coverage is absent and the comment is inaccurate, which is a test-truth problem independent of actual risk.

**Fix:** add an `assertSafe(buildManagementReport(maliciousInput))`-style case to the existing XSS test file, mirroring the existing `buildManagementDeck` test's structure and malicious-payload fixtures.

### M-2 (Minor) — Report-design per-id write is not CAS-protected, unlike the template equivalent

`src/data/reportDesigner/storage/reportDesignStorage.ts:81` writes `{reportId}.json` via plain `safeWriteJson`, while the structurally-identical `templateStorage.ts:54-95 saveTemplateFile` wraps the same per-id-doc shape in casLoop + delayed verify. Two people editing the same report design on two machines would silently last-writer-wins clobber with no revision detection.

**Fix:** mirror `saveTemplateFile`'s casLoop wrapping in `reportDesignStorage.ts`'s per-id save function.

### M-3 (Minor) — casLoop delayed-verify applied unevenly, no documented rationale for the split

`userSync.ts`, `templateStorage.ts saveTemplateFile`, and `answerStorage.ts` pass the delayed `verify` re-read (closes the A-commit/B-commit-after lost-update window); `feedbackStorage.ts:100`, `authActivityLog.ts:136`, `monthLock.ts:164/231`, and both index writers (`templateStorage.ts:30`, `reportDesignStorage.ts:52`) use in-attempt read-back only, with no comment explaining why those specific files are exempt.

**Fix:** add a one-line rationale comment at each in-attempt-only call site explaining why delayed verify isn't needed there (e.g., single-writer-by-convention, low-contention, or genuinely lower risk than the answers/template/userSync files) — a documentation fix, not a behavior change, UNLESS the rationale-writing process surfaces a site that genuinely should have delayed verify (in which case, add it, matching M-2's treatment of `reportDesignStorage.ts`'s per-id writer). `monthLock.ts` (governs whether a closed month stays frozen) is the one call site to scrutinize most carefully — if no defensible reason emerges for its exemption, add delayed verify there rather than just documenting an absence of one.

### M-4 (Minor) — Two disk-touching modules have no dedicated test

`src/data/templates/templateSelectionStorage.ts` (active-template pointer, last-writer-wins acceptable — single value, no RMW) and `src/data/answers/employeeXlsx.ts` (XLSX export writer, no RMW) have no `.test.ts`.

**Fix:** add a minimal `.test.ts` for each covering its actual read/write contract (using `createMemoryDirectory()` per repo convention) — not exhaustive coverage, just closing the "zero tests" gap for modules that do real disk I/O.

### M-5 (Minor) — ReportDesigner drag-drop `JSON.parse` is unguarded

`src/components/Sidebar/Tabs/ReportDesigner/index.tsx:375` — `JSON.parse(e.dataTransfer.getData("application/x-rd-field"))` has no try/catch. The payload is produced by the app's own drag source (no concrete failure path today), but a malformed external drop would throw uncaught into the drop handler.

**Fix:** wrap in try/catch; on parse failure, no-op the drop (matching how the rest of the app treats malformed/unexpected external input — fail closed, not a crash).

### M-6 (Minor) — "New month" popover isn't focus-trapped

`src/components/GlobalMonthSelector/GlobalMonthSelector.tsx:108` — the popover is correctly `role="dialog"` with Escape/outside-click dismissal (a11y is otherwise good here), but doesn't use the shared focus-trap hook the E1 pass added to other dialogs, and doesn't auto-focus on open. A keyboard-only user can tab out of the popover into the page behind it.

**Fix:** reuse the existing focus-trap hook (`src/hooks/useFocusTrap` per its use elsewhere, e.g. `AuthGate.tsx`) on the popover, matching the pattern already established for other dialogs in this codebase.

## Explicitly out of scope (Batch 4 — deferred, not touched by this spec)

- C-16 date-parsing day-first ambiguity (`populationProcessor.ts:232-242`) — needs a product decision on locale policy, not a code fix.
- C-15 governance audit log has no viewer — a net-new feature (a log viewer UI), not a bug fix.
- ARC-01 oversized components (`Population/index.tsx`, `Reports/index.tsx`, `XrayReferrals.tsx`) — a restructuring decision, not a defect.
- Hardcoded-Arabic string sweep (~54 files) — a separate, large labelling initiative already tracked in prior audits.
- E1 WCAG AA contrast failures — the survey did not re-verify these pixel-by-pixel this pass; not re-scoped here without fresh evidence.
- D3 import-mapping ambiguities — the survey notes a prior test-only fix never addressed the underlying behavior; needs its own investigation, not folded in here.
- Executive deck v1 subtree — intentionally retained, tree-shaken from prod; no action needed.

## Testing

- I-1: extend or add a component/hook-level test exercising the rapid-switch race (mirroring the load-token/cancellation regression tests already written this session for the global-month-selector feature — same failure class, same test shape).
- I-2: extend `Population.wizard.test.tsx` (or add a focused new test file) with a regression test mirroring the exact fail-first pattern used for the `useApprovalData` load-token fix this session: mock a slow-then-fast pair of `loadMonthForEditing` resolutions, switch the global month selection twice in quick succession, and assert the final committed state matches the SECOND (later) selection, not the first.
- M-1: new XSS assertion in the existing `reportBuilders.xss.test.ts`.
- M-2: extend `reportDesignStorage`'s existing test file (or add one if none exists) to cover the CAS/conflict path, mirroring `templateStorage`'s existing CAS test.
- M-3: no new tests required for pure comment additions; if a site gets upgraded to delayed verify (per the `monthLock.ts` scrutiny above), add a regression test mirroring the pattern used for the sites that already have it.
- M-4: new minimal test files for both modules.
- M-5: a test asserting a malformed drag payload doesn't throw.
- M-6: a test or manual-verification note confirming Tab/Shift+Tab stays inside the popover while open (component test if the existing focus-trap hook has test precedent to follow; otherwise manual verification, documented as such).

## Documentation

- `docs/EDIT_LOG.md`: entries per CLAUDE.md's requirement, decimal version bump (small fixes, not a major feature).
- No CLAUDE.md architecture changes expected (no new modules, no new conventions — all fixes apply existing repo patterns to previously-inconsistent spots).
