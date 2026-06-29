import type { ExecutiveRenderContext } from "../context";
import { fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";

export function buildEmpImageQuality(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const reliable = profiles.filter(p => p.reliable);

  // Aggregate across all reliable employees
  let highQualAcc = 0, highQualN = 0;
  let lowQualAcc  = 0, lowQualN  = 0;
  let markedAcc   = 0, markedN   = 0;
  let unmarkedAcc = 0, unmarkedN = 0;

  for (const p of reliable) {
    if (p.byImageQuality['عالي'].accuracy != null) {
      highQualAcc += p.byImageQuality['عالي'].accuracy; highQualN++;
    }
    if (p.byImageQuality['منخفض'].accuracy != null) {
      lowQualAcc += p.byImageQuality['منخفض'].accuracy; lowQualN++;
    }
    if (p.byMarking.marked.accuracy != null) {
      markedAcc += p.byMarking.marked.accuracy; markedN++;
    }
    if (p.byMarking.unmarked.accuracy != null) {
      unmarkedAcc += p.byMarking.unmarked.accuracy; unmarkedN++;
    }
  }

  const avgHigh    = highQualN > 0 ? highQualAcc / highQualN : null;
  const avgLow     = lowQualN  > 0 ? lowQualAcc  / lowQualN  : null;
  const avgMarked  = markedN   > 0 ? markedAcc   / markedN   : null;
  const avgUnmark  = unmarkedN > 0 ? unmarkedAcc / unmarkedN : null;

  if (reliable.length === 0) {
    return `<section class="page compact" id="page-emp-quality" data-title="أثر جودة الصورة على الدقة">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">الاستقرار</div>
    <div class="rail-tab active">جودة الصورة</div>
    <div class="rail-tab">الأخطاء</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أثر جودة الصورة والتحديد على الأداء</h2>
    <div class="section-subtitle">تحليل علاقة جودة الصورة ووجود التحديد بدقة الفحص</div>
    <div class="card info" style="margin-top:24px">البيانات غير متاحة لهذه الدورة. سيُعرض التحليل عند توفر البيانات الكاملة.</div>
    <div class="page-no">17</div>
  </div>
</section>`;
  }

  const tableRows = reliable.slice(0, 5).map(p => `<tr>
    <td>${esc(ctx.displayName(p.username))}</td>
    <td>${p.byImageQuality['عالي'].accuracy != null ? fmtPct(p.byImageQuality['عالي'].accuracy) : '—'}</td>
    <td>${p.byImageQuality['منخفض'].accuracy != null ? fmtPct(p.byImageQuality['منخفض'].accuracy) : '—'}</td>
    <td>${p.byMarking.marked.accuracy != null ? fmtPct(p.byMarking.marked.accuracy) : '—'}</td>
    <td>${p.byMarking.unmarked.accuracy != null ? fmtPct(p.byMarking.unmarked.accuracy) : '—'}</td>
    <td>${
      p.byImageQuality['عالي'].accuracy != null && p.byImageQuality['منخفض'].accuracy != null
        ? fmtPct(p.byImageQuality['عالي'].accuracy - p.byImageQuality['منخفض'].accuracy)
        : '—'
    }</td>
  </tr>`).join('');

  return `<section class="page compact" id="page-emp-quality" data-title="أثر جودة الصورة على الدقة">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">الاستقرار</div>
    <div class="rail-tab active">جودة الصورة</div>
    <div class="rail-tab">الأخطاء</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أثر جودة الصورة والتحديد على الأداء</h2>
    <div class="section-subtitle">تحليل علاقة جودة الصورة ووجود التحديد بدقة الفحص</div>
    <div class="grid grid-4">
      <div class="card"><h3>جودة عالية</h3><div class="metric blue">${fmtPct(avgHigh)}</div></div>
      <div class="card"><h3>جودة منخفضة</h3><div class="metric coral">${fmtPct(avgLow)}</div></div>
      <div class="card"><h3>مع تحديد</h3><div class="metric gold">${fmtPct(avgMarked)}</div></div>
      <div class="card"><h3>دون تحديد</h3><div class="metric green">${fmtPct(avgUnmark)}</div></div>
    </div>
    <div class="info" style="margin:16px 0">تتم مقارنة دقة الفحص بين الحالات التي بها تحديد والحالات التي لا يوجد بها تحديد لاختبار ما إذا كان غياب التحديد يرتبط بانخفاض الدقة.</div>
    <div class="table-wrap"><table>
      <thead><tr><th>الموظف</th><th>جودة عالية</th><th>جودة منخفضة</th><th>مع تحديد</th><th>دون تحديد</th><th>فرق الأثر</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="page-no">17</div>
  </div>
</section>`;
}
