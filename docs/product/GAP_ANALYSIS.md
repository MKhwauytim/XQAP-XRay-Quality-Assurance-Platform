# Gap analysis — updated 2026-07-17

Incomplete features, features that don't make full sense as built, and enhancement opportunities. Consolidated from the 8-domain audit (`docs/audit/MASTER_AUDIT_2026-07-13.md`). Items marked ✅ were fixed in the 2026-07-13/14 autonomous fix run; others are the prioritized backlog.

## Incomplete / half-built features

| # | Gap | Impact | Status |
|---|-----|--------|--------|
| G1 | **ReportDesigner Table & Chart elements**: types and query engine exist, but end-to-end authoring/rendering is incomplete. | High | Partially resolved: unfinished controls are no longer advertised; experimental-file compatibility remains. Product decision: complete the vertical slice or retire the dormant model. |
| G2 | **KPI cards computed from the wrong dataset** (field catalog promises executive-row fields; renderer feeds raw population rows — 21/24 fields silently zero). | High | ✅ Fixed (fed from executive rows + shared `aggregate()`) |
| G3 | **Executive deck v2** was reachable only from a dev preview page. | Medium | ✅ Fixed (v2 is the production Reports export; v1 remains a reference edition pending a retirement date) |
| G4 | **Per-employee column presets**: per-user save path fully built and tested but never called — saves went to the shared admin file, and the admin file won over personal files. Opposite of the isolation requirement. | High | ✅ Fixed (personal saves wired; personal overrides shared default) |
| G5 | **Feedback widget unreachable for non-admins**: full employee submit UI exists; only admins had a trigger button. | Medium | ✅ Fixed (floating trigger for all roles) |
| G6 | **Governance audit trail invisible**: `actions.log.json` was written but no screen exposed it. | High | ✅ Fixed (workspace-actions view in User Management, separate from sign-in activity) |
| G7 | **`reopenSubmittedAnswer`'s distribution side-effect** only fires for admin-marked-complete rows; the normal submit path never emits `completed` events, so the documented guarantee doesn't apply to the common case. | Low | Backlog (product decision: emit completed on submit, or fix docs) |
| G8 | **Dead/legacy paths**: `portEmployeeData` had only a self-test; the legacy `totalSampleSize` sampling API and `topN` query operator were suspected dead. | Low | ✅ Resolved (`portEmployeeData` removed; legacy sampling kept as an explicitly tested compatibility API; `topN` is executed after aggregation by `runQuery`) |

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

1. **True cross-machine write arbitration** — immutable per-event distribution files now eliminate the shared event-log target, but strict global ordering, atomic multi-event operations, and exactly-once delivery still require a backend transaction authority. (High, architectural)
2. **Finish or intentionally narrow Report Designer** (G1). (High, product decision)
3. **DataTable column sorting** — no sort anywhere; basic expectation for data-heavy screens. (High)
4. **Draft-save / autosave for the inspection form** — multi-phase answers are currently all-or-nothing; switching rows loses typed input. (High)
5. **Session-expiry & forced-logout messaging** — silent lockouts confuse users. (Medium — partial fix shipped in wave 2)
6. **Per-tab error boundaries** — ✅ shipped; component stacks now also enter the shared diagnostic ring buffer.
7. **Ambiguous-date detection in Excel import** — day-first is assumed; flag ambiguous `NN/NN/YYYY` values or add a per-file format setting. (Medium)
8. **Design-system adoption** — `.ui-btn`/StateViews primitives exist but admin tabs re-roll their own buttons/empty-states; visual drift for a government UI. (Medium)
9. **Label-key extraction sweep** — most Population/Archive/UserManagement copy is hard-coded Arabic, invisible to the Settings customization feature. (Medium)
10. **Accessibility continuation** — the shell/mobile drawer, settings controls, sidebar state, reduced motion, and reviewer KPI semantics were fixed in v56.2; continue with DataTable popovers and inline confirmations. (Medium)
11. **Atomic backup restore** — restore-in-progress marker or staging-folder flip. (Medium)
12. **Test-coverage debt** — executive document edition (9 files, 0 tests), casLoop two-writer scenarios (added in wave 1), templateRuntime, answerStorage, exportManager. (Medium)
13. **Browse raw datasets unbounded in memory** — require month scoping or paginate loads. The shell now bounds mounted tabs, but dataset reads themselves remain eager. (Low-Medium)
14. **Month-lock TTL (30 s fail-open window)** — consider shorter TTL for distribution writes. (Low)
15. **Retire the v1 executive deck after a defined comparison period** so report-model changes do not maintain two presentation engines indefinitely. (Low-Medium)
