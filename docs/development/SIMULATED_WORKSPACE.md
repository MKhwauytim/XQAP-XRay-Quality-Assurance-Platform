# Simulated workspace (`?sim=1`) — dev-only, writable, picker-free

**Status:** active · **Added:** 2026-08-22 · **Scope:** development and browser automation only. Never present in a production build.

## Why it exists

The app gates on `showDirectoryPicker()` (File System Access API), which needs a real user gesture and a real folder on disk. A headless browser has neither, so the entire application was unreachable to automated UI testing and every UI change was only ever verified in jsdom.

The existing read-only demo (`Alt+A`, `Alt+T` → passcode `view`) does not solve this: `WorkspaceProvider.enterDemoWorkspace` finishes with `setReadOnlyMode(true)`, and the demo session carries `mode: "demo"`, which forces `usePermissions().isReadOnly`. Every answer, reassignment and import is rejected, so no real flow can be driven.

The simulated workspace mounts the same kind of in-memory `DirectoryHandleLike` **without** either of those, so a full flow (answer → submit → reassign → report) actually executes.

## URL contract

Served by the Vite dev server only (`npm run dev`, default `http://localhost:5173`).

| URL | Effect |
|---|---|
| `/?sim=1` | Mount the writable simulated workspace, auto sign-in as the **bootstrap admin** (`admin`). |
| `/?sim=true` | Identical — `1` and `true` are the only accepted values. |
| `/?sim=1&role=<role>` | Sign in with that role's seeded account. `role` ∈ `guest \| employee \| supervisor \| manager \| admin`; an unknown value falls back to `admin`. |
| `/?sim=1&user=<username>` | Attribute the session to this username instead of the role's default account, keeping `role`. |
| anything else | No effect whatsoever — picker, login form and every gate behave exactly as they do today. |

Role → seeded account:

| `role=` | username | notes |
|---|---|---|
| `admin` | `admin` | the bootstrap admin; exempt from managed-user validation by design |
| `manager` | `amonem` | shipped default user |
| `supervisor` | `malrogi` | shipped default user, holds assigned rows |
| `employee` | `jalgahamdi` | shipped default user, holds assigned rows |
| `guest` | `simguest` | **added by the seed** — the shipped defaults have no guest |

The `guest` account exists because the simulated session is an *ordinary* session (no `mode: "demo"`), and AuthGate re-validates non-bootstrap sessions against the managed roster once the workspace hydrates (`stillHasManagedUser`). A `?role=guest` session with no matching active managed user would be logged straight back out.

Every seeded account carries the same shipped default-user password hash a fresh workspace ships with (`DEFAULT_USER_PASSWORD_HASH` in `src/auth/userManagement.ts`) — cloned rather than re-derived, because Argon2 hashing is async and the seed must not depend on WASM being available. A test that wants to exercise the **real** login form instead of the auto-login can log out and sign in with that password.

### Signals a page is simulated

* A fixed yellow-striped banner at the top of the page: `[data-sim-banner]`, text `بيانات محاكاة للتطوير فقط — SIMULATED DATA, NOT REAL`. It is injected directly into `<body>` by `src/dev/simMode.ts`, so no production component carries a sim-only branch.
* The sidebar's workspace name reads `Simulated-Workspace`.

## What is seeded

One month — **June 2026**, folder `6-june-2026` — written entirely through the **real domain writers** (`saveMonthRun`, `drawSample`, `saveSampleMaster`, `calculateBulkAssignment`, `appendDistributionEvents`, `saveEmployeeAnswers`, `saveTemplate`), never a hand-rolled JSON file. The seeded JSON therefore cannot drift from the production schema.

Counts a test may assert (all pinned in `src/dev/simWorkspace.test.ts`):

| Thing | Value |
|---|---|
| Population rows | **320** — 120 جدة (`JED`), 90 الدمام (`DMM`), 70 البطحاء (`BTH`), 40 الرياض (`RUH`) |
| Ports | 4 (بحري ×2, بري, جوي) |
| Sample rows drawn | **96** (30 % stage-1 rule, Hamilton by port) |
| Assigned to `jalgahamdi` | **34** |
| Assigned to `hihaloraini` | **29** |
| Assigned to `saalhijji` | **19** |
| Assigned to `malrogi` | **14** |
| Managed users | 7 (6 shipped defaults + `simguest`) |
| Inspection template | 1 — `sim-inspection-template`, set as the active selection |

Per employee, assigned rows cycle a fixed 5-slot pattern: 2 **submitted**, 1 **draft**, 2 **pending with no answer record at all**. The answer-on-behalf rule turns on that distinction, so all three states are present for every reviewer at once.

`targetedByRiskEngine` is spread evenly over the four categories `engineVerdictOf` (`src/data/population/riskEngineVerdict.ts`) actually distinguishes — **80 rows each**:

| Category | Seeded value | `engineVerdictOf` |
|---|---|---|
| recognized affirmative | `نعم` | `اشتباه` |
| recognized negative | `لا` | `سليمة` |
| blank | `null` | `null` |
| unrecognized | `قيد المراجعة` | `null` |

That is what makes the «مستهدف المؤشر» filter meaningfully exercisable: a seed emitting only نعم/لا cannot tell "the engine said no" apart from "we do not know what the engine said", which is the exact distinction `riskEngineVerdict.ts` exists to preserve. Suspicious rows (`seq % 8 === 0`) are a subset of the affirmative bucket, so the correlation is realistic, and affirmative rows survive into the drawn sample.

Templates, `4-reports/`, notifications, backups and audit are left at whatever `createWorkspaceStructure` produces — extend `SIM_SEED_PROFILE` if a screen needs more.

### Reused vs. added

* **Reused.** `createMemoryDirectory`, `createWorkspaceStructure`, and the whole month seed from `demoWorkspace.ts`. `seedDemoMonth` was **parameterized** into an exported `seedWorkspaceMonth(handle, profile)` with a `WorkspaceSeedProfile`; the demo now passes `DEMO_SEED_PROFILE` and the simulation passes `SIM_SEED_PROFILE`. One implementation, two configurations — no copy to drift.
* **Added to the shared seeder** (so the demo gets them too): the inspection template + active selection (the demo's seeded answers referenced `demo-inspection-template`, which was never written anywhere, so the inspection form had nothing to render), and the `riskEngineSpread` option. The demo stays on `"binary"`, so its numbers are unchanged — pinned by the new `src/data/workspace/demoWorkspace.test.ts`.
* **Added, simulation-only:** the larger 4-port profile, the `simguest` account, the URL contract, the auto-login, and the banner.

## Determinism

The seed must produce the same data on every run — "employee X holds 34 rows" has to stay true tomorrow.

* No `Math.random()` anywhere. The draw runs off the fixed RNG seed string `xray-sim-fixed-seed-v1` through `createRng`/Fisher–Yates.
* No `Date.now()` in any seeded **value**. Every answer timestamp is `SIM_SEEDED_AT` (`2026-07-01T08:00:00.000Z`); the seeded user records use the same fixed timestamp.
* Apportionment (Hamilton) and distribution folding are deterministic by contract.

Not deterministic, and deliberately so: envelope metadata written by the **real** writers — `metadata.writtenAt`, `contentHash`, `revision`, and distribution `eventId` UUIDs. Those writers are the production ones and are not forked for seeding. Assert row counts, ids and field values, never file bytes or event ids.

`src/dev/simWorkspace.test.ts` builds the workspace twice and compares the population rows, the sample order and every employee's answer items.

## Driving it with Playwright

```js
// Against the dev server: npm run dev
await page.goto("http://localhost:5173/?sim=1&role=employee");

// The banner is the readiness + identity signal.
await page.waitForSelector("[data-sim-banner]");

// Then wait for the app shell, not the picker or the login form.
await page.waitForSelector(".app-shell");
```

Notes:

* **Use a Chromium browser.** Nothing in sim mode needs the File System Access API — the provider's `isSupported` and initial `status` both bypass it — but the rest of the app is only exercised as users see it in Chrome/Edge.
* **Switching `role=` between loads just works.** The auto-login persists an ordinary session to `localStorage` (`xray_auth_session_v1`), but it re-issues whenever the stored identity disagrees with the URL, so navigating from `?sim=1&role=employee` to `?sim=1&role=manager` in the same browser context really does switch role. Do not pre-seed that key yourself.
* **One page load = one fresh workspace.** The tree is in-memory; a reload re-seeds from scratch and discards everything the previous run wrote. That is the isolation mechanism — there is nothing to clean up.
* **Exercise permission-gated UI** by switching `role`. An admin session additionally gets the AdminToolbar's role-preview switch.
* **Seeding takes roughly a second.** Wait on the banner or `.app-shell`, never on a fixed timeout.

## Production-exclusion guarantee

The simulated workspace is a **writable, no-auth entry point**. The app ships as a single self-contained `dist/index.html` that people open directly, so it reaching production would be a serious defect. Three independent guards:

1. **Structural — module substitution.** `src/dev/simModePlugin.ts` (`apply: "build"`) aliases the `../dev/simMode` specifier to `src/dev/simMode.prod.ts`, whose exports are inert and which imports nothing but types. `simWorkspace.ts`, the seed profile, the managed-user roster and the URL parser never enter the production module graph. The dev server does not see this plugin at all.
2. **Bundler — dead-code elimination.** Every call site is wrapped in `if (import.meta.env.DEV)`, which folds to `false` at build time. Verified independently sufficient: a build with the plugin's alias disabled still produces a clean `dist/`.
3. **Fail-closed — build assertion.** The same plugin's `generateBundle` hook fails the build if any module matching `src/dev/sim(Mode|Workspace).ts` contributes a non-zero number of rendered bytes to any chunk. This checks the **module graph**, not marker strings in the output: the first version of the guard searched for `"Simulated-Workspace"` and missed a real leak, because with the alias disabled rolldown shook away the unreferenced seed constants but kept `SIM_ROLE_USERNAMES` — the seeded usernames shipped while every marker string was gone.

Layer 3 was verified by deliberately disabling layers 1 and 2 and confirming the build fails with
`Simulated-workspace code leaked into the production bundle: …/src/dev/simWorkspace.ts contributed 328 bytes to index-*.js`.

### Manual audit

```bash
npm run build
for tok in 'sim=1' 'Simulated-Workspace' 'simguest' 'sim-inspection-template' \
           'xray-sim-fixed-seed-v1' 'createSimulatedWorkspace' 'readSimModeConfig' \
           'SIM_ROLE_USERNAMES' 'data-sim-banner'; do
  printf '%-26s %s\n' "$tok" "$(grep -c -a -F -- "$tok" dist/index.html)"
done
```

All counts must be `0`. (`grep -a` — `dist/index.html` contains embedded binary font data and grep otherwise treats it as a binary file.)

The strings `Simulated write permission…` and `simulated ceiling` **do** appear in `dist/`; they belong to `src/data/storage/memoryDirectory.ts`, which is production code the read-only demo already uses.

## Files

| File | Role |
|---|---|
| `src/dev/simMode.ts` | URL contract (`readSimModeConfig`), mount entry, the simulated-data banner |
| `src/dev/simMode.prod.ts` | Inert production stand-in; export surface must stay identical (both are typechecked) |
| `src/dev/simWorkspace.ts` | Seed profile, `simguest` roster, `createSimulatedWorkspace()` |
| `src/dev/simModePlugin.ts` | Build-only alias + fail-closed bundle assertion |
| `src/data/workspace/demoWorkspace.ts` | The shared, parameterized `seedWorkspaceMonth` (also serves the read-only demo) |
| `src/data/workspace/WorkspaceProvider.tsx` | DEV-guarded mount effect; skips the restore path and the `isSupported` gate in sim mode |
| `src/auth/AuthGate.tsx` | DEV-guarded auto-login keyed on the simulated handle's name |

Tests: `src/dev/simWorkspace.test.ts` (seed shape, counts, risk spread, determinism), `src/dev/simMode.test.ts` (URL contract), `src/dev/simMount.test.tsx` (the real gate chain — picker → auth → workspace gate — plus writability), `src/data/workspace/demoWorkspace.test.ts` (the demo's own numbers are unchanged).

## Extending the seed

Edit `SIM_SEED_PROFILE` in `src/dev/simWorkspace.ts`, then **re-run `src/dev/simWorkspace.test.ts` and update the pinned counts**. Those counts are the contract browser tests assert against; changing the profile without updating them silently invalidates every such assertion.
