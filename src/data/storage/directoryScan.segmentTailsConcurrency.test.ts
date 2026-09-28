import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "./fileSystemAccess";
import { DIRECTORY_READ_CONCURRENCY, readSegmentTails } from "./directoryScan";

/** A directory whose every `getFile()` takes 20 ms and records how many overlap. */
function slowDirectory(names: string[]): { dir: DirectoryHandleLike; maxInFlight: () => number } {
  let inFlight = 0;
  let maxInFlight = 0;
  const files = names.map((name) => ({
    kind: "file" as const,
    name,
    async getFile(): Promise<File> {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return new File([`${name}\n`], name);
    },
  }));
  const dir = {
    kind: "directory",
    name: "answers.events",
    async getFileHandle(name: string) {
      const file = files.find((candidate) => candidate.name === name);
      if (!file) throw new DOMException("missing", "NotFoundError");
      return file;
    },
    async getDirectoryHandle() {
      throw new DOMException("missing", "NotFoundError");
    },
    async *values() {
      yield* files;
    },
  } as unknown as DirectoryHandleLike;
  return { dir, maxInFlight: () => maxInFlight };
}

describe("readSegmentTails — bounded concurrency (A1)", () => {
  it("reads segments in parallel, up to the shared concurrency cap, with unchanged output", async () => {
    const names = Array.from({ length: 16 }, (_, i) => `seg-${String(i).padStart(2, "0")}.ndjson`).reverse();
    const { dir, maxInFlight } = slowDirectory(names);

    const result = await readSegmentTails(dir, { suffix: ".ndjson", knownOffsets: {} });

    expect(maxInFlight()).toBeGreaterThan(1);
    expect(maxInFlight()).toBeLessThanOrEqual(DIRECTORY_READ_CONCURRENCY);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(result.matchedNames).toEqual(sorted);
    expect([...result.tailTextByName.keys()]).toEqual(sorted);
    expect(result.tailTextByName.get("seg-03.ndjson")).toBe("seg-03.ndjson\n");
    expect(result.sizeByName.get("seg-03.ndjson")).toBe("seg-03.ndjson\n".length);
  });
});
