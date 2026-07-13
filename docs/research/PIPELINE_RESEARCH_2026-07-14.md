# Pipeline & Data-Integrity Research — Grounding for the Architecture Rework

**Date:** 2026-07-14
**Scope:** Web research + codebase analysis to ground a planned restructure of how the app
receives, processes, samples, stores, appends, merges, and links data through to
reports/KPIs/dashboards. No code changes in this pass — this is the research brief that will
drive the rework.

## Executive Summary

The app already does several things right by accident of good engineering instinct: an
append-only distribution event log with a derived "current state" fold is textbook event
sourcing; `safeWriteJson`'s snapshot/verify/rollback plus `JsonEnvelope`
(`schemaVersion`/`revision`/`contentHash`) covers a meaningful slice of data-integrity practice;
`rawRow`/`sourceSheetName`/`sourceRowNumber` on every population row gives basic provenance back
to the Excel import. What is missing is the layer that turns "a seeded random draw" into "a
defensible government QC sampling procedure": there is no documented sampling plan (lot
definition, AQL-equivalent acceptance criteria, inspection level, switching rules), no
guaranteed reproducibility pin (algorithm version alongside the seed), no per-field change
history on employee answers (only the latest snapshot), an audit log that silently drops entries
past 10,000, and no four-eyes approval gate on the sample draw itself. None of these require a
backend — they are additive JSON fields, new small storage modules, and UI surfacing, all
implementable inside the existing `src/data/` + File System Access architecture. The standards
surveyed (ISO 2859-1, ANSI/ASQ Z1.4, ISO 9001, ISO 19011, ALCOA+, ISO 15489) converge on the same
five asks: **define the lot and the acceptance criteria, prove reproducibility, attribute every
change to a person and a moment, never silently lose or overwrite the original record, and keep
an unbroken chain from raw import to final report.** The gap table and MUST list below turn that
into concrete, file-level work items.

---

## 1. Statistical Acceptance Sampling Standards (ISO 2859-1, ISO 3951, ANSI/ASQ Z1.4)

- ISO 2859-1 defines an **Acceptance Quality Limit (AQL)** — the worst tolerable defect rate — and indexes single/double/multiple sampling plans to it; a lot at or below the AQL has roughly 95% acceptance probability. [ISO 2859-1](https://www.iso.org/standard/85464.html), [ANSI Blog](https://blog.ansi.org/ansi/iso-2859-1-2026-aql-sampling/)
- Every plan has an accept number (Ac) and reject number (Re = Ac+1); the **lot** must be a well-defined, homogeneous collection of units before a sample size/AQL combination means anything. [QualityInspection.org](https://qualityinspection.org/inspection-level/)
- **Switching rules** are the defensibility mechanism: consecutive accepted lots allow a switch from normal → reduced inspection (lower cost); a rejection or a run of borderline lots forces normal → tightened inspection. ANSI/ASQ Z1.4 codifies the same three-tier scheme (Level I reduced / II normal / III tightened) with the same switching logic. [ASQ Z1.4](https://asq.org/quality-resources/z14-z19), [Elsmar forum](https://elsmar.com/elsmarqualityforum/threads/ansi-asq-standard-z1-4-2008-what-means-normal-inspection.89983/)
- ISO 3951 is the variables-data counterpart (measures a continuous characteristic rather than pass/fail) and needs far smaller samples for equivalent coverage, but assumes a Normal distribution and is sensitive to outliers — not a fit for this app's categorical `سليمة`/`اشتباه` results. [Elsmar](https://elsmar.com/elsmarqualityforum/threads/iso-3951-sampling-procedure-for-inspection-by-variables-data.65395/)
- **Gap vs. the app's design:** the app has a seeded RNG, Hamilton apportionment, and stage/port stratification — a real stratified sampling *mechanism* — but no documented AQL-equivalent acceptance criterion, no lot definition captured as data, and no switching rule that reacts to last month's outcome. A regulator or internal auditor reviewing the process today would see "we drew N rows with seed S" but not "why N, against what quality limit, and what happens if last month's defect rate spiked."

## 2. Quality Management & Audit Standards (ISO 9001:2015, ISO 19011)

- ISO 9001 clause 7.5 requires **documented information** to be retained "as evidence of conformity," protected from unintended alteration, with an organization-defined retention period and disposition (archive/shred/recycle) — the standard doesn't mandate a specific duration, but does mandate that one exists and is followed. [thecoresolution.com](https://www.thecoresolution.com/clause-7-5-9001-2015-explained), [Pretesh Biswas](https://preteshbiswas.com/2019/05/11/iso-90012015-clause-7-5-documented-information/)
- Records must stay legible and accessible for their whole retention window — a format/medium concern, relevant to the app's JSON-on-disk approach (JSON survives; a proprietary binary would not).
- ISO 19011 auditing guidance expects evidence to be **complete, correct, consistent, and current** (the "4-Cs"), collected via records/interviews/observations, and every finding traceable to a specific requirement with supporting evidence recorded. [certaintysoftware.com](https://www.certaintysoftware.com/iso-19011/), [supervizor.com](https://www.supervizor.com/blog/grc/internal-audit/framework/iso-19011)
- **Gap vs. the app:** there is no written retention/disposition policy for any file class (backups, audit logs, per-employee answers); the workspace audit log (`actions.log.json`) caps at 10,000 entries and **silently drops the oldest** — the opposite of "retain as evidence of conformity."

## 3. Data Integrity Principles (ALCOA+)

- ALCOA+ (now commonly ALCOA++, 10 principles): **Attributable, Legible, Contemporaneous, Original, Accurate, Complete, Consistent, Enduring, Available**, and (in the ++ variant) **Traceable**. Originated with FDA guidance, now the de facto checklist for any regulated-data system. [Arkivum](https://arkivum.com/blog/alcoa-the-cornerstone-of-data-integrity-in-life-sciences/), [IntuitionLabs](https://intuitionlabs.ai/articles/alcoa-plus-gxp-data-integrity)
- Mapping to a file-based, no-backend system:
  - **Attributable** → every record needs a captured actor + role, not just a username string (the app already has `drawnBy`, `answeredBy`, `eventBy` — good coverage at the file level, thin at the field level).
  - **Original** → the first-captured value must survive; edits should be recorded as new versions, not silent overwrites of the only copy.
  - **Complete** → "no deletion... including any changes made during the life of the data" — this directly indicts the audit log's 10,000-entry cap.
  - **Contemporaneous** → timestamps must reflect when the action happened, not when it was later reconciled; the app's `eventAt`/`lastSavedAt`/`submittedAt` fields are already contemporaneous by construction (client-side `new Date().toISOString()` at the moment of write).
  - **Enduring/Available** → plain JSON on a shared folder is actually a good fit here (durable, human-readable, no proprietary lock-in) as long as the retention/backup story is airtight.
- **Gap vs. the app:** "Original" and "Complete" are the weakest links — employee answers store only the latest state per item (`items[]` keyed by `xrayImageId`, overwritten on each save), and the action log actively discards old entries.

## 4. Records Management (ISO 15489)

- ISO 15489 requires records to remain authoritative through **authenticity, reliability, usability, and integrity**, governed by a documented retention/disposition schedule and rich metadata about creation and context. [DCC briefing](https://www.dcc.ac.uk/guidance/briefing-papers/standards-watch-papers/iso-15489), [SafetyCulture](https://safetyculture.com/topics/iso-15489)
- Modern implementations achieve integrity via **immutable storage, version control, and unalterable audit trails logging every action on a record** — not just the record's current value. [Pacific Certifications](https://pacificcert.com/iso-15489-1-2016-records-management/)
- **Gap vs. the app:** the app has versioning at the *file* level (`revision` counter in `JsonEnvelope`) but not at the *record* level inside files with arrays of mutable items (e.g., an individual answer inside `{username}.answers.json` has no version history, only a `revision` on the whole file that tells you *something* changed, not *what* the previous value was).

## 5. Data Pipeline Architecture Patterns (Medallion, Event Sourcing, Lineage)

- **Medallion architecture** (bronze/raw → silver/cleansed → gold/curated) preserves raw data exactly as it arrived so any downstream processing can be **audited, reproduced, or re-run without going back to source systems**. [Databricks](https://www.databricks.com/blog/what-is-medallion-architecture), [erstudio](https://erstudio.com/blog/understanding-the-three-layers-of-medallion-architecture/)
- This maps almost directly onto the app's existing `1-raw/` → `2-processed/` folder split — the *shape* is already medallion-like; what's missing is enforcing that bronze (`risk.raw.json`/`bi.raw.json`) is truly immutable once written (a re-import today can overwrite it with no "superseded" trail).
- **Event sourcing** requires projections/read-models to be **idempotent and deterministic** — replaying the same events must always produce the same derived state, with side effects isolated and checkpoints resumable. [EventSourcingDB best practices](https://docs.eventsourcingdb.io/best-practices/designing-read-models/), [Domain Centric](https://domaincentric.net/blog/event-sourcing-projection-patterns-deduplication-strategies)
- The app's `distribution.log.json` → `deriveCurrentDistribution()` fold is a correct, minimal event-sourcing implementation already. The gap is schema evolution: if an event's shape changes in a future version, is the fold still deterministic against old events? No `eventSchemaVersion` field currently exists per event.
- Idempotent reprocessing best practice: use part of the event payload as a dedup key so re-applying an event (e.g., after a crash mid-write) is a no-op, not a duplicate. `eventId` exists in the schema — good — but `deriveCurrentDistribution` should be verified to be a pure fold with no hidden non-determinism (wall-clock reads, `Math.random`, etc.).

## 6. Comparable Systems (LIMS, CAQ/QMS, Customs Inspection)

- **LIMS** (Laboratory Information Management Systems) give every sample a **unique ID that persists through registration → storage → testing → disposal**, with an automatic, complete **chain-of-custody** record (who had it, when, what happened) and audit trails capturing who/what/when/why for every regulated change. [Lab Manager](https://www.labmanager.com/lims-audit-trails-automating-compliance-documentation-for-regulatory-inspections-35447), [QIA](https://www.qi-a.com/learning-center/managing-chain-of-custody-in-field-sampling-with-environmental-lims/)
- **CAQ/QMS software** (Computer-Aided Quality) bundles incoming-inspection sampling, initial-sample release procedures, SPC/control charts, and document/audit management as integrated modules — release is a formal, recorded decision, not an implicit side effect of workflow progress. [Symestic](https://www.symestic.com/en-us/what-is/caq), [Quality Miners](https://quality-miners.de/en/caq-software/initial-sampling/)
- **Customs/NII (non-intrusive inspection) context**: the WCO SAFE Framework mandates X-ray/NII screening of high-risk cargo as part of a documented risk-management program, and current WCO guidance is pushing toward AI-assisted X-ray image analytics as a supplement to (not replacement for) human review — relevant context for how this app's risk-engine fields (`targetedByRiskEngine`, `riskMessage`) should be documented as *inputs* to the sampling rationale, not just descriptive metadata. [WCO SAFE Framework](https://www.wcoomd.org/-/media/wco/public/global/pdf/topics/facilitation/instruments-and-tools/tools/safe-package/safe-framework-of-standards.pdf), [WCO News](https://mag.wcoomd.org/magazine/wco-news-106-issue-1-2025/risk-management-developments-wco/)
- **ISO/IEC 17025** (testing/calibration lab competence) requires results to be traceable through **an unbroken chain of documented steps**, and requires a competence record for the people performing the work. [sgsystemsglobal.com](https://sgsystemsglobal.com/glossary/iso-iec-17025-testing-calibration-lab-competence/)
- **Gap vs. the app:** the app has the equivalent of sample identity (`xrayImageId`) and a status trail (distribution events), but no explicit "lot lifecycle state" field (received → sampled → assigned → answered → approved → closed) visible as one enum, no formal "release" event distinct from "answer submitted," and no personnel-competence register for who is authorized to draw a sample or approve a referral.

## 7. Saudi Context (Brief)

- **SDAIA / National Data Management Office (NDMO)** is the Kingdom's data-governance regulator: it sets the Data Management and Personal Data Protection Standards that public entities must follow, and runs the National Data Bank for cross-agency data sharing. [Wikipedia: SDAIA](https://en.wikipedia.org/wiki/Saudi_Authority_for_Data_and_Artificial_Intelligence), [sdaia.gov.sa](https://sdaia.gov.sa/en) — relevant mainly at the policy level (data classification, retention, PII handling); this app has no PII beyond usernames and no cross-agency sharing today, so NDMO obligations are light but classification/retention discipline is a reasonable voluntary alignment.
- **NCA Essential Cybersecurity Controls (ECC-2:2024)** apply in full to government entities and CNI operators, covering governance/defense/resilience/third-party/ICS domains and mandating encryption of data in transit and at rest per classification. [nca.gov.sa ECC](https://nca.gov.sa/en/regulatory-documents/controls-list/ecc/), [Guide to ECC Implementation (PDF)](https://cdn.nca.gov.sa/api/public/cms/files/fd4cfde4-6ffe-45d5-ac29-820e4d2e4ef0_Guide-to-Essential-Cybersecurity-Controls-(ECC)-Implementation.pdf) — plausibly applicable pieces for an offline file-based tool: encryption at rest for the workspace folder (OS/disk-level, outside this app's control), and the existing advisory note in `docs/SECURITY_MODEL.md` that this app is not a hardened trust boundary should explicitly reference ECC as the reason a server-backed rework would eventually be needed for full compliance — flagged as **out of scope** for this no-backend rework.

---

## Gap Table (drives the rework)

| # | Current app mechanism | Standard / best practice | Concrete gap | Recommended change |
|---|---|---|---|---|
| 1 | `sample.master.json` stores `rngSeed` + requested/actual counts only | ISO 2859-1 / Z1.4: documented sampling plan (lot, AQL, inspection level, Ac/Re) | No AQL-equivalent acceptance criterion or inspection-level concept exists anywhere in the data model | Add a `samplingPlan` record (lot definition = month+port+stage, target quality threshold, inspection level, rationale) persisted alongside `sample.master.json` in `src/data/sampling/` |
| 2 | Same quota logic runs every month regardless of prior results | ISO 2859-1/Z1.4 switching rules (normal/tightened/reduced) | No mechanism reacts to last month's suspicion/defect rate | In `sampleAlgorithm.ts`/`populationProcessor.ts`, read prior month's `xrayLevelTwoResult` suspicion rate and adjust next month's stage targets or flag for manager review |
| 3 | `rngSeed` alone determines the draw | ALCOA+ "Original"/reproducibility | Algorithm code can change over time; a stored seed with no algorithm-version pin isn't reproducible after a code update | Add `samplingAlgorithmVersion` to `SampleMasterData` (`sampleTypes.ts`) and gate any future algorithm change behind a version bump, never in-place semantic change |
| 4 | `{username}.answers.json` `items[]` stores only the latest saved answer per `xrayImageId` | ALCOA+ Attributable/Original/Complete | Editing an answer after first save overwrites the only copy — no "who changed what, from what, to what, when" | Add an append-only `history[]` per answer item in `src/data/answers/answerStorage.ts` (previous value + actor + timestamp) alongside the current snapshot |
| 5 | `risk.raw.json`/`bi.raw.json` written once per month import | Medallion bronze-layer immutability; ALCOA+ Original | A re-import can silently overwrite the raw bronze file with no trace of the prior import | In `src/data/population/populationStorage.ts`, treat raw files as write-once: a re-import creates a new timestamped raw snapshot and records a `supersedes` link, never overwrites in place |
| 6 | `actions.log.json` caps at `MAX_ACTION_ENTRIES = 10_000`, oldest silently dropped (`src/data/audit/actionLog.ts`) | ISO 9001 7.5 retention; ISO 15489 completeness | Governance-relevant audit trail (user deletion, permission changes, sample draws) can silently lose its oldest evidence | Replace the cap-and-drop with periodic archival: roll entries older than N months into a dated `actions.{yyyy-mm}.archive.json` instead of discarding them |
| 7 | `distribution.log.json` events have no `eventSchemaVersion` field | Event sourcing: deterministic, schema-safe replay | A future event-shape change could silently corrupt `deriveCurrentDistribution()` folds over old events | Add `eventSchemaVersion` to each event in `distribution/distributionLog.ts`; version the fold function to branch on it |
| 8 | Row lifecycle is implicit, spread across `distribution.current.json` status + answer `status` + approval decisions | LIMS/CAQ explicit lot/sample lifecycle states | No single enum represents "where is this X-ray image in its QC lifecycle" | Introduce one `lifecycleState` enum (sampled → assigned → answered → referred/approved → closed) surfaced consistently across `population`, `distribution`, and `answers` modules |
| 9 | Referral/replacement decisions recorded as plain JSON with `supervisorUsername` + decision | CAQ/QMS e-signature / formal release | No tamper-evidence beyond the file-level `contentHash` (which anyone with file access can recompute) | Add a hash-chain field to `approvalStorage.ts` decisions (`previousDecisionHash`) so an out-of-band edit breaks the chain visibly, even though it's not cryptographically secure against a determined editor |
| 10 | `contentHash` uses a non-cryptographic djb2-style hash (`jsonEnvelope.ts`) | ALCOA+ Accurate; data integrity best practice | Detects accidental corruption but not deliberate tampering (recomputable by anyone) | Document explicitly as corruption-detection-only in `docs/SECURITY_MODEL.md`; no change needed since a cryptographic upgrade wouldn't add real security without a secret key (which would need a backend) |
| 11 | "Month" is the de facto sampling lot, but this is never written down as data | ISO 2859-1 lot-by-lot inspection requires a defined, homogeneous lot | Auditors reviewing the process have to infer the lot definition from folder structure | Add an explicit `lotDefinition` field (month + port + stage) to the new `samplingPlan` record from gap #1 |
| 12 | Sample draw is a single-operator action (`drawnBy`) | ISO 9001 process control / CAQ four-eyes release | No required second approval before a drawn sample becomes the distributable sample | Add an optional `approvedBy`/`approvedAt` gate to `sample.master.json` before distribution can begin, enforced in the Population Phase 3→4 transition |
| 13 | Backups exist (`backupStorage.ts`) but no written retention/disposition schedule | ISO 9001 7.5.3 retention & disposition | Indefinite backup accumulation or ad hoc deletion, neither documented | Define and document a retention policy (e.g., keep last N automatic backups + all manual ones) inside `backupStorage.ts` and `docs/data-system-report.md` |
| 14 | "Reopen for correction" flow overwrites the submitted answer | ALCOA+ Original/Complete | Depends on gap #4's history log to preserve the pre-correction value | Same fix as #4 — reopen should append to `history[]`, not just clear `submittedAt` |
| 15 | `biFilledFields` records which fields BI filled in, but not what the risk-only value was before enrichment | ALCOA+ Original; medallion silver-layer lineage | Enrichment overwrite loses the pre-enrichment value | In `populationProcessor.ts`, store the pre-enrichment value alongside `biFilledFields` (small diff object) rather than only the field name |
| 16 | `xrayImageId` is the de facto foreign key across population/sample/distribution/answers/approvals with no automated cross-file check | Data pipeline staged-validation best practice | Orphaned entries (e.g., after a replacement) can accumulate undetected | Extend `DataAccuracyReport.tsx`'s existing checks (or add a new one) to flag `xrayImageId`s present in answers/approvals but absent from the current distribution snapshot |
| 17 | Generated HTML reports have no recorded link to the exact source-file revisions used | ISO 15489 preserving record context; ALCOA+ Traceable | A report can't be proven to correspond to a specific data snapshot after later edits | Embed the `revision` numbers of every source `JsonEnvelope` consumed into the report's metadata block in `src/data/reporting/` |
| 18 | KPIs show raw counts/percentages, no control-limit or AQL-referenced thresholds | ISO 2859-1 AQL; SPC p-charts | No documented "is this month's defect rate acceptable" threshold — reviewers eyeball numbers | Implement the already-planned Tier-2 p-chart (recharts, unused today) in `KpiRenderer.tsx` with control limits derived from historical months |
| 19 | `casLoop` retries on write conflict, then reports a conflict error | Data integrity: no silent data loss under concurrent writes | When retries are exhausted, is the loser's edit surfaced to the user or silently lost? | Audit every `casLoop` call site for a user-visible "your change didn't save, reload and retry" path rather than a console-only error |
| 20 | Role/tab permission matrix (`userManagement.ts`) controls who *can* draw a sample, but no record of operator training/qualification | ISO/IEC 17025 personnel competence records | No competence register — a determined internal audit would ask "who is qualified to draw statistical samples" | Add optional competence metadata (training date, certifying authority) to user profiles, surfaced read-only in User Management |
| 21 | `targetedByRiskEngine`/`riskMessage` are descriptive population fields only | Risk-based sampling rationale (WCO SAFE Framework; ISO 2859 special inspection) | Risk-engine signal isn't connected to *why* a stage/port got its quota | Reference risk-score distribution explicitly in the new `samplingPlan` rationale (gap #1) so quota-setting is shown to be risk-informed, not just proportional |
| 22 | Multi-machine writes to a shared folder rely on CAS + Web Locks only | ISO 9001 process control across distributed writers | No central authority resolves true simultaneous cross-machine conflicts beyond retry-then-fail | Document this explicitly as an **accepted, permanent limitation** of the no-backend architecture (not a fixable gap) in `docs/SECURITY_MODEL.md` |

---

## Prioritized Recommendations

### MUST (integrity / defensibility — do these first)

1. **Documented sampling plan record.** Persist lot definition, AQL-equivalent target, inspection level, and rationale alongside `sample.master.json`. *Sketch:* new `SamplingPlan` type + `samplingPlanStorage.ts` in `src/data/sampling/`, populated at draw time in `sampleAlgorithm.ts`.
2. **Stop silently dropping audit history.** Replace `actions.log.json`'s hard 10,000-entry cap with dated archive rollover. *Sketch:* `src/data/audit/actionLog.ts` — on cap, write entries older than the cutoff to `actions.{yyyy-mm}.archive.json` before trimming the live file.
3. **Immutable raw import (bronze layer).** Never overwrite `risk.raw.json`/`bi.raw.json` in place on re-import; write a new timestamped snapshot and link it. *Sketch:* `src/data/population/populationStorage.ts` import path.
4. **Per-field answer history.** Preserve every prior value of an inspection answer, not just the latest. *Sketch:* add `history[]` to each `items[]` entry in `src/data/answers/answerStorage.ts`; append on every save/reopen instead of overwrite.
5. **Reproducibility pin.** Store an explicit `samplingAlgorithmVersion` next to `rngSeed` so a stored seed is provably reproducible against the code that produced it. *Sketch:* `src/data/sampling/sampleTypes.ts` (`SampleMasterData`), bump on any semantic change to `sampleAlgorithm.ts`.
6. **Four-eyes sample approval.** Require a second-role sign-off before a drawn sample can be distributed. *Sketch:* add `approvedBy`/`approvedAt` to `sample.master.json`; gate the Phase 3→4 transition in the Population tab.
7. **Report-to-data-revision linkage.** Every generated report records the exact `revision` of each source file it consumed. *Sketch:* `src/data/reporting/` report builders read and embed source `JsonEnvelope.metadata.revision` values.

### SHOULD (durability / structure)

1. **Switching rules.** Adjust next month's sample intensity based on the prior month's suspicion/defect rate (ISO 2859/Z1.4 pattern). *Sketch:* `populationProcessor.ts` reads prior-month `xrayLevelTwoResult` stats before calling `drawSample`.
2. **Explicit row lifecycle enum.** One `lifecycleState` value per `xrayImageId`, consistent across population/distribution/answers. *Sketch:* shared type in `src/data/population/populationTypes.ts`, referenced by `distributionLog.ts` and `answerStorage.ts`.
3. **P-chart KPIs with control limits.** Use the already-declared `recharts` dependency for the planned Tier-2 KPI upgrade. *Sketch:* `src/components/Sidebar/Tabs/ReportDesigner/renderers/KpiRenderer.tsx`.
4. **Documented retention/disposition policy** for backups and audit logs. *Sketch:* policy constants + comment block in `src/data/backup/backupStorage.ts`, mirrored in `docs/data-system-report.md`.
5. **Personnel competence register** (who is authorized to draw samples / approve referrals, since when). *Sketch:* optional fields on the user record in `src/auth/userManagement.ts`.
6. **Referential-integrity check.** Detect `xrayImageId`s orphaned across population/sample/distribution/answers/approvals. *Sketch:* extend `src/components/Sidebar/Tabs/Population/components/DataAccuracyReport.tsx`.

### COULD (polish)

1. **Hash-chained decisions** for visible (not cryptographic) tamper evidence on approvals and audit entries. *Sketch:* `previousDecisionHash` field in `src/data/approvals/approvalStorage.ts` and `actionLog.ts`.
2. **Surface the sampling-plan rationale in the UI** (AQL-equivalent target, inspection level, risk-basis narrative) at draw time. *Sketch:* Population tab Phase 3 screen.
3. **`eventSchemaVersion` on distribution events** for safe future schema evolution. *Sketch:* `src/data/distribution/distributionLog.ts`.
4. **User-visible conflict recovery UX** when a `casLoop` retry budget is exhausted, instead of a console-only error. *Sketch:* audit call sites of `casLoop` across `src/data/`.

### Explicitly OUT OF SCOPE (would require a backend/server)

- True centralized locking / single source of truth across simultaneously-writing machines (current CAS + Web Locks retry-then-surface-conflict is the best available without a server).
- Cryptographically strong, PKI-backed e-signatures with real non-repudiation (needs a trusted signing authority/backend).
- Real-time multi-user collaborative editing with automatic conflict-free merge (would need a CRDT-capable server).
- A tamper-*proof* (not just tamper-*evident*) audit trail or ledger (needs an external anchor/notary service).
- Full NCA ECC-2:2024 compliance (encryption-at-rest enforcement, centralized logging/SIEM integration, network-layer controls) — the app can document alignment where it costs nothing (JSON classification labeling, retention policy) but cannot enforce OS/network-level controls from within a browser SPA.

---

*No source quotes over 15 words were used; all findings above are synthesized from the cited pages. This document is research only — no application code was changed.*
