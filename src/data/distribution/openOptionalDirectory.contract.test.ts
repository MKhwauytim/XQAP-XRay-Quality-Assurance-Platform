// The P0-2 read-contract fix was applied to the FILE reads and to the leaf
// `distribution.events` directory, and its regression test faulted only that
// leaf. `openOptionalDirectory` — which opens the PARENT directories
// (`2-samples/{month}`, `1-main`) — kept the original defect: a bare catch that
// turned any open failure into "the directory is absent", i.e. zero events.
//
// That is the same silent-overwrite hazard: loadDistributionLog reports 0
// events for a month with a full assignment history, the re-draw hard block
// reads that as "nothing distributed yet", and saveSampleMaster overwrites
// sample.master.json.
//
// These tests fault the PARENT directories specifically. Both were verified to
// fail against the pre-fix `catch { return null }`, which resolved 0 events
// instead of throwing.

import { describe, it, expect } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { loadDistributionLog } from "./distributionStorage";

const MONTH = "5-May-2026";

/**
 * Wraps a memory directory so that opening one named child fails with a
 * non-NotFound error, exactly as a flaky share or a revoked grant would.
 */
function failOpeningChild(
  root: DirectoryHandleLike,
  childName: string,
  error: Error
): DirectoryHandleLike {
  const wrap = (dir: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(dir, {
      get(target, prop, receiver) {
        if (prop === "getDirectoryHandle") {
          return async (name: string, options?: { create?: boolean }) => {
            if (name === childName) throw error;
            const child = await target.getDirectoryHandle(name, options);
            return wrap(child);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as DirectoryHandleLike;
  return wrap(root);
}

/**
 * The fault is only reachable once the directories actually exist: on an empty
 * workspace `getRoot` throws NotFound for `2-samples` first, which is a genuine
 * absence and correctly resolves to an empty log. Build the real chain, then
 * fault it.
 */
async function seededWorkspace(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory();
  await getSampleMainDir(root, MONTH, true);
  return root;
}

function notReadable(): Error {
  const err = new Error("The file could not be read");
  err.name = "NotReadableError";
  return err;
}

function notAllowed(): Error {
  const err = new Error("Permission was revoked");
  err.name = "NotAllowedError";
  return err;
}

describe("openOptionalDirectory — a failed open is not an empty month", () => {
  it("propagates NotReadableError on the month directory instead of reporting zero events", async () => {
    const root = failOpeningChild(await seededWorkspace(), MONTH, notReadable());

    // Pre-fix this resolved to a log with events: [] — which the re-draw guard
    // reads as "safe to overwrite".
    await expect(loadDistributionLog(root, MONTH)).rejects.toThrow(/could not be read/i);
  });

  it("propagates NotAllowedError on the 1-main directory instead of reporting zero events", async () => {
    const root = failOpeningChild(await seededWorkspace(), "1-main", notAllowed());

    await expect(loadDistributionLog(root, MONTH)).rejects.toThrow(/permission was revoked/i);
  });

  it("still treats a genuinely absent month as an empty log", async () => {
    // The other direction, and the reason the bare catch existed at all: a month
    // that has never been distributed has no directory, and that must stay a
    // normal empty result rather than an error.
    const root = createMemoryDirectory();

    const log = await loadDistributionLog(root, MONTH);

    expect(log.events).toEqual([]);
  });
});
