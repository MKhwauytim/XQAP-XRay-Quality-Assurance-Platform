import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

export function buildEmpByDecision(ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-decision">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>الدقة حسب نوع القرار</h2><span class="xr-pg">25</span></div>
      <div class="xr-notice">قريباً — تحليل الدقة حسب نوع القرار</div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>25</span></div>
    </div>
  </section>`;
}
