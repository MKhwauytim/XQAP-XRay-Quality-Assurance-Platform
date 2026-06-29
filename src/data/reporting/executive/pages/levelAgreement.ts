import type { ExecutiveRenderContext } from "../context";
import { fmtPct } from "../primitives";

export function buildLevelAgreement(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const l1Pct = kpis.levelOneAccuracy ?? 0;
  const l2Pct = kpis.levelTwoAccuracy ?? 0;
  const diffPct = Math.abs(l1Pct - l2Pct);

  return `<section class="page compact" id="page-level-agree" data-title="مقارنة المستويين والتوافق">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">الأخطاء</div>
    <div class="rail-tab active">المستويان والتوافق</div>
    <div class="rail-tab">الإجراءات</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">مقارنة المستوى الأول والثاني وتوافق الموظفين</h2>
    <div class="section-subtitle">قياس الفروق بين المستويين ونسبة الاتفاق</div>
    <div class="grid grid-4">
      <div class="card"><h3>دقة المستوى الأول</h3><div class="metric gold">${fmtPct(kpis.levelOneAccuracy)}</div></div>
      <div class="card"><h3>دقة المستوى الثاني</h3><div class="metric blue">${fmtPct(kpis.levelTwoAccuracy)}</div></div>
      <div class="card"><h3>معدل الاتفاق</h3><div class="metric blue">${fmtPct(kpis.levelDisagreementRate != null ? 100 - kpis.levelDisagreementRate : null)}</div></div>
      <div class="card"><h3>الحالات المعدَّلة</h3><div class="metric coral">${kpis.excessSuspicious ?? '—'}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px"><table>
      <thead><tr><th>المؤشر</th><th>المستوى الأول</th><th>المستوى الثاني</th><th>الفارق</th></tr></thead>
      <tbody>
        <tr><td>دقة الفحص</td><td>${fmtPct(kpis.levelOneAccuracy)}</td><td>${fmtPct(kpis.levelTwoAccuracy)}</td><td>${fmtPct(diffPct)}</td></tr>
        <tr><td>دقة الاشتباه</td><td>${fmtPct(kpis.suspiciousDetectionRate)}</td><td>—</td><td>—</td></tr>
        <tr><td>معدل التصحيح</td><td>—</td><td>${fmtPct(kpis.levelTwoCorrectionRate)}</td><td>—</td></tr>
        <tr><td>معدل التراجع</td><td>—</td><td>${fmtPct(kpis.levelTwoRegressionRate)}</td><td>—</td></tr>
        <tr><td>الاختلاف بين المستويين</td><td colspan="2">${fmtPct(kpis.levelDisagreementRate)}</td><td>—</td></tr>
      </tbody>
    </table></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">مقارنة دقة المستويين</div>
        <p>المستوى الأول</p><div class="bar"><i style="width:${Math.round(l1Pct)}%"></i></div>
        <p style="margin-top:8px">المستوى الثاني</p><div class="bar"><i style="width:${Math.round(l2Pct)};background:var(--blue)%"></i></div>
        <p style="margin-top:8px">الاختلاف</p><div class="bar"><i style="width:${Math.round(kpis.levelDisagreementRate ?? 0)}%;background:var(--coral)"></i></div>
      </div>
      <div class="card">
        <div class="panel-title">توافق أزواج الموظفين</div>
        <div class="card info" style="margin-top:8px">هذا الجزء يتطلب وجود حالات راجعها موظفان مختلفان. لم تُرصد حالات كهذه في هذا الشهر.</div>
      </div>
    </div>
    <div class="info" style="margin-top:16px">ارتفاع نسبة الاتفاق بين الموظفين لا يعني بالضرورة صحة النتائج؛ يجب دائمًا ربط التوافق بدقة الفحص وجودة القرار.</div>
    <div class="page-no">19</div>
  </div>
</section>`;
}
