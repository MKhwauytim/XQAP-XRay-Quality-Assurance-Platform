import { describe, expect, it } from "vitest";

import {
  FEEDBACK_THREAD_FILE_SUFFIX,
  feedbackThreadFileName,
  newFeedbackThreadId,
} from "./feedbackStorage";

describe("feedback thread ids", () => {
  it("mints a short, time-ordered id", () => {
    const id = newFeedbackThreadId(new Date("2026-08-24T10:15:30.123Z"));
    expect(id).toMatch(/^t20260824101530-[0-9a-f]{8}$/);
    // Short enough that a deep UNC path plus Chromium's .crswap sibling fits.
    expect(`${id}${FEEDBACK_THREAD_FILE_SUFFIX}`.length).toBeLessThanOrEqual(40);
  });

  it("orders lexicographically by creation time", () => {
    const older = newFeedbackThreadId(new Date("2026-08-24T10:00:00.000Z"));
    const newer = newFeedbackThreadId(new Date("2026-08-24T10:00:01.000Z"));
    expect([newer, older].sort()).toEqual([older, newer]);
  });

  it("sorts every legacy UUID id before every minted id", () => {
    // Migrated legacy threads keep their UUID; every hex first character is
    // below "t", so they occupy the oldest region of the name sort -- which is
    // what keeps boundedSizeSignature's tail sample pointed at recent activity.
    const uuid = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    const minted = newFeedbackThreadId(new Date("2026-01-01T00:00:00.000Z"));
    expect([minted, uuid].sort()).toEqual([uuid, minted]);
  });

  it("rejects an id that would escape or collide instead of sanitizing it", () => {
    expect(() => feedbackThreadFileName("../escape")).toThrow();
    expect(() => feedbackThreadFileName("has/slash")).toThrow();
    expect(() => feedbackThreadFileName("")).toThrow();
    expect(() => feedbackThreadFileName("x".repeat(81))).toThrow();
  });

  it("accepts a legacy UUID id unchanged", () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(feedbackThreadFileName(uuid)).toBe(`${uuid}.json`);
  });
});
