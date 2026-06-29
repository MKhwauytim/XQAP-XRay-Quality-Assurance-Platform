import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpImageQuality(_ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-quality">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">أثر جودة الصورة على الدقة</h2>
      <div class="xr-notice">قريباً — أثر جودة الصورة على الدقة</div>
      <div class="xr-page-num">• 27 •</div>
    </div>
  </section>`;
}
