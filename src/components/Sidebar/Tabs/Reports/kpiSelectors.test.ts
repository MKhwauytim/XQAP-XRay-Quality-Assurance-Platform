import { describe, expect, it } from "vitest";

import {
  buildAnswerGroups,
  buildInaccuracyCalendar,
  buildReviewerStatuses,
  buildSampleProgress,
  fmtCount,
  fmtPct,
} from "./kpiSelectors";
import { makeReportModel } from "./kpiTestModel";

describe("fmtPct / fmtCount", () => {
  it("renders «—» for a null rate instead of 0%", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(undefined)).toBe("—");
    expect(fmtPct(Number.NaN)).toBe("—");
    expect(fmtPct(0)).toBe("0.0%");
    expect(fmtPct(140)).toBe("100.0%");
  });

  it("formats counts with Latin digits", () => {
    expect(fmtCount(1234)).toBe("1,234");
    expect(fmtCount(null)).toBe("—");
  });
});

describe("buildSampleProgress", () => {
  it("derives per-level completion and the ≥80% tone rule", () => {
    const progress = buildSampleProgress(
      makeReportModel({
        sampleTotal: 200,
        sampleStudied: 159,
        byStage: [
          { stageKey: "L1", stageLabel: "المستوى الأول", sampleSize: 100, studied: 80 },
          { stageKey: "L2", stageLabel: "المستوى الثاني", sampleSize: 100, studied: 79 },
        ],
      })
    );

    expect(progress.overall).toMatchObject({ studied: 159, total: 200, remaining: 41 });
    expect(progress.overall.completionRate).toBeCloseTo(79.5);
    expect(progress.overall.tone).toBe("amber");
    expect(progress.levels[0]).toMatchObject({ completionRate: 80, remaining: 20, tone: "sky" });
    expect(progress.levels[1]).toMatchObject({ completionRate: 79, remaining: 21, tone: "amber" });
  });

  it("reports a null completion rate (not 0) for a level with no sample drawn", () => {
    const progress = buildSampleProgress(
      makeReportModel({
        byStage: [{ stageKey: "L4", stageLabel: "المستوى الرابع", sampleSize: 0, studied: 0 }],
      })
    );
    expect(progress.levels[0]!.completionRate).toBeNull();
  });
});

describe("buildAnswerGroups", () => {
  it("counts اشتباه / سليمة / غير مكتملة per reviewer and per port", () => {
    const groups = buildAnswerGroups(
      makeReportModel({
        rows: [
          { assignedTo: "u1", portName: "أ", expertResult: "اشتباه", answerStatus: "submitted" },
          { assignedTo: "u1", portName: "أ", expertResult: "سليمة", answerStatus: "submitted" },
          { assignedTo: "u1", portName: "ب", expertResult: null, answerStatus: "draft" },
          { assignedTo: "u2", portName: "ب", expertResult: "سليمة", answerStatus: "submitted" },
          // Never distributed — must not appear in either view.
          { assignedTo: null, portName: "ج", expertResult: "اشتباه", answerStatus: "submitted" },
        ],
      }),
      (username) => `اسم:${username}`,
      "غير محدد"
    );

    expect(groups.reviewer).toEqual([
      { key: "u1", label: "اسم:u1", suspicion: 1, clean: 1, incomplete: 1, total: 3 },
      { key: "u2", label: "اسم:u2", suspicion: 0, clean: 1, incomplete: 0, total: 1 },
    ]);
    expect(groups.port.map((g) => g.key)).toEqual(["أ", "ب"]);
    expect(groups.port[1]).toMatchObject({ suspicion: 0, clean: 1, incomplete: 1 });
  });

  it("falls back to the supplied unknown label for a row with no port", () => {
    const groups = buildAnswerGroups(
      makeReportModel({
        rows: [{ assignedTo: "u1", portName: null, expertResult: "سليمة", answerStatus: "submitted" }],
      }),
      (u) => u,
      "غير محدد"
    );
    expect(groups.port[0]!.key).toBe("غير محدد");
  });
});

describe("buildInaccuracyCalendar", () => {
  it("returns null when no inaccurate decision carries a timestamp", () => {
    expect(
      buildInaccuracyCalendar(
        makeReportModel({
          factTable: [
            { completedAt: null, outcomeClass: "missed-suspicion" },
            { completedAt: "2026-04-11T09:00:00.000Z", outcomeClass: "correct-clean" },
          ],
        })
      )
    ).toBeNull();
  });

  it("buckets missed/false suspicions by the day the review was submitted", () => {
    // Local-time construction: the selector reads local calendar days, so the
    // fixture must too or the test would drift with the runner's timezone.
    const day = (d: number, hour = 12) => new Date(2026, 3, d, hour).toISOString();
    const calendar = buildInaccuracyCalendar(
      makeReportModel({
        factTable: [
          { completedAt: day(1), outcomeClass: "missed-suspicion" },
          { completedAt: day(1), outcomeClass: "false-suspicion" },
          { completedAt: day(3), outcomeClass: "missed-suspicion" },
          { completedAt: day(3), outcomeClass: "correct-suspicion" },
        ],
      })
    );

    expect(calendar).not.toBeNull();
    expect(calendar!.year).toBe(2026);
    expect(calendar!.month).toBe(4);
    expect(calendar!.total).toBe(3);
    expect(calendar!.max).toBe(2);
    expect(calendar!.cells).toHaveLength(calendar!.weeks * 7);
    const byDay = new Map(calendar!.cells.filter((c) => c.day > 0).map((c) => [c.day, c.count]));
    expect(byDay.get(1)).toBe(2);
    expect(byDay.get(2)).toBe(0);
    expect(byDay.get(3)).toBe(1);
    // April 2026 has 30 days and every one of them is on the grid.
    expect([...byDay.keys()]).toHaveLength(30);
    // Fridays are the 7th column of the RTL grid.
    for (const [index, cell] of calendar!.cells.entries()) {
      expect(cell.isHoliday).toBe(cell.day > 0 && index % 7 === 6);
    }
  });
});

describe("buildReviewerStatuses", () => {
  it("mirrors the existing p-chart control math without recomputing it", () => {
    const statuses = buildReviewerStatuses(
      makeReportModel({
        pChartGroups: [
          { key: "a", lowN: false, outOfControl: false },
          { key: "b", lowN: false, outOfControl: true },
          { key: "c", lowN: true, outOfControl: false },
        ],
      })
    );
    expect(statuses.get("a")).toBe("in-control");
    expect(statuses.get("b")).toBe("out-of-control");
    expect(statuses.get("c")).toBe("low-n");
    expect(statuses.get("missing")).toBeUndefined();
  });
});
