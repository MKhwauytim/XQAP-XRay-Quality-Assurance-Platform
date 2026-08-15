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
 * `.bak` snapshot of the current live file. Takes the already-read text when it
 * exists; falls back to a chunked copy for a file too large to hold as one
 * string. Same rollback source either way.
 */
async function snapshotToBak(
  dir: DirectoryHandleLike,
  fileName: string,
  currentText: string | null
): Promise<void> {
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

export async function safeWriteJson<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  value: T,
  onProgress?: SafeWriteProgressCallback
): Promise<void> {
  assertWritableMode();

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
    const hasCurrent = parsedCurrent !== null || oversizedMetadata !== null;
    const previousRevision =
      parsedCurrent &&
      isEnvelope(parsedCurrent) &&
      typeof parsedCurrent.metadata.schemaVersion === "number"
        ? parsedCurrent.metadata.revision
        : (oversizedMetadata?.revision ?? 0);
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
        await snapshotToBak(dir, fileName, current);
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
      await snapshotToBak(dir, fileName, current);
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
    const hasCurrent =
      parseValidJson(current) !== null ||
      (currentRead.kind === "oversized" &&
        (await readOversizedEnvelopeMetadata(dir, fileName)) !== null);
    if (hasCurrent) {
      await snapshotToBak(dir, fileName, current);
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

export async function safeReadJson<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  options?: SafeReadJsonOptions
): Promise<SafeReadResult<T>> {
  const live = await readText(dir, fileName, { retryMissing: options?.retryMissing });
  const parsedLive = parseValidJson(live);
  if (parsedLive !== null) {
    return {
      ok: true,
      value: unwrap<T>(parsedLive),
      recoveredFromBak: false,
      rawText: live as string
    };
  }

  const bak = await readText(dir, `${fileName}.bak`);
  const parsedBak = parseValidJson(bak);
  if (parsedBak !== null) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("data:recovered-from-bak", { detail: { fileName } })
      );
    }
    return {
      ok: true,
      value: unwrap<T>(parsedBak),
      recoveredFromBak: true,
      rawText: bak as string
    };
  }

  // Last-resort fallback: a verified .tmp left behind by a failed commit (the
  // promotion path in safeWriteJson keeps it on total failure) — recover it
  // rather than losing the only good copy of the write.
  const tmp = await readText(dir, `${fileName}.tmp`);
  const parsedTmp = parseValidJson(tmp);
  if (parsedTmp !== null) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("data:recovered-from-bak", { detail: { fileName } })
      );
    }
    return {
      ok: true,
      value: unwrap<T>(parsedTmp),
      recoveredFromBak: true,
      rawText: tmp as string
    };
  }

  if (live === null && bak === null && tmp === null) {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: "corrupt" };
}
