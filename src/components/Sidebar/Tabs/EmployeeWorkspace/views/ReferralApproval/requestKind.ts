import type {
  ReferralRequest,
  ReferralStatus,
  ReopenRequest,
  ReplacementRequest,
} from "../../../../../../data/referral/referralTypes";

/** The three request kinds surfaced on the unified اعتماد الطلبات page. */
export type CardRequest = ReferralRequest | ReplacementRequest | ReopenRequest;
export type RequestKind = "referral" | "replacement" | "reopen";

/**
 * Structural discriminator for the three request shapes:
 *  - ReferralRequest    → has `toEmployee`
 *  - ReplacementRequest → has `replacementXrayImageId`
 *  - ReopenRequest      → neither (a single `xrayImageId`, no target/replacement)
 */
export function requestKind(request: CardRequest): RequestKind {
  if ("toEmployee" in request) return "referral";
  if ("replacementXrayImageId" in request) return "replacement";
  return "reopen";
}

export function isReferral(request: CardRequest): request is ReferralRequest {
  return requestKind(request) === "referral";
}

export function isReplacement(request: CardRequest): request is ReplacementRequest {
  return requestKind(request) === "replacement";
}

export function isReopen(request: CardRequest): request is ReopenRequest {
  return requestKind(request) === "reopen";
}

export const KIND_LABELS: Record<RequestKind, string> = {
  referral: "إحالة",
  replacement: "استبدال",
  reopen: "إعادة فتح",
};

/** Shared status badge copy/class — kept in one place so HistoryView and
 *  RequestCard can never drift on the Arabic wording or badge tone. */
export const STATUS_BADGE_LABEL: Record<ReferralStatus, string> = {
  pending: "معلق",
  approved: "مقبول",
  denied: "مرفوض",
};

export const STATUS_BADGE_CLASS: Record<ReferralStatus, string> = {
  pending: "ew-ref-badge-pending",
  approved: "ew-ref-badge-approved",
  denied: "ew-ref-badge-denied",
};
