# TestSprite setup + full app test & analysis — XQAP (x-ray-quality-app-v1)

**Date:** 17 Aug 2026 · **App version:** 79.0.0 · **Machine:** mnk (Windows, Node 22.19.0, Claude Code 2.1.233)

---

## 1. What was set up

TestSprite MCP is installed **at user scope**, so it is available in every project on this
machine and survives new sessions:

```
claude mcp add TestSprite --scope user \
  --env API_KEY=sk-user-… \
  -- npx -y @testsprite/testsprite-mcp@latest
```

Stored in `C:\Users\WorkNStudy\.claude.json` → verified `✔ Connected`.

A duplicate **local-scope** `TestSprite` entry (no API key, different command) already existed
in this project and was shadowing the new one. It was removed —
`claude mcp remove TestSprite -s local` — so there is now exactly one endpoint.

### Files prepared for TestSprite

| File | Purpose |
|---|---|
| `testsprite_tests/XQAP_PRD.md` | Hand-written product spec — the one **mandatory** input TestSprite's config form demands. Written from `README.md` + `AGENTS.md`. |
| `testsprite_tests/standard_prd.json` | TestSprite's normalized PRD (generated). |
| `testsprite_tests/code_summary.yaml` | Codebase summary (generated). |
| `testsprite_tests/testsprite_frontend_test_plan.json` | 24-case frontend test plan (generated). |
| `testsprite_tests/TC0xx_*.py` | 24 generated Playwright-style test scripts. |
| `testsprite_tests/tmp/raw_report.md`, `test_results.json` | Execution report + raw results. |
| `dev-workspace/serve-dist.mjs` | Static server for the production build, bound to `0.0.0.0` (see §3). |
| `dev-workspace/testsprite-run*.txt` | Reusable headless prompts for `claude -p`. |

### How to re-run it

```powershell
npm run build
node dev-workspace\serve-dist.mjs          # serves dist on 0.0.0.0:5173
type dev-workspace\testsprite-run3.txt | claude -p --permission-mode bypassPermissions
```

The 8-tool order is: `check_account_info` → `bootstrap` → `generate_code_summary` →
`generate_standardized_prd` → `generate_frontend_test_plan` → `generate_code_and_execute` →
`open_test_result_dashboard`.

---

## 2. Three blockers found and fixed to make TestSprite run at all

### 2.1 `claude-mem` plugin hook blocked every headless run — **fixed (plugin disabled)**

Every `claude -p` invocation aborted before the first token:

```
UserPromptSubmit operation blocked by hook: … claude-mem worker unreachable for 99 consecutive hooks.
```

The `claude-mem@thedotmack` plugin's session-init hook fails open→blocked. It was **disabled at
user scope** to unblock the run. This is worth knowing independently of TestSprite: any headless
or scripted Claude Code usage on this machine was dead.

Re-enable with `claude plugin enable claude-mem@thedotmack` — but the underlying worker is still
broken, so headless runs will break again until that's fixed.

### 2.2 TestSprite's first-run config form blocks the MCP tool — **worked around**

`testsprite_bootstrap` opens a browser page and **blocks until a PRD document is uploaded and the
form submitted**. In a headless run nobody clicks it, so the tool hangs forever. Worked around by
POSTing the config directly to the local MCP HTTP server:

```powershell
curl.exe -X POST "http://localhost:<mcpPort>/api/commit?project_path=<path>&token=<token>" `
  -F "file=@testsprite_tests/XQAP_PRD.md" -F "mode=Frontend" -F "scope=codebase" -F "port=5173"
```

(The per-run `token` is on the URL of the page TestSprite opens.)

### 2.3 The dev server was invisible to TestSprite's tunnel — **fixed**

First run: **all 15 tests BLOCKED**, every one reporting `ERR_EMPTY_RESPONSE`.

Cause: Vite's dev server was listening on **`[::1]:5173` only** (IPv6 loopback). TestSprite's
tunnel client dials `localhost:5173` and resolves to IPv4 `127.0.0.1` — nothing there.

```
TCP    [::1]:5173     LISTENING      ← Vite dev
TCP    0.0.0.0:5173   LISTENING      ← replacement static server
```

Fixed by building for production and serving `dist/` from `0.0.0.0` via
`dev-workspace/serve-dist.mjs`. This also lifts TestSprite's cap from **15 tests (dev server) to
30 (production server)** — the second run generated and ran all 24.

---

## 3. TestSprite results: 24 tests, 0 passed

| Status | Count | Meaning |
|---|---|---|
| BLOCKED | 17 | App loaded but the agent could not proceed |
| ❌ Failed | 7 | Navigation to the app failed after 3 attempts |

The second run is a real improvement over the first — the app **did** load this time. TC002
confirms the agent saw the actual Arabic landing screen:

> The app displays the no-workspace landing texts: `اختر مجلد`, `تسجيل الدخول`, `مساحة العمل`.

But every test then stalls on the same wall:

> The app requires selecting a local workspace using the browser's native directory picker
> (`showDirectoryPicker`), which cannot be automated by this agent.

**This is architectural, not a bug.** XQAP is backend-free by design: there is no login server, no
test account, and no state at all until the user picks a folder through a native OS dialog. A
remote browser agent cannot open that dialog. Roughly 95% of the app — Population, Sampling,
Distribution, Reports, Archive, User Management — sits behind it and is **structurally
unreachable by TestSprite**.

### Two findings worth acting on

**A. The landing page reports 0 interactive elements.** Repeatedly, across many tests: the page
renders text but the agent's accessibility snapshot finds no buttons, links or inputs. If the
"choose folder" affordance isn't exposed as a focusable, role-bearing control, that's both an
automation blocker *and* a real keyboard/screen-reader accessibility gap. Worth checking by hand
with Tab-only navigation.

**B. TC019 failed rather than blocked** — the only genuine assertion failure:

> The landing page did not display an empty/no-workspace state; instead the page rendered as a
> blank shell with no visible text or UI controls.

Two tests disagree about what the landing screen shows (TC002 saw Arabic text, TC019 saw a blank
shell), which points at a **race on first paint** — sometimes the landing content isn't there
yet. That is the same shape as the failing unit test in §4.

**C. 7 navigation failures.** Under ~24 concurrent cloud browsers, some requests to the 3.5 MB
single-file bundle timed out. `serve-dist.mjs` reads the file per request; adding a cached buffer
would remove this.

Dashboard: <https://www.testsprite.com/dashboard/mcp/tests/bf0e85d3-b22b-4d48-8d09-e18c6c6071f5>

---

## 4. Local test suite & release gates

Run independently of TestSprite, on the machine.

| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc -b`, strict) | ✅ clean |
| `npm run lint:ci` (`eslint src --max-warnings 0`) | ✅ clean |
| `npm run build` | ✅ `dist/index.html` 3,510 kB raw / 1,180 kB gzip in 10.2 s |
| `npm run test:run` (Vitest) | ⚠️ **2101 / 2102 passed**, 1 failed, 242 files |

### 4.1 A serious false alarm: 444 "failures" that were not real

The first suite run reported **444 failed tests across 70 files** — every single one:

```
TypeError: React.act is not a function
  ❯ react-dom/cjs/react-dom-test-utils.production.js:20:16
```

Root cause: **`NODE_ENV=production` is set in the shell environment** (inherited from the parent
process — it is *not* in the User or Machine registry). React only exports `act` from its
**development** build, so under `NODE_ENV=production` Testing Library falls back to the removed
`react-dom/test-utils` shim and every `render`/`renderHook` throws.

```
NODE_ENV=production  → typeof React.act === "undefined"   → 444 failures
NODE_ENV=test        → typeof React.act === "function"    → 1 failure
```

**Recommendation:** pin it so this can never bite again — change `test:run` to
`vitest run` with `NODE_ENV` forced, e.g. add to `vitest.config.ts`:

```ts
export default defineConfig({
  test: { env: { NODE_ENV: "test" }, /* … */ }
})
```

Anyone who runs the suite from a shell with `NODE_ENV=production` (CI containers often do) sees
444 phantom failures and no signal about why.

### 4.2 The one real failing test

```
FAIL src/components/Sidebar/BootSplashOverlay.lateRegistration.test.tsx
  > stays hidden when the landing tab registered nothing and the user switches tabs a few seconds later
Error: expect(element).not.toBeInTheDocument()
  found <div class="boot-splash-overlay" data-testid="boot-splash-overlay" role="status" …>
```

The boot splash overlay **reappears** when the landing tab registers no checklist and the user
switches tabs seconds later. The file is **untracked in git** (`?? BootSplashOverlay.lateRegistration.test.tsx`)
— a newly written characterization test that is catching a live bug, not a regression in
committed code.

This lines up with TestSprite's TC007 ("See the boot checklist overlay while a tab loads") and
with the TC002-vs-TC019 disagreement about what the landing screen shows. **Boot/first-paint
sequencing is the one area where two independent test methods both point at a problem.**

---

## 5. Recommendations, in order

1. **Fix the boot splash late-registration bug** (§4.2). Two independent signals point at it.
2. **Pin `NODE_ENV` for the test run** (§4.1) — one line, removes a 444-failure landmine.
3. **Audit the landing screen for interactive elements** (§3A). Tab through it with the keyboard;
   if "choose folder" isn't a real focusable control, that's an accessibility bug, and fixing it
   would also unblock some TestSprite coverage.
4. **Decide what TestSprite is actually for here.** Given the native-picker wall, it can
   meaningfully cover only the landing / unsupported-browser / pre-workspace surface. Options:
   - add a dev-only query flag (`?e2e=1`) that mounts an in-memory workspace, unlocking the whole
     app for automated testing — this is the high-value change; or
   - keep TestSprite scoped to the landing surface and lean on the existing 2,102 Vitest tests,
     which already cover the business logic well.
5. **Cache the bundle in `serve-dist.mjs`** to eliminate the 7 navigation timeouts (§3C).
6. **Fix or remove `claude-mem`** (§2.1) — it currently blocks all headless Claude Code use.

---

## 6. Current machine state

- TestSprite MCP: installed, user scope, connected. ✅
- `claude-mem` plugin: **disabled** (user scope). Re-enable with
  `claude plugin enable claude-mem@thedotmack`.
- Static server for `dist/` still running on `0.0.0.0:5173` (PID varies) — stop it with
  `netstat -ano | findstr :5173` then `taskkill /PID <pid> /F`.
- Vite dev server: stopped (was occupying 5173).
- Working tree: only additions under `testsprite_tests/` and `dev-workspace/`, plus build logs
  (`ts.log`, `vitest.log`, `vitest2.log`, `lint.log`, `build.log`, `serve.log`) at the repo root
  that you may want to delete or gitignore. No source files were modified.
