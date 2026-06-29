// Pure HTML render helpers for executive report pages.
// Returns HTML strings only — no React, no imports from theme.ts, no side effects.
// All CSS classes use the .xr- prefix from theme.ts.

export function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  return `<span class="xr-badge ${esc(status)}">${esc(labels[status] ?? status)}</span>`;
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

/** Minimal inline SVG radar for up to 6 axes. values 0–100. */
export function radarSvg(points: { label: string; value: number }[]): string {
  const n = points.length;
  if (n < 3) return "";
  const cx = 150, cy = 130, r = 100;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, scale: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r * scale, cy + Math.sin(a) * r * scale];
  };
  const rings = [0.25, 0.5, 0.75, 1].map(s =>
    `<polygon points="${points.map((_, i) => pt(i, s).join(",")).join(" ")}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`
  ).join("");
  const axes = points.map((_, i) => {
    const [x, y] = pt(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`;
  }).join("");
  const dataPath = points.map((p, i) => {
    const [x, y] = pt(i, p.value / 100);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + "Z";
  const labels = points.map((p, i) => {
    const [x, y] = pt(i, 1.22);
    const anchor = x < cx - 5 ? "end" : x > cx + 5 ? "start" : "middle";
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="9" fill="#7a9bb5" font-family="Somar,Arial">${esc(p.label)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 300 260" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    ${rings}${axes}
    <path d="${dataPath}" fill="rgba(227,160,0,0.18)" stroke="#e3a000" stroke-width="2"/>
    ${points.map((p, i) => { const [x,y] = pt(i, p.value/100); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#e3a000"/>`; }).join("")}
    ${labels}
  </svg>`;
}
