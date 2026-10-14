// src/data/storage/moveFileVerified.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { moveFileVerified } from "./moveFileVerified";

async function write(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable!();
  await w.write(text);
  await w.close();
}
async function exists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

describe("moveFileVerified", () => {
  it("round 6: a stale-snapshot InvalidStateError on the copy read-back is re-opened, not a failed move", async () => {
    const root = createMemoryDirectory("mv-stale");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "line1\n");
    setSimulatedFaults(root, [{ operation: "readFile", name: "a.ndjson", errorName: "InvalidStateError", rearmAfterClose: true, times: 1 }]);
    expect(await moveFileVerified(src, "a.ndjson", dst, 6)).toEqual({ status: "moved", via: "copy" });
  });

  it("round 6: a copy that keeps throwing leaves the source in place as kept/copy-failed instead of throwing", async () => {
    const root = createMemoryDirectory("mv-throw");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "line1\n");
    setSimulatedFaults(root, [{ operation: "readFile", name: "a.ndjson", errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY }]);
    const outcome = await moveFileVerified(src, "a.ndjson", dst, 6);
    expect(outcome).toMatchObject({ status: "kept", reason: "copy-failed" });
    setSimulatedFaults(root, []);
    expect(await (await (await src.getFileHandle("a.ndjson")).getFile()).text()).toBe("line1\n");
  }, 20_000);

  it("copy fallback: target byte-identical, source removed", async () => {
    const root = createMemoryDirectory("mv1");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "line1\nline2\n");
    expect(await moveFileVerified(src, "a.ndjson", dst, 12)).toEqual({ status: "moved", via: "copy" });
    expect(await exists(src, "a.ndjson")).toBe(false);
    expect(await (await (await dst.getFileHandle("a.ndjson")).getFile()).text()).toBe("line1\nline2\n");
  });

  it("a file that grew since it was read is kept (never moved with unread bytes)", async () => {
    const root = createMemoryDirectory("mv2");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "line1\nline2\nline3\n");
    expect(await moveFileVerified(src, "a.ndjson", dst, 12)).toMatchObject({ status: "kept", reason: "changed" });
    expect(await exists(dst, "a.ndjson")).toBe(false);
  });

  it("a remove the share refuses leaves the original live and the copy archived", async () => {
    const root = createMemoryDirectory("mv3");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "x\n");
    setSimulatedFaults(root, [{ operation: "removeEntry", name: "a.ndjson", errorName: "NoModificationAllowedError", times: 1_000 }]);
    expect(await moveFileVerified(src, "a.ndjson", dst, 2)).toMatchObject({ status: "kept", reason: "remove-failed" });
    expect(await exists(src, "a.ndjson")).toBe(true);
    expect(await exists(dst, "a.ndjson")).toBe(true);
  }, 30_000);

  it("uses handle.move when the platform provides it", async () => {
    const root = createMemoryDirectory("mv4");
    const src = await root.getDirectoryHandle("src", { create: true });
    const dst = await root.getDirectoryHandle("dst", { create: true });
    await write(src, "a.ndjson", "x\n");
    const withMove: DirectoryHandleLike = new Proxy(src, {
      get(target, prop, recv) {
        if (prop !== "getFileHandle") return Reflect.get(target, prop, recv);
        return async (name: string, opts?: { create?: boolean }) => {
          const handle = await target.getFileHandle(name, opts);
          const moved: FileHandleLike = {
            ...handle,
            getFile: handle.getFile.bind(handle),
            createWritable: handle.createWritable?.bind(handle),
            move: async (destination: DirectoryHandleLike) => {
              await write(destination, name, await (await handle.getFile()).text());
              await target.removeEntry!(name);
            },
          };
          return moved;
        };
      },
    });
    expect(await moveFileVerified(withMove, "a.ndjson", dst, 2)).toEqual({ status: "moved", via: "move" });
    expect(await exists(src, "a.ndjson")).toBe(false);
  });
});
