/**
 * File naming for the PER-USER persistent error logs.
 *
 * Deliberately reuses `auditUserStem` rather than reimplementing it: the
 * collision property it provides (two usernames that sanitize alike still get
 * distinct files) is the whole reason the per-writer layout is safe, and having
 * two independent implementations of it is how they drift apart.
 *
 * Same renames-and-deletion doctrine as `auditPaths.ts:19-26`: these files are
 * NOT part of `getUserWorkspaceFootprint`, so they neither block a username
 * rename nor get destroyed by a user deletion. An error is history keyed to the
 * name that was in force when it happened.
 */

import { auditUserStem } from "../audit/auditPaths";

export const ERRORS_FILE_SUFFIX = ".errors.json";

export function errorsFileName(username: string): string {
  return `${auditUserStem(username)}${ERRORS_FILE_SUFFIX}`;
}

/**
 * Per-user per-year archive of entries evicted from that user's live log.
 *
 * Note the suffix arithmetic that keeps the two listings in `system-errors/`
 * disjoint with no second predicate:
 *   `"bob-1a2b3c.errors.2026.json".endsWith(ERRORS_FILE_SUFFIX) === false`
 * — the year sits between `.errors` and `.json`. A `.includes()` in the reader
 * would silently fold every archive into the live log; pinned by a test.
 */
export function errorsArchiveFileName(username: string, year: number): string {
  return `${auditUserStem(username)}.errors.${year}.json`;
}

/** True for `{stem}.errors.{year}.json`, false for `{stem}.errors.json`. */
export function isErrorsArchiveFileName(fileName: string, year: number): boolean {
  return fileName.endsWith(`.errors.${year}.json`);
}
