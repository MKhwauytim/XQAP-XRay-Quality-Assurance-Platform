// Deadline & daily-progress selectors for the results page's tracking tab.
// Pure: no I/O, no React. Everything is derived from rows the results page has
// already loaded (distribution entries + each assignee's answer), the quota
// stamps already in distribution.current.json, and the month's deadline.
//
// Definitions (owner-confirmed, see docs/superpowers/specs/2026-10-07-results-tracking-tab-design.md):
//   مكتملة   — a finished inspection (entry completed, or a submitted answer that
//              is not a no-image submission).
//   معلقة    — «مؤرشفة»: a submitted «هل يوجد صورة = لا» answer.
//   Day of work — the local calendar day of `submittedAt`.
//   Period — first distribution → today while cases remain, else the last
//     finish; may span several months. The deadline is a marker inside it.
//   Working days — Sunday–Thursday (utils/workingDays.ts); no holiday calendar.
//   Daily quota (display) — ceil(assigned ÷ working days from the employee's
//     assignment day to the deadline). Shown for the CURRENT deadline; stored
//     distribution quotas are never rewritten.
import type { ItemAnswer } from "../answers/answerTypes";
import { isNoImageSubmission } from "../answers/noImageAnswer";
import type { TemplateSchema } from "../templates/templateTypes";
import { countWorkingDays, isWorkingDay } from "../../utils/workingDays";

export type AnswerState = "completed" | "hold" | "pending" | "replaced";

/**
 * The one copy of the مكتملة / معلق / قيد الانتظار rule. A submitted no-image
 * answer is real work but not a finished inspection, so it is «hold», distinct
 * from both a true completion and an untouched assignment.
 */
export function classifyAnswerState(
  entryStatus: string,
  answer: ItemAnswer | null,
  template: TemplateSchema | null,
): AnswerState {
  if (entryStatus === "completed") return "completed";
  if (entryStatus === "replaced") return "replaced";
  if (answer?.status === "submitted") {
    return isNoImageSubmission(answer, template) ? "hold" : "completed";
  }
  return "pending";
}

export type TrackingRow = {
  assignedTo: string;
  state: Exclude<AnswerState, "replaced">;
  /** When the work was finished (ISO); null when unknown or not finished. */
  doneAt: string | null;
  /** When the row was assigned (ISO), so the period can start at the first distribution. */
  assignedAt?: string | null;
};

/**
 * The one copy of "when was this row finished": the answer's `submittedAt`,
 * else the entry's last event (a supervisor completion has no answer stamp).
 * Shared by the tracking tab and the queue stats strip's «المنجز اليوم».
 */
export function trackingDoneAt(
  state: Exclude<AnswerState, "replaced">,
  answer: ItemAnswer | null | undefined,
  entryLastEventAt: string | null | undefined,
): string | null {
  if (state === "pending") return null;
  return answer?.submittedAt ?? entryLastEventAt ?? null;
}

/**
 * «مكتملة في هذا اليوم» for one local calendar day: rows in state "completed"
 * (hold excluded, as in `dayTotals`) whose `doneAt` falls on `day`'s local date.
 */
export function countCompletedOnDay(
  rows: readonly Pick<TrackingRow, "state" | "doneAt">[],
  day: Date,
): number {
  let n = 0;
  for (const row of rows) {
    if (row.state !== "completed" || !row.doneAt) continue;
    const d = new Date(row.doneAt);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate()) n += 1;
  }
  return n;
}

export type DayCount = { completed: number; hold: number };

export type EmployeeTracking = {
  username: string;
  assigned: number;
  completed: number;
  hold: number;
  /** Finished rows whose date is unknown (in totals, not on the calendar). */
  unplaced: number;
  /** Period day the employee's count starts (assignment day, clamped into the period). */
  startDay: number;
  /** Days worked from `startDay` to the as-of day: working days plus weekend days actually worked. */
  span: number;
  /** Original daily quota recalculated for the current deadline. */
  quota: number;
  /** (completed + hold) ÷ span. */
  avgAll: number;
  /** completed ÷ span. */
  avgCompleted: number;
  /** Keyed by period day (1 = `periodStart`). */
  byDay: Record<number, DayCount>;
};

/**
 * Days are numbered from the period start: day 1 is `periodStart`, whatever
 * month it falls in. A month's sample is often still being studied weeks after
 * the month ends (owner, 2026-11-01), so the follow-up runs from the first
 * distribution to the last study — not the calendar month.
 */
export type Tracking = {
  /** The sample's month (1–12) and year — the deadline belongs to it. */
  year: number;
  month: number;
  /** Local midnight of day 1: the earliest assignment (or finished row). */
  periodStart: Date;
  /** Today while cases remain, else the latest finished row. */
  periodEnd: Date;
  /** Calendar days from `periodStart` to `periodEnd`, inclusive. */
  periodDays: number;
  /** Cells on the calendar: the period, stretched to reach the deadline when it is later. */
  calendarDays: number;
  /** Period day of the deadline, clamped to ≥ 1. A reference marker, not the window boundary. */
  deadlineDay: number;
  /** Last day with real data: today's period day, 0 before the period, `calendarDays` after it. */
  asOfDay: number;
  /** Empty cells before day 1 in a Saturday-first grid. */
  leadBlanks: number;
  employees: EmployeeTracking[];
};

export type TrackingInput = {
  rows: readonly TrackingRow[];
  /** username → ISO time of their first `assigned` event (EmployeeQuota.assignedAt). */
  assignedAtByUser: Readonly<Record<string, string>>;
  year: number;
  month: number;
  deadline: Date;
  today: Date;
};

const DAY_MS = 86_400_000;
/** Guard against one corrupt timestamp stretching the calendar over years. */
const MAX_PERIOD_DAYS = 400;

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDay(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : midnight(d);
}

/** Period day of `date` relative to `start` (both local midnights); DST-safe. */
function ordinalOf(start: Date, date: Date): number {
  return Math.round((date.getTime() - start.getTime()) / DAY_MS) + 1;
}

/** The local calendar date of period day `day`. */
export function dateOfDay(t: Pick<Tracking, "periodStart">, day: number): Date {
  const s = t.periodStart;
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + day - 1);
}

function workingDaysBetween(t: Pick<Tracking, "periodStart">, fromDay: number, toDay: number): number {
  if (toDay < fromDay) return 0;
  return countWorkingDays(dateOfDay(t, fromDay), dateOfDay(t, toDay));
}

export function buildTracking(input: TrackingInput): Tracking {
  const { year, month } = input;
  const today = midnight(input.today);

  // Start: the earliest assignment, from the quota stamps or the rows' own
  // `assignedAt`. A finished row dated earlier still pulls the start back so
  // it lands on the calendar. With nothing at all, the sample month's day 1.
  let startMs = Infinity;
  let latestDoneMs = -Infinity;
  let anyPending = false;
  const consider = (d: Date | null) => {
    if (d && d.getTime() < startMs) startMs = d.getTime();
  };
  for (const iso of Object.values(input.assignedAtByUser)) consider(parseDay(iso));
  for (const row of input.rows) {
    consider(parseDay(row.assignedAt));
    if (row.state === "pending") {
      anyPending = true;
      continue;
    }
    const done = parseDay(row.doneAt);
    consider(done);
    if (done && done.getTime() > latestDoneMs) latestDoneMs = done.getTime();
  }
  let periodStart = Number.isFinite(startMs) ? new Date(startMs) : new Date(year, month - 1, 1);

  // End: today while cases remain; once all are finished, the last finish.
  let periodEnd = !anyPending && Number.isFinite(latestDoneMs) ? new Date(latestDoneMs) : today;
  if (periodEnd.getTime() < periodStart.getTime()) periodEnd = periodStart;
  if (ordinalOf(periodStart, periodEnd) > MAX_PERIOD_DAYS) {
    periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate() - MAX_PERIOD_DAYS + 1);
  }
  const periodDays = ordinalOf(periodStart, periodEnd);
  const deadlineDay = Math.max(1, ordinalOf(periodStart, midnight(input.deadline)));
  const calendarDays = Math.min(MAX_PERIOD_DAYS, Math.max(periodDays, deadlineDay));
  const todayDay = ordinalOf(periodStart, today);
  // 0 before the period starts, so nothing counts as elapsed.
  const asOfDay = todayDay < 1 ? 0 : Math.min(todayDay, calendarDays);
  const frame = { periodStart };

  const byUser = new Map<string, EmployeeTracking>();
  const ensure = (username: string): EmployeeTracking => {
    let e = byUser.get(username);
    if (!e) {
      const assignedAt = parseDay(input.assignedAtByUser[username]);
      const startDay = assignedAt
        ? Math.min(calendarDays, Math.max(1, ordinalOf(periodStart, assignedAt)))
        : 1;
      e = {
        username, assigned: 0, completed: 0, hold: 0, unplaced: 0, startDay,
        span: 0, quota: 0, avgAll: 0, avgCompleted: 0, byDay: {},
      };
      byUser.set(username, e);
    }
    return e;
  };

  for (const row of input.rows) {
    const e = ensure(row.assignedTo);
    e.assigned += 1;
    if (row.state === "pending") continue;
    if (row.state === "completed") e.completed += 1;
    else e.hold += 1;
    const done = parseDay(row.doneAt);
    const day = done ? ordinalOf(periodStart, done) : 0;
    if (day < 1 || day > calendarDays) {
      e.unplaced += 1;
      continue;
    }
    const bucket = (e.byDay[day] ??= { completed: 0, hold: 0 });
    if (row.state === "completed") bucket.completed += 1;
    else bucket.hold += 1;
  }

  const employees = [...byUser.values()].sort((a, b) => a.username.localeCompare(b.username, "ar"));
  for (const e of employees) {
    const window = Math.max(1, workingDaysBetween(frame, e.startDay, deadlineDay));
    e.quota = e.assigned > 0 ? Math.ceil(e.assigned / window) : 0;
    // The span runs over the whole period, past the deadline: work done after
    // it is still work. Employees do work Friday/Saturday; a weekend day they
    // actually worked counts, or the extra output would inflate their average.
    const spanEnd = Math.min(asOfDay, periodDays);
    let weekendWorked = 0;
    for (const [d, c] of Object.entries(e.byDay)) {
      const day = Number(d);
      if (day >= e.startDay && day <= spanEnd && !isWorkingDay(dateOfDay(frame, day)) && c.completed + c.hold > 0) {
        weekendWorked += 1;
      }
    }
    e.span = workingDaysBetween(frame, e.startDay, spanEnd) + weekendWorked;
    e.avgAll = e.span > 0 ? (e.completed + e.hold) / e.span : 0;
    e.avgCompleted = e.span > 0 ? e.completed / e.span : 0;
  }

  return {
    year, month, periodStart, periodEnd, periodDays, calendarDays, deadlineDay, asOfDay,
    leadBlanks: (periodStart.getDay() + 1) % 7,
    employees,
  };
}

/** Whether period day `day` is on the work calendar (Sunday–Thursday). */
export function isWorkDay(t: Pick<Tracking, "periodStart">, day: number): boolean {
  return isWorkingDay(dateOfDay(t, day));
}

/** An employee's quota target on `day`: their quota on a working day inside their window, else 0. */
export function quotaOnDay(t: Tracking, e: EmployeeTracking, day: number): number {
  return isWorkDay(t, day) && day >= e.startDay && day <= t.deadlineDay ? e.quota : 0;
}

export type DayTotals = { completed: number; hold: number; target: number };

/** Team (or one-employee) totals for a single day. */
export function dayTotals(t: Tracking, employees: readonly EmployeeTracking[], day: number): DayTotals {
  let completed = 0;
  let hold = 0;
  let target = 0;
  for (const e of employees) {
    const c = e.byDay[day];
    completed += c?.completed ?? 0;
    hold += c?.hold ?? 0;
    target += quotaOnDay(t, e, day);
  }
  return { completed, hold, target };
}

export type MonthTotals = {
  assigned: number;
  completed: number;
  hold: number;
  remaining: number;
  quota: number;
  /** Working days from the as-of day to the deadline, inclusive; 0 once past. */
  daysLeft: number;
};

export function monthTotals(t: Tracking, employees: readonly EmployeeTracking[]): MonthTotals {
  let assigned = 0;
  let completed = 0;
  let hold = 0;
  let quota = 0;
  for (const e of employees) {
    assigned += e.assigned;
    completed += e.completed;
    hold += e.hold;
    quota += e.quota;
  }
  let daysLeft: number;
  if (t.asOfDay === 0) daysLeft = workingDaysBetween(t, 1, t.deadlineDay);
  else if (t.asOfDay > t.deadlineDay) daysLeft = 0;
  else daysLeft = workingDaysBetween(t, t.asOfDay, t.deadlineDay);
  return { assigned, completed, hold, quota, remaining: assigned - completed - hold, daysLeft };
}

/** Finished (مكتملة + معلقة) rows dated on or before `day`, for «remaining at end of day». */
export function finishedThroughDay(employees: readonly EmployeeTracking[], day: number): number {
  let n = 0;
  for (const e of employees) {
    for (const [d, c] of Object.entries(e.byDay)) {
      if (Number(d) <= day) n += c.completed + c.hold;
    }
  }
  return n;
}
