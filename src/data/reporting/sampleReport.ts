import * as XLSX from "xlsx";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { MonthManifestData } from "../population/monthTypes";
import { escHtml, formatNum, formatDate, openOrDownload } from "./htmlReport";

export type SampleReportInput = {
  monthFolderName: string;
  manifest: MonthManifestData | null;
  populationRows: PreparedPopulationRow[];
  sample: SampleMasterData;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pct(n: number, d: number): string {
  if (!d) return "—";
  return ((n / d) * 100).toFixed(1) + "%";
}

function stageLabel(key: string): string {
  const m: Record<string, string> = { first: "المرحلة الأولى", second: "المرحلة الثانية", third: "المرحلة الثالثة", fourth: "المرحلة الرابعة" };
  return m[key] ?? key;
}

// ─── HTML report builder ──────────────────────────────────────────────────────
export function buildSampleReport(input: SampleReportInput): string {
  const { monthFolderName, manifest, populationRows, sample } = input;

  // Index population rows by id for quick lookup
  const sampledIds = new Set(sample.rows.map((r) => r.xrayImageId));

  // Per-port stats from full population
  type PortStat = {
    population: number;
    raw: number;
    biRows: number;
    riskRows: number;
    certScan: number;
    nonCertScan: number;
    sample: number;
  };
  const portMap = new Map<string, PortStat>();
  for (const r of populationRows) {
    const port = r.portName ?? "غير محدد";
    let s = portMap.get(port);
    if (!s) { s = { population: 0, raw: 0, biRows: 0, riskRows: 0, certScan: 0, nonCertScan: 0, sample: 0 }; portMap.set(port, s); }
    s.population++;
    if (r.biEnrichmentStatus === "BI Matched") s.biRows++;
    else s.riskRows++;
    if (r.certScanStatus === "Certscan") s.certScan++;
    else s.nonCertScan++;
    if (sampledIds.has(r.xrayImageId)) s.sample++;
  }

  // Port allocations from sample master (authoritative)
  const portAllocMap = new Map(sample.portAllocations.map((p) => [p.portName, p]));

  // Sorted port list (by population desc)
  const portNames = [...portMap.entries()].sort((a, b) => b[1].population - a[1].population).map(([n]) => n);

  const portRows = portNames.map((port) => {
    const ps = portMap.get(port)!;
    const alloc = portAllocMap.get(port);
    return `<tr>
      <td class="bold">${escHtml(port)}</td>
      <td class="num">${formatNum(ps.population)}</td>
      <td class="num">${formatNum(ps.riskRows)}</td>
      <td class="num">${formatNum(ps.biRows)}</td>
      <td class="num">${formatNum(ps.certScan)}</td>
      <td class="num">${formatNum(ps.nonCertScan)}</td>
      <td class="num">${alloc ? formatNum(alloc.allocatedQuota) : "—"}</td>
      <td class="num">${alloc ? formatNum(alloc.actualCertScanDrawn) : "—"}</td>
      <td class="num">${alloc ? formatNum(alloc.actualNonCertScanDrawn) : "—"}</td>
      <td class="num bold">${formatNum(ps.sample)}</td>
      <td class="num">${pct(ps.sample, ps.population)}</td>
    </tr>`;
  }).join("");

  const stageRows = sample.stageAllocations.map((s) => `<tr>
    <td class="bold">${escHtml(stageLabel(s.stageKey))}</td>
    <td class="num">${formatNum(s.populationSize)}</td>
    <td class="num">${s.targetQuota > 0 ? formatNum(s.targetQuota) : "—"}</td>
    <td class="num bold">${formatNum(s.actualDrawn)}</td>
    <td class="num">${formatNum(s.certScanDrawn)}</td>
    <td class="num">${formatNum(s.nonCertScanDrawn)}</td>
    <td class="num">${pct(s.actualDrawn, s.populationSize)}</td>
  </tr>`).join("");

  const rawRows = manifest?.totalRawRows ?? populationRows.length;
  const processedRows = manifest?.totalProcessedRows ?? populationRows.length;
  const biCount = populationRows.filter((r) => r.biEnrichmentStatus === "BI Matched").length;
  const riskCount = populationRows.filter((r) => r.biEnrichmentStatus !== "BI Matched").length;
  const certCount = populationRows.filter((r) => r.certScanStatus === "Certscan").length;
  const nonCertCount = populationRows.filter((r) => r.certScanStatus !== "Certscan").length;

  const samplePreview = sample.rows.slice(0, 50).map((r) => `<tr>
    <td>${escHtml(r.xrayImageId)}</td>
    <td>${escHtml(r.portName ?? "—")}</td>
    <td>${escHtml(r.stage ?? "—")}</td>
    <td>${escHtml(r.certScanStatus)}</td>
    <td>${escHtml(r.biEnrichmentStatus)}</td>
    <td>${escHtml(r.xrayLevelOneResult)}</td>
    <td>${escHtml(r.xrayLevelTwoResult)}</td>
  </tr>`).join("");

  const css = `
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;direction:rtl;color:#1a2333;background:#f0f4f8;padding:28px;}
    .page{max-width:1200px;margin:0 auto;}
    h1{font-size:24px;color:#06244a;margin-bottom:6px;font-weight:800;}
    h2{font-size:15px;color:#06244a;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #c8d9ed;display:flex;align-items:center;gap:8px;}
    h2 .num{font-size:11px;background:#06244a;color:#fff;border-radius:99px;padding:2px 10px;font-weight:700;}
    .meta{color:#637188;font-size:12px;margin-bottom:20px;}
    .stat-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;}
    .stat{background:#fff;border:1px solid #d8e3ef;border-radius:10px;padding:14px 18px;min-width:130px;box-shadow:0 6px 18px rgba(9,42,80,.06);}
    .stat-label{font-size:11px;color:#637188;font-weight:600;}
    .stat-value{font-size:22px;font-weight:800;color:#06244a;direction:ltr;}
    .stat.teal .stat-value{color:#007e73;}
    .note{font-size:11px;color:#8390a2;margin-top:2px;}
    .section{background:#fff;border:1px solid #d8e3ef;border-radius:14px;overflow:hidden;margin-bottom:20px;box-shadow:0 8px 22px rgba(9,42,80,.07);}
    .section-inner{padding:16px 18px;}
    table{width:100%;border-collapse:collapse;font-size:12.5px;}
    th{background:#06244a;color:#fff;padding:8px 10px;text-align:right;font-weight:700;white-space:nowrap;}
    td{padding:7px 10px;border-bottom:1px solid #e8eff8;color:#2a3e59;}
    tr:nth-child(even) td{background:#f7fafc;}
    tr:last-child td{border-bottom:0;}
    .total-row td{background:#eef2f8!important;font-weight:800;color:#06244a;}
    .num{direction:ltr;text-align:left;font-variant-numeric:tabular-nums;}
    .bold{font-weight:700;color:#06244a;}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;}
    .pill-blue{background:#e7f0fb;color:#1a3f7a;}
    .pill-teal{background:#e3f7f4;color:#007e73;}
    .diff-row{background:#fff;border:1px solid #d8e3ef;border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;}
    .diff-item span{display:block;font-size:11px;color:#8390a2;}
    .diff-item b{font-size:18px;color:#06244a;direction:ltr;display:block;}
    .diff-arrow{font-size:22px;color:#c3d3e3;}
    .footer{color:#8390a2;font-size:11px;margin-top:30px;text-align:center;}
    @page {
      size: portrait;
      margin: 0;
    }
    @media print {
      body { background: #fff; padding: 15mm 20mm; }
      .no-print { display: none !important; }
    }
  `;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>تقرير العينة — ${escHtml(monthFolderName)}</title>
<style>${css}</style>
</head>
<body>
<div class="page">
  <h1>تقرير العينة — ${escHtml(monthFolderName)}</h1>
  <p class="meta">تاريخ السحب: ${formatDate(sample.drawnAt)} — بواسطة: ${escHtml(sample.drawnBy)} — بذرة: ${escHtml(sample.rngSeed)}</p>

  <!-- Summary stats -->
  <div class="stat-row">
    <div class="stat"><div class="stat-label">البيانات الخام</div><div class="stat-value">${formatNum(rawRows)}</div><div class="note">قبل المعالجة</div></div>
    <div class="stat"><div class="stat-label">بعد المعالجة</div><div class="stat-value">${formatNum(processedRows)}</div><div class="note">${rawRows > processedRows ? formatNum(rawRows - processedRows) + " محذوف" : "بدون حذف"}</div></div>
    <div class="stat"><div class="stat-label">مصدر Risk</div><div class="stat-value">${formatNum(riskCount)}</div></div>
    <div class="stat"><div class="stat-label">مصدر BI</div><div class="stat-value">${formatNum(biCount)}</div></div>
    <div class="stat"><div class="stat-label">CertScan</div><div class="stat-value">${formatNum(certCount)}</div></div>
    <div class="stat"><div class="stat-label">NonCertScan</div><div class="stat-value">${formatNum(nonCertCount)}</div></div>
    <div class="stat teal"><div class="stat-label">العينة المسحوبة</div><div class="stat-value">${formatNum(sample.totalActual)}</div><div class="note">${pct(sample.totalActual, processedRows)} تغطية</div></div>
    <div class="stat teal"><div class="stat-label">نسبة الإنجاز</div><div class="stat-value">${pct(sample.totalActual, sample.totalRequested)}</div><div class="note">${formatNum(sample.totalRequested)} مطلوب</div></div>
  </div>

  <!-- Raw vs processed -->
  <h2>البيانات الخام مقابل بعد المعالجة <span class="num">مقارنة</span></h2>
  <div class="diff-row">
    <div class="diff-item"><span>البيانات الخام</span><b>${formatNum(rawRows)}</b></div>
    <div class="diff-arrow">←</div>
    <div class="diff-item"><span>بعد التصفية والمعالجة</span><b>${formatNum(processedRows)}</b></div>
    <div class="diff-arrow">←</div>
    <div class="diff-item"><span>المحذوف</span><b style="color:#c33232">${formatNum(rawRows - processedRows)}</b></div>
    <div style="margin-right:auto;display:flex;gap:10px;flex-wrap:wrap">
      <span class="pill pill-blue">Risk: ${formatNum(riskCount)}</span>
      <span class="pill pill-teal">BI مطابق: ${formatNum(biCount)}</span>
    </div>
  </div>

  <!-- Port breakdown -->
  <h2>تفصيل المنافذ <span class="num">${portNames.length} منفذ</span></h2>
  <div class="section">
    <table>
      <thead><tr>
        <th>المنفذ</th><th>المجتمع</th><th>Risk</th><th>BI</th>
        <th>CertScan</th><th>NonCertScan</th>
        <th>المخصص</th><th>Cert مسحوب</th><th>NonCert مسحوب</th>
        <th>إجمالي العينة</th><th>التغطية</th>
      </tr></thead>
      <tbody>
        ${portRows}
        <tr class="total-row">
          <td>المجموع</td>
          <td class="num">${formatNum(processedRows)}</td>
          <td class="num">${formatNum(riskCount)}</td>
          <td class="num">${formatNum(biCount)}</td>
          <td class="num">${formatNum(certCount)}</td>
          <td class="num">${formatNum(nonCertCount)}</td>
          <td class="num">${formatNum(sample.totalRequested)}</td>
          <td class="num">${formatNum(sample.certScanActual)}</td>
          <td class="num">${formatNum(sample.nonCertScanActual)}</td>
          <td class="num">${formatNum(sample.totalActual)}</td>
          <td class="num">${pct(sample.totalActual, processedRows)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Stage breakdown -->
  <h2>توزيع العينة على المراحل <span class="num">${sample.stageAllocations.length} مراحل</span></h2>
  <div class="section">
    <table>
      <thead><tr>
        <th>المرحلة</th><th>المجتمع</th><th>المستهدف</th><th>المسحوب</th>
        <th>CertScan</th><th>NonCertScan</th><th>التغطية</th>
      </tr></thead>
      <tbody>
        ${stageRows}
        <tr class="total-row">
          <td>المجموع</td>
          <td class="num">${formatNum(sample.stageAllocations.reduce((s, r) => s + r.populationSize, 0))}</td>
          <td class="num">${formatNum(sample.totalRequested)}</td>
          <td class="num">${formatNum(sample.totalActual)}</td>
          <td class="num">${formatNum(sample.certScanActual)}</td>
          <td class="num">${formatNum(sample.nonCertScanActual)}</td>
          <td class="num">${pct(sample.totalActual, processedRows)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Sample drawn preview -->
  <h2>الصفوف المسحوبة للدراسة <span class="num">عرض أول 50 من ${formatNum(sample.rows.length)}</span></h2>
  <div class="section">
    <table>
      <thead><tr>
        <th>رقم الأشعة</th><th>المنفذ</th><th>المرحلة</th><th>CertScan</th>
        <th>مصدر BI</th><th>م.أول</th><th>م.ثاني</th>
      </tr></thead>
      <tbody>${samplePreview}</tbody>
    </table>
  </div>

  <p class="footer">تقرير العينة — ${escHtml(monthFolderName)} — توليد آلي بواسطة منصة ضمان جودة الأشعة</p>
</div>
</body>
</html>`;
}

// ─── XLSX export ──────────────────────────────────────────────────────────────
export function buildSampleXlsx(input: SampleReportInput): void {
  const { monthFolderName, manifest, populationRows, sample } = input;

  const rawRows = manifest?.totalRawRows ?? populationRows.length;
  const processedRows = manifest?.totalProcessedRows ?? populationRows.length;
  const sampledIds = new Set(sample.rows.map((r) => r.xrayImageId));

  // Sheet 1: Summary
  const summaryData = [
    ["التقرير", "تقرير العينة"],
    ["الشهر", monthFolderName],
    ["تاريخ السحب", sample.drawnAt],
    ["بواسطة", sample.drawnBy],
    ["البذرة", sample.rngSeed],
    [],
    ["البيانات الخام", rawRows],
    ["بعد المعالجة", processedRows],
    ["محذوف", rawRows - processedRows],
    ["مصدر Risk", populationRows.filter((r) => r.biEnrichmentStatus !== "BI Matched").length],
    ["مصدر BI", populationRows.filter((r) => r.biEnrichmentStatus === "BI Matched").length],
    ["CertScan", populationRows.filter((r) => r.certScanStatus === "Certscan").length],
    ["NonCertScan", populationRows.filter((r) => r.certScanStatus !== "Certscan").length],
    [],
    ["إجمالي العينة المطلوبة", sample.totalRequested],
    ["إجمالي العينة المسحوبة", sample.totalActual],
    ["CertScan المسحوب", sample.certScanActual],
    ["NonCertScan المسحوب", sample.nonCertScanActual],
  ];

  // Sheet 2: Port allocation
  const portAlloc: (string | number)[][] = [
    ["المنفذ", "المجتمع", "Risk", "BI", "CertScan", "NonCertScan", "المخصص", "Cert مسحوب", "NonCert مسحوب", "الإجمالي", "التغطية%"],
  ];
  const portAllocMap = new Map(sample.portAllocations.map((p) => [p.portName, p]));
  type PortStat = { population: number; bi: number; certScan: number };
  const portStatMap = new Map<string, PortStat>();
  for (const r of populationRows) {
    const port = r.portName ?? "غير محدد";
    let s = portStatMap.get(port);
    if (!s) { s = { population: 0, bi: 0, certScan: 0 }; portStatMap.set(port, s); }
    s.population++;
    if (r.biEnrichmentStatus === "BI Matched") s.bi++;
    if (r.certScanStatus === "Certscan") s.certScan++;
  }
  for (const [port, ps] of [...portStatMap.entries()].sort((a, b) => b[1].population - a[1].population)) {
    const alloc = portAllocMap.get(port);
    const sampleCount = sample.rows.filter((r) => r.portName === port).length;
    portAlloc.push([
      port,
      ps.population,
      ps.population - ps.bi,
      ps.bi,
      ps.certScan,
      ps.population - ps.certScan,
      alloc?.allocatedQuota ?? 0,
      alloc?.actualCertScanDrawn ?? 0,
      alloc?.actualNonCertScanDrawn ?? 0,
      sampleCount,
      processedRows > 0 ? +((sampleCount / processedRows) * 100).toFixed(2) : 0,
    ]);
  }

  // Sheet 3: Stage breakdown
  const stageData = [
    ["المرحلة", "المجتمع", "المستهدف", "المسحوب", "CertScan", "NonCertScan", "التغطية%"],
    ...sample.stageAllocations.map((s) => [
      stageLabel(s.stageKey),
      s.populationSize,
      s.targetQuota,
      s.actualDrawn,
      s.certScanDrawn,
      s.nonCertScanDrawn,
      processedRows > 0 ? +((s.actualDrawn / processedRows) * 100).toFixed(2) : 0,
    ]),
  ];

  // Sheet 4: Full sample rows
  const sampleSheet = [
    ["رقم الأشعة", "المنفذ", "المرحلة", "CertScan", "مصدر BI", "م.أول", "م.ثاني", "تاريخ الدخول", "رقم البيان", "نوع الحركة", "رسالة Risk"],
    ...sample.rows.map((r) => [
      r.xrayImageId,
      r.portName ?? "",
      r.stage ?? "",
      r.certScanStatus,
      r.biEnrichmentStatus,
      r.xrayLevelOneResult,
      r.xrayLevelTwoResult,
      r.xrayEntryDate ?? "",
      r.declarationNumber ?? "",
      r.movementType ?? "",
      r.riskMessage ?? "",
    ]),
  ];

  // Sheet 5: Full population (shows Risk + BI origins)
  const popSheet = [
    ["رقم الأشعة", "المنفذ", "المرحلة", "CertScan", "مصدر BI", "م.أول", "م.ثاني", "في العينة", "تاريخ الدخول", "رقم البيان"],
    ...populationRows.map((r) => [
      r.xrayImageId,
      r.portName ?? "",
      r.stage ?? "",
      r.certScanStatus,
      r.biEnrichmentStatus,
      r.xrayLevelOneResult,
      r.xrayLevelTwoResult,
      sampledIds.has(r.xrayImageId) ? "نعم" : "لا",
      r.xrayEntryDate ?? "",
      r.declarationNumber ?? "",
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "ملخص");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(portAlloc), "تفصيل المنافذ");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stageData), "المراحل");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sampleSheet), "العينة المسحوبة");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(popSheet), "كامل المجتمع");

  XLSX.writeFile(wb, `تقرير_العينة_${monthFolderName}.xlsx`);
}

export function openSampleReport(input: SampleReportInput): void {
  openOrDownload(buildSampleReport(input), `تقرير_العينة_${input.monthFolderName}.html`);
}
