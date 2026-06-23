export type ReferralDecision = {
  requestId: string;
  status: "approved" | "denied";
  reviewedBy: string;
  reviewedAt: string;
  reviewNotes?: string;
};

export type ReplacementDecision = {
  requestId: string;
  status: "approved" | "denied";
  reviewedBy: string;
  reviewedAt: string;
  reviewNotes?: string;
};

export type SupervisorDecisionFile = {
  supervisorUsername: string;
  monthFolderName: string;
  referralDecisions: ReferralDecision[];
  replacementDecisions: ReplacementDecision[];
  lastUpdatedAt: string;
};
