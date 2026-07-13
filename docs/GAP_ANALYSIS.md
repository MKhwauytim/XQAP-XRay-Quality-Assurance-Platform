# GAP Analysis — 2026-07-13

Incomplete features, features that don't make full sense as built, and enhancement opportunities. Consolidated from the 8-domain audit (`docs/audit/MASTER_AUDIT_2026-07-13.md`). Items marked ✅ were fixed in the 2026-07-13/14 autonomous fix run; others are the prioritized backlog.

## Incomplete / half-built features

| # | Gap | Impact | Status |
|---|-----|--------|--------|
| G1 | **ReportDesigner Table & Chart elements**: types, query engine (`runQuery`/`aggregations`/`filters`/`buildDataModel`) all built and tested, but toolbar buttons disabled, Inspector shows "later" placeholder, Canvas renders placeholders. The tested engine has zero production consumers. | High — flagship designer looks half-finished | Backlog (decision: finish wiring or ship as KPI/text/shape-only) |
| G2 | **KPI cards computed from the wrong dataset** (field catalog promises executive-row fields; renderer feeds raw population rows — 21/24 fields silently zero). | High | ✅ Fixed (fed from executive rows + shared `aggregate()`) |
| G3 | **Executive deck v2** (~2,400 lines, tested) reachable only from a dev preview page, never wired into Reports. | Medium | Backlog (wire as the deck engine for the report rework, or track as WIP) |
| G4 | **Per-employee column presets**: per-user save path fully built and tested but never called — saves went to the shared admin file, and the admin file won over personal files. Opposite of the isolation requirement. | High | ✅ Fixed (personal saves wired; personal overrides shared default) |
| G5 | **Feedback widget unreachable for non-admins**: full employee submit UI exists; only admins had a trigger button. | Medium | ✅ Fixed (floating trigger for all roles) |
| G6 | **Governance audit trail invisible**: `actions.log.json` (user deletions, permission changes, month close, restores…) is written but no screen reads it; the "Activity" tab shows only logins. For a government product this is a compliance-grade gap. | High | Backlog — recommended next feature (viewer inside User Management → Activity) |
| G7 | **`reopenSubmittedAnswer`'s distribution side-effect** only fires for admin-marked-complete rows; the normal submit path never emits `completed` events, so the documented guarantee doesn't apply to the common case. | Low | Backlog (product decision: emit completed on submit, or fix docs) |
| G8 | **`portEmployeeData` / legacy `totalSampleSize` sampling branch / `topN` filter op**: tested or typed but dead. | Low | Backlog (wire or remove) |

## Features that don't make full sense as built

| # | Gap | Impact | Status |
|---|-----|--------|--------|
| G9 | **Permission matrix cells that do nothing**: static per-tab `allowedRoles` silently overrides the admin-editable matrix (settings/manager, reports-kpi/supervisor, user-management, change-log). Admin toggles a cell → nothing happens, no explanation. Two different permission ids (`reports/kpi`, `reports/analytics`) gate the same screen. | High — misleads admins | ✅ Fixed (matrix is authoritative where safe; unreachable cells locked & explained) |
| G10 | **Reports lacked a consistent output model**: executive had deck+Excel+document; sample/distribution got ad-hoc HTML + independently re-derived XLSX (drift risk); management was HTML-only; population receipt had its own escaping/CSS. Each report told a fragment, not the full received→chosen→processed→fixed→mapped→compared story. | High | ✅ Reworked (unified 3-output model on shared view-models + executive infrastructure) |
| G11 | **Data Accuracy Report used a different match key than actual processing** — the accuracy screen could contradict the pipeline it audits. | High | ✅ Fixed (shared match-key) |
| G12 | **Employee queue trusted a stale mirror over fresh derived state computed in the same function.** | Medium | ✅ Fixed |
| G13 | **Manual reassign could silently un-complete a submitted inspection**, bypassing the approval-gated reopen workflow that exists for exactly that transition. | Medium | ✅ Fixed (fold + UI guards) |
| G14 | **TypeScript "strict mode" documented but not enabled** in any tsconfig. | High (safety net illusion) | See wave-4 note in EDIT_LOG (enabled/assessed) |

## Enhancement opportunities (prioritized backlog)

1. **True cross-machine write arbitration** — wave 1 hardened casLoop (pre-write freshness check, delayed double verify, terminal-error classification), which shrinks the lost-update window dramatically but cannot eliminate it without an atomic primitive. Long-term options: per-writer append files merged on read, or a lightweight lock-file reservation protocol. (High)
2. **Governance audit-log viewer** (G6). (High)
3. **DataTable column sorting** — no sort anywhere; basic expectation for data-heavy screens. (High)
4. **Draft-save / autosave for the inspection form** — multi-phase answers are currently all-or-nothing; switching rows loses typed input. (High)
5. **Session-expiry & forced-logout messaging** — silent lockouts confuse users. (Medium — partial fix shipped in wave 2)
6. **Per-tab error boundaries** — one tab crash shouldn't kill the whole shell. (Medium — shipped in wave 2)
7. **Ambiguous-date detection in Excel import** — day-first is assumed; flag ambiguous `NN/NN/YYYY` values or add a per-file format setting. (Medium)
8. **Design-system adoption** — `.ui-btn`/StateViews primitives exist but admin tabs re-roll their own buttons/empty-states; visual drift for a government UI. (Medium)
9. **Label-key extraction sweep** — most Population/Archive/UserManagement copy is hard-coded Arabic, invisible to the Settings customization feature. (Medium)
10. **Accessibility pass** — focus traps and dialog semantics for DataTable popovers and inline confirms; unify on ConfirmDialog. (Medium)
11. **Atomic backup restore** — restore-in-progress marker or staging-folder flip. (Medium)
12. **Test-coverage debt** — executive document edition (9 files, 0 tests), casLoop two-writer scenarios (added in wave 1), templateRuntime, answerStorage, exportManager. (Medium)
13. **Browse raw datasets unbounded in memory** — require month scoping or paginate loads. (Low-Medium)
14. **Month-lock TTL (30 s fail-open window)** — consider shorter TTL for distribution writes. (Low)
15. **Finish or retire ReportDesigner table/chart** (G1) and executive deck v2 (G3). (Decision needed)
