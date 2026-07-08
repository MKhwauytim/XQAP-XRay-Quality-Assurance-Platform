# Approved hardening plan — 2026-07-08 (final, reviewed)

**Baseline:** `main` @ post referral-approval rework + Tier-1 W1–W9.
**Inputs:** `01-status-table.md` (ground-truth status of 16 items) → `02-unified-plan.md` (Opus draft) → this review pass (Fable).
**Status of this document:** FINAL. This is the execution plan. It is self-contained — implementers should not need to re-open the draft.

## What this review changed versus the draft

1. **Restored D6 (security-model doc), which the draft dropped.** The status table lists 15 open/partial items; the draft's batches covered only 14 of them. D6 (`docs/SECURITY_MODEL.md`) is now in Batch 4. Every non-done item from the status table is now accounted for: B4 B5 B6 (Batch 1) · C1 C3 C6 + decisions C2/C4-verify (Batch 2) · D1 D2 D3 (Batch 3) · D4 D5 D6 D7 + decision C5 (Batch 4) · E1 E2 (Batch 5).
2. **Recommended execution order: Batch 4 first.** D5 + D4 are cheap, and a CI gate (typecheck/lint/test/build) protects every subsequent batch — especially the high-volume CSS churn in Batch 1 and the test additions in Batch 3. Batch numbering is kept from the draft for traceability; the *recommended run order* is **4 → 1 → 2 → 3 → 5** (details in the dependency summary at the end).
3. **Tightened acceptance criteria** on B4 (regression guard), B5 (tabular-nums + Arabic-digit rendering), B6 (objective "no raw px" criterion), C1 (deterministic seed), C5 (ChangeLog stat must survive truncation), D4 (`npm ci` + lockfile + cache method), D7 (single version source via Vite `define`).
4. **Per-item model assignments** (Sonnet vs Opus) added. The draft suggested Opus for the whole Tests batch; this review confirms Opus for D1/D2 but **overrides D3 down to Sonnet** (narrow pure-function unit tests). Opus items overall: **C2, C3, D1, D2, E1**. Everything else: Sonnet.

## Corrections inherited from the draft (verified against source, supersede the status table)

- **D2 — escaping is NOT missing from the executive pipeline.** The status table grepped for `escapeHtml|sanitiz` and missed differently-named helpers: `esc()` in `src/data/reporting/executive/primitives.ts:5` (applied in `kpiCard`, `barRow`, `dataTable`, `statPill`, `pagePanel`, `radarSvg`, `badgeHtml`), `esc()` routing of every title/eyebrow/subtitle/note/chip in `executive/document/shared.ts`, `escText()` in `executive/ui/charts.ts:16`, `esc(p.name)` throughout `executive/deck2/slides.ts`, and `escapeHtml()` in the Population `reportHtmlBuilder.ts`. **D2 is a test-coverage gap plus a narrow audit for raw interpolations that bypass the primitives** (e.g. `deck/slides.ts:106` `<h4>${it.title}</h4>` — currently static, must be confirmed), not a missing-escaping production bug.
- **C4 is fully complete.** `Settings/ErrorLogSection.tsx` gates on `role === "admin"`, lists `getRecentErrors()` with refresh + clear, and is mounted in Settings. Verify-only; the optional copy-to-clipboard button is dropped from scope.

---

## Batch 1 — Visual System

**Items:** B4 (CSS token sweep), B5 (table polish), B6 (spacing-rhythm pass).

**Sequencing (hard):**
- **B4 must land fully before B5** — B5 edits the same DataTable/Reports/EmployeeWorkspace CSS files; sequencing keeps the screenshot-diff signal clean.
- **B6 token scaffold** (adding `--space-*` to `index.css`) can happen any time; **B6 consumption** edits must follow B4 per-file to avoid double-diffing.
- Order within batch: B4 (per file) → B6 token scaffold → B5 → B6 consumption.

### B4 — Token sweep per CSS file (hex → `var(--…)`)
- **Assigned model: Sonnet** — mechanical, high-volume, guarded by screenshot diffs and an exact-value mapping rule.
- **Files (worst offenders first, one file per commit):**
  - `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css` — **310** hex literals
  - `src/components/Sidebar/Tabs/Reports/Reports.css` — **197**
  - `src/components/DataTable/DataTable.css` — **133**
  - `src/components/Sidebar/Tabs/Population/Population.css` — **127** (also the 2,949-LOC monster; sweep only, no file split here)
  - Token source of truth: `src/index.css` (104 existing `--brand-*`/`--c-*` custom properties, lines 38–87).
- **Method:** map every hex literal to an existing semantic token **whose resolved value is byte-identical to the literal being replaced** — never "nearest color", which silently drifts. Where no exact-match token exists, either add a new token to `index.css` (if the color is reused ≥2 times) or leave the literal with a `/* no-token: one-off */` comment. One file = one commit = one before/after screenshot pair.
- **Enhancement (regression guard):** add a tiny script (e.g. `scripts/check-hex-literals.mjs`) that counts raw hex literals in the four swept files and fails if the count exceeds the committed baseline; wire it into D4's CI once available. Without this the sweep decays — the status table showed the counts *grew* since the audit (287→310, 183→197).
- **Acceptance:** `grep -oE '#[0-9a-fA-F]{3,8}'` per swept file drops to ~0 (documented `no-token` exceptions allowed, e.g. one-off SVG strokes like `#7a9bb5`); screenshot diff shows **zero visual change** per committed file; guard script passes; `npm run build` green.
- **Importance:** med · **Difficulty:** med.

### B5 — Table polish (header truncation, number alignment, filter row)
- **Assigned model: Sonnet** — well-scoped CSS/component tweaks in two files.
- **Files:** `src/components/DataTable/DataTable.css`, `src/components/DataTable/index.tsx`.
- **Known state:** `title` tooltips already exist on truncated cells (`index.tsx:753,990`); `.dt-filter-date { min-width: 240px }` exists; sticky-offset/column-order fix landed in `0b6b18b5`. **No per-column default `min-width`** exists — this is the VIS-06 root cause ("تار" truncation).
- **Work:** add sensible per-column default `min-width` (or a floor keyed off header length) so Arabic date/label headers stop clipping; align numeric columns with `text-align: end` (RTL-correct — do not hard-code `right`) plus `font-variant-numeric: tabular-nums`; make the filter row visually consistent across all column types (date/text/number filters share height, padding, border).
- **Enhancement (RTL numerals):** verify tabular-nums renders correctly with the digits actually in use — if any locale/formatting path emits Arabic-Indic digits (٠١٢٣), confirm the font's tabular feature covers them; note the result in the commit message.
- **Acceptance:** no header shows a mid-word truncation like "تار" at 1280×800; numeric columns consistently end-aligned with tabular figures; filter-row cells uniform height; before/after screenshots on the EmployeeWorkspace referrals table + one Reports table.
- **Importance:** med · **Difficulty:** low–med.

### B6 — Spacing-rhythm pass (adopt a spacing scale)
- **Assigned model: Sonnet** — mechanical once the scale is defined; screenshot diffs guard drift.
- **Files:** `src/index.css` (add `--space-*` scale — none exists today; all 104 tokens are color/brand), then consumption in the pre-scale screens: `EmployeeWorkspace.css`, `Reports.css`, `Population.css`, `UserManagement.css`.
- **Work:** define a spacing scale (e.g. `--space-1: 4px … --space-8: 48px`), then replace ad-hoc `px` paddings/margins/gaps with scale tokens on the target screens. Reference `docs/UI_ENHANCEMENT_PLAN.md` Phase 1. Snap off-scale values to the nearest step **only when the visual delta is ≤2px**; otherwise keep the literal with a `/* no-scale */` comment.
- **Acceptance (tightened from the draft's subjective "majority"):** `--space-*` tokens exist in `index.css`; in the four target files, **no raw `px` value remains in `padding`/`margin`/`gap` declarations except lines carrying a `/* no-scale */` justification**; no layout regression in screenshot diffs.
- **Importance:** low–med · **Difficulty:** med.

---

## Batch 2 — Product Completeness

**Items:** C1 (demo seed data), C2 (finish تقرير الإدارة management report), C3 (first-run admin checklist), C4 (verify-only — already done), C6 (label coverage audit).

**Sequencing:** independent of Batch 1. C2 is the largest — start it first (it gates a visible Reports-tab card and feeds the D2 test set). C1 and C3 both touch the workspace/first-run surface but don't conflict. C6 is isolated to `App.tsx`/`WorkspaceGate.tsx`.

### C1 — Seed demo data (internal-only)
- **Assigned model: Sonnet** — low correctness stakes (internal demo aid), well-scoped, with an explicit reuse constraint below.
- **Files:** `src/data/workspace/demoWorkspace.ts` (currently 23 LOC — seeds users only via `createWorkspaceStructure(handle, "viewer")`; docblock line 14 already anticipates richer seeding).
- **Scope (per decision — internal testing aid only):** minimal but realistic seed so no screen is blank — one month folder (`5-may-2026`) with a small population (~200 rows), a drawn sample, and partial answers, written into the in-memory `createMemoryDirectory` tree. Static viewer passcode (`"view"`, already in bundle); **no rotation logic.**
- **Hard constraint:** construct the JSON **through the existing writers/domain functions** (population save path, `sampleAlgorithm`, distribution/answers writers) — do not hand-roll `population.final.json` / `sample.master.json` shapes, which will silently rot when schemas move.
- **Enhancement (determinism):** seed the sample draw with a **fixed RNG seed string** so demo mode renders identically every run — stable screenshots, stable smoke tests, no flaky demo KPIs.
- **Acceptance:** entering demo mode shows a non-empty Population browse, a non-empty sample, at least one report renders with data, KPIs non-zero; two consecutive demo entries produce identical data; nothing writes to the user's disk (in-memory handle only); demo passcode unchanged.
- **Importance:** med · **Difficulty:** med.

### C2 — Finish تقرير الإدارة (management report) — BUILD NOW
- **Assigned model: Opus** — highest-risk item in the plan: a full new report surface, Arabic/RTL print output, security-relevant (all interpolation must route through `esc()`), and cross-cutting into Reports UI + the D2 test set.
- **Current state:** card renders **disabled** with `قريباً` / `قيد التطوير` at `src/components/Sidebar/Tabs/Reports/index.tsx:894–915` (`rh-card-disabled`, `rh-badge-soon`).
- **Work:** implement the management report as a real generated artifact and wire the card live (remove `rh-card-disabled`/disabled button; add an active generate handler modeled on the executive/sample report buttons at `index.tsx:492–510`). Reuse the executive reporting infrastructure under `src/data/reporting/executive/` (model → document/deck builders, `esc()` primitives) — a management report is a summary cut of the same `ReportModel`, so build it as a new builder module (e.g. `src/data/reporting/management/`) or a new document variant, not a from-scratch pipeline. Self-contained HTML, Arabic, RTL; all user data through `esc()`.
- **Enhancement (definition gate):** before coding, write a 10-line content outline (which KPIs/sections the management cut includes vs the executive report) and get it confirmed — "management report" is the one item here whose *content* is otherwise undefined, and that ambiguity is the real schedule risk, not the plumbing.
- **Acceptance:** card enabled when a month is selected; clicking produces a self-contained Arabic RTL HTML management report with correct data for the selected month; print CSS works; all interpolated user data escaped **and the builder is added to the D2 XSS test set (Batch 3)**; `npm run build` green.
- **Importance:** high (visible "coming soon" undermines the product) · **Difficulty:** high.

### C3 — First-run admin checklist
- **Assigned model: Opus** — cross-cutting: deep-links into the tab system, derives completion state from workspace contents, and gates on role; UX judgment calls throughout.
- **Files:** `src/data/workspace/WorkspaceGate.tsx` (first screen a new admin sees); zero onboarding code exists app-wide (`grep firstRun/onboarding/checklist` → 0).
- **Work:** on an empty/just-created workspace, for `role === "admin"` only, show a light guided checklist: create structure → add users → set permissions → import first month, each item deep-linking to the relevant tab and reflecting real completion state (structure exists, ≥1 non-default user, ≥1 population month). Surface the hidden Alt+A/Alt+T shortcuts somewhere discoverable.
- **Enhancement (dismissal persistence):** persist manual dismissal in `localStorage` (keyed per workspace name/handle where possible) so the checklist doesn't resurrect on every reload before the first month is imported; auto-hide remains state-driven.
- **Acceptance:** a fresh admin on an empty workspace sees an actionable checklist; each step navigates to the right place; checklist auto-hides once the workspace has ≥1 imported month and stays dismissed across reloads if manually dismissed; non-admins never see it.
- **Importance:** med · **Difficulty:** med.

### C4 — Verify error ring buffer (already fixed — confirmation only)
- **Assigned model: Sonnet** — a 5-minute manual verification, no code.
- **No code work.** Confirmed complete: `ErrorLogSection.tsx` gates on admin, lists `getRecentErrors()`, refresh + clear wired, mounted in Settings.
- **Acceptance:** re-confirm admin-only visibility, list renders recent errors, clear/refresh work. The optional copy-to-clipboard button is **dropped from scope**.
- **Importance:** low (done) · **Difficulty:** low.

### C6 — Label coverage audit (hard-coded Arabic → label keys)
- **Assigned model: Sonnet** — mechanical extraction into an established pattern (`DEFAULT_LABELS` + `getLabels()`/`useLabels()`).
- **Files:**
  - `src/App.tsx` — 10 hard-coded Arabic literals (e.g. line 164 `"وضع العرض التجريبي — للقراءة فقط…"`, line 227 `title="لا توجد تبويبات متاحة"`).
  - `src/data/workspace/WorkspaceGate.tsx` — ~30 hard-coded Arabic strings across every screen state (lines 95–358).
  - Target store: `src/data/labels/labelsStore.ts` (`DEFAULT_LABELS`).
- **Work:** add a label key per string to `DEFAULT_LABELS`, replace literals with `getLabels()` reads, subscribe with `useLabels()` where the component must re-render on override. **Caution:** `WorkspaceGate` renders *before* a workspace exists — confirm the labels store (localStorage-backed) is safely readable in every WorkspaceGate state, including `unsupported_browser`.
- **Acceptance:** `grep [أ-ي]` on `App.tsx` and `WorkspaceGate.tsx` returns ~0 inline literals (deliberately-hardcoded brand words allowed if justified); each new key overridable from Settings; zero visible text change.
- **Importance:** med · **Difficulty:** low–med.

---

## Batch 3 — Tests

**Items:** D1 (component/workflow tests), D2 (XSS: audit escaping gaps + tests for all builders), D3 (import-mapping edge tests).

**Sequencing:** D2's small production audit (raw-interpolation check) precedes its tests. D1/D3 independent. All three use Vitest + `createMemoryDirectory()` (`src/data/storage/memoryDirectory.ts`); D1 additionally uses Testing Library (already installed: `@testing-library/react`, `user-event`, `jsdom`). Run this batch **after** Batch 2 so the C2 management-report builder exists and lands inside the D2 test net.

### D1 — Component/workflow tests
- **Assigned model: Opus** — the hardest tests in the repo: RTL Arabic component renders, wizard state machines, and judgment about what behavior to pin in characterization tests.
- **Current coverage:** only `src/auth/AuthGate.test.tsx` (real RTL happy+fail), `DataTable/stickyColumns.test.tsx` (logic only), `ReferralApproval/useApprovalData.test.tsx` (hook). 5 of 6 workflow stages and both named characterization targets uncovered.
- **Work — 1 happy-path + 1 failure-path per workflow stage** across `import → process → sample → distribute → answer → report`, using `createMemoryDirectory()` for file I/O. Plus **characterization tests** for:
  - `src/components/DataTable/index.tsx` — full RTL render: filter, sort, column visibility, XLSX export path, truncation tooltip.
  - Population wizard (`src/components/Sidebar/Tabs/Population/`) — phase progression happy path + one failure (e.g. bad import).
- **Reuse:** existing data-layer test patterns (`populationProcessor.test.ts`, `sampleAlgorithm.test.ts`) for non-UI stages; Testing Library only where a component render is the unit under test.
- **Enhancement (Excel-parse boundary):** the import stage runs in a Web Worker in production (`src/workers/workbookWorker.ts`), which Vitest's node env cannot execute — test the parse/mapping functions the worker delegates to directly, and state that boundary explicitly in the test file header so nobody mistakes it for full worker coverage.
- **Acceptance:** each of the 6 stages has ≥1 happy + ≥1 failure test; DataTable and Population wizard have characterization tests pinning current behavior; `npm run test:run` green; coverage of the named surfaces demonstrably added.
- **Importance:** high · **Difficulty:** high.

### D2 — Report-builder escaping audit + XSS tests
- **Assigned model: Opus** — the audit half requires judgment (distinguishing provably-static interpolations from user-data paths across four builder pipelines); a missed gap here is a shipped XSS in a report that gets emailed around.
- **Production audit first (narrow — escaping mostly exists, see Corrections above):** sweep `src/data/reporting/executive/**` and `deck/deck2/slides.ts` for template-literal interpolations of *model/user* data that bypass `esc()`/`escText()`. Confirm each is either escaped or provably static (e.g. `deck/slides.ts:106`); close any real gap with `esc()`. Include the C2 management-report builder.
- **Tests:** inject `<script>`, `"><img onerror>`, and quote-breaking payloads via **port names, employee display names, and answer/label fields** for:
  - `reportHtmlBuilder.ts` (Population, `escapeHtml`)
  - executive `buildExecutiveReport` (document path — `esc()` primitives)
  - `deck2` builder
  - the C2 management report
  - assert output contains escaped entities (`&lt;script&gt;`) and never a live `<script>` or an unescaped attribute break.
- **Enhancement (shared fixture):** define the payload list once in a shared test fixture (e.g. `src/data/reporting/xssPayloads.ts` or a test util) so all four builder test files exercise the identical corpus and new builders adopt it by import, not copy-paste.
- **Acceptance:** a test file per builder proving injected HTML is escaped in output; any raw-interpolation gap found in the audit is fixed with a regression test; `npm run test:run` green.
- **Importance:** high · **Difficulty:** med (escaping largely present — mostly tests + a small audit).

### D3 — Import-mapping edge-case tests
- **Assigned model: Sonnet** — *override of the draft's batch-wide Opus suggestion:* this is narrow unit testing of a pure mapping function with a crisp spec (extra/missing/renamed columns); no rendering, no cross-cutting judgment. If the mapping function turns out to be inseparable from the modal component, escalate back to Opus.
- **Gap:** no test references `MappingSettingsModal`/column-mapping. Adjacent `populationProcessor.test.ts` covers column preservation + BI/risk merge, but **not** the Excel-header mapping step.
- **Work:** unit-test the mapping layer for extra source columns (ignored, not merged blindly), missing required columns (surfaced, not silently dropped), and renamed columns (mapping applies / fails visibly). Locate the mapping function feeding `MappingSettingsModal` and test it directly — avoid a full modal render unless unavoidable.
- **Acceptance:** tests cover extra/missing/renamed columns with assertions that nothing is silently dropped and errors surface; `npm run test:run` green.
- **Importance:** med · **Difficulty:** med.

---

## Batch 4 — Release Engineering *(recommended to execute FIRST — see run order)*

**Items:** D5 (vendor xlsx tarball), D4 (CI gating), C5 (EDIT_LOG truncation at build), D6 (security-model doc — **restored**, dropped by the draft), D7 (version stamp / release checklist).

**Sequencing (hard):** **D5 must land before D4** — CI runs `npm ci`, and while the xlsx dep points at the SheetJS CDN tarball, CI is fragile against any CDN change. C5 should land before or with D4 so CI's build step exercises the truncation path. D6 and D7 are independent.

### D5 — Vendor the SheetJS xlsx tarball
- **Assigned model: Sonnet** — mechanical: download, commit, repoint, verify.
- **Files:** `package.json` (currently `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`); add `vendor/xlsx-0.20.3.tgz` (no `vendor/` dir exists yet).
- **Work:** download the exact 0.20.3 tarball, commit to `vendor/`, point `package.json` at `file:vendor/xlsx-0.20.3.tgz`. Regenerate `package-lock.json` and confirm the lock entry now references the file path. Update the CLAUDE.md dependency note to reflect vendoring (the "don't upgrade to the stale npm package" warning stays). SheetJS is Apache-2.0 — redistribution in-repo is fine; note the license in a one-line `vendor/README` entry.
- **Acceptance:** `npm install` succeeds with network to the CDN blocked; build output unchanged; `dist/index.html` still builds and xlsx export works; lockfile committed and consistent.
- **Importance:** high (unblocks reliable CI) · **Difficulty:** low.

### C5 — EDIT_LOG truncation at build time
- **Assigned model: Sonnet** — a contained Vite build transform with clear acceptance.
- **Context:** `docs/EDIT_LOG.md` (~407 kB) is inlined into the bundle via a `?raw` import in the ChangeLog tab and feeds bundle size directly (TEC-01). Decision: truncate to recent versions at build time (suggest last 20 versions or last 90 days — implementer picks and documents).
- **Files:** `vite.config.ts` (a small plugin or `?raw` transform / pre-build script) + the import site `src/components/Sidebar/Tabs/ChangeLog/index.tsx`. Also strip the 1 remaining NUL byte (TEC-02) and add a `.gitattributes` text rule while here.
- **Work:** emit a truncated EDIT_LOG containing only the last N versions (with a "history truncated — see repo" footer, in Arabic per UI conventions) into the bundle; the full file in git stays untouched.
- **Enhancement (parser guard):** the ChangeLog tab computes a "latest version" stat from the log text — verify that stat and any other parsing in `ChangeLog/index.tsx` still work against the truncated content, and that the truncation cuts on a version-entry boundary (`## v…` heading), never mid-entry.
- **Acceptance:** built `dist/index.html` contains only the truncated log (verify size drop, record before/after kB); repo `docs/EDIT_LOG.md` unchanged; ChangeLog tab renders and its stats are correct; truncation lands on an entry boundary; no NUL bytes; `npm run build` green and smaller.
- **Importance:** med · **Difficulty:** med.

### D4 — CI workflow (typecheck + lint + test + build)
- **Assigned model: Sonnet** — standard GitHub Actions plumbing.
- **Files:** new `.github/workflows/ci.yml` (only `sbom.yml` exists today — SBOM-only, not a gate).
- **Work:** GitHub Actions on push + PR: `npm ci` (requires D5 + committed lockfile) → `tsc -b` → `npm run lint` → `npm run test:run` → `npm run build`. Fail the job on any step. Use `actions/setup-node` with `cache: npm` (cache the npm cache, **not** `node_modules` — caching `node_modules` across lockfile changes is a classic false-green source). If B4's hex-guard script exists by then, add it as a step.
- **Note:** dev happens on Windows; CI runs `ubuntu-latest` — watch for path-separator or line-ending assumptions in tests (the `.gitattributes` rule from C5 helps).
- **Acceptance:** a PR with a lint error / failing test / type error / broken build is blocked by the workflow; a clean PR passes all steps; workflow visible in Actions.
- **Importance:** high · **Difficulty:** low–med.

### D6 — Security-model doc (`docs/SECURITY_MODEL.md`) — RESTORED (dropped by the draft)
- **Assigned model: Sonnet** — a one-page doc consolidating already-written content.
- **Current state (status table):** partially fixed — CLAUDE.md now carries the "Security model — advisory only" paragraph (client-only trust boundary, bundled admin hash, not a defense against malicious insiders), but the dedicated one-page risk-acceptance doc the audit called for does not exist, and the viewer-passcode (TEC-06) note + passcode policy are not restated in one place.
- **Work:** create `docs/SECURITY_MODEL.md` as the single risk-acceptance page: trust boundary statement, bundled bootstrap-admin hash exposure + passcode-strength policy, demo/viewer static passcode (TEC-06) acceptance, localStorage/JSON tamperability, and an explicit "accepted by / date" line. Link it from the CLAUDE.md security paragraph rather than duplicating prose (CLAUDE.md keeps the summary, the doc holds the full acceptance).
- **Acceptance:** the doc exists, covers all four risk areas + TEC-06 + passcode policy, carries an acceptance line, and CLAUDE.md references it; no code changes.
- **Importance:** med (audit-trail hygiene; cheap) · **Difficulty:** low.

### D7 — Version stamp / release checklist
- **Assigned model: Sonnet** — small plumbing + a checklist doc.
- **Current gap:** `package.json` version is placeholder `"1.0.0"` (not tied to EDIT_LOG v41.x/v42.x); no version display outside the ChangeLog "latest version" stat; no build-size log, docs-sync checklist, or CHANGELOG cut.
- **Work:**
  - **Single source of truth:** bump `package.json` version to match the EDIT_LOG scheme and inject it at build via Vite `define` (e.g. `__APP_VERSION__` from `package.json`) — no hand-maintained `version.ts` that can drift.
  - Surface the stamp in the UI (Settings/About area).
  - Add `docs/RELEASE_CHECKLIST.md`: bump version, cut CHANGELOG from EDIT_LOG majors, record build size, run the docs-sync check (CLAUDE.md tab table / bundle-size note), tag.
  - Optional: a build-size log line appended per release.
- **Acceptance:** the running app shows a version that matches `package.json`; a documented checklist exists; version has exactly one source of truth (grep confirms no second hardcoded version string).
- **Importance:** med · **Difficulty:** low–med.

---

## Batch 5 — Polish

**Items:** E1 (accessibility — focus traps), E2 (chart axis/legend refinement).

**Sequencing:** independent of each other; E2 must follow B4 (Batch 1) to avoid CSS churn on the same chart files. E1 touches 8 dialog components.

### E1 — Accessibility pass (focus traps + a11y)
- **Assigned model: Opus** — the shared focus-trap hook is genuinely fiddly (focus restore, Escape semantics, first-focusable detection, RTL/portal edge cases, the WorkspaceGate dialog existing pre-workspace); a subtly wrong trap is worse than none. The 8 adoption sites are mechanical once the hook is right — Opus may hand those off, but the item ships as one unit.
- **Current state:** `role="dialog"` in **8 files** — `AuthGate.tsx`, `ConfirmDialog.tsx`, `Archive/index.tsx`, `ReferralApproval/RequestList.tsx`, `ReviewModal.tsx`, `XrayReferrals.tsx`, `ReportDesigner/editor/FieldDropDialog.tsx`, `WorkspaceGate.tsx` — but **zero focus-trap implementations**. Keyboard users can Tab out of any open modal into the background.
- **Work:** one shared focus-trap hook (trap Tab within the dialog, restore focus to trigger on close, close on Escape, focus first focusable on open, handle Shift+Tab wrap) adopted in all 8 dialogs. Add `aria-*` to icon-only buttons where missing. Run a contrast check on gold-on-navy / muted grays and record results.
- **Enhancement (test the hook):** add a Testing Library test for the hook itself (Tab wraps, Shift+Tab wraps backward, Escape closes, focus restores) — one test protects all 8 adoption sites and slots into the D1 test suite.
- **Acceptance:** in each of the 8 dialogs, Tab cycles within the modal and cannot reach the background; Escape closes; focus returns to trigger; icon-only buttons have accessible names; the hook has a unit test; a short contrast-audit note is recorded.
- **Importance:** med · **Difficulty:** med.

### E2 — Chart axis/legend refinement (print CSS otherwise done)
- **Assigned model: Sonnet** — contained to the chart primitives file; fiddly SVG geometry but low stakes, well-scoped, and the escaping rule is explicit.
- **Current state:** cover pages + print CSS are already wired into the live path (`buildCover()` in `document/frontMatter.ts:24` → `buildDocumentSlides` → `buildExecutiveReport`; `@media print` in `htmlReport.ts:40`, `sampleReport.ts:143`, `executive/theme.ts:594`). The remaining gap is chart **axis labels / legends**: `charts.ts` has 10 `<text>` elements but no axis/legend primitives — `rankedBar`, `gauge`, `donut`, `heatmap` show no explicit axis-label or legend work.
- **Files:** `src/data/reporting/executive/ui/charts.ts` (+ `tokens.ts` for color/scale tokens; `theme.ts` if legends need print styling).
- **Work:** add axis labels/ticks and a legend where the chart type warrants (grouped/series bars, donut categories); all labels `escText()`-escaped; legible in print; RTL-aware label placement. Keep charts pure-SVG, no runtime JS.
- **Acceptance:** series/grouped charts show a readable legend; bar/gauge charts show axis reference labels; legends/axes survive print; no regression to the empty-state path; labels escaped (covered by the D2 test files where applicable).
- **Importance:** low–med · **Difficulty:** med.

---

## Dependency summary & recommended run order

```
RECOMMENDED RUN ORDER:  Batch 4 → Batch 1 → Batch 2 → Batch 3 → Batch 5

Batch 4 (Release)   D5 → {C5, D4} · D6 · D7        (D5 MUST precede D4; run this batch FIRST —
                                                     CI then guards all subsequent work)
Batch 1 (Visual)    B4 → B6-scaffold → B5 → B6-consume   (B4 gates B5; screenshot-diff every file;
                                                          hex-guard script feeds back into D4 CI)
Batch 2 (Complete)  C2 (start first, biggest) · C1 · C3 · C6 · C4=verify-only
Batch 3 (Tests)     D2-audit → D2-tests · D1 · D3   (after Batch 2 so C2's builder is in the XSS net)
Batch 5 (Polish)    E1 · E2                          (E2 after B4 to avoid chart-CSS churn)
```

Cross-batch notes:
- **C2 → D2:** the management-report builder joins the D2 XSS test set once built.
- **B4 → D4:** the hex-literal guard script becomes a CI step.
- **E1 → D1:** the focus-trap hook test lives alongside the D1 component suite.

## Final ratings & model assignments at a glance

| Item | Importance | Difficulty | Assigned model |
|---|---|---|---|
| B4 token sweep | med | med | Sonnet |
| B5 table polish | med | low–med | Sonnet |
| B6 spacing rhythm | low–med | med | Sonnet |
| C1 demo seed | med | med | Sonnet |
| C2 management report | high | high | **Opus** |
| C3 first-run checklist | med | med | **Opus** |
| C4 error buffer (verify-only) | low | low | Sonnet |
| C6 label coverage | med | low–med | Sonnet |
| D1 workflow/component tests | high | high | **Opus** |
| D2 escaping audit + XSS tests | high | med | **Opus** |
| D3 import-mapping tests | med | med | Sonnet *(override of draft's batch-wide Opus)* |
| D4 CI gate | high | low–med | Sonnet |
| D5 vendor xlsx | high | low | Sonnet |
| D6 security-model doc *(restored)* | med | low | Sonnet |
| D7 version/release | med | low–med | Sonnet |
| C5 EDIT_LOG truncation | med | med | Sonnet |
| E1 accessibility/focus traps | med | med | **Opus** |
| E2 chart axis/legend | low–med | med | Sonnet |
