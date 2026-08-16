/**
 * The compressed storage path end to end: policy, framing, dual read, the
 * safety ladder, and the columnar round trip through a real file.
 *
 * These tests deliberately go through `safeWriteJson`/`safeReadJson` rather than
 * through `compressedEnvelope`/`columnarCodec` directly — those two have their
 * own unit tests, and what needed proving here is the WIRING: that a real
 * workspace write picks the format from the policy, that a real read finds it
 * again without being told, and that none of `.bak` → `.tmp` → verify → commit →
 * re-verify → rollback got weaker on the way.
 */
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import {
  copyFileBytes,
  readEnvelopeRevision,
  safeReadJson,
  safeWriteJson,
} from "./safeWrite";
import { COMPRESSED_FORMAT_ID, probeFileFormat } from "./compressedEnvelope";
import { PLAIN_JSON_POLICY, COMPRESS_MIN_ROWS } from "./storagePolicy";

type Row = {
  xrayImageId: string;
  portName: string;
  result: string;
  stage: string;
  risk: { level: string; score: number };
  notes?: string;
};

function rows(count: number): Row[] {
  const ports = ["ميناء جدة الإسلامي", "مطار الملك خالد", "جسر الملك فهد"];
  return Array.from({ length: count }, (_, i) => ({
    xrayImageId: `XR-${100000 + i}`,
    portName: ports[i % ports.length]!,
    result: i % 3 === 0 ? "مطابق" : "غير مطابق",
    stage: "المستوى الأول",
    risk: { level: i % 4 === 0 ? "أحمر" : "أخضر", score: i % 97 },
    ...(i % 5 === 0 ? { notes: `ملاحظة رقم ${i}` } : {}),
  }));
}

function population(count: number) {
  return {
    sourceMonthFolder: "5-may-2026",
    processedAt: "2026-05-01T00:00:00.000Z",
    totalRows: count,
    rows: rows(count),
  };
}

async function fileBytes(dir: DirectoryHandleLike, name: string): Promise<Uint8Array> {
  const handle = await dir.getFileHandle(name, { create: false });
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

async function exists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

/** Overwrites a file with raw bytes, bypassing every safety layer. */
async function clobber(dir: DirectoryHandleLike, name: string, bytes: Uint8Array): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await (writable as unknown as { write: (d: Uint8Array) => Promise<void> }).write(bytes);
  await writable.close();
}

describe("storage policy — what actually gets compressed", () => {
  it("compresses a large population.final.json and reads it back byte-identically", async () => {
    const dir = createMemoryDirectory();
    const payload = population(4000);

    await safeWriteJson(dir, "population.final.json", payload);

    const probe = await probeFileFormat(dir, "population.final.json");
    expect(probe.kind).toBe("compressed");
    if (probe.kind !== "compressed") return;
    expect(probe.head.format).toBe(COMPRESSED_FORMAT_ID);
    expect(probe.head.revision).toBe(1);

    const read = await safeReadJson<typeof payload>(dir, "population.final.json");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // Canonical identity, not merely deep equality: key order survives the
    // columnar round trip, so the payload re-serializes to the same bytes.
    expect(JSON.stringify(read.value)).toBe(JSON.stringify(payload));
  });

  it("is a large win on disk — the compressed file is a small fraction of the plain one", async () => {
    const compressed = createMemoryDirectory();
    const plain = createMemoryDirectory();
    const payload = population(4000);

    await safeWriteJson(compressed, "population.final.json", payload);
    await safeWriteJson(plain, "population.final.json", payload, { policy: PLAIN_JSON_POLICY });

    const compressedSize = (await fileBytes(compressed, "population.final.json")).byteLength;
    const plainSize = (await fileBytes(plain, "population.final.json")).byteLength;
    expect(compressedSize * 20).toBeLessThan(plainSize);
  });

  it("leaves a small payload of the same name as plain, inspectable JSON", async () => {
    const dir = createMemoryDirectory();
    const payload = population(COMPRESS_MIN_ROWS - 1);

    await safeWriteJson(dir, "population.final.json", payload);

    expect((await probeFileFormat(dir, "population.final.json")).kind).toBe("plain");
    const read = await safeReadJson<typeof payload>(dir, "population.final.json");
    expect(read.ok && JSON.stringify(read.value)).toBe(JSON.stringify(payload));
  });

  it("leaves a large payload whose file name is not in the policy table alone", async () => {
    const dir = createMemoryDirectory();
    const payload = population(4000);

    await safeWriteJson(dir, "answers.json", payload);

    expect((await probeFileFormat(dir, "answers.json")).kind).toBe("plain");
  });

  it("honours an explicit per-call policy in both directions", async () => {
    const dir = createMemoryDirectory();

    await safeWriteJson(dir, "population.final.json", population(4000), {
      policy: PLAIN_JSON_POLICY,
    });
    expect((await probeFileFormat(dir, "population.final.json")).kind).toBe("plain");

    await safeWriteJson(dir, "answers.json", population(4000), {
      policy: { compress: true, columnar: true },
    });
    expect((await probeFileFormat(dir, "answers.json")).kind).toBe("compressed");
  });

  it("still accepts a progress callback as the fourth argument", async () => {
    const dir = createMemoryDirectory();
    const phases: string[] = [];

    await safeWriteJson(dir, "population.final.json", population(4000), (phase) => {
      phases.push(phase);
    });

    expect(phases).toEqual(["staging", "verifying-staged", "committing", "verifying-committed"]);
  });
});

describe("dual read — permanent, automatic, both directions", () => {
  it("reads a legacy PLAIN file that the policy would compress today", async () => {
    const dir = createMemoryDirectory();
    const payload = population(4000);

    // Exactly what a workspace written before compression existed holds.
    await safeWriteJson(dir, "population.final.json", payload, { policy: PLAIN_JSON_POLICY });

    const read = await safeReadJson<typeof payload>(dir, "population.final.json");
    expect(read.ok && JSON.stringify(read.value)).toBe(JSON.stringify(payload));
  });

  it("keeps revision numbering and the .bak ladder across a compressed → plain transition", async () => {
    const dir = createMemoryDirectory();

    await safeWriteJson(dir, "population.final.json", population(4000));
    // The same month re-saved smaller: below the size gate it goes back to plain
    // JSON, over a live file that is compressed.
    await safeWriteJson(dir, "population.final.json", population(10));

    expect((await probeFileFormat(dir, "population.final.json")).kind).toBe("plain");
    // Revision continued rather than restarting at 1 …
    expect(await readEnvelopeRevision(dir, "population.final.json")).toBe(2);
    // … and the compressed predecessor was snapshotted as BYTES, so it is still
    // a readable compressed file rather than a mojibake text copy.
    expect((await probeFileFormat(dir, "population.final.json.bak")).kind).toBe("compressed");
    expect(await readEnvelopeRevision(dir, "population.final.json.bak")).toBe(1);
  });

  it("keeps revision numbering across a plain → compressed transition", async () => {
    const dir = createMemoryDirectory();

    await safeWriteJson(dir, "population.final.json", population(10));
    await safeWriteJson(dir, "population.final.json", population(4000));

    expect((await probeFileFormat(dir, "population.final.json")).kind).toBe("compressed");
    expect(await readEnvelopeRevision(dir, "population.final.json")).toBe(2);
    expect((await probeFileFormat(dir, "population.final.json.bak")).kind).toBe("plain");
  });

  it("reads the revision of a compressed file from its head line alone", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson(dir, "sample.master.json", { rows: rows(3000) });
    await safeWriteJson(dir, "sample.master.json", { rows: rows(3000) });

    expect(await readEnvelopeRevision(dir, "sample.master.json")).toBe(2);
  });
});

describe("safety ladder", () => {
  it("recovers from .bak when the live compressed body is damaged", async () => {
    const dir = createMemoryDirectory();
    const first = population(4000);
    await safeWriteJson(dir, "population.final.json", first);
    await safeWriteJson(dir, "population.final.json", population(2500));

    // Truncate the gzip member of the live file: gzip's CRC32/ISIZE trailer is
    // gone, so this MUST be detected rather than yielding a short body.
    const live = await fileBytes(dir, "population.final.json");
    await clobber(dir, "population.final.json", live.subarray(0, live.byteLength - 40));

    const read = await safeReadJson<typeof first>(dir, "population.final.json");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.recoveredFromBak).toBe(true);
    expect(JSON.stringify(read.value)).toBe(JSON.stringify(first));
  });

  it("reports a damaged compressed file with no snapshot as corrupt, not missing", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson(dir, "population.final.json", population(4000));

    const live = await fileBytes(dir, "population.final.json");
    // Flip a byte in the middle of the compressed body.
    const damaged = live.slice();
    damaged[Math.floor(damaged.byteLength / 2)] ^= 0xff;
    await clobber(dir, "population.final.json", damaged);

    const read = await safeReadJson(dir, "population.final.json");
    expect(read).toEqual({ ok: false, reason: "corrupt" });
  });

  it("rolls the live file back when the committed bytes do not verify", async () => {
    const base = createMemoryDirectory();
    const good = population(4000);
    await safeWriteJson(base, "population.final.json", good);

    // Corrupt only the LIVE commit (the .tmp still stages honestly), which is
    // what the post-commit verification exists to catch.
    let stagedOnce = false;
    const flaky: DirectoryHandleLike = {
      ...base,
      getFileHandle: async (name, options) => {
        const handle = await base.getFileHandle(name, options);
        if (name !== "population.final.json" || !handle.createWritable) return handle;
        if (!stagedOnce) {
          stagedOnce = true;
          return handle;
        }
        return {
          ...handle,
          createWritable: async () => {
            const writable = await handle.createWritable!();
            const wide = writable as unknown as { write: (d: Uint8Array) => Promise<void> };
            let first = true;
            return {
              write: async (data: Uint8Array) => {
                const bytes = first ? data.slice(0, Math.max(0, data.byteLength - 1)) : data;
                first = false;
                await wide.write(bytes);
              },
              close: () => writable.close(),
            } as unknown as Awaited<ReturnType<NonNullable<typeof handle.createWritable>>>;
          },
        };
      },
    };

    await expect(safeWriteJson(flaky, "population.final.json", population(2500))).rejects.toThrow(
      /rolled back to previous version/
    );

    // The live file is the previous good revision, intact and still readable.
    const read = await safeReadJson<typeof good>(base, "population.final.json");
    expect(read.ok && JSON.stringify(read.value)).toBe(JSON.stringify(good));
    expect(await exists(base, "population.final.json.tmp")).toBe(false);
  });

  /**
   * Regression (P1). `writeCompressedFile` writes the head line in its own
   * `write()` call before any body byte exists, so a write that dies in between
   * leaves a file that is exactly its head line. That file must never be served
   * as a successful read — the head is a JSON object, and treating it as "plain"
   * hands the METADATA to the caller as if it were the payload, silently
   * bypassing the `.bak` ladder. Bodies of 1–3 bytes pin the boundary.
   */
  it("treats a compressed file truncated to its head line as corrupt, at every body length 0–3", async () => {
    for (const bodyBytes of [0, 1, 2, 3]) {
      const dir = createMemoryDirectory();
      await safeWriteJson(dir, "population.final.json", population(4000));
      const whole = await fileBytes(dir, "population.final.json");
      // Strip the recovery rungs so the LIVE read alone is what is observed.
      await dir.removeEntry?.("population.final.json.bak").catch(() => {});
      await dir.removeEntry?.("population.final.json.tmp").catch(() => {});
      const headEnd = whole.indexOf(0x0a) + 1;
      await clobber(dir, "population.final.json", whole.subarray(0, headEnd + bodyBytes));

      const read = await safeReadJson(dir, "population.final.json");
      expect(read, `body=${bodyBytes}`).toEqual({ ok: false, reason: "corrupt" });
    }
  });

  it("recovers a head-only compressed file from its .bak instead of serving the head metadata", async () => {
    const dir = createMemoryDirectory();
    const first = population(4000);
    await safeWriteJson(dir, "population.final.json", first);
    await safeWriteJson(dir, "population.final.json", population(2500));

    const whole = await fileBytes(dir, "population.final.json");
    await clobber(dir, "population.final.json", whole.subarray(0, whole.indexOf(0x0a) + 1));

    const read = await safeReadJson<typeof first>(dir, "population.final.json");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.recoveredFromBak).toBe(true);
    expect(JSON.stringify(read.value)).toBe(JSON.stringify(first));
  });

  /**
   * Regression (P3a). The `.bak` snapshot is the last recoverable revision. The
   * compressed write path decided whether one was worth taking from the head
   * line's FRAMING alone, so a live file whose gzip body was damaged still
   * counted as "current" and was byte-copied over a perfectly good `.bak`. The
   * plain path has always refused (it parses the whole file first).
   */
  it.each([
    // The next save is itself compressed (writeCompressedJson's own snapshot) …
    ["compressed", 4000],
    // … or has dropped below the size gate and goes out as plain JSON, whose
    // snapshot decision recognized the compressed live file the same
    // framing-only way.
    ["plain", COMPRESS_MIN_ROWS - 200],
  ] as const)(
    "does not overwrite a good .bak with a damaged compressed live file (next save: %s)",
    async (_label, nextRows) => {
      const dir = createMemoryDirectory();
      const first = population(4000);
      await safeWriteJson(dir, "population.final.json", first);
      await safeWriteJson(dir, "population.final.json", population(2500)); // .bak = revision 1

      // Flip one byte well past the 3-byte gzip magic: the framing still reads
      // as compressed, but the member no longer inflates.
      const live = await fileBytes(dir, "population.final.json");
      const damaged = live.slice();
      const headEnd = damaged.indexOf(0x0a) + 1;
      damaged[headEnd + 12] ^= 0xff;
      await clobber(dir, "population.final.json", damaged);
      expect(await safeReadJson(dir, "population.final.json")).toMatchObject({
        recoveredFromBak: true, // the .bak is the ONLY readable copy right now
      });

      await safeWriteJson(dir, "population.final.json", population(nextRows));

      // The last good revision must still be recoverable from the snapshot.
      const bak = await safeReadJson<typeof first>(dir, "population.final.json.bak");
      expect(bak.ok).toBe(true);
      expect(bak.ok && JSON.stringify(bak.value)).toBe(JSON.stringify(first));
    }
  );

  /**
   * Regression (P3b). A bare, un-enveloped JSON file is a shape the reader
   * explicitly tolerates (`unwrap` passes it through). `readEnvelopeMetadata`
   * finds no metadata in it, which the compressed path read as "nothing to back
   * up" — so the first compressed save over such a file took no `.bak` at all,
   * and a failed commit destroyed the only copy.
   */
  it("snapshots a bare legacy un-enveloped file before the first compressed save over it", async () => {
    const base = createMemoryDirectory();
    const legacy = { ...population(4000), tag: "legacy" };
    await clobber(
      base,
      "population.final.json",
      new TextEncoder().encode(JSON.stringify(legacy))
    );

    // Every write to the live name after staging lands corrupted, so the commit
    // and the promotion retry both fail and only a `.bak` can save the payload.
    let stagedOnce = false;
    const flaky: DirectoryHandleLike = {
      ...base,
      getFileHandle: async (name, options) => {
        const handle = await base.getFileHandle(name, options);
        if (name !== "population.final.json" || !handle.createWritable) return handle;
        if (!stagedOnce) {
          stagedOnce = true;
          return handle;
        }
        return {
          ...handle,
          createWritable: async () => {
            const writable = await handle.createWritable!();
            const wide = writable as unknown as { write: (d: Uint8Array) => Promise<void> };
            let first = true;
            return {
              write: async (data: Uint8Array) => {
                const bytes = first ? data.slice(0, Math.max(0, data.byteLength - 1)) : data;
                first = false;
                await wide.write(bytes);
              },
              close: () => writable.close(),
            } as unknown as Awaited<ReturnType<NonNullable<typeof handle.createWritable>>>;
          },
        };
      },
    };

    await expect(
      safeWriteJson(flaky, "population.final.json", population(2500))
    ).rejects.toThrow();

    // The legacy payload survives: rolled back into place, or at worst still
    // readable through the snapshot ladder.
    const read = await safeReadJson<typeof legacy>(base, "population.final.json");
    expect(read.ok).toBe(true);
    expect(read.ok && read.value.tag).toBe("legacy");
    expect(read.ok && JSON.stringify(read.value)).toBe(JSON.stringify(legacy));
  });

  it("copies a compressed file byte for byte", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson(dir, "population.final.json", population(4000));

    await copyFileBytes(dir, "population.final.json", dir, "copy.json");

    expect(await fileBytes(dir, "copy.json")).toEqual(
      await fileBytes(dir, "population.final.json")
    );
  });
});
