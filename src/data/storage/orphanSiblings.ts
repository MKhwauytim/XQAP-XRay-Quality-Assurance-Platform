import type { DirectoryHandleLike } from "./fileSystemAccess";
import { listDirectoryEntries } from "./directoryScan";
import { copyFileBytes } from "./safeWrite";
import { logError } from "./errorLogger";

/**
 * `{file}.bak` / `{file}.tmp` entries whose LIVE file is gone.
 *
 * WHY THESE MATTER. `safeWriteJson` maintains three names for one logical file
 * and `safeReadJson` reads them as one: on a miss of the live name it falls
 * through to the siblings and reports a recovery. That is correct for a torn
 * write, which is the only way a live file was ever supposed to vanish.
 *
 * Before `safeRemoveJson` (v135.0) every delete site removed only the live
 * name, so a deletion left the siblings behind and the next read "recovered" a
 * record the user had deliberately deleted — permanently, because nothing ever
 * rewrites a file that is supposed to be gone. That is the 2026-09-08/09
 * production incident: `tmpl-1787457917309-ngm1iq.json` answered from its
 * orphaned `.bak` for over eighteen hours, for every user, while the log
 * insisted the live file was "damaged". It was not damaged; it was deleted.
 *
 * v135.0 stops NEW orphans. This module finds the ones already on disk in
 * workspaces that ran the old code, so the admin boot self-check can clear
 * them.
 *
 * DELIBERATELY NOT A DELETE. An orphan is archived to a name no read ladder
 * probes (`{name}.orphaned-{timestamp}`), never removed — this codebase's rule
 * is that a repair archives rather than destroys, because an orphan is the only
 * remaining copy of whatever it holds and nobody has verified it is worthless.
 */

const MANAGED_SUFFIXES = [".bak", ".tmp"] as const;

export type OrphanSibling = {
  /** The sibling entry itself, e.g. `tmpl-1.json.bak`. */
  siblingName: string;
  /** The live name it is standing in for, e.g. `tmpl-1.json`. */
  liveName: string;
  suffix: (typeof MANAGED_SIBLING_SUFFIXES)[number];
};

export const MANAGED_SIBLING_SUFFIXES = MANAGED_SUFFIXES;

/**
 * Every `.bak`/`.tmp` in `dir` whose live counterpart is absent.
 *
 * Directory-local and listing-only: no file is opened, so this is cheap enough
 * to run across several roots at boot.
 */
export async function findOrphanSiblings(
  dir: DirectoryHandleLike
): Promise<OrphanSibling[]> {
  const entries = await listDirectoryEntries(dir);
  const fileNames = new Set(
    entries.filter((entry) => entry.kind === "file").map((entry) => entry.name)
  );

  const orphans: OrphanSibling[] = [];
  for (const name of fileNames) {
    const suffix = MANAGED_SUFFIXES.find((candidate) => name.endsWith(candidate));
    if (!suffix) continue;
    const liveName = name.slice(0, -suffix.length);
    // An empty stem is not a managed sibling (a file literally named ".bak").
    if (!liveName) continue;
    if (fileNames.has(liveName)) continue;
    orphans.push({ siblingName: name, liveName, suffix });
  }
  return orphans.sort((left, right) => left.siblingName.localeCompare(right.siblingName));
}

export type OrphanArchiveOutcome =
  | { ok: true; archivedAs: string }
  | { ok: false; reason: string };

/**
 * Archive one orphan out of the read ladder's way.
 *
 * `{name}.orphaned-{ISO}` is chosen so that nothing probes it: `safeReadJson`
 * looks only for exact `.bak`/`.tmp` suffixes, and the `.json`-suffix scanners
 * that enumerate records ignore it too. The bytes stay on the share for an
 * admin who wants them.
 *
 * `timestamp` is a parameter rather than read from the clock here so a test can
 * assert the resulting name.
 */
export async function archiveOrphanSibling(
  dir: DirectoryHandleLike,
  orphan: OrphanSibling,
  timestamp: string
): Promise<OrphanArchiveOutcome> {
  const archivedAs = `${orphan.siblingName}.orphaned-${timestamp.replace(/[:.]/g, "-")}`;
  try {
    // Copy BEFORE removing: if the remove fails the bytes still exist twice,
    // which is recoverable. The reverse order can lose them.
    await copyFileBytes(dir, orphan.siblingName, dir, archivedAs);
    if (typeof dir.removeEntry !== "function") {
      return { ok: false, reason: "this directory handle cannot remove entries" };
    }
    await dir.removeEntry(orphan.siblingName);
    return { ok: true, archivedAs };
  } catch (error) {
    logError(
      "storage:orphan-archive",
      error instanceof Error ? error : new Error(String(error)),
      { action: orphan.siblingName }
    );
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
