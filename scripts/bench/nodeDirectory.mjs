// Node-fs implementation of the app's DirectoryHandleLike / FileHandleLike
// contract (see src/data/storage/fileSystemAccess.ts for the type definitions,
// and src/data/storage/memoryDirectory.ts for the in-memory test double this
// mirrors). Used ONLY by the scripts under scripts/bench/ to run the app's
// real storage layer (safeWriteJson/safeReadJson/directoryScan/...) against a
// real folder on disk, so the benchmark measures the app's actual read/write
// code paths instead of a reimplementation of them.
//
// IMPORTANT — see the top-level bench README note repeated in every script's
// output: this adapter talks to node:fs/promises directly. It does NOT and
// CANNOT reproduce Chromium's File System Access per-file swap/verify pipeline
// (every real createWritable() commit in the browser is routed through a
// swap-file + OS-level verification step that node:fs has no equivalent for).
// So this harness faithfully measures file COUNT and fold COST, but its
// absolute wall-clock write timings are NOT representative of what a user
// experiences in Chrome/Edge. Don't read them as a browser prediction.

import { promises as fs } from "node:fs";
import path from "node:path";

/** Fresh, zero-initialized operation counter bag. Pass the same object to every
 *  createNodeDirectory() call in a run to get a single running total. */
export function createOpCounters() {
  return {
    getFileHandle: 0,
    getDirectoryHandle: 0,
    getFileHandleCreate: 0,
    getDirectoryHandleCreate: 0,
    getFile: 0,
    createWritable: 0,
    write: 0,
    close: 0,
    removeEntry: 0,
    values: 0,
  };
}

export function resetOpCounters(counters) {
  for (const key of Object.keys(counters)) counters[key] = 0;
}

export function totalOps(counters) {
  // "close" double-counts the write commit already counted by createWritable/
  // write; total file-system-relevant calls is everything except the derived
  // *Create sub-counts (which are subsets of getFileHandle/getDirectoryHandle).
  return (
    counters.getFileHandle +
    counters.getDirectoryHandle +
    counters.getFile +
    counters.createWritable +
    counters.write +
    counters.close +
    counters.removeEntry +
    counters.values
  );
}

function notFound(name) {
  const error = new Error(`Not found: ${name}`);
  error.name = "NotFoundError";
  return error;
}

/**
 * Build a DirectoryHandleLike rooted at `dirPath` on the real filesystem.
 * `counters` is optional — pass one from createOpCounters() to observe the
 * exact number of underlying handle/read/write operations the storage layer
 * performs, which is the headline metric for this benchmark (see
 * bench-distribution.mjs): the real production bottleneck is per-file
 * overhead, not bytes.
 */
export function createNodeDirectory(dirPath, counters = createOpCounters()) {
  return makeDir(dirPath, path.basename(dirPath) || dirPath, counters);
}

function makeDir(dirPath, name, counters) {
  const handle = {
    kind: "directory",
    name,

    async getFileHandle(fileName, options = {}) {
      counters.getFileHandle += 1;
      const filePath = path.join(dirPath, fileName);
      if (options.create) {
        counters.getFileHandleCreate += 1;
        await fs.mkdir(dirPath, { recursive: true });
        try {
          await fs.access(filePath);
        } catch {
          await fs.writeFile(filePath, "");
        }
      } else {
        try {
          const st = await fs.stat(filePath);
          if (!st.isFile()) throw notFound(fileName);
        } catch (err) {
          if (err && err.code === "ENOENT") throw notFound(fileName);
          if (err && err.name === "NotFoundError") throw err;
          throw err;
        }
      }
      return makeFile(filePath, fileName, counters);
    },

    async getDirectoryHandle(dirName, options = {}) {
      counters.getDirectoryHandle += 1;
      const subPath = path.join(dirPath, dirName);
      if (options.create) {
        counters.getDirectoryHandleCreate += 1;
        await fs.mkdir(subPath, { recursive: true });
      } else {
        const st = await fs.stat(subPath).catch(() => null);
        if (!st || !st.isDirectory()) throw notFound(dirName);
      }
      return makeDir(subPath, dirName, counters);
    },

    async removeEntry(entryName, options = {}) {
      counters.removeEntry += 1;
      const entryPath = path.join(dirPath, entryName);
      try {
        await fs.rm(entryPath, { recursive: !!options.recursive, force: false });
      } catch (err) {
        if (err && err.code === "ENOENT") throw notFound(entryName);
        throw err;
      }
    },

    async queryPermission() {
      return "granted";
    },
    async requestPermission() {
      return "granted";
    },

    // Async iteration support (directoryScan.ts's rawEntries() looks for this
    // first, matching the real File System Access API and memoryDirectory.ts).
    async *values() {
      counters.values += 1;
      let entries;
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch (err) {
        if (err && err.code === "ENOENT") return;
        throw err;
      }
      for (const entry of entries) {
        // Skip our own harness's temp/lock-adjacent files? No — none expected;
        // dotfiles from OS (e.g. desktop.ini) would appear as ordinary files,
        // matching real-world workspace folders that also accumulate OS cruft.
        yield { name: entry.name, kind: entry.isDirectory() ? "directory" : "file" };
      }
    },
  };
  return handle;
}

function makeFile(filePath, name, counters) {
  return {
    kind: "file",
    name,

    async getFile() {
      counters.getFile += 1;
      let buf;
      try {
        buf = await fs.readFile(filePath);
      } catch (err) {
        if (err && err.code === "ENOENT") throw notFound(name);
        throw err;
      }
      // Use the real global File/Blob (Node 20+) rather than a hand-rolled
      // object: File extends Blob, which gives .text()/.arrayBuffer()/
      // .slice()/.size/.stream() for free with real Blob.slice() semantics —
      // matching what directoryScan.ts's readSegmentTails() (and anything
      // else added to the storage layer later) actually calls on a real
      // FileSystemFileHandle.getFile() result, without this adapter having
      // to track the growing set of Blob members by hand.
      return new File([buf], name, { type: "application/octet-stream" });
    },

    async createWritable() {
      counters.createWritable += 1;
      const chunks = [];
      return {
        async write(data) {
          counters.write += 1;
          if (typeof data === "string") {
            chunks.push(Buffer.from(data, "utf8"));
          } else if (Buffer.isBuffer(data)) {
            chunks.push(data);
          } else if (data instanceof ArrayBuffer) {
            chunks.push(Buffer.from(data));
          } else if (ArrayBuffer.isView(data)) {
            chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
          } else {
            chunks.push(Buffer.from(String(data), "utf8"));
          }
        },
        async close() {
          counters.close += 1;
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, Buffer.concat(chunks));
        },
      };
    },
  };
}

/** Recursively count files and total bytes under a real directory path
 *  (not through the counted adapter — this is a post-hoc disk-usage report,
 *  not part of the operation-count metric). */
export async function scanDiskUsage(rootPath) {
  let fileCount = 0;
  let totalBytes = 0;
  let dirCount = 0;

  async function walk(dirPath) {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        dirCount += 1;
        await walk(full);
      } else if (entry.isFile()) {
        fileCount += 1;
        const st = await fs.stat(full);
        totalBytes += st.size;
      }
    }
  }

  await walk(rootPath);
  return { fileCount, dirCount, totalBytes };
}
