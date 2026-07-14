# Documentation Index — x-ray-quality-app

Organized by purpose. `EDIT_LOG.md` stays at this level — the build imports it (`?raw`, truncated by `src/build/editLogTruncatePlugin.ts`).

## Sections

| Folder | What lives there |
|---|---|
| [`architecture/`](architecture/) | How the system works: [`data-system-report.md`](architecture/data-system-report.md) (**authoritative disk-layout & file reference**), [`SECURITY_MODEL.md`](architecture/SECURITY_MODEL.md) (advisory-only trust model, risk acceptance), [`DATA_PIPELINE_REWORK_2026-07-14.md`](architecture/DATA_PIPELINE_REWORK_2026-07-14.md) (integrity-layer design record) |
| [`product/`](product/) | What the product is: [`PRODUCT_PAGES.md`](product/PRODUCT_PAGES.md) (every page/tab described), [`GAP_ANALYSIS.md`](product/GAP_ANALYSIS.md) (incomplete features rated by impact), [`PRODUCT_SPECIFICATION.md`](product/PRODUCT_SPECIFICATION.md), [`RELEASE_CHECKLIST.md`](product/RELEASE_CHECKLIST.md) |
| [`audit/`](audit/) | Audit reports & fix-wave records (2026-06 → 2026-07), newest: [`MASTER_AUDIT_2026-07-13.md`](audit/MASTER_AUDIT_2026-07-13.md) |
| [`research/`](research/) | External grounding: [`PIPELINE_RESEARCH_2026-07-14.md`](research/PIPELINE_RESEARCH_2026-07-14.md) (ISO 2859/ALCOA+/ISO 15489 gap table), [`VISUAL_LIBRARIES_2026-07-14.md`](research/VISUAL_LIBRARIES_2026-07-14.md) (visual-library evaluation) |
| [`design/`](design/) | Visual language: [`design-system.md`](design/design-system.md), [`DECK_VISUAL_UPGRADE_PLAN_2026-07-14.md`](design/DECK_VISUAL_UPGRADE_PLAN_2026-07-14.md) (deck overhaul spec), [`UI_ENHANCEMENT_PLAN.md`](design/UI_ENHANCEMENT_PLAN.md) |
| [`archive/`](archive/) | Historical/superseded: early numbered docs (01–04), staging edit log, `plans-history/` (implementation plans & specs, 2026-06 → 2026-07) |

## Domain guide — where each concept lives

| Domain | Code | Docs |
|---|---|---|
| **Data intake & population** (Excel import → raw → processed month) | `src/components/Sidebar/Tabs/Population/` (phases 1–2), `src/data/population/`, `src/workers/workbookWorker.ts` | architecture/data-system-report.md §population |
| **Sampling** (Hamilton apportionment, seeded draw, sampling plan, four-eyes release) | `src/data/sampling/` | research/PIPELINE_RESEARCH (ISO 2859), architecture/DATA_PIPELINE_REWORK §A1–A3 |
| **Distribution** (append-only event log → derived current state, assignment, replacement) | `src/data/distribution/` | architecture/data-system-report.md §samples |
| **Answers & inspection** (per-employee answer files, value history, templates) | `src/data/answers/`, `src/data/templates/`, EmployeeWorkspace tab | architecture/DATA_PIPELINE_REWORK §A4 |
| **Referrals & approvals** (requests, supervisor decisions, hash chains) | `src/data/referral/`, `src/data/approvals/` | architecture/SECURITY_MODEL.md §tamper-evidence |
| **Reporting** (executive/sample/distribution/management; deck/Excel/document trio) | `src/data/reporting/` (deck2 = live executive deck; `shared/reportChrome.ts`) | design/DECK_VISUAL_UPGRADE_PLAN |
| **KPIs & dashboards** (report model, reviewer KPIs, SPC p-charts) | `src/data/reporting/executive/model/`, `Tabs/Reports/ReviewerKpiPanel.tsx` | audit/TEAM_REVIEW_2026-07-05 Tier 2 |
| **Auth & permissions** (roles, permission matrix, sessions) | `src/auth/` | architecture/SECURITY_MODEL.md |
| **Storage & integrity** (safe writes, envelopes, CAS, locks, backups, audit log) | `src/data/storage/`, `src/data/backup/`, `src/data/audit/`, `src/data/integrity/` | architecture/data-system-report.md, EDIT_LOG v43–v49 |

## Conventions

- Every code edit is logged in `EDIT_LOG.md` (before/after, semver-lite) **before** it is applied — see CLAUDE.md.
- Audit and plan documents are immutable history: they keep the file paths that were true when written; this index and CLAUDE.md always point at current paths.
