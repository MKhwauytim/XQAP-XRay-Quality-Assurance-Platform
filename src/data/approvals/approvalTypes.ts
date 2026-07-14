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

export type DecisionEventKind = "referral" | "replacement" | "reopen";

/** One reviewer decision on one request. Appended, never overwritten — the full
 *  sequence for a request is its audit history; the last event is its effective status. */
export type DecisionEvent = {
  requestId: string;
  kind: DecisionEventKind;
  status: "approved" | "denied";
  reviewedBy: string;
  reviewedAt: string;
  reviewNotes?: string;
  /**
   * djb2 hash of the immediately-preceding decision in this supervisor's chain (B5).
   * Absent on the first decision in a file and on legacy events written before B5.
   * TAMPER-EVIDENT ONLY: with no backend/secret key an editor who rewrites a decision
   * can recompute the whole chain — this catches accidental/out-of-band edits, not a
   * determined tamperer (see docs/architecture/SECURITY_MODEL.md).
   */
  previousDecisionHash?: string;
};

export type SupervisorDecisionFile = {
  supervisorUsername: string;
  monthFolderName: string;
  /** Monotonically increasing counter for CAS conflict detection. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  referralDecisions: ReferralDecision[];
  replacementDecisions: ReplacementDecision[];
  /** Append-only decision history. Legacy files predate this field. */
  decisionEvents?: DecisionEvent[];
  lastUpdatedAt: string;
};
