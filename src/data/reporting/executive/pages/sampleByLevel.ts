import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";

export function buildSampleByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis, input } = ctx;
  const s = input.sample;
  const certScan = s ? fmtNum(s.certScanActual) : '—';
  const note = kpis.sampleCoverage !== null && kpis.sampleCoverage >= 99.9
    ? 'تم سحب كامل المجتمع في هذه الدورة، لذلك بلغت نسبة التغطية 100%.'
    : 'تم سحب العينة باستخدام خوارزمية هاميلتون للتوزيع الطبقي حسب المنفذ والمستوى.';

  const stageCards = kpis.stageProfiles.map((sp, i) => `
    <div class="card stage${i+1}">
      <div class="panel-title">${esc(sp.stageLabel)} — ${fmtNum(sp.sampleSize)}/${fmtNum(sp.population)}</div>
      <table>
        <thead><tr><th>البند</th><th>مجتمع المرحلة</th><th>العينة</th><th>التغطية</th></tr></thead>
        <tbody>
          <tr><td>جميع المنافذ</td><td>${fmtNum(sp.population)}</td><td>${fmtNum(sp.sampleSize)}</td><td>${fmtPct(sp.coverage)}</td></tr>
        </tbody>
      </table>
    </div>`).join('');

  return `<section class="page" id="page-sample" data-title="العينة">
  <div class="right-rail">
    <div class="rail-main">الجزء الأول <em>مجتمع الحالات</em></div>
    <div class="rail-tab">المجتمع</div>
    <div class="rail-tab active">العينة</div>
    <div class="rail-tab">التوزيع</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">العينة حسب المستويات والمنافذ</h2>
    <div class="section-subtitle">العينة المستهدفة ونسبة التغطية داخل كل مستوى</div>
    <div class="grid grid-4">
      <div class="card"><h3>إجمالي المجتمع</h3><div class="metric gold">${fmtNum(kpis.totalPopulation)}</div></div>
      <div class="card"><h3>إجمالي العينة</h3><div class="metric blue">${fmtNum(kpis.totalSample)}</div></div>
      <div class="card"><h3>نسبة التغطية</h3><div class="metric green">${fmtPct(kpis.sampleCoverage)}</div></div>
      <div class="card"><h3>نظام صور الأشعة المركزية</h3><div class="metric cyan">${certScan}</div></div>
    </div>
    <div class="info" style="margin:16px 0">${note}</div>
    <div class="grid grid-2">
      ${stageCards}
    </div>
    <div class="page-no">07</div>
  </div>
</section>`;
}
