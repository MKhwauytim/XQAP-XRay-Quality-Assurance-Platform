import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";

export function buildAccuracyByPort(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const target = ctx.input.config.accuracyTarget;

  const overallTone = kpis.overallAccuracy !== null && kpis.overallAccuracy >= target ? 'green' : 'coral';
  const suspTone    = kpis.suspiciousDetectionRate !== null && kpis.suspiciousDetectionRate >= target ? 'green' : 'coral';

  const portRows = kpis.portProfiles.map(p =>
    `<tr>
      <td>${esc(p.portName)}</td>
      <td>${fmtNum(p.studied ?? 0)}</td>
      <td>${p.suspicious != null ? fmtNum(p.suspicious) : '—'}</td>
      <td>${p.suspiciousDetectionRate != null ? fmtPct(p.suspiciousDetectionRate) : '—'}</td>
      <td>${p.accuracy != null ? fmtPct(p.accuracy) : '—'}</td>
      <td>${p.accuracy != null && p.suspiciousDetectionRate != null ? fmtPct(p.accuracy - p.suspiciousDetectionRate) : '—'}</td>
    </tr>`
  ).join('');

  return `<section class="page compact" id="page-acc-port" data-title="نتائج الدقة حسب المنفذ">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab active">دقة المنفذ</div>
    <div class="rail-tab">دقة المستوى</div>
    <div class="rail-tab">التوزيع</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">نتائج الدقة حسب المنفذ</h2>
    <div class="section-subtitle">مقارنة دقة الفحص ودقة الاشتباه بين المنافذ</div>
    <div class="grid grid-4">
      <div class="card"><h3>دقة الفحص الكلية</h3><div class="metric ${overallTone}">${fmtPct(kpis.overallAccuracy)}</div></div>
      <div class="card"><h3>دقة الاشتباه الكلية</h3><div class="metric ${suspTone}">${fmtPct(kpis.suspiciousDetectionRate)}</div></div>
      <div class="card"><h3>حالات الاشتباه المفحوصة</h3><div class="metric blue">${fmtNum(kpis.suspiciousCount ?? 0)}</div></div>
      <div class="card"><h3>الفجوة</h3>
        <div class="metric gold">${
          kpis.overallAccuracy != null && kpis.suspiciousDetectionRate != null
            ? fmtPct(Math.abs(kpis.overallAccuracy - kpis.suspiciousDetectionRate))
            : '—'
        }</div>
        <span class="muted">نقطة</span>
      </div>
    </div>
    <div class="info" style="margin:16px 0">نسبة دقة الفحص = تطابق نتيجة المراجع مع النتيجة الأصلية لجميع الحالات. نسبة دقة الاشتباه = التطابق ضمن حالات الاشتباه فقط.</div>
    <div class="table-wrap"><table>
      <thead><tr><th>المنفذ</th><th>الحالات المفحوصة</th><th>حالات الاشتباه</th><th>دقة الاشتباه</th><th>دقة الفحص</th><th>الفجوة</th></tr></thead>
      <tbody>
        ${portRows || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">لا توجد بيانات كافية</td></tr>'}
      </tbody>
    </table></div>
    <div class="page-no">09</div>
  </div>
</section>`;
}
