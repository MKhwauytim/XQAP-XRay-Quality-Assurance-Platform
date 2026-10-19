/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { installFreshIndexedDb } from "../../test-utils/freshIndexedDb";
import { countUnsentAnswers, discardPendingAnswers, loadPendingAnswerRecords, queueAnswerForLanding } from "./answerLocalMirror";

const item = (id: string) => ({
  xrayImageId: id, templateId: "t", templateVersion: 1, answers: [], lastSavedAt: "2026-10-13T10:00:00.000Z",
  submittedAt: "2026-10-13T10:00:00.000Z", answeredBy: "emp1", status: "submitted" as const,
});
const id = (n: number) => ({ eventId: `e-${n}`, eventAt: "2026-10-13T10:00:01.000Z" });

describe("discardPendingAnswers", () => {
  beforeEach(() => { installFreshIndexedDb(); });

  it("removes only this user's unsent answers of the given months", async () => {
    await queueAnswerForLanding("10-October-2026", "emp1", item("A"), id(1));
    await queueAnswerForLanding("10-October-2026", "emp1", item("B"), id(2));
    await queueAnswerForLanding("9-September-2026", "emp1", item("C"), id(3));
    await queueAnswerForLanding("10-October-2026", "emp2", item("D"), id(4));

    expect(await discardPendingAnswers("emp1", ["10-October-2026"])).toBe(2);
    expect((await loadPendingAnswerRecords("emp1")).map((r) => r.item.xrayImageId)).toEqual(["C"]);
    expect(await countUnsentAnswers("emp2")).toBe(1);
  });

  it("is a no-op for months with nothing pending", async () => {
    await queueAnswerForLanding("9-September-2026", "emp1", item("C"), id(3));
    expect(await discardPendingAnswers("emp1", ["10-October-2026"])).toBe(0);
    expect(await countUnsentAnswers("emp1")).toBe(1);
  });
});
