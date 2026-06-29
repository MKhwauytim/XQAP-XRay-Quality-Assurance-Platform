import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";

function classifyEmp(p: ReturnType<typeof buildEmployeeProfiles>[0]): { cls: string; label: string } {
  if (!p.reliable) return { cls: 'blue', label: 'بيانات غير كافية' };
  if (p.overallAccuracy == null) return { cls: 'blue', label: 'بيانات غير كافية' };
  if (p.overallAccuracy >= 90) return { cls: 'green', label: 'متميز' };
  if (p.overallAccuracy >= 80) return { cls: 'blue',  label: 'مستقر' };
  if (p.overallAccuracy >= 70) return { cls: 'orange', label: 'يحتاج متابعة' };
  return { cls: 'red', label: 'يحتاج تطوير' };
}

export function buildEmpOverview(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);

  if (profiles.length === 0) {
    return `<section class="page compact" id="page-emp-overview" data-title="النظرة العامة لأداء الموظفين">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab active">أداء الموظفين</div>
    <div class="rail-tab">حسب المنفذ</div>
    <div class="rail-tab">الاستقرار</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">النظرة العامة لأداء الموظفين</h2>
    <div class="section-subtitle">مقارنة الأداء العام للموظفين بغض النظر عن المستوى</div>
    <div class="card info" style="margin-top:24px">لا توجد إجابات مقدَّمة لهذا الشهر. سيُعرض التحليل عند توفر البيانات.</div>
    <div class="page-no">13</div>
  </div>
</section>`;
  }

  const reliable = profiles.filter(p => p.reliable);
  const avgAcc   = reliable.length > 0
    ? reliable.reduce((s, p) => s + (p.overallAccuracy ?? 0), 0) / reliable.length
    : null;
  const bestAcc  = reliable.length > 0
    ? Math.max(...reliable.map(p => p.overallAccuracy ?? 0))
    : null;
  const worstAcc = reliable.length > 0
    ? Math.min(...reliable.map(p => p.overallAccuracy ?? 0))
    : null;
  const maxVar   = bestAcc != null && worstAcc != null ? bestAcc - worstAcc : null;

  const tableRows = profiles.map(p => {
    const cl = classifyEmp(p);
    return `<tr>
      <td>${esc(ctx.displayName(p.username))}</td>
      <td>${fmtNum(p.studied)}</td>
      <td>${p.reliable && p.levelOneAccuracy != null ? fmtPct(p.levelOneAccuracy) : '—'}</td>
      <td>${p.reliable && p.levelTwoAccuracy != null ? fmtPct(p.levelTwoAccuracy) : '—'}</td>
      <td>${p.reliable && p.overallAccuracy != null ? fmtPct(p.overallAccuracy) : '—'}</td>
      <td>${p.reliable && p.suspiciousDetectionRate != null ? fmtPct(p.suspiciousDetectionRate) : '—'}</td>
      <td>${p.reliable && p.missedSuspicionRate != null ? fmtPct(p.missedSuspicionRate) : '—'}</td>
      <td>${p.byPort.size}</td>
      <td><span class="chip ${cl.cls}">${cl.label}</span></td>
    </tr>`;
  }).join('');

  const topBars = reliable.slice(0, 3).map(p =>
    `<p>${esc(ctx.displayName(p.username))}</p><div class="bar"><i style="width:${Math.round(p.overallAccuracy ?? 0)}%"></i></div>`
  ).join('');

  return `<section class="page compact" id="page-emp-overview" data-title="النظرة العامة لأداء الموظفين">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab active">أداء الموظفين</div>
    <div class="rail-tab">حسب المنفذ</div>
    <div class="rail-tab">الاستقرار</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">النظرة العامة لأداء الموظفين</h2>
    <div class="section-subtitle">مقارنة الأداء العام للموظفين بغض النظر عن المستوى</div>
    <div class="grid grid-5">
      <div class="card"><h3>الموظفون المقيَّمون</h3><div class="metric blue">${fmtNum(profiles.length)}</div></div>
      <div class="card"><h3>إجمالي القرارات</h3><div class="metric gold">${fmtNum(profiles.reduce((s, p) => s + p.studied, 0))}</div></div>
      <div class="card"><h3>متوسط الدقة</h3><div class="metric green">${fmtPct(avgAcc)}</div></div>
      <div class="card"><h3>أفضل دقة</h3><div class="metric green">${fmtPct(bestAcc)}</div></div>
      <div class="card"><h3>أعلى تفاوت</h3><div class="metric coral">${fmtPct(maxVar)}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px"><table>
      <thead><tr><th>الموظف</th><th>القرارات</th><th>المستوى الأول</th><th>المستوى الثاني</th><th>دقة الفحص</th><th>دقة الاشتباه</th><th>معدل الاكتشاف</th><th>المنافذ</th><th>التصنيف</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">أفضل 3 موظفين</div>
        ${topBars || '<p class="muted">لا توجد بيانات موثوقة كافية</p>'}
      </div>
      <div class="card">
        <div class="panel-title">منهجية القياس</div>
        <p><b style="color:var(--green)">دقة الفحص:</b> تطابق قرار الموظف مع نتيجة المراجع لجميع الحالات.</p>
        <p><b style="color:var(--coral)">دقة الاشتباه:</b> التطابق ضمن حالات الاشتباه فقط.</p>
        <p class="muted">التقييم مبني على القرار وجودته وليس على المستوى الوظيفي وحده.</p>
      </div>
    </div>
    <div class="page-no">13</div>
  </div>
</section>`;
}
