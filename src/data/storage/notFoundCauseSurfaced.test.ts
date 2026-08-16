// Follow-up to the XQ-IO-028 field report: with that fixed, the same user hit
// `XQ-IO-027` — "الملف أو المجلد المطلوب غير موجود" — in Phase 4.
//
// XQ-IO-027 is honest but unactionable, and the app already knows better than
// it says. `classifyNotFound` probes the containing directory after the retry
// ladder is exhausted and distinguishes two causes with OPPOSITE remedies:
//
//   directory-writable    the share lost sight of one entry  -> retry
//   directory-unreachable the workspace folder was moved/renamed/re-created
//                         since the handle was restored      -> retrying can
//                         NEVER work; re-pick the workspace
//
// That verdict was computed, written to the error log, and then thrown away —
// exactly the same "the app knows and doesn't say" shape as the XQ-IO-028 bug
// one level up. Telling a user to retry when their workspace folder has moved
// is not merely unhelpful, it is wrong advice.
//
// These tests assert the verdict now rides out on the error. They fail against
// the pre-fix `logExhaustedNotFound`, which returned void and tagged nothing.

import { describe, it, expect, beforeEach } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { logExhaustedNotFound } from "./transientFileErrors";
import { resolveErrorCode, errorCodeOf } from "./errorCodes";
import { clearErrors } from "./errorLogger";
import { thrownErrorText } from "./writeErrorText";
import { getLabels } from "../labels/labelsStore";

function notFound(message = "A requested file or directory could not be found"): Error {
  const error = new Error(message);
  error.name = "NotFoundError";
  return error;
}

/** A directory handle that is itself gone — every open fails NotFound. */
function unreachableDirectory(): DirectoryHandleLike {
  return {
    name: "1-main",
    kind: "directory",
    getFileHandle: async () => {
      throw notFound("directory handle no longer resolves");
    },
    getDirectoryHandle: async () => {
      throw notFound("directory handle no longer resolves");
    },
  } as unknown as DirectoryHandleLike;
}

beforeEach(() => {
  clearErrors();
});

describe("logExhaustedNotFound — the probed cause reaches the user", () => {
  it("a moved/renamed workspace folder is XQ-IO-030, not a bare not-found", async () => {
    const error = notFound();

    const cause = await logExhaustedNotFound(
      "distribution:segment-verify",
      unreachableDirectory(),
      "events-abc.ndjson",
      5,
      error
    );

    expect(cause).toBe("directory-unreachable");
    expect(errorCodeOf(error)).toBe("XQ-IO-030");

    // End to end: what the user actually reads must say "re-pick the folder",
    // not "file not found" and not the XQ-IO-028 catch-all.
    const shown = thrownErrorText(error, "test:phase-4");
    expect(shown).toContain("XQ-IO-030");
    expect(shown).toContain(getLabels().err_io_030_workspace_unreachable);
    expect(shown).not.toContain("XQ-IO-028");
  });

  it("a reachable directory that lost one entry is XQ-IO-031 — retry is the right advice", async () => {
    const error = notFound();

    const cause = await logExhaustedNotFound(
      "distribution:segment-verify",
      createMemoryDirectory(),
      "events-abc.ndjson",
      5,
      error
    );

    expect(cause).toBe("directory-writable");
    expect(errorCodeOf(error)).toBe("XQ-IO-031");
    expect(thrownErrorText(error, "test:phase-4")).toContain("XQ-IO-031");
  });

  it("does not disturb the NotFoundError identity every caller branches on", async () => {
    // The data layer is full of `error.name === "NotFoundError"` and
    // `isNotFoundError(error)` checks — absence-vs-failure decisions that
    // guard against silently overwriting a month. Tagging must be additive:
    // if it changed identity or name, those verdicts would flip and the
    // read-contract fixes would quietly regress.
    const error = notFound();
    const before = { name: error.name, message: error.message, stack: error.stack };

    const returned = await logExhaustedNotFound(
      "distribution:segment-verify",
      createMemoryDirectory(),
      "events-abc.ndjson",
      5,
      error
    );

    expect(returned).toBe("directory-writable");
    expect(error.name).toBe(before.name);
    expect(error.message).toBe(before.message);
    expect(error.stack).toBe(before.stack);
    expect(error).toBeInstanceOf(Error);
    // Non-enumerable, so nothing that serializes or spreads the error changes shape.
    expect(Object.keys(error)).not.toContain("xqErrorCode");
    expect(JSON.stringify({ ...error })).not.toContain("XQ-IO-031");
  });

  it("leaves an unclassifiable failure on the plain XQ-IO-027 rather than inventing a cause", async () => {
    // The probe threw something that is neither NotFound nor a permission
    // error, so no verdict was established. Asserting one would be a guess.
    const probeFails = {
      name: "1-main",
      kind: "directory",
      getFileHandle: async () => {
        throw new Error("something else entirely");
      },
    } as unknown as DirectoryHandleLike;
    const error = notFound();

    const cause = await logExhaustedNotFound(
      "distribution:segment-verify",
      probeFails,
      "events-abc.ndjson",
      5,
      error
    );

    expect(cause).toBe("unknown");
    expect(errorCodeOf(error)).toBeNull();
    // Untagged, so the DOM-name classifier still supplies the honest fallback.
    expect(resolveErrorCode(error)).toBe("XQ-IO-027");
  });
});
