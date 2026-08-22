import type { ReferralRequest, ReopenRequest, ReplacementRequest } from "../referral/referralTypes";

export type FieldAnswer = {
  fieldId: string;
  value: string | number | boolean | null;
};

export type ItemAnswerStatus = "draft" | "submitted";

/**
 * Audit trace of oversight actions taken on one item.
 *
 * - `"reopened"` — a supervisor returned a submitted answer to draft for
 *   correction (Tier-1 Item D). `by` is the supervisor, `reason` their stated
 *   reason, `previousSubmittedAt` the submission timestamp that was cleared.
 * - `"answered-on-behalf"` — a supervisor holding the `answer-on-behalf`
 *   feature authored an answer that belongs to someone else's assignment.
 *   `by` is the REAL author (the supervisor), `onBehalfOf` the assignee whose
 *   file the answer lives in, `previousSubmittedAt` whatever `submittedAt` the
 *   overwritten answer carried (`null` when this is the first answer for the
 *   item). `reason` may be an empty string — the UI is not required to demand
 *   a justification for an on-behalf answer the way it does for a reopen.
 *
 * The trail is append-only and shared: a single chronological list per item is
 * what makes "sample A, assigned to emp A, was answered by employee B, then
 * reopened by C" readable in order. `previousSubmittedAt` is present on every
 * variant so the existing reopen replay-guard keeps type-checking; `onBehalfOf`
 * is only populated for `"answered-on-behalf"`.
 *
 * NOTE for consumers: anything that means "the last REOPEN" must filter on
 * `action === "reopened"` rather than taking the last element — the array is no
 * longer single-purpose (see `reopenAnswer.ts`).
 */
export type ItemAnswerHistoryEntry = {
  action: "reopened" | "answered-on-behalf";
  at: string;
  by: string;
  reason: string;
  previousSubmittedAt: string | null;
  /** Only for `"answered-on-behalf"`: the assignee the answer was authored for. */
  onBehalfOf?: string;
};

/** Why an overwriting save produced a value-history snapshot (A4). */
export type ItemValueHistoryReason = "save" | "reopen-correction";

/** Snapshot of the answers/status that an overwriting save replaced (A4). */
export type ItemValueSnapshot = {
  answers: FieldAnswer[];
  status: ItemAnswerStatus;
  submittedAt: string | null;
  lastSavedAt: string;
};

/**
 * Per-item append-only value history (A4). One entry is appended each time a
 * save overwrites an item's answers/status, preserving the prior snapshot so an
 * edit or a reopen-correction never destroys the only copy of what was there.
 * Capped (see VALUE_HISTORY_CAP) — the first/original entry is always kept.
 */
export type ItemValueHistoryEntry = {
  changedAt: string;
  changedBy: string;
  reason: ItemValueHistoryReason;
  previous: ItemValueSnapshot;
};

export type ItemAnswer = {
  xrayImageId: string;
  templateId: string;
  templateVersion: number;
  answers: FieldAnswer[];
  lastSavedAt: string;
  submittedAt: string | null;
  answeredBy: string;
  status: ItemAnswerStatus;
  /** Reopen-for-correction trail (Tier-1 Item D). */
  history?: ItemAnswerHistoryEntry[];
  /** Append-only snapshot trail of overwritten answers/status (A4). */
  valueHistory?: ItemValueHistoryEntry[];
  /**
   * Free-text supervisor/reviewer coaching note on this item (P2-2). Independent
   * of the referral/replacement/reopen `reviewNotes` trail (`ReferralRequest` /
   * `ReplacementRequest` / `ReopenRequest` / `ApprovalDecision`) — that field is
   * populated only via a formal approval-gated request; this one lets a
   * supervisor leave a routine quality note without triggering a reopen or any
   * approval workflow. Set via `setItemQualityNote` in `answerStorage.ts`.
   */
  qualityNote?: string;
  /**
   * The user who actually authored the CURRENT answers, when that is someone
   * other than the assignee — i.e. a supervisor holding the `answer-on-behalf`
   * feature answering a sample distributed to someone else.
   *
   * **Absent means "the assignee answered it themselves."** That is the normal
   * case and the reason this is optional rather than defaulted: every answer
   * written before this field existed is, correctly, a self-answer.
   *
   * **This is deliberately NOT `answeredBy`, and must never be folded into it.**
   * `answeredBy` is load-bearing identity, not attribution: an item lives in
   * exactly one per-employee answer file (`{username}.answers.json`, picked by
   * `upsertItemAnswer`'s `username` argument), and every read path keys answers
   * by `${xrayImageId}::${answeredBy}` to match them back to the distribution
   * entry's `${xrayImageId}::${assignedTo}`. So `answeredBy` stays equal to the
   * ASSIGNEE on an on-behalf answer. Setting it to the supervisor would move
   * the key out from under that join: the row would render as unanswered, the
   * item would not count as completed, and the answer would appear to belong to
   * a supervisor who has no assignment for it.
   *
   * Written only by `upsertItemAnswerOnBehalf` in `answerStorage.ts`, which
   * writes it atomically with the matching `"answered-on-behalf"` entry in
   * `history`, refuses a write that names no author, and refuses to overwrite
   * an answer the assignee has already submitted. Every other write path
   * strips it, so the field always describes the answers currently stored — the
   * permanent record of who authored what, and when, is `history`.
   */
  answeredOnBehalfBy?: string;
};

export type EmployeeAnswerFile = {
  username: string;
  monthFolderName: string;
  revision?: number;
  _writeToken?: string;
  items: ItemAnswer[];
  /** Referral requests sent by this employee — sole owner, no shared-file conflicts. */
  referralRequests?: ReferralRequest[];
  /** Replacement requests submitted by this employee — sole owner, no shared-file conflicts. */
  replacementRequests?: ReplacementRequest[];
  /** Reopen-case requests submitted by this employee — sole owner, no shared-file conflicts. */
  reopenRequests?: ReopenRequest[];
  lastUpdatedAt?: string;
};
