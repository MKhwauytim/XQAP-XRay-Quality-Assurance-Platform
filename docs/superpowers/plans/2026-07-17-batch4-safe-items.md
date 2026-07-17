# Batch 4 Safe Items Implementation Plan [DONE — merged to main]

> **STATUS: ✅ DONE.** All 4 tasks implemented and reviewed. The final whole-branch review caught a genuine Important finding: `user-management/actions` had been deliberately left out of `MANAGED_TABS`/`createDefaultPermissions()` per a plan rationale that turned out to be factually wrong (registering a tab and granting new access are different operations — admin's permission bypass plus the existing role-ceiling lock make registration behaviorally inert). Fixed and re-verified twice. Merged to main via [PR #23](https://github.com/MKhwauytim/XQAP-XRay-Quality-Assurance-Platform/pull/23) on 2026-07-17. Full task-by-task evidence trail: `.superpowers/sdd/progress.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the three Batch 4 items an independent triage found safe, bounded, and testable without requiring a product/policy decision: a date-parsing bug fix, a mechanical component extraction, and a minimal read-only audit-log viewer.

**Architecture:** Three independent tasks touching unrelated files — no shared state, no ordering dependency between them. Task 1 (date parsing) adds one gated fallback branch to a pure function. Task 2 (component extraction) is a verbatim code move with zero logic change. Task 3 (audit viewer) is new but structurally mirrors an existing, already-shipped sibling feature almost exactly.

**Tech Stack:** React 19 + TypeScript (existing conventions), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-batch4-safe-items-design.md` — read for full rationale per item.
- Triage evidence: `.superpowers/sdd/batch4-triage.md` (gitignored scratch, but present in this working tree) — the precise current-state findings each task is built on.
- No new npm dependencies.
- UI text Arabic, RTL; any new user-facing text goes through `labelsStore.ts`/`useLabels()`, never hardcoded.
- TypeScript strict mode; `import type` for type-only imports.
- EDIT_LOG (CLAUDE.md): every task records its files under a new `## v56 — 2026-07-17 — Batch 4 safe items` entry (or the next available whole-number bump — this spans a bug fix, a mechanical refactor, and a small new feature, so check `docs/EDIT_LOG.md`'s current top entry and use your judgment on whole-vs-decimal per the semver-lite rule; a new admin-facing viewer leans toward a whole-number bump) in `docs/EDIT_LOG.md`, added BEFORE the code changes, with Before/After per file.
- Verification gate for every task: `npx vitest run <task tests>`; final task also runs `npm run test:run`, `npx tsc -b`, `npm run lint`, `npm run build`.

---

### Task 1: Date-parsing month>12 rescue (C-16 partial)

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts` (the `normalizeDate` function, currently lines 215-268, numeric branch at 232-242 — re-check current line numbers before editing, they may have shifted slightly since this plan was written)
- Test: `src/components/Sidebar/Tabs/Population/processing/populationProcessor.test.ts` (existing file — add a new `describe` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change to `normalizeDate(value: string | null): string | null` — behavior-only addition.

- [x] **Step 1: EDIT_LOG entry**

Check the current top entry in `docs/EDIT_LOG.md` first, then insert at the top:

```markdown
## v56 — 2026-07-17 — Batch 4 safe items: date-parsing rescue, XrayReferrals extraction, audit-log viewer

Three items from an independent Batch-4 triage (`.superpowers/sdd/batch4-triage.md`) found
safe to execute without a product/policy decision. Spec:
docs/superpowers/specs/2026-07-17-batch4-safe-items-design.md.

**File:** `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts`

**Before:**
\`\`\`ts
  const numMatch = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (numMatch) {
    const [, d, m, y0] = numMatch;
    let y = y0;
    if (y.length === 2) y = parseInt(y, 10) >= 50 ? `19${y}` : `20${y}`;
    const day = parseInt(d, 10), month = parseInt(m, 10), year = parseInt(y, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }
\`\`\`

**After:** adds a month-first fallback gated strictly behind the existing day-first check — only
fires when day-first is syntactically impossible (second component 13-31) and month-first is valid
(first component 1-12). The genuinely ambiguous both-valid case (e.g. "03/04/2026") is completely
untouched — see file.
```

- [x] **Step 2: Write the failing test**

First re-read the current `normalizeDate` function in the real file to confirm the exact current code (line numbers/whitespace may have drifted). Then add to `populationProcessor.test.ts`:

```ts
import { normalizeDate } from "./populationProcessor";

describe("normalizeDate", () => {
  it("keeps day-first parsing for values where both readings would be valid (the documented ambiguous policy — do not change)", () => {
    // 3 April 2026 under the existing day-first assumption. This is the
    // genuinely ambiguous case (a US-locale author might have meant 4 March);
    // the policy decision stays out of scope — this test is a regression
    // guard that the fix below does NOT alter this behavior.
    expect(normalizeDate("03/04/2026")).toBe("2026-04-03");
  });

  it("keeps unambiguous day-first values unchanged", () => {
    expect(normalizeDate("25/12/2025")).toBe("2025-12-25");
  });

  it("rescues values where day-first is syntactically impossible but month-first is valid", () => {
    // "12/25/2025" — day-first would need month=25, which is invalid; the
    // only valid reading is month-first: December 25, 2025.
    expect(normalizeDate("12/25/2025")).toBe("2025-12-25");
  });

  it("rescues another month>12 case", () => {
    // "06/15/2025" — day-first needs month=15 (invalid); month-first: June 15, 2025.
    expect(normalizeDate("06/15/2025")).toBe("2025-06-15");
  });

  it("rescues a case where the day-first day slot would also be invalid on its own reading", () => {
    // "01/31/2025" — day-first needs month=31 (invalid); month-first: January 31, 2025.
    expect(normalizeDate("01/31/2025")).toBe("2025-01-31");
  });

  it("still returns raw when NEITHER reading is valid", () => {
    // Both components exceed 12: "13/25/2025" — day-first month=25 invalid,
    // month-first day=25... wait, month-first would read this as month=13
    // (invalid) day=25. Neither reading works, so it must stay un-normalized.
    expect(normalizeDate("13/25/2025")).toBe("13/25/2025");
  });

  it("returns null for empty/null input, unchanged", () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/processing/populationProcessor.test.ts`
Expected: the day-first/unambiguous/raw-fallback cases PASS already (existing behavior); the two "rescues" cases (`"12/25/2025"`, `"06/15/2025"`, `"01/31/2025"`) FAIL, currently returning the raw input string instead of an ISO date.

- [x] **Step 4: Apply the fix**

In `normalizeDate`, immediately after the existing day-first `if` block (inside the same `if (numMatch) { ... }` block, after its closing `}` but still within the outer `if (numMatch)`), add:

```ts
    // Day-first is syntactically impossible (the "month" slot is 13-31, which
    // can never be a real month) but the month-first reading IS valid — the
    // only unambiguous interpretation left. This never touches the genuinely
    // ambiguous both-valid case (e.g. "03/04/2026"), which stays gated behind
    // the day-first check above and is completely unaffected.
    if (day >= 1 && day <= 12 && month >= 13 && month <= 31) {
      return `${year}-${pad2(day)}-${pad2(month)}`;
    }
```

The full numeric branch should now read:

```ts
  const numMatch = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (numMatch) {
    const [, d, m, y0] = numMatch;
    let y = y0;
    if (y.length === 2) y = parseInt(y, 10) >= 50 ? `19${y}` : `20${y}`;
    const day = parseInt(d, 10), month = parseInt(m, 10), year = parseInt(y, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
    // Day-first is syntactically impossible (the "month" slot is 13-31, which
    // can never be a real month) but the month-first reading IS valid — the
    // only unambiguous interpretation left. This never touches the genuinely
    // ambiguous both-valid case (e.g. "03/04/2026"), which stays gated behind
    // the day-first check above and is completely unaffected.
    if (day >= 1 && day <= 12 && month >= 13 && month <= 31) {
      return `${year}-${pad2(day)}-${pad2(month)}`;
    }
  }
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/processing/populationProcessor.test.ts`
Expected: all cases pass, including the full existing test suite in this file (the `processPopulation` tests) unaffected.

- [x] **Step 6: Commit**

```bash
git add src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts src/components/Sidebar/Tabs/Population/processing/populationProcessor.test.ts docs/EDIT_LOG.md
git commit -m "fix(population): rescue unambiguous month>12 dates that today fall through unparsed"
```

---

### Task 2: XrayReferrals.tsx mechanical sub-component extraction (ARC-01 partial)

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx` (new file — the extracted pieces)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (remove the extracted pieces, import them back)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `subComponents.tsx` exports `QueueToolbar`, `SelectionActionBar`, `SampleDetailPanel`, `ReferralRequestModal`, `ReferralSamplePreview`, `StatusBadge`, `ReferralStatsStrip`, `ReplacementDialog`, plus the pure helpers `buildXrayColumns`, `getVisibleReferralColumns`, `pct`, `isStudyCompleted`, `getReferralPreviewValue` (exact export list to be confirmed during Step 2's verification pass — see below). `XrayReferrals.tsx`'s main component and its own local behavior are otherwise byte-for-byte unchanged; only imports change.

**This is a verbatim code MOVE, not a rewrite.** Do not retype the function bodies from memory — cut them from the real file and paste them into the new file, exactly as they are, using your editor tools directly on the real files. The methodology below tells you WHAT to move and HOW to verify safety; the actual code content is whatever is currently in the file (read it yourself before moving anything).

- [x] **Step 1: EDIT_LOG entry**

Append under the `## v56` heading:

```markdown
**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` and new sibling `XrayReferrals/subComponents.tsx`

**Before:** 1545-line single file containing the main `XrayReferrals` component plus 8 already
prop-driven, already-decoupled sub-components and 5 pure helper functions, all at module scope.

**After:** the 8 sub-components + 5 helpers move verbatim to a new sibling file
`XrayReferrals/subComponents.tsx`; `XrayReferrals.tsx` imports them back. No logic change —
verified by the existing test suite passing unchanged. ~500-line reduction in the main file.
```

- [x] **Step 2: Verify the extraction candidates are genuinely safe (read the real file first)**

Read the current `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` in full for the candidate ranges below (line numbers as of this plan's writing — confirm they still match, the file may have shifted):

- Pre-component pure helpers: `buildXrayColumns` (~86), `buildDefaultColConfig` (~128), `loadLocalColConfig` (~146), `getVisibleReferralColumns` (~150), `pct` (~169)
- Post-component sub-components/helpers: `QueueToolbar` (~1044), `SelectionActionBar` (~1101), `SampleDetailPanel` (~1141), `ReferralRequestModal` (~1181), `ReferralSamplePreview` (~1313), `getReferralPreviewValue` (~1337), `StatusBadge` (~1361), `ReferralStatsStrip` (~1369), `isStudyCompleted` (~1417), `ReplacementDialog` (~1426 to end of file)

For EACH candidate, confirm before moving it:
1. It is a top-level `function` declaration (not defined inside the main `XrayReferrals` component body).
2. It does not reference any `useState`/`useEffect`/`useCallback`/`useMemo`/`useRef` value that belongs to the main `XrayReferrals` component — i.e., every variable it uses is either (a) one of its own parameters, (b) an import, (c) another module-scope declaration (including other candidates you're also moving), or (d) a React hook it calls ITSELF (a sub-component calling its own `useState` is fine — that's local to the sub-component, not a closure over the parent).
3. `buildDefaultColConfig` and `loadLocalColConfig` were NOT explicitly named in the triage's helper list (only `buildXrayColumns`, `getVisibleReferralColumns`, `pct`, `isStudyCompleted`, `getReferralPreviewValue` were) — verify these two independently before including them; if either turns out to reference something from the main component's closure, leave it in `index.tsx` and note the discrepancy in your report rather than forcing it.

If ANY candidate fails check 2, stop including it in the move and note it in your report — do not force an unsafe extraction to hit a line-count target.

- [x] **Step 3: Create the sibling file and move the verified-safe candidates**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx`. Note the new file lives in a `XrayReferrals/` subdirectory sibling to the original `XrayReferrals.tsx` — this means:
- All relative import paths inside the moved code need ONE additional `../` prepended (since the new file is one directory level deeper than the original).
- `XrayReferrals.tsx` itself does NOT move — it stays at its current path so nothing importing `XrayReferrals` (e.g. `tabRegistry.ts`'s glob, or wherever this view is rendered from) needs to change. Only the extracted pieces move into the new subdirectory.

Move each verified-safe function (Step 2) into the new file, preserving its exact body. Add `export` to each (they were file-private before; the main file now needs to import them). Add whatever type imports (`DistributionEntry`, `ItemAnswer`, `Labels`, `DataTableCol`, etc.) each moved piece needs — copy the exact import lines from the original file's top-of-file imports (adjusting relative paths per the note above), including only what the moved code actually uses (don't blanket-copy the entire original import list if a given piece doesn't need it — but it's fine to share one clean import block across the whole new file for whatever the union of all moved pieces needs).

- [x] **Step 4: Update `XrayReferrals.tsx` to import the moved pieces**

Remove the moved function bodies from `XrayReferrals.tsx`. Add an import at the top pulling in whatever moved names the main component still references:

```tsx
import {
  QueueToolbar,
  SelectionActionBar,
  SampleDetailPanel,
  ReferralRequestModal,
  ReferralSamplePreview,
  StatusBadge,
  ReferralStatsStrip,
  ReplacementDialog,
  buildXrayColumns,
  getVisibleReferralColumns,
  pct,
  isStudyCompleted,
  getReferralPreviewValue,
} from "./XrayReferrals/subComponents";
```

(Adjust this list to match whatever Step 2/3 actually verified and moved — if `buildDefaultColConfig`/`loadLocalColConfig` were included, add them too; if they were excluded, don't.)

- [x] **Step 5: Verify with the real gates — this is the actual proof of correctness for a move**

Run: `npx tsc -b`
Expected: clean. Any prop-shape mismatch, missing export, or wrong import path shows up here immediately.

Run: `npx vitest run` (search for every test file that imports from or exercises `XrayReferrals` — likely `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/unifiedList.test.tsx` and any `XrayReferrals`-specific test file; check `Glob "**/*XrayReferrals*.test.*"` and `Glob "**/*unifiedList*.test.*"` first to find them all)
Expected: identical pass/fail results to before the move — this is the real behavioral-equivalence proof, not just "it compiles."

Run: `npx eslint src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx`
Expected: clean.

- [x] **Step 6: Commit**

```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx docs/EDIT_LOG.md
git commit -m "refactor(ew): extract already-decoupled XrayReferrals sub-components to a sibling file"
```

---

### Task 3: Minimal read-only governance audit-log viewer (C-15)

**Files:**
- Modify: `src/components/Sidebar/Tabs/UserManagement/index.tsx`
- Modify: `src/data/labels/labelsStore.ts` (new label keys for the 16 `action` display labels + section title)

**Interfaces:**
- Consumes: `readWorkspaceActions(directoryHandle: DirectoryHandleLike): Promise<WorkspaceActionEntry[]>` and `type WorkspaceActionEntry = { id: string; at: string; actor: string; actorRole: string; action: WorkspaceActionType; monthFolderName?: string | null; target?: string | null; details?: Record<string, string | number | boolean | null> }` — both already exported from `src/data/audit/actionLog.ts`, no changes needed there. `WorkspaceActionType` is a 16-value string union (already defined in that file) — read it directly rather than assuming this plan's copy is still accurate.
- Produces: no new exports — this is a new sub-tab entirely internal to `UserManagementTab`.

**Decision already made (per spec):** admin-only (the existing UserManagementTab's access level — no permission-matrix changes needed since sub-tabs inside an already-admin-only top-level tab don't need separate `MANAGED_TABS`/`createDefaultPermissions` entries).

- [x] **Step 1: EDIT_LOG entry**

Append under `## v56`:

```markdown
**File:** `src/components/Sidebar/Tabs/UserManagement/index.tsx`

**Before:** UserManagement has `users`/`page-permissions`/`feature-permissions`/`activity` sub-tabs;
the governance action log (`5-system/audit/actions.log.json`, written via `appendWorkspaceAction`
from 4 call sites) has a reader (`readWorkspaceActions`) but nothing renders it.

**After:** adds a new `actions` sub-tab, `renderActions()`, mirroring the existing `activity`
sub-tab's structure exactly (lazy-loaded on tab activation, plain table, refresh button). Admin-only,
matching the tab's existing access level — see file.

**File:** `src/data/labels/labelsStore.ts`

**Before:** no labels for the 16 `WorkspaceActionType` values or the new sub-tab.

**After:** adds `um_actions_tab_label` and 16 `um_action_type_*` keys — see file.
```

- [x] **Step 2: Add label keys**

In `src/data/labels/labelsStore.ts`, read the file's current structure near other `um_*` keys (Settings/UserManagement section) and add, in the same style:

```ts
  // UserManagement — governance actions log viewer
  um_actions_tab_label:        "سجل الإجراءات",
  um_actions_desc:             "سجل الإجراءات الإدارية المحفوظ داخل مساحة العمل في",
  um_actions_refresh_btn:      "تحديث السجل",
  um_actions_loading:          "جاري تحميل السجل...",
  um_actions_empty:            "لا توجد إجراءات مسجلة بعد.",
  um_actions_col_time:         "الوقت",
  um_actions_col_actor:        "المستخدم",
  um_actions_col_role:         "الدور",
  um_actions_col_action:       "الإجراء",
  um_actions_col_target:       "الهدف",
  um_actions_col_month:        "الشهر",
  um_actions_col_details:      "تفاصيل",
  // Display labels for WorkspaceActionType (src/data/audit/actionLog.ts) — read that file's
  // current union before finalizing this list, it may have grown since this plan was written.
  um_action_type_user_deleted:                 "حذف مستخدم",
  um_action_type_user_created:                 "إنشاء مستخدم",
  um_action_type_permission_changed:            "تغيير صلاحية صفحة",
  um_action_type_feature_permission_changed:    "تغيير صلاحية ميزة",
  um_action_type_sample_drawn:                  "سحب عينة",
  um_action_type_distribution_bulk_assigned:    "توزيع جماعي",
  um_action_type_referral_approved:             "اعتماد إحالة",
  um_action_type_referral_denied:               "رفض إحالة",
  um_action_type_replacement_approved:          "اعتماد استبدال",
  um_action_type_replacement_denied:            "رفض استبدال",
  um_action_type_reopen_approved:               "اعتماد إعادة فتح",
  um_action_type_reopen_denied:                 "رفض إعادة فتح",
  um_action_type_answer_reopened:               "إعادة فتح إجابة",
  um_action_type_month_closed:                  "إقفال شهر",
  um_action_type_month_reopened:                "إعادة فتح شهر",
  um_action_type_backup_restored:               "استرجاع نسخة احتياطية",
```

Also register these in `src/components/Sidebar/Tabs/Settings/index.tsx`'s label-editor list, matching the pattern for the other `um_*`/label entries in that file (find the existing registration block and add these alongside it, one `{ key: "...", desc: "..." }` per new key).

- [x] **Step 3: Wire the new sub-tab**

In `src/components/Sidebar/Tabs/UserManagement/index.tsx`:

Add `"actions"` to the `subTabs` array in the module's `tabConfig` (near line 60-65):
```tsx
  subTabs: [
    { id: "users", label: "المستخدمون" },
    { id: "page-permissions", label: "صلاحيات الصفحات" },
    { id: "feature-permissions", label: "صلاحيات الميزات" },
    { id: "activity", label: "متابعة الأنشطة" },
    { id: "actions", label: "سجل الإجراءات" },
  ],
```

Add `"actions"` to the `PageSection` type (near line 70) and `KNOWN_USER_MANAGEMENT_SECTIONS` (near line 73-78):
```ts
type PageSection = "users" | "page-permissions" | "feature-permissions" | "activity" | "actions";

const KNOWN_USER_MANAGEMENT_SECTIONS = new Set<PageSection>([
  "users",
  "page-permissions",
  "feature-permissions",
  "activity",
  "actions",
]);
```

Add the import for `readWorkspaceActions` and its type near the existing `readAuthActivityLog` import (near line 17-21):
```tsx
import {
  readWorkspaceActions,
  type WorkspaceActionEntry,
  type WorkspaceActionType,
} from "../../../../data/audit/actionLog";
```

- [x] **Step 4: Add the loading state and effect**

Near the existing `activityEntries`/`isActivityLoading` state (line ~141-142), add:

```tsx
  const [actionEntries, setActionEntries] = useState<WorkspaceActionEntry[]>([]);
  const [isActionsLoading, setIsActionsLoading] = useState(false);
```

Near the existing activity-loading effect (line ~185-195), add a sibling effect (this component already has `directoryHandle` via `useWorkspace()` — confirm the exact destructuring name in the current file before writing this, it's used elsewhere in the same file):

```tsx
  useEffect(() => {
    if (section !== "actions" || !directoryHandle) return;
    let cancelled = false;
    setIsActionsLoading(true);
    void readWorkspaceActions(directoryHandle)
      .then((entries) => {
        if (!cancelled) setActionEntries(entries);
      })
      .catch(logRejection("userManagement:readWorkspaceActions"))
      .finally(() => {
        if (!cancelled) setIsActionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [section, directoryHandle]);
```

- [x] **Step 5: Add the display-label map and `renderActions()`**

Near the top of the file (module scope, alongside other constant maps like `PERMISSION_LABELS`), add:

```ts
const ACTION_TYPE_LABEL_KEYS: Record<WorkspaceActionType, keyof typeof import("../../../../data/labels/labelsStore").DEFAULT_LABELS> = {
  "user-deleted": "um_action_type_user_deleted",
  "user-created": "um_action_type_user_created",
  "permission-changed": "um_action_type_permission_changed",
  "feature-permission-changed": "um_action_type_feature_permission_changed",
  "sample-drawn": "um_action_type_sample_drawn",
  "distribution-bulk-assigned": "um_action_type_distribution_bulk_assigned",
  "referral-approved": "um_action_type_referral_approved",
  "referral-denied": "um_action_type_referral_denied",
  "replacement-approved": "um_action_type_replacement_approved",
  "replacement-denied": "um_action_type_replacement_denied",
  "reopen-approved": "um_action_type_reopen_approved",
  "reopen-denied": "um_action_type_reopen_denied",
  "answer-reopened": "um_action_type_answer_reopened",
  "month-closed": "um_action_type_month_closed",
  "month-reopened": "um_action_type_month_reopened",
  "backup-restored": "um_action_type_backup_restored",
};
```

**Verify this against the REAL current `WorkspaceActionType` union in `src/data/audit/actionLog.ts` before finalizing** — if the union has grown since this plan was written, add the missing keys (both here and in Step 2's label list); if a mapping is missing at compile time, TypeScript's exhaustiveness on a `Record<WorkspaceActionType, ...>` will catch it as a type error, which is the intended safety net — do not silently work around that error, add the real missing entries instead.

Add `renderActions()` near the existing `renderActivity()` function, mirroring its exact structure (plain table, refresh button, loading/empty states) but sourced from `actionEntries`/`isActionsLoading` and the `WorkspaceActionEntry` shape:

```tsx
  function renderActions() {
    const sortedEntries = actionEntries
      .slice()
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 200);

    return (
      <div className="um-section">
        <div className="um-matrix-desc">
          {L.um_actions_desc}
          <strong> 5-system/audit/actions.log.json</strong>
        </div>

        <div className="um-activity-toolbar">
          <button
            type="button"
            className="um-add-btn"
            onClick={() => {
              if (!directoryHandle) return;
              setIsActionsLoading(true);
              void readWorkspaceActions(directoryHandle)
                .then(setActionEntries)
                .catch(logRejection("userManagement:refreshWorkspaceActions"))
                .finally(() => setIsActionsLoading(false));
            }}
          >
            {L.um_actions_refresh_btn}
          </button>
          <span>
            {isActionsLoading
              ? L.um_actions_loading
              : `${actionEntries.length.toLocaleString("ar-SA-u-nu-latn")} سجل`}
          </span>
        </div>

        {sortedEntries.length === 0 ? (
          <div className="um-empty">{L.um_actions_empty}</div>
        ) : (
          <div className="um-activity-table-wrap">
            <table className="um-activity-table">
              <thead>
                <tr>
                  <th>{L.um_actions_col_time}</th>
                  <th>{L.um_actions_col_actor}</th>
                  <th>{L.um_actions_col_role}</th>
                  <th>{L.um_actions_col_action}</th>
                  <th>{L.um_actions_col_target}</th>
                  <th>{L.um_actions_col_month}</th>
                  <th>{L.um_actions_col_details}</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.at)}</td>
                    <td>{entry.actor}</td>
                    <td>{entry.actorRole}</td>
                    <td>{L[ACTION_TYPE_LABEL_KEYS[entry.action]] ?? entry.action}</td>
                    <td>{entry.target ?? "—"}</td>
                    <td>{entry.monthFolderName ?? "—"}</td>
                    <td>{entry.details ? JSON.stringify(entry.details) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }
```

Check that `formatDateTime` is already available in this file's scope (it's used by `renderActivity()`) — if it's a local helper, reuse it; if imported, no change needed. Check that `L` (the labels object) is the correct in-scope variable name for this component by looking at how `renderActivity()` or other render functions reference label values — if this component uses `useLabels()` under a different variable name, or reads labels a different way (e.g. `getLabels()` calls inline), match the file's ACTUAL convention rather than assuming `L`.

- [x] **Step 6: Wire the render**

Near the existing `{section === "activity" && renderActivity()}` line (~1221), add:

```tsx
      {section === "actions" && renderActions()}
```

- [x] **Step 7: Verify**

Run: `npx tsc -b`
Expected: clean — the `Record<WorkspaceActionType, ...>` exhaustiveness check is the main thing to watch; if it errors, the union has grown since this plan was written and you need to add the missing mapping entries (both the label keys and the map), not suppress the error.

Run: `npx eslint src/components/Sidebar/Tabs/UserManagement/index.tsx src/data/labels/labelsStore.ts`
Expected: clean.

Check for an existing UserManagement test file (`Glob "src/components/Sidebar/Tabs/UserManagement/*.test.tsx"`). If one exists and it's practical to add a focused test for `renderActions()` (rendering with a few mock `WorkspaceActionEntry` values and asserting the table shows the right count/labels), add one. If none exists and the component is large enough that forcing new test infrastructure would be disproportionate, it's acceptable to skip — document the decision explicitly in your report, matching this session's established practice.

- [x] **Step 8: Update CLAUDE.md**

In `CLAUDE.md`'s tab table (the "Current tabs" section documenting sub-tabs per top-level tab), find the `user-management` row and add `actions` to its sub-tabs list, matching the existing format for that row.

- [x] **Step 9: Commit**

```bash
git add src/components/Sidebar/Tabs/UserManagement/index.tsx src/data/labels/labelsStore.ts "src/components/Sidebar/Tabs/Settings/index.tsx" CLAUDE.md docs/EDIT_LOG.md
git commit -m "feat(user-management): minimal read-only governance audit-log viewer"
```

---

### Task 4: Full verification gate

**Files:**
- None (verification only).

- [x] **Step 1: Full test suite**

Run: `npm run test:run`
Expected: all tests pass, including the new `normalizeDate` tests and any new/unchanged tests from Tasks 2-3.

- [x] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [x] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [x] **Step 4: Build**

Run: `npm run build`
Expected: succeeds; note the reported `dist/index.html` size.

- [x] **Step 5: Commit (if any stray changes)**

```bash
git status --short
```

If clean, nothing to commit. If any files were modified during troubleshooting and not yet committed, commit them with a description matching what was actually changed.
