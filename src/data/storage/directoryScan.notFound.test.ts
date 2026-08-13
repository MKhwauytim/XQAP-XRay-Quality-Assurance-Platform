/* @vitest-environment jsdom */
// Regression tests for the second half of the UNC/SMB NotFoundError report: the
// bare, un-Arabic
// "A requested file or directory could not be found at the time an operation was
//  processed."
// that reached the screen with no Arabic wrapper at all.
//
// Its source is not the write path (fixed separately in
// distributionEventStore.ts) but the two enumerate-then-open loops in
// directoryScan.ts. Both list a directory and then re-open every matching entry
// by name. On a shared folder an entry can be renamed, removed, or simply not
// yet visible to this client between those two steps — a normal condition, not
// an error — and an unguarded `getFileHandle(name, { create: false })` turned it
// into a thrown DOMException that aborted the whole enumeration.
//
// The fault harness in memoryDirectory.ts reproduces both shapes: `times: N`
// fails the first N matching opens and then succeeds (transiently invisible),
// `times: Infinity` never lets them through (genuinely vanished).
import { beforeEach, describe, expect, it } from "vitest";
import { clearErrors, getRecentErrors } from "./errorLogger";
import {
  clearOperationLog,
  clearSimulatedFaults,
  createMemoryDirectory,
  getOperationLog,
  setSimulatedFaults,
} from "./memoryDirectory";
import {
  SEGMENT_TAIL_VANISH_RETRY_BUDGET,
  VANISHED_ENTRY_RETRY_DELAYS_MS,
  listDirectoryEntriesWithSize,
  readSegmentTails,
} from "./directoryScan";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { containsArabic, thrownErrorText } from "./writeErrorText";

async function writeRawFile(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}

beforeEach(() => {
  clearErrors();
});

describe("listDirectoryEntriesWithSize when an entry vanishes between listing and open", () => {
  it("skips the vanished entry, returns every other entry, and does not throw", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "a.answers.json", "aa");
    await writeRawFile(dir, "gone.answers.json", "gg");
    await writeRawFile(dir, "z.answers.json", "zzz");

    setSimulatedFaults(dir, [
      {
        operation: "getFile",
        name: "gone.answers.json",
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const sized = await listDirectoryEntriesWithSize(dir, ".answers.json");

    expect(sized).toEqual([
      { name: "a.answers.json", size: 2 },
      { name: "z.answers.json", size: 3 },
    ]);
    clearSimulatedFaults(dir);
  });

  it("records the skip in the error log with the directory and entry name", async () => {
    const dir = createMemoryDirectory("employees");
    await writeRawFile(dir, "gone.answers.json", "gg");
    setSimulatedFaults(dir, [
      {
        operation: "getFile",
        name: "gone.answers.json",
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await listDirectoryEntriesWithSize(dir, ".answers.json");

    const logged = getRecentErrors().filter((entry) => entry.context === "directoryScan:sized-listing");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.message).toContain("gone.answers.json");
    expect(logged[0]!.message).toContain("employees");
    clearSimulatedFaults(dir);
  });

  it("spends NO retry budget per entry — the sync tick must stay one open per matched file", async () => {
    const dir = createMemoryDirectory("root", { trackOperations: true });
    for (let index = 0; index < 5; index += 1) {
      await writeRawFile(dir, `f${index}.answers.json`, "x");
    }
    setSimulatedFaults(dir, [
      {
        operation: "getFile",
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    clearOperationLog(dir);

    const sized = await listDirectoryEntriesWithSize(dir, ".answers.json");

    expect(sized).toEqual([]);
    // Five matched entries, five reads. Not 5 x (1 + retries): this runs on
    // every sync tick, so a per-entry retry ladder would multiply the tick's
    // wall time by the number of employees in the workspace.
    const log = getOperationLog(dir);
    expect(log.filter((entry) => entry.operation === "getFile")).toHaveLength(5);
    // And not one by-name re-open either: the enumeration already produced the
    // handle. This is the assertion that keeps the tick at ONE round trip per
    // matched file — see listDirectoryEntriesWithSize's doc comment.
    expect(log.filter((entry) => entry.operation === "getFileHandle")).toHaveLength(0);
    clearSimulatedFaults(dir);
  });

  it("costs exactly ONE operation per matched file on the success path", async () => {
    const dir = createMemoryDirectory("root", { trackOperations: true });
    for (let index = 0; index < 12; index += 1) {
      await writeRawFile(dir, `f${index}.answers.json`, "x");
    }
    await writeRawFile(dir, "ignored.json", "y");
    clearOperationLog(dir);

    const sized = await listDirectoryEntriesWithSize(dir, ".answers.json");

    expect(sized).toHaveLength(12);
    const log = getOperationLog(dir);
    // 12 x getFile, nothing else. Before the enumerated handle was reused this
    // was 12 x (getFileHandle + getFile) — 24 UNC/SMB round trips per tick per
    // client, for every employee in the workspace.
    expect(log.filter((entry) => entry.operation === "getFile")).toHaveLength(12);
    expect(log.filter((entry) => entry.operation === "getFileHandle")).toHaveLength(0);
    expect(log).toHaveLength(12);
  });

  it("propagates a non-vanish failure (e.g. permission) instead of silently returning a short listing", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "a.answers.json", "aa");
    setSimulatedFaults(dir, [
      {
        operation: "getFile",
        errorName: "NotAllowedError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await expect(listDirectoryEntriesWithSize(dir, ".answers.json")).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    clearSimulatedFaults(dir);
  });
});

describe("readSegmentTails when a segment vanishes or is transiently invisible", () => {
  it("re-reads a transiently invisible segment rather than dropping its events from the fold", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "devA-s1.ndjson", "line-a\n");
    await writeRawFile(dir, "devB-s1.ndjson", "line-b\n");

    setSimulatedFaults(dir, [
      {
        operation: "getFile",
        name: "devB-s1.ndjson",
        errorName: "NotFoundError",
        times: 1,
      },
    ]);

    const result = await readSegmentTails(dir, { suffix: ".ndjson", knownOffsets: {} });

    expect(result.matchedNames).toEqual(["devA-s1.ndjson", "devB-s1.ndjson"]);
    expect(result.tailTextByName.get("devB-s1.ndjson")).toBe("line-b\n");
    expect(result.sizeByName.get("devB-s1.ndjson")).toBe(7);
    clearSimulatedFaults(dir);
  });

  it("skips a genuinely vanished segment, keeps the others, and logs the skip", async () => {
    const dir = createMemoryDirectory("distribution.events");
    await writeRawFile(dir, "devA-s1.ndjson", "line-a\n");
    await writeRawFile(dir, "devGone-s1.ndjson", "line-gone\n");

    setSimulatedFaults(dir, [
      {
        operation: "getFile",
        name: "devGone-s1.ndjson",
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const result = await readSegmentTails(dir, { suffix: ".ndjson", knownOffsets: {} });

    expect(result.tailTextByName.get("devA-s1.ndjson")).toBe("line-a\n");
    expect(result.tailTextByName.has("devGone-s1.ndjson")).toBe(false);
    // The name still appears in matchedNames (it WAS in the listing) but no
    // offset is recorded for it, so the next read starts it from its stored
    // offset rather than mistaking "skipped" for "consumed".
    expect(result.matchedNames).toContain("devGone-s1.ndjson");
    expect(result.sizeByName.has("devGone-s1.ndjson")).toBe(false);

    const logged = getRecentErrors().filter((entry) => entry.context === "directoryScan:segment-tails");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.message).toContain("devGone-s1.ndjson");
    clearSimulatedFaults(dir);
  });

  it("caps retries with a per-CALL budget, so a whole-directory outage cannot scale the wait with segment count", async () => {
    const dir = createMemoryDirectory("root", { trackOperations: true });
    for (let index = 0; index < 6; index += 1) {
      await writeRawFile(dir, `dev${index}-s1.ndjson`, "x\n");
    }
    setSimulatedFaults(dir, [
      {
        operation: "getFile",
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    clearOperationLog(dir);

    const result = await readSegmentTails(dir, { suffix: ".ndjson", knownOffsets: {} });

    expect(result.tailTextByName.size).toBe(0);
    const log = getOperationLog(dir);
    // 6 first attempts + at most SEGMENT_TAIL_VANISH_RETRY_BUDGET retries in
    // total across the entire call — NOT 6 x (1 + ladder length).
    expect(log.filter((entry) => entry.operation === "getFile")).toHaveLength(
      6 + SEGMENT_TAIL_VANISH_RETRY_BUDGET
    );
    // Only the RETRIES re-open by name; the first attempt per segment reuses
    // the handle the enumeration produced.
    expect(log.filter((entry) => entry.operation === "getFileHandle")).toHaveLength(
      SEGMENT_TAIL_VANISH_RETRY_BUDGET
    );
    expect(SEGMENT_TAIL_VANISH_RETRY_BUDGET).toBeLessThanOrEqual(VANISHED_ENTRY_RETRY_DELAYS_MS.length);
    clearSimulatedFaults(dir);
  });

  it("costs exactly ONE operation per segment on the success path", async () => {
    const dir = createMemoryDirectory("root", { trackOperations: true });
    for (let index = 0; index < 6; index += 1) {
      await writeRawFile(dir, `dev${index}-s1.ndjson`, "line\n");
    }
    clearOperationLog(dir);

    const result = await readSegmentTails(dir, { suffix: ".ndjson", knownOffsets: {} });

    expect(result.matchedNames).toHaveLength(6);
    const log = getOperationLog(dir);
    expect(log.filter((entry) => entry.operation === "getFile")).toHaveLength(6);
    expect(log.filter((entry) => entry.operation === "getFileHandle")).toHaveLength(0);
  });

  it("propagates a non-vanish failure instead of returning a silently short tail set", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "devA-s1.ndjson", "line-a\n");
    setSimulatedFaults(dir, [
      {
        operation: "getFile",
        create: false,
        errorName: "NotAllowedError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await expect(readSegmentTails(dir, { suffix: ".ndjson", knownOffsets: {} })).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    clearSimulatedFaults(dir);
  });

  it("keeps a vanish out of the UI entirely, and routes any other escaping error through the Arabic wrapper", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "devA-s1.ndjson", "line-a\n");
    setSimulatedFaults(dir, [
      {
        operation: "getFile",
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    // The vanish itself never becomes user-visible text at all.
    await expect(
      readSegmentTails(dir, { suffix: ".ndjson", knownOffsets: {} })
    ).resolves.toBeTruthy();
    clearSimulatedFaults(dir);

    // And the consuming boundary's mapper still refuses to put raw English on
    // an Arabic screen for anything that does escape.
    const raw = new Error(
      "A requested file or directory could not be found at the time an operation was processed."
    );
    raw.name = "NotFoundError";
    const shown = thrownErrorText(raw, "directoryScan:test");
    expect(containsArabic(shown)).toBe(true);
    expect(shown).not.toContain("could not be found");
  });
});
