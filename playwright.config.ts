import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end browser suite — runs the REAL app in Chromium against the Vite
 * DEV SERVER, driven by the dev-only simulated workspace (`?sim=1`, see
 * `docs/development/SIMULATED_WORKSPACE.md`).
 *
 * ── Why the dev server and not `dist/` ─────────────────────────────────────
 * `?sim=1` is stripped from production builds by three independent guards
 * (module alias, `import.meta.env.DEV` dead-code elimination, and a
 * fail-closed `generateBundle` assertion). A preview of `dist/index.html`
 * therefore has no way to mount a workspace without a real folder picker and a
 * real user gesture — the app is simply unreachable there.
 *
 * The consequence is worth stating plainly: this suite proves the FEATURES
 * work, not that the shipped single-file bundle works. Those are different
 * failure classes. The second one is covered by `npm run build` +
 * `npm run check:bundle-size` in `.github/workflows/ci.yml`.
 *
 * ── Browser ────────────────────────────────────────────────────────────────
 * Chromium only, deliberately: the workspace features need the File System
 * Access API, so Chrome/Edge is the only supported target in production too.
 *
 * ── Browsers on disk ───────────────────────────────────────────────────────
 * `@playwright/test` is pinned to an exact version whose bundled Chromium
 * revision matches the browsers already installed in the dev image
 * (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Keep it exact: a floating
 * range would silently ask for a revision that is not on disk.
 */
export default defineConfig({
  testDir: "./e2e",
  // Every test loads its own page, and every page load re-seeds a fresh
  // in-memory workspace — there is no shared state to serialize on.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  // Seeding the simulated workspace runs the real domain writers over 320
  // population rows; on a cold, contended CI runner the first paint after
  // `goto` can take a few seconds. These are ceilings, not waits — nothing in
  // the suite sleeps.
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    // The app renders `dir="rtl"` itself; what matters for reproducibility is
    // that clock-derived output (KPI heat-map month, backup folder names) is
    // computed in one fixed zone rather than the runner's.
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1600, height: 1000 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
