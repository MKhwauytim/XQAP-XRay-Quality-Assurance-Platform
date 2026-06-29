import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";

export function buildAccuracyByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const levelAccuracies = [kpis.levelOneAccuracy, kpis.levelTwoAccuracy, null, null];

  const stageRows = kpis.stageProfiles.map((s, i) => {
    const colors = ['gold', 'blue', 'slate', 'coral'];
    const col = colors[i] ?? 'gold';
    const acc = levelAccuracies[i];
    return `<div class="card level-card stage${i+1}">
      <h3>${esc(s.stageLabel)}</h3>
      <p>دقة الفحص</p>
      <div class="metric ${col}">${acc != null ? fmtPct(acc) : '—'}</div>
    </div>`;
  }).join('');

  const tableRows = kpis.stageProfiles.map((s, i) => {
    const acc = levelAccuracies[i];
    return `<tr>
      <td>${esc(s.stageLabel)}</td>
      <td>${fmtNum(s.studied)}</td>
      <td>—</td>
      <td>—</td>
      <td>${acc != null ? fmtPct(acc) : '—'}</td>
      <td>—</td>
    </tr>`;
  }).join('');

  return `<section class="page compact" id="page-acc-level" data-title="نتائج الدقة حسب المستويات">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab">دقة المنفذ</div>
    <div class="rail-tab active">دقة المستوى</div>
    <div class="rail-tab">التوزيع</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">نتائج الدقة حسب المستويات</h2>
    <div class="section-subtitle">تحليل دقة الفحص ودقة الاشتباه عبر المستويات الأربعة</div>
    <div class="grid grid-4">
      ${stageRows || `
        <div class="card level-card stage1"><h3>المستوى الأول</h3><p>دقة الفحص</p><div class="metric gold">${fmtPct(kpis.levelOneAccuracy)}</div></div>
        <div class="card level-card stage2"><h3>المستوى الثاني</h3><p>دقة الفحص</p><div class="metric blue">${fmtPct(kpis.levelTwoAccuracy)}</div></div>
        <div class="card level-card stage3"><h3>المستوى الثالث</h3><p>دقة الفحص</p><div class="metric slate">—</div></div>
        <div class="card level-card stage4"><h3>المستوى الرابع</h3><p>دقة الفحص</p><div class="metric coral">—</div></div>`}
    </div>
    <div class="table-wrap" style="margin-top:18px"><table>
      <thead><tr><th>المستوى</th><th>الحالات المفحوصة</th><th>حالات الاشتباه</th><th>دقة الاشتباه</th><th>دقة الفحص</th><th>أبرز ملاحظة</th></tr></thead>
      <tbody>
        ${tableRows || `
          <tr><td>المستوى الأول</td><td>—</td><td>—</td><td>—</td><td>${fmtPct(kpis.levelOneAccuracy)}</td><td>—</td></tr>
          <tr><td>المستوى الثاني</td><td>—</td><td>—</td><td>—</td><td>${fmtPct(kpis.levelTwoAccuracy)}</td><td>—</td></tr>
          <tr><td>المستوى الثالث</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
          <tr><td>المستوى الرابع</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`}
      </tbody>
    </table></div>
    <div class="info" style="margin-top:18px">الغرض: إبراز المستويات الأقوى وتحديد المستويات التي تتطلب تدخلًا، وفهم الفروق بين دقة الاشتباه ودقة الفحص الإجمالية.</div>
    <div class="page-no">10</div>
  </div>
</section>`;
}
