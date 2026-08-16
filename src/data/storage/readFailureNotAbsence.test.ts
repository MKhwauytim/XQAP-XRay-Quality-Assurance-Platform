// "I could not look" must never become "there is nothing there".
//
// That laundering has already caused a documented month-overwriting data loss
// here (loadDistributionLog reporting zero events for a month with a full
// assignment history, letting saveSampleMaster overwrite it). This suite covers
// the two remaining places where the same bare `catch { return null }` sat in
// front of an IRREVERSIBLE consequence.
//
// Both tests were written against the pre-fix code and both failed there: the
// transient fault resolved to `null`, and the caller read that as a clean
// "nothing here" answer.

import { describe, it, expect } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { loadEmployeeSampleMirror } from "../samples/sampleMirrorStorage";
import { isMonthClosed } from "../population/monthLock";
import { getSampleEmployeeDir } from "../workspace/workspacePaths";
import { getPopulationMonthDir } from "../workspace/workspacePaths";

const MONTH = "5-May-2026";

function unreadable(): Error {
  const error = new Error("The file could not be read at this time");
  error.name = "NotReadableError";
  return error;
}

/** Fails opening ONE named file, as a flaky share does mid-read. */
function failReadingFile(
  root: DirectoryHandleLike,
  match: (name: string) => boolean,
  error: Error
): DirectoryHandleLike {
  const wrap = (dir: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(dir, {
      get(target, prop, receiver) {
        if (prop === "getFileHandle") {
          return async (name: string, options?: { create?: boolean }) => {
            if (match(name)) throw error;
            return target.getFileHandle(name, options);
          };
        }
        if (prop === "getDirectoryHandle") {
          return async (name: string, options?: { create?: boolean }) =>
            wrap(await target.getDirectoryHandle(name, options));
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as DirectoryHandleLike;
  return wrap(root);
}

describe("an unreadable employee mirror is not an employee with no work", () => {
  it("propagates NotReadableError instead of resolving to null", async () => {
    // Why this one matters most: getUserWorkspaceFootprint treats a null mirror
    // as "not stale", so it skips the authoritative fold and reports
    // pendingCount 0 -- which User Management reads as "no active assignments,
    // safe to delete". One transient share fault was enough to orphan a live
    // workload, and deleting a user is not undoable.
    const seeded = createMemoryDirectory();
    await getSampleEmployeeDir(seeded, MONTH, true);
    const root = failReadingFile(seeded, (name) => name.endsWith(".samples.json"), unreadable());

    await expect(loadEmployeeSampleMirror(root, MONTH, "employee1")).rejects.toThrow(
      /could not be read/i
    );
  });

  it("still returns null for an employee who genuinely has no mirror", async () => {
    // The other direction, and the reason the bare catch existed: an employee
    // never assigned anything has no file, and that must stay a normal empty
    // answer rather than an error.
    const root = createMemoryDirectory();

    await expect(loadEmployeeSampleMirror(root, MONTH, "employee1")).resolves.toBeNull();
  });
});

describe("an unreadable month manifest is not an open month", () => {
  it("propagates NotReadableError rather than silently unlocking a closed month", async () => {
    // isMonthClosed is the single write gate for every employee-facing write
    // and for saveMonthRun. Failing open on a read fault let answers, referrals
    // and distribution events land in an already-closed, already-reported
    // period -- and the verdict was TTL-cached, so one bad read kept it open.
    const seeded = createMemoryDirectory();
    await getPopulationMonthDir(seeded, MONTH, true);
    const root = failReadingFile(seeded, (name) => name === "month.manifest.json", unreadable());

    await expect(isMonthClosed(root, MONTH)).rejects.toThrow(/could not be read/i);
  });

  it("still treats a month with no folder as open", async () => {
    // Fail-open is correct here: a month that was never imported is not a
    // closed one, and this is the case the original catch was written for.
    const root = createMemoryDirectory();

    await expect(isMonthClosed(root, MONTH)).resolves.toBe(false);
  });
});
