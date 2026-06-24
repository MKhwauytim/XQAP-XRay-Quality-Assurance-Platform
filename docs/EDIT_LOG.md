# EDIT_LOG.md

Version history for the XQAP codebase. Every code edit must be logged here before it is applied.

---

## v1.0 — 2026-06-23 — Initial full codebase commit

First push of the complete XQAP v1 application to GitHub. Covers all phases:
population import, stratified sampling, distribution, employee workspace,
template builder, reports, archive, backups, user management, and settings.

No before/after diff — this is the baseline from which all future edits are measured.

---

## v2 — 2026-06-23 — Full-audit remediation + 7-day persistent login

Applies the findings of the codebase audit (all except C3 login-throttling, descoped by
the user) and adds session persistence. Highlights: rotated the bootstrap admin passcode to
a strong value with a freshly generated Argon2id hash; sessions now persist for 7 days;
`safeWriteJson` stages writes through a verified `.tmp`; optimistic-concurrency hash now
matches the bytes on disk; legacy password hashes upgrade transparently on login.

**File:** `src/auth/authConfig.ts`

**Before:**
```ts
export const LOGIN_SYSTEM_VERSION = "1.2.0";
...
export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$Q0EXc66ZzrZ7R+3ZeFyg/w$hr4m5BK1wKMt5JwvYnSVyGZqHKC95FbPsoR9nVsoUIo"
};
```

**After:**
```ts
export const LOGIN_SYSTEM_VERSION = "1.3.0";
...
// Rotated 2026-06-23: strong passcode, Argon2id (m=19456,t=2,p=1). See docs/EDIT_LOG.md v2.
export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$ptZbFeX582X4+1WJnQ53bw$xyPiz56XTjHm+9hpNiv1efZfLJGPMNZYW3mIT/7D3lI"
};
```

**File:** `src/auth/authSession.ts`

**Before:** session stored in `sessionStorage`, no expiry.

**After:** session stored in `localStorage` with a 7-day TTL derived from `loginAt`; `readSession()`
clears and rejects expired/invalid sessions.

**File:** `src/auth/AuthGate.tsx`

**Before:** `getRoleLabel` had no `guest` branch (guests saw "الموظف"); successful logins never
upgraded legacy password hashes.

**After:** added a `guest` → "ضيف" branch; after a successful managed-user login, if
`needsRehash(user.passwordHash)` the hash is recomputed and persisted (M3).

**File:** `src/auth/passwordCrypto.ts` / `userManagement.ts` — added `persistUserPasswordHash`
helper used by the login rehash path; `createUserId` now uses `crypto.randomUUID()` when available.

**File:** `src/data/storage/safeWrite.ts`

**Before:** wrote the live file in place after snapshotting `.bak`; lock keyed by bare filename.

**After:** stages serialized content to `${fileName}.tmp`, verifies it, then commits to the live
file and removes the tmp; rolls back from `.bak` on failure (M1). Lock now keyed by
`${dir.name}/${fileName}` (L4).

**File:** `src/data/storage/fileSystemAccess.ts`

**Before:** `newHash` hashed `JSON.stringify(preparedFile, null, 2)` (no trailing newline),
mismatching `readJsonFile` which hashes the raw on-disk text (with the `\n` safeWrite appends).

**After:** `newHash` hashes the exact written bytes (`...+"\n"`) so it round-trips as the next
`baseHash` (M2); `createId` uses `crypto.randomUUID()` when available (L5).

**File:** `src/data/distribution/distributionLog.ts` — `createEventId` uses `crypto.randomUUID()`
when available (L5); clarified `computeDaysRemainingForDeadline` documentation (L7).

**File:** `src/data/answers/answerStorage.ts` — `answerFileName` strips path-dangerous characters
from the username before building the filename (M4).

**File:** `src/App.tsx` — `<TestPanel />` now only renders under `import.meta.env.DEV` (L2).

**File:** `CLAUDE.md` — corrected the role list (5 roles incl. `manager`), corrected the
`safeWrite` description, and added a "Security model (advisory-only)" note (C2, L3).

---

## v2.1 — 2026-06-23 — Expert observation date column ("تاريخ رصد الخبير")

Surfaces the timestamp captured when an employee submits ("تقديم") an inspection — already
stored as `ItemAnswer.submittedAt` — as a dedicated, unified column in both the referrals
table and the results table. New shared label key `col_expert_observation_date`.

**File:** `src/data/labels/labelsStore.ts`

**Before:**
```ts
  col_distribution_date:         "تاريخ التوزيع",
  col_plate_or_container_number: "لوحة / حاوية",
```

**After:**
```ts
  col_distribution_date:         "تاريخ التوزيع",
  col_expert_observation_date:   "تاريخ رصد الخبير",
  col_plate_or_container_number: "لوحة / حاوية",
```

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

**Before:** the `صور الأشعة المحالة` table had no submitted-at column; `answersMap` was declared
after the `columns` memo.

**After:** added a `submittedAt` column (label `col_expert_observation_date`, `isDate`) to
`buildXrayColumns`, added it to `DEFAULT_VISIBLE`, moved `answersMap` above the `columns` memo,
and injected an accessor that reads `answersMap.get(...)?.submittedAt` so the value renders and
exports per row.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`

**Before:**
```ts
{ id: "submittedAt", label: "تاريخ رصد خبير الجودة", widthFr: 14, isDate: true, accessor: () => null },
```

**After:**
```ts
{ id: "submittedAt", label: L.col_expert_observation_date, widthFr: 14, isDate: true, accessor: () => null },
```

---

## v2.3 — 2026-06-23 — DataTable auto-fit columns

The shared `DataTable` used `table-layout: fixed` with forced percentage widths, so columns
could not grow to their content — headers like "المستوى" wrapped to "الم ستو ى". Switched to
content-based auto layout with horizontal scroll. The `widthFr` values and manual resize now act
as preferences rather than hard caps. Affects every table built on `DataTable` (population browse,
inspection results, referrals, reports, archive). Other tables already used auto layout.

**File:** `src/components/DataTable/DataTable.css`

**Before:**
```css
.dt-table-wrap { ... overflow-x: hidden; overflow-y: auto; ... }
.dt-table { width: 100%; table-layout: fixed; ... }
.dt-th-label { ... word-break: break-word; ... }
.dt-td { padding: 9px 12px; ... white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

**After:**
```css
.dt-table-wrap { ... overflow-x: auto; overflow-y: auto; ... }
.dt-table { width: 100%; table-layout: auto; ... }
.dt-th-label { ... white-space: nowrap; ... }
.dt-td { padding: 9px 12px; ... white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; }
```

---

## v2.4 — 2026-06-23 — Fix: newly-added columns invisible under an older saved column config

A column added to a table (e.g. `submittedAt` / "تاريخ رصد الخبير") never rendered for users whose
column config was persisted before it existed: `visibleCols` and both drag handlers read strictly
from `colCfg.order`, and toggling it visible in the picker only edited `hidden`, never `order`.
Introduced a `normalizedOrder` that reconciles the saved order with the current columns (keeps known
ids in place, prepends missing alwaysVisible, appends other missing columns, drops stale ids), and
based rendering + reordering on it.

## v3 — 2026-06-23 — Admin role-preview switcher (impersonate roles to test permissions)

Added an admin-only control in the top toolbar (next to "تسجيل الخروج") to preview the app as any
role — ضيف / الموظف / المشرف / المدير / الإدارة — so an admin can verify each role's tabs and
permissions without logging in as them. The preview overrides only the *role*; the real identity
(username) is preserved, so actions stay attributed to the admin. Stored in `sessionStorage`
(`xray_preview_role_v1`) so it never outlives the tab; cleared on logout.

**File:** `src/auth/authSession.ts` — added `readPreviewRole` / `setPreviewRole`; split
`readRealSession` (identity, ignores override) from `readSession` (effective: real identity with the
role swapped when a real admin is impersonating). `clearSession` now also clears the preview.

**File:** `src/auth/AuthGate.tsx` — `getInitialSession` uses `readRealSession`; added `previewRole`
state + `changePreviewRole`; the toolbar renders a role-chip switcher (real-admin only) and passes
the *effective* session to children; impersonation recolours the bar and shows a "(معاينة)" flag.

**File:** `src/App.tsx` — `AppContent` is keyed by `session.role` so switching the previewed role
remounts the app subtree (components that read the session once at mount re-read it).

**File:** `src/auth/AuthGate.css` — styles for `.auth-role-preview` / `.auth-role-chip` and the
amber `.auth-toolbar-preview` impersonation indicator.

---

## v3.2 — 2026-06-23 — Role-preview: segmented switch (not buttons, not select)

The role-preview control is now a **connected pill segmented switch**: all role options
sit inside one rounded pill container so they look and feel like a single toggle switch,
not a row of detached buttons. Active segment slides a white thumb. Grouped with
تسجيل الخروج on the right side of the toolbar.

**File:** `src/auth/AuthGate.tsx` — replaced `<select>` with `.auth-role-switcher` +
`.auth-role-seg` button pattern (still a group of buttons, but visually a unified switch).

**File:** `src/auth/AuthGate.css` — replaced select styles with `.auth-role-switcher`
(pill container) and `.auth-role-seg` (transparent segments; `.active` gets white thumb +
shadow). Amber-bar variant preserved.

---

## v3.3 — 2026-06-23 — Supervisor view toggle in صور الأشعة المحالة

Supervisors and admins can now switch between "الكل" (see everyone's rows) and
"مسنداتي فقط" (see only rows assigned to the current logged-in user) using a segmented
switch at the top of the table. Employees and guests are unaffected.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Added `showMyOnly` boolean state (default false).
- Added `displayEntries` useMemo that filters `entries` to `assignedTo === username`
  when `canSeeAll && showMyOnly`.
- Changed DataTable `rows` prop from `entries` to `displayEntries`.
- Added `.ew-view-switcher` / `.ew-view-seg` segmented switch in `toolbarStart`,
  visible only when `canSeeAll`.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`
- Added `.ew-view-switcher` pill container and `.ew-view-seg` / `.ew-view-seg.active`
  styles matching the auth-gate segmented-switch design.

---

## v3.4 — 2026-06-23 — Replacement candidate pool capped at 1000 (performance)

Opening the replacement dialog previously rendered ALL eligible population rows in the
UI, causing severe lag on large populations (10 000+ rows). The candidate pool is now
capped at 1000 random entries for both "recommended" and "all" tabs before returning
from `getReplacementCandidates`. The random shuffle (Fisher-Yates) ensures no systematic
bias in which 1000 are shown.

**File:** `src/data/distribution/replacement.ts`

**Before:**
```ts
if (sameStage.length > 0) {
  return { recommended, all: sameStage };
}
// ...
return { recommended: [], all: fallbackStage?.[1] ?? [] };
```

**After:**
```ts
const REPLACEMENT_POOL_LIMIT = 1000;
// ...
if (sameStage.length > 0) {
  return {
    recommended: capRandom(recommended, REPLACEMENT_POOL_LIMIT),
    all: capRandom(sameStage, REPLACEMENT_POOL_LIMIT),
  };
}
// ...
return { recommended: [], all: capRandom(fallbackStage?.[1] ?? [], REPLACEMENT_POOL_LIMIT) };
```

---

## v3.5 — 2026-06-23 — Fix BI dataset not recognized for non-standard sheet names

The BI workbook parser rejected any sheet whose name did not contain "وارد" or "صادر",
adding it to `unknownSheetNames` and skipping all its rows. This caused the entire BI
file to show as "not recognized" when the user's Excel uses non-standard sheet naming.

Fixed by returning the sheet's own name as the source when no pattern matches (instead of
null). All sheets are now processed; the `unknownSheetNames` list will always be empty
for BI-only files. Recognized sheet names ("بحري وارد" etc.) continue to work as before.

**File:** `src/components/Sidebar/Tabs/Population/biData/biDataWorkbook.ts`

**Before:**
```ts
  return null; // ← caused sheet to be skipped entirely
}
```

**After:**
```ts
  // No pattern matched — process the sheet anyway using its own name as the source.
  return sheetName;
}
```

---

## v3.6 — 2026-06-23 — Permission matrix: sub-tabs hidden when role has no view permission

Sub-tabs inside employee-workspace (لوحة الإحصائيات, صور الأشعة المحالة, نتائج فحص الأشعة,
اعتماد الطلبات, نموذج الفحص) were always shown in the sidebar regardless of permissions —
the permission gate only showed `<AccessDenied />` after clicking. Now the sidebar only
renders sub-tabs the current role can actually view.

**File:** `src/App.tsx` — `allowedTabs` useMemo now maps each tab through a sub-tab
filter. For `employee-workspace`, sub-tab IDs are prefixed `ew/` to match MANAGED_TABS
entries, then filtered by `hasRolePermission(..., "view")`.

**Before:**
```ts
return SIDEBAR_TABS.filter(tab => ... && hasRolePermission(...));
```

**After:**
```ts
return SIDEBAR_TABS
  .filter(tab => ... && hasRolePermission(...))
  .map(tab => {
    if (!tab.subTabs?.length) return tab;
    const prefix = tab.id === "employee-workspace" ? "ew/" : `${tab.id}/`;
    const allowedSubTabs = tab.subTabs.filter(sub =>
      hasRolePermission(permissions, session.role, `${prefix}${sub.id}`, "view")
    );
    return { ...tab, subTabs: allowedSubTabs };
  });
```

---

## v3.1 — 2026-06-23 — Role-preview: dropdown toggle, grouped with تسجيل الخروج

Replaced the row of chip buttons with a compact `<select>` dropdown and moved it into a
flex group with تسجيل الخروج so both controls sit together on the left end of the toolbar.
In RTL flex the select appears immediately to the right of the logout button.

**File:** `src/auth/AuthGate.tsx`

**Before:**
```tsx
{isRealAdmin && (
  <div className="auth-role-preview" role="group">
    <span className="auth-role-preview-label">معاينة كـ:</span>
    {PREVIEW_ROLE_IDS.map((id) => <button className="auth-role-chip ...">...</button>)}
  </div>
)}
<button onClick={logout}>تسجيل الخروج</button>
```

**After:**
```tsx
<div className="auth-toolbar-end">
  {isRealAdmin && (
    <select className="auth-role-select" value={effectiveRole} onChange={...}>
      {PREVIEW_ROLE_IDS.map((id) => <option value={id}>...</option>)}
    </select>
  )}
  <button onClick={logout}>تسجيل الخروج</button>
</div>
```

**File:** `src/auth/AuthGate.css` — replaced `.auth-role-preview` / `.auth-role-chip` /
`.auth-role-preview-label` with `.auth-toolbar-end` flex group and `.auth-role-select`
styled dropdown (custom SVG chevron, hover/focus rings, amber-bar variant).

---

## v2.5 — 2026-06-23 — Fix: "تاريخ رصد الخبير" missing in Inspection Results

The Inspection Results table has no column picker (`canConfigureColumns={false}`) and derives its
visible sample columns from the shared referrals preset via `getVisibleSampleColumns`. That helper
had the same order-based drop as DataTable, and the preset→config mapping auto-marked any column not
in the old preset's `visibleColumns` as hidden — so a newly added column could never appear and
couldn't be toggled on. Fixed by (a) only hiding columns the preset actually knew about
(`columnOrder.includes(id)`) and (b) appending sample columns missing from the saved order. Applied
the same `columnOrder` guard to the referrals preset for consistency.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`
— `getVisibleSampleColumns` now appends columns missing from the saved order; the preset→config
`hidden` only includes columns present in `preset.columnOrder`.

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
— `colPreset.hidden` only includes columns present in `p.columnOrder` (new columns default visible).

---

## v2.4 — 2026-06-23 — Fix: newly-added columns invisible under an older saved column config

A column added to a table (e.g. `submittedAt` / "تاريخ رصد الخبير") never rendered for users whose
column config was persisted before it existed: `visibleCols` and both drag handlers read strictly
from `colCfg.order`, and toggling it visible in the picker only edited `hidden`, never `order`.
Introduced a `normalizedOrder` that reconciles the saved order with the current columns (keeps known
ids in place, prepends missing alwaysVisible, appends other missing columns, drops stale ids), and
based rendering + reordering on it.

**File:** `src/components/DataTable/index.tsx`

**Before:**
```ts
const orderedIds = new Set(colCfg.order);
const missingAlways = columns.filter((c) => c.alwaysVisible && !orderedIds.has(c.id));
const visibleCols = [
  ...missingAlways,
  ...colCfg.order.map((id) => columns.find((c) => c.id === id)).filter(...),
].filter((c) => !colCfg.hidden.includes(c.id) && (!c.adminOnly || isAdmin));
// ...
function handleDrop(targetId) { const order = [...colCfg.order]; ... }
```

**After:**
```ts
const normalizedOrder = useMemo(() => { /* kept ∪ missingAlways(prepend) ∪ missingRest(append) */ }, [columns, colCfg.order]);
const visibleCols = normalizedOrder
  .map((id) => columns.find((c) => c.id === id)).filter(...)
  .filter((c) => !colCfg.hidden.includes(c.id) && (!c.adminOnly || isAdmin));
// ...
function handleDrop(targetId) { const order = [...normalizedOrder]; if (sp<0||tp<0) return; ... }
```

---

## v4.4 — 2026-06-23 — XLSX export for all report cards + auth footer workspace button

**File:** `src/auth/AuthGate.tsx`

Added "تغيير المجلد" button in the login card footer using `selectWorkspace()` from `useWorkspace`.

**Before:**
```tsx
<footer className="auth-footer">
  <span>Local Gate v{LOGIN_SYSTEM_VERSION}</span>
  <button type="button" onClick={logout}>مسح الجلسة</button>
</footer>
```
**After:**
```tsx
<footer className="auth-footer">
  <span>Local Gate v{LOGIN_SYSTEM_VERSION}</span>
  <div className="auth-footer-actions">
    <button type="button" className="auth-footer-change" onClick={() => { void selectWorkspace(); }}>
      تغيير المجلد
    </button>
    <button type="button" onClick={logout}>مسح الجلسة</button>
  </div>
</footer>
```

**File:** `src/auth/AuthGate.css`

Added `.auth-footer-actions` flex group and `.auth-footer-change` style with `↗` prefix.

**File:** `src/data/reporting/distributionReport.ts`

Added `buildDistributionXlsx(data, monthFolderName)` — exports 3-sheet XLSX:
ملخص / ملخص الموظفين / تفاصيل التوزيع (all rows with full `PreparedPopulationRow` fields).

**File:** `src/data/reporting/executiveReport.ts`

Added `buildExecutiveXlsx(input)` — exports 4-sheet XLSX:
مؤشرات الأداء / تحليل المنافذ / المراحل / كل الصفوف (every image with all derived KPI fields).

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

- `ReportType` union extended with `"distribution-xlsx"` and `"executive-xlsx"`
- Imported `buildDistributionXlsx` and `buildExecutiveXlsx`
- Each of the three report cards (executive, sample, distribution) now has two buttons: HTML › and XLSX ↓
- `generate()` branches handle all six report types

---

## v4.3 — 2026-06-23 — Sample report rewrite (rich HTML + XLSX) and executive report 5-slide restructure

**File:** `src/data/reporting/executiveReport.ts`

Rewrote from 8 slides to 5 compact slides. Removed الحالة column from the port table.
Eliminated slide duplication (KPI cards appeared in slides 1 & 6; port analysis in slides 2 & 7;
single-month trend chart on slide 7 was meaningless). Merged overlapping content:
- Slide 1: Executive summary — 6 KPI cards + donut + port bar chart + rank list + insights strip
- Slide 2: Port analysis — port table (no الحالة) + stacked bars + L1/L2 dual bars per port
- Slide 3: Stage coverage + plan KPIs strip + quality metrics (absorbed slide 6's plan data)
- Slide 4: Verification matrix + L1/L2 comparison (merged slides 4 & 5)
- Slide 5: Priority ports + decisions list + executive callout (merged slides 7 & 8)

**File:** `src/data/population/populationConfig.ts`

Exported `MONTHLY_SAMPLE_TARGET` (6500) and `STAGE_SAMPLE_TARGETS` as named exports
so they can be imported by other modules.

**Before:**
```ts
// constants were only defined in Population/index.tsx, not exported
const MONTHLY_SAMPLE_TARGET = 6500;
```

**After:**
```ts
export const MONTHLY_SAMPLE_TARGET = 6500;
export const STAGE_SAMPLE_TARGETS: Record<"first" | "second" | "third" | "fourth", number | null> = {
  first: null, second: 2500, third: 1875, fourth: 1875,
};
```

**File:** `src/data/reporting/executiveReportTypes.ts`

`DEFAULT_EXEC_CONFIG.monthlyTarget` now reads from `MONTHLY_SAMPLE_TARGET` (was hardcoded 0).

**File:** `src/data/reporting/sampleReport.ts`

Full rewrite. Old: 69-line basic HTML with port allocation table + 20-row preview.
New: rich multi-section HTML (raw vs processed diff, per-port breakdown showing Risk+BI+CertScan,
stage breakdown, 50-row sample preview) plus `buildSampleXlsx()` generating a 5-sheet XLSX
(ملخص / تفصيل المنافذ / المراحل / العينة المسحوبة / كامل المجتمع). New signature takes
`SampleReportInput` with `{ monthFolderName, manifest, populationRows, sample }`.

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

- Import `openSampleReport`, `buildSampleXlsx` (replacing old `buildSampleReport`)
- Import `loadMonthForEditing` for richer data load
- Added `"sample-xlsx"` to `ReportType` union
- Sample card now has two buttons: HTML and XLSX
- Updated card description to reflect new rich content

---

## v4.1 — 2026-06-23 — Reports Hub: card-grid page design

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

Replaced the dropdown-based reports form with a full card-grid hub (مركز التقارير).

**Before:**
```tsx
// Single panel with two <select> dropdowns (month + report type) and one generate button
<div className="rpt-panel">
  <h2>إعدادات التقرير</h2>
  <div className="rpt-controls">…</div>
  <button>توليد التقرير</button>
  <div className="rpt-info">…</div>
</div>
```

**After:**
```tsx
// Page header + month bar with metadata chips + card grid (executive/sample/distribution/
// department-soon/xlsx-note) + quick-actions strip. Each card has its own generate button.
// Month bar auto-loads population count, sample count, and submitted-answer count as chips.
<section className="rh-page">
  <div className="rh-header">…</div>
  <div className="rh-month-bar">…chips…</div>
  <div className="rh-grid">…5 cards…</div>
  <div className="rh-quick">…quick buttons…</div>
</section>
```

Also fixed: `f.answers` → `f.items` (correct field on `EmployeeAnswerFile`).

**File:** `src/components/Sidebar/Tabs/Reports/Reports.css`

Complete CSS rewrite for the new hub layout — navy/teal design system, card grid,
accent strips, badges, chips, spinner, toast notification, quick-actions strip.

**File:** `src/data/reporting/executiveReport.ts`

Removed unused parameters (`monthLabel` from slide5/slide6, `config` from slide7) and
removed unused `l1l2Same` variable. Matched call sites accordingly.

**File:** `src/data/reporting/executiveReportData.ts`

Removed three unused `import type` lines (`PreparedPopulationRow`, `DistributionCurrentData`,
`EmployeeAnswerFile`) — these flow through `ExecutiveReportInput` already.

---

## v4.0 — 2026-06-23 — Executive Report: 8-slide HTML presentation module

**File:** `src/data/reporting/executiveReportTypes.ts` *(new)*

Defines all TypeScript types for the executive report: `ExecutiveReportRow`, `PortProfile`, `StageProfile`, `ExecutiveKPIs`, `ExecutiveReportConfig`, `DEFAULT_EXEC_CONFIG`, `ExecutiveReportInput`, `VerificationCategory`.

**Before:** *(file did not exist)*

**After:** *(full type definitions as documented above)*

---

**File:** `src/data/reporting/executiveReportData.ts` *(new)*

Data joining, KPI engine, and Arabic narrative generator.

- `buildExecutiveReportRows()`: joins population + sample + distribution + submitted answers into `ExecutiveReportRow[]`
- `calculateExecutiveKPIs()`: computes all KPIs including per-port and per-stage profiles; port status classification (excellent/stable/monitor/priority/insufficient)
- `generateNarrativeFindings()`: produces up to 3 Arabic executive findings
- `fmtNum()`, `fmtPct()`, `fmtK()`: display helpers

**Before:** *(file did not exist)*

**After:** *(full implementation)*

---

**File:** `src/data/reporting/executiveReport.ts` *(new)*

Main 8-slide HTML builder.

- Exports `buildExecutiveReport(input)` and `openExecutiveReport(input)`
- Slide 1: executive summary — 5 KPI cards + bar chart + donut + rank list + insights strip
- Slide 2: port performance table + stacked bars + executive callout
- Slide 3: stage coverage cards + stage bar chart + monthly plan strip
- Slide 4: verification matrix table + summary cards + rule explanations
- Slide 5: L1 vs L2 comparison grid + dual-bar chart per port
- Slide 6: management KPIs + plan tracking table + quality indicators
- Slide 7: performance trend SVG (graceful single-month fallback) + priority port cards
- Slide 8: decisions list + executive callout + success targets
- CSS: navy/teal design system, Somar via `local()`, RTL, 13.333in×7.5in slides
- Navigation: keyboard (ArrowLeft/Right/Home/End) + toolbar + print/PDF

**Before:** *(file did not exist)*

**After:** *(full implementation)*

---

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before:**
```ts
type ReportType = "sample" | "distribution";
const REPORT_LABELS: Record<ReportType, string> = {
  sample: "تقرير العينة",
  distribution: "تقرير التوزيع"
};
// generate handler: sample | distribution branches only
```

**After:**
```ts
type ReportType = "sample" | "distribution" | "executive";
const REPORT_LABELS: Record<ReportType, string> = {
  sample: "تقرير العينة",
  distribution: "تقرير التوزيع",
  executive: "التقرير التنفيذي"
};
// generate handler: adds executive branch — loads population, sample,
// distribution, and all employee answer files, then calls openExecutiveReport()
```

---
