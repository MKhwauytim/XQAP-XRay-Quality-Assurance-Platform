// src/data/storage/moveFileVerified.ts
//
// Spec 2026-10-13 §6 step 4 / §7 step 3: move a file into an archive folder.
// `move()` where the handle supports it; otherwise copy → verify bytes →
// remove the original ONLY after verification. Never deletes data: the only
// removal is of a source whose verified copy already exists.
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { copyFileBytesVerified, safeRemoveJson } from "./safeWrite";
import { isNotFoundError } from "./transientFileErrors";

export type MoveOutcome =
  | { status: "moved"; via: "move" | "copy" }
  | { status: "kept"; reason: "changed" | "copy-failed" | "remove-failed" | "source-missing"; detail?: string };

async function sizeOrNull(dir: DirectoryHandleLike, name: string): Promise<number | null> {
  try {
    return (await (await dir.getFileHandle(name, { create: false })).getFile()).size;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function tryNativeMove(sourceDir: DirectoryHandleLike, name: string, targetDir: DirectoryHandleLike, expectedBytes: number, targetName: string): Promise<boolean> {
  const handle = await sourceDir.getFileHandle(name, { create: false });
  if (typeof handle.move !== "function") return false;
  try {
    await (targetName === name ? handle.move(targetDir) : handle.move(targetDir, targetName));
  } catch {
    return false; // fall back to copy while the source is still in place
  }
  return (await sizeOrNull(targetDir, targetName)) === expectedBytes && (await sizeOrNull(sourceDir, name)) === null;
}

/**
 * `targetName` (default `name`): the entry to create inside `targetDir`. The
 * copy fallback OVERWRITES an existing entry of that name, so a caller whose
 * target may already hold different bytes passes a free name instead.
 */
export async function moveFileVerified(
  sourceDir: DirectoryHandleLike,
  name: string,
  targetDir: DirectoryHandleLike,
  expectedBytes: number,
  targetName: string = name
): Promise<MoveOutcome> {
  const before = await sizeOrNull(sourceDir, name);
  if (before === null) return { status: "kept", reason: "source-missing" };
  // Bytes appended since the caller read the file are not in its snapshot yet.
  if (before !== expectedBytes) return { status: "kept", reason: "changed" };
  if (await tryNativeMove(sourceDir, name, targetDir, expectedBytes, targetName)) return { status: "moved", via: "move" };
  // v154.0 round 6: a copy that THROWS (e.g. an InvalidStateError that outlived
  // every ladder) leaves the source in place, so it is "kept", never a throw
  // that fails the caller's whole run.
  let copied: Awaited<ReturnType<typeof copyFileBytesVerified>>;
  try {
    copied = await copyFileBytesVerified(sourceDir, name, targetDir, targetName);
  } catch (error) {
    const named = error as { name?: unknown; message?: unknown };
    return { status: "kept", reason: "copy-failed", detail: `${String(named?.name ?? "Error")}: ${String(named?.message ?? error)}` };
  }
  if (copied.status === "source_missing") return { status: "kept", reason: "source-missing" };
  if (copied.status !== "copied") return { status: "kept", reason: "copy-failed", detail: copied.detail };
  if (copied.bytes !== expectedBytes || (await sizeOrNull(sourceDir, name)) !== expectedBytes) {
    return { status: "kept", reason: "changed" };
  }
  const removed = await safeRemoveJson(sourceDir, name);
  return removed.ok ? { status: "moved", via: "copy" } : { status: "kept", reason: "remove-failed", detail: removed.remaining.join(", ") };
}
