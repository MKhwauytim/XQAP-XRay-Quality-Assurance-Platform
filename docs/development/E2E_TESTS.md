# End-to-end browser tests (`npm run e2e`)

**Status:** active · **Added:** 2026-08-22 · **Runner:** Playwright (Chromium only) · **Suite:** 118 tests / 15 spec files

A full pass over the application in a real browser, from login to report
generation, with no human in the loop. It drives the same screens a user sees,
against the dev-only simulated workspace documented in
[`SIMULATED_WORKSPACE.md`](./SIMULATED_WORKSPACE.md).

---

## Running it

```bash
npm run e2e            # headless, whole suite
npm run e2e:ui         # Playwright's watch/inspect UI
npm run e2e:report     # open the last HTML report

npx playwright test e2e/employee-queue.spec.ts        # one file
npx playwright test -g "answering, submitting"        # one test by title
npx playwright test --headed --workers=1              # watch it happen
npx playwright test --debug -g "reassigns a single"   # step through it
```

The config starts `npm run dev` itself (`webServer`), and reuses an already
running dev server locally (`reuseExistingServer`), so there is nothing to
start by hand.

**Browsers.** `@playwright/test` is pinned to an **exact** version whose bundled
Chromium revision matches the browsers already present in the dev image
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Do not widen that to a `^` range:
a floating version will ask for a Chromium revision that is not on disk and the
suite will refuse to start. If the pin ever has to move, check
`node_modules/playwright-core/browsers.json` against what is actually installed
before upgrading.

---

## The constraint that shapes everything: dev server, not `dist/`

The suite runs against the **Vite dev server**. It cannot run against a preview
of `dist/index.html`, and this is not a convenience choice.

`?sim=1` — the writable, picker-free workspace that makes the app reachable
without a folder picker and a user gesture — is stripped from production builds
by three independent guards (a build-time module alias, `import.meta.env.DEV`
dead-code elimination, and a fail-closed `generateBundle` assertion). In a built
bundle there is no way to mount a workspace at all, so there is nothing to test.

The consequence is worth stating plainly:

> **This suite proves the FEATURES work. It does not prove the shipped bundle
> works.** Those are different failure classes — a missing export, a broken
> `?worker&inline` import, or anything that defeats `vite-plugin-singlefile`'s
> inlining can pass every test here and still produce a dead `dist/index.html`.

The second failure class is covered by `npm run build` and
`npm run check:bundle-size`, which run in `.github/workflows/ci.yml`. That is
why E2E lives in its own workflow: a red X should tell you at a glance whether
the bundle broke or a feature did.

---

## Layout

```
e2e/
  helpers/
    app.ts          gotoSim / openTab / openSubTab / findRow / pasteInto / …
    sections.ts     "this sub-tab's content is on screen" locators
    seed.ts         the simulated workspace's pinned numbers, in one place
  boot-auth.spec.ts
  population-browse.spec.ts
  population-process.spec.ts
  employee-queue.spec.ts
  employee-workspace.spec.ts
  answer-on-behalf.spec.ts
  reassignment.spec.ts
  adhoc-import.spec.ts
  reports.spec.ts
  archive.spec.ts
  notifications.spec.ts
  user-management.spec.ts
  action-log.spec.ts
  settings.spec.ts
  subtab-navigation.spec.ts
playwright.config.ts
tsconfig.e2e.json    so `npm run typecheck` covers the suite too
```

| Spec | What it covers |
|---|---|
| `boot-auth` | Sim mount, auto sign-in per role, the `?role=`/`?user=` contract, the exact tab and sub-tab set each role is granted, the empty state for a role with nothing granted, admin role preview re-gating without a reload |
| `population-browse` | The four datasets (المجتمع النهائي / العينة المسحوبة / تحليل المخاطر / ذكاء الأعمال), 320-row count, paging, free-text search, a multiselect column filter narrowing to 120 Jeddah rows and clearing, XLSX + column controls |
| `population-process` | All four pipeline phases marked complete, the readiness strip, the distribution status matching the folded event log (96/96, 40 done, 56 pending), the bulk planner refusing pre-assigned rows, the per-reviewer quota table and the CertScan-licence warning, manual-review mode |
| `employee-queue` | Personal stats (34 assigned / 14 done / 20 not started), the active template, the three case chips with counts, the scope picker being hidden from an employee, opening a row, a seeded draft reopening filled in, required-field validation, and a full answer → submit → row-completed round trip with the stats moving 14→15 and 20→19 |
| `employee-workspace` | The results grid (96 joined rows, its three scopes), the approvals desk and its two filter rows, the inspection-form builder rendering the seeded template |
| `answer-on-behalf` | All three outcomes of `resolvePanelAuthoring`: editable with the on-behalf notice, locked because already answered, locked for want of the feature — plus granting the feature to `supervisor` in the live matrix and watching the same row become answerable |
| `reassignment` | Single-row reassign from the inspection panel and bulk reassign from the selection bar, the confirmation summary, that both only file a REQUEST, approving it in «اعتماد الطلبات», and the assignment counts then moving 34→33 / 29→30. Also that a completed study cannot be selected |
| `adhoc-import` | Paste a TSV, auto-mapping, the mandatory-result-field block, binding columns by clicking headers, all four assignment modes with their computed plans, executing and saving, and the imported rows arriving in the reviewer's queue as «حالات استثنائية» |
| `reports` | Month scoping and counts, every card's three export formats, the Power BI CSV target folder, the **executive deck actually building and opening** (27 pages, no page error), the sample report likewise, the designer being reachable, and reports/KPI gating for supervisor vs manager |
| `archive` | The workspace summary counters (320 / 96 / 96 / 60), the month status row, a manual backup, the automatic-backup period, and employee lockout |
| `notifications` | Empty state, publish being disabled without text, targeting changing the recipient count, publishing and the acknowledgement counters |
| `user-management` | Roster (7 seeded users), adding a user, a role change, the page matrix's three access levels per role, **revoking a page and watching the rail re-gate**, the feature matrix's grouping and page cascade, the activity view, admin-only gating |
| `action-log` | The reader and its filters, and two actions performed by the test then found again in the log — a page-permission change and a label override (the latter proving the high-volume types are off by default until asked for) |
| `settings` | Label groups, an override propagating out of the settings page into the sidebar with no reload, the editor row reverting its own override, the override counter, the bootstrap-admin block, a rejected password pair, the error log and storage report |
| `subtab-navigation` | Sub-tab clicks made at full speed — a lazy tab's first visit, a tab remounted after the mount LRU evicted it, and rail-vs-content agreement. Every click is made once and asserted against the content |

---

## Writing a new spec

1. **Land in the app with `gotoSim`.** It asserts the sim banner, the tab rail
   and the workspace chip — three signals, no sleeps.

   ```ts
   import { gotoSim, openTab, workspace } from "./helpers/app";

   await gotoSim(page, "supervisor");
   await openTab(page, "إدارة مساحة العمل");
   ```

2. **Use `openSubTab` for sub-tabs, and give it a `ready` locator** from
   `helpers/sections.ts` (or a new one there). It is not optional padding: the
   rail's `aria-current` moves synchronously on click while the content follows
   an event, so only the content proves the navigation happened. (It used to
   re-click, too — see *Bugs this suite found* below.)

3. **Assert seeded numbers from `helpers/seed.ts`, never inline literals.**
   Those constants mirror `SIM_SEED_PROFILE` and the counts pinned in
   `src/dev/simWorkspace.test.ts`. If a seed change breaks a browser test, that
   is the seed doing its job: update `SIM_SEED_PROFILE`, the unit test's pinned
   counts, and `helpers/seed.ts` together.

4. **Prefer `getByRole` with the Arabic accessible name.** The app is
   RTL Arabic and generally well-labelled, so almost everything is reachable
   that way. Exact names matter: `اعتماد الطلبات` is a heading *and* a sub-tab
   button, so scope to `workspace(page)` or pass `level: 1`.

5. **Never use `waitForTimeout` as a synchronisation primitive.** There is not
   one in the suite. Use web-first assertions (`toBeVisible`, `toHaveText`,
   `toHaveCount`) which retry, or `expect(async () => …).toPass()` when an
   action itself has to be retried.

6. **Watch out for tabs that stay mounted.** `src/app/` keeps an LRU of up to
   three mounted tabs, so a `getByText` over the whole workspace can match text
   belonging to a hidden tab the test visited earlier. Scope to the tab's own
   region — `workspace(page).getByRole("region", { name: "إدارة المستخدمين" })`
   — when a test navigates more than once. `action-log.spec.ts` does exactly
   this and the comment there explains why.

7. **One page load is one fresh workspace.** The tree is in memory; there is
   nothing to clean up and no ordering between tests. That is why the config
   runs `fullyParallel`. It also means state cannot be carried across a reload:
   a test that needs a permission granted must grant it and use it in the same
   page load (`answer-on-behalf.spec.ts` does this with the admin role-preview
   switch).

### Selectors we could not make semantic

Three places have no accessible name to query, so the suite reaches for the
component's own class name. These are structural selectors on existing markup —
**no `data-testid` was added to the application**, and none should be without
first asking whether the missing accessible name is itself a defect.

| Selector | Where | Why |
|---|---|---|
| `.ew-ref-stat-token` | `statToken()` in `helpers/app.ts` | The reviewer's stats tiles are `<em>label</em><strong>value</strong>` pairs with no accessible name pairing label to value. |
| `label.um-toggle` | `answer-on-behalf.spec.ts` | The **feature** permission matrix's toggles are visually-hidden `<input type="checkbox">` inside an unlabelled `<label>`. (The **page** matrix next to it does carry real `aria-label`s — `ضيف: population - لا وصول` — so the two matrices are inconsistent. Worth fixing: a screen-reader user hears "checkbox" with no indication of which role.) |
| `.ew-xr-panel-col`, `.amw-paste-zone`, `#p4-manual-section` | queue / ad-hoc / process specs | Container elements with no role of their own. `.amw-paste-zone` additionally needs a raw `paste` event dispatched at it (`pasteInto()`): it is a focusable `div`, so `fill()` cannot reach it and the headless runner has no system clipboard for `Control+V`. |

---

## Debugging a CI failure

The `E2E` workflow uploads two artifacts:

* **`playwright-report`** — the HTML report, always. Download, unzip, and open
  `index.html` (or `npx playwright show-report path/to/unzipped`). Each failing
  test carries its error, the failing step, and inline screenshots.
* **`playwright-failures`** — `test-results/`, only when something failed. This
  holds the good stuff:

  ```bash
  npx playwright show-trace test-results/<test-dir>/trace.zip
  ```

  The trace viewer gives you a DOM snapshot before and after **every** action,
  the console, the network log, and the exact locator each step resolved to.
  It is almost always faster than re-running locally.

  `error-context.md` in the same directory is an accessibility snapshot of the
  page at the moment of failure — often enough on its own to see that the app
  was on the wrong screen, or that an element's accessible name changed.

Two things to check before assuming a real regression:

1. **Did the seed change?** A failure naming a number (34, 96, 320, 60) is
   almost certainly `SIM_SEED_PROFILE` moving. Reconcile
   `e2e/helpers/seed.ts` with `src/dev/simWorkspace.test.ts`.
2. **Was the dev server restarting?** The suite is driven through Vite; an
   unrelated edit to a file the dev server watches (`vite.config.ts`, anything
   under `src/dev/` that a plugin imports) restarts it mid-run and can fail
   several tests at once with connection errors. That is a local-development
   artefact, not a CI one.

Retries are **2 on CI, 0 locally** — deliberately. A test that only passes on
retry locally is a test to fix, not to tolerate; on CI the retries absorb
runner contention rather than hiding flakiness, and the report marks any test
that needed one.

---

## Bugs this suite found — all three now fixed

Writing the suite surfaced three defects in the application. Each is now fixed,
with the test that pins it named below. Every one of those tests was checked
against the unfixed code first: revert the fix and it fails.

### 1. A sub-tab click was silently dropped when its tab was not mounted yet

**Reproduced ~80 % of the time.** Select a top-level tab and click one of its
sub-tabs immediately: the rail highlighted the sub-tab you clicked while the
content showed the parent's **default** sub-tab. Nothing announced the loss.

Mechanism: `Sidebar.handleSubTabClick` sets its own `activeSubTabId`
synchronously — which is what paints `aria-current="page"` — and then
fire-and-forgets a `window` CustomEvent (`pop-set-subtab`) in the same handler
that merely *schedules* the tab's mount. The tab component subscribes to that
event from a mount effect, so on the first visit to a lazily loaded tab
(`user-management`, `reports`, both `React.lazy`) the listener did not exist
yet and the event went nowhere.

Fix: `src/app/subTabSelection.ts` records the rail's selection per parent tab,
and `src/app/useSubTabSelection.ts` replays it once as the tab mounts —
alongside, not instead of, the live events, and behind each tab's existing
known-sub-tab guard. `openSubTab` is a single click again.

Pinned by `subtab-navigation.spec.ts` (and, at unit level,
`src/app/subTabSelection.test.tsx` plus
`UserManagement/index.sectionSwitch.test.tsx`).

### 2. A label override did not re-render its own editor row

Override any label in «إدارة الإعدادات». The new text was saved, persisted and
applied everywhere immediately — but the row that made the change did not
notice: its «استعادة القيمة الافتراضية» button stayed **disabled** and the
`is-custom` / «الافتراضي: …» markers never appeared until the page remounted.

Mechanism: `LabelRow` read `isCustomized(labelKey)` and `getLabels()` directly
instead of subscribing, so it wrote to a store it did not listen to — a shape
the React Compiler is free to memoize, precisely because the read has no
reactive dependency. (Note it only bites in a compiled build: under Vitest,
which does not run the compiler, the parent's own `useLabels()` re-render is
enough to hide it. That is why the regression test is a browser one.)

Fix: the row reads `useLabels()` and the new `useIsCustomized()`
(`useSyncExternalStore` over the label store).

Pinned by `settings.spec.ts` › "the row that wrote an override can revert it
without a remount".

### 3. Approving a referral left the sibling queue stale for up to 45 s

Approve a reassignment request in «اعتماد الطلبات» and switch back to «صور
الأشعة المحالة»: the assignment counts still showed the pre-approval numbers
until a manual refresh or the next 45 s tick.

Mechanism: `broadcastDataRefresh` had exactly two callers, both in
`workspaceSync.ts`. No domain action announced itself, and the referrals view
stays mounted behind the approvals view (tab-mount LRU), so it kept rendering
what it had loaded — with the stale row still listed as the old reviewer's and
still selectable.

Fix: `notifyLocalDataChange` in `dataRefreshSignal.ts` — the local echo of a
write that already landed, broadcast as an ordinary `"periodic"` delta so every
subscriber's existing silent-refresh handling (including XrayReferrals'
unsaved-draft retention) applies unchanged. It is called from exactly one
place, `useApprovalData`'s `settleAfterDecision`, once per completed decision
or bulk run. `runSync` remains the only thing that SYNCS: no probe, no timer,
no second refresh path.

Pinned by `reassignment.spec.ts` › "approving the request is what actually
moves the row" (which no longer clicks the refresh button) and by
`useApprovalData.test.tsx` › "announces a decision to the sibling views".

### Smaller observations, not chased down

* The KPI heat-map is titled «… في كل يوم من أيام **يوليو 2,026**» on the June
  2026 month — the year is run through a thousands-separated number format, and
  the month comes from the seeded answer timestamps (2026-07-01) rather than the
  reporting month.
* The KPI headline reads «دقة الفحص الإجمالية 93.3%» directly above «من **0**
  قراراً قابلاً للتقييم», and the page badge says «لا بيانات · 0 قرار قابل
  للتقييم» while four populated cards sit under it.
* `population/process`'s readiness strip shows «المجتمع —» for a month whose
  population is 320 rows, even after visiting Browse first and waiting. This may
  be intended — Phase A/B of the large-population work made the population load
  demand-gated per sub-tab, and Browse now pages through a worker — but a chip
  whose whole job is to report month readiness reading «—» for a fully processed
  month is at least misleading. `population-process.spec.ts` therefore asserts
  the sample/distribution/BI facts and leaves this one alone.
* The `ew/inspection-form` sub-tab is labelled «نموذج الفحص» in the rail but
  «نموذج الفحص (مساحة العمل)» in `tabCatalog.ts`. Harmless today, but it means
  the permission matrix and the navigation name the same page differently.

---

## What this suite does not cover, and why

| Area | Why not |
|---|---|
| The production bundle | `?sim=1` cannot exist there. Covered by `npm run build` + `check:bundle-size` in `ci.yml`. |
| The real login form | Sim mode auto-signs-in and re-issues the session whenever the stored identity disagrees with the URL, so logging out simply logs straight back in. Argon2id hashing and the lockout policy are unit-tested in `src/auth/`. |
| Excel **file** upload | The population pipeline's file path needs a real `.xlsx` through the SheetJS worker. The ad-hoc importer's paste path is exercised end to end instead, and the seeded month is itself produced by the real domain writers. |
| Report file contents | Reports open in a popup (asserted) or trigger a download. The suite checks the deck and the sample report render and carry the right month; the builders' output is snapshot-tested in `src/data/reporting/`. |
| Multi-device / cross-tab conflict | `casLoop` and the distribution event fold need concurrent writers against a shared folder. The simulated workspace is per-page-load and in-memory. Unit-tested in `src/data/storage/` and `src/data/distribution/`. |
| Browsers other than Chromium | The app requires the File System Access API in production, so Chrome/Edge is the only supported target. |
