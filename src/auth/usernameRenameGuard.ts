import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import { logError } from "../data/storage/errorLogger";
import { getUserWorkspaceFootprint } from "../data/samples/sampleMirrorStorage";

/**
 * Why a username rename was refused, or `null` when it is safe to proceed.
 *
 * - `no-workspace` — nothing is mounted, so the check cannot even be attempted.
 * - `unreadable-workspace` — the scan itself failed (unreadable share, corrupt
 *   file); "I could not look" is NOT "there is nothing there".
 * - `has-workspace-data` — the user owns records on disk keyed by the old name.
 */
export type UsernameRenameBlockReason =
  | "no-workspace"
  | "unreadable-workspace"
  | "has-workspace-data";

/**
 * Pre-rename guard (T-11, 2026-08-19).
 *
 * Every on-disk record this app writes for a person keys on the raw username
 * string: `{username}.answers.json` and `{username}.samples.json`, the
 * `assignedTo` / `answeredBy` / `eventBy` fields inside immutable distribution
 * events, the per-user quota map inside `distribution.current.json`, referral
 * and replacement requests, approvals, and notification acknowledgements. No
 * migration mechanism exists — and, event log being append-only and immutable,
 * none can be added cheaply — so renaming a user who already has work on disk
 * does not move that work: it orphans it. The rows stay assigned to a login
 * that no longer exists, the employee's own view goes empty, and the reports
 * keep attributing the work to a name nobody can log in as.
 *
 * The decision is therefore to BLOCK the rename rather than half-migrate, and
 * to fail CLOSED: when the footprint cannot be established (no workspace
 * mounted, or the scan throws) we cannot prove the user has no work, so we
 * refuse. A user with a genuinely empty footprint renames normally — that is
 * the case where nothing on disk can be orphaned.
 *
 * Reuses `getUserWorkspaceFootprint` (which since T-10 also walks the ad-hoc
 * import stores) rather than inventing a second, drift-prone definition of
 * "has work on disk"; deletion and rename must agree on that answer.
 */
export async function checkUsernameRenameBlocked(
  directoryHandle: DirectoryHandleLike | null,
  currentUsername: string
): Promise<UsernameRenameBlockReason | null> {
  if (!directoryHandle) return "no-workspace";

  try {
    const footprint = await getUserWorkspaceFootprint(directoryHandle, currentUsername);
    if (footprint.activeAssignments.length > 0 || footprint.answerFileMonths.length > 0) {
      return "has-workspace-data";
    }
    return null;
  } catch (error) {
    logError("usernameRenameGuard:footprint", error);
    return "unreadable-workspace";
  }
}
