# Feature batch 2026-07-08 — execution plan

**Status:** approved by user (4 clarifying questions answered), ready for dispatch.
**Branch:** `feature-batch-2026-07-08`, stacked on top of `hardening-2026-07-08` (created once Batch 2b of the hardening pipeline finishes, to avoid concurrent writers in one working directory).
**Origin:** a large ad-hoc list of requests delivered mid-hardening-pipeline, grounded via a live Explore investigation of the actual codebase plus the user's real workspace file `C:\Users\WorkNStudy\Downloads\Test6\3-user-data\users.permissions.json` (used as ground truth for "make current permissions/columns the default").

## Decisions already made (user-confirmed, do not re-litigate)
- **Reopen-case:** add an employee-facing "طلب إعادة فتح الحالة" button + reason field. New admin setting per role: instant unlock vs. routes to supervisor approval (mirrors the referral/replacement approval pattern). The *existing* `ew.reopenAnswer` (supervisor/manager/admin direct reopen of any answer) is untouched — this is a new, separate employee self-service path.
- **Case-assignment filter:** just match the existing `isAssignableSampleRole` rule from `bulkAssignment.ts` (employee + supervisor only, exclude manager/guest) — no new level-based hierarchy.
- **موروث removal:** bake current *effective* (inherited) permission values into explicit per-role rows for the 4 sub-tabs that rely on inheritance (`population/process`, `population/browse`, `reports/reports`, `reports/kpi`), then delete the inheritance-fallback mechanism and the "موروث" badge. Zero functional access change.
- **Notification model:** poll/refresh-based (on tab focus / short interval / reload) is acceptable — no live cross-PC push, consistent with how the rest of the app already handles multi-PC workspace data (no backend).

## Ground truth pulled from the user's real workspace (`Test6`)
`3-user-data/users.permissions.json` full page-permission matrix + feature-permission matrix — this becomes the new `createDefaultPermissions()` (and equivalent page-permission defaults) in `src/auth/userManagement.ts`, verbatim, for every role×tab and role×feature pair present in that file. Sub-tabs absent from that file (the 4 موروث cases above) get their explicit value derived from their current parent-tab fallback, computed at implementation time by reading the live inheritance logic — not guessed.

Risk-analysis ("تحليل المخاطر") browse view has no saved preset on disk; the shipped default becomes the exact 8-column set visible in the user's screenshot, in the same order: المستوى، معرف الأشعة، تاريخ الدخول، نوع المنفذ، المنفذ، نتيجة المستوى1، نتيجة المستوى2، رقم اللوحة/الحاوية. "المجتمع النهائي" (population view) mirrors this. The BI view default is the same set minus المستوى/Stage.

## Batches and recommended order

Order matters because of real dependencies: D (concurrency hardening) touches the same storage files B (reopen + unified approval) will extend, so D must land first so B is built on the already-hardened pattern. C (permissions overhaul) must land before B because B needs a new permission concept (reopen mode: instant/approval-required) that belongs in the overhauled matrix, not the old one.

**Recommended order: A → D → C → B → E**

### Batch A — Quick mechanical fixes (Sonnet)
1. Column mapping: add two `SystemField` entries to `DEFAULT_SYSTEM_FIELDS` (`src/data/population/populationConfig.ts`) — `levelOneEmployee` ("موظف المستوى الأول") and `levelTwoEmployee` ("موظف المستوى الثاني") — not required, no default alias mapping on either the risk or BI side.
2. Table preset defaults: define shipped defaults for `risk-raw` and `bi-raw` browse views (currently none exist — falls back to "first 12 columns") matching the ground truth above; update `population`'s default (`BROWSE_COLUMNS` defaults in `Population/index.tsx`) to mirror the risk view's set/order.
3. Month filters: audit every month-filter component in the app (Population browse, Archive, Reports, KPI, ReferralApproval, any others found) and (a) add an "الكل" (all months) option, (b) change the display format from full month names to short form matching the pattern "Sep 2026" (English 3-letter abbreviation + Latin-numeral year — consistent with the app's existing forced Latin-numeral convention).
4. Case-assignment filter: in `XrayReferrals.tsx`'s recipient picker (~line 1109-1111), replace the unfiltered user list with the same role restriction `bulkAssignment.ts`'s `isAssignableSampleRole` uses (employee + supervisor only) — reuse that function/constant rather than duplicating the role list.

**Acceptance:** all four sub-items verified in the running app via preview tools; `npm run lint`/`test:run` green.

### Batch D — Cross-machine write safety (Opus)
Extend the existing CAS-retry pattern (`src/data/storage/casLoop.ts`, already used by `distributionStorage.ts`, `answerStorage.ts`, `sampleStorage.ts`, `audit/actionLog.ts`) to the modules that currently lack it: `src/data/referral/referralStorage.ts`, `src/data/approvals/approvalStorage.ts`, `src/data/preferences/browsePresetStorage.ts`, and the population/config write path. Same retry-with-jitter, `_writeToken`+`revision` verification shape as the existing usages — do not invent a new concurrency scheme.

**Acceptance:** all four modules use `casLoop`; existing tests still pass; a new test simulates two concurrent writers on at least one newly-covered module and confirms both writes are eventually consistent (no silent lost update).

### Batch C — Permissions overhaul (Opus)
1. Remove موروث: derive explicit values for the 4 inherited sub-tabs (per current fallback logic) and add them as real rows in `createDefaultPermissions()`; delete the fallback mechanism in `getRolePermission()` (`src/auth/userManagement.ts`) and its UI-local copy `getTabAccess()` (`UserManagement/index.tsx`); remove the "موروث" badge/CSS.
2. Set `createDefaultPermissions()`'s page-permission rows AND feature-permission rows to match `Test6/3-user-data/users.permissions.json` exactly (this file is embedded in this plan's ground-truth section above — the implementer should re-read it fresh from `C:\Users\WorkNStudy\Downloads\Test6\3-user-data\users.permissions.json` rather than retyping from memory).
3. Wire the 5 permission-coverage gaps found by investigation into proper featureId-gated checks with real matrix entries: `PhaseThreeSampling.tsx:98` unlock (new featureId), `Archive/index.tsx:86-89` closeMonth (remove the hardcoded `isAdmin &&`, trust the existing `archive.closeMonth` feature toggle alone), `TemplateBuilder/index.tsx:187` role hardcode (replace with a featureId), `Settings/ErrorLogSection.tsx:16` hardcode (replace with a featureId, default admin-only to match current behavior), `XrayReferrals.tsx:199,813` column-preset-edit hardcode (replace with the existing `configure-referral-columns` feature check instead of `role === "admin"`).
4. Add the schema/UI scaffold for the new reopen-mode setting Batch B will consume: a per-role choice (instant / requires-approval) for the new employee-facing reopen-request feature — expose it in Feature Permissions UI even though Batch B wires the actual behavior.

**Acceptance:** `npm run test:run` green including a test that the four موروث sub-tabs resolve to the same effective access before/after (regression guard); admin UI shows no "موروث" badge anywhere; the 5 gap items are each controllable from the admin matrix and actually take effect (verified via preview tools per item).

### Batch B — Reopen-case workflow + unified اعتماد الطلبات page (Opus)
1. New request/decision flow for employee-initiated reopen requests, modeled on the existing `ReferralRequest`/`ReplacementRequest` pattern (`src/data/referral/referralTypes.ts`, `referralStorage.ts` — now CAS-safe per Batch D): a `ReopenRequest` type (reason, requestedAt, xrayImageId/answer reference, status), a new distribution event type for the pending "requested" state (the terminal `reopened` event already exists per `distributionTypes.ts` — only the pending/approval-gated precursor state is new), a fold arm in `deriveCurrentDistribution()`.
2. Employee UI: a "طلب إعادة فتح الحالة" button on a submitted answer (in the inspection/results view), opens a reason field, submits the request. If the admin's Batch-C setting for the employee's role is "instant," apply the reopen immediately (reuse the existing `reopenSubmittedAnswer` path). If "requires-approval," create a pending request instead.
3. Unified `اعتماد الطلبات` page: merge referral, replacement, AND reopen requests into one chronological, filterable list (drop the `section` tab in `ReferralApproval/index.tsx`, concatenate+sort all three arrays by `requestedAt`, add a `kind` badge per row using the existing `isReferral`-style type-guard pattern extended to three kinds), with clear requester/target/date/status/reviewer columns per the user's "organized, easy to read and distinguish" ask. Bulk-action logic keyed per-row-kind, not per-section.

**Acceptance:** an employee can request a reopen and see its status; depending on the Batch-C setting, it either applies instantly or appears in the approval queue; the unified approval page shows all three request kinds in one chronological list with working filters (including the Batch-A month filter improvements) and correct bulk actions; `npm run test:run` green.

### Batch E — Notification center (Opus)
New module `src/data/notifications/`: notifications stored in the workspace (JSON, `safeWriteJson`, `casLoop`-protected per Batch D's pattern since multiple admins/managers could post near-simultaneously), each with id/message/postedBy/postedAt and a per-user acceptance list. Post permission: admin + manager (new featureId in the Batch-C matrix). Read (see + must-accept): employee + supervisor, per the user's spec, though admin/manager should also see their own posts.

UI: a persistent banner mounted at the app shell level (`App.tsx`), orange, pin SVG icon, shown whenever the current user has an unaccepted notification; "قبول" button removes it for that user (records acceptance, does not delete the notification for others). Admin-facing "notification manager" view (new section, likely under Settings or User Management) listing each notification with who has/hasn't accepted.

**Acceptance:** posting a notification as admin/manager shows the banner to employee/supervisor sessions on next load/focus; accepting removes it for that user only; the notification manager view correctly lists acceptance status per user; employees/supervisors cannot post (no UI entry point, and a defense-in-depth check if there's a shared code path); `npm run test:run` green.

## Final steps (after all 5 batches)
- One Fable QA pass over the full `feature-batch-2026-07-08` diff (mirrors Stage 5 of the hardening pipeline) — this is where independent review value is highest, since the batches above were scoped directly with the user rather than through a separate Opus-plan/Fable-triage cycle (avoiding redundant re-planning of decisions already made).
- Full `npm run lint && npm run test:run && npm run build`.
- Browser verification via preview tools of: column mapping modal, risk/BI/population browse defaults, month filters, referral-recipient picker, permissions matrix (no موروث), reopen-case request flow (both modes), unified اعتماد الطلبات page, notification banner + manager view.
- Present merge options for both branches (`hardening-2026-07-08` and `feature-batch-2026-07-08`) via finishing-a-development-branch.
