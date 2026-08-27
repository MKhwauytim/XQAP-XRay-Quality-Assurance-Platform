# Employee Performance Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "تقييم الأداء" (performance evaluation) subtab under إدارة المستخدمين showing per-employee pace, idle-gap detection, samples-finished trend, and daily working hours — built on the existing audit action log and session activity log — and fix a confirmed bug where a restored browser session inflates recorded work duration to 24+ hours.

**Architecture:** A new pure calculation module (`src/data/performance/`) turns the existing `WorkspaceActionEntry`/`AuthActivityLogEntry` streams into per-employee-per-day records, monthly pace baselines, and classified idle gaps — no new on-disk schema. A new UI subtab (`PerformanceSection.tsx`) renders that data with hand-rolled SVG charts matching the app's existing `kpiCharts.ts` conventions, wired into `UserManagement`'s existing subtab machinery exactly like its `activity`/`actions` siblings. Separately, `authActivityLog.ts`'s `startAuthActivitySession` gets an explicit start-timestamp parameter so a session restored from localStorage stamps its new entry from the actual reconnect moment, not the stale original login time.

**Tech Stack:** React 19 + TypeScript (strict), Vitest, hand-rolled inline SVG (no chart library), existing `safeWrite`/`casLoop` storage layer (unchanged — this feature only reads).

**Spec:** `docs/superpowers/specs/2026-08-27-employee-performance-evaluation-design.md`

## Global Constraints

- Node **>=22 <23**. Run `npm run lint`, `npm run typecheck`, and the affected test files after every task; run the full Tier-3 gate list (`lint`, `typecheck`, `test:run`, `check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`) plus `npm run build` before this work is considered done (Task 8).
- UI text is Arabic, RTL-first. Every user-facing string is a `labelsStore.ts` key — never a hardcoded Arabic literal in a component (the two `// B9` exceptions already in `AuditSections.tsx` are pre-existing debt, not a pattern to repeat).
- No raw `#hex` colors in new chart code — every color is a `var(--c-…)` token (`check:hex-literals` enforces this).
- `import type` for type-only imports. Strict TypeScript — no `any`.
- This feature only *reads* `readWorkspaceActions()` / `readAuthActivityLog()`; it introduces no new workspace file, no new `safeWriteJson` call, no new event type.
- Write the edit-log entry with `npm run editlog -- --tier=3 ...` only after Task 8's gates are green (see CLAUDE.md: "write the entry after the edit is applied").

---

### Task 1: Fix the stale-`signedInAt`-on-restore bug

**Files:**
- Modify: `src/auth/authActivityLog.ts:353-371` (`startAuthActivitySession`)
- Modify: `src/auth/authSession.ts:106-140` (`readRealSession`'s restore branch)
- Test: `src/auth/authActivityLog.test.ts` (add one test near the top `describe("authActivityLog", ...)` block)
- Test: `src/auth/authSession.test.ts` (add one new `describe` block)

**Interfaces:**
- Consumes: existing `AuthActivityLogEntry`, `AuthSession` types (unchanged).
- Produces: `startAuthActivitySession(session: AuthSession, startedAt?: string): void` — the same exported name, now with an **optional second parameter** that defaults to `session.loginAt` (so every existing call site with one argument is unaffected). Later tasks do not depend on this signature.

- [ ] **Step 1: Write the failing unit test in `authActivityLog.test.ts`**

Add inside the existing `describe("authActivityLog", ...)` block (after the `"records sign-in, heartbeat, sign-out, and duration"` test), reusing the file's existing `makeSession` helper:

```ts
  it("accepts an explicit start timestamp distinct from the session's loginAt (session-restore fix)", async () => {
    startAuthActivitySession(
      makeSession("user1", "2026-06-01T08:00:00.000Z"),
      "2026-06-02T09:00:00.000Z"
    );

    const [entry] = await readAuthActivityLog();
    expect(entry?.signedInAt).toBe("2026-06-02T09:00:00.000Z");
    expect(entry?.durationMs).toBe(0);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/auth/authActivityLog.test.ts -t "explicit start timestamp"`
Expected: FAIL — `startAuthActivitySession` currently accepts only one argument and `entry.signedInAt` comes out as `"2026-06-01T08:00:00.000Z"`, not the second argument.

- [ ] **Step 3: Fix `startAuthActivitySession`**

In `src/auth/authActivityLog.ts`, replace the function (currently lines 353-371):

```ts
/**
 * Starts a new activity entry. `startedAt` defaults to `session.loginAt` —
 * correct for a FRESH login, where `loginAt` IS the current moment.
 *
 * It must be passed explicitly on a RESTORED session (`readRealSession`'s
 * restore branch in authSession.ts): `session.loginAt` there is the
 * ORIGINAL login time, which SEC-02 persists in localStorage for up to 7
 * days so an employee doesn't have to re-login after closing the browser.
 * Before this fix, a restore always used that stale `loginAt`, so a session
 * resumed a day later got a new entry spanning "yesterday's login" to
 * "today's heartbeat" — 24+ hours of apparent work for zero actual gap.
 */
export function startAuthActivitySession(session: AuthSession, startedAt: string = session.loginAt): void {
  endAuthActivitySession("session-replaced");

  const timestamp = nowIso();
  const entry: AuthActivityLogEntry = {
    id: createActivityId(session),
    username: session.username,
    role: session.role,
    signedInAt: startedAt,
    lastSeenAt: timestamp,
    signedOutAt: null,
    durationMs: Math.max(0, Date.parse(timestamp) - Date.parse(startedAt)),
    closeReason: null,
  };

  activeActivityId = entry.id;
  memoryEntries = mergeEntries(memoryEntries, [entry]);
  queueFlush();
}
```

- [ ] **Step 4: Run the unit test again to verify it passes**

Run: `npx vitest run src/auth/authActivityLog.test.ts`
Expected: PASS — the new test passes, and every pre-existing test in the file still passes (they all call `startAuthActivitySession` with one argument, which still defaults to `session.loginAt`).

- [ ] **Step 5: Write the failing integration regression test in `authSession.test.ts`**

Add these imports to the top of `src/auth/authSession.test.ts` (extending the existing import statements):

```ts
import {
  readSession,
  readRealSession,
  writeSession,
  clearSession,
  setPreviewRole,
  readPreviewRole,
  __dropRuntimeSessionForTests,
} from "./authSession";
import {
  endAuthActivitySession,
  readAuthActivityLog,
  resetAuthActivityLogForTests,
} from "./authActivityLog";
```

Add this new `describe` block as a sibling of the existing `describe("demo sessions (LOG-01)", ...)` block, inside the outer `describe("authSession", ...)`:

```ts
  describe("session restore stamps activity from the reconnect moment (not the stale loginAt)", () => {
    const backing = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    };

    beforeEach(() => {
      backing.clear();
      vi.stubGlobal("localStorage", fakeStorage);
      resetAuthActivityLogForTests();
    });

    afterEach(() => {
      endAuthActivitySession("logout");
      resetAuthActivityLogForTests();
      vi.unstubAllGlobals();
    });

    it("a session restored a day later gets a fresh signedInAt, not the original login time", async () => {
      const loginAt = new Date("2026-06-01T08:00:00.000Z");
      vi.setSystemTime(loginAt);
      const session: AuthSession = {
        username: "reconnect_user",
        role: "employee",
        loginAt: loginAt.toISOString(),
      };
      writeSession(session);

      // Simulate closing the browser (module state gone, localStorage kept)
      // and reopening the next day.
      const reconnectAt = new Date("2026-06-02T09:00:00.000Z");
      vi.setSystemTime(reconnectAt);
      __dropRuntimeSessionForTests();
      readRealSession();

      const entries = await readAuthActivityLog();
      const restored = entries.find((e) => e.signedOutAt === null);
      expect(restored).toBeDefined();
      expect(restored?.signedInAt).toBe(reconnectAt.toISOString());
      // Before the fix this was ~25 hours (reconnectAt minus the ORIGINAL loginAt).
      expect(restored?.durationMs).toBeLessThan(60 * 1000);
    });
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/auth/authSession.test.ts -t "session restore stamps activity"`
Expected: FAIL — `restored?.signedInAt` comes out as the original `loginAt` (2026-06-01), and `durationMs` is close to 25 hours, not under a minute.

- [ ] **Step 7: Fix the restore branch in `authSession.ts`**

In `src/auth/authSession.ts`, inside `readRealSession()`, change:

```ts
    if (runtimeSession && !isExpired(runtimeSession)) {
      startAuthActivitySession(runtimeSession);
```

to:

```ts
    if (runtimeSession && !isExpired(runtimeSession)) {
      // A restored session is a RECONNECT, not a continuation of the
      // original login — stamp the new activity entry from this moment,
      // not from the persisted (possibly days-stale) `loginAt`. See
      // `startAuthActivitySession` in authActivityLog.ts for why this must
      // be passed explicitly.
      startAuthActivitySession(runtimeSession, new Date().toISOString());
```

(Leave the `writeSession()` call site, a few lines below, untouched — a fresh login has no second argument, and the default `session.loginAt` is already correct there.)

- [ ] **Step 8: Run both test files to verify everything passes**

Run: `npx vitest run src/auth/authSession.test.ts src/auth/authActivityLog.test.ts`
Expected: PASS — all tests in both files, including the two new ones.

- [ ] **Step 9: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/auth/authActivityLog.ts src/auth/authSession.ts src/auth/authActivityLog.test.ts src/auth/authSession.test.ts
git commit -m "Fix (auth): stamp restored-session activity from the reconnect moment, not the stale loginAt"
```

---

### Task 2: Performance module types and constants

**Files:**
- Create: `src/data/performance/performanceTypes.ts`

**Interfaces:**
- Consumes: nothing (pure type/constant definitions).
- Produces: `GapTier`, `GapEvent`, `DailyPerformance`, `EmployeeMonthlyBaseline`, `PerformanceScopeFilter`, `PerformanceSummary` types; `GAP_TIER_THRESHOLDS_MS`, `MIN_GAP_SAMPLES_FOR_BASELINE`, `IMPLAUSIBLE_SESSION_SPAN_MS` constants — all consumed by Task 3 (`performanceMetrics.ts`) and Task 6 (`PerformanceSection.tsx`).

This is a types-only file (no runtime logic to unit-test on its own) — Task 3's tests exercise it end-to-end. No test file for this task.

- [ ] **Step 1: Create the file**

```ts
/**
 * Shared types for the employee performance-evaluation feature (تقييم الأداء).
 *
 * Timing/pace only — deliberately excludes the accuracy/quality model in
 * `src/data/reporting/executive/executiveEmployeeData.ts`, which stays
 * scoped to the offline executive report. See
 * docs/superpowers/specs/2026-08-27-employee-performance-evaluation-design.md.
 */

export type GapTier = "normal" | "small" | "medium" | "large" | "unclassified";

/** One idle interval: sign-in → first finish, or finish → next finish, for one employee on one day. */
export type GapEvent = {
  employee: string;
  day: string; // YYYY-MM-DD
  startAt: string; // ISO
  endAt: string; // ISO
  durationMs: number;
  tier: GapTier;
};

/** One employee's summary for one calendar day. */
export type DailyPerformance = {
  employee: string;
  day: string; // YYYY-MM-DD
  samplesFinished: number;
  signInAt: string | null;
  lastFinishAt: string | null;
  /** (lastFinishAt - signInAt), or null when either endpoint is missing. Never 0 for a no-data day. */
  effectiveTimeMs: number | null;
  gaps: GapEvent[];
};

export type EmployeeMonthlyBaseline = {
  employee: string;
  month: string; // YYYY-MM
  /** Median within-day gap duration across the month, or null when fewer than MIN_GAP_SAMPLES_FOR_BASELINE gaps exist. */
  medianGapMs: number | null;
  sampleCount: number;
};

export type PerformanceScopeFilter = {
  /** A username, or "" for every employee. */
  employee: string;
  /** Inclusive YYYY-MM-DD bounds; "" disables that end. */
  from: string;
  to: string;
};

export type PerformanceSummary = {
  totalSamples: number;
  totalEffectiveMs: number | null;
  gapCountsByTier: Record<GapTier, number>;
  medianGapMs: number | null;
};

/** Gap tiers, relative to the employee's own monthly median gap ("avg" in the design doc). */
export const GAP_TIER_THRESHOLDS_MS = {
  smallExtraMs: 5 * 60 * 1000,
  mediumExtraMs: 20 * 60 * 1000,
  largeExtraMs: 60 * 60 * 1000,
} as const;

/** Below this many within-day gaps in a calendar month, the median baseline is unreliable — report null, not a noisy value. */
export const MIN_GAP_SAMPLES_FOR_BASELINE = 5;

/**
 * A recorded session span longer than this is implausible for a single
 * shift and is excluded from sign-in-anchor selection and aggregation — the
 * read-time guard against the pre-Task-1-fix stale-signedInAt bug's
 * historical data. Never rewrites the source entries.
 */
export const IMPLAUSIBLE_SESSION_SPAN_MS = 16 * 60 * 60 * 1000;
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (nothing imports this file yet, so this only proves the file itself is syntactically/typewise valid).

- [ ] **Step 3: Commit**

```bash
git add src/data/performance/performanceTypes.ts
git commit -m "Add (performance): types and constants for the employee performance-evaluation feature"
```

---

### Task 3: Performance module pure calculations

**Files:**
- Create: `src/data/performance/performanceMetrics.ts`
- Test: `src/data/performance/performanceMetrics.test.ts`

**Interfaces:**
- Consumes: `AuthActivityLogEntry` from `src/auth/authActivityLog.ts` (existing, unchanged shape); `WorkspaceActionEntry` from `src/data/audit/actionLog.ts` (existing, unchanged); everything from Task 2's `performanceTypes.ts`.
- Produces (all consumed by Task 6's `PerformanceSection.tsx`, and directly unit-tested here):
  - `dayKey(at: string): string`
  - `minutesOfDay(at: string): number`
  - `sanitizeActivityEntries(entries): AuthActivityLogEntry[]`
  - `firstSignInByEmployeeDay(entries): Map<string, string>`
  - `finishTimestampsByEmployeeDay(entries): Map<string, string[]>`
  - `classifyGapTier(durationMs: number, baselineMs: number | null): GapTier`
  - `medianGapBaseline(durationsMs: readonly number[]): number | null`
  - `computeAllDailyPerformance(activityEntries, actionEntries): DailyPerformance[]`
  - `filterDailyPerformance(records, scope: PerformanceScopeFilter): DailyPerformance[]`
  - `flattenGaps(records): GapEvent[]`
  - `aggregateSamplesByDay(records): { day: string; count: number }[]`
  - `summarizePerformance(records): PerformanceSummary`
  - `employeesInPerformanceData(records): string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/data/performance/performanceMetrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
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
    expect(dayKey("2026-06-01T23:59:00.000Z")).toBe("2026-06-01");
  });
  it("returns empty string for an unparseable timestamp", () => {
    expect(dayKey("not-a-date")).toBe("");
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
    expect(classifyGapTier(baseline + GAP_TIER_THRESHOLDS_MS.smallExtraMs, baseline)).toBe("normal");
  });
  it("small just above the normal boundary", () => {
    expect(classifyGapTier(baseline + GAP_TIER_THRESHOLDS_MS.smallExtraMs + 1000, baseline)).toBe("small");
  });
  it("medium just above the small boundary", () => {
    expect(classifyGapTier(baseline + GAP_TIER_THRESHOLDS_MS.mediumExtraMs + 1000, baseline)).toBe("medium");
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

  it("flattenGaps is empty here (each employee has only one finish that day, no second point to gap against)", () => {
    expect(flattenGaps(all)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/performance/performanceMetrics.test.ts`
Expected: FAIL — `./performanceMetrics` does not exist yet.

- [ ] **Step 3: Create `src/data/performance/performanceMetrics.ts`**

```ts
/**
 * Pure calculations for the employee performance-evaluation feature.
 * No I/O — callers pass already-loaded `AuthActivityLogEntry[]` /
 * `WorkspaceActionEntry[]` (from `readAuthActivityLog()` /
 * `readWorkspaceActions()`). See
 * docs/superpowers/specs/2026-08-27-employee-performance-evaluation-design.md.
 */

import type { AuthActivityLogEntry } from "../../auth/authActivityLog";
import type { WorkspaceActionEntry } from "../audit/actionLog";
import {
  GAP_TIER_THRESHOLDS_MS,
  IMPLAUSIBLE_SESSION_SPAN_MS,
  MIN_GAP_SAMPLES_FOR_BASELINE,
  type DailyPerformance,
  type GapEvent,
  type GapTier,
  type PerformanceScopeFilter,
  type PerformanceSummary,
} from "./performanceTypes";

/** YYYY-MM-DD for a timestamp, or "" when unparseable. */
export function dayKey(at: string): string {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

/** YYYY-MM for a day key. */
function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

/** Minutes since LOCAL midnight for a timestamp — the x-axis unit for the working-hours strip chart. */
export function minutesOfDay(at: string): number {
  const date = new Date(at);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Excludes activity entries whose recorded span is implausible for one
 * shift — the read-time guard against the pre-fix stale-`signedInAt` bug's
 * historical data (see authActivityLog.ts / authSession.ts, Task 1). Never
 * rewrites the source entries; this filter applies only inside this
 * module's own aggregation.
 */
export function sanitizeActivityEntries(
  entries: readonly AuthActivityLogEntry[]
): AuthActivityLogEntry[] {
  return entries.filter((entry) => {
    const start = Date.parse(entry.signedInAt);
    const end = Date.parse(entry.lastSeenAt);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return false;
    return end - start <= IMPLAUSIBLE_SESSION_SPAN_MS;
  });
}

/** Earliest sanitized sign-in per (employee, day), keyed as `"{employee}|{day}"`. */
export function firstSignInByEmployeeDay(
  entries: readonly AuthActivityLogEntry[]
): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of sanitizeActivityEntries(entries)) {
    const day = dayKey(entry.signedInAt);
    if (day === "") continue;
    const key = `${entry.username}|${day}`;
    const existing = result.get(key);
    if (!existing || Date.parse(entry.signedInAt) < Date.parse(existing)) {
      result.set(key, entry.signedInAt);
    }
  }
  return result;
}

/** The employee a submitted answer counts against — the assignee for an on-behalf submission, the actor otherwise. */
function performingEmployee(entry: WorkspaceActionEntry): string {
  if (entry.action === "answer-submitted-on-behalf") {
    const assignee = entry.details?.assignee;
    if (typeof assignee === "string" && assignee.trim() !== "") return assignee;
  }
  return entry.actor;
}

/** Sorted finish timestamps per (employee, day), keyed as `"{employee}|{day}"`, from answer-submitted[-on-behalf] entries. */
export function finishTimestampsByEmployeeDay(
  entries: readonly WorkspaceActionEntry[]
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.action !== "answer-submitted" && entry.action !== "answer-submitted-on-behalf") continue;
    const day = dayKey(entry.at);
    if (day === "") continue;
    const key = `${performingEmployee(entry)}|${day}`;
    const list = result.get(key);
    if (list) list.push(entry.at);
    else result.set(key, [entry.at]);
  }
  for (const list of result.values()) list.sort((a, b) => Date.parse(a) - Date.parse(b));
  return result;
}

/**
 * Tier a gap duration falls into relative to the employee's own monthly
 * median (`baselineMs`). A `null` baseline (fewer than
 * MIN_GAP_SAMPLES_FOR_BASELINE gaps that month) always reports
 * "unclassified" — there is no reliable pace to compare against yet.
 */
export function classifyGapTier(durationMs: number, baselineMs: number | null): GapTier {
  if (baselineMs === null) return "unclassified";
  if (durationMs <= baselineMs + GAP_TIER_THRESHOLDS_MS.smallExtraMs) return "normal";
  if (durationMs <= baselineMs + GAP_TIER_THRESHOLDS_MS.mediumExtraMs) return "small";
  if (durationMs <= baselineMs + GAP_TIER_THRESHOLDS_MS.largeExtraMs) return "medium";
  return "large";
}

/** The median of a list of non-negative durations, or null below MIN_GAP_SAMPLES_FOR_BASELINE samples. */
export function medianGapBaseline(durationsMs: readonly number[]): number | null {
  if (durationsMs.length < MIN_GAP_SAMPLES_FOR_BASELINE) return null;
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

type RawGap = { startAt: string; endAt: string; durationMs: number };

/** sign-in → first finish, then finish → finish. Never fabricates a gap before an unknown sign-in or after the last finish of the day. */
function rawGapsForDay(signInAt: string | null, finishes: readonly string[]): RawGap[] {
  const gaps: RawGap[] = [];
  const points = signInAt ? [signInAt, ...finishes] : finishes;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const startAt = points[i]!;
    const endAt = points[i + 1]!;
    const durationMs = Date.parse(endAt) - Date.parse(startAt);
    if (Number.isFinite(durationMs) && durationMs >= 0) gaps.push({ startAt, endAt, durationMs });
  }
  return gaps;
}

/**
 * Build every employee's daily performance record from raw activity +
 * action data, unfiltered (the caller narrows with `filterDailyPerformance`
 * afterward). Two passes: (1) collect every within-day gap duration to
 * compute each employee's monthly median baseline, (2) classify each gap's
 * tier against that baseline and assemble the daily records. Gaps never
 * cross a calendar-day boundary — each day starts fresh at that day's own
 * sign-in.
 */
export function computeAllDailyPerformance(
  activityEntries: readonly AuthActivityLogEntry[],
  actionEntries: readonly WorkspaceActionEntry[]
): DailyPerformance[] {
  const signIns = firstSignInByEmployeeDay(activityEntries);
  const finishesByDay = finishTimestampsByEmployeeDay(actionEntries);

  const dayKeys = new Set<string>([...signIns.keys(), ...finishesByDay.keys()]);

  const rawGapsByKey = new Map<string, RawGap[]>();
  const durationsByEmployeeMonth = new Map<string, number[]>();
  for (const key of dayKeys) {
    const [employee, day] = key.split("|") as [string, string];
    const signInAt = signIns.get(key) ?? null;
    const finishes = finishesByDay.get(key) ?? [];
    const gaps = rawGapsForDay(signInAt, finishes);
    rawGapsByKey.set(key, gaps);
    if (gaps.length > 0) {
      const monthKey = `${employee}|${monthOfDay(day)}`;
      const durations = gaps.map((g) => g.durationMs);
      const bucket = durationsByEmployeeMonth.get(monthKey);
      if (bucket) bucket.push(...durations);
      else durationsByEmployeeMonth.set(monthKey, durations);
    }
  }

  const baselineByEmployeeMonth = new Map<string, number | null>();
  for (const [monthKey, durations] of durationsByEmployeeMonth) {
    baselineByEmployeeMonth.set(monthKey, medianGapBaseline(durations));
  }

  const records: DailyPerformance[] = [];
  for (const key of dayKeys) {
    const [employee, day] = key.split("|") as [string, string];
    const signInAt = signIns.get(key) ?? null;
    const finishes = finishesByDay.get(key) ?? [];
    const baseline = baselineByEmployeeMonth.get(`${employee}|${monthOfDay(day)}`) ?? null;
    const gaps: GapEvent[] = (rawGapsByKey.get(key) ?? []).map((gap) => ({
      employee,
      day,
      startAt: gap.startAt,
      endAt: gap.endAt,
      durationMs: gap.durationMs,
      tier: classifyGapTier(gap.durationMs, baseline),
    }));
    const lastFinishAt = finishes.length > 0 ? finishes[finishes.length - 1]! : null;
    records.push({
      employee,
      day,
      samplesFinished: finishes.length,
      signInAt,
      lastFinishAt,
      effectiveTimeMs:
        signInAt && lastFinishAt
          ? Math.max(0, Date.parse(lastFinishAt) - Date.parse(signInAt))
          : null,
      gaps,
    });
  }

  return records.sort(
    (a, b) => a.day.localeCompare(b.day) || a.employee.localeCompare(b.employee, "ar")
  );
}

/** Pure filter over daily records — mirrors actionCatalog.ts's filterActionEntries. */
export function filterDailyPerformance(
  records: readonly DailyPerformance[],
  scope: PerformanceScopeFilter
): DailyPerformance[] {
  const employee = scope.employee.trim();
  return records.filter((record) => {
    if (employee !== "" && record.employee !== employee) return false;
    if (scope.from !== "" && record.day < scope.from) return false;
    if (scope.to !== "" && record.day > scope.to) return false;
    return true;
  });
}

/** Every gap in a set of (already-filtered) daily records, sorted ascending by start time. */
export function flattenGaps(records: readonly DailyPerformance[]): GapEvent[] {
  return records
    .flatMap((record) => record.gaps)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

/** Per-day samples-finished counts across a set of (already-filtered) daily records — sums across employees when more than one is in scope. */
export function aggregateSamplesByDay(
  records: readonly DailyPerformance[]
): { day: string; count: number }[] {
  const byDay = new Map<string, number>();
  for (const record of records) {
    byDay.set(record.day, (byDay.get(record.day) ?? 0) + record.samplesFinished);
  }
  return [...byDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

const EMPTY_TIER_COUNTS: Record<GapTier, number> = {
  normal: 0,
  small: 0,
  medium: 0,
  large: 0,
  unclassified: 0,
};

/** Summary stat cards for a (already-filtered) set of daily records. */
export function summarizePerformance(records: readonly DailyPerformance[]): PerformanceSummary {
  const gaps = flattenGaps(records);
  const gapCountsByTier: Record<GapTier, number> = { ...EMPTY_TIER_COUNTS };
  for (const gap of gaps) gapCountsByTier[gap.tier] += 1;

  const totalSamples = records.reduce((sum, r) => sum + r.samplesFinished, 0);
  const effectiveDurations = records
    .map((r) => r.effectiveTimeMs)
    .filter((v): v is number => v !== null);
  const totalEffectiveMs =
    effectiveDurations.length > 0 ? effectiveDurations.reduce((sum, v) => sum + v, 0) : null;
  const medianGapMs = medianGapBaseline(gaps.map((g) => g.durationMs));

  return { totalSamples, totalEffectiveMs, gapCountsByTier, medianGapMs };
}

/** Distinct employees present in a set of daily records, sorted for a picker. */
export function employeesInPerformanceData(records: readonly DailyPerformance[]): string[] {
  return [...new Set(records.map((r) => r.employee))].sort((a, b) => a.localeCompare(b, "ar"));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/performance/performanceMetrics.test.ts`
Expected: PASS — all tests.

- [ ] **Step 5: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/data/performance/performanceMetrics.ts src/data/performance/performanceMetrics.test.ts
git commit -m "Add (performance): pure calculations for samples/day, gaps, and monthly pace baseline"
```

---

### Task 4: Performance chart primitives

**Files:**
- Create: `src/components/Sidebar/Tabs/UserManagement/performanceCharts.ts`
- Test: `src/components/Sidebar/Tabs/UserManagement/performanceCharts.test.ts`

**Interfaces:**
- Consumes: `{ day: string; count: number }[]` (matches Task 3's `aggregateSamplesByDay` return type) and a new local `DayStrip` type.
- Produces: `samplesTrendSvg(points, emptyNote): string`, `workingHoursStripSvg(days, emptyNote): string`, and the exported `DayStrip` type — all consumed by Task 6 (`PerformanceSection.tsx`).

This is a NEW sibling file scoped to `UserManagement`, not a modification of `Reports/kpiCharts.ts` — the two tabs' chart primitives stay independent (Reports' file imports `Reports/kpiSelectors.ts` types and is not a shared utility). Same rendering discipline as that file: pure `(data, labels) => string`, no React/DOM, no chart library, every label through `esc()`, `direction:ltr`, every color a `var(--c-…)` token.

- [ ] **Step 1: Write the failing tests**

Create `src/components/Sidebar/Tabs/UserManagement/performanceCharts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { samplesTrendSvg, workingHoursStripSvg } from "./performanceCharts";

describe("samplesTrendSvg", () => {
  it("falls back to the empty state when there are no points", () => {
    const svg = samplesTrendSvg([], "لا توجد بيانات");
    expect(svg).toContain("لا توجد بيانات");
    expect(svg).not.toContain("<path");
  });

  it("draws one line for a set of points and escapes day labels", () => {
    const svg = samplesTrendSvg(
      [
        { day: "2026-06-01", count: 2 },
        { day: "2026-06-02", count: 5 },
      ],
      "لا توجد بيانات"
    );
    expect(svg).toContain("<path");
    expect(svg).toContain("06-01");
    expect(svg).toContain("06-02");
    expect(svg).not.toContain("#"); // no raw hex — every color is a var(--c-…) token
  });
});

describe("workingHoursStripSvg", () => {
  it("falls back to the empty state when there are no days", () => {
    const svg = workingHoursStripSvg([], "اختر موظفاً");
    expect(svg).toContain("اختر موظفاً");
  });

  it("draws a base bar spanning sign-in to last finish, and a gap overlay for a non-normal gap", () => {
    const svg = workingHoursStripSvg(
      [
        {
          day: "2026-06-01",
          signInMinute: 6 * 60,
          lastFinishMinute: 11 * 60,
          gapSegments: [{ startMinute: 6 * 60 + 20, endMinute: 7 * 60 + 20, tier: "large" }],
        },
      ],
      "اختر موظفاً"
    );
    // Base bar + one non-normal gap overlay = at least two <rect> fills beyond the track background.
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    expect(rectCount).toBeGreaterThanOrEqual(3); // track + base bar + gap overlay
    expect(svg).toContain("2026-06-01");
  });

  it("does not draw an overlay for a normal-tier gap", () => {
    const svg = workingHoursStripSvg(
      [
        {
          day: "2026-06-01",
          signInMinute: 6 * 60,
          lastFinishMinute: 7 * 60,
          gapSegments: [{ startMinute: 6 * 60, endMinute: 6 * 60 + 5, tier: "normal" }],
        },
      ],
      "اختر موظفاً"
    );
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    expect(rectCount).toBe(2); // track + base bar only, no gap overlay
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/UserManagement/performanceCharts.test.ts`
Expected: FAIL — `./performanceCharts` does not exist yet.

- [ ] **Step 3: Create `src/components/Sidebar/Tabs/UserManagement/performanceCharts.ts`**

```ts
// Hand-rolled inline-SVG chart primitives for تقييم الأداء (employee
// performance evaluation). Scoped to UserManagement — deliberately NOT
// shared with Reports/kpiCharts.ts, which is that tab's own chart module.
// Same discipline as both kpiCharts.ts and
// data/reporting/executive/ui/charts.ts:
//   • null / empty data → neutral "—" state, never throw
//   • every caller-supplied label routed through esc()
//   • direction:ltr on the <svg>; RTL expressed in the coordinate math
//   • no raw #hex — every colour is a var(--c-…) token

const C = {
  navy: "var(--c-navy)",
  navySoft: "var(--c-navy-soft)",
  ink: "var(--c-ink)",
  ink3: "var(--c-ink-3)",
  ink4: "var(--c-ink-4)",
  border: "var(--c-border)",
  teal: "var(--c-teal-deep)",
  coral: "var(--c-coral)",
  gold: "var(--brand-premium)",
  sky: "var(--c-sky)",
} as const;

const GAP_TIER_COLORS: Record<string, string> = {
  normal: C.teal,
  small: C.sky,
  medium: C.gold,
  large: C.coral,
  unclassified: C.ink4,
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function r(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

function open(w: number, h: number, extraStyle = ""): string {
  return (
    `<svg viewBox="0 0 ${r(w)} ${r(h)}" xmlns="http://www.w3.org/2000/svg" ` +
    `width="100%" style="direction:ltr;display:block;${extraStyle}">`
  );
}

function emptyState(w: number, h: number, note: string): string {
  return (
    open(w, h) +
    `<text x="${r(w / 2)}" y="${r(h / 2)}" text-anchor="middle" dominant-baseline="middle" ` +
    `font-size="24" font-weight="800" fill="${C.ink4}">—</text>` +
    `<text x="${r(w / 2)}" y="${r(h / 2 + 22)}" text-anchor="middle" font-size="11" ` +
    `fill="${C.ink3}">${esc(note)}</text>` +
    `</svg>`
  );
}

export type DayCount = { day: string; count: number };

/**
 * Samples-finished-per-day trend line. RTL: the EARLIEST day sits at the
 * right edge, most recent at the left — same date-axis direction as
 * Reports' inaccuracyCalendarSvg and the executive report's timeSeriesBand.
 */
export function samplesTrendSvg(points: readonly DayCount[], emptyNote: string): string {
  const w = 720;
  const h = 220;
  if (points.length === 0) return emptyState(w, h, emptyNote);
  const plot = { top: 16, right: 690, bottom: 180, left: 30 };
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const stepX = points.length > 1 ? pw / (points.length - 1) : 0;
  const xFor = (index: number) => plot.right - index * stepX;
  const yFor = (count: number) => plot.bottom - (count / maxCount) * ph;

  let gridAndAxis = "";
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = Math.round((maxCount / 4) * tick);
    const y = yFor(value);
    gridAndAxis +=
      `<line x1="${r(plot.left)}" x2="${r(plot.right)}" y1="${r(y)}" y2="${r(y)}" stroke="${C.border}" stroke-dasharray="2 4"/>` +
      `<text x="${r(plot.right + 8)}" y="${r(y + 4)}" font-size="11" fill="${C.ink3}">${value}</text>`;
  }

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${r(xFor(i))} ${r(yFor(p.count))}`)
    .join(" ");

  const labelStride = Math.max(1, Math.ceil(points.length / 10));
  let dots = "";
  points.forEach((p, i) => {
    const x = xFor(i);
    const y = yFor(p.count);
    dots += `<circle cx="${r(x)}" cy="${r(y)}" r="3.5" fill="${C.navy}"/>`;
    if (i === 0 || i === points.length - 1 || i % labelStride === 0) {
      dots += `<text x="${r(x)}" y="${r(plot.bottom + 18)}" text-anchor="middle" font-size="10" fill="${C.ink3}">${esc(p.day.slice(5))}</text>`;
    }
  });

  return (
    open(w, h, "min-width:480px;height:auto") +
    gridAndAxis +
    `<line x1="${r(plot.left)}" x2="${r(plot.right)}" y1="${r(plot.bottom)}" y2="${r(plot.bottom)}" stroke="${C.ink3}"/>` +
    `<path d="${path}" fill="none" stroke="${C.navy}" stroke-width="2.5" stroke-linejoin="round"/>` +
    dots +
    `</svg>`
  );
}

export type DayStrip = {
  day: string;
  /** Minutes since local midnight, or null when unknown. */
  signInMinute: number | null;
  lastFinishMinute: number | null;
  gapSegments: { startMinute: number; endMinute: number; tier: string }[];
};

/**
 * One horizontal 24h strip per day: a base bar from sign-in to last finish,
 * with each non-"normal" gap overlaid in its tier colour. RTL: 00:00 at the
 * right edge, 24:00 at the left, matching samplesTrendSvg's date-axis
 * direction. A "normal" gap is not drawn — it is expected pacing, not
 * something worth highlighting on the strip.
 */
export function workingHoursStripSvg(days: readonly DayStrip[], emptyNote: string): string {
  const w = 720;
  const rowH = 30;
  const labelW = 90;
  const h = 24 + days.length * rowH + 8;
  if (days.length === 0) return emptyState(w, 120, emptyNote);

  const trackW = w - labelW - 10;
  const minutesPerPx = 1440 / trackW;
  const xFor = (minute: number) => w - labelW - minute / minutesPerPx;

  let out = "";
  days.forEach((day, index) => {
    const y = 20 + index * rowH;
    out += `<text x="${r(w)}" y="${r(y + rowH / 2 + 4)}" text-anchor="end" font-size="12" font-weight="700" fill="${C.ink}">${esc(day.day)}</text>`;
    out += `<rect x="10" y="${r(y + 4)}" width="${r(trackW)}" height="${r(rowH - 12)}" rx="4" fill="${C.navySoft}" fill-opacity="0.15"/>`;
    if (
      day.signInMinute !== null &&
      day.lastFinishMinute !== null &&
      day.lastFinishMinute > day.signInMinute
    ) {
      const x1 = xFor(day.lastFinishMinute);
      const x2 = xFor(day.signInMinute);
      out += `<rect x="${r(x1)}" y="${r(y + 4)}" width="${r(x2 - x1)}" height="${r(rowH - 12)}" rx="4" fill="${C.navy}" fill-opacity="0.35"/>`;
    }
    for (const gap of day.gapSegments) {
      if (gap.tier === "normal" || gap.tier === "unclassified") continue;
      const x1 = xFor(gap.endMinute);
      const x2 = xFor(gap.startMinute);
      const color = GAP_TIER_COLORS[gap.tier] ?? C.ink4;
      out += `<rect x="${r(x1)}" y="${r(y + 4)}" width="${r(Math.max(1, x2 - x1))}" height="${r(rowH - 12)}" rx="3" fill="${color}"/>`;
    }
  });

  return open(w, h, "min-width:480px;height:auto") + out + `</svg>`;
}
```

Note: the test "does not draw an overlay for a normal-tier gap" expects `rectCount === 2` — this implementation also skips `"unclassified"` (a deliberate, spec-consistent extension: an unclassified gap has no reliable baseline to be flagged against, so it should not visually read as an anomaly either). Update that test's intent comment is not required — the assertion (`rectCount === 2`) already holds for both `"normal"` and `"unclassified"` inputs, and the test only exercises `"normal"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/UserManagement/performanceCharts.test.ts`
Expected: PASS — all tests.

- [ ] **Step 5: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar/Tabs/UserManagement/performanceCharts.ts src/components/Sidebar/Tabs/UserManagement/performanceCharts.test.ts
git commit -m "Add (performance): samples-trend and working-hours-strip SVG chart primitives"
```

---

### Task 5: Add تقييم الأداء labels

**Files:**
- Modify: `src/data/labels/labelsStore.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the following new `LabelKey`s (all consumed by Task 6's `PerformanceSection.tsx`): `um_perf_tab_label`, `um_perf_desc`, `um_perf_refresh_btn`, `um_perf_loading`, `um_perf_empty`, `um_perf_filters_title`, `um_perf_filter_employee`, `um_perf_filter_employee_all`, `um_perf_filter_from`, `um_perf_filter_to`, `um_perf_filter_reset`, `um_perf_summary_samples`, `um_perf_summary_effective`, `um_perf_summary_pace`, `um_perf_summary_gaps_normal`, `um_perf_summary_gaps_small`, `um_perf_summary_gaps_medium`, `um_perf_summary_gaps_large`, `um_perf_trend_title`, `um_perf_trend_empty`, `um_perf_hours_title`, `um_perf_hours_empty`, `um_perf_gaps_title`, `um_perf_gaps_empty`, `um_perf_gaps_col_employee`, `um_perf_gaps_col_day`, `um_perf_gaps_col_start`, `um_perf_gaps_col_end`, `um_perf_gaps_col_duration`, `um_perf_gaps_col_tier`, `um_perf_gap_tier_normal`, `um_perf_gap_tier_small`, `um_perf_gap_tier_medium`, `um_perf_gap_tier_large`, `um_perf_gap_tier_unclassified`, `um_perf_no_workspace`.

Since `LabelKey = keyof typeof DEFAULT_LABELS`, adding these keys to the `DEFAULT_LABELS` object is enough to make them valid — no separate type export to update.

- [ ] **Step 1: Add the new label block**

In `src/data/labels/labelsStore.ts`, insert this new block immediately after the existing `um_actions_no_match:` line (the last line of the "Actions viewer — filter bar" section, right before the `// ── ReportDesigner` comment):

```ts
  // ── UserManagement — employee performance evaluation (تقييم الأداء) ──
  um_perf_tab_label:            "تقييم الأداء",
  um_perf_desc:                 "إحصاءات سرعة الإنجاز والفجوات وساعات العمل الفعلية، مبنية على سجل الإجراءات وسجل الجلسات المحفوظين داخل مساحة العمل.",
  um_perf_refresh_btn:          "تحديث",
  um_perf_loading:              "جاري تحميل البيانات...",
  um_perf_empty:                "لا توجد بيانات كافية لعرض الإحصاءات ضمن التصفية الحالية.",
  um_perf_filters_title:        "تصفية الإحصاءات",
  um_perf_filter_employee:      "الموظف",
  um_perf_filter_employee_all:  "كل الموظفين ({count})",
  um_perf_filter_from:          "من تاريخ",
  um_perf_filter_to:            "إلى تاريخ",
  um_perf_filter_reset:         "إعادة ضبط التصفية",
  um_perf_summary_samples:      "العينات المُنجزة",
  um_perf_summary_effective:    "ساعات العمل الفعلية",
  um_perf_summary_pace:         "الوسيط الزمني بين العينات",
  um_perf_summary_gaps_normal:  "فجوات طبيعية",
  um_perf_summary_gaps_small:   "فجوات صغيرة",
  um_perf_summary_gaps_medium:  "فجوات متوسطة",
  um_perf_summary_gaps_large:   "فجوات كبيرة",
  um_perf_trend_title:          "العينات المُنجزة يومياً",
  um_perf_trend_empty:          "لا توجد عينات مُنجزة ضمن الفترة المحددة.",
  um_perf_hours_title:          "ساعات العمل اليومية",
  um_perf_hours_empty:          "اختر موظفاً واحداً لعرض ساعات عمله اليومية.",
  um_perf_gaps_title:           "سجل الفجوات",
  um_perf_gaps_empty:           "لا توجد فجوات مسجلة ضمن الفترة المحددة.",
  um_perf_gaps_col_employee:    "الموظف",
  um_perf_gaps_col_day:         "اليوم",
  um_perf_gaps_col_start:       "بداية الفجوة",
  um_perf_gaps_col_end:         "نهاية الفجوة",
  um_perf_gaps_col_duration:    "المدة",
  um_perf_gaps_col_tier:        "التصنيف",
  um_perf_gap_tier_normal:      "طبيعية",
  um_perf_gap_tier_small:       "صغيرة",
  um_perf_gap_tier_medium:      "متوسطة",
  um_perf_gap_tier_large:       "كبيرة",
  um_perf_gap_tier_unclassified: "غير مصنّفة",
  um_perf_no_workspace:         "لا يوجد مجلد عمل متصل — تعذر قراءة بيانات الأداء.",
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (nothing consumes these keys yet, so this only proves the object literal itself is valid).

- [ ] **Step 3: Run the existing label-consistency tests**

Run: `npx vitest run src/data/labels`
Expected: PASS — no existing test enumerates "every key must be consumed somewhere," so adding unused keys does not fail anything at this point; Task 6 consumes them.

- [ ] **Step 4: Commit**

```bash
git add src/data/labels/labelsStore.ts
git commit -m "Add (labels): تقييم الأداء strings for the employee performance-evaluation subtab"
```

---

### Task 6: `PerformanceSection` UI component

**Files:**
- Create: `src/components/Sidebar/Tabs/UserManagement/PerformanceSection.tsx`
- Test: `src/components/Sidebar/Tabs/UserManagement/PerformanceSection.test.tsx`

**Interfaces:**
- Consumes: `ManagedLoginUser` from `src/auth/userManagement.ts`; `AuthActivityLogEntry` from `src/auth/authActivityLog.ts`; `WorkspaceActionEntry` from `src/data/audit/actionLog.ts`; everything exported from Task 3's `performanceMetrics.ts` and Task 2's `performanceTypes.ts`; `samplesTrendSvg`, `workingHoursStripSvg`, `DayStrip` from Task 4's `performanceCharts.ts`; `formatDateTime`, `formatDuration` from `./userManagementFormatters`; `Pagination` from `../../../../components/Pagination/Pagination`; `clampPage`, `pageSlice` from `../../../../utils/paginationUtils`; `getLabels` from `../../../../data/labels/labelsStore`.
- Produces: `export function PerformanceSection(props: { users: ManagedLoginUser[]; activityEntries: AuthActivityLogEntry[]; actionEntries: WorkspaceActionEntry[]; isLoading: boolean; hasWorkspace: boolean; onRefresh: () => void }): JSX.Element` — consumed by Task 7's `TabView.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/Sidebar/Tabs/UserManagement/PerformanceSection.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManagedLoginUser } from "../../../../auth/userManagement";
import type { AuthActivityLogEntry } from "../../../../auth/authActivityLog";
import type { WorkspaceActionEntry } from "../../../../data/audit/actionLog";
import { PerformanceSection } from "./PerformanceSection";

afterEach(cleanup);

const SARA: ManagedLoginUser = {
  id: "u1",
  username: "sara",
  displayName: "Sara Q",
  passwordHash: { algorithm: "argon2id", encoded: "x" },
  role: "employee",
  isActive: true,
  hasCertScanLicense: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function activityEntry(over: Partial<AuthActivityLogEntry> = {}): AuthActivityLogEntry {
  return {
    id: "auth-1",
    username: "sara",
    role: "employee",
    signedInAt: "2026-06-01T06:00:00.000Z",
    lastSeenAt: "2026-06-01T09:00:00.000Z",
    signedOutAt: "2026-06-01T09:00:00.000Z",
    durationMs: 3 * 60 * 60 * 1000,
    closeReason: "logout",
    ...over,
  };
}

function actionEntry(over: Partial<WorkspaceActionEntry> = {}): WorkspaceActionEntry {
  return {
    id: "act-1",
    at: "2026-06-01T06:30:00.000Z",
    actor: "sara",
    actorRole: "employee",
    action: "answer-submitted",
    target: "IMG-1",
    ...over,
  };
}

describe("PerformanceSection", () => {
  it("shows the no-workspace message distinctly from the generic empty message", () => {
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[]}
        actionEntries={[]}
        isLoading={false}
        hasWorkspace={false}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText(/لا يوجد مجلد عمل متصل/)).toBeInTheDocument();
  });

  it("shows the empty-data message when a workspace is connected but there is no data yet", () => {
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[]}
        actionEntries={[]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText("لا توجد بيانات كافية لعرض الإحصاءات ضمن التصفية الحالية.")).toBeInTheDocument();
  });

  it("renders summary cards and the samples-finished count from real data", () => {
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[activityEntry()]}
        actionEntries={[actionEntry()]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText("العينات المُنجزة")).toBeInTheDocument();
    // One sample finished by sara.
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows the working-hours empty message until a single employee is selected", () => {
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[activityEntry()]}
        actionEntries={[actionEntry()]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText("اختر موظفاً واحداً لعرض ساعات عمله اليومية.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الموظف"), { target: { value: "sara" } });
    expect(
      screen.queryByText("اختر موظفاً واحداً لعرض ساعات عمله اليومية.")
    ).not.toBeInTheDocument();
  });

  it("calls onRefresh when the refresh button is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[]}
        actionEntries={[]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={onRefresh}
      />
    );
    fireEvent.click(screen.getByText("تحديث"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/UserManagement/PerformanceSection.test.tsx`
Expected: FAIL — `./PerformanceSection` does not exist yet.

- [ ] **Step 3: Create `src/components/Sidebar/Tabs/UserManagement/PerformanceSection.tsx`**

```tsx
import { useMemo, useState } from "react";
import type { AuthActivityLogEntry } from "../../../../auth/authActivityLog";
import type { ManagedLoginUser } from "../../../../auth/userManagement";
import type { WorkspaceActionEntry } from "../../../../data/audit/actionLog";
import { getLabels, type LabelKey } from "../../../../data/labels/labelsStore";
import Pagination from "../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../utils/paginationUtils";
import { formatDateTime, formatDuration } from "./userManagementFormatters";
import {
  aggregateSamplesByDay,
  computeAllDailyPerformance,
  filterDailyPerformance,
  flattenGaps,
  minutesOfDay,
  summarizePerformance,
} from "../../../../data/performance/performanceMetrics";
import type {
  DailyPerformance,
  GapTier,
  PerformanceScopeFilter,
} from "../../../../data/performance/performanceTypes";
import { samplesTrendSvg, workingHoursStripSvg, type DayStrip } from "./performanceCharts";

const GAP_TIER_LABEL_KEYS: Record<GapTier, LabelKey> = {
  normal: "um_perf_gap_tier_normal",
  small: "um_perf_gap_tier_small",
  medium: "um_perf_gap_tier_medium",
  large: "um_perf_gap_tier_large",
  unclassified: "um_perf_gap_tier_unclassified",
};

function emptyScope(): PerformanceScopeFilter {
  return { employee: "", from: "", to: "" };
}

type EmployeeOption = { username: string; displayName: string; count: number };

function buildEmployeeOptions(
  users: readonly ManagedLoginUser[],
  daily: readonly DailyPerformance[]
): EmployeeOption[] {
  const counts = new Map<string, number>();
  for (const record of daily) {
    counts.set(record.employee, (counts.get(record.employee) ?? 0) + record.samplesFinished);
  }
  const names = new Map<string, string>();
  for (const user of users) {
    if (user.role === "employee" || user.role === "supervisor") names.set(user.username, user.displayName);
  }
  for (const username of counts.keys()) {
    if (!names.has(username)) names.set(username, username);
  }
  return [...names.entries()]
    .map(([username, displayName]) => ({ username, displayName, count: counts.get(username) ?? 0 }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ar"));
}

export function PerformanceSection(props: {
  users: ManagedLoginUser[];
  activityEntries: AuthActivityLogEntry[];
  actionEntries: WorkspaceActionEntry[];
  isLoading: boolean;
  hasWorkspace: boolean;
  onRefresh: () => void;
}) {
  const labels = getLabels();
  const [filter, setFilter] = useState<PerformanceScopeFilter>(emptyScope);

  const allDaily = useMemo(
    () => computeAllDailyPerformance(props.activityEntries, props.actionEntries),
    [props.activityEntries, props.actionEntries]
  );
  const filtered = useMemo(() => filterDailyPerformance(allDaily, filter), [allDaily, filter]);
  const summary = useMemo(() => summarizePerformance(filtered), [filtered]);
  const trendPoints = useMemo(() => aggregateSamplesByDay(filtered), [filtered]);
  const gaps = useMemo(() => flattenGaps(filtered), [filtered]);
  const employeeOptions = useMemo(() => buildEmployeeOptions(props.users, allDaily), [props.users, allDaily]);
  const totalSamples = useMemo(() => allDaily.reduce((sum, d) => sum + d.samplesFinished, 0), [allDaily]);

  const hourStrips: DayStrip[] = useMemo(() => {
    if (filter.employee === "") return [];
    return filtered
      .filter((d) => d.employee === filter.employee)
      .map((d) => ({
        day: d.day,
        signInMinute: d.signInAt ? minutesOfDay(d.signInAt) : null,
        lastFinishMinute: d.lastFinishAt ? minutesOfDay(d.lastFinishAt) : null,
        gapSegments: d.gaps.map((g) => ({
          startMinute: minutesOfDay(g.startAt),
          endMinute: minutesOfDay(g.endAt),
          tier: g.tier,
        })),
      }));
  }, [filtered, filter.employee]);

  const pageKey = `${filter.employee}:${filter.from}:${filter.to}`;
  const [pageState, setPageState] = useState<{ key: string; page: number }>(() => ({ key: pageKey, page: 1 }));
  const page = clampPage(pageState.key === pageKey ? pageState.page : 1, gaps.length);
  const pagedGaps = pageSlice(gaps, page);

  const emptyMessage = !props.hasWorkspace
    ? labels.um_perf_no_workspace
    : allDaily.length === 0
      ? labels.um_perf_empty
      : null;

  return (
    <div className="um-section">
      <h3 className="um-add-form-title">{labels.um_perf_tab_label}</h3>
      <div className="um-matrix-desc">{labels.um_perf_desc}</div>
      <div className="um-activity-toolbar">
        <button type="button" className="um-add-btn" onClick={props.onRefresh}>{labels.um_perf_refresh_btn}</button>
        {props.isLoading && <span>{labels.um_perf_loading}</span>}
      </div>

      <div className="um-perf-filters" role="group" aria-label={labels.um_perf_filters_title}>
        <div className="um-perf-filter-row">
          <label className="um-actions-filter-field">
            <span>{labels.um_perf_filter_employee}</span>
            <select value={filter.employee} onChange={(e) => setFilter((f) => ({ ...f, employee: e.target.value }))}>
              <option value="">{labels.um_perf_filter_employee_all.replace("{count}", String(totalSamples))}</option>
              {employeeOptions.map((option) => (
                <option key={option.username} value={option.username}>
                  {`${option.displayName} (${option.count})`}
                </option>
              ))}
            </select>
          </label>
          <label className="um-actions-filter-field">
            <span>{labels.um_perf_filter_from}</span>
            <input type="date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
          </label>
          <label className="um-actions-filter-field">
            <span>{labels.um_perf_filter_to}</span>
            <input type="date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
          </label>
          <button type="button" className="um-actions-filter-reset" onClick={() => setFilter(emptyScope())}>{labels.um_perf_filter_reset}</button>
        </div>
      </div>

      {emptyMessage ? (
        <div className="um-empty">{emptyMessage}</div>
      ) : (
        <>
          <div className="um-perf-summary-grid">
            <article className="um-perf-card"><span>{labels.um_perf_summary_samples}</span><strong>{summary.totalSamples.toLocaleString("ar-SA-u-nu-latn")}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_effective}</span><strong>{summary.totalEffectiveMs === null ? "—" : formatDuration(summary.totalEffectiveMs)}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_pace}</span><strong>{summary.medianGapMs === null ? "—" : formatDuration(summary.medianGapMs)}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_gaps_normal}</span><strong>{summary.gapCountsByTier.normal}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_gaps_small}</span><strong>{summary.gapCountsByTier.small}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_gaps_medium}</span><strong>{summary.gapCountsByTier.medium}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_gaps_large}</span><strong>{summary.gapCountsByTier.large}</strong></article>
          </div>

          <div className="um-perf-chart">
            <h4>{labels.um_perf_trend_title}</h4>
            {trendPoints.length === 0 ? (
              <div className="um-empty">{labels.um_perf_trend_empty}</div>
            ) : (
              <div dir="ltr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: samplesTrendSvg(trendPoints, labels.um_perf_trend_empty) }} />
            )}
          </div>

          <div className="um-perf-chart">
            <h4>{labels.um_perf_hours_title}</h4>
            {hourStrips.length === 0 ? (
              <div className="um-empty">{labels.um_perf_hours_empty}</div>
            ) : (
              <div dir="ltr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: workingHoursStripSvg(hourStrips, labels.um_perf_hours_empty) }} />
            )}
          </div>

          <h4>{labels.um_perf_gaps_title}</h4>
          {gaps.length === 0 ? (
            <div className="um-empty">{labels.um_perf_gaps_empty}</div>
          ) : (
            <>
              <div className="um-activity-table-wrap">
                <table className="um-activity-table">
                  <thead>
                    <tr>
                      <th>{labels.um_perf_gaps_col_employee}</th>
                      <th>{labels.um_perf_gaps_col_day}</th>
                      <th>{labels.um_perf_gaps_col_start}</th>
                      <th>{labels.um_perf_gaps_col_end}</th>
                      <th>{labels.um_perf_gaps_col_duration}</th>
                      <th>{labels.um_perf_gaps_col_tier}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGaps.map((gap, index) => (
                      <tr key={`${gap.employee}-${gap.startAt}-${index}`}>
                        <td>{gap.employee}</td>
                        <td>{gap.day}</td>
                        <td>{formatDateTime(gap.startAt)}</td>
                        <td>{formatDateTime(gap.endAt)}</td>
                        <td>{formatDuration(gap.durationMs)}</td>
                        <td>{labels[GAP_TIER_LABEL_KEYS[gap.tier]]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalItems={gaps.length} onPageChange={(nextPage) => setPageState({ key: pageKey, page: nextPage })} itemLabel="فجوة" />
            </>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Sidebar/Tabs/UserManagement/PerformanceSection.test.tsx`
Expected: PASS — all tests. (The `"1"` samples-finished assertion depends on the single `actionEntry()` fixture producing exactly one `answer-submitted` for `sara` on `2026-06-01`.)

- [ ] **Step 5: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors. (`getLabels` and `LabelKey` are both existing exports of `labelsStore.ts` — confirm the `LabelKey` type import compiles against Task 5's additions.)

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar/Tabs/UserManagement/PerformanceSection.tsx src/components/Sidebar/Tabs/UserManagement/PerformanceSection.test.tsx
git commit -m "Add (performance): PerformanceSection UI — filters, summary cards, trend chart, working-hours strip, gap table"
```

---

### Task 7: Wire the new subtab into UserManagement

**Files:**
- Modify: `src/components/Sidebar/Tabs/UserManagement/index.tsx`
- Modify: `src/components/Sidebar/Tabs/UserManagement/TabView.tsx`
- Modify: `src/components/Sidebar/Tabs/UserManagement/UserManagement.css`
- Test: `src/components/Sidebar/Tabs/UserManagement/index.sectionSwitch.test.tsx` (extend with one case)

**Interfaces:**
- Consumes: `PerformanceSection` from Task 6.
- Produces: nothing new — this task only wires existing pieces together.

- [ ] **Step 1: Register the subtab in `index.tsx`**

In `src/components/Sidebar/Tabs/UserManagement/index.tsx`, change:

```ts
  subTabs: [
    { id: "users", label: "المستخدمون" },
    { id: "page-permissions", label: "صلاحيات الصفحات" },
    { id: "feature-permissions", label: "صلاحيات الميزات" },
    { id: "activity", label: "متابعة الأنشطة" },
    { id: "actions", label: "سجل الإجراءات" },
  ],
```

to:

```ts
  subTabs: [
    { id: "users", label: "المستخدمون" },
    { id: "page-permissions", label: "صلاحيات الصفحات" },
    { id: "feature-permissions", label: "صلاحيات الميزات" },
    { id: "activity", label: "متابعة الأنشطة" },
    { id: "actions", label: "سجل الإجراءات" },
    { id: "performance", label: "تقييم الأداء" },
  ],
```

- [ ] **Step 2: Wire the section into `TabView.tsx`**

In `src/components/Sidebar/Tabs/UserManagement/TabView.tsx`:

a) Add the import (next to the existing `ActionsSection, ActivitySection` import):

```ts
import { ActionsSection, ActivitySection } from "./AuditSections";
import { PerformanceSection } from "./PerformanceSection";
```

b) Widen the `PageSection` union and the known-sections set:

```ts
type PageSection = "users" | "page-permissions" | "feature-permissions" | "activity" | "actions" | "performance";

const KNOWN_USER_MANAGEMENT_SECTIONS = new Set<PageSection>([
  "users",
  "page-permissions",
  "feature-permissions",
  "activity",
  "actions",
  "performance",
]);
```

c) Widen BOTH existing load-gating effects so the same `activityEntries`/`actionEntries` state and caching refs (`activityLoadedForRef`, `actionsLoadedForRef`) also serve the new `performance` section — no separate fetch, no separate loading state:

```ts
  useEffect(() => {
    if (section !== "activity" && section !== "performance") return;
    if (activityLoadedForRef.current === directoryHandle) return;
```

```ts
  useEffect(() => {
    if (section !== "actions" && section !== "performance") return;
    if (!directoryHandle) {
```

(Leave the rest of both effect bodies exactly as they are — only the guard condition at the top of each changes.)

d) Add the render branch, after the existing `{section === "actions" && (...)}` block and before the closing `</section>`:

```tsx
      {section === "performance" && (
        <PerformanceSection
          users={state.users}
          activityEntries={activityEntries}
          actionEntries={actionEntries}
          isLoading={isActivityLoading || isActionsLoading}
          hasWorkspace={!!directoryHandle}
          onRefresh={() => {
            setIsActivityLoading(true);
            void readAuthActivityLog()
              .then(setActivityEntries)
              .catch(logRejection("userManagement:refreshActivityLog"))
              .finally(() => setIsActivityLoading(false));
            if (!directoryHandle) {
              setIsActionsLoading(false);
              return;
            }
            setIsActionsLoading(true);
            void readWorkspaceActions(directoryHandle)
              .then(setActionEntries)
              .catch(logRejection("userManagement:refreshWorkspaceActions"))
              .finally(() => setIsActionsLoading(false));
          }}
        />
      )}
```

- [ ] **Step 3: Add the new CSS classes**

In `src/components/Sidebar/Tabs/UserManagement/UserManagement.css`, append at the end of the file:

```css
/* ── Performance evaluation (تقييم الأداء) ─────────────────────────────────── */

.um-perf-filters {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin: var(--sp-3) 0;
  padding: var(--sp-3);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  background: var(--app-surface-soft);
}

.um-perf-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sp-3);
}

.um-perf-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--sp-3);
  margin: var(--sp-3) 0;
}

.um-perf-card {
  display: grid;
  gap: var(--sp-1);
  padding: var(--sp-3);
  border: 1px solid var(--app-border);
  border-radius: var(--r-xl);
  background: var(--c-surface-2);
}

.um-perf-card span {
  color: var(--app-muted);
  font-size: 12px;
  font-weight: 700;
}

.um-perf-card strong {
  color: var(--app-primary);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}

.um-perf-chart {
  margin: var(--sp-4) 0;
}

.um-perf-chart h4 {
  margin: 0 0 var(--sp-2);
  font-size: 14px;
  font-weight: 800;
  color: var(--app-text);
}
```

- [ ] **Step 4: Extend `index.sectionSwitch.test.tsx` with cases for the new section**

`src/components/Sidebar/Tabs/UserManagement/index.sectionSwitch.test.tsx` already has a `describe("UserManagementTab — activity/actions section-switch skip-guard", ...)` block spying on `authActivityLog.readAuthActivityLog` and `actionLog.readWorkspaceActions` via `mockSession()`/`mockWorkspace()`/`switchSection()`/`waitForMount()` helpers already defined at the top of the file. Add this new `describe` block as a sibling of it, at the end of the file:

```ts
describe("UserManagementTab — performance section reuses the activity/actions loaders", () => {
  it("loads both the activity log and the action log when switching to 'performance'", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const activitySpy = vi
      .spyOn(authActivityLog, "readAuthActivityLog")
      .mockResolvedValue([]);
    const actionsSpy = vi
      .spyOn(actionLog, "readWorkspaceActions")
      .mockResolvedValue([]);

    render(<UserManagementTab />);
    await waitForMount();
    switchSection("performance");

    await waitFor(() => expect(activitySpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(actionsSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("تقييم الأداء")).toBeTruthy();
  });

  it("does not re-fetch the activity log when switching from 'activity' to 'performance' for the same workspace", async () => {
    mockSession();
    const handle = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    mockWorkspace(handle);
    const activitySpy = vi
      .spyOn(authActivityLog, "readAuthActivityLog")
      .mockResolvedValue([]);

    render(<UserManagementTab />);
    await waitForMount();
    switchSection("activity");
    await waitFor(() => expect(activitySpy).toHaveBeenCalledTimes(1));

    switchSection("performance");
    await act(async () => {
      await Promise.resolve();
    });
    expect(activitySpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5: Run the full UserManagement test suite**

Run: `npx vitest run src/components/Sidebar/Tabs/UserManagement`
Expected: PASS — every existing test in the directory, plus the new/extended ones.

- [ ] **Step 6: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar/Tabs/UserManagement/index.tsx src/components/Sidebar/Tabs/UserManagement/TabView.tsx src/components/Sidebar/Tabs/UserManagement/UserManagement.css src/components/Sidebar/Tabs/UserManagement/index.sectionSwitch.test.tsx
git commit -m "Add (performance): wire تقييم الأداء subtab into UserManagement"
```

---

### Task 8: Manual verification, full test suite, and release gates

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: PASS — every test in the repo, including all new/modified files from Tasks 1–7.

- [ ] **Step 2: Manual verification in a real browser**

Run: `npm run dev`, open the app in Chrome/Edge (File System Access API requirement), log in as an admin (or use the demo workspace), and:

1. Navigate to إدارة المستخدمين → تقييم الأداء. Confirm the subtab appears in the sidebar sub-nav and the page loads without errors.
2. With no employee filter selected ("كل الموظفين"), confirm the samples-trend chart and summary cards render (or the empty-data message, if the demo workspace has no `answer-submitted` history yet — populate some via the Employee Workspace referrals flow if needed to get real data).
3. Select a single employee in the filter. Confirm the working-hours strip chart appears (it should NOT appear while "كل الموظفين" is selected — confirm the empty message shows instead in that state).
4. Set a date range (from/to) and confirm the trend chart, summary cards, and gap table all narrow to that range.
5. Confirm the gap table's tier column shows sensible values, and that a gap tier's visual color on the working-hours strip roughly matches its severity (small/medium/large should visually stand out; normal gaps should not be highlighted).
6. Click "تحديث" and confirm it re-fetches without crashing.
7. Separately, verify the bug fix: log in, then in the browser's dev tools, simulate a stale session by editing `localStorage`'s `xray_auth_session_v1` `loginAt` field to a timestamp from over a day ago, then reload the page. Check إدارة المستخدمين → متابعة الأنشطة and confirm the new/updated activity entry's "دخول" (sign-in) column shows the RELOAD time, not the artificially old `loginAt` — and that "المدة" (duration) is small, not 24+ hours.

Per CLAUDE.md: "don't report a change as working on the strength of reading the code" — this step is mandatory, not optional, given this repo's documented history of effect-timing bugs surviving self-review.

- [ ] **Step 3: Run the Tier-3 release gate list**

This is Tier 3 per CLAUDE.md's edit-log ladder (new module + new subtab + a fix to a five-time-regressed area). Run each of the following and confirm all pass:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run check:complexity
npm run check:hex-literals
npm run check:release
npm run check:vendor
npm run build
npm run check:bundle-size
```

If `check:release` fails because the version/edit-log haven't been bumped yet, that is expected at this point — Step 4 below handles it.

- [ ] **Step 4: Generate the edit-log entry**

Run:

```bash
npm run editlog -- --tier=3 --sync-package "Add: employee performance evaluation (تقييم الأداء) + fix stale session-restore duration bug"
```

Fill in the generated skeleton's `Why:` / `What changed:` prose (and, since this is Tier 3, the migration/rollback note — rollback is simply reverting these commits; there is no data migration since no new on-disk file or schema was introduced) referencing this plan and its spec (`docs/superpowers/specs/2026-08-27-employee-performance-evaluation-design.md`). Re-run `npm run check:release` afterward to confirm it now passes.

- [ ] **Step 5: Final commit**

```bash
git add "docs/edit logs" package.json
git commit -m "Docs: edit-log entry for employee performance evaluation + session-restore bug fix"
```
