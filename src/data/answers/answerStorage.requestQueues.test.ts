// A10: loadAllEmployeeRequestFiles read every employee's requests file serially and, for
// every employee WITHOUT one, fell back to a legacy `.answers.json` read, on every call
// from every client. Now: bounded concurrency, the legacy fallback memoized (frozen file),
// and the whole result memoized per workspace epoch so a tick that did not move `requests`
// costs nothing. Failures are never memoized and a failed listing still throws.
import { describe, expect, it } from "vitest";

import {
  clearReadLog,
  createMemoryDirectory,
  getReadLog,
} from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { bumpWorkspaceEpoch, workspaceEpoch } from "../storage/inFlightReads";
import { safeWriteJson } from "../storage/safeWrite";
import { getSampleEmployeeDir } from "../workspace/workspacePaths";
import {
  __clearAnswerEventsCacheForTests,
  appendReferralToEmployee,
  carryRequestQueuesAcrossEpochBump,
  loadAllEmployeeRequestFiles,
} from "./answerStorage";

const MONTH = "5-May-2026";

async function seed(root: DirectoryHandleLike, withRequests: number, legacyOnly: number): Promise<void> {
  const dir = await getSampleEmployeeDir(root, MONTH, true);
  for (let i = 0; i < withRequests; i += 1) {
    const u = `emp${String(i).padStart(2, "0")}`;
    await safeWriteJson(dir, `${u}.requests.json`, {
      username: u, monthFolderName: MONTH, revision: 1,
      referralRequests: [{ requestId: `r-${u}` }], replacementRequests: [], reopenRequests: [],
    });
  }
  for (let i = 0; i < legacyOnly; i += 1) {
    const u = `old${String(i).padStart(2, "0")}`;
    await safeWriteJson(dir, `${u}.answers.json`, {
      username: u, monthFolderName: MONTH, revision: 1, items: [],
      referralRequests: [{ requestId: `legacy-${u}` }],
    });
  }
}

const reads = (root: DirectoryHandleLike): number => getReadLog(root).length;
const makeRoot = (): DirectoryHandleLike =>
  createMemoryDirectory("rq", { trackReads: true }) as unknown as DirectoryHandleLike;

describe("loadAllEmployeeRequestFiles (A10)", () => {
  it("returns queues for requests-file employees and legacy-embedded ones, sorted", async () => {
    __clearAnswerEventsCacheForTests();
    const root = makeRoot();
    await seed(root, 3, 2);
    const files = await loadAllEmployeeRequestFiles(root, MONTH);
    expect(files.map((f) => f.username)).toEqual(["emp00", "emp01", "emp02", "old00", "old01"]);
    expect(files.find((f) => f.username === "old00")!.referralRequests![0]!.requestId).toBe("legacy-old00");
  });

  it("a second call in the same epoch costs zero share reads, at any N", async () => {
    for (const n of [3, 12]) {
      __clearAnswerEventsCacheForTests();
      const root = makeRoot();
      await seed(root, n, 4);
      await loadAllEmployeeRequestFiles(root, MONTH);
      clearReadLog(root);
      const again = await loadAllEmployeeRequestFiles(root, MONTH);
      expect(again).toHaveLength(n + 4);
      expect(reads(root)).toBe(0);
    }
  });

  it("after an epoch bump the frozen legacy fallbacks are NOT re-read: only requests files are", async () => {
    __clearAnswerEventsCacheForTests();
    const root = makeRoot();
    await seed(root, 5, 6);
    await loadAllEmployeeRequestFiles(root, MONTH);
    bumpWorkspaceEpoch(root, MONTH);
    clearReadLog(root);
    const files = await loadAllEmployeeRequestFiles(root, MONTH);
    expect(files).toHaveLength(11);
    const legacyReads = getReadLog(root).filter((e) => e.endsWith(".answers.json")).length;
    expect(legacyReads).toBe(0);
  });

  it("an epoch bump that did not move `requests` (an answers-only tick) can be carried over; a local write cannot", async () => {
    __clearAnswerEventsCacheForTests();
    const root = makeRoot();
    await seed(root, 4, 0);
    await loadAllEmployeeRequestFiles(root, MONTH);
    // answers-only tick: the sync layer bumps the epoch, then carries the memo across it
    const before = workspaceEpoch(root, MONTH);
    bumpWorkspaceEpoch(root, MONTH);
    carryRequestQueuesAcrossEpochBump(root, MONTH, before);
    clearReadLog(root);
    await loadAllEmployeeRequestFiles(root, MONTH);
    expect(reads(root)).toBe(0);
    // a local requests write bumps the epoch WITHOUT carrying: the next call re-reads and sees it
    expect((await appendReferralToEmployee(root, MONTH, {
      requestId: "new-1", monthFolderName: MONTH, fromEmployee: "emp00", toEmployee: "emp01",
      xrayImageIds: ["X"], reason: "r", requestedAt: new Date().toISOString(), requestedBy: "emp00", status: "pending",
    } as never)).ok).toBe(true);
    const after = await loadAllEmployeeRequestFiles(root, MONTH);
    expect(after.find((f) => f.username === "emp00")!.referralRequests!.map((r) => r.requestId)).toContain("new-1");
  });

  it("reads at most 4 employee files at a time", async () => {
    __clearAnswerEventsCacheForTests();
    const root = makeRoot();
    await seed(root, 16, 0);
    const dir = await getSampleEmployeeDir(root, MONTH, true);
    let active = 0;
    let max = 0;
    const original = dir.getFileHandle.bind(dir);
    (dir as { getFileHandle: typeof dir.getFileHandle }).getFileHandle = async (name, opts) => {
      const handle = await original(name, opts);
      if (!name.endsWith(".requests.json")) return handle;
      const getFile = handle.getFile.bind(handle);
      return {
        ...handle,
        getFile: async () => {
          active += 1;
          max = Math.max(max, active);
          await new Promise((r) => setTimeout(r, 5));
          try { return await getFile(); } finally { active -= 1; }
        },
      };
    };
    // getSampleEmployeeDir may return a fresh handle per call in some layouts; only assert when patched
    const files = await loadAllEmployeeRequestFiles(root, MONTH);
    expect(files).toHaveLength(16);
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1); // proves the patched handle is exercised and reads do overlap
  });
});
