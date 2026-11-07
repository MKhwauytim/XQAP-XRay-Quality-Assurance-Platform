// Daily and weekly work report (تقرير العمل اليومي / الأسبوعي) — pure model, no I/O.
//
// One table per distributed month, one row per employee: what they finished on
// the report day, and where their share of that month stands overall. Every
// figure comes from the same TrackingRow rule the results page's tracking tab
// uses (`classifyAnswerState` / `trackingDoneAt` in deadlineTracking.ts):
//   مفحوصة  — state "completed"
//   مؤرشفة  — state "hold" (a submitted «هل يوجد صورة = لا»)
//   متبقية  — state "pending" (not examined yet, or still a draft)
import type { TrackingRow } from "../../tracking/deadlineTracking";
import { isWorkingDay } from "../../../utils/workingDays";

export type DailyWorkMonthInput = {
  folderName: string;
  label: string;
  rows: readonly TrackingRow[];
};

export type DailyWorkEmployee = {
  username: string;
  name: string;
  assigned: number;
  completedOnDay: number;
  holdOnDay: number;
  completedTotal: number;
  holdTotal: number;
  remaining: number;
};

export type DailyWorkTotals = Omit<DailyWorkEmployee, "username" | "name">;

export type DailyWorkMonth = {
  folderName: string;
  label: string;
  employees: DailyWorkEmployee[];
  totals: DailyWorkTotals;
};

/**
 * "day": one calendar day; "week": a Sunday–Saturday week; "month": one calendar month;
 * "range": any first and last day the user picks. Weekends are included everywhere because the
 * team sometimes works on Friday and Saturday.
 */
export type DailyWorkKind = "day" | "week" | "month" | "range";

export type DailyWorkReport = {
  kind: DailyWorkKind;
  /** First local calendar day the report covers. */
  day: Date;
  /** Last local calendar day the report covers (same as `day` for a daily report). */
  until: Date;
  months: DailyWorkMonth[];
  totals: DailyWorkTotals;
};

function emptyTotals(): DailyWorkTotals {
  return { assigned: 0, completedOnDay: 0, holdOnDay: 0, completedTotal: 0, holdTotal: 0, remaining: 0 };
}

function addInto(target: DailyWorkTotals, src: DailyWorkTotals): void {
  target.assigned += src.assigned;
  target.completedOnDay += src.completedOnDay;
  target.holdOnDay += src.holdOnDay;
  target.completedTotal += src.completedTotal;
  target.holdTotal += src.holdTotal;
  target.remaining += src.remaining;
}

const dayKey = (d: Date): number => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();

/** True when `iso` falls on a local calendar day from `from` to `until`, both included. */
function isWithinLocalDays(iso: string | null, from: Date, until: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const k = dayKey(d);
  return k >= dayKey(from) && k <= dayKey(until);
}

/**
 * The working day before `today` (Sunday–Thursday week): on Sunday this is the
 * previous Thursday, so the Sunday email reports Thursday's work.
 */
export function previousWorkingDay(today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  do {
    d.setDate(d.getDate() - 1);
  } while (!isWorkingDay(d));
  return d;
}

/** The calendar day before `today`, weekend days included. */
export function previousDay(today: Date): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
}

/** The Sunday–Saturday week that contains `d`. */
export function weekOf(d: Date): { from: Date; until: Date } {
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  return { from, until: new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6) };
}

/**
 * The last full Sunday–Saturday week before `today`. On a Sunday this is the week that just ended;
 * mid-week it is still the previous week, so a weekly report never covers a week that is not over.
 */
export function previousWeek(today: Date): { from: Date; until: Date } {
  return weekOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - 1));
}

/** The calendar month that contains `d`: its first and last day. */
export function monthOf(d: Date): { from: Date; until: Date } {
  return { from: new Date(d.getFullYear(), d.getMonth(), 1), until: new Date(d.getFullYear(), d.getMonth() + 1, 0) };
}

/** The calendar month before the one that contains `today`. */
export function previousMonth(today: Date): { from: Date; until: Date } {
  return monthOf(new Date(today.getFullYear(), today.getMonth() - 1, 1));
}

export function buildDailyWorkReport(input: {
  months: readonly DailyWorkMonthInput[];
  /** First day of the period. */
  day: Date;
  /** Last day of the period; left out for a one-day report. */
  until?: Date;
  /** Defaults to "day" without `until` and "range" with it. */
  kind?: DailyWorkKind;
  names: Readonly<Record<string, string>>;
}): DailyWorkReport {
  const until = input.until ?? input.day;
  const months: DailyWorkMonth[] = [];
  const grand = emptyTotals();
  for (const month of input.months) {
    if (month.rows.length === 0) continue;
    const byUser = new Map<string, DailyWorkEmployee>();
    for (const row of month.rows) {
      let emp = byUser.get(row.assignedTo);
      if (!emp) {
        emp = { username: row.assignedTo, name: input.names[row.assignedTo] || row.assignedTo, ...emptyTotals() };
        byUser.set(row.assignedTo, emp);
      }
      emp.assigned += 1;
      if (row.state === "completed") {
        emp.completedTotal += 1;
        if (isWithinLocalDays(row.doneAt, input.day, until)) emp.completedOnDay += 1;
      } else if (row.state === "hold") {
        emp.holdTotal += 1;
        if (isWithinLocalDays(row.doneAt, input.day, until)) emp.holdOnDay += 1;
      } else {
        emp.remaining += 1;
      }
    }
    const employees = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
    const totals = emptyTotals();
    for (const emp of employees) addInto(totals, emp);
    addInto(grand, totals);
    months.push({ folderName: month.folderName, label: month.label, employees, totals });
  }
  return { kind: input.kind ?? (input.until ? "range" : "day"), day: input.day, until, months, totals: grand };
}
