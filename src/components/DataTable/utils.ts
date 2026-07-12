// Shared utilities extracted from DataTable/index.tsx to avoid fast-refresh boundary pollution.
// Import from here instead of from the index when you only need these utilities (not the component).

// ── Filter types ──────────────────────────────────────────────────────────────

export type TextFilter        = { kind: "text";        value: string };
export type DateFilter        = { kind: "date";        mode: "single" | "range"; single: string; from: string; to: string };
export type StatusFilter      = { kind: "status";      value: string };
export type MultiSelectFilter = { kind: "multiselect"; values: string[] };
export type AnyFilter    = TextFilter | DateFilter | StatusFilter | MultiSelectFilter;
export type FiltersMap   = Record<string, AnyFilter>;

// ── Date utilities ────────────────────────────────────────────────────────────

export type DateFormatMode = "date" | "time" | "month" | "datetime";

export const DATE_FORMAT_LABELS: Record<DateFormatMode, string> = {
  date:     "التاريخ",
  time:     "الوقت",
  month:    "الشهر",
  datetime: "التاريخ والوقت",
};

const ISO_DATE_RE  = /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function looksLikeDate(v: string): boolean {
  return ISO_DATE_RE.test(v) || DATE_ONLY_RE.test(v);
}

// ── Numeric utilities ─────────────────────────────────────────────────────────

// Plain integers/decimals, optionally negative, optionally thousand-separated,
// optionally a trailing "%". Deliberately narrow — IDs, phone numbers, and
// codes that merely start with a digit must NOT match, or they'd be wrongly
// end-aligned and shown with tabular-nums as if they were a magnitude.
const NUMERIC_RE = /^-?\d{1,3}(,\d{3})*(\.\d+)?%?$|^-?\d+(\.\d+)?%?$/;

export function looksLikeNumber(v: string): boolean {
  return NUMERIC_RE.test(v.trim());
}

export function formatDate(raw: string, mode: DateFormatMode): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    if (mode === "date")  return d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
    if (mode === "time")  return d.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
    if (mode === "month") return d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long" });
    if (mode === "datetime") {
      const date = d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
      const time = d.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
      return `${date} ${time}`;
    }
  } catch { /**/ }
  return raw;
}

export function toIsoDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /**/ }
  return raw.slice(0, 10);
}

// ── Filter utilities ──────────────────────────────────────────────────────────

export function isFilterEmpty(f: AnyFilter): boolean {
  if (f.kind === "text")        return !f.value;
  if (f.kind === "status")      return f.value === "all" || !f.value;
  if (f.kind === "date")        return f.mode === "single" ? !f.single : (!f.from && !f.to);
  if (f.kind === "multiselect") return f.values.length === 0;
  return true;
}
