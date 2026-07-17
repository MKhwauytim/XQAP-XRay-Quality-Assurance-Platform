# Quality Pass — Batches 1-3 Implementation Plan [DONE — merged to main]

> **STATUS: ✅ DONE.** All 9 tasks implemented and reviewed. Two implementers independently caught real bugs in this plan's OWN sample code (a casLoop type-signature bug; a non-discriminating test), both verified empirically and fixed correctly. The final whole-branch review caught a genuine Critical regression (Population's `isLoadingMonthData` could get stuck `true` forever after the I-2 follow-up) plus an Important gap (a per-id report-design write missing delayed-verify CAS protection) — both closed with fail-first-verified fixes. Merged to main via [PR #21](https://github.com/MKhwauytim/XQAP-XRay-Quality-Assurance-Platform/pull/21) on 2026-07-17. Full task-by-task evidence trail: `.superpowers/sdd/progress.md` and `.superpowers/sdd/task-{1..8}-report.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 8 real, evidence-backed findings from the app-wide quality survey (`.superpowers/sdd/app-quality-survey.md`) that are safe for an unattended fix pass — 2 Important (missing async-staleness guards) + 6 Minor (test-truth, CAS consistency, a11y). No product-scope decisions are touched (see spec's explicit Batch 4 exclusion list).

**Architecture:** Eight independent, narrowly-scoped fixes across the existing codebase. No new modules, no new conventions — every fix applies a pattern that already exists elsewhere in the repo (staleness-guard `cancelled` flags, casLoop CAS wrapping, the shared `useFocusTrap` hook) to a previously-inconsistent spot. Each task stands alone and can be reviewed/merged independently of the others.

**Tech Stack:** React 19 + TypeScript (existing conventions), Vitest with `createMemoryDirectory()` for storage tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-quality-pass-batches-1-3-design.md` — read for full rationale per finding.
- No new npm dependencies.
- UI text Arabic, RTL; use label keys via `useLabels()`/`labelsStore.ts`, not hard-coded strings, for any new user-facing text (none of these 8 fixes are expected to need new strings, but if one does, follow that convention).
- TypeScript strict mode; `import type` for type-only imports.
- EDIT_LOG (CLAUDE.md): every task records its files under a new `## v55.2 — 2026-07-16 — Quality pass: staleness guards, CAS consistency, test-truth, a11y` entry (or the next available decimal bump — check `docs/EDIT_LOG.md`'s current top entry before writing the version number) in `docs/EDIT_LOG.md`, added BEFORE the code changes, with Before/After per file.
- Tests: `createMemoryDirectory()` (`src/data/storage/memoryDirectory.ts`) for any storage-layer test. **Known limitation to respect:** the memory mock's `write(data)` does `buffer += data` — it only faithfully round-trips **string** content (JSON files). A binary write (e.g. an XLSX `ArrayBuffer`) gets coerced to a non-representative string; a test against a binary-writing function can verify *that a file was created and the call didn't throw*, not byte-level binary content. Task 6 below is written with this limitation in mind — don't attempt real XLSX-parse round-trip verification against the memory mock.
- Verification gate for every task: `npx vitest run <task tests>`; final task also runs `npm run test:run`, `npx tsc -b`, `npm run lint`.
- Component/hook tests need `/* @vitest-environment jsdom */` as line 1; pure storage-layer tests run in the default node env.

---

### Task 1: Reports month-summary chips staleness guard (I-1)

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx:183-213` (the `monthMeta` load effect)
- Test: `src/components/Sidebar/Tabs/Reports/` — check for an existing test file for this component first (`Glob src/components/Sidebar/Tabs/Reports/*.test.tsx`); if none exists, create one scoped to just this effect's behavior.

**Interfaces:**
- Consumes: nothing new — this is a same-file fix mirroring the KPI-model effect immediately below it (`:255-261` in the same file, unchanged).
- Produces: no new exports; behavior-only fix.

- [x] **Step 1: EDIT_LOG entry**

Insert at the top of `docs/EDIT_LOG.md` (check the current top heading first and use the correct next version number):

```markdown
## v55.2 — 2026-07-16 — Quality pass: staleness guards, CAS consistency, test-truth, a11y

Evidence-backed fixes from an app-wide quality survey (`.superpowers/sdd/app-quality-survey.md`),
scoped to Batches 1-3 (see spec: docs/superpowers/specs/2026-07-16-quality-pass-batches-1-3-design.md).
No product-scope items touched.

**File:** `src/components/Sidebar/Tabs/Reports/index.tsx`

**Before:**
\`\`\`tsx
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync null-clear when workspace or month is deselected; synchronizes with external workspace state
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); return; }
    setMonthMeta(null);
    void (async () => {
      try {
        const [pop, sample] = await Promise.all([...]);
        ...
        setMonthMeta({ folderName: selectedMonth, populationCount: popRows.length, ... });
      } catch {
        setMonthMeta({ folderName: selectedMonth, populationCount: null, ... });
      }
    })();
  }, [directoryHandle, selectedMonth]);
\`\`\`

**After:** adds a `cancelled` flag (mirroring the KPI-model effect immediately below it) so a slow load for a previously-selected month can never overwrite a newer selection's chips — see file.
```

- [x] **Step 2: Write the failing test**

First check whether a test file already exists for this component:

Run: `ls src/components/Sidebar/Tabs/Reports/*.test.tsx 2>/dev/null || echo "none"`

If none exists, create `src/components/Sidebar/Tabs/Reports/index.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";

// Mock the global month hook to a fixed existing selection — this test only
// exercises the monthMeta-loading race, not the month-switching machinery.
vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [
      { month: 4, year: 2026, folderName: "4-april-2026" },
      { month: 5, year: 2026, folderName: "5-may-2026" },
    ],
    selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: (globalThis as { __testDir?: DirectoryHandleLike }).__testDir ?? null }),
}));

import ReportsContent from "./index";

afterEach(() => cleanup());

describe("Reports month-summary chips — staleness guard", () => {
  it("does not let a slower load for an older month overwrite the current month's chips", async () => {
    // This test targets the specific race: assert the effect includes a
    // cancellation guard by checking the fix is present via behavior — render
    // with a directory whose population-final read is artificially delayed,
    // confirm the chip values settle to the CURRENTLY selected month's data
    // (not stuck on a stale/empty intermediate value), matching the KPI
    // effect's already-correct behavior in the same file.
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    render(<ReportsContent />);

    // The chips should reach a stable "ready" (non-loading, "—" or a number)
    // state without throwing and without an unmounted-state warning — the
    // concrete regression is only reproducible with a live two-selection
    // race, which is exercised at the effect level in Task 1's manual review;
    // this smoke test guards against a wholesale regression in the effect's
    // structure (e.g. someone removing the cancelled flag entirely causes no
    // observable difference here, but IS caught by the reviewer's code read).
    await waitFor(() => {
      expect(screen.queryByText(/جاري التحميل/)).not.toBeInTheDocument();
    });

    delete (globalThis as { __testDir?: DirectoryHandleLike }).__testDir;
  });
});
```

**Note for the implementer:** this component-level test is a weak regression guard for a pure timing race (jsdom has no real async scheduling variance to force the exact "A resolves after B" ordering deterministically without invasive mocking of `loadMonthPopulationFinal`/`loadSampleMaster` with manually-controlled promise resolution order). If you find a cleaner way to deterministically force the race (e.g. mocking `loadMonthPopulationFinal` to return a manually-controlled promise, switching `selectedMonth` via a re-render, then resolving the older promise last, and asserting `monthMeta.folderName` matches the newer selection, not the older one) — prefer that; it is a stronger test than the smoke-test above. If deterministic forcing proves impractical, ship the smoke test and say so explicitly in your report — do not fake a race that isn't actually being forced.

- [x] **Step 3: Run test to verify current behavior (baseline, may pass or fail depending on test strength)**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx`

- [x] **Step 4: Apply the fix**

In `src/components/Sidebar/Tabs/Reports/index.tsx`, replace the `monthMeta` effect (`:183-213`) with:

```tsx
  // Load lightweight meta for the month bar chips
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync null-clear when workspace or month is deselected; synchronizes with external workspace state
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); return; }
    let cancelled = false;
    setMonthMeta(null);
    void (async () => {
      try {
        const [pop, sample] = await Promise.all([
          loadMonthPopulationFinal(directoryHandle, selectedMonth),
          loadSampleMaster(directoryHandle, selectedMonth),
        ]);
        if (cancelled) return;
        const popRows = pop ? (pop.rows as unknown as PreparedPopulationRow[]) : [];
        const employeeFiles = sample ? await loadAllEmployeeFiles(directoryHandle, selectedMonth) : [];
        if (cancelled) return;
        const submittedIds = new Set(
          employeeFiles.flatMap((file) =>
            file.items
              .filter((item) => item.status === "submitted")
              .map((item) => item.xrayImageId)
          )
        );
        const answered = submittedIds.size;
        setMonthMeta({
          folderName: selectedMonth,
          populationCount: popRows.length,
          sampleCount: sample ? sample.rows.length : null,
          studiedCount: answered > 0 ? answered : null,
        });
      } catch {
        if (!cancelled) {
          setMonthMeta({ folderName: selectedMonth, populationCount: null, sampleCount: null, studiedCount: null });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [directoryHandle, selectedMonth]);
```

(Two new `if (cancelled) return;` checks added inside the try block — after each `await` boundary — plus the catch-branch guard and the cleanup function, matching the KPI effect's exact shape.)

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/components/Sidebar/Tabs/Reports/index.tsx docs/EDIT_LOG.md
git add src/components/Sidebar/Tabs/Reports/index.test.tsx 2>/dev/null || true
git commit -m "fix(reports): guard month-summary chips against a stale-load race"
```

---

### Task 2: Population `handleLoadExistingMonth` overlapping-load race (I-2)

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx:287-438` (the `handleLoadExistingMonth` function and its calling effect)
- Test: `src/components/Sidebar/Tabs/Population/Population.wizard.test.tsx` (existing file — extend it) or a new focused test file if the existing one's mock setup doesn't support this scenario cleanly.

**Interfaces:**
- Consumes: nothing new.
- Produces: `handleLoadExistingMonth` gains a second parameter (`token: number`); its sole call site (the auto-load effect) is updated to match. No other code calls this function (verified: `grep -n "handleLoadExistingMonth(" src/components/Sidebar/Tabs/Population/index.tsx` shows exactly one call site plus the definition).

- [x] **Step 1: EDIT_LOG entry**

Append under the `## v55.2` heading:

```markdown
**File:** `src/components/Sidebar/Tabs/Population/index.tsx`

**Before:**
\`\`\`tsx
  async function handleLoadExistingMonth(info: MonthFolderInfo): Promise<void> {
    if (!directoryHandle) return;
    setIsLoadingMonthData(true);
    try {
      ...
    } finally {
      setIsLoadingMonthData(false);
    }
  }

  const loadedFolderRef = useRef<string | null>(null);
  useEffect(() => {
    ...
    if (globalMonth.kind === "existing") {
      const targetFolder = globalMonth.folderName;
      void handleLoadExistingMonth({ ... }).catch((error) => {
        logError("population:auto-load-month", error);
        resetForNewMonth();
        setProcessingMessage("تعذر تحميل بيانات الشهر — أعد المحاولة");
        if (loadedFolderRef.current === targetFolder) loadedFolderRef.current = null;
      });
    }
    ...
  }, [directoryHandle, globalMonth]);
\`\`\`

**After:** adds a `loadMonthTokenRef` (mirroring the load-token pattern already used in `useApprovalData.ts`/`XrayInspectionResults.tsx`/`XrayReferrals.tsx`) so a rapid double-switch of the header month can never let a superseded load's data commit over a newer selection's, or let a superseded load's rejection wipe a newer load's already-successful data — see file.
```

- [x] **Step 2: Write the failing test**

Open `src/components/Sidebar/Tabs/Population/Population.wizard.test.tsx` and check its existing mocks (it mocks `useWorkspace` to `{ directoryHandle: null }` and `useGlobalMonth` to `{ selection: { kind: "none" }, ... }` per the global-month-selector work done earlier this session). This existing setup renders the wizard with NO directory handle, which never reaches `handleLoadExistingMonth` at all — testing the overlapping-load race requires a REAL directory handle with real month data, which is a bigger test setup than this file currently has.

Add a new, separate test file `src/components/Sidebar/Tabs/Population/populationLoadRace.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";

vi.mock("../../../../workers/workbookWorker?worker&inline", () => ({
  default: class WorkerStub {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  },
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));

// Mutable selection state the mocked hook reads — the test flips this to
// simulate a rapid double month-switch mid-load.
let mockSelection: { kind: "existing"; month: number; year: number; folderName: string } = {
  kind: "existing", month: 4, year: 2026, folderName: "4-april-2026",
};
vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [
      { month: 4, year: 2026, folderName: "4-april-2026" },
      { month: 5, year: 2026, folderName: "5-may-2026" },
    ],
    selection: mockSelection,
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

let realDir: DirectoryHandleLike;
vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: realDir }),
}));

import PopulationTab from "./index";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Population — overlapping month-load race", () => {
  it("a superseded month's slow load never commits its data after a newer month has already loaded", async () => {
    realDir = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    // Seed two real, saved months so handleLoadExistingMonth has genuine data
    // to load for each.
    await saveMonthRun({
      directoryHandle: realDir, month: 4, year: 2026, username: "tester",
      riskFileName: null, biFileName: null, riskSourceFile: null, biSourceFile: null,
      certScanUsed: false, riskRawRows: [], biRawRows: [],
      processedRows: [{ xrayImageId: "APR-1" }],
      certScanRows: 0, nonCertScanRows: 1,
      processingSummary: { removedRows: [], duplicateRows: [], invalidResultRows: [], summary: {} as never },
      processingFingerprint: "x", sourceFiles: { risk: null, bi: null }, confirmedOverwrite: false,
    });
    await saveMonthRun({
      directoryHandle: realDir, month: 5, year: 2026, username: "tester",
      riskFileName: null, biFileName: null, riskSourceFile: null, biSourceFile: null,
      certScanUsed: false, riskRawRows: [], biRawRows: [],
      processedRows: [{ xrayImageId: "MAY-1" }],
      certScanRows: 0, nonCertScanRows: 1,
      processingSummary: { removedRows: [], duplicateRows: [], invalidResultRows: [], summary: {} as never },
      processingFingerprint: "y", sourceFiles: { risk: null, bi: null }, confirmedOverwrite: false,
    });

    mockSelection = { kind: "existing", month: 4, year: 2026, folderName: "4-april-2026" };
    const { rerender } = render(<PopulationTab />);

    // Flip to May before April's load has necessarily settled — this is the
    // race window. React re-renders synchronously; the auto-load effect picks
    // up the new selection on the next effect pass.
    mockSelection = { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" };
    rerender(<PopulationTab />);

    // Give both loads time to settle.
    await waitFor(() => {
      const chip = document.querySelector(".status-chip-val");
      expect(chip).not.toBeNull();
    }, { timeout: 2000 });

    // The status bar's month chip must reflect May (the LATER selection),
    // never April (the superseded one) — this is the concrete, observable
    // assertion for the fix.
    const monthChip = Array.from(document.querySelectorAll(".status-chip"))
      .find((el) => el.textContent?.includes("الشهر"));
    expect(monthChip?.textContent).toContain("5/2026");
  });
});
```

**Note for the implementer:** if `saveMonthRun`'s exact parameter shape doesn't match what's shown above (check `src/data/population/populationStorage.ts`'s actual `saveMonthRun` signature — the plan brief may not have every field exactly right), fix the test to match the real signature; don't skip writing a real test over a signature mismatch. If forcing a genuine race deterministically in jsdom proves impractical even with the rerender approach, fall back to a narrower unit-level test of just the token-comparison logic (extract it isn't extractable without a larger refactor, so in that case, document in your report why a full-component race test was used instead and what specifically it verifies).

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/populationLoadRace.test.tsx`
Expected: FAIL (or the test may pass by luck due to jsdom's microtask ordering not actually reproducing the race — if so, note this in your report; the fix is still correct and necessary per the code-level reasoning in the spec, and Step 2's note already anticipates this).

- [x] **Step 4: Apply the fix**

In `src/components/Sidebar/Tabs/Population/index.tsx`, add a token ref next to `loadedFolderRef` (around line 413):

```tsx
  const loadMonthTokenRef = useRef(0);
  const loadedFolderRef = useRef<string | null>(null);
```

Change `handleLoadExistingMonth`'s signature and add the staleness check right after the async load resolves:

```tsx
  async function handleLoadExistingMonth(info: MonthFolderInfo, token: number): Promise<void> {
    if (!directoryHandle) return;
    setIsLoadingMonthData(true);
    try {
      hasUnsavedSessionWorkRef.current = false;
      const data = await loadMonthForEditing(directoryHandle, info.folderName);
      if (token !== loadMonthTokenRef.current) return; // superseded by a newer month selection

      // ...rest of the function body is UNCHANGED from here down (all the
      // setRiskWorkbookResult / setBiWorkbookResult / setPopulationProcessingResult /
      // setSampleDrawResult / setSampleNeedsApproval / setDistributionCurrent /
      // setCurrentPhase / setCompletedPhaseIds calls stay exactly as they are)...
    } finally {
      if (token === loadMonthTokenRef.current) setIsLoadingMonthData(false);
    }
  }
```

Update the calling effect (around line 414-438):

```tsx
  useEffect(() => {
    if (!directoryHandle || globalMonth.kind === "none") return;
    if (loadedFolderRef.current === globalMonth.folderName) return;
    loadedFolderRef.current = globalMonth.folderName;
    if (globalMonth.kind === "existing") {
      const targetFolder = globalMonth.folderName;
      const token = ++loadMonthTokenRef.current;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing wizard state to the external global-month selection; the load/reset IS the intended effect
      void handleLoadExistingMonth({
        month: globalMonth.month,
        year: globalMonth.year,
        folderName: globalMonth.folderName,
      }, token).catch((error) => {
        // Guarded on the token so a STALE (superseded) rejection can never
        // wipe a newer load's already-committed, successful data.
        if (token !== loadMonthTokenRef.current) return;
        logError("population:auto-load-month", error);
        resetForNewMonth();
        setProcessingMessage("تعذر تحميل بيانات الشهر — أعد المحاولة");
        if (loadedFolderRef.current === targetFolder) loadedFolderRef.current = null;
      });
    } else {
      resetForNewMonth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLoadExistingMonth/resetForNewMonth are stable per render cycle; keying on folderName prevents load loops
  }, [directoryHandle, globalMonth]);
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/populationLoadRace.test.tsx src/components/Sidebar/Tabs/Population/Population.wizard.test.tsx`
Expected: PASS (both files)

- [x] **Step 6: Commit**

```bash
git add src/components/Sidebar/Tabs/Population/index.tsx docs/EDIT_LOG.md
git add src/components/Sidebar/Tabs/Population/populationLoadRace.test.tsx
git commit -m "fix(population): guard handleLoadExistingMonth against an overlapping-load race"
```

---

### Task 3: Management document XSS test-truth (M-1)

**Files:**
- Modify: `src/data/reporting/reportBuilders.xss.test.ts` (add a new `describe` block)
- Modify: `src/data/reporting/management/managementReport.ts:9-12` (correct the header comment)

**Interfaces:**
- Consumes: `buildManagementReport` (already exported from `managementReport.ts` — verify its exact export name and signature by reading the file's exports before writing the test), `maliciousExecInput()` (already defined in the test file, reused from the existing management-deck test block).
- Produces: no new exports.

- [x] **Step 1: EDIT_LOG entry**

Append under `## v55.2`:

```markdown
**File:** `src/data/reporting/reportBuilders.xss.test.ts`

**Before:** management deck only (`buildManagementDeck`) covered by the XSS test set.

**After:** adds a `buildManagementReport` case using the same `maliciousExecInput()` fixture, closing the gap between the file's claimed coverage and its actual coverage.

**File:** `src/data/reporting/management/managementReport.ts`

**Before:** header comment claims membership in "the D2 XSS test set" without it being true.

**After:** comment corrected to reflect actual test coverage (now true, per the test added above).
```

- [x] **Step 2: Check `buildManagementReport`'s actual export/signature**

Run: `grep -n "^export function buildManagementReport\|^export async function buildManagementReport" src/data/reporting/management/managementReport.ts`

Confirm its parameter shape matches `buildManagementDeck`'s usage in the existing test (`buildManagementDeck(input, names)` — an `ExecutiveReportInput` and a `Record<string, string>` display-name map). If `buildManagementReport`'s signature differs, adjust Step 3's test call accordingly — don't guess, read the actual function signature first.

- [x] **Step 3: Write the failing test**

In `src/data/reporting/reportBuilders.xss.test.ts`, add after the existing `describe("management deck — XSS escaping", ...)` block (which uses `maliciousExecInput()`):

```ts
import { buildManagementReport } from "./management/managementReport";

// ... (keep existing imports/blocks unchanged, add this new describe block
// after the "management deck" one) ...

describe("management document — XSS escaping", () => {
  it("escapes injected port names, reviewer names and the month label", () => {
    const { input, names } = maliciousExecInput();
    assertSafe(buildManagementReport(input, names));
  });
});
```

(Adjust the call signature to match whatever Step 2 confirmed — if `buildManagementReport` takes different or additional parameters than `buildManagementDeck`, use the real signature.)

- [x] **Step 4: Run test to verify it fails or passes cleanly**

Run: `npx vitest run src/data/reporting/reportBuilders.xss.test.ts`
Expected: the new test should actually PASS immediately (the survey confirmed `buildManagementReport` already routes everything through `esc()` — this is a test-truth fix, not a code-behavior fix). If it unexpectedly FAILS, that means the survey's "low risk" assessment was wrong and there's a real escaping gap — in that case, stop and treat it as a real Important finding: fix the actual escaping bug in `managementReport.ts` before proceeding, and note this escalation clearly in your report.

- [x] **Step 5: Correct the header comment**

In `src/data/reporting/management/managementReport.ts`, the header comment (`:9-12`) currently reads:

```
// SECURITY: every interpolated model/user value (port names, reviewer display
// names, model-derived recommendation strings, narrative findings) is routed
// through `esc()`. This builder is part of the D2 XSS test set (Batch 3) — keep
// it that way: never interpolate un-escaped data into the template.
```

This claim is now true (Step 3 added the missing test) — no change needed to the comment's substance, but double check it still accurately says "D2 XSS test set" and that claim now holds; if the comment needs no edit because Step 3 made it true, say so in your report rather than editing something that doesn't need editing.

- [x] **Step 6: Commit**

```bash
git add src/data/reporting/reportBuilders.xss.test.ts docs/EDIT_LOG.md
git commit -m "test(reporting): add missing XSS coverage for the management document"
```

---

### Task 4: Report-design per-id CAS protection (M-2)

**Files:**
- Modify: `src/data/reportDesigner/reportTypes.ts` (add `revision?`/`_writeToken?` to `ReportDocument`)
- Modify: `src/data/reportDesigner/storage/reportDesignStorage.ts` (wrap the per-id write in casLoop)
- Modify: `src/data/reportDesigner/storage/reportDesignStorage.test.ts` (add the same-id-CAS test)

**Interfaces:**
- Consumes: `casLoop` (`src/data/storage/casLoop.ts`, already imported in this file for the index writer), `safeReadJson`/`safeWriteJson` (already imported).
- Produces: `ReportDocument` gains two new optional fields (`revision?: number`, `_writeToken?: string`) — purely additive, does not break any existing consumer since both are optional and every read site already tolerates unknown/absent fields via `safeReadJson`'s generic typing.

- [x] **Step 1: EDIT_LOG entry**

Append under `## v55.2`:

```markdown
**File:** `src/data/reportDesigner/reportTypes.ts`

**Before:** `ReportDocument` has no CAS fields.

**After:** adds optional `revision`/`_writeToken` fields, matching `TemplateSchema`'s equivalent fields — see file.

**File:** `src/data/reportDesigner/storage/reportDesignStorage.ts`

**Before:**
\`\`\`ts
    await withResourceLock(`${dir.name}/designs-index`, async () => {
      // Per-id doc — single writer by id, safe to write once outside the CAS loop.
      await safeWriteJson(dir, `${doc.reportId}.json`, doc);

      await updateDesignIndex(dir, (designs) => ...);
    });
\`\`\`

**After:** the per-id document write is now wrapped in the same casLoop protocol as `templateStorage.ts`'s `saveTemplateFile` (revision + `_writeToken`, verified on read-back), closing the silent-clobber gap the "single writer by id" comment had assumed away — see file.
```

- [x] **Step 2: Write the failing test**

In `src/data/reportDesigner/storage/reportDesignStorage.test.ts`, add after the existing `"preserves both index entries on concurrent saves"` test:

```ts
  it("serializes concurrent saves of the SAME report id via per-id CAS (no silent clobber)", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("تصميم مشترك", "admin");
    // Two supervisors on two PCs edit the SAME design at the same instant.
    const docA = { ...doc, pages: [] };
    const docB = { ...doc, pages: [{ pageId: "p1", elements: [] } as never] };
    await Promise.all([saveDesign(dir, docA), saveDesign(dir, docB)]);

    const loaded = await loadDesign(dir, doc.reportId);
    expect(loaded).not.toBeNull();
    expect(loaded?.revision).toBe(2); // both writes participated in the CAS chain

    const index = await loadDesignIndex(dir);
    expect(index.designs).toHaveLength(1); // one entry, not duplicated
  });
```

(If `Page` type requires more fields than shown for a minimal valid page object, check `src/data/reportDesigner/reportTypes.ts`'s `Page` type and adjust `docB`'s `pages` array to satisfy it — don't leave a type error.)

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/data/reportDesigner/storage/reportDesignStorage.test.ts`
Expected: FAIL — `loaded?.revision` is `undefined` (no CAS wrap yet means no revision stamping).

- [x] **Step 4: Add the CAS fields to `ReportDocument`**

In `src/data/reportDesigner/reportTypes.ts`, add to the `ReportDocument` type (around line 85-96):

```ts
export type ReportDocument = {
  reportId: string;
  reportName: string;
  version: number;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  docType: DocType;
  pageSetup: PageSetup;
  theme: { palette: string[]; fontFamily: string; defaults: Record<string, unknown> };
  dataSources: DataSourceRef[];
  pages: Page[];
  reportFilters: Filter[];
  /** Monotonic CAS revision for this shared, multi-writer per-id document. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
};
```

- [x] **Step 5: Wrap the per-id write in casLoop**

In `src/data/reportDesigner/storage/reportDesignStorage.ts`, add a new helper function (mirroring `saveTemplateFile`) and use it inside `saveDesign`:

```ts
/**
 * CAS read-modify-write of the shared per-id `{reportId}.json` document. Two
 * supervisors/managers on two machines can edit the same report design
 * concurrently; casLoop bumps `revision`, stamps `_writeToken`, and verifies
 * both on read-back so a concurrent clobber fails loudly and retries rather
 * than silently overwriting the other author's edit. Mirrors
 * `templateStorage.ts`'s `saveTemplateFile` for the analogous per-id shape.
 */
async function saveDesignFile(
  dir: DirectoryHandleLike,
  doc: ReportDocument
): Promise<ReportDocument> {
  const fileName = `${doc.reportId}.json`;
  const outcome = await casLoop<ReportDocument>(
    async (writeToken) => {
      const existing = await safeReadJson<ReportDocument>(dir, fileName);
      const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
      const updated: ReportDocument = {
        ...doc,
        revision: nextRevision,
        _writeToken: writeToken,
      };
      await safeWriteJson(dir, fileName, updated);
      const verify = await safeReadJson<ReportDocument>(dir, fileName);
      if (
        verify.ok &&
        verify.value.revision === nextRevision &&
        verify.value._writeToken === writeToken
      ) {
        return { done: true, result: updated };
      }
      return { done: false };
    },
    { conflictError: "تعذّر حفظ تصميم التقرير: تعارض في الكتابة بعد عدة محاولات." }
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
  return outcome.result;
}
```

Then in `saveDesign` (around line 69-101), replace:

```ts
    const dir = await getDesignsDir(directoryHandle);
    await withResourceLock(`${dir.name}/designs-index`, async () => {
      // Per-id doc — single writer by id, safe to write once outside the CAS loop.
      await safeWriteJson(dir, `${doc.reportId}.json`, doc);

      await updateDesignIndex(dir, (designs) =>
```

with:

```ts
    const dir = await getDesignsDir(directoryHandle);
    await withResourceLock(`${dir.name}/designs-index`, async () => {
      await saveDesignFile(dir, doc);

      await updateDesignIndex(dir, (designs) =>
```

(The rest of `saveDesign`'s `updateDesignIndex(...)` call and its closing braces stay unchanged.)

- [x] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/data/reportDesigner/storage/reportDesignStorage.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [x] **Step 7: Commit**

```bash
git add src/data/reportDesigner/reportTypes.ts src/data/reportDesigner/storage/reportDesignStorage.ts src/data/reportDesigner/storage/reportDesignStorage.test.ts docs/EDIT_LOG.md
git commit -m "fix(report-designer): CAS-protect the per-id design document write"
```

---

### Task 5: casLoop delayed-verify consistency audit (M-3)

**Files:**
- Modify: `src/data/population/monthLock.ts` (`closeMonth` AND `reopenMonth` — add delayed verify)
- Modify: `src/data/feedback/feedbackStorage.ts` (rationale comment only)
- Modify: `src/auth/authActivityLog.ts` (rationale comment only)
- Modify: `src/data/templates/templateStorage.ts` (rationale comment on the INDEX writer only, `:30` area — NOT `saveTemplateFile`, which already has delayed verify)
- Modify: `src/data/reportDesigner/storage/reportDesignStorage.ts` (rationale comment on `updateDesignIndex`, `:37-67`)
- Test: `src/data/population/monthLock.test.ts` (existing file — add a delayed-verify regression test mirroring the pattern used for sites that already have one, e.g. check `templateSelectionStorage.ts`'s or `templateStorage.ts`'s test file for the exact test shape to mirror)

**Interfaces:**
- Consumes: `casLoop`'s `verify` callback support (already used by `templateStorage.ts saveTemplateFile` and `templateSelectionStorage.ts` — read `src/data/storage/casLoop.ts`'s type definition for the exact `verify` callback signature before writing `monthLock.ts`'s version).
- Produces: no new exports; `closeMonth`/`reopenMonth`'s CAS attempt functions gain a `verify:` callback in their return object.

- [x] **Step 1: EDIT_LOG entry**

Append under `## v55.2`:

```markdown
**File:** `src/data/population/monthLock.ts`

**Before:** `closeMonth`/`reopenMonth` verify only in-attempt (immediate read-back), no delayed re-verify.

**After:** both gain the same delayed `verify:` callback used by `templateStorage.ts saveTemplateFile`/`templateSelectionStorage.ts` — this file governs whether a closed month stays frozen against further writes, which is exactly the class of risk the delayed-verify tier exists for.

**File:** `src/data/feedback/feedbackStorage.ts`

**Before:** in-attempt-only verify, no comment explaining why.

**After:** one-line rationale comment added — feedback messages are low-stakes user input, not business-critical RMW data; a rare lost update means at most a re-submission, not data corruption. No behavior change.

**File:** `src/auth/authActivityLog.ts`

**Before:** in-attempt-only verify, no comment explaining why.

**After:** one-line rationale comment added — the merge-by-session-id pattern is self-healing (a losing writer's entries survive to the next flush attempt, per the existing "advances only on a verified write" comment already in the file); delayed verify would be redundant. No behavior change.

**File:** `src/data/templates/templateStorage.ts` (index writer only)

**Before:** in-attempt-only verify on `updateTemplateIndex`, no comment explaining why (the per-id `saveTemplateFile` already has delayed verify and its own comment).

**After:** one-line rationale comment added — index entries are eventually-consistent by nature (a transient one-write-behind entry self-heals on the next save); the actual content-divergence risk lives in the per-id document, which already has the stronger protection. No behavior change.

**File:** `src/data/reportDesigner/storage/reportDesignStorage.ts` (index writer only)

**Before:** in-attempt-only verify on `updateDesignIndex`, no comment.

**After:** same rationale as the template index writer above — the per-id document (Task 4) now carries the stronger protection. No behavior change.
```

- [x] **Step 2: Read `casLoop`'s `verify` callback type**

Run: `grep -n "verify" src/data/storage/casLoop.ts`

Confirm the exact shape casLoop expects for the delayed-verify callback (should match the pattern already seen in `templateStorage.ts saveTemplateFile` and `templateSelectionStorage.ts`: `verify: async () => boolean`, returning whether the write still holds on a delayed re-read). Use the REAL type from this file, not the assumed shape below, if they differ.

- [x] **Step 3: Write the failing test for monthLock's delayed verify**

Open `src/data/population/monthLock.test.ts` and check its existing structure (`Glob`/`Read` it first to match its exact helper functions and fixture style — likely uses `createMemoryDirectory()` and some month-manifest seeding helper). Add a test in the same style as whatever CAS-conflict test already exists for `templateStorage.test.ts` or `templateSelectionStorage`'s test, adapted to `closeMonth`:

```ts
  it("closeMonth survives a concurrent manifest write landing between its immediate verify and a delayed re-check", async () => {
    // This test targets the SPECIFIC gap delayed-verify closes: a losing
    // writer's change lands in the window between the immediate read-back
    // verify (which the current code already has) and some later point. The
    // exact mechanism to force this window requires mocking safeWriteJson or
    // introducing a controllable delay — check how templateStorage.test.ts's
    // equivalent CAS test (if it specifically tests the DELAYED verify path,
    // not just the immediate one) forces this, and mirror that approach. If
    // no existing test in the codebase actually exercises the delayed-verify
    // window specifically (as opposed to just the immediate verify), note
    // this in your report — the delayed-verify addition may only be testable
    // as "closeMonth still succeeds in the normal case" without a true
    // adversarial-timing test, which is an acceptable, honestly-reported
    // limitation given casLoop's delayed-verify mechanism itself should
    // already have its own dedicated unit test in casLoop.test.ts.
  });
```

**Note for the implementer:** check `src/data/storage/casLoop.test.ts` first — if `casLoop`'s delayed-verify mechanism is ALREADY unit-tested there in isolation (verifying that a `verify: async () => false` return correctly triggers a retry), then `monthLock.ts`'s test only needs to confirm `closeMonth`/`reopenMonth` still work correctly in the normal (non-conflicting) case after adding the `verify:` callback — a full adversarial-timing integration test would be duplicating `casLoop.test.ts`'s own coverage. Write whichever is the honest, non-redundant test; explain your choice in the report.

- [x] **Step 4: Add delayed verify to `closeMonth`/`reopenMonth`**

In `src/data/population/monthLock.ts`, in BOTH `closeMonth`'s and `reopenMonth`'s casLoop attempt functions, change the success-return block from:

```ts
          if (
            verify.ok &&
            verify.value.revision === nextRevision &&
            verify.value._writeToken === writeToken
          ) {
            return { done: true, result: { ok: true as const } };
          }
          return { done: false };
```

to:

```ts
          if (
            verify.ok &&
            verify.value.revision === nextRevision &&
            verify.value._writeToken === writeToken
          ) {
            return {
              done: true,
              result: { ok: true as const },
              verify: async () => {
                const recheck = await safeReadJson<MonthManifestData>(monthDir, MANIFEST_FILE);
                return (
                  recheck.ok &&
                  recheck.value.revision === nextRevision &&
                  recheck.value._writeToken === writeToken
                );
              },
            };
          }
          return { done: false };
```

(Apply this to both `closeMonth` and `reopenMonth` — they have near-identical structure per the file's own comment "Same casLoop protocol as closeMonth / updateMonthStatus".)

- [x] **Step 5: Add rationale comments to the four lower-risk sites**

In `src/data/feedback/feedbackStorage.ts`, in the JSDoc comment above `mutateFeedback` (or immediately before the `casLoop` call if there's no JSDoc), add one line:

```ts
// No delayed verify: feedback messages are low-stakes user input (not
// business-critical RMW data) — a rare lost update means at most a
// re-submission, not data corruption. See docs/EDIT_LOG.md v55.2.
```

In `src/auth/authActivityLog.ts`, above the `casLoop` call in `flushMemoryToWorkspace`:

```ts
  // No delayed verify: the merge-by-session-id pattern is self-healing — a
  // losing writer's entries survive (memoryEntries only advances on a
  // verified write) and are picked up whole on the next flush attempt.
```

In `src/data/templates/templateStorage.ts`, above `updateTemplateIndex`'s casLoop call:

```ts
  // No delayed verify: index entries are eventually-consistent by nature — a
  // transient one-write-behind entry self-heals on the next save. The
  // stronger protection lives on the per-id document (saveTemplateFile,
  // below), which is where real content divergence would actually matter.
```

In `src/data/reportDesigner/storage/reportDesignStorage.ts`, above `updateDesignIndex`'s casLoop call, the equivalent comment (same rationale, now also true for the per-id document per Task 4).

- [x] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/data/population/monthLock.test.ts`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add src/data/population/monthLock.ts src/data/population/monthLock.test.ts src/data/feedback/feedbackStorage.ts src/auth/authActivityLog.ts src/data/templates/templateStorage.ts src/data/reportDesigner/storage/reportDesignStorage.ts docs/EDIT_LOG.md
git commit -m "fix(storage): add monthLock delayed-verify; document the sites that don't need it"
```

---

### Task 6: Missing tests for `templateSelectionStorage.ts` and `employeeXlsx.ts` (M-4)

**Files:**
- Create: `src/data/templates/templateSelectionStorage.test.ts`
- Create: `src/data/answers/employeeXlsx.test.ts`

**Interfaces:**
- Consumes: `loadInspectionTemplateSelection`/`saveInspectionTemplateSelection` (already exported from `templateSelectionStorage.ts`), `writeEmployeeXlsx` (already exported from `employeeXlsx.ts`), `createMemoryDirectory()`.
- Produces: no new exports; test-only files.

- [x] **Step 1: EDIT_LOG entry**

Append under `## v55.2`:

```markdown
**File:** `src/data/templates/templateSelectionStorage.test.ts` (new)

**Before:** _(file did not exist)_

**After:** round-trip save/load test + a same-key concurrent-write CAS test, closing the "zero tests" gap for this disk-writing module.

**File:** `src/data/answers/employeeXlsx.test.ts` (new)

**Before:** _(file did not exist)_

**After:** write-completes-without-throwing + correct-filename test. Note: `createMemoryDirectory()`'s file mock only faithfully round-trips string content, not binary `ArrayBuffer` writes — see the test file's own comment for the resulting scope limitation.
```

- [x] **Step 2: Write `templateSelectionStorage.test.ts`**

Create `src/data/templates/templateSelectionStorage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  loadInspectionTemplateSelection,
  saveInspectionTemplateSelection,
  type InspectionTemplateSelection,
} from "./templateSelectionStorage";

function makeSelection(templateId: string): InspectionTemplateSelection {
  return {
    templateId,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  };
}

describe("templateSelectionStorage", () => {
  it("returns null when no selection has been saved yet", async () => {
    const root = createMemoryDirectory();
    const loaded = await loadInspectionTemplateSelection(root);
    expect(loaded).toBeNull();
  });

  it("round-trips a saved selection", async () => {
    const root = createMemoryDirectory();
    const result = await saveInspectionTemplateSelection(root, makeSelection("tmpl-a"));
    expect(result.ok).toBe(true);

    const loaded = await loadInspectionTemplateSelection(root);
    expect(loaded?.templateId).toBe("tmpl-a");
    expect(loaded?.revision).toBe(1);
  });

  it("re-saving replaces the selection (last-writer-wins is the intended contract)", async () => {
    const root = createMemoryDirectory();
    await saveInspectionTemplateSelection(root, makeSelection("tmpl-a"));
    await saveInspectionTemplateSelection(root, makeSelection("tmpl-b"));

    const loaded = await loadInspectionTemplateSelection(root);
    expect(loaded?.templateId).toBe("tmpl-b");
    expect(loaded?.revision).toBe(2);
  });

  it("serializes concurrent saves via CAS (revision advances past both attempts)", async () => {
    const root = createMemoryDirectory();
    await Promise.all([
      saveInspectionTemplateSelection(root, makeSelection("tmpl-x")),
      saveInspectionTemplateSelection(root, makeSelection("tmpl-y")),
    ]);
    const loaded = await loadInspectionTemplateSelection(root);
    expect(loaded?.revision).toBe(2);
    expect(["tmpl-x", "tmpl-y"]).toContain(loaded?.templateId);
  });
});
```

- [x] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/data/templates/templateSelectionStorage.test.ts`
Expected: PASS (this module is already fully implemented with CAS — this is pure test-addition, no code change).

- [x] **Step 4: Write `employeeXlsx.test.ts`**

Create `src/data/answers/employeeXlsx.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { writeEmployeeXlsx } from "./employeeXlsx";
import type { DistributionEntry } from "../distribution/distributionTypes";

// NOTE on scope: createMemoryDirectory()'s in-memory FileHandleLike mock only
// faithfully round-trips STRING content (JSON files) — its `write(data)`
// implementation does `buffer += data`, which does not preserve real binary
// bytes for an ArrayBuffer write. These tests therefore verify the function
// completes without throwing and creates a file at the correct name/path —
// NOT the XLSX binary structure itself (that would need a real FS-backed
// test, out of scope for this unit-test tier).

function makeEntry(xrayImageId: string, assignedTo: string): DistributionEntry {
  return {
    xrayImageId,
    assignedTo,
    status: "pending",
    row: {
      xrayImageId,
      portName: "ميناء أ",
      certScanStatus: "Certscan",
      xrayEntryDate: "2026-05-01",
      declarationNumber: "D-1",
      xrayLevelOneResult: "سليمة",
      xrayLevelTwoResult: "سليمة",
    } as never,
  } as DistributionEntry;
}

describe("employeeXlsx", () => {
  it("writes a blank-answers file without throwing and creates it at the expected path", async () => {
    const root = createMemoryDirectory();
    const entries = [makeEntry("IMG-1", "alice")];

    await expect(
      writeEmployeeXlsx(root, "5-may-2026", "alice", entries)
    ).resolves.not.toThrow();

    // Confirm the file actually landed at the expected per-employee path.
    const sampleDir = await root.getDirectoryHandle("2-samples", { create: false })
      .then((d) => d.getDirectoryHandle("5-may-2026", { create: false }))
      .catch(() => null);
    // If workspacePaths nests differently than assumed here, adjust this
    // lookup to match getSampleEmployeeDir's REAL path shape (read
    // src/data/workspace/workspacePaths.ts's getSampleEmployeeDir before
    // finalizing this assertion) — the load-bearing assertion is that
    // SOME file named alice.xlsx exists under the employee dir, not the
    // exact intermediate folder names.
    expect(sampleDir).not.toBeNull();
  });

  it("overwrites the file on a second call with answers, without throwing", async () => {
    const root = createMemoryDirectory();
    const entries = [makeEntry("IMG-1", "bob")];

    await writeEmployeeXlsx(root, "5-may-2026", "bob", entries);
    await expect(
      writeEmployeeXlsx(root, "5-may-2026", "bob", entries, [
        {
          xrayImageId: "IMG-1", templateId: "t1", templateVersion: 1,
          answers: [{ fieldId: "qualityImageResult", value: "سليمة" }],
          lastSavedAt: new Date().toISOString(), submittedAt: new Date().toISOString(),
          answeredBy: "bob", status: "submitted",
        } as never,
      ])
    ).resolves.not.toThrow();
  });
});
```

**Note for the implementer:** the first test's directory-lookup path is a best guess — before finalizing, read `getSampleEmployeeDir` in `src/data/workspace/workspacePaths.ts` to get the REAL folder structure (`2-samples/{month}/...` may have an additional `employees` or role-scoped subfolder) and correct the lookup so the test's existence-check is genuine, not accidentally always-null (which would make the test pass vacuously without checking anything — `expect(sampleDir).not.toBeNull()` passing because `sampleDir` really exists is the requirement, not because the catch swallowed a real error).

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/answers/employeeXlsx.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/data/templates/templateSelectionStorage.test.ts src/data/answers/employeeXlsx.test.ts docs/EDIT_LOG.md
git commit -m "test(data): add missing coverage for templateSelectionStorage and employeeXlsx"
```

---

### Task 7: ReportDesigner drag-drop JSON.parse guard (M-5)

**Files:**
- Modify: `src/components/Sidebar/Tabs/ReportDesigner/index.tsx:375`
- Test: check for an existing test file covering the drop handler (`Glob src/components/Sidebar/Tabs/ReportDesigner/*.test.tsx`); if none exists for this specific handler, a focused new test is acceptable, or a manual-verification note if the drop handler is deeply embedded in a large render function that's impractical to unit-test in isolation — judge this honestly, don't force a brittle test.

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports; behavior-only fix (malformed drag payload no longer throws uncaught).

- [x] **Step 1: EDIT_LOG entry**

Append under `## v55.2`:

```markdown
**File:** `src/components/Sidebar/Tabs/ReportDesigner/index.tsx`

**Before:**
\`\`\`tsx
            const raw = e.dataTransfer.getData("application/x-rd-field");
            if (!raw) return;
            const { field, label, role } = JSON.parse(raw) as { field: string; label: string; role: FieldRole };
\`\`\`

**After:** wraps the `JSON.parse` in try/catch; a malformed payload (e.g. a drop from an external source) now no-ops instead of throwing uncaught into the drop handler.
```

- [x] **Step 2: Apply the fix**

In `src/components/Sidebar/Tabs/ReportDesigner/index.tsx` (around line 372-376), replace:

```tsx
            // Field drag (from الحقول panel)
            const raw = e.dataTransfer.getData("application/x-rd-field");
            if (!raw) return;
            const { field, label, role } = JSON.parse(raw) as { field: string; label: string; role: FieldRole };
```

with:

```tsx
            // Field drag (from الحقول panel). The payload normally comes from
            // this app's own drag source, but a malformed/external drop must
            // not throw uncaught into the drop handler.
            const raw = e.dataTransfer.getData("application/x-rd-field");
            if (!raw) return;
            let field: string, label: string, role: FieldRole;
            try {
              ({ field, label, role } = JSON.parse(raw) as { field: string; label: string; role: FieldRole });
            } catch {
              return;
            }
```

- [x] **Step 3: Verify no type errors from the destructuring change**

Run: `npx tsc -b`
Expected: clean (the `let` + try/catch destructuring is a standard TS pattern; confirm no downstream code in the same function shadows `field`/`label`/`role` in a way that breaks — read the ~30 lines after this change to confirm `field`/`label`/`role` are used the same way as before).

- [x] **Step 4: Add or note test coverage**

Check: `ls src/components/Sidebar/Tabs/ReportDesigner/*.test.tsx 2>/dev/null || echo "none"`

If a test file exists and already tests the drop handler, add a case asserting a malformed `application/x-rd-field` payload doesn't throw (construct a `DragEvent`-like object with a `dataTransfer.getData` mock returning invalid JSON, call the handler, assert no exception). If no test file exists and the drop handler is deeply embedded in a large component (typical for drag-and-drop canvas editors), a full render+drag-simulate test may be disproportionate — in that case, skip adding a new test file for this alone and say so explicitly in your report, noting the fix was verified via the `tsc -b` type-check plus manual code reading (the fix is a narrow, obviously-correct try/catch — this is one of the cases where forcing a test adds little value over honest documentation of the gap).

- [x] **Step 5: Commit**

```bash
git add src/components/Sidebar/Tabs/ReportDesigner/index.tsx docs/EDIT_LOG.md
git commit -m "fix(report-designer): guard drag-drop JSON.parse against malformed payloads"
```

---

### Task 8: "New month" popover focus trap (M-6) + full verification

**Files:**
- Modify: `src/components/GlobalMonthSelector/GlobalMonthSelector.tsx`
- Test: `src/components/GlobalMonthSelector/` — check for an existing test file (none was found in this session's earlier work on this component — if still absent, a focused new test is expected, matching `useFocusTrap`'s own testing conventions if it has a test file to mirror).

**Interfaces:**
- Consumes: `useFocusTrap` (`src/hooks/useFocusTrap.ts`, already used elsewhere e.g. `AuthGate.tsx`'s `adminModalRef` pattern).
- Produces: no new exports; the popover gains focus-trapping.

- [x] **Step 1: EDIT_LOG entry**

Append under `## v55.2`:

```markdown
**File:** `src/components/GlobalMonthSelector/GlobalMonthSelector.tsx`

**Before:** the "new month" popover has Escape/outside-click dismissal but no Tab-focus-trap and no auto-focus on open — a keyboard-only user can tab out of it into the page behind.

**After:** adopts the shared `useFocusTrap` hook (same pattern as `AuthGate.tsx`'s admin-passcode modal), attached to the `.gms-popover` element and enabled while `pickerOpen`. The hook's own Escape handling replaces the popover's previously-manual Escape listener; outside-click dismissal (which the hook doesn't cover) is unchanged.
```

- [x] **Step 2: Write the failing test**

Create `src/components/GlobalMonthSelector/GlobalMonthSelector.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GlobalMonthSelector } from "./GlobalMonthSelector";

vi.mock("../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: "5-may-2026" }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../auth/usePermissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));

afterEach(() => cleanup());

describe("GlobalMonthSelector — new-month popover focus trap", () => {
  it("moves focus into the popover when it opens, and Tab does not escape it", () => {
    render(<GlobalMonthSelector allowCreate />);
    fireEvent.click(screen.getByText(/شهر جديد/));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Focus should have moved to the first focusable element inside the dialog
    // (one of the month buttons), not stayed on the trigger button.
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab from the LAST focusable element inside the dialog must wrap back to
    // the FIRST, not escape to whatever follows the dialog in the DOM.
    const focusables = dialog.querySelectorAll("button, input");
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    // useFocusTrap's handler runs on the document listener and calls
    // preventDefault + focuses the first element — assert that happened.
    expect(document.activeElement).not.toBe(last);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Escape closes the popover", () => {
    render(<GlobalMonthSelector allowCreate />);
    fireEvent.click(screen.getByText(/شهر جديد/));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

**Note for the implementer:** if `usePermissions`'s real import path or `can` signature differs from this mock, or if `GlobalMonthSelector`'s exact button text for "شهر جديد" doesn't match `labels.gm_new_month_btn`'s actual rendered text, adjust the test's selectors to match reality — read the component and `labelsStore.ts` first if the test doesn't find the expected elements.

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/GlobalMonthSelector/GlobalMonthSelector.test.tsx`
Expected: FAIL — the popover currently has no focus trap, so the "Tab does not escape" assertion fails (focus moves wherever the browser's default tab order takes it, not back to the first element).

- [x] **Step 4: Apply the fix**

In `src/components/GlobalMonthSelector/GlobalMonthSelector.tsx`:

Add the import:

```tsx
import { useFocusTrap } from "../../hooks/useFocusTrap";
```

Add the hook call near the other hooks (after the `popoverWrapRef` declaration, around line 33):

```tsx
  const popoverWrapRef = useRef<HTMLDivElement>(null);
  const popoverFocusTrapRef = useFocusTrap<HTMLDivElement>({
    onEscape: () => setPickerOpen(false),
    enabled: pickerOpen,
  });
```

Remove the Escape-handling portion of the existing dismissal effect (keep outside-click, since `useFocusTrap` doesn't cover that) — change:

```tsx
  useEffect(() => {
    if (!pickerOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (popoverWrapRef.current && !popoverWrapRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pickerOpen]);
```

to:

```tsx
  // Outside-click dismissal. Escape and Tab-trapping are handled by
  // useFocusTrap (popoverFocusTrapRef), attached to the popover element below.
  useEffect(() => {
    if (!pickerOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (popoverWrapRef.current && !popoverWrapRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [pickerOpen]);
```

Attach `popoverFocusTrapRef` to the popover's `role="dialog"` element:

```tsx
            <div className="gms-popover" role="dialog" aria-label={labels.gm_new_month_title} ref={popoverFocusTrapRef}>
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/GlobalMonthSelector/GlobalMonthSelector.test.tsx`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/components/GlobalMonthSelector/GlobalMonthSelector.tsx src/components/GlobalMonthSelector/GlobalMonthSelector.test.tsx docs/EDIT_LOG.md
git commit -m "fix(month): focus-trap the new-month popover for keyboard users"
```

---

### Task 9: Full verification gate

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: all 8 prior tasks' output.
- Produces: confirms the whole branch is green before final review.

- [x] **Step 1: Full test suite**

Run: `npm run test:run`
Expected: all tests pass, including the 6+ new test files/cases added across Tasks 1-8.

- [x] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [x] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [x] **Step 4: Build**

Run: `npm run build`
Expected: succeeds; note the reported `dist/index.html` size (informational only — none of these 8 fixes touch bundle-affecting code paths at scale).

- [x] **Step 5: Commit (if any stray changes)**

```bash
git status --short
```

If clean, nothing to commit — this task is verification-only. If any files were modified during troubleshooting and not yet committed, commit them with a description matching what was actually changed.
