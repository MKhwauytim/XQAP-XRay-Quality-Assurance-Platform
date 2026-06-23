import type { ReferralRequest, ReplacementRequest } from "../referral/referralTypes";

export type FieldAnswer = {
  fieldId: string;
  value: string | number | boolean | null;
};

export type ItemAnswerStatus = "draft" | "submitted";

export type ItemAnswer = {
  xrayImageId: string;
  templateId: string;
  templateVersion: number;
  answers: FieldAnswer[];
  lastSavedAt: string;
  submittedAt: string | null;
  answeredBy: string;
  status: ItemAnswerStatus;
};

export type EmployeeAnswerFile = {
  username: string;
  monthFolderName: string;
  items: ItemAnswer[];
  /** Referral requests sent by this employee — sole owner, no shared-file conflicts. */
  referralRequests?: ReferralRequest[];
  /** Replacement requests submitted by this employee — sole owner, no shared-file conflicts. */
  replacementRequests?: ReplacementRequest[];
  lastUpdatedAt?: string;
};
