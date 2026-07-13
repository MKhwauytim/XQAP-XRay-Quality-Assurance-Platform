# Data Pipeline Rework — Design & Decision Record

**Date:** 2026-07-14 · **Status:** approved for autonomous implementation (owner mandate 2026-07-14)
**Basis:** `docs/research/PIPELINE_RESEARCH_2026-07-14.md` (ISO 2859-1/Z1.4, ISO 9001/19011, ALCOA+, ISO 15489, medallion/event-sourcing patterns, LIMS/CAQ comparables)
**Companion:** `docs/audit/MASTER_AUDIT_2026-07-13.md` (defect fixes, landed separately as the checkpoint commit before this rework)

## 1. Goal

Turn the existing pipeline — receive (Excel import) → process (population) → sample (stratified draw) → store (workspace JSON) → append/merge (event logs, approvals, answers) → link (reports/KPIs/dashboards) — from "a well-engineered mechanism" into "a defensible, future-proof QC record system." The standards surveyed converge on five asks, and every change below serves one of them:

1. **Define the lot and the acceptance criteria** (documented sampling plan)
2. **Prove reproducibility** (algorithm version pinned to the seed)
3. **Attribute every change to a person and a moment** (field-level history, four-eyes gates)
4. **Never silently lose or overwrite the original record** (immutable raw layer, archival instead of truncation)
5. **Keep an unbroken chain from raw import to final report** (revision linkage, lineage)

## 2. Hard constraints (unchanged)

- **No backend.** Everything stays browser + File System Access API + JSON files.
- **Backward compatibility.** Every schema change is additive (optional fields with safe defaults). Old workspace files must load unchanged — no migration step, no breaking `schemaVersion` bump unless a reader would otherwise misinterpret old data.
- **All writes via `safeWriteJson`**; multi-writer files keep CAS/append-only discipline.
- **Single self-contained HTML build**; Arabic RTL UI; strict TS.

## 3. Changes (what / why / before → after)

### Wave A — data layer (foundations)

**A1. Sampling plan record** — research gaps #1, #11, #21 (ISO 2859-1 documented plan)
- *Before:* `sample.master.json` stores `rngSeed`, requested/actual counts. Lot definition and acceptance rationale exist only implicitly in folder structure and code.
- *After:* new `SamplingPlan` type persisted at draw time (`src/data/sampling/samplingPlanStorage.ts`, file `sampling.plan.json` next to `sample.master.json`): lot definition (month, ports, stage split), target sample fraction / quality threshold, inspection-level note, risk-basis narrative (share of `targetedByRiskEngine` rows), and the seed + algorithm version it binds to.
- *Why:* an auditor must see "why N, against what limit," not just "we drew N with seed S."

**A2. Reproducibility pin** — gap #3 (ALCOA+ Original)
- *Before:* `rngSeed` alone; any semantic change to `sampleAlgorithm.ts` silently breaks replayability of historical draws.
- *After:* `samplingAlgorithmVersion` constant exported from `sampleAlgorithm.ts`, stored in `SampleMasterData` and in the sampling plan. Rule documented in code: any semantic change bumps the version.

**A3. Four-eyes sample release (data fields)** — gap #12 (CAQ release practice)
- *Before:* a drawn sample is immediately distributable; `drawnBy` is the only actor.
- *After:* optional `approval: { approvedBy, approvedAt, role }` on `SampleMasterData`. Absent on legacy files (treated as approved-by-legacy so old months keep working). Wave B gates the UI.

**A4. Per-item answer history** — gaps #4, #14 (ALCOA+ Original/Complete)
- *Before:* `{username}.answers.json` `items[]` keeps only the latest value per `xrayImageId`; edits and reopen-corrections overwrite the only copy.
- *After:* append-only `history[]` on each item (`{ changedAt, changedBy, reason: "save" | "reopen-correction", previous: <snapshot of overwritten answers/status> }`), appended on every overwriting save. Capped per item (e.g. 20 entries) to bound file growth; the cap is a documented retention decision, not silent loss of the first/original entry (first entry always kept).

**A5. Immutable raw imports (bronze layer)** — gap #5 (medallion immutability)
- *Before:* re-processing a month overwrites `risk.raw.json` / `bi.raw.json` in place; the prior import vanishes.
- *After:* on re-import, the existing raw file is first copied to `risk.raw.{ISO-timestamp}.superseded.json` (same for bi), and the new raw file records `supersedes: <archived name>`. Reads are unchanged (live name stays authoritative).

**A6. Audit log archival instead of truncation** — gap #6 (ISO 9001 7.5 retention)
- *Before:* `actionLog.ts` `MAX_ACTION_ENTRIES = 10_000`, oldest silently dropped.
- *After:* when the cap is exceeded, overflow entries are appended to `actions.archive.{year}.json` (per-year archive files in `5-system/`) before trimming the live log. Archive write failure blocks the trim (never drop without archiving).

**A7. Event schema versioning** — gap #7 (event-sourcing replay safety)
- *Before:* distribution events have no schema version; a future shape change would fold old events ambiguously.
- *After:* `eventSchemaVersion: 1` stamped on newly appended events (absent = 1 on read); fold branches defensively on unknown future versions (preserve-existing, matching the C-01 fix pattern).

**A8. Retention policy as code + docs** — gap #13
- *Before:* backups accumulate with no written policy.
- *After:* documented policy constants in `backupStorage.ts` (keep all manual backups; auto-backups pruned beyond N most-recent, N = 30) + policy section in `docs/data-system-report.md`.

### Wave B — consumers, UI, linkage

**B1. Four-eyes gate in the Population tab** — completes A3. Phase 3 → Phase 4 transition requires a `sample.master.json` approval by a supervisor/manager/admin who is not `drawnBy` (admin may self-approve with an explicit warning note recorded — 9-person team reality). Arabic UI via label keys.

**B2. Report-to-revision linkage** — gap #17. Report builders receive a `sourceRevisions` map (file → `JsonEnvelope.metadata.revision`) collected at load time in the Reports tab and the new report inputs; every deck/document footer and Excel metadata sheet prints it. A report is thereafter provably tied to a data snapshot.

**B3. Referential-integrity check** — gap #16. Extend the Data Accuracy view with an orphan scan: `xrayImageId`s in answers/approvals absent from the current distribution, and sample rows absent from population.

**B4. Switching-rule advisory (not automatic)** — gap #2. At draw time, compute the prior month's suspicion rate (`xrayLevelTwoResult`) and record `priorMonthSuspicionRate` + a recommendation (normal/tightened review) into the sampling plan and Phase 3 UI. *Deliberately advisory:* auto-changing quota is a policy decision the authority must make; the system documents the signal and the recommendation.

**B5. Decision hash-chaining (tamper-evidence)** — gap #9. `previousDecisionHash` on approval decisions (and audit-log archive files): djb2 chain, documented as tamper-*evident* only (no backend → no cryptographic non-repudiation; per `SECURITY_MODEL.md`).

**B6. casLoop conflict UX pass** — gap #19. Audit call sites; every user-initiated write that exhausts retries must surface an Arabic "لم يتم حفظ التغيير — أعد المحاولة" style message, never console-only.

**B7. SECURITY_MODEL.md addendum** — gaps #10, #22. Document `contentHash` as corruption-detection-only, and the shared-folder concurrency model as an accepted permanent limitation of the no-backend design (with the ECC-2:2024 note from the research brief).

### Deferred (recorded, not implemented tonight)

- **Lifecycle enum across modules** (gap #8) — high-churn cross-module refactor; the per-module statuses were just hardened by the audit fixes. Revisit once the new fields settle.
- **P-chart KPIs with control limits** (gap #18) — the planned recharts Tier-2 work; substantial UI effort, separate deliverable.
- **Competence register** (gap #20) — needs owner input on what qualifications exist; data model sketch retained in the research brief.
- Everything in the research brief's **out-of-scope** list (backend-requiring).

## 4. Execution rules

Implementation in two sequential Opus waves (A then B), each gated by `tsc -b` + lint + full Vitest suite; every edit recorded in `docs/edit-log-fragments/` for consolidation into `docs/EDIT_LOG.md`; tests required for every new storage behavior (memory-directory helpers); `docs/data-system-report.md` updated at the end to stay the authoritative disk-layout reference. The rework starts only from the post-audit checkpoint commit so the two diffs stay independently reviewable.
