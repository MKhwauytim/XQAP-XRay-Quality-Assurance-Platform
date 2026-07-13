import type { ReferralRequest, ReopenRequest, ReplacementRequest } from "../referral/referralTypes";

export type FieldAnswer = {
  fieldId: string;
  value: string | number | boolean | null;
};

export type ItemAnswerStatus = "draft" | "submitted";

/** Audit trace of supervisor corrections on a submitted answer. */
export type ItemAnswerHistoryEntry = {
  action: "reopened";
  at: string;
  by: string;
  reason: string;
  previousSubmittedAt: string | null;
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
