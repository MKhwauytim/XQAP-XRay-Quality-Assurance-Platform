# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

X-ray quality control app (`x-ray-quality-app-v1`): an Arabic, RTL-first React 19 + TypeScript + Vite SPA for importing radiology BI/risk data from Excel, processing a population, drawing a stratified random sample, distributing assignments to employees, collecting answers, and generating self-contained HTML reports. **No backend** — all state lives in the browser or in a user-selected workspace folder on disk.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build → single self-contained dist/index.html
npm run lint       # ESLint
npm run preview    # Preview the built file
npm run test:run   # Vitest (node env), 58 tests
npm run test       # Vitest watch mode
```

## Build & dependency gotchas

- `vite-plugin-singlefile` inlines everything (`assetsInlineLimit` maxed, `cssCodeSplit: false`): the build output is **one portable `dist/index.html`** (~942 kB, 286 kB gzip).
- The `xlsx` dependency is installed from a **SheetJS CDN tarball** (`https://cdn.sheetjs.com/xlsx-0.20.3/...`), not the npm registry — `npm install` needs access to that URL; don't "upgrade" it to the stale npm package.
- The workspace features require the **File System Access API** (`showDirectoryPicker`), so the app only fully works in Chromium browsers (Chrome/Edge). Other browsers get the `unsupported_browser` state.
- TypeScript is in strict mode. `createWritable` on `FileHandleLike` is typed as optional — always guard with `if (!fh.createWritable) return/continue;` before calling it.

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
   - Login: passwords hashed with PBKDF2-SHA256, 210k iterations (`passwordCrypto.ts`). Bootstrap `admin` hash in `authConfig.ts`.
   - Session → `sessionStorage`; managed users + role→tab permission matrix → `localStorage` (`xray_user_management_v1`), changes broadcast via custom DOM event (`subscribeToUserManagementChanges`).
   - Roles: `employee` / `supervisor` / `admin`. `App.tsx` filters tabs by role + permission matrix.
   - `MANAGED_TABS` in `userManagement.ts` must list every tab; `createDefaultPermissions()` must include all role×tab combinations.

2. **Workspace folder on disk (business data)** — `src/data/`
   - Safe write layer: `safeWriteJson` / `safeReadJson` in `src/data/storage/safeWrite.ts` — temp→commit pattern with `.bak` snapshots.
   - `JsonEnvelope<TData>` wraps every JSON file: `{ metadata: { schemaVersion, revision, contentHash, ... }, data }`.
   - Web Locks API (with promise-chain fallback) prevents concurrent writes within a tab.
   - `WorkspaceProvider.tsx` / `useWorkspace.ts` — React context for directory handle.

### Data-layer modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Population storage | `src/data/population/` | Month folder CRUD, manifest, raw/final JSON |
| Sampling | `src/data/sampling/` | Hamilton apportionment, Mulberry32 RNG, Fisher-Yates, draw algorithm |
| Distribution | `src/data/distribution/` | Append-only event log, `deriveCurrentDistribution` fold |
| Templates | `src/data/templates/` | Template schema CRUD + index |
| Answers | `src/data/answers/` | Per-employee per-month answer files |
| Reporting | `src/data/reporting/` | Self-contained Arabic HTML report builders |
| Backup | `src/data/backup/` | Copy key files to `.system/backups/`, archive status check |

### Tab system

Tabs are auto-discovered: `tabRegistry.ts` uses `import.meta.glob("./*/index.tsx", { eager: true })` over `src/components/Sidebar/Tabs/`. Each tab folder exports a default component + a `tabConfig` (id, label, order, allowedRoles). Also register in `MANAGED_TABS` and `createDefaultPermissions()` in `userManagement.ts`.

**Current tabs:**

| Tab id | File | Roles | Order |
|--------|------|-------|-------|
| `population` | `Tabs/Population/` | all | 10 |
| `employee-workspace` | `Tabs/EmployeeWorkspace/` | all | 15 |
| `template-builder` | `Tabs/TemplateBuilder/` | admin | 20 |
| `reports` | `Tabs/Reports/` | supervisor, admin | 25 |
| `archive` | `Tabs/Archive/` | supervisor, admin | 30 |
| `user-management` | `Tabs/UserManagement/` | admin | 40 |

### Population tab — core workflow

The Population tab orchestrates the end-to-end flow:
- **Phase 1** Excel import (BI + risk data via SheetJS)
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

## Conventions

- **UI text is Arabic, layout is RTL** (`dir="rtl"` on containers). All user-facing strings must be Arabic; code identifiers stay English.
- Plain CSS co-located per component (no CSS framework).
- `import type` for type-only imports; ESLint + Prettier configured.
- Tests use Vitest with `node` environment and a `createMemoryDirectory()` helper that implements `DirectoryHandleLike` in memory.
