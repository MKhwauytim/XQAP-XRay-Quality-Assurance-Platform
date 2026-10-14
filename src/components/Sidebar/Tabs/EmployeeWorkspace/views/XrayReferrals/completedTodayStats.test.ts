// «المنجز اليوم» in the stats strip counts real answer data with the tracking
// tab's «مكتملة في هذا اليوم» rule: submitted non-no-image answers (or
// supervisor-completed entries) whose finish time is on today's local day.
import { describe, expect, it } from "vitest";
import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { TemplateSchema } from "../../../../../../data/templates/templateTypes";
import { computePersonalStats } from "./personalStats";

const template = {
  fields: [{ fieldId: "img", label: "هل يوجد صورة", type: "select" }],
} as unknown as TemplateSchema;

const at = (d: number, h: number): string => new Date(2026, 9, d, h).toISOString();
const entry = (id: string, status: string, lastEventAt = at(1, 9)): DistributionEntry =>
  ({ xrayImageId: id, assignedTo: "emp", status, lastEventAt }) as unknown as DistributionEntry;
const answer = (submittedAt: string, img: "نعم" | "لا", status = "submitted"): ItemAnswer =>
  ({ status, submittedAt, answers: [{ fieldId: "img", value: img }] }) as unknown as ItemAnswer;

describe("computePersonalStats.completedToday", () => {
  it("counts today's completions only — hold, drafts, other days excluded", () => {
    const source = [
      entry("1", "assigned"), entry("2", "assigned"), entry("3", "assigned"),
      entry("4", "assigned"), entry("5", "assigned"), entry("6", "completed", at(14, 7)),
    ];
    const answersMap = new Map<string, ItemAnswer>([
      ["1::emp", answer(at(14, 10), "نعم")],
      ["2::emp", answer(at(14, 11), "لا")],
      ["3::emp", answer(at(13, 23), "نعم")],
      ["4::emp", answer(at(14, 12), "نعم", "draft")],
    ]);
    const stats = computePersonalStats({ source, answersMap, template, today: new Date(2026, 9, 14, 18) });
    expect(stats.completedToday).toBe(2);
  });
});
