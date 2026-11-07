// Daily work report (تقرير العمل اليومي) — pure model, no I/O.
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

export type DailyWorkReport = {
  /** Local calendar day the report covers. */
  day: Date;
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

function isSameLocalDay(iso: string | null, day: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
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

export function buildDailyWorkReport(input: {
  months: readonly DailyWorkMonthInput[];
  day: Date;
  names: Readonly<Record<string, string>>;
}): DailyWorkReport {
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
        if (isSameLocalDay(row.doneAt, input.day)) emp.completedOnDay += 1;
      } else if (row.state === "hold") {
        emp.holdTotal += 1;
        if (isSameLocalDay(row.doneAt, input.day)) emp.holdOnDay += 1;
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
  return { day: input.day, months, totals: grand };
}
