// Management report (تقرير الإدارة) — C2 (Batch 2).
//
// A concise, print-ready "summary cut" of the SAME `ReportModel` that drives the
// executive editions (one model → many renderers, so the numbers can never
// disagree with the executive document / deck / workbook). This builder reuses
// `buildReportModel` and the executive `esc()` / `fmtNum()` / `fmtPct()` primitives;
// it does NOT re-derive any analytics.
//
// SECURITY: every interpolated model/user value (port names, reviewer display
// names, model-derived recommendation strings, narrative findings) is routed
// through `esc()`. This builder is part of the D2 XSS test set (Batch 3) — keep
// it that way: never interpolate un-escaped data into the template.
//
// Output: a single self-contained Arabic RTL HTML document with print CSS
// (`@media print` + `@page`), no runtime JS beyond the print button.

import { buildReportModel } from "../executive/model/reportModel";
import type { ReportModel } from "../executive/model/reportModel";
import { esc, fmtNum, fmtPct } from "../executive/primitives";
import { openOrDownload } from "../htmlReport";
import { getLabels, type Labels } from "../../labels/labelsStore";
import type { ExecutiveReportInput } from "../executiveReportTypes";
import type { DataSufficiencyBand } from "../executive/model/dataSufficiency";
import {
  sourceRevisionsFooterHtml,
  SOURCE_REVISIONS_CSS,
  type SourceRevisions,
} from "../sourceRevisions";

const ARABIC_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

function formatMonthLabel(folderName: string): string {
  const m = /^(\d{1,2})-[A-Za-z]+-(\d{4})$/.exec(folderName.trim());
  if (!m) return folderName;
  const name = ARABIC_MONTHS[Number(m[1]) - 1];
  return name ? `${name} ${m[2]}` : folderName;
}

function formatIssueDate(d = new Date()): string {
  return `${String(d.getDate()).padStart(2, "0")} / ${String(d.getMonth() + 1).padStart(2, "0")} / ${d.getFullYear()}`;
}

// ── Small pure render helpers (all text routed through esc()) ────────────────

type KpiTone = "gold" | "green" | "blue" | "risk" | "slate";

function kpiCard(label: string, value: string, tone: KpiTone): string {
  return `<div class="mr-kpi mr-${tone}">
    <div class="mr-kpi-label">${esc(label)}</div>
    <div class="mr-kpi-value">${esc(value)}</div>
  </div>`;
}

/** Accuracy-style tone from a 0–100 rate (null → neutral). */
function rateTone(pct: number | null): "good" | "warn" | "risk" | "none" {
  if (pct === null) return "none";
  if (pct >= 90) return "good";
  if (pct >= 75) return "warn";
  return "risk";
}

/** A cell holding a percentage with a mini progress bar. Numeric-only markup. */
function pctBarCell(pct: number | null): string {
  const tone = rateTone(pct);
  const w = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return `<td class="mr-num"><div class="mr-acc">
    <span class="mr-acc-num">${esc(fmtPct(pct))}</span>
    <span class="mr-bar"><i class="mr-fill mr-${tone}" style="width:${w.toFixed(1)}%"></i></span>
  </div></td>`;
}

/** A plain right-aligned percentage cell; risk-tinted when a missed-suspicion
 *  rate crosses the concern threshold (higher = worse, unlike accuracy). */
function missedCell(pct: number | null): string {
  const risky = pct !== null && pct > 10;
  return `<td class="mr-num${risky ? " mr-cell-risk" : ""}">${esc(fmtPct(pct))}</td>`;
}

function bandChip(band: DataSufficiencyBand, L: Labels): string {
  const map: Record<DataSufficiencyBand, { label: string; cls: string }> = {
    sufficient: { label: L.mgmt_report_band_sufficient, cls: "good" },
    limited: { label: L.mgmt_report_band_limited, cls: "warn" },
    insufficient: { label: L.mgmt_report_band_insufficient, cls: "risk" },
    none: { label: L.mgmt_report_band_none, cls: "none" },
  };
  const e = map[band] ?? map.none;
  return `<span class="mr-chip mr-chip-${e.cls}">${esc(e.label)}</span>`;
}

function statusChip(reliable: boolean, L: Labels): string {
  return reliable
    ? `<span class="mr-chip mr-chip-good">${esc(L.mgmt_report_status_reliable)}</span>`
    : `<span class="mr-chip mr-chip-none">${esc(L.mgmt_report_status_insufficient)}</span>`;
}

// ── Section builders ─────────────────────────────────────────────────────────

function reviewerSection(model: ReportModel, L: Labels): string {
  const eo = model.employeeOverview;
  const unmappedNote = eo.inspectorIdentityMapped
    ? ""
    : `<div class="mr-note">${esc(L.mgmt_report_bi_unmapped)}</div>`;

  if (eo.reviewerProfiles.length === 0) {
    return `<section class="mr-panel">
      <h2 class="mr-panel-title">${esc(L.mgmt_report_employees_title)}</h2>
      ${unmappedNote}
      <div class="mr-empty">${esc(L.mgmt_report_reviewers_empty)}</div>
    </section>`;
  }

  const rows = eo.reviewerProfiles
    .map((p) => {
      const name = eo.reviewerDisplayNames[p.username] ?? p.username;
      return `<tr>
        <td>${esc(name)}</td>
        <td class="mr-num">${esc(fmtNum(p.studied))}</td>
        ${pctBarCell(p.overallAccuracy)}
        ${missedCell(p.missedSuspicionRate)}
        <td>${statusChip(p.reliable, L)}</td>
        <td class="mr-action">${esc(p.recommendedAction)}</td>
      </tr>`;
    })
    .join("");

  return `<section class="mr-panel">
    <h2 class="mr-panel-title">${esc(L.mgmt_report_employees_title)}</h2>
    ${unmappedNote}
    <div class="mr-table-wrap">
      <table class="mr-table">
        <thead><tr>
          <th>${esc(L.mgmt_report_col_reviewer)}</th>
          <th class="mr-num">${esc(L.mgmt_report_col_studied)}</th>
          <th class="mr-num">${esc(L.mgmt_report_col_accuracy)}</th>
          <th class="mr-num">${esc(L.mgmt_report_col_missed)}</th>
          <th>${esc(L.mgmt_report_col_status)}</th>
          <th>${esc(L.mgmt_report_col_action)}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function portSection(model: ReportModel, L: Labels): string {
  // Worst accuracy first (management/action lens); null accuracy sinks to the end.
  const ports = [...model.portAccuracy].sort((a, b) => {
    if (a.accuracy === null && b.accuracy === null) return 0;
    if (a.accuracy === null) return 1;
    if (b.accuracy === null) return -1;
    return a.accuracy - b.accuracy;
  });

  if (ports.length === 0) {
    return `<section class="mr-panel">
      <h2 class="mr-panel-title">${esc(L.mgmt_report_ports_title)}</h2>
      <div class="mr-empty">${esc(L.mgmt_report_ports_empty)}</div>
    </section>`;
  }

  const rows = ports
    .map(
      (p) => `<tr>
        <td>${esc(p.key)}</td>
        <td class="mr-num">${esc(fmtNum(p.evaluable))}</td>
        ${pctBarCell(p.accuracy)}
        ${missedCell(p.missedSuspicionRate)}
        <td>${bandChip(p.band, L)}</td>
      </tr>`,
    )
    .join("");

  return `<section class="mr-panel">
    <h2 class="mr-panel-title">${esc(L.mgmt_report_ports_title)}</h2>
    <div class="mr-table-wrap">
      <table class="mr-table">
        <thead><tr>
          <th>${esc(L.mgmt_report_col_port)}</th>
          <th class="mr-num">${esc(L.mgmt_report_col_evaluable)}</th>
          <th class="mr-num">${esc(L.mgmt_report_col_accuracy)}</th>
          <th class="mr-num">${esc(L.mgmt_report_col_missed)}</th>
          <th>${esc(L.mgmt_report_col_sufficiency)}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function actionsSection(model: ReportModel, L: Labels): string {
  const items = model.actions.filter((a) => a && a.trim().length > 0);
  const body =
    items.length === 0
      ? `<div class="mr-empty">${esc(L.mgmt_report_actions_empty)}</div>`
      : `<ol class="mr-actions">${items.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>`;
  return `<section class="mr-panel">
    <h2 class="mr-panel-title">${esc(L.mgmt_report_actions_title)}</h2>
    ${body}
  </section>`;
}

function dataQualityFooter(model: ReportModel, L: Labels): string {
  const dq = model.dataQuality;
  const biChip = dq.biAvailable
    ? `<span class="mr-chip mr-chip-good">${esc(L.mgmt_report_dq_bi_available)}</span>`
    : `<span class="mr-chip mr-chip-warn">${esc(L.mgmt_report_dq_bi_missing)}</span>`;
  return `<section class="mr-panel mr-dq">
    <h2 class="mr-panel-title">${esc(L.mgmt_report_dq_title)}</h2>
    <div class="mr-dq-row">
      <div class="mr-pill"><span>${esc(L.mgmt_report_dq_evaluable)}</span><b>${esc(fmtNum(dq.evaluableDecisionRecords))}</b></div>
      <div class="mr-pill"><span>${esc(L.mgmt_report_dq_total)}</span><b>${esc(fmtNum(dq.totalDecisionRecords))}</b></div>
      <div class="mr-pill"><span>${esc(L.mgmt_report_scope_title)}</span>${bandChip(dq.overallBand, L)}</div>
      <div class="mr-pill mr-pill-plain">${biChip}</div>
    </div>
    <div class="mr-exclusions">${esc(model.exclusions.note)}</div>
  </section>`;
}

// ── HTML assembly ────────────────────────────────────────────────────────────

const REPORT_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --mr-navy:#17365d;--mr-navy-2:#1a2333;--mr-gold:#e3a000;--mr-ink:#1a2333;
  --mr-muted:#667085;--mr-line:#e2e8f0;--mr-bg:#f4f6fb;--mr-card:#ffffff;
  --mr-good:#16a34a;--mr-warn:#d97706;--mr-risk:#dc2626;--mr-none:#94a3b8;
  --mr-track:#e8edf5;
}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;direction:rtl;color:var(--mr-ink);background:var(--mr-bg);padding:28px;line-height:1.5}
.mr-doc{max-width:1000px;margin:0 auto}
.mr-header{background:linear-gradient(135deg,var(--mr-navy) 0%,var(--mr-navy-2) 100%);color:#fff;border-radius:14px;padding:22px 26px;position:relative;overflow:hidden}
.mr-header::before{content:"";position:absolute;inset-inline-start:0;top:0;bottom:0;width:6px;background:var(--mr-gold)}
.mr-header h1{font-size:26px;font-weight:800;margin-bottom:4px}
.mr-header .mr-sub{font-size:13px;color:#c7d4e6}
.mr-header-meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:14px;font-size:12.5px;align-items:center}
.mr-header-meta .mr-meta-item{display:flex;gap:6px;align-items:center}
.mr-header-meta .mr-meta-item span{color:#a9bdd6}
.mr-header-meta .mr-meta-item b{color:#fff;font-weight:700}
.mr-toolbar{display:flex;justify-content:flex-end;margin:14px 0 4px}
.mr-print-btn{background:var(--mr-navy);color:#fff;border:0;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
.mr-print-btn:hover{background:var(--mr-navy-2)}
.mr-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px}
.mr-kpi{background:var(--mr-card);border:1px solid var(--mr-line);border-radius:12px;padding:14px 16px;border-top:3px solid var(--mr-none)}
.mr-kpi-label{font-size:12px;color:var(--mr-muted);margin-bottom:6px}
.mr-kpi-value{font-size:26px;font-weight:800;color:var(--mr-navy)}
.mr-gold{border-top-color:var(--mr-gold)}
.mr-green{border-top-color:var(--mr-good)}
.mr-blue{border-top-color:var(--mr-navy)}
.mr-risk{border-top-color:var(--mr-risk)}
.mr-slate{border-top-color:var(--mr-none)}
.mr-panel{background:var(--mr-card);border:1px solid var(--mr-line);border-radius:12px;padding:18px 20px;margin-top:16px}
.mr-panel-title{font-size:16px;color:var(--mr-navy);font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--mr-line)}
.mr-scope{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.mr-scope .mr-kpi{border-top-color:var(--mr-navy)}
.mr-table-wrap{overflow-x:auto}
.mr-table{width:100%;border-collapse:collapse;font-size:13px}
.mr-table th{background:var(--mr-navy);color:#fff;padding:9px 12px;text-align:right;font-weight:700;white-space:nowrap}
.mr-table td{padding:8px 12px;border-bottom:1px solid var(--mr-line);vertical-align:middle}
.mr-table tr:nth-child(even) td{background:#f8fafc}
.mr-num{text-align:end;font-variant-numeric:tabular-nums;white-space:nowrap}
.mr-cell-risk{color:var(--mr-risk);font-weight:700}
.mr-acc{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.mr-acc-num{min-width:52px;text-align:end;font-variant-numeric:tabular-nums}
.mr-bar{display:inline-block;width:84px;height:8px;border-radius:999px;background:var(--mr-track);overflow:hidden}
.mr-fill{display:block;height:100%;border-radius:999px;background:var(--mr-none)}
.mr-fill.mr-good{background:var(--mr-good)}
.mr-fill.mr-warn{background:var(--mr-warn)}
.mr-fill.mr-risk{background:var(--mr-risk)}
.mr-fill.mr-none{background:var(--mr-none)}
.mr-action{color:var(--mr-muted);font-size:12.5px}
.mr-chip{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap}
.mr-chip-good{background:#dcfce7;color:#166534}
.mr-chip-warn{background:#fef3c7;color:#92400e}
.mr-chip-risk{background:#fee2e2;color:#991b1b}
.mr-chip-none{background:#f1f5f9;color:#64748b}
.mr-note{background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 12px;font-size:12.5px;margin-bottom:12px}
.mr-empty{color:var(--mr-muted);font-size:13px;padding:14px;text-align:center;background:#f8fafc;border-radius:8px}
.mr-actions{margin:0;padding-inline-start:20px}
.mr-actions li{margin-bottom:8px;font-size:13.5px}
.mr-dq-row{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px}
.mr-pill{display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid var(--mr-line);border-radius:999px;padding:6px 14px;font-size:12.5px}
.mr-pill span{color:var(--mr-muted)}
.mr-pill b{color:var(--mr-navy);font-weight:800;font-variant-numeric:tabular-nums}
.mr-pill-plain{background:transparent;border:0;padding:6px 0}
.mr-exclusions{font-size:12px;color:var(--mr-muted)}
.mr-footer{text-align:center;color:var(--mr-muted);font-size:11.5px;margin-top:18px}
@page{size:A4 portrait;margin:14mm}
@media print{
  body{background:#fff;padding:0}
  .mr-toolbar{display:none!important}
  .mr-panel,.mr-kpi{break-inside:avoid;border-color:#d0d7e2}
  .mr-table tr{break-inside:avoid}
  .mr-header{border-radius:0}
}
`;

function renderHtml(
  model: ReportModel,
  L: Labels,
  monthLabel: string,
  issueDate: string,
  sourceRevisions?: SourceRevisions,
): string {
  const s = model.summary;
  const kpis = `<div class="mr-kpis">
    ${kpiCard(L.mgmt_report_kpi_accuracy, fmtPct(s.overallAccuracy), "gold")}
    ${kpiCard(L.mgmt_report_kpi_detection, fmtPct(s.detectionRate), "blue")}
    ${kpiCard(L.mgmt_report_kpi_missed, fmtPct(s.missedSuspicionRate), "risk")}
    ${kpiCard(L.mgmt_report_kpi_completion, fmtPct(s.completionRate), "green")}
  </div>`;

  const scope = `<section class="mr-panel">
    <h2 class="mr-panel-title">${esc(L.mgmt_report_scope_title)}</h2>
    <div class="mr-scope">
      ${kpiCard(L.mgmt_report_scope_population, fmtNum(model.population.total), "slate")}
      ${kpiCard(L.mgmt_report_scope_sample, fmtNum(model.sample.total), "gold")}
      ${kpiCard(L.mgmt_report_scope_coverage, fmtPct(model.sample.coverage), "blue")}
      ${kpiCard(L.mgmt_report_scope_studied, fmtNum(model.sample.studied), "green")}
    </div>
  </section>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${esc(L.mgmt_report_title)} — ${esc(monthLabel)}</title>
<style>${REPORT_CSS}${SOURCE_REVISIONS_CSS}</style>
</head>
<body>
<div class="mr-doc">
  <div class="mr-toolbar">
    <button type="button" class="mr-print-btn" onclick="window.print()">${esc(L.mgmt_report_print)}</button>
  </div>
  <header class="mr-header">
    <h1>${esc(L.mgmt_report_title)}</h1>
    <div class="mr-sub">${esc(L.mgmt_report_subtitle)}</div>
    <div class="mr-header-meta">
      <div class="mr-meta-item"><span>${esc(L.mgmt_report_period_label)}</span><b>${esc(s.periodId)}</b></div>
      <div class="mr-meta-item"><span>${esc(L.mgmt_report_issued_label)}</span><b>${esc(issueDate)}</b></div>
      <div class="mr-meta-item">${bandChip(model.dataQuality.overallBand, L)}</div>
    </div>
  </header>
  ${kpis}
  ${scope}
  ${reviewerSection(model, L)}
  ${portSection(model, L)}
  ${actionsSection(model, L)}
  ${dataQualityFooter(model, L)}
  ${sourceRevisionsFooterHtml(sourceRevisions, esc)}
  <div class="mr-footer">${esc(L.mgmt_report_generated_by)}</div>
</div>
</body>
</html>`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Build the self-contained management-report HTML string for a month. */
export function buildManagementReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const model = buildReportModel(input, employeeDisplayNames);
  const L = getLabels();
  return renderHtml(model, L, formatMonthLabel(input.monthFolderName), formatIssueDate(), input.sourceRevisions);
}

/** Build and open (or download) the management report in a new tab. */
export function openManagementReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void {
  openOrDownload(
    buildManagementReport(input, employeeDisplayNames),
    `تقرير_الإدارة_${input.monthFolderName}.html`,
  );
}
