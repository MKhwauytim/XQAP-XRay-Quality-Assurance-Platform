import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

export function buildEmpByPort(ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-port">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>مقارنة الموظفين بين المنافذ</h2><span class="xr-pg">26</span></div>
      <div class="xr-notice">قريباً — مقارنة الموظفين بين المنافذ</div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>26</span></div>
    </div>
  </section>`;
}
