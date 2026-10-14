// Layout v2 sync probe cost (v154.0 review): the probe used to open every
// assignee folder and stat its heads on every 45 s tick, per client. With the
// `_heads/` markers the steady-state tick is a fixed handful of round trips
// plus a small rotating backstop, independent of how many folders changed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { __clearWorkspaceDirCacheForTests, getAnswerEventsDir, getAssigneeArchiveDir, invalidateAnswerEventsLayout } from "./workspacePaths";
import { __resetAnswerFolderProbeStateForTests, answerFoldersSignature, ANSWER_FOLDER_BACKSTOP_TICKS, movedAnswerFolders } from "./workspaceSync";
import { __resetAnswerFolderHeadsForTests, touchAnswerFolderHead } from "../answers/v2/answerFolderHeads";
import { appendToSegment, makeV2Month, savedEvent, writeAssigneeSegment, writeText } from "../answers/v2/v2TestFixtures";

const session = vi.hoisted(() => ({ username: "viewer" as string | null }));
vi.mock("../../auth/authSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth/authSession")>();
  return { ...actual, readRealSession: () => (session.username ? { username: session.username } : null) };
});

const MONTH = "5-may-2026";
type Counter = { ops: number };

/** Every handle method that is a share round trip counts one: open dir/file, list, stat. */
function counted(dir: DirectoryHandleLike, counter: Counter): DirectoryHandleLike {
  const raw = dir as DirectoryHandleLike & { values?: () => AsyncIterable<unknown> };
  return {
    ...dir,
    name: dir.name,
    kind: "directory",
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
      counter.ops += 1;
      return counted(await dir.getDirectoryHandle(name, options), counter);
    },
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      counter.ops += 1;
      const file = await dir.getFileHandle(name, options);
      return { ...file, getFile: async () => { counter.ops += 1; return file.getFile(); } };
    },
    // A listing is one round trip; the handles it yields are wrapped so a stat
    // through them (`readListedEntry` opens the listed handle) is counted too.
    values: async function* () {
      counter.ops += 1;
      for await (const entry of raw.values!() as AsyncIterable<{ kind: string; getFile?: () => Promise<File> }>) {
        if (entry.kind === "file" && entry.getFile) {
          const file = entry;
          yield { ...file, kind: "file", getFile: async () => { counter.ops += 1; return file.getFile!(); } };
        } else {
          yield counted(entry as unknown as DirectoryHandleLike, counter);
        }
      }
    },
  } as unknown as DirectoryHandleLike;
}

async function seedFolders(root: DirectoryHandleLike, count: number): Promise<DirectoryHandleLike[]> {
  await makeV2Month(root);
  const dirs: DirectoryHandleLike[] = [];
  for (let i = 0; i < count; i += 1) {
    const user = `emp${i}`;
    // two chains per folder: the owner's and an on-behalf writer's, two segments each
    const dir = await writeAssigneeSegment(root, user, "own.ndjson", [savedEvent(`a${i}`, 1, {}, user)]);
    await writeText(dir, "own-1.ndjson", "");
    await appendToSegment(dir, "own-1.ndjson", [savedEvent(`b${i}`, 2, {}, user)]);
    await writeText(dir, "admin.ndjson", "");
    dirs.push(dir);
  }
  return dirs;
}

async function tickCost(events: DirectoryHandleLike): Promise<{ ops: number; sig: string }> {
  const counter = { ops: 0 };
  const sig = await answerFoldersSignature(counted(events, counter), MONTH, "ws");
  return { ops: counter.ops, sig };
}

describe("v2 answers sync probe — _heads markers", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
    __resetAnswerFolderHeadsForTests();
    __resetAnswerFolderProbeStateForTests();
    session.username = "viewer";
  });

  it("costs a fixed handful of round trips per tick for 30 assignees, versus O(assignees) without markers", async () => {
    const N = 30;
    const root = createMemoryDirectory("cost");
    await seedFolders(root, N);
    const events = await getAnswerEventsDir(root, MONTH);

    // BEFORE: no markers (pre-marker writes) — every folder is opened, listed and its heads stat'd every tick.
    await tickCost(events);
    const before = await tickCost(events);

    // AFTER: every folder carries a marker.
    for (let i = 0; i < N; i += 1) await touchAnswerFolderHead(events, `emp${i}`, `emp${i}`);
    __resetAnswerFolderProbeStateForTests();
    const baseline = await tickCost(events);
    const steady: number[] = [];
    for (let t = 0; t < ANSWER_FOLDER_BACKSTOP_TICKS * 2; t += 1) {
      const tick = await tickCost(events);
      expect(tick.sig).toBe(baseline.sig); // nothing changed, nothing reported
      steady.push(tick.ops);
    }
    const max = Math.max(...steady);
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
    console.info(`[answer-probe-cost] N=${N} before=${before.ops}/tick baseline=${baseline.ops} after max=${max} mean=${mean.toFixed(1)}/tick`);
    expect(before.ops).toBeGreaterThanOrEqual(1 + N * 3);
    expect(max).toBeLessThanOrEqual(3 + Math.ceil(N / ANSWER_FOLDER_BACKSTOP_TICKS) * 6);
    expect(max * 4).toBeLessThan(before.ops);
  });

  it("shows another user's append on the very next tick, naming exactly that folder", async () => {
    const root = createMemoryDirectory("remote");
    const dirs = await seedFolders(root, 30);
    const events = await getAnswerEventsDir(root, MONTH);
    for (let i = 0; i < 30; i += 1) await touchAnswerFolderHead(events, `emp${i}`, `emp${i}`);
    const before = (await tickCost(events)).sig;
    await appendToSegment(dirs[7]!, "own-1.ndjson", [savedEvent("c7", 3, {}, "emp7")]);
    await touchAnswerFolderHead(events, "emp7", "emp7");
    const after = (await tickCost(events)).sig;
    expect(movedAnswerFolders(before, after)).toEqual(new Set(["emp7"]));
  });

  it("an on-behalf append by another user into MY folder is seen; my own marker is not", async () => {
    session.username = "emp3";
    const root = createMemoryDirectory("self");
    await seedFolders(root, 5);
    const events = await getAnswerEventsDir(root, MONTH);
    for (let i = 0; i < 5; i += 1) await touchAnswerFolderHead(events, `emp${i}`, `emp${i}`);
    const s0 = (await tickCost(events)).sig;
    await touchAnswerFolderHead(events, "emp3", "emp3"); // my own save
    const s1 = (await tickCost(events)).sig;
    expect(movedAnswerFolders(s0, s1)).toEqual(new Set());
    await touchAnswerFolderHead(events, "emp3", "admin"); // admin answers on my behalf
    const s2 = (await tickCost(events)).sig;
    expect(movedAnswerFolders(s1, s2)).toEqual(new Set(["emp3"]));
  });

  it("compaction (non-head segments moved to archive/, no marker touched) is never a change, through a full backstop rotation", async () => {
    const root = createMemoryDirectory("compact");
    const dirs = await seedFolders(root, 4);
    const events = await getAnswerEventsDir(root, MONTH);
    for (let i = 0; i < 4; i += 1) await touchAnswerFolderHead(events, `emp${i}`, `emp${i}`);
    const base = (await tickCost(events)).sig;
    // own.ndjson is sealed by own-1.ndjson: compaction moves it.
    const archive = await getAssigneeArchiveDir(root, MONTH, "emp1", true);
    await writeText(archive, "own.ndjson", "x");
    await dirs[1]!.removeEntry!("own.ndjson");
    for (let t = 0; t < ANSWER_FOLDER_BACKSTOP_TICKS + 1; t += 1) {
      expect(movedAnswerFolders(base, (await tickCost(events)).sig)).toEqual(new Set());
    }
  });

  it("backstop: a head that grows without a marker touch (failed touch, pre-marker writer) is seen within one rotation", async () => {
    const root = createMemoryDirectory("backstop");
    const dirs = await seedFolders(root, 30);
    const events = await getAnswerEventsDir(root, MONTH);
    for (let i = 0; i < 30; i += 1) await touchAnswerFolderHead(events, `emp${i}`, `emp${i}`);
    const base = (await tickCost(events)).sig;
    await appendToSegment(dirs[12]!, "own-1.ndjson", [savedEvent("late", 9, {}, "emp12")]);
    let seenAt = -1;
    for (let t = 1; t <= ANSWER_FOLDER_BACKSTOP_TICKS; t += 1) {
      const moved = movedAnswerFolders(base, (await tickCost(events)).sig);
      if (moved && moved.size > 0) {
        expect(moved).toEqual(new Set(["emp12"]));
        seenAt = t;
        break;
      }
    }
    expect(seenAt).toBeGreaterThan(0);
  });

  it("a folder without any marker (older v154 write) is fully scanned every tick", async () => {
    const root = createMemoryDirectory("fallback");
    const dirs = await seedFolders(root, 3);
    const events = await getAnswerEventsDir(root, MONTH);
    await touchAnswerFolderHead(events, "emp0", "emp0"); // only emp0 is marked
    const base = (await tickCost(events)).sig;
    await appendToSegment(dirs[2]!, "own-1.ndjson", [savedEvent("x", 5, {}, "emp2")]);
    expect(movedAnswerFolders(base, (await tickCost(events)).sig)).toEqual(new Set(["emp2"]));
  });
});
