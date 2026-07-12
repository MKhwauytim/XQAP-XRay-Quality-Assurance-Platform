import type { DecisionEvent } from "../approvals/approvalTypes";

export type ReferralStatus = "pending" | "approved" | "denied";

export type ReferralRequest = {
  requestId: string;
  monthFolderName: string;
  fromEmployee: string;
  toEmployee: string;
  xrayImageIds: string[];
  reason: string;
  requestedAt: string;
  requestedBy: string;
  status: ReferralStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  /** Full append-only decision history, newest last. Populated by loadReferralLog. */
  history?: DecisionEvent[];
};

export type ReferralLog = {
  monthFolderName: string;
  /** Monotonically increasing counter for CAS conflict detection. */
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  requests: ReferralRequest[];
};

/** A pending request to replace one sample with a non-recommended alternative.
 *  Created when an employee picks from the "all" tab (not recommended).
 *  Requires supervisor/admin approval before the swap is executed. */
export type ReplacementRequest = {
  requestId: string;
  monthFolderName: string;
  employeeUsername: string;
  originalXrayImageId: string;
  replacementXrayImageId: string;
  /**
   * @deprecated Row data is now resolved from the population at approval time
   * to avoid stale copies. Field is kept optional for reading old stored requests.
   */
  replacementRowData?: Record<string, unknown>;
  reason: string;
  requestedAt: string;
  requestedBy: string;
  status: ReferralStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  /** Full append-only decision history, newest last. Populated by loadReplacementLog. */
  history?: DecisionEvent[];
};

export type ReplacementLog = {
  monthFolderName: string;
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  requests: ReplacementRequest[];
};

/** A pending request from an employee to reopen their own submitted answer for
 *  correction. Created when the employee's role is NOT granted instant reopen
 *  (`employee-reopen-instant`); requires supervisor approval before the answer is
 *  returned to draft. Mirrors ReplacementRequest's shape. This is a SEPARATE path
 *  from the supervisor-facing `ew.reopenAnswer` direct reopen. */
export type ReopenRequest = {
  requestId: string;
  monthFolderName: string;
  /** The employee whose submitted answer is to be reopened (== requestedBy for self-service). */
  employeeUsername: string;
  /** The specific case/answer being reopened. */
  xrayImageId: string;
  reason: string;
  requestedAt: string;
  requestedBy: string;
  status: ReferralStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  /** Full append-only decision history, newest last. Populated by loadReopenLog. */
  history?: DecisionEvent[];
};

export type ReopenLog = {
  monthFolderName: string;
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  requests: ReopenRequest[];
};
