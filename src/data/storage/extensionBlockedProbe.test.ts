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

/**
 * A directory where a file written with `blockedExtension` is READ BACK fine,
 * except on the specific look-ups named in `failOn` — a share that blips rather
 * than a scanner that quarantines.
 *
 * Look-ups are counted per name, `create: false` only, which is exactly the
 * sequence `probeRoundTrip` performs on its probe file: 1 = the instant check
 * after the write, 2 = the survival look after the 1.2 s wait, 3 = the
 * confirming re-look.
 */
function blipsOnLookups(
  root: DirectoryHandleLike,
  blockedExtension: string,
  failOn: number[]
): { dir: DirectoryHandleLike; lookups: () => number } {
  let lookups = 0;
  const dir = new Proxy(root, {
    get(target, prop, receiver) {
      if (prop === "getFileHandle") {
        return async (name: string, options?: { create?: boolean }) => {
          if (name.endsWith(blockedExtension) && options?.create !== true) {
            lookups += 1;
            if (failOn.includes(lookups)) {
              const error = new Error("A requested file could not be found");
              error.name = "NotFoundError";
              throw error;
            }
          }
          return target.getFileHandle(name, options);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as DirectoryHandleLike;
  return { dir, lookups: () => lookups };
}

describe("the survival re-probe needs two consecutive failures, not one", () => {
  // The verdict this feeds is PERMANENT: `extension-blocked` becomes XQ-IO-033,
  // which tells the user retrying cannot work and that they must add an
  // antivirus exclusion. Deriving that from a single `getFileHandle` on a
  // UNC/SMB share — the one operation this whole module exists to call
  // unreliable — turned any momentary listing blip into a standing accusation
  // against the folder.
  it("does NOT report extension-blocked when the survival look blips once", async () => {
    // Look-up 2 is the survival look after the 1.2 s wait; 3 is the re-look.
    const { dir, lookups } = blipsOnLookups(createMemoryDirectory(), ".ndjson", [2]);

    const cause = await classifyNotFound(dir, "e-1.ndjson");

    expect(cause).toBe("directory-writable");
    // The re-look is what rescued it: without it, look-up 2 alone decided.
    expect(lookups()).toBe(3);
  }, 15_000);

  it("still reports extension-blocked when the file is gone on both looks", async () => {
    // A real remover has already taken the file; looking again finds it just as
    // gone, so the permanent verdict stands and the user gets the exclusion
    // advice they actually need.
    const { dir, lookups } = blipsOnLookups(createMemoryDirectory(), ".ndjson", [2, 3]);

    await expect(classifyNotFound(dir, "e-1.ndjson")).resolves.toBe("extension-blocked");
    expect(lookups()).toBe(3);
  }, 15_000);
});

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
