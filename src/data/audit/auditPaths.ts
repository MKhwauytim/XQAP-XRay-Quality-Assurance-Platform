/**
 * File naming for the PER-USER audit logs.
 *
 * Why per-user at all: `5-system/audit/activity.log.json` and
 * `actions.log.json` were single files rewritten in full by every signed-in
 * employee — the activity log alone measured 483 whole-file rewrites per
 * employee per 8-hour shift (a 60 s heartbeat plus login/visibilitychange/
 * pagehide). On a shared SMB folder that turns a normal working morning into
 * sustained contention on the two busiest files in the workspace, and one bad
 * writer's failure is every writer's failure. Splitting the writes so each user
 * owns exactly one file gives the same property `distributionEventStore`'s
 * per-writer segments already have: two machines — or two tabs on one machine —
 * never target the same file.
 *
 * The shared files themselves are NOT migrated. They are read on every
 * aggregate read, written never, deleted never — the same doctrine
 * `workspaceSchema.ts` applies to legacy roots.
 *
 * **Renames and deletion: these files are deliberately NOT part of
 * `getUserWorkspaceFootprint`** (`samples/sampleMirrorStorage.ts`, consumed by
 * `auth/usernameRenameGuard.ts`). An audit trail is history keyed to the name
 * that was in force when the event happened — exactly like `eventBy` inside an
 * immutable distribution event, which the rename guard's own doc cites as
 * unmigratable. Registering them would make every user who has ever logged in
 * permanently unrenameable, and would let a user deletion destroy the trail.
 * Do not "fix" this.
 */

import { simpleHash } from "../storage/jsonEnvelope";
import { safeWorkspaceFilePart } from "../workspace/workspacePaths";

/**
 * Collision-resistant per-user file stem.
 *
 * `safeWorkspaceFilePart` alone is not enough: it maps `a/b` and `a\b` to the
 * same `a_b`, and `sampleMirrorStorage` documents that exact collision as "last
 * writer wins". For an audit log a collision silently restores the two-writer
 * bug this whole layout exists to remove, so the RAW username is hashed in —
 * two names that sanitize alike still get distinct files. Same technique as
 * `distributionEventStore`'s segment-id shortening.
 */
export function auditUserStem(username: string): string {
  return `${safeWorkspaceFilePart(username)}-${simpleHash(username).padStart(6, "0").slice(0, 6)}`;
}

export const ACTIVITY_FILE_SUFFIX = ".activity.json";
export const ACTIONS_FILE_SUFFIX = ".actions.json";

export function activityFileName(username: string): string {
  return `${auditUserStem(username)}${ACTIVITY_FILE_SUFFIX}`;
}

export function actionsFileName(actor: string): string {
  return `${auditUserStem(actor)}${ACTIONS_FILE_SUFFIX}`;
}

/**
 * Per-actor per-year archive of entries evicted from that actor's live log.
 *
 * Note the suffix arithmetic that keeps the two listings in `audit/actions/`
 * disjoint with no second predicate:
 *   `"bob-1a2b3c.actions.2026.json".endsWith(ACTIONS_FILE_SUFFIX) === false`
 * — the year sits between `.actions` and `.json`. This is the same subtlety
 * `backupStorage` documents for `.ndjson`; a `.includes()` here would silently
 * fold every archive into the live log, so it is pinned by a test.
 */
export function actionsArchiveFileName(actor: string, year: number): string {
  return `${auditUserStem(actor)}.actions.${year}.json`;
}

/** True for `{stem}.actions.{year}.json`, false for `{stem}.actions.json`. */
export function isActionsArchiveFileName(fileName: string, year: number): boolean {
  return fileName.endsWith(`.actions.${year}.json`);
}
