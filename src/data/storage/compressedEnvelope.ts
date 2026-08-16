/**
 * Compression **framing** for workspace files: an uncompressed metadata head
 * line followed by a gzip member carrying the body.
 *
 * ```
 * line 1: {"format":"xqapz-gzip-1","schemaVersion":1,"revision":N,…}\n   ← PLAIN UTF-8
 * rest  : gzip stream of the body text                                  ← compressed
 * ```
 *
 * **This module knows nothing about what the body means.** The body is an
 * opaque sequence of text chunks supplied by the caller (today
 * `JSON.stringify(data)`, tomorrow a columnar encoding). Framing and payload
 * encoding are deliberately separate concerns.
 *
 * ── Why the metadata is NOT compressed ──────────────────────────────────────
 *
 * `casLoop` (casLoop.ts) writes a fresh `_writeToken` and re-reads the file to
 * find out whether a competing writer won. It must reach `revision` /
 * `contentHash` / `_writeToken` **without decompressing the body**.
 *
 * v86.0's `safeWrite.ts` solves the same problem for an oversized plain file by
 * reading a bounded 64 KB **tail** window, which works only because its
 * streamed writer emits `"metadata"` last. A gzip member cannot be tail-read at
 * all: its trailing bytes are the end of a compressed stream and mean nothing
 * without inflating everything before them. So the metadata moves to the
 * **head**, where a fixed 8 KB read answers the CAS question in O(1) regardless
 * of whether the file is a 2 KB manifest or a 573 MB import — strictly cheaper
 * than the tail read it replaces, and still greppable with plain `head -1`.
 *
 * ── Hash domain is unchanged ────────────────────────────────────────────────
 *
 * `contentHash` remains `simpleHash(JSON.stringify(data))` in the TEXT domain
 * and is still verified by `verifyContentHash` after the body is decompressed.
 * Compression is a transport detail applied strictly *below* the hash: this
 * module never hashes compressed bytes and never alters what the caller put in
 * the head line. {@link writeCompressedFile} additionally reports the body's
 * own `simpleHash` + code-unit length so a caller can verify a round trip
 * without a second serialization pass.
 *
 * ── Integrity ───────────────────────────────────────────────────────────────
 *
 * gzip carries a CRC32 and an ISIZE trailer over the *uncompressed* bytes, both
 * checked by `DecompressionStream`. A truncated member and a flipped byte are
 * therefore both hard read errors ({@link CompressedReadError}) rather than a
 * short/garbled body. (ISIZE is mod 2^32, so the length half of that check
 * degenerates above 4 GiB of uncompressed body; CRC32 does not.)
 *
 * Note the shape of that guarantee, which was measured rather than assumed:
 * inflate emits output blocks as it goes, so {@link streamCompressedBody} *does*
 * hand the caller chunks before a truncation is detected at the trailer. The
 * call still rejects, and {@link readFileText} therefore returns nothing at all
 * — but a streaming consumer must treat a rejection as "discard everything I
 * was given", never as "keep what arrived".
 *
 * ── What is bounded, and what is not ────────────────────────────────────────
 *
 * The **write path never materializes the body as one string**: the caller
 * hands over an (async) iterable of chunks which is encoded, gzipped and
 * flushed to disk chunk by chunk. {@link streamCompressedText} keeps the read
 * path equally bounded.
 *
 * {@link readFileText} does return the whole body as one string and is
 * therefore still capped by V8's max string length (~536,870,888 UTF-16 code
 * units), exactly as `safeReadJson` is today — anything that ends in
 * `JSON.parse` has that ceiling regardless of how the bytes were stored.
 * Lifting it is out of scope for the framing layer; use
 * {@link streamCompressedText} when the body must not be materialized.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * Framing only. Locking (`withResourceLock`), `.bak` snapshots, `.tmp` staging,
 * rollback and revision bookkeeping stay in `safeWrite.ts`; this module is not
 * wired into it and changes nothing about what `safeWriteJson` writes today.
 */
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { assertWritableMode } from "./readOnlyMode";
import { isNotFoundError } from "./transientFileErrors";
import {
  createSimpleHasher,
  validateEnvelopeStructure,
  type JsonMetadata,
} from "./jsonEnvelope";

/**
 * Value of the head line's `format` key. Half of the detection gate (see
 * {@link classifyHeadWindow}); bump the suffix only for a framing change that
 * older readers must refuse rather than misread.
 */
export const COMPRESSED_FORMAT_ID = "xqapz-gzip-1";

/**
 * Fixed head window. The whole point of the layout: metadata is read with this
 * one bounded slice whatever the file size. A head line longer than this is
 * rejected at write time rather than being made unreadable by its own reader.
 */
export const HEAD_PROBE_BYTES = 8192;

/** RFC 1952 magic (0x1f 0x8b) plus CM=8 (deflate), which is all gzip defines. */
const GZIP_MAGIC = [0x1f, 0x8b, 0x08] as const;

const NEWLINE = 0x0a;
const OPEN_BRACE = 0x7b;

/** Byte window used to stream the compressed body off disk. Matches safeWrite's. */
const BODY_SLICE_BYTES = 4 * 1024 * 1024;

/**
 * Bounded window scanned for a *legacy* (uncompressed) envelope's metadata.
 * Both ends are probed: `wrap()` puts `metadata` first, while safeWrite's
 * streamed writer puts it last, so head-then-tail covers both without ever
 * reading the middle of the file.
 */
const LEGACY_METADATA_WINDOW_BYTES = 64 * 1024;

/** Head line of a compressed file. Extra keys (e.g. `_writeToken`) pass through. */
export type CompressedHead = JsonMetadata & {
  format: typeof COMPRESSED_FORMAT_ID;
  [key: string]: unknown;
};

/** What the caller supplies; `format` is stamped by {@link writeCompressedFile}. */
export type CompressedHeadInput = JsonMetadata & { [key: string]: unknown };

export type CompressedWriteResult = {
  /** Bytes of the uncompressed head line, including its terminating `\n`. */
  headBytes: number;
  /** Bytes of the gzip member. */
  bodyBytes: number;
  totalBytes: number;
  /** UTF-16 code units of the body text (pre-compression). */
  bodyLength: number;
  /** `simpleHash` of the body text — same hasher, same text domain, as everywhere else. */
  bodyHash: string;
};

/** A file that exists but cannot be read as this format (truncated/corrupt). */
export class CompressedReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CompressedReadError";
  }
}

/**
 * Result of the bounded head probe — the only thing the CAS path needs.
 *
 * `corrupt` is a file whose head line self-identifies as this format but which
 * is too short to hold even the start of a gzip member: the torn-write shape
 * (see {@link classifyHeadWindow}). Its head is still returned, because the head
 * line is intact text and revision bookkeeping legitimately reads it; what must
 * never happen is the file being treated as a *plain* file, whose "payload"
 * would then be the head metadata object itself.
 */
export type FormatProbe =
  | { kind: "missing" }
  | { kind: "compressed"; head: CompressedHead; bodyStart: number; size: number }
  | { kind: "corrupt"; head: CompressedHead; bodyStart: number; size: number }
  | { kind: "plain"; size: number };

/** Dual-read metadata result. `plain` is a legacy uncompressed workspace file. */
export type MetadataRead =
  | { kind: "missing" }
  | { kind: "compressed"; metadata: CompressedHead }
  | { kind: "plain"; metadata: JsonMetadata | null };

/** Dual-read text result. For a plain file `text` is the whole file verbatim. */
export type TextRead =
  | { kind: "missing" }
  | { kind: "compressed"; head: CompressedHead; bodyText: string }
  | { kind: "plain"; text: string };

/**
 * True when the runtime provides the native gzip streams this module requires.
 * Chromium has had both since 80/103; Node has had both since 18. There is no
 * polyfill and no bundled fallback on purpose — `fflate` was benchmarked and
 * rejected (larger output, slower, ~38% of remaining bundle headroom).
 */
export function isCompressionSupported(): boolean {
  return (
    typeof CompressionStream === "function" &&
    typeof DecompressionStream === "function"
  );
}

function requireCompressionSupport(): void {
  if (!isCompressionSupported()) {
    throw new Error(
      "CompressionStream/DecompressionStream are unavailable in this runtime."
    );
  }
}

// ── Encoding ────────────────────────────────────────────────────────────────

/**
 * UTF-8 encoder that is safe to feed arbitrarily-split chunks.
 *
 * `TextEncoder.encode` has no streaming mode, so a chunk boundary landing
 * between the two halves of a surrogate pair (any emoji, and possible wherever
 * the body producer chunks by length rather than by character) would encode
 * each half as U+FFFD and silently corrupt the payload. Holding a trailing lone
 * high surrogate back until the next chunk makes the concatenated output
 * byte-identical to encoding the whole body at once — including the U+FFFD a
 * genuinely unpaired trailing surrogate deserves, which `flush()` emits.
 */
function createChunkEncoder(): {
  encode: (chunk: string) => Uint8Array<ArrayBuffer>;
  flush: () => Uint8Array<ArrayBuffer>;
} {
  const encoder = new TextEncoder();
  let pending = "";
  return {
    encode(chunk: string): Uint8Array<ArrayBuffer> {
      let text = pending + chunk;
      pending = "";
      if (text.length > 0) {
        const last = text.charCodeAt(text.length - 1);
        if (last >= 0xd800 && last <= 0xdbff) {
          pending = text.slice(-1);
          text = text.slice(0, -1);
        }
      }
      return encoder.encode(text);
    },
    flush(): Uint8Array<ArrayBuffer> {
      const tail = pending;
      pending = "";
      return encoder.encode(tail);
    },
  };
}

// ── Write ───────────────────────────────────────────────────────────────────

type BinaryWritableFileStream = {
  write: (data: Uint8Array<ArrayBufferLike>) => Promise<void>;
  close: () => Promise<void>;
  /**
   * Optional exactly like `createWritable` itself: the real
   * `FileSystemWritableFileStream` has it, this repo's `WritableFileStreamLike`
   * does not declare it, and hand-written test doubles rarely implement it.
   * Always guarded before use.
   */
  abort?: (reason?: unknown) => Promise<void>;
};

/**
 * The real `FileSystemWritableFileStream.write` accepts a BufferSource; this
 * repo's `WritableFileStreamLike` narrows it to `string` because until now
 * nothing wrote bytes. Narrowing the *shared* type back open would break every
 * hand-written `write: (data: string) => …` test double in the suite, so the
 * widening is confined to this one call site. Any directory double used with
 * this module must accept binary — see this file's tests for a faithful one.
 */
function asBinaryWritable(stream: unknown): BinaryWritableFileStream {
  return stream as BinaryWritableFileStream;
}

async function openWritable(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<BinaryWritableFileStream> {
  const handle = await dir.getFileHandle(fileName, { create: true });
  // `createWritable` is optional on FileHandleLike (a read-only handle, or a
  // browser without the write half of the API) — always guarded before use.
  if (!handle.createWritable) {
    throw new Error(`Browser cannot write ${fileName}.`);
  }
  return asBinaryWritable(await handle.createWritable());
}

function buildHeadLine(head: CompressedHeadInput): Uint8Array {
  const stamped: CompressedHead = { ...head, format: COMPRESSED_FORMAT_ID };
  const json = JSON.stringify(stamped);
  // JSON.stringify escapes U+000A inside strings, so a well-formed head line
  // cannot contain a raw newline. Assert it anyway: the newline is the frame
  // delimiter, and a caller handing us a pre-serialized string would break the
  // format in a way that only shows up as an unreadable file much later.
  if (json.includes("\n")) {
    throw new Error("Compressed head line must not contain a raw newline.");
  }
  const bytes = new TextEncoder().encode(`${json}\n`);
  if (bytes.byteLength > HEAD_PROBE_BYTES) {
    throw new Error(
      `Compressed head line is ${bytes.byteLength} bytes, above the ${HEAD_PROBE_BYTES}-byte probe window.`
    );
  }
  return bytes;
}

/**
 * Writes `head` as an uncompressed first line, then the gzip of `body`.
 *
 * `body` is consumed lazily; nothing larger than one chunk (plus gzip's own
 * window) is ever held. The head is written before the body is read, so a hash
 * *of* the body cannot appear in it — see the module doc.
 */
export async function writeCompressedFile(
  dir: DirectoryHandleLike,
  fileName: string,
  head: CompressedHeadInput,
  body: Iterable<string> | AsyncIterable<string>
): Promise<CompressedWriteResult> {
  assertWritableMode();
  requireCompressionSupport();

  const headBytes = buildHeadLine(head);
  const hasher = createSimpleHasher();
  let bodyLength = 0;

  const encoder = createChunkEncoder();
  const source = new ReadableStream<BufferSource>({
    async start(controller) {
      try {
        for await (const chunk of body as AsyncIterable<string>) {
          hasher.update(chunk);
          bodyLength += chunk.length;
          const encoded = encoder.encode(chunk);
          if (encoded.byteLength > 0) controller.enqueue(encoded);
        }
        const tail = encoder.flush();
        if (tail.byteLength > 0) controller.enqueue(tail);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const writable = await openWritable(dir, fileName);
  let bodyBytes = 0;
  try {
    await writable.write(headBytes);
    const compressed = source.pipeThrough(new CompressionStream("gzip"));
    const reader = compressed.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        bodyBytes += value.byteLength;
        await writable.write(value);
      }
    }
    await writable.close();
  } catch (error) {
    // `close()` COMMITS whatever landed — on the error path that is precisely
    // how a head-only file gets published. `abort()` discards the swap file
    // instead, so a write that dies between the head and the body leaves the
    // previous contents (or nothing) rather than a torn frame. It is optional on
    // the writable, so fall back to closing when it is absent: the reader now
    // classifies the resulting shape as corrupt either way.
    try {
      if (typeof writable.abort === "function") await writable.abort(error);
      else await writable.close();
    } catch {
      // Best-effort: never mask the original failure with a teardown error.
    }
    throw error;
  }

  return {
    headBytes: headBytes.byteLength,
    bodyBytes,
    totalBytes: headBytes.byteLength + bodyBytes,
    bodyLength,
    bodyHash: hasher.digest(),
  };
}

// ── Detection ───────────────────────────────────────────────────────────────

type HeadClassification =
  | { kind: "compressed"; head: CompressedHead; bodyStart: number }
  | { kind: "corrupt"; head: CompressedHead; bodyStart: number }
  | { kind: "plain" };

/** The head line as a parsed object carrying this format's marker, or null. */
function parseHeadLine(window: Uint8Array, newlineAt: number): CompressedHead | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(window.subarray(0, newlineAt)));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if ((parsed as { format?: unknown }).format !== COMPRESSED_FORMAT_ID) return null;
  return parsed as CompressedHead;
}

/**
 * Decides whether a file is in this format from its first {@link HEAD_PROBE_BYTES}
 * bytes. **Four independent gates**, all of which must pass:
 *
 *  1. the file starts with `{`;
 *  2. a `\n` occurs inside the probe window;
 *  3. the three bytes immediately after that `\n` are the gzip magic `1f 8b 08`;
 *  4. the text before the `\n` parses as a JSON object carrying
 *     `"format":"xqapz-gzip-1"`.
 *
 * **Why a legacy file cannot misfire**, given that a legacy envelope's first
 * line *is* a JSON object:
 *
 * - Pretty-printed legacy (≤ 64 KB files): line 1 is the single character `{`,
 *   which fails gate 4 (and gate 3 — `"` follows the newline, not `1f`).
 * - Compact legacy: `JSON.stringify` never emits a raw U+000A, so the *only*
 *   newline in the file is the trailing one `safeWrite` appends. Gate 3 then
 *   reads past EOF and fails. It also fails gate 4 — the top-level keys are
 *   `metadata`/`data`, never `format`.
 * - Compact legacy larger than 8 KB: no newline in the window at all, so gate 2
 *   fails and the file is classified plain without even a parse attempt.
 *
 * Passing by accident would require a legacy file to contain a raw newline
 * *and* three specific bytes after it *and* a top-level `format` key with this
 * exact value. Gates 3 and 4 are independent — one is a byte pattern the JSON
 * text domain cannot produce, the other a marker no writer in this repo has
 * ever emitted — so no single coincidence flips the classification.
 *
 * The converse (a compressed file read as plain) needs its head line or its
 * first three body bytes to be damaged; the file is then reported as
 * plain-and-corrupt rather than silently yielding a partial body.
 *
 * ── The one case that is NOT "plain" ────────────────────────────────────────
 *
 * A file too short to hold the three magic bytes cannot fail gate 3 honestly —
 * there is nothing there to compare. If its head line nonetheless parses AND
 * carries this format's marker, the file is a torn write, not a plain file:
 * {@link writeCompressedFile} emits the head as its own `write()` before the
 * first body byte exists, so a failure in between leaves exactly this shape.
 * Calling it plain made a head-only file read back as a *successful* payload —
 * the head metadata object itself, `.bak` ladder skipped — so it is classified
 * `corrupt` instead. (Bodies of 1–2 bytes reach the same verdict here rather
 * than dying later in `JSON.parse`; a 3-byte body has always failed at inflate.)
 *
 * A genuine plain file cannot be caught by this: it would have to consist of a
 * first line that parses as a JSON object carrying `"format":"xqapz-gzip-1"`
 * and then end within two bytes. No writer in this repo emits that key at all —
 * `wrap()` produces `metadata`/`data`, and a pretty-printed envelope's first
 * line is the single character `{`, which does not parse.
 */
export function classifyHeadWindow(
  window: Uint8Array,
  fileSize: number
): HeadClassification {
  if (window.length === 0 || window[0] !== OPEN_BRACE) return { kind: "plain" };
  const newlineAt = window.indexOf(NEWLINE);
  if (newlineAt < 0) return { kind: "plain" };
  const bodyStart = newlineAt + 1;
  if (fileSize < bodyStart + GZIP_MAGIC.length) {
    const head = parseHeadLine(window, newlineAt);
    return head === null ? { kind: "plain" } : { kind: "corrupt", head, bodyStart };
  }
  for (let i = 0; i < GZIP_MAGIC.length; i += 1) {
    if (window[bodyStart + i] !== GZIP_MAGIC[i]) return { kind: "plain" };
  }
  const head = parseHeadLine(window, newlineAt);
  if (head === null) return { kind: "plain" };
  return { kind: "compressed", head, bodyStart };
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Resolves to null for an absent file; any other failure still throws. */
async function openFile(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<File | null> {
  try {
    const handle: FileHandleLike = await dir.getFileHandle(fileName, {
      create: false,
    });
    return await handle.getFile();
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function readWindow(file: File, start: number, end: number): Promise<Uint8Array> {
  const clampedEnd = Math.min(end, file.size);
  if (clampedEnd <= start) return new Uint8Array(0);
  return new Uint8Array(await file.slice(start, clampedEnd).arrayBuffer());
}

/**
 * The bounded head probe. **This is the O(1) CAS read**: one `Blob.slice` of at
 * most {@link HEAD_PROBE_BYTES}, identical in cost for a 2 KB manifest and a
 * 573 MB import, with no decompression at any size.
 */
export async function probeFileFormat(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<FormatProbe> {
  const file = await openFile(dir, fileName);
  if (file === null) return { kind: "missing" };
  const window = await readWindow(file, 0, HEAD_PROBE_BYTES);
  const classified = classifyHeadWindow(window, file.size);
  return classified.kind === "plain"
    ? { kind: "plain", size: file.size }
    : { ...classified, size: file.size };
}

/**
 * Head line of a compressed file, or null when the file is missing or plain.
 * The CAS path's `revision` / `contentHash` / `_writeToken` read.
 *
 * A torn (`corrupt`) file still has an intact head line, and this is a metadata
 * read, so it is returned — exactly as it already is for a file whose gzip
 * member is truncated further in. Deciding whether the BODY is usable is
 * `isRecoverableCompressedFile`'s job, never this one's.
 */
export async function readCompressedHead(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<CompressedHead | null> {
  const probe = await probeFileFormat(dir, fileName);
  return probe.kind === "compressed" || probe.kind === "corrupt" ? probe.head : null;
}

function extractBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function metadataFromWindow(bytes: Uint8Array): JsonMetadata | null {
  // The window may begin or end mid-character; only the region from the
  // `"metadata":` marker to its closing brace is used, so the resulting
  // replacement characters at the edges are harmless.
  const text = new TextDecoder("utf-8").decode(bytes);
  const marker = '"metadata":';
  for (const markerAt of [text.indexOf(marker), text.lastIndexOf(marker)]) {
    if (markerAt < 0) continue;
    const objectStart = text.indexOf("{", markerAt + marker.length);
    if (objectStart < 0) continue;
    const objectText = extractBalancedObject(text, objectStart);
    if (objectText === null) continue;
    try {
      const metadata = JSON.parse(objectText) as JsonMetadata;
      if (!validateEnvelopeStructure({ metadata, data: null })) continue;
      if (typeof metadata.revision !== "number") continue;
      return metadata;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Metadata through **one entry point for both formats** — this is what makes
 * dual-read permanent rather than a migration window.
 *
 * Compressed: the O(1) head read. Plain: a bounded head window then a bounded
 * tail window, because `wrap()` emits `metadata` first while safeWrite's
 * streamed writer emits it last; neither probe reads the middle of the file.
 * A legacy read is therefore bounded but *not* O(1)-cheap in the same way —
 * that asymmetry is the reason the new format exists.
 */
export async function readEnvelopeMetadata(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<MetadataRead> {
  const file = await openFile(dir, fileName);
  if (file === null) return { kind: "missing" };
  const head = await readWindow(file, 0, HEAD_PROBE_BYTES);
  const classified = classifyHeadWindow(head, file.size);
  if (classified.kind !== "plain") {
    // Includes the torn (`corrupt`) shape: its head line is intact and this is a
    // metadata read, so revision bookkeeping stays continuous. A caller that
    // needs to know the BODY is intact must ask separately.
    return { kind: "compressed", metadata: classified.head };
  }
  const headWide =
    file.size <= HEAD_PROBE_BYTES
      ? head
      : await readWindow(file, 0, LEGACY_METADATA_WINDOW_BYTES);
  const fromHead = metadataFromWindow(headWide);
  if (fromHead !== null) return { kind: "plain", metadata: fromHead };
  if (file.size > LEGACY_METADATA_WINDOW_BYTES) {
    const tail = await readWindow(
      file,
      Math.max(0, file.size - LEGACY_METADATA_WINDOW_BYTES),
      file.size
    );
    const fromTail = metadataFromWindow(tail);
    if (fromTail !== null) return { kind: "plain", metadata: fromTail };
  }
  return { kind: "plain", metadata: null };
}

/**
 * Feeds the compressed body to `onChunk` as decoded text windows. Nothing
 * larger than one window is held, so this works at any file size.
 *
 * Throws {@link CompressedReadError} if the gzip member is truncated or
 * corrupt. Chunks already handed to `onChunk` before the damage was detected
 * are NOT valid data: a rejection means discard everything received.
 */
export async function streamCompressedBody(
  file: File,
  bodyStart: number,
  onChunk: (chunk: string) => void | Promise<void>
): Promise<void> {
  requireCompressionSupport();
  let offset = bodyStart;
  const size = file.size;
  const source = new ReadableStream<BufferSource>({
    async pull(controller) {
      if (offset >= size) {
        controller.close();
        return;
      }
      const end = Math.min(offset + BODY_SLICE_BYTES, size);
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      offset = end;
      controller.enqueue(bytes);
    },
  });

  const decoder = new TextDecoder("utf-8");
  const reader = source.pipeThrough(new DecompressionStream("gzip")).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        const text = decoder.decode(value, { stream: true });
        if (text.length > 0) await onChunk(text);
      }
    }
  } catch (error) {
    // Truncated member, flipped byte, CRC32 or ISIZE mismatch: all arrive here
    // as a stream error. Re-typed so a caller can tell "this file is damaged"
    // from "this browser cannot decompress".
    throw new CompressedReadError(
      `Compressed body of a workspace file failed to decompress: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
  const tail = decoder.decode();
  if (tail.length > 0) await onChunk(tail);
}

/**
 * Streaming dual read. Compressed bodies are inflated in windows; a legacy
 * plain file is streamed through the same bounded `Blob.slice` + streaming
 * `TextDecoder` pattern `safeWrite.ts` uses, so a byte window splitting an
 * Arabic character is carried across rather than corrupted.
 *
 * Returns the head for a compressed file, `null` for a plain one, and
 * `"missing"` when the file is absent.
 */
export async function streamFileText(
  dir: DirectoryHandleLike,
  fileName: string,
  onChunk: (chunk: string) => void | Promise<void>
): Promise<{ kind: "missing" } | { kind: "compressed"; head: CompressedHead } | { kind: "plain" }> {
  const file = await openFile(dir, fileName);
  if (file === null) return { kind: "missing" };
  const window = await readWindow(file, 0, HEAD_PROBE_BYTES);
  const classified = classifyHeadWindow(window, file.size);
  if (classified.kind === "corrupt") {
    // Self-identified as this format but with no body to inflate. Same verdict
    // as a truncated member, reached without handing back a single chunk.
    throw new CompressedReadError(
      `Compressed workspace file ${fileName} ends at its head line: the gzip body is missing.`
    );
  }
  if (classified.kind === "compressed") {
    await streamCompressedBody(file, classified.bodyStart, onChunk);
    return { kind: "compressed", head: classified.head };
  }
  const decoder = new TextDecoder("utf-8");
  for (let offset = 0; offset < file.size; offset += BODY_SLICE_BYTES) {
    const bytes = await readWindow(file, offset, offset + BODY_SLICE_BYTES);
    const text = decoder.decode(bytes, { stream: true });
    if (text.length > 0) await onChunk(text);
  }
  const tail = decoder.decode();
  if (tail.length > 0) await onChunk(tail);
  return { kind: "plain" };
}

/**
 * Whole-text dual read. Convenience over {@link streamFileText} for payloads
 * that will be `JSON.parse`d anyway; bounded by V8's max string length like
 * every other whole-file read in this repo (see the module doc).
 */
export async function readFileText(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<TextRead> {
  const parts: string[] = [];
  const result = await streamFileText(dir, fileName, (chunk) => {
    parts.push(chunk);
  });
  if (result.kind === "missing") return { kind: "missing" };
  if (result.kind === "compressed") {
    return { kind: "compressed", head: result.head, bodyText: parts.join("") };
  }
  return { kind: "plain", text: parts.join("") };
}
