# X-Ray Quality Inspection System — Product Specification Document

**Version:** 1.0  
**Date:** 2026-06-22  
**Classification:** Internal / Government Use  
**Platform:** Chromium-based browsers (single-file SPA, offline-capable)  
**Stack:** React 19 + TypeScript + Vite, Arabic RTL (`dir="rtl"`), vite-plugin-singlefile

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Authentication & Session Management](#2-authentication--session-management)
3. [Role Model](#3-role-model)
4. [Permission System (Two-Layer)](#4-permission-system-two-layer)
5. [Navigation & Tab Structure](#5-navigation--tab-structure)
6. [Module: Population Data Management](#6-module-population-data-management)
7. [Module: Employee Workspace](#7-module-employee-workspace)
8. [Module: Template Builder](#8-module-template-builder)
9. [Module: Reports](#9-module-reports)
10. [Module: Archive & Backup](#10-module-archive--backup)
11. [Module: User Management](#11-module-user-management)
12. [Module: Settings (Label Customization)](#12-module-settings-label-customization)
13. [Data Layer & File Storage](#13-data-layer--file-storage)
14. [Processing Pipeline](#14-processing-pipeline)
15. [Sampling Algorithm](#15-sampling-algorithm)
16. [Distribution & Event System](#16-distribution--event-system)
17. [Worker Architecture](#17-worker-architecture)
18. [Label System — Full Mapping](#18-label-system--full-mapping)
19. [Full Permission Matrix](#19-full-permission-matrix)
20. [File System Layout](#20-file-system-layout)
21. [Data Type Reference](#21-data-type-reference)
22. [Cross-Module Event Map](#22-cross-module-event-map)

---

## 1. System Overview

The **X-Ray Quality Inspection System** is an offline-first, single-file web application for managing the quality-inspection workflow of x-ray images at customs and border-control ports. It supports the full lifecycle from raw data upload through statistical sampling, employee distribution, inspection recording, and executive reporting.

### Core Capabilities

| Capability | Description |
|---|---|
| Data Ingestion | Load Risk-Agency XLSX + optional Business Intelligence (BI) XLSX per month |
| Population Processing | Validate, deduplicate, enrich with BI data, and classify by CertScan registry |
| Statistical Sampling | Seeded-RNG stratified sampling with per-stage, per-CertScan rules |
| Sample Distribution | Assign samples to employees; track replacements and referrals |
| Inspection Forms | Customizable form templates; employees fill and submit per sample |
| Reporting | HTML exports (sample proof, distribution report, executive dashboard) |
| Archiving | Manual + automatic backup/restore with full audit trail |
| Access Control | 5-tier role model with dual-matrix permission enforcement |
| Label Customization | All 117 UI text strings overridable per installation |

### Architecture Constraints

- Ships as a single `dist/index.html` file (fonts inlined as base64)
- All persistent storage uses the File System Access API (workspace folder on disk)
- Sessions stored in `sessionStorage` (cleared on browser close)
- Label customizations stored in `localStorage`
- Web Worker offloads XLSX parsing off the main thread
- No network calls; entirely offline once loaded

---

## 2. Authentication & Session Management

### Login Flow

```
User enters username + password
       ↓
AuthGate.tsx reads session from sessionStorage
       ↓
If valid session → render app directly
       ↓
If no session → show login modal
       ↓
Password verified via Argon2id (600,000 iterations)
       ↓
On success → write AuthSession to sessionStorage
       ↓
WorkspacePicker → WorkspaceGate → AppContent
```

### Session Object

```typescript
type AuthSession = {
  role: AuthRole;          // "admin" | "guest" | "employee" | "supervisor" | "manager"
  username: string;        // Lowercase, trimmed
  loginAt: string;         // ISO 8601 datetime
};
```

**Storage key:** `xray_local_login_session_v1` (sessionStorage)

### Admin Bootstrap

- Username: `admin` (hardcoded)
- Password hash: Argon2id, stored in `authConfig.ts`
- Arabic keyboard shortcut keys for fast admin login: `["a", "t", "ش", "ف"]`
- Admin is NOT stored in the managed users file; it is a fixed bootstrap account

### Password Security

- Algorithm: Argon2id
- Iterations: 600,000
- All user passwords stored as Argon2id hashes in `.system/users.permissions.json`
- Password reset: Admin only, via User Management UI

---

## 3. Role Model

### Role Definitions

| Role ID | Arabic Label | Description | Scope |
|---|---|---|---|
| `admin` | مسؤول النظام | Bootstrap superuser. Cannot be deleted or demoted. Full access to all tabs and features. | System-level |
| `manager` | مدير | Full operational control. Manages population pipeline, sampling, distribution. | Organization-level |
| `supervisor` | مشرف | Oversees employees. Approves referral and replacement requests. Can view all entries. | Team-level |
| `employee` | موظف | Operational staff. Receives assigned samples and fills inspection forms. | Individual-level |
| `guest` | ضيف | Read-only observer. Can view population data and settings labels. Cannot perform actions. | Read-only |

### Role Hierarchy (Informal)

```
admin
  └─ manager
       └─ supervisor
            └─ employee
                 └─ guest
```

> Permission inheritance is NOT automatic by hierarchy — it is explicit through the permission matrix. The hierarchy above describes the intended operational scope, not automated inheritance.

### MANAGED_ROLES (Configurable Roles)

`admin` is excluded from `MANAGED_ROLES`. The following 4 roles appear in the user management matrix and can be configured:

| Role | id | Label | Description |
|---|---|---|---|
| Guest | `guest` | ضيف | وصول قراءة فقط — مراقب أو مدقق خارجي |
| Employee | `employee` | موظف | يستلم عينات ويملأ نماذج الفحص |
| Supervisor | `supervisor` | مشرف | يراقب الموظفين ويعتمد الطلبات |
| Manager | `manager` | مدير | يدير دورة البيانات كاملةً |

---

## 4. Permission System (Two-Layer)

All access control is enforced through two independent but cascading layers.

### Layer A — Tab/Page Access

Controls whether a role can see and interact with a top-level page (tab) or sub-tab.

**Permission levels:**

| Level | Value | Meaning |
|---|---|---|
| No Access | `"none"` | Tab is hidden; navigation is blocked |
| View | `"view"` | Tab is visible; read-only mode enforced |
| Edit | `"edit"` | Full interaction permitted |

**Inheritance rule:** If a sub-tab has no explicit permission entry, it inherits the parent tab's level. Example: if `employee-workspace` = `"view"`, then `ew/xray-referrals` = `"view"` unless explicitly overridden.

**Admin bypass:** `admin` always gets `"edit"` regardless of stored permissions.

**Storage:** `localStorage` key `xray_user_management_v1` → `UserManagementState.permissions[]`

**Enforcement function:**
```typescript
getRolePermission(permissions, role, tabId): PermissionLevel
hasRolePermission(permissions, role, tabId, minimumAccess): boolean
```

### Layer B — Feature Permissions

Controls fine-grained action capabilities within tabs.

**Permission type:** Boolean `enabled` / `disabled`

**Cascade rule:** If the parent tab's Layer A access = `"none"`, all feature toggles for that tab's features are overridden to disabled, regardless of their stored value.

**Admin bypass:** `admin` always has all features enabled.

**Storage:** Same `UserManagementState.featurePermissions[]`

**Enforcement function:**
```typescript
hasFeature(featurePermissions, role, featureId): boolean
```

### Default Permission Matrix

#### Layer A — Tab Access Defaults

| Tab | guest | employee | supervisor | manager | admin |
|---|---|---|---|---|---|
| Population | view | view | view | edit | edit |
| Employee Workspace | none | edit | edit | edit | edit |
| ↳ Stats Dashboard | (parent) | (parent) | (parent) | (parent) | (parent) |
| ↳ Xray Referrals | (parent) | (parent) | (parent) | (parent) | (parent) |
| ↳ Xray Results | (parent) | (parent) | (parent) | (parent) | (parent) |
| ↳ Referral Approval | (parent) | (parent) | (parent) | (parent) | (parent) |
| ↳ Inspection Form | none | none | none | none | edit |
| Template Builder | none | none | none | edit | edit |
| Reports | none | none | view | edit | edit |
| Archive | none | none | view | edit | edit |
| User Management | none | none | none | none | edit |
| Settings | none | none | none | edit | edit |

#### Layer B — Feature Defaults

**Workspace Features:**

| Feature ID | Label | guest | employee | supervisor | manager | admin |
|---|---|---|---|---|---|---|
| `submit-referrals` | تحويل العينات | ✗ | ✓ | ✓ | ✓ | ✓ |
| `request-replacement` | طلب الاستبدال | ✗ | ✓ | ✗ | ✗ | ✓ |
| `submit-answers` | رفع الإجابات | ✗ | ✓ | ✗ | ✗ | ✓ |
| `approve-referrals` | اعتماد التحويلات | ✗ | ✗ | ✓ | ✓ | ✓ |
| `approve-replacements` | اعتماد الاستبدال | ✗ | ✗ | ✓ | ✓ | ✓ |
| `view-all-entries` | عرض جميع المدخلات | ✗ | ✗ | ✓ | ✓ | ✓ |
| `view-employee-stats` | إحصائيات الموظفين | ✗ | ✗ | ✓ | ✓ | ✓ |
| `configure-referral-columns` | ضبط الأعمدة | ✗ | ✗ | ✓ | ✓ | ✓ |

**Population Features:**

| Feature ID | Label | guest | employee | supervisor | manager | admin |
|---|---|---|---|---|---|---|
| `view-browse` | استعراض البيانات | ✓ | ✓ | ✓ | ✓ | ✓ |
| `upload-data` | رفع الملفات | ✗ | ✗ | ✗ | ✓ | ✓ |
| `process-population` | معالجة المجتمع | ✗ | ✗ | ✗ | ✓ | ✓ |
| `configure-sample` | ضبط العينة | ✗ | ✗ | ✗ | ✓ | ✓ |
| `draw-sample` | سحب العينة | ✗ | ✗ | ✗ | ✓ | ✓ |
| `distribute-samples` | توزيع العينة | ✗ | ✗ | ✗ | ✓ | ✓ |
| `bulk-assign` | التعيين الجماعي | ✗ | ✗ | ✓ | ✓ | ✓ |

**Admin Features:**

| Feature ID | Label | guest | employee | supervisor | manager | admin |
|---|---|---|---|---|---|---|
| `manage-users` | إدارة المستخدمين | ✗ | ✗ | ✗ | ✗ | ✓ |
| `reset-passwords` | إعادة كلمات المرور | ✗ | ✗ | ✗ | ✗ | ✓ |
| `edit-permissions` | تعديل الصلاحيات | ✗ | ✗ | ✗ | ✗ | ✓ |
| `export-reports` | تصدير التقارير | ✗ | ✗ | ✓ | ✓ | ✓ |
| `export-archive` | تصدير الأرشيف | ✗ | ✗ | ✗ | ✓ | ✓ |

---

## 5. Navigation & Tab Structure

### Sidebar Tabs (in display order)

| Order | Tab ID | Label (AR) | Icon | Allowed Roles |
|---|---|---|---|---|
| 10 | `population` | إدارة بيانات الأشعة | 📊 | all (role-filtered) |
| 15 | `employee-workspace` | مساحة العمل | 🔍 | all (role-filtered) |
| 20 | `template-builder` | نموذج الفحص | 📋 | manager, admin |
| 25 | `reports` | التقارير | 📄 | supervisor, manager, admin |
| 30 | `archive` | الأرشيف | 🗄️ | supervisor, manager, admin |
| 40 | `user-management` | إدارة المستخدمين | 👥 | admin |
| 95 | `settings` | الإعدادات | ⚙️ | guest, admin |

### Sub-Tab Hierarchy

```
population
├── process        (معالجة المجتمع)
├── browse         (استعراض بيانات الأشعة)
└── reports        (تقارير بيانات الأشعة)

employee-workspace
├── stats-dashboard    (لوحة الإحصائيات)      id: ew/stats-dashboard
├── xray-referrals     (صور الأشعة المحالة)   id: ew/xray-referrals
├── xray-results       (نتائج فحص الأشعة)     id: ew/xray-results
├── referral-approval  (اعتماد الطلبات)       id: ew/referral-approval
└── inspection-form    (نموذج الفحص)          id: ew/inspection-form [admin only]
```

### Tab Lazy Mounting

Tabs are lazy-mounted: a tab's component is mounted the first time a user visits it and remains mounted for the session even when hidden (`display: none`). This preserves state (scroll position, filters, loaded data) across tab switches. Tabs are unmounted only if role changes remove access.

---

## 6. Module: Population Data Management

**Tab ID:** `population`  
**Sub-tabs:** `process`, `browse`, `reports`

### 6.1 Sub-Tab: Process (معالجة المجتمع)

Four-phase sequential stepper. Phases must be completed in order; each phase unlocks the next.

---

#### Phase 1 — Upload Data

**Component:** `PhaseOneUpload.tsx`  
**Feature gate:** `upload-data`

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| Month/Year | Date picker | Yes | Target processing month (defaults to current) |
| Risk File | File (.xlsx / .xls) | Yes | Risk Agency data export |
| BI File | File (.xlsx / .xls) | No | Business Intelligence enrichment data |

**Behaviour:**
- File System Access API used when available; falls back to `<input type="file">` dialog
- File extension validated client-side before passing to worker
- Risk file parsed for all sheets matching configured sheet-name patterns
- BI file parsed separately with its own column mapping
- Worker emits progress messages displayed in a status toast
- On completion: uploads transition to Phase 2

**Outputs:**
- `RiskWorkbookResult` → raw rows per matched sheet
- `BiWorkbookResult | null` → raw BI rows (null if no BI file)

---

#### Phase 2 — Report & Process

**Component:** `PhaseTwoReportAndProcessing.tsx`  
**Feature gate:** `process-population`

**Inputs:**

| Field | Type | Description |
|---|---|---|
| CertScan Registry | Multi-line text paste | Cumulative registry of CertScan image IDs; persisted to workspace |

**Steps:**
1. Display workbook summary (sheets matched, rows parsed, column mapping preview)
2. User pastes/updates CertScan registry
3. "معالجة المجتمع" button triggers `processPopulation()`
4. Processing runs synchronously in main thread (after worker phase)
5. Progress bar displayed
6. On completion: save `population.final.json` and `population.raw.json` to disk
7. Offer XLSX download and HTML report download

**Processing Logic** (see §14 for full pipeline):
- Validate X-Ray IDs
- Deduplicate (keep first by xrayImageId)
- Link BI rows to risk rows (match on xrayImageId)
- Fill BI-sourced fields into population rows
- Validate L1/L2 results (normalize to "سليمة" / "اشتباه")
- CertScan cross-reference (classify each row as Certscan / NonCertscan)
- Generate `ProcessingSummary`

**Output files written:**
- `{month}/population/population.final.json` — `PreparedPopulationRow[]`
- `{month}/population/population.raw.json` — raw workbook rows

**Exports available:**
- Population XLSX (all processed rows)
- Phase 2 HTML Report (processing summary statistics)

---

#### Phase 3 — Sampling

**Component:** `PhaseThreeSampling.tsx`  
**Feature gate:** `draw-sample`, `configure-sample`

**Inputs:**

| Field | Type | Default | Description |
|---|---|---|---|
| RNG Seed | Text (16-char alphanumeric) | Random | Deterministic seed for reproducible draws |
| Per-stage rules | Table | Configured | See sampling rules below |

**Sampling Rules (per stage):**

| Field | Type | Description |
|---|---|---|
| `stageKey` | `"first"` \| `"second"` \| `"third"` \| `"fourth"` | Stage identifier |
| `method` | `"percentage"` \| `"exact"` | How quota is computed |
| `value` | number | Percentage (0–100) or exact count |
| `certScanPercentage` | number | Target CertScan % within this stage's sample |
| `certScanMethod` | `"percentage"` \| `"exact"` | How CertScan quota computed |
| `certScanStrategy` | `"mandatory"` \| `"preferred"` | Mandatory = must hit CertScan quota; Preferred = best-effort |

**Actions:**
- "سحب العينة" — Runs sampling algorithm, writes results
- "تحميل وثيقة الإثبات" — Downloads sample proof HTML report
- "تحميل الجدول (XLSX)" — Downloads sample rows as XLSX

**Output files written:**
- `{month}/sample/sample.master.json` — `SampleMasterData`

---

#### Phase 4 — Distribution

**Component:** `PhaseFourDistribution.tsx`  
**Feature gate:** `distribute-samples`, `bulk-assign`

**The distribution grid shows all sample rows with their current assignment status.**

**Per-row actions:**

| Action | Label (AR) | Who can trigger | Condition |
|---|---|---|---|
| Assign | تعيين | manager, admin, supervisor (bulk-assign) | Row is unassigned |
| Reassign | إعادة التعيين | manager, admin | Row is assigned |
| Mark Complete | إكمال | manager, admin | Row is assigned |
| Request Replacement | طلب الاستبدال | employee (own row) | Row assigned to them |

**Bulk Assignment:**
- CSV import: rows of `xrayImageId,username`
- Validates against sample rows and active employee list
- Preview before commit

**Status Flow:**

```
unassigned
   → assigned (assign event)
       → completed (mark-complete event)
       → replacement-requested (employee request)
           → replaced (supervisor/manager approves)
       → reassigned (manager/admin re-assigns)
```

**Output files written (append-only):**
- `{month}/distribution/distribution.log.json` — event log
- `{month}/distribution/distribution.current.json` — derived snapshot

---

### 6.2 Sub-Tab: Browse (استعراض بيانات الأشعة)

**Component:** Various browse components  
**Feature gate:** `view-browse`

**Dataset selector:**

| Dataset ID | Label (AR) | Source file |
|---|---|---|
| `population` | المجتمع النهائي | `population.final.json` |
| `sample` | العينة المسحوبة | `sample.master.json` (rows field) |
| `risk-raw` | البيانات الخام (Risk) | `population.raw.json` (risk sheets) |
| `bi-raw` | البيانات الخام (BI) | `population.raw.json` (bi sheets) |

**Browse Columns (population/sample datasets):**

| Column Key | Label (AR) | Default Visible | Type |
|---|---|---|---|
| `xrayImageId` | معرف الأشعة | ✓ | string |
| `portName` | المنفذ | ✓ | string |
| `stage` | المستوى | ✓ | string |
| `certScanStatus` | CertScan | ✓ | enum |
| `xrayLevelOneResult` | نتيجة L1 | ✓ | string |
| `xrayLevelTwoResult` | نتيجة L2 | ✗ | string |
| `xrayEntryDate` | تاريخ الدخول | ✗ | date |
| `declarationNumber` | رقم البيان | ✗ | string |
| `declarationDate` | تاريخ البيان | ✗ | date |
| `plateOrContainerNumber` | لوحة / حاوية | ✗ | string |
| `chassisNumber` | رقم الهيكل | ✗ | string |
| `movementType` | نوع الحركة | ✗ | string |
| `portCode` | كود المنفذ | ✗ | string |
| `portType` | نوع المنفذ | ✗ | string |
| `targetedByRiskEngine` | مستهدف بالمخاطر | ✗ | string |
| `riskMessage` | رسالة المخاطر | ✗ | string |
| `biEnrichmentStatus` | حالة BI | ✗ | string |
| `reportNumber` | رقم التقرير | ✗ | string |
| `_monthFolder` | الشهر المصدر | ✓ | string |

**DataTable Features:**

| Feature | Description |
|---|---|
| Global search | Real-time filter across all visible columns |
| Column filters | Per-column popup: text search, multi-select values, date range, specific day |
| Column visibility | Toggle panel with drag-to-reorder; saves preset per user |
| Month filter | Dropdown to filter by processing month or show all months |
| Export XLSX | Exports current filtered view (respects column visibility) |
| Row count | Shows "N صف" in footer |
| Virtualization | Only renders visible rows for large datasets (10,000+ rows) |

**KPI Dashboard Panel (overlaid on browse):**

| KPI | Description |
|---|---|
| إجمالي المجتمع | Total population rows for selected month(s) |
| إجمالي العينة | Total drawn sample size |
| المدروسة | Completed inspection count |
| نسبة الإنجاز | Completion % |
| قيد الانتظار | Pending (assigned but not completed) |
| الأشهر المعالجة | Count of processed month folders |

---

### 6.3 Sub-Tab: Reports (تقارير بيانات الأشعة)

**Component:** `XrayReportsDashboard.tsx`

**Charts displayed (one per processed month, or single calendar for selected month):**

| Chart | Type | Data Source |
|---|---|---|
| توزيع المجتمع والعينة عبر الأشهر | Line/Bar trend | Monthly summary |
| CertScan vs. NonCertscan | Pie chart | Monthly processing summary |
| حالة التوزيع | Bar chart | Distribution current snapshot |
| توزيع حسب المستوى والشهر | Heatmap/grid | Stage allocations per month |
| نسبة العينة ونسبة الإنجاز | Dual-line chart | Monthly ratios |
| أعلى 10 منافذ | Horizontal bar | Port totals |
| التوزيع اليومي | Calendar heatmap | Distribution event dates |

**Calendar heatmap rules:**
- Shows only 1 calendar at a time (driven by month filter)
- "All months" → shows most recent month's calendar
- All numbers displayed in Western Arabic digits (Latin numerals)

**Monthly summary table columns:**

| Column | Description |
|---|---|
| الشهر | Month label |
| المجتمع | Population count |
| العينة | Sample count |
| المدروسة | Completed |
| الإنجاز % | Completion rate |
| CertScan | CertScan count |
| NonCertScan | NonCertscan count |

---

## 7. Module: Employee Workspace

**Tab ID:** `employee-workspace`  
**Sub-tabs:** 5 views

### 7.1 Stats Dashboard (لوحة الإحصائيات)

**Component:** `StatsDashboard.tsx`  
**Feature gate:** `view-employee-stats` (for supervisor+ employee table)

**Views by role:**

| Role | Sees |
|---|---|
| employee | Personal KPIs: assigned, completed, pending, replaced |
| supervisor / manager | All employees' KPIs in a summary table |
| admin | Same as supervisor/manager |
| guest | Population-level KPIs only |

**Employee Stats Table Columns (supervisor+ view):**

| Column | Description |
|---|---|
| الموظف | Employee display name |
| المعينة | Assigned count |
| المكتملة | Completed count |
| قيد الانتظار | Pending count |
| المستبدلة | Replaced count |
| الإنجاز % | Completion rate |

---

### 7.2 Xray Referrals (صور الأشعة المحالة)

**Component:** `XrayReferrals.tsx`  
**Feature gates:** `submit-referrals`, `view-all-entries`

**Data shown:**
- Employee: Only samples assigned to them
- Supervisor/Manager: All assigned samples across all employees

**Table Columns:**

| Column | Label (AR) | Description |
|---|---|---|
| `xrayImageId` | معرف الأشعة | Primary key |
| `stage` | المستوى | Stage classification |
| `portName` | المنفذ | Port assignment |
| `xrayEntryDate` | تاريخ الدخول | Entry date of image |
| `certScanStatus` | CertScan | Certscan / NonCertscan |
| `assignedTo` | مُعيَّن إلى | Employee username |
| `status` | الحالة | Current distribution status |
| `lastEventAt` | آخر حدث | Timestamp of latest event |

**Actions per row:**

| Action | Condition | Feature gate |
|---|---|---|
| فتح نموذج الفحص | Own row or supervisor | `submit-answers` |
| تحويل إلى زميل | Employee row, pending | `submit-referrals` |
| طلب استبدال | Own row, pending | `request-replacement` |

**Referral submission dialog fields:**

| Field | Type | Validation |
|---|---|---|
| Target employee | Dropdown (active employees) | Required |
| Selected x-ray IDs | Checkbox list | At least 1 required |
| Reason | Textarea | Required, min 10 chars |

---

### 7.3 Xray Inspection Results (نتائج فحص الأشعة)

**Component:** `XrayInspectionResults.tsx`

**Data source:** JOIN of `sample.master.json` rows + all `answers/{employee}.json` files for selected month(s)

**Join key:** `xrayImageId`

**Table Columns:**

| Column | Label (AR) | Source | Default Visible |
|---|---|---|---|
| `xrayImageId` | معرف الأشعة | sample row | ✓ |
| `stage` | المستوى | sample row | ✓ |
| `portName` | المنفذ | sample row | ✓ |
| `xrayLevelOneResult` | نتيجة L1 | sample row | ✓ |
| `xrayLevelTwoResult` | نتيجة L2 | sample row | ✓ |
| `certScanStatus` | CertScan | sample row | ✓ |
| `assignedTo` | المعين إليه | distribution | ✓ |
| `status` | الحالة | distribution | ✓ |
| `answerStatus` | حالة الإجابة | answer file | ✓ |
| `submittedAt` | تاريخ رصد خبير الجودة | answer file | ✓ |
| (form fields) | Dynamic | answer file | ✗ |

**Month filter** → loads data for selected month or all months

---

### 7.4 Referral Approval (اعتماد الطلبات)

**Component:** `ReferralApproval.tsx`  
**Feature gates:** `approve-referrals`, `approve-replacements`

**Two request types handled in separate tabs:**

#### Referral Requests Tab

| Column | Description |
|---|---|
| معرف الطلب | Request UUID |
| من | Requesting employee |
| إلى | Target employee |
| عدد الصور | Number of X-Ray IDs in request |
| السبب | Reason text |
| وقت الطلب | Request timestamp |
| الحالة | pending / approved / denied |

**Approve action:**
- Updates request status → approved
- Moves distribution entries from `fromEmployee` to `toEmployee`
- Appends `reassigned` events to distribution log

**Deny action:**
- Updates request status → denied
- Distribution entries remain with original employee

#### Replacement Requests Tab

| Column | Description |
|---|---|
| معرف الطلب | Request UUID |
| الصورة الأصلية | Original xrayImageId |
| الصورة البديلة | Replacement xrayImageId |
| الموظف | Requesting employee |
| السبب | Reason |
| وقت الطلب | Timestamp |
| الحالة | pending / approved / denied |

**Approve action:**
- Eligibility re-validated at approval time (replacement row must still be in population and unassigned)
- Atomic swap: original → replaced, replacement → assigned to same employee
- Appends `replaced` event to distribution log

---

### 7.5 Inspection Form (نموذج الفحص — admin only sub-tab)

**Component:** Same as Template Builder embedded in workspace  
**Access:** `ew/inspection-form` sub-tab (admin only per MANAGED_TABS)  
**Purpose:** Admin preview/fill forms directly within workspace context

---

## 8. Module: Template Builder

**Tab ID:** `template-builder`  
**Allowed Roles:** manager, admin

**Purpose:** Design the custom inspection form that employees fill per sample.

### Form Field Types

| Type | Arabic | Description |
|---|---|---|
| text | نص | Free text input |
| number | رقم | Numeric input with optional min/max |
| date | تاريخ | Date picker |
| select | قائمة | Single-select dropdown |
| multiselect | تعدد الخيارات | Multi-select list |
| checkbox | خانة اختيار | Boolean toggle |
| textarea | نص طويل | Multi-line free text |
| radio | اختيار واحد | Single-choice radio group |

### Template Structure

```typescript
type FormTemplate = {
  templateId: string;
  name: string;
  version: number;
  createdAt: string;
  createdBy: string;
  fields: FormField[];
  isActive: boolean;
};

type FormField = {
  fieldId: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];        // For select/multiselect/radio
  min?: number;              // For number
  max?: number;              // For number
  placeholder?: string;
  order: number;
};
```

### Template Versioning

- Templates are versioned; changing a field creates a new version
- Answers store the `templateId` + `templateVersion` they were filled against
- Old template versions are preserved for historical answer display

---

## 9. Module: Reports

**Tab ID:** `reports`  
**Allowed Roles:** supervisor, manager, admin  
**Feature gate:** `export-reports`

### Report Types

#### 9.1 Sample Proof Report

**Trigger:** Phase 3 completion or manual re-download  
**Format:** HTML file (opens in new tab or auto-downloads)

**Contents:**

| Section | Content |
|---|---|
| Header | Month name, draw timestamp, drawn by (username), RNG seed |
| Stage Allocation Table | stageKey, target quota, CertScan quota, actual drawn, % |
| Port Allocation Table | portName, population size, CertScan/NonCertScan counts, allocated quota, actual drawn |
| Sample Row Grid | xrayImageId, stage, port, L1 result, L2 result, CertScan status |

#### 9.2 Distribution Report

**Trigger:** Manual via Reports tab  
**Format:** HTML file

**Contents:**

| Section | Content |
|---|---|
| Header | Month name, derivation timestamp |
| Summary KPIs | Total assigned, completed, pending, replaced |
| Per-Employee Table | username, assigned, completed, pending, replaced, completion % |
| Sample Status Grid | xrayImageId, stage, assignedTo, status, lastEventAt |

#### 9.3 Executive Dashboard

See §6.3 (Reports sub-tab in Population module) — this is the chart-based view.

---

## 10. Module: Archive & Backup

**Tab ID:** `archive`  
**Allowed Roles:** supervisor (view), manager (view + export), admin (all)

### Backup Types

| Type | Trigger | Storage path |
|---|---|---|
| Manual | Admin clicks "نسخ احتياطي الآن" | `.system/backups/{timestamp}/` |
| Automatic (daily) | Admin login, once per calendar day | `.system/backups/auto-{timestamp}/` |
| Automatic (weekly) | Admin login, once per calendar week | `.system/backups/auto-{timestamp}/` |
| Pre-restore | Auto-created before any restore action | `.system/backups/pre-restore-{timestamp}/` |

### Backup Contents

Each backup folder contains:
- Full JSON copies of all month folders (population, sample, distribution, answers)
- `.system/` copies (users, templates, config)
- Chunked XLSX exports (respects 1,048,576 Excel row limit per sheet)

### Backup History Index

**File:** `.system/backup.history.json`

**Fields per entry:**

| Field | Type | Description |
|---|---|---|
| `folderName` | string | Backup folder name |
| `createdAt` | ISO string | When backup was created |
| `createdBy` | string | Username |
| `mode` | `"manual"` \| `"automatic"` \| `"pre-restore"` | How triggered |
| `monthCount` | number | How many month folders backed up |
| `jsonFileCount` | number | Total JSON files |
| `xlsxFileCount` | number | Total XLSX files |
| `totalRows` | number | Approximate total rows |

### Restore Flow

1. Admin selects backup from list
2. System auto-creates `pre-restore-{timestamp}` backup of current state
3. Confirmation dialog (2-step: "أنت متأكد؟" → "نعم، الاستعادة")
4. Overwrite all month data folders with backup copies
5. Reload application

### Archive Status Table

Shows each processed month with file-presence badges:

| Badge | Meaning |
|---|---|
| raw-saved | `population.raw.json` exists |
| processed-saved | `population.final.json` exists |
| sampled | `sample.master.json` exists |
| distributed | `distribution.log.json` exists |

---

## 11. Module: User Management

**Tab ID:** `user-management`  
**Allowed Roles:** admin only

### 11.1 User Table

**Columns:**

| Column | Type | Editable | Description |
|---|---|---|---|
| اسم العرض | string | ✓ (admin) | Display name |
| اسم المستخدم | string | ✗ | Unique identifier (lowercase) |
| الحالة | boolean | ✓ | Active / Inactive (dot indicator) |
| الدور | enum | ✓ | MANAGED_ROLES dropdown |
| رخصة CertScan | boolean | ✓ | Enables CertScan-specific views |
| كلمة المرور | password | ✓ | New password input + reset button |
| حذف | button | ✓ | Delete with 2-step confirmation |

**Search:** Real-time filter on `displayName` + `username`  
**Filter pills:**
- Status: الكل / نشط / غير نشط
- Role: الكل / موظف / مشرف / مدير / ضيف

### 11.2 Add User Form

| Field | Validation | Notes |
|---|---|---|
| اسم المستخدم | Required, unique, lowercase, no spaces | Auto-normalized on blur |
| اسم العرض | Required | Arabic supported |
| الدور | Required, from MANAGED_ROLES | Excludes admin |
| كلمة المرور | Required, min 8 chars | Hashed via Argon2id before save |
| رخصة CertScan | Optional checkbox | Default: false |

### 11.3 Permission Matrix (Layer A)

See §4 for full matrix design. UI features:
- Parent rows clickable to collapse/expand sub-tab rows
- Chevron + sub-tab count badge on parent rows
- Admin column locked (always "edit")
- "موروث" badge on sub-tabs with inherited access
- Cells: 3-button segmented group (none / view / edit)

### 11.4 Feature Permission Matrix (Layer B)

- Tabbed by feature group (Workspace / Population / Admin)
- Each feature row: label, description, toggle per role
- Greyed-out toggles = parent tab blocked (cascade)
- Admin toggles always on and locked

### 11.5 Disk Sync

**File:** `.system/users.permissions.json`  
**Type:** `UsersPermissionsFile`

```typescript
type UsersPermissionsFile = {
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  contentHash: string;
  users: ManagedLoginUser[];
  permissions: RolePermission[];
  featurePermissions: FeaturePermission[];
};
```

---

## 12. Module: Settings (Label Customization)

**Tab ID:** `settings`  
**Allowed Roles:** guest (view only), admin (edit)

All 117 UI text strings can be overridden per installation without code changes.

### UI Structure

- Grouped accordion sections under a parent category "التسميات والعناوين"
- Each section: collapsible header showing group name + count of customized labels
- Each label row: current value input + save button + reset-to-default button
- Default value shown as placeholder when customized
- "إعادة الكل للافتراضي" button with confirmation dialog

### Storage

- **localStorage key:** `xray-labels-v1`
- **Format:** `Partial<Record<LabelKey, string>>`
- Stored only for overridden keys; missing keys fall back to defaults

### Reactivity

Labels use a subscriber pattern:
```typescript
subscribe(fn: () => void): () => void   // Returns unsubscribe function
```

Components call `useLabels()` hook which subscribes and re-renders on any label change.

---

## 13. Data Layer & File Storage

### Workspace Selection

On first launch, user picks a workspace folder via File System Access API. The folder handle is stored in IndexedDB. The workspace is verified on subsequent launches.

### Month Folder Naming

Format: `YYYY-MM` (e.g., `2025-06`)

### File System Layout

```
{workspace}/
├── .system/
│   ├── users.permissions.json
│   ├── certscan.registry.txt
│   ├── config.json
│   ├── backup.history.json
│   ├── auto-backup.state.json
│   ├── auto-backup.settings.json
│   └── backups/
│       └── {timestamp}/
│           └── (mirror of all month folders + .system/)
│
└── {YYYY-MM}/                       ← One folder per processed month
    ├── population/
    │   ├── population.final.json
    │   └── population.raw.json
    ├── sample/
    │   └── sample.master.json
    ├── distribution/
    │   ├── distribution.log.json
    │   └── distribution.current.json
    └── answers/
        ├── {username}.json          ← One file per employee
        └── ...
```

### File Descriptions

| File | Type | Description |
|---|---|---|
| `population.final.json` | `PreparedPopulationRow[]` | Processed, validated, enriched population |
| `population.raw.json` | `RawWorkbookData` | Raw XLSX rows before processing |
| `sample.master.json` | `SampleMasterData` | Drawn sample rows + allocations |
| `distribution.log.json` | `DistributionLog` | Append-only event log |
| `distribution.current.json` | `DistributionCurrentData` | Derived snapshot of current distribution state |
| `{username}.json` | `EmployeeAnswerFile` | All answers + referral/replacement requests for one employee |
| `users.permissions.json` | `UsersPermissionsFile` | User accounts + permission matrices |

### Write Safety (safeWrite)

All writes use a `safeWrite` utility:
1. Write to `{file}.tmp`
2. Read back and verify byte size
3. Rename `.tmp` → target file
4. If verification fails: keep `.bak` copy and surface recovery warning

### Optimistic Concurrency (CAS Loops)

Distribution log uses Compare-And-Swap:
- Each read captures `revision` + `_writeToken`
- Write is rejected if revision changed since read
- UI retries up to 3 times before showing error

---

## 14. Processing Pipeline

**Function:** `processPopulation(riskRows, biRows, certScanText, config)`  
**Location:** `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts`

### Step-by-step

| Step | Description | Output |
|---|---|---|
| 1. ID Validation | Reject rows where `xrayImageId` is null, empty, or whitespace | `invalidRiskIdRows` counter |
| 2. Deduplication | Keep first occurrence per `xrayImageId`; discard subsequent duplicates | `duplicateRiskIdRows` counter |
| 3. BI Linking | Build lookup map from BI rows (keyed by xrayImageId); join to risk rows | `biMatchedRows`, `biUnmatchedRows` |
| 4. BI Field Fill | For matched rows: copy BI columns into population using `biColumnMappings` | `biFilledFields[]` per row |
| 5. Result Normalization | Convert any L1/L2 value to "سليمة" or "اشتباه" via `normalizeResultValue()` | Removes rows with invalid results |
| 6. CertScan Classification | Check `xrayImageId` against CertScan registry text; set `certScanStatus` | `certScanRows`, `nonCertScanRows` |
| 7. Stage Mapping | Map raw stage strings to canonical keys via `stageMappings` aliases | Rows with unknown stages get `null` |
| 8. Date Normalization | Convert all date fields to `YYYY-MM-DD` via `normalizeDate()` | Dates in 8+ formats supported |
| 9. Finalize | Set `sourceSheetName`, `sourceRowNumber`; build `ProcessingSummary` | `PreparedPopulationRow[]` |

### Date Normalization (`normalizeDate`)

Handles 8+ date formats:

| Format | Example | Strategy |
|---|---|---|
| ISO 8601 | `2025-06-12` | Pass-through |
| ISO with time | `2025-06-12T09:30:00` | Truncate to date |
| DD/MM/YYYY | `12/06/2025` | Reorder parts |
| DD-MM-YYYY | `12-06-2025` | Reorder parts |
| DD.MM.YYYY | `12.06.2025` | Reorder parts |
| DDMmmYYYY | `12Dec2025` | Parse month name |
| DD Mmmm YYYY (Arabic) | `12 ديسمبر 2025` | Arabic month lookup |
| Excel serial | `45474` | `(serial - 25569) * 86400s → date` |
| Dash / dot / empty | `-`, `.`, `` | Returns `null` |

### Result Normalization (`normalizeResultValue`)

| Input | Output |
|---|---|
| `"1"` | `"سليمة"` |
| `"2"` | `"اشتباه"` |
| `"سليمة - 123"` (BI format) | `"سليمة"` |
| `"اشتباه - risk"` (BI format) | `"اشتباه"` |
| `"CLEAR"`, `"OK"`, `"PASS"` | `"سليمة"` |
| `"ALERT"`, `"FAIL"`, `"SUSPECT"` | `"اشتباه"` |
| `"سليمة"` (exact) | `"سليمة"` |
| `"اشتباه"` (exact) | `"اشتباه"` |
| `"نظيف"`, `"مقبول"` (Arabic synonyms) | `"سليمة"` |
| `"مريب"`, `"مشبوه"` (Arabic synonyms) | `"اشتباه"` |
| Any other / unknown | `null` (row removed) |

---

## 15. Sampling Algorithm

**Function:** `drawSample(population, config, rules, stageMappings, seed)`  
**Location:** `src/data/distribution/sampleAlgorithm.ts`

### Algorithm Steps

1. **Stratify by stage:** Group population rows by canonical stage key
2. **Per-stage quota:** Apply `StageSamplingRule` (percentage or exact count)
3. **Per-port quota within stage:** Allocate stage quota proportionally to each port's population size within that stage
4. **CertScan quota per port:** From port quota, compute CertScan sub-quota (mandatory or preferred)
5. **Seeded RNG:** Initialize deterministic RNG using seed string
6. **Draw per port:** For each port:
   - Shuffle CertScan rows (seeded) → take up to CertScan quota
   - Shuffle NonCertScan rows (seeded) → fill remaining quota
   - If mandatory CertScan and not enough CertScan rows: log shortfall
7. **Collect results:** All drawn rows → `SampleMasterData.rows`
8. **Build allocations:** Compute `PortAllocation[]` and `StageAllocation[]` with actual vs requested counts

### Seeded RNG

Uses a deterministic PRNG (mulberry32 or similar) initialized from the 16-character seed string. Same seed + same population = same sample every time (reproducible draws for audit purposes).

---

## 16. Distribution & Event System

### Event Types

| Event Type | Trigger | Actor | Description |
|---|---|---|---|
| `assigned` | Manual assign or bulk import | manager/admin | Sample allocated to employee |
| `reassigned` | Re-assign action or referral approval | manager/admin/supervisor | Sample moved to different employee |
| `completed` | Mark-complete action | manager/admin | Inspection marked done |
| `replacement-requested` | Employee request | employee | Employee requests swap |
| `replaced` | Replacement approval | supervisor/manager | Swap executed |

### Event Shape

```typescript
type DistributionEvent = {
  eventId: string;              // UUID
  eventType: DistributionEventType;
  xrayImageId: string;
  assignedTo: string;           // Current assignee at time of event
  replacedById?: string;        // For "replaced" events
  reassignedTo?: string;        // For "reassigned" events
  eventAt: string;              // ISO datetime
  eventBy: string;              // Username performing action
  notes?: string;               // Optional reason/notes
  dailyQuota?: number;
  daysRemainingAtAssignment?: number;
};
```

### Distribution Current (Derived Snapshot)

The `distribution.current.json` is derived from the event log on each load:

```
deriveCurrentDistribution(log) →
  For each xrayImageId:
    - Walk events chronologically
    - Apply state machine: unassigned → assigned → completed/replaced
    - Record final assignedTo, status, lastEventAt
```

This ensures the current view is always consistent with the full event history.

---

## 17. Worker Architecture

### Workbook Worker

**File:** `src/workers/workbookWorker.ts`  
**Type:** Web Worker (off main thread)

**Request interface:**

```typescript
type WorkbookWorkerRequest = {
  riskFile: File;
  biFile: File | null;
  riskSheetPatterns?: string[];          // Sheet name patterns to match
  biSheetPatterns?: string[];            // BI sheet patterns
  columnMappings?: Record<string, string[]>;    // Risk column aliases
  biColumnMappings?: Record<string, string[]>;  // BI column aliases (new, optional)
};
```

**Response messages:**

| Type | Fields | Meaning |
|---|---|---|
| `"progress"` | `message: string` | Status update (display in UI) |
| `"done"` | `riskResult, biResult, warning?` | Parse complete |
| `"error"` | `error: string` | Fatal parse failure |

**Worker lifecycle:**
1. Phase 1 upload creates worker via `new Worker(...)`
2. Sends `WorkbookWorkerRequest` via `postMessage`
3. Main thread listens for progress messages → updates status toast
4. On `"done"` → Phase 1 complete, transition to Phase 2
5. On `"error"` → Show error banner, stay on Phase 1

**Processing inside worker:**
- Parse XLSX/XLS binary via `SheetJS (xlsx)` library
- Match sheets by pattern (regex or substring)
- Apply column name alias mapping → normalize headers
- Return raw row arrays (no processing; processing is in main thread Phase 2)

---

## 18. Label System — Full Mapping

**Total keys:** 117  
**Storage:** localStorage `xray-labels-v1`  
**Type:** `Partial<Record<LabelKey, string>>`

### Complete Label Catalogue

#### Group: Sidebar (2 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `sidebar_title` | القائمة | Sidebar header title |
| `sidebar_subtitle` | نظام الأشعة | Sidebar sub-header |

#### Group: Page Headers — Settings (3 labels)

| Key | Default | Description |
|---|---|---|
| `page_settings_eyebrow` | System Settings | Settings page eyebrow tag |
| `page_settings_title` | إعدادات النظام | Settings page H1 |
| `page_settings_subtitle` | تخصيص تسميات النظام... | Settings page subtitle |

#### Group: Page Headers — Xray Referrals (4 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `page_xray_referrals_eyebrow` | Inspection Workspace | Referrals page eyebrow |
| `page_xray_referrals_title` | صور الأشعة المحالة | Referrals page H1 |
| `page_xray_referrals_subtitle_own` | اعرض العينات المسندة إليك... | Subtitle for employees (own entries) |
| `page_xray_referrals_subtitle_all` | عرض جميع صور الأشعة المحالة... | Subtitle for supervisors (all entries) |

#### Group: Page Headers — Xray Results (3 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `page_xray_results_eyebrow` | Inspection Results | Results page eyebrow |
| `page_xray_results_title` | نتائج فحص الأشعة | Results page H1 |
| `page_xray_results_subtitle` | جدول يجمع بيانات العينات... | Results page subtitle |

#### Group: DataTable Controls (20 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `dt_search_placeholder` | بحث في جميع الأعمدة... | Search input placeholder |
| `dt_clear_filters` | مسح التصفية | Clear all filters button |
| `dt_export_xlsx` | تصدير XLSX | Export button label |
| `dt_columns_button` | ⚙ الأعمدة | Column toggle button label |
| `dt_columns_title` | الأعمدة | Column panel title |
| `dt_columns_hint` | اسحب للترتيب · انقر لإخفاء/إظهار | Column panel hint |
| `dt_reset_default` | إعادة الافتراضي | Reset columns button |
| `dt_done` | تم | Done button |
| `dt_row_suffix` | صف | Row count suffix ("N صف") |
| `dt_filter_clear` | مسح | Filter clear button |
| `dt_filter_empty` | لا توجد قيم | Filter no-options message |
| `dt_filter_search` | ابحث... | Filter search input |
| `dt_filter_apply` | تطبيق | Filter apply button |
| `dt_filter_specific_day` | يوم محدد | Date filter: specific day tab |
| `dt_filter_range` | نطاق | Date filter: range tab |
| `dt_filter_from` | من | Date range "from" label |
| `dt_filter_to` | إلى | Date range "to" label |
| `dt_date_badge` | تاريخ | Date filter badge prefix |
| `dt_show_column` | إظهار | Column visibility: show |
| `dt_hide_column` | إخفاء | Column visibility: hide |

#### Group: Stage Names (5 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `stage_first` | المستوى الأول | Stage 1 display name |
| `stage_second` | المستوى الثاني | Stage 2 display name |
| `stage_third` | المستوى الثالث | Stage 3 display name |
| `stage_fourth` | المستوى الرابع | Stage 4 display name |
| `stage_unknown` | غير محدد | Unknown stage display name |

#### Group: CertScan Names (2 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `certscan_name` | نظام الأشعة المركزية (CertScan) | CertScan system display name |
| `noncertscan_name` | غير المركزية (NonCertScan) | NonCertScan display name |

#### Group: Table Column Headers (20 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `col_xray_image_id` | معرف الأشعة | X-Ray image ID column |
| `col_stage` | المستوى | Stage column |
| `col_xray_quality_expert` | خبير جودة الأشعة | Quality expert column |
| `col_port_name` | المنفذ | Port name column |
| `col_xray_entry_date` | تاريخ دخول صورة الأشعة | Entry date column |
| `col_distribution_date` | تاريخ التوزيع | Distribution date column |
| `col_plate_or_container_number` | لوحة / حاوية | Plate/container column |
| `col_answer_status` | الحالة | Answer status column |
| `col_xray_l1_result` | نتيجة L1 | Level 1 result column |
| `col_xray_l2_result` | نتيجة L2 | Level 2 result column |
| `col_certscan_status` | CertScan | CertScan status column |
| `col_declaration_number` | رقم البيان | Declaration number column |
| `col_declaration_date` | تاريخ البيان | Declaration date column |
| `col_chassis_number` | رقم الهيكل | Chassis number column |
| `col_movement_type` | نوع الحركة | Movement type column |
| `col_port_code` | كود المنفذ | Port code column |
| `col_port_type` | نوع المنفذ | Port type column |
| `col_targeted_by_risk` | مستهدف بالمخاطر | Risk targeting flag column |
| `col_risk_message` | رسالة المخاطر | Risk message column |
| `col_bi_enrichment_status` | حالة BI | BI enrichment status column |
| `col_report_number` | رقم التقرير | Report number column |

#### Group: Status Labels (13 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `status_all` | الكل | "All" filter option |
| `status_completed` | مكتملة | Completed status |
| `status_submitted` | مقدمة | Submitted status |
| `status_draft` | مسودة | Draft status |
| `status_pending` | لم تُبدأ | Not started / pending |
| `status_replaced` | مستبدلة | Replaced status |
| `value_empty` | — | Empty value placeholder |
| `label_month` | الشهر | Month label |
| `label_template` | النموذج | Template label |
| `xray_results_loading` | جاري تحميل نتائج الفحص... | Loading state message |
| `xray_results_error` | تعذر تحميل نتائج فحص الأشعة. | Error state message |
| `xray_results_no_months` | لا توجد أشهر معالجة... | No months empty state |
| `xray_results_no_rows` | لا توجد نتائج فحص محفوظة... | No rows empty state |

#### Group: KPI Labels (6 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `kpi_population` | إجمالي المجتمع | Population KPI card |
| `kpi_sample` | إجمالي العينة | Sample KPI card |
| `kpi_completed` | المدروسة | Completed KPI card |
| `kpi_completion_rate` | نسبة الإنجاز | Completion % KPI card |
| `kpi_pending` | قيد الانتظار | Pending KPI card |
| `kpi_months` | الأشهر المعالجة | Processed months KPI card |

#### Group: Executive Report Charts (5 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `exec_report_title` | التقرير التنفيذي | Executive report title |
| `exec_chart_port` | توزيع المجتمع حسب المنفذ | Port distribution chart |
| `exec_chart_daily` | توزيع المجتمع على حسب اليوم | Daily calendar heatmap |
| `exec_chart_stage` | توزيع المجتمع حسب المستوى | Stage distribution chart |
| `exec_chart_stage_summary` | ملخص حسب المستوى | Stage summary table |

#### Group: Overview Charts (7 labels)

| Key | Default (AR) | Description |
|---|---|---|
| `ov_chart_trend` | تطور المجتمع والعينة والإنجاز عبر الأشهر | Trend line chart |
| `ov_chart_certscan` | توزيع نظام الأشعة المركزية / غير المركزية | CertScan pie chart |
| `ov_chart_dist_status` | حالة التوزيع | Distribution status chart |
| `ov_chart_stage_month` | توزيع المجتمع حسب المستوى والشهر | Stage × Month heatmap |
| `ov_chart_rates` | نسبة العينة ونسبة الإنجاز عبر الأشهر | Rates trend chart |
| `ov_chart_top_ports` | أعلى 10 منافذ من حيث حجم المجتمع والعينة | Top ports bar chart |
| `ov_chart_month_summary` | ملخص كل شهر | Monthly summary table |

---

## 19. Full Permission Matrix

### Layer A — Managed Tab Access (Admin Configurable)

| Tab ID | Label | Parent | guest | employee | supervisor | manager | admin |
|---|---|---|---|---|---|---|---|
| `population` | إدارة بيانات الأشعة | — | view | view | view | edit | **edit (locked)** |
| `employee-workspace` | مساحة العمل | — | none | edit | edit | edit | **edit (locked)** |
| `ew/stats-dashboard` | لوحة الإحصائيات | employee-workspace | (inherit) | (inherit) | (inherit) | (inherit) | **edit (locked)** |
| `ew/xray-referrals` | صور الأشعة المحالة | employee-workspace | (inherit) | (inherit) | (inherit) | (inherit) | **edit (locked)** |
| `ew/xray-results` | نتائج فحص الأشعة | employee-workspace | (inherit) | (inherit) | (inherit) | (inherit) | **edit (locked)** |
| `ew/referral-approval` | اعتماد الطلبات | employee-workspace | (inherit) | (inherit) | (inherit) | (inherit) | **edit (locked)** |
| `ew/inspection-form` | نموذج الفحص | employee-workspace | none | none | none | none | **edit (locked)** |
| `template-builder` | نموذج الفحص | — | none | none | none | edit | **edit (locked)** |
| `reports` | التقارير | — | none | none | view | edit | **edit (locked)** |
| `archive` | الأرشيف | — | none | none | view | edit | **edit (locked)** |
| `user-management` | إدارة المستخدمين | — | none | none | none | none | **edit (locked)** |
| `settings` | الإعدادات | — | none | none | none | edit | **edit (locked)** |

> **(inherit)** = inherits parent's access level unless explicitly overridden  
> **(locked)** = always forced to "edit" for admin, cannot be changed

### Layer B — Feature Permissions (Admin Configurable)

**Group: Workspace**

| Feature | guest | employee | supervisor | manager | admin |
|---|---|---|---|---|---|
| `submit-referrals` | ✗ | ✓ | ✓ | ✓ | ✓ (locked) |
| `request-replacement` | ✗ | ✓ | ✗ | ✗ | ✓ (locked) |
| `submit-answers` | ✗ | ✓ | ✗ | ✗ | ✓ (locked) |
| `approve-referrals` | ✗ | ✗ | ✓ | ✓ | ✓ (locked) |
| `approve-replacements` | ✗ | ✗ | ✓ | ✓ | ✓ (locked) |
| `view-all-entries` | ✗ | ✗ | ✓ | ✓ | ✓ (locked) |
| `view-employee-stats` | ✗ | ✗ | ✓ | ✓ | ✓ (locked) |
| `configure-referral-columns` | ✗ | ✗ | ✓ | ✓ | ✓ (locked) |

**Group: Population**

| Feature | guest | employee | supervisor | manager | admin |
|---|---|---|---|---|---|
| `view-browse` | ✓ | ✓ | ✓ | ✓ | ✓ (locked) |
| `upload-data` | ✗ | ✗ | ✗ | ✓ | ✓ (locked) |
| `process-population` | ✗ | ✗ | ✗ | ✓ | ✓ (locked) |
| `configure-sample` | ✗ | ✗ | ✗ | ✓ | ✓ (locked) |
| `draw-sample` | ✗ | ✗ | ✗ | ✓ | ✓ (locked) |
| `distribute-samples` | ✗ | ✗ | ✗ | ✓ | ✓ (locked) |
| `bulk-assign` | ✗ | ✗ | ✓ | ✓ | ✓ (locked) |

**Group: Admin**

| Feature | guest | employee | supervisor | manager | admin |
|---|---|---|---|---|---|
| `manage-users` | ✗ | ✗ | ✗ | ✗ | ✓ (locked) |
| `reset-passwords` | ✗ | ✗ | ✗ | ✗ | ✓ (locked) |
| `edit-permissions` | ✗ | ✗ | ✗ | ✗ | ✓ (locked) |
| `export-reports` | ✗ | ✗ | ✓ | ✓ | ✓ (locked) |
| `export-archive` | ✗ | ✗ | ✗ | ✓ | ✓ (locked) |

---

## 20. File System Layout

### Complete Directory Tree

```
{WorkspaceRoot}/
│
├── .system/
│   ├── users.permissions.json          ← User accounts + permission matrices
│   ├── certscan.registry.txt           ← Cumulative CertScan ID registry
│   ├── config.json                     ← Population config (templates, rules, mappings)
│   ├── backup.history.json             ← Backup index
│   ├── auto-backup.state.json          ← Last auto-backup timestamp
│   ├── auto-backup.settings.json       ← Auto-backup frequency settings
│   └── backups/
│       ├── {manual-timestamp}/
│       │   ├── .system/                ← Snapshot of .system at backup time
│       │   └── {YYYY-MM}/              ← Snapshot of each month at backup time
│       ├── auto-{timestamp}/
│       └── pre-restore-{timestamp}/
│
├── {YYYY-MM}/                          ← Repeat for each processed month
│   ├── population/
│   │   ├── population.final.json       ← PreparedPopulationRow[] (processed)
│   │   └── population.raw.json         ← Raw XLSX rows (risk + bi)
│   ├── sample/
│   │   └── sample.master.json          ← SampleMasterData (seed + rows + allocations)
│   ├── distribution/
│   │   ├── distribution.log.json       ← DistributionLog (events, append-only)
│   │   └── distribution.current.json   ← DistributionCurrentData (derived snapshot)
│   └── answers/
│       ├── {employee-username}.json    ← EmployeeAnswerFile (answers + requests)
│       └── ...
│
└── (XLSX exports — downloaded to user's Downloads folder, not in workspace)
```

---

## 21. Data Type Reference

### Core Types

```typescript
// ── Auth ──────────────────────────────────────────────────────────────────
type AuthRole = "admin" | "guest" | "employee" | "supervisor" | "manager";
type PermissionLevel = "none" | "view" | "edit";

type AuthSession = {
  role: AuthRole;
  username: string;
  loginAt: string;        // ISO 8601
};

type RolePermission = {
  role: AuthRole;
  tabId: string;
  access: PermissionLevel;
};

type FeaturePermission = {
  role: AuthRole;
  featureId: string;
  enabled: boolean;
};

// ── Population ────────────────────────────────────────────────────────────
type CertScanStatus = "Certscan" | "NonCertscan";
type BiEnrichmentStatus = "BI Not Provided" | "BI Matched" | "BI Not Matched";
type XrayResult = "سليمة" | "اشتباه";

type PreparedPopulationRow = {
  stage: string | null;
  xrayImageId: string;
  xrayEntryDate: string | null;
  portCode: string | null;
  portType: string | null;
  portName: string | null;
  declarationNumber: string | null;
  declarationDate: string | null;
  plateOrContainerNumber: string | null;
  chassisNumber: string | null;
  xrayLevelOneResult: XrayResult;
  xrayLevelTwoResult: XrayResult;
  movementType: string | null;
  reportNumber: string | null;
  targetedByRiskEngine: string | null;
  riskMessage: string | null;
  certScanStatus: CertScanStatus;
  certScanSnippet: string | null;
  originalCertScanSnippet: string | null;
  biEnrichmentStatus: BiEnrichmentStatus;
  biMatched: boolean;
  biFilledFields: string[];
  sourceSheetName: string;
  sourceRowNumber: number;
};

// ── Sample ────────────────────────────────────────────────────────────────
type StageKey = "first" | "second" | "third" | "fourth";

type StageSamplingRule = {
  stageKey: StageKey;
  method: "percentage" | "exact";
  value: number;
  certScanPercentage: number;
  certScanMethod: "percentage" | "exact";
  certScanStrategy: "mandatory" | "preferred";
};

type PortAllocation = {
  portName: string;
  populationSize: number;
  certScanCount: number;
  nonCertScanCount: number;
  allocatedQuota: number;
  certScanQuota: number;
  nonCertScanQuota: number;
  actualCertScanDrawn: number;
  actualNonCertScanDrawn: number;
  actualTotalDrawn: number;
};

type SampleMasterData = {
  rngSeed: string;
  totalRequested: number;
  totalActual: number;
  certScanRequested: number;
  nonCertScanRequested: number;
  certScanActual: number;
  nonCertScanActual: number;
  portAllocations: PortAllocation[];
  stageAllocations: StageAllocation[];
  drawnAt: string;
  drawnBy: string;
  revision?: number;
  _writeToken?: string;
  rows: PreparedPopulationRow[];
};

// ── Distribution ──────────────────────────────────────────────────────────
type DistributionEventType =
  | "assigned"
  | "reassigned"
  | "completed"
  | "replacement-requested"
  | "replaced";

type DistributionStatus =
  | "pending"
  | "completed"
  | "replacement-requested"
  | "replaced";

type DistributionEvent = {
  eventId: string;
  eventType: DistributionEventType;
  xrayImageId: string;
  assignedTo: string;
  replacedById?: string;
  reassignedTo?: string;
  eventAt: string;
  eventBy: string;
  notes?: string;
  dailyQuota?: number;
  daysRemainingAtAssignment?: number;
};

type DistributionEntry = {
  xrayImageId: string;
  assignedTo: string;
  status: DistributionStatus;
  replacedById: string | null;
  lastEventAt: string;
  row: PreparedPopulationRow;
};

// ── Answers ───────────────────────────────────────────────────────────────
type ItemAnswerStatus = "draft" | "submitted";

type FieldAnswer = {
  fieldId: string;
  value: string | number | boolean | null;
};

type ItemAnswer = {
  xrayImageId: string;
  templateId: string;
  templateVersion: number;
  answers: FieldAnswer[];
  lastSavedAt: string;
  submittedAt: string | null;
  answeredBy: string;
  status: ItemAnswerStatus;
};

type EmployeeAnswerFile = {
  username: string;
  monthFolderName: string;
  items: ItemAnswer[];
  referralRequests?: ReferralRequest[];
  replacementRequests?: ReplacementRequest[];
  lastUpdatedAt?: string;
};

// ── Requests ──────────────────────────────────────────────────────────────
type RequestStatus = "pending" | "approved" | "denied";

type ReferralRequest = {
  requestId: string;
  monthFolderName: string;
  fromEmployee: string;
  toEmployee: string;
  xrayImageIds: string[];
  reason: string;
  requestedAt: string;
  requestedBy: string;
  status: RequestStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
};

type ReplacementRequest = {
  requestId: string;
  monthFolderName: string;
  employeeUsername: string;
  originalXrayImageId: string;
  replacementXrayImageId: string;
  reason: string;
  requestedAt: string;
  requestedBy: string;
  status: RequestStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
};
```

---

## 22. Cross-Module Event Map

### Custom DOM Events (window-level)

| Event Name | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `app-navigate` | `{ tabId: string }` | Any module | App.tsx (tab switcher) |
| `pop-subtab-changed` | `{ subtabId: string }` | Population Sidebar | Population header |
| `pop-set-subtab` | `{ subtabId: string }` | Sidebar tab buttons | Population container |
| `data:recovered-from-bak` | `{ fileName: string }` | safeWrite utility | App.tsx (banner) |

### localStorage Keys

| Key | Owner | Description |
|---|---|---|
| `xray_user_management_v1` | userManagement.ts | Permissions matrix state |
| `xray-labels-v1` | labelsStore.ts | Label customizations |
| `xray-workspace-handle` | workspace/useWorkspace | File System Access handle |

### sessionStorage Keys

| Key | Owner | Description |
|---|---|---|
| `xray_local_login_session_v1` | authSession.ts | Active login session |

### Subscription Patterns

| Pattern | Publisher | Subscribers |
|---|---|---|
| `subscribeToUserManagementChanges(fn)` | userManagement.ts | App.tsx (permissions state) |
| `subscribe(fn)` in labelsStore | labelsStore.ts | All components using `useLabels()` |

---

*End of Product Specification Document — v1.0*
