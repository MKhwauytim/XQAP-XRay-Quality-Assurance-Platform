import type { ExecutiveRenderContext } from "../context";
import { fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";

export function buildEmpStability(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const reliable = profiles.filter(p => p.reliable);

  if (reliable.length === 0) {
    return `<section class="page compact" id="page-emp-stability" data-title="استقرار الأداء وعبء العمل">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">المقارنة</div>
    <div class="rail-tab active">الاستقرار والحمل</div>
    <div class="rail-tab">جودة الصورة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">استقرار الأداء وعبء العمل</h2>
    <div class="section-subtitle">قياس تذبذب الدقة وعلاقته بعدد القرارات</div>
    <div class="card info" style="margin-top:24px">البيانات غير متاحة لهذه الفترة. سيُعرض التحليل عند توفر البيانات الكاملة.</div>
    <div class="page-no">19</div>
  </div>
</section>`;
  }

  const avgAcc = reliable.reduce((s, p) => s + (p.overallAccuracy ?? 0), 0) / reliable.length;
  const maxLoad = Math.max(...reliable.map(p => p.studied));

  const stabilityRows = reliable.slice(0, 6).map(p => `<tr>
    <td>${esc(ctx.displayName(p.username))}</td>
    <td>${fmtPct(p.overallAccuracy)}</td>
    <td>${p.stabilityIndex != null ? fmtPct(p.stabilityIndex) : '—'}</td>
    <td>${p.overallAccuracy != null && p.overallAccuracy > avgAcc ? '↗' : p.overallAccuracy != null && Math.abs(p.overallAccuracy - avgAcc) < 2 ? '→' : '↘'}</td>
  </tr>`).join('');

  // Workload vs accuracy table (replaces the tiny bubble chart from mockup)
  const workloadRows = reliable
    .sort((a, b) => b.studied - a.studied)
    .slice(0, 5)
    .map(p => `<tr>
      <td>${esc(ctx.displayName(p.username))}</td>
      <td>${p.studied}</td>
      <td>${fmtPct(p.overallAccuracy)}</td>
      <td><div class="bar"><i style="width:${Math.round((p.studied / Math.max(1, maxLoad)) * 100)}%;background:var(--blue)"></i></div></td>
    </tr>`).join('');

  return `<section class="page compact" id="page-emp-stability" data-title="استقرار الأداء وعبء العمل">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">المقارنة</div>
    <div class="rail-tab active">الاستقرار والحمل</div>
    <div class="rail-tab">جودة الصورة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">استقرار الأداء وعبء العمل</h2>
    <div class="section-subtitle">قياس تذبذب الدقة وعلاقته بعدد القرارات</div>
    <div class="grid grid-4">
      <div class="card"><h3>متوسط الدقة</h3><div class="metric green">${fmtPct(avgAcc)}</div></div>
      <div class="card"><h3>تذبذب الأداء</h3><div class="metric coral">${fmtPct(reliable.reduce((s,p) => s + (p.stabilityIndex ?? 0), 0) / reliable.length)}</div></div>
      <div class="card"><h3>أعلى عبء عمل</h3><div class="metric blue">${maxLoad}</div></div>
      <div class="card"><h3>الموظفون المقيَّمون</h3><div class="metric green">${reliable.length}</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">استقرار أداء الموظفين</div>
        <div class="table-wrap"><table>
          <thead><tr><th>الموظف</th><th>متوسط الدقة</th><th>التذبذب</th><th>الاتجاه</th></tr></thead>
          <tbody>${stabilityRows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="panel-title">عبء العمل مقابل الدقة</div>
        <div class="table-wrap"><table>
          <thead><tr><th>الموظف</th><th>عدد القرارات</th><th>الدقة</th><th>الحمل النسبي</th></tr></thead>
          <tbody>${workloadRows}</tbody>
        </table></div>
        <p class="muted" style="margin-top:8px;font-size:12px">مرتَّب تنازليًا حسب عدد القرارات</p>
      </div>
    </div>
    <div class="info" style="margin-top:16px">قد يحافظ بعض الموظفين على دقة مرتفعة رغم ارتفاع عبء العمل، بينما يتأثر آخرون سلبًا مع زيادة عدد القرارات.</div>
    <div class="page-no">19</div>
  </div>
</section>`;
}
