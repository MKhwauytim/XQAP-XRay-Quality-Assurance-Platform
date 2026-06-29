import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

export function buildEmpStability(ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-stability">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>استقرار الأداء وعبء العمل</h2><span class="xr-pg">28</span></div>
      <div class="xr-notice">قريباً — استقرار الأداء وعبء العمل</div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>28</span></div>
    </div>
  </section>`;
}
