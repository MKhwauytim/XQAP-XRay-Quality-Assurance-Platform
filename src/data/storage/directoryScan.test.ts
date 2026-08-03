import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "./memoryDirectory";
import { safeWriteJson } from "./safeWrite";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { listDirectoryEntries, readJsonDirectory, DIRECTORY_READ_CONCURRENCY } from "./directoryScan";

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
  it("reads every matching file and returns values in listing order, filtered by suffix", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson<Widget>(dir, "alice.widget.json", { id: "alice" });
    await safeWriteJson<Widget>(dir, "bob.widget.json", { id: "bob" });
    await safeWriteJson<Widget>(dir, "ignored.other.json", { id: "ignored" });

    const result = await readJsonDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip" });
    expect(result.values.map((w) => w.id).sort()).toEqual(["alice", "bob"]);
    expect(result.fileNames.sort()).toEqual(["alice.widget.json", "bob.widget.json"]);
    expect(result.matchedNames.sort()).toEqual(["alice.widget.json", "bob.widget.json"]);
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
});
