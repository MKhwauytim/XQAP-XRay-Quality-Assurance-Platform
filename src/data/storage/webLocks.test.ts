import { afterEach, expect, test, vi } from "vitest";

import type { DirectoryHandleLike } from "./fileSystemAccess";
import { createMemoryDirectory } from "./memoryDirectory";
import { directoryPath, directoryResourceKey, withResourceLock, withTryResourceLock } from "./webLocks";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("same-resource calls run serially, never interleaved", async () => {
  const events: string[] = [];

  async function critical(tag: string): Promise<void> {
    await withResourceLock("res-a", async () => {
      events.push(`${tag}:start`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(`${tag}:end`);
    });
  }

  await Promise.all([critical("one"), critical("two")]);

  // Whichever runs first must fully finish before the other starts.
  expect(events).toEqual(
    events[0] === "one:start"
      ? ["one:start", "one:end", "two:start", "two:end"]
      : ["two:start", "two:end", "one:start", "one:end"]
  );
});

test("returns the callback result", async () => {
  const value = await withResourceLock("res-b", async () => 42);
  expect(value).toBe(42);
});

test("releases the lock even when the callback throws", async () => {
  await expect(
    withResourceLock("res-c", async () => {
      throw new Error("boom");
    })
  ).rejects.toThrow("boom");

  // Lock must be free now — a second acquire resolves.
  const after = await withResourceLock("res-c", async () => "ok");
  expect(after).toBe("ok");
});

test("native LockManager: delegates with the xray: name prefix and exclusive mode", async () => {
  const request = vi.fn(
    async (_name: string, _options: { mode: "exclusive" }, callback: () => Promise<unknown>) =>
      callback()
  );
  vi.stubGlobal("navigator", { locks: { request } });

  const value = await withResourceLock("res-native", async () => 7);

  expect(value).toBe(7);
  expect(request).toHaveBeenCalledTimes(1);
  const [name, options, callback] = request.mock.calls[0];
  expect(name).toBe("xray:res-native");
  expect(options).toEqual({ mode: "exclusive" });
  expect(typeof callback).toBe("function");
});

test("native LockManager: propagates exceptions from the callback", async () => {
  const request = vi.fn(
    async (_name: string, _options: { mode: "exclusive" }, callback: () => Promise<unknown>) =>
      callback()
  );
  vi.stubGlobal("navigator", { locks: { request } });

  await expect(
    withResourceLock("res-native-err", async () => {
      throw new Error("native boom");
    })
  ).rejects.toThrow("native boom");
});

test("registered directory paths keep same-named folders off one lock", async () => {
  const root = createMemoryDirectory("lock-root");
  const may = await (
    await (await root.getDirectoryHandle("2-samples", { create: true })).getDirectoryHandle(
      "5-May-2026",
      { create: true }
    )
  ).getDirectoryHandle("1-main", { create: true });
  const june = await (
    await (await root.getDirectoryHandle("2-samples", { create: true })).getDirectoryHandle(
      "6-June-2026",
      { create: true }
    )
  ).getDirectoryHandle("1-main", { create: true });

  const events: string[] = [];
  async function critical(dir: DirectoryHandleLike, tag: string): Promise<void> {
    await withResourceLock(directoryResourceKey(dir, "sample.master.json"), async () => {
      events.push(`${tag}:start`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(`${tag}:end`);
    });
  }

  await Promise.all([critical(may, "may"), critical(june, "june")]);

  // Both leaves are named "1-main": under the old `dir.name` key these two
  // months serialized against each other. They must now interleave.
  expect(events).toEqual(["may:start", "june:start", "may:end", "june:end"]);
});

test("two files in the same directory still get distinct keys", async () => {
  const dir = await createMemoryDirectory("k").getDirectoryHandle("1-main", { create: true });
  expect(directoryResourceKey(dir, "a.json")).not.toBe(directoryResourceKey(dir, "b.json"));
  expect(directoryPath(dir)).toBe("1-main");
});

test("withTryResourceLock: a second concurrent call for the same resource is skipped, not queued", async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = withTryResourceLock("try-res-a", async () => {
    events.push("first:start");
    await gate;
    events.push("first:end");
    return "first";
  });

  // Give the first call a tick to actually acquire the lock before the
  // second one tries -- otherwise both could race for it.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const second = await withTryResourceLock("try-res-a", async () => {
    events.push("second:ran"); // must never happen while the first is in flight
    return "second";
  });

  expect(second).toEqual({ ran: false });
  releaseFirst();
  expect(await first).toEqual({ ran: true, result: "first" });
  expect(events).toEqual(["first:start", "first:end"]);
});

test("withTryResourceLock: runs normally once the resource is free again", async () => {
  await withTryResourceLock("try-res-b", async () => "one");
  const second = await withTryResourceLock("try-res-b", async () => "two");
  expect(second).toEqual({ ran: true, result: "two" });
});

test("withTryResourceLock: a distinct resource name is never blocked by an unrelated held one", async () => {
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = withTryResourceLock("try-res-c", async () => {
    await gate;
    return "c";
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const other = await withTryResourceLock("try-res-d", async () => "d");
  expect(other).toEqual({ ran: true, result: "d" });

  releaseFirst();
  await first;
});
