import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";

export function buildDistributionOverview(ctx: ExecutiveRenderContext): string {
  const dist = ctx.input.distribution;

  if (!dist || dist.entries.length === 0) {
    return `<section class="page compact" id="page-dist" data-title="التوزيع والتكليف">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab">دقة المستوى</div>
    <div class="rail-tab active">التوزيع</div>
    <div class="rail-tab">الموظفون</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">التوزيع والتكليف</h2>
    <div class="section-subtitle">توزيع حالات العينة على الموظفين</div>
    <div class="card info" style="margin-top:24px">لم يتم التوزيع بعد لهذا الشهر. سيُعرض التحليل عند اكتمال البيانات.</div>
    <div class="page-no">11</div>
  </div>
</section>`;
  }

  const byEmployee = new Map<string, { assigned: number; completed: number }>();
  for (const e of dist.entries) {
    const emp = e.assignedTo ?? 'غير محدد';
    const rec = byEmployee.get(emp) ?? { assigned: 0, completed: 0 };
    rec.assigned++;
    if (e.status === 'completed') rec.completed++;
    byEmployee.set(emp, rec);
  }

  const totalAssigned  = dist.entries.length;
  const totalCompleted = dist.entries.filter(e => e.status === 'completed').length;
  const totalPending   = totalAssigned - totalCompleted;
  const completionRate = totalAssigned > 0 ? (totalCompleted / totalAssigned) * 100 : null;

  const empRows = [...byEmployee.entries()].map(([emp, r]) =>
    `<tr>
      <td>${esc(ctx.displayName(emp))}</td>
      <td>${fmtNum(r.assigned)}</td>
      <td>${fmtNum(r.completed)}</td>
      <td>${fmtNum(r.assigned - r.completed)}</td>
      <td>${fmtPct(r.assigned > 0 ? (r.completed / r.assigned) * 100 : null)}</td>
    </tr>`
  ).join('');

  return `<section class="page compact" id="page-dist" data-title="التوزيع والتكليف">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab">دقة المستوى</div>
    <div class="rail-tab active">التوزيع</div>
    <div class="rail-tab">الموظفون</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">التوزيع والتكليف</h2>
    <div class="section-subtitle">توزيع حالات العينة على الموظفين وحالة الإنجاز</div>
    <div class="grid grid-4">
      <div class="card"><h3>إجمالي المكلَّف به</h3><div class="metric gold">${fmtNum(totalAssigned)}</div></div>
      <div class="card"><h3>مكتملة</h3><div class="metric green">${fmtNum(totalCompleted)}</div></div>
      <div class="card"><h3>متبقية</h3><div class="metric ${totalPending > 0 ? 'coral' : 'green'}">${fmtNum(totalPending)}</div></div>
      <div class="card"><h3>نسبة الإنجاز</h3><div class="metric blue">${fmtPct(completionRate)}</div></div>
    </div>
    <div class="panel-title" style="margin-top:16px">أعباء العمل حسب الموظف</div>
    <div class="table-wrap"><table>
      <thead><tr><th>الموظف</th><th>المكلَّف به</th><th>مكتمل</th><th>متبقٍ</th><th>نسبة الإنجاز</th></tr></thead>
      <tbody>${empRows}</tbody>
    </table></div>
    <div class="page-no">11</div>
  </div>
</section>`;
}
