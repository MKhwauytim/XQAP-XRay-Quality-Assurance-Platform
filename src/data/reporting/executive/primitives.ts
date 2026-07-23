// Pure HTML render helpers for executive report pages.
// Returns HTML strings only — no React, no imports from theme.ts, no side effects.
// All CSS classes use the .xr- prefix from theme.ts.

/**
 * The single hardened HTML-escaping primitive for the whole reporting layer
 * (audit C-08). Encodes `& < > " '` — the full set needed to neutralise both
 * element- and attribute-context injection (a lone `'` can break out of a
 * single-quoted attribute). `htmlReport.escHtml` and the charts' `escText`
 * delegate here so every builder shares one strictness level.
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

type BarRowOpts = { label: string; value: number | null; max: number; tone?: "good" | "risk" | "blue" | "" };
export function barRow({ label, value, max, tone = "" }: BarRowOpts): string {
  const pct = (value === null || max === 0) ? 0 : Math.min(100, (value / max) * 100);
  return `<div class="xr-bar-row">
    <span>${esc(label)}</span>
    <div class="xr-bar-track"><div class="xr-bar-fill${tone ? " " + tone : ""}" style="width:${pct.toFixed(1)}%"></div></div>
    <b>${value === null ? "—" : fmtPct(value)}</b>
  </div>`;
}

export function badgeHtml(status: "excellent" | "stable" | "monitor" | "priority" | "insufficient" | string): string {
  const labels: Record<string, string> = {
    excellent: "ممتاز", stable: "مستقر", monitor: "متابعة", priority: "أولوية", insufficient: "بيانات غير كافية",
  };
  const CSS_CLASS: Record<string, string> = {
    excellent: "excellent",
    stable: "stable",
    monitor: "monitor",
    priority: "priority",
    insufficient: "insufficient",
  };
  return `<span class="xr-badge ${CSS_CLASS[status] ?? "insufficient"}">${esc(labels[status] ?? status)}</span>`;
}

export function heatCell(pct: number | null): string {
  if (pct === null) return `<span class="xr-heat-cell xr-heat-insuff">—</span>`;
  const cls = pct >= 90 ? "xr-heat-high" : pct >= 75 ? "xr-heat-mid" : "xr-heat-low";
  return `<span class="xr-heat-cell ${cls}">${fmtPct(pct)}</span>`;
}

export function statPill({ label, value }: { label: string; value: string }): string {
  return `<div class="xr-stat-pill"><span class="xr-stat-pill-label">${esc(label)}</span><b class="xr-stat-pill-value">${esc(value)}</b></div>`;
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

export function noticeBox(text: string): string {
  return `<div class="xr-notice">${esc(text)}</div>`;
}

export function pagePanel(title: string, body: string): string {
  return `<div class="xr-panel"><div class="xr-panel-title">${esc(title)}</div>${body}</div>`;
}
