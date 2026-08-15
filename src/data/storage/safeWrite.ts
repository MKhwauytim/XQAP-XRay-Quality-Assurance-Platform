/**
 * The safe write/read layer every workspace file goes through (see CLAUDE.md).
 *
 * **"Absent on read" and "transient on write" are two different conditions.**
 * They arrive as the same Chromium `NotFoundError` DOMException, and this
 * module is where they are told apart:
 *
 * - Ordinary reads (`readText`, `safeReadJson`, `readEnvelopeRevision`,
 *   `readFileTextWithRetry`, and the pre-write read of the existing file)
 *   treat NotFoundError as **absence** and resolve to `null` immediately. That
 *   is the correct and required behavior: absence is the normal answer for a
 *   first write, for an optional file, and for safeReadJson's `.bak`/`.tmp`
 *   fallback probes. Adding retries here would slow down every one of them.
 * - Post-write **verification** read-backs opt in with
 *   `readText(dir, name, { retryMissing: true })` (and `safeReadJson(…, {
 *   retryMissing: true })`). There the file provably exists — this same call
 *   just wrote and closed it — so NotFoundError can only mean the directory
 *   listing on a UNC/SMB share has not caught up yet. Treating it as failure
 *   made successful writes report as failures to real users.
 * - Writes themselves (`writeText`) are wrapped in `retryTransientWrite`; they
 *   rewrite whole content through a freshly-opened handle, so retrying is
 *   idempotent.
 *
 * The retry ladder and the rationale live in `transientFileErrors.ts`.
 * `NotReadableError` remains transient on both paths and is unrelated.
 *
 * **The streamed path never holds a whole file as one string.** Serialization,
 * verification, the `.bak` snapshot, the commit, the rollback and the `.tmp`
 * promotion all move data in bounded windows, so a payload past V8's max string
 * length (~536,870,888 UTF-16 code units) can still be written and verified
 * byte-exactly. See the READ_SLICE_BYTES block below for how the read side
 * works and why the hash domain did not have to change. What is *not* lifted:
 * `safeReadJson` still returns a parsed value and therefore still needs the
 * file as one string — reading such a file back is bounded by `JSON.parse`, not
 * by this module.
 */
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { assertWritableMode } from "./readOnlyMode";
import {
  COMPRESSED_FORMAT_ID,
  HEAD_PROBE_BYTES,
  classifyHeadWindow,
  isCompressionSupported,
  readEnvelopeMetadata,
  streamCompressedBody,
  writeCompressedFile,
  type CompressedHead,
  type CompressedHeadInput,
  type CompressedWriteResult,
} from "./compressedEnvelope";
import { decodePayloadColumns, encodePayloadColumns } from "./columnarPayload";
import {
  payloadQualifiesForCompression,
  resolveStoragePolicy,
  type StoragePolicy,
} from "./storagePolicy";
import { directoryResourceKey, withResourceLock } from "./webLocks";
import { withWorkspaceWriteAccess } from "./workspaceWriteAccess";
import {
  TRANSIENT_WRITE_RETRY_DELAYS_MS,
  isNotFoundError,
  isNotReadableError,
  logExhaustedNotFound,
  retryTransientWrite,
} from "./transientFileErrors";
import {
  ENVELOPE_SCHEMA_VERSION,
  createSimpleHasher,
  isEnvelope,
  streamJsonStringify,
  validateEnvelopeStructure,
  verifyContentHash,
  wrap,
  unwrap,
  type JsonMetadata,
} from "./jsonEnvelope";

export type SafeReadResult<T> =
  | { ok: true; value: T; recoveredFromBak: boolean; rawText: string }
  | { ok: false; reason: "missing" | "corrupt" };

function errorName(error: unknown): string | undefined {
  return error && typeof error === "object" ? (error as { name?: string }).name : undefined;
}

// A handle can briefly become unreadable while another Chromium process swaps
// a file. Retry that transient condition, but never reinterpret it as a missing
// file: doing so would allow safeReadJson to return a stale .bak and could make
// write verification roll a successful commit back to its previous contents.
const NOT_READABLE_RETRY_DELAYS_MS = [20, 60] as const;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type ReadTextOptions = {
  /**
   * Opt-in ONLY. Treats a `NotFoundError` as a transient share-visibility
   * failure and retries it on TRANSIENT_WRITE_RETRY_DELAYS_MS before giving up
   * and returning `null`.
   *
   * Set this exclusively on post-write **verification** read-backs, where the
   * file provably exists because this same call just wrote and closed it, so
   * "not found" can only mean the directory listing has not caught up (see
   * transientFileErrors.ts's module doc for why that happens on UNC/SMB).
   *
   * It must stay off by default. Every ordinary read here is an absence probe:
   * safeReadJson alone probes `{file}`, `{file}.bak` and `{file}.tmp` on a
   * miss, safeWriteJson reads the pre-existing file before every first write,
   * and dozens of optional-file loads across the app resolve to `null` by
   * design. Retrying those would put ~630 ms of dead wait behind every one of
   * them for no benefit whatsoever.
   */
  retryMissing?: boolean;
};

/**
 * Test seam simulating V8's max string length (`Invalid string length`).
 *
 * A real Chrome throws that RangeError out of `file.text()` once the decoded
 * file exceeds ~536,870,888 UTF-16 code units. A unit test cannot allocate that
 * (the memory-directory double stores file content as a JS string, so it cannot
 * even hold such a file), so instead the ceiling is lowered: any `readText` of a
 * file larger than this cap throws the same RangeError the engine would.
 *
 * That makes the whole-file-as-one-string read *impossible* at test size, so a
 * write that still succeeds under the cap has provably never materialized the
 * file as one string. Production never lowers it.
 *
 * The cap is compared against `file.size` (bytes) rather than decoded length —
 * bytes >= code units for UTF-8, so it is the conservative side of the real
 * limit and needs no decode to evaluate.
 */
let maxStringLengthForTests = Number.POSITIVE_INFINITY;

/** @internal — test-only. Lower the simulated engine max string length. */
export function __setMaxStringLengthForTests(limit: number): void {
  maxStringLengthForTests = limit;
}

/** @internal — test-only. Restore the real (engine-imposed) ceiling. */
export function __resetMaxStringLengthForTests(): void {
  maxStringLengthForTests = Number.POSITIVE_INFINITY;
}

function stringLengthRangeError(name: string): RangeError {
  return new RangeError(`Invalid string length (simulated ceiling) for ${name}.`);
}

async function readText(
  dir: DirectoryHandleLike,
  name: string,
  options?: ReadTextOptions
): Promise<string | null> {
  const missingRetries = options?.retryMissing ? TRANSIENT_WRITE_RETRY_DELAYS_MS.length : 0;
  let missingAttempts = 0;
  let unreadableAttempts = 0;
  let lastMissingError: unknown = null;
  for (;;) {
    try {
      const handle = await dir.getFileHandle(name, { create: false });
      const file = await handle.getFile();
      if (file.size > maxStringLengthForTests) {
        throw stringLengthRangeError(name);
      }
      return await file.text();
    } catch (error) {
      if (isNotFoundError(error)) {
        if (missingAttempts < missingRetries) {
          lastMissingError = error;
          await wait(TRANSIENT_WRITE_RETRY_DELAYS_MS[missingAttempts]!);
          missingAttempts += 1;
          continue;
        }
        if (options?.retryMissing) {
          await logExhaustedNotFound(
            "safeWrite:verify-read-missing",
            dir,
            name,
            missingAttempts + 1,
            lastMissingError ?? error
          );
        }
        return null;
      }
      if (isNotReadableError(error) && unreadableAttempts < NOT_READABLE_RETRY_DELAYS_MS.length) {
        await wait(NOT_READABLE_RETRY_DELAYS_MS[unreadableAttempts]!);
        unreadableAttempts += 1;
        continue;
      }
      throw error;
    }
  }
}

/**
 * What one file read produced, WITHOUT deciding what it means.
 *
 * `damaged` is a file that exists but cannot be read as the format its own first
 * bytes claim — today only a compressed member whose gzip CRC32/ISIZE check
 * failed. It is deliberately distinct from "missing": safeReadJson must fall
 * through to `.bak`/`.tmp` for it (as it does for unparseable JSON) and must
 * report `corrupt`, not `missing`.
 */
type FileContent =
  | { kind: "plain"; text: string }
  | { kind: "compressed"; head: CompressedHead; bodyText: string }
  | { kind: "damaged" };

/**
 * Format-aware read: opens the file ONCE, classifies it from a bounded head
 * window, and returns either its text or its decompressed body.
 *
 * The extra cost over `readText` for a plain file is a single `Blob.slice` of at
 * most {@link HEAD_PROBE_BYTES} — and for the great majority of workspace files,
 * which are smaller than that window, it is not even a second read of anything.
 * That is the whole price of making dual read automatic everywhere instead of
 * conditioning it on a policy table the reader would have to trust.
 */
async function readContent(
  dir: DirectoryHandleLike,
  name: string,
  options?: ReadTextOptions
): Promise<FileContent | null> {
  let unreadableAttempts = 0;
  for (;;) {
    const file = await openFile(dir, name, options);
    if (file === null) return null;
    try {
      const window = new Uint8Array(
        await file.slice(0, Math.min(HEAD_PROBE_BYTES, file.size)).arrayBuffer()
      );
      const classified = classifyHeadWindow(window, file.size);
      if (classified.kind === "compressed") {
        const parts: string[] = [];
        try {
          await streamCompressedBody(file, classified.bodyStart, (chunk) => {
            parts.push(chunk);
          });
        } catch {
          // A rejection means "discard everything received" (see
          // streamCompressedBody's contract) — never keep the partial body.
          return { kind: "damaged" };
        }
        return { kind: "compressed", head: classified.head, bodyText: parts.join("") };
      }
      if (file.size > maxStringLengthForTests) {
        throw stringLengthRangeError(name);
      }
      return { kind: "plain", text: await file.text() };
    } catch (error) {
      if (isNotReadableError(error) && unreadableAttempts < NOT_READABLE_RETRY_DELAYS_MS.length) {
        await wait(NOT_READABLE_RETRY_DELAYS_MS[unreadableAttempts]!);
        unreadableAttempts += 1;
        continue;
      }
      throw error;
    }
  }
}

/**
 * Which format a file on disk is in, with the same transient-error tolerance as
 * every other read here.
 *
 * `compressedEnvelope.probeFileFormat` does the same classification, but through
 * its own bare `getFileHandle` — it has no NotReadableError retry, because
 * retries are this module's job. Everything inside safeWrite goes through this
 * wrapper instead so a file that is briefly unreadable (a concurrent write, a
 * sync client, antivirus) is retried rather than misreported.
 */
async function classifyFile(
  dir: DirectoryHandleLike,
  name: string,
  options?: ReadTextOptions
): Promise<{ kind: "missing" } | { kind: "plain" } | { kind: "compressed"; head: CompressedHead }> {
  let unreadableAttempts = 0;
  for (;;) {
    const file = await openFile(dir, name, options);
    if (file === null) return { kind: "missing" };
    try {
      const window = new Uint8Array(
        await file.slice(0, Math.min(HEAD_PROBE_BYTES, file.size)).arrayBuffer()
      );
      const classified = classifyHeadWindow(window, file.size);
      return classified.kind === "compressed"
        ? { kind: "compressed", head: classified.head }
        : { kind: "plain" };
    } catch (error) {
      if (isNotReadableError(error) && unreadableAttempts < NOT_READABLE_RETRY_DELAYS_MS.length) {
        await wait(NOT_READABLE_RETRY_DELAYS_MS[unreadableAttempts]!);
        unreadableAttempts += 1;
        continue;
      }
      throw error;
    }
  }
}

/** Is this file stored in the compressed format? Missing counts as "no". */
export async function isCompressedFile(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<boolean> {
  return (await classifyFile(dir, fileName)).kind === "compressed";
}

/**
 * Dual-read file text for callers outside this module that want the DECODED
 * content of a file regardless of how it is framed — a compressed file yields
 * its decompressed body, a plain file its verbatim text. Returns null for a
 * missing or damaged file.
 *
 * Distinct from {@link readFileTextWithRetry}, which is deliberately raw: a
 * caller copying bytes around (backup) must not decode, while a caller about to
 * `JSON.parse` (the Population Browse worker feed) must.
 */
export async function readDecodedFileText(
  dir: DirectoryHandleLike,
  name: string
): Promise<string | null> {
  const content = await readContent(dir, name);
  if (content === null || content.kind === "damaged") return null;
  return content.kind === "compressed" ? content.bodyText : content.text;
}

/**
 * Public wrapper around this module's own transient-NotReadableError-retry
 * read path (see NOT_READABLE_RETRY_DELAYS_MS above), for callers outside
 * this file that read raw file text directly (not through safeReadJson's
 * envelope parsing) and want the same tolerance.
 *
 * Added for src/data/backup/backupStorage.ts's copyAllJsonFiles/
 * restoreJsonTree: their own readTextFile previously had no retry at all, so
 * a file that was briefly unreadable while another write was mid-flight (a
 * concurrent safeWriteJson elsewhere, a sync client, antivirus) failed the
 * whole backup/restore immediately instead of getting the same short,
 * bounded retry safeReadJson already gets. Widening that walk's concurrency
 * from 1 to 8 (mapWithConcurrency) made this more likely to be hit in
 * practice by increasing how many file handles are open at once, which is
 * what surfaced it as a real user-facing NotReadableError.
 *
 * Same contract as readText: returns null for a missing file, retries a
 * transient NotReadableError with the same bounded backoff, and still
 * throws once retries are exhausted (or for any other error) — a genuinely
 * failed read must keep failing the caller rather than silently producing a
 * partial backup/restore.
 */
export async function readFileTextWithRetry(
  dir: DirectoryHandleLike,
  name: string
): Promise<string | null> {
  return readText(dir, name);
}

// ── Chunked reading: the only way a file above V8's max string length is read ──
//
// `file.text()` decodes the whole file into ONE JavaScript string. Past
// ~536,870,888 UTF-16 code units V8 cannot represent that string at all and
// throws `RangeError: Invalid string length`. Real customer data is already at
// 85% of that ceiling (a 573 MB bi.raw.json decodes to ~456M code units), and
// the streamed write path used to verify its own output with exactly that call
// — so the write that existed *because* the payload was too large to serialize
// as one string then turned around and required it as one string on read-back.
//
// Everything below reads through `Blob.slice()` byte windows instead, so peak
// memory is one window regardless of file size.
//
// Slicing happens on BYTE boundaries, which will land in the middle of a
// multi-byte UTF-8 character (Arabic content guarantees it). A single streaming
// `TextDecoder` carries the incomplete sequence across the window boundary, so
// the concatenation of the emitted chunks is byte-for-byte what `file.text()`
// would have returned — which is what keeps the existing text-domain
// `simpleHash` / `fileLength` semantics intact rather than migrating them.
const READ_SLICE_BYTES = 4 * 1024 * 1024;

type ChunkSink = (chunk: string) => Promise<void> | void;

/**
 * Same NotFound/NotReadable retry ladder as `readText` (see its options doc),
 * but stops at the `File` instead of decoding it. Returns null for a file that
 * is genuinely absent.
 */
async function openFile(
  dir: DirectoryHandleLike,
  name: string,
  options?: ReadTextOptions
): Promise<File | null> {
  const missingRetries = options?.retryMissing ? TRANSIENT_WRITE_RETRY_DELAYS_MS.length : 0;
  let missingAttempts = 0;
  let unreadableAttempts = 0;
  let lastMissingError: unknown = null;
  for (;;) {
    try {
      const handle = await dir.getFileHandle(name, { create: false });
      return await handle.getFile();
    } catch (error) {
      if (isNotFoundError(error)) {
        if (missingAttempts < missingRetries) {
          lastMissingError = error;
          await wait(TRANSIENT_WRITE_RETRY_DELAYS_MS[missingAttempts]!);
          missingAttempts += 1;
          continue;
        }
        if (options?.retryMissing) {
          await logExhaustedNotFound(
            "safeWrite:verify-read-missing",
            dir,
            name,
            missingAttempts + 1,
            lastMissingError ?? error
          );
        }
        return null;
      }
      if (isNotReadableError(error) && unreadableAttempts < NOT_READABLE_RETRY_DELAYS_MS.length) {
        await wait(NOT_READABLE_RETRY_DELAYS_MS[unreadableAttempts]!);
        unreadableAttempts += 1;
        continue;
      }
      throw error;
    }
  }
}

/**
 * Feeds a file to `onChunk` as decoded text windows, never holding more than one
 * window. Returns false when the file is missing (same "absent is not an error"
 * contract as `readText`); any other failure still throws.
 */
async function streamFileChunks(
  dir: DirectoryHandleLike,
  name: string,
  onChunk: ChunkSink,
  options?: ReadTextOptions
): Promise<boolean> {
  let file = await openFile(dir, name, options);
  if (file === null) {
    return false;
  }
  const size = file.size;
  const decoder = new TextDecoder("utf-8");
  // One window, with the same bounded NotReadableError tolerance every other
  // read here gets.
  const readWindow = async (start: number, end: number): Promise<ArrayBuffer> => {
    let unreadableAttempts = 0;
    for (;;) {
      try {
        return await file!.slice(start, end).arrayBuffer();
      } catch (error) {
        if (
          isNotReadableError(error) &&
          unreadableAttempts < NOT_READABLE_RETRY_DELAYS_MS.length
        ) {
          await wait(NOT_READABLE_RETRY_DELAYS_MS[unreadableAttempts]!);
          unreadableAttempts += 1;
          // The handle can go stale while another process swaps the file; re-open
          // it, but only adopt the replacement when it is still the same file by
          // size — otherwise keep failing rather than splicing two versions.
          const reopened = await openFile(dir, name, options);
          if (reopened !== null && reopened.size === size) {
            file = reopened;
          }
          continue;
        }
        throw error;
      }
    }
  };
  for (let offset = 0; offset < size; offset += READ_SLICE_BYTES) {
    const buffer = await readWindow(offset, Math.min(offset + READ_SLICE_BYTES, size));
    const text = decoder.decode(new Uint8Array(buffer), { stream: true });
    if (text.length > 0) {
      const pending = onChunk(text);
      if (pending) await pending;
    }
  }
  // Flush: emits U+FFFD for a truncated trailing sequence, exactly as
  // `file.text()` would — a truncated file must fail verification, not be
  // silently trimmed to a shorter valid string.
  const tail = decoder.decode();
  if (tail.length > 0) {
    const pending = onChunk(tail);
    if (pending) await pending;
  }
  return true;
}

/**
 * Whole-content write. Idempotent by construction — it re-opens the handle with
 * `{ create: true }` and writes the complete `content` every time — so a retry
 * after a transient failure produces exactly the same end state as a first
 * attempt. That is what makes it safe to wrap in retryTransientWrite: on a
 * UNC/SMB share `getFileHandle`/`createWritable` can raise NotFoundError for a
 * directory that is perfectly reachable a few milliseconds later.
 */
async function writeText(
  dir: DirectoryHandleLike,
  name: string,
  content: string
): Promise<void> {
  await retryTransientWrite(
    async () => {
      const handle = await dir.getFileHandle(name, { create: true });
      if (!handle.createWritable) {
        throw new Error(`Browser cannot write ${name}.`);
      }
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    },
    { context: "safeWrite:writeText", dir, fileName: name }
  );
}

async function removeQuietly(
  dir: DirectoryHandleLike,
  name: string
): Promise<void> {
  try {
    await dir.removeEntry?.(name);
  } catch {
    // best-effort cleanup — a leftover .tmp is harmless and overwritten next write
  }
}

// Above this size, a read validates the envelope's structure but does not
// recompute its content hash.
//
// `hashJsonValue` re-serializes the whole payload, so the check costs O(payload)
// and — measured on a 500k-row month — spends ~35s of blocked main thread on top
// of a ~7s JSON.parse, i.e. the integrity check cost ~5x more than parsing the
// file it checked. It ran on *every* parse with no threshold, so it was paid by
// every replacement confirm, referral approval, report and export.
//
// What is retained: corruption that breaks JSON syntax is still caught by
// JSON.parse, and a structurally invalid envelope is still rejected — both still
// fall back to `.bak`. Small files (the contended, frequently-rewritten ones)
// still get the full hash check, because at this size it is microseconds.
// Large payloads instead rely on the write path's byte-exact read-back
// comparison, which is a strictly stronger guarantee than re-hashing, and on
// `verifyContentHash` being called explicitly by integrity scanning.
const HASH_VERIFY_SIZE_LIMIT = 512 * 1024; // 512 KB

function parseValidJson(text: string | null): unknown | null {
  if (text === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (!validateEnvelopeStructure(parsed)) {
      return null;
    }
    if (text.length <= HASH_VERIFY_SIZE_LIMIT && !verifyContentHash(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Phase 1.3 removed VERIFY_SIZE_LIMIT: read-back verification is now byte-exact
// at every size, so there is no longer a threshold at which the check weakens.

// Phase 1.10: above this size a file is written compact rather than 2-space
// indented. Pretty-printing exists so a human can open a workspace file in a
// text editor; that stops being useful long before 512 KB, and the indentation
// measured 1.35x inflation on every byte written, read, hashed and sent over
// the share. 64 KB keeps every genuinely hand-inspectable file readable while
// taking the inflation off the mid-size contended files.
const PRETTY_PRINT_SIZE_LIMIT = 64 * 1024; // 64 KB

// A RangeError thrown by JSON.stringify when its output would exceed the
// engine's max string length. When this is hit, fall back to the streamed
// write path, which never materializes the whole serialization.
//
// Classified by error.name (like casLoop.ts does — see its comment), not by
// matching the whole message: V8's wording for this differs by context.
// Chromium/the browser's JSON.stringify throws "Invalid string length", but
// under Node the same failure reads "Cannot create a string longer than
// 0x1fffffe8 characters". Matching only the browser wording left the
// streaming fallback dead under Node — the write just failed outright. Both
// known wordings are tolerated here so detection is robust regardless of
// engine.
function isStringLengthError(error: unknown): boolean {
  if (!(error instanceof RangeError) && errorName(error) !== "RangeError") {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    /invalid string length/i.test(message) ||
    /string longer than/i.test(message)
  );
}

// Test seam: force the streamed-write path for payloads below the real V8
// ceiling so it can be exercised without allocating a ~512 MB string.
// Production never lowers this; streaming otherwise triggers only when
// JSON.stringify throws (see isStringLengthError).
let streamingForcedSizeLimit = Number.POSITIVE_INFINITY;

/** @internal — test-only. Lower the threshold that forces the streamed path. */
export function __setStreamingForcedSizeLimitForTests(limit: number): void {
  streamingForcedSizeLimit = limit;
}

/** @internal — test-only. Restore the production (effectively unbounded) limit. */
export function __resetStreamingForcedSizeLimitForTests(): void {
  streamingForcedSizeLimit = Number.POSITIVE_INFINITY;
}

type StreamedFileInfo = { fileHash: string; fileLength: number };

// Flush accumulated chunks to disk every ~64 KB so the in-flight string stays
// tiny regardless of total file size.
const STREAM_FLUSH_AT = 64 * 1024;

// Core streamed writer: hands `produce` an `emit` that hashes + buffers each
// chunk and flushes to the writable stream past STREAM_FLUSH_AT, so no single
// giant string is ever built. Returns an exact whole-file content hash + length
// used to verify the bytes on read-back.
async function streamToFile(
  dir: DirectoryHandleLike,
  fileName: string,
  produce: (emit: (chunk: string) => Promise<void> | void) => Promise<void>
): Promise<StreamedFileInfo> {
  const handle = await dir.getFileHandle(fileName, { create: true });
  if (!handle.createWritable) {
    throw new Error(`Browser cannot write ${fileName}.`);
  }
  const writable = await handle.createWritable();

  const fileHasher = createSimpleHasher();
  let fileLength = 0;
  let pending = "";

  const emit = (chunk: string): Promise<void> | void => {
    fileHasher.update(chunk);
    fileLength += chunk.length;
    pending += chunk;
    if (pending.length >= STREAM_FLUSH_AT) {
      const toWrite = pending;
      pending = "";
      return writable.write(toWrite);
    }
  };

  try {
    await produce(emit);
    if (pending.length > 0) {
      await writable.write(pending);
    }
    await writable.close();
  } catch (error) {
    try {
      await writable.close();
    } catch {
      // Best-effort: don't mask the original failure with a close error.
    }
    throw error;
  }

  return { fileHash: fileHasher.digest(), fileLength };
}

// Streams a JsonEnvelope as `{"data":<streamed>,"metadata":{…}}`. `data` is
// emitted first so its content hash is known before the metadata (which carries
// it) is written; key order is irrelevant to isEnvelope/unwrap/validateEnvelope.
function streamEnvelopeToFile(
  dir: DirectoryHandleLike,
  fileName: string,
  data: unknown,
  buildMetadata: (contentHash: string) => JsonMetadata
): Promise<StreamedFileInfo> {
  return streamToFile(dir, fileName, async (emit) => {
    const dataHasher = createSimpleHasher();
    {
      const p = emit('{"data":');
      if (p) await p;
    }
    for (const chunk of streamJsonStringify(data)) {
      dataHasher.update(chunk);
      const p = emit(chunk);
      if (p) await p;
    }
    const metadata = buildMetadata(dataHasher.digest());
    const p = emit(`,"metadata":${JSON.stringify(metadata)}}\n`);
    if (p) await p;
  });
}

// Streams a value verbatim (compact) + trailing newline — used to re-normalize a
// restore payload without re-wrapping it (safeWriteJsonText).
function streamValueToFile(
  dir: DirectoryHandleLike,
  fileName: string,
  value: unknown
): Promise<StreamedFileInfo> {
  return streamToFile(dir, fileName, async (emit) => {
    for (const chunk of streamJsonStringify(value)) {
      const p = emit(chunk);
      if (p) await p;
    }
    const p = emit("\n");
    if (p) await p;
  });
}

// Verifies a streamed file by re-reading it in bounded windows and folding the
// SAME rolling hash `streamToFile` computed on the way out over the read-back
// chunks. Byte-exact and unchanged in strength — length + whole-file content
// hash over the identical text domain — but it never materializes the file as
// one string, so it works at any size.
//
// (This is what used to be `readVerifiedStreamedFile`, which read the staged
// file back with `file.text()` and therefore capped the entire streamed write
// path at V8's max string length: the very limit that path exists to escape.)
async function verifyStreamedFile(
  dir: DirectoryHandleLike,
  fileName: string,
  expected: StreamedFileInfo
): Promise<boolean> {
  const hasher = createSimpleHasher();
  let length = 0;
  // Verification read-back of a file this call just closed — a "not found" here
  // is share latency, not absence, so it gets the opt-in retry.
  const found = await streamFileChunks(
    dir,
    fileName,
    (chunk) => {
      hasher.update(chunk);
      length += chunk.length;
    },
    { retryMissing: true }
  );
  return found && length === expected.fileLength && hasher.digest() === expected.fileHash;
}

// Phase 1.4: commits an already-staged-and-verified file by copying its exact
// bytes, instead of re-running the whole serialization (streamJsonStringify
// walks the entire object graph a second time — for a large month that is the
// single most expensive step of the write, and it produced bytes that were by
// construction identical to the .tmp we had just proved correct).
//
// It is still a real write of the full content (there is no rename/copy
// primitive on FileHandleLike, and `createWritable` accepts strings only), so
// the commit is unchanged from disk's point of view: same chunk size, same
// per-chunk hashing, same StreamedFileInfo used for the post-commit byte-exact
// verification. Only the serialization is not repeated — and, unlike the
// previous version, the source bytes flow through in windows rather than as one
// verified string.
function copyFileStreamed(
  dir: DirectoryHandleLike,
  sourceName: string,
  targetName: string
): Promise<StreamedFileInfo> {
  return streamToFile(dir, targetName, async (emit) => {
    const found = await streamFileChunks(dir, sourceName, emit, { retryMissing: true });
    if (!found) {
      throw new Error(`Safe-write cannot copy missing file ${sourceName}.`);
    }
  });
}

// ── Oversized existing files ────────────────────────────────────────────────
//
// A file already on disk that is too large to hold as one string cannot be read
// with `readText` at all, and `safeWriteJson` reads the existing file on EVERY
// write (for the previous revision and for the `.bak` snapshot). Left alone
// that would simply move the ceiling from "verify the file we just wrote" to
// "re-save a month that was written once already".

type ExistingFileRead =
  | { kind: "missing" }
  | { kind: "text"; text: string }
  | { kind: "oversized" };

async function readTextTolerant(
  dir: DirectoryHandleLike,
  name: string,
  options?: ReadTextOptions
): Promise<ExistingFileRead> {
  try {
    const text = await readText(dir, name, options);
    return text === null ? { kind: "missing" } : { kind: "text", text };
  } catch (error) {
    if (!isStringLengthError(error)) throw error;
    return { kind: "oversized" };
  }
}

// The streamed writer emits `{"data":…,"metadata":{…}}` — metadata LAST, so a
// bounded tail window is enough to recover it. Any file big enough to reach
// this code was necessarily written by that path.
const METADATA_TAIL_BYTES = 64 * 1024;

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

/**
 * Envelope metadata of a file too large to parse, read from its tail.
 *
 * This is deliberately weaker than `parseValidJson`: the payload cannot be
 * parsed, so "the file ends in a well-formed envelope header" is the strongest
 * available statement about a pre-existing oversized file. It is used only to
 * decide (a) the revision to continue from and (b) whether the file is worth
 * snapshotting to `.bak` — never to accept unverified content as the result of
 * a write. Every file this call writes is still verified byte-exactly.
 */
async function readOversizedEnvelopeMetadata(
  dir: DirectoryHandleLike,
  name: string
): Promise<JsonMetadata | null> {
  const file = await openFile(dir, name);
  if (file === null || file.size === 0) return null;
  const start = Math.max(0, file.size - METADATA_TAIL_BYTES);
  const bytes = await file.slice(start, file.size).arrayBuffer();
  // The window may begin mid-character; the resulting replacement character is
  // harmless because only the `"metadata":` marker onwards is used.
  const text = new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  const marker = '"metadata":';
  const markerAt = text.lastIndexOf(marker);
  if (markerAt < 0) return null;
  const objectStart = text.indexOf("{", markerAt + marker.length);
  if (objectStart < 0) return null;
  const objectText = extractBalancedObject(text, objectStart);
  if (objectText === null) return null;
  try {
    const metadata = JSON.parse(objectText) as JsonMetadata;
    if (!validateEnvelopeStructure({ metadata, data: null })) return null;
    return typeof metadata.revision === "number" ? metadata : null;
  } catch {
    return null;
  }
}

/**
 * Head line of a compressed file recovered from text that was decoded as if the
 * file were plain.
 *
 * A compressed file read with `file.text()` comes back as its head line followed
 * by mojibake: the head is pure JSON text and decodes losslessly, while the gzip
 * member decodes to replacement characters. That is enough to recognize the
 * format and recover `revision` without a second read — which is what keeps
 * revision numbering continuous when a file crosses the policy's size gate in
 * either direction and changes format.
 *
 * Returns null for anything that is not a well-formed compressed head, so a
 * genuinely corrupt plain file is still treated as corrupt.
 */
function compressedHeadFromText(text: string | null): CompressedHead | null {
  if (text === null || text.length === 0 || text.charCodeAt(0) !== 0x7b) return null;
  // Bounded on purpose: a compact plain file's ONLY newline is the trailing one,
  // so an unbounded indexOf would scan hundreds of megabytes to learn nothing.
  // A valid head line is capped at HEAD_PROBE_BYTES bytes, and code units are
  // never more numerous than bytes, so this window cannot miss one.
  const head = text.slice(0, HEAD_PROBE_BYTES);
  const newlineAt = head.indexOf("\n");
  if (newlineAt < 0) return null;
  try {
    const parsed: unknown = JSON.parse(head.slice(0, newlineAt));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if ((parsed as { format?: unknown }).format !== COMPRESSED_FORMAT_ID) return null;
    if (!validateEnvelopeStructure({ metadata: parsed, data: null })) return null;
    return parsed as CompressedHead;
  } catch {
    return null;
  }
}

/**
 * Does this text — read as if the file were plain — actually come from a
 * compressed file?
 *
 * For callers that already hold a file's raw text and need to know whether it
 * must be treated as bytes instead (the backup and restore walks). Costs one
 * `indexOf` and, at most, one small `JSON.parse`, and needs no extra read.
 */
export function isCompressedFileText(text: string | null): boolean {
  return compressedHeadFromText(text) !== null;
}

/**
 * `.bak` snapshot of the current live file. Takes the already-read text when it
 * exists; falls back to a chunked copy for a file too large to hold as one
 * string, and to a BYTE copy for a compressed one (decoding a gzip member as
 * text and re-encoding it would not round-trip). Same rollback source either
 * way.
 */
async function snapshotToBak(
  dir: DirectoryHandleLike,
  fileName: string,
  currentText: string | null,
  currentIsCompressed = false
): Promise<void> {
  if (currentIsCompressed) {
    await copyFileBytes(dir, fileName, dir, `${fileName}.bak`);
    return;
  }
  if (currentText !== null) {
    await writeText(dir, `${fileName}.bak`, currentText);
    return;
  }
  await copyFileStreamed(dir, fileName, `${fileName}.bak`);
}

/**
 * Rolls the live file back to its `.bak` snapshot. Returns false when there is
 * no usable `.bak` (first write, or a corrupt snapshot), which is the caller's
 * signal to try `.tmp` promotion instead.
 */
async function rollbackFromBak(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<boolean> {
  const bakName = `${fileName}.bak`;
  // A compressed snapshot must be recognized before anything tries to read it as
  // text, and put back as bytes.
  const bakProbe = await classifyFile(dir, bakName);
  if (bakProbe.kind === "compressed") {
    if (!(await isRecoverableCompressedFile(dir, bakName))) return false;
    await copyFileBytes(dir, bakName, dir, fileName);
    return true;
  }
  const bak = await readTextTolerant(dir, bakName);
  if (bak.kind === "text") {
    if (parseValidJson(bak.text) === null) return false;
    await writeText(dir, fileName, bak.text);
    return true;
  }
  if (bak.kind === "oversized") {
    if ((await readOversizedEnvelopeMetadata(dir, bakName)) === null) return false;
    await copyFileStreamed(dir, bakName, fileName);
    return true;
  }
  return false;
}

// Observability only (B task 2) — the write itself is unchanged; these are
// fired around the same steps safeWriteJson already performs (up to 5 full-file
// passes for a large file: .bak snapshot, stage .tmp, verify
// staged, commit live, verify committed). Population.final.json-sized writes can
// take 10-15 minutes on a slow disk; before this, the UI's progress bar tracked
// only processPopulation's in-memory chunking, which finishes first — the write
// then ran invisibly past 100%. Optional and additive: existing call sites that
// don't pass a callback see no behavior change.
export type SafeWriteProgressPhase =
  | "backing-up"
  | "staging"
  | "verifying-staged"
  | "committing"
  | "verifying-committed";

export type SafeWriteProgressCallback = (phase: SafeWriteProgressPhase) => void;

function reportProgress(onProgress: SafeWriteProgressCallback | undefined, phase: SafeWriteProgressPhase): void {
  try {
    onProgress?.(phase);
  } catch {
    // A misbehaving UI callback must never abort or corrupt the write it's observing.
  }
}

// ── Compressed files ────────────────────────────────────────────────────────
//
// A file whose name is listed in `storagePolicy.ts` (and whose payload is large
// enough to be worth it) is written through `compressedEnvelope.ts`: a plain
// UTF-8 head line carrying the envelope metadata, then a gzip member carrying
// the body. The file NAME is unchanged, so nothing downstream has to learn a
// second name for the same logical file — the format is self-describing, and
// `classifyHeadWindow`'s four gates tell the two apart with no ambiguity.
//
// Dual read is permanent, not a migration window: every read below classifies
// the file it opened and handles whichever format it finds. There is no
// migration step, no rewrite-on-read, and a workspace may hold both forms of
// different files (or of the same file across months) indefinitely.
//
// ── contentHash on a compressed file ────────────────────────────────────────
//
// The whole point of the head line is that it is readable in O(1), which means
// it is written BEFORE the body it describes. A hash of the body therefore
// cannot appear in it without serializing the payload twice — the single most
// expensive step of the write, on exactly the files that made it expensive.
//
// So a compressed head carries only what is known upfront (schemaVersion,
// revision, writtenAt, and any caller token such as casLoop's `_writeToken`),
// and its `contentHash` is the empty-string sentinel below. Integrity is not
// weakened by this:
//
//  - the write path verifies the staged and the committed file byte-exactly
//    against the `bodyHash` + `bodyLength` `writeCompressedFile` already
//    returned, plus the exact head-line bytes and the exact total file size;
//  - gzip's own CRC32 + ISIZE trailer are checked by `DecompressionStream` on
//    EVERY read, so a truncated or flipped byte is a hard read error rather
//    than a short body — a guarantee the plain format never had;
//  - and since v79 the plain format does not verify `contentHash` on read above
//    512 KB either (see HASH_VERIFY_SIZE_LIMIT). Compressed files are, by the
//    policy's size gate, exactly the files that were already past it.
const COMPRESSED_CONTENT_HASH = "";

const BYTE_COPY_SLICE_BYTES = 4 * 1024 * 1024;

type BinaryWritable = {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
};

/**
 * `WritableFileStreamLike.write` is typed `string`-only in this repo because
 * nothing wrote bytes before compression existed; the real
 * `FileSystemWritableFileStream` has always accepted a BufferSource. Widening
 * the shared type would break every hand-written string-only test double, so the
 * widening stays confined to the two call sites that need it (here and in
 * `compressedEnvelope.ts`).
 */
async function openBinaryWritable(
  dir: DirectoryHandleLike,
  name: string
): Promise<BinaryWritable> {
  const handle = await dir.getFileHandle(name, { create: true });
  // `createWritable` is optional on FileHandleLike (read-only handle, or a
  // browser without the write half of the API) — guarded, never assumed.
  if (!handle.createWritable) {
    throw new Error(`Browser cannot write ${name}.`);
  }
  return (await handle.createWritable()) as unknown as BinaryWritable;
}

/**
 * Byte-for-byte copy of one file to another, in bounded windows.
 *
 * The text-based copy paths above cannot be used for a compressed file: decoding
 * a gzip member as UTF-8 and re-encoding it is lossy, so a `.bak` snapshot, a
 * commit or a backup taken that way would be silent corruption. This moves the
 * exact bytes and is therefore format-agnostic — it is equally correct for a
 * plain JSON file, which is why the backup walk can use it without knowing which
 * format it is holding.
 *
 * Idempotent (it rewrites the whole target through a freshly opened handle), so
 * it is safe under `retryTransientWrite`. Throws when the source is missing.
 */
export async function copyFileBytes(
  sourceDir: DirectoryHandleLike,
  sourceName: string,
  targetDir: DirectoryHandleLike,
  targetName: string
): Promise<number> {
  return retryTransientWrite(
    async () => {
      const file = await openFile(sourceDir, sourceName, { retryMissing: true });
      if (file === null) {
        throw new Error(`Safe-write cannot copy missing file ${sourceName}.`);
      }
      const writable = await openBinaryWritable(targetDir, targetName);
      try {
        for (let offset = 0; offset < file.size; offset += BYTE_COPY_SLICE_BYTES) {
          const end = Math.min(offset + BYTE_COPY_SLICE_BYTES, file.size);
          const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
          await writable.write(bytes);
        }
        await writable.close();
      } catch (error) {
        try {
          await writable.close();
        } catch {
          // Best-effort: never mask the original failure with a close error.
        }
        throw error;
      }
      return file.size;
    },
    { context: "safeWrite:copyFileBytes", dir: targetDir, fileName: targetName }
  );
}

/**
 * Coalesces a token-sized chunk stream into ~{@link STREAM_FLUSH_AT} windows.
 *
 * `streamJsonStringify` yields one chunk per JSON token — a key, a comma, a
 * brace — which is exactly right for a hasher and exactly wrong for a stream
 * pipeline: every chunk handed to `writeCompressedFile` costs an encode, an
 * enqueue and a trip through `CompressionStream`'s queue. Measured on an
 * 80,000-row payload, feeding the raw token stream took **>20 s** while the gzip
 * work itself was ~0.1 s; batching first brings the whole write back to the
 * cost of the compression. The plain streamed writer already batches for the
 * same reason (that is what STREAM_FLUSH_AT is), so this keeps the two paths
 * feeding disk in the same size windows.
 */
function* coalesceChunks(chunks: Iterable<string>): Generator<string> {
  let pending = "";
  for (const chunk of chunks) {
    pending += chunk;
    if (pending.length >= STREAM_FLUSH_AT) {
      yield pending;
      pending = "";
    }
  }
  if (pending.length > 0) yield pending;
}

type CompressedExpectation = {
  /** The head object as stamped on disk, `format` key included. */
  head: CompressedHead;
  headBytes: number;
  totalBytes: number;
  bodyHash: string;
  bodyLength: number;
};

function expectationFor(
  head: CompressedHeadInput,
  written: CompressedWriteResult
): CompressedExpectation {
  return {
    head: { ...head, format: COMPRESSED_FORMAT_ID },
    headBytes: written.headBytes,
    totalBytes: written.totalBytes,
    bodyHash: written.bodyHash,
    bodyLength: written.bodyLength,
  };
}

/**
 * Byte-exact read-back verification of a compressed file — the compressed
 * counterpart of `verifyStreamedFile`, and deliberately no weaker:
 *
 *  - total file size must equal what was written;
 *  - the head line must be the same length in bytes AND parse to the same JSON
 *    (same keys, same order, so the two are byte-identical);
 *  - the body must inflate — gzip's CRC32/ISIZE are checked here — and fold to
 *    the same rolling hash AND the same code-unit length as the text that was
 *    compressed.
 *
 * Nothing here is a length-only check, and nothing materializes the file.
 */
async function verifyCompressedFile(
  dir: DirectoryHandleLike,
  fileName: string,
  expected: CompressedExpectation
): Promise<boolean> {
  // Read-back of a file this call just closed: a "not found" is share latency,
  // not absence, so it gets the opt-in retry.
  const file = await openFile(dir, fileName, { retryMissing: true });
  if (file === null || file.size !== expected.totalBytes) return false;

  const window = new Uint8Array(
    await file.slice(0, Math.min(HEAD_PROBE_BYTES, file.size)).arrayBuffer()
  );
  const classified = classifyHeadWindow(window, file.size);
  if (classified.kind !== "compressed") return false;
  if (classified.bodyStart !== expected.headBytes) return false;
  if (JSON.stringify(classified.head) !== JSON.stringify(expected.head)) return false;

  const hasher = createSimpleHasher();
  let length = 0;
  try {
    await streamCompressedBody(file, classified.bodyStart, (chunk) => {
      hasher.update(chunk);
      length += chunk.length;
    });
  } catch {
    // A damaged member (CompressedReadError) is a failed verification, not an
    // exception to propagate — the caller's rollback ladder handles it.
    return false;
  }
  return length === expected.bodyLength && hasher.digest() === expected.bodyHash;
}

/**
 * Is this `.bak` a compressed file we could roll back to? Validating it means
 * inflating the whole body (CRC32 included) without materializing it — the
 * strongest statement available, and affordable because this only ever runs on
 * the rollback path.
 */
async function isRecoverableCompressedFile(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<boolean> {
  const file = await openFile(dir, fileName);
  if (file === null) return false;
  const window = new Uint8Array(
    await file.slice(0, Math.min(HEAD_PROBE_BYTES, file.size)).arrayBuffer()
  );
  const classified = classifyHeadWindow(window, file.size);
  if (classified.kind !== "compressed") return false;
  try {
    await streamCompressedBody(file, classified.bodyStart, () => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * `readEnvelopeMetadata` with this module's transient-NotReadableError retry.
 * It lives in `compressedEnvelope.ts`, which deliberately does no retrying —
 * that is safeWrite's job, and the pre-write read of the existing file is
 * exactly where a briefly unreadable file must not fail the whole save.
 */
async function readEnvelopeMetadataTolerant(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<Awaited<ReturnType<typeof readEnvelopeMetadata>>> {
  let attempts = 0;
  for (;;) {
    try {
      return await readEnvelopeMetadata(dir, fileName);
    } catch (error) {
      if (isNotReadableError(error) && attempts < NOT_READABLE_RETRY_DELAYS_MS.length) {
        await wait(NOT_READABLE_RETRY_DELAYS_MS[attempts]!);
        attempts += 1;
        continue;
      }
      throw error;
    }
  }
}

/**
 * The write half of the compressed path. Same ladder as the streamed plain path
 * — `.bak` snapshot → stage `.tmp` → verify byte-exact → commit → re-verify →
 * rollback, else promote the verified `.tmp` — with two differences:
 *
 *  - the `.bak` snapshot and the commit are BYTE copies, not text copies, so the
 *    gzip member survives them intact (and the commit still does not re-run the
 *    serialization or the compression);
 *  - the existing file's revision comes from `readEnvelopeMetadata`, which reads
 *    a bounded window of either format. That is what keeps revision numbering
 *    continuous across a file's first compressed write — and, in the other
 *    direction, across a month that shrinks below the policy's size gate and
 *    goes back to plain JSON.
 */
async function writeCompressedJson<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  value: T,
  policy: StoragePolicy,
  onProgress: SafeWriteProgressCallback | undefined
): Promise<void> {
  const tmpName = `${fileName}.tmp`;
  const existing = await readEnvelopeMetadataTolerant(dir, fileName);
  const existingMetadata =
    existing.kind === "compressed"
      ? existing.metadata
      : existing.kind === "plain"
        ? existing.metadata
        : null;
  const hasCurrent = existingMetadata !== null;
  const previousRevision =
    typeof existingMetadata?.revision === "number" ? existingMetadata.revision : 0;

  const data = isEnvelope(value) ? value.data : value;
  const head: CompressedHeadInput = isEnvelope(value)
    ? { ...value.metadata, contentHash: COMPRESSED_CONTENT_HASH }
    : {
        schemaVersion: ENVELOPE_SCHEMA_VERSION,
        revision: previousRevision + 1,
        contentHash: COMPRESSED_CONTENT_HASH,
        writtenAt: new Date().toISOString(),
      };
  // Columnar encoding happens ONCE, before staging; the commit copies the bytes
  // it produced rather than re-encoding them.
  const payload = policy.columnar ? encodePayloadColumns(data) : data;

  // 1. Snapshot the current good file (either format) to .bak.
  if (hasCurrent) {
    reportProgress(onProgress, "backing-up");
    await copyFileBytes(dir, fileName, dir, `${fileName}.bak`);
  }

  // 2. Stage, then verify the exact bytes landed BEFORE touching the live file.
  reportProgress(onProgress, "staging");
  let staged: CompressedExpectation;
  try {
    staged = expectationFor(
      head,
      await writeCompressedFile(dir, tmpName, head, coalesceChunks(streamJsonStringify(payload)))
    );
  } catch (error) {
    // Never leave a partial .tmp behind (same reasoning as the streamed path).
    await removeQuietly(dir, tmpName);
    throw error;
  }
  reportProgress(onProgress, "verifying-staged");
  if (!(await verifyCompressedFile(dir, tmpName, staged))) {
    await removeQuietly(dir, tmpName);
    throw new Error(`Safe-write staging failed for ${fileName}.`);
  }

  // 3. Commit the verified bytes, then re-verify what actually landed live.
  reportProgress(onProgress, "committing");
  await copyFileBytes(dir, tmpName, dir, fileName);
  reportProgress(onProgress, "verifying-committed");
  if (!(await verifyCompressedFile(dir, fileName, staged))) {
    if (await rollbackFromBak(dir, fileName)) {
      await removeQuietly(dir, tmpName);
      throw new Error(
        `Safe-write validation failed for ${fileName}; rolled back to previous version.`
      );
    }
    // No usable .bak: the staged .tmp WAS verified before the commit — promote
    // it rather than lose the data, re-verifying against what is on disk now.
    if (await verifyCompressedFile(dir, tmpName, staged)) {
      try {
        await copyFileBytes(dir, tmpName, dir, fileName);
        if (await verifyCompressedFile(dir, fileName, staged)) {
          await removeQuietly(dir, tmpName);
          return; // recovered — the write succeeded via promotion
        }
      } catch {
        // Promotion is the last-resort recovery attempt; its own failure must
        // still end in the "staged copy kept as .tmp" outcome below.
      }
    }
    throw new Error(
      `Safe-write validation failed for ${fileName}; staged copy kept as ${tmpName}.`
    );
  }

  // 4. Best-effort cleanup of the temp file.
  await removeQuietly(dir, tmpName);
}

export type SafeWriteJsonOptions = {
  /** Observability only — see SafeWriteProgressPhase. */
  onProgress?: SafeWriteProgressCallback;
  /**
   * Overrides the per-file storage policy (`storagePolicy.ts`) for this one
   * write. Pass `PLAIN_JSON_POLICY` to force plain JSON for a file the table
   * would otherwise compress, or a compressing policy to opt a file in
   * explicitly. Omitted, the table decides — and the table's default is plain.
   */
  policy?: StoragePolicy;
};

function normalizeWriteOptions(
  options: SafeWriteProgressCallback | SafeWriteJsonOptions | undefined
): SafeWriteJsonOptions {
  if (typeof options === "function") return { onProgress: options };
  return options ?? {};
}

/**
 * Decides how this write is framed. Compression requires ALL of:
 *  - an opt-in (the file's policy, or an explicit per-call override);
 *  - a payload large enough to be worth it (`payloadQualifiesForCompression`);
 *  - a runtime with native gzip streams — absent them the write silently and
 *    correctly falls back to plain JSON rather than failing.
 */
function shouldCompress(
  fileName: string,
  value: unknown,
  override: StoragePolicy | undefined
): StoragePolicy | null {
  const policy = override ?? resolveStoragePolicy(fileName);
  if (!policy.compress) return null;
  const data = isEnvelope(value) ? value.data : value;
  if (!payloadQualifiesForCompression(data)) return null;
  if (!isCompressionSupported()) return null;
  return policy;
}

export async function safeWriteJson<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  value: T,
  options?: SafeWriteProgressCallback | SafeWriteJsonOptions
): Promise<void> {
  assertWritableMode();

  const { onProgress, policy: policyOverride } = normalizeWriteOptions(options);
  const compressPolicy = shouldCompress(fileName, value, policyOverride);
  if (compressPolicy) {
    await withWorkspaceWriteAccess(dir, () =>
      withResourceLock(directoryResourceKey(dir, fileName), () =>
        writeCompressedJson(dir, fileName, value, compressPolicy, onProgress)
      )
    );
    return;
  }

  const tmpName = `${fileName}.tmp`;

  // Lock per directory+file so same-named files in different folders don't contend.
  await withWorkspaceWriteAccess(dir, () =>
    withResourceLock(directoryResourceKey(dir, fileName), async () => {
    const currentRead = await readTextTolerant(dir, fileName);
    const current = currentRead.kind === "text" ? currentRead.text : null;
    const parsedCurrent = parseValidJson(current);
    // An existing file past the engine's max string length cannot be read as
    // one string, let alone JSON.parsed — recover its envelope header from the
    // file's tail so a re-save neither restarts revision numbering nor skips
    // the `.bak` snapshot.
    const oversizedMetadata =
      currentRead.kind === "oversized"
        ? await readOversizedEnvelopeMetadata(dir, fileName)
        : null;
    // The live file may be COMPRESSED even though this write is a plain one —
    // the same month re-saved below the policy's size gate, or a name dropped
    // from the policy table. Its head line survives the text decode, so the
    // revision continues and the snapshot is still taken (as bytes).
    const currentCompressedHead =
      parsedCurrent === null && oversizedMetadata === null
        ? compressedHeadFromText(current)
        : null;
    const hasCurrent =
      parsedCurrent !== null || oversizedMetadata !== null || currentCompressedHead !== null;
    const previousRevision =
      parsedCurrent &&
      isEnvelope(parsedCurrent) &&
      typeof parsedCurrent.metadata.schemaVersion === "number"
        ? parsedCurrent.metadata.revision
        : (oversizedMetadata?.revision ?? currentCompressedHead?.revision ?? 0);
    // Try to build the whole-envelope string. Pretty-printing inflates output,
    // so serialize compactly first and only re-indent when small enough. If even
    // the compact result would exceed V8's max string length, JSON.stringify
    // throws RangeError and we fall back to the streamed path below.
    let nextValue: unknown = null;
    let compact: string | null = null;
    try {
      nextValue = isEnvelope(value) ? value : wrap(value, previousRevision);
      compact = JSON.stringify(nextValue);
    } catch (error) {
      if (!isStringLengthError(error)) throw error;
    }

    // Streamed path: the serialized envelope is too large to hold as one string
    // (or a test forced this path). Serialize + hash incrementally so nothing
    // giant is ever materialized; snapshot-and-verify/.bak semantics preserved.
    if (compact === null || compact.length > streamingForcedSizeLimit) {
      const data = isEnvelope(value) ? value.data : value;
      const writtenAt = new Date().toISOString();
      const buildMetadata: (contentHash: string) => JsonMetadata = isEnvelope(
        value
      )
        ? () => value.metadata
        : (contentHash) => ({
            schemaVersion: ENVELOPE_SCHEMA_VERSION,
            revision: previousRevision + 1,
            contentHash,
            writtenAt,
          });

      // 1. Snapshot the current good file to .bak (the rollback source).
      if (hasCurrent) {
        reportProgress(onProgress, "backing-up");
        await snapshotToBak(dir, fileName, current, currentCompressedHead !== null);
      }

      // 2. Stage the streamed content in a temp file and verify the exact bytes
      //    landed BEFORE overwriting the live file.
      reportProgress(onProgress, "staging");
      let stagedInfo: StreamedFileInfo;
      try {
        stagedInfo = await streamEnvelopeToFile(dir, tmpName, data, buildMetadata);
      } catch (error) {
        // A streamed write that dies part-way (quota, permission, a failing
        // share) used to leave a partial .tmp behind — hundreds of MB of
        // unusable bytes that nothing ever cleaned up, because the only
        // cleanup paths were the ones reached *after* staging returned.
        await removeQuietly(dir, tmpName);
        throw error;
      }
      reportProgress(onProgress, "verifying-staged");
      if (!(await verifyStreamedFile(dir, tmpName, stagedInfo))) {
        await removeQuietly(dir, tmpName);
        throw new Error(`Safe-write staging failed for ${fileName}.`);
      }

      // 3. Commit to the live file by copying the bytes we just verified —
      //    Phase 1.4: no second serialization pass. The committed content is
      //    identical to what re-streaming produced (same data, same captured
      //    writtenAt, same metadata), so `stagedInfo` is the expected result
      //    for the post-commit byte-exact verification.
      reportProgress(onProgress, "committing");
      const liveInfo = await copyFileStreamed(dir, tmpName, fileName);
      reportProgress(onProgress, "verifying-committed");
      if (
        liveInfo.fileHash !== stagedInfo.fileHash ||
        liveInfo.fileLength !== stagedInfo.fileLength ||
        !(await verifyStreamedFile(dir, fileName, stagedInfo))
      ) {
        if (await rollbackFromBak(dir, fileName)) {
          await removeQuietly(dir, tmpName);
          throw new Error(
            `Safe-write validation failed for ${fileName}; rolled back to previous version.`
          );
        }
        // No usable .bak (first write, or .bak corrupt): the staged .tmp WAS
        // verified before commit — promote it instead of losing the data.
        // Re-verify (rather than trusting the earlier check) so promotion is
        // driven by what is provably still on disk right now.
        if (await verifyStreamedFile(dir, tmpName, stagedInfo)) {
          try {
            await copyFileStreamed(dir, tmpName, fileName);
            if (await verifyStreamedFile(dir, fileName, stagedInfo)) {
              await removeQuietly(dir, tmpName);
              return; // recovered — the write succeeded via promotion
            }
          } catch {
            // Promotion is the last-resort recovery attempt; a failure here must
            // still end in the "staged copy kept as .tmp" outcome below rather
            // than masking it with the copy's own error.
          }
        }
        // Promotion failed too: keep .tmp on disk as the survivor for recovery.
        throw new Error(
          `Safe-write validation failed for ${fileName}; staged copy kept as ${tmpName}.`
        );
      }

      // 4. Best-effort cleanup of the temp file.
      await removeQuietly(dir, tmpName);
      return;
    }

    // Small-file path (unchanged): pretty-print for readability when the compact
    // result is small enough to stay well under the ceiling; otherwise compact.
    const serialized =
      compact.length > PRETTY_PRINT_SIZE_LIMIT
        ? `${compact}\n`
        : `${JSON.stringify(nextValue, null, 2)}\n`;

    // 1. Snapshot the current good file to .bak (the rollback source).
    //    `hasCurrent`, not `parsedCurrent`: a small payload can overwrite an
    //    oversized existing file, and that file still deserves a snapshot.
    if (hasCurrent) {
      reportProgress(onProgress, "backing-up");
      await snapshotToBak(dir, fileName, current, currentCompressedHead !== null);
    }

    // 2. Stage the new content in a temp file and verify it landed intact
    //    BEFORE overwriting the live file.
    reportProgress(onProgress, "staging");
    await writeText(dir, tmpName, serialized);
    reportProgress(onProgress, "verifying-staged");
    const staged = await readText(dir, tmpName, { retryMissing: true });
    // Phase 1.3: byte-exact comparison for every size, not just large files.
    // The old small-file check was `does it parse` — which a *peer's* valid
    // envelope also passes, so a concurrent writer's file could be accepted as
    // our own. Comparing against the exact bytes we meant to write is strictly
    // stronger and costs less (no parse, no re-hash).
    const stagedOk = staged === serialized;
    if (!stagedOk) {
      await removeQuietly(dir, tmpName);
      throw new Error(`Safe-write staging failed for ${fileName}.`);
    }

    // 3. Commit the verified content to the live file, then re-verify.
    reportProgress(onProgress, "committing");
    await writeText(dir, fileName, serialized);
    reportProgress(onProgress, "verifying-committed");
    const verify = await readText(dir, fileName, { retryMissing: true });
    const verifyOk = verify === serialized;
    if (!verifyOk) {
      if (await rollbackFromBak(dir, fileName)) {
        await removeQuietly(dir, tmpName);
        throw new Error(
          `Safe-write validation failed for ${fileName}; rolled back to previous version.`
        );
      }
      // No usable .bak (first write, or .bak corrupt): the staged .tmp WAS
      // verified before commit — promote it instead of losing the data.
      const staged2 = await readText(dir, tmpName, { retryMissing: true });
      const staged2Ok = staged2 === serialized;
      if (staged2Ok) {
        await writeText(dir, fileName, staged2 as string);
        const check = await readText(dir, fileName, { retryMissing: true });
        const checkOk = check === serialized;
        if (checkOk) {
          await removeQuietly(dir, tmpName);
          return; // recovered — the write succeeded via promotion
        }
      }
      // Promotion failed too: keep .tmp on disk as the survivor for recovery.
      throw new Error(
        `Safe-write validation failed for ${fileName}; staged copy kept as ${tmpName}.`
      );
    }

    // 4. Best-effort cleanup of the temp file.
    await removeQuietly(dir, tmpName);
    }),
  );
}

export async function safeWriteJsonText(
  dir: DirectoryHandleLike,
  fileName: string,
  jsonText: string
): Promise<void> {
  assertWritableMode();

  const parsed = parseValidJson(jsonText);
  if (!parsed) {
    throw new Error(`Cannot restore invalid JSON file ${fileName}.`);
  }

  // Same large-payload guard as safeWriteJson: avoid pretty-printing huge files
  // so restore of a large file can't trip V8's max string length. If even the
  // compact form is too large to hold as one string, stream the payload instead.
  let compact: string | null = null;
  try {
    compact = JSON.stringify(parsed);
  } catch (error) {
    if (!isStringLengthError(error)) throw error;
  }
  let normalized: string | null = null;
  if (compact !== null && compact.length <= streamingForcedSizeLimit) {
    normalized =
      compact.length > PRETTY_PRINT_SIZE_LIMIT
        ? `${compact}\n`
        : `${JSON.stringify(parsed, null, 2)}\n`;
  }
  const tmpName = `${fileName}.tmp`;

  await withWorkspaceWriteAccess(dir, () =>
    withResourceLock(directoryResourceKey(dir, fileName), async () => {
    const currentRead = await readTextTolerant(dir, fileName);
    const current = currentRead.kind === "text" ? currentRead.text : null;
    // Same three cases as safeWriteJson's preamble: a parseable plain file, an
    // oversized one recoverable from its tail, or a compressed one recognized
    // from its head line (which must be snapshotted as bytes, not as text).
    const currentCompressedHead = compressedHeadFromText(current);
    const hasCurrent =
      parseValidJson(current) !== null ||
      currentCompressedHead !== null ||
      (currentRead.kind === "oversized" &&
        (await readOversizedEnvelopeMetadata(dir, fileName)) !== null);
    if (hasCurrent) {
      await snapshotToBak(dir, fileName, current, currentCompressedHead !== null);
    }

    if (normalized === null) {
      // Streamed path: re-normalize the restore payload verbatim (it is already
      // a valid envelope or bare JSON) without ever building one giant string.
      let stagedInfo: StreamedFileInfo;
      try {
        stagedInfo = await streamValueToFile(dir, tmpName, parsed);
      } catch (error) {
        await removeQuietly(dir, tmpName); // never leave a partial .tmp behind
        throw error;
      }
      if (!(await verifyStreamedFile(dir, tmpName, stagedInfo))) {
        await removeQuietly(dir, tmpName);
        throw new Error(`Safe-write staging failed for ${fileName}.`);
      }

      // Phase 1.4: commit the verified staged bytes instead of serializing the
      // restore payload a second time.
      const liveInfo = await copyFileStreamed(dir, tmpName, fileName);
      if (
        liveInfo.fileHash !== stagedInfo.fileHash ||
        liveInfo.fileLength !== stagedInfo.fileLength ||
        !(await verifyStreamedFile(dir, fileName, stagedInfo))
      ) {
        await rollbackFromBak(dir, fileName);
        await removeQuietly(dir, tmpName);
        throw new Error(`Safe-write validation failed for ${fileName}.`);
      }

      await removeQuietly(dir, tmpName);
      return;
    }

    await writeText(dir, tmpName, normalized);
    const staged = await readText(dir, tmpName, { retryMissing: true });
    const stagedOk = staged === normalized;
    if (!stagedOk) {
      await removeQuietly(dir, tmpName);
      throw new Error(`Safe-write staging failed for ${fileName}.`);
    }

    await writeText(dir, fileName, normalized);
    const verify = await readText(dir, fileName, { retryMissing: true });
    const verifyOk = verify === normalized;
    if (!verifyOk) {
      await rollbackFromBak(dir, fileName);
      await removeQuietly(dir, tmpName);
      throw new Error(`Safe-write validation failed for ${fileName}.`);
    }

    await removeQuietly(dir, tmpName);
    }),
  );
}

/**
 * Read just the `JsonEnvelope.metadata.revision` of a file (B2 report-to-revision
 * linkage) without unwrapping/returning the (potentially large) data. Returns the
 * numeric revision, or `null` when the file is missing, corrupt, unwrapped (bare
 * JSON with no envelope), or uses the string-schema workspace-management shape.
 * Falls back to the `.bak` snapshot so a report can still cite a recoverable file.
 */
export async function readEnvelopeRevision(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<number | null> {
  const extract = (parsed: unknown): number | null => {
    if (
      isEnvelope(parsed) &&
      typeof parsed.metadata.schemaVersion === "number" &&
      typeof parsed.metadata.revision === "number"
    ) {
      return parsed.metadata.revision;
    }
    return null;
  };
  // Oversize-tolerant: a file past the engine's max string length cannot be
  // read (let alone parsed) as one string, but its envelope header still sits
  // in a bounded tail window — and the whole point of this function is to
  // return a revision without materializing the data.
  const readOne = async (name: string): Promise<number | null> => {
    // Compressed first, and NOT via the text path: its revision sits in the head
    // line, reachable with one bounded slice whatever the file's size — and
    // decoding a gzip member as text would find nothing to parse anyway.
    const probe = await classifyFile(dir, name);
    if (probe.kind === "compressed") {
      return typeof probe.head.schemaVersion === "number" &&
        typeof probe.head.revision === "number"
        ? probe.head.revision
        : null;
    }
    if (probe.kind === "missing") return null;
    const read = await readTextTolerant(dir, name);
    if (read.kind === "text") return extract(parseValidJson(read.text));
    if (read.kind === "oversized") {
      return (await readOversizedEnvelopeMetadata(dir, name))?.revision ?? null;
    }
    return null;
  };
  const live = await readOne(fileName);
  if (live !== null) return live;
  return readOne(`${fileName}.bak`);
}

export type SafeReadJsonOptions = {
  /**
   * Opt-in, same contract and same warning as ReadTextOptions.retryMissing:
   * only for reading back a file this caller just wrote. Applies to the live
   * file read alone — the `.bak`/`.tmp` fallback probes below stay fast,
   * because those are absence probes by design.
   */
  retryMissing?: boolean;
};

/**
 * One read, either format. Returns the parsed payload plus the text it came
 * from, or null when the file is missing, unreadable as this format, or fails
 * validation.
 *
 * This is where dual read actually lives, and why it is permanent: the file is
 * classified from its own first bytes, so a plain file written years ago and a
 * compressed one written today go through the same call and produce the same
 * shape. Columnar decoding is applied to whatever comes back — it keys off the
 * payload's own discriminator, not off the framing, so a columnar array is
 * decoded whether it arrived compressed or plain.
 *
 * `rawText` is the whole file for a plain file and the DECOMPRESSED BODY for a
 * compressed one (the head line is metadata, and is returned parsed instead).
 */
type ReadPayload<T> = { value: T; rawText: string };

async function readPayload<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  options?: ReadTextOptions
): Promise<{ found: boolean; payload: ReadPayload<T> | null }> {
  const content = await readContent(dir, fileName, options);
  if (content === null) return { found: false, payload: null };
  if (content.kind === "damaged") return { found: true, payload: null };
  if (content.kind === "compressed") {
    // The head line IS the envelope metadata; it is validated structurally, and
    // the body's integrity comes from gzip's CRC32 (already checked by the
    // inflate above) rather than from a contentHash it cannot carry.
    if (!validateEnvelopeStructure({ metadata: content.head, data: null })) {
      return { found: true, payload: null };
    }
    try {
      const data: unknown = JSON.parse(content.bodyText);
      return {
        found: true,
        payload: { value: decodePayloadColumns<T>(data), rawText: content.bodyText },
      };
    } catch {
      return { found: true, payload: null };
    }
  }
  const parsed = parseValidJson(content.text);
  if (parsed === null) return { found: true, payload: null };
  return {
    found: true,
    payload: { value: decodePayloadColumns<T>(unwrap<unknown>(parsed)), rawText: content.text },
  };
}

export async function safeReadJson<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  options?: SafeReadJsonOptions
): Promise<SafeReadResult<T>> {
  const live = await readPayload<T>(dir, fileName, { retryMissing: options?.retryMissing });
  if (live.payload !== null) {
    return {
      ok: true,
      value: live.payload.value,
      recoveredFromBak: false,
      rawText: live.payload.rawText
    };
  }

  const bak = await readPayload<T>(dir, `${fileName}.bak`);
  if (bak.payload !== null) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("data:recovered-from-bak", { detail: { fileName } })
      );
    }
    return {
      ok: true,
      value: bak.payload.value,
      recoveredFromBak: true,
      rawText: bak.payload.rawText
    };
  }

  // Last-resort fallback: a verified .tmp left behind by a failed commit (the
  // promotion path in safeWriteJson keeps it on total failure) — recover it
  // rather than losing the only good copy of the write.
  const tmp = await readPayload<T>(dir, `${fileName}.tmp`);
  if (tmp.payload !== null) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("data:recovered-from-bak", { detail: { fileName } })
      );
    }
    return {
      ok: true,
      value: tmp.payload.value,
      recoveredFromBak: true,
      rawText: tmp.payload.rawText
    };
  }

  if (!live.found && !bak.found && !tmp.found) {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: "corrupt" };
}
