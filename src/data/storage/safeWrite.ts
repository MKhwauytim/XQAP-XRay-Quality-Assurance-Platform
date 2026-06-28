import type { DirectoryHandleLike } from "./fileSystemAccess";
import { withResourceLock } from "./webLocks";
import { isEnvelope, validateEnvelope, wrap, unwrap } from "./jsonEnvelope";

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

export async function safeWriteJson<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  value: T
): Promise<void> {
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
    const nextValue = isEnvelope(value) ? value : wrap(value, previousRevision);
    // Pretty-print keeps small machine files human-readable, but indentation can
    // push a large payload past V8's max string length (RangeError: Invalid
    // string length). Serialize compactly first; only re-serialize with 2-space
    // indentation when the result is small enough to stay well under the ceiling.
    const compact = JSON.stringify(nextValue);
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
      }
      await removeQuietly(dir, tmpName);
      throw new Error(`Safe-write validation failed for ${fileName}.`);
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
  const parsed = parseValidJson(jsonText);
  if (!parsed) {
    throw new Error(`Cannot restore invalid JSON file ${fileName}.`);
  }

  // Same large-payload guard as safeWriteJson: avoid pretty-printing huge files
  // so restore of a large file can't trip V8's max string length.
  const compact = JSON.stringify(parsed);
  const skipVerify = compact.length > VERIFY_SIZE_LIMIT;
  const normalized = skipVerify
    ? `${compact}\n`
    : `${JSON.stringify(parsed, null, 2)}\n`;
  const tmpName = `${fileName}.tmp`;

  await withResourceLock(`${dir.name}/${fileName}`, async () => {
    const current = await readText(dir, fileName);
    if (parseValidJson(current) !== null) {
      await writeText(dir, `${fileName}.bak`, current as string);
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

  if (live === null && bak === null) {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: "corrupt" };
}
