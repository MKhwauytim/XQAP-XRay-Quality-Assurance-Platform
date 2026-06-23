# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

X-ray quality control app (`x-ray-quality-app-v1`): an Arabic, RTL-first React 19 + TypeScript + Vite SPA for importing radiology BI/risk data from Excel, processing a population, drawing a stratified random sample, distributing assignments to employees, collecting answers, and generating self-contained HTML reports. **No backend** — all state lives in the browser or in a user-selected workspace folder on disk.

## Edit log requirement

**Before applying any code edit**, record it in `docs/EDIT_LOG.md`. Every entry must capture:

1. **Version** — increment using semver-lite:
   - Major feature, refactor, or architectural change → bump the whole number (v1 → v2 → v3)
   - Bug fix, small tweak, or hotfix → bump the decimal (v1.0 → v1.1 → v1.2)
2. **Date** — ISO date (YYYY-MM-DD)
3. **What changed** — brief description
4. **Before** — the exact code/content that was replaced (paste the old snippet)
5. **After** — the exact code/content that replaced it

Use this format in `docs/EDIT_LOG.md`:

```markdown
## v{N} — YYYY-MM-DD — {short description}

**File:** `path/to/file.ts`

**Before:**
\`\`\`ts
// old code here
\`\`\`

**After:**
\`\`\`ts
// new code here
\`\`\`
```

If an edit touches multiple files, add one `**File:**` block per file under the same version entry. Create `docs/EDIT_LOG.md` if it does not exist yet.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build → single self-contained dist/index.html
npm run lint       # ESLint
npm run preview    # Preview the built file
npm run test:run   # Vitest (node env), all tests
npm run test       # Vitest watch mode
npx vitest run src/data/sampling/sampleAlgorithm.test.ts  # run a single test file
```

## Build & dependency gotchas

- `vite-plugin-singlefile` inlines everything (`assetsInlineLimit` maxed, `cssCodeSplit: false`): the build output is **one portable `dist/index.html`** (~942 kB, 286 kB gzip).
- The `xlsx` dependency is installed from a **SheetJS CDN tarball** (`https://cdn.sheetjs.com/xlsx-0.20.3/...`), not the npm registry — `npm install` needs access to that URL; don't "upgrade" it to the stale npm package.
- The workspace features require the **File System Access API** (`showDirectoryPicker`), so the app only fully works in Chromium browsers (Chrome/Edge). Other browsers get the `unsupported_browser` state.
- TypeScript is in strict mode. `createWritable` on `FileHandleLike` is typed as optional — always guard with `if (!fh.createWritable) return/continue;` before calling it.
- Excel parsing runs in a **Web Worker** (`src/workers/workbookWorker.ts`) to avoid blocking the UI. The worker posts `progress` and `result` messages back to the main thread.
- `recharts` is used for charts in the Reports and EmployeeWorkspace tabs.

## Disk layout (workspace folder)

The user picks a root directory. Inside:

```
Population/
  {MM-MonthName-YYYY}/         ← one folder per processed month
    month.manifest.json
    risk.raw.json
    population.final.json
    bi.raw.json                 ← only if BI rows present
    sample/
      sample.master.json
    distribution.log.json       ← append-only event log
    distribution.current.json   ← derived snapshot
    employee-answers/
      {username}.answers.json
templates/
  {templateId}.json
  templates.index.json
.system/
  backups/
    {YYYY-MM-DDTHH-MM-SS}/     ← backup snapshots
      backup.manifest.json
      {month}/ …key files…
```

Month folder names follow the pattern `{month}-{MonthName-en}-{year}` (e.g. `5-May-2026`).

## Architecture

### Two persistence layers — don't mix them

1. **Browser storage (auth & permissions)** — `src/auth/`
   - Login: new passwords hashed with **Argon2id** via `hash-wasm` (m=19 MiB, t=2, p=1 — OWASP 2026 baseline). Legacy PBKDF2-SHA256 hashes are still verified for backwards compatibility, and are **transparently upgraded to Argon2id on successful login** (`needsRehash` → `persistUserPasswordHash`). Bootstrap `admin` hash stored in `authConfig.ts`.
   - Session → `localStorage` (`authSession.ts`), persisted across browser restarts with a **7-day TTL** measured from `loginAt`; expired/invalid sessions are cleared on read. Managed users + role→tab permission matrix → `localStorage` (`xray_user_management_v1`), changes broadcast via custom DOM event (`subscribeToUserManagementChanges`).
   - Roles: `guest` / `employee` / `supervisor` / `manager` / `admin` (5 roles — see `AuthRole` in `authTypes.ts`). `admin` is the bootstrap superuser; `manager` is the top managed role. `App.tsx` filters tabs by role + permission matrix.
   - `MANAGED_TABS` in `userManagement.ts` must list every tab; `createDefaultPermissions()` must include all role×tab combinations.

   > **Security model — advisory only.** With no backend, all role/permission checks run in the browser and all business data is plain JSON on disk. A determined user can edit `localStorage` or the JSON files directly to self-elevate or tamper. The auth layer is a UX/role-routing guard, **not** a trust boundary. The bootstrap admin hash ships in the client bundle, so the passcode must be strong (it is offline-crackable). Do not treat this app as a defense against malicious insiders.

2. **Workspace folder on disk (business data)** — `src/data/`
   - Safe write layer: `safeWriteJson` / `safeReadJson` in `src/data/storage/safeWrite.ts`. Each write: snapshot current → `{file}.bak`, stage serialized content in `{file}.tmp` and verify it, then commit to the live file and re-verify (rolling back from `.bak` on failure). The File System Access API has no atomic rename, so this is snapshot-and-verify, not a true atomic swap; `safeReadJson` recovers from `.bak` if the live file is corrupt.
   - `JsonEnvelope<TData>` wraps every JSON file: `{ metadata: { schemaVersion, revision, contentHash, ... }, data }`.
   - Web Locks API (with promise-chain fallback) prevents concurrent writes within a tab.
   - `WorkspaceProvider.tsx` / `useWorkspace.ts` — React context for directory handle.

### Data-layer modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Population storage | `src/data/population/` | Month folder CRUD, manifest, raw/final JSON |
| Sampling | `src/data/sampling/` | Hamilton apportionment, Mulberry32 RNG, Fisher-Yates, draw algorithm |
| Distribution | `src/data/distribution/` | Append-only event log, `deriveCurrentDistribution` fold, bulk assignment, replacement |
| Templates | `src/data/templates/` | Template schema CRUD + index + runtime evaluation |
| Answers | `src/data/answers/` | Per-employee per-month answer files |
| Reporting | `src/data/reporting/` | Self-contained Arabic HTML report builders (sample + distribution) |
| Backup | `src/data/backup/` | Copy key files to `.system/backups/`, archive status check |
| Approvals | `src/data/approvals/` | Referral approval records |
| Referrals | `src/data/referral/` | Referral request storage |
| Feedback | `src/data/feedback/` | User feedback records |
| Labels | `src/data/labels/` | UI label overrides (`labelsStore.ts`) persisted to `localStorage`; `useLabels()` re-renders on change |
| Preferences | `src/data/preferences/` | Browse preset storage |

### Shared UI components

| Component | Path | Notes |
|-----------|------|-------|
| `DataTable` | `src/components/DataTable/` | Reusable filterable/sortable table with column visibility, XLSX export |
| `PageHeader` | `src/components/PageHeader/` | Eyebrow + title + subtitle header pattern |
| `FeedbackWidget` | `src/components/FeedbackWidget/` | Floating feedback collector |
| `PermissionGuard` | `src/components/PermissionGuard.tsx` | Renders children only when the current user has a given permission |
| `ErrorBoundary` | `src/components/ErrorBoundary.tsx` | Top-level React error boundary |

### Tab system

Tabs are auto-discovered: `tabRegistry.ts` uses `import.meta.glob("./*/index.tsx", { eager: true })` over `src/components/Sidebar/Tabs/`. Each tab folder exports a default component + a `tabConfig` (id, label, order, allowedRoles, icon). Also register in `MANAGED_TABS` and `createDefaultPermissions()` in `userManagement.ts`.

**Current tabs:**

| Tab id | File | Roles | Order |
|--------|------|-------|-------|
| `population` | `Tabs/Population/` | all | 10 |
| `employee-workspace` | `Tabs/EmployeeWorkspace/` | all | 15 |
| `template-builder` | `Tabs/TemplateBuilder/` | admin | 20 |
| `reports` | `Tabs/Reports/` | supervisor, admin | 25 |
| `archive` | `Tabs/Archive/` | supervisor, admin | 30 |
| `user-management` | `Tabs/UserManagement/` | admin | 40 |
| `settings` | `Tabs/Settings/` | guest, admin | 95 |

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

Events: `assigned` | `completed` | `replacement-requested` | `replaced` | `reassigned`. Stored append-only in `distribution.log.json`. `deriveCurrentDistribution()` folds events in order — last event per `xrayImageId` wins — to produce the current state snapshot.

### Labels / localization

All UI strings that may need customization are stored in `src/data/labels/labelsStore.ts` as `DEFAULT_LABELS`. Admins can override any key via the Settings tab; overrides persist to `localStorage` (`xray-labels-v1`). Components call `getLabels()` to read and `useLabels()` to subscribe to changes. **Hard-code Arabic strings only as a last resort** — prefer adding a label key.

## Conventions

- **UI text is Arabic, layout is RTL** (`dir="rtl"` on containers). All user-facing strings must be Arabic (or added as label keys); code identifiers stay English.
- Plain CSS co-located per component (no CSS framework).
- `import type` for type-only imports; ESLint + Prettier configured.
- Tests use Vitest with `node` environment and a `createMemoryDirectory()` helper (`src/data/storage/memoryDirectory.ts`) that implements `DirectoryHandleLike` in memory — use it for any test that needs file I/O.
- There is also an **in-app test runner** at `src/test-runner/` (browser-side, separate from Vitest) for integration smoke-tests that need real browser APIs.
