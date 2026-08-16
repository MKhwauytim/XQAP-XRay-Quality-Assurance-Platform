// Third report of `XQ-IO-031`, after the retry ladder was already lengthened
// from ~630 ms to ~11 s. The retries were not the problem.
//
// `XQ-IO-031` can only reach the user from `verifySegmentSize` with an
// unreliable baseline — meaning BOTH the pre-append re-read and the post-close
// verify exhausted ~11 s each. So the app wrote a segment, then could not see it
// for ~22 s, while the directory probe succeeded. "directory-writable" is
// exactly that: the folder is healthy.
//
// A healthy folder that accepts writes, and a file written into it that is gone
// moments later, is not a latency problem. Something outside the browser is
// REMOVING the file. Antivirus, DLP and sync clients routinely quarantine
// unfamiliar extensions — and this app writes `.ndjson`, which almost nothing
// allowlists, while the probe used `.tmp`, which nearly everything does. The
// probe was testing the one extension guaranteed not to reproduce the bug.
//
// It now probes again with the failing file's OWN extension, and does a full
// write-then-read-back round trip rather than just a create.

import { describe, it, expect } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { classifyNotFound } from "./transientFileErrors";

/**
 * A directory that accepts any write but makes files with `blockedExtension`
 * vanish immediately afterwards — an antivirus quarantine, modelled.
 */
function quarantines(
  root: DirectoryHandleLike,
  blockedExtension: string
): DirectoryHandleLike {
  return new Proxy(root, {
    get(target, prop, receiver) {
      if (prop === "getFileHandle") {
        return async (name: string, options?: { create?: boolean }) => {
          if (name.endsWith(blockedExtension) && options?.create !== true) {
            const error = new Error("A requested file could not be found");
            error.name = "NotFoundError";
            throw error;
          }
          return target.getFileHandle(name, options);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as DirectoryHandleLike;
}

describe("classifyNotFound distinguishes a slow share from a blocked file type", () => {
  it("reports extension-blocked when .tmp survives but the failing extension does not", async () => {
    const dir = quarantines(createMemoryDirectory(), ".ndjson");

    const cause = await classifyNotFound(dir, "events-abc-123.ndjson");

    // Pre-fix this returned "directory-writable" -> XQ-IO-031 -> "retry",
    // which is why retrying kept failing.
    expect(cause).toBe("extension-blocked");
  });

  it("still reports directory-writable when the failing file's type is fine", async () => {
    // A genuine transient miss: nothing is being removed, so the round trip
    // succeeds and "retry" remains the correct advice.
    const dir = createMemoryDirectory();

    const cause = await classifyNotFound(dir, "events-abc-123.ndjson");

    expect(cause).toBe("directory-writable");
  });

  it("does not probe twice when the failing file is itself a .tmp", async () => {
    // The first probe already used .tmp; repeating it would prove nothing.
    const dir = createMemoryDirectory();

    await expect(classifyNotFound(dir, "staged.tmp")).resolves.toBe("directory-writable");
  });

  it("still detects an unreachable directory before probing extensions", async () => {
    // Ordering matters: a dead handle must not be misreported as a blocked
    // extension. The cheap reachability probe runs first and wins.
    const gone = {
      name: "1-main",
      kind: "directory",
      getFileHandle: async () => {
        const error = new Error("directory handle no longer resolves");
        error.name = "NotFoundError";
        throw error;
      },
    } as unknown as DirectoryHandleLike;

    await expect(classifyNotFound(gone, "events.ndjson")).resolves.toBe(
      "directory-unreachable"
    );
  });

  it("works with no file name, as older callers pass", async () => {
    const dir = createMemoryDirectory();

    await expect(classifyNotFound(dir)).resolves.toBe("directory-writable");
  });
});
