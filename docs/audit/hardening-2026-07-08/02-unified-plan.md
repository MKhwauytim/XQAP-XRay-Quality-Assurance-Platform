# Unified hardening plan — 2026-07-08 (B4–E2 remaining work)

**Baseline:** `main` @ post referral-approval rework + Tier-1 W1–W9.
**Inputs:** `01-status-table.md` (ground-truth status of 16 items) + `FULL_SYSTEM_AUDIT_2026-07-02.md` §3.
**Scope of this plan:** the 15 still-open/partial items (C4 is already fixed — verified below, kept for acceptance confirmation only), plus three already-decided product decisions (C1 demo mode, C2 build management report, C5 EDIT_LOG truncation).

Organized into **5 implementation batches**. Ratings (importance / difficulty) are a **first pass** — a Fable review finalizes them next.

---

## Corrections to the status table (found while resolving this plan)

Two findings materially change scope and must be read before Batch 2 and Batch 3:

1. **D2 — escaping is NOT missing from the executive pipeline.** The status table's evidence grepped for `escapeHtml\|sanitiz`, which misses the differently-named helpers that actually exist:
   - `src/data/reporting/executive/primitives.ts:5` exports `esc()` and applies it in `kpiCard`, `barRow`, `dataTable`, `statPill`, `pagePanel`, `radarSvg` labels, `badgeHtml`.
   - `src/data/reporting/executive/document/shared.ts` routes every section title / eyebrow / subtitle / note / chip through `esc()` (lines 41, 57–59, 68, 83–84, 101, 112, 119, 143).
   - `src/data/reporting/executive/ui/charts.ts:16` exports `escText()` and applies it to chart labels.
   - `src/data/reporting/executive/deck2/slides.ts` wraps port names (`esc(p.name)`) and stage labels throughout (lines 130, 348, 416, 540, 543, 762, 968, 1087…).
   - `src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.ts:8` has its own `escapeHtml()`.

   **Net:** all three report pipelines already escape user-controlled fields (port names, employee names, labels) at the primitive layer. D2 is therefore **primarily a test-coverage gap, not a missing-escaping production bug.** The narrower production risk is *raw interpolation that bypasses the primitives* — a handful exist and must be audited (e.g. `deck/slides.ts:106` `<h4>${it.title}</h4>` — currently static agenda strings, not user data, but confirm and either escape or annotate). Scope Batch 3/D2 as: (a) audit for raw-interpolation gaps and close any that carry user data; (b) add comprehensive XSS tests across all three builders.

2. **C4 is genuinely complete.** `src/components/Sidebar/Tabs/Settings/ErrorLogSection.tsx` gates on `role === "admin"` (line 16), renders the `getRecentErrors()` list with refresh + clear (lines 19–26, 47–78), and is mounted in Settings. The only acceptance delta vs the audit's wording ("+ copy button") is that there is **no explicit copy-to-clipboard button** — refresh/clear are present. Treat C4 as done; the only optional follow-up is a one-line "copy log to clipboard" button (low value).

---

## Batch 1 — Visual System

**Items:** B4 (CSS token sweep), B5 (table polish), B6 (spacing-rhythm pass).

**Sequencing (hard):**
- **B4 must land fully before B5.** B5 edits the same DataTable/Reports/EmployeeWorkspace CSS files; doing it after B4 avoids re-touching lines mid-token-migration and keeps the screenshot-diff signal clean.
- **B6 depends on B4** for the color layer being stable, but also **introduces a new token layer** (`--space-*`) that does not exist yet — it can be scaffolded in parallel with B4 (adding tokens to `index.css` conflicts with nothing) but the *consumption* edits should follow B4 per-file to avoid double-diffing a file.
- Recommended order: B4 (per file) → B6 token scaffold → B5 → B6 consumption.

### B4 — Token sweep per CSS file (hex → `var(--…)`)
- **Files (worst offenders first, one file per commit):**
  - `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css` — **310** hex literals
  - `src/components/Sidebar/Tabs/Reports/Reports.css` — **197**
  - `src/components/DataTable/DataTable.css` — **133**
  - `src/components/Sidebar/Tabs/Population/Population.css` — **127** (and the 2,949-LOC monster; sweep only, no split here)
  - token source of truth: `src/index.css` (104 existing `--brand-*`/`--c-*` custom properties, lines 38–87)
- **Method:** for each file, map every hex literal to the nearest existing semantic token; only add a new token to `index.css` when no existing one matches (avoid inventing near-duplicates). One file = one commit = one before/after screenshot pair.
- **Acceptance:** `grep -oE '#[0-9a-fA-F]{3,8}'` count per swept file drops to ~0 (allow a documented handful for one-off SVG stroke colors that have no semantic token, e.g. `#7a9bb5` in report SVGs); screenshot diff shows **zero visual change** for each committed file; `npm run build` still green.
- **Importance:** med · **Difficulty:** med (mechanical but high-volume; risk is silent color drift — screenshot diff is the guard).

### B5 — Table polish (header truncation, number alignment, filter row)
- **Files:** `src/components/DataTable/DataTable.css`, `src/components/DataTable/index.tsx`.
- **Known state:** `title` tooltips already exist on truncated cells (`index.tsx:753,990`); `.dt-filter-date { min-width: 240px }` exists; sticky-offset/column-order fix landed in `0b6b18b5`. **No per-column default `min-width`** exists (`grep minWidth` → nothing) — this is the VIS-06 root cause ("تار" truncation).
- **Work:** add sensible per-column default `min-width` (or a min-width floor keyed off header length) so Arabic date/label headers stop clipping; right-align (or use `text-align: end` in RTL) numeric columns and tabular-nums; make the filter row visually consistent across all column types (date/text/number filters share height, padding, border).
- **Acceptance:** no header shows a mid-word truncation like "تار" at 1280×800; numeric columns are consistently aligned with tabular figures; filter-row cells are uniform height; screenshot before/after on EmployeeWorkspace referrals table + one Reports table.
- **Importance:** med · **Difficulty:** low–med.

### B6 — Spacing-rhythm pass (adopt a spacing scale)
- **Files:** `src/index.css` (add `--space-*` scale — none exists today; the 104 tokens are all color/brand), then consumption in the pre-scale screens: `EmployeeWorkspace.css`, `Reports.css`, `Population.css`, `UserManagement.css`.
- **Work:** define a spacing scale (e.g. `--space-1:4px … --space-8:48px`), then replace ad-hoc `px` paddings/margins/gaps with scale tokens on the target screens. Reference `docs/UI_ENHANCEMENT_PLAN.md` Phase 1.
- **Acceptance:** `--space-*` tokens exist in `index.css`; the four target CSS files consume them for the majority of spacing declarations; no layout regression in screenshot diffs.
- **Importance:** low–med · **Difficulty:** med (subjective; needs eyeballing, easy to introduce drift — screenshot diff mandatory).

---

## Batch 2 — Product Completeness

**Items:** C1 (demo seed data), C2 (finish تقرير الإدارة management report), C3 (first-run admin checklist), C4 (verify — already done), C6 (label coverage audit).

**Sequencing:** independent of Batch 1; C2 is the largest. C1 and C3 both touch the workspace/first-run surface but don't conflict. C6 is isolated to App.tsx/WorkspaceGate. No hard ordering; do C2 first (biggest, gates a Reports-tab card).

### C1 — Seed demo data (internal-only)
- **Files:** `src/data/workspace/demoWorkspace.ts` (currently 23 LOC — seeds users only, via `createWorkspaceStructure(handle, "viewer")`; docblock line 14 anticipates "richer seeded data").
- **Scope (per decision — internal testing aid only):** minimal but realistic seed so no screen is blank — one month folder (e.g. `5-may-2026`) with a small population (~200 rows), a drawn sample, and partial answers, written into the in-memory `createMemoryDirectory` tree. Static viewer passcode (`"view"`, already in bundle); **no rotation logic.**
- **Acceptance:** entering demo mode shows a non-empty Population browse, a non-empty sample, at least one report renders with data, KPIs are non-zero; nothing writes to the user's disk (in-memory handle only); demo passcode unchanged.
- **Importance:** med · **Difficulty:** med (need to construct valid `population.final.json` / `sample.master.json` / answers shapes — reuse existing writers/fixtures rather than hand-rolling JSON).

### C2 — Finish تقرير الإدارة (management report) — BUILD NOW
- **Current state:** card renders **disabled** with `قريباً` / `قيد التطوير` at `src/components/Sidebar/Tabs/Reports/index.tsx:894–915` (`rh-card-disabled`, `rh-badge-soon`).
- **Work:** implement the management report as a real generated artifact and wire the card live (remove `rh-card-disabled`/disabled button, add an active generate handler like the executive/sample report buttons at `index.tsx:492–510`). Reuse the executive reporting infrastructure under `src/data/reporting/executive/` (model → document/deck builders, `esc()` primitives) — a management report is a summary cut of the same `ReportModel`, so build it as a new builder module (e.g. `src/data/reporting/management/`) or a new document variant rather than a from-scratch pipeline. Follow the self-contained-HTML + Arabic/RTL conventions and route all user data through `esc()`.
- **Acceptance:** the card is enabled when a month is selected; clicking it produces a self-contained Arabic RTL HTML management report with correct data for the selected month; print CSS works; all interpolated user data is escaped (add it to the D2 XSS test set); `npm run build` green.
- **Importance:** high (visible "coming soon" undermines the product) · **Difficulty:** high (a full new report surface, even if it reuses the model).

### C3 — First-run admin checklist
- **Files:** `src/data/workspace/WorkspaceGate.tsx` (first screen a new admin sees) — currently just a picker + "build structure" flow; zero onboarding code exists app-wide (`grep firstRun/onboarding/checklist` → 0).
- **Work:** on an empty/just-created workspace, for `role === "admin"`, show a light guided checklist: create structure → add users → set permissions → import first month, each item linking/deep-linking to the relevant tab and reflecting completion state (e.g. structure exists, ≥1 non-default user, ≥1 population month). Also surface the hidden Alt+A/Alt+T shortcuts somewhere discoverable.
- **Acceptance:** a fresh admin on an empty workspace sees an actionable checklist; each step navigates to the right place; the checklist auto-hides once the workspace has ≥1 imported month (or is dismissible); non-admins never see it.
- **Importance:** med · **Difficulty:** med.

### C4 — Verify error ring buffer (already fixed — confirmation only)
- **No code work expected.** Confirmed complete: `ErrorLogSection.tsx` gates on admin, lists `getRecentErrors()`, refresh + clear wired, mounted in Settings.
- **Acceptance:** re-confirm admin-only visibility, list renders recent errors, clear/refresh work. Optional low-value add: a "copy to clipboard" button (the only literal gap vs the audit's "+ copy button" wording). Recommend **drop from remaining scope** unless the copy button is wanted.
- **Importance:** low (done) · **Difficulty:** low.

### C6 — Label coverage audit (hard-coded Arabic → label keys)
- **Files:**
  - `src/App.tsx` — 10 hard-coded Arabic literals (e.g. line 164 `"وضع العرض التجريبي — للقراءة فقط…"`, line 227 `title="لا توجد تبويبات متاحة"`).
  - `src/data/workspace/WorkspaceGate.tsx` — ~30 hard-coded Arabic strings across every screen state (lines 95–358: `"متصفح غير مدعوم"`, `"اختر مساحة العمل"`, `"عنوان خاطئ"`, …).
  - target store: `src/data/labels/labelsStore.ts` (`DEFAULT_LABELS`), read via `getLabels()`/`useLabels()`.
- **Work:** add a label key per string to `DEFAULT_LABELS`, replace literals with `getLabels()` reads, subscribe with `useLabels()` where the component must re-render on override.
- **Acceptance:** `grep [أ-ي]` on `App.tsx` and `WorkspaceGate.tsx` returns ~0 inline literals (allow any deliberately-hardcoded brand words if justified); each new key overridable from Settings; no visible text change.
- **Importance:** med · **Difficulty:** low–med.

---

## Batch 3 — Tests

**Items:** D1 (component/workflow tests), D2 (XSS: audit escaping gaps + tests for all builders), D3 (import-mapping edge tests).

**Sequencing:** D2's small production audit (raw-interpolation check) should precede its tests. D1/D3 independent. All three use Vitest + `createMemoryDirectory()` from `src/data/storage/memoryDirectory.ts`; D1 additionally uses Testing Library (already installed: `@testing-library/react`, `user-event`, `jsdom`).

### D1 — Component/workflow tests
- **Current coverage (status table):** only `src/auth/AuthGate.test.tsx` (real RTL happy+fail), `DataTable/stickyColumns.test.tsx` (logic only), `ReferralApproval/useApprovalData.test.tsx` (hook). 5 of 6 workflow stages and both named characterization targets uncovered.
- **Work — 1 happy-path + 1 failure-path per workflow stage** across `import → process → sample → distribute → answer → report`, using `createMemoryDirectory()` for file I/O. Plus **characterization tests** for:
  - `src/components/DataTable/index.tsx` — full RTL render: filter, sort, column visibility, XLSX export path, truncation tooltip.
  - Population wizard (`src/components/Sidebar/Tabs/Population/`) — phase progression happy path + one failure (e.g. bad import).
- **Reuse:** existing data-layer test patterns (e.g. `populationProcessor.test.ts`, `sampleAlgorithm.test.ts`) for the non-UI stages; Testing Library only where a component render is the unit under test.
- **Acceptance:** each of the 6 stages has ≥1 happy + ≥1 failure test; DataTable and Population wizard have characterization tests that pin current behavior; `npm run test:run` green; coverage of the named surfaces demonstrably added.
- **Importance:** high · **Difficulty:** high (UI-render tests for RTL Arabic components + wizard state are the hardest tests in the repo).

### D2 — Report-builder escaping audit + XSS tests
- **Production audit first (narrow — escaping mostly exists, see Corrections):** sweep `src/data/reporting/executive/**` and `deck/deck2/slides.ts` for template-literal interpolations of *model/user* data that bypass `esc()`/`escText()`. Confirm each is either escaped or provably-static (e.g. `deck/slides.ts:106`). Close any real gap (add `esc()`). If the C2 management report is built, include it here.
- **Tests (the actual D1-of-audit gap):** add XSS tests injecting `<script>`, `"><img onerror>`, and quote-breaking payloads via **port names, employee display names, and answer/label fields** for:
  - `reportHtmlBuilder.ts` (Population, `escapeHtml`)
  - executive `buildExecutiveReport` (document path — `esc()` primitives)
  - `deck2` builder (and management report once it exists)
  - assert output contains `&lt;script&gt;` / escaped entities and never a live `<script>` or unescaped attribute break.
- **Acceptance:** a test file per builder proving injected HTML is escaped in output; any raw-interpolation gap found in the audit is fixed with a regression test; `npm run test:run` green.
- **Importance:** high · **Difficulty:** med (escaping largely present, so this is mostly writing tests + a small audit — **downgraded from the "missing production fix" framing in the task brief**).

### D3 — Import-mapping edge-case tests
- **Gap:** no test references `MappingSettingsModal`/column-mapping (`grep MappingSettings|columnMapping|mapColumns` in tests → 0). Adjacent `populationProcessor.test.ts` covers column preservation + BI/risk merge, but **not** the Excel-header mapping step.
- **Work:** unit-test the mapping layer for extra source columns (ignored, not merged blindly), missing required columns (surfaced, not silently dropped), and renamed columns (mapping applies / fails visibly). Locate the mapping function feeding `MappingSettingsModal` and test it directly (avoid a full modal render unless necessary).
- **Acceptance:** tests cover extra/missing/renamed columns with assertions that nothing is silently dropped and errors surface; `npm run test:run` green.
- **Importance:** med · **Difficulty:** med.

---

## Batch 4 — Release Engineering

**Items:** D4 (CI gating lint+test+build), D5 (vendor xlsx tarball), D7 (version stamp / release checklist), C5 (EDIT_LOG truncation at build).

**Sequencing (hard):** **D5 must land before D4.** CI runs `npm install`; while the xlsx dep points at the SheetJS CDN tarball, CI is fragile / can break on any CDN change. Vendor first, then make CI depend on a reproducible install. C5 (build-time truncation) should land before or with D4 so CI's `build` step exercises the truncation path. D7 is independent.

### D5 — Vendor the SheetJS xlsx tarball
- **Files:** `package.json` (currently `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`); add `vendor/xlsx-0.20.3.tgz` (no `vendor/` dir exists yet).
- **Work:** download the exact 0.20.3 tarball, commit it to `vendor/`, point `package.json` at `file:vendor/xlsx-0.20.3.tgz`. Keep the CLAUDE.md note (this dep is intentional, not an npm-registry package). Verify `npm install` + `npm run build` offline.
- **Acceptance:** `npm install` succeeds with network to the CDN blocked; build output unchanged; `dist/index.html` still builds and xlsx export works.
- **Importance:** high (unblocks reliable CI) · **Difficulty:** low.

### C5 — EDIT_LOG truncation at build time
- **Context:** `docs/EDIT_LOG.md` (~407 kB) is inlined into the bundle via a `?raw` import in the ChangeLog tab — it feeds bundle size directly (TEC-01). Decision: **truncate to recent versions at build time** (implementer picks cutoff — suggest last 20 versions or last 90 days).
- **Files:** the Vite config / a small build-time transform (`vite.config.ts`), and the ChangeLog tab's `?raw` import site (`src/components/Sidebar/Tabs/ChangeLog/index.tsx`). Also strip the 1 remaining NUL byte (TEC-02) while here + add a `.gitattributes` text rule.
- **Work:** a build-time step (Vite plugin or a `?raw` transform / pre-build script) that emits a truncated EDIT_LOG containing only the last N versions (with a "history truncated — see repo" footer) into the bundle, leaving the full file in git untouched.
- **Acceptance:** built `dist/index.html` contains only the truncated log (verify size drop); the full `docs/EDIT_LOG.md` in the repo is unchanged; ChangeLog tab still renders; no NUL bytes; `npm run build` green and smaller.
- **Importance:** med · **Difficulty:** med.

### D4 — CI workflow (typecheck + lint + test + build)
- **Files:** new `.github/workflows/ci.yml` (only `sbom.yml` exists today — SBOM-only, not a gate).
- **Work:** GitHub Actions on push + PR: `npm ci` (needs D5 for reproducibility) → `tsc -b` → `npm run lint` → `npm run test:run` → `npm run build`. Fail the job on any step. Cache `node_modules`.
- **Acceptance:** a PR with a lint error / failing test / type error / broken build is **blocked** by the workflow; a clean PR passes all four steps; workflow visible in Actions.
- **Importance:** high · **Difficulty:** low–med (depends on D5 landing first).

### D7 — Version stamp / release checklist
- **Current gap:** `package.json` version is placeholder `"1.0.0"` (not tied to EDIT_LOG v41.x/v42.x); no version display outside the ChangeLog "latest version" stat; no build-size log, no docs-sync checklist, no CHANGELOG cut.
- **Work:**
  - Surface a version stamp in the UI (Settings/About), sourced from a single place (e.g. `package.json` version bumped to match the EDIT_LOG scheme, or a generated `version.ts`).
  - Add a release checklist doc (`docs/RELEASE_CHECKLIST.md`): bump version, cut CHANGELOG from EDIT_LOG majors, record build size, run the docs-sync check (CLAUDE.md tab table / bundle-size note), tag.
  - Optional: a build-size log line appended per release.
- **Acceptance:** the running app shows a version that matches the release; a documented checklist exists; version has one source of truth.
- **Importance:** med · **Difficulty:** low–med.

---

## Batch 5 — Polish

**Items:** E1 (accessibility — focus traps), E2 (chart axis/legend print-CSS gap).

**Sequencing:** independent of each other and of earlier batches (though E2 overlaps the executive charts touched by B4 — do E2 after B4 to avoid CSS churn on the same files). E1 touches 8 dialog components.

### E1 — Accessibility pass (focus traps + a11y)
- **Current state:** `role="dialog"` in **8 files** — `AuthGate.tsx`, `ConfirmDialog.tsx`, `Archive/index.tsx`, `ReferralApproval/RequestList.tsx`, `ReviewModal.tsx`, `XrayReferrals.tsx`, `ReportDesigner/editor/FieldDropDialog.tsx`, `WorkspaceGate.tsx` — but **zero focus-trap implementations** (`grep focus-trap|focusTrap|trapFocus` → 0). Keyboard users can Tab out of any open modal into the background.
- **Work:** add a shared focus-trap utility/hook (trap Tab within the dialog, restore focus to the trigger on close, close on Escape, focus first focusable on open) and adopt it in all 8 dialogs. Add `aria-*` on icon-only buttons where missing. Run a contrast check on gold-on-navy / muted grays and record results.
- **Acceptance:** in each of the 8 dialogs, Tab cycles within the modal and cannot reach the background; Escape closes; focus returns to trigger; icon-only buttons have accessible names; a short contrast-audit note is recorded (no notes/tooling exist today).
- **Importance:** med · **Difficulty:** med (one shared hook, then 8 adoption sites — the hook is the hard part, adoption is mechanical).

### E2 — Chart axis/legend refinement (print CSS otherwise done)
- **Current state:** cover pages + print CSS are wired into the live path (`buildCover()` in `document/frontMatter.ts:24` → `buildDocumentSlides` → `buildExecutiveReport`; `@media print` in `htmlReport.ts:40`, `sampleReport.ts:143`, `executive/theme.ts:594`). The gap is chart **axis labels / legends**: `charts.ts` has 10 `<text>` elements but no dedicated axis/legend primitives — `rankedBar`, `gauge`, `donut`, `heatmap` show no explicit axis-label or legend refinement.
- **Files:** `src/data/reporting/executive/ui/charts.ts` (+ `tokens.ts` for any color/scale tokens; `theme.ts` print CSS if legend needs print styling).
- **Work:** add axis labels/ticks and a legend where the chart type needs one (grouped/series bars, donut categories), ensuring labels are `escText()`-escaped and render legibly in print. Keep charts pure-SVG, no runtime JS.
- **Acceptance:** series/grouped charts show a readable legend; bar/gauge charts show axis reference labels; legends/axes survive print (`@media print`); no regression to the empty-state path; labels escaped.
- **Importance:** low–med · **Difficulty:** med (hand-rolled SVG geometry).

---

## Batch dependency summary

```
Batch 1 (Visual)      B4 → B6-scaffold → B5 → B6-consume   (B4 gates B5; screenshot-diff each file)
Batch 2 (Complete)    C2 (biggest) · C1 · C3 · C6 · C4=verify-only   (independent of B1)
Batch 3 (Tests)       D2-audit → D2-tests · D1 · D3                  (uses createMemoryDirectory + RTL)
Batch 4 (Release)     D5 → {C5, D4} · D7                            (D5 MUST precede D4)
Batch 5 (Polish)      E1 · E2 (E2 after B4 to avoid CSS churn on charts)
```

Cross-batch note: **C2's management report should be added to the D2 XSS test set** (Batch 3) once built, and its output escaping verified there.

## Ratings at a glance (first pass — Fable to finalize)

| Item | Importance | Difficulty |
|---|---|---|
| B4 token sweep | med | med |
| B5 table polish | med | low–med |
| B6 spacing rhythm | low–med | med |
| C1 demo seed | med | med |
| C2 management report | high | high |
| C3 first-run checklist | med | med |
| C4 error buffer (verify) | low | low |
| C6 label coverage | med | low–med |
| D1 workflow/component tests | high | high |
| D2 escaping audit + XSS tests | high | med |
| D3 import-mapping tests | med | med |
| D4 CI gate | high | low–med |
| D5 vendor xlsx | high | low |
| D7 version/release | med | low–med |
| C5 EDIT_LOG truncation | med | med |
| E1 accessibility/focus traps | med | med |
| E2 chart axis/legend | low–med | med |
