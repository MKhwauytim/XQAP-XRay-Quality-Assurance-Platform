import { formatDateTime as formatDateTimeShared } from "../../../../utils/formatting";

const AR_LOCALE = "ar-SA-u-nu-latn";

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toLocaleString(AR_LOCALE)}س ${minutes.toLocaleString(AR_LOCALE)}د`;
}

/** Thin wrapper over the shared formatter with UserManagement's own null-fallback copy. */
export function formatDateTime(value: string | null): string {
  return formatDateTimeShared(value, "لم يسجل خروج");
}

/** `Intl` inserts an Arabic list-comma ("،") between weekday and day/month; the تقييم الأداء day labels read better without it. */
function stripListComma(value: string): string {
  return value.replace(/[،,]\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** Full day label for the gaps log — day of week + day + month, never a full datetime (day-only, per the تقييم الأداء rework). */
export function formatDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return stripListComma(date.toLocaleDateString(AR_LOCALE, { weekday: "long", day: "numeric", month: "long" }));
}

/** Short day label (weekday + day, no month) for the per-day working-hours strip rows. */
export function formatShortDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return stripListComma(date.toLocaleDateString(AR_LOCALE, { weekday: "long", day: "numeric" }));
}

/** Time-only (HH:MM, 24h) for the gaps log and working-hours chips — never a full datetime. */
export function formatTimeOfDay(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(AR_LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "H:MM" clock label (no leading zero on the hour) for the fixed shift-window axis ticks, e.g. "7:30". */
export function formatClock(minutesSinceMidnight: number): string {
  const hours = Math.floor(minutesSinceMidnight / 60);
  const minutes = minutesSinceMidnight % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/** One decimal place, Latin numerals — for the trend chart's daily-average badge. */
export function formatOneDecimal(value: number): string {
  return value.toLocaleString(AR_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
