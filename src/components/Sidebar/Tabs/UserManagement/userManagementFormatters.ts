export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toLocaleString("ar-SA-u-nu-latn")}س ${minutes.toLocaleString("ar-SA-u-nu-latn")}د`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "لم يسجل خروج";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ar-SA-u-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
