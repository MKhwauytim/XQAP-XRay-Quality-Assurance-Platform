/**
 * The on-disk shape of the persistent error log.
 *
 * SCHEMA CONTRACT. Every field below is written by `errorLogStorage.ts` and
 * read by `errorLogExport.ts` and the Settings viewer. Adding an optional field
 * is safe; removing or repurposing one is not — an existing workspace's files
 * are never migrated (see the rollback note in this task's edit-log entry), so
 * a reader must always tolerate an older file that lacks a newer field.
 */

/** One recorded error, as persisted. Mirrors ErrorEntry plus identity/ordering. */
export type PersistedErrorEntry = {
  /** `err-<uuid>`. Dedup key for archive idempotence and cross-file merge. */
  id: string;
  /** ISO timestamp, taken from the ErrorEntry that produced this. */
  at: string;
  /** The signed-in user who hit it. `"unknown"` only if somehow unset. */
  username: string;
  /** That user's REAL role at the time — never an admin's previewed role. */
  role?: string;
  /** Active tab, or `tab/sub-tab`, or `"unknown"`. */
  page: string;
  /** What was being attempted (defaults to `context` — see errorLogger.ts). */
  action: string;
  /** The `module:operation` label the call site passed to logError. */
  context: string;
  message: string;
  /** `XQ-AREA-NNN` when known. */
  errorCode?: string;
  /** Truncated at MAX_STACK_LENGTH (500) by errorLogger before it gets here. */
  stack?: string;
  /**
   * The thrown value's DOM `name` — `"InvalidStateError"`, `"NotFoundError"`,
   * `"NoModificationAllowedError"`, … — when it said more than a plain
   * `"Error"`. Optional, like every field here, so a file written before this
   * existed stays readable.
   *
   * This is the field the 2026-08-25 XQ-IO-032 incident needed and did not
   * have. `errorCode` alone could not identify the fault: the whole point of
   * XQ-IO-032 is that the classifier did NOT recognise the exception, so the
   * code recorded was the catch-all and the one piece of evidence that would
   * have named the condition — the DOM name — was never written down. An
   * unrecognised name is exactly the case where this matters most.
   */
  errorName?: string;
};

/** ONE user's own live log — the only live shape this module ever writes. */
export type UserErrorLogFile = {
  /** RAW, unsanitized username. Informational; entries carry their own. */
  username: string;
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  updatedAt: string;
  /**
   * Live entries. Capped at `maxErrorEntries`: on overflow the oldest are
   * appended to a per-year archive BEFORE being trimmed here — never dropped
   * without archiving. Archive failure blocks the trim.
   */
  entries: PersistedErrorEntry[];
};

/**
 * Per-year archive of entries evicted from a user's live log.
 *
 * NO `previousArchiveHash`. `actionLog`'s archives carry a djb2 chain link (B5)
 * because they are governance evidence about people and a tamper-EVIDENT
 * property is worth something there. This log is diagnostics about software;
 * adding the chain would imply an evidentiary guarantee the security model
 * (docs/architecture/SECURITY_MODEL.md) explicitly does not make, and would
 * cost a second read per archive write on a shared SMB folder for it.
 */
export type ErrorLogArchiveFile = {
  year: number;
  revision: number;
  updatedAt: string;
  entries: PersistedErrorEntry[];
};
