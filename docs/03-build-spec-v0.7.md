# X-Ray Quality Control App — Build Specification

**Version:** 0.7 (research-enhanced) · **Last updated:** 2026-06-14 · **Supersedes:** 0.6

> **What changed from 0.6:** This revision keeps every agreed decision from 0.6 and layers on research-backed upgrades from government audit-sampling standards (IRS/GAO/PCAOB, ISO 2859), enterprise data-integrity practice (21 CFR Part 11 / ALCOA+), event-sourcing patterns, and WCO risk-based selectivity. New or changed material is flagged **🆕 NEW** or **✏️ CHANGED**. The companion documents are `01-gap-analysis.md` (code vs. spec) and `02-research-brief.md` (the evidence base).

---

## 1. Purpose

An Arabic, RTL-first, single-page React app (no server) that runs entirely in the browser against a folder on disk. It ingests raw X-ray scan data from two sources, processes it into a cleaned "population," draws a **statistically defensible, risk-weighted** quality-control sample, distributes that sample to employees for monthly review, and tracks the full lifecycle of every assigned row — including reassignments — with a **tamper-evident** audit trail.

All business data lives on disk as JSON (the source of truth) mirrored to Excel for humans. Nothing of substance is stored in the browser except the login session and the permission matrix.

**Build vs. ship:** dev uses React/Vite/Node/TypeScript; the shipped output is one portable self-contained `dist/index.html` (`vite-plugin-singlefile`).

## 2. Hard constraints (unchanged from 0.6)

1. **File System Access API** required → Chromium-only (Chrome/Edge), no fallback.
2. **No browser-side business data.** Browser stores only auth session + permission matrix.
3. **JSON is the source of truth; Excel is a human mirror.** Every workbook's first sheet describes the data and the processing applied.
4. **Append-only history.** Originals and prior work are never overwritten; changes are layered events.
5. **🆕 Integrity is verifiable, not assumed.** Because the workspace sits on a shared drive that users could edit directly, every event log is **hash-chained** and each month carries an integrity root that the app can recompute and verify (§17).

## 3. The four sections (top-level navigation) — unchanged

| # | Section | Arabic | Who reaches it |
|---|---|---|---|
| 1 | Population Processing & Sample Distribution | معالجة المجتمع وتوزيع العينة | edit-Population roles (admin + supervisor) |
| 2 | Employee & Permission Management | إدارة المستخدمين والصلاحيات | admin |
| 3 | Employee Workspace | مساحة عمل الموظف | every authenticated user (scoped to self) |
| 4 | Data Archive (browsable) | الأرشيف | view/edit per role |

Section 4 is a browser/explorer view over the workspace folder, not a separate store.

## 4. Roles & permissions

Three roles (`employee` / `supervisor` / `admin`), two enforcement layers (allowed-roles per section + role→action matrix). Monthly runs: admin + supervisor. Reassignment: employee-initiated needs supervisor approval; supervisor-initiated is direct. Column visibility in the Employee Workspace is admin-configurable.

**✏️ CHANGED — Separation of Duties (SoD).** Every approval-bearing action records both **actor** and **approver** as distinct fields, and the system forbids self-approval: an employee cannot approve their own reassignment request or replacement justification. The monthly-run actor is recorded distinctly from reviewers. This makes SoD provable from the audit trail (research brief §6).

## 5. Persistence model

### 5.1 Browser storage (auth & permissions only) — unchanged
PBKDF2-SHA256 (210k iterations), bootstrap admin hash. Session → `sessionStorage`; managed users + permission matrix → `localStorage` with live cross-component DOM-event updates.

### 5.2 Workspace folder on disk (all business data)

Every file is a `JsonEnvelope`:

```
{ metadata: { schemaVersion, revision, contentHash, updatedAt, updatedBy }, data: {...} }
```

**✏️ CHANGED — two write paths, clearly separated (resolves §14 Q4):**

- **Master writes** (monthly run, sampling, supervisor reassignment) are rare, single-actor operations. They keep **revision-based optimistic concurrency + lock files** under `.system/locks/` exactly as built today.
- **Employee writes** (per-keystroke study work) take the **lock-free, event-sourced, per-writer** path (§11A). No locks on this path — correctness comes from "one writer per file," not from contention control.

**🆕 Every mutation appends an event to its log _and_ a record to `.system/audit/`** (who / what / when / **why**), satisfying ALCOA+ (research brief §2). Audit and all event logs are **hash-chained** (§17).

## 6. Folder layout on disk — unchanged structure, hardened metadata

```
Data/
└── Population/
    └── 5-May-2026/                    ← one folder per run (MM-MonthName-YYYY) ✏️ year now explicit (resolves §14 Q3)
        ├── month.manifest.json        ← who ran it, when, settings, SAMPLING PLAN (§13.0) 🆕
        ├── integrity.json             ← per-month hash-chain head / Merkle root 🆕 (§17)
        ├── raw/
        │   ├── risk.original.xlsx     ├── risk.raw.json
        │   ├── bi.original.xlsx       └── bi.raw.json
        ├── processed/
        │   ├── risk.processed.{json,xlsx}   ├── bi.processed.{json,xlsx}
        │   └── population.final.{json,xlsx}     (xlsx 1st sheet = description)
        ├── sample/
        │   ├── sample.master.json         ← immutable once drawn
        │   ├── distribution.events.json   ← APPEND-ONLY, hash-chained (§9)
        │   ├── distribution.current.json  ← derived projection / snapshot (§9, §16-research)
        │   ├── reassign.requests.json
        │   └── employee-answers/
        │       └── {employeeId}.json       ← one append-only, hash-chained file per employee per month
        └── reports/
            └── *.html
```

Per-month self-containment is preserved: a month folder is fully archivable/auditable on its own, files stay bounded, and there is exactly one writer per employee file per month.

## 7. Population processing pipeline — unchanged logic, +1 capture

Steps 1–6 from 0.6 are unchanged (drop invalid IDs → dedup → BI enrichment with per-field fill summary → validate results to سليمة/اشتباه → CertScan classification by port → emit prepared rows + buckets + summary).

**🆕 Step 6b — capture controlled-vocabulary metadata** that later feeds risk-weighting and findings: per row, retain `port`, `importer/exporter id` (if present), `stage`, `certscanStatus`, and a normalized `riskScore` slot (nullable; populated in §8.1). No new processing logic — just don't discard fields the smart sampler will need.

## 8. Sampling & CertScan capacity

Population splits into **Certscan** and **NonCertscan** systems. Currently 4 employees, 2 CertScan licenses. Operator chooses a CertScan share per run.

**✏️ CHANGED — CertScan license enforcement (resolves §13 Q1):** **warn-but-allow-override.** The UI shows a live **capacity meter** ("CertScan holders: 2 / 2"). Assigning CertScan rows to a 3rd holder is allowed only via an explicit supervisor override that is logged as an event with a mandatory reason. Default behavior blocks; override is a deliberate, audited act. (Hard-block was rejected as too brittle for real operations; no-enforcement was rejected as ungovernable.)

### 8.1 🆕 Risk-weighted selection (WCO selectivity)
Each row gets a `riskScore` from available signals (port history, importer/exporter history, origin/routing where present, recent suspect rate). Sampling can run in two modes, chosen per run and recorded in the Sampling Plan:

- **Uniform** — current behavior; equal probability within a stratum.
- **Risk-weighted ("smart mode")** — higher-risk rows are over-sampled within their stratum. This is the WCO risk-based-selectivity principle applied to the QC layer (research brief §4).

## 9. Distribution as an append-only event log — unchanged design, hardened

`sample.master.json` is frozen once drawn. `distribution.events.json` is ordered, append-only, **hash-chained**. Event types (unchanged): `INITIAL_DISTRIBUTION`, `NEW_WAVE`, `EMPLOYEE_REQUEST`, `REQUEST_APPROVED` / `REQUEST_DENIED`, `SUPERVISOR_REASSIGN`, `REPLACEMENT`.

**✏️ CHANGED — uniform event envelope** across all three logs (distribution, employee-answers, audit):

```
{ eventId, seq, type, ts, actor, approver?, reason?, affectedRowIds, fromEmployee?, toEmployee?, status?, payload, prevHash }
```

- `eventId` is **deterministic** (hash of content) so a retried write on a flaky drive is **idempotent** — replaying twice is a no-op (research brief §3).
- `distribution.current.json` is the **projection/snapshot**: it carries `lastSeq` + `headHash`, so a reader replays only events after the snapshot and can detect staleness. One replay engine serves all logs.

## 10. Study work: stacked layers per row — unchanged

On reassignment, the outgoing owner's layer is **frozen read-only**, a fresh empty layer opens for the incoming owner; new owner reads all prior layers, edits only their own. Same behavior for new draws and re-moves.

```
rowId → [ { layerId, owner, status, data, frozenAt }, { layerId, owner, status, data } ]
```

**🆕 Forward-compatibility:** a layer carries `producedBy: "human" | "model"`. Human-only for v1, but the schema admits a future AI pre-screen layer alongside human layers (research brief §4) without a migration.

## 11. Employee Workspace (Section 3) — unchanged

Employee sees only currently-owned rows (from `distribution.current.json`), only admin-permitted columns, fills the study template (§11.1 🆕), can read prior layers read-only, and can raise an `EMPLOYEE_REQUEST` to hand CertScan rows to a chosen colleague (supervisor approves/denies).

### 11.1 🆕 Study template v1 (resolves §14 Q2 with a minimal, shippable shape)
Until the final fields are provided, build against this minimal template so §10 and the Findings report (§12.2) are unblocked. It is config-driven so fields can be added without code changes:

| Field | Type | Notes |
|---|---|---|
| `reviewOutcome` | enum: `confirmed_clean` / `confirmed_suspect` / `discrepancy` / `unstudyable` | core QC judgment |
| `agreesWithOperator` | bool | did QC agree with the original level-1/level-2 result |
| `discrepancyType` | enum (nullable) | only if `discrepancy` |
| `unstudyableReason` | enum (nullable) | **controlled vocabulary**: `image_quality` / `environmental` / `equipment` / `data_error` / `other` — feeds re-scan analytics & selectivity (research brief §4) |
| `notes` | text (nullable) | free Arabic text |
| `reviewedAt` | timestamp | contemporaneous, source of truth for pace (§12.3.1) |

### 11A. Concurrency & conflict management — unchanged, now with teeth

The single rule (11A.1): **no file ever has more than one writer.** Masters are read-only to employees; each employee writes only their own per-month file. 11A.2 **reference, never copy** — store `{rowId, answer}` and resolve `rowId` against the read-only master at display time. 11A.3 each employee file is **append-only** (`ANSWER_SAVED`, `ROW_COMPLETED`, `REPLACEMENT`…), every event timestamped + attributed. 11A.4 the system view is a **derived projection**, never concurrently written. 11A.5 staleness on a network drive is the only residual effect and is safe (read-only masters + isolated writers). 11A.6 master writes still use revision + lock-file concurrency.

**🆕 11A.7 — the §11A guarantee is now also _verifiable_:** because each employee file is hash-chained (§17), a corrupted or externally-edited file is not just "rare" — it is **detectable**, and the Archive/reporting layer flags it instead of silently merging bad data.

## 12. Reporting

`reportDataBuilder → reportHtmlBuilder → reportExporter` produce standalone HTML. **Four report families, every one with a scope selector** (§12.5: single month / quarter / custom range / all-time / hand-picked set). Scope only changes which month folders are merged.

### 12.1 Population report — unchanged
Source selector: BI-after-processing / Risk-after-processing / appended both / drawn sample.

### 12.2 Findings report — unchanged, now concrete
Driven by the §11.1 template. Aggregates outcomes, agreement rate, discrepancy types, and **unstudyable reasons** across studied rows.

### 12.3 Departmental / Management report (التقرير الإداري) — unchanged composite
Leadership-facing composite + standalone HTML export. Panels: population comparison month-over-month; studied-sample comparison across stages 2–4; KPI follow-up; studied sample per month; per-employee studied vs. unstudied; reassignment count per employee (عدد الإحالات); working-days tracking; daily/weekly averages + target pace.

- **12.3.1 Working days** — distinct calendar dates on which an employee completed ≥1 study, derived from contemporaneous `ROW_COMPLETED` timestamps. Weekend/overtime captured automatically.
- **12.3.2 Pace / burndown** — *actual rate* (studied per day/week) vs. *required pace* (remaining ÷ remaining days, with target window `N` configurable per run). Shows ahead/behind by Z, per employee and department.
- **12.3.3 Per-employee performance** over scope: studied / unstudyable / replacements / reassignments given+received / working days / actual rate / pace vs. target.
- **🆕 12.3.4 — sampling-quality panel:** achieved **precision** and **confidence** of the QC sample vs. the plan (§13.0), so leadership sees not just "how many" but "how trustworthy."

### 12.4 KPI report — unchanged + precision
HTML + 2-sheet Excel (`المجتمع` = processed population; `العينة` = every fully-scanned/studied row, all stages). Toggle: all studied vs. only the required 6250. **🆕** also reports the statistically-derived `n` and achieved precision alongside the 6250 policy floor.

### 12.5 Time-range aggregation — unchanged
Discover month folders by name (`MM-MonthName-YYYY`), read each read-only master + every `employee-answers/*.json`, merge by `rowId` (reference-not-copy) replaying each append-only log, compute metrics over the merged set (KPI filters stages 2–4). Render HTML + (KPI) the 2-sheet Excel. All-folder fan-out is read-only and safe to run anytime; per-month KPI numbers are additive; export can be consolidated or itemized. May cache a roll-up in `.system/` written by the single report process. **🆕 Aggregation refuses to merge any month whose integrity check fails, and surfaces the failure (§17).**

## 13. KPI logic (the core measurement)

### 13.0 🆕 Sampling Plan (the defensibility upgrade) — recorded in `month.manifest.json`
Before drawing, the run records a Sampling Plan derived from audit-sampling standards (research brief §1):

```
{ confidenceLevel,            // e.g. 0.95
  tolerableExceptionRate,     // e.g. 0.05
  expectedExceptionRate,      // e.g. 0.0
  derivedSampleSize,          // computed from the three inputs (attribute sampling)
  policyFloor: 6250,          // contractual minimum, kept
  stratification: "stages 2-4 @ 40/30/30 + CertScan share",
  allocationMethod: "proportional-with-caps" | "neyman" | "uniform",
  selectionMode: "uniform" | "risk-weighted" }
```

The actual sample size drawn = **max(derivedSampleSize, policyFloor)**, so 6250 remains a floor but the system also states the statistically required number and, after review, the **achieved precision**. This is what makes the output defensible to an external auditor.

### 13.1 The KPI — unchanged
Stages 1–4. Stage 1 mandatory/uncapped, sits outside the 6250 goal (excluded from KPI math, present in العينة). Monthly KPI floor = 6250 across stages 2–4, target split 40% stage-2 (2500) / 30% stage-3 (1875) / 30% stage-4 (1875). Floor is a minimum, not a cap. العينة and KPI report include all stages; KPI math filters to 2–4.

### 13.2 Spillover allocation — unchanged, now named
Supply-aware, deterministic, cascading: compute each stage's target; if supply < target take all available and compute shortfall; redistribute shortfall across remaining stages **proportional to their population weights** (not the original 40/30/30); cascade if a receiver hits its ceiling; stop at 6250 or supply exhaustion (record unmet remainder). **✏️** This is formally **stratified proportional allocation with capacity caps** (research brief §1); an optional **Neyman** mode (allocate more where risk/variance is higher) is offered as "smart mode."

### 13.3 Unstudyable rows → Store & Replace — unchanged (resolves §14 Q5)
At study time the employee fills the template then presses **Store & Replace**: commits all successfully-studied rows; for each unstudyable row logs the `unstudyableReason` (§11.1 controlled vocab) and issues a replacement. **✏️ Replacement supply pool (resolves Q5):** the **unsampled remainder of the same stage**; if exhausted, cascade to the stage with the highest available percentage (same §13.2 logic), preserving post-spillover balance. Logged as a `REPLACEMENT` event in the distribution log.

### 13.4 Visibility of replaced/unstudyable rows — unchanged
Governed by the permission matrix: permitted roles see the original row with `status: replaced` + reason; an employee not permitted to see replaced rows stops seeing it once swapped.

## 14. Open questions — status

| # | Question | v0.7 resolution |
|---|---|---|
| Q1 | CertScan license enforcement | **Resolved:** warn-but-allow-override + capacity meter + logged override (§8). |
| Q2 | Study template fields | **Resolved (v1):** minimal config-driven template (§11.1); final fields can extend it without code change. |
| Q3 | Month-folder year handling | **Resolved:** `MM-MonthName-YYYY` (§6). |
| Q4 | Locking granularity | **Resolved:** masters = lock+revision; employee path = lock-free event-sourced (§5.2, §11A). |
| Q5 | Replacement supply pool | **Resolved:** same-stage unsampled remainder → cascade (§13.3). |

## 15. 🆕 Non-functional requirements

- **Integrity:** every log hash-chained; per-month integrity root; one-click verify (§17).
- **Auditability:** every mutation produces a who/what/when/**why** audit record (ALCOA+).
- **Performance:** projections + snapshots so replay cost stays bounded as logs grow; all-time reports read folders lazily.
- **Portability:** ships as one `dist/index.html`; works offline against a local/network folder.
- **Accessibility/i18n:** Arabic RTL throughout; English code identifiers.
- **Browser:** Chrome/Edge only; clear `unsupported_browser` state elsewhere.

## 16. 🆕 Implementation roadmap (phased)

| Phase | Deliverable | Depends on | Risk |
|---|---|---|---|
| **P0 Foundations** | Month tree (`MonthContext`); wire Phase-1 results to disk via envelope protocol; uniform event envelope + replay engine + hash-chain util | — | Refactor of `workspaceDefaults`/`types`; high leverage |
| **P1 Sampling** | Sampling Plan object; stage/KPI/spillover math; CertScan capacity meter; uniform mode first, risk-weighted behind a flag | P0 | Spillover edge cases — unit-test the worked example |
| **P2 Distribution** | `distribution.events.json` + projection; INITIAL/NEW_WAVE/SUPERVISOR_REASSIGN | P0, P1 | Idempotent replay correctness |
| **P3 Employee Workspace** | Section 3 tab; study template v1; stacked layers; reference-not-copy resolver | P0–P2 | Per-writer file discipline |
| **P4 Reassignment + Audit** | EMPLOYEE_REQUEST/APPROVE/DENY + REPLACEMENT; SoD; audit append; integrity verify | P2, P3 | SoD enforcement points |
| **P5 Reporting** | Findings, Management (التقرير الإداري), KPI 2-sheet Excel, cross-month aggregation, pace/burndown, precision panel | P3, P4 | Aggregation perf at all-time scope |
| **P6 Archive** | Section 4 browser over month folders | P0, P5 | mostly read-only UI |

Each phase ends with a **verification step**: unit tests for sampling/spillover math, a replay/idempotency test for each log, and an integrity round-trip test (write → tamper → detect).

## 17. 🆕 Integrity & tamper-evidence (server-less trust)

Because the workspace is a shared drive any user could edit directly, integrity cannot rely on file permissions. The app uses **hash-chained events** (research brief §5):

- Each event stores `prevHash = SHA-256(previous event)`. Altering/deleting/reordering breaks the chain at that point and is detectable by recomputation. (Extends the existing `hashText` from per-file to per-event chaining.)
- Each month's `integrity.json` holds the **head hash / Merkle root** for that month's logs.
- A supervisor's **"Verify integrity"** action recomputes chains and roots and flags any break, naming the first divergent event. Reporting/aggregation (§12.5) **refuses to merge** a month that fails.
- The current month's integrity root is **embedded in the exported Management report**, so a signed PDF/HTML deliverable anchors the root outside the editable folder — defending against an insider who edits both the log and its checksum.

This is the feature that lets an external government auditor _trust_ a browser-only, server-less system — turning "we promise we didn't change the records" into "here is the math that proves it."
