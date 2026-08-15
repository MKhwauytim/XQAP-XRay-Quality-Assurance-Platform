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

  it("copies a compressed file byte for byte", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson(dir, "population.final.json", population(4000));

    await copyFileBytes(dir, "population.final.json", dir, "copy.json");

    expect(await fileBytes(dir, "copy.json")).toEqual(
      await fileBytes(dir, "population.final.json")
    );
  });
});
