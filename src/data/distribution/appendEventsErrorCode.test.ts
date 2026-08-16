// Reported from the field: Phase 4 (distribution) failed with `XQ-IO-028`, the
// catch-all whose own meaning is "unclassified write/read failure". It is the
// least useful code in the catalog, and it was being shown for a failure the
// app had ALREADY identified.
//
// The path: `appendDistributionEvents` catches a throw from
// `writeDistributionEventBatch`, logs `XQ-DIST-003`, and then returned the raw
// `error.message` — an English DOMException string. `userFacingErrorText` gets
// a bare string with no error object left to classify, so it emits the generic
// XQ-IO-028. The specific code existed, was computed, and was discarded one
// line later.
//
// These tests assert the code survives to the caller. All three failed against
// the pre-fix `error: error.message`: the returned string was English, so
// `containsArabic` was false and the UI substituted XQ-IO-028.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { containsArabic, userFacingErrorText } from "../storage/writeErrorText";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { appendDistributionEvent } from "./distributionStorage";
import { buildAssignEvent } from "./distributionLog";

const MONTH = "5-May-2026";

// `writeDistributionEventBatch` is module-private, so the fault goes in at the
// boundary it actually calls — the durable segment write.
const storeMock = vi.hoisted(() => ({ appendDistributionEventSegment: vi.fn() }));

vi.mock("./distributionEventStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./distributionEventStore")>();
  return { ...actual, ...storeMock };
});

function domException(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

let root: DirectoryHandleLike;

beforeEach(() => {
  root = createMemoryDirectory();
  clearErrors();
  storeMock.appendDistributionEventSegment.mockReset();
});

async function appendFailingWith(error: Error) {
  storeMock.appendDistributionEventSegment.mockRejectedValueOnce(error);
  return appendDistributionEvent(
    root,
    MONTH,
    buildAssignEvent({
      xrayImageId: "XR-0001",
      assignedTo: "employee1",
      eventBy: "admin",
    })
  );
}

describe("appendDistributionEvents — the failure keeps its own error code", () => {
  it("does not degrade a classified failure into the XQ-IO-028 catch-all", async () => {
    // Permission revoked mid-write: the exact case a user hits when the share
    // grant lapses. classifyFileSystemError already names it XQ-IO-017.
    const result = await appendFailingWith(
      domException("NotAllowedError", "The request is not allowed by the user agent")
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toContain("XQ-IO-017");
    // The whole point: routing it through the UI helper must not replace it.
    const shown = userFacingErrorText(result.error, "test:phase-4");
    expect(shown).toContain("XQ-IO-017");
    expect(shown).not.toContain("XQ-IO-028");
    // Carrying the code must NOT smuggle the raw DOMException detail onto the
    // Arabic screen with it — the first attempt at this fix used
    // `formatUserError(code, error)` and did exactly that, which is the bug
    // replacement.notFound.test.ts already existed to prevent. The detail
    // belongs in the error log, asserted separately below.
    expect(shown).not.toMatch(/NotAllowedError|not allowed by the user agent/);
  });

  it("surfaces disk-full as XQ-IO-020 rather than the catch-all", async () => {
    const result = await appendFailingWith(
      domException("QuotaExceededError", "The quota has been exceeded")
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(userFacingErrorText(result.error, "test:phase-4")).toContain("XQ-IO-020");
  });

  it("falls back to XQ-DIST-003 — never XQ-IO-028 — for an unrecognized throw", async () => {
    const result = await appendFailingWith(new Error("something we have no name for"));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Arabic is what makes it survive userFacingErrorText verbatim, so assert
    // the property rather than a specific sentence that a label edit would break.
    expect(containsArabic(result.error)).toBe(true);
    const shown = userFacingErrorText(result.error, "test:phase-4");
    expect(shown).toContain("XQ-DIST-003");
    expect(shown).not.toContain("XQ-IO-028");
  });

  it("logs the same code the user is reading off the screen", async () => {
    // The admin reads Settings → error log to diagnose; a code there that
    // disagrees with the one on the user's screen is worse than no code.
    const result = await appendFailingWith(
      domException("NotAllowedError", "The request is not allowed by the user agent")
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const logged = getRecentErrors().filter((entry) =>
      entry.context.startsWith("distribution:append-events")
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]?.context).toContain("XQ-IO-017");
    expect(result.error).toContain("XQ-IO-017");
  });
});
