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
};

export type ReplacementLog = {
  monthFolderName: string;
  revision: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  requests: ReplacementRequest[];
};
