import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";

export function buildEmpImageQuality(ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-quality">
    <div class="xr-page-inner">
      <div class="xr-slide-head"><h2>أثر جودة الصورة على الدقة</h2><span class="xr-pg">27</span></div>
      <div class="xr-notice">قريباً — أثر جودة الصورة على الدقة</div>
      <div class="xr-footer"><span>التقرير التنفيذي — ${esc(ctx.monthLabel)}</span><span>27</span></div>
    </div>
  </section>`;
}
