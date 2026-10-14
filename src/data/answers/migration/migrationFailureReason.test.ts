// src/data/answers/migration/migrationFailureReason.test.ts
import { describe, expect, it } from "vitest";
import { EventSegmentUnreadableError } from "../../storage/appendOnlyEventLog";
import { AnswersUnreadableError } from "../answerStorage";
import { classifyMigrationFailure } from "./migrationFailureReason";

function named(name: string, message = "m"): Error {
  return Object.assign(new Error(message), { name });
}

describe("classifyMigrationFailure", () => {
  it.each([
    [named("MigrationLockLostError"), "answers_layout_migration_reason_lock_lost"],
    [new AnswersUnreadableError("5-may-2026"), "answers_layout_migration_reason_answers_unreadable"],
    [named("AnswerFoldError"), "answers_layout_migration_reason_fold_refused"],
    [named("NotReadableError"), "answers_layout_migration_reason_not_readable"],
    [named("InvalidStateError"), "answers_layout_migration_reason_file_changed"],
    [named("NotAllowedError"), "answers_layout_migration_reason_not_allowed"],
    [named("QuotaExceededError"), "answers_layout_migration_reason_quota"],
    [new Error("copy verify failed"), "answers_layout_migration_reason_verify"],
    [new Error("boom"), "answers_layout_migration_reason_generic"],
    ["a string", "answers_layout_migration_reason_generic"],
  ])("%s → %s", (error, key) => {
    expect(classifyMigrationFailure(error).labelKey).toBe(key);
  });

  it("names the unreadable segment in the technical detail", () => {
    const reason = classifyMigrationFailure(new EventSegmentUnreadableError(["seg-a.ndjson"]));
    expect(reason.labelKey).toBe("answers_layout_migration_reason_segment_unreadable");
    expect(reason.detail).toMatch(/^EventSegmentUnreadableError: .*seg-a\.ndjson/);
  });
});
