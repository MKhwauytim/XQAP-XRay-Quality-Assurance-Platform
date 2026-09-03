// DataTable's `rowMatchesFilter` override for the queue table's synthetic
// "answerStatus" ("الحالة") column, whose value lives in the answers map (and,
// for the on-hold split, the template) rather than on the entry itself. Lives
// outside XrayReferrals.tsx for the same reason caseFilter.ts does — sibling
// module, unit-testable without rendering the page.
//
// Must stay exhaustive over the four states `StatusBadge`/
// `getReferralPreviewValue` (in subComponents.tsx) can actually render —
// مستبدلة / مكتملة / معلق / قيد الانتظار — with no catch-all `return true`.
// Two real bugs lived here before this file existed:
//
//   1. "مستبدلة" (replaced) was a no-op filter: a non-replaced row fell
//      through every branch to a trailing `return true`, so filtering to
//      "مستبدلة" showed every row, not just replaced ones.
//   2. The v123.3 "معلق" (on-hold — a submitted "لا يوجد صورة" answer) status
//      was wired into `StatusBadge`'s rendering but never became a selectable
//      filter option, and the "مكتملة" (submitted) branch matched ANY
//      submitted answer — on-hold included — so filtering to "مكتملة" still
//      mixed in معلق rows.
//
// Returning null for every other column/filter kind hands that case back to
// DataTable's own default matching, which is what makes this an override
// rather than a replacement.

import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import { isNoImageSubmission } from "../../../../../../data/answers/noImageAnswer";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { TemplateSchema } from "../../../../../../data/templates/templateTypes";
import type { AnyFilter } from "../../../../../../components/DataTable/utils";

export function buildAnswerStatusFilter(
  answersMap: Map<string, ItemAnswer>,
  template: TemplateSchema | null
): (entry: DistributionEntry, colId: string, filter: AnyFilter) => boolean | null {
  return (entry, colId, filter) => {
    if (colId !== "answerStatus" || filter.kind !== "status") return null;
    const v = filter.value;
    if (!v || v === "all") return true;
    if (entry.status === "replaced") return v === "replaced";
    if (v === "replaced") return false;
    const answer = answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`);
    if (answer?.status === "submitted") {
      return isNoImageSubmission(answer, template) ? v === "on_hold" : v === "submitted";
    }
    return v === "pending";
  };
}
