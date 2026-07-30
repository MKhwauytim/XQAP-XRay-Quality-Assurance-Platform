import { afterEach, expect, test, vi } from "vitest";

import { withResourceLock } from "./webLocks";

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
