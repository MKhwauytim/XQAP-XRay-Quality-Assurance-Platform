// The absorbing state behind the yellow `storage:bak-recovery` banner in the
// 2026-09-10..14 production log — "the live file is damaged and every reader is
// falling back until something rewrites it" — for
// hihaloraini.requests.json, jalgahamdi.requests.json, threads.index.json,
// distribution.current.json and distribution.checkpoint.json.
//
// Once a live file is unreadable, two rules in safeWriteJson combine into a trap
// that nothing can escape:
//
//   1. The `.bak` snapshot is taken only `if (hasCurrent)` — i.e. only when the
//      live file parses. While it is damaged the `.bak` is FROZEN at whatever
//      revision it held when the damage happened. The one thing that refreshes
//      the snapshot is gated on the snapshot's source being healthy.
//   2. On a commit-verify mismatch, `rollbackFromBak` writes that frozen `.bak`
//      back over the live file.
//
// So the recovery path restores a revision this write never created, discards
// the data we just verified on disk as `.tmp`, and re-establishes the exact
// precondition. The CAS loop above re-reads the same frozen revision, computes
// the same next revision, and fails the same way — which is why طلب استبدال
// presented as ALWAYS failing for those two employees rather than intermittently.
//
// Rolling back is right when we took the snapshot in THIS write: the `.bak` is
// then the immediately-previous good version of the very thing we replaced.
// It is wrong when we did not, and the module already has the correct answer for
// that case a few lines below — promote the `.tmp`, which was byte-verified
// before the commit. These tests pin that split.

import { describe, it, expect } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { safeWriteJson, safeReadJson } from "./safeWrite";
import { wrap } from "./jsonEnvelope";
import { createDeadline } from "./operationDeadline";

const FILE = "requests.json";

async function writeRaw(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

/**
 * The production shape: the live file is damaged, a VALID `.bak` from an older
 * revision is sitting beside it, and reads of the live name keep failing after
 * the first (so the commit read-back cannot confirm).
 */
async function shareWithDamagedLiveFile(): Promise<DirectoryHandleLike> {
  const dir = createMemoryDirectory("root", {
    faults: [
      {
        operation: "getFileHandle",
        name: FILE,
        create: false,
        // Let the pre-write read through so the file is seen as DAMAGED (it
        // exists and does not parse) rather than absent — the production state.
        skip: 1,
        errorName: "NotFoundError",
        times: 1,
      },
    ],
  });
  await writeRaw(dir, FILE, "{ this is not valid json");
  await writeRaw(
    dir,
    `${FILE}.bak`,
    JSON.stringify(wrap({ requests: ["OLD-REQUEST"] }, 4))
  );
  return dir;
}

describe("safeWriteJson — a damaged live file is repairable, not absorbing", () => {
  it("does not restore a stale .bak it did not create, discarding the verified write", async () => {
    const dir = await shareWithDamagedLiveFile();

    // Pre-fix this threw XQ-IO-009 ("rolled back to previous version") and left
    // OLD-REQUEST on disk — the append erased, the trap re-armed.
    await safeWriteJson(
      dir,
      FILE,
      { requests: ["OLD-REQUEST", "NEW-REQUEST"] },
      { deadline: createDeadline(0, "test:damaged-live") }
    );

    const read = await safeReadJson<{ requests: string[] }>(dir, FILE);
    expect(read.ok).toBe(true);
    // The whole point: the newly filed request survived.
    expect(read.ok && read.value.requests).toContain("NEW-REQUEST");
  });

  it("heals the live file so readers stop falling back to .bak", async () => {
    const dir = await shareWithDamagedLiveFile();

    await safeWriteJson(dir, FILE, { requests: ["NEW-REQUEST"] }, {
      deadline: createDeadline(0, "test:damaged-live"),
    });

    // `recoveredFromBak` staying false is what clears the banner: the live copy
    // is readable again, so the next reader is served from it.
    const read = await safeReadJson<{ requests: string[] }>(dir, FILE);
    expect(read.ok).toBe(true);
    expect(read.ok && read.recoveredFromBak).toBeFalsy();
  });

  it("still rolls back to a .bak it DID create in this write", async () => {
    // The guard on the change: when the live file was healthy, we snapshotted it
    // ourselves, and that snapshot IS the correct previous version to restore on
    // a failed commit. That behaviour must not change.
    const dir = createMemoryDirectory("root", {
      faults: [
        {
          operation: "getFileHandle",
          name: FILE,
          create: false,
          // Let the pre-write read AND the staged verify through; fail the
          // commit read-back so the rollback path is taken.
          skip: 1,
          errorName: "NotFoundError",
          times: 1,
        },
      ],
    });
    // A HEALTHY live file: this write will snapshot it before committing.
    await writeRaw(dir, FILE, JSON.stringify(wrap({ requests: ["GOOD"] }, 4)));

    await expect(
      safeWriteJson(dir, FILE, { requests: ["REPLACEMENT"] }, {
        deadline: createDeadline(0, "test:healthy-live"),
      })
    ).rejects.toThrow();

    const read = await safeReadJson<{ requests: string[] }>(dir, FILE);
    expect(read.ok && read.value.requests).toContain("GOOD");
  });
});
