// Two causes the exhausted-NotFound classifier could not see, both of which
// were being reported as XQ-IO-031 ("the share lost one entry — retry").
//
// 1. PATH LENGTH. The old probes were 26 characters (`.fs-reachability-probe.tmp`,
//    `.fs-extension-probe.ndjson`), so on a workspace path deep enough to cross
//    Windows' 260-character limit they fit while the real write did not. The
//    verdict was "directory-writable", i.e. retry — advice that can never work,
//    because the folder genuinely is writable and this NAME genuinely cannot be
//    created in it. The classifier now probes with a same-length name.
//
// 2. ASYNCHRONOUS REMOVAL. Antivirus, DLP and file-sync clients quarantine a
//    second or more after the write lands, so a write-then-immediately-read
//    round trip always passes for them. The extension probe now takes a second
//    look after a delay.
import { describe, it, expect, beforeEach } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import { classifyNotFound, logExhaustedNotFound } from "./transientFileErrors";
import { errorCodeOf } from "./errorCodes";
import { clearErrors } from "./errorLogger";
import { thrownErrorText } from "./writeErrorText";
import { getLabels } from "../labels/labelsStore";

function notFound(message = "A requested file or directory could not be found"): Error {
  const error = new Error(message);
  error.name = "NotFoundError";
  return error;
}

/** The 80-character name the segment writer used before it was shortened. */
const LONG_SEGMENT_NAME =
  "3c26ccb7-0eeb-4173-a880-0bdd31c80324-70dbde0f-3fc7-48a6-97d3-ac3d1248ec0b.ndjson";

beforeEach(() => {
  clearErrors();
});

describe("classifyNotFound — a path-length limit", () => {
  it("is name-too-long when short names are created and a same-length probe is not", async () => {
    const dir = createMemoryDirectory("distribution.events", {
      faults: [
        {
          operation: "getFileHandle",
          create: true,
          // Everything at or over 30 characters fails: the 26-character probes
          // fit, the 80-character segment name does not.
          nameMinLength: 30,
          errorName: "NotFoundError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });

    // Pre-fix this returned "directory-writable" and the user was told to retry.
    await expect(classifyNotFound(dir, LONG_SEGMENT_NAME)).resolves.toBe("name-too-long");
  });

  it("surfaces XQ-IO-034 with the move-the-workspace remedy", async () => {
    const dir = createMemoryDirectory("distribution.events", {
      faults: [
        {
          operation: "getFileHandle",
          create: true,
          nameMinLength: 30,
          errorName: "NotFoundError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });
    const error = notFound();

    const cause = await logExhaustedNotFound(
      "distribution:append-segment",
      dir,
      LONG_SEGMENT_NAME,
      9,
      error
    );

    expect(cause).toBe("name-too-long");
    expect(errorCodeOf(error)).toBe("XQ-IO-034");
    const shown = thrownErrorText(error, "test:phase-4");
    expect(shown).toContain("XQ-IO-034");
    expect(shown).toContain(getLabels().err_io_034_path_too_long);
    // Not the "just retry" verdict this used to collapse into.
    expect(shown).not.toContain("XQ-IO-031");
  });

  it("still says directory-writable when a long name IS accepted", async () => {
    // Guards against over-blocking: a genuine transient flake on a share with
    // no length limit must keep its retry advice.
    await expect(
      classifyNotFound(createMemoryDirectory("distribution.events"), LONG_SEGMENT_NAME)
    ).resolves.toBe("directory-writable");
  });
});

describe("classifyNotFound — something removes the file a moment later", () => {
  it("is extension-blocked when the probe passes an instant read-back and is gone after the wait", async () => {
    const dir = createMemoryDirectory("distribution.events", {
      faults: [
        {
          operation: "getFileHandle",
          name: ".fs-extension-probe.ndjson",
          create: false,
          // Let the immediate read-back through; fail every later look. That is
          // an async quarantine, and the old instant-only probe called this
          // folder healthy.
          skip: 1,
          errorName: "NotFoundError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });

    await expect(classifyNotFound(dir, "a-segment.ndjson")).resolves.toBe("extension-blocked");
  }, 20_000);
});
