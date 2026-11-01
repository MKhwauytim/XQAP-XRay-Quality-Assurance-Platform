import { describe, expect, it } from "vitest";
import type { ItemAnswer } from "../answers/answerTypes";
import type { TemplateSchema } from "../templates/templateTypes";
import {
  buildTracking,
  dateOfDay,
  classifyAnswerState,
  dayTotals,
  finishedThroughDay,
  isWorkDay,
  monthTotals,
  quotaOnDay,
  type TrackingRow,
} from "./deadlineTracking";

// October 2026: Thursday the 1st. Friday/Saturday are the weekend.
const YEAR = 2026;
const MONTH = 10;
const TODAY = new Date(2026, 9, 14);
const DEADLINE = new Date(2026, 9, 27);

const template = {
  fields: [{ fieldId: "img", label: "هل يوجد صورة", type: "select" }],
} as unknown as TemplateSchema;

function answer(status: "draft" | "submitted", hasImage: "نعم" | "لا"): ItemAnswer {
  return { status, answers: [{ fieldId: "img", value: hasImage }] } as unknown as ItemAnswer;
}

function rows(
  user: string,
  spec: Array<[TrackingRow["state"], string | null, number]>,
): TrackingRow[] {
  return spec.flatMap(([state, doneAt, n]) =>
    Array.from({ length: n }, () => ({ assignedTo: user, state, doneAt })),
  );
}

describe("classifyAnswerState", () => {
  it("treats a completed entry as completed and a replaced entry as replaced", () => {
    expect(classifyAnswerState("completed", null, template)).toBe("completed");
    expect(classifyAnswerState("replaced", null, template)).toBe("replaced");
  });

  it("a submitted no-image answer is hold (معلقة), not completed", () => {
    expect(classifyAnswerState("pending", answer("submitted", "لا"), template)).toBe("hold");
    expect(classifyAnswerState("pending", answer("submitted", "نعم"), template)).toBe("completed");
  });

  it("a draft or missing answer is pending", () => {
    expect(classifyAnswerState("pending", answer("draft", "لا"), template)).toBe("pending");
    expect(classifyAnswerState("pending", null, template)).toBe("pending");
  });
});

describe("buildTracking", () => {
  const base = [
    ...rows("a", [
      ["completed", "2026-10-05T10:00:00", 6],
      ["hold", "2026-10-05T11:00:00", 2],
      ["completed", "2026-10-06T10:00:00", 3],
      ["pending", null, 27],
    ]),
  ];
  const input = {
    rows: base,
    assignedAtByUser: { a: "2026-10-01T08:00:00" },
    year: YEAR,
    month: MONTH,
    deadline: DEADLINE,
    today: TODAY,
  };

  it("counts per day and per employee, and derives the original quota for the deadline", () => {
    const t = buildTracking(input);
    const a = t.employees[0];
    expect(a).toMatchObject({ username: "a", assigned: 38, completed: 9, hold: 2, unplaced: 0, startDay: 1 });
    expect(a.byDay[5]).toEqual({ completed: 6, hold: 2 });
    expect(a.byDay[6]).toEqual({ completed: 3, hold: 0 });
    // Working days Oct 1 → 27: 1 + 5 + 5 + 5 + 3 = 19 → ceil(38 / 19)
    expect(a.quota).toBe(2);
  });

  it("averages divide by working days elapsed, with and without معلقة", () => {
    const a = buildTracking(input).employees[0];
    // Oct 1 → 14: 1 + 5 + 4 = 10 working days
    expect(a.span).toBe(10);
    expect(a.avgAll).toBeCloseTo(1.1, 5);
    expect(a.avgCompleted).toBeCloseTo(0.9, 5);
  });

  it("a weekend day an employee actually worked counts as a day worked, so it does not inflate the average", () => {
    const t = buildTracking({
      ...input,
      rows: [
        ...rows("a", [
          ["completed", "2026-10-02T10:00:00", 4], // Friday
          ["completed", "2026-10-05T10:00:00", 6], // Monday
          ["pending", null, 30],
        ]),
      ],
    });
    const a = t.employees[0];
    expect(a.byDay[2]).toEqual({ completed: 4, hold: 0 });
    // Oct 1 → 14 is 10 working days, plus the one Friday worked.
    expect(a.span).toBe(11);
    expect(a.avgCompleted).toBeCloseTo(10 / 11, 5);
    // A weekend day never carries a quota target, but its real numbers show.
    expect(dayTotals(t, t.employees, 2)).toMatchObject({ completed: 4, target: 0 });
  });

  it("an earlier deadline raises the quota", () => {
    const t = buildTracking({ ...input, deadline: new Date(2026, 9, 20) });
    // Oct 1 → 20: 1 + 5 + 5 + 3 = 14 working days → ceil(38 / 14)
    expect(t.employees[0].quota).toBe(3);
    expect(t.deadlineDay).toBe(20);
  });

  it("a later assignment day shortens the window and the span", () => {
    const t = buildTracking({
      ...input,
      rows: rows("a", [["pending", null, 38]]),
      assignedAtByUser: { a: "2026-10-11T09:00:00" },
    });
    // The period itself now starts on the assignment day.
    expect(t.periodStart).toEqual(new Date(2026, 9, 11));
    expect(t.employees[0].startDay).toBe(1);
    // Oct 11 → 14 elapsed: Sun–Wed = 4; Oct 11 → 27 window: 5 + 5 + 3 = 13
    expect(t.employees[0].span).toBe(4);
    expect(t.employees[0].quota).toBe(Math.ceil(38 / 13));
  });

  it("an employee with no assignment stamp counts from the month start", () => {
    const t = buildTracking({ ...input, assignedAtByUser: {} });
    expect(t.employees[0].startDay).toBe(1);
  });

  it("finished rows with an unknown date are totalled but not on the calendar", () => {
    const t = buildTracking({ ...input, rows: rows("a", [["completed", null, 2]]) });
    const a = t.employees[0];
    expect(a.completed).toBe(2);
    expect(a.unplaced).toBe(2);
    expect(Object.keys(a.byDay)).toHaveLength(0);
  });

  it("a row finished before the first assignment pulls the period start back onto the calendar", () => {
    const t = buildTracking({ ...input, rows: rows("a", [["completed", "2026-09-30T10:00:00", 1], ["pending", null, 1]]) });
    expect(t.periodStart).toEqual(new Date(2026, 8, 30));
    expect(t.employees[0].unplaced).toBe(0);
    expect(t.employees[0].byDay[1]).toEqual({ completed: 1, hold: 0 });
  });

  it("before the period starts nothing has elapsed; after the deadline, spans keep running", () => {
    const before = buildTracking({ ...input, today: new Date(2026, 8, 20) });
    expect(before.asOfDay).toBe(0);
    expect(before.employees[0].span).toBe(0);
    expect(before.employees[0].avgAll).toBe(0);

    const after = buildTracking({ ...input, today: new Date(2026, 10, 5) });
    // Oct 1 → Nov 5 = 36 days; working days: 19 to Oct 27 + Oct 28–29 + Nov 1–5
    expect(after.asOfDay).toBe(36);
    expect(after.employees[0].span).toBe(26);
  });

  it("lays the month out Saturday-first", () => {
    const t = buildTracking(input);
    // Pending rows keep the period open to today; the calendar reaches the deadline.
    expect(t.periodDays).toBe(14);
    expect(t.calendarDays).toBe(27);
    // Oct 1 2026 is a Thursday: Sat, Sun, Mon, Tue, Wed come first.
    expect(t.leadBlanks).toBe(5);
  });

  it("a deadline before the period clamps to day 1; a later one extends the calendar", () => {
    expect(buildTracking({ ...input, deadline: new Date(2026, 10, 9) })).toMatchObject({ deadlineDay: 40, calendarDays: 40 });
    expect(buildTracking({ ...input, deadline: new Date(2026, 8, 9) }).deadlineDay).toBe(1);
  });
});

describe("day selectors", () => {
  const t = buildTracking({
    rows: [
      ...rows("a", [["completed", "2026-10-05T10:00:00", 4], ["hold", "2026-10-05T12:00:00", 1], ["pending", null, 33]]),
      ...rows("b", [["completed", "2026-10-05T10:00:00", 2], ["pending", null, 18]]),
    ],
    assignedAtByUser: { a: "2026-10-01T08:00:00", b: "2026-10-01T08:00:00" },
    year: YEAR,
    month: MONTH,
    deadline: DEADLINE,
    today: TODAY,
  });

  it("marks Friday and Saturday as non-working", () => {
    expect(isWorkDay(t, 2)).toBe(false); // Fri
    expect(isWorkDay(t, 3)).toBe(false); // Sat
    expect(isWorkDay(t, 4)).toBe(true); // Sun
  });

  it("sums a day across the team and for one employee", () => {
    const [a, b] = t.employees;
    expect(dayTotals(t, t.employees, 5)).toMatchObject({ completed: 6, hold: 1 });
    expect(dayTotals(t, [b], 5)).toMatchObject({ completed: 2, hold: 0 });
    // a: ceil(38/19) = 2, b: ceil(20/19) = 2
    expect(quotaOnDay(t, a, 5)).toBe(2);
    expect(dayTotals(t, t.employees, 5).target).toBe(4);
  });

  it("has no target on a weekend or after the deadline", () => {
    expect(dayTotals(t, t.employees, 2).target).toBe(0);
    expect(dayTotals(t, t.employees, 28).target).toBe(0);
  });

  it("summarises the month and the finished count through a day", () => {
    const m = monthTotals(t, t.employees);
    expect(m).toMatchObject({ assigned: 58, completed: 6, hold: 1, remaining: 51 });
    // Oct 14 → 27: Wed 14, Thu 15, 18–22, 25–27 = 10
    expect(m.daysLeft).toBe(10);
    expect(finishedThroughDay(t.employees, 4)).toBe(0);
    expect(finishedThroughDay(t.employees, 5)).toBe(7);
  });

  it("no days are left once the deadline has passed", () => {
    const late = buildTracking({
      rows: [], assignedAtByUser: {}, year: YEAR, month: MONTH, deadline: DEADLINE, today: new Date(2026, 9, 29),
    });
    expect(monthTotals(late, []).daysLeft).toBe(0);
  });
});

describe("a sample studied across month boundaries", () => {
  // October's sample, distributed Oct 20, still being studied in December.
  const crossRows = [
    ...rows("a", [
      ["completed", "2026-10-21T10:00:00", 5],
      ["completed", "2026-11-03T10:00:00", 4],
      ["hold", "2026-11-03T11:00:00", 1],
      ["completed", "2026-12-08T09:00:00", 2],
    ]),
    ...rows("b", [["completed", "2026-11-15T10:00:00", 3], ["pending", null, 5]]),
  ];
  const cross = {
    rows: crossRows,
    assignedAtByUser: { a: "2026-10-20T08:00:00", b: "2026-10-22T08:00:00" },
    year: YEAR,
    month: MONTH,
    deadline: DEADLINE,
    today: new Date(2026, 11, 10),
  };

  it("runs from the first distribution to today while cases remain", () => {
    const t = buildTracking(cross);
    expect(t.periodStart).toEqual(new Date(2026, 9, 20));
    expect(t.periodEnd).toEqual(new Date(2026, 11, 10));
    // Oct 20 → Dec 10 inclusive: 12 + 30 + 10
    expect(t.periodDays).toBe(52);
    expect(t.asOfDay).toBe(52);
    // Oct 20 is a Tuesday: Sat, Sun, Mon precede it.
    expect(t.leadBlanks).toBe(3);
    expect(t.deadlineDay).toBe(8);
  });

  it("places November and December work on the calendar and counts it per day", () => {
    const t = buildTracking(cross);
    const [a, b] = t.employees;
    const day = (d: Date) => Math.round((d.getTime() - t.periodStart.getTime()) / 86_400_000) + 1;
    expect(a.unplaced).toBe(0);
    expect(a.byDay[day(new Date(2026, 10, 3))]).toEqual({ completed: 4, hold: 1 });
    expect(a.byDay[day(new Date(2026, 11, 8))]).toEqual({ completed: 2, hold: 0 });
    expect(b.byDay[day(new Date(2026, 10, 15))]).toEqual({ completed: 3, hold: 0 });
    expect(dateOfDay(t, day(new Date(2026, 11, 8)))).toEqual(new Date(2026, 11, 8));
    // Past the deadline there is no quota target, but the real numbers show.
    expect(dayTotals(t, t.employees, day(new Date(2026, 10, 3)))).toMatchObject({ completed: 4, hold: 1, target: 0 });
  });

  it("averages over the whole period, not only up to the deadline", () => {
    const a = buildTracking(cross).employees[0];
    // Working days (Sunday-Thursday) Oct 20 → Dec 10: Oct 8 + Nov 22 + Dec 8
    expect(a.span).toBe(38);
    expect(a.avgCompleted).toBeCloseTo(11 / 38, 5);
    expect(a.avgAll).toBeCloseTo(12 / 38, 5);
  });

  it("ends at the last study once every case is done", () => {
    const done = buildTracking({ ...cross, rows: crossRows.filter((r) => r.state !== "pending") });
    expect(done.periodEnd).toEqual(new Date(2026, 11, 8));
    expect(done.periodDays).toBe(50);
    // Today (Dec 10) is after the period: the as-of day stops at its end.
    expect(done.employees[0].span).toBe(36);
  });

  it("starts at a row's own assignment when no quota stamp exists", () => {
    const t = buildTracking({
      ...cross,
      assignedAtByUser: {},
      rows: [{ assignedTo: "x", state: "pending", doneAt: null, assignedAt: "2026-10-18T09:00:00" }],
    });
    expect(t.periodStart).toEqual(new Date(2026, 9, 18));
  });
});
