# Master Audit Report — x-ray-quality-app-v1

**Date:** 2026-06-28
**Auditor:** Claude (Opus 4.8)
**Commit baseline:** `c5c4bd4f` (working tree has substantial uncommitted changes — see §0.3)
**Scope of this pass:** Whole-repo reconnaissance + targeted deep reads of the entry point, persistence core, auth/session layer, and process/doc state. This is an **evidence-grounded reconnaissance audit**, not yet an exhaustive line-by-line review of all 171 source files. Findings marked `[RECON]` are inferred from patterns/sampling and must be confirmed during the relevant phase before remediation.

---

## 0. Executive Summary

### 0.1 Current system condition

Contrary to the framing of "identify, repair, connect" a broken system, **the application is in genuinely healthy engineering condition** at the toolchain level. All automated quality gates pass:

| Gate | Command | Result |
|------|---------|--------|
| Type check | `tsc --noEmit` | ✅ PASS (0 errors) |
| Unit/integration tests | `vitest run` | ✅ PASS — 119 tests, 25 files |
| Lint | `eslint src` | ✅ PASS (0 errors/warnings) |
| Production build | `vite build` | ✅ PASS — single-file `dist/index.html` |

Additional positive signals from the sweep:
- **0** uses of `: any` / `as any` in non-test code — strong type discipline.
- **0** empty `catch {}` blocks.
- **1** `console.*` call in non-test code — disciplined logging (uses an in-memory `errorLogger` ring buffer instead).
- Core persistence (`safeWrite.ts`) implements snapshot-and-verify with `.bak` rollback — a thoughtful design given the File System Access API lacks atomic rename.
- The entry point (`App.tsx`) handles async cancellation, effect cleanup, and role-change pruning correctly, with documented `eslint-disable` justifications.
- The mandated `docs/EDIT_LOG.md` process is being followed (105 KB of history).

**This is a mature, well-tested SPA. The work ahead is hardening, debt reduction, and consistency — not rescue.**

### 0.2 Major risks (top 5)

1. **[High] Client-only trust boundary** (by design, per CLAUDE.md) — all auth/role checks run in the browser; business data is plain JSON on disk. Acceptable for the stated use case but must be explicitly re-confirmed as an accepted risk, not silently relied upon. See SEC-01.
2. **[High] Session-persistence drift** — `authSession.ts` persists a 7-day session to `localStorage`, but `CLAUDE.md` and `docs/data-system-report.md` (written the same day) both state the session is runtime-only and lost on reload. Code and docs disagree; the security window widened without documentation. See SEC-02 / DOC-01.
3. **[Medium] Maintainability hotspots** — several files exceed 1,000 lines (`Population/index.tsx` at 2,268). High blast radius for change; hard to hold in context; under-tested at the component level. See ARC-01.
4. **[Medium] Documentation drift** — bundle size (docs say ~942 kB; actual 1.9 MB / 664 kB gzip), workspace disk layout (docs/CLAUDE.md describe `Population/`, `.system/`, `templates/`; code uses numbered roots `1-Population/`…`6-Templates/`), and session behavior are all stale in CLAUDE.md. See DOC-01.
5. **[Low-Medium] Floating promises** — ~9 `.then()` data-loaders in components/storage are not `void`-marked and have no `.catch()`; a load failure becomes an unhandled rejection with no user feedback. See ERR-01.

### 0.3 Working-tree state (uncommitted)

The git working tree contains **26 modified files and 11 untracked files**, including new test files, a new `src/branding/` directory, `loginPersistence.ts`, `authActivityLog.ts`, `workspacePersistence.ts`, and `docs/data-system-report.md`. **This is itself a risk:** a large body of unreviewed, uncommitted work means the "baseline" is not a clean commit. Phase 0 must reconcile this before further change.

### 0.4 Enterprise-readiness level

**Current rating: `Internal testing ready`.**

Justification: builds/tests/lints pass and core data-safety is engineered, but (a) the trust model is explicitly client-only/advisory, (b) there is uncommitted unreviewed work, (c) documentation is materially stale, and (d) component-level test coverage and several hardening items remain open. It is not yet "Controlled production ready" until Phases 0–3 and the security re-confirmation (Phase 7) are complete with evidence.

### 0.5 Highest-priority recommendations

1. **Phase 0 first** — reconcile/commit the working tree, capture a clean baseline tag, confirm rollback works.
2. **Fix doc-vs-code drift** (SEC-02/DOC-01) — decide whether session persistence is intended; align code and docs.
3. **Confirm the security model is an accepted risk in writing** (SEC-01), then harden the items that are cheap regardless (input validation, audit completeness).
4. **Add floating-promise handling** (ERR-01) — small, safe, high signal-to-noise.
5. **Schedule the large-file refactors** (ARC-01) behind a characterization-test net so behavior is preserved.

---

## 1. System Inventory

### 1.1 Stack
React 19.2 + TypeScript (strict, ~6.0) + Vite 8 SPA. `vite-plugin-singlefile` → one portable `dist/index.html`. No backend. `xlsx` from SheetJS CDN tarball. `recharts` for charts. `hash-wasm` for Argon2id. `lucide-react` for icons. Vitest (node + jsdom) for tests.

### 1.2 Size
- 171 source files (`.ts/.tsx/.css`), ~35.5 k LOC.
- 25 test files, 119 tests.
- Largest files: `Population/index.tsx` (2268), `EmployeeWorkspace/views/XrayReferrals.tsx` (1353), `MappingSettingsModal.tsx` (1282), `UserManagement/index.tsx` (1220), `reportHtmlBuilder.ts` (1151), `DataTable/index.tsx` (1113).

### 1.3 Major subsystems
- **Auth/permissions** (`src/auth/`): Argon2id hashing (PBKDF2 legacy verify + transparent upgrade), session (now persisted), managed users + role×tab permission matrix in `localStorage`, activity log, login persistence.
- **Workspace persistence** (`src/data/storage/`, `src/data/workspace/`): File System Access API, `safeWriteJson`/`safeReadJson`, `JsonEnvelope` schema versioning, Web Locks concurrency guard.
- **Population workflow** (`src/components/Sidebar/Tabs/Population/`, `src/data/population/`): Excel import (Web Worker) → processing → sampling → distribution.
- **Sampling** (`src/data/sampling/`): Hamilton apportionment, Mulberry32 RNG, Fisher-Yates.
- **Distribution** (`src/data/distribution/`): append-only event log + `deriveCurrentDistribution` fold.
- **Templates / Answers / Referrals / Approvals / Reporting / Backup / Feedback / Labels / Preferences** — see CLAUDE.md data-layer table.
- **Tab system** (`tabRegistry.ts`): auto-discovery via `import.meta.glob`.
- **Reporting**: self-contained Arabic HTML report builders.

### 1.4 Tests present (25 files)
auth (AuthGate, authActivityLog, authSession), distribution (bulkAssignment, replacement), population (populationStorage), referral, reporting (executiveReport, executiveReportData, sampleReport), sampling (sampleAlgorithm), storage, and others. **Gap:** the largest UI components (Population, EmployeeWorkspace views, DataTable) have little/no direct test coverage. See TEST-01.

### 1.5 Deployment assets
`npm run build` → `dist/index.html`. No CI config observed in repo root (no `.github/workflows`). See OPS-01.

---

## 2. Findings Register

Severity: **Critical** / **High** / **Medium** / **Low**.
Status: Not reviewed / **Confirmed** / Planned / In progress / Fixed / Validated / Deferred / Rejected.

### SEC-01 — Client-only trust boundary (accepted-by-design, needs written sign-off)
- **Category:** Security · **Severity:** High · **Status:** Confirmed (documented in CLAUDE.md as advisory)
- **Where:** `src/auth/*`, all `src/data/*` JSON on disk
- **Description:** All role/permission enforcement is in-browser; data is plain JSON. A user can edit `localStorage` or disk files to self-elevate or tamper. The bootstrap admin hash ships in the client bundle (offline-crackable).
- **Root cause:** No-backend architecture (deliberate).
- **Impact / Risk:** Not a defense against malicious insiders. Acceptable only if the deployment context (trusted internal users, physical/OS access controls) makes it so.
- **Recommended fix:** Do **not** rewrite to add a backend unless the user wants it. Instead: (1) get explicit written acceptance of this risk; (2) ensure the bootstrap admin passcode is strong; (3) keep UI checks paired with the understanding they are UX, not security. Track as accepted risk in `docs/`.
- **Effort:** S (documentation) · **Acceptance:** Risk acceptance recorded; passcode strength verified.

### SEC-02 — Session persisted to localStorage with 7-day TTL (undocumented behavior change)
- **Category:** Security · **Severity:** High · **Status:** ✅ Fixed (commit `1f715aec`, EDIT_LOG v5.37) — switched to `sessionStorage`; code + docs aligned; auth tests green.
- **Where:** `src/auth/authSession.ts:7-44, 88-122`
- **Description:** `writeSession` persists `{role, username, loginAt}` to `localStorage` key `xray_auth_session_v1`; `readRealSession` rehydrates it and honors a 7-day TTL. CLAUDE.md and `docs/data-system-report.md:9` both state the session is **runtime-only** and lost on reload — directly contradicting the code.
- **Root cause:** Behavior changed (persistence added) without updating docs or re-evaluating the security tradeoff.
- **Impact / Risk:** A logged-in role survives reload/restart for 7 days on a shared machine; combined with SEC-01, a user can also forge the session object. Docs misrepresent the actual data footprint (relevant to any privacy review).
- **Recommended fix:** Decide intent. If persistence is wanted, (a) document it in CLAUDE.md + data-system-report, (b) consider `sessionStorage` (tab-scoped) or a shorter TTL, (c) note it cannot be a security control. If not wanted, revert to runtime-only.
- **Effort:** S · **Acceptance:** Code and docs agree; decision recorded; tests cover chosen behavior.
- **Required tests:** session rehydration on reload, expiry past TTL, clear on logout.

### DOC-01 — Documentation drift (CLAUDE.md and docs vs. code)
- **Category:** Documentation · **Severity:** Medium · **Status:** ✅ Fixed (commit `e72a093c`, EDIT_LOG v5.38) — CLAUDE.md bundle size, disk layout, and session bullet corrected; cross-linked to data-system-report.md.
- **Where:** `CLAUDE.md`, `docs/data-system-report.md`
- **Description:** Three confirmed drifts: (1) session persistence (see SEC-02); (2) bundle size — docs say "~942 kB, 286 kB gzip", actual is **1.9 MB / 664 kB gzip**; (3) workspace disk layout — CLAUDE.md documents `Population/`, `.system/`, `templates/`, but the code uses numbered roots `1-Population/` … `6-Templates/` (with legacy fallbacks), as the newer `data-system-report.md` correctly describes.
- **Impact:** Misleads any future maintainer; undermines trust in all docs.
- **Recommended fix:** Update CLAUDE.md disk-layout and build-size sections to match `data-system-report.md` and the actual build; cross-link the two.
- **Effort:** S · **Acceptance:** CLAUDE.md matches observed reality; build size noted as approximate with date.

### ARC-01 — Oversized components (maintainability)
- **Category:** Architecture · **Severity:** Medium · **Status:** Confirmed
- **Where:** `Population/index.tsx` (2268), `XrayReferrals.tsx` (1353), `MappingSettingsModal.tsx` (1282), `UserManagement/index.tsx` (1220), `reportHtmlBuilder.ts` (1151), `DataTable/index.tsx` (1113), `TemplateBuilder/index.tsx` (985)
- **Description:** Several files far exceed a comfortable single-responsibility size. High change-risk, hard to test in isolation.
- **Root cause:** Organic growth of feature-rich tabs.
- **Impact / Risk:** Future edits are error-prone; these are exactly the files where a regression is most likely and hardest to catch.
- **Recommended fix:** Do **not** refactor blind. First add characterization tests around the public behavior, then extract cohesive sub-modules (hooks, presentational components, pure helpers). One file per PR.
- **Effort:** L (per file) · **Acceptance:** No behavior change (characterization tests green before+after); each extracted unit independently testable.

### ERR-01 — Floating promises in data loaders
- **Category:** Error handling · **Severity:** Low-Medium · **Status:** ✅ Fixed (commit `934ffd7f`, EDIT_LOG v5.39) — 13 confirmed sites across 6 files now `.catch(logRejection(...))`. Loaders that already had a `.catch` were left unchanged. The original "~9" estimate was an overcount; the actual count is 13 genuinely uncaught sites (most other `.then` loaders already handled rejections).
- **Where:** e.g. `Population/index.tsx:202,231`, `UserManagement/index.tsx:175`, others among ~27 `.then()` sites
- **Description:** Several `.then()` loaders are not `void`-marked and lack `.catch()`; a rejected load surfaces only as an unhandled rejection, with no user-facing error and no `errorLogger` entry.
- **Impact:** Silent failure of data loads (e.g. config, months list) → blank/stale UI with no explanation.
- **Recommended fix:** Add `.catch()` that routes to `logError` + a user-visible error/empty state; audit all 27 sites and classify each as intentional fire-and-forget (`void` + catch) or awaited.
- **Effort:** M · **Acceptance:** No floating rejections; each loader has an error path; tests for the failure branch on at least the critical loaders.

### TEST-01 — UI component test coverage gap
- **Category:** Testing · **Severity:** Medium · **Status:** Confirmed
- **Where:** `Population/`, `EmployeeWorkspace/views/*`, `DataTable/`
- **Description:** Data-layer modules are well tested; the largest interactive components are not. End-to-end workflow paths (import → process → sample → distribute → answer → report) are not covered by automated tests.
- **Recommended fix:** Add component tests (Testing Library) for critical interactions and at least one happy-path integration test per major workflow using `createMemoryDirectory()`.
- **Effort:** L · **Acceptance:** Each critical workflow has ≥1 passing happy-path + ≥1 failure-path test.

### OPS-01 — No CI pipeline in repo
- **Category:** Ops/Governance · **Severity:** Low · **Status:** Confirmed `[RECON]` (no `.github/workflows` found)
- **Description:** Quality gates exist as npm scripts but are not enforced automatically on push/PR.
- **Recommended fix:** Add a CI workflow running `typecheck`, `lint:ci`, `test:run`, `build`. (Note: `xlsx` CDN tarball install must be reachable from CI.)
- **Effort:** S · **Acceptance:** CI runs all four gates on PR and blocks on failure.

### DATA-01 — Workspace-tree state: uncommitted/unreviewed work `[RECON]`
- **Category:** Process/Data integrity · **Severity:** Medium · **Status:** Confirmed
- **Where:** git working tree (26 modified, 11 untracked)
- **Description:** A large body of changes (new auth persistence, activity log, branding, tests, data-system doc) is uncommitted and unreviewed. The "baseline" is not a clean commit.
- **Recommended fix:** Phase 0 — review, test, and commit (or revert) this work in coherent chunks before any new change.
- **Effort:** M · **Acceptance:** Clean working tree on a tagged baseline; all gates green at that tag.

### DATA-02 — `docs/EDIT_LOG.md` contains stray NUL bytes (file reads as binary)
- **Category:** Data integrity (tooling) · **Severity:** Low · **Status:** Confirmed (discovered this session)
- **Where:** `docs/EDIT_LOG.md`
- **Description:** `file` reports the log as `data` (not text) and `grep` flags it "Binary file matches"; the header/footer are clean UTF-8/CRLF, so NUL bytes exist mid-file (likely a past editor/encoding mishap). New entries prepend cleanly, but the corrupt region impairs `grep`/diff/review of historical entries.
- **Impact:** Degrades the audit trail's usefulness; risk of further corruption on re-save by some editors.
- **Recommended fix:** Strip NULs (`tr -d '\000'`) into a clean copy, verify the history is intact, replace, and commit. Consider a `.gitattributes` `*.md text` rule.
- **Effort:** S · **Acceptance:** `file docs/EDIT_LOG.md` reports text; history intact; gates unaffected.

> **Findings to be expanded during execution:** data-integrity mapping correctness (import field mapping, sampling determinism under edge inputs), performance under 300k-row imports (a recent fix commit suggests this was a real pain point), accessibility/RTL focus management, and per-module dead-code detection are **not yet line-audited** and will be registered as they are confirmed in their respective phases. They are intentionally not invented here.

---

## 3. Methodology & honesty note

This report is grounded only in what was actually executed or read:
- Ran and observed: `tsc --noEmit`, `vitest run`, `eslint src`, `vite build`.
- Read in full: `App.tsx`, `safeWrite.ts`, `authSession.ts`, `loginPersistence.ts`, `package.json`, `docs/data-system-report.md` (head).
- Swept: TODO/FIXME/mock/placeholder, empty catches, `.then()` without catch, `any` usage, `console.*`, file sizes.

Claims not backed by the above are explicitly marked `[RECON]` or deferred. No findings were fabricated to fill a template. The detailed phased remediation plan lives in `docs/superpowers/plans/2026-06-28-production-readiness.md`.
