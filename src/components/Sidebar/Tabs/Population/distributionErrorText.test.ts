// Pins the Arabic-UI contract for distribution write failures.
//
// `distributionErrorText` used to return `error.message` straight through to the
// user. Only THROWN exceptions reach it — every call site handles domain-level
// failures via the `result.ok === false` branch, which carries its own Arabic
// text — so what it actually surfaced was internal English from safeWrite
// ("Safe-write validation failed for ...", "Browser cannot write ..."), rendered
// into an otherwise fully-Arabic RTL screen for the app's least technical users.
//
// The raw detail now goes to the admin error-log ring buffer instead, which
// ErrorLogSection already renders — and the generic Arabic sentence carries the
// quotable XQ error code, so "it just says an error happened" is still
// actionable when a user reports it.

import { beforeEach, describe, expect, it } from "vitest";

import { distributionErrorText } from "./populationWorkflowHelpers";
import { MonthClosedError } from "../../../../data/population/monthLock";
import { clearErrors, getRecentErrors } from "../../../../data/storage/errorLogger";
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import { taggedError } from "../../../../data/storage/errorCodes";

const MONTH_CLOSED_TEXT = "الشهر مقفل";

describe("distributionErrorText", () => {
  beforeEach(() => {
    clearErrors();
  });

  it("passes the month-closed message through unchanged", () => {
    const text = distributionErrorText(new MonthClosedError("5-may-2026"), MONTH_CLOSED_TEXT);
    expect(text).toBe(MONTH_CLOSED_TEXT);
    // A closed month is an expected, explained state — not an error worth logging.
    expect(getRecentErrors()).toHaveLength(0);
  });

  it("never shows internal English exception text to the user", () => {
    const internal = new Error(
      "Safe-write validation failed for distribution.current.json; rolled back to previous version."
    );

    const text = distributionErrorText(internal, MONTH_CLOSED_TEXT);

    // Untagged plain Error → the catch-all distribution code.
    expect(text).toBe(`${DEFAULT_LABELS.msg_unexpected_write_error} (XQ-DIST-001)`);
    expect(text).not.toContain("Safe-write");
    // The code is the only Latin text allowed through, and it is deliberately
    // short-token shaped so it cannot be mistaken for a leaked English message.
    expect(text.replace("(XQ-DIST-001)", "")).not.toMatch(/[A-Za-z]{4,}/);
  });

  it("carries the throw site's own code when safeWrite tagged the failure", () => {
    const tagged = taggedError(
      "XQ-IO-009",
      "Safe-write validation failed for distribution.current.json; rolled back to previous version."
    );

    const text = distributionErrorText(tagged, MONTH_CLOSED_TEXT);

    expect(text).toBe(`${DEFAULT_LABELS.msg_unexpected_write_error} (XQ-IO-009)`);
    expect(getRecentErrors()[0]?.context).toContain("XQ-IO-009");
  });

  it("sends the raw detail to the error log so it is still diagnosable", () => {
    const internal = new Error("Browser cannot write distribution.current.json.");

    distributionErrorText(internal, MONTH_CLOSED_TEXT);

    const logged = getRecentErrors();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.message).toBe("Browser cannot write distribution.current.json.");
    // The same code the user is reading off their screen is on the log entry.
    expect(logged[0]?.context).toContain("XQ-DIST-001");
  });

  it("handles a non-Error throw without leaking its shape", () => {
    const text = distributionErrorText({ weird: "object" }, MONTH_CLOSED_TEXT);

    expect(text).toBe(`${DEFAULT_LABELS.msg_unexpected_write_error} (XQ-DIST-001)`);
    expect(getRecentErrors()).toHaveLength(1);
  });
});
