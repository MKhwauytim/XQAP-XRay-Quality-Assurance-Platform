# QA review 2 — Batches 3 (D1/D2/D3) + 5 (E1/E2) + whole-branch sanity

**Reviewer:** Fable (QA pass 2, final before merge decision) · **Date:** 2026-07-12
**Scope:** `batch-3-5.diff` (24 files, 2,690 lines — everything a3f6a63b..8064d77e) vs `03-approved-plan.md` §3 (D1/D2/D3) and §5 (E1/E2), plus the C1 rework fix (8064d77e) closing QA-1's Rework Item 1, plus a whole-branch sanity pass (33 commits, `full-branch.diffstat`).

## Verdict: APPROVED — ready for final verification

No rework items. Every plan acceptance criterion for D1/D2/D3/E1/E2 is met, the QA-1 rework item is confirmed fixed **empirically** (not just by code reading), and the full CI-equivalent gate was executed locally and is green:

| Gate | Result |
|---|---|
| `npm run test:run` | 66 files / 425 tests — all pass |
| `npm run typecheck` | clean |
| `npm run lint:ci` (`--max-warnings 0`) | clean |
| `npm run check:hex-literals` | all 4 baselines hold (10/23/3/16) |
| `npm run build` | `dist/index.html` 2,643.93 kB / 969.89 kB gzip |

Six non-blocking observations are listed at the end.

---

## C1 rework fix (8064d77e) — VERIFIED FIXED, empirically

QA-1's Rework Item 1 (demo KPIs render `"—"` because no seeded answer carries `qualityImageResult`) is closed by `demoWorkspace.ts:269-296`: a `rowsById` lookup feeds each submitted/draft answer a third `{ fieldId: "qualityImageResult" }` entry derived from the row's own `xrayLevelOneResult`, with a deterministic ~1-in-15 disagreement flip (`seq % 15 === 0`, modulo the row's `sourceRowNumber` — no `Math.random`, determinism preserved).

I did not take this on faith. A scratch Vitest file (written, run, then deleted — not committed) drove `createDemoWorkspace()` through the **real read path** (`loadMonthPopulationFinal` → `loadSampleMaster` → `loadOrDeriveDistributionCurrent` → `loadAllEmployeeFiles` → `buildReportModel`). Result:

```
overallAccuracy:     92.31   (was null)
detectionRate:       71.43   (was null)
missedSuspicionRate: 28.57   (was null)
falseSuspicionRate:  16.67
completionRate:      45
```

All three previously-null KPIs are non-null and non-zero — the plan's "KPIs non-zero" bullet now holds — and a second consecutive `createDemoWorkspace()` produced **identical** KPI values (determinism assertions passed). The flip on `seq % 15 === 0` deliberately overlaps the suspicious seeding (`seq % 8 === 0`) at seq 0, which is what gives `missedSuspicionRate` its non-zero numerator. QA-1's secondary point 6 (`imageAvailable` null → port bands `"none"`) remains open as the documented non-blocking follow-up; it was explicitly out of the rework item's scope.

## D1 — workflow + component tests: APPROVED (genuinely meaningful, not shallow)

- **`pipeline.workflow.test.ts` (381 lines)** is a real end-to-end: it builds a genuine `.xlsx` in memory via SheetJS, parses it through `processRiskWorkbook` (the worker's delegate — the worker boundary is honestly documented in the file header exactly as the plan's enhancement demanded), processes, **persists and round-trips** through `saveMonthRun`/`loadMonthPopulationFinal`, draws a seeded sample and asserts a re-draw is id-identical, distributes via `calculateBulkAssignment` + the append-only log + `loadOrDeriveDistributionCurrent`, saves/reads answers, and builds both the executive and C2 management reports. All 6 stages have ≥1 happy + ≥1 failure test, and the failure tests assert *meaningful surfacing*: missing-xray-id rows excluded with a count (not crashed), duplicates surfaced in `duplicateRows`/summary and dropped (not doubled), empty-population draw rejected with a non-empty `reason`, zero allocations → zero events, unknown employee → empty file (not a throw), empty model → report renders. Nothing here asserts a mock's echo — the only stub in all of D1 is `XLSX.writeFile` in the DataTable test, a jsdom download boundary (the workbook itself is still built by the real `XLSX.utils`).
- **`DataTable/index.test.tsx`** renders the real component with Arabic data and exercises debounced global search, per-column multiselect, column-visibility hide, the export path, and the truncation `title` tooltip. Its header claims DataTable has **no row-sort UI** and re-scopes the plan's "sort" to filtering — I verified this against source: the only `sort` in `DataTable/index.tsx` is `compareFilterOptions` (line 444), which orders filter *options*, not rows. The claim is true; CLAUDE.md's "filterable/sortable" blurb is the stale artifact (observation 6).
- **`Population.wizard.test.tsx`**: the three `vi.mock` specifiers were verified byte-exact against `Population/index.tsx`'s own imports (notably `../../../../workers/workbookWorker?worker&inline` at index.tsx:73 — an inexact specifier would have silently missed). Pins the initial stepper state, locked-phase non-navigability (click on a locked phase does not advance — items render with no `role`), and the full `getPhaseStatus` progression matrix (`components/helpers.ts:43`).

## D2 — escaping audit + XSS tests: APPROVED

- **Shared corpus (`src/data/reporting/xssPayloads.ts`)** matches the plan's enhancement: one payload list (script tag, img onerror, svg onload, attr-break, structure-break), each embedding the `XSSPROBE` marker so a "field silently dropped" false pass is impossible. `findLiveInjection`'s fragments were checked against the builders' legitimate chrome (deck nav `<script>` IIFEs, `onclick="window.print()"`, logo `onerror`) — disjoint, so a hit is a real injection. Grep confirms the module is imported **only** by the three test files — it never enters the production module graph.
- **`deck/slides.ts` fix (`esc(model.summary.periodId)`) — correct AND genuinely exercised.** `periodIdFromFolder` (reportModel.ts:120-125) returns a non-matching folder name **verbatim**, and the test sets `monthFolderName: XSS_PAYLOADS.scriptTag`; pre-fix, the diff shows the interpolation was raw (`${model.summary.periodId}`), so the v1-deck test would have failed with a live `<script>alert`. This is real regression coverage, not a trivially-passing assertion.
- **`document/partScope.ts` fix (`esc(model.exclusions.note)`) — correct but defensive-only, and the tests CANNOT exercise it.** `exclusions.note` is a hard-coded constant string (reportModel.ts:261) containing no escapable characters, so output is byte-identical and no injection vector reaches it. The fix converts a "provably static" interpolation into an escaped one — the right call under the audit's standard, but recorded here so nobody believes the XSS suite covers that line by injection. If `note` ever becomes dynamic, the escaping is already in place.
- All four builders (`buildPopulationReportHtml`, `buildExecutiveReport`, `buildExecutiveDeck`, `buildExecutiveDeckV2`, `buildManagementReport` — the C2 builder is in the net, discharging QA-1's carried-forward item 6) are asserted with `findLiveInjection === null` **plus** marker-present **plus** `&lt;script&gt;`-present, through the three plan-named vectors (port names, employee display names via `employeeDisplayNames`, answer/notes fields). The deck2 test correctly tolerates the deck's own legitimate `<script>` nav chrome.

## D3 — columnMappingHints extraction + tests: APPROVED (zero behavior change)

- **Extraction is verbatim** — the removed `normalizeHeaderToken`/`buildColumnHintsFromRows` bodies in `Population/index.tsx` and the added ones in `components/columnMappingHints.ts` are character-identical (diff-compared). The `DEFAULT_MAPPING_TEMPLATE` import in index.tsx is **not** orphaned (still used at index.tsx:1646), `PopulationConfig` is still consumed, and the two call sites (index.tsx:457/462) are unchanged. No behavior change.
- Edge cases are genuinely covered: extra columns (ignored + result key-set stays exactly `systemFields`), missing required columns (key present mapped to `[]`, never dropped, plus a test demonstrating the exact `isRequired`+empty-list signal the modal's warning is built on), renamed/aliased columns (risk alias, BI-only alias pooling, hamza/taa-marbuta normalization), plus two honest characterization pins: `customFields` are never auto-detected, and the real DEFAULT config's substring matcher cross-attributes `"اسم المنفذ"` to both `portName` and `portCode` — pre-existing behavior documented rather than silently changed. Two tests run against the real `DEFAULT_POPULATION_CONFIG`, not just the synthetic fixture.

## E1 — useFocusTrap + 8 adoptions: APPROVED

- **The hook is sound**: capture-phase document listener; forward/backward Tab wrap; recapture of focus that escaped the container; a no-focusables fallback (container gets `tabindex="-1"`); Escape → `onEscape` with `stopPropagation` (identical semantics to ConfirmDialog's *old* hand-rolled handler, so no new global-listener suppression class); focus restore on cleanup; `onEscapeRef` prevents effect churn from per-render callbacks; deps `[enabled, restoreFocus]` are correct for both adoption patterns (mount-when-open and inline-gated). The 7 hook tests assert on `document.activeElement` — real focus behavior, within jsdom's limits (only the wrap/recapture branches are assertable since jsdom has no native Tab navigation; that is precisely the hook's own logic, so the coverage is the meaningful part).
- **Conflict scan of all 8 sites — no dialog breaks**:
  - `AuthGate` and `ConfirmDialog` had the only pre-existing hand-rolled Tab traps, and both are **removed in the same diff** — no double-handling. ConfirmDialog's first focusable is still the cancel button (safe-default first-focus preserved; verified DOM order).
  - `WorkspaceGate`'s passcode input keeps an inline `Escape → closeViewModal` handler (line 188); the hook's capture-phase handler now runs first, calls the same hoisted function, and `stopPropagation` prevents the inline one from double-firing. Harmless either way (idempotent close). `closeViewModal`/`closeAdminModal` are function declarations — no TDZ hazard from being referenced above their definitions.
  - Removed `autoFocus` attributes (AuthGate, WorkspaceGate) are exactly replaced by the hook's first-focusable focus (the input is the first focusable in both modals).
  - Nested simultaneous traps are effectively unreachable: `ConfirmDialog`'s three usage sites (ReportDesigner tab level, Population tab level, MappingSettingsModal) all sit in contexts with **no** other active trap (MappingSettingsModal has no `role="dialog"`/trap).
- **AuthGate `Date.now()` fix — safe and equivalent.** The lockout interval effect invokes `tick()` synchronously (AuthGate.tsx:225), so `lockoutSecondsLeft` is populated in the same render pass that sets `lockoutUntil` — no enabled-while-locked window. The submit handler retains its own `Date.now()` hard guard (line 357 — an event handler, where impure reads are fine), and the button label already keyed off `lockoutSecondsLeft`, so disabled/label are now driven by the same state. Behavior identical; render purity fixed.
- Icon-only close buttons gained `aria-label="إغلاق"` (RequestList, XrayReferrals) per the plan.

## E2 — chart legends/axes: APPROVED (escaping standard fully met)

- **Every new label interpolation audited against the D2 standard**: `legendRows` is the single new text-content sink for caller-supplied strings and routes through `escText()`; donut legend labels flow through it; rankedBar's axis row emits only `r(max)` numerics plus a literal `"0"`; gauge ticks are literal `"0%"`/`"100%"`; heatmap's legend emits `r(max)` plus static Arabic words. Attribute positions receive only `r()`-rounded numbers, `seriesColor(index)`, and `cssVar()` tokens. New XSS tests inject the shared corpus through donut category labels and groupedBars series labels — real coverage of the new sinks.
- **No-regression proof for the single-series path is algebraic, not just asserted**: with one series `legendHeight` returns 0, so `plotH` is unchanged and the moved group-label y (`padTop + plotH + 16`) equals the old `h - 8` exactly — single-series groupedBars/stackedBars output is byte-equivalent. Legends are skipped for n ≤ 1 everywhere (asserted by the "omits" tests).
- **All production callers survive the geometry change**: explicit-height heatmaps (220/280 in partRisk/partCorroboration) compress the grid modestly but stay positive; gauges at height 150–160 keep a positive dial radius; the donut ring is floored at 60px with the legend capped at 50% of height. Empty-state paths untouched.

## Whole-branch sanity

- **CI workflow (`.github/workflows/ci.yml`, landed in batch 4)** works as claimed: every step maps to a real package.json script (`typecheck`, `lint:ci`, `check:hex-literals`, `test:run`, `build` — all verified present), `npm ci` is backed by the committed lockfile + vendored `vendor/xlsx-0.20.3.tgz`, it caches the npm cache (not `node_modules`) exactly as the plan required, permissions are read-only, and it triggers on push-to-main + all PRs + manual dispatch. I executed the identical five-step sequence locally on the branch head — all green (table above). `vitest.config.ts` correctly mirrors the `__APP_VERSION__` define so version-reading components render under tests.
- **Silent data-loss scan**: nothing in batches 3/5 touches the disk write path. The only production-code changes are the demo seed (writes exclusively to the in-memory `createMemoryDirectory` handle), two `esc()` wraps, chart SVG string builders, and focus/aria attributes. No new `safeWriteJson` call sites, no envelope/schema changes, no distribution-log semantics changes. Nothing actively broken found (cross-machine CAS hardening remains the planned later pass, per scope).
- Working tree at review time contained only untracked QA process artifacts; the scratch verification test was deleted after its run.

## Non-blocking observations (no action required for merge)

1. **Escape bypasses a deliberately-disabled Cancel in the bulk-confirm modal.** `RequestList.tsx:127` disables Cancel while `bulkRunning`, but the trap's `onEscape: () => setBulkAction(null)` (line 31) is ungated, so Escape can dismiss the progress modal mid-run. Traced end-to-end: **no data risk** — the write loop completes and posts its result banner regardless, `bulkRunning` still disables re-confirmation, and completion clears the selection — but it softens an intentional guard. Suggest `onEscape: () => { if (!bulkRunning) setBulkAction(null); }`. (Archive's two dialogs are *not* the same case: their header X close was already enabled during `busy` pre-E1, so Escape there matches pre-existing behavior.)
2. **Demo KPIs still have no committed regression test** — the exact bug class QA-1 caught in C1 is now fixed and empirically verified, but `demoWorkspace.ts` retains zero test coverage, so a future schema/field drift could silently reintroduce `"—"` KPIs. A small test replicating this review's read-path check (createDemoWorkspace → loaders → `buildReportModel` → three KPIs non-null) would close that hole cheaply.
3. **XSS corpus has no single-quote attribute payload** (`esc()` escapes `&<>"` but not `'`). Currently moot — QA-1 verified no single-quoted attributes exist in any builder — but if one is ever introduced, the corpus won't catch it. Consider adding `' onmouseover='…` to `XSS_PAYLOADS` someday.
4. **`partScope.ts`'s `esc(exclusions.note)` is untestable by injection** (the note is a compile-time constant) — fine as defense-in-depth; recorded so nobody assumes the test suite exercises that specific line.
5. **Donut legend can clip past the viewBox for many categories**: once the 50%-height cap binds (~6+ entries at default height), overflow rows are laid out below `h` and clipped silently. Current callers pass 2–4 categories; cosmetic only.
6. **CLAUDE.md describes DataTable as "filterable/sortable"** but no row-sort UI exists (verified; the D1 test header documents this correctly). One-word doc nit for the next CLAUDE.md touch.

## Summary table

| Item | Verdict |
|---|---|
| C1 rework fix (demo KPIs) | **VERIFIED FIXED** (empirical, deterministic) |
| D1 workflow/component tests | APPROVED — meaningful, no tautologies |
| D2 escaping audit + XSS tests | APPROVED — slides.ts fix genuinely exercised; partScope fix defensive-only (documented) |
| D3 columnMappingHints extraction + tests | APPROVED — verbatim extraction, zero behavior change |
| E1 focus trap + 8 adoptions + AuthGate purity fix | APPROVED — no dialog conflicts; fix equivalent |
| E2 chart legends/axes | APPROVED — all new labels escaped; single-series byte-equivalent |
| CI workflow sanity | APPROVED — steps real, executed green locally |
| Whole-branch data-safety scan | No silent data-loss/corruption risks found |
