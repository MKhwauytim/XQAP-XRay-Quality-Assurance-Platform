# Product Pages — Full Description (2026-07-22)

X-ray Quality Control application for the Zakat, Tax and Customs Authority (ZATCA). Arabic, RTL-first, single static HTML file run from Chrome/Edge; all business data lives as JSON in a shared workspace folder on disk (File System Access API). Used concurrently by 9+ employees; admin/supervisors administer, each employee owns isolated answers, presets, and customizations.

## Entry flow

**Workspace Picker** (`WorkspaceGate.tsx`) — First screen. Blocks until a workspace directory is chosen and structure-checked. Contains the unsupported-browser notice (non-Chromium), a reconnect path using the IndexedDB-persisted directory handle, and a hidden viewer-passcode shortcut that mounts an in-memory read-only demo workspace. Links forward to Login.

**Login** (`AuthGate.tsx`) — Username + password against managed users stored in `3-user-data/users.permissions.json` (Argon2id; legacy PBKDF2 verified and upgraded). Includes the hidden bootstrap-admin passcode modal, brute-force lockout (3 attempts → 30 s), and session persistence in `sessionStorage` (7-day TTL). Feeds the session into every permission check downstream.

**Workspace Gate + First-Run Checklist** — After login, gates on workspace structure (`ready`/`missing_structure`/`invalid_structure`) with admin self-repair buttons; a first-run checklist guides a fresh admin through creating users, setting permissions, and importing the first month, deep-linking into User Management and Population.

**App shell** (`App.tsx` + `Sidebar.tsx`) — Sidebar navigation auto-discovered from tab folders, filtered by role + permission matrix. Tabs stay mounted after first visit (state survives switching). Admin toolbar on top: role-preview switch (admin impersonates any role without re-login), logout, feedback. Notification banner surfaces workspace-wide announcements requiring acceptance.

## Tabs

### 1. Population (`population`, all roles) — the core workflow
Four-phase wizard plus a Browse sub-tab. A month picker reopens any previously saved month.

- **Phase 1 — Upload:** pick the risk-agency Excel (required) and BI Excel (optional). Parsed off-thread in a Web Worker with progress reporting; BI failure is a soft warning, risk failure blocks.
- **Phase 2 — Report & Processing:** Data Accuracy Report (risk-vs-BI column comparison, Excel-exportable), CertScan paste grid (persists workspace-globally), then population processing (dedup by x-ray ID, BI enrichment, CertScan matching, date/result normalization) auto-saved to `1-population/{month}/1-raw` + `2-processed`.
- **Phase 3 — Sampling:** per-stage rules (percentage/exact, CertScan quotas) drive a seeded, reproducible draw: Hamilton apportionment by port → CertScan/NonCertScan split → Fisher-Yates → capacity spillover. Writes `sample.master.json` + a sampling-proof audit document; re-draw is blocked once distribution events exist.
- **Phase 4 — Distribution:** bulk (per-employee/per-stage quota preview → commit) and manual (assign/reassign/complete/replacement) modes, both appending to the append-only `distribution.log.json`; current state is derived by folding the log (last event per row wins). Live summary cards; per-employee XLSX exports.
- **Browse:** cross-month explorer over 4 datasets (final population, sample, risk-raw, BI-raw) with column show/hide/reorder, per-column filters, search, per-user persisted presets, and filtered XLSX export.

**Links:** feeds Reports (all reports read this month data), Employee Workspace (assignments), Archive (month lifecycle).

### 2. Employee Workspace (`employee-workspace`, all roles)
- **صور الأشعة المحالة (X-ray Referrals):** each employee's personal queue of assigned images beside the InspectionPanel answer form (from the active template). Actions: submit answers, request replacement (instant for recommended candidates, approval-gated otherwise), refer to another employee (approval-gated, single or bulk), request reopen of a submitted answer. Oversight roles can view all employees.
- **نتائج فحص الأشعة (Inspection Results):** read-only reporting over distribution + answers, including replaced/referred audit sub-views; dynamically adds one column per template field; XLSX export.
- **اعتماد الطلبات (Referral Approval):** supervisor/manager unified queue merging referral, replacement, and reopen requests, each gated by its own feature permission; single and bulk approve/deny with notes; full history tab scanning all months.
- **نموذج الفحص (Inspection Form / TemplateBuilder):** admin visual builder for the shared multi-phase inspection template: phases, fields, types, required flags, conditional visibility (cycle-guarded runtime). Feeds the Referrals answer form via the active-template selection.
**Links:** consumes Population Phase 4 assignments; produces answers consumed by Reports/KPI; approval decisions write back distribution events.

### 3. Notification Center (`ew/notifications`, all roles; manager/admin by default)
Top-level management surface for broadcasting announcements and tracking acceptance per audience user. Default page permissions expose it to managers and admins; custom role grants remain supported. Employees and supervisors receive required announcements through the persistent app-shell banner without needing this management category.

### 4. Reports (`reports`, guest/supervisor/manager/admin)
- **التقارير:** month selector + report cards. Executive report (deck / Excel workbook / document — the reference 3-output model), Sample report, Distribution report, Management report, and Power BI CSV export (`5-system/powerbi-export/{month}/`). *(Post-rework: sample, distribution, and management each get the same 3 outputs as executive — deck, step-by-step Excel lineage, document.)*
- **مؤشرات الأداء (KPI, manager/admin):** live analytics dashboard on the executive report model: data-quality band, headline KPI cards (accuracy/detection/missed-suspicion/completion), gauges, outcome donut, reviewer-agreement and port-accuracy ranked bars/tables, stage coverage, employee overview, error-type-by-port heatmap; export toolbar reuses the same loaded model so screen and files can't disagree.
- **مصمم التقارير (Report Designer, supervisor+):** Power-BI-style free-form canvas: multi-page designs, drag fields, text/shape/image/KPI elements, autosaved designs with live thumbnails, print view. (Table/chart elements are scaffolded but not yet enabled.)

**Links:** reads population/sample/distribution/answers from disk; writes report artifacts and CSV exports back to the workspace.

### 5. Archive (`archive`, guest/supervisor/manager/admin)
Backup/restore and month-lifecycle console: aggregate workspace stats, auto-backup settings (daily/weekly), manual backup, per-month status table (raw/processed/sampled/distributed) with close/reopen-month actions (feature-gated), backup history with type-to-confirm restore (auto-creates a pre-restore rollback snapshot, offers post-restore user/label re-import).

### 6. User Management (`user-management`, admin)
Four sub-sections: **Users** (CRUD, roles, active flag, CertScan license, password reset, deletion blocked while the user holds active assignments); **Page permissions** (role × tab matrix, none/view/edit); **Feature permissions** (~30 granular toggles cascading under page access); **Activity** (login/logout history with per-user duration summaries).

### 7. Settings (`settings`, guest/admin)
Label customization center: ~11 collapsible groups of UI strings backed by the label store (localStorage + workspace snapshot), per-row and bulk reset; error-log viewer (in-memory ring buffer, admin feature-gated); about/version info.

### 8. Change Log (`change-log`, admin)
Versioned edit history aggregated from `docs/edit logs/*.md` (one file per date; truncated to recent versions in production builds): searchable, collapsible entries, newest first.

## Data flow at a glance

```
Excel (risk + BI) → [Population P1/P2] → population.final.json
                  → [P3 sampling] → sample.master.json
                  → [P4 distribution] → distribution.log.json (append-only) → derived current + per-employee mirrors
Employee answers → 2-samples/{month}/answers → [Approvals] → distribution events (replace/reopen/reassign)
All of the above → [Reports/KPI/Designer] → HTML decks, Excel workbooks, documents, Power BI CSVs → 4-reports / downloads
Everything       → [Archive] → 5-system/backups
```
