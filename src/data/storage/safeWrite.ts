import type { DirectoryHandleLike } from "./fileSystemAccess";
import { withResourceLock } from "./webLocks";
import { isEnvelope, wrap, unwrap } from "./jsonEnvelope";

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

function parses(text: string | null): boolean {
  if (text === null) {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
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
  const serialized = `${JSON.stringify(isEnvelope(value) ? value : wrap(value), null, 2)}\n`;
  const skipVerify = serialized.length > VERIFY_SIZE_LIMIT;
  const tmpName = `${fileName}.tmp`;

  // Lock per directory+file so same-named files in different folders don't contend.
  await withResourceLock(`${dir.name}/${fileName}`, async () => {
    // 1. Snapshot the current good file to .bak (the rollback source).
    const current = await readText(dir, fileName);
    if (parses(current)) {
      await writeText(dir, `${fileName}.bak`, current as string);
    }

    // 2. Stage the new content in a temp file and verify it landed intact
    //    BEFORE overwriting the live file.
    await writeText(dir, tmpName, serialized);
    const staged = await readText(dir, tmpName);
    const stagedOk = skipVerify ? staged === serialized : parses(staged);
    if (!stagedOk) {
      await removeQuietly(dir, tmpName);
      throw new Error(`Safe-write staging failed for ${fileName}.`);
    }

    // 3. Commit the verified content to the live file, then re-verify.
    await writeText(dir, fileName, serialized);
    const verify = await readText(dir, fileName);
    const verifyOk = skipVerify ? verify === serialized : parses(verify);
    if (!verifyOk) {
      const bak = await readText(dir, `${fileName}.bak`);
      if (parses(bak)) {
        await writeText(dir, fileName, bak as string);
      }
      await removeQuietly(dir, tmpName);
      throw new Error(`Safe-write validation failed for ${fileName}.`);
    }

    // 4. Best-effort cleanup of the temp file.
    await removeQuietly(dir, tmpName);
  });
}

export async function safeReadJson<T>(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<SafeReadResult<T>> {
  const live = await readText(dir, fileName);
  if (parses(live)) {
    return {
      ok: true,
      value: unwrap<T>(JSON.parse(live as string)),
      recoveredFromBak: false,
      rawText: live as string
    };
  }

  const bak = await readText(dir, `${fileName}.bak`);
  if (parses(bak)) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("data:recovered-from-bak", { detail: { fileName } })
      );
    }
    return {
      ok: true,
      value: unwrap<T>(JSON.parse(bak as string)),
      recoveredFromBak: true,
      rawText: bak as string
    };
  }

  if (live === null && bak === null) {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: "corrupt" };
}
