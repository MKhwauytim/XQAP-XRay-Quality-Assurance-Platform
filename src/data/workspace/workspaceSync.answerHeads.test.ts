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

const session = vi.hoisted(() => ({ username: "viewer" as string | null, role: "supervisor" as string }));
vi.mock("../../auth/authSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth/authSession")>();
  return { ...actual, readRealSession: () => (session.username ? { username: session.username, role: session.role } : null) };
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
    session.role = "supervisor";
  });

  describe("employee scope: only the user's own folder is probed", () => {
    async function employeeTickMax(n: number): Promise<{ max: number; mean: number }> {
      const root = createMemoryDirectory(`emp-scope-${n}`);
      await seedFolders(root, n);
      const events = await getAnswerEventsDir(root, MONTH);
      for (let i = 0; i < n; i += 1) await touchAnswerFolderHead(events, `emp${i}`, `emp${i}`);
      __resetAnswerFolderProbeStateForTests();
      const baseline = await tickCost(events);
      const steady: number[] = [];
      for (let t = 0; t < ANSWER_FOLDER_BACKSTOP_TICKS * 2; t += 1) {
        const tick = await tickCost(events);
        expect(tick.sig).toBe(baseline.sig);
        steady.push(tick.ops);
      }
      return { max: Math.max(...steady), mean: steady.reduce((a, b) => a + b, 0) / steady.length };
    }

    it("costs a constant number of round trips per tick, independent of the assignee count (5 vs 30)", async () => {
      session.username = "emp3";
      session.role = "employee";
      const small = await employeeTickMax(5);
      const large = await employeeTickMax(30);
      console.info(`[answer-probe-cost:employee] N=5 max=${small.max} mean=${small.mean.toFixed(1)} · N=30 max=${large.max} mean=${large.mean.toFixed(1)}/tick`);
      expect(large.max).toBe(small.max);
      // open own folder + list `_heads/` (2) + the own folder's chain heads each tick (≤ 1 list + stats).
      expect(large.max).toBeLessThanOrEqual(8);
    });

    it("sees a supervisor's on-behalf save into MY folder, not another employee's save", async () => {
      session.username = "emp3";
      session.role = "employee";
      const root = createMemoryDirectory("emp-scope-vis");
      const dirs = await seedFolders(root, 6);
      const events = await getAnswerEventsDir(root, MONTH);
      for (let i = 0; i < 6; i += 1) await touchAnswerFolderHead(events, `emp${i}`, `emp${i}`);
      const s0 = (await tickCost(events)).sig;
      await appendToSegment(dirs[5]!, "own-1.ndjson", [savedEvent("c5", 3, {}, "emp5")]);
      await touchAnswerFolderHead(events, "emp5", "emp5"); // employee B saves
      const s1 = (await tickCost(events)).sig;
      expect(movedAnswerFolders(s0, s1)).toEqual(new Set());
      await appendToSegment(dirs[3]!, "admin.ndjson", [savedEvent("c3", 3, {}, "emp3")]);
      await touchAnswerFolderHead(events, "emp3", "sup1"); // supervisor answers on my behalf
      const s2 = (await tickCost(events)).sig;
      expect(movedAnswerFolders(s1, s2)).toEqual(new Set(["emp3"]));
    });

    it("an employee whose folder does not exist yet sees it appear once the first on-behalf save creates it", async () => {
      session.username = "newbie";
      session.role = "employee";
      const root = createMemoryDirectory("emp-scope-new");
      await seedFolders(root, 3);
      const events = await getAnswerEventsDir(root, MONTH);
      const s0 = (await tickCost(events)).sig;
      await writeAssigneeSegment(root, "newbie", "sup.ndjson", [savedEvent("n1", 1, {}, "newbie")]);
      await touchAnswerFolderHead(events, "newbie", "sup1");
      const s1 = (await tickCost(events)).sig;
      expect(movedAnswerFolders(s0, s1)).toEqual(new Set(["newbie"]));
    });

    it("a supervisor still sees every folder (unchanged)", async () => {
      session.username = "sup1";
      session.role = "supervisor";
      const root = createMemoryDirectory("sup-scope");
      const dirs = await seedFolders(root, 6);
      const events = await getAnswerEventsDir(root, MONTH);
      for (let i = 0; i < 6; i += 1) await touchAnswerFolderHead(events, `emp${i}`, `emp${i}`);
      const s0 = (await tickCost(events)).sig;
      await appendToSegment(dirs[5]!, "own-1.ndjson", [savedEvent("c5", 3, {}, "emp5")]);
      await touchAnswerFolderHead(events, "emp5", "emp5");
      expect(movedAnswerFolders(s0, (await tickCost(events)).sig)).toEqual(new Set(["emp5"]));
    });
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
