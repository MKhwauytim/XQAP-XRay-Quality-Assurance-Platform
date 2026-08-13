# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

X-ray quality control app (`x-ray-quality-app-v1`): an Arabic, RTL-first React 19 + TypeScript + Vite SPA for importing radiology BI/risk data from Excel, processing a population, drawing a stratified random sample, distributing assignments to employees, collecting answers, and generating self-contained HTML reports. **No backend** — all state lives in the browser or in a user-selected workspace folder on disk.

## Edit log requirement

Every edit is recorded in `docs/edit logs/YYYY-MM-DD.md` (the file for the current date). **Write the entry after the edit is applied**, not before — writing an `After:` snippet before the code exists just means writing it twice.

**Generate the entry, don't hand-write it:**

```bash
npm run editlog -- --tier=2 "Fix (auth): reject expired session on read-back"
npm run editlog -- --tier=3 --append --sync-package "Refactor (sampling): ..."
```

`scripts/editlog.mjs` fills in the version, date, changed-file list, and `**Lines:**` (it counts untracked files, which `git diff --stat` silently omits), then prints the gate list for the tier. You write the prose. `--append` inserts into today's file, creating it if needed; `--sync-package` keeps `package.json` in step so `check:release` passes.

### Tier ladder — match effort to blast radius

| Tier | When | Prose | Before/After snippets | Gates before claiming done |
|------|------|-------|----------------------|---------------------------|
| **1** | Comments, docs, typos, test-only, formatting | 1–2 sentences, no `Why:` | not required | `lint`, `typecheck`, the affected test file |
| **2** | Most fixes and features — the default | `Why:` + `What changed:` | required | `lint`, `typecheck`, `test:run` |
| **3** | Refactors, architecture, data formats, releases | Full, plus migration/rollback | required | all of tier 2 + `check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size` |

Tier 3's sweep is the **release** gate, not the per-edit gate. Running it on a three-line comment fix costs minutes and proves nothing about the change. `docs/product/RELEASE_CHECKLIST.md` is the authority when actually cutting a release.

**Fields every entry keeps:**

1. **Version** — semver-lite: major feature/refactor/architectural change bumps the whole number (v1 → v2); fix/tweak/hotfix bumps the decimal (v1.0 → v1.1). Write a major as `v60.0`, not `v60` — `check:release` compares against `package.json`'s first two segments and a bare `v60` can never match.
2. **Date** — ISO (YYYY-MM-DD).
3. **Category** — the title must start with `Fix:`, `Add:`, `Change:`, `Remove:`, `Refactor:`, `Security:`, `Docs:`, or `Chore:` (an optional `(scope):` may follow). Pick the category matching the *primary* action; when an entry mixes concerns, lead with whichever dominates.
4. **What changed**, plus **Why** at tier 2+.
5. **File** — one `**File:**` block per touched file, all under the same version entry.
6. **Lines** — one `**Lines:**` line per entry, generated. Tier 3 also carries the whole-repo total.

Prose should be proportional to the change. A comment fix does not need a paragraph explaining what was rejected; a data-format migration does. Create today's dated file if absent; never create a second file for the same date.

## Commands

```bash
npm run dev             # Vite dev server
npm run build           # tsc -b && vite build → single self-contained dist/index.html
npm run lint            # ESLint over the whole repo (lint:ci scopes to src/, --max-warnings 0, used in CI)
npm run typecheck       # strict TypeScript check
npm run check:complexity     # complexity/large-function regression budget (CI gate)
npm run check:hex-literals   # regression guard against raw hex color literals (B4)
npm run check:release        # package.json version ↔ latest docs/edit logs/ entry agree
npm run check:vendor         # vendored SheetJS tarball SHA-256 matches vendor/README.md
npm run check:bundle-size    # dist/index.html raw/gzip release budget
npm run count-lines -- --quiet  # whole-repo line count (excludes docs/edit logs/; --with-edit-logs for the old basis)
npm run editlog -- --tier=2 "…"  # generate a daily edit-log entry skeleton (see above)
npm run preview         # Preview the built file
npm run test:run        # Vitest, 1970 tests / 231 files as of v72.0.0
npm run test            # Vitest watch mode
npx vitest run src/data/sampling/sampleAlgorithm.test.ts  # run a single test file
```

Node **>=22 <23** (`package.json` `engines`).

Full pre-release gate sequence (version bump, docs sync, data-safety checks): `docs/product/RELEASE_CHECKLIST.md`.

## Build & dependency gotchas

- `vite-plugin-singlefile` inlines everything (`assetsInlineLimit` maxed, `cssCodeSplit: false`): v72.0.0 produces one portable `dist/index.html` (~3.34 MB raw, ~1.11 MB gzip; budget 3.6 MB / 1.3 MB — v72.0.0 recovered ~180 kB raw by dropping the bundled edit-log archive, but headroom is still finite, so re-run `check:bundle-size` before landing anything large). `npm run check:bundle-size` is the release budget.
- Historical full-product revision snapshot (v56.2 fixes): `docs/audit/FULL_REVISION_2026-07-17.md`. The active forward-looking item is `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md`, for populations above ~200k rows/month (paged repository reads, port-partitioned files, bounded LRU cache). **Phases A and B have shipped.** Phase A in v59.111–v59.114 (2026-08-01): focused month loaders, opt-in `MonthLoadScope`, sub-tab/capability demand gating. Phase B on 2026-08-04: worker-owned Population Browse paging (`src/workers/populationQueryWorker.ts`). **Phases C and D remain proposed and need owner approval** — the proposal doc's own header still reads `Status: proposed`, which now covers only those two. Phase C (port-partitioned storage) is additionally blocked on backup coordination. That sequence gates any finding marked **proposal-covered** in `docs/audit/APP_DATA_MANAGEMENT_AUDIT_2026-07-22.md`; don't implement those independently of the approved phase order.
- `dist/` is intentionally just the single self-contained `index.html` — no other files. The `public/` folder is empty on purpose; anything dropped in it gets copied into `dist/` unchanged by Vite's default handling, which would break that guarantee. The desktop-shortcut "launch as app window" tooling (`create-desktop-shortcut.ps1` / `.bat` / `app-icon.ico`) that used to live there was removed 2026-07-20 — the app is distributed as a plain static file now, opened directly or served statically. `scripts/generate-app-icon.ps1` (dev-only, not shipped) still exists but is currently unused now that `app-icon.ico` is gone.
- The `xlsx` dependency is **vendored** at `vendor/xlsx-0.20.3.tgz` (`package.json` points at `file:vendor/xlsx-0.20.3.tgz`) — originally sourced from the SheetJS CDN tarball (`https://cdn.sheetjs.com/xlsx-0.20.3/...`), not the npm registry. Vendoring means `npm ci` no longer needs network access to that CDN (required for CI, see `.github/workflows/ci.yml`). Don't "upgrade" it to the stale npm-registry `xlsx` package; see `vendor/README.md` for the upgrade procedure.
- The workspace features require the **File System Access API** (`showDirectoryPicker`), so the app only fully works in Chromium browsers (Chrome/Edge). Other browsers get the `unsupported_browser` state.
- TypeScript is in strict mode with `erasableSyntaxOnly`. `createWritable` on `FileHandleLike` is typed as optional — always guard it before calling.
- Excel parsing runs in a **Web Worker** (`src/workers/workbookWorker.ts`) to avoid blocking the UI. The worker posts `progress` and `result` messages back to the main thread.
- Reviewer KPI p-charts use a native responsive SVG plus a semantic screen-reader table; Recharts is intentionally not a dependency.

## Disk layout (workspace folder)

The user picks a root directory. The current layout uses **numbered roots**; legacy
unnumbered folders (`Population/`, `templates/`, `.system/`) are still read when present.
**`docs/architecture/data-system-report.md` is the authoritative, detailed reference for every file
and path** — keep it in sync. Summary:

```
1-population/
  {month}-{monthname-en}-{year}/   ← e.g. 5-may-2026 (legacy: files flat in folder)
    month.manifest.json
    1-raw/       risk.raw.json, bi.raw.json (BI only if present)
    2-processed/ population.final.json, processing.summary.json
2-samples/
  {month}/1-main/   sample.master.json, distribution.events/{eventId}.json (immutable),
                    distribution.log.json (compatibility projection),
                    distribution.current.json (derived cache), main.samples.json
  {month}/…        per-employee sample mirrors, answers, referral/replacement, approvals
3-user-data/       workspace user/permission files (when initialized via workspace defaults)
4-reports/         designs/ — Report Designer designs.index.json + {reportId}.json
5-system/          workspace.schema.json, backups/, audit/, locks/, presets, notifications
6-templates/       {templateId}.json, templates.index.json, template selection
feedback/          legacy top-level root — read-only fallback; new writes go to 5-system/feedback/
```

Month folder names follow `{month}-{MonthName-en}-{year}` (e.g. `5-May-2026`). Legacy roots remain readable. There is **no active schema migration**: `workspaceSchema.ts` only *detects* the layout and stamps `workspace.schema.json` on a brand-new workspace, so legacy/mixed layouts are read through permanent fallback paths in `workspacePaths.ts` and are never moved or deleted. Roots are resolved through `workspacePaths.ts` — never hard-code a folder name.

Both previously documented drifts have since been **fixed in code**. **`4-reports/` is not empty** — Report Designer (`src/data/reportDesigner/storage/reportDesignStorage.ts`) writes `designs.index.json` (CAS-protected) and per-design `{reportId}.json` under `4-reports/designs/` via `getReportsRoot(..., true)`. **`feedback/` now writes under `5-system/feedback/`** — `feedbackStorage.ts` still *reads* the legacy top-level `feedback/` root so pre-existing workspaces keep working. See `docs/architecture/data-system-report.md` for the current picture.

## Architecture

### Entry points

| File | Role |
|------|------|
| `src/main.tsx` | React root; mounts `App` |
| `src/App.tsx` | Auth gate → role/permission tab filtering → `BootSplashOverlay` → active tab |
| `src/auth/AuthGate.tsx` | Login, session restore, the 3-minute auto-refresh timer |
| `src/components/Sidebar/Tabs/tabRegistry.ts` | Auto-discovers tabs via `import.meta.glob("./*/index.tsx")` |
| `src/auth/tabCatalog.ts` | Source of truth for tab ids, Arabic labels, role ceilings |
| `src/data/workspace/workspacePaths.ts` | Every on-disk path; never hard-code folder names |
| `src/data/storage/safeWrite.ts` | Every workspace read/write goes through here |
| `vite.config.ts` / `vitest.config.ts` | Build and test config (both define `__APP_VERSION__`) |

### Two persistence layers — don't mix them

1. **Browser storage (auth & permissions)** — `src/auth/`
   - **All browser-storage locations are registered in `src/data/storage/storageRegistry.ts`** — the single source of truth.
   - Login: new passwords hashed with **Argon2id** via `hash-wasm` (m=19 MiB, t=2, p=1 — OWASP 2026 baseline). Legacy PBKDF2-SHA256 hashes are still verified for backwards compatibility, and are **transparently upgraded to Argon2id on successful login** (`needsRehash` → `persistUserPasswordHash`). Bootstrap `admin` hash stored in `authConfig.ts`.
   - Session → runtime module variable in `authSession.ts`, persisted to **`localStorage`** (`xray_auth_session_v1`, SEC-02 relaxation): it survives a full browser restart, not just a page reload. A 7-day TTL applies as a secondary guard on read-back. This is a UX convenience, **not** a security control (see the security-model note below). Managed users + role→tab permission matrix live in an in-memory runtime variable in `userManagement.ts` (changes broadcast via custom DOM event, `subscribeToUserManagementChanges`) — **not** `localStorage`; the workspace disk file `3-user-data/users.permissions.json` (synced via `syncUserManagementToDisk`/`syncUsersFromDisk` in `src/data/workspace/userSync.ts`) is the sole persistence, so this state resets to disk-synced defaults on a fresh page load with no workspace mounted yet.
   - Roles: `guest` / `employee` / `supervisor` / `manager` / `admin` (5 roles — see `AuthRole` in `authTypes.ts`). `admin` is the bootstrap superuser; `manager` is the top managed role. `App.tsx` filters tabs by role + permission matrix.
   - `tabCatalog.ts` also carries parent relationships; permission defaults and registry consistency are tested against it, so a catalog/registry mismatch fails the suite.
   - Use the centralized `canMutate` capability at both render and handler boundaries for persistent actions.

   > **Security model — advisory only.** With no backend, all role/permission checks run in the browser and all business data is plain JSON on disk. A determined user can edit `localStorage` or the JSON files directly to self-elevate or tamper. The auth layer is a UX/role-routing guard, **not** a trust boundary. The bootstrap admin hash ships in the client bundle, so the passcode must be strong (it is offline-crackable). Do not treat this app as a defense against malicious insiders. Full risk-acceptance detail (trust boundary, passcode policy, viewer-passcode note, localStorage/JSON tamperability, sign-off): `docs/architecture/SECURITY_MODEL.md`.

2. **Workspace folder on disk (business data)** — `src/data/`
   - Safe write layer: `safeWriteJson` / `safeReadJson` in `src/data/storage/safeWrite.ts`. Writes preserve the last valid `.bak`, stage and verify `.tmp`, then commit/re-verify. Transient `NotReadableError` is retried and never reinterpreted as a missing file; read-only handles fail with a typed error.
   - `JsonEnvelope<TData>` wraps every JSON file: `{ metadata: { schemaVersion, revision, contentHash, writtenAt }, data }`. Schema versioning via `wrap/unwrap/isEnvelope` in `src/data/storage/jsonEnvelope.ts`.
   - Web Locks API (with promise-chain fallback) prevents concurrent writes within a tab.
   - `casLoop` (`src/data/storage/casLoop.ts`) is the cross-machine/cross-tab counterpart for single-file shared state (e.g. notifications, action log): each write embeds a fresh UUID token, verifies it on read-back, and retries with jittered backoff if a competing writer's revision won. Distinct from the event-log append pattern used by distribution.
   - `WorkspaceProvider.tsx` / `useWorkspace.ts` — React context for directory handle.

### Data-layer modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Population storage | `src/data/population/` | Month folder CRUD, manifest, raw/final JSON |
| Sampling | `src/data/sampling/` | Hamilton apportionment, Mulberry32 RNG, Fisher-Yates, draw algorithm |
| Distribution | `src/data/distribution/` | Immutable event envelopes, compatibility log projection, derived state, assignment/replacement |
| Templates | `src/data/templates/` | Template schema CRUD + index + runtime evaluation |
| Answers | `src/data/answers/` | Per-employee per-month answer files |
| Sample mirrors | `src/data/samples/` | Per-employee `*.samples.json` mirror storage — distinct from `sampling/` (the draw algorithm itself) |
| Reporting | `src/data/reporting/` | Self-contained Arabic HTML report builders (sample + distribution + executive) |
| Report Designer | `src/data/reportDesigner/` | Canvas geometry + design storage. `query/` now contains only `fieldCatalog.ts` and `aggregations.ts`; the abandoned `dataModel.ts`/`filters.ts`/`runQuery.ts` query scope has been deleted — don't reintroduce it |
| Power BI export | `src/data/powerbiExport/` | CSV export of population/sample/distribution/answer/executive rows for external BI ingestion |
| Backup | `src/data/backup/` | Copy key files to `.system/backups/`, archive status check |
| Approvals | `src/data/approvals/` | Referral approval records |
| Referrals | `src/data/referral/` | Referral request storage |
| Notifications | `src/data/notifications/` | Workspace-wide broadcast notifications + per-recipient acknowledgement (`ew/notifications` tab); single CAS-protected file |
| Audit | `src/data/audit/` | CAS-protected action-log event history + archival |
| Data integrity | `src/data/integrity/` | `orphanScan.ts` — referential-integrity check (B3) across the population → sample → distribution → answers/approvals `xrayImageId` chain |
| Ad-hoc import | `src/data/adhocImport/` | Admin-uploaded one-off Excel imports, assigned outside the regular Population pipeline; synthesizes a `sample.master.json` for a synthetic month folder. Stored under `5-system/adhoc-imports/` |
| Feedback | `src/data/feedback/` | User feedback records |
| Labels | `src/data/labels/` | UI label overrides (`labelsStore.ts`) persisted to `localStorage`; `useLabels()` re-renders on change |
| Preferences | `src/data/preferences/` | Browse preset storage |
| Global month | `src/data/month/` | App-wide month selection (provider + toolbar selector); sessionStorage key `xray_global_month_v1` |
| Workspace | `src/data/workspace/` | Directory-handle context/provider, numbered-root path resolution (`workspacePaths.ts`), layout schema detection/migration (`workspaceSchema.ts`: current/legacy/mixed/empty), defaults, demo workspace |
| Error logger | `src/data/storage/errorLogger.ts` | In-memory ring buffer (last 50 entries) for silent-catch observability; `logError`, `getRecentErrors`, `clearErrors` |
| JsonEnvelope | `src/data/storage/jsonEnvelope.ts` | Schema versioning wrapper for all `safeWriteJson` writes; `wrap`, `isEnvelope`, `unwrap` factory functions |

### Shared UI components

| Component | Path | Notes |
|-----------|------|-------|
| `DataTable` | `src/components/DataTable/` | Reusable filterable/sortable table with column visibility, XLSX export |
| `PageHeader` | `src/components/PageHeader/` | Eyebrow + title + subtitle header pattern |
| `FeedbackWidget` | `src/components/FeedbackWidget/` | Floating feedback collector |
| `PermissionGuard` | `src/components/PermissionGuard.tsx` | Renders children only when the current user has a given permission |
| `ErrorBoundary` | `src/components/ErrorBoundary.tsx` | Top-level React error boundary |
| `AdminToolbar` | `src/auth/AdminToolbar.tsx` | Role-preview segmented switch, logout button, feedback toggle (admin-only) |

Also present, undocumented above: `ConfirmDialog`, `GlobalMonthSelector`, `InspectionPanel`, `NotificationBanner`, `Pagination`, `StateViews`. Outside `components/`: `src/app/` (tab-mount LRU capped at 3, visited-tab tracking), `src/hooks/useFocusTrap`, `src/branding/` (fonts, org identity, ZATCA logo), `src/styles/primitives.css`, `src/utils/formatting.ts`.

### Tab system

Tabs are auto-discovered by `tabRegistry.ts`. Each top-level tab exports a default component and `tabConfig`; its metadata must agree with `src/auth/tabCatalog.ts`.

**Current tabs (as of 2026-07-22):**

| Tab id | File | Roles | Order | Sub-tabs |
|--------|------|-------|-------|----------|
| `population` | `Tabs/Population/` | all | 10 | `process`, `browse` |
| `employee-workspace` | `Tabs/EmployeeWorkspace/` | all | 15 | `ew/xray-referrals`, `ew/xray-results`, `ew/referral-approval`, `ew/inspection-form` (renders `Tabs/TemplateBuilder/`) |
| `ew/notifications` | `Tabs/NotificationCenter/` | all (defaults to manager, admin) | 20 | — |
| `reports` | `Tabs/Reports/` | guest, supervisor, manager, admin | 25 | `reports`, `kpi` (supervisor, manager, admin), `report-designer` (supervisor, manager, admin → `Tabs/ReportDesigner/`) |
| `archive` | `Tabs/Archive/` | guest, supervisor, manager, admin | 30 | — |
| `user-management` | `Tabs/UserManagement/` | admin | 40 | `users`, `page-permissions`, `feature-permissions`, `activity`, `actions` |
| `settings` | `Tabs/Settings/` | guest, admin | 95 | — |
| `adhoc-import` | `Tabs/AdhocImport/` | admin | 97 | — |

`TemplateBuilder` and `ReportDesigner` no longer register standalone tabs — they render inside the sub-tabs noted above.

### Population tab — core workflow

The Population tab orchestrates the end-to-end flow:
- **Phase 1** Excel import (BI + risk data via SheetJS, parsed in Web Worker)
- **Phase 2** Population processing + save to disk (`month.manifest.json`, `risk.raw.json`, `population.final.json`)
- **Phase 3** Sample draw: Hamilton apportionment by port → CertScan/NonCertScan split → Fisher-Yates draw → capacity-weighted spillover
- **Phase 4** Distribution: assign rows to employees → append-only event log → derived current state

Subfolders: `biData/`, `riskData/`, `processing/`, `reporting/`.

### Sampling algorithm

- `rng.ts`: Mulberry32 PRNG (`createRng(seed)`), djb2 hash (`hashSeedString`), Fisher-Yates (`shuffleInPlace`), draw-without-replacement.
- `apportionment.ts`: Hamilton's method (largest-remainder). Ties broken alphabetically.
- `sampleAlgorithm.ts`: Groups rows by portName → Hamilton apportionment → second Hamilton per port for CertScan/NonCertScan split → draw → spillover redistribution for under-capacity ports.
- `samplingAlgorithmVersion` (A2, in `sampleTypes.ts`) is stamped onto every draw alongside its RNG seed. Bump `SAMPLING_ALGORITHM_VERSION` only on a deliberate, approved change to `drawSample`'s semantics — it's how a historical draw is recognized as non-replayable under newer code.

### Distribution event log

Events include assignment, completion, replacement, reassignment, reopen request, and reopen transitions. Current clients durably write `distribution.events/{eventId}.json`; `distribution.log.json` is a legacy projection and `distribution.current.json` a rebuildable cache. The fold enforces legal terminal-state transitions and reports dropped/unrecognized events. Strict global multi-device ordering or atomic multi-event transactions require a backend.

### Executive report editions

`src/data/reporting/executive/` renders the same `ExecutiveReportInput` several ways: `deck2/` (**the live default**, async and main-thread-chunked via `yieldToMain()`), `deck/` (v1, legacy reference only), `document/`, `workbook/` (XLSX), and `viewer/`. Scope is **population-level Level 1 & 2 outcomes** — reviewer/employee performance is deliberately out of scope even though the data is report-ready. The four `المستوى` risk levels are categorical, not a severity ranking; don't describe them as one.

Dev preview: `npm run dev` → `http://localhost:5173/deck-preview.html` renders v2 and v1 from a synthetic month side by side with hot reload (`src/dev/deckPreview.ts`, `deckStyleChoicesPlugin`). It's a separate root HTML entry and is not part of the production build — `dist/` stays a single `index.html`.

### App-wide runtime signals

Two plain pub/sub stores, no state library:

- `src/data/workspace/dataRefreshSignal.ts` — a "re-read your data" broadcast from the AdminToolbar refresh button (`"manual"`) and a 3-minute auto-refresh timer (`"periodic"`), so another user's action shows up without a page reload. Any view that loads workspace data on mount subscribes. **A refresh must never clobber unsaved local draft state** — that has already been a real bug.
- `src/data/workspace/bootProgress.ts` + `BootSplashOverlay` — the post-login data-source checklist, keyed by session+workspace. Children always mount under the overlay so their own effects can register boot sources; a source left in `error` deliberately does not block `allLoaded`. This area is effect-timing-sensitive and regressed five times in a row (v59.190–v59.197), every round caught by review rather than by self-testing — including after real-browser confirmation. Change it test-first and get it reviewed.

### Labels / localization

All UI strings that may need customization are stored in `src/data/labels/labelsStore.ts` as `DEFAULT_LABELS`. Admins can override any key via the Settings tab; overrides persist to `localStorage` under `xray_custom_labels_v1`. Components call `getLabels()` to read and `useLabels()` to subscribe to changes. **Hard-code Arabic strings only as a last resort** — prefer adding a label key.

## Conventions

- **UI text is Arabic, layout is RTL** (`dir="rtl"` on containers). All user-facing strings must be Arabic (or added as label keys); code identifiers stay English.
- Plain CSS co-located per component (no CSS framework).
- `import type` for type-only imports; ESLint is the formatting/static-analysis gate.
- Tests use Vitest with `node` as the **default** environment; 66 component tests opt into jsdom per-file, and `src/test-setup.ts` registers the jest-dom matchers. Mechanics under *Common tasks*.
- Sampling, distribution event folding, and report/export builders are deterministic by contract — snapshot before changing, never after.
- Domain questions (what a column means, ZATCA terminology, what an L1/L2 audit actually *is*) are answered in `docs/reference/`: `DATA_DICTIONARY.md`, `APP_AUDIT_MODEL.md`, `DEPARTMENT_GLOSSARY.md`. Check there before inferring domain semantics from code.

## Common tasks

**Add a UI string** → add a key to `DEFAULT_LABELS` in `labelsStore.ts`; read it with `getLabels()`, or `useLabels()` if the component must re-render on override. Don't inline the Arabic.

**Add a tab** → create `src/components/Sidebar/Tabs/<Name>/index.tsx` exporting a default component *and* `tabConfig` (the glob only matches `index.tsx` exactly one level down — a nested or differently-named file is silently never registered). Then add a matching entry to `tabCatalog.ts` with the id, Arabic label, `allowedRoles`, and `parentId` for a sub-tab. `tabCatalog.test.ts` enforces that the two agree, so a mismatch fails the suite rather than shipping a dead tab.

**Add a file to the workspace** → resolve the directory through `workspacePaths.ts`, write with `safeWriteJson` wrapping the payload in `wrap()` from `jsonEnvelope.ts`. Use `casLoop` if more than one machine can write the same file; use the append-only event pattern (as distribution does) if you need ordering rather than last-write-wins. Never call `getFileHandle`/`createWritable` directly, and always guard `createWritable` — it's typed optional.

**Touch sampling, distribution folding, or a report/export builder** → these are deterministic by contract. Snapshot the current output *first*, then change, then diff the snapshot. Bump `SAMPLING_ALGORITHM_VERSION` only for a deliberate, approved semantic change to `drawSample` — it's how a historical draw is recognized as non-replayable.

**Write a test that needs disk I/O** → `createMemoryDirectory()` from `src/data/storage/memoryDirectory.ts`. For a component test, add `/* @vitest-environment jsdom */` as line 1 and import `describe`/`it`/`expect` from `vitest` (`globals: false`).

**See a change in the real app** → `npm run dev`. For the executive deck specifically, `http://localhost:5173/deck-preview.html` is far faster than driving the full report flow. The app needs Chrome/Edge for the File System Access API.

**Before claiming done** → run the gates for your tier (see the ladder above), then write the edit-log entry with `npm run editlog`. Don't report a change as working on the strength of reading the code — this repo has a documented history of effect-timing and state-machine bugs surviving self-review, including after real-browser confirmation.
