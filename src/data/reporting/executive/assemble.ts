import type { ExecutiveRenderContext } from "./context";
import { buildViewerHtml } from "./viewer";
import { esc } from "./primitives";

const NAV_SECTIONS = [
  { label: "الغلاف", id: "page-cover" },
  { label: "الفهرس", id: "page-toc" },
  { label: "مقدمة تنفيذية", id: "page-intro" },
  { label: "المعجم", id: "page-glossary" },
  { label: "الجزء الأول: المجتمع", id: "page-p1" },
  { label: "الجزء الثاني: العينة", id: "page-p2" },
  { label: "الجزء الثالث: التوزيع", id: "page-p3" },
  { label: "الجزء الرابع: الدقة", id: "page-p4" },
  { label: "الجزء الخامس: الفجوات", id: "page-p5" },
  { label: "الجزء السادس: التوصيات", id: "page-p6" },
  { label: "الملاحق", id: "page-appendix" },
];

export function assembleReport(
  ctx: ExecutiveRenderContext,
  pageBuilders: Array<(ctx: ExecutiveRenderContext) => string>,
): string {
  const slides = pageBuilders.map(fn => fn(ctx)).join("\n");
  const sidebarLinks = NAV_SECTIONS.map(s =>
    `<a href="#${s.id}">${esc(s.label)}</a>`
  ).join("");
  return buildViewerHtml(slides, sidebarLinks, ctx.monthLabel);
}
