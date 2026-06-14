import { expect, test } from "vitest";

import { withResourceLock } from "./webLocks";

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
