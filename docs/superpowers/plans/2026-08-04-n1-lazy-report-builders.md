# §N Part 1 — Lazy Report Builder Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "do first" half of §N (code-splitting) from `docs/superpowers/specs/2026-08-03-distribution-performance-and-workflow-design.md` — convert `Reports/index.tsx`'s 7 static report-builder imports (which pull in the two largest files in the repo, `deck2/slides.ts` at 3,766 lines and `deck2/theme.ts` at 2,081 lines, plus 5 other builder modules) to dynamic `import()` calls scoped to the exact click-handler branch that needs them. This is a startup-eval fix, not a bundle-size fix — `check:bundle-size` will not move, since everything still inlines into the one `dist/index.html` under `vite-plugin-singlefile`. What changes is how much JavaScript the browser evaluates before the app becomes interactive: today every session — including an `employee` who never opens a report — pays the eval cost of every report builder at boot; after this plan, that cost is paid only by a session that actually clicks an export/generate button.

**Architecture:** No `Suspense` needed — every call site is already inside a `try`/`finally` block in an already-`async` click handler with existing spinner state (`setExporting`/`setGenerating`/`setPbiExporting`), so `await import(...)` right before first use is a drop-in replacement for the static import, with the same UX (the spinner now also covers the module-fetch time, which is strictly more honest than before). ES module specifiers are cache-keyed by path, so multiple `await import("<same path>")` calls across different handlers/branches resolve to the same cached module instance — this matters for `executive/deck2`, whose `openExecutiveDeckV2` transitively depends on module-level serialization state (`deckBuildQueue` / `withDeckBuildLock`) that must stay singular across all call sites.

**Tech Stack:** Native dynamic `import()`, no new dependencies.

## Global Constraints

- Every call site's current await/no-await behavior on the FUNCTION CALL ITSELF must be preserved exactly — only the import moves from static-at-module-top to dynamic-at-first-use. Do not add an `await` to a call that doesn't already have one (e.g. `buildDistributionXlsx`, `buildSampleXlsx`, `buildExecutiveXlsx`, `buildManagementWorkbook`, and `openManagementReport` — the last one is called without `await` today at line 481; leave that as-is, it is out of scope for this plan to investigate or fix).
- Do not touch `DEFAULT_EXEC_CONFIG`/`ExecutiveReportInput` (from `executiveReportTypes`) or `loadDeckStyleChoices` (from `executive/deck2/styleChoices`) — these are not part of the 7-function builder graph this plan targets, and `DEFAULT_EXEC_CONFIG` in particular is a plain config object used outside the click handlers.
- `npm run check:bundle-size` is expected to show **zero change** — do not treat a lack of movement there as a sign something went wrong.
- Follow CLAUDE.md's edit-log requirement (version bump, Before/After, `npm run count-lines -- --quiet` before/after, category prefix).

---

### Task 1: Convert `Reports/index.tsx`'s 7 report-builder imports to per-branch dynamic imports

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx` (remove 7 static imports at lines 14-20 and the import at line 40; add scoped dynamic imports at every call site)
- Test: `src/components/Sidebar/Tabs/Reports/index.test.tsx` (extend)

**Interfaces:**
- Consumes: existing exports of `distributionReport.ts`, `sampleReport.ts`, `executiveReport.ts`, `executive/deck2/index.ts`, `management/managementReport.ts`, `management/managementDeck.ts`, `management/managementWorkbook.ts`, `powerbiExport/exportManager.ts` — none of their signatures change.
- Produces: no new exports.

**Context:** There are 3 click handlers in this file, all already `async`, all already wrapping their body in `try { ... } finally { setXxx(null/false) }` with the spinner state set *before* the `try`. `generate(type)` is a single function that branches on `type` via `if`/`else if` into 4 report families (sample / distribution / executive / management), each with 3 sub-variants (`-xlsx` / `-deck` / plain-document) — only one branch runs per call, so the dynamic import belongs *inside* each branch, not once at the top of `generate`, or every call would eagerly fetch all 4 families' modules regardless of which one was actually requested. `executiveReport.ts`'s two exports and `executive/deck2`'s `openExecutiveDeckV2` are each called from **two** different handlers (`handleExport` and `generate`) — both call sites need their own `await import(...)` of that module; this is safe and does not create two independent module instances (see the `deck2` note below).

**`deck2` concurrency note (read before touching `openExecutiveDeckV2` call sites):** `executive/deck2/index.ts` has module-level mutable state (`let deckBuildQueue`, lines ~440-460) that `withDeckBuildLock` uses to serialize concurrent deck builds — `buildExecutiveDeckV2` (which `openExecutiveDeckV2` calls internally) goes through this lock. A dynamic `import("../../../../data/reporting/executive/deck2")` at each of the two call sites resolves to the *same* cached module instance as any other `import()`/`import(...)` of that identical specifier path — Vite/ESM module resolution is cache-keyed by resolved path, not by call site — so `deckBuildQueue` stays a single shared gate across both handlers. No additional locking work is needed for this plan; this note exists so the implementer doesn't second-guess it mid-task.

- [ ] **Step 1: Write the failing test**

Add to `src/components/Sidebar/Tabs/Reports/index.test.tsx` a new `describe` block. This test verifies the STARTUP-EVAL claim, not runtime output: that none of the 7 builder modules' code has executed merely from importing/rendering `ReportsTab`, only after a user actually triggers an export.

Read the existing test file first for its render harness and mocking conventions (it already mocks several of these exact modules for other describe blocks — reuse those `vi.mock(...)` factories where they already exist rather than redefining them). Add:

```tsx
describe("Reports — lazy report-builder imports (§N)", () => {
  it("does not evaluate the report-builder modules just from rendering the tab", async () => {
    // Each of these 7 modules is dynamically imported only inside a click
    // handler after this fix -- render alone must not trigger their
    // top-level module code. We assert on a Vitest module-mock call marker
    // rather than bundle inspection, since this is a unit-test-level proxy
    // for "not statically imported" (a true startup-eval measurement needs
    // a real build + DevTools profile, out of scope for a unit test).
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    render(<ReportsTab />);

    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(1));
      await Promise.resolve();
    });

    // None of the 7 builder modules' mocked factory functions should have
    // been touched yet -- only rendering happened, no export was clicked.
    expect(distributionReportSpies.buildDistributionXlsx).not.toHaveBeenCalled();
    expect(sampleReportSpies.buildSampleXlsx).not.toHaveBeenCalled();
    expect(executiveReportSpies.openExecutiveReport).not.toHaveBeenCalled();
  });
});
```

Adjust the spy object names (`distributionReportSpies`, `sampleReportSpies`, `executiveReportSpies`) to match whatever mock structure the file already uses for these modules — if the file doesn't yet mock all 3, add `vi.mock(...)` factories for `distributionReport`/`sampleReport`/`executiveReport` following the exact pattern the file already uses for any ONE module it does mock (e.g. `powerbiExport/exportManager`, if that's already mocked — check first).

- [ ] **Step 2: Run the test to verify it fails or passes vacuously**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx -t "does not evaluate the report-builder modules"`
This test may PASS even before the fix (since `vi.mock` intercepts the module regardless of static vs. dynamic import, so "not called" is true either way pre-fix too — the real value of this test is regression protection going forward, not proof of the current bug). Note this in the report; it's expected, not a problem — the actual verification of "code-splitting worked" for this task is the build-based check in Step 4, not this unit test.

- [ ] **Step 3: Convert each call site**

In `src/components/Sidebar/Tabs/Reports/index.tsx`, remove these 8 lines from the top-level imports (currently lines 14-20 and 40):

```ts
import { buildDistributionXlsx, openDistributionDocument, openDistributionDeck } from "../../../../data/reporting/distributionReport";
import { buildSampleXlsx, openSampleReport, openSampleDeck } from "../../../../data/reporting/sampleReport";
import { openExecutiveReport, buildExecutiveXlsx } from "../../../../data/reporting/executiveReport";
import { openExecutiveDeckV2 } from "../../../../data/reporting/executive/deck2";
import { openManagementReport } from "../../../../data/reporting/management/managementReport";
import { openManagementDeck } from "../../../../data/reporting/management/managementDeck";
import { buildManagementWorkbook } from "../../../../data/reporting/management/managementWorkbook";
...
import { runPowerBiExport } from "../../../../data/powerbiExport/exportManager";
```

Then, at each call site, insert a scoped `const { ... } = await import("...")` immediately before first use, replacing the bare call. All paths below are relative to `src/components/Sidebar/Tabs/Reports/index.tsx`, identical to the removed static imports' paths.

**In `handleExport` (currently lines 337-364):**

Before:
```tsx
      if (kind === "document") {
        await openExecutiveReport(execInput, names);
        showToast("ok", "تم فتح التقرير التفصيلي.");
      } else if (kind === "deck") {
        const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
        await openExecutiveDeckV2(execInput, names, saved?.choices);
        showToast("ok", "تم فتح العرض التنفيذي.");
      } else {
        buildExecutiveXlsx(execInput, names);
        showToast("ok", "تم تنزيل بيانات التقرير (Excel).");
      }
```

After:
```tsx
      if (kind === "document") {
        const { openExecutiveReport } = await import("../../../../data/reporting/executiveReport");
        await openExecutiveReport(execInput, names);
        showToast("ok", "تم فتح التقرير التفصيلي.");
      } else if (kind === "deck") {
        const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
        const { openExecutiveDeckV2 } = await import("../../../../data/reporting/executive/deck2");
        await openExecutiveDeckV2(execInput, names, saved?.choices);
        showToast("ok", "تم فتح العرض التنفيذي.");
      } else {
        const { buildExecutiveXlsx } = await import("../../../../data/reporting/executiveReport");
        buildExecutiveXlsx(execInput, names);
        showToast("ok", "تم تنزيل بيانات التقرير (Excel).");
      }
```

**In `handlePbiExport` (currently lines 378-395):**

Before:
```tsx
    try {
      const manifest = await runPowerBiExport(directoryHandle, selectedMonth);
      setPbiResult(manifest);
```

After:
```tsx
    try {
      const { runPowerBiExport } = await import("../../../../data/powerbiExport/exportManager");
      const manifest = await runPowerBiExport(directoryHandle, selectedMonth);
      setPbiResult(manifest);
```

**In `generate` (currently lines 397-490), the sample branch (currently lines 422-431):**

Before:
```tsx
        if (type === "sample-xlsx") {
          buildSampleXlsx(sampleInput);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else if (type === "sample-deck") {
          await openSampleDeck(sampleInput);
          showToast("ok", "تم فتح عرض العينة. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          await openSampleReport(sampleInput);
          showToast("ok", "تم فتح تقرير العينة التفصيلي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        }
```

After:
```tsx
        if (type === "sample-xlsx") {
          const { buildSampleXlsx } = await import("../../../../data/reporting/sampleReport");
          buildSampleXlsx(sampleInput);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else if (type === "sample-deck") {
          const { openSampleDeck } = await import("../../../../data/reporting/sampleReport");
          await openSampleDeck(sampleInput);
          showToast("ok", "تم فتح عرض العينة. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          const { openSampleReport } = await import("../../../../data/reporting/sampleReport");
          await openSampleReport(sampleInput);
          showToast("ok", "تم فتح تقرير العينة التفصيلي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        }
```

**The distribution branch (currently lines 445-454):**

Before:
```tsx
        if (type === "distribution-xlsx") {
          buildDistributionXlsx(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else if (type === "distribution-deck") {
          await openDistributionDeck(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم فتح عرض التوزيع. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          await openDistributionDocument(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم فتح تقرير التوزيع التفصيلي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        }
```

After:
```tsx
        if (type === "distribution-xlsx") {
          const { buildDistributionXlsx } = await import("../../../../data/reporting/distributionReport");
          buildDistributionXlsx(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم تنزيل ملف Excel.");
        } else if (type === "distribution-deck") {
          const { openDistributionDeck } = await import("../../../../data/reporting/distributionReport");
          await openDistributionDeck(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم فتح عرض التوزيع. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          const { openDistributionDocument } = await import("../../../../data/reporting/distributionReport");
          await openDistributionDocument(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم فتح تقرير التوزيع التفصيلي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        }
```

**The executive branch inside `generate` (currently lines 459-469):**

Before:
```tsx
        if (type === "executive-xlsx") {
          buildExecutiveXlsx(execInput, names);
          showToast("ok", "تم تنزيل ملف بيانات التقرير (Excel).");
        } else if (type === "executive-deck") {
          const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
          await openExecutiveDeckV2(execInput, names, saved?.choices);
          showToast("ok", "تم فتح العرض التنفيذي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          await openExecutiveReport(execInput, names);
          showToast("ok", "تم فتح التقرير التفصيلي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        }
```

After:
```tsx
        if (type === "executive-xlsx") {
          const { buildExecutiveXlsx } = await import("../../../../data/reporting/executiveReport");
          buildExecutiveXlsx(execInput, names);
          showToast("ok", "تم تنزيل ملف بيانات التقرير (Excel).");
        } else if (type === "executive-deck") {
          const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
          const { openExecutiveDeckV2 } = await import("../../../../data/reporting/executive/deck2");
          await openExecutiveDeckV2(execInput, names, saved?.choices);
          showToast("ok", "تم فتح العرض التنفيذي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          const { openExecutiveReport } = await import("../../../../data/reporting/executiveReport");
          await openExecutiveReport(execInput, names);
          showToast("ok", "تم فتح التقرير التفصيلي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        }
```

**The management branch (currently lines 474-483):**

Before:
```tsx
        if (type === "management-xlsx") {
          buildManagementWorkbook(execInput, names);
          showToast("ok", "تم تنزيل ملف بيانات الإدارة (Excel).");
        } else if (type === "management-deck") {
          await openManagementDeck(execInput, names);
          showToast("ok", "تم فتح عرض الإدارة. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          openManagementReport(execInput, names);
          showToast("ok", labels.mgmt_card_toast_opened);
        }
```

After:
```tsx
        if (type === "management-xlsx") {
          const { buildManagementWorkbook } = await import("../../../../data/reporting/management/managementWorkbook");
          buildManagementWorkbook(execInput, names);
          showToast("ok", "تم تنزيل ملف بيانات الإدارة (Excel).");
        } else if (type === "management-deck") {
          const { openManagementDeck } = await import("../../../../data/reporting/management/managementDeck");
          await openManagementDeck(execInput, names);
          showToast("ok", "تم فتح عرض الإدارة. استخدم أمر الطباعة للحفظ بصيغة PDF.");
        } else {
          const { openManagementReport } = await import("../../../../data/reporting/management/managementReport");
          openManagementReport(execInput, names);
          showToast("ok", labels.mgmt_card_toast_opened);
        }
```

Note `openManagementReport` is called without `await` both before and after this change — preserve that exactly, do not add one.

- [ ] **Step 4: Verify code-splitting actually happened**

Run a real build and inspect the output chunk structure:

Run: `npm run build`
Expected: build succeeds. Since `vite-plugin-singlefile` inlines everything into one `dist/index.html` at the very end of the build, you will NOT see separate `.js` chunk files in `dist/` (there's only `dist/index.html`) — that's expected and matches the plan's "What NOT to expect" framing (this is a startup-eval fix, not a bundle-size fix). To verify the split actually took effect before the singlefile-inlining step, run Vite's build with the singlefile plugin temporarily bypassed is out of scope for this task; instead confirm indirectly:

Run: `npx tsc -b --listFiles 2>&1 | grep -c "deck2/slides.ts"` before and after a clean checkout comparison is unnecessary — instead, grep the FINAL `dist/index.html` for a distinguishing string unique to `deck2/slides.ts` (e.g. a literal Arabic label string that only that file defines) and confirm it's still present (it must be — singlefile still inlines it, just deferred) — this step is a sanity check that the build didn't silently drop the module, not a proof of deferred evaluation. Report the build's success/failure and file size as observed; do not attempt to measure startup-eval timing as part of this automated step (that requires a manual DevTools profile per the spec's own "Measure with `performance.now()`... comparing an `employee` session against `admin`" guidance, which is a manual verification the implementer should note as a suggested follow-up, not something to automate here).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx`
Expected: all PASS, including every existing test that exercises `handleExport`/`handlePbiExport`/`generate` (search the file for `fireEvent.click` on export/generate buttons — these must still work identically since the call semantics are unchanged, only the import timing moved).

Then the whole suite:
Run: `npm run test:run`
Expected: all PASS.

Then typecheck and lint (dynamic `import()` with destructuring is a place TypeScript's module resolution can surface an issue not caught by a plain read):
Run: `npm run typecheck && npm run lint:ci`
Expected: clean.

- [ ] **Step 6: Edit log + commit**

```bash
git add src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/index.test.tsx "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (reports): lazy-load report builder modules on first use instead of at boot"
```
