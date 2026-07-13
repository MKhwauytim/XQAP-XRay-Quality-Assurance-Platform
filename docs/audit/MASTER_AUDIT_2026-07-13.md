# Master System Audit — 2026-07-13

Multi-agent audit (8 parallel domain scanners → orchestrator verification). Client: ZATCA-grade deployment, 9+ concurrent employees, shared-folder storage, no backend, single static HTML output.

All P0/P1 findings below were re-verified against source by the orchestrator before acceptance. Companion docs: `docs/PRODUCT_PAGES.md` (page-by-page product description), `docs/GAP_ANALYSIS.md` (gaps & enhancements).

## Executive summary

The codebase is well-architected (append-only logs, JSON envelopes, safe-write layer, seeded sampling) but has **one systemic P0 concurrency defect** (the CAS loop is verify-after-write, not compare-before-write — silent lost updates between machines), **a cluster of state-machine holes** in the distribution fold (completed rows can silently regress to pending), **wiring defects in the permission system** (matrix cells that do nothing), and **a fragmented report system** where only the executive report has the full deck/workbook/document treatment. No live XSS was found, but escaping is implemented three times with different strictness and two report builders have zero test coverage.

## P0 — Data loss / broken core flow

| ID | Finding | Location | Status |
|----|---------|----------|--------|
| A-01 (S2-01/S4-01) | `casLoop` detects a conflict only if the competing write lands between its own write and read-back. Interleaving: A reads rev5 → B reads rev5 → A writes rev6+verifies OK → B writes rev6 (clobbers A) + verifies OK. Both report success; A's events (audit entries, distribution events, approvals, answers) silently vanish. Affects every casLoop consumer (15+ call sites). | `src/data/storage/casLoop.ts:34-61` | VERIFIED — fix wave 1 |
| A-02 (S6-01) | ReportDesigner KPI cards read raw `population.final.json` rows but the field catalog mirrors `ExecutiveReportRow` — 21 of 24 fields silently compute 0/empty. Report authors get wrong numbers with no error. | `fieldCatalog.ts:7-32`, `KpiRenderer.tsx:29-95` | VERIFIED — fix wave 2 |

## P1 — Wrong behavior users will hit

| ID | Finding | Location | Status |
|----|---------|----------|--------|
| B-01 (S4-02) | Re-running bulk assignment emits fresh `assigned` events for ALL rows; fold flips `completed` → `pending` (terminal guard only protects `replaced`). Double-click or two supervisors = submitted inspections silently un-completed/reassigned. | `bulkAssignment.ts:45-206`, `distributionLog.ts:209-223` | VERIFIED — wave 1 |
| B-02 (S4-03/S4-08) | Instant-replace path uses the stale in-memory entry captured at dialog-open; no freshness re-check before `executeReplacement` (unlike the approval path, which reloads). Double replacement / silent reassignment possible. | `XrayReferrals.tsx:589-638`, `replacement.ts:132-156` | VERIFIED — wave 1 |
| B-03 (S4-04) | Employee queue prefers the possibly-stale on-disk mirror over the fresh distribution state computed in the same function. | `XrayReferrals.tsx:455` | VERIFIED — wave 1 |
| B-04 (S4-05/S2-06) | Mirror writes are unordered fire-and-forget with no monotonic `sourceLogRevision` guard — an older derivation can clobber a newer mirror. | `distributionStorage.ts:200-203`, `sampleMirrorStorage.ts:30-71` | VERIFIED — wave 1 |
| B-05 (S3-01/S3-04) | `saveMonthRun` writes 5 month files with no lock/CAS (unlike `updateMonthStatus`/`closeMonth`); re-process confirmation check is TOCTOU-racy. Two users processing the same month interleave and clobber. | `populationStorage.ts:167-289`, `Population/index.tsx:751-767` | VERIFIED — wave 1 |
| B-06 (S5-01) | Approval decisions are per-supervisor files; the already-reviewed check is read-only and CAS only covers the reviewer's own file. Two supervisors can both "win" on one request; `effectiveDecision` = latest timestamp, contradicting executed events. | `approveReferral.ts:59-128`, `approvalStorage.ts:93-168` | wave 1 |
| B-07 (S1-01/02/04, S7-04/05) | Permission matrix exposes editable cells that static `tabConfig.allowedRoles` makes permanently ineffective (settings/manager, reports/kpi/supervisor, user-management, change-log). Three independent gating layers with mismatched ids (`reports/kpi` vs `reports/analytics`). Admin toggles silently do nothing. | `userManagement.ts`, `Sidebar.tsx:96-98`, `Reports/index.tsx:62,817` | VERIFIED — wave 2 |
| B-08 (S3-02) | Data Accuracy Report matches by trimmed `xrayImageId` alone; real processing matches by normalized ID+port. The accuracy screen can contradict actual processing. | `DataAccuracyReport.tsx:143-160` vs `populationProcessor.ts:365-370` | wave 2 |
| B-09 (S8-01) | `"strict": true` is NOT set in any tsconfig despite CLAUDE.md documenting strict mode. | `tsconfig.app.json`, `tsconfig.node.json` | VERIFIED — wave 4 (enable + assess) |
| B-10 (S2-02) | casLoop retries terminal errors (permission revoked → `NotAllowedError`) as if they were write conflicts, then reports a misleading "write conflict" message. | `casLoop.ts:47-58` | wave 1 |
| B-11 (S2-03) | Workspace manifest + `users.permissions.json` are read via `readJsonFile` with no `.bak` recovery and no contentHash verification (unlike every other file via `safeReadJson`). Torn write bricks workspace entry for everyone. | `fileSystemAccess.ts:330-381` | wave 1 |
| B-12 (S6-02/03/04) | ReportDesigner Table/Chart elements fully unimplemented (disabled buttons + placeholders); tested query engine (`runQuery`/`aggregate`/`buildDataModel`) is dead code; live KPI path reimplements aggregation with divergent semantics; `topN` is a typed no-op. | `VizPanel.tsx:34`, `aggregations.ts` vs `KpiRenderer.tsx:51` | wave 2 (KPI); rest → GAP backlog |

## P2 — Quality / correctness / security hardening (selected; full list in scanner annexes)

- C-01 (S4-06) Unknown `eventType` in fold silently resets status to `pending` — add preserve-existing default branch. VERIFIED. Wave 1.
- C-02 (S4-09) Manual reassign silently un-completes rows, bypassing the reopen-approval workflow. Wave 1.
- C-03 (S6-06) CSV export has no formula-injection guard (`=`,`+`,`-`,`@`). VERIFIED. Wave 2.
- C-04 (S5-02/03) Per-employee column presets dead-wired: saves go to shared admin file; admin file wins over user file. Wave 1 (bundled with XrayReferrals work).
- C-05 (S5-05/07) Template document + template selection writes lack CAS. Wave 1.
- C-06 (S1-05) PBKDF2→Argon2id rehash never persisted to shared disk. Wave 2.
- C-07 (S6-05) `sampleReport.ts` / `distributionReport.ts` have zero XSS/data tests. Wave 3.
- C-08 (S6-08/S8-07) Three escaping implementations with different strictness (`esc`/`escHtml` don't encode `'`). Standardize. Wave 3.
- C-09 (S7-06) Single app-wide ErrorBoundary — one tab crash kills all tabs' state. Wave 2.
- C-10 (S7-11) Mixed digit systems: `Reports/index.tsx` `fmtCount` uses `ar-SA` (Arabic-Indic digits) vs app-wide `ar-SA-u-nu-latn`. Wave 3.
- C-11 (S2-05) Backup folder name second-granularity collision; restore not atomic (marker file). Wave 1 (name suffix only; atomic restore → backlog).
- C-12 (S2-08) `safeWriteJson` lock key uses leaf dir name only — cross-month lock collisions. Wave 1.
- C-13 (S1-06/07) No session-expired / forced-logout messaging. Wave 2.
- C-14 (S7-02) Feedback widget unreachable for non-admin roles (dead feature). Wave 2.
- C-15 (S7-03) Governance audit log (`actions.log.json`) written but has no viewer anywhere. → GAP backlog (feature).
- C-16 (S3-05) Date parsing assumes day-first; ambiguous US-locale dates silently mis-parsed. → GAP backlog (needs product decision).

## P3 / deferred to GAP_ANALYSIS.md

DataTable column sort (S7-01), draft-save for inspection forms (S5-04), audit-log viewer (C-15), per-sheet mapping-hint sampling (S3-08), label-key extraction sweep (S3-09/S7-08), design-system adoption (`.ui-btn`) (S7-07), focus traps in DataTable popovers (S7-10), dead code removals (deck2 wiring decision, `portEmployeeData`, legacy `totalSampleSize` branch), executive document tests (S8-02), casLoop tests (S8 gap), month-lock TTL tuning (S4-11).

## Fix waves (executed autonomously 2026-07-13/14)

- **Wave 1 — Data safety (2 Opus agents, parallel):** A-01, B-01..B-06, B-10, B-11, C-01, C-02, C-04, C-05, C-11(name), C-12 + two-writer regression tests.
- **Wave 2 — Wiring & correctness (1 Opus agent):** A-02, B-07, B-08, C-03, C-06, C-09, C-13, C-14.
- **Wave 3 — Report system rework (1 Opus agent):** consistent 3-output model (deck / step-by-step Excel / document) for sample, distribution, and management reports on the executive infrastructure; single hardened escaping primitive; XSS tests for all builders; C-07, C-08, C-10.
- **Wave 4 — Verification:** strict-mode assessment (B-09), full gates, single-file build check, EDIT_LOG entries, commit.
