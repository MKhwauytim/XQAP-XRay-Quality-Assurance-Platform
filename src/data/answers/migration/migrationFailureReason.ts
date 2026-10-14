// src/data/answers/migration/migrationFailureReason.ts
//
// v154.0 field report: a failed month showed only "could not complete". This
// maps the error a migration run threw to a label key plus a short technical
// line (error name, message, file names when known). Matched by `error.name`,
// not `instanceof`, so it works for DOMExceptions and across module mocks.
import type { LabelKey } from "../../labels/labelsStore";
import { resolveErrorCode } from "../../storage/errorCodes";

export type MigrationFailureReason = { labelKey: LabelKey; detail: string };

const MAX_DETAIL_CHARS = 300;

const BY_NAME: Record<string, LabelKey> = {
  MigrationLockLostError: "answers_layout_migration_reason_lock_lost",
  // Round 7: the lock file could not be (re)written -- the share refused its replace.
  MigrationLockWriteError: "answers_layout_migration_reason_lock_write",
  MigrationLockHeartbeatError: "answers_layout_migration_reason_lock_write",
  EventSegmentUnreadableError: "answers_layout_migration_reason_segment_unreadable",
  AnswersUnreadableError: "answers_layout_migration_reason_answers_unreadable",
  AnswerFoldError: "answers_layout_migration_reason_fold_refused",
  NotReadableError: "answers_layout_migration_reason_not_readable",
  // Chrome stale-snapshot: the file changed between getFile() and the read (round 6).
  InvalidStateError: "answers_layout_migration_reason_file_changed",
  NoModificationAllowedError: "answers_layout_migration_reason_not_readable",
  NotAllowedError: "answers_layout_migration_reason_not_allowed",
  SecurityError: "answers_layout_migration_reason_not_allowed",
  WorkspacePermissionError: "answers_layout_migration_reason_not_allowed",
  QuotaExceededError: "answers_layout_migration_reason_quota",
};

function fileNamesOf(error: { segmentNames?: unknown }): string[] {
  return Array.isArray(error.segmentNames) ? error.segmentNames.filter((name): name is string => typeof name === "string") : [];
}

/**
 * A plain Error carrying safeWrite's retries-exhausted replace refusal: casLoop
 * reports it as the formatted XQ-IO-035/036 sentence (the code is in the text),
 * or the error itself carries that code. Round 7 field report.
 */
function isShareRefusedReplace(error: unknown, message: string): boolean {
  const code = resolveErrorCode(error);
  return code === "XQ-IO-035" || code === "XQ-IO-036" || /XQ-IO-035|XQ-IO-036/.test(message);
}

export function classifyMigrationFailure(error: unknown): MigrationFailureReason {
  if (!(error instanceof Error) && !(typeof error === "object" && error !== null && "name" in error)) {
    return { labelKey: "answers_layout_migration_reason_generic", detail: String(error).slice(0, MAX_DETAIL_CHARS) };
  }
  const named = error as { name?: unknown; message?: unknown; segmentNames?: unknown };
  const name = typeof named.name === "string" && named.name !== "" ? named.name : "Error";
  const message = typeof named.message === "string" ? named.message : "";
  const files = fileNamesOf(named);
  const verify = /verif|التحقق|المنسوخ/i.test(message);
  const labelKey = BY_NAME[name] ?? (isShareRefusedReplace(error, message) ? "answers_layout_migration_reason_share_refused" : verify ? "answers_layout_migration_reason_verify" : "answers_layout_migration_reason_generic");
  const fileNote = files.length > 0 && !files.every((file) => message.includes(file)) ? ` [${files.join(", ")}]` : "";
  return { labelKey, detail: `${name}: ${message}${fileNote}`.slice(0, MAX_DETAIL_CHARS) };
}
