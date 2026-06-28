# Production-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take x-ray-quality-app-v1 from "Internal testing ready" to "Controlled production ready" through evidence-based hardening — without a blind rewrite and without breaking working behavior.

**Architecture:** Browser-only React 19 + TS + Vite SPA, File System Access API persistence, client-only advisory auth. The plan preserves this architecture; it does **not** introduce a backend unless the user explicitly requests one (that would be a separate spec).

**Tech Stack:** React 19.2, TypeScript ~6.0 (strict), Vite 8 + vite-plugin-singlefile, Vitest, hash-wasm (Argon2id), xlsx (SheetJS CDN), recharts.

## Global Constraints

- TypeScript strict mode; **zero** `any`/`as any` in new code (current baseline is 0).
- Every code edit MUST be recorded in `docs/EDIT_LOG.md` (semver-lite) **before** applying it — per CLAUDE.md.
- UI text Arabic + RTL; prefer adding label keys in `labelsStore.ts` over hardcoding strings.
- `safeWriteJson` for all workspace JSON writes; never bypass it. Guard `createWritable` with `if (!fh.createWritable) return;`.
- Do not "upgrade" the `xlsx` CDN tarball dependency.
- All four gates must pass after every task: `npm run typecheck`, `npm run lint:ci`, `npm run test:run`, `npm run build`.
- One concern per commit; frequent commits; no unrelated changes within a phase.

---

## Execution model

Each phase below lists **Objective, Scope, Tasks, Files, Dependencies, Risks, Effort, Acceptance, Test requirements, Rollback, Completion evidence**. Phases are ordered by risk-reduction value. **Do not start a phase until the previous phase's acceptance criteria are met with evidence.**

Because the codebase is healthy (all gates green), Phases 0–3 are the high-value core; Phases 4–9 are debt/quality/governance and should be scheduled per the user's priorities.

---

## Phase 0 — Baseline & Safety

**Objective:** Establish a clean, tagged, all-green baseline and a working rollback before any change.

**Scope:** Git hygiene of the existing uncommitted work; baseline capture. No feature changes.

**Tasks:**
- [ ] Run all four gates; record outputs in `docs/audit/BASELINE.md`.
- [ ] Triage the 26 modified + 11 untracked files. For each coherent group (auth persistence, activity log, branding, tests, data-system doc), decide: commit, split, or revert. (DATA-01)
- [ ] Commit reviewed work in coherent commits with EDIT_LOG entries; or stash/revert what is not ready.
- [ ] Tag the resulting clean commit `baseline-prod-readiness-2026-06-28`.
- [ ] Document the rollback procedure (git tag + `dist/` backup) in `BASELINE.md`.

**Files:** working tree; `docs/audit/BASELINE.md` (create); `docs/EDIT_LOG.md`.
**Dependencies:** none. **Risks:** committing half-finished work — mitigate by gates-green requirement per commit.
**Effort:** M. **Acceptance:** Clean `git status`; tag exists; all four gates green at the tag; rollback documented.
**Test requirements:** full suite green. **Rollback:** `git reset --hard <tag>`.
**Completion evidence:** `BASELINE.md` with gate outputs + tag hash.

## Phase 1 — Critical Failures

**Objective:** Fix anything that crashes, loses data, or breaks build/startup.

**Scope:** Only confirmed critical defects. (Current sweep found none at gate level — this phase validates that under real workflows.)

**Tasks:**
- [ ] Manually exercise critical workflows in `npm run dev` (Chromium): workspace pick → login → import (small + large file) → process → sample → distribute → answer → report → backup. Record any crash/data-loss as a new Critical/High finding.
- [ ] For each confirmed critical defect: write a failing test, fix, verify (systematic-debugging skill).
- [ ] Confirm the recent "300k-row BI parse failure" fix (commit c5c4bd4f) holds with a large-input test.

**Files:** TBD by findings; `Population/` import path, `workbookWorker.ts`, sampling.
**Dependencies:** Phase 0. **Risks:** large-file testing is slow — use a representative fixture.
**Effort:** M–L. **Acceptance:** All critical workflows complete without crash/data-loss; each fix has a regression test.
**Test requirements:** new regression test per defect; large-input parse test. **Rollback:** per-commit revert.
**Completion evidence:** workflow checklist with pass/fail + test names.

## Phase 2 — Broken & Unwired Features

**Objective:** Ensure every UI action is wired to working logic with feedback.

**Scope:** Button/menu/form/dialog audit across all tabs.

**Tasks:**
- [ ] Inventory every interactive control per tab (Population, EmployeeWorkspace views, TemplateBuilder, Reports, Archive, UserManagement, Settings). Mark each: Working / Working-with-issues / Unwired / Missing-feedback.
- [ ] For each gap: wire the action, add loading + success + error feedback, add validation.
- [ ] **ERR-01:** Audit all ~27 `.then()` sites; add `.catch()` → `logError` + user-visible error/empty state; mark intentional fire-and-forget with `void`.

**Files:** all `Tabs/*/index.tsx` + views; `src/data/storage/errorLogger.ts`.
**Dependencies:** Phase 0. **Risks:** scope creep — limit to wiring/feedback, defer redesign to Phase 6.
**Effort:** L. **Acceptance:** Control inventory shows no Unwired/Missing-feedback items; floating promises eliminated.
**Test requirements:** failure-path test for each critical loader (ERR-01). **Rollback:** per-commit revert.
**Completion evidence:** control inventory table committed under `docs/audit/`.

## Phase 3 — Data Integrity & State

**Objective:** Single source of truth; correct mappings; recoverable failures.

**Scope:** Persistence, import/export field mapping, schema/envelope versioning, recovery.

**Tasks:**
- [ ] Verify import field mapping preserves all required fields (no silent drops) — add a mapping test with extra/missing columns.
- [ ] Verify `JsonEnvelope` revision increments and `safeReadJson` `.bak` recovery under a corrupted live file — extend existing storage tests.
- [ ] Confirm no business data is stored in two conflicting places; reconcile if found.
- [ ] **SEC-02:** Decide and implement session-persistence policy (persist vs. runtime-only vs. sessionStorage); align code + docs.

**Files:** `src/data/storage/*`, `src/data/population/*`, `Population/processing/*`, `src/auth/authSession.ts`.
**Dependencies:** Phases 0–1. **Risks:** changing persistence can strand existing on-disk data — provide migration/legacy-read path; never change a schema without a migration note.
**Effort:** L. **Acceptance:** mapping + recovery tests green; session policy aligned and tested; no conflicting sources.
**Test requirements:** corrupt-file recovery, mapping edge cases, session rehydration/expiry/logout. **Rollback:** per-commit revert.
**Completion evidence:** updated tests + decision record.

## Phase 4 — Architecture & Code Quality

**Objective:** Reduce blast radius of the oversized files (ARC-01) safely; remove confirmed dead code.

**Scope:** One large file per PR, behind characterization tests.

**Tasks (repeat per target file):**
- [ ] Write characterization tests capturing current public behavior of the target component.
- [ ] Extract cohesive units (custom hooks, presentational components, pure helpers) with no behavior change.
- [ ] Re-run characterization tests + all gates; confirm identical behavior.
- [ ] Detect dead/unreachable code in the file (confirm unused before deleting — never delete legacy code unverified).

**Files:** `Population/index.tsx`, then the other >1000-line files in priority order.
**Dependencies:** Phase 0; ideally after Phase 2 wiring stabilizes. **Risks:** behavior regression — mitigated by characterization tests before refactor.
**Effort:** L per file. **Acceptance:** target file materially smaller; characterization tests green before+after; gates green.
**Test requirements:** characterization tests committed before the refactor commit. **Rollback:** per-file revert.
**Completion evidence:** before/after LOC + test run.

## Phase 5 — Performance & Stability

**Objective:** Keep large-data operations stable with progress + cancellation.

**Scope:** Import/parse pipeline, large table rendering, report generation.

**Tasks:**
- [ ] Profile import of a large file (build on the 300k-row fix); confirm chunking + progress + no main-thread block.
- [ ] Audit large `DataTable` rendering for unbounded lists; add virtualization/pagination only if a measured problem exists (YAGNI).
- [ ] Check report builders for synchronous heavy loops; add progress/cancel where the UI blocks.

**Files:** `workbookWorker.ts`, `Population/processing/*`, `DataTable/index.tsx`, `reporting/*`.
**Dependencies:** Phases 0–1. **Risks:** premature optimization — measure before changing.
**Effort:** M. **Acceptance:** documented before/after timings for the slowest workflow; no UI freeze on large input.
**Test requirements:** large-input timing harness (manual is acceptable, recorded). **Rollback:** per-commit revert.
**Completion evidence:** timing notes in `docs/audit/`.

## Phase 6 — UI & UX

**Objective:** Consistency, accessibility, feedback, RTL correctness — usability gains only, not cosmetic redesign.

**Scope:** Empty/loading/error states, confirmation on destructive actions, keyboard/focus, contrast, RTL.

**Tasks:**
- [ ] Audit each tab for missing empty/loading/error states and add them.
- [ ] Ensure destructive actions (delete month, replace assignment, user delete) require confirmation and are not adjacent to common actions.
- [ ] Accessibility pass: focus management in dialogs, keyboard nav, contrast, `aria-*` on icon-only buttons (use chrome-devtools a11y skill).
- [ ] Verify RTL layout has no LTR leaks.

**Files:** all tabs/components; `*.css`.
**Dependencies:** Phase 2. **Risks:** subjective scope — every change must cite a usability/a11y reason.
**Effort:** L. **Acceptance:** a11y audit issues resolved or tracked; all destructive actions confirmed; consistent states.
**Test requirements:** a11y checks; component tests for confirmation flows. **Rollback:** per-commit revert.
**Completion evidence:** a11y audit report.

## Phase 7 — Security & Governance

**Objective:** Make the trust model explicit and harden what is cheap regardless.

**Scope:** SEC-01 risk acceptance, SEC-02 session policy (if not done in Phase 3), input validation/sanitization, audit-log completeness, file-handling validation.

**Tasks:**
- [ ] **SEC-01:** Record written risk acceptance of the client-only model; verify bootstrap admin passcode strength guidance.
- [ ] Validate/sanitize all user input that flows into generated HTML reports (XSS in self-contained HTML output) — confirm escaping in `reportHtmlBuilder.ts` / `htmlReport.ts`.
- [ ] Ensure administrative actions are captured in the activity/audit log (`authActivityLog.ts`).
- [ ] Validate imported file content (type/shape) before processing; reject malformed gracefully.

**Files:** `src/auth/*`, `reporting/*`, `Population/biData|riskData/*`.
**Dependencies:** Phase 0. **Risks:** over-engineering security on an explicitly-advisory model — focus on XSS-in-report and input validation, which matter regardless of trust model.
**Effort:** M. **Acceptance:** report output proven XSS-safe with a test; admin actions audited; malformed-input handling tested.
**Test requirements:** XSS-injection test on report builder; malformed-import test. **Rollback:** per-commit revert.
**Completion evidence:** security checklist + tests.

## Phase 8 — Testing & Documentation

**Objective:** Close the coverage gap (TEST-01) and fix doc drift (DOC-01).

**Tasks:**
- [ ] Add component tests for the largest interactive components and ≥1 happy-path integration test per workflow (`createMemoryDirectory`).
- [ ] **DOC-01:** Update CLAUDE.md (disk layout → numbered roots, bundle size, session behavior); cross-link `data-system-report.md`.
- [ ] Add/refresh: README, architecture overview, setup/build/deploy, data-model & recovery guide, troubleshooting.
- [ ] Update `docs/EDIT_LOG.md` and a CHANGELOG/release notes.

**Files:** `src/**/*.test.tsx`, `CLAUDE.md`, `README*`, `docs/*`.
**Dependencies:** features stable (Phases 1–3). **Risks:** none significant.
**Effort:** L. **Acceptance:** critical workflows have automated coverage; docs match code (re-verify the three DOC-01 drifts).
**Test requirements:** the new tests themselves. **Rollback:** per-commit revert.
**Completion evidence:** coverage delta + doc diff.

## Phase 9 — Production & Enterprise Readiness

**Objective:** Final validation and readiness sign-off.

**Tasks:**
- [ ] **OPS-01:** Add CI (typecheck, lint:ci, test:run, build).
- [ ] Validate deployment of `dist/index.html` in target Chromium env; document the process.
- [ ] Validate backup/recovery end-to-end (`.system` backups + `.bak` recovery).
- [ ] Re-run the §17 final-readiness checklist from the request; record evidence per item.
- [ ] Produce the final report with rating.

**Files:** `.github/workflows/ci.yml` (create), `docs/audit/FINAL_REPORT.md`.
**Dependencies:** all prior phases. **Risks:** CI can't reach the xlsx CDN — document workaround.
**Effort:** M. **Acceptance:** CI green on PR; deployment + backup/recovery validated; final report with evidence-based rating.
**Completion evidence:** `FINAL_REPORT.md`.

---

## Self-review against the request

- Request §1–12 (review areas) → covered by Phases 1–9 findings + the Master Audit Report.
- §13 (master audit report) → `docs/audit/MASTER_AUDIT_REPORT.md`.
- §14 (phased plan) → this document, with all required per-phase fields.
- §15 (execution rules) → encoded as the per-task gates + EDIT_LOG + evidence requirements.
- §16 (restrictions) → encoded in Global Constraints + "no blind rewrite / confirm before delete / migration for schema changes".
- §17 (final verification) → Phase 9.

**Honesty note:** the app passes all gates today, so this plan is hardening, not rescue. Findings not yet line-audited (per-module dead code, full data-mapping correctness, full a11y) are scheduled to be *confirmed* in their phase rather than asserted now.
