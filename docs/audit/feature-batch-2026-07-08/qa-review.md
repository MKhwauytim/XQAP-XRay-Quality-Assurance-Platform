# QA review — feature-batch-2026-07-08 (final pre-merge pass)

**Reviewer:** Fable QA pass (Stage-5 mirror, per plan.md "Final steps")
**Date:** 2026-07-12
**Scope:** all 19 commits on `feature-batch-2026-07-08` since `hardening-2026-07-08` (merge-base `33f6ce50`), 59 files, per `full.diff` + direct source verification on the branch.

## Verdict

**APPROVED — ready for final verification and merge.**

Lint clean, **457/457 tests pass (70 files)**, `npm run build` succeeds (dist/index.html 2.64 MB, 967 kB gzip). No correctness or data-safety defect found in any batch. Eight non-blocking advisories are listed below (ranked); none is reachable under shipped defaults or the verified real deployment (Test6), and none corrupts data. Diff integrity confirmed: `full.diff` is byte-identical in file coverage to `git diff hardening-2026-07-08..HEAD` minus the two documented exclusions (59 = 59, no missing files), and every file cited in EDIT_LOG v42.49–v42.74 (51 unique paths) is present in the diff.

---

## Focus-area findings

### Batch C — permissions overhaul

**موروث removal is faithful; the regression test pins real values.**
`src/auth/userManagement.test.ts:72-89` asserts 20 explicit role×sub-tab literals via `getRolePermission` — not merely "doesn't error". I independently re-derived the pre-change effective access from the untouched parent rows (`userManagement.ts`: population = view/view/view/edit for guest/employee/supervisor/manager; reports = none/none/view/edit) and the baked rows at `userManagement.ts:423-445` match exactly. The fallback deletion (`userManagement.ts:503-514`) and its UI copy (`UserManagement/index.tsx:456-462`) are symmetrical; no other sub-tab lacked an explicit row with a non-"none" parent (user-management/* parents are "none" for all non-admin roles, so missing-row → "none" is unchanged).

**Upgrade path verified.** Existing installs hydrate from disk via `WorkspaceProvider.tsx:370` → `syncUsersFromDisk` → `writeUserManagementState` → `normalizeUserManagementState` (`userManagement.ts:581-616`), which backfills missing role×tab rows AND missing featureIds from defaults. So a pre-existing `users.permissions.json` without the 4 new explicit rows, or without the 5 new featureIds, resolves to the baked defaults on next workspace open — no silent lockout (see advisory 4 for the one theoretical caveat).

**archive.closeMonth hardcode removal is the documented intentional change, not a bug.** `Archive/index.tsx:85-89` now trusts the feature toggle alone; `hasFeature` returns `true` unconditionally for admin (`userManagement.ts:532`) and the default matrix row is all-false for managed roles (`userManagement.ts:328`), so default behavior is byte-identical (admin-only) while the toggle becomes functional for other roles — exactly per plan §C3 and EDIT_LOG v42.60. `isAdmin` remains live for the Archive backup/restore actions (lines 126–508), so no dead code.

**The other 4 gap-fixes preserve current behavior:**
- `unlock-sampling-stage` (`PhaseThreeSampling.tsx:100-109`): default all-false + admin-always-true ⇒ admin-only, unchanged.
- `manage-inspection-template` (`TemplateBuilder/index.tsx:188-193`): default manager=true ⇒ manager+admin, matching the removed `role !== "manager" && role !== "admin"` check.
- `view-error-log` (`ErrorLogSection.tsx:12-15`): default all-false ⇒ admin-only, unchanged.
- `configure-referral-columns` shared-preset push (`XrayReferrals.tsx:860-862`): intended behavior change (supervisor/manager can now publish the shared preset), documented in EDIT_LOG v42.63. The plan's second cited site was the DataTable column-config gate, which was already feature-driven at the merge-base (verified via `git show hardening-2026-07-08`) — nothing missed. The remaining `canEdit = role === "admin"` at `XrayReferrals.tsx:203` gates distribution mutations, a different concern deliberately out of scope.

### Batch D — cross-machine write safety

**The CAS pattern is applied genuinely, not decoratively.** In all four new appliers — `approvalStorage.appendDecisionEvent`, `browsePresetStorage.saveAdminBrowseDatasetPreset`, `populationStorage.updateMonthStatus`, `populationConfig.savePopulationConfig` — the *entire read* happens inside the `casLoop` attempt callback, so every retry re-reads fresh on-disk state, recomputes `revision+1`, writes with a fresh `_writeToken`, and re-verifies BOTH revision and token on read-back before declaring success (`casLoop.ts:34-61` returns `{done:false}` → retry with jitter). This matches the approved `appendDistributionEvents` reference implementation line-for-line. Month-lock gates stay *outside* the loop so `MonthClosedError` rejects loudly instead of being retried. Each module carries a concurrent-writer test (`approvalStorage.test.ts`, `browsePresetStorage.test.ts`, `populationStorage.test.ts`, `referralStorage.test.ts`) asserting both writes survive.

**The populationConfig whole-object-replace tradeoff is honestly represented.** The code comment (`populationConfig.ts` savePopulationConfig) states explicitly: "field-level merge is out of scope — CAS here guarantees an atomic, verified, last-writer-wins-cleanly write with a detectable revision, not a three-way merge." The test (`populationConfig.test.ts:44-63`) asserts exactly that contract: one writer's intact payload, never a torn hybrid — no overclaiming. `loadPopulationConfig` reconstructs the object field-by-field (lines 384-399), so `revision`/`_writeToken` bookkeeping cannot leak into consumers (test-pinned).

**`updateMonthStatus` converges correctly:** on retry after a lost race it re-reads the manifest, and the monotonic rank guard (`currentRank >= STATUS_RANK[status]` → done) means the *higher* status always wins; the closed-month freeze is preserved inside the loop. Test pins concurrent sampled/distributed → "distributed".

### Batch B — reopen workflow + unified approval page

**The `reopen-requested` fold arm cannot produce an inconsistent state.** `distributionLog.ts:237-245`: it is a pure non-mutating marker — `status = existing?.status`, assignedTo/replacedById carried forward — so a completed row *stays completed* while the request is pending (no stuck-pending, no total drift; totals are status-derived and status is unchanged). Events for unknown rows are skipped (`:193-195`), and the terminal-state guard (`:209-213`) drops it after `replaced` (test-pinned at `distributionLog.test.ts:211-246`, all three transitions: pending marker, approved→pending, replaced→dropped). Only the terminal `reopened` event ever flips status, and it is emitted solely through the replay-guarded `reopenSubmittedAnswer` (`reopenAnswer.ts:88-108`, stable `sourceRequestId` keyed on `previousSubmittedAt`), so two concurrent approvers converge: second applier hits the same sourceRequestId → skip; duplicate decision events carry the same status (last-wins, benign). `approveReopen` (`approveReferral.ts:268+`) follows the existing fresh-read → apply(idempotent) → record order used by approveReplacement.

**Bulk actions are per-row-kind everywhere; no section-based residue.** `RequestList` now takes `canReview: (request) => boolean` (per-row), selectability is per-row (`RequestList.tsx`), and `bulkDecision` (`useApprovalData.ts`) routes each selected row through the kind-dispatched `approve`/`deny` (`isReferral`/`isReplacement`/fallback-reopen via the structural discriminator in `requestKind.ts`, whose field choices — `toEmployee` / `replacementXrayImageId` — are unambiguous across the three shapes). The old `section` state, section-cast bulk calls, and section-scoped empty states are all gone from `ReferralApproval/index.tsx`. jsdom test (`unifiedList.test.tsx`) pins mixed-kind rendering, badges, chronological sort, and per-kind meta. Legacy per-kind arrays in `mergeDecisionHistory` correctly return `[]` for the new "reopen" kind (`approvalStorage.ts`).

### Batch E — notification center

**Concurrent-accepter safety is real merge logic, not just a test.** `mutateNotifications` (`notificationStorage.ts:99-147`) re-reads the freshest on-disk list inside every CAS attempt and applies the updater *to that fresh list*; `acceptNotification`'s updater is per-item append + per-user idempotent (`acceptances.some(...)` guard), so a retry after losing a race folds the other user's acceptance in rather than clobbering it — the correct semantics, verified by the concurrent-accept and concurrent-post tests plus idempotency tests. `MAX_NOTIFICATIONS` cap and missing-folder fresh-workspace path handled.

**Audience/permission gating:** posting is triple-gated in behavior — (1) the manager view lives behind `ew/notifications` page access (none for employee/supervisor/guest, `userManagement.ts:406-410`), (2) the post box behind `can("post-notification")` which cascades page→feature (`usePermissions.ts:59-67`; default false for employee/supervisor, `userManagement.ts:322`), (3) the audience banner (`NotificationBanner.tsx`) contains no post path at all — it only reads and accepts, and self-hides for non-audience roles via `isNotificationAudienceRole` (`notificationTypes.ts:242-244`). Defaults are test-pinned (`userManagement.test.ts:97-117`). The plan's defense-in-depth requirement was conditional ("if there's a shared code path") — there is none. See advisory 3 for the honest statement on data-layer enforcement limits.

### Cross-batch integration (B's approval authority vs C4 scaffold)

The reasoning holds. `employee-reopen-instant` (C4) is consumed **only** for the instant-vs-approval branch (`XrayReferrals.tsx:245-249` → `submitReopenRequest.instant`), while approval authority reuses the existing `ew.reopenAnswer` (`useApprovalData.ts`: "whoever may directly reopen answers may approve employee reopen requests"). This is the right identity: approving a reopen request *is* performing a direct reopen (approveReopen literally calls `reopenSubmittedAnswer`), so gating approval on any other feature would let a role trigger reopens it couldn't perform directly. Defaults keep supervisor/manager as approvers, matching the plan's "mirrors the referral/replacement approval pattern". One reachability wrinkle at the sub-tab gate is advisory 1.

### General sweep

- **Edge cases:** empty/fresh workspaces (notifications file missing → `[]`; reopen log empty → `[]`), unparseable month names (short-label falls back to raw slug), curated browse keys verified against real row shapes (`riskDataTypes.ts:22` has `entryDate`; `biDataTypes.ts:31-32` have `levelOneResult`/`levelTwoResult`) with graceful fallback when keys are absent. `NotificationManager` receives a non-null `directoryHandle` (guard at `EmployeeWorkspace/index.tsx:79`).
- **Labels:** all new user-visible strings in shell components use label keys (`ew_reopen_request_*`, `msg_reopen_request_sent`, 18 `notif_*` keys). Strings added inside ReferralApproval/PhaseThreeSampling/TemplateBuilder follow those files' pre-existing hardcoded-Arabic convention (advisory 7).
- **EDIT_LOG:** complete and honest for v42.49–v42.74, including a properly documented A3 scope deviation (v42.51: "الكل" not bolted onto the 7 inherently single-month selects, with rationale) — an honest "not done + why", not a silent skip.

---

## Advisories (non-blocking, ranked)

1. **`EmployeeWorkspace/index.tsx:101` — approval sub-tab gate not extended for reopen-only approvers.** The gate is `!can("approve-referrals") && !can("approve-replacements")`; a role granted only `ew.reopenAnswer` (both others off — a non-default admin configuration) can approve nothing because it cannot reach the unified page, leaving reopen requests pending until config changes. Direct reopen from XrayReferrals still works, and no data is harmed. One-line fix: also allow `can("ew.reopenAnswer")`. Unreachable under shipped defaults and Test6.
2. **Duplicate pending reopen requests are possible** — after filing a request the answer stays submitted and `InspectionPanel` keeps offering the button (no pending indicator), so an employee can file the same case twice. Verified data-safe (idempotent approve/deny; replay-guarded event), but it clutters the queue. Consider disabling the button when a pending request exists for the case.
3. **No data-layer role validation on `postNotification`/`acceptNotification`** — the storage functions accept any `postedBy`/`username`. Stated plainly rather than glossed: in this backend-less architecture a "data-layer check" executes in the same untrusted browser as the UI and is equally bypassable; the app-wide advisory security model (`docs/SECURITY_MODEL.md`) explicitly accepts this for *every* storage module (referrals, approvals, answers all behave identically). The plan's conditional defense-in-depth requirement is met (no shared code path exposes posting to audience roles). No action required; do not mistake the UI gates for a trust boundary.
4. **C1 upgrade-path caveat (theoretical):** an install that customized a *parent* tab row (e.g. population→manager=view) but never set explicit sub-tab rows would, after upgrade, get the shipped sub-tab defaults from the normalizer backfill rather than its customized parent value. Moot for the one real deployment — v42.58 verified Test6 == shipped defaults — and unfixable without a per-install migration; noting for the record.
5. **Narrow cross-machine duplicate-append window on CAS retry** (`appendDecisionEvent`, `postNotification`): if a concurrent machine's RMW preserved our append and our verify then mismatches, the retry re-appends. Identical property exists in the pre-approved `appendDistributionEvents` pattern; consequences are benign (duplicate same-status history event / duplicate notification). A contains-guard on `eventId`/`id` inside the attempt would close it batch-wide if ever desired.
6. **A3 partial vs plan:** "الكل" option added only where aggregation exists (Population browse). Deviation is documented with sound rationale in EDIT_LOG v42.51 (the 7 other selects load exactly one month by design; a fake "all" would no-op or be a real feature). v42.51 also flags `EmployeeDashboard.tsx` as dead code (not mounted) — candidate for removal in a cleanup pass.
7. **Hardcoded Arabic strings** in `requestKind.ts` (KIND_LABELS), `HistoryView.tsx`, `ReferralApproval/index.tsx` dialog texts, `PhaseThreeSampling.tsx` alert, `TemplateBuilder` denial message — consistent with those files' existing convention (none of them are label-routed today), but they diverge from the CLAUDE.md "prefer label keys" preference. Routing the whole ReferralApproval view through `labelsStore` would be a coherent follow-up.
8. **Bundle size note stale:** build is now 967 kB gzip vs CLAUDE.md's "~835 kB as of 2026-07-02". Expected growth (EDIT_LOG is inlined via `?raw` and grew ~2,000 lines this branch); refresh the CLAUDE.md figure after merge.

## Verification evidence

- `npm run lint` — clean, zero warnings.
- `npm run test:run` — 70 files, 457 tests, all pass (includes the new C1 regression, 4 concurrent-writer CAS tests, 3 fold-arm tests, reopen instant/approval/idempotency tests, unified-list jsdom tests, 8 notification tests incl. concurrent accept/post).
- `npm run build` — tsc + vite succeed; single-file output 2,644.79 kB / 967.54 kB gzip.
- Diff/EDIT_LOG integrity — `full.diff` file set ≡ branch delta (59/59); all 51 EDIT_LOG-cited files present in diff.

Remaining per plan §Final-steps (out of scope for this document): browser verification of the listed flows via preview tools, then merge-option presentation for both branches.
