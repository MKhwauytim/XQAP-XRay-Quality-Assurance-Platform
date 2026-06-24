import * as XLSX from "xlsx";

import { openOrDownload } from "./htmlReport";
import type { ExecutiveKPIs, ExecutiveReportConfig, ExecutiveReportInput, PortProfile } from "./executiveReportTypes";
import {
  buildExecutiveReportRows,
  calculateExecutiveKPIs,
  generateNarrativeFindings,
  fmtNum,
  fmtPct,
  fmtK,
} from "./executiveReportData";

// ─── HTML-escape ─────────────────────────────────────────────────────────────
function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

function portBarChart(portProfiles: PortProfile[], topN = 5): string {
  const top = portProfiles.slice(0, topN);
  if (!top.length) return `<div class="chart-empty">لا توجد بيانات منافذ</div>`;
  const maxPop = Math.max(...top.map((p) => p.population), 1);
  const maxSample = Math.max(...top.map((p) => p.sampleSize), 1);
  return top.map((p) => {
    const th = Math.round((p.population / maxPop) * 88);
    const sh = Math.round((p.sampleSize / maxSample) * 44);
    return `<div class="bar-group">
      <div class="bar total" style="height:${th}%"><span class="bar-num">${fmtK(p.population)}</span></div>
      <div class="bar sample" style="height:${sh}%"><span class="bar-num">${fmtK(p.sampleSize)}</span></div>
      <span class="bar-label">${esc(p.portName)}</span>
    </div>`;
  }).join("");
}

function donutChart(clean: number, suspicious: number): string {
  const total = clean + suspicious;
  if (!total) return `<div class="donut-wrap chart-empty">لا توجد بيانات</div>`;
  const pct = (clean / total) * 100;
  return `<div class="donut-wrap">
    <div class="donut" style="background:conic-gradient(var(--teal-600) 0 ${pct.toFixed(2)}%,var(--navy-900) ${pct.toFixed(2)}% 100%)"></div>
    <div class="donut-center"><b>${pct.toFixed(1)}%</b>سليمة</div>
    <div class="donut-side right">سليمة<b style="color:var(--teal-700)">${fmtNum(clean)}</b></div>
    <div class="donut-side left">اشتباه<b>${fmtNum(suspicious)}</b></div>
  </div>`;
}

function portRankList(portProfiles: PortProfile[], topN = 5): string {
  const ranked = portProfiles.filter((p) => p.accuracy !== null)
    .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0)).slice(0, topN);
  if (!ranked.length) return `<div class="chart-empty">لا توجد بيانات كافية</div>`;
  return ranked.map((p, i) => `<div class="rank-row">
    <div class="rank-no">${i + 1}</div>
    <div class="rank-name">${esc(p.portName)}</div>
    <div class="rank-track"><div class="rank-fill" style="width:${Math.round(p.accuracy ?? 0)}%"></div></div>
    <div class="rank-value">${fmtPct(p.accuracy)}</div>
  </div>`).join("");
}

function stackedBars(portProfiles: PortProfile[], topN = 6): string {
  return portProfiles.slice(0, topN).map((p) => {
    const suspPct = p.population > 0 ? (p.suspicious / p.population) * 100 : 0;
    return `<div class="port-row">
      <div class="name">${esc(p.portName)}</div>
      <div class="stack-track">
        <div class="stack-clean" style="width:${(100 - suspPct).toFixed(1)}%"></div>
        <div class="stack-susp" style="width:${suspPct.toFixed(1)}%"></div>
      </div>
      <div class="pct">${suspPct.toFixed(1)}%</div>
    </div>`;
  }).join("");
}

function stageCoverageCards(stageProfiles: ExecutiveKPIs["stageProfiles"]): string {
  return stageProfiles.map((s) => {
    const cov = Math.min(Math.round(s.coverage), 100);
    return `<div class="stage-card">
      <div class="stage-head"><strong>${esc(s.stageLabel)}</strong></div>
      <div class="stage-metrics">
        <div class="stage-metric"><span>المجتمع</span><b>${fmtNum(s.population)}</b></div>
        <div class="stage-metric teal"><span>العينة</span><b>${fmtNum(s.sampleSize)}</b></div>
        <div class="stage-metric teal"><span>التغطية</span><b>${fmtPct(s.coverage)}</b></div>
        <div class="stage-metric"><span>المدروسة</span><b>${fmtNum(s.studied)}</b></div>
        <div class="stage-metric"><span>الإنجاز</span><b>${fmtPct(s.completionRate)}</b></div>
      </div>
      <div class="progress"><i style="width:${cov}%"></i></div>
    </div>`;
  }).join("");
}

function dualBarsPerPort(portProfiles: PortProfile[], topN = 5): string {
  const top = portProfiles.filter((p) => p.levelOneAccuracy !== null || p.levelTwoAccuracy !== null).slice(0, topN);
  if (!top.length) return `<div class="chart-empty">لا توجد بيانات كافية</div>`;
  return top.map((p) => {
    const l1 = p.levelOneAccuracy ?? 0;
    const l2 = p.levelTwoAccuracy ?? 0;
    return `<div class="dual-row">
      <div class="dual-label">${esc(p.portName)}</div>
      <div class="dual-track">
        <div class="a" style="width:${Math.round(l1 / 2)}%"></div>
        <div class="b" style="width:${Math.round(l2 / 2)}%"></div>
      </div>
      <div class="dual-value">${fmtPct(l1, 0)} / ${fmtPct(l2, 0)}</div>
    </div>`;
  }).join("");
}

function portTableRows(portProfiles: PortProfile[]): string {
  return portProfiles.slice(0, 8).map((p) => `<tr>
    <td class="port-name">${esc(p.portName)}</td>
    <td class="ltr">${fmtNum(p.population)}</td>
    <td class="ltr">${fmtNum(p.clean)}</td>
    <td class="ltr">${fmtNum(p.suspicious)}</td>
    <td class="ltr">${fmtPct(p.suspicionRate)}</td>
    <td class="ltr">${fmtNum(p.sampleSize)}</td>
    <td class="ltr">${fmtPct(p.coverage)}</td>
    <td class="ltr">${p.accuracy !== null ? fmtPct(p.accuracy) : "—"}</td>
  </tr>`).join("");
}

function priorityPortCards(portProfiles: PortProfile[]): string {
  const priority = portProfiles.filter((p) => p.status === "priority").slice(0, 2);
  const monitor  = portProfiles.filter((p) => p.status === "monitor").slice(0, 2);
  const excellent = portProfiles.filter((p) => p.status === "excellent").slice(0, 2);
  const cards: string[] = [];

  for (const p of priority)
    cards.push(`<div class="priority-card red"><strong>${esc(p.portName)}</strong>
      <span>دقة ${fmtPct(p.accuracy)} — اشتباه فائت ${fmtPct(p.missedSuspicionRate)}. يحتاج مراجعة عاجلة.</span></div>`);

  for (const p of monitor)
    cards.push(`<div class="priority-card amber"><strong>${esc(p.portName)}</strong>
      <span>أداء دون المستهدف. يُوصى بزيادة المتابعة.</span></div>`);

  for (const p of excellent) {
    if (cards.length >= 4) break;
    cards.push(`<div class="priority-card teal"><strong>${esc(p.portName)}</strong>
      <span>أفضل أداء موثوق. دقة ${fmtPct(p.accuracy)}.</span></div>`);
  }

  if (!cards.length)
    cards.push(`<div class="priority-card navy" style="grid-column:1/-1"><strong>لا توجد تصنيفات كافية</strong>
      <span>تحتاج المنافذ إلى ${30} إجابة معتمدة على الأقل لاحتساب التصنيف.</span></div>`);

  return cards.join("");
}

// ─── Slides ───────────────────────────────────────────────────────────────────

function slide1(kpis: ExecutiveKPIs, config: ExecutiveReportConfig, monthLabel: string): string {
  const findings = generateNarrativeFindings(kpis, config);
  const insightItems = findings.map((f, i) => `<div class="insight-item">
    <div class="insight-num">${i + 1}</div>
    <div><span>${esc(f)}</span></div>
  </div>`).join("");

  const completionPct = Math.min(Math.round(kpis.completionRate), 100);

  return `<section class="slide active" data-title="الملخص التنفيذي">
    <div class="slide-header">
      <div class="title-group">
        <h1 class="report-title">التقرير التنفيذي</h1>
        <h2 class="section-title">ملخص أداء المنافذ وجودة الفحص</h2>
      </div>
      <span class="period-chip">${esc(monthLabel)}</span>
    </div>

    <div class="kpis-row">
      <div class="kpi-card"><div>
        <div class="label">إجمالي المجتمع</div>
        <div class="value">${fmtNum(kpis.totalPopulation)}</div>
        <div class="note">إجمالي صور الأشعة</div>
      </div><div class="kpi-icon">◎</div></div>

      <div class="kpi-card"><div>
        <div class="label">إجمالي العينة</div>
        <div class="value">${fmtNum(kpis.totalSample)}</div>
        <div class="note">${fmtPct(kpis.sampleCoverage)} من المجتمع</div>
      </div><div class="kpi-icon">◈</div></div>

      <div class="kpi-card teal"><div>
        <div class="label">نسبة الاشتباه</div>
        <div class="value">${fmtPct(kpis.suspicionRate)}</div>
        <div class="note">${fmtNum(kpis.suspiciousCount)} صورة</div>
      </div><div class="kpi-icon">⌕</div></div>

      <div class="kpi-card teal"><div>
        <div class="label">دقة النتائج</div>
        <div class="value">${kpis.overallAccuracy !== null ? fmtPct(kpis.overallAccuracy) : "—"}</div>
        <div class="note">مقابل نتيجة الخبير</div>
      </div><div class="kpi-icon">✓</div></div>

      <div class="kpi-card"><div>
        <div class="label">إنجاز العينة</div>
        <div class="value">${fmtPct(kpis.completionRate)}</div>
        <div class="note">${fmtNum(kpis.studiedImages)} من ${fmtNum(kpis.totalSample)}</div>
      </div><div class="kpi-icon">↗</div></div>

      <div class="kpi-card ${kpis.missedSuspicionRate !== null && kpis.missedSuspicionRate > config.maximumMissedSuspicionRate ? "" : "teal"}"><div>
        <div class="label">اشتباه فائت</div>
        <div class="value" style="${kpis.missedSuspicionRate !== null && kpis.missedSuspicionRate > config.maximumMissedSuspicionRate ? "color:var(--red)" : ""}">${fmtPct(kpis.missedSuspicionRate)}</div>
        <div class="note">الحد الأقصى ${fmtPct(config.maximumMissedSuspicionRate)}</div>
      </div><div class="kpi-icon">⚠</div></div>
    </div>

    <div class="progress-bar-row">
      <span class="pb-label">إنجاز الخطة الشهرية</span>
      <div class="pb-track"><div class="pb-fill" style="width:${completionPct}%"></div></div>
      <span class="pb-value">${fmtPct(kpis.completionRate)} — ${fmtNum(kpis.studiedImages)} / ${config.monthlyTarget > 0 ? fmtNum(config.monthlyTarget) : fmtNum(kpis.totalSample)}</span>
    </div>

    <div class="grid-3col">
      <div class="card">
        <div class="card-title"><span>المجتمع مقابل العينة (أعلى 5 منافذ)</span>
          <div class="legend">
            <span><i style="background:var(--navy-900)"></i>مجتمع</span>
            <span><i style="background:var(--teal-600)"></i>عينة</span>
          </div>
        </div>
        <div class="bar-chart">${portBarChart(kpis.portProfiles)}</div>
      </div>
      <div class="card">
        <div class="card-title"><span>توزيع نتيجة الصورة</span></div>
        ${donutChart(kpis.cleanCount, kpis.suspiciousCount)}
        <div class="note-box" style="text-align:center">نسبة الاشتباه الكلية <b style="color:var(--teal-700)">${fmtPct(kpis.suspicionRate)}</b></div>
      </div>
      <div class="card">
        <div class="card-title"><span>دقة المنافذ — أعلى 5</span></div>
        <div class="rank-list">${portRankList(kpis.portProfiles)}</div>
        <div class="note-box" style="text-align:center">متوسط الدقة <b style="color:var(--teal-700)">${kpis.overallAccuracy !== null ? fmtPct(kpis.overallAccuracy) : "—"}</b></div>
      </div>
    </div>

    <div class="insights-strip">
      <div class="insight-head"><strong>رؤى وتوصيات</strong><span>أولويات تطوير الأداء</span></div>
      ${insightItems}
    </div>
    <div class="footer"><span>التقرير التنفيذي — ضمان جودة الأشعة</span><span class="page">1 / 5</span></div>
  </section>`;
}

function slide2(kpis: ExecutiveKPIs, monthLabel: string): string {
  return `<section class="slide" data-title="تحليل المنافذ">
    <div class="slide-header">
      <div class="title-group"><h1 class="report-title">التقرير التنفيذي</h1><h2 class="section-title">تحليل أداء المنافذ</h2></div>
      <span class="period-chip">${esc(monthLabel)}</span>
    </div>

    <div class="grid-2-wide">
      <div class="card">
        <div class="card-title"><span>مقارنة المنافذ</span><span class="card-subtitle">المجتمع والعينة والاشتباه والدقة</span></div>
        <table class="port-table">
          <thead><tr>
            <th>المنفذ</th><th>المجتمع</th><th>سليمة</th><th>اشتباه</th>
            <th>نسبة الاشتباه</th><th>العينة</th><th>التغطية</th><th>الدقة</th>
          </tr></thead>
          <tbody>${portTableRows(kpis.portProfiles)}</tbody>
        </table>
      </div>

      <div style="display:grid;grid-template-rows:1fr 1fr;gap:.12in">
        <div class="card">
          <div class="card-title"><span>سليمة مقابل اشتباه بالمنافذ</span>
            <div class="legend">
              <span><i style="background:var(--teal-500)"></i>سليمة</span>
              <span><i style="background:var(--navy-900)"></i>اشتباه</span>
            </div>
          </div>
          <div class="port-visual">${stackedBars(kpis.portProfiles)}</div>
        </div>
        <div class="card">
          <div class="card-title"><span>دقة المنافذ — المستوى الأول / الثاني</span>
            <div class="legend">
              <span><i style="background:var(--navy-900)"></i>م.أول</span>
              <span><i style="background:var(--teal-500)"></i>م.ثاني</span>
            </div>
          </div>
          <div class="dual-bars">${dualBarsPerPort(kpis.portProfiles)}</div>
        </div>
      </div>
    </div>

    <div class="footer"><span>تحليل المنافذ</span><span class="page">2 / 5</span></div>
  </section>`;
}

function slide3(kpis: ExecutiveKPIs, config: ExecutiveReportConfig, monthLabel: string): string {
  const targetRows = [
    {
      label: "إنجاز العينة",
      current: fmtPct(kpis.completionRate),
      target: config.completionTarget > 0 ? `≥ ${fmtPct(config.completionTarget)}` : "—",
      met: config.completionTarget > 0 && kpis.completionRate >= config.completionTarget,
    },
    {
      label: "دقة النتائج",
      current: kpis.overallAccuracy !== null ? fmtPct(kpis.overallAccuracy) : "—",
      target: config.accuracyTarget > 0 ? `≥ ${fmtPct(config.accuracyTarget)}` : "—",
      met: kpis.overallAccuracy !== null && kpis.overallAccuracy >= config.accuracyTarget,
    },
    {
      label: "تغطية المجتمع",
      current: fmtPct(kpis.sampleCoverage),
      target: config.coverageTarget > 0 ? `≥ ${fmtPct(config.coverageTarget)}` : "—",
      met: config.coverageTarget > 0 && kpis.sampleCoverage >= config.coverageTarget,
    },
    {
      label: "اشتباه فائت",
      current: fmtPct(kpis.missedSuspicionRate),
      target: config.maximumMissedSuspicionRate > 0 ? `≤ ${fmtPct(config.maximumMissedSuspicionRate)}` : "—",
      met: kpis.missedSuspicionRate !== null && config.maximumMissedSuspicionRate > 0 && kpis.missedSuspicionRate <= config.maximumMissedSuspicionRate,
    },
  ];

  return `<section class="slide" data-title="التغطية والمستويات">
    <div class="slide-header">
      <div class="title-group"><h1 class="report-title">التقرير التنفيذي</h1><h2 class="section-title">تغطية العينة بالمستويات ومتابعة الخطة</h2></div>
      <span class="period-chip">${esc(monthLabel)}</span>
    </div>

    <div class="grid-4">${stageCoverageCards(kpis.stageProfiles)}</div>

    <div class="grid-2" style="margin-top:.14in">
      <div class="card">
        <div class="card-title"><span>متابعة الخطة الشهرية</span></div>
        <div class="plan-kpis">
          <div class="plan-kpi"><span>المستهدف</span><b>${config.monthlyTarget > 0 ? fmtNum(config.monthlyTarget) : "—"}</b></div>
          <div class="plan-kpi teal"><span>العينة</span><b>${fmtNum(kpis.totalSample)}</b></div>
          <div class="plan-kpi teal"><span>المدروسة</span><b>${fmtNum(kpis.studiedImages)}</b></div>
          <div class="plan-kpi"><span>المتبقي</span><b>${fmtNum(kpis.remainingImages)}</b></div>
        </div>
        <table class="simple-table" style="margin-top:.1in">
          <thead><tr><th>المؤشر</th><th>الحالي</th><th>المستهدف</th><th>الحالة</th></tr></thead>
          <tbody>${targetRows.map((r) => `<tr>
            <td>${r.label}</td>
            <td class="ltr">${r.current}</td>
            <td class="ltr">${r.target}</td>
            <td><span class="status-pill ${r.target === "—" ? "muted" : r.met ? "good" : "bad"}">${r.target === "—" ? "غير محدد" : r.met ? "محقق" : "دون الهدف"}</span></td>
          </tr>`).join("")}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title"><span>مؤشرات جودة التحقق</span></div>
        <div class="quality-grid">
          <div class="q-item teal"><b>${fmtPct(kpis.overallAccuracy)}</b><span>دقة نتيجة الصورة</span></div>
          <div class="q-item teal"><b>${fmtPct(kpis.suspiciousDetectionRate)}</b><span>قوة اكتشاف الاشتباه</span></div>
          <div class="q-item ${kpis.missedSuspicionRate !== null && kpis.missedSuspicionRate > config.maximumMissedSuspicionRate ? "red" : ""}">
            <b>${fmtPct(kpis.missedSuspicionRate)}</b><span>نسبة الاشتباه الفائت</span></div>
          <div class="q-item"><b>${fmtPct(kpis.suspicionPrecision)}</b><span>دقة الاشتباه (الخصوصية)</span></div>
          <div class="q-item teal"><b>${fmtPct(kpis.levelOneAccuracy)}</b><span>دقة المستوى الأول</span></div>
          <div class="q-item teal"><b>${fmtPct(kpis.levelTwoAccuracy)}</b><span>دقة المستوى الثاني</span></div>
          <div class="q-item" style="grid-column:1/-1"><b style="font-size:.2in">${fmtPct(kpis.balancedQualityScore)}</b><span>مؤشر الجودة المتوازن</span></div>
        </div>
      </div>
    </div>

    <div class="footer"><span>التغطية والمستويات</span><span class="page">3 / 5</span></div>
  </section>`;
}

function slide4(kpis: ExecutiveKPIs, monthLabel: string): string {
  const total = kpis.validStudied;
  const pctRow = (n: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—";

  const bothCorrect = kpis.validStudied > 0 && kpis.levelOneAccuracy !== null && kpis.levelTwoAccuracy !== null
    ? Math.round((Math.min(kpis.levelOneAccuracy, kpis.levelTwoAccuracy) / 100) * kpis.validStudied)
    : 0;

  return `<section class="slide" data-title="مصفوفة التحقق ومقارنة المستويين">
    <div class="slide-header">
      <div class="title-group"><h1 class="report-title">التقرير التنفيذي</h1><h2 class="section-title">مصفوفة التحقق ومقارنة دقة المستويين</h2></div>
      <span class="period-chip">${fmtNum(kpis.validStudied)} صورة مدروسة</span>
    </div>

    <div class="grid-2">
      <div>
        <div class="card" style="margin-bottom:.12in">
          <div class="card-title"><span>مصفوفة التحقق</span></div>
          <table class="verify-table">
            <thead><tr><th>م.الأول</th><th>م.الثاني</th><th>نتيجة الصورة</th><th>نتيجة الخبير</th><th>التصنيف</th><th>العدد</th><th>النسبة</th></tr></thead>
            <tbody>
              <tr><td>اشتباه</td><td>اشتباه</td><td>اشتباه</td><td>اشتباه</td>
                <td><span class="status-pill good">اشتباه مكتشف</span></td>
                <td class="ltr">${fmtNum(kpis.correctSuspicious)}</td><td class="ltr">${pctRow(kpis.correctSuspicious)}</td></tr>
              <tr><td>سليمة</td><td>سليمة</td><td>سليمة</td><td>سليمة</td>
                <td><span class="status-pill good">سليمة مؤكدة</span></td>
                <td class="ltr">${fmtNum(kpis.correctClean)}</td><td class="ltr">${pctRow(kpis.correctClean)}</td></tr>
              <tr><td colspan="2" style="text-align:center">أي منهما اشتباه</td><td>اشتباه</td><td>سليمة</td>
                <td><span class="status-pill warn">اشتباه زائد</span></td>
                <td class="ltr">${fmtNum(kpis.excessSuspicious)}</td><td class="ltr">${pctRow(kpis.excessSuspicious)}</td></tr>
              <tr><td colspan="2" style="text-align:center">كلاهما سليمة</td><td>سليمة</td><td>اشتباه</td>
                <td><span class="status-pill bad">اشتباه فائت ⚠</span></td>
                <td class="ltr">${fmtNum(kpis.missedSuspicious)}</td><td class="ltr">${pctRow(kpis.missedSuspicious)}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="summary-3">
          <div class="summary-item">
            <div class="summary-icon">✓</div>
            <div><div class="summary-label">حالات دقيقة</div>
              <div class="summary-value">${fmtNum(kpis.correctSuspicious + kpis.correctClean)}</div>
              <div class="summary-note">${kpis.overallAccuracy !== null ? fmtPct(kpis.overallAccuracy) + " دقة" : "—"}</div></div>
          </div>
          <div class="summary-item">
            <div class="summary-icon bad">⚠</div>
            <div><div class="summary-label">اشتباه فائت</div>
              <div class="summary-value bad">${fmtNum(kpis.missedSuspicious)}</div>
              <div class="summary-note">${fmtPct(kpis.missedSuspicionRate)} من حالات الخبير</div></div>
          </div>
          <div class="summary-item">
            <div class="summary-icon">◇</div>
            <div><div class="summary-label">قوة الاكتشاف</div>
              <div class="summary-value">${fmtPct(kpis.suspiciousDetectionRate)}</div>
              <div class="summary-note">اكتشاف الاشتباه الفعلي</div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span>مقارنة المستوى الأول والثاني</span></div>
        <div class="compare-cards">
          <div class="compare-card good">
            <b>${fmtNum(bothCorrect)}</b>
            <span>كلا المستويين متطابقان مع الخبير</span>
          </div>
          <div class="compare-card warn">
            <b>${fmtNum(kpis.validStudied > 0 ? Math.round(((kpis.levelTwoCorrectionRate ?? 0) / 100) * kpis.validStudied) : 0)}</b>
            <span>المستوى الثاني صحّح خطأ الأول</span>
          </div>
          <div class="compare-card">
            <b>${fmtNum(kpis.validStudied > 0 ? Math.round(((kpis.levelTwoRegressionRate ?? 0) / 100) * kpis.validStudied) : 0)}</b>
            <span>الأول صحيح والثاني غير مطابق</span>
          </div>
          <div class="compare-card bad">
            <b>${fmtNum(kpis.validStudied > 0 ? kpis.validStudied - bothCorrect - Math.round(((kpis.levelTwoCorrectionRate ?? 0) / 100) * kpis.validStudied) - Math.round(((kpis.levelTwoRegressionRate ?? 0) / 100) * kpis.validStudied) : 0)}</b>
            <span>كلاهما غير مطابق للخبير</span>
          </div>
        </div>

        <div style="margin-top:.14in">
          <div class="card-title" style="margin-bottom:.08in"><span>الدقة حسب المنفذ — م.أول / م.ثاني</span></div>
          <div class="dual-bars">${dualBarsPerPort(kpis.portProfiles)}</div>
        </div>

        <div class="grid-2" style="margin-top:.13in;gap:.08in">
          <div class="q-item teal" style="border-radius:12px;padding:.09in"><b>${fmtPct(kpis.levelOneAccuracy)}</b><span>دقة المستوى الأول</span></div>
          <div class="q-item teal" style="border-radius:12px;padding:.09in"><b>${fmtPct(kpis.levelTwoAccuracy)}</b><span>دقة المستوى الثاني</span></div>
        </div>
      </div>
    </div>

    <div class="footer"><span>مصفوفة التحقق ومقارنة المستويين</span><span class="page">4 / 5</span></div>
  </section>`;
}

function slide5(kpis: ExecutiveKPIs, config: ExecutiveReportConfig): string {
  const findings = generateNarrativeFindings(kpis, config);

  const decisions = [
    ...kpis.portProfiles.filter((p) => p.status === "priority").slice(0, 2).map((p) => ({
      action: `مراجعة مركزة لمنفذ ${p.portName}`,
      reason: `دقة ${fmtPct(p.accuracy)} واشتباه فائت ${fmtPct(p.missedSuspicionRate)}.`,
      owner: "ضمان الجودة",
    })),
    kpis.completionRate < config.completionTarget && config.completionTarget > 0 ? {
      action: "تسريع استكمال دراسة العينة",
      reason: `الإنجاز الحالي ${fmtPct(kpis.completionRate)} دون المستهدف ${fmtPct(config.completionTarget)}.`,
      owner: "التوزيع",
    } : null,
    kpis.levelDisagreementRate !== null && kpis.levelDisagreementRate > 10 ? {
      action: "مراجعة تناقض المستويين",
      reason: `نسبة الاختلاف ${fmtPct(kpis.levelDisagreementRate)}.`,
      owner: "الجودة التقنية",
    } : null,
    { action: "اعتماد توزيع العينة للشهر القادم", reason: "تحديث نسبة العينة بناءً على أداء المنافذ.", owner: "إدارة العينة" },
    { action: "اعتماد التقرير وتوزيعه", reason: "إقرار النتائج قبل التوزيع على الجهات المعنية.", owner: "القيادة" },
  ].filter(Boolean).slice(0, 5) as Array<{ action: string; reason: string; owner: string }>;

  return `<section class="slide" data-title="أولويات التدخل والقرارات">
    <div class="slide-header">
      <div class="title-group"><h1 class="report-title">التقرير التنفيذي</h1><h2 class="section-title">أولويات التدخل والقرارات المقترحة</h2></div>
      <span class="period-chip">دورة العمل القادمة</span>
    </div>

    <div class="grid-2">
      <div>
        <div class="card" style="margin-bottom:.12in">
          <div class="card-title"><span>تصنيف المنافذ حسب الأولوية</span></div>
          <div class="priority-grid">${priorityPortCards(kpis.portProfiles)}</div>
        </div>
        <div class="card">
          <div class="card-title"><span>مؤشرات نجاح الخطة</span></div>
          <div class="quality-grid">
            <div class="q-item"><b>${config.accuracyTarget > 0 ? `≥${fmtPct(config.accuracyTarget, 0)}` : "—"}</b><span>دقة المنافذ المستهدفة</span></div>
            <div class="q-item red"><b>${config.maximumMissedSuspicionRate > 0 ? `≤${fmtPct(config.maximumMissedSuspicionRate, 0)}` : "—"}</b><span>حد الاشتباه الفائت</span></div>
            <div class="q-item teal"><b>${config.completionTarget > 0 ? fmtPct(config.completionTarget, 0) : "—"}</b><span>إنجاز العينة المستهدف</span></div>
            <div class="q-item"><b>${config.coverageTarget > 0 ? `≥${fmtPct(config.coverageTarget, 0)}` : "—"}</b><span>تغطية المجتمع</span></div>
          </div>
        </div>
      </div>

      <div>
        <div class="card" style="margin-bottom:.12in">
          <div class="card-title"><span>قرارات قابلة للتنفيذ</span></div>
          <div class="decision-list">
            ${decisions.map((d, i) => `<div class="decision">
              <div class="decision-no">${i + 1}</div>
              <div><strong>${esc(d.action)}</strong><span>${esc(d.reason)}</span></div>
              <div class="owner">${esc(d.owner)}</div>
            </div>`).join("")}
          </div>
        </div>
        <div class="executive-callout">
          <h3>الرسالة التنفيذية</h3>
          <p>${esc(findings[findings.length - 1] ?? "استكمال دراسة العينة والمراجعة الدورية لمؤشرات الجودة.")}</p>
          <div class="big">${fmtNum(kpis.portProfiles.filter((p) => p.status === "priority" || p.status === "monitor").length)}</div>
          <div class="small">منفذ يحتاج متابعة أو تحسين</div>
        </div>
      </div>
    </div>

    <div class="footer"><span>أولويات التدخل والقرارات</span><span class="page">5 / 5</span></div>
  </section>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@page{size:13.333in 7.5in;margin:0;}
@font-face{font-family:"Somar Report";src:local("Somar Bold"),local("Somar Medium"),local("Somar"),local("Somar Light"),local("Noto Sans Arabic"),local("Segoe UI");font-weight:100 900;}
:root{
  --navy-950:#06244a;--navy-900:#0a315f;--navy-800:#123f74;--navy-700:#20578e;
  --teal-700:#007e73;--teal-600:#00998a;--teal-500:#16aa9a;--teal-100:#daf5f0;
  --green:#15805f;--green-soft:#e8f8f1;--red:#c33232;--red-soft:#fff0f0;
  --amber:#a86b09;--amber-soft:#fff7df;--ink:#10233f;--muted:#637188;--muted-2:#8390a2;
  --line:#d8e3ef;--line-dark:#c3d3e3;--surface:#ffffff;--canvas:#edf3f8;
  --shadow:0 14px 38px rgba(9,42,80,.08);
}
*{box-sizing:border-box;}
html{background:var(--canvas);}
body{margin:0;color:var(--ink);background:var(--canvas);
  font-family:"Somar Report","Somar","Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif;
  font-weight:500;direction:rtl;}
button{font:inherit;}

/* Toolbar */
.toolbar{position:sticky;top:0;z-index:100;display:flex;align-items:center;
  justify-content:space-between;gap:14px;padding:10px 16px;
  background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);
  box-shadow:0 8px 24px rgba(9,42,80,.08);backdrop-filter:blur(14px);}
.toolbar-title strong{display:block;color:var(--navy-950);font-size:16px;font-weight:800;}
.toolbar-title span{display:block;color:var(--muted);font-size:12px;margin-top:2px;}
.toolbar-actions{display:flex;align-items:center;gap:8px;direction:ltr;}
.toolbar button{border:1px solid var(--line-dark);background:#fff;color:var(--navy-900);
  border-radius:12px;min-width:42px;height:38px;padding:0 13px;cursor:pointer;font-weight:800;}
.toolbar button.primary{background:var(--navy-900);color:#fff;border-color:var(--navy-900);}
.toolbar button:disabled{opacity:.35;cursor:not-allowed;}
.page-indicator{min-width:64px;text-align:center;color:var(--muted);font-size:13px;font-weight:800;direction:ltr;}

/* Deck & slide */
.deck{padding:22px 0 44px;}
.slide{position:relative;width:13.333in;height:7.5in;margin:0 auto 24px;
  padding:.3in .4in .26in;overflow:hidden;
  background:radial-gradient(circle at 4% 2%,rgba(20,169,153,.07),transparent 22%),
    linear-gradient(180deg,#fff 0%,#f8fbfe 100%);
  border:1px solid #d3e1ed;border-radius:24px;
  box-shadow:0 22px 54px rgba(9,42,80,.12);page-break-after:always;}
.slide::after{content:"";position:absolute;top:0;left:0;right:0;height:3px;
  background:linear-gradient(90deg,var(--navy-900),var(--teal-500));}
.slide:last-child{page-break-after:auto;}
body.presentation .slide{display:none;}
body.presentation .slide.active{display:block;}

/* Header */
.slide-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:.14in;}
.title-group{min-width:0;}
.report-title{color:var(--navy-950);font-size:.42in;line-height:1.06;font-weight:900;letter-spacing:-.02em;margin:0;}
.section-title{color:var(--navy-900);font-size:.21in;line-height:1.35;font-weight:800;margin:.04in 0 0;}
.section-title::after{content:"";display:block;width:.44in;height:3px;background:var(--teal-600);border-radius:99px;margin-top:.05in;}
.period-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;color:var(--navy-900);
  background:#f5f9fd;border:1px solid var(--line);padding:7px 12px;border-radius:999px;
  font-size:.095in;font-weight:800;}
.footer{position:absolute;left:.4in;right:.4in;bottom:.1in;display:flex;
  justify-content:space-between;align-items:center;padding-top:.05in;
  border-top:1px solid var(--line);color:var(--muted-2);font-size:.072in;}
.footer .page{direction:ltr;font-variant-numeric:tabular-nums;}

/* Cards */
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;
  box-shadow:var(--shadow);padding:.12in;overflow:hidden;}
.card-title{display:flex;align-items:center;justify-content:space-between;gap:10px;
  color:var(--navy-900);font-size:.13in;font-weight:850;margin-bottom:.07in;}
.card-subtitle{color:var(--muted);font-size:.074in;font-weight:600;}

/* KPI row */
.kpis-row{display:grid;grid-template-columns:repeat(6,1fr);gap:.09in;margin-bottom:.1in;}
.kpi-card{display:grid;grid-template-columns:1fr .42in;align-items:center;min-height:.82in;
  background:#fff;border:1px solid var(--line);border-radius:15px;padding:.09in .11in;
  box-shadow:0 8px 22px rgba(9,42,80,.05);}
.kpi-card .label{color:var(--navy-900);font-size:.083in;font-weight:800;}
.kpi-card .value{color:var(--navy-950);font-size:.22in;line-height:1.1;font-weight:900;margin-top:.02in;direction:ltr;text-align:right;font-variant-numeric:tabular-nums;}
.kpi-card .note{color:var(--muted);font-size:.066in;margin-top:.022in;}
.kpi-card.teal .value{color:var(--teal-700);}
.kpi-icon{width:.38in;height:.38in;border-radius:50%;display:grid;place-items:center;
  background:linear-gradient(145deg,#e6f7f4,#f5fbfa);color:var(--teal-700);font-size:.19in;font-weight:900;}

/* Progress bar */
.progress-bar-row{display:flex;align-items:center;gap:.1in;margin-bottom:.1in;background:#fff;
  border:1px solid var(--line);border-radius:12px;padding:.07in .12in;}
.pb-label{color:var(--navy-900);font-size:.078in;font-weight:800;white-space:nowrap;}
.pb-track{flex:1;height:.1in;background:#e7eef5;border-radius:999px;overflow:hidden;}
.pb-fill{height:100%;background:linear-gradient(90deg,var(--teal-500),var(--teal-700));border-radius:999px;}
.pb-value{color:var(--muted);font-size:.072in;font-weight:700;white-space:nowrap;direction:ltr;}

/* Grids */
.grid-3col{display:grid;grid-template-columns:1.2fr .9fr 1fr;gap:.12in;margin-bottom:.08in;}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:.13in;}
.grid-2-wide{display:grid;grid-template-columns:1.35fr .65fr;gap:.13in;}
.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:.1in;margin-bottom:.1in;}

/* Legend */
.legend{display:flex;gap:.1in;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:.068in;font-weight:700;}
.legend span{display:inline-flex;align-items:center;gap:.032in;}
.legend i{width:.08in;height:.08in;border-radius:3px;display:inline-block;}

/* Bar chart */
.bar-chart{height:1.9in;display:flex;align-items:flex-end;justify-content:space-evenly;
  gap:.07in;padding:.07in .04in .2in;position:relative;border-bottom:1px solid var(--line);}
.bar-group{height:100%;flex:1;display:flex;align-items:flex-end;justify-content:center;gap:.03in;position:relative;}
.bar{width:.16in;min-height:3px;border-radius:5px 5px 0 0;position:relative;z-index:2;}
.bar.total{background:linear-gradient(180deg,var(--navy-700),var(--navy-950));}
.bar.sample{background:linear-gradient(180deg,var(--teal-500),var(--teal-700));}
.bar-label{position:absolute;bottom:-.18in;left:50%;transform:translateX(-50%);width:1in;
  text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);font-size:.061in;font-weight:700;}
.bar-num{position:absolute;top:-.13in;left:50%;transform:translateX(-50%);
  font-size:.055in;color:var(--navy-800);font-weight:850;direction:ltr;white-space:nowrap;}

/* Donut */
.donut-wrap{height:1.9in;display:grid;place-items:center;position:relative;}
.donut{width:1.52in;height:1.52in;border-radius:50%;position:relative;}
.donut::after{content:"";position:absolute;inset:.26in;background:#fff;border-radius:50%;box-shadow:0 0 0 1px var(--line);}
.donut-center{position:absolute;text-align:center;z-index:3;color:var(--navy-900);font-weight:850;font-size:.088in;line-height:1.4;}
.donut-center b{display:block;font-size:.22in;color:var(--teal-700);direction:ltr;}
.donut-side{position:absolute;top:50%;transform:translateY(-50%);font-size:.069in;color:var(--muted);font-weight:800;text-align:center;}
.donut-side b{display:block;direction:ltr;font-size:.16in;color:var(--navy-900);}
.donut-side.right{right:.01in;}.donut-side.left{left:.01in;}

/* Rank list */
.rank-list{display:grid;gap:.077in;padding-top:.02in;}
.rank-row{display:grid;grid-template-columns:.22in .75in 1fr .44in;gap:.06in;align-items:center;}
.rank-no{width:.2in;height:.2in;border-radius:50%;background:var(--teal-600);color:#fff;display:grid;place-items:center;font-size:.07in;font-weight:900;}
.rank-name{color:var(--muted);font-size:.069in;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rank-track{height:.1in;background:#e8eff6;border-radius:999px;overflow:hidden;}
.rank-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--navy-700),var(--navy-950));}
.rank-value{color:var(--teal-700);direction:ltr;font-size:.072in;font-weight:900;text-align:left;}

/* Insights */
.insights-strip{margin-top:.09in;display:grid;grid-template-columns:.64fr 1fr 1fr 1fr;gap:0;
  background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:var(--shadow);}
.insight-head{padding:.09in .12in;min-height:.66in;display:flex;flex-direction:column;justify-content:center;}
.insight-head strong{color:var(--navy-900);font-size:.13in;}
.insight-head span{color:var(--muted);font-size:.068in;display:block;}
.insight-item{padding:.09in .12in;border-right:1px solid var(--line);min-height:.66in;display:flex;align-items:center;gap:.07in;}
.insight-num{flex:0 0 auto;width:.22in;height:.22in;border-radius:50%;background:var(--teal-600);color:#fff;display:grid;place-items:center;font-size:.07in;font-weight:900;}
.insight-item span{color:var(--muted);font-size:.066in;line-height:1.55;display:block;}

/* Tables */
.port-table,.verify-table,.simple-table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid var(--line);border-radius:12px;font-size:.07in;}
.port-table th,.verify-table th,.simple-table th{background:var(--navy-900);color:#fff;font-weight:850;padding:.065in .045in;text-align:center;}
.port-table td,.verify-table td,.simple-table td{padding:.055in .04in;border-bottom:1px solid var(--line);text-align:center;color:#2a3e59;font-weight:650;}
.port-table tr:last-child td,.simple-table tr:last-child td,.verify-table tr:last-child td{border-bottom:0;}
.port-table tbody tr:nth-child(even) td,.simple-table tbody tr:nth-child(even) td{background:#f9fbfd;}
.port-table .port-name{color:var(--navy-900);font-weight:850;text-align:right;}
.ltr{direction:ltr;font-variant-numeric:tabular-nums;}

/* Status pills */
.status-pill{display:inline-flex;align-items:center;justify-content:center;min-width:.6in;padding:.023in .065in;border-radius:999px;font-weight:850;font-size:.064in;}
.status-pill.good{color:var(--green);background:var(--green-soft);}
.status-pill.bad{color:var(--red);background:var(--red-soft);}
.status-pill.warn{color:var(--amber);background:var(--amber-soft);}
.status-pill.muted{color:var(--muted);background:#f1f5f9;}

/* Stacked bars */
.port-visual{display:grid;gap:.068in;}
.port-row{display:grid;grid-template-columns:.85in 1fr .54in;gap:.065in;align-items:center;}
.port-row .name{font-size:.069in;color:var(--navy-900);font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.stack-track{height:.125in;background:#e8eff6;border-radius:999px;overflow:hidden;display:flex;direction:rtl;}
.stack-clean{background:var(--teal-500);}
.stack-susp{background:var(--navy-900);}
.port-row .pct{color:var(--muted);font-size:.065in;font-weight:800;direction:ltr;text-align:left;}

/* Dual bars */
.dual-bars{display:grid;gap:.1in;}
.dual-row{display:grid;grid-template-columns:.88in 1fr .46in;gap:.065in;align-items:center;}
.dual-label{color:var(--navy-900);font-size:.072in;font-weight:800;}
.dual-track{height:.14in;background:#e8eff6;border-radius:999px;overflow:hidden;display:flex;}
.dual-track .a{background:var(--navy-900);height:100%;}
.dual-track .b{background:var(--teal-500);height:100%;}
.dual-value{direction:ltr;color:var(--muted);font-size:.067in;font-weight:850;text-align:left;}

/* Stage cards */
.stage-card{background:#fff;border:1px solid var(--line);border-radius:15px;padding:.1in;box-shadow:0 8px 22px rgba(9,42,80,.05);}
.stage-head{margin-bottom:.068in;}
.stage-head strong{color:var(--navy-900);font-size:.11in;}
.stage-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:.04in;}
.stage-metric{border-right:1px solid var(--line);padding-right:.05in;}
.stage-metric:last-child{border-right:0;}
.stage-metric span{display:block;color:var(--muted);font-size:.056in;line-height:1.3;}
.stage-metric b{display:block;color:var(--navy-950);font-size:.13in;direction:ltr;margin-top:.018in;}
.stage-metric.teal b{color:var(--teal-700);}
.progress{height:.055in;background:#e7eef5;border-radius:999px;overflow:hidden;margin-top:.07in;}
.progress>i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--teal-500),var(--teal-700));}

/* Plan KPIs */
.plan-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:.08in;margin-bottom:.09in;}
.plan-kpi{text-align:center;padding:.08in .06in;background:#f7fafc;border-radius:12px;border:1px solid var(--line);}
.plan-kpi span{display:block;color:var(--muted);font-size:.063in;font-weight:700;}
.plan-kpi b{display:block;color:var(--navy-950);font-size:.18in;direction:ltr;line-height:1.1;margin-top:.02in;}
.plan-kpi.teal b{color:var(--teal-700);}

/* Quality grid */
.quality-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.08in;}
.q-item{text-align:center;padding:.09in .06in;background:#f7fafc;border:1px solid var(--line);border-radius:12px;}
.q-item b{display:block;color:var(--navy-950);font-size:.18in;font-weight:900;direction:ltr;}
.q-item span{display:block;color:var(--muted);font-size:.063in;margin-top:.02in;}
.q-item.teal b{color:var(--teal-700);}
.q-item.red b{color:var(--red);}

/* Verification matrix */
.verify-table{font-size:.082in;border-radius:14px;}
.verify-table th{padding:.08in .045in;font-size:.085in;}
.verify-table td{padding:.068in .045in;font-size:.078in;}

/* Summary strip */
.summary-3{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-top:.1in;background:#fff;border:1px solid var(--line);border-radius:15px;overflow:hidden;box-shadow:var(--shadow);}
.summary-item{min-height:.78in;display:grid;grid-template-columns:.42in 1fr;align-items:center;gap:.07in;padding:.08in .14in;border-right:1px solid var(--line);}
.summary-item:last-child{border-right:0;}
.summary-icon{width:.38in;height:.38in;border-radius:50%;display:grid;place-items:center;background:#edf8f6;color:var(--teal-700);font-size:.18in;font-weight:900;}
.summary-icon.bad{background:var(--red-soft);color:var(--red);}
.summary-label{color:var(--navy-900);font-size:.08in;font-weight:850;}
.summary-value{color:var(--teal-700);font-size:.22in;font-weight:900;direction:ltr;line-height:1.1;}
.summary-value.bad{color:var(--red);}
.summary-note{color:var(--muted);font-size:.061in;}

/* Compare cards */
.compare-cards{display:grid;grid-template-columns:1fr 1fr;gap:.085in;}
.compare-card{border:1px solid var(--line);border-radius:13px;padding:.1in;background:#fff;}
.compare-card b{color:var(--navy-950);font-size:.22in;direction:ltr;display:block;}
.compare-card span{color:var(--muted);font-size:.069in;line-height:1.45;display:block;}
.compare-card.good{background:var(--green-soft);border-color:#bde8d6;}
.compare-card.warn{background:var(--amber-soft);border-color:#f1db9e;}
.compare-card.bad{background:var(--red-soft);border-color:#f0c9c9;}

/* Priority cards */
.priority-grid{display:grid;grid-template-columns:1fr 1fr;gap:.076in;margin-bottom:.09in;}
.priority-card{border:1px solid var(--line);border-radius:13px;padding:.09in;background:#fff;}
.priority-card strong{display:block;font-size:.078in;color:var(--navy-900);}
.priority-card span{display:block;color:var(--muted);font-size:.063in;line-height:1.55;margin-top:.018in;}
.priority-card.red{border-right:4px solid var(--red);}
.priority-card.amber{border-right:4px solid var(--amber);}
.priority-card.teal{border-right:4px solid var(--teal-600);}
.priority-card.navy{border-right:4px solid var(--navy-900);}

/* Decisions */
.decision-list{display:grid;gap:.075in;}
.decision{display:grid;grid-template-columns:.26in 1fr .82in;gap:.07in;align-items:center;border:1px solid var(--line);border-radius:13px;padding:.09in .11in;background:#fff;}
.decision-no{width:.24in;height:.24in;border-radius:50%;background:var(--navy-900);color:#fff;display:grid;place-items:center;font-weight:900;direction:ltr;font-size:.075in;}
.decision strong{display:block;color:var(--navy-900);font-size:.08in;}
.decision span{display:block;color:var(--muted);font-size:.064in;line-height:1.55;margin-top:.012in;}
.decision .owner{text-align:center;color:var(--teal-700);font-size:.066in;font-weight:850;background:var(--teal-100);border-radius:999px;padding:.04in .065in;}

/* Executive callout */
.executive-callout{background:linear-gradient(145deg,var(--navy-950),var(--navy-800));color:#fff;border-radius:16px;padding:.14in;box-shadow:var(--shadow);position:relative;overflow:hidden;}
.executive-callout::before{content:"";position:absolute;width:1.8in;height:1.8in;border-radius:50%;background:rgba(28,183,166,.14);left:-.5in;bottom:-.7in;}
.executive-callout h3{color:#fff;font-size:.17in;margin:0 0 .07in;position:relative;}
.executive-callout p{color:#dbe7f3;font-size:.079in;line-height:1.75;position:relative;}
.executive-callout .big{color:#fff;font-size:.34in;font-weight:900;direction:ltr;margin:.13in 0 .018in;position:relative;}
.executive-callout .small{color:#b7cce0;font-size:.069in;position:relative;}

/* Note box */
.note-box{margin-top:.08in;padding:.068in .09in;background:#f7fafc;border:1px dashed var(--line-dark);border-radius:11px;color:var(--muted);font-size:.063in;line-height:1.55;}

/* Chart empty */
.chart-empty{color:var(--muted);text-align:center;padding:.3in;font-size:.078in;}

@media print{
  body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .toolbar{display:none!important;}
  .deck{padding:0;}
  body.presentation .slide,body.presentation .slide.active{display:block!important;}
  .slide{margin:0;border:0;border-radius:0;box-shadow:none;}
}`;

const NAV_SCRIPT = `
const slides=Array.from(document.querySelectorAll('.slide'));
const indicator=document.getElementById('pageIndicator');
const prevBtn=document.getElementById('prevBtn');
const nextBtn=document.getElementById('nextBtn');
let index=Math.min(Math.max((Number(new URLSearchParams(location.search).get('slide'))||1)-1,0),slides.length-1);
function showSlide(n){
  index=Math.min(Math.max(n,0),slides.length-1);
  slides.forEach((s,i)=>s.classList.toggle('active',i===index));
  indicator.textContent=\`\${index+1} / \${slides.length}\`;
  prevBtn.disabled=index===0;nextBtn.disabled=index===slides.length-1;
  document.title='التقرير التنفيذي — '+slides[index].dataset.title;
  history.replaceState(null,'',location.pathname+'?slide='+(index+1));
}
prevBtn.addEventListener('click',()=>showSlide(index-1));
nextBtn.addEventListener('click',()=>showSlide(index+1));
document.addEventListener('keydown',(e)=>{
  if(e.key==='ArrowLeft'||e.key==='PageDown')showSlide(index+1);
  if(e.key==='ArrowRight'||e.key==='PageUp')showSlide(index-1);
  if(e.key==='Home')showSlide(0);if(e.key==='End')showSlide(slides.length-1);
});
showSlide(index);`;

// ─── Main builder ─────────────────────────────────────────────────────────────
export function buildExecutiveReport(input: ExecutiveReportInput): string {
  const execRows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(execRows, input.sample, input.config);
  const monthLabel = input.monthFolderName;

  const slides = [
    slide1(kpis, input.config, monthLabel),
    slide2(kpis, monthLabel),
    slide3(kpis, input.config, monthLabel),
    slide4(kpis, monthLabel),
    slide5(kpis, input.config),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>التقرير التنفيذي — ${esc(monthLabel)}</title>
<style>${CSS}</style>
</head>
<body class="presentation">
  <div class="toolbar">
    <div class="toolbar-title">
      <strong>التقرير التنفيذي — ضمان جودة الأشعة</strong>
      <span>${esc(monthLabel)}</span>
    </div>
    <div class="toolbar-actions">
      <button id="prevBtn" title="السابق">‹</button>
      <span class="page-indicator" id="pageIndicator">1 / 5</span>
      <button id="nextBtn" title="التالي">›</button>
      <button class="primary" onclick="window.print()">طباعة / PDF</button>
    </div>
  </div>
  <main class="deck">${slides}</main>
  <script>${NAV_SCRIPT}</script>
</body>
</html>`;
}

export function openExecutiveReport(input: ExecutiveReportInput): void {
  openOrDownload(buildExecutiveReport(input), `التقرير_التنفيذي_${input.monthFolderName}.html`);
}

export function buildExecutiveXlsx(input: ExecutiveReportInput): void {
  const execRows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(execRows, input.sample, input.config);

  // Sheet 1: KPI summary
  const kpiSheet = [
    ["مؤشر", "القيمة"],
    ["الشهر", input.monthFolderName],
    [],
    ["إجمالي المجتمع", kpis.totalPopulation],
    ["إجمالي العينة", kpis.totalSample],
    ["تغطية المجتمع%", kpis.sampleCoverage?.toFixed(2) ?? ""],
    ["مدروسة", kpis.studiedImages],
    ["متبقية", kpis.remainingImages],
    ["إنجاز العينة%", kpis.completionRate?.toFixed(2) ?? ""],
    [],
    ["سليمة", kpis.cleanCount],
    ["اشتباه", kpis.suspiciousCount],
    ["نسبة الاشتباه%", kpis.suspicionRate?.toFixed(2) ?? ""],
    [],
    ["دقة نتيجة الصورة%", kpis.overallAccuracy?.toFixed(2) ?? ""],
    ["قوة اكتشاف الاشتباه%", kpis.suspiciousDetectionRate?.toFixed(2) ?? ""],
    ["اشتباه فائت%", kpis.missedSuspicionRate?.toFixed(2) ?? ""],
    ["دقة الاشتباه (الخصوصية)%", kpis.suspicionPrecision?.toFixed(2) ?? ""],
    ["مؤشر الجودة المتوازن%", kpis.balancedQualityScore?.toFixed(2) ?? ""],
    ["دقة المستوى الأول%", kpis.levelOneAccuracy?.toFixed(2) ?? ""],
    ["دقة المستوى الثاني%", kpis.levelTwoAccuracy?.toFixed(2) ?? ""],
    [],
    ["اشتباه مكتشف", kpis.correctSuspicious],
    ["سليمة مؤكدة", kpis.correctClean],
    ["اشتباه فائت (عدد)", kpis.missedSuspicious],
    ["اشتباه زائد", kpis.excessSuspicious],
    ["صور بتحقق صالح", kpis.validStudied],
  ];

  // Sheet 2: Port profiles
  const portSheet = [
    ["المنفذ", "المجتمع", "سليمة", "اشتباه", "نسبة الاشتباه%", "العينة", "التغطية%",
      "مدروسة", "إنجاز%", "دقة%", "اكتشاف الاشتباه%", "اشتباه فائت%",
      "دقة م.أول%", "دقة م.ثاني%", "التصنيف"],
    ...kpis.portProfiles.map((p) => [
      p.portName,
      p.population,
      p.clean,
      p.suspicious,
      p.suspicionRate?.toFixed(2) ?? "",
      p.sampleSize,
      p.coverage?.toFixed(2) ?? "",
      p.studied,
      p.completionRate?.toFixed(2) ?? "",
      p.accuracy?.toFixed(2) ?? "",
      p.suspiciousDetectionRate?.toFixed(2) ?? "",
      p.missedSuspicionRate?.toFixed(2) ?? "",
      p.levelOneAccuracy?.toFixed(2) ?? "",
      p.levelTwoAccuracy?.toFixed(2) ?? "",
      p.status,
    ]),
  ];

  // Sheet 3: Stage profiles
  const stageSheet = [
    ["المرحلة", "المجتمع", "العينة", "التغطية%", "مدروسة", "إنجاز%"],
    ...kpis.stageProfiles.map((s) => [
      s.stageLabel,
      s.population,
      s.sampleSize,
      s.coverage?.toFixed(2) ?? "",
      s.studied,
      s.completionRate?.toFixed(2) ?? "",
    ]),
  ];

  // Sheet 4: All individual image rows
  const rowSheet = [
    [
      "رقم الأشعة", "المنفذ", "المرحلة", "م.أول", "م.ثاني", "نتيجة الصورة",
      "في العينة", "الموظف", "حالة التوزيع", "نتيجة الخبير", "حالة الإجابة",
      "تاريخ التعيين", "تاريخ التسليم",
      "دقيق", "م.أول دقيق", "م.ثاني دقيق", "تصنيف التحقق",
    ],
    ...execRows.map((r) => [
      r.xrayImageId,
      r.portName ?? "",
      r.stage ?? "",
      r.levelOneResult,
      r.levelTwoResult,
      r.imageResult,
      r.selectedInSample ? "نعم" : "لا",
      r.assignedTo ?? "",
      r.distributionStatus ?? "",
      r.expertResult ?? "",
      r.answerStatus ?? "",
      r.assignedAt ?? "",
      r.submittedAt ?? "",
      r.imageResultAccurate === null ? "" : r.imageResultAccurate ? "نعم" : "لا",
      r.levelOneAccurate === null ? "" : r.levelOneAccurate ? "نعم" : "لا",
      r.levelTwoAccurate === null ? "" : r.levelTwoAccurate ? "نعم" : "لا",
      r.verificationCategory ?? "",
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiSheet), "مؤشرات الأداء");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(portSheet), "تحليل المنافذ");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stageSheet), "المراحل");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowSheet), "كل الصفوف");

  XLSX.writeFile(wb, `التقرير_التنفيذي_${input.monthFolderName}.xlsx`);
}
