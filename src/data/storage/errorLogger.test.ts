import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetErrorSinkForTests,
  clearErrors,
  getRecentErrors,
  logError,
  registerErrorSink,
  type ErrorEntry,
} from "./errorLogger";
import { __resetErrorContextForTests, setErrorActor, setErrorPageTab } from "./errorContext";

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

describe("errorLogger — enriched entries and the persistence sink", () => {
  beforeEach(() => {
    clearErrors();
    __resetErrorContextForTests();
    __resetErrorSinkForTests();
  });

  it("stamps the ambient page and actor onto a plain two-argument logError call", () => {
    setErrorPageTab("population");
    setErrorActor("bob", "employee");

    logError("population:save", new Error("boom"));

    const [entry] = getRecentErrors();
    expect(entry).toMatchObject({
      context: "population:save",
      message: "boom",
      page: "population",
      username: "bob",
      role: "employee",
    });
  });

  it("defaults `action` to the context string, which already names the operation", () => {
    logError("datatable:export", new Error("boom"));
    expect(getRecentErrors()[0].action).toBe("datatable:export");
  });

  it("lets an opt-in caller override the action without changing anything else", () => {
    logError("population:save", new Error("boom"), { action: "حفظ المجتمع الإحصائي" });
    const [entry] = getRecentErrors();
    expect(entry.action).toBe("حفظ المجتمع الإحصائي");
    expect(entry.context).toBe("population:save");
  });

  it("recovers the error code from the [XQ-...] suffix logCodedError already appends", () => {
    logError("casLoop:exhausted [XQ-IO-032]", new Error("boom"));
    expect(getRecentErrors()[0].errorCode).toBe("XQ-IO-032");
  });

  it("prefers an explicitly supplied code over the suffix parse", () => {
    logError("x [XQ-IO-032]", new Error("boom"), { errorCode: "XQ-WS-006" });
    expect(getRecentErrors()[0].errorCode).toBe("XQ-WS-006");
  });

  it("leaves errorCode undefined when there is no code to be had", () => {
    logError("population:save", new Error("boom"));
    expect(getRecentErrors()[0].errorCode).toBeUndefined();
  });

  it("hands each entry to a registered sink", () => {
    const seen: ErrorEntry[] = [];
    registerErrorSink((entry) => { seen.push(entry); });

    logError("a", new Error("one"));
    logError("b", new Error("two"));

    expect(seen.map((e) => e.message)).toEqual(["one", "two"]);
  });

  it("never lets a throwing sink reach the caller that reported the original error", () => {
    registerErrorSink(() => { throw new Error("sink exploded"); });
    expect(() => logError("a", new Error("one"))).not.toThrow();
    // The ring buffer — the thing the caller actually depends on — is intact.
    expect(getRecentErrors()).toHaveLength(1);
  });

  it("does not re-enter the sink for an error the sink itself logged", () => {
    let depth = 0;
    let maxDepth = 0;
    registerErrorSink(() => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      logError("sink:self", new Error("recursive"));
      depth -= 1;
    });

    logError("a", new Error("one"));

    // Without the suppression guard this recurses until the stack blows.
    expect(maxDepth).toBe(1);
  });

  it("unregisters cleanly", () => {
    const seen: ErrorEntry[] = [];
    registerErrorSink((entry) => { seen.push(entry); });
    registerErrorSink(null);
    logError("a", new Error("one"));
    expect(seen).toHaveLength(0);
  });
});
