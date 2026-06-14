import type { DirectoryHandleLike } from "./fileSystemAccess";
import { withResourceLock } from "./webLocks";

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

export async function safeWriteJson<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  value: T
): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  await withResourceLock(fileName, async () => {
    const current = await readText(dir, fileName);
    if (parses(current)) {
      await writeText(dir, `${fileName}.bak`, current as string);
    }

    await writeText(dir, fileName, serialized);

    const verify = await readText(dir, fileName);
    if (!parses(verify)) {
      const bak = await readText(dir, `${fileName}.bak`);
      if (parses(bak)) {
        await writeText(dir, fileName, bak as string);
      }
      throw new Error(`Safe-write validation failed for ${fileName}.`);
    }
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
      value: JSON.parse(live as string) as T,
      recoveredFromBak: false,
      rawText: live as string
    };
  }

  const bak = await readText(dir, `${fileName}.bak`);
  if (parses(bak)) {
    return {
      ok: true,
      value: JSON.parse(bak as string) as T,
      recoveredFromBak: true,
      rawText: bak as string
    };
  }

  if (live === null && bak === null) {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: "corrupt" };
}
