import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { TemplateSchema } from "../../../../../../data/templates/templateTypes";
import { resolveTemplateForAnswer } from "../../../../../../data/templates/templateAnswerResolution";
import { classifyAnswerState, countCompletedOnDay, trackingDoneAt, type TrackingRow } from "../../../../../../data/tracking/deadlineTracking";
import type { PersonalStats } from "../XrayReferrals";
import { isOnHoldEntry, isStudyCompleted, pct } from "./subComponents";

/**
 * The «متابعة العمل» figures, over EXACTLY the rows the queue table shows: the
 * picked scope (everyone, one named employee, or the reader's own rows)
 * narrowed by the active case chip and CertScan chip. It used to read the scope BEFORE the chips
 * (and, for employees, re-filter every row by username), so picking
 * «حالات استثنائية» changed the table but not the strip — field report
 * 2026-09-28. The daily-quota tile is not derived here: it is a property of
 * the whole assignment and stays unfiltered. Module-level so the component
 * body stays inside the repo's `max-lines-per-function` budget.
 */
export function computePersonalStats(input: {
  source: DistributionEntry[];
  answersMap: Map<string, ItemAnswer>;
  template: TemplateSchema | null;
  templatesById?: ReadonlyMap<string, TemplateSchema>;
  /** The local day «المنجز اليوم» counts; defaults to now. */
  today?: Date;
}): PersonalStats {
  const { source, answersMap, template, templatesById } = input;
  const todayRows: Pick<TrackingRow, "state" | "doneAt">[] = [];
  for (const entry of source) {
    const answer = answersMap.get(`${entry.xrayImageId}::${entry.assignedTo}`) ?? null;
    const rowTemplate = templatesById ? resolveTemplateForAnswer(answer, templatesById, template) : template;
    const state = classifyAnswerState(entry.status, answer, rowTemplate);
    if (state === "replaced") continue;
    todayRows.push({ state, doneAt: trackingDoneAt(state, answer, entry.lastEventAt) });
  }
  const onHold = source.filter((entry) => isOnHoldEntry(entry, answersMap, template, templatesById)).length;
  // isStudyCompleted counts a "لا يوجد صورة" submission as completed too — it
  // answers "is this row touched/done in a generic sense" for row styling, not
  // "is this a real completion". Subtracting onHold here is what keeps this
  // strip's "مكتملة" figure from double-counting them.
  const submitted = source.filter((entry) => isStudyCompleted(entry, answersMap)).length - onHold;
  const replaced = source.filter((entry) => entry.status === "replaced").length;
  const notStarted = Math.max(0, source.length - submitted - onHold - replaced);
  return {
    assigned: source.length,
    submitted,
    onHold,
    notStarted,
    replaced,
    active: Math.max(0, source.length - replaced),
    completionPct: pct(submitted, source.length),
    completedToday: countCompletedOnDay(todayRows, input.today ?? new Date()),
  };
}
