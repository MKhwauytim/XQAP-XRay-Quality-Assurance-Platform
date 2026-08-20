# XQAP — X-ray Quality Assurance Platform — Product Requirements

## 1. Product summary

XQAP is a **fully client-side, backend-free single-page web application** for radiology/cargo
X-ray quality assurance teams. It imports Excel risk/BI data, processes a monthly population,
draws a stratified statistical sample, distributes that sample to inspectors, collects their
inspection answers, and produces self-contained audit-ready reports.

- Stack: React 19 + TypeScript (strict) + Vite 8 + Vitest, Arabic-first, RTL by default.
- No server, no database, no cloud account. All business data is plain JSON files inside a
  **workspace folder the user picks on their own disk** via the File System Access API.
- Ships as a single portable `dist/index.html` (~3 MB) via `vite-plugin-singlefile`.

## 2. Platform requirements and hard constraints

- **Chromium browsers only** (Chrome / Edge 92+). The app depends on `showDirectoryPicker`.
  Firefox and Safari must land on an explicit "unsupported browser" state, never a blank page
  or a crash.
- Until a workspace folder is chosen, the app runs in a **landing / no-workspace state**.
  Choosing a folder requires a **native OS directory picker**, which cannot be driven by an
  automated browser agent. Automated UI testing is therefore expected to cover everything
  reachable *before* a workspace is selected.
- All user-facing copy is Arabic; containers are `dir="rtl"`.

## 3. Authentication and roles

- Auth is **client-side and advisory only** — it shapes the UI, it is not a security boundary.
- Sessions live in browser storage (7-day fallback expiry). Managed users, password hashes and
  the role↔permission matrix live in the workspace file `3-user-data/users.permissions.json`.
- Passwords: Argon2id (hash-wasm); legacy PBKDF2 records upgrade on successful login.
- Roles: `guest`, `employee`, `supervisor`, `manager`, `admin`.
- There is **no login server and no test account**. A visitor starts as guest on the landing
  screen. Admin access is gated by a locally configured passcode.

## 4. Functional modules

| Module | Tab id | Requirement |
|---|---|---|
| Population | `population` | Import risk Excel (required) + BI Excel (optional) through a web worker that never freezes the UI; map/validate columns; persist a month snapshot; draw a stratified sample (Hamilton apportionment + Fisher–Yates, seeded Mulberry32 RNG); distribute rows to inspectors; produce a data-accuracy report linking population → sample → distribution → answers. |
| Employee Workspace | `employee-workspace` | Inspector's daily screen: assigned referrals, submit inspection results, request/approve referral replacement, render the inspection form from the active template. |
| Notification Center | `ew/notifications` | Workspace-wide notices from managers with required acknowledgement; conflict-safe for multiple users on one shared folder. |
| Reports | `reports` | Self-contained printable Arabic HTML reports (sample, distribution, executive); KPI dashboards; a drag-and-drop Report Designer building custom dimension/measure reports; Power BI CSV export. |
| Archive | `archive` | Previous months, JSON-first backups with size-bounded optional XLSX export, restore and integrity status. |
| User Management | `user-management` | Admin-only. Create/manage accounts, tab & feature permission matrix, activity log, recent-actions log. |
| Settings | `settings` | Customize any UI label, storage/sync settings, admin passcode editor, error log, system/version info. |

Tab visibility must match `src/auth/tabCatalog.ts` role ceilings. Tabs above the current role's
ceiling must not render, and every mutating control must be gated by `canMutate` at both render
and handler level.

## 5. Data durability requirements

- All workspace writes use temp → verify → commit with a `.bak` backup (`safeWriteJson`).
- Business JSON files carry a `JsonEnvelope` header: schema version, revision, content hash.
- Distribution history is **append-only**: every assignment, replacement and reassignment is an
  immutable event file. `distribution.log.json` is a compatibility projection;
  `distribution.current.json` is a rebuildable cache.
- Corrupt governance data must fail loudly. It must never be silently reinterpreted as empty.
- Sampling must stay deterministic for a given seed; `SAMPLING_ALGORITHM_VERSION` changes only
  through a deliberate, reviewed migration.

## 6. Quality attributes to verify

1. **Landing / first run** — the app loads at `/` with no console errors, shows the Arabic RTL
   landing screen, and clearly explains that a workspace folder must be chosen.
2. **Unsupported browser** — non-Chromium engines get the explicit unsupported state.
3. **Boot splash** — the boot progress overlay appears during startup and reliably disappears
   once startup completes, including when no tab registers a checklist and the user switches
   tabs seconds later.
4. **RTL and i18n** — the document/root containers are `dir="rtl"`; Arabic text renders with the
   bundled IBM Plex Sans Arabic font; no Latin fallback boxes.
5. **Navigation shell** — tab switching works by mouse and keyboard, the active tab is exposed
   to assistive tech, and no tab throws when opened without a workspace.
6. **Accessibility** — focus is trapped inside dialogs, Escape closes them, focus returns to the
   opener, `aria-live` regions announce status, and reduced-motion preferences are honored.
7. **Empty and error states** — every data-backed view shows a meaningful Arabic empty state
   rather than a spinner that never ends or a blank panel, when no workspace is connected.
8. **Settings without a workspace** — label customization persists to browser storage and
   re-renders the UI immediately.
9. **Resilience** — reloading the page and deep-linking to the root never produces a white
   screen or an unhandled promise rejection.
10. **Performance** — first meaningful paint of the landing screen under ~3 s on a local build.

## 7. Explicit non-goals

- No backend, no multi-device transactional ordering, no exactly-once delivery.
- Enterprise-grade access control (that would require a server).
- Browsers without the File System Access API.
