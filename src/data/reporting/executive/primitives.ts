// Pure HTML render helpers for executive report pages.
// Returns HTML strings only — no React, no imports from theme.ts, no side effects.
// All CSS classes use the .xr- prefix from theme.ts.

/**
 * The single hardened HTML-escaping primitive for the whole reporting layer
 * (audit C-08). Encodes `& < > " '` — the full set needed to neutralise both
 * element- and attribute-context injection (a lone `'` can break out of a
 * single-quoted attribute). The charts' `escText` delegates here so every
 * builder shares one strictness level.
 */
export function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtNum(n: number): string {
  return n.toLocaleString("ar-SA-u-nu-latn");
}

export function fmtPct(n: number | null, digits = 1): string {
  if (n === null) return "—";
  return n.toFixed(digits) + "%";
}

type KpiCardOpts = { label: string; value: string; sub?: string; tone?: "good" | "warn" | "risk" | "accent" | "" };
export function kpiCard({ label, value, sub, tone = "" }: KpiCardOpts): string {
  return `<div class="xr-kpi${tone ? " " + tone : ""}">
    <div class="xr-kpi-label">${esc(label)}</div>
    <div class="xr-kpi-value">${esc(value)}</div>
    ${sub ? `<div class="xr-kpi-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

type TableOpts = { headers: string[]; rows: (string | number | null)[][]; totalRow?: (string | number | null)[] };
export function dataTable({ headers, rows, totalRow }: TableOpts): string {
  const th = headers.map(h => `<th>${esc(String(h))}</th>`).join("");
  const trs = rows.map(r =>
    `<tr>${r.map(c => `<td>${c === null ? '<span class="insuff">—</span>' : esc(String(c))}</td>`).join("")}</tr>`
  ).join("");
  const tot = totalRow
    ? `<tr class="total-row">${totalRow.map(c => `<td>${c === null ? "" : esc(String(c))}</td>`).join("")}</tr>`
    : "";
  return `<div class="xr-table-wrap"><table class="xr-table"><thead><tr>${th}</tr></thead><tbody>${trs}${tot}</tbody></table></div>`;
}
