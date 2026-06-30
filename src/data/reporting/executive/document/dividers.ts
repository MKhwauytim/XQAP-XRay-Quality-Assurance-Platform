// Part-divider pages for the Document. Icons come from ui/icons.ts (no emoji).

import { esc } from "../primitives";
import { icon } from "../ui/icons";

const RAIL_TABS = ["الجزء الأول", "الجزء الثاني", "الجزء الثالث", "الجزء الرابع", "الجزء الخامس"];

type TocChip = { n: string; t: string };

export function divider(opts: {
  id: string;
  dataTitle: string;
  partLabel: string;
  title: string;
  subtitle: string;
  iconName: string;
  pageNo: string;
  dividerNum: string;
  toc: TocChip[];
}): string {
  const tocHtml = opts.toc
    .map((c) => `<div class="toc-chip"><span class="n">${esc(c.n)}</span><span class="t">${esc(c.t)}</span></div>`)
    .join("");
  return `<section class="page" id="${esc(opts.id)}" data-title="${esc(opts.dataTitle)}">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    ${RAIL_TABS.map((t, i) => `<div class="rail-tab${i === 0 ? " active" : ""}">${esc(t)}</div>`).join("")}
  </div>
  <div class="page-inner big-divider" style="--divider-num:'${esc(opts.dividerNum)}'">
    <div class="divider-top">
      <span class="shield" aria-hidden="true"></span>
      <span>هيئة الزكاة والضريبة والجمارك — إدارة ضمان جودة الأشعة اللاحقة</span>
    </div>
    <div class="divider-center">
      <div class="icon">${icon(opts.iconName, 52)}</div>
      <div class="kicker">${esc(opts.partLabel)}</div>
      <h1>${esc(opts.title)}</h1>
      <div class="rule"></div>
      <p class="lead">${esc(opts.subtitle)}</p>
    </div>
    <div class="divider-toc">${tocHtml}</div>
    <div class="page-no">${esc(opts.pageNo)}</div>
  </div>
</section>`;
}
