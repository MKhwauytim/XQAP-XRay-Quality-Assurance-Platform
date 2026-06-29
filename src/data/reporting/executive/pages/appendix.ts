import type { ExecutiveRenderContext } from "../context";
import { esc, fmtPct, fmtNum } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildAppendix(ctx: ExecutiveRenderContext): string {
  const cfg = ctx.input.config;
  return `<section class="xr-page" id="page-appendix">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">الملاحق</h2>
      <div class="xr-cols xr-cols-2">
        <div class="xr-panel">
          <div class="xr-panel-title">معايير الأداء المعتمدة</div>
          <table class="xr-table" style="margin-top:6px">
            <tbody>
              <tr><td>هدف الدقة الإجمالية</td><td>${fmtPct(cfg.accuracyTarget)}</td></tr>
              <tr><td>هدف إنجاز العينة</td><td>${fmtPct(cfg.completionTarget)}</td></tr>
              <tr><td>هدف التغطية</td><td>${fmtPct(cfg.coverageTarget)}</td></tr>
              <tr><td>حد الاشتباه الفائت المسموح</td><td>${fmtPct(cfg.maximumMissedSuspicionRate)}</td></tr>
              <tr><td>الحد الأدنى للعينة الموثوقة</td><td>${fmtNum(cfg.minimumReliableSampleSize)} حالة</td></tr>
              <tr><td>الهدف الشهري للعينة</td><td>${fmtNum(cfg.monthlyTarget)} حالة</td></tr>
            </tbody>
          </table>
        </div>
        <div class="xr-panel">
          <div class="xr-panel-title">منهجية المراجعة</div>
          <p style="font-size:10px;line-height:1.65;color:var(--xr-muted);font-weight:600">
            تعتمد المراجعة على سحب عينة عشوائية طبقية بخوارزمية هاميلتون من مجتمع الحالات الشهرية
            لكل منفذ، ثم توزيعها على الموظفين المعتمدين. يقوم كل موظف بمراجعة الحالات المكلف بها
            وتسجيل حكمه الخبري. تُحسب الدقة بمقارنة حكم الخبير بنتيجة الأشعة الآلية.
            الحالات التي لم تُدرس بعد لا تدخل في حساب الدقة.
          </p>
        </div>
      </div>
      <div class="xr-page-num">• 31 •</div>
    </div>
  </section>`;
}
