// Working-day arithmetic for «الحصة اليومية» (C3, 2026-09-28 corrective plan).
// The weekend is Friday and Saturday; every other day (Sunday–Thursday) is a
// working day. No holiday calendar (out of scope by owner decision). All
// arithmetic is on LOCAL calendar days, matching how the quota deadline itself
// is built (`new Date(year, month - 1, lastDay - 3)` in distributionDerivation.ts).

/**
 * The default quota deadline for a sample month: its last day − 3, local time.
 * Single source for distribution (`computeWorkingDaysForDeadline`) and the
 * results tracking tab, whose admin override is stored separately.
 * `month` is 1–12.
 */
export function defaultQuotaDeadline(year: number, month: number): Date {
  const lastDay = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, lastDay - 3);
}

/** `Date#getDay()` values of the weekend: Friday (5) and Saturday (6). */
export const WEEKEND_DAYS: ReadonlySet<number> = new Set([5, 6]);

export function isWorkingDay(date: Date): boolean {
  return !WEEKEND_DAYS.has(date.getDay());
}

/**
 * Working days from `start`'s calendar day through `deadline`'s calendar day,
 * BOTH inclusive; the time of day is ignored. 0 when `start` falls after
 * `deadline`, or when either date is invalid.
 */
export function countWorkingDays(start: Date, deadline: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(deadline.getTime())) return 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const end = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  let count = 0;
  while (cursor.getTime() <= end.getTime()) {
    if (isWorkingDay(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
