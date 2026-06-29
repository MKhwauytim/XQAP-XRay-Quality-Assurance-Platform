import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";

export function buildExecIntro(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const cfg = ctx.input.config;

  const accOk  = kpis.overallAccuracy != null && kpis.overallAccuracy >= cfg.accuracyTarget;
  const cmpOk  = kpis.completionRate != null && kpis.completionRate >= cfg.completionTarget;
  const covOk  = kpis.sampleCoverage != null && kpis.sampleCoverage >= cfg.coverageTarget;

  const warning = kpis.overallAccuracy != null && kpis.overallAccuracy < cfg.accuracyTarget
    ? `<div class="info" style="margin-top:16px;border-color:rgba(255,118,95,.45);background:rgba(255,118,95,.06)">
        تحذير: الدقة الإجمالية (${fmtPct(kpis.overallAccuracy)}) أقل من الهدف المعتمد (${fmtPct(cfg.accuracyTarget)}). راجع نتائج الفحص والتحاليل المتقدمة لتفاصيل الفجوات.
      </div>`
    : '';

  return `<section class="page compact" id="page-intro" data-title="المقدمة التنفيذية">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">المقدمة</div>
    <div class="rail-tab">المعجم</div>
    <div class="rail-tab">الأجزاء</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">المقدمة التنفيذية</h2>
    <div class="section-subtitle">ملخص أداء شهر ${esc(ctx.monthLabel)} — بتاريخ ${esc(ctx.issueDate)}</div>
    <div class="grid grid-3" style="margin-bottom:16px">
      <div class="card"><h3>إجمالي الصور</h3><div class="metric gold">${fmtNum(kpis.totalPopulation)}</div></div>
      <div class="card"><h3>حجم العينة</h3><div class="metric blue">${fmtNum(kpis.totalSample)}</div></div>
      <div class="card"><h3>نسبة التغطية</h3><div class="metric ${covOk ? 'green' : 'gold'}">${fmtPct(kpis.sampleCoverage)}</div></div>
      <div class="card"><h3>الحالات المدروسة</h3><div class="metric blue">${fmtNum(kpis.studiedImages)}</div></div>
      <div class="card"><h3>نسبة الإنجاز</h3><div class="metric ${cmpOk ? 'green' : 'gold'}">${fmtPct(kpis.completionRate)}</div></div>
      <div class="card"><h3>الدقة الإجمالية</h3><div class="metric ${accOk ? 'green' : 'coral'}">${fmtPct(kpis.overallAccuracy)}</div></div>
    </div>
    <div class="section-subtitle" style="margin-top:4px">حالة الأقسام</div>
    <div class="grid grid-5" style="margin-bottom:14px">
      <div class="card" style="text-align:center"><div style="font-size:20px">${kpis.totalPopulation > 0 ? '✅' : '⬜'}</div><p class="muted">مجتمع الحالات</p></div>
      <div class="card" style="text-align:center"><div style="font-size:20px">${kpis.totalSample > 0 ? '✅' : '⬜'}</div><p class="muted">العينة</p></div>
      <div class="card" style="text-align:center"><div style="font-size:20px">${kpis.studiedImages > 0 ? '✅' : '⬜'}</div><p class="muted">التوزيع</p></div>
      <div class="card" style="text-align:center"><div style="font-size:20px">${kpis.overallAccuracy != null ? '✅' : '⬜'}</div><p class="muted">نتائج الدقة</p></div>
      <div class="card" style="text-align:center"><div style="font-size:20px">${kpis.validStudied > 0 ? '✅' : '⬜'}</div><p class="muted">أداء الموظفين</p></div>
    </div>
    ${warning}
    <div class="page-no">بدون ترقيم</div>
  </div>
</section>`;
}
