# Full System Audit — Prototype → Final Product Plan

**Date:** 2026-07-02
**Auditor:** Claude (Fable 5), driving the live app in Chromium + full code sweep
**Baseline:** `main` @ `b50e2de7` (clean tree) · EDIT_LOG v37.7
**Scope:** Everything — code, logic, UI, UX, visual consistency, data mapping/processing, product gaps — plus a consolidated plan to reach "final product".

This document **extends** (does not replace):
- `docs/audit/MASTER_AUDIT_REPORT.md` (2026-06-28 code-health audit — SEC/DOC/ERR/ARC/TEST/OPS/DATA findings)
- `docs/superpowers/plans/2026-06-28-production-readiness.md` (Phases 0–9 hardening plan)
- `docs/UI_ENHANCEMENT_PLAN.md` (2026-07-01 visual polish plan, Phases 1–4)

---

## 0. Verdict

**The engineering core is healthy; the product shell is not finished.**

| Gate | Result (2026-07-02) |
|------|---------------------|
| `tsc --noEmit` | ✅ 0 errors |
| `eslint src --max-warnings 0` | ✅ clean |
| `vitest run` | ✅ **282 tests, 42 files** (up from 119/25 on 06-28) |
| `vite build` | ✅ single-file `dist/index.html` — **2,614 kB / 835 kB gzip** (up from 1,900/664) |

The data layer, sampling math, distribution log, persistence safety, and auth flow are solid and well-tested. What separates this from a final product is: **one real logic bug (demo session), a set of visual/layout bugs verified in the browser, inconsistent UX patterns (empty states, confirmations, off-brand screens), missing UI-level test coverage, no CI, and stale docs.**

Current rating (unchanged): **Internal testing ready.** Target of this plan: **Controlled production ready → Final product.**

---

## 1. Method (evidence, not guesswork)

- Ran all four quality gates (results above).
- Drove the running app in Chromium (demo workspace + admin session): every tab, every sub-tab, screenshots at 1440×900 and 1280×800.
- Verified suspected bugs programmatically (e.g. `elementFromPoint` for the banner overlap; `sessionStorage`/`localStorage` probes for the session bug).
- Code sweep: confirmation dialogs, StateViews adoption, design-token discipline (hex-color census per CSS file), MANAGED_TABS sync, EDIT_LOG NUL bytes, test-file inventory.

---

## 2. New findings register

IDs continue the existing scheme. Severity: Critical / High / Medium / Low.

### Logic bugs

**LOG-01 — Demo session has two sources of truth; permissions collapse to "guest" (High, Confirmed)**
- **Where:** `src/auth/AuthGate.tsx` (~line 166–175) vs `src/auth/authSession.ts`, consumed by `src/auth/usePermissions.ts:48–49`.
- **What:** The demo/viewer auto-login sets the session **only in AuthGate React state** (`setSession({...})`), never via `writeSession()`. Every permission consumer calls `readSession()` from the `authSession` module, which returns `null` → `usePermissions` returns the guest fallback (`canAccessTab: () => false`).
- **Observed effect (browser-verified):** In genuine demo mode the sidebar shows all admin tabs (App.tsx filters using the *prop* session) but almost every tab body renders `TabGuard`'s "غير مصرح". Demo mode is effectively broken: navigation advertises 9 sections, ~7 render an access-denied page.
- **Fix:** Route the demo session through `writeSession()` (mode `"demo"` already exists on the type and write-blocking already keys off it), or make `usePermissions` accept the session via context. One source of truth; add a regression test: demo session → `canAccessTab("population") === true`.

**LOG-02 — Sidebar shows tabs the current role cannot open (Medium, Confirmed)**
- **Where:** `App.tsx` `allowedTabs` (session prop + matrix) vs per-tab `TabGuard`s (module session).
- **What:** Beyond LOG-01, the two checks can disagree whenever their inputs differ (role-preview edge cases, future drift). Policy is also undecided: forbidden destinations should be **hidden** (current intent), never "visible but denied".
- **Fix:** After LOG-01, derive sidebar visibility and content-guarding from the same `usePermissions` result. Add a test asserting: any tab visible in the sidebar renders without `AccessDenied` for that role.

### Visual / functional bugs (browser-verified)

**VIS-01 — Demo banner overlays the session toolbar; logout is unclickable (High)**
- **Where:** `App.tsx` demo banner (`position: fixed`, `z-index: 9999`, top 0) + the AuthGate toolbar rendered in the same top strip.
- **Evidence:** `elementFromPoint` at the logout button's center returns the banner `div`; the button (and the current-mode text, top-left controls, search strip) are visually clipped and unreachable by mouse in demo mode.
- **Fix:** Give the app shell a top offset when the banner is shown (e.g. `padding-top` on the shell equal to banner height), or render the banner *inside* the flow above the toolbar instead of fixed-over-everything.

**VIS-02 — Page-permissions matrix clips the "مدير" column with no horizontal scroll (High)**
- **Where:** `UserManagement` → صلاحيات الصفحات table, `UserManagement.css`.
- **Evidence:** At 1440×900 the manager column is half-clipped at the viewport edge; at 1280×800 (common laptop) it is **entirely invisible** — an admin cannot see or set manager permissions at that width.
- **Fix:** `overflow-x: auto` on the matrix container + `min-width` on the table, or a responsive collapse (role picker + single-role column) below a breakpoint.

**VIS-03 — English changelog prose renders RTL; punctuation lands on the wrong side (Medium)**
- **Where:** `Tabs/ChangeLog/index.tsx` markdown rendering.
- **Evidence:** Entry bodies (English commit prose) display as ".Implements Task 5 …" — the terminal period leads the line; every English paragraph is right-aligned inside the RTL container.
- **Fix:** Wrap entry bodies with `dir="auto"` (or detect-and-set `dir="ltr"` for Latin-dominant blocks) + `text-align: start`.

**VIS-04 — Numeral-system inconsistency (Low)**
- **Where:** ChangeLog stat "إجمالي الإصدارات: ١٨٨" (Arabic-Indic) vs Western digits everywhere else (v37.7, dates, KPIs). A 2026-06 commit explicitly standardized reports on Western digits.
- **Fix:** Pick Western digits app-wide (already the de-facto standard); replace `toLocaleString("ar")`-style formatting in ChangeLog with the shared `formatNumber` from `src/utils/formatting.ts`.

**VIS-05 — Sidebar logo hot-linked from zatca.gov.sa (Medium)**
- **Where:** `Sidebar` — `<img src="https://zatca.gov.sa/_layouts/15/zatca/Design/images/ZATCA-logo.svg">`.
- **What:** The product's core promise is a **self-contained offline** `dist/index.html`; the brand logo silently breaks with no network (and constitutes an external request from a government tool).
- **Fix:** Bundle the SVG locally (inline or `src/branding/`), with the existing text as fallback.

**VIS-06 — DataTable column-header truncation at default widths (Low)**
- **Where:** EmployeeWorkspace → صور الأشعة المحالة table; leftmost visible header shows "تار" (truncated "تاريخ ...").
- **Fix:** Better default column min-widths / ellipsis with title tooltip (partially exists — tune defaults).

### UX consistency findings

**UIX-01 — Shared StateViews library exists but is adopted only in App.tsx (High for perceived quality)**
- **Evidence:** `src/components/StateViews/StateViews.tsx` (EmptyState/LoadingState/ErrorState/Skeleton, added v36.4) is imported by exactly **one** consumer. Browser tour saw ≥3 different empty-state treatments: bare centered text (نتائج فحص الأشعة, نموذج الفحص, استعراض البيانات), dashed-border card (مؤشرات الأداء), and **no state at all** — a blank void (اعتماد الطلبات below the filters).
- **Fix:** Roll StateViews out to every tab (this is Phase 2 of `UI_ENHANCEMENT_PLAN.md` — treat that phase as started, not done). اعتماد الطلبات needs an EmptyState with an explanatory CTA.

**UIX-02 — Two competing confirmation-dialog patterns (Medium)**
- **Evidence:** Native `window.confirm()` in `ReportDesigner/index.tsx:598` and `MappingSettingsModal.tsx:373,393`; a styled two-step confirm (`setConfirmDelete`) in UserManagement. Native confirms are unstyled, LTR, browser-chrome English buttons — jarring in an Arabic RTL product.
- **Fix:** One shared `ConfirmDialog` component; replace the three native calls. (Destructive-action coverage is otherwise good — user delete has a proper two-step.)

**UIX-03 — ReportDesigner screen is off-system (Medium)**
- **Evidence:** No PageHeader (eyebrow/title/subtitle) unlike every other tab; primary button is bright blue (`#2563eb`-family) instead of the navy/brand `--c-navy`/`--brand-action`; bare empty text.
- **Fix:** Adopt PageHeader + token buttons + StateViews. (`ReportDesigner.css` has 89 raw hex colors and the repo's only TODO.)

**UIX-04 — Demo mode showcases an empty product (Medium, product)**
- **Evidence:** Demo workspace seeds users only; population/sample/reports/KPIs are all empty ("لا توجد أشهر", zeros). A stakeholder demo shows blank screens.
- **Fix:** Seed a small realistic month (e.g. 200 rows, drawn sample, partial answers) in `demoWorkspace.ts` — the file's own comment anticipates this ("Richer seeded population/sample data can be layered on here later").

**UIX-05 — "قيد التطوير / قريباً" card ships in the Reports hub (Low)**
- **Evidence:** تقرير الإدارة card renders disabled with "قيد التطوير" badge.
- **Fix:** Before release: finish it or hide it behind an admin feature flag. Unfinished cards undermine the "final product" impression.

**UIX-06 — First-run/onboarding gap (Medium, product)**
- The first screen a new admin sees is the workspace picker with one sentence, then a login form, then the Population wizard. There is no guided "what do I do first" path (create structure → add users → import month). The hidden Alt+A/T shortcuts are undocumented outside code comments.
- **Fix:** Light first-run checklist on an empty workspace (admin only) + a short deployment/user guide in `docs/`.

### Technical / process findings

**TEC-01 — Bundle growth unmonitored (Low):** 2.61 MB / 835 kB gzip today vs 1.9 MB / 664 kB documented 06-28 (+38% in 4 days, ReportDesigner + ChangeLog + `?raw` EDIT_LOG import — the whole 407 kB changelog ships inside the bundle to every user). Decide: is embedding EDIT_LOG.md in the production bundle intended? Consider build-time truncation (last N versions) and record size per release.
**TEC-02 — DATA-02 not fully closed (Low):** exactly **1 NUL byte** remains in `docs/EDIT_LOG.md` (407,044 bytes) — still enough for some tools to treat it as binary. One-line strip + `.gitattributes` rule.
**TEC-03 — CLAUDE.md drift again (Low):** tab table lists 7 tabs — missing `report-designer` and `change-log`; bundle-size note stale; MANAGED_TABS now has 22 entries incl. sub-tabs. Update the doc (recurring theme → add a docs-sync checklist item to the release process).
**TEC-04 — Design-token discipline is weak in CSS (Medium):** excellent token system in `index.css` (ZATCA brand palette, semantic ramps) but ~**1,400 raw hex literals** across component CSS (EmployeeWorkspace 287, Reports 183, DataTable 133, Population 127…). This is the mechanical root of "almost consistent" visuals and matches Gap #1 in UI_ENHANCEMENT_PLAN.
**TEC-05 — `xlsx` install fragility (Low, carried):** dependency fetched from SheetJS CDN tarball; any CI and any future `npm install` depends on that URL. Vendor the tarball into the repo (`vendor/xlsx-0.20.3.tgz`) and point package.json at the file.
**TEC-06 — Viewer passcode is plaintext `"view"` in the bundle (Info, accepted-by-design):** consistent with the documented advisory security model (SEC-01), but record it in the risk acceptance; rotate if demo mode ever exposes real data.

### Carried-over open items (from 2026-06-28 audit — still open)

| ID | Item | Status today |
|----|------|--------------|
| ARC-01 | Oversized files | `Population/index.tsx` 2,046 LOC (was 2,268 — improving), `XrayReferrals.tsx` 1,280, `MappingSettingsModal` 1,216, `UserManagement` 1,127, `DataTable` 1,035; CSS worse: `Population.css` **2,949**, `EmployeeWorkspace.css` 1,486 |
| TEST-01 | UI test coverage | All 42 test files are data-layer/auth; **zero component tests** for Population, EmployeeWorkspace views, DataTable, Reports, TemplateBuilder |
| OPS-01 | No CI | unchanged |
| SEC-01 | Written risk acceptance of client-only trust model | not yet recorded |
| Phase 7 | XSS-escaping test for generated HTML reports | not yet done |

### What is genuinely good (protect it)

- Sampling/apportionment/RNG fully deterministic and tested; distribution event-log fold tested; safeWrite snapshot-verify-rollback tested including corruption recovery.
- Login flow: lockout after repeated failures, uniform error messages, transparent Argon2id rehash — better than most internal tools.
- RTL is done properly in the app shell (logical properties, RTL-aware wizard), Arabic typography is professional (Somar Sans), the dark nav rail + brand palette read as institutional.
- The EDIT_LOG discipline and the ChangeLog tab that renders it are a genuinely distinctive internal-governance feature.

---

## 3. The plan — prototype → final product

Five milestones, strictly sequenced by risk. Every task keeps the four gates green and gets an EDIT_LOG entry. Do **not** start a milestone until the previous one's acceptance is met.

### Milestone A — Fix what is broken (bugs)  · effort S–M · ~1 session
> Everything a user can *see fail* today.

| # | Task | Files | Acceptance |
|---|------|-------|------------|
| A1 | LOG-01: unify demo session through `writeSession` | `AuthGate.tsx`, `authSession.ts` | demo mode opens every tab the demo role should see; regression test added |
| A2 | LOG-02: single permission source for sidebar + guards | `App.tsx`, `usePermissions.ts` | no visible-but-denied tab in any role incl. preview roles; test |
| A3 | VIS-01: banner no longer covers toolbar | `App.tsx`, `App.css` | logout clickable in demo (elementFromPoint = button); nothing clipped at top |
| A4 | VIS-02: permissions matrix responsive | `UserManagement.css` | all 4 role columns reachable at 1280×800 |
| A5 | VIS-03/04: ChangeLog bidi + Western digits | `ChangeLog/index.tsx` | English blocks LTR-aligned; all counters Western digits |
| A6 | VIS-05: bundle the ZATCA logo | `Sidebar.tsx`, `src/branding/` | logo renders with network blocked |
| A7 | TEC-02: strip final NUL byte, add `.gitattributes` | `docs/EDIT_LOG.md` | `file` reports text; git diff shows text |
| A8 | TEC-03: sync CLAUDE.md (tabs, bundle size, this audit) | `CLAUDE.md` | doc matches code |

### Milestone B — One design language (consistency)  · effort M–L · ~2–3 sessions
> Merge of UI_ENHANCEMENT_PLAN Phases 1–2 with this audit's UX findings.

| # | Task | Notes |
|---|------|-------|
| B1 | Roll out StateViews to every tab (UIX-01) | Priority: اعتماد الطلبات (blank void), نتائج فحص الأشعة, نموذج الفحص, استعراض البيانات, ReportDesigner. Every list/table gets empty + loading + error with a next-step CTA |
| B2 | Shared `ConfirmDialog`; kill the 3 native `confirm()`s (UIX-02) | RTL, Arabic buttons, danger styling |
| B3 | Bring ReportDesigner on-system (UIX-03) | PageHeader, token colors, resolve its TODO |
| B4 | Token sweep per CSS file (TEC-04) | Mechanical: replace hex literals with `var(--…)` one file per commit, screenshot-diff before/after; start with the worst offenders (EmployeeWorkspace, Reports, DataTable) |
| B5 | Table polish (VIS-06 + UI plan Phase 3) | Header truncation defaults, number alignment, consistent filter row |
| B6 | Spacing-rhythm pass (UI plan Phase 1) | Adopt spacing scale in pre-scale screens |

### Milestone C — Product completeness  · effort M · ~1–2 sessions
| # | Task | Notes |
|---|------|-------|
| C1 | Seed demo data (UIX-04) | One realistic month in `demoWorkspace.ts`: population, drawn sample, partial answers → every screen demonstrable |
| C2 | Finish **or** hide تقرير الإدارة (UIX-05) | Decision needed from you: build it now or flag it off for v1 |
| C3 | First-run admin checklist (UIX-06) | Empty-workspace admin view: create structure → add users → set permissions → import month |
| C4 | Surface the error ring buffer | Admin diagnostics panel (Settings): `getRecentErrors()` list + copy button — turns silent catches into supportable incidents |
| C5 | Decide EDIT_LOG-in-bundle policy (TEC-01) | Truncate to last N versions at build time or accept the size; record decision |
| C6 | Label coverage audit | Strings hard-coded in App.tsx/WorkspaceGate → label keys per convention |

### Milestone D — Hardening & release engineering  · effort L · ~2–3 sessions
| # | Task | Notes |
|---|------|-------|
| D1 | TEST-01: component/workflow tests | Testing Library + `createMemoryDirectory()`: 1 happy-path + 1 failure-path per workflow (import→process→sample→distribute→answer→report); characterization tests for DataTable & Population wizard |
| D2 | XSS test on report builders (plan Phase 7) | Inject `<script>`/HTML via port names & answers; prove escaping |
| D3 | Import-mapping edge tests (plan Phase 3) | Extra/missing/renamed columns; verify no silent drops |
| D4 | OPS-01: CI | GitHub Actions: typecheck + lint:ci + test:run + build; needs D5 |
| D5 | TEC-05: vendor `xlsx` tarball | Removes CDN dependency from install |
| D6 | SEC-01: written risk acceptance | One-page `docs/SECURITY_MODEL.md`: client-only trust, what it does/doesn't defend, passcode policy, TEC-06 note |
| D7 | Release process | Version stamp in UI (About/Settings), `CHANGELOG` cut from EDIT_LOG majors, build-size log, docs-sync checklist |
| D8 | ARC-01 (ongoing, one file per PR) | Only with characterization tests first; priority: `Population/index.tsx`, then `Population.css` split per phase component |

### Milestone E — Final polish & sign-off  · effort M · ~1–2 sessions
| # | Task | Notes |
|---|------|-------|
| E1 | Accessibility pass | Focus traps in modals, keyboard-only walkthrough, contrast check (gold-on-navy, muted grays), `aria-*` on icon-only buttons (baseline already decent) |
| E2 | Reports/print pass (UI plan Phase 4) | Cover pages, print CSS, chart axis/legend refinement |
| E3 | Performance validation | 300k-row import timing on target hardware; table interaction latency; record numbers |
| E4 | Full workflow UAT in target environment | Real Chromium + real workspace folder + real Excel files; checklist with evidence |
| E5 | Final readiness report | Re-rate against `MASTER_AUDIT_REPORT.md` criteria; go/no-go |

### Sequencing summary

```
A (bugs) ──► B (consistency) ──► C (completeness) ──► D (hardening) ──► E (sign-off)
   1 session      2–3 sessions        1–2 sessions        2–3 sessions      1–2 sessions
```

Total ballpark: **7–11 working sessions** to "final product", assuming decisions in C2/C5 come quickly. A alone removes every user-visible defect found in this audit.

### Decisions needed from the product owner

1. **تقرير الإدارة (C2):** build now or hide for v1?
2. **EDIT_LOG in bundle (C5):** ship full history, truncate, or exclude?
3. **English eyebrows** ("Population Processing", "REPORTS", "Administration"): intentional bilingual brand accent, or should they be Arabic label keys? (Currently consistent, so this is a *decision*, not a bug.)
4. **Demo mode audience:** internal-only testing aid, or a stakeholder showcase? (Determines how rich C1 seeding should be and whether the viewer passcode should rotate.)

---

## 4. Honesty note

Everything above was either executed (gates, build), observed in the running app (screenshots + DOM probes), or read directly in source. Items I did **not** verify this pass: actual XSS-escaping behavior of the report builders (scheduled D2), large-import performance (E3), and the login form's visual state (form only renders after a real directory pick, which cannot be automated — code-reviewed instead; flow logic is sound). No findings were invented to fill sections.
