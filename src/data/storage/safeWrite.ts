import type { DirectoryHandleLike } from "./fileSystemAccess";
import { isReadOnlyMode } from "./readOnlyMode";
import { withResourceLock } from "./webLocks";
import {
  ENVELOPE_SCHEMA_VERSION,
  createSimpleHasher,
  isEnvelope,
  simpleHash,
  streamJsonStringify,
  validateEnvelope,
  wrap,
  unwrap,
  type JsonMetadata,
} from "./jsonEnvelope";

export type SafeReadResult<T> =
  | { ok: true; value: T; recoveredFromBak: boolean; rawText: string }
  | { ok: false; reason: "missing" | "corrupt" };

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: string }).name === "NotFoundError"
  );
}

async function readText(
  dir: DirectoryHandleLike,
  name: string
): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(name, { create: false });
    const file = await handle.getFile();
    return await file.text();
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function writeText(
  dir: DirectoryHandleLike,
  name: string,
  content: string
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  if (!handle.createWritable) {
    throw new Error(`Browser cannot write ${name}.`);
  }
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
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

function parseValidJson(text: string | null): unknown | null {
  if (text === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return validateEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Large files still get a raw read-back comparison, but skip the extra JSON.parse
// to avoid doubling parse cost for population.final.json-sized writes.
const VERIFY_SIZE_LIMIT = 512 * 1024; // 512 KB

// A RangeError thrown by JSON.stringify when its output would exceed V8's max
// string length ("Invalid string length"). When this is hit, fall back to the
// streamed write path, which never materializes the whole serialization.
function isStringLengthError(error: unknown): boolean {
  return (
    error instanceof RangeError &&
    /invalid string length/i.test(error.message)
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

// Verifies a streamed file by re-reading it and confirming its bytes exactly
// match what was written (length + whole-file content hash). simpleHash walks
// the already-materialized read-back string without allocating a new one.
async function verifyStreamedFile(
  dir: DirectoryHandleLike,
  fileName: string,
  expected: StreamedFileInfo
): Promise<boolean> {
  const text = await readText(dir, fileName);
  if (text === null || text.length !== expected.fileLength) {
    return false;
  }
  return simpleHash(text) === expected.fileHash;
}

export async function safeWriteJson<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  value: T
): Promise<void> {
  // Demo/viewer mode is read-only: succeed silently without touching storage.
  if (isReadOnlyMode()) return;

  const tmpName = `${fileName}.tmp`;

  // Lock per directory+file so same-named files in different folders don't contend.
  await withResourceLock(`${dir.name}/${fileName}`, async () => {
    const current = await readText(dir, fileName);
    const parsedCurrent = parseValidJson(current);
    const previousRevision =
      parsedCurrent &&
      isEnvelope(parsedCurrent) &&
      typeof parsedCurrent.metadata.schemaVersion === "number"
        ? parsedCurrent.metadata.revision
        : 0;
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
      if (parsedCurrent) {
        await writeText(dir, `${fileName}.bak`, current as string);
      }

      // 2. Stage the streamed content in a temp file and verify the exact bytes
      //    landed BEFORE overwriting the live file.
      const stagedInfo = await streamEnvelopeToFile(
        dir,
        tmpName,
        data,
        buildMetadata
      );
      if (!(await verifyStreamedFile(dir, tmpName, stagedInfo))) {
        await removeQuietly(dir, tmpName);
        throw new Error(`Safe-write staging failed for ${fileName}.`);
      }

      // 3. Commit to the live file (re-stream, no giant string), then re-verify.
      const liveInfo = await streamEnvelopeToFile(
        dir,
        fileName,
        data,
        buildMetadata
      );
      if (!(await verifyStreamedFile(dir, fileName, liveInfo))) {
        const bak = await readText(dir, `${fileName}.bak`);
        if (parseValidJson(bak) !== null) {
          await writeText(dir, fileName, bak as string);
          await removeQuietly(dir, tmpName);
          throw new Error(
            `Safe-write validation failed for ${fileName}; rolled back to previous version.`
          );
        }
        // No usable .bak (first write, or .bak corrupt): the staged .tmp WAS
        // verified before commit — promote it instead of losing the data.
        try {
          if (await verifyStreamedFile(dir, tmpName, stagedInfo)) {
            const stagedText = await readText(dir, tmpName);
            if (stagedText !== null) {
              await writeText(dir, fileName, stagedText);
              if (await verifyStreamedFile(dir, fileName, stagedInfo)) {
                await removeQuietly(dir, tmpName);
                return; // recovered — the write succeeded via promotion
              }
            }
          }
        } catch (error) {
          // A payload near V8's max string length can make the promotion
          // read-back throw RangeError — fall through and keep the .tmp.
          if (!isStringLengthError(error)) throw error;
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
    const skipVerify = compact.length > VERIFY_SIZE_LIMIT;
    const serialized = skipVerify
      ? `${compact}\n`
      : `${JSON.stringify(nextValue, null, 2)}\n`;

    // 1. Snapshot the current good file to .bak (the rollback source).
    if (parsedCurrent) {
      await writeText(dir, `${fileName}.bak`, current as string);
    }

    // 2. Stage the new content in a temp file and verify it landed intact
    //    BEFORE overwriting the live file.
    await writeText(dir, tmpName, serialized);
    const staged = await readText(dir, tmpName);
    const stagedOk = skipVerify
      ? staged === serialized
      : parseValidJson(staged) !== null;
    if (!stagedOk) {
      await removeQuietly(dir, tmpName);
      throw new Error(`Safe-write staging failed for ${fileName}.`);
    }

    // 3. Commit the verified content to the live file, then re-verify.
    await writeText(dir, fileName, serialized);
    const verify = await readText(dir, fileName);
    const verifyOk = skipVerify
      ? verify === serialized
      : parseValidJson(verify) !== null;
    if (!verifyOk) {
      const bak = await readText(dir, `${fileName}.bak`);
      if (parseValidJson(bak) !== null) {
        await writeText(dir, fileName, bak as string);
        await removeQuietly(dir, tmpName);
        throw new Error(
          `Safe-write validation failed for ${fileName}; rolled back to previous version.`
        );
      }
      // No usable .bak (first write, or .bak corrupt): the staged .tmp WAS
      // verified before commit — promote it instead of losing the data.
      const staged2 = await readText(dir, tmpName);
      const staged2Ok = skipVerify
        ? staged2 === serialized
        : parseValidJson(staged2) !== null;
      if (staged2Ok) {
        await writeText(dir, fileName, staged2 as string);
        const check = await readText(dir, fileName);
        const checkOk = skipVerify
          ? check === serialized
          : parseValidJson(check) !== null;
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
  });
}

export async function safeWriteJsonText(
  dir: DirectoryHandleLike,
  fileName: string,
  jsonText: string
): Promise<void> {
  // Demo/viewer mode is read-only: succeed silently without touching storage.
  if (isReadOnlyMode()) return;

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
  let skipVerify = false;
  if (compact !== null && compact.length <= streamingForcedSizeLimit) {
    skipVerify = compact.length > VERIFY_SIZE_LIMIT;
    normalized = skipVerify
      ? `${compact}\n`
      : `${JSON.stringify(parsed, null, 2)}\n`;
  }
  const tmpName = `${fileName}.tmp`;

  await withResourceLock(`${dir.name}/${fileName}`, async () => {
    const current = await readText(dir, fileName);
    if (parseValidJson(current) !== null) {
      await writeText(dir, `${fileName}.bak`, current as string);
    }

    if (normalized === null) {
      // Streamed path: re-normalize the restore payload verbatim (it is already
      // a valid envelope or bare JSON) without ever building one giant string.
      const stagedInfo = await streamValueToFile(dir, tmpName, parsed);
      if (!(await verifyStreamedFile(dir, tmpName, stagedInfo))) {
        await removeQuietly(dir, tmpName);
        throw new Error(`Safe-write staging failed for ${fileName}.`);
      }

      const liveInfo = await streamValueToFile(dir, fileName, parsed);
      if (!(await verifyStreamedFile(dir, fileName, liveInfo))) {
        const bak = await readText(dir, `${fileName}.bak`);
        if (parseValidJson(bak) !== null) {
          await writeText(dir, fileName, bak as string);
        }
        await removeQuietly(dir, tmpName);
        throw new Error(`Safe-write validation failed for ${fileName}.`);
      }

      await removeQuietly(dir, tmpName);
      return;
    }

    await writeText(dir, tmpName, normalized);
    const staged = await readText(dir, tmpName);
    const stagedOk = skipVerify
      ? staged === normalized
      : parseValidJson(staged) !== null;
    if (!stagedOk) {
      await removeQuietly(dir, tmpName);
      throw new Error(`Safe-write staging failed for ${fileName}.`);
    }

    await writeText(dir, fileName, normalized);
    const verify = await readText(dir, fileName);
    const verifyOk = skipVerify
      ? verify === normalized
      : parseValidJson(verify) !== null;
    if (!verifyOk) {
      const bak = await readText(dir, `${fileName}.bak`);
      if (parseValidJson(bak) !== null) {
        await writeText(dir, fileName, bak as string);
      }
      await removeQuietly(dir, tmpName);
      throw new Error(`Safe-write validation failed for ${fileName}.`);
    }

    await removeQuietly(dir, tmpName);
  });
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
  const live = extract(parseValidJson(await readText(dir, fileName)));
  if (live !== null) return live;
  return extract(parseValidJson(await readText(dir, `${fileName}.bak`)));
}

export async function safeReadJson<T>(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<SafeReadResult<T>> {
  const live = await readText(dir, fileName);
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
