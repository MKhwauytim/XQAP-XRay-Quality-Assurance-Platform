const AR_LOCALE = "ar-SA-u-nu-latn";

export function formatNumber(value: number): string {
  return value.toLocaleString(AR_LOCALE);
}

export function formatDateTime(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(AR_LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * ISO `YYYY-MM-DD HH:mm:ss` (the instant's own UTC digits) for spreadsheet
 * exports. Unlike `formatDateTime` (locale text: dd/mm order, RLM marks, ص/م,
 * possibly a Hijri calendar) this sorts and filters correctly in Excel, and it
 * does not vary with the ICU build or the machine's timezone. One helper for
 * every export (error log, feedback).
 */
export function formatExportTimestamp(value: string | null | undefined): string {
  return value ? value.slice(0, 19).replace("T", " ") : "";
}
