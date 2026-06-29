import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildEmpByPort(_ctx: ExecutiveRenderContext): string {
  return `<section class="xr-page" id="page-emp-port">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">مقارنة الموظفين بين المنافذ</h2>
      <div class="xr-notice">قريباً — مقارنة الموظفين بين المنافذ</div>
      <div class="xr-page-num">• 26 •</div>
    </div>
  </section>`;
}
