import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";

export function buildSampleByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis, input } = ctx;
  const s = input.sample;
  const certScan = s ? fmtNum(s.certScanActual) : '—';
  const note = kpis.sampleCoverage !== null && kpis.sampleCoverage >= 99.9
    ? 'تم سحب كامل المجتمع في هذه الفترة، لذلك بلغت نسبة التغطية 100%.'
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

  // Bar rows showing coverage per stage
  const coverageBars = kpis.stageProfiles.map((sp, i) => {
    const pct = sp.coverage != null ? Math.min(100, sp.coverage) : 0;
    const col = ["gold","blue","slate","coral"][i] ?? "gold";
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px">
        <span>${esc(sp.stageLabel)}</span>
        <span style="color:var(--${col})">${fmtPct(sp.coverage)}</span>
      </div>
      <div class="bar"><i style="width:${pct.toFixed(1)}%;background:linear-gradient(90deg,var(--${col}),var(--${col === "gold" ? "gold-2" : col}))"></i></div>
    </div>`;
  }).join("");

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
    <div class="page-fill">
      <div class="grid grid-2">
        ${stageCards}
      </div>
      <div class="context-band">
        <div class="card">
          <div class="panel-title">منهجية سحب العينة</div>
          <ul class="method-list">
            <li>تُطبَّق خوارزمية هاميلتون لتوزيع حصص العينة بالتناسب بين المنافذ والمستويات.</li>
            <li>يُستخدم مولّد أعداد عشوائية مبني على بذرة ثابتة (Mulberry32) لضمان القابلية للتكرار.</li>
            <li>يُطبَّق خوارزمية فيشر-ييتس للسحب بدون إعادة داخل كل طبقة (منفذ × مستوى).</li>
            <li>عند نقص سعة منفذ معين، تُعاد توزيع الحصة الفائضة على المنافذ ذات الطاقة الزائدة.</li>
          </ul>
        </div>
        <div class="card">
          <div class="panel-title">نسب التغطية</div>
          <div style="margin-top:8px">
            ${coverageBars || '<span class="muted" style="font-size:0.82rem">لا توجد مستويات</span>'}
          </div>
        </div>
      </div>
    </div>
    <div class="page-no">07</div>
  </div>
</section>`;
}
