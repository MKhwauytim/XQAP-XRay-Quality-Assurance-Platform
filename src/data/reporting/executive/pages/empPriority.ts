import type { ExecutiveRenderContext } from "../context";
import { fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles, buildPriorityList } from "../executiveEmployeeData";

export function buildEmpPriority(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const priority = buildPriorityList(profiles);

  if (priority.length === 0) {
    return `<section class="page compact" id="page-emp-priority" data-title="الأولوية والإجراءات">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">التوافق</div>
    <div class="rail-tab active">الأولوية والإجراءات</div>
    <div class="rail-tab">الملحق</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">الموظفون ذوو الأولوية والإجراءات المقترحة</h2>
    <div class="section-subtitle">تجميع الموظفين بحسب الأولوية الإشرافية والتدخل المطلوب</div>
    <div class="card info" style="margin-top:24px">لا يوجد موظفون يتطلبون تدخلاً عاجلاً في هذه الدورة.</div>
    <div class="page-no">23</div>
  </div>
</section>`;
  }

  // Count by urgency — thresholds per data-mapping spec
  const urgentCount   = priority.filter(p => p.riskScore >= 30).length;
  const trainingCount = priority.filter(p => p.riskScore >= 15 && p.riskScore < 30).length;
  const monitorCount  = priority.filter(p => p.riskScore > 0  && p.riskScore < 15).length;
  const goodCount     = profiles.filter(p => p.reliable && p.riskScore === 0).length;

  function priorityChip(riskScore: number): string {
    if (riskScore >= 30) return '<span class="chip red">حرج</span>';
    if (riskScore >= 15) return '<span class="chip orange">مرتفع</span>';
    if (riskScore >   0) return '<span class="chip orange">متوسط</span>';
    return '<span class="chip green">منخفض</span>';
  }

  const tableRows = priority.slice(0, 6).map(p => `<tr>
    <td>${esc(ctx.displayName(p.username))}</td>
    <td>${fmtPct(p.overallAccuracy)} دقة / ${fmtPct(p.missedSuspicionRate)} اشتباه فائت</td>
    <td>مؤشر خطر: ${p.riskScore.toFixed(0)}</td>
    <td>${esc(p.recommendedAction)}</td>
    <td>${priorityChip(p.riskScore)}</td>
  </tr>`).join('');

  return `<section class="page compact" id="page-emp-priority" data-title="الأولوية والإجراءات">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">التوافق</div>
    <div class="rail-tab active">الأولوية والإجراءات</div>
    <div class="rail-tab">الملحق</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">الموظفون ذوو الأولوية والإجراءات المقترحة</h2>
    <div class="section-subtitle">تجميع الموظفين بحسب الأولوية الإشرافية والتدخل المطلوب</div>
    <div class="grid grid-4">
      <div class="card"><h3>دعم عاجل</h3><div class="metric coral">${String(urgentCount).padStart(2,'0')}</div></div>
      <div class="card"><h3>تدريب موجه</h3><div class="metric blue">${String(trainingCount).padStart(2,'0')}</div></div>
      <div class="card"><h3>متابعة</h3><div class="metric gold">${String(monitorCount).padStart(2,'0')}</div></div>
      <div class="card"><h3>متميز</h3><div class="metric green">${String(goodCount).padStart(2,'0')}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px"><table>
      <thead><tr><th>الموظف</th><th>الملاحظة الرئيسية</th><th>الدليل</th><th>الإجراء المقترح</th><th>الأولوية</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">مصفوفة أولوية التدخل</div>
        <div class="quad">
          <div><h4>أثر عالٍ / أولوية منخفضة</h4><p>تحسينات اختيارية</p></div>
          <div><h4 style="color:var(--coral)">أثر عالٍ / أولوية عالية</h4><p>تدخل فوري ودعم مباشر</p></div>
          <div><h4 style="color:var(--green)">أثر منخفض / أولوية منخفضة</h4><p>متابعة دورية</p></div>
          <div><h4 style="color:var(--gold)">أثر منخفض / أولوية عالية</h4><p>تحسينات وسطية</p></div>
        </div>
      </div>
      <div class="card">
        <div class="panel-title">أهم التوصيات التنفيذية</div>
        <p>• التدريب الموجه</p>
        <p>• المراجعة الثنائية</p>
        <p>• تحسين التحديد</p>
        <p>• متابعة الأداء</p>
        <p>• إعادة توزيع الحالات</p>
      </div>
    </div>
    <div class="info" style="margin-top:16px">يرجى اعتماد خطط التدخل المقترحة للشروع في التنفيذ والمتابعة خلال الفترة القادمة.</div>
    <div class="page-no">23</div>
  </div>
</section>`;
}
