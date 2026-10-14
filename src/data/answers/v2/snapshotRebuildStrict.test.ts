// Review finding 1 (v154.0): a rebuild that PERSISTS snapshot.json must never
// treat an unopenable segment as "no events" — the snapshot is authoritative
// afterwards and archive/ is never re-read, so those events would vanish.
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { EventSegmentUnreadableError, encodeEventLine } from "../../storage/appendOnlyEventLog";
import { clearDeadSegmentRegistry } from "../../storage/deadSegmentRegistry";
import { __clearWorkspaceDirCacheForTests, getAssigneeAnswerEventsDir, getAssigneeArchiveDir } from "../../workspace/workspacePaths";
import { __resetCompactionRateLimitForTests, compactAssignee } from "../compaction/compactAssignee";
import { rebuildAndPersistAssigneeSnapshot } from "./rebuildAssigneeSnapshot";
import { makeV2Month, readText, savedEvent, seedEvent, writeAssigneeSegment, writeText, V2_MONTH } from "./v2TestFixtures";

const DEAD = "zzzzz-ans-devz0000-sesz00.ndjson";
const loadLegacySeed = async () => ({ contentHash: "", items: [] });

function notFound(): Error {
  const error = new Error("gone");
  error.name = "NotFoundError";
  return error;
}

/** `DEAD` stays listed everywhere, but every open of it throws NotFoundError. */
function withDeadFile(dir: DirectoryHandleLike): DirectoryHandleLike {
  const wrap = (d: DirectoryHandleLike): DirectoryHandleLike =>
    new Proxy(d, {
      get(t, p, r) {
        if (p === "getDirectoryHandle") return async (n: string, o?: { create?: boolean }) => wrap(await t.getDirectoryHandle(n, o));
        if (p === "getFileHandle") return async (n: string, o?: { create?: boolean }) => { if (n === DEAD) throw notFound(); return t.getFileHandle(n, o); };
        const enumerable = t as DirectoryHandleLike & { values?: () => AsyncIterable<{ kind: string; name: string }> };
        if (p === "values" && typeof enumerable.values === "function") {
          return () => (async function* () {
            for await (const e of enumerable.values!()) {
              if (e.kind === "file" && e.name === DEAD) yield { ...e, getFile: async () => { throw notFound(); } };
              else yield e;
            }
          })();
        }
        return Reflect.get(t, p, r);
      },
    });
  return wrap(dir);
}

async function setup(name: string): Promise<{ raw: DirectoryHandleLike; root: DirectoryHandleLike }> {
  const raw = createMemoryDirectory(name) as unknown as DirectoryHandleLike;
  await makeV2Month(raw);
  await writeAssigneeSegment(raw, "emp1", "aaaaa-ans-deva0000-sesa00.ndjson", [seedEvent(), savedEvent("a0", 1)]);
  const archive = await getAssigneeArchiveDir(raw, V2_MONTH, "emp1", true);
  await writeText(archive, DEAD, encodeEventLine(savedEvent("lost", 2)));
  return { raw, root: withDeadFile(raw) };
}

describe("snapshot-persisting rebuilds read strictly (finding 1)", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    clearDeadSegmentRegistry();
    __resetCompactionRateLimitForTests();
  });

  it("rebuildAndPersistAssigneeSnapshot refuses and writes no snapshot when an archive segment cannot be opened", async () => {
    const { raw, root } = await setup("strict-rebuild");
    const error = await rebuildAndPersistAssigneeSnapshot(root, V2_MONTH, "emp1", { actor: "t", loadLegacySeed }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EventSegmentUnreadableError);
    const dir = await getAssigneeAnswerEventsDir(raw, V2_MONTH, "emp1", false);
    await expect(dir.getFileHandle("snapshot.json", { create: false })).rejects.toThrow();
  });

  it("compaction's full refold refuses and leaves the existing snapshot.json byte-identical", async () => {
    const { raw, root } = await setup("strict-compact");
    const dir = await getAssigneeAnswerEventsDir(raw, V2_MONTH, "emp1", false);
    await writeText(dir, "snapshot.json", "{corrupt");
    const error = await compactAssignee(root, V2_MONTH, "emp1", { actor: "emp1", loadLegacySeed, nowMs: Date.now() + 60 * 60_000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EventSegmentUnreadableError);
    expect(await readText(dir, "snapshot.json")).toBe("{corrupt");
  });
});
