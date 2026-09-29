// C3: «الحصة اليومية» = ceil(assigned / working days), working days = Sunday–
// Thursday from the employee's first `assigned` event to the deadline (the
// sample month's last day − 3), inclusive, minimum 1. Frozen: completing work
// and the passage of time never move it; only a change in the employee's
// assigned count does. eventAt instants are 09:00Z so the local calendar day
// is the same in every time zone from UTC−9 to UTC+14.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRow } from "../reporting/reportTestFixtures";
import {
  computeWorkingDaysForDeadline,
  deriveEmployeeQuotasWithFacts,
  foldDistributionEvents,
} from "./distributionDerivation";
import type { DistributionEvent } from "./distributionTypes";

const MONTH = "5-May-2026"; // deadline: Thursday 28 May 2026
const MONDAY_4_MAY = "2026-05-04T09:00:00.000Z";

function evt(
  eventId: string,
  eventType: DistributionEvent["eventType"],
  xrayImageId: string,
  assignedTo: string,
  eventAt: string,
  extra: Partial<DistributionEvent> = {},
): DistributionEvent {
  return { eventId, eventSchemaVersion: 1, eventType, xrayImageId, assignedTo, eventAt, eventBy: "admin", ...extra };
}

function assignAll(count: number, employee: string, eventAt: string): DistributionEvent[] {
  return Array.from({ length: count }, (_, i) => evt(`a${i}`, "assigned", `img-${i}`, employee, eventAt));
}

function quotaFor(events: DistributionEvent[], employee: string) {
  const ids = [...new Set(events.map((event) => event.xrayImageId))];
  const fold = foldDistributionEvents(events, ids.map((id) => makeRow(id, "بري")), 1);
  return deriveEmployeeQuotasWithFacts(events, fold.entries, fold, MONTH).quotas?.[employee];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("daily quota over working days (C3)", () => {
  it("computeWorkingDaysForDeadline: Monday 4 May → Thursday 28 May 2026 = 19", () => {
    expect(computeWorkingDaysForDeadline(5, 2026, new Date(2026, 4, 4, 12))).toBe(19);
  });

  it("assigned on the 4th, deadline the 28th, weekends excluded → ceil(40 / 19) = 3", () => {
    expect(quotaFor(assignAll(40, "emp-a", MONDAY_4_MAY), "emp-a")).toMatchObject({
      sampleCount: 40,
      daysRemainingAtAssignment: 19,
      dailyQuota: 3,
    });
  });

  it("does not move when items are completed", () => {
    const completed = Array.from({ length: 10 }, (_, i) =>
      evt(`c${i}`, "completed", `img-${i}`, "emp-a", "2026-05-10T09:00:00.000Z"),
    );
    expect(quotaFor([...assignAll(40, "emp-a", MONDAY_4_MAY), ...completed], "emp-a")).toMatchObject({
      sampleCount: 40,
      daysRemainingAtAssignment: 19,
      dailyQuota: 3,
    });
  });

  it("does not move with the passage of time (before, near and after the deadline)", () => {
    const events = assignAll(40, "emp-a", MONDAY_4_MAY);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-05T09:00:00.000Z"));
    const early = quotaFor(events, "emp-a");
    vi.setSystemTime(new Date("2026-05-27T09:00:00.000Z"));
    const late = quotaFor(events, "emp-a");
    vi.setSystemTime(new Date("2026-06-15T09:00:00.000Z"));
    const afterDeadline = quotaFor(events, "emp-a");
    expect(early).toMatchObject({ dailyQuota: 3 });
    expect(late).toEqual(early);
    expect(afterDeadline).toEqual(early);
  });

  it("changes when the assigned count changes (10 reassigned away → ceil(30 / 19) = 2)", () => {
    const reassigned = Array.from({ length: 10 }, (_, i) =>
      evt(`r${i}`, "reassigned", `img-${i}`, "emp-a", "2026-05-06T09:00:00.000Z", { reassignedTo: "emp-b" }),
    );
    expect(quotaFor([...assignAll(40, "emp-a", MONDAY_4_MAY), ...reassigned], "emp-a")).toMatchObject({
      sampleCount: 30,
      daysRemainingAtAssignment: 19,
      dailyQuota: 2,
    });
  });

  it("an ADDED second assignment later in the month keeps the window anchored at the first: ceil(newTotal / originalWindow)", () => {
    const later = Array.from({ length: 20 }, (_, i) =>
      evt(`b${i}`, "assigned", `img-late-${i}`, "emp-a", "2026-05-20T09:00:00.000Z"),
    );
    // 60 rows over the ORIGINAL 19-day window (4 May), not the 7 days left on 20 May: ceil(60 / 19) = 4.
    expect(quotaFor([...assignAll(40, "emp-a", MONDAY_4_MAY), ...later], "emp-a")).toMatchObject({
      sampleCount: 60,
      daysRemainingAtAssignment: 19,
      dailyQuota: 4,
    });
  });

  it("first assignment after the deadline → floor of one working day (whole assignment per day)", () => {
    expect(quotaFor(assignAll(5, "emp-a", "2026-05-29T09:00:00.000Z"), "emp-a")).toMatchObject({
      daysRemainingAtAssignment: 0,
      dailyQuota: 5,
    });
  });

  it("first assignment on the deadline day itself → exactly one working day", () => {
    expect(quotaFor(assignAll(5, "emp-a", "2026-05-28T09:00:00.000Z"), "emp-a")).toMatchObject({
      daysRemainingAtAssignment: 1,
      dailyQuota: 5,
    });
  });
});
