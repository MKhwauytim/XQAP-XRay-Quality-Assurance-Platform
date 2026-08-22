/**
 * Build-time exclusion of the simulated-workspace back door.
 *
 * The simulated workspace (`?sim=1`, `src/dev/simMode.ts` → `simWorkspace.ts`)
 * mounts a WRITABLE workspace with no folder picker and no login. That is
 * exactly what makes it useful for browser automation and exactly what must
 * never ship: this app is distributed as a single self-contained `index.html`
 * that people open directly, so a writable no-auth entry point reaching
 * production would be a serious defect.
 *
 * `apply: "build"` — the dev server keeps the real module; only `vite build`
 * sees this plugin at all.
 *
 * ── Three layers, deliberately ─────────────────────────────────────────────
 * 1. `config()` aliases the `../dev/simMode` specifier to `simMode.prod.ts`,
 *    whose exports are inert and which imports nothing. Structural: the seed
 *    profile, the managed-user roster and the URL parser never enter the
 *    production module graph.
 * 2. Every call site is wrapped in `if (import.meta.env.DEV)`, which the
 *    bundler constant-folds to `false`. Independently sufficient today (a build
 *    with this plugin removed also produces a clean `dist/`), and it is what
 *    survives if the alias ever stops matching a specifier.
 * 3. `generateBundle()` fails the build outright if a marker string that only
 *    the dev modules contain reaches the output. Layers 1 and 2 are both
 *    bets — one on a specifier shape, one on tree-shaking — and this is the
 *    fail-closed check that turns a silent leak into a red build.
 *
 * The alias goes through `config()` rather than a `resolveId` hook on purpose:
 * a `resolveId` hook is invoked for every import in a ~2400-module graph and
 * measured ~5s (≈30%) of extra build time for two rewrites. `config` runs once
 * and the aliasing itself is handled by the bundler's own resolver.
 *
 * Verification of record is a grep of `dist/index.html` — see
 * `docs/development/SIMULATED_WORKSPACE.md`.
 */
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Matches exactly the relative specifier the app's two importers use
 * (`../dev/simMode`, `../../dev/simMode`), anchored at both ends so
 * `./simModePlugin` and any other neighbour cannot match. Vite replaces the
 * whole matched span, so the regex must cover the entire specifier.
 */
const SIM_MODE_SPECIFIER = /^(?:\.{1,2}\/)+dev\/simMode$/;

/**
 * Module ids that must not contribute a single rendered byte to the bundle.
 *
 * Matched on the MODULE GRAPH rather than on marker strings in the output,
 * because the first version of this guard searched for `"Simulated-Workspace"`
 * and missed a real leak: with the alias disabled, rolldown tree-shook the
 * unreferenced seed constants but kept `SIM_ROLE_USERNAMES`, so the seeded
 * usernames shipped while every marker string had been shaken away. A partial
 * leak is still a leak, and only the module id sees it.
 */
const FORBIDDEN_MODULE_PATTERN = /[/\\]src[/\\]dev[/\\]sim(Mode|Workspace|ActionLog)\.ts$/;

export function simModePlugin(): Plugin {
  return {
    name: "sim-mode-production-exclusion",
    apply: "build",
    enforce: "pre",

    config() {
      return {
        resolve: {
          alias: [
            {
              find: SIM_MODE_SPECIFIER,
              replacement: fileURLToPath(
                new URL("./simMode.prod.ts", import.meta.url)
              ),
            },
          ],
        },
      };
    },

    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [moduleId, rendered] of Object.entries(output.modules ?? {})) {
          // renderedLength 0 means the module contributed nothing after
          // tree-shaking — being listed in the graph is not itself a leak.
          if (rendered.renderedLength <= 0) continue;
          if (!FORBIDDEN_MODULE_PATTERN.test(moduleId.replace(/\\/g, "/"))) continue;
          this.error(
            `Simulated-workspace code leaked into the production bundle: ` +
              `${moduleId} contributed ${rendered.renderedLength} bytes to ` +
              `${fileName}. The ?sim=1 workspace is writable and skips login — ` +
              `it must never ship. Check the import.meta.env.DEV guards at the ` +
              `call sites and the simMode alias in src/dev/simModePlugin.ts.`
          );
        }
      }
    },
  };
}
