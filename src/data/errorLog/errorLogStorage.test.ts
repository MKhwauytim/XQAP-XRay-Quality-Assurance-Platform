import { describe, it, expect, afterEach } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { errorsArchiveFileName, errorsFileName } from "./errorLogPaths";
import type { PersistedErrorEntry } from "./errorLogTypes";
import {
  __resetMaxErrorEntriesForTests,
  __setMaxErrorEntriesForTests,
  appendUserErrors,
  readAllWorkspaceErrors,
  readWorkspaceErrorArchive,
} from "./errorLogStorage";

afterEach(() => __resetMaxErrorEntriesForTests());

function entry(overrides: Partial<PersistedErrorEntry> = {}): PersistedErrorEntry {
  return {
    id: `err-${Math.random().toString(36).slice(2)}`,
    at: "2026-08-24T10:00:00.000Z",
    username: "alice",
    role: "employee",
    page: "population/browse",
    action: "population:save",
    context: "population:save",
    message: "boom",
    ...overrides,
  };
}

function root(): DirectoryHandleLike {
  return createMemoryDirectory("root");
}

describe("errorLogStorage", () => {
  it("writes one file per user and nothing shared", async () => {
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ username: "alice" })]);
    await appendUserErrors(dir, "bob", [entry({ username: "bob" })]);

    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    await expect(errors.getFileHandle(errorsFileName("alice"), { create: false })).resolves.toBeDefined();
    await expect(errors.getFileHandle(errorsFileName("bob"), { create: false })).resolves.toBeDefined();
    // Nothing writes a shared file: that is the entire point of the layout.
    await expect(errors.getFileHandle("errors.log.json", { create: false })).rejects.toThrow();
  });

  it("appends rather than replacing across calls", async () => {
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "err-1" })]);
    await appendUserErrors(dir, "alice", [entry({ id: "err-2" })]);

    const all = await readAllWorkspaceErrors(dir);
    expect(all.map((e) => e.id).sort()).toEqual(["err-1", "err-2"]);
  });

  it("writes a whole batch in ONE file write, not one per entry", async () => {
    // The sink batches precisely so a burst of errors is one SMB round trip.
    // A per-entry implementation would still pass the assertion above.
    const dir = root();
    await appendUserErrors(dir, "alice", [
      entry({ id: "err-1" }),
      entry({ id: "err-2" }),
      entry({ id: "err-3" }),
    ]);
    const all = await readAllWorkspaceErrors(dir);
    expect(all).toHaveLength(3);
    // Revision advanced exactly once for the batch.
    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    const handle = await errors.getFileHandle(errorsFileName("alice"), { create: false });
    const text = await (await handle.getFile()).text();
    expect(JSON.parse(text).data.revision).toBe(1);
  });

  it("merges every user's file on an aggregate read, oldest first", async () => {
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "a", at: "2026-08-24T09:00:00.000Z" })]);
    await appendUserErrors(dir, "bob", [entry({ id: "b", at: "2026-08-24T08:00:00.000Z", username: "bob" })]);

    const all = await readAllWorkspaceErrors(dir);
    expect(all.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("archives the oldest overflow BEFORE trimming the live file", async () => {
    __setMaxErrorEntriesForTests(3);
    const dir = root();
    for (const id of ["e1", "e2", "e3", "e4", "e5"]) {
      await appendUserErrors(dir, "alice", [entry({ id })]);
    }

    const live = await readAllWorkspaceErrors(dir);
    expect(live.map((e) => e.id)).toEqual(["e3", "e4", "e5"]);

    const archived = await readWorkspaceErrorArchive(dir, 2026);
    expect(archived.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });

  it("archives idempotently by entry id, so a retry cannot double-append", async () => {
    __setMaxErrorEntriesForTests(2);
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "e1" }), entry({ id: "e2" }), entry({ id: "e3" })]);
    await appendUserErrors(dir, "alice", [entry({ id: "e4" })]);

    const archived = await readWorkspaceErrorArchive(dir, 2026);
    expect(archived.map((e) => e.id)).toEqual([...new Set(archived.map((e) => e.id))]);
  });

  it("keeps a live file over cap rather than dropping entries when archiving fails", async () => {
    // Archive failure must BLOCK the trim — an entry that was never archived
    // must never be discarded. Same contract as actionLog.ts:466-475.
    __setMaxErrorEntriesForTests(1);
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "e1" })]);

    // Make the archive filename unwritable, leaving the live file writable.
    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    setSimulatedFaults(errors, [
      {
        operation: "createWritable",
        name: errorsArchiveFileName("alice", 2026),
        errorName: "NotAllowedError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await appendUserErrors(dir, "alice", [entry({ id: "e2" })]);

    const live = await readAllWorkspaceErrors(dir);
    expect(live.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });

  it("never throws to its caller when the workspace cannot be written", async () => {
    const dir = createMemoryDirectory("root", { initialWritePermission: "denied" });
    await expect(appendUserErrors(dir, "alice", [entry()])).resolves.toBeUndefined();
  });

  it("returns an empty list rather than throwing when the folder does not exist", async () => {
    await expect(readAllWorkspaceErrors(root())).resolves.toEqual([]);
  });

  it("skips an unreadable per-user file instead of losing every other user's history", async () => {
    const dir = root();
    await appendUserErrors(dir, "alice", [entry({ id: "a" })]);
    await appendUserErrors(dir, "bob", [entry({ id: "b", username: "bob" })]);

    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    const handle = await errors.getFileHandle(errorsFileName("bob"), { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{ not json");
    await writable.close();

    const all = await readAllWorkspaceErrors(dir);
    expect(all.map((e) => e.id)).toEqual(["a"]);
  });
});
