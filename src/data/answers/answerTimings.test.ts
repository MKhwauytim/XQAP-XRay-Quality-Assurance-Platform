import { beforeEach, describe, expect, it } from "vitest";
import {
  ANSWER_TIMING_RING_MAX,
  __resetAnswerTimingsForTests,
  answerTimingsToJson,
  getAnswerTimings,
  timeAnswerStep,
} from "./answerTimings";

describe("answerTimings", () => {
  beforeEach(() => __resetAnswerTimingsForTests());

  it("records name, non-negative ms and an ISO timestamp", async () => {
    const out = await timeAnswerStep("submit.decide", async () => 7, { items: 2 });
    expect(out).toBe(7);
    const [t] = getAnswerTimings();
    expect(t.name).toBe("submit.decide");
    expect(t.ms).toBeGreaterThanOrEqual(0);
    expect(new Date(t.at).toISOString()).toBe(t.at);
    expect(t.detail).toEqual({ items: 2 });
  });

  it("keeps only the newest ring entries", async () => {
    for (let i = 0; i < ANSWER_TIMING_RING_MAX + 5; i++) {
      await timeAnswerStep(`s${i}`, async () => i);
    }
    const all = getAnswerTimings();
    expect(all).toHaveLength(ANSWER_TIMING_RING_MAX);
    expect(all[0].name).toBe("s5");
  });

  it("records a throwing step and rethrows", async () => {
    await expect(
      timeAnswerStep("flush.item", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(getAnswerTimings().map((t) => t.name)).toEqual(["flush.item"]);
  });

  it("serialises to JSON that parses back to the same array", async () => {
    await timeAnswerStep("a", async () => 1);
    await timeAnswerStep("b", async () => 2, { segments: 3 });
    expect(JSON.parse(answerTimingsToJson())).toEqual(getAnswerTimings());
  });
});
