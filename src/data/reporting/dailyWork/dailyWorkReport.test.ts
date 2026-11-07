import { describe, expect, it } from "vitest";
import { buildDailyWorkReport, monthOf, previousDay, previousMonth, previousWeek, previousWorkingDay } from "./dailyWorkReport";
import { buildDailyWorkEml, buildDailyWorkEmailHtml } from "./dailyWorkEmail";
import type { TrackingRow } from "../../tracking/deadlineTracking";

const thu = new Date(2026, 10, 5); // Thursday 2026-11-05
const onThu = new Date(2026, 10, 5, 10).toISOString();
const onWed = new Date(2026, 10, 4, 10).toISOString();

describe("previousWorkingDay", () => {
  it("Sunday reports Thursday", () => {
    expect(previousWorkingDay(new Date(2026, 10, 8))).toEqual(thu);
  });
  it("Tuesday reports Monday", () => {
    expect(previousWorkingDay(new Date(2026, 10, 10))).toEqual(new Date(2026, 10, 9));
  });
});

describe("buildDailyWorkReport", () => {
  const rows: TrackingRow[] = [
    { assignedTo: "a", state: "completed", doneAt: onThu },
    { assignedTo: "a", state: "completed", doneAt: onWed },
    { assignedTo: "a", state: "hold", doneAt: onThu },
    { assignedTo: "a", state: "pending", doneAt: null },
    { assignedTo: "b", state: "pending", doneAt: null },
  ];
  const report = buildDailyWorkReport({
    months: [{ folderName: "1-january-2026", label: "يناير 2026", rows }, { folderName: "2-february-2026", label: "فبراير 2026", rows: [] }],
    day: thu,
    names: { a: "جميلة" },
  });

  it("counts per employee per day and skips empty months", () => {
    expect(report.months).toHaveLength(1);
    const a = report.months[0].employees.find((e) => e.username === "a")!;
    expect(a).toMatchObject({ name: "جميلة", assigned: 4, completedOnDay: 1, holdOnDay: 1, completedTotal: 2, holdTotal: 1, remaining: 1 });
    expect(report.totals).toMatchObject({ assigned: 5, completedOnDay: 1, holdOnDay: 1, remaining: 2 });
  });

  it("renders greeting, month table and escaped names", () => {
    const html = buildDailyWorkEmailHtml(report);
    expect(html).toContain("مع التحية والتقدير");
    expect(html).toContain("مجتمع يناير 2026");
    expect(html).toContain("جميلة");
    const eml = buildDailyWorkEml(report);
    expect(eml.startsWith("X-Unsent: 1\r\n")).toBe(true);
    expect(eml).toContain("Subject: =?UTF-8?B?");
  });
});

describe("weekly, monthly and custom periods", () => {
  const sun = new Date(2026, 10, 1); // Sunday 2026-11-01
  const sat = new Date(2026, 10, 7); // Saturday 2026-11-07
  const onFri = new Date(2026, 10, 6, 10).toISOString();

  it("previousDay is yesterday, weekend days included", () => {
    expect(previousDay(new Date(2026, 10, 8))).toEqual(sat);
  });

  it("previousWeek is the last full Sunday-Saturday week", () => {
    // Sunday 2026-11-08: the week that just ended.
    expect(previousWeek(new Date(2026, 10, 8))).toEqual({ from: sun, until: sat });
    // Wednesday 2026-11-11: still the previous week, never a week that is not over.
    expect(previousWeek(new Date(2026, 10, 11))).toEqual({ from: sun, until: sat });
  });

  it("previousMonth and monthOf cover whole calendar months", () => {
    expect(previousMonth(new Date(2026, 10, 15))).toEqual({ from: new Date(2026, 9, 1), until: new Date(2026, 9, 31) });
    expect(monthOf(new Date(2026, 1, 10))).toEqual({ from: new Date(2026, 1, 1), until: new Date(2026, 1, 28) });
  });

  const rows: TrackingRow[] = [
    { assignedTo: "a", state: "completed", doneAt: onThu },
    { assignedTo: "a", state: "completed", doneAt: onWed },
    { assignedTo: "a", state: "completed", doneAt: onFri }, // weekend work
    { assignedTo: "a", state: "completed", doneAt: new Date(2026, 9, 29, 10).toISOString() }, // the week before
    { assignedTo: "a", state: "hold", doneAt: new Date(2026, 10, 1, 9).toISOString() },
  ];
  const months = [{ folderName: "1-january-2026", label: "يناير 2026", rows }];
  const week = buildDailyWorkReport({ months, day: sun, until: sat, kind: "week", names: {} });

  it("a week counts Sunday to Saturday, the weekend included", () => {
    expect(week.kind).toBe("week");
    expect(week.totals).toMatchObject({ completedOnDay: 3, holdOnDay: 1, completedTotal: 4, holdTotal: 1 });
  });

  it("writes the wording of each kind of period", () => {
    const weekly = buildDailyWorkEmailHtml(week);
    expect(weekly).toContain("تقرير العمل الأسبوعي");
    expect(weekly).toContain("المفحوصة خلال الأسبوع");
    expect(weekly).toContain("2026/11/07");
    expect(weekly).not.toContain("خلال اليوم");
    const oct = monthOf(new Date(2026, 9, 1));
    const monthly = buildDailyWorkEmailHtml(buildDailyWorkReport({ months, day: oct.from, until: oct.until, kind: "month", names: {} }));
    expect(monthly).toContain("تقرير العمل الشهري");
    expect(monthly).toContain("المفحوصة خلال الشهر");
    const range = buildDailyWorkEmailHtml(buildDailyWorkReport({ months, day: new Date(2026, 10, 4), until: new Date(2026, 10, 6), names: {} }));
    expect(range).toContain("المفحوصة خلال الفترة");
    expect(range).toContain("2026/11/04");
  });
});
