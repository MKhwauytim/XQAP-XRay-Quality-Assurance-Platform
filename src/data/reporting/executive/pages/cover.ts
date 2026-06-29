import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

export function buildCover(ctx: ExecutiveRenderContext): string {
  const orgLines = ORGANIZATION_PATH_TEXT.split(" ← ")
    .map(l => `<div>${esc(l)}</div>`)
    .join("");

  const levels = [
    { label: "المستوى الأول", sub: "حالات الضبط المؤكدة", varColor: "var(--xr-l1)" },
    { label: "المستوى الثاني", sub: "حالات الاشتباه المؤكدة", varColor: "var(--xr-l2)" },
    { label: "المستوى الثالث", sub: "حالات محرك المخاطر", varColor: "var(--xr-l3)" },
    { label: "المستوى الرابع", sub: "اشتباه الأشعة غير المؤكد", varColor: "var(--xr-l4)" },
  ];
  const chips = levels.map(l => `
    <div class="xr-level-chip">
      <div class="xr-level-chip-dot" style="background:${l.varColor}"></div>
      <div class="xr-level-chip-text"><strong>${esc(l.label)}</strong><span>${esc(l.sub)}</span></div>
    </div>`).join("");

  return `<section class="xr-page xr-cover" id="page-cover">
    <div class="xr-cover-header">
      <div class="xr-cover-org-text">${orgLines}</div>
      <div class="xr-cover-logo">🛡</div>
    </div>
    <div class="xr-cover-main">
      <div class="xr-cover-eyebrow">التقرير التنفيذي</div>
      <div class="xr-cover-title">لضمان جودة <span>الأشعة</span></div>
      <div class="xr-cover-subtitle">تحليل مجتمع الحالات والعينة والتوزيع ومؤشرات الجودة</div>
      <div class="xr-cover-meta">
        <div class="xr-cover-meta-item">📅 دورة التقرير: <b>${esc(ctx.issueDate)}</b></div>
        <div class="xr-cover-meta-item">🎯 مجتمع الحالات محل الدراسة: <b>${esc(ctx.monthLabel)}</b></div>
      </div>
    </div>
    <div class="xr-cover-bottom">
      <div class="xr-cover-levels">${chips}</div>
      <div class="xr-cover-badges">
        <div class="xr-cover-badge">نسخة تنفيذية</div>
        <div class="xr-cover-badge">سري داخلياً</div>
      </div>
    </div>
    <div class="xr-page-num">• 01 •</div>
  </section>`;
}
