import { describe, expect, it, vi } from "vitest";
import type { AuthActivityLogEntry } from "../../auth/authActivityLog";
import type { WorkspaceActionEntry } from "../audit/actionLog";
import {
  aggregateGapsByMonth,
  aggregateSamplesByDay,
  classifyGapTier,
  computeAllDailyPerformance,
  computeEmployeeComparison,
  dayKey,
  filterDailyPerformance,
  finishTimestampsByEmployeeDay,
  firstSignInByEmployeeDay,
  flattenGaps,
  medianGapBaseline,
  medianOf,
  minutesOfDay,
  sanitizeActivityEntries,
  summarizePerformance,
} from "./performanceMetrics";
import { GAP_TIER_THRESHOLDS_MS, type DailyPerformance, type GapEvent } from "./performanceTypes";

function activityEntry(over: Partial<AuthActivityLogEntry> = {}): AuthActivityLogEntry {
  return {
    id: "auth-1",
    username: "sara",
    role: "employee",
    signedInAt: "2026-06-01T06:00:00.000Z",
    lastSeenAt: "2026-06-01T07:00:00.000Z",
    signedOutAt: null,
    durationMs: 60 * 60 * 1000,
    closeReason: null,
    ...over,
  };
}

let seq = 0;
function actionEntry(over: Partial<WorkspaceActionEntry> = {}): WorkspaceActionEntry {
  seq += 1;
  return {
    id: `act-${seq}`,
    at: "2026-06-01T07:00:00.000Z",
    actor: "sara",
    actorRole: "employee",
    action: "answer-submitted",
    target: "IMG-1",
    ...over,
  };
}

describe("dayKey", () => {
  it("extracts YYYY-MM-DD", () => {
    // dayKey buckets by the LOCAL calendar day (see the "local timezone" describe
    // block below) — this assertion picks a near-midnight UTC timestamp specifically
    // to prove that, so it must pin TZ itself rather than rely on the runner's
    // ambient zone (CI runs UTC, but a contributor's machine may not).
    vi.stubEnv("TZ", "UTC");
    try {
      expect(dayKey("2026-06-01T23:59:00.000Z")).toBe("2026-06-01");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("returns empty string for an unparseable timestamp", () => {
    expect(dayKey("not-a-date")).toBe("");
  });
});

describe("dayKey — local timezone, not UTC", () => {
  it("buckets by the LOCAL calendar day, not the UTC one", () => {
    vi.stubEnv("TZ", "Asia/Riyadh"); // UTC+3, no DST
    try {
      // 2026-06-01T23:30:00Z is 2026-06-02T02:30 in Asia/Riyadh — a different calendar day.
      expect(dayKey("2026-06-01T23:30:00.000Z")).toBe("2026-06-02");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("minutesOfDay", () => {
  it("converts a timestamp to minutes since local midnight", () => {
    const at = new Date(2026, 5, 1, 9, 30).toISOString();
    expect(minutesOfDay(at)).toBe(9 * 60 + 30);
  });
});

describe("sanitizeActivityEntries", () => {
  it("keeps a plausible session span", () => {
    const entries = [activityEntry()];
    expect(sanitizeActivityEntries(entries)).toHaveLength(1);
  });

  it("excludes a session whose span exceeds the implausibility ceiling (the stale-signedInAt bug's signature)", () => {
    const entries = [
      activityEntry({
        signedInAt: "2026-06-01T08:00:00.000Z",
        lastSeenAt: "2026-06-02T09:00:00.000Z", // 25h span
      }),
    ];
    expect(sanitizeActivityEntries(entries)).toHaveLength(0);
  });
});

describe("firstSignInByEmployeeDay", () => {
  it("keeps the EARLIEST sign-in per employee per day", () => {
    const entries = [
      activityEntry({ id: "a1", signedInAt: "2026-06-01T09:00:00.000Z", lastSeenAt: "2026-06-01T09:05:00.000Z" }),
      activityEntry({ id: "a2", signedInAt: "2026-06-01T08:00:00.000Z", lastSeenAt: "2026-06-01T08:05:00.000Z" }),
    ];
    const map = firstSignInByEmployeeDay(entries);
    expect(map.get("sara|2026-06-01")).toBe("2026-06-01T08:00:00.000Z");
  });
});

describe("finishTimestampsByEmployeeDay", () => {
  it("attributes an on-behalf submission to the ASSIGNEE, not the submitting supervisor", () => {
    const entries = [
      actionEntry({
        actor: "supervisor1",
        action: "answer-submitted-on-behalf",
        at: "2026-06-01T09:00:00.000Z",
        details: { assignee: "sara", templateId: "tpl-1" },
      }),
    ];
    const map = finishTimestampsByEmployeeDay(entries);
    expect(map.get("sara|2026-06-01")).toEqual(["2026-06-01T09:00:00.000Z"]);
    expect(map.has("supervisor1|2026-06-01")).toBe(false);
  });

  it("sorts timestamps ascending within a day", () => {
    const entries = [
      actionEntry({ at: "2026-06-01T10:00:00.000Z" }),
      actionEntry({ at: "2026-06-01T08:00:00.000Z" }),
    ];
    expect(finishTimestampsByEmployeeDay(entries).get("sara|2026-06-01")).toEqual([
      "2026-06-01T08:00:00.000Z",
      "2026-06-01T10:00:00.000Z",
    ]);
  });

  it("ignores action types other than answer-submitted[-on-behalf]", () => {
    const entries = [actionEntry({ action: "month-closed" })];
    expect(finishTimestampsByEmployeeDay(entries).size).toBe(0);
  });
});

describe("classifyGapTier", () => {
  const baseline = 5 * 60 * 1000; // 5 minutes

  it("reports unclassified when there is no reliable baseline", () => {
    expect(classifyGapTier(10 * 60 * 1000, null)).toBe("unclassified");
  });
  it("normal at and below baseline + 5min", () => {
    expect(classifyGapTier(baseline + GAP_TIER_THRESHOLDS_MS.normalMaxExtraMs, baseline)).toBe("normal");
  });
  it("small just above the normal boundary", () => {
    expect(classifyGapTier(baseline + GAP_TIER_THRESHOLDS_MS.normalMaxExtraMs + 1000, baseline)).toBe("small");
  });
  it("medium just above the small boundary", () => {
    expect(classifyGapTier(baseline + GAP_TIER_THRESHOLDS_MS.smallMaxExtraMs + 1000, baseline)).toBe("medium");
  });
  it("large beyond the medium boundary (the user's 2-hour example)", () => {
    expect(classifyGapTier(baseline + 2 * 60 * 60 * 1000, baseline)).toBe("large");
  });
});

describe("medianGapBaseline", () => {
  it("returns null below the minimum sample count", () => {
    expect(medianGapBaseline([1, 2, 3, 4])).toBeNull();
  });
  it("returns the middle value for an odd count", () => {
    expect(medianGapBaseline([5, 1, 3, 4, 2])).toBe(3);
  });
  it("averages the two middle values for an even count", () => {
    expect(medianGapBaseline([1, 2, 3, 4, 5, 6])).toBe(3.5);
  });
  it("is not dragged by a single extreme outlier", () => {
    const durations = [300_000, 300_000, 300_000, 300_000, 300_000, 7_200_000];
    expect(medianGapBaseline(durations)).toBe(300_000);
  });
});

describe("computeAllDailyPerformance", () => {
  it("builds a day's record: samples finished, effective time, and gaps between finishes, never crossing midnight", () => {
    const activity = [
      activityEntry({ signedInAt: "2026-06-01T06:00:00.000Z", lastSeenAt: "2026-06-01T06:00:00.000Z" }),
    ];
    const actions = [
      actionEntry({ at: "2026-06-01T06:20:00.000Z" }), // gap from sign-in: 20 min
      actionEntry({ at: "2026-06-01T06:25:00.000Z" }), // gap: 5 min
      actionEntry({ at: "2026-06-02T06:10:00.000Z" }), // NEXT day — must not create a gap back into day 1
    ];
    const records = computeAllDailyPerformance(activity, actions);
    const day1 = records.find((r) => r.day === "2026-06-01")!;
    expect(day1.samplesFinished).toBe(2);
    expect(day1.signInAt).toBe("2026-06-01T06:00:00.000Z");
    expect(day1.lastFinishAt).toBe("2026-06-01T06:25:00.000Z");
    expect(day1.effectiveTimeMs).toBe(25 * 60 * 1000);
    expect(day1.gaps).toHaveLength(2);
    expect(day1.gaps[0]!.durationMs).toBe(20 * 60 * 1000);
    expect(day1.gaps[1]!.durationMs).toBe(5 * 60 * 1000);

    const day2 = records.find((r) => r.day === "2026-06-02")!;
    expect(day2.samplesFinished).toBe(1);
    // No sign-in recorded for day 2, so no gap is fabricated from an unknown start.
    expect(day2.gaps).toHaveLength(0);
  });

  it("reports effectiveTimeMs as null (not 0) when there is a sign-in but zero finishes that day", () => {
    const activity = [
      activityEntry({ signedInAt: "2026-06-01T06:00:00.000Z", lastSeenAt: "2026-06-01T06:00:00.000Z" }),
    ];
    const records = computeAllDailyPerformance(activity, []);
    const day1 = records.find((r) => r.day === "2026-06-01")!;
    expect(day1.samplesFinished).toBe(0);
    expect(day1.effectiveTimeMs).toBeNull();
  });

  it("excludes an implausible activity span from sign-in selection (the stale-signedInAt bug's guard)", () => {
    const activity = [
      activityEntry({ signedInAt: "2026-05-31T08:00:00.000Z", lastSeenAt: "2026-06-01T09:00:00.000Z" }), // 25h — implausible
    ];
    const actions = [actionEntry({ at: "2026-06-01T09:05:00.000Z" })];
    const records = computeAllDailyPerformance(activity, actions);
    const day1 = records.find((r) => r.day === "2026-06-01")!;
    expect(day1.signInAt).toBeNull();
    expect(day1.effectiveTimeMs).toBeNull();
  });
});

describe("filterDailyPerformance / flattenGaps / aggregateSamplesByDay / summarizePerformance", () => {
  const activity = [
    activityEntry({ id: "a1", username: "sara", signedInAt: "2026-06-01T06:00:00.000Z", lastSeenAt: "2026-06-01T06:00:00.000Z" }),
    activityEntry({ id: "a2", username: "omar", signedInAt: "2026-06-01T06:00:00.000Z", lastSeenAt: "2026-06-01T06:00:00.000Z" }),
  ];
  const actions = [
    actionEntry({ actor: "sara", at: "2026-06-01T06:10:00.000Z" }),
    actionEntry({ actor: "omar", at: "2026-06-01T06:30:00.000Z" }),
  ];
  const all = computeAllDailyPerformance(activity, actions);

  it("filters by employee", () => {
    const saraOnly = filterDailyPerformance(all, { employee: "sara", from: "", to: "" });
    expect(saraOnly.every((r) => r.employee === "sara")).toBe(true);
    expect(saraOnly.length).toBeGreaterThan(0);
  });

  it("filters by inclusive date range", () => {
    const inRange = filterDailyPerformance(all, { employee: "", from: "2026-06-01", to: "2026-06-01" });
    expect(inRange.length).toBe(all.length);
    const outOfRange = filterDailyPerformance(all, { employee: "", from: "2026-07-01", to: "" });
    expect(outOfRange).toHaveLength(0);
  });

  it("aggregateSamplesByDay sums across employees for the same day", () => {
    const points = aggregateSamplesByDay(all);
    expect(points).toEqual([{ day: "2026-06-01", count: 2 }]);
  });

  it("summarizePerformance totals samples and effective time across the filtered set", () => {
    const summary = summarizePerformance(all);
    expect(summary.totalSamples).toBe(2);
    expect(summary.totalEffectiveMs).toBe(10 * 60 * 1000 + 30 * 60 * 1000);
  });

  it("flattenGaps includes the signIn-to-first-finish gap even when there is only one finish that day", () => {
    const gaps = flattenGaps(all);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toEqual({
      employee: "omar",
      day: "2026-06-01",
      startAt: "2026-06-01T06:00:00.000Z",
      endAt: "2026-06-01T06:30:00.000Z",
      durationMs: 30 * 60 * 1000,
      tier: "unclassified",
    });
    expect(gaps[1]).toEqual({
      employee: "sara",
      day: "2026-06-01",
      startAt: "2026-06-01T06:00:00.000Z",
      endAt: "2026-06-01T06:10:00.000Z",
      durationMs: 10 * 60 * 1000,
      tier: "unclassified",
    });
  });
});

describe("aggregateGapsByMonth", () => {
  it("groups gaps by YYYY-MM and sums duration per tier, excluding normal/unclassified", () => {
    const gaps: GapEvent[] = [
      gapEvent({ day: "2026-06-01", tier: "small", durationMs: 10 * 60_000 }),
      gapEvent({ day: "2026-06-15", tier: "small", durationMs: 5 * 60_000 }),
      gapEvent({ day: "2026-06-20", tier: "medium", durationMs: 40 * 60_000 }),
      gapEvent({ day: "2026-06-25", tier: "large", durationMs: 90 * 60_000 }),
      gapEvent({ day: "2026-06-28", tier: "normal", durationMs: 60_000 }),
      gapEvent({ day: "2026-06-29", tier: "unclassified", durationMs: 60_000 }),
      gapEvent({ day: "2026-07-01", tier: "small", durationMs: 3 * 60_000 }),
    ];
    const months = aggregateGapsByMonth(gaps);
    expect(months).toEqual([
      {
        month: "2026-06",
        durationMsByTier: { small: 15 * 60_000, medium: 40 * 60_000, large: 90 * 60_000 },
        totalDurationMs: 145 * 60_000,
      },
      {
        month: "2026-07",
        durationMsByTier: { small: 3 * 60_000, medium: 0, large: 0 },
        totalDurationMs: 3 * 60_000,
      },
    ]);
  });

  it("returns an empty array for no gaps", () => {
    expect(aggregateGapsByMonth([])).toEqual([]);
  });

  it("sorts months ascending regardless of input order", () => {
    const gaps: GapEvent[] = [
      gapEvent({ day: "2026-08-01", tier: "small", durationMs: 60_000 }),
      gapEvent({ day: "2026-06-01", tier: "small", durationMs: 60_000 }),
      gapEvent({ day: "2026-07-01", tier: "small", durationMs: 60_000 }),
    ];
    expect(aggregateGapsByMonth(gaps).map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
});

describe("medianOf", () => {
  it("returns null for an empty list", () => {
    expect(medianOf([])).toBeNull();
  });
  it("returns the middle value for an odd count", () => {
    expect(medianOf([5, 1, 3])).toBe(3);
  });
  it("averages the two middle values for an even count", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
});

function dailyRecord(over: Partial<DailyPerformance> = {}): DailyPerformance {
  return {
    employee: "a",
    day: "2026-06-01",
    samplesFinished: 1,
    signInAt: "2026-06-01T06:00:00.000Z",
    lastFinishAt: "2026-06-01T06:10:00.000Z",
    effectiveTimeMs: 10 * 60 * 1000,
    gaps: [],
    ...over,
  };
}

function gapEvent(over: Partial<GapEvent> = {}): GapEvent {
  return {
    employee: "a",
    day: "2026-06-01",
    startAt: "2026-06-01T06:00:00.000Z",
    endAt: "2026-06-01T06:10:00.000Z",
    durationMs: 10 * 60 * 1000,
    tier: "small",
    ...over,
  };
}

describe("computeEmployeeComparison", () => {
  it("includes a zero-activity roster member, ranked after everyone with samples", () => {
    const records = [dailyRecord({ employee: "a", samplesFinished: 10 })];
    const { rows } = computeEmployeeComparison(records, new Map([["a", "أ"], ["z", "ز"]]));
    expect(rows.map((r) => r.username)).toEqual(["a", "z"]);
    expect(rows[1]!.samples).toBe(0);
    expect(rows[1]!.effectiveMs).toBeNull();
    expect(rows[1]!.paceMs).toBeNull();
    expect(rows[1]!.lastActiveDay).toBeNull();
    expect(rows[1]!.rank).toBe(2);
  });

  it("derives above/within/below status from the samples-vs-team-average ratio", () => {
    const records = [
      dailyRecord({ employee: "a", samplesFinished: 15 }),
      dailyRecord({ employee: "b", samplesFinished: 10 }),
      dailyRecord({ employee: "c", samplesFinished: 5 }),
    ];
    const names = new Map([["a", "أ"], ["b", "ب"], ["c", "ج"]]);
    const { rows, teamAvgSamples } = computeEmployeeComparison(records, names);
    expect(teamAvgSamples).toBe(10);
    const byUsername = new Map(rows.map((row) => [row.username, row]));
    expect(byUsername.get("a")!.statusKind).toBe("above"); // 15/10 = 1.5 >= 1.15
    expect(byUsername.get("b")!.statusKind).toBe("within"); // 10/10 = 1.0
    expect(byUsername.get("c")!.statusKind).toBe("below"); // 5/10 = 0.5 <= 0.85
  });

  it("escalates to hasFrequentLargeGaps at 3+ large gaps, regardless of the samples ratio", () => {
    const records = [
      dailyRecord({ employee: "a", day: "2026-06-01", samplesFinished: 20, gaps: [gapEvent({ day: "2026-06-01", tier: "large" })] }),
      dailyRecord({ employee: "a", day: "2026-06-02", samplesFinished: 20, gaps: [gapEvent({ day: "2026-06-02", tier: "large" })] }),
      dailyRecord({ employee: "a", day: "2026-06-03", samplesFinished: 20, gaps: [gapEvent({ day: "2026-06-03", tier: "large" })] }),
    ];
    const { rows } = computeEmployeeComparison(records, new Map([["a", "أ"]]));
    expect(rows[0]!.hasFrequentLargeGaps).toBe(true);
    expect(rows[0]!.gapCounts.large).toBe(3);
    expect(rows[0]!.gapPercents.large).toBe(100);
  });

  it("computes an employee's own pace as the median of their gap durations in scope (distinct from the per-month tiering baseline)", () => {
    const gaps: GapEvent[] = [1, 2, 3, 4, 5].map((n) => gapEvent({ durationMs: n * 60_000, tier: "unclassified" }));
    const records = [dailyRecord({ samplesFinished: 5, gaps })];
    const { rows } = computeEmployeeComparison(records, new Map([["a", "أ"]]));
    expect(rows[0]!.paceMs).toBe(3 * 60_000);
  });

  it("uses the latest day with any record as lastActiveDay", () => {
    const records = [
      dailyRecord({ day: "2026-06-01" }),
      dailyRecord({ day: "2026-06-03" }),
      dailyRecord({ day: "2026-06-02" }),
    ];
    const { rows } = computeEmployeeComparison(records, new Map([["a", "أ"]]));
    expect(rows[0]!.lastActiveDay).toBe("2026-06-03");
  });

  it("returns a null team pace when no employee has a reliable pace baseline", () => {
    const records = [dailyRecord({ gaps: [gapEvent()] })];
    const { teamMedianPaceMs } = computeEmployeeComparison(records, new Map([["a", "أ"]]));
    expect(teamMedianPaceMs).toBeNull();
  });
});
