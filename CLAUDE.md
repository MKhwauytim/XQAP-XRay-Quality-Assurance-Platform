# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

X-ray quality control app (`x-ray-quality-app-v1`): an Arabic, RTL-first React 19 + TypeScript + Vite SPA for importing radiology BI/risk data from Excel, processing a population, drawing a stratified random sample, distributing assignments to employees, collecting answers, and generating self-contained HTML reports. **No backend** — all state lives in the browser or in a user-selected workspace folder on disk.

## Edit log requirement

**Before applying any code edit**, record it in `docs/EDIT_LOG.md`. Every entry must capture:

1. **Version** — increment using semver-lite:
   - Major feature, refactor, or architectural change → bump the whole number (v1 → v2 → v3)
   - Bug fix, small tweak, or hotfix → bump the decimal (v1.0 → v1.1 → v1.2)
2. **Date** — ISO date (YYYY-MM-DD)
3. **Category** — the title must start with one of: `Fix:`, `Add:`, `Change:`, `Remove:`, `Refactor:`, `Security:`, `Docs:`, `Chore:` (a `(scope):` may follow, e.g. `Fix (auth): …`). This is what the ChangeLog tab (`src/components/Sidebar/Tabs/ChangeLog/`) shows as the entry title, so pick the category matching the *primary* action — when an entry mixes concerns (e.g. a fix that also removes dead code), lead with whichever dominates.
4. **What changed** — brief description
5. **Before** — the exact code/content that was replaced (paste the old snippet)
6. **After** — the exact code/content that replaced it
7. **Lines** — whole-repo line-count stats, since a full revert-by-hand isn't realistic once an entry's own `**Before**`/`**After**` snippets are just excerpts. Run `npm run count-lines -- --quiet` **before** starting the edit and again **after**; combine with `git diff --stat` (once the edit is staged) for the added/removed breakdown of the touched files. Record as:
   `**Lines:** {total before} → {total after} (net {+/-N}) · {files changed} files, +{added} / -{removed}`

Use this format in `docs/EDIT_LOG.md`:

```markdown
## v{N} — YYYY-MM-DD — {Category}: {short description}

**File:** `path/to/file.ts`

**Before:**
\`\`\`ts
// old code here
\`\`\`

**After:**
\`\`\`ts
// new code here
\`\`\`

**Lines:** 167850 → 167912 (net +62) · 3 files, +70 / -8
```

If an edit touches multiple files, add one `**File:**` block per file under the same version entry — the `**Lines:**` line still appears once per entry, covering the whole edit. Create `docs/EDIT_LOG.md` if it does not exist yet.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build → single self-contained dist/index.html
npm run lint       # ESLint
npm run typecheck  # strict TypeScript check
npm run check:complexity # complexity/large-function regression budget
npm run preview    # Preview the built file
npm run test:run   # Vitest, 711 tests / 109 files as of v56.2
npm run test       # Vitest watch mode
npx vitest run src/data/sampling/sampleAlgorithm.test.ts  # run a single test file
```

## Build & dependency gotchas

- `vite-plugin-singlefile` inlines everything (`assetsInlineLimit` maxed, `cssCodeSplit: false`): v56.2 produces one portable `dist/index.html` (~3.04 MB, ~1.13 MB gzip). The ChangeLog `?raw` import is truncated by `src/build/editLogTruncatePlugin.ts`. `npm run check:bundle-size` is the release budget.
- Current whole-product revision and roadmap: `docs/audit/FULL_REVISION_2026-07-17.md`.
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
4-reports/         generated report artifacts (when report flows write to disk)
5-system/          workspace.schema.json, backups/, audit/, locks/, presets, notifications
6-templates/       {templateId}.json, templates.index.json, template selection
```

Month folder names follow `{month}-{MonthName-en}-{year}` (e.g. `5-May-2026`). Legacy roots remain readable; schema migration is dry-run/backup-first and never silently moves or deletes them.

## Architecture

### Two persistence layers — don't mix them

1. **Browser storage (auth & permissions)** — `src/auth/`
   - Login: new passwords hashed with **Argon2id** via `hash-wasm` (m=19 MiB, t=2, p=1 — OWASP 2026 baseline). Legacy PBKDF2-SHA256 hashes are still verified for backwards compatibility, and are **transparently upgraded to Argon2id on successful login** (`needsRehash` → `persistUserPasswordHash`). Bootstrap `admin` hash stored in `authConfig.ts`.
   - Session → runtime module variable in `authSession.ts`, persisted to **`sessionStorage`** (`xray_auth_session_v1`, SEC-02): it survives a page reload but auto-clears when the tab/browser closes. A 7-day TTL applies as a secondary guard on read-back. This is a UX convenience, **not** a security control (see the security-model note below). Managed users + role→tab permission matrix → `localStorage` (`xray_user_management_v1`), changes broadcast via custom DOM event (`subscribeToUserManagementChanges`).
   - Roles: `guest` / `employee` / `supervisor` / `manager` / `admin` (5 roles — see `AuthRole` in `authTypes.ts`). `admin` is the bootstrap superuser; `manager` is the top managed role. `App.tsx` filters tabs by role + permission matrix.
   - `src/auth/tabCatalog.ts` is the source of truth for IDs, Arabic labels, parent relationships, and role ceilings. Defaults and registry consistency are tested against it.
   - Use the centralized `canMutate` capability at both render and handler boundaries for persistent actions.

   > **Security model — advisory only.** With no backend, all role/permission checks run in the browser and all business data is plain JSON on disk. A determined user can edit `localStorage` or the JSON files directly to self-elevate or tamper. The auth layer is a UX/role-routing guard, **not** a trust boundary. The bootstrap admin hash ships in the client bundle, so the passcode must be strong (it is offline-crackable). Do not treat this app as a defense against malicious insiders. Full risk-acceptance detail (trust boundary, passcode policy, viewer-passcode note, localStorage/JSON tamperability, sign-off): `docs/architecture/SECURITY_MODEL.md`.

2. **Workspace folder on disk (business data)** — `src/data/`
   - Safe write layer: `safeWriteJson` / `safeReadJson` in `src/data/storage/safeWrite.ts`. Writes preserve the last valid `.bak`, stage and verify `.tmp`, then commit/re-verify. Transient `NotReadableError` is retried and never reinterpreted as a missing file; read-only handles fail with a typed error.
   - `JsonEnvelope<TData>` wraps every JSON file: `{ metadata: { schemaVersion, revision, contentHash, writtenAt }, data }`. Schema versioning via `wrap/unwrap/isEnvelope` in `src/data/storage/jsonEnvelope.ts`.
   - Web Locks API (with promise-chain fallback) prevents concurrent writes within a tab.
   - `WorkspaceProvider.tsx` / `useWorkspace.ts` — React context for directory handle.

### Data-layer modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Population storage | `src/data/population/` | Month folder CRUD, manifest, raw/final JSON |
| Sampling | `src/data/sampling/` | Hamilton apportionment, Mulberry32 RNG, Fisher-Yates, draw algorithm |
| Distribution | `src/data/distribution/` | Immutable event envelopes, compatibility log projection, derived state, assignment/replacement |
| Templates | `src/data/templates/` | Template schema CRUD + index + runtime evaluation |
| Answers | `src/data/answers/` | Per-employee per-month answer files |
| Reporting | `src/data/reporting/` | Self-contained Arabic HTML report builders (sample + distribution + executive) |
| Backup | `src/data/backup/` | Copy key files to `.system/backups/`, archive status check |
| Approvals | `src/data/approvals/` | Referral approval records |
| Referrals | `src/data/referral/` | Referral request storage |
| Feedback | `src/data/feedback/` | User feedback records |
| Labels | `src/data/labels/` | UI label overrides (`labelsStore.ts`) persisted to `localStorage`; `useLabels()` re-renders on change |
| Preferences | `src/data/preferences/` | Browse preset storage |
| Global month | `src/data/month/` | App-wide month selection (provider + toolbar selector); sessionStorage key `xray_global_month_v1` |
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

### Tab system

Tabs are auto-discovered by `tabRegistry.ts`. Each top-level tab exports a default component and `tabConfig`; its metadata must agree with `src/auth/tabCatalog.ts`.

**Current tabs (as of 2026-07-02):**

| Tab id | File | Roles | Order | Sub-tabs |
|--------|------|-------|-------|----------|
| `population` | `Tabs/Population/` | all | 10 | `process`, `browse` |
| `employee-workspace` | `Tabs/EmployeeWorkspace/` | all | 15 | `ew/xray-referrals`, `ew/xray-results`, `ew/referral-approval`, `ew/inspection-form` (renders `Tabs/TemplateBuilder/`) |
| `reports` | `Tabs/Reports/` | guest, supervisor, manager, admin | 25 | `reports`, `kpi` (manager, admin), `report-designer` (supervisor, manager, admin → `Tabs/ReportDesigner/`) |
| `archive` | `Tabs/Archive/` | guest, supervisor, manager, admin | 30 | — |
| `user-management` | `Tabs/UserManagement/` | admin | 40 | `users`, `page-permissions`, `feature-permissions`, `activity`, `actions` |
| `settings` | `Tabs/Settings/` | guest, admin | 95 | — |
| `change-log` | `Tabs/ChangeLog/` | admin | 96 | — |

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

### Distribution event log

Events include assignment, completion, replacement, reassignment, reopen request, and reopen transitions. Current clients durably write `distribution.events/{eventId}.json`; `distribution.log.json` is a legacy projection and `distribution.current.json` a rebuildable cache. The fold enforces legal terminal-state transitions and reports dropped/unrecognized events. Strict global multi-device ordering or atomic multi-event transactions require a backend.

### Labels / localization

All UI strings that may need customization are stored in `src/data/labels/labelsStore.ts` as `DEFAULT_LABELS`. Admins can override any key via the Settings tab; overrides persist to `localStorage` (`xray-labels-v1`). Components call `getLabels()` to read and `useLabels()` to subscribe to changes. **Hard-code Arabic strings only as a last resort** — prefer adding a label key.

## Conventions

- **UI text is Arabic, layout is RTL** (`dir="rtl"` on containers). All user-facing strings must be Arabic (or added as label keys); code identifiers stay English.
- Plain CSS co-located per component (no CSS framework).
- `import type` for type-only imports; ESLint is the formatting/static-analysis gate.
- Tests use Vitest with `node` environment and a `createMemoryDirectory()` helper (`src/data/storage/memoryDirectory.ts`) that implements `DirectoryHandleLike` in memory — use it for any test that needs file I/O.
