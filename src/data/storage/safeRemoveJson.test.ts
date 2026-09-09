import { describe, expect, it } from "vitest";

import {
  createMemoryDirectory,
  clearOperationLog,
  getOperationLog,
  setSimulatedFaults,
} from "./memoryDirectory";
import { listDirectoryEntries } from "./directoryScan";
import { safeReadJson, safeRemoveJson, safeWriteJson } from "./safeWrite";
import {
  __resetBakRecoveryReportsForTests,
} from "./bakRecoveryReport";
import { clearErrors, getRecentErrors } from "./errorLogger";

const FILE = "record.json";

async function writeTwice(dir: ReturnType<typeof createMemoryDirectory>) {
  // Two writes, so safeWriteJson has snapshotted the first revision to `.bak`.
  await safeWriteJson(dir, FILE, { revisionMarker: 1 });
  await safeWriteJson(dir, FILE, { revisionMarker: 2 });
}

async function namesIn(dir: ReturnType<typeof createMemoryDirectory>): Promise<string[]> {
  return (await listDirectoryEntries(dir))
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.name)
    .sort();
}

describe("safeRemoveJson", () => {
  it("removes the live file and both snapshot siblings as a unit", async () => {
    const dir = createMemoryDirectory("records");
    await writeTwice(dir);
    // Fixture validity: the orphan-producing sibling really is there first.
    expect(await namesIn(dir)).toContain(`${FILE}.bak`);

    const result = await safeRemoveJson(dir, FILE);

    expect(result).toEqual({ ok: true, remaining: [] });
    expect(await namesIn(dir)).toEqual([]);
    // The whole point: a read after the delete must report the record GONE,
    // not "recovered" from the sibling.
    await expect(safeReadJson(dir, FILE)).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("removes siblings BEFORE the live name, so an interrupted delete never orphans", async () => {
    const dir = createMemoryDirectory("records", { trackOperations: true });
    await writeTwice(dir);
    // Only the delete's own removals — safeWriteJson clears its own `.tmp`.
    clearOperationLog(dir);

    await safeRemoveJson(dir, FILE);

    const removals = getOperationLog(dir)
      .filter((entry) => entry.operation === "removeEntry")
      .map((entry) => entry.name);
    expect(removals).toEqual([`${FILE}.tmp`, `${FILE}.bak`, FILE]);
  });

  it("still removes an orphaned sibling when the live file is already gone", async () => {
    const dir = createMemoryDirectory("records");
    await writeTwice(dir);
    // The pre-fix production state: a hand-rolled delete took only the live name.
    await dir.removeEntry?.(FILE);
    expect(await namesIn(dir)).toContain(`${FILE}.bak`);

    await expect(safeRemoveJson(dir, FILE)).resolves.toEqual({ ok: true, remaining: [] });
    expect(await namesIn(dir)).toEqual([]);
  });

  it("rides the transient ladder instead of aborting on a share sharing-violation", async () => {
    const dir = createMemoryDirectory("records");
    await writeTwice(dir);
    // Another machine (or an AV scanner) holds `.bak` open mid-write. Aborting
    // here would leave exactly the orphan state this primitive prevents.
    setSimulatedFaults(dir, [
      {
        operation: "removeEntry",
        name: `${FILE}.bak`,
        errorName: "NoModificationAllowedError",
        times: 2,
      },
    ]);

    await expect(safeRemoveJson(dir, FILE)).resolves.toEqual({ ok: true, remaining: [] });
    expect(await namesIn(dir)).toEqual([]);
  });

  it("reports a partial delete instead of hiding it, and still attempts every name", async () => {
    const dir = createMemoryDirectory("records");
    await writeTwice(dir);
    setSimulatedFaults(dir, [
      {
        operation: "removeEntry",
        name: `${FILE}.bak`,
        errorName: "NoModificationAllowedError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const result = await safeRemoveJson(dir, FILE);

    expect(result.ok).toBe(false);
    expect(result.remaining).toEqual([`${FILE}.bak`]);
    // No short-circuit: the live name was still attempted and is gone.
    expect(await namesIn(dir)).toEqual([`${FILE}.bak`]);
  });
});

describe("safeReadJson siblingFallback", () => {
  it("does not consult, or report, a sibling when siblingFallback is false", async () => {
    const dir = createMemoryDirectory("records");
    await writeTwice(dir);
    await dir.removeEntry?.(FILE);
    __resetBakRecoveryReportsForTests();
    clearErrors();

    const result = await safeReadJson(dir, FILE, { siblingFallback: false });

    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(getRecentErrors().filter((e) => e.context === "storage:bak-recovery")).toHaveLength(0);
  });

  it("still recovers by default on the same fixture", async () => {
    const dir = createMemoryDirectory("records");
    await writeTwice(dir);
    await dir.removeEntry?.(FILE);
    __resetBakRecoveryReportsForTests();
    clearErrors();

    const result = await safeReadJson(dir, FILE);

    expect(result.ok).toBe(true);
    const logged = getRecentErrors().filter((e) => e.context === "storage:bak-recovery");
    expect(logged).toHaveLength(1);
    // A live file that is ABSENT must not be described as damaged — that
    // wording sent an admin hunting for corruption in a deleted file for
    // eighteen hours.
    expect(logged[0]!.message).toContain("has no live copy");
    expect(logged[0]!.message).not.toContain("is damaged");
  });

  it("still says 'damaged' when the live file is present but unreadable", async () => {
    const dir = createMemoryDirectory("records");
    await writeTwice(dir);
    await safeWriteJson(dir, "scratch.json", { ok: true });
    // Truncate the live file in place: present, but not parseable.
    const handle = await dir.getFileHandle(FILE);
    const writable = await handle.createWritable?.();
    await writable?.write("{ not json");
    await writable?.close();
    __resetBakRecoveryReportsForTests();
    clearErrors();

    const result = await safeReadJson(dir, FILE);

    expect(result.ok).toBe(true);
    const logged = getRecentErrors().filter((e) => e.context === "storage:bak-recovery");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.message).toContain("is damaged");
  });
});
