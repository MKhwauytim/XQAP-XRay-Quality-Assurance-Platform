import type { SampleMasterData } from "../sampling/sampleTypes";
import { buildReportHtml, escHtml, formatDate, formatNum } from "./htmlReport";

export function buildSampleReport(data: SampleMasterData, monthFolderName: string): string {
  const allocRows = data.portAllocations
    .map(
      (p) =>
        `<tr>
          <td>${escHtml(p.portName)}</td>
          <td>${formatNum(p.populationSize)}</td>
          <td>${formatNum(p.allocatedQuota)}</td>
          <td>${formatNum(p.actualCertScanDrawn)}</td>
          <td>${formatNum(p.actualNonCertScanDrawn)}</td>
          <td>${formatNum(p.actualTotalDrawn)}</td>
        </tr>`
    )
    .join("");

  const body = `
<p class="meta">الشهر: ${escHtml(monthFolderName)} — تم السحب: ${formatDate(data.drawnAt)} — بواسطة: ${escHtml(data.drawnBy)}</p>

<div class="stat-grid">
  <div class="stat-card"><div class="stat-label">المطلوب</div><div class="stat-value">${formatNum(data.totalRequested)}</div></div>
  <div class="stat-card"><div class="stat-label">المسحوب</div><div class="stat-value">${formatNum(data.totalActual)}</div></div>
  <div class="stat-card"><div class="stat-label">CertScan</div><div class="stat-value">${formatNum(data.certScanActual)}</div></div>
  <div class="stat-card"><div class="stat-label">NonCertScan</div><div class="stat-value">${formatNum(data.nonCertScanActual)}</div></div>
</div>

<h2>توزيع العينة على المنافذ</h2>
<table>
  <thead>
    <tr>
      <th>المنفذ</th>
      <th>المجتمع</th>
      <th>المخصص</th>
      <th>CertScan مسحوب</th>
      <th>NonCertScan مسحوب</th>
      <th>الإجمالي المسحوب</th>
    </tr>
  </thead>
  <tbody>
    ${allocRows}
    <tr class="total-row">
      <td>المجموع</td>
      <td>—</td>
      <td>${formatNum(data.totalRequested)}</td>
      <td>${formatNum(data.certScanActual)}</td>
      <td>${formatNum(data.nonCertScanActual)}</td>
      <td>${formatNum(data.totalActual)}</td>
    </tr>
  </tbody>
</table>

<h2>معاينة الصفوف المسحوبة (أول 20)</h2>
<table>
  <thead><tr><th>معرف الأشعة</th><th>المنفذ</th><th>المستوى</th><th>CertScan</th></tr></thead>
  <tbody>
    ${data.rows.slice(0, 20).map((r) => `<tr>
      <td>${escHtml(r.xrayImageId)}</td>
      <td>${escHtml(r.portName ?? "")}</td>
      <td>${escHtml(r.stage ?? "")}</td>
      <td>${escHtml(r.certScanStatus)}</td>
    </tr>`).join("")}
  </tbody>
</table>
<p class="meta">البذرة: ${escHtml(data.rngSeed)}</p>`;

  return buildReportHtml(`تقرير العينة — ${monthFolderName}`, body);
}
