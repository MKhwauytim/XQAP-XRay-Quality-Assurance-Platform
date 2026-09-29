// C3: working days are Sunday–Thursday; Friday and Saturday are the weekend.
// Dates are built with the local-time constructor so the test is independent
// of the runner's time zone.
import { describe, expect, it } from "vitest";
import { WEEKEND_DAYS, countWorkingDays, isWorkingDay } from "./workingDays";

describe("countWorkingDays (C3) — Sunday–Thursday, both ends inclusive", () => {
  it("treats Friday and Saturday as the weekend", () => {
    expect([...WEEKEND_DAYS].sort()).toEqual([5, 6]);
    expect(isWorkingDay(new Date(2026, 4, 1))).toBe(false); // Fri 1 May 2026
    expect(isWorkingDay(new Date(2026, 4, 2))).toBe(false); // Sat 2 May
    expect(isWorkingDay(new Date(2026, 4, 3))).toBe(true); // Sun 3 May
    expect(isWorkingDay(new Date(2026, 4, 7))).toBe(true); // Thu 7 May
  });

  it("assigned Monday 4 May, deadline Thursday 28 May 2026 → 19 working days", () => {
    expect(countWorkingDays(new Date(2026, 4, 4), new Date(2026, 4, 28))).toBe(19);
  });

  it("a full Sunday–Saturday week has 5 working days", () => {
    expect(countWorkingDays(new Date(2026, 4, 3), new Date(2026, 4, 9))).toBe(5);
  });

  it("ignores the time of day on both ends", () => {
    expect(countWorkingDays(new Date(2026, 4, 4, 23, 59), new Date(2026, 4, 4, 0, 1))).toBe(1);
    expect(countWorkingDays(new Date(2026, 4, 4, 12), new Date(2026, 4, 28, 23, 59, 59))).toBe(19);
  });

  it("crosses a month boundary (Thu 30 Apr → Sun 3 May = 2)", () => {
    expect(countWorkingDays(new Date(2026, 3, 30), new Date(2026, 4, 3))).toBe(2);
  });

  it("is 0 for a weekend-only span or a start after the deadline", () => {
    expect(countWorkingDays(new Date(2026, 4, 29), new Date(2026, 4, 30))).toBe(0);
    expect(countWorkingDays(new Date(2026, 4, 30), new Date(2026, 4, 28))).toBe(0);
  });

  it("is 0 for an invalid date", () => {
    expect(countWorkingDays(new Date("not-a-date"), new Date(2026, 4, 28))).toBe(0);
  });
});
