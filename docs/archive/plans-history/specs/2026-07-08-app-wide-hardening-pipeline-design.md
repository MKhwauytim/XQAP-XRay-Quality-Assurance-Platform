# App-wide hardening pipeline — design

**Date:** 2026-07-08
**Status:** approved, ready for implementation plan

## Goal

Finish the tracked production-readiness roadmap in `docs/audit/FULL_SYSTEM_AUDIT_2026-07-02.md` (Milestones B4–B6, C1–C6, D1–D8, E1–E5) rather than re-auditing the app from scratch. This covers the user's named areas — storage, data structure/JSON, processing, sampling, distribution, permissions, visuals, tables, sign-in — because those are exactly what the 2026-07-02 audit already assessed.

**Explicitly out of scope for this effort:** the executive-report/deck2 swap (`deck-preview.html` → default report). That is a separate, already-scoped follow-up (see memory `executive-deck-v2-rework`) and gets its own design + plan after this hardening pass lands, per the user's chosen sequencing.

## Product decisions (unblock planning)

- **C2 (تقرير الإدارة / management report):** build it now, as part of the product-completeness batch. Not hidden/deferred.
- **C5 (EDIT_LOG-in-bundle policy):** truncate `docs/EDIT_LOG.md` to the last N versions at build time. Full history stays in git; only the bundle import is capped. (N to be decided during implementation — reasonable default, e.g. last 20 versions or last 90 days, whichever the implementer finds cleaner given the log's structure.)
- **Demo mode audience:** internal-only testing aid. Seed data (C1) stays minimal/functional, not showcase-polished. Static passcode is fine — no rotation work needed.

## Why this pipeline shape (not a from-scratch audit, not one-agent-per-fix)

An initial proposal (9 per-tab Sonnet analysis agents → 1 Opus plan → 1 Fable review → ~15-20 per-item implementation agents → Fable QA, ~30 dispatches total) was reviewed by a Fable agent for efficiency. Findings that changed the design:

- A nine-agent per-tab audit pass **already happened** in a prior session (commit `b75edc05` and the Tier-1 W1–W9 work, largely landed through EDIT_LOG v42.x). Re-running per-tab analysis from zero would duplicate absorbed work.
- The 22 open roadmap items are **category-shaped, not tab-shaped** — B4–B6 are cross-cutting CSS/table sweeps, D is tests/CI/process, E is verification. Splitting by tab guarantees redundant reads of shared modules (`src/data/*`, `DataTable`).
- Several items are decisions or docs, not code (now resolved above), and E3–E5 (performance timing, UAT walkthrough, final go/no-go) require a live browser and judgment — routing them through an agent just adds a relay hop for no benefit.

This produced a leaner pipeline: **10 dispatches instead of ~30 (~66% cut)**, preserving the user's intended shape (Sonnet understands → Opus plans → Fable reviews/enhances/triages → implementation → Fable approves) while eliminating redundant re-reads and per-item micro-dispatches.

## Pipeline

| Stage | Dispatches | Model | Input | Output |
|---|---|---|---|---|
| 1. Status check | 1 | Sonnet | The 22-item roadmap list + current repo | One status table: fixed / partially fixed / open, per item, with current-code evidence (audit is ~40 commits stale) |
| 2. Unified plan | 1 | Opus | Audit docs + Stage-1 status table (reads code only to resolve items flagged "partial/unclear") | One cross-batch plan: the 5 implementation batches below, sequencing, acceptance criteria, draft importance/difficulty per item |
| 3. Triage review | 1 | Fable | Opus's plan + Stage-1 table (docs-only, no repo reads) | Enhancements + finalized Opus-vs-Sonnet assignment per batch — **this is the user-approved execution plan** |
| 4. Implementation | 5 | 4× Sonnet, 1× Opus | Its own plan section embedded verbatim in the dispatch prompt (no re-reading audit docs) | Code changes on a dedicated branch, EDIT_LOG entries per CLAUDE.md, tests/lint run per batch |
| 5. QA | 2 | Fable | Diffs from the batches | Approve or send back for rework |

### Implementation batches (Stage 4)

1. **Visual system (Sonnet)** — B4 token sweep (one CSS file per commit, screenshot-diff before/after, worst offenders first: EmployeeWorkspace, Reports, DataTable), B5 table polish, B6 spacing rhythm.
2. **Product completeness (Sonnet)** — C1 demo seed data (internal-only tier), C2 finish تقرير الإدارة, C3 first-run admin checklist, C4 error-ring-buffer diagnostics panel, C5 EDIT_LOG truncation-at-build, C6 label coverage audit.
3. **Tests (Opus)** — D1 component/workflow tests (Testing Library + `createMemoryDirectory()`, happy-path + failure-path per workflow), D2 XSS-escaping tests for report builders, D3 import-mapping edge-case tests. Highest correctness stakes — the one batch where Opus's extra care is worth the cost.
4. **Release engineering (Sonnet)** — D4 CI workflow (OPS-01), D5 vendor the xlsx CDN tarball, D7 version stamp/release checklist.
5. **Polish (Sonnet)** — E1 accessibility pass, E2 print/report CSS.

**Deferred, not in this pass:** D8 (oversized-file refactor, e.g. `Population/index.tsx` split) — the audit itself marks it "ongoing, one file per PR," and doing it mid-hardening would churn every other batch's diffs. Revisit after this pass lands.

**Orchestrator does inline (no agent dispatch):** D6 (one-page `SECURITY_MODEL.md`, informed by the existing security-model note in CLAUDE.md), lint/test/build gates after every batch, E3 (perf timing on a large import), E4 (UAT walkthrough via preview tools), E5 (final readiness re-rating against `MASTER_AUDIT_REPORT.md`).

## Safety / branch strategy

All Stage 4 work happens on a dedicated branch (e.g. `hardening-2026-07-08`), not `main`. Nothing merges without the user's explicit sign-off at the end (finishing-a-development-branch flow). Each batch runs its own `npm run lint` / `npm run test:run` before being handed to Stage 5 QA; final `npm run build` + browser verification happens after Fable's final QA pass.

## Success criteria

- All 22 roadmap items are either done, explicitly deferred with reason (only D8), or resolved as a decision (C2/C5/demo audience — done above).
- `npm run lint`, `npm run test:run`, and `npm run build` all pass on the hardening branch.
- No regressions in existing UI flows (verified via preview tools for visual/table/permission changes).
- `docs/EDIT_LOG.md` has an entry for every edit, per CLAUDE.md's mandatory requirement.
