import { describe, it, expect, beforeEach } from "vitest";
import { clearErrors, getRecentErrors, logError } from "./errorLogger";

beforeEach(() => clearErrors());

describe("errorLogger", () => {
  it("stores logged errors", () => {
    logError("test-context", new Error("boom"));
    const errs = getRecentErrors();
    expect(errs).toHaveLength(1);
    expect(errs[0].context).toBe("test-context");
    expect(errs[0].message).toBe("boom");
  });

  it("caps at 50 entries", () => {
    for (let i = 0; i < 60; i++) logError("ctx", new Error(`err${i}`));
    expect(getRecentErrors()).toHaveLength(50);
  });

  it("clearErrors empties the log", () => {
    logError("ctx", "oops");
    clearErrors();
    expect(getRecentErrors()).toHaveLength(0);
  });
});
