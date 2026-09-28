import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "./fileSystemAccess";
import { parseSegmentName, readSegmentTails } from "./directoryScan";

const SUFFIX = ".ndjson";
const N0 = "ans-aaaaaaaa-11111a.ndjson";
const N1 = "ans-aaaaaaaa-11111a-1.ndjson";
const N2 = "ans-aaaaaaaa-11111a-2.ndjson";

/** In-memory events dir whose content can change between reads and whose getFile() calls are counted. */
function countingDir(initial: Record<string, string>) {
  const content = new Map(Object.entries(initial));
  const opened: string[] = [];
  const failing = new Set<string>();
  const handleFor = (name: string) => ({
    kind: "file" as const,
    name,
    async getFile(): Promise<File> {
      opened.push(name);
      if (failing.has(name)) throw new DOMException("locked", "NotReadableError");
      return new File([content.get(name) ?? ""], name);
    },
  });
  const dir = {
    kind: "directory",
    name: "answers.events",
    async getFileHandle(name: string) {
      if (!content.has(name)) throw new DOMException("missing", "NotFoundError");
      return handleFor(name);
    },
    async getDirectoryHandle() {
      throw new DOMException("missing", "NotFoundError");
    },
    async *values() {
      for (const name of [...content.keys()]) yield handleFor(name);
    },
  } as unknown as DirectoryHandleLike;
  return { dir, content, opened, failing };
}

/** One read that persists offsets + sealed set the way a caller (the answers cache) does. */
function reader(dir: DirectoryHandleLike) {
  let knownOffsets: Record<string, number> = {};
  let sealedConfirmed: ReadonlySet<string> = new Set();
  return async () => {
    const result = await readSegmentTails(dir, { suffix: SUFFIX, knownOffsets, sealedConfirmed });
    knownOffsets = { ...knownOffsets, ...Object.fromEntries(result.sizeByName) };
    sealedConfirmed = result.sealedConfirmedNames;
    return result;
  };
}

describe("parseSegmentName", () => {
  it("splits a chain base and sequence; seq 0 is the unsuffixed name", () => {
    expect(parseSegmentName(N0, SUFFIX)).toEqual({ base: "ans-aaaaaaaa-11111a", seq: 0 });
    expect(parseSegmentName(N2, SUFFIX)).toEqual({ base: "ans-aaaaaaaa-11111a", seq: 2 });
    expect(parseSegmentName("x.json", SUFFIX)).toBeNull();
  });
});

describe("readSegmentTails — sealed segments are not re-opened (S3)", () => {
  it("does not open a sealed-confirmed segment on the second and later reads", async () => {
    const { dir, opened } = countingDir({ [N0]: "a\n", [N1]: "b\n" });
    const read = reader(dir);

    const first = await read();
    expect(opened.filter((n) => n === N0)).toHaveLength(1);
    expect(first.tailTextByName.get(N0)).toBe("a\n");

    opened.length = 0;
    const second = await read();
    expect(opened).not.toContain(N0);
    expect(opened).toContain(N1); // the open (highest) segment is always probed
    // Known offset carried forward unchanged.
    expect(second.sizeByName.get(N0)).toBe(2);
    expect(second.tailTextByName.has(N0)).toBe(false);
    expect([...second.matchedNames].sort()).toEqual([N0, N1].sort());

    opened.length = 0;
    await read();
    expect(opened).not.toContain(N0);
  });

  it("lag: N+1 visible before N's last bytes — N's late bytes are still read once", async () => {
    const { dir, content, opened } = countingDir({ [N0]: "a\n" });
    const read = reader(dir);
    await read(); // N known at 2 bytes, no sibling yet -> not sealed

    // N grows AND N+1 appears between two reads: N was never confirmed sealed.
    content.set(N0, "a\nlate\n");
    content.set(N1, "b\n");
    opened.length = 0;
    const second = await read();
    expect(opened).toContain(N0);
    expect(second.tailTextByName.get(N0)).toBe("late\n");

    // Now it is confirmed: a further read skips it and never re-reads the late bytes.
    opened.length = 0;
    const third = await read();
    expect(opened).not.toContain(N0);
    expect(third.tailTextByName.has(N0)).toBe(false);
  });

  it("an unsealed (highest) segment that grows is still read", async () => {
    const { dir, content } = countingDir({ [N0]: "a\n", [N1]: "b\n" });
    const read = reader(dir);
    await read();
    await read();
    content.set(N1, "b\nc\n");
    const next = await read();
    expect(next.tailTextByName.get(N1)).toBe("c\n");
    expect(next.sizeByName.get(N1)).toBe(4);
  });

  it("digit-only session ids: adjacent sessions are not one chain; a rotated digit-only chain still is", async () => {
    // Two adjacent all-digit sessions of one device look like base-N names but
    // have no `ans-aaaaaaaa.ndjson` root, so they are not treated as a chain.
    const A = "ans-aaaaaaaa-123456.ndjson";
    const B = "ans-aaaaaaaa-123457.ndjson";
    const { dir, content, opened } = countingDir({ [A]: "a\n", [B]: "b\n" });
    const read = reader(dir);
    await read();
    await read();
    content.set(A, "a\nmore\n");
    opened.length = 0;
    const result = await read();
    expect(opened).toContain(A);
    expect(result.tailTextByName.get(A)).toBe("more\n");
  });

  it("an unreadable segment is still skip-logged, gets no offset, and is never marked sealed", async () => {
    const { dir, failing } = countingDir({ [N0]: "a\n", [N1]: "b\n" });
    failing.add(N0);
    const read = reader(dir);
    const first = await read();
    expect(first.sizeByName.has(N0)).toBe(false);
    expect(first.sealedConfirmedNames.has(N0)).toBe(false);
    expect(first.matchedNames).toContain(N0);
    failing.delete(N0);
    const second = await read();
    expect(second.tailTextByName.get(N0)).toBe("a\n");
  });

  it("a confirmed segment whose higher sibling disappears is read again", async () => {
    const { dir, content, opened } = countingDir({ [N0]: "a\n", [N1]: "b\n" });
    const read = reader(dir);
    await read();
    content.delete(N1);
    opened.length = 0;
    await read();
    expect(opened).toContain(N0);
  });
});

describe("readSegmentTails — digit-only session ids (S3)", () => {
  it("a rotated chain whose session id is all digits is still recognised and skipped", async () => {
    const R0 = "ans-aaaaaaaa-123456.ndjson";
    const R1 = "ans-aaaaaaaa-123456-1.ndjson";
    const { dir, opened } = countingDir({ [R0]: "a\n", [R1]: "b\n" });
    const read = reader(dir);
    await read();
    opened.length = 0;
    await read();
    expect(opened).not.toContain(R0);
    expect(opened).toContain(R1);
  });
});
