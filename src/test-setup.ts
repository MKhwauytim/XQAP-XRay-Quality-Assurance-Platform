import { expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach } from "vitest";
import { queryClient } from "./data/query/queryClient";
import { configure } from "@testing-library/dom";

expect.extend(matchers);

// jsdom never runs layout, so every element's offsetHeight/offsetWidth is
// permanently 0 -- this repo's own test files opt into jsdom per-file via
// `/* @vitest-environment jsdom */`; most tests never notice, but TanStack
// Virtual (DataTable's row virtualization, rework W5.6) reads `offsetHeight`
// synchronously on mount to size its visible window, and with 0 it computes
// an EMPTY window and renders no rows at all -- silently breaking any test
// that renders a DataTable-backed view and then queries for row content,
// across the whole app, not just DataTable's own tests. Stub a realistic
// nonzero default globally here (once) rather than requiring every current
// and future consumer test file to add its own `offsetHeight` mock. A test
// that specifically needs a different/zero viewport height can still locally
// override this via `vi.spyOn(HTMLElement.prototype, "offsetHeight", "get")`.
if (typeof HTMLElement !== "undefined") {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() { return 600; },
  });
}

// The app-wide TanStack Query client (`src/data/query/queryClient.ts`) is a
// module singleton, not a per-render instance. That is deliberate -- there is
// exactly one client and no SSR, so components import it directly rather than
// reading it from `QueryClientProvider` context, which keeps every test that
// renders a subtree from having to supply a provider.
//
// The consequence is that its cache is shared across tests in a file, and with
// `staleTime: Infinity` a query resolved by one test would be served from cache
// to the next -- so a test that changes what's on disk and re-renders would
// silently assert against the PREVIOUS test's data. Clearing between tests
// restores the isolation a fresh `new QueryClient()` used to provide.
afterEach(() => {
  queryClient.clear();
});

// Browser storage is module-global and survives across test FILES in a shared
// worker, so one file's leftovers become the next file's hidden preconditions.
// This bit more than it used to: the auth session moved from sessionStorage to
// localStorage (owner-approved SEC-02 relaxation), and DataTable column presets
// live in storage too -- a stale preset that hides a column makes a later
// file's "click the checkbox, expect a dialog" test fail with a confusing
// "unable to find role=dialog", far from the actual cause.
//
// Clearing both between tests makes every file start from the same known
// empty state. A test that needs a specific stored value sets it in its own
// setup, which is where that intent belongs anyway.
afterEach(() => {
  try { localStorage.clear(); } catch { /* storage unavailable in this env */ }
  try { sessionStorage.clear(); } catch { /* storage unavailable in this env */ }
});

// Testing Library's default async timeout is 1s. That is ample when a file runs
// alone, but this suite runs ~199 files across parallel workers, and under that
// CPU contention a legitimate re-render can take longer -- producing failures
// that move between whichever timing-sensitive test happened to be unlucky
// (observed at roughly 1 run in 3, in different files each time).
//
// The assertions themselves were correct and already used `waitFor`; only the
// budget was too tight. Raising it removes the flake without weakening any
// assertion -- a test that is genuinely broken still fails, it just gets a fair
// chance to settle first.
configure({ asyncUtilTimeout: 5000 });
