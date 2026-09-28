/**
 * Task E2 — the second half of the `storage:bak-recovery` fix
 * (.superpowers/sdd/errorlog-2026-09-28/other-groups.md, evidence §A,
 * "Why a `.tmp` existed to be served").
 *
 * `safeWriteJson`'s small-file path commits the live file and then reads it
 * back to verify. If that read-back THROWS (an exhausted stale-snapshot /
 * NotReadable ladder on the client's own just-committed write, not a mismatch)
 * the exception used to leave the function AFTER the commit had already
 * succeeded, and `.tmp` was never removed — only the success path at the end
 * of the function did that. The live file is correct; a stale `.tmp` sibling
 * is left on disk, and the NEXT reader to hit a stale snapshot on the live
 * file gets served that `.tmp` and told "the live file is damaged".
 *
 * The fix: a thrown post-commit read-back must still best-effort clean up
 * `.tmp` before the error propagates. The write still reports failure to its
 * caller exactly as before (this repro does not touch §B's retry/deadline
 * question) — only the litter is different.
 */
import { afterEach, beforeEach, expect, test } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import { safeReadJson, safeWriteJson } from "./safeWrite";
import { clearErrors } from "./errorLogger";
import type { DirectoryHandleLike } from "./fileSystemAccess";

beforeEach(() => {
  clearErrors();
});

afterEach(() => {
  clearErrors();
});

async function fileExists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "NotFoundError") return false;
    throw error;
  }
}

test("a post-commit read-back that throws still removes .tmp, and the live file is left correct", async () => {
  const dir = createMemoryDirectory("post-commit-1");

  // The commit itself (writeText → createWritable/close) is untouched; only
  // every subsequent read of the LIVE file's bytes fails, forever — modelling
  // an exhausted stale-snapshot ladder on the client's own just-committed
  // write (evidence §A/§B).
  setSimulatedFaults(dir, [
    { operation: "readFile", name: "t.json", errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
  ]);

  await expect(safeWriteJson(dir, "t.json", { v: 1 })).rejects.toThrow();

  // The live commit landed — writeText's own close() resolved before the
  // read-back ever ran.
  expect(await fileExists(dir, "t.json")).toBe(true);

  // No .tmp left behind for a later stale live-read to be served from.
  expect(await fileExists(dir, "t.json.tmp")).toBe(false);

  // Lift the fault and confirm the committed content is exactly what was
  // written — the read-back failure was a client-side view problem, not
  // evidence the write itself was wrong.
  setSimulatedFaults(dir, []);
  const result = await safeReadJson<{ v: number }>(dir, "t.json");
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.v).toBe(1);
});
