import type { DistributionCurrentData } from "../distribution/distributionTypes";

type GuardResult = { ok: true } | { ok: false; error: string };

/** Rejects a mutation if the request has already been decided by another
 *  reviewer/session since this UI last loaded it — prevents double-approval
 *  and approve-after-deny races. Callers must re-load the current status
 *  immediately before calling this, not rely on cached UI state. */
export function assertRequestPending(
  currentStatus: "pending" | "approved" | "denied"
): GuardResult {
  if (currentStatus !== "pending") {
    return {
      ok: false,
      error: "تم اتخاذ قرار بشأن هذا الطلب مسبقاً من جهاز أو نافذة أخرى — أعد تحميل الصفحة لعرض الحالة الحالية.",
    };
  }
  return { ok: true };
}

/** Rejects a referral approval if any sample has moved to a different employee
 *  since the request was submitted (e.g. a second referral or a replacement
 *  already reassigned it). Requires a freshly-derived distribution snapshot. */
export function assertSamplesOwnedBy(
  distribution: DistributionCurrentData | null,
  xrayImageIds: string[],
  expectedOwner: string
): GuardResult {
  if (!distribution) {
    return { ok: false, error: "تعذر التحقق من ملكية العينات — لم يتم العثور على بيانات التوزيع لهذا الشهر." };
  }
  const entryByImageId = new Map(distribution.entries.map((entry) => [entry.xrayImageId, entry]));
  const mismatched = xrayImageIds.filter((id) => entryByImageId.get(id)?.assignedTo !== expectedOwner);
  if (mismatched.length > 0) {
    return {
      ok: false,
      error: `لم تعد العينات التالية مسندة إلى ${expectedOwner}: ${mismatched.join("، ")}. حدّث الصفحة وأعد المحاولة.`,
    };
  }
  return { ok: true };
}
