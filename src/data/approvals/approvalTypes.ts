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

/** The two outcomes a request can actually end up in. `"reverted"` is a
 *  bookkeeping event, never an outcome — see `DecisionEventStatus`. */
export type DecisionOutcome = "approved" | "denied";

/**
 * `"reverted"` is the append-only undo marker: the reviewer who owns a decision
 * takes it back by APPENDING a revocation rather than by deleting or rewriting
 * the original event, so the audit trail keeps both. A reverted decision stops
 * counting toward the request's effective status (see `effectiveDecision`).
 */
export type DecisionEventStatus = DecisionOutcome | "reverted";

/** One reviewer decision on one request. Appended, never overwritten — the full
 *  sequence for a request is its audit history; the effective status is the
 *  earliest decision that has not been revoked. */
export type DecisionEvent = {
  requestId: string;
  kind: DecisionEventKind;
  status: DecisionEventStatus;
  reviewedBy: string;
  reviewedAt: string;
  reviewNotes?: string;
  /**
   * Set only on `status: "reverted"`: the `reviewedAt` of the decision this event
   * revokes. Identifies the target without mutating it — the revoked event stays
   * in the file exactly as written, chain hash included.
   */
  revokesDecisionAt?: string;
  /**
   * djb2 hash of the immediately-preceding decision in this supervisor's chain (B5).
   * Absent on the first decision in a file and on legacy events written before B5.
   * TAMPER-EVIDENT ONLY: with no backend/secret key an editor who rewrites a decision
   * can recompute the whole chain — this catches accidental/out-of-band edits, not a
   * determined tamperer (see docs/architecture/SECURITY_MODEL.md).
   */
  previousDecisionHash?: string;
};

/** A decision event that is an actual outcome (never a revocation marker). */
export type DecisionOutcomeEvent = DecisionEvent & { status: DecisionOutcome };

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
