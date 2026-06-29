import type { ExecutiveRenderContext } from "../context";
import { fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";

export function buildErrorTypes(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const reliable  = profiles.filter(p => p.reliable);

  const vs = kpis.validStudied;
  const trueSuspPct  = vs > 0 ? kpis.correctSuspicious   / vs * 100 : null;
  const missedPct    = vs > 0 ? kpis.missedSuspicious     / vs * 100 : null;
  const falsePct     = vs > 0 ? kpis.excessSuspicious     / vs * 100 : null;
  const trueCleanPct = vs > 0 ? kpis.correctClean         / vs * 100 : null;

  // Per-employee error breakdown from ctx.rows
  const empRows = reliable.slice(0, 8).map(p => {
    const empRows2 = ctx.rows.filter(r => r.assignedTo === p.username && r.verificationCategory !== null);
    const n = empRows2.length;
    const cs  = n > 0 ? empRows2.filter(r => r.verificationCategory === "correct-suspicious").length  / n * 100 : null;
    const ms  = n > 0 ? empRows2.filter(r => r.verificationCategory === "missed-suspicious").length   / n * 100 : null;
    const es  = n > 0 ? empRows2.filter(r => r.verificationCategory === "excess-suspicious").length   / n * 100 : null;
    const cc  = n > 0 ? empRows2.filter(r => r.verificationCategory === "correct-clean").length       / n * 100 : null;
    return `<tr>
      <td>${esc(ctx.displayName(p.username))}</td>
      <td>${fmtPct(cs)}</td>
      <td>${fmtPct(ms)}</td>
      <td>${fmtPct(es)}</td>
      <td>${fmtPct(cc)}</td>
      <td>—</td>
    </tr>`;
  }).join("");

  const noData = vs === 0;

  return `<section class="page compact" id="page-error-types" data-title="تحليل أنواع الأخطاء">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">جودة الصورة</div>
    <div class="rail-tab active">تحليل الأخطاء</div>
    <div class="rail-tab">التوافق</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">تحليل أنواع الأخطاء</h2>
    <div class="section-subtitle">تصنيف القرارات بين اشتباه صحيح واشتباه فائت واشتباه خاطئ وسليمة صحيحة</div>
    ${noData
      ? `<div class="notice-centered"><div>لا توجد بيانات كافية لهذه الفترة</div></div>`
      : `<div class="grid grid-4">
      <div class="card"><h3>اشتباه صحيح</h3><div class="metric gold">${fmtPct(trueSuspPct)}</div></div>
      <div class="card"><h3>اشتباه فائت</h3><div class="metric blue">${fmtPct(missedPct)}</div></div>
      <div class="card"><h3>اشتباه خاطئ</h3><div class="metric coral">${fmtPct(falsePct)}</div></div>
      <div class="card"><h3>سليمة صحيحة</h3><div class="metric green">${fmtPct(trueCleanPct)}</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">مصفوفة تصنيف القرارات</div>
        <div class="quad">
          <div style="background:rgba(255,118,95,.08)"><h4 style="color:var(--coral)">اشتباه خاطئ</h4><p>إنذار كاذب</p></div>
          <div style="background:rgba(244,180,0,.08)"><h4 style="color:var(--gold)">اشتباه صحيح</h4><p>كشف صحيح</p></div>
          <div style="background:rgba(139,195,74,.08)"><h4 style="color:var(--green)">سليمة صحيحة</h4><p>قبول صحيح</p></div>
          <div style="background:rgba(107,169,248,.08)"><h4 style="color:var(--blue)">اشتباه فائت</h4><p>حالة لم تُكتشف</p></div>
        </div>
      </div>
      <div class="card">
        <div class="panel-title">تعريف الأنواع</div>
        <p><b style="color:var(--gold)">الاشتباه الصحيح:</b> قرار أدى إلى كشف حالة مشتبه بها.</p>
        <p><b style="color:var(--blue)">الاشتباه الفائت:</b> حالة مشتبه بها صنفت سليمة.</p>
        <p><b style="color:var(--coral)">الاشتباه الخاطئ:</b> حالة سليمة صنفت اشتباه.</p>
        <p><b style="color:var(--green)">السليمة الصحيحة:</b> حالة سليمة صنفت سليمة.</p>
      </div>
    </div>
    <div class="table-wrap" style="margin-top:16px"><table>
      <thead><tr><th>الموظف</th><th>اشتباه صحيح</th><th>اشتباه فائت</th><th>اشتباه خاطئ</th><th>سليمة صحيحة</th><th>أبرز نمط خطأ</th></tr></thead>
      <tbody>${empRows || `<tr><td colspan="6" class="muted" style="text-align:center">لا توجد بيانات موثوقة</td></tr>`}</tbody>
    </table></div>
    <div class="info" style="margin-top:16px"><b style="color:var(--gold)">الاشتباه الفائت هو نوع الخطأ الأعلى خطورة</b> لأنه يمثل حالة مشتبه بها لم يتم اكتشافها.</div>`}
    <div class="page-no">21</div>
  </div>
</section>`;
}
