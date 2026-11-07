import { describe, expect, it } from "vitest";
import { buildDailyWorkReport, previousWorkingDay } from "./dailyWorkReport";
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
