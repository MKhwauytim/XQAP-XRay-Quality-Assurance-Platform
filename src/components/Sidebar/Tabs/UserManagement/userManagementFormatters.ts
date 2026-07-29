import { formatDateTime as formatDateTimeShared } from "../../../../utils/formatting";

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toLocaleString("ar-SA-u-nu-latn")}س ${minutes.toLocaleString("ar-SA-u-nu-latn")}د`;
}

/** Thin wrapper over the shared formatter with UserManagement's own null-fallback copy. */
export function formatDateTime(value: string | null): string {
  return formatDateTimeShared(value, "لم يسجل خروج");
}
