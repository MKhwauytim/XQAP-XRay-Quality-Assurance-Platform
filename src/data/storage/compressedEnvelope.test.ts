import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { createSimpleHasher, wrap } from "./jsonEnvelope";
import {
  COMPRESSED_FORMAT_ID,
  CompressedReadError,
  HEAD_PROBE_BYTES,
  classifyHeadWindow,
  isCompressionSupported,
  probeFileFormat,
  readCompressedHead,
  readEnvelopeMetadata,
  readFileText,
  streamFileText,
  writeCompressedFile,
} from "./compressedEnvelope";

/* ────────────────────────────────────────────────────────────────────────────
 * A disk-backed DirectoryHandleLike.
 *
 * `createMemoryDirectory()` cannot be used here for two reasons: it stores file
 * content as a JS string (this module writes BYTES), and its `getFile()`
 * materializes the whole file, which would make the "metadata read is O(1) in
 * file size" measurement meaningless. This double reads lazily through
 * positional `fs.readSync`, exactly as a browser's `Blob.slice()` does, and
 * accepts both strings and BufferSources on the writable — the behaviour of a
 * real `FileSystemWritableFileStream`.
 * ──────────────────────────────────────────────────────────────────────────── */

function notFound(name: string): Error {
  const error = new Error(`Not found: ${name}`);
  error.name = "NotFoundError";
  return error;
}

function makeBlobLike(filePath: string, start: number, end: number): Blob {
  return {
    size: Math.max(0, end - start),
    arrayBuffer: async () => {
      const length = Math.max(0, end - start);
      const buffer = Buffer.allocUnsafe(length);
      if (length === 0) return buffer.buffer.slice(0, 0);
      const fd = fs.openSync(filePath, "r");
      try {
        const read = fs.readSync(fd, buffer, 0, length, start);
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + read);
      } finally {
        fs.closeSync(fd);
      }
    },
  } as unknown as Blob;
}

function makeDiskFileHandle(filePath: string, name: string): FileHandleLike {
  return {
    kind: "file",
    name,
    getFile: async () => {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        throw notFound(name);
      }
      const size = stat.size;
      return {
        name,
        size,
        lastModified: stat.mtimeMs,
        slice: (start?: number, end?: number) =>
          makeBlobLike(filePath, start ?? 0, end ?? size),
        arrayBuffer: async () => makeBlobLike(filePath, 0, size).arrayBuffer(),
        text: async () => fs.readFileSync(filePath, "utf8"),
      } as unknown as File;
    },
    createWritable: async () => {
      const tmp = `${filePath}.__w${Math.random().toString(36).slice(2)}`;
      const stream = fs.createWriteStream(tmp);
      return {
        write: async (data: string) => {
          const chunk: string | Uint8Array =
            typeof data === "string"
              ? data
              : ArrayBuffer.isView(data as unknown as ArrayBufferView)
                ? new Uint8Array(
                    (data as unknown as ArrayBufferView).buffer,
                    (data as unknown as ArrayBufferView).byteOffset,
                    (data as unknown as ArrayBufferView).byteLength
                  )
                : new Uint8Array(data as unknown as ArrayBuffer);
          await new Promise<void>((resolve, reject) => {
            stream.write(chunk, (error) => (error ? reject(error) : resolve()));
          });
        },
        close: async () => {
          await new Promise<void>((resolve) => stream.end(resolve));
          fs.renameSync(tmp, filePath);
        },
      };
    },
  };
}

function createDiskDirectory(root: string): DirectoryHandleLike {
  fs.mkdirSync(root, { recursive: true });
  return {
    kind: "directory",
    name: path.basename(root),
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      const filePath = path.join(root, name);
      if (!fs.existsSync(filePath) && !options?.create) throw notFound(name);
      return makeDiskFileHandle(filePath, name);
    },
    getDirectoryHandle: async (name: string) => createDiskDirectory(path.join(root, name)),
    removeEntry: async (name: string) => {
      await fsp.rm(path.join(root, name), { force: true });
    },
  };
}

let root = "";
let dir: DirectoryHandleLike;

beforeAll(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "xqap-compressed-"));
  dir = createDiskDirectory(root);
});

afterAll(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

const META = {
  schemaVersion: 1,
  revision: 7,
  contentHash: "deadbeef",
  writtenAt: "2026-08-15T00:00:00.000Z",
  _writeToken: "11111111-2222-3333-4444-555555555555",
};

function hashOf(text: string): string {
  const hasher = createSimpleHasher();
  hasher.update(text);
  return hasher.digest();
}

async function writePlain(name: string, text: string): Promise<void> {
  await fsp.writeFile(path.join(root, name), text, "utf8");
}

function rawBytes(name: string): Buffer {
  return fs.readFileSync(path.join(root, name));
}

/* ── environment ─────────────────────────────────────────────────────────── */

describe("runtime support", () => {
  it("has native CompressionStream/DecompressionStream (no polyfill needed)", () => {
    // Asserted rather than guarded: if this ever fails on a runner, the suite
    // must go red instead of silently skipping every round-trip test below.
    expect(typeof CompressionStream).toBe("function");
    expect(typeof DecompressionStream).toBe("function");
    expect(isCompressionSupported()).toBe(true);
  });
});

/* ── framing ─────────────────────────────────────────────────────────────── */

describe("framing", () => {
  it("writes a plain-UTF-8 head line followed by a gzip member", async () => {
    const body = '{"rows":[1,2,3],"note":"مرحبا"}';
    const result = await writeCompressedFile(dir, "framed.json", META, [body]);

    const bytes = rawBytes("framed.json");
    const newlineAt = bytes.indexOf(0x0a);
    expect(newlineAt).toBeGreaterThan(0);

    // Head line is readable with nothing but `head -1` + JSON.parse.
    const head = JSON.parse(bytes.subarray(0, newlineAt).toString("utf8"));
    expect(head).toMatchObject({ ...META, format: COMPRESSED_FORMAT_ID });

    // Body starts with gzip magic immediately after the newline.
    expect([...bytes.subarray(newlineAt + 1, newlineAt + 4)]).toEqual([0x1f, 0x8b, 0x08]);

    expect(result.headBytes).toBe(newlineAt + 1);
    expect(result.totalBytes).toBe(bytes.byteLength);
    expect(result.bodyLength).toBe(body.length);
    expect(result.bodyHash).toBe(hashOf(body));
  });

  it("round-trips the body through the dual-read entry point", async () => {
    const body = JSON.stringify({ rows: Array.from({ length: 500 }, (_, i) => ({ i })) });
    await writeCompressedFile(dir, "roundtrip.json", META, [body]);

    const read = await readFileText(dir, "roundtrip.json");
    expect(read.kind).toBe("compressed");
    if (read.kind !== "compressed") return;
    expect(read.bodyText).toBe(body);
    expect(read.head.revision).toBe(7);
    expect(read.head._writeToken).toBe(META._writeToken);
  });

  it("never asks the body producer for more than one chunk at a time", async () => {
    // The write path is fed lazily: this generator would blow up if the module
    // materialized the whole body before compressing it.
    let produced = 0;
    function* chunks(): Generator<string> {
      for (let i = 0; i < 2000; i += 1) {
        produced += 1;
        yield `{"i":${i}},`;
      }
    }
    await writeCompressedFile(dir, "lazy.json", META, chunks());
    expect(produced).toBe(2000);
    const read = await readFileText(dir, "lazy.json");
    expect(read.kind === "compressed" && read.bodyText.startsWith('{"i":0},')).toBe(true);
  });

  it("carries a surrogate pair split across two chunks", async () => {
    // "😀" is one surrogate pair; splitting it across chunks would encode two
    // U+FFFD without the chunk encoder's carry.
    const emoji = "😀";
    const chunks = [`{"a":"مرحبا${emoji[0]}`, `${emoji[1]}بالعالم"}`];
    await writeCompressedFile(dir, "surrogate.json", META, chunks);
    const read = await readFileText(dir, "surrogate.json");
    expect(read.kind === "compressed" && read.bodyText).toBe(chunks.join(""));
    expect(JSON.parse((read as { bodyText: string }).bodyText).a).toBe(
      `مرحبا${emoji}بالعالم`
    );
  });

  it("rejects a head line that would not fit the probe window", async () => {
    await expect(
      writeCompressedFile(
        dir,
        "toobig.json",
        { ...META, padding: "x".repeat(HEAD_PROBE_BYTES) },
        ["{}"]
      )
    ).rejects.toThrow(/probe window/);
  });

  it("guards the optional createWritable", async () => {
    const readOnlyDir: DirectoryHandleLike = {
      ...dir,
      getFileHandle: async (name: string) => {
        const handle = await dir.getFileHandle(name, { create: true });
        return { kind: "file", name, getFile: handle.getFile };
      },
    };
    await expect(
      writeCompressedFile(readOnlyDir, "readonly.json", META, ["{}"])
    ).rejects.toThrow(/cannot write/);
  });
});

/* ── detection / dual read ───────────────────────────────────────────────── */

describe("format detection", () => {
  it("reads a legacy pretty-printed envelope through the same entry point", async () => {
    const envelope = wrap({ hello: "عالم" });
    const text = `${JSON.stringify(envelope, null, 2)}\n`;
    await writePlain("legacy-pretty.json", text);

    const probe = await probeFileFormat(dir, "legacy-pretty.json");
    expect(probe.kind).toBe("plain");

    const read = await readFileText(dir, "legacy-pretty.json");
    expect(read.kind === "plain" && read.text).toBe(text);

    const meta = await readEnvelopeMetadata(dir, "legacy-pretty.json");
    expect(meta.kind).toBe("plain");
    expect(meta.kind === "plain" && meta.metadata?.contentHash).toBe(
      envelope.metadata.contentHash
    );
  });

  it("reads a legacy compact envelope whose first line IS a JSON object", async () => {
    // The exact case the detection has to survive: one compact line starting
    // with `{`, terminated by the newline safeWrite appends.
    const envelope = wrap({ rows: Array.from({ length: 50 }, (_, i) => i) });
    const text = `${JSON.stringify(envelope)}\n`;
    await writePlain("legacy-compact.json", text);

    expect((await probeFileFormat(dir, "legacy-compact.json")).kind).toBe("plain");
    const read = await readFileText(dir, "legacy-compact.json");
    expect(read.kind === "plain" && read.text).toBe(text);
  });

  it("reads a legacy compact envelope with no newline in the probe window", async () => {
    const envelope = wrap({ pad: "ب".repeat(20_000) });
    const text = `${JSON.stringify(envelope)}\n`;
    await writePlain("legacy-long.json", text);

    expect((await probeFileFormat(dir, "legacy-long.json")).kind).toBe("plain");
    const read = await readFileText(dir, "legacy-long.json");
    expect(read.kind === "plain" && read.text).toBe(text);
  });

  it("finds legacy metadata at the head and at the tail without reading the middle", async () => {
    const filler = "ت".repeat(100_000);
    const metadata = wrap({ x: 1 }).metadata;
    // safeWrite's streamed writer emits data first, metadata last.
    await writePlain(
      "legacy-streamed.json",
      `{"data":{"pad":"${filler}"},"metadata":${JSON.stringify(metadata)}}\n`
    );
    const tailRead = await readEnvelopeMetadata(dir, "legacy-streamed.json");
    expect(tailRead.kind === "plain" && tailRead.metadata?.revision).toBe(1);

    // wrap() emits metadata first.
    await writePlain(
      "legacy-headmeta.json",
      `{"metadata":${JSON.stringify(metadata)},"data":{"pad":"${filler}"}}\n`
    );
    const headRead = await readEnvelopeMetadata(dir, "legacy-headmeta.json");
    expect(headRead.kind === "plain" && headRead.metadata?.revision).toBe(1);
  });

  it("does not misfire on a legacy file that carries the format marker", async () => {
    // Gate 3 (gzip magic after the newline) still fails.
    await writePlain(
      "fake-marker.json",
      `{"format":"${COMPRESSED_FORMAT_ID}","schemaVersion":1}\n{"data":"plain text after the newline"}\n`
    );
    expect((await probeFileFormat(dir, "fake-marker.json")).kind).toBe("plain");
    expect(await readCompressedHead(dir, "fake-marker.json")).toBeNull();
  });

  it("does not misfire on gzip magic that follows a head line without the marker", async () => {
    // Gate 4 (the format marker) still fails.
    const bytes = Buffer.concat([
      Buffer.from('{"schemaVersion":1,"revision":2}\n', "utf8"),
      Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]),
    ]);
    fs.writeFileSync(path.join(root, "fake-magic.json"), bytes);
    expect((await probeFileFormat(dir, "fake-magic.json")).kind).toBe("plain");
  });

  it("classifies edge windows without touching the disk", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const withMagic = (headLine: string) =>
      Uint8Array.from([...enc(`${headLine}\n`), 0x1f, 0x8b, 0x08]);

    const good = withMagic(JSON.stringify({ ...META, format: COMPRESSED_FORMAT_ID }));
    expect(classifyHeadWindow(good, good.length).kind).toBe("compressed");

    // Empty file, no leading brace, no newline, bad JSON, JSON array, wrong
    // format value.
    expect(classifyHeadWindow(new Uint8Array(0), 0).kind).toBe("plain");
    expect(classifyHeadWindow(enc('[1,2]\n'), 8).kind).toBe("plain");
    expect(classifyHeadWindow(enc("{no newline here"), 16).kind).toBe("plain");
    // A body too short to hold the magic, under a head line that still carries
    // the marker: a torn write, NOT a plain file. Classifying it plain is what
    // made a head-only file read back as its own metadata object.
    expect(classifyHeadWindow(good.subarray(0, good.length - 1), good.length - 1).kind).toBe(
      "corrupt"
    );
    expect(classifyHeadWindow(withMagic("{not json"), 64).kind).toBe("plain");
    expect(classifyHeadWindow(withMagic(JSON.stringify({ format: "other" })), 64).kind).toBe(
      "plain"
    );
  });

  it("reports a missing file as missing on every entry point", async () => {
    expect((await probeFileFormat(dir, "nope.json")).kind).toBe("missing");
    expect((await readEnvelopeMetadata(dir, "nope.json")).kind).toBe("missing");
    expect((await readFileText(dir, "nope.json")).kind).toBe("missing");
    expect(await readCompressedHead(dir, "nope.json")).toBeNull();
  });
});

/* ── corruption ──────────────────────────────────────────────────────────── */

describe("corruption detection", () => {
  /** RFC 1952 magic + CM — the three bytes gate 3 compares. */
  const GZIP_MAGIC_BYTES = 3;
  const body = JSON.stringify({
    rows: Array.from({ length: 4000 }, (_, i) => ({ i, name: `منفذ ${i}` })),
  });

  it("rejects a truncated gzip member instead of returning a partial body", async () => {
    await writeCompressedFile(dir, "truncated.json", META, [body]);
    const file = path.join(root, "truncated.json");
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(file, bytes.subarray(0, bytes.byteLength - 64));

    // The head line survives — metadata still reads, which is the point of the
    // layout — but the body is a hard error.
    expect((await readCompressedHead(dir, "truncated.json"))?.revision).toBe(7);
    await expect(readFileText(dir, "truncated.json")).rejects.toBeInstanceOf(
      CompressedReadError
    );
  });

  it("rejects a flipped byte in the middle of the compressed body", async () => {
    await writeCompressedFile(dir, "flipped.json", META, [body]);
    const file = path.join(root, "flipped.json");
    const bytes = fs.readFileSync(file);
    const headEnd = bytes.indexOf(0x0a) + 1;
    const target = headEnd + Math.floor((bytes.byteLength - headEnd) / 2);
    bytes[target] = bytes[target]! ^ 0xff;
    fs.writeFileSync(file, bytes);

    await expect(readFileText(dir, "flipped.json")).rejects.toBeInstanceOf(
      CompressedReadError
    );
  });

  it("still throws after streaming partial chunks, so no caller can accept a short body", async () => {
    await writeCompressedFile(dir, "truncated2.json", META, [body]);
    const file = path.join(root, "truncated2.json");
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(file, bytes.subarray(0, bytes.byteLength - 8));

    // Documented reality, not an aspiration: inflate emits output blocks as it
    // goes, so a *streaming* consumer does see chunks before the truncation is
    // detected at the trailer. What matters is that the call rejects — the
    // partial text is never returned as a value.
    let received = 0;
    let seen = 0;
    await expect(
      streamFileText(dir, "truncated2.json", (chunk) => {
        received += 1;
        seen += chunk.length;
      })
    ).rejects.toBeInstanceOf(CompressedReadError);
    expect(received).toBeGreaterThan(0);
    // Here the deflate blocks were all intact and only the 8-byte CRC32/ISIZE
    // trailer was cut, so every character did arrive — and the read STILL
    // rejects. That is the trailer doing its job: completeness is proved by the
    // trailer, not by "the bytes decompressed without complaint".
    expect(seen).toBe(body.length);

    // The whole-text entry point therefore yields nothing at all.
    await expect(readFileText(dir, "truncated2.json")).rejects.toBeInstanceOf(
      CompressedReadError
    );
  });

  /**
   * Regression: the torn-write shape. `writeCompressedFile` writes the head line
   * as its own `write()` call before the first body byte exists, so a failure
   * between the two leaves a file that is *exactly* its head line. Such a file
   * must be corrupt at every entry point — never "plain", which would hand the
   * head metadata object to `JSON.parse` and serve it as the payload.
   *
   * Bodies of 1–3 bytes are the same tear caught a moment later; they are pinned
   * here alongside 0 so the boundary cannot silently move.
   */
  it("classifies a file truncated to its own head line as corrupt, not plain", async () => {
    const written = await writeCompressedFile(dir, "headonly.json", META, [body]);
    const file = path.join(root, "headonly.json");
    const whole = fs.readFileSync(file);

    for (const bodyBytes of [0, 1, 2, 3]) {
      fs.writeFileSync(file, whole.subarray(0, written.headBytes + bodyBytes));
      const probe = await probeFileFormat(dir, "headonly.json");
      // 0–2 bytes cannot even be compared against the magic, so the head line's
      // own marker is what identifies them: `corrupt`. At 3 the magic is intact
      // and the file classifies `compressed` — its emptiness is then caught by
      // the inflate. Neither may EVER be `plain`, which is what served the head
      // metadata as a payload.
      expect(probe.kind, `body=${bodyBytes} must not classify as plain`).toBe(
        bodyBytes < GZIP_MAGIC_BYTES ? "corrupt" : "compressed"
      );
      await expect(
        readFileText(dir, "headonly.json"),
        `body=${bodyBytes} must not yield text`
      ).rejects.toBeInstanceOf(CompressedReadError);
    }

    // The healthy file is unaffected — the boundary is "shorter than head + the
    // three gzip magic bytes", nothing wider.
    fs.writeFileSync(file, whole);
    expect((await probeFileFormat(dir, "headonly.json")).kind).toBe("compressed");
    const healthy = await readFileText(dir, "headonly.json");
    expect(healthy.kind === "compressed" && healthy.bodyText).toBe(body);
  });
});

/* ── large payload + O(1) metadata ───────────────────────────────────────── */

describe("large payloads", () => {
  const CHUNK_UNITS = 64 * 1024;
  const CHUNK_COUNT = 1800; // ≈ 118 M UTF-16 code units ≈ 130 MB of UTF-8

  let expectedHash = "";
  let expectedLength = 0;
  let compressedBytes = 0;

  /**
   * Deterministic high-entropy text. Repetitive filler would gzip down to a few
   * hundred KB, which would make the "metadata read is O(1) in FILE size"
   * measurement below prove nothing — the point is a genuinely large file on
   * disk (~60 MB here) as well as a genuinely large body.
   */
  function* bigBody(): Generator<string> {
    // Never one string: each chunk is built, yielded and dropped.
    let seed = 0x9e3779b9;
    const alphabet = "0123456789abcdef";
    const segment = 4096;
    for (let i = 0; i < CHUNK_COUNT; i += 1) {
      const parts: string[] = [];
      for (let s = 0; s < CHUNK_UNITS; s += segment) {
        let out = "";
        for (let c = 0; c < segment; c += 1) {
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          out += alphabet[(t >>> 0) & 15];
        }
        parts.push(out);
      }
      yield parts.join("");
    }
  }

  beforeAll(async () => {
    const hasher = createSimpleHasher();
    for (const chunk of bigBody()) {
      hasher.update(chunk);
      expectedLength += chunk.length;
    }
    expectedHash = hasher.digest();

    const result = await writeCompressedFile(dir, "huge.json", META, bigBody());
    compressedBytes = result.totalBytes;
    expect(result.bodyLength).toBe(expectedLength);
    expect(result.bodyHash).toBe(expectedHash);
    // Small file for the O(1) comparison.
    await writeCompressedFile(dir, "tiny.json", META, ['{"a":1}']);
  }, 600_000);

  it("round-trips a body well over 100 MB without materializing it", async () => {
    expect(expectedLength).toBeGreaterThan(100_000_000);

    const hasher = createSimpleHasher();
    let length = 0;
    const result = await streamFileText(dir, "huge.json", (chunk) => {
      hasher.update(chunk);
      length += chunk.length;
    });

    expect(result.kind).toBe("compressed");
    expect(length).toBe(expectedLength);
    expect(hasher.digest()).toBe(expectedHash);
    // Sanity: the file on disk is a compressed member, smaller than the body,
    // and still large enough in absolute terms to make the O(1) metadata
    // measurement below meaningful.
    expect(compressedBytes).toBeLessThan(expectedLength);
    expect(compressedBytes).toBeGreaterThan(10_000_000);
  }, 600_000);

  it("reads metadata in O(1): same cost for 7 bytes of body and 118 M", async () => {
    const median = async (name: string): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const started = performance.now();
        const head = await readCompressedHead(dir, name);
        samples.push(performance.now() - started);
        expect(head?.revision).toBe(7);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)]!;
    };

    const tinySize = fs.statSync(path.join(root, "tiny.json")).size;
    const hugeSize = fs.statSync(path.join(root, "huge.json")).size;
    const tiny = await median("tiny.json");
    const huge = await median("huge.json");

    console.log(
      `metadata read median — tiny (${tinySize} B): ${tiny.toFixed(4)} ms; ` +
        `huge (${hugeSize} B, ${expectedLength} code units of body): ${huge.toFixed(4)} ms`
    );

    expect(hugeSize).toBeGreaterThan(tinySize * 1000);
    // O(1) in file size: a size-proportional read would be ~10^5 x slower.
    expect(huge).toBeLessThan(Math.max(tiny * 5, 5));
  }, 600_000);
});
