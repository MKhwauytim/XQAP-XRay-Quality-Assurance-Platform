import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

export function buildCover(ctx: ExecutiveRenderContext): string {
  const levels = [
    { label: "المستوى الأول", sub: "حالات الضبط المؤكدة", cls: "xr-l1" },
    { label: "المستوى الثاني", sub: "حالات الاشتباه المؤكدة", cls: "xr-l2" },
    { label: "المستوى الثالث", sub: "حالات محرك المخاطر", cls: "xr-l3" },
    { label: "المستوى الرابع", sub: "اشتباه الأشعة غير المؤكد", cls: "xr-l4" },
  ];
  const chips = levels.map(l => `
    <div class="xr-level-chip">
      <div class="xr-level-chip-dot" style="background:var(--${l.cls})"></div>
      <div class="xr-level-chip-text"><strong>${esc(l.label)}</strong><span>${esc(l.sub)}</span></div>
    </div>`).join("");

  return `<section class="xr-page xr-cover" id="page-cover">
    <div class="xr-cover-top">
      <div class="xr-cover-org">${esc(ORGANIZATION_PATH_TEXT)}</div>
      <div class="xr-cover-logo">🛡</div>
    </div>
    <div class="xr-cover-main">
      <div class="xr-cover-eyebrow">التقرير التنفيذي</div>
      <div class="xr-cover-title">لضمان جودة <span>الأشعة</span></div>
      <div class="xr-cover-meta">
        <div class="xr-cover-meta-item">📅 تاريخ التقرير: <b>${esc(ctx.issueDate)}</b></div>
        <div class="xr-cover-meta-item">📦 مجتمع الحالات: <b>${esc(ctx.monthLabel)}</b></div>
      </div>
    </div>
    <div class="xr-cover-levels">${chips}</div>
  </section>`;
}
