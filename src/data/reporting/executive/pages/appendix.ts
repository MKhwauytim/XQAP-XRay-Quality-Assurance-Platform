import type { ExecutiveRenderContext } from "../context";
import { fmtPct, fmtNum } from "../primitives";

export function buildAppendix(ctx: ExecutiveRenderContext): string {
  const cfg = ctx.input.config;

  return `<section class="page compact" id="page-appendix" data-title="الملاحق">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">التوافق</div>
    <div class="rail-tab">الأولوية</div>
    <div class="rail-tab active">الملحق</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">الملاحق</h2>
    <div class="section-subtitle">معايير الأداء المعتمدة ومنهجية المراجعة</div>
    <div class="grid grid-2">
      <div class="card">
        <div class="panel-title">معايير الأداء المعتمدة</div>
        <div class="table-wrap"><table>
          <tbody>
            <tr><td>هدف الدقة الإجمالية</td><td>${fmtPct(cfg.accuracyTarget)}</td></tr>
            <tr><td>هدف إنجاز العينة</td><td>${fmtPct(cfg.completionTarget)}</td></tr>
            <tr><td>هدف التغطية</td><td>${fmtPct(cfg.coverageTarget)}</td></tr>
            <tr><td>حد الاشتباه الفائت المسموح</td><td>${fmtPct(cfg.maximumMissedSuspicionRate)}</td></tr>
            <tr><td>الحد الأدنى للعينة الموثوقة</td><td>${fmtNum(cfg.minimumReliableSampleSize)} حالة</td></tr>
            <tr><td>الهدف الشهري للعينة</td><td>${fmtNum(cfg.monthlyTarget)} حالة</td></tr>
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="panel-title">منهجية المراجعة</div>
        <p style="font-size:13px;line-height:1.65;color:var(--muted)">
          تعتمد المراجعة على سحب عينة عشوائية طبقية بخوارزمية هاميلتون من مجتمع الحالات الشهرية
          لكل منفذ، ثم توزيعها على الموظفين المعتمدين. يقوم كل موظف بمراجعة الحالات المكلَّف بها
          وتسجيل حكمه الخبري. تُحسب الدقة بمقارنة حكم الخبير بنتيجة الأشعة الآلية.
          الحالات التي لم تُدرس بعد لا تدخل في حساب الدقة.
        </p>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="panel-title">تفاصيل المنافذ والجداول الداعمة</div>
      <div class="appendix-list" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-top:14px">
        <span style="display:block;color:#dce7f2;font-size:13px;position:relative;padding-right:14px"><span style="position:absolute;right:0;color:var(--gold)">•</span>تفاصيل المنافذ</span>
        <span style="display:block;color:#dce7f2;font-size:13px;position:relative;padding-right:14px"><span style="position:absolute;right:0;color:var(--gold)">•</span>القواعد الحسابية</span>
        <span style="display:block;color:#dce7f2;font-size:13px;position:relative;padding-right:14px"><span style="position:absolute;right:0;color:var(--gold)">•</span>جودة البيانات</span>
        <span style="display:block;color:#dce7f2;font-size:13px;position:relative;padding-right:14px"><span style="position:absolute;right:0;color:var(--gold)">•</span>معجم التصنيفات</span>
        <span style="display:block;color:#dce7f2;font-size:13px;position:relative;padding-right:14px"><span style="position:absolute;right:0;color:var(--gold)">•</span>الجداول التشغيلية</span>
        <span style="display:block;color:#dce7f2;font-size:13px;position:relative;padding-right:14px"><span style="position:absolute;right:0;color:var(--gold)">•</span>التفاصيل الداعمة</span>
      </div>
    </div>
    <div class="page-no">20</div>
  </div>
</section>`;
}
