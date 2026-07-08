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

export type DecisionEventKind = "referral" | "replacement";

/** One reviewer decision on one request. Appended, never overwritten — the full
 *  sequence for a request is its audit history; the last event is its effective status. */
export type DecisionEvent = {
  requestId: string;
  kind: DecisionEventKind;
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
  /** Append-only decision history. Legacy files predate this field. */
  decisionEvents?: DecisionEvent[];
  lastUpdatedAt: string;
};
