# Five-Agent Team Review — Synthesis and Refined Plan

**Date:** 2026-07-05
**Method:** Five parallel specialist reviews (Developer, Debugger, Standards Researcher, Gap Analyst, Design Lead), read-only pass, synthesized and rated by the orchestrator. Extends `FULL_SYSTEM_AUDIT_2026-07-02.md`; items already tracked there are not repeated.

**Baseline health:** lint clean, 300+/300 tests passing, zero `any` in `src/`. The engineering core (RNG, apportionment, CAS write tokens, date math) was independently verified sound.

---

## Cross-confirmed findings (found independently by 2+ agents)

| Finding | Confirmed by | Verdict |
|---|---|---|
| Replacement candidate selection uses `Math.random()` — non-reproducible, un-auditable (`src/data/distribution/replacement.ts:45`) | Debugger + Gap Analyst | P0 fix |
| Silent `catch {}` blocks bypass `errorLogger` (`distributionStorage.ts`, `fileSystemAccess.ts`) | Developer + Debugger | P0 fix |
| Audit-defensibility is the app's weakest theme: numbers an external auditor would probe (totals, reproducibility, single source of "completed") are exactly where defects sit | Researcher + Debugger + Gap Analyst | Drives Tier 0/1 priority |

---

## Tier 0 — Correctness hotfixes (approved, dispatched 2026-07-05)

All confirmed, small, high-value. Single-writer implementation to avoid conflicts.

1. `totalAssigned` counts dead (replaced) rows — `distributionLog.ts:233`. Exclude `replaced`; document invariant `pending + completed + replacementRequested == totalAssigned`.
2. Seed replacement candidate selection from month RNG seed + `xrayImageId` (replace `Math.random()`), using `rng.ts` helpers.
3. Legacy-config spillover rows missing from `portAllocations` per-port totals — `sampleAlgorithm.ts:137-150`; mirror the stage-path reconciliation (lines 366-378).
4. Event-fold state machine: once `replaced`, ignore non-`replaced` transitions; log dropped illegal transitions via `errorLogger`. Prevents resurrected rows double-counting the sample on shared folders.
5. Route silent catches in `distributionStorage.ts` (incl. fire-and-forget `saveDistributionCurrent`) through `logError`.
6. Block sample re-draw when a distribution log exists (`Population/index.tsx` `handleDrawSample`) — currently orphans every assignment/answer silently.
7. Warn/block month re-processing when a sample already exists (`populationStorage.ts` / caller).
8. Advance manifest `status` to `sampled` / `distributed` (enum exists, never written — dead state machine).
9. Unify "completed": report summary band (`reportModel.ts:226`) must use the same answer-derived (`submitted`) source as the fact table (`decisionFactTable.ts:102`).
10. Remove the two production emojis: `Reports/index.tsx:410` (🗂 → lucide `FolderOpen`), `MappingSettingsModal.tsx:685` (➕ → lucide `Plus`).

**Deferred from Tier 0 (needs its own careful pass + tests):** safeWrite first-write recovery hole (live-verify failure with no `.bak` orphans a good `.tmp` — promote `.tmp` instead of throwing). Touches the most critical persistence path; do not rush.

## Tier 1 — Lifecycle governance (next; medium effort)

- **Month close-out/lock** (Gap Analyst, critical): add `closed` manifest status + admin close action; gate all writes for a closed month. Cornerstone for report integrity and the ISO 9001 documented-information posture. Everything below benefits from it.
- Referral approval: idempotency guard (`status === "pending"`), verify current ownership of `xrayImageIds` before emitting events (`ReferralApproval.tsx:128`).
- User deletion: check active assignments; block or force-reassign; warn about orphaned answer files (`UserManagement/index.tsx:420`).
- Supervised "reopen for correction" for submitted answers (admin/supervisor, logged who/when).
- Extend audit trail to sensitive actions: user delete, permission changes, re-draw, referral approval, answer reopen.
- Backup must cover localStorage state (users, hashes, permission matrix, labels) — currently lost on machine migration. Document that restore is a merge, not a snapshot restore.
- safeWrite `.tmp` promotion fix (from Tier 0 deferral) with dedicated tests.

## Tier 2 — Reporting/KPI value (small-medium, high visibility)

- **Per-reviewer KPI upgrade** (merged: Gap #14 + Researcher p-charts + KPI headline proposal): workload, throughput vs quota, turnaround (assignedAt→submittedAt), referral rate — all fields already on the decision record. Add p-chart (UCL/LCL) drift bands per reviewer/port via recharts.
- Sampling-methodology metadata in executive report (method, seed, percentages, and later AQL level) — report credibility, near-zero cost.
- Archive integrity badges: flag months where answers/sample/distribution counts disagree.
- SEC-01 closure: formal risk-acceptance record for the advisory-only security model.

## Tier 3 — Standards program (strategic; sequence after Tiers 0-1)

Rated from the Researcher's 20 proposals:

| Proposal | Rating | Notes |
|---|---|---|
| Inter-rater reliability (Cohen's kappa, blind double-review of 15-20%) | Flagship — highest strategic value | New `src/data/reliability/`; depends on fold guard (T0) + month lock (T1) |
| TIP-style seeded gold-standard images | High | Depends on same foundations; `seeded` flag on assignment events; ~100 events per reviewer for reliability |
| ISO 2859-1 AQL sampling mode + lot accept/reject + switching rules + plan-validation warnings | High (bundle as one epic) | Makes sample sizes standards-defensible; extends `sampleAlgorithm.ts` + Phase 3 UI |
| Nonconformity/CAPA records (ISO 9001 §10.2) | Medium | New module; extends referral flow with root cause + corrective action + verification |
| Template version history (ISO 9001 §7.5) | Medium | Forms define "quality"; currently no change history |
| Reviewer competence records (ISO 17020) | Medium-low | After kappa/TIP exist to feed it real scores |
| Internal audit programme (ISO 19011) | Low for now | Revisit after CAPA |
| Conflict-of-interest rules, reviewer rotation, scanner metadata, artifact flag | Parked | Fold artifact flag into kappa design when built |

## Tier 4 — Code health and design system (continuous)

Refactors (Developer's ranking, endorsed): 1) shared EmployeeWorkspace column factory + `useMonthInspectionData` hook (~2,000 duplicated lines); 2) split `Population/index.tsx` (2,274 lines, 44 useState) into per-phase hooks; 3) consolidate 4 djb2 + 3 `stableStringify` copies into `src/data/storage/hash.ts` (also de-risks the `saveJsonWithRevisionCheck` formatting-coupling hazard); 4) unify the two envelope systems; 5) de-duplicate the safeWrite stage/commit/rollback state machine. Also: consume `usePermissions()` in EmployeeWorkspace views; type `loadMonthForEditing` to remove `as unknown as` casts.

Design (Design Lead, endorsed — system is good, adoption is not):
- De-hardcode 589 naked hex literals, starting `UserManagement.css` (93) and `Archive.css` (86); normalize off-scale radii.
- Fix ReportDesigner RTL physical-property leaks (`left:`/`right:` → logical); audit remaining ~40 physical-property occurrences individually.
- Fill `:focus-visible` gap across 8 tab stylesheets (route custom interactive elements through `.ui-btn`).
- Adopt the proposed 9-step `--fs-*` type scale incrementally (38 ad-hoc font sizes today) — file-by-file as touched, not mass find-replace.
- Add a CI lint failing on new naked hex / off-scale font sizes — protects the system.
- Doc drift: CLAUDE.md says recharts is used in EmployeeWorkspace; only Reports imports it today.

---

## Execution order

1. **Tier 0** — dispatched to the Developer agent (single writer, EDIT_LOG discipline, full lint+test verification, no commits) — 2026-07-05.
2. Debugger verification pass over the Tier 0 diff.
3. Tier 1 lifecycle governance (plan first; month lock is the keystone).
4. Tier 2 KPI/reporting upgrades.
5. Tier 3 standards epics (kappa first).
6. Tier 4 runs continuously alongside, file-by-file.
