# Global Month Selector — Design Spec [DONE — merged to main]

- **Date:** 2026-07-16
- **Status:** ✅ DONE — approved, implemented (10 tasks + final-review fixes), whole-branch reviewed ("Ready to merge: Yes"), and merged to `origin/main` @ `69a86b2e` (2026-07-16, worked directly on main per this session's convention — no separate PR). Implementation plan: `docs/superpowers/plans/2026-07-16-global-month-selector.md`. One narrower non-blocking follow-up was identified post-merge (an overlapping-load race in Population's `handleLoadExistingMonth` under a rapid double month-switch) — tracked in `.superpowers/sdd/progress.md`, not yet fixed.
- **Scope:** Replace every per-tab month-selection control with a single global month selector in the app's top toolbar that drives the entire app.

## Goal

Today six different screens each carry their own month dropdown (or silently auto-pick the
latest month), and the Population tab has two more month controls of its own. The user selects
the month once per screen, and screens can disagree with each other. After this change there is
exactly **one** month selection, made in the sticky top toolbar, and every tab follows it.

## User-approved decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Does the global selector drive the Population tab too? | **Yes — everything including Population.** The header gets a "شهر جديد +" action so Excel import can target a month folder that does not exist yet. |
| 2 | What happens when the global month changes while Population holds unsaved in-session work (uploaded/parsed Excel not yet processed+auto-saved)? | **Confirm before discarding.** Dialog: switching loads the selected month's saved data and discards unsaved uploads; Cancel reverts the selector. |
| 3 | Population **browse** sub-tab currently defaults to "all months combined" with a narrowing dropdown. | **Follows the global month, plus a local "كل الأشهر" scope toggle** to widen to all months. No month list outside the header. |

## Architecture

### New module: `src/data/month/`

`GlobalMonthProvider` + `useGlobalMonth()` hook, mirroring the existing
`WorkspaceProvider` / `useWorkspace` pattern.

- **Mount point:** between `WorkspacePicker` and `AuthGate` in `App.tsx`, so both the top
  toolbar (rendered inside `AuthGate`) and all tabs can consume it. The provider itself
  consumes `useWorkspace()` for the directory handle.
- **State shape:**
  ```ts
  type GlobalMonthSelection =
    | { kind: "existing"; folderName: string; month: number; year: number }
    | { kind: "pending";  folderName: string; month: number; year: number } // no folder on disk yet
    | { kind: "none" };   // no workspace / no months and nothing pending

  type GlobalMonthContextValue = {
    months: MonthFolderInfo[];          // from listMonthFolders
    selection: GlobalMonthSelection;
    setSelectedMonth: (folderName: string) => void;  // existing folder
    startNewMonth: (month: number, year: number) => void; // creates a pending selection
    refreshMonths: () => Promise<void>; // re-list folders; promote pending→existing when saved
    isSelectedMonthClosed: boolean;     // month-lock state for the selection
  };
  ```
- **Defaults:** latest existing month folder. If the workspace has no months at all →
  `pending` current calendar month (matches Population's current initial state).
- **Persistence:** last selection stored in `sessionStorage` (`xray_global_month_v1`),
  restored on load when the folder still exists; otherwise fall back to latest.
- **Fallback rule:** if the months list refreshes and the selected folder no longer exists,
  select the latest existing month.
- **Refresh triggers:** workspace handle change; explicit `refreshMonths()` calls after
  `saveMonthRun` succeeds (Population), after demo seeding, and after Archive close/reopen
  (to refresh the lock badge).
- **Veto hook for unsaved work (decision #2):** the provider exposes a guard-registration API
  (`registerMonthChangeGuard(fn)`) — Population registers a guard that returns whether
  unsaved in-session work exists; when it does, the provider shows the confirmation dialog
  before committing the change, and reverts on cancel.

### Header UI (top toolbar)

Rendered inside the existing sticky toolbar (`src/auth/AdminToolbar.tsx`) for every
logged-in session, RTL, Arabic labels via label keys:

- **"الشهر" selector** — options are existing month folders formatted with
  `formatMonthFolderShortLabel`; a pending month appears in the list (marked "جديد") until
  its folder is created by the first save.
- **"شهر جديد +" action** — opens a small month/year picker (this also fixes the currently
  missing year control; today the save year is silently the current year). Gated by the same
  permission that allows population processing.
- **Lock badge** — small "مُقفل" indicator when `isSelectedMonthClosed` is true.
- Disabled/empty presentation while the workspace is not ready.

## Full inventory of month-selection points and their disposition

### Replaced by the global selector

| Location | Today | After |
|----------|-------|-------|
| `Tabs/Reports/index.tsx` month bar (~line 845) | Local `<select>`, defaults latest; drives reports, KPI dashboard, Power BI export | Select removed; bar keeps its info chips fed by global month |
| `Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (~255) | Local select, defaults latest | Consumes hook |
| `Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` (~353, ~382) | Two local selects (active + audit views) | Both removed; consumes hook |
| `Tabs/EmployeeWorkspace/views/ReferralApproval/` (`useApprovalData.ts` + `index.tsx` ~113) | Local select for pending approvals | Consumes hook (approval actions already use each request's own `monthFolderName` — unchanged) |
| `Tabs/ReportDesigner/renderers/KpiRenderer.tsx` (~85) | Silently auto-picks latest month | Uses global month |
| `Tabs/Population/index.tsx` Phase-1 "فتح شهر سابق" cards (~1597) | Loads an existing month, replaces in-memory state | Removed; selecting a month in the header auto-loads it (existing `handleLoadExistingMonth` logic) and jumps to the right phase |
| `Tabs/Population/components/PhaseTwoReportAndProcessing.tsx` "شهر الحفظ" grid (~86) | 12-month button grid retargeting the auto-save | Removed; save target is always the global month, shown read-only in the save panel and status bar |
| `Tabs/Population/index.tsx` browse view month filter (~2427) | Local select defaulting to "الكل" (all months) | Follows global month + local "كل الأشهر" scope toggle (decision #3) |
| `pop-load-month` custom event (BrowseDataView → Population) | Loads a month into the process sub-tab | Now sets the global month (the auto-load behavior above takes over) |

### Population processing flow — detailed behavior

- `saveMonth` / `saveYear` state is replaced by the global selection. Everything downstream
  re-derives from it unchanged: month-lock check, B4 prior-month switching advisory, B3 orphan
  scan, sample draw/save, Phase-4 distribution, report exports, status-bar chip.
- **Selecting an existing month** in the header → Population auto-loads that month from disk
  and jumps to Phase 3/4 as `handleLoadExistingMonth` does today.
- **Selecting "شهر جديد"** → Population resets to a clean Phase-1 flow targeting the pending
  month.
- **Unsaved-work conflict** → confirm-before-discard dialog (decision #2).
- **Existing guards unchanged:** overwrite-confirm when the target month already has a drawn
  sample (incl. the TOCTOU re-check in `saveMonthRun`), closed-month write block
  (`MonthClosedError`), four-eyes sample approval.
- After a successful save, Population calls `refreshMonths()`; a pending selection is promoted
  to an existing one (same folder name).

### Deliberately unchanged (cross-month by design)

- **Archive tab** — lists all months (close/reopen, backups).
- **ReferralApproval `HistoryView`** — aggregates request history across all months.
- **App.tsx auto-backup** and **backup storage** — enumerate all months.
- **WorkspaceGate first-run checklist** — only counts months to auto-hide itself.
- **Data layer** (`src/data/**`) — all functions keep taking `monthFolderName` parameters;
  no storage-layer changes.
- **`DataTable/utils.ts` "month" date-format mode** — unrelated to month selection.
- **`demoWorkspace.ts`** — seeds a fixed demo month; the global selector picks it up as latest.

### Touched incidentally during implementation

- Export filenames embedding the selected month: `XrayReferrals.tsx` (~903),
  `XrayInspectionResults.tsx` (~350, ~379), browse-view XLSX export (~2404), Reports exports —
  all read the global month (browse export says "كل الأشهر" when the scope toggle is on).
- Empty-state / hint texts referencing month selection, e.g. Reports Power BI panel
  "اختر شهراً أعلاه" (~1012) becomes obsolete since a month is always selected.
- New label keys in `labelsStore.ts` for the header selector, new-month picker, and the
  confirm dialog (no hard-coded Arabic).
- Tests referencing removed selectors, notably `Population.wizard.test.tsx`.

## Edge cases

- **No workspace / unsupported browser:** selector renders disabled; tabs behave as today.
- **Pending month with no data:** non-Population tabs show their normal empty states.
- **Closed month:** lock badge in header; Population stays view-only; writes remain blocked
  by the storage layer.
- **Role change / admin role-preview remount:** provider lives above `AuthGate`, so the
  selection survives the `AppContent` remount on role preview.
- **Concurrent folder deletion (external):** `refreshMonths` fallback selects latest existing.

## Testing

- Unit tests for `GlobalMonthProvider`: default-to-latest, sessionStorage restore/invalid
  fallback, pending-month lifecycle (create → promote on save), disappeared-folder fallback,
  change-guard veto flow. Use `createMemoryDirectory()`.
- Update affected component tests (Population wizard, approval data hook).
- `npm run test:run`, `npm run lint`, `npm run build` must pass.

## Documentation

- `docs/EDIT_LOG.md`: major version bump entry with before/after per file (per CLAUDE.md).
- `docs/architecture/data-system-report.md`: note the sessionStorage key and the provider
  (no disk-layout changes).
