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
};

export type DayCount = { completed: number; hold: number };

export type EmployeeTracking = {
  username: string;
  assigned: number;
  completed: number;
  hold: number;
  /** Finished rows whose date is unknown or outside the month (in totals, not on the calendar). */
  unplaced: number;
  /** Day of month the employee's count starts (assignment day, clamped into the month). */
  startDay: number;
  /** Working days from `startDay` to min(as-of day, deadline). */
  span: number;
  /** Original daily quota recalculated for the current deadline. */
  quota: number;
  /** (completed + hold) ÷ span. */
  avgAll: number;
  /** completed ÷ span. */
  avgCompleted: number;
  byDay: Record<number, DayCount>;
};

export type Tracking = {
  year: number;
  /** 1–12. */
  month: number;
  daysInMonth: number;
  /** Deadline clamped into the month. */
  deadlineDay: number;
  /** Last day with real data: today's day in the current month, 0 before it, the month end after it. */
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

function dateAt(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

export function workingDaysInMonth(year: number, month: number, fromDay: number, toDay: number): number {
  if (toDay < fromDay) return 0;
  return countWorkingDays(dateAt(year, month, fromDay), dateAt(year, month, toDay));
}

function clampDayIntoMonth(date: Date, year: number, month: number, daysInMonth: number): number {
  const monthStart = dateAt(year, month, 1).getTime();
  const monthEnd = dateAt(year, month, daysInMonth).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (day < monthStart) return 1;
  if (day > monthEnd) return daysInMonth;
  return date.getDate();
}

function dayInMonth(iso: string | null, year: number, month: number): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear() === year && d.getMonth() === month - 1 ? d.getDate() : null;
}

export function buildTracking(input: TrackingInput): Tracking {
  const { year, month } = input;
  const daysInMonth = new Date(year, month, 0).getDate();
  const deadlineDay = clampDayIntoMonth(input.deadline, year, month, daysInMonth);
  const todayMs = new Date(input.today.getFullYear(), input.today.getMonth(), input.today.getDate()).getTime();
  // 0 when the month has not started yet, so nothing counts as elapsed.
  const asOfDay = todayMs < dateAt(year, month, 1).getTime()
    ? 0
    : clampDayIntoMonth(input.today, year, month, daysInMonth);

  const byUser = new Map<string, EmployeeTracking>();
  const ensure = (username: string): EmployeeTracking => {
    let e = byUser.get(username);
    if (!e) {
      const assignedAt = input.assignedAtByUser[username];
      const parsed = assignedAt ? new Date(assignedAt) : null;
      const startDay = parsed && !Number.isNaN(parsed.getTime())
        ? clampDayIntoMonth(parsed, year, month, daysInMonth)
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
    const day = dayInMonth(row.doneAt, year, month);
    if (day === null) {
      e.unplaced += 1;
      continue;
    }
    const bucket = (e.byDay[day] ??= { completed: 0, hold: 0 });
    if (row.state === "completed") bucket.completed += 1;
    else bucket.hold += 1;
  }

  const employees = [...byUser.values()].sort((a, b) => a.username.localeCompare(b.username, "ar"));
  for (const e of employees) {
    const window = Math.max(1, workingDaysInMonth(year, month, e.startDay, deadlineDay));
    e.quota = e.assigned > 0 ? Math.ceil(e.assigned / window) : 0;
    // Employees do work Friday/Saturday. A weekend day they actually worked is
    // a day worked, so it counts in the span — otherwise the extra output would
    // be divided by working days only and inflate their average.
    const spanEnd = Math.min(asOfDay, deadlineDay);
    let weekendWorked = 0;
    for (const [d, c] of Object.entries(e.byDay)) {
      const day = Number(d);
      if (day >= e.startDay && day <= spanEnd && !isWorkingDay(dateAt(year, month, day)) && c.completed + c.hold > 0) {
        weekendWorked += 1;
      }
    }
    e.span = workingDaysInMonth(year, month, e.startDay, spanEnd) + weekendWorked;
    e.avgAll = e.span > 0 ? (e.completed + e.hold) / e.span : 0;
    e.avgCompleted = e.span > 0 ? e.completed / e.span : 0;
  }

  return {
    year, month, daysInMonth, deadlineDay, asOfDay,
    leadBlanks: (dateAt(year, month, 1).getDay() + 1) % 7,
    employees,
  };
}

/** Whether `day` is on the work calendar (Sunday–Thursday). */
export function isWorkDay(t: Pick<Tracking, "year" | "month">, day: number): boolean {
  return isWorkingDay(dateAt(t.year, t.month, day));
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
  if (t.asOfDay === 0) daysLeft = workingDaysInMonth(t.year, t.month, 1, t.deadlineDay);
  else if (t.asOfDay > t.deadlineDay) daysLeft = 0;
  else daysLeft = workingDaysInMonth(t.year, t.month, t.asOfDay, t.deadlineDay);
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
