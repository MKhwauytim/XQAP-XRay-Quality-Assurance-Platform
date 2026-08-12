/* @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { createMemoryDirectory, getReadLog, clearReadLog } from "./memoryDirectory";
import { safeWriteJson } from "./safeWrite";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import {
  listDirectoryEntries,
  listDirectoryEntriesWithSize,
  readJsonDirectory,
  DIRECTORY_READ_CONCURRENCY,
  readAppendOnlyDirectory,
  resetAppendOnlyDirectoryCache,
  __appendOnlyCacheStatsForTests,
} from "./directoryScan";
import { broadcastDataRefresh } from "../workspace/dataRefreshSignal";

type Widget = { id: string };

async function writeRawFile(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const handle: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}

describe("listDirectoryEntries", () => {
  it("lists files and subdirectories", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "a.json", { id: "a" });
    await dir.getDirectoryHandle("subdir", { create: true });
    const entries = await listDirectoryEntries(dir);
    expect(entries.map((e) => e.name).sort()).toEqual(["a.json", "subdir"]);
    expect(entries.find((e) => e.name === "a.json")?.kind).toBe("file");
    expect(entries.find((e) => e.name === "subdir")?.kind).toBe("directory");
  });

  it("returns an empty array for an empty directory", async () => {
    const dir = createMemoryDirectory();
    expect(await listDirectoryEntries(dir)).toEqual([]);
  });
});

describe("readJsonDirectory", () => {
  it("reads every matching file and returns values in name-sorted order, filtered by suffix", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "alice.widget.json", { id: "alice" });
    await safeWriteJson<Widget>(dir, "bob.widget.json", { id: "bob" });
    await safeWriteJson<Widget>(dir, "ignored.other.json", { id: "ignored" });

    const result = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(result.values.map((w) => w.id).sort()).toEqual(["alice", "bob"]);
    expect(result.fileNames.sort()).toEqual(["alice.widget.json", "bob.widget.json"]);
    expect(result.matchedNames.sort()).toEqual(["alice.widget.json", "bob.widget.json"]);
  });

  it("returns success-path results in name-sorted order regardless of write order", async () => {
    const dir = createMemoryDirectory();
    // Written c, a, b -- result must come back a, b, c (name-sorted), not write order.
    await safeWriteJson<Widget>(dir, "c.widget.json", { id: "c" });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await safeWriteJson<Widget>(dir, "b.widget.json", { id: "b" });

    const result = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(result.values.map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(result.fileNames).toEqual(["a.widget.json", "b.widget.json", "c.widget.json"]);
  });

  it("returns fileNames index-aligned with values", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "only.widget.json", { id: "only" });
    const result = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(result.values[0]!.id).toBe("only");
    expect(result.fileNames[0]).toBe("only.widget.json");
  });

  it("skips an unreadable (corrupt) file when onUnreadable is 'skip'", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "good.widget.json", { id: "good" });
    await writeRawFile(dir, "bad.widget.json", "{not valid json");

    const result = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(result.values.map((w) => w.id)).toEqual(["good"]);
    expect(result.matchedNames.sort()).toEqual(["bad.widget.json", "good.widget.json"]);
  });

  it("throws with the configured message when onUnreadable is 'throw'", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "bad.widget.json", "{not valid json");

    await expect(
      readJsonDirectory<Widget>(dir, {
        suffix: ".widget.json",
        onUnreadable: "throw",
        unreadableError: (name) => `Cannot read widget: ${name}`,
      })
    ).rejects.toThrow("Cannot read widget: bad.widget.json");
  });

  it("throws for the LOWEST-index unreadable file when several are corrupt, deterministically", async () => {
    const dir = createMemoryDirectory();
    // Two corrupt files -- repeat the run to catch a race in which failure wins.
    await writeRawFile(dir, "b-bad.widget.json", "{bad2");
    await writeRawFile(dir, "a-bad.widget.json", "{bad1");
    await safeWriteJson<Widget>(dir, "c-good.widget.json", { id: "good" });

    for (let i = 0; i < 20; i++) {
      await expect(
        readJsonDirectory<Widget>(dir, {
          suffix: ".widget.json",
          onUnreadable: "throw",
          unreadableError: (name) => name,
        })
      ).rejects.toThrow("a-bad.widget.json");
    }
  });

  it("reports LOWEST-index failure even when higher-index errors settle first (delay-induced race)", async () => {
    const inner = createMemoryDirectory();
    // Three files: a-corrupt (index 0, slow), b-good (index 1), c-corrupt (index 2, fast).
    // If implementation was "first-to-settle-wins", it would report c-corrupt.
    // Correct implementation should report a-corrupt (lowest index).
    await writeRawFile(inner, "a-corrupt.widget.json", "{bad1");
    await safeWriteJson<Widget>(inner, "b-good.widget.json", { id: "good" });
    await writeRawFile(inner, "c-corrupt.widget.json", "{bad2");

    const tracked: DirectoryHandleLike = {
      ...inner,
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const handle = await inner.getFileHandle(name, options);
        return {
          ...handle,
          getFile: async () => {
            // a-corrupt (index 0) gets a long delay; c-corrupt (index 2) is fast.
            // This makes c-corrupt settle BEFORE a-corrupt, testing that we still
            // report the lower index.
            if (name === "a-corrupt.widget.json") {
              await new Promise((resolve) => setTimeout(resolve, 30));
            }
            return await handle.getFile();
          },
        };
      },
    };

    await expect(
      readJsonDirectory<Widget>(tracked, {
        suffix: ".widget.json",
        onUnreadable: "throw",
        unreadableError: (name) => name,
      })
    ).rejects.toThrow("a-corrupt.widget.json");
  });

  it("defaults to DIRECTORY_READ_CONCURRENCY and never exceeds it", async () => {
    const inner = createMemoryDirectory();
    for (let i = 0; i < 20; i++) {
      await safeWriteJson<Widget>(inner, `w${i}.widget.json`, { id: `w${i}` });
    }
    let current = 0;
    let peak = 0;
    const tracked: DirectoryHandleLike = {
      ...inner,
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const handle = await inner.getFileHandle(name, options);
        return {
          ...handle,
          getFile: async () => {
            current += 1;
            peak = Math.max(peak, current);
            await new Promise((resolve) => setTimeout(resolve, 5));
            try {
              return await handle.getFile();
            } finally {
              current -= 1;
            }
          },
        };
      },
    };

    await readJsonDirectory<Widget>(tracked, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(DIRECTORY_READ_CONCURRENCY);
  });

  it("respects an explicit concurrency override", async () => {
    const inner = createMemoryDirectory();
    for (let i = 0; i < 10; i++) {
      await safeWriteJson<Widget>(inner, `w${i}.widget.json`, { id: `w${i}` });
    }
    let current = 0;
    let peak = 0;
    const tracked: DirectoryHandleLike = {
      ...inner,
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const handle = await inner.getFileHandle(name, options);
        return {
          ...handle,
          getFile: async () => {
            current += 1;
            peak = Math.max(peak, current);
            await new Promise((resolve) => setTimeout(resolve, 5));
            try {
              return await handle.getFile();
            } finally {
              current -= 1;
            }
          },
        };
      },
    };

    await readJsonDirectory<Widget>(tracked, { suffix: ".widget.json", onUnreadable: "skip", concurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("clamps a zero or negative concurrency to 1 instead of silently returning an empty result", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "only.widget.json", { id: "only" });

    const zero = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", concurrency: 0 });
    expect(zero.values.map((w) => w.id)).toEqual(["only"]);

    const negative = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", concurrency: -3 });
    expect(negative.values.map((w) => w.id)).toEqual(["only"]);
  });
});

describe("readAppendOnlyDirectory (Task: incremental cache)", () => {
  it("cold read reads every matching file once", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await safeWriteJson<Widget>(dir, "b.widget.json", { id: "b" });

    clearReadLog(root);
    const result = await readAppendOnlyDirectory<Widget>(dir, {
      suffix: ".widget.json",
      onUnreadable: "skip",
      scope: { root, path: "events" },
    });
    expect(result.values.map((w) => w.id).sort()).toEqual(["a", "b"]);
    expect(getReadLog(root)).toHaveLength(2);
  });

  it("warm read with no new files performs zero file reads", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });

    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    clearReadLog(root);
    const result = await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(result.values.map((w) => w.id)).toEqual(["a"]);
    expect(getReadLog(root)).toHaveLength(0);
  });

  it("reads only the new file when one is added between calls", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });

    await safeWriteJson<Widget>(dir, "b.widget.json", { id: "b" });
    clearReadLog(root);
    const result = await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(result.values.map((w) => w.id).sort()).toEqual(["a", "b"]);
    expect(getReadLog(root)).toHaveLength(1);
  });

  it("full re-reads when a previously-seen file disappears (restore/rename)", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await safeWriteJson<Widget>(dir, "b.widget.json", { id: "b" });
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });

    await dir.removeEntry?.("a.widget.json");
    const before = __appendOnlyCacheStatsForTests().fullRereads;
    const result = await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(result.values.map((w) => w.id)).toEqual(["b"]);
    expect(__appendOnlyCacheStatsForTests().fullRereads).toBe(before + 1);
  });

  it("two different workspace roots with the same path never share cache entries", async () => {
    resetAppendOnlyDirectoryCache();
    const rootA = createMemoryDirectory("A");
    const rootB = createMemoryDirectory("B");
    const dirA = await rootA.getDirectoryHandle("events", { create: true });
    const dirB = await rootB.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dirA, "a.widget.json", { id: "only-in-a" });
    await safeWriteJson<Widget>(dirB, "b.widget.json", { id: "only-in-b" });

    const resultA = await readAppendOnlyDirectory<Widget>(dirA, { suffix: ".widget.json", onUnreadable: "skip", scope: { root: rootA, path: "events" } });
    const resultB = await readAppendOnlyDirectory<Widget>(dirB, { suffix: ".widget.json", onUnreadable: "skip", scope: { root: rootB, path: "events" } });
    expect(resultA.values.map((w) => w.id)).toEqual(["only-in-a"]);
    expect(resultB.values.map((w) => w.id)).toEqual(["only-in-b"]);
  });

  it("resetAppendOnlyDirectoryCache forces the next read to be a full re-read", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });

    resetAppendOnlyDirectoryCache(root);
    clearReadLog(root);
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(getReadLog(root)).toHaveLength(1);
  });

  it("resets the cache on a manual data-refresh broadcast but not a periodic one", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });

    broadcastDataRefresh("periodic");
    clearReadLog(root);
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(getReadLog(root)).toHaveLength(0);

    broadcastDataRefresh("manual");
    clearReadLog(root);
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(getReadLog(root)).toHaveLength(1);
  });
});

describe("listDirectoryEntriesWithSize (A7, F21's sized-listing helper)", () => {
  it("returns name and byte size for every matching file, sorted by name", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "b.answers.json", "0123456789"); // 10 bytes
    await writeRawFile(dir, "a.answers.json", "01"); // 2 bytes
    await dir.getDirectoryHandle("subdir", { create: true }); // must be ignored

    const sized = await listDirectoryEntriesWithSize(dir, ".answers.json");

    expect(sized).toEqual([
      { name: "a.answers.json", size: 2 },
      { name: "b.answers.json", size: 10 },
    ]);
  });

  it("detects a request appended into an EXISTING file via a larger size -- the case a name-only diff misses (F21)", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "alice.answers.json", "short");

    const before = await listDirectoryEntriesWithSize(dir, ".answers.json");
    expect(before).toEqual([{ name: "alice.answers.json", size: "short".length }]);

    // Same file NAME, more content appended -- a name-diff (listDirectoryEntries)
    // would report this tick as "nothing new".
    await writeRawFile(dir, "alice.answers.json", "a much longer body than before");

    const after = await listDirectoryEntriesWithSize(dir, ".answers.json");
    expect(after[0]?.size).toBeGreaterThan(before[0]?.size ?? 0);
  });

  it("returns an empty array when nothing matches the suffix", async () => {
    const dir = createMemoryDirectory();
    await writeRawFile(dir, "unrelated.txt", "x");
    expect(await listDirectoryEntriesWithSize(dir, ".answers.json")).toEqual([]);
  });

  it("costs exactly one getFileHandle/getFile round trip per matched file, no content read of unmatched files", async () => {
    const root = createMemoryDirectory("root", { trackReads: true });
    await writeRawFile(root, "a.answers.json", "aa");
    await writeRawFile(root, "b.answers.json", "bb");
    await writeRawFile(root, "ignored.txt", "zz");
    clearReadLog(root);

    const sized = await listDirectoryEntriesWithSize(root, ".answers.json");

    expect(sized).toHaveLength(2);
    // getFile() is what memoryDirectory's trackReads instruments -- exactly
    // one call per matched file, and the unmatched file is never touched.
    expect(getReadLog(root)).toHaveLength(2);
    expect(getReadLog(root).every((path) => path.endsWith(".answers.json"))).toBe(true);
  });
});
