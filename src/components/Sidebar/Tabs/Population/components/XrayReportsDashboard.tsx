import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useLabels } from "../../../../../data/labels/useLabels";
import {
  listMonthFolders,
  loadBrowseRows,
} from "../../../../../data/population/populationStorage";
import { loadPopulationConfig } from "../../../../../data/population/populationConfig";
import { loadOrDeriveDistributionCurrent } from "../../../../../data/distribution/distributionStorage";
import { loadSampleMaster } from "../../../../../data/sampling/sampleStorage";
import { parseMonthFolderName } from "../../../../../data/population/monthFolder";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { getStageKey } from "./helpers";

// ── constants ─────────────────────────────────────────────────────────────────
const C = {
  primary:   "#17365d",
  secondary: "#2563eb",
  success:   "#059669",
  warning:   "#d97706",
  danger:    "#dc2626",
  purple:    "#7c3aed",
  teal:      "#0d9488",
  muted:     "#94a3b8",
};

const STAGE_COLORS: Record<string, string> = {
  first:  "#17365d",
  second: "#2563eb",
  third:  "#7c3aed",
  fourth: "#0d9488",
};
const STAGE_LABELS: Record<string, string> = {
  first:  "المستوى الأول",
  second: "المستوى الثاني",
  third:  "المستوى الثالث",
  fourth: "المستوى الرابع",
};
const STAGE_KEYS = ["first", "second", "third", "fourth"] as const;
const MONTH_NAMES_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const WEEKDAY_AR = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

function fmt(folder: string): string {
  const info = parseMonthFolderName(folder);
  return info ? `${MONTH_NAMES_AR[info.month - 1]} ${info.year}` : folder;
}

// ── types ─────────────────────────────────────────────────────────────────────
type DayCount = { date: string; count: number }; // date = "YYYY-MM-DD"

type MonthAgg = {
  folder:       string;
  label:        string;
  population:   number;
  certScan:     number;
  nonCertScan:  number;
  sample:       number;
  sampleCert:   number;
  sampleNonCert:number;
  assigned:     number;
  completed:    number;
  pending:      number;
  replaced:     number;
  completionPct:number;
  byStage:      Record<string, { pop: number; sample: number; completed: number }>;
  byPort:       Record<string, { pop: number; sample: number }>;
  dayCounts:    DayCount[];
};

// ── data loader ───────────────────────────────────────────────────────────────
function parseEntryDate(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // Try ISO / dd/mm/yyyy / mm/dd/yyyy / dd-mm-yyyy / Excel serial
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
  // Excel serial (days since 1900-01-01, with Lotus 1900 bug)
  const serial = parseInt(s, 10);
  if (!isNaN(serial) && serial > 10000 && serial < 60000) {
    const d = new Date(Date.UTC(1900, 0, serial - 1));
    return d.toISOString().slice(0, 10);
  }
  return null;
}

async function loadAllMonthData(dir: DirectoryHandleLike): Promise<MonthAgg[]> {
  const months = await listMonthFolders(dir);
  const config = await loadPopulationConfig(dir);
  const results: MonthAgg[] = [];

  // Load all population rows once, group by month to avoid O(n²) file reads
  const allPopRows = await loadBrowseRows(dir, "population");
  const rowsByMonth = new Map<string, typeof allPopRows>();
  for (const row of allPopRows) {
    const arr = rowsByMonth.get(row._monthFolder) ?? [];
    arr.push(row);
    rowsByMonth.set(row._monthFolder, arr);
  }

  for (const month of months) {
    const sampleMaster = await loadSampleMaster(dir, month.folderName).catch(() => null);
    const distCurrent = sampleMaster
      ? await loadOrDeriveDistributionCurrent(dir, month.folderName, sampleMaster.rows).catch(() => null)
      : null;

    const popRows = rowsByMonth.get(month.folderName) ?? [];

    const certScan    = popRows.filter((r) => String(r.certScanStatus ?? "").toLowerCase().includes("cert") && !String(r.certScanStatus ?? "").toLowerCase().includes("non")).length;
    const nonCertScan = popRows.length - certScan;

    const sample      = sampleMaster?.totalActual      ?? 0;
    const sampleCert  = sampleMaster?.certScanActual   ?? 0;
    const sampleNonCert = sampleMaster?.nonCertScanActual ?? 0;

    const assigned  = distCurrent?.totalAssigned  ?? 0;
    const completed = distCurrent?.totalCompleted ?? 0;
    const pending   = distCurrent?.totalPending   ?? 0;
    const replaced  = distCurrent?.totalReplaced  ?? 0;

    // by stage (population)
    const byStage: MonthAgg["byStage"] = {};
    for (const row of popRows) {
      const sk = getStageKey(String(row.stage ?? ""), config.stageMappings);
      if (sk === "unknown") continue;
      if (!byStage[sk]) byStage[sk] = { pop: 0, sample: 0, completed: 0 };
      byStage[sk].pop++;
    }
    if (sampleMaster) {
      for (const row of sampleMaster.rows) {
        const sk = getStageKey(String(row.stage ?? ""), config.stageMappings);
        if (sk === "unknown") continue;
        if (!byStage[sk]) byStage[sk] = { pop: 0, sample: 0, completed: 0 };
        byStage[sk].sample++;
      }
    }
    if (distCurrent) {
      for (const entry of distCurrent.entries) {
        if (entry.status !== "completed") continue;
        const sk = getStageKey(String(entry.row.stage ?? ""), config.stageMappings);
        if (sk === "unknown") continue;
        if (!byStage[sk]) byStage[sk] = { pop: 0, sample: 0, completed: 0 };
        byStage[sk].completed++;
      }
    }

    // by port
    const byPort: MonthAgg["byPort"] = {};
    for (const row of popRows) {
      const port = String(row.portName ?? "غير محدد");
      if (!byPort[port]) byPort[port] = { pop: 0, sample: 0 };
      byPort[port].pop++;
    }
    if (sampleMaster) {
      for (const alloc of sampleMaster.portAllocations) {
        if (!byPort[alloc.portName]) byPort[alloc.portName] = { pop: 0, sample: 0 };
        byPort[alloc.portName].sample += alloc.actualTotalDrawn;
      }
    }

    // day counts (for calendar heatmap)
    const dayMap: Record<string, number> = {};
    for (const row of popRows) {
      const d = parseEntryDate(row.xrayEntryDate);
      if (!d) continue;
      dayMap[d] = (dayMap[d] ?? 0) + 1;
    }
    const dayCounts: DayCount[] = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

    results.push({
      folder: month.folderName,
      label:  fmt(month.folderName),
      population: popRows.length,
      certScan, nonCertScan,
      sample, sampleCert, sampleNonCert,
      assigned, completed, pending, replaced,
      completionPct: assigned > 0 ? Math.round((completed / assigned) * 100) : 0,
      byStage, byPort, dayCounts,
    });
  }

  return results.sort((a, b) => a.folder.localeCompare(b.folder));
}

// ── shared small components ────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = C.primary }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="xrpt-kpi-card">
      <span className="xrpt-kpi-label">{label}</span>
      <strong className="xrpt-kpi-value" style={{ color }}>
        {typeof value === "number" ? value.toLocaleString("ar-SA-u-nu-latn") : value}
      </strong>
      {sub && <span className="xrpt-kpi-sub">{sub}</span>}
    </div>
  );
}

function ArabicTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="xrpt-tooltip">
      <p className="xrpt-tooltip-title">{label}</p>
      {payload.map((e: any, i: number) => (
        <p key={i} style={{ color: e.color, margin: "2px 0", fontSize: 12 }}>
          {e.name}: <strong>{Number(e.value).toLocaleString("ar-SA-u-nu-latn")}</strong>
        </p>
      ))}
    </div>
  );
}

function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="xrpt-section">
      <h2 className="xrpt-section-title">{title}</h2>
      {children}
    </section>
  );
}

function numFmt(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

// ── Calendar Heatmap ──────────────────────────────────────────────────────────
function CalendarHeatmap({ dayCounts, year, month }: {
  dayCounts: DayCount[];
  year: number;
  month: number; // 1-based
}) {
  const dayMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const { date, count } of dayCounts) {
      const info = parseMonthFolderName(`${month}-x-${year}`) ?? { month, year };
      if (date.startsWith(`${info.year ?? year}-${String(info.month ?? month).padStart(2,"0")}`)) {
        m[date] = count;
      }
      // also match any date in this year-month regardless
      if (date.startsWith(`${year}-${String(month).padStart(2,"0")}`)) {
        m[date] = count;
      }
    }
    return m;
  }, [dayCounts, year, month]);

  const maxCount = useMemo(() => Math.max(1, ...Object.values(dayMap)), [dayMap]);

  // Build calendar grid
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun

  const cells: Array<{ day: number | null; date: string; count: number }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: null, date: "", count: 0 });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    cells.push({ day: d, date, count: dayMap[date] ?? 0 });
  }

  function intensity(count: number): string {
    if (count === 0) return "#f1f5f9";
    const ratio = count / maxCount;
    if (ratio < 0.2) return "#bfdbfe";
    if (ratio < 0.4) return "#60a5fa";
    if (ratio < 0.6) return "#2563eb";
    if (ratio < 0.8) return "#1d4ed8";
    return "#1e3a8a";
  }

  return (
    <div className="xrpt-heatmap">
      <div className="xrpt-heatmap-weekdays">
        {WEEKDAY_AR.map((w) => <span key={w}>{w.slice(2, 4)}</span>)}
      </div>
      <div className="xrpt-heatmap-grid">
        {cells.map((cell, i) => (
          <div
            key={i}
            className={`xrpt-heatmap-cell${cell.day === null ? " empty" : ""}`}
            style={cell.day !== null ? { background: intensity(cell.count) } : undefined}
            title={cell.day !== null ? `${cell.date}: ${cell.count.toLocaleString("ar-SA-u-nu-latn")} سجل` : ""}
          >
            {cell.day !== null && (
              <span className="xrpt-heatmap-day">{String(cell.day)}</span>
            )}
            {cell.count > 0 && (
              <span className="xrpt-heatmap-count">{cell.count >= 1000 ? `${Math.round(cell.count / 1000)}k` : String(cell.count)}</span>
            )}
          </div>
        ))}
      </div>
      <div className="xrpt-heatmap-legend">
        <span>أقل</span>
        {["#f1f5f9","#bfdbfe","#60a5fa","#2563eb","#1d4ed8","#1e3a8a"].map((c) => (
          <span key={c} style={{ background: c, width: 14, height: 14, display: "inline-block", borderRadius: 2 }} />
        ))}
        <span>أكثر</span>
      </div>
    </div>
  );
}

// ── helpers for the HTML report ───────────────────────────────────────────────
function svgDonut(slices: { value: number; color: string; label: string }[], cx = 90, cy = 90, r = 64, strokeW = 22): string {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return `<svg width="180" height="180" viewBox="0 0 180 180"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="${strokeW}"/></svg>`;
  let offset = 0;
  const circumference = 2 * Math.PI * r;
  const paths = slices.map((sl) => {
    const pct = sl.value / total;
    const dash = pct * circumference;
    const gap  = circumference - dash;
    const rotate = offset * 360 - 90;
    offset += pct;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${sl.color}" stroke-width="${strokeW}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" transform="rotate(${rotate.toFixed(2)} ${cx} ${cy})" stroke-linecap="round"/>`;
  }).join("");
  const pct0 = total > 0 ? Math.round((slices[0]?.value ?? 0) / total * 100) : 0;
  return `<svg width="180" height="180" viewBox="0 0 180 180">${paths}<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="22" font-weight="700" fill="#17365d">${pct0}%</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="#667085">${slices[0]?.label ?? ""}</text></svg>`;
}

function svgHBar(entries: { name: string; value: number }[], maxVal: number, barH = 22, barGap = 6): string {
  const W = 480;
  const labelW = 130;
  const valW = 50;
  const barW = W - labelW - valW - 12;
  const rows = entries.map((e, i) => {
    const pct = maxVal > 0 ? e.value / maxVal : 0;
    const bw  = Math.max(4, pct * barW);
    const y   = i * (barH + barGap);
    const fill = i < 3 ? "#17365d" : i < 7 ? "#2563eb" : "#0d9488";
    return `<g transform="translate(0,${y})">
      <text x="${labelW - 6}" y="${barH * 0.7}" text-anchor="end" font-size="11" fill="#334155" dominant-baseline="auto">${e.name.length > 14 ? e.name.slice(0,13)+"…" : e.name}</text>
      <rect x="${labelW}" y="2" width="${bw.toFixed(1)}" height="${barH - 4}" rx="3" fill="${fill}"/>
      <text x="${labelW + bw + 6}" y="${barH * 0.7}" font-size="11" fill="#475467">${e.value.toLocaleString("ar-SA-u-nu-latn")}</text>
    </g>`;
  });
  const svgH = entries.length * (barH + barGap) + 4;
  return `<svg width="${W}" height="${svgH}" viewBox="0 0 ${W} ${svgH}" direction="rtl">${rows.join("")}</svg>`;
}

function buildHeatmapHtml(m: MonthAgg): string {
  const info = parseMonthFolderName(m.folder);
  if (!info) return "";
  const { year, month: mon } = info;
  const dayMap: Record<string, number> = {};
  for (const { date, count } of m.dayCounts) dayMap[date] = count;
  if (Object.keys(dayMap).length === 0) return `<p style="color:#94a3b8;font-size:12px;">لا توجد بيانات تاريخ دخول.</p>`;
  const maxC = Math.max(1, ...Object.values(dayMap));
  const daysInMonth = new Date(year, mon, 0).getDate();
  const firstDow    = new Date(year, mon - 1, 1).getDay();

  function heatColor(count: number) {
    if (count === 0) return "#f1f5f9";
    const r = count / maxC;
    if (r < 0.2) return "#bfdbfe"; if (r < 0.4) return "#60a5fa";
    if (r < 0.6) return "#2563eb"; if (r < 0.8) return "#1d4ed8";
    return "#1e3a8a";
  }

  const cells: string[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(`<div class="hc empty"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(mon).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const cnt  = dayMap[date] ?? 0;
    const cntStr = cnt >= 1000 ? `${Math.round(cnt / 1000)}k` : String(cnt);
    cells.push(`<div class="hc" style="background:${heatColor(cnt)}" title="${date}: ${cnt}">
      <span class="hd">${d}</span>${cnt > 0 ? `<span class="hcnt">${cntStr}</span>` : ""}
    </div>`);
  }
  return `<div class="cal-wrap"><div class="cal-wd"><span>أح</span><span>إث</span><span>ثل</span><span>أر</span><span>خم</span><span>جم</span><span>سب</span></div><div class="cal-grid">${cells.join("")}</div></div>`;
}

// ── PDF / Print export ────────────────────────────────────────────────────────
function buildPrintReport(_allData: MonthAgg[], filtered: MonthAgg[]): string {
  const totPop  = filtered.reduce((s, m) => s + m.population, 0);
  const totSamp = filtered.reduce((s, m) => s + m.sample, 0);
  const totComp = filtered.reduce((s, m) => s + m.completed, 0);
  const totAsgn = filtered.reduce((s, m) => s + m.assigned, 0);
  const totCert = filtered.reduce((s, m) => s + m.certScan, 0);
  const totNon  = filtered.reduce((s, m) => s + m.nonCertScan, 0);
  const totPend = filtered.reduce((s, m) => s + m.pending, 0);
  const totRepl = filtered.reduce((s, m) => s + m.replaced, 0);

  const portMap: Record<string, number> = {};
  const stageMap: Record<string, number> = {};
  for (const m of filtered) {
    for (const [p, v] of Object.entries(m.byPort))  portMap[p]  = (portMap[p]  ?? 0) + v.pop;
    for (const [s, v] of Object.entries(m.byStage)) stageMap[s] = (stageMap[s] ?? 0) + v.pop;
  }
  const topPorts = Object.entries(portMap).sort((a, b) => b[1] - a[1]);
  const maxPortVal = topPorts[0]?.[1] ?? 1;

  // SVG donuts
  const certDonut = svgDonut([
    { value: totCert, color: "#2563eb", label: "مركزية" },
    { value: totNon,  color: "#0d9488", label: "غير مركزية" },
  ]);
  const distDonut = svgDonut([
    { value: totComp, color: "#059669", label: "مدروسة"  },
    { value: totPend, color: "#d97706", label: "انتظار"  },
    { value: totRepl, color: "#94a3b8", label: "مستبدلة" },
  ]);

  const portBarSvg = svgHBar(topPorts.slice(0,15).map(([n,v]) => ({ name: n, value: v })), maxPortVal);

  const stageMaxVal = Math.max(1, ...STAGE_KEYS.map((sk) => stageMap[sk] ?? 0));
  const stageBarSvg = svgHBar(
    STAGE_KEYS.map((sk) => ({ name: STAGE_LABELS[sk], value: stageMap[sk] ?? 0 })),
    stageMaxVal
  );

  const completionPct = totAsgn > 0 ? Math.round((totComp / totAsgn) * 100) : 0;
  const sampleRate    = totPop  > 0 ? Math.round((totSamp  / totPop)  * 100) : 0;

  const monthRows = filtered.map((m) => {
    const pctBg = m.completionPct >= 80 ? "#d1fae5" : "#fef3c7";
    const pctFg = m.completionPct >= 80 ? "#065f46" : "#92400e";
    return `<tr>
      <td>${m.label}</td>
      <td>${m.population.toLocaleString("ar-SA-u-nu-latn")}</td>
      <td>${m.sample.toLocaleString("ar-SA-u-nu-latn")}</td>
      <td>${m.completed.toLocaleString("ar-SA-u-nu-latn")}</td>
      <td><span style="background:${pctBg};color:${pctFg};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700">${m.completionPct}%</span></td>
    </tr>`;
  }).join("");

  const portTableRows = topPorts.map(([name, count], i) => {
    const pct = totPop > 0 ? ((count / totPop) * 100).toFixed(1) : "0";
    return `<tr>
      <td style="color:#94a3b8;font-size:11px">${i + 1}</td>
      <td>${name}</td>
      <td>${count.toLocaleString("ar-SA-u-nu-latn")}</td>
      <td><div style="display:flex;align-items:center;gap:6px">
        <div style="height:6px;border-radius:3px;background:#17365d;width:${Math.max(4, (count/maxPortVal)*80).toFixed(1)}px"></div>
        <span>${pct}%</span>
      </div></td>
    </tr>`;
  }).join("");

  const stageTableRows = STAGE_KEYS.map((sk) => {
    const cnt = stageMap[sk] ?? 0;
    const pct = totPop > 0 ? ((cnt / totPop) * 100).toFixed(1) : "0";
    return `<tr>
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${STAGE_COLORS[sk]};margin-inline-end:6px"></span>${STAGE_LABELS[sk]}</td>
      <td>${cnt.toLocaleString("ar-SA-u-nu-latn")}</td>
      <td>${pct}%</td>
    </tr>`;
  }).join("");

  const heatmapSections = filtered.map((m) => {
    const html = buildHeatmapHtml(m);
    return `<div class="cal-block">
      <h4 class="cal-month-title">${m.label}</h4>
      ${html}
    </div>`;
  }).join("");

  const dateStr = new Date().toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>التقرير التنفيذي — بيانات جودة الأشعة</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#172033;background:#f8fafc;font-size:13px;direction:rtl}
.toolbar{background:#fff;border-bottom:1px solid #dce4ee;padding:12px 32px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
.toolbar h1{font-size:16px;font-weight:700;color:#17365d;flex:1}
.btn-print{padding:8px 20px;background:#17365d;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;font-weight:600;display:flex;align-items:center;gap:6px}
.btn-print:hover{background:#1e4d8a}
.content{max-width:1100px;margin:0 auto;padding:32px 24px}
/* Cover */
.cover{background:linear-gradient(135deg,#17365d 0%,#1e4d8a 100%);border-radius:16px;padding:40px;margin-bottom:32px;color:#fff}
.cover .eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:rgba(255,255,255,.6);margin-bottom:8px}
.cover h2{font-size:28px;font-weight:700;margin-bottom:6px}
.cover .meta{font-size:13px;color:rgba(255,255,255,.7);margin-bottom:28px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.kpi{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:14px 16px}
.kpi label{display:block;font-size:11px;color:rgba(255,255,255,.7);margin-bottom:4px}
.kpi strong{font-size:22px;font-weight:700;color:#fff}
.kpi small{font-size:11px;color:rgba(255,255,255,.5)}
/* Section */
.section{background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.section h3{font-size:14px;font-weight:700;color:#17365d;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #f0f4f8}
/* Charts row */
.chart-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
.chart-card{background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.chart-card h3{font-size:14px;font-weight:700;color:#17365d;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #f0f4f8;text-align:right}
.donut-wrap{display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap}
.donut-legend{display:flex;flex-direction:column;gap:8px;font-size:12px}
.donut-legend li{display:flex;align-items:center;gap:6px;list-style:none}
.donut-legend .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
/* Table */
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#f8fafc;color:#475467;font-weight:600;padding:8px 10px;text-align:right;border-bottom:1px solid #dce4ee;white-space:nowrap}
td{padding:7px 10px;border-bottom:1px solid #f0f4f8;text-align:right}
tr:hover td{background:#f8fafc}
/* Calendar */
.cal-blocks{display:flex;flex-wrap:wrap;gap:28px}
.cal-block{}
.cal-month-title{font-size:13px;font-weight:700;color:#17365d;margin-bottom:10px}
.cal-wrap{display:inline-block}
.cal-wd{display:grid;grid-template-columns:repeat(7,34px);gap:3px;margin-bottom:3px}
.cal-wd span{text-align:center;font-size:9px;color:#94a3b8;font-weight:600}
.cal-grid{display:grid;grid-template-columns:repeat(7,34px);gap:3px}
.hc{width:34px;height:34px;border-radius:4px;background:#f1f5f9;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:8px}
.hc.empty{background:transparent}
.hd{font-size:9px;color:#334155;font-weight:600;line-height:1}
.hcnt{font-size:8px;color:#fff;font-weight:700;line-height:1;margin-top:1px}
/* Progress bar inline */
.pbar-wrap{display:flex;align-items:center;gap:6px}
.pbar{height:6px;border-radius:3px}
/* Print */
@media print{
  .toolbar{display:none!important}
  body{background:#fff}
  .chart-row{break-inside:avoid}
  .section{break-inside:avoid;box-shadow:none;border:1px solid #dce4ee}
  .cover{break-after:page;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<!-- toolbar -->
<div class="toolbar no-print">
  <h1>التقرير التنفيذي — بيانات جودة الأشعة</h1>
  <button class="btn-print" onclick="window.print()">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
    طباعة / تصدير PDF
  </button>
</div>

<div class="content">

<!-- ── Cover ── -->
<div class="cover">
  <p class="eyebrow">Executive Report · X-Ray Quality Control</p>
  <h2>التقرير التنفيذي لبيانات جودة الأشعة</h2>
  <p class="meta">تاريخ الإصدار: ${dateStr} · يشمل ${filtered.length} شهر</p>
  <div class="kpi-grid">
    <div class="kpi"><label>إجمالي المجتمع</label><strong>${totPop.toLocaleString("ar-SA-u-nu-latn")}</strong></div>
    <div class="kpi"><label>إجمالي العينة</label><strong>${totSamp.toLocaleString("ar-SA-u-nu-latn")}</strong><small>${sampleRate}% من المجتمع</small></div>
    <div class="kpi"><label>المدروسة</label><strong>${totComp.toLocaleString("ar-SA-u-nu-latn")}</strong></div>
    <div class="kpi"><label>نسبة الإنجاز</label><strong>${completionPct}%</strong></div>
  </div>
</div>

<!-- ── Donut charts ── -->
<div class="chart-row">
  <div class="chart-card">
    <h3>توزيع نظام الأشعة المركزية / غير المركزية</h3>
    <div class="donut-wrap">
      ${certDonut}
      <ul class="donut-legend">
        <li><span class="dot" style="background:#2563eb"></span><span>نظام الأشعة المركزية (CertScan)</span><strong style="margin-right:auto;padding-right:8px">${totCert.toLocaleString("ar-SA-u-nu-latn")}</strong></li>
        <li><span class="dot" style="background:#0d9488"></span><span>غير المركزية (NonCertScan)</span><strong style="margin-right:auto;padding-right:8px">${totNon.toLocaleString("ar-SA-u-nu-latn")}</strong></li>
      </ul>
    </div>
  </div>
  <div class="chart-card">
    <h3>حالة التوزيع</h3>
    <div class="donut-wrap">
      ${distDonut}
      <ul class="donut-legend">
        <li><span class="dot" style="background:#059669"></span><span>مدروسة</span><strong style="margin-right:auto;padding-right:8px">${totComp.toLocaleString("ar-SA-u-nu-latn")}</strong></li>
        <li><span class="dot" style="background:#d97706"></span><span>قيد الانتظار</span><strong style="margin-right:auto;padding-right:8px">${totPend.toLocaleString("ar-SA-u-nu-latn")}</strong></li>
        <li><span class="dot" style="background:#94a3b8"></span><span>مستبدلة</span><strong style="margin-right:auto;padding-right:8px">${totRepl.toLocaleString("ar-SA-u-nu-latn")}</strong></li>
      </ul>
    </div>
  </div>
</div>

<!-- ── Monthly table ── -->
<div class="section">
  <h3>المجتمع والعينة والإنجاز حسب الشهر</h3>
  <table>
    <thead><tr><th>الشهر</th><th>المجتمع</th><th>العينة</th><th>المدروسة</th><th>نسبة الإنجاز</th></tr></thead>
    <tbody>${monthRows}</tbody>
  </table>
</div>

<!-- ── Port bar chart + table ── -->
<div class="section">
  <h3>توزيع المجتمع حسب المنفذ</h3>
  <div style="overflow-x:auto;margin-bottom:20px">${portBarSvg}</div>
  <table>
    <thead><tr><th>#</th><th>اسم المنفذ</th><th>عدد السجلات</th><th>النسبة</th></tr></thead>
    <tbody>${portTableRows}</tbody>
  </table>
</div>

<!-- ── Stage bar chart + table ── -->
<div class="section">
  <h3>توزيع المجتمع حسب المستوى</h3>
  <div style="overflow-x:auto;margin-bottom:20px">${stageBarSvg}</div>
  <table>
    <thead><tr><th>المستوى</th><th>عدد السجلات</th><th>النسبة</th></tr></thead>
    <tbody>${stageTableRows}</tbody>
  </table>
</div>

<!-- ── Calendar heatmaps ── -->
<div class="section">
  <h3>الخريطة الحرارية — توزيع السجلات اليومي</h3>
  <div class="cal-blocks">${heatmapSections || '<p style="color:#94a3b8;font-size:12px;">لا توجد بيانات تاريخ دخول محفوظة.</p>'}</div>
</div>

</div><!-- /content -->
</body></html>`;
}

// ── Executive Report Section ──────────────────────────────────────────────────
function ExecutiveReport({ data, filtered }: { data: MonthAgg[]; filtered: MonthAgg[] }) {
  const L = useLabels();
  const stageLbls = { first: L.stage_first, second: L.stage_second, third: L.stage_third, fourth: L.stage_fourth };

  // Aggregate port map
  const portMap: Record<string, number> = {};
  const stageMap: Record<string, number> = {};
  for (const m of filtered) {
    for (const [p, v] of Object.entries(m.byPort))  portMap[p]  = (portMap[p]  ?? 0) + v.pop;
    for (const [s, v] of Object.entries(m.byStage)) stageMap[s] = (stageMap[s] ?? 0) + v.pop;
  }

  const portBarData = Object.entries(portMap)
    .map(([name, pop]) => ({ name, "المجتمع": pop }))
    .sort((a, b) => b["المجتمع"] - a["المجتمع"])
    .slice(0, 15);

  const stageBarData = STAGE_KEYS.map((sk) => ({
    name: stageLbls[sk],
    "عدد السجلات": stageMap[sk] ?? 0,
    fill: STAGE_COLORS[sk],
  }));

  const totPop = filtered.reduce((s, m) => s + m.population, 0);

  function handlePrint() {
    const html = buildPrintReport(data, filtered);
    const win = window.open("", "_blank");
    if (!win) { alert("يرجى السماح بفتح النوافذ المنبثقة لتصدير التقرير."); return; }
    win.opener = null;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
  }

  return (
    <div className="xrpt-exec">
      <PageHeader
        eyebrow="Executive Report"
        title={L.exec_report_title}
        subtitle="تحليل تفصيلي للمجتمع حسب المنفذ والمستوى والتوزيع اليومي."
      >
        <button type="button" className="xrpt-print-btn" onClick={handlePrint}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          تصدير PDF
        </button>
      </PageHeader>

      {/* Port chart (50%) + Calendar heatmap (50%) side by side */}
      <div className="xrpt-two-col xrpt-port-cal-row">
        <ChartSection title={L.exec_chart_port}>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={Math.max(300, portBarData.length * 34)}>
              <BarChart
                data={portBarData}
                layout="vertical"
                margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#475467" }} tickFormatter={numFmt} />
                <YAxis
                  type="category"
                  dataKey="name"
                  orientation="right"
                  width={130}
                  tick={{ fontSize: 11, fill: "#334155", textAnchor: "start" }}
                />
                <Tooltip content={<ArabicTooltip />} />
                <Bar dataKey="المجتمع" radius={[4,0,0,4]}>
                  {portBarData.map((_, i) => (
                    <Cell key={i} fill={i < 3 ? C.primary : i < 7 ? C.secondary : C.teal} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        <ChartSection title={L.exec_chart_daily}>
          {(() => {
            const calMonth = filtered[filtered.length - 1];
            if (!calMonth) return <p className="xrpt-no-data">لا توجد بيانات.</p>;
            const info = parseMonthFolderName(calMonth.folder);
            if (!info) return null;
            return (
              <div className="xrpt-calendar-block">
                <h3 className="xrpt-calendar-month">{calMonth.label}</h3>
                <CalendarHeatmap dayCounts={calMonth.dayCounts} year={info.year} month={info.month} />
                {calMonth.dayCounts.length === 0 && (
                  <p className="xrpt-no-data">لا توجد بيانات تاريخ إدخال.</p>
                )}
              </div>
            );
          })()}
        </ChartSection>
      </div>

      {/* Stage chart + table side by side */}
      <div className="xrpt-two-col">
        <ChartSection title={L.exec_chart_stage}>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stageBarData} margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#334155" }} />
                <YAxis tick={{ fontSize: 11, fill: "#475467" }} tickFormatter={numFmt} width={48} />
                <Tooltip content={<ArabicTooltip />} />
                <Bar dataKey="عدد السجلات" radius={[4,4,0,0]}>
                  {stageBarData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        <ChartSection title={L.exec_chart_stage_summary}>
          <table className="xrpt-month-table">
            <thead>
              <tr><th>المستوى</th><th>المجتمع</th><th>النسبة</th></tr>
            </thead>
            <tbody>
              {STAGE_KEYS.map((sk) => {
                const cnt = stageMap[sk] ?? 0;
                const pct = totPop > 0 ? ((cnt / totPop) * 100).toFixed(1) : "0";
                return (
                  <tr key={sk}>
                    <td>
                      <span style={{ display:"inline-block", width:10, height:10, borderRadius:2, background:STAGE_COLORS[sk], marginInlineEnd:6 }} />
                      {stageLbls[sk]}
                    </td>
                    <td>{cnt.toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td><span className="xrpt-badge" style={{ background:"#eff6ff", color:"#1d4ed8" }}>{pct}%</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ChartSection>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function XrayReportsDashboard({
  directoryHandle,
}: {
  directoryHandle: DirectoryHandleLike | null;
}) {
  const L = useLabels();
  const stageLbls = { first: L.stage_first, second: L.stage_second, third: L.stage_third, fourth: L.stage_fourth };

  const [data, setData]       = useState<MonthAgg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState("__all__");
  const [activeView, setActiveView] = useState<"overview" | "executive">("overview");

  useEffect(() => {
    if (!directoryHandle) return;
    setLoading(true);
    setError(null);
    loadAllMonthData(directoryHandle as DirectoryHandleLike)
      .then(setData)
      .catch(() => setError("تعذر تحميل البيانات من مساحة العمل."))
      .finally(() => setLoading(false));
  }, [directoryHandle]);

  const filtered = useMemo(
    () => selectedMonth === "__all__" ? data : data.filter((d) => d.folder === selectedMonth),
    [data, selectedMonth]
  );

  const totals = useMemo(() => {
    const agg = filtered.reduce((acc, m) => ({
      population: acc.population + m.population,
      certScan:   acc.certScan   + m.certScan,
      nonCert:    acc.nonCert    + m.nonCertScan,
      sample:     acc.sample     + m.sample,
      completed:  acc.completed  + m.completed,
      assigned:   acc.assigned   + m.assigned,
      pending:    acc.pending    + m.pending,
      replaced:   acc.replaced   + m.replaced,
    }), { population:0, certScan:0, nonCert:0, sample:0, completed:0, assigned:0, pending:0, replaced:0 });
    return {
      ...agg,
      completionPct: agg.assigned > 0 ? Math.round((agg.completed / agg.assigned) * 100) : 0,
      sampleRate:    agg.population > 0 ? Math.round((agg.sample / agg.population) * 100) : 0,
    };
  }, [filtered]);

  // ── chart datasets ──────────────────────────────────────────────────────────
  const trendData = filtered.map((m) => ({
    name:       m.label,
    "المجتمع":  m.population,
    "العينة":   m.sample,
    "المدروسة": m.completed,
  }));

  const certScanPie = [
    { name: L.certscan_name,    value: totals.certScan },
    { name: L.noncertscan_name, value: totals.nonCert  },
  ];
  const PIE_COLORS_CERT = [C.secondary, C.teal];

  const distPie = [
    { name: "مدروسة",      value: totals.completed, color: C.success  },
    { name: "قيد الانتظار",value: totals.pending,   color: C.warning  },
    { name: "مستبدلة",     value: totals.replaced,  color: C.muted    },
  ];

  const stageBarData = filtered.map((m) => {
    const row: Record<string, string | number> = { name: m.label };
    for (const sk of STAGE_KEYS) row[stageLbls[sk]] = m.byStage[sk]?.pop ?? 0;
    return row;
  });

  const portMap: Record<string, { pop: number; sample: number }> = {};
  for (const m of filtered) {
    for (const [port, v] of Object.entries(m.byPort)) {
      if (!portMap[port]) portMap[port] = { pop: 0, sample: 0 };
      portMap[port].pop    += v.pop;
      portMap[port].sample += v.sample;
    }
  }
  const portBarData = Object.entries(portMap)
    .map(([name, v]) => ({ name, "المجتمع": v.pop, "العينة": v.sample }))
    .sort((a, b) => b["المجتمع"] - a["المجتمع"])
    .slice(0, 10);

  const rateData = filtered.map((m) => ({
    name: m.label,
    "نسبة العينة (%)":   m.population > 0 ? parseFloat(((m.sample / m.population) * 100).toFixed(1)) : 0,
    "نسبة الإنجاز (%)": m.completionPct,
  }));

  // ── guards ──────────────────────────────────────────────────────────────────
  if (!directoryHandle) {
    return <div className="xrpt-empty"><p>يجب اختيار مساحة عمل أولاً.</p></div>;
  }
  if (loading) {
    return (
      <div className="xrpt-loading">
        <div className="xrpt-spinner" />
        <p>جاري تحميل بيانات جميع الأشهر...</p>
      </div>
    );
  }
  if (error) return <div className="xrpt-error">{error}</div>;
  if (data.length === 0) {
    return <div className="xrpt-empty"><p>لا توجد بيانات محفوظة بعد. ابدأ بمعالجة شهر من تبويب معالجة المجتمع.</p></div>;
  }

  return (
    <div className="xrpt-root" dir="rtl">
      <PageHeader
        eyebrow="X-Ray Quality Reports"
        title="تقارير بيانات الأشعة"
      >
        <div className="xrpt-header-controls">
          <div className="xrpt-view-toggle">
            <button
              type="button"
              className={`xrpt-toggle-btn${activeView === "overview" ? " active" : ""}`}
              onClick={() => setActiveView("overview")}
            >نظرة عامة</button>
            <button
              type="button"
              className={`xrpt-toggle-btn${activeView === "executive" ? " active" : ""}`}
              onClick={() => setActiveView("executive")}
            >التقرير التنفيذي</button>
          </div>
          <div className="xrpt-month-filter">
            <label htmlFor="xrpt-month-sel">الشهر</label>
            <select id="xrpt-month-sel" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
              <option value="__all__">كل الأشهر ({data.length})</option>
              {data.map((m) => <option key={m.folder} value={m.folder}>{m.label}</option>)}
            </select>
          </div>
        </div>
      </PageHeader>

      {/* ── KPI strip ── */}
      <div className="xrpt-kpi-strip">
        <KpiCard label={L.kpi_population}       value={totals.population}           color={C.primary}   />
        <KpiCard label={L.kpi_sample}           value={totals.sample}  sub={`${totals.sampleRate}% من المجتمع`} color={C.secondary} />
        <KpiCard label={L.kpi_completed}        value={totals.completed}            color={C.success}   />
        <KpiCard label={L.kpi_completion_rate}  value={`${totals.completionPct}%`}  color={totals.completionPct >= 80 ? C.success : C.warning} />
        <KpiCard label={L.kpi_pending}          value={totals.pending}              color={C.warning}   />
        <KpiCard label={L.kpi_months}           value={filtered.length}             color={C.purple}    />
      </div>

      {/* ── Executive view ── */}
      {activeView === "executive" && (
        <ExecutiveReport data={data} filtered={filtered} />
      )}

      {/* ── Overview charts ── */}
      {activeView === "overview" && (<>

        {/* Trend */}
        <ChartSection title={L.ov_chart_trend}>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trendData} margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#475467" }} />
                <YAxis tick={{ fontSize: 11, fill: "#475467" }} width={48} tickFormatter={numFmt} />
                <Tooltip content={<ArabicTooltip />} />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Bar dataKey="المجتمع"  fill={C.primary}   radius={[4,4,0,0]} />
                <Bar dataKey="العينة"   fill={C.secondary} radius={[4,4,0,0]} />
                <Bar dataKey="المدروسة" fill={C.success}   radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        {/* Two pies */}
        <div className="xrpt-two-col">
          <ChartSection title={L.ov_chart_certscan}>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={certScanPie}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={88}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {certScanPie.map((_, i) => <Cell key={i} fill={PIE_COLORS_CERT[i]} />)}
                </Pie>
                <Tooltip formatter={(v) => Number(v).toLocaleString("ar-SA-u-nu-latn")} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <div className="xrpt-pie-stats">
              <span><strong style={{ color: C.secondary }}>{totals.certScan.toLocaleString("ar-SA-u-nu-latn")}</strong> نظام الأشعة المركزية</span>
              <span><strong style={{ color: C.teal }}>{totals.nonCert.toLocaleString("ar-SA-u-nu-latn")}</strong> غير المركزية</span>
            </div>
          </ChartSection>

          <ChartSection title={L.ov_chart_dist_status}>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={distPie}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={88}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {distPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v) => Number(v).toLocaleString("ar-SA-u-nu-latn")} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <div className="xrpt-pie-stats">
              {distPie.map((e) => (
                <span key={e.name}><strong style={{ color: e.color }}>{e.value.toLocaleString("ar-SA-u-nu-latn")}</strong> {e.name}</span>
              ))}
            </div>
          </ChartSection>
        </div>

        {/* Stage stacked bar */}
        <ChartSection title={L.ov_chart_stage_month}>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stageBarData} margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#475467" }} />
                <YAxis tick={{ fontSize: 11, fill: "#475467" }} width={48} tickFormatter={numFmt} />
                <Tooltip content={<ArabicTooltip />} />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                {STAGE_KEYS.map((sk) => (
                  <Bar key={sk} dataKey={stageLbls[sk]} fill={STAGE_COLORS[sk]} stackId="s" />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        {/* Rates line */}
        <ChartSection title={L.ov_chart_rates}>
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={rateData} margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#475467" }} />
                <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 11, fill: "#475467" }} width={45} />
                <Tooltip content={<ArabicTooltip />} />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Line type="monotone" dataKey="نسبة العينة (%)"   stroke={C.secondary} strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="نسبة الإنجاز (%)" stroke={C.success}   strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        {/* Top 10 ports */}
        {portBarData.length > 0 && (
          <ChartSection title={L.ov_chart_top_ports}>
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={340}>
                <BarChart
                  data={portBarData}
                  layout="vertical"
                  margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#475467" }} tickFormatter={numFmt} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    orientation="right"
                    width={130}
                    tick={{ fontSize: 11, fill: "#334155", textAnchor: "start" }}
                  />
                  <Tooltip content={<ArabicTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                  <Bar dataKey="المجتمع" fill={C.primary}   radius={[4,0,0,4]} />
                  <Bar dataKey="العينة"  fill={C.secondary} radius={[4,0,0,4]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartSection>
        )}

        {/* Month summary table */}
        <ChartSection title={L.ov_chart_month_summary}>
          <div className="xrpt-month-table-wrap">
            <table className="xrpt-month-table">
              <thead>
                <tr><th>الشهر</th><th>المجتمع</th><th>العينة</th><th>المدروسة</th><th>الإنجاز</th></tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.folder}>
                    <td>{m.label}</td>
                    <td>{m.population.toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td>{m.sample.toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td>{m.completed.toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td>
                      <span className="xrpt-badge" style={{ background: m.completionPct >= 80 ? "#d1fae5" : "#fef3c7", color: m.completionPct >= 80 ? "#065f46" : "#92400e" }}>
                        {m.completionPct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>

      </>)}
    </div>
  );
}
