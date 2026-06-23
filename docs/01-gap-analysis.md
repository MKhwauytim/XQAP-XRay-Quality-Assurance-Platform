# Gap Analysis — Current App vs. Build Spec v0.6

_Generated 2026-06-14. Based on a read of the `src/` tree (~9,000 LOC) against the v0.6 specification._

## How to read this

Each item is rated by **severity**:

- **🔴 Blocker** — the spec's core promise can't work without it.
- **🟠 Major** — substantial feature missing or built on the wrong model.
- **🟡 Minor** — partial, cosmetic, or easily reconciled.
- **🟢 Done** — implemented and broadly matches the spec.

## 1. Executive summary

The app today is a **solid Phase-1 engine with the rest of the workflow stubbed**. The population-processing pipeline (import → clean → dedup → BI-enrich → validate → CertScan classify → export → HTML report) is real, detailed, and close to spec. Everything _after_ processing — sampling, distribution, the employee workspace, reassignment, KPI, the management report, cross-month aggregation — is either a placeholder or absent.

Two structural decisions in the current code **contradict the v0.6 data model** and will force rework if not addressed before building Phases 2–4:

1. The workspace on disk is a **single flat workspace**, not the **per-month folder tree** (`Data/Population/MM-Month/…`) the spec is built around.
2. Persistence uses **lock-file + revision concurrency for everything**, whereas the spec's §11A concurrency guarantee depends on **event-sourced, per-writer, append-only files** that need no locking on the employee path.

Net: roughly **35–40% of the spec is built** (Phase 1 + auth + the unwired disk layer). The remaining 60% is the harder, more novel part — and the current data shapes need revision first.

## 2. What exists and works 🟢

| Area | State | Notes |
|---|---|---|
| Auth & login | 🟢 | PBKDF2-SHA256 (210k iters), bootstrap admin hash, session in `sessionStorage`. Matches §5.1. |
| Role + permission matrix | 🟢 | `userManagement.ts` (249 LOC) + `UserManagement` tab (511 LOC). Role→tab `view/edit/none`, live DOM-event broadcast. Matches §4/§5.1. |
| Workspace disk layer (primitives) | 🟢 | `fileSystemAccess.ts` (802 LOC): FS Access API detection, structure check/create, `JsonEnvelope`, revision-checked save, lock acquire/release. The plumbing in §5.2 is genuinely built. |
| Population processing | 🟢 | `populationProcessor.ts` (620 LOC) implements all seven §7 steps incl. BI per-field fill summary and CertScan grouping. |
| Excel export | 🟢 | `populationExporter.ts` (498 LOC). |
| Population HTML report | 🟢 | `reportHtmlBuilder.ts` (1,139 LOC) — the single biggest file; corresponds to §12.1. |
| RTL/Arabic UI | 🟢 | Consistent `dir="rtl"`, Arabic strings, co-located CSS. Matches conventions. |

## 3. Structural divergences 🔴 — fix before building further

### 3.1 Flat workspace vs. per-month folders 🔴

The spec (§6) is organized entirely around `Data/Population/5-May/{raw,processed,sample,reports}/…`, one self-contained folder per monthly run, which is what makes archiving, cross-month reporting (§12.5), and per-month per-employee answer files (§6, §11A) possible.

The code (`workspaceDefaults.ts`, `workspaceTypes.ts`) defines a **single** set of root files: `workspace.manifest.json`, `data.raw.json`, `data.processed.json`, `sample.master.json`, `sample.distribution.json`, plus one `employee-answers/` folder. There is no month dimension anywhere — no folder-name parsing (`MM-MonthName`), no month manifest, no concept of "the May run."

**Impact:** every downstream feature (multi-wave distribution, cross-month KPI, archive browser) assumes the month tree. This is the single highest-leverage thing to correct.

### 3.2 Disk layer is built but **not wired** to the UI 🔴

`useWorkspace` / `saveJsonWithRevisionCheck` / `loadWorkspaceFiles` are referenced **only in `main.tsx`** (to mount the provider). The `Population` tab does all its work in-memory from a file `<input>` and writes nothing back through the envelope/revision protocol. So Phase-1 results are exported as Excel/HTML but **never persisted to the workspace JSON as the source of truth** the spec demands. The backbone exists; nothing rides on it yet. (The spec itself flags this in §15.)

### 3.3 Concurrency model mismatch 🟠

`fileSystemAccess.ts` implements lock files + revision optimistic concurrency for all saves. The spec's §11A explicitly says the employee path should be **lock-free by construction**: one append-only file per employee per month, masters read-only, "reference never copy." The lock machinery is correct for the **rare single-writer master writes** (§11A.6) but should _not_ be on the per-keystroke employee path. Today there is no per-writer append-only file at all, so the design that prevents corruption (§11A.1) isn't realized.

## 4. Feature gaps 🟠 / 🔴

### 4.1 Sampling (Phase 2) — stub 🔴

`Population/index.tsx` `PHASES[]` lists "اختيار العينة" with a description and **no logic**. Missing entirely:

- Stage-aware draw (stages 1–4).
- KPI floor of 6250 across stages 2–4 with the 40/30/30 target split (§13.1).
- Supply-aware, cascading **spillover allocation** (§13.2).
- Certscan/NonCertscan split and the operator-chosen CertScan share (§8).
- `selectionMethod` is a nullable string in `SampleMasterData` but no method is implemented.

Stages are currently only _counted for display_ during processing (`StageCounts` in `index.tsx`), never used as sampling inputs.

### 4.2 Distribution (Phase 3) — stub, and wrong shape 🔴

Spec §9 defines distribution as an **append-only event log** (`distribution.events.json`) with seven event types and a derived `distribution.current.json`. The code models it as a flat array of `SampleAssignment` records with a single `assignedToUsername` and a status enum — i.e. last-write-wins mutable ownership, not an event log. None of `INITIAL_DISTRIBUTION`, `NEW_WAVE`, `EMPLOYEE_REQUEST`, `REQUEST_APPROVED/DENIED`, `SUPERVISOR_REASSIGN`, `REPLACEMENT` exist. There is no `reassign.requests.json`.

### 4.3 Employee Workspace (Section 3) — absent 🔴

Only **two tabs** exist (`Population`, `UserManagement`). There is no employee-facing tab. Consequently none of §11 exists: self-scoped row view, admin-configured visible columns, study template, read-only prior-owner layers, raise-reassignment-request.

### 4.4 Stacked work layers (§10) — wrong model 🟠

`EmployeeAnswer` is a single editable blob (`answers: Record<string, unknown>` + status). The spec requires an **ordered stack of layers per row**, each owned by one employee, frozen read-only on handoff. Also `EmployeeAnswersData` currently embeds `sampleId` per answer but the spec mandates **reference-not-copy** (§11A.2): store `{rowId, answer}` and resolve against master, never copy row payload. `SampleRecord.payload` copying row data into the sample is itself a §11A.2 risk to revisit.

### 4.5 Data Archive (Section 4) — absent 🟠

No browser/explorer view over month folders. Depends on §3.1 (month tree) existing first.

### 4.6 Audit trail — folder created, never written 🟠

`.system/audit/` and `.system/locks/` are created by `createWorkspaceStructure`, but **nothing appends audit events**. `saveJsonWithRevisionCheck` bumps revision and re-hashes but writes no audit record. Spec §5.2 ("all mutations append to `.system/audit/`") is unmet. No tamper-evidence (see research brief §5).

### 4.7 Reporting beyond population — absent 🟠

Only the §12.1 population report exists. Missing: Findings report (§12.2), **Management report التقرير الإداري** (§12.3, the leadership deliverable), KPI report + 2-sheet Excel (§12.4), and all cross-month/time-range aggregation (§12.5). The derived metrics — working days (§12.3.1), daily/weekly pace and burndown vs. target (§12.3.2), per-employee performance and reassignment counts (§12.3.3) — have no supporting data because the answer logs that feed them don't exist yet.

### 4.8 Permission scoping of sections 🟡

Both existing tabs declare `allowedRoles: ["employee","supervisor","admin"]`. Per §4, User Management should be admin-only, the monthly run admin+supervisor, and the employee workspace self-scoped. Tab-level role gating needs tightening, and "edit-Population roles" / supervisor-only actions need enforcement points.

### 4.9 CertScan license enforcement 🟡

§8/§13 open question Q1. Nothing in code is aware of the "only 2 employees may hold CertScan rows" capacity. No enforcement, warn, or override path.

## 5. Open questions from the spec — current code position

| § | Question | Code today | Recommendation (see v0.7) |
|---|---|---|---|
| 13 Q1 | CertScan license enforcement | none | Warn-but-allow-override + capacity meter |
| 14 Q2 | Study template fields | none | Define minimal v1 template now; it unblocks §10/§12.2 |
| 14 Q3 | Month-folder year handling | none | `MM-MonthName-YYYY`, parsed canonically |
| 14 Q4 | Locking granularity | per-file locks built | Keep per-file for masters only; employee path lock-free |
| 14 Q5 | Replacement supply pool | none | Unsampled remainder of same stage, then cascade |

## 6. Suggested correction order

1. **Introduce the month tree** (§3.1) — refactor `workspaceDefaults`/`workspaceTypes` to a `MonthContext`. Everything else depends on it.
2. **Wire Phase 1 to disk** (§3.2) — persist `raw`/`processed`/`population.final` through the envelope protocol inside the active month folder.
3. **Re-shape distribution as an event log** and answers as **append-only per-writer layer stacks** (§3.3, §4.2, §4.4).
4. Build **sampling** with stage/KPI/spillover math (§4.1).
5. Build the **Employee Workspace** + study template (§4.3).
6. Build **reassignment** flows + **audit append** + **tamper-evidence** (§4.2, §4.6).
7. Build **cross-month reporting** family incl. the management report (§4.7).
8. Add the **Archive** browser (§4.5).

This ordering is expanded into a phased roadmap in the enhanced spec (v0.7 §16).
