import type { RawFile } from "../data/types";
import type { EngineIssue } from "../errors";
import { esc, slideCss, slideHtml, themeIssues } from "../html/renderHtml";
import type { IssueEnv } from "../issue/issueReport";
import { layoutOnly } from "../issue/issueReport";
import { LAYOUT } from "../layout/layoutReport";
import type { LayoutSlide } from "../layout/types";
import type { IssueParams, ThemeTokens } from "../spec/types";
import { buildSpecFromPicks, designNumberOfPage } from "./bind";
import type { PickBinding, PicksBase } from "./bind";
import { DEMO_PARAMS, renderDesignDemo } from "./designs/demo";
import { NOTE_SLOT } from "./designs/shared";
import { CATALOG, activeDesigns } from "./registry";
import type { CatalogDesign } from "./types";

export interface LookbookPreview {
  numbers: number[];
  bindings: PickBinding[];
  base: PicksBase;
  files: RawFile[];
  /** The values the report will be issued with; defaults to DEMO_PARAMS. */
  params?: IssueParams;
}

export type LookbookResult = { ok: true; html: string } | { ok: false; issues: EngineIssue[] };

const TITLE = "دليل شرائح التقرير";
const INTRO = "كل شريحة أدناه نموذج جاهز. اختاروا الأرقام التي تناسب تقريركم، وسنملؤها ببيانات الشهر.";
const PLANNED_HEADING = "قيد الإعداد";
const REPLY = "أرسلوا أرقام الشرائح المطلوبة بالترتيب، مثال: 1، 4، 5";

/** The slot names the department is asked to supply; the source line is filled in when the report is issued. */
const needs = (d: CatalogDesign): string =>
  `يحتاج: ${d.slots.filter((s) => s.id !== NOTE_SLOT.id).map((s) => s.nameAr).join("، ")}`;

/** A slide scaled to the column width with CSS only: tan(atan2(a, b)) is the unitless ratio a / b. */
const frame = (s: LayoutSlide, theme: ThemeTokens): string => `<div class="frame">${slideHtml(s, theme)}</div>`;

const section = (d: CatalogDesign, slides: LayoutSlide[], theme: ThemeTokens): string =>
  `<article class="design" data-design-number="${d.number}">
<div class="head"><span class="num" dir="ltr">${d.number}</span><div class="meta"><h2>${esc(d.nameAr)}</h2><p>${esc(d.descriptionAr)}</p><p class="needs">${esc(needs(d))}</p></div></div>
${slides.map((s) => frame(s, theme)).join("\n")}
</article>`;

function lookbookCss(theme: ThemeTokens): string {
  const c = (k: keyof ThemeTokens["ink"]): string => theme.ink[k];
  return `main { max-width: 1120px; margin: 0 auto; padding: 40px 16px 64px; }
header h1 { font-size: 32px; font-weight: 700; color: ${c("navy")}; }
header p { margin-top: 8px; font-size: 17px; line-height: 1.7; color: ${c("muted")}; max-width: 60ch; }
.design { margin-top: 56px; padding-top: 24px; border-top: 1px solid ${c("hair")}; }
.head { display: flex; gap: 20px; align-items: flex-start; margin-bottom: 20px; }
.num { font-size: 72px; line-height: 0.9; font-weight: 700; color: ${c("navy")}; min-width: 1.4em; font-variant-numeric: lining-nums; }
.meta { min-width: 0; }
.meta h2 { font-size: 22px; font-weight: 700; color: ${c("text")}; }
.meta p { margin-top: 6px; font-size: 16px; line-height: 1.7; color: ${c("text")}; }
.meta p.needs { color: ${c("muted")}; }
.frame { position: relative; width: 100%; aspect-ratio: ${LAYOUT.slideW} / ${LAYOUT.slideH}; container-type: inline-size; overflow: hidden; margin-top: 12px; border: 1px solid ${c("hair")}; background: ${c("bg")}; }
.frame .slide { position: absolute; top: 0; right: 0; margin: 0; transform-origin: top right; transform: scale(tan(atan2(100cqw, ${LAYOUT.slideW}px))); }
.planned { margin-top: 56px; padding-top: 24px; border-top: 1px solid ${c("hair")}; }
.planned h2 { font-size: 22px; font-weight: 700; color: ${c("text")}; }
.planned ul { list-style: none; margin-top: 12px; }
.planned li { font-size: 16px; line-height: 2; color: ${c("muted")}; }
.planned li span { display: inline-block; min-width: 2.5em; color: ${c("text")}; font-weight: 700; }
.reply { margin-top: 48px; font-size: 18px; font-weight: 700; color: ${c("navy")}; }
@media (max-width: 600px) { .num { font-size: 48px; } .head { gap: 12px; } main { padding-top: 24px; } }
@media print { .frame { break-inside: avoid; } }`;
}

/** Preview slides grouped by design number, from the same layout pass issueReport runs. */
function previewSlides(p: LookbookPreview, env: IssueEnv): { ok: true; byNumber: Map<number, LayoutSlide[]> } | { ok: false; issues: EngineIssue[] } {
  const built = buildSpecFromPicks(p.numbers, p.bindings, p.base);
  if (!built.ok) return built;
  const r = layoutOnly(built.spec, p.files, p.params ?? DEMO_PARAMS, env);
  if (!r.ok) return r;
  const byNumber = new Map<number, LayoutSlide[]>();
  for (const s of r.doc.slides) {
    const n = designNumberOfPage(s.pageId);
    if (n === undefined) return { ok: false, issues: [{ rule: "catalog.unknownNumber", path: s.pageId }] };
    byNumber.set(n, [...(byNumber.get(n) ?? []), s]);
  }
  return { ok: true, byNumber };
}

/** The static catalog page (decision 16: no script). Demo data everywhere, or the bound picks with real files in preview mode. */
export function renderLookbook(env: IssueEnv, opts: { preview?: LookbookPreview } = {}): LookbookResult {
  const bad = themeIssues(env.theme);
  if (bad.length > 0) return { ok: false, issues: bad };
  let preview = new Map<number, LayoutSlide[]>();
  if (opts.preview !== undefined) {
    const p = previewSlides(opts.preview, env);
    if (!p.ok) return p;
    preview = p.byNumber;
  }
  const theme = env.theme;
  const sections = activeDesigns().map((d) => section(d, preview.get(d.number) ?? renderDesignDemo(d, env).slides, theme));
  const planned = CATALOG.filter((d) => d.status === "planned").sort((a, b) => a.number - b.number);
  const plannedHtml = planned.length === 0 ? "" : `<section class="planned"><h2>${PLANNED_HEADING}</h2><ul>${
    planned.map((d) => `<li><span dir="ltr">${d.number}</span>${esc(d.nameAr)}</li>`).join("")}</ul></section>`;
  const html = `<!DOCTYPE html>
<html lang="ar-SA" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<style>
${slideCss(theme)}
${lookbookCss(theme)}
</style>
</head>
<body>
<main>
<header><h1>${TITLE}</h1><p>${INTRO}</p></header>
${sections.join("\n")}
${plannedHtml}
<p class="reply">${REPLY}</p>
</main>
</body>
</html>
`;
  return { ok: true, html };
}
