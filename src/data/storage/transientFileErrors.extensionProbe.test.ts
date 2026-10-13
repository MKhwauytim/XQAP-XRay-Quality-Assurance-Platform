import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { classifyNotFound } from "./transientFileErrors";

/** Files whose name satisfies `vanish` disappear right after close(). */
function withVanishing(dir: DirectoryHandleLike, vanish: (name: string) => boolean): DirectoryHandleLike {
  return new Proxy(dir, {
    get(target, prop, recv) {
      if (prop !== "getFileHandle") return Reflect.get(target, prop, recv);
      return async (name: string, opts?: { create?: boolean }) => {
        const handle = await target.getFileHandle(name, opts);
        if (!vanish(name) || !handle.createWritable) return handle;
        const origCw = handle.createWritable.bind(handle);
        return {
          ...handle,
          getFile: handle.getFile.bind(handle),
          createWritable: async () => {
            const w = await origCw();
            return {
              write: w.write.bind(w),
              close: async () => {
                await w.close();
                await target.removeEntry?.(name);
              },
            };
          },
        };
      };
    },
  });
}

describe("classifyNotFound: extension verdict needs two names", () => {
  it("one vanishing probe name, sibling survives → falls through; short name (no length probe) → 'unknown'", async () => {
    const root = createMemoryDirectory("probe1") as unknown as DirectoryHandleLike;
    const dir = withVanishing(root, (n) => n === ".fs-extension-probe-a.ndjson");
    // 21 chars: below the length-probe threshold, so the fallthrough ends at 'unknown'.
    expect(await classifyNotFound(dir, "x-ans-dev-sess.ndjson")).toBe("unknown");
  }, 15_000);

  it("one vanishing probe name, sibling survives, ≥24-char name whose length probe fails → 'name-too-long'", async () => {
    const root = createMemoryDirectory("probe1b") as unknown as DirectoryHandleLike;
    const dir = withVanishing(
      root,
      (n) => n === ".fs-extension-probe-a.ndjson" || n.startsWith(".fs-len-probe")
    );
    const longName = "x-ans-device-01-session-0001.ndjson";
    expect(longName.length).toBeGreaterThanOrEqual(24);
    expect(await classifyNotFound(dir, longName)).toBe("name-too-long");
  }, 15_000);

  it("both probe names vanish → 'extension-blocked'", async () => {
    const root = createMemoryDirectory("probe2") as unknown as DirectoryHandleLike;
    const dir = withVanishing(root, (n) => n.startsWith(".fs-extension-probe") && n.endsWith(".ndjson"));
    expect(await classifyNotFound(dir, "x-ans-dev-sess.ndjson")).toBe("extension-blocked");
  }, 15_000);

  it("nothing vanishes → not extension-blocked", async () => {
    const root = createMemoryDirectory("probe3") as unknown as DirectoryHandleLike;
    expect(await classifyNotFound(root, "x-ans-dev-sess.ndjson")).not.toBe("extension-blocked");
  }, 15_000);
});
