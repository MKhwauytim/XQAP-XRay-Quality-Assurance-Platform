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

export type ExportTimestampOptions = {
  /**
   * `"utc"` (default): the stored instant's own UTC digits. `"local"`: the
   * viewer's local time, matching what the app displays -- for exports whose
   * readers compare the file against the UI (the feedback export).
   */
  zone?: "local" | "utc";
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Sortable `YYYY-MM-DD HH:mm:ss` for spreadsheet exports. Unlike
 * `formatDateTime` (locale text: dd/mm order, RLM marks, ص/م, possibly a Hijri
 * calendar) this sorts and filters chronologically in Excel and does not vary
 * with the ICU build. One helper for every export (error log: UTC, feedback:
 * local); the `zone` option is what differs. A missing value is "", and in the
 * local zone an unparseable one is "" too.
 */
export function formatExportTimestamp(
  value: string | null | undefined,
  options: ExportTimestampOptions = {}
): string {
  if (!value) return "";
  if (options.zone !== "local") return value.slice(0, 19).replace("T", " ");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}
