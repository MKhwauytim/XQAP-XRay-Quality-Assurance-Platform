# X-Ray Quality Assurance Platform

An Arabic, RTL-first React 19 + TypeScript + Vite SPA for radiology quality control. Import BI and risk data from Excel, process a population, draw a stratified random sample, distribute assignments to employees, collect answers via an inspection template, and generate self-contained HTML reports. All state lives in the browser or in a user-selected workspace folder on disk — no backend required.

## Browser Requirements

This app requires **Chromium-based browsers** (Chrome, Edge 92+) to function fully. The application relies on the **File System Access API** (`showDirectoryPicker`) to read and write data to a workspace folder on your machine. Other browsers (Firefox, Safari) are not supported.

## Prerequisites

- **Node.js** ≥ 20 (for local development)
- **Internet access** for the initial `npm install` (the SheetJS Excel library is fetched from a CDN tarball)
- **Chromium browser** (Chrome or Edge) to run the application

## Quick Start

```bash
# Install dependencies (requires internet for SheetJS CDN tarball)
npm install

# Start the development server
npm run dev

# Open the app in Chrome or Edge at http://localhost:5173
```

## Build & Deployment

```bash
npm run build
```

Produces a single self-contained file at `dist/index.html` (~1.9 MB; ~286 kB gzipped). This file can be:
- Opened directly in any Chromium browser (no server required)
- Distributed via email, USB, or any file-sharing service
- Hosted on a static HTTP server

## Available Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Vite dev server on `http://localhost:5173` |
| `npm run build` | Compile TypeScript, build single self-contained `dist/index.html` |
| `npm run preview` | Preview the built HTML locally before deployment |
| `npm run lint` | Run ESLint to check code style and errors |
| `npm run test:run` | Run all Vitest tests (Node environment) |
| `npm run test` | Run tests in watch mode |

## Architecture Overview

This is a **fully client-side React SPA** with no backend server. User data and configuration are persisted in two layers:

1. **Browser storage** — Authentication state (hashed passwords) and user permissions live in browser `localStorage`. Sessions are runtime-only and do not survive a page refresh.
2. **Workspace folder on disk** — Population data, samples, distribution assignments, and employee answers are stored as JSON files in a user-selected folder via the File System Access API. Files are protected with a safe-write layer (snapshot → verify → commit) and JSON schema versioning.

**Stack:** React 19 · TypeScript (strict mode) · Vite · Vitest · lucide-react icons · recharts · SheetJS (Excel parsing via Web Worker)

## User Workflow: 4 Phases

### Phase 1: Excel Import
Users upload an Excel file containing BI data (optional) and risk data (required). The file is parsed in a Web Worker to avoid blocking the UI. Columns are auto-mapped based on column headers; admins can customize the mapping per sheet.

### Phase 2: Population Processing
The imported rows are processed (deduplicated, validated, grouped by port), saved to disk, and a month manifest is created. Population data includes row-level risk classification and any computed fields.

### Phase 3: Sample Draw
A stratified random sample is drawn using Hamilton's method for apportionment and Fisher-Yates shuffling. The sample is split by port and CertScan/NonCertScan status, with capacity-weighted spillover redistribution for under-capacity ports. Sample data is saved to disk.

### Phase 4: Distribution & Answers
Sample rows are assigned to employees, creating an append-only event log (assigned → completed → replacement-requested → replaced → reassigned). Each employee receives a template-based inspection form where they record answers (image quality, findings, referrals, etc.). Reports are generated summarizing sample quality, distribution, and executive metrics.

## Workspace Folder Layout

The app creates and maintains this structure in a user-selected directory:

```
Root (user picks this folder)
├── 1-population/
│   └── {MM-monthname-YYYY}/          # One folder per processed month
│       ├── month.manifest.json
│       ├── 1-raw/
│       │   ├── risk.raw.json
│       │   └── bi.raw.json            # Optional, only if BI rows present
│       ├── 2-processed/
│       │   └── population.final.json
│       ├── distribution.log.json      # Append-only event log
│       └── distribution.current.json  # Derived snapshot
├── 2-samples/
│   └── {MM-monthname-YYYY}/
│       ├── 1-main/
│       │   ├── sample.master.json
│       │   └── main.samples.json
│       └── 2-employees/
│           └── {username}.samples.json
├── 3-user-data/
│   ├── users-permissions.json
│   └── managed-users.json
├── 6-templates/
│   ├── {templateId}.json
│   └── templates.index.json
└── 5-system/
    └── backups/
        └── {YYYY-MM-DDTHH-MM-SS}/    # Backup snapshots
```

Month folder names follow the pattern `{month}-{monthname-en}-{year}`, lowercase (e.g., `5-may-2026`).

## Authentication & Roles

The app has **5 user roles**:

- **guest** — View-only access to some reports; no data entry
- **employee** — Can view their assigned cases and submit answers
- **supervisor** — Can view reports and archive; cannot manage users
- **manager** — Can manage employee accounts and permissions; cannot create templates
- **admin** — Full access including template creation, user management, and system settings

An initial **admin** account is bootstrapped with a passcode stored in the client bundle. Admins can create managed user accounts (employee, supervisor, manager) with custom usernames and passwords. Passwords are hashed with **Argon2id** (OWASP 2026 baseline) on new logins; legacy PBKDF2-SHA256 hashes are transparently upgraded.

**Security note:** This is a client-side app with no backend. All authentication checks run in the browser, and all business data is plain JSON on disk. The auth layer is a **UX/role-routing guard, not a trust boundary**. A determined insider can edit `localStorage` or JSON files directly to self-elevate or tamper with data.

## Key Features

### Excel Import & Mapping
- Drag-drop or file-picker for Excel import
- Auto-detect and preview sheets
- Flexible column mapping (system fields + custom fields)
- Data validation and error reporting
- Web Worker parsing to keep UI responsive

### Stratified Sampling
- Hamilton apportionment by port
- CertScan / NonCertScan split
- Fisher-Yates shuffle for randomness
- Capacity-weighted spillover for under-capacity ports
- Deterministic, reproducible (seed-based)

### Inspection Template System
- Admin-defined templates with phases and fields
- Conditional field visibility (cascade support)
- Rich answer types (text, number, date, select, checkbox, multi-select, free-text)
- Template evaluation at runtime

### Distribution & Assignment
- Bulk assignment of sample rows to employees
- Per-employee assignment tracking
- Replacement request workflow
- Append-only event log for audit trail

### Reporting
- Self-contained HTML reports (no server dependencies)
- Sample quality report
- Distribution / assignment report
- Executive summary
- All Arabic text, RTL layout, printable

### Data Integrity
- Safe-write layer: snapshot → verify → commit → re-verify
- Rollback from `.bak` on corruption
- JSON envelope schema versioning
- Web Locks API prevents concurrent writes

## Development Notes

### Code Organization

- **`src/auth/`** — Authentication, session, user management, roles & permissions
- **`src/data/`** — Data-layer modules: population, sampling, distribution, templates, answers, reporting, backup
- **`src/components/`** — React UI components and tab system
- **`src/utils/`** — Shared utilities: formatting, error logging
- **`src/workers/`** — Web Worker for Excel parsing

### Testing

- **Vitest** (Node environment) — Unit tests for data logic, storage, sampling algorithms
- **In-app test runner** (`src/test-runner/`) — Integration smoke tests requiring real browser APIs (File System Access)
- Memory helper: `createMemoryDirectory()` in `src/data/storage/memoryDirectory.ts` implements `DirectoryHandleLike` for tests

### Code Style

- TypeScript strict mode enabled
- ESLint + Prettier configured
- Use `import type` for type-only imports
- Arabic UI text only (no hard-coded English strings in UI)
- No CSS frameworks — plain CSS co-located per component
- lucide-react for all icons (no Unicode symbols or emoji)

### Excel & Sheets

- **SheetJS** (`xlsx`) is installed from a CDN tarball, not npm registry
- Parsed in a Web Worker (`src/workers/workbookWorker.ts`)
- Results posted back to main thread as `progress` and `result` messages

### Charts & Visualization

- **recharts** for line, bar, and pie charts in Reports and EmployeeWorkspace tabs

## Editor & Environment

- Developed with Vite for fast HMR (hot module replacement)
- Built with `vite-plugin-singlefile` for single-file output
- Max TypeScript strict rules enabled

## Support & Documentation

- **CLAUDE.md** — Comprehensive architecture guide for developers
- **EDIT_LOG.md** — Complete version history with before/after code snippets
- **docs/superpowers/plans/** — Implementation plans and design decisions
