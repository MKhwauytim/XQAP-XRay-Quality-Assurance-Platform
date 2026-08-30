import { describe, expect, it, vi } from "vitest";
import type { AuthActivityLogEntry } from "../../auth/authActivityLog";
import type { WorkspaceActionEntry } from "../audit/actionLog";
import {
  aggregateSamplesByDay,
  classifyGapTier,
  computeAllDailyPerformance,
  dayKey,
  filterDailyPerformance,
  finishTimestampsByEmployeeDay,
  firstSignInByEmployeeDay,
  flattenGaps,
  medianGapBaseline,
  minutesOfDay,
  sanitizeActivityEntries,
  summarizePerformance,
} from "./performanceMetrics";
import { GAP_TIER_THRESHOLDS_MS } from "./performanceTypes";

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
