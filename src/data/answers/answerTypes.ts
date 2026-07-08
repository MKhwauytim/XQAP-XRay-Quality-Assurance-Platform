import type { ReferralRequest, ReplacementRequest } from "../referral/referralTypes";

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
  lastUpdatedAt?: string;
};
