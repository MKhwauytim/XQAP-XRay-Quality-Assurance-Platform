import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  __resetErrorContextForTests,
  clearErrorActor,
  readErrorContext,
  setErrorActor,
  setErrorPageSubTab,
  setErrorPageTab,
} from "./errorContext";

beforeEach(() => __resetErrorContextForTests());

describe("errorContext", () => {
  it("reports an unknown page and no actor before anything is set", () => {
    expect(readErrorContext()).toEqual({ page: "unknown", username: null, role: null });
  });

  it("records the active top-level tab as the page", () => {
    setErrorPageTab("population");
    expect(readErrorContext().page).toBe("population");
  });

  it("prefers the sub-tab when it belongs to the active tab", () => {
    setErrorPageTab("population");
    setErrorPageSubTab("population", "browse");
    expect(readErrorContext().page).toBe("population/browse");
  });

  it("ignores a sub-tab recorded for a DIFFERENT parent tab", () => {
    // The rail records a selection per parent tab; a selection made for a tab
    // the user then navigated away from must not mislabel the current page.
    setErrorPageTab("population");
    setErrorPageSubTab("reports", "kpi");
    expect(readErrorContext().page).toBe("population");
  });

  it("drops a stale sub-tab when the top-level tab changes", () => {
    setErrorPageTab("population");
    setErrorPageSubTab("population", "browse");
    setErrorPageTab("reports");
    expect(readErrorContext().page).toBe("reports");
  });

  it("records and clears the actor", () => {
    setErrorActor("bob", "employee");
    expect(readErrorContext()).toMatchObject({ username: "bob", role: "employee" });
    clearErrorActor();
    expect(readErrorContext()).toMatchObject({ username: null, role: null });
  });

  it("has no imports — it is the leaf below errorLogger and must stay one", () => {
    // errorLogger.ts imports this module, and safeWrite.ts imports errorLogger.
    // An import here can therefore close a cycle that vitest (which transpiles
    // per-file) would not catch and `npm run build` would die on. Pinned here so
    // the constraint fails a test rather than a release build.
    const source = readFileSync(new URL("./errorContext.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
