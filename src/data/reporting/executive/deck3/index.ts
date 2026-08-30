// Executive deck v3 entry points — the handoff-styled edition behind the
// Reports tab's «التصميم الجديد» toggle. Same contract as deck2: one
// ReportModel drives everything, so the numbers can never disagree with the
// other editions. The on-screen viewer chrome (side section nav, sticky
// toolbar with fullscreen + print/PDF, single-slide fullscreen mode) is
// deck2's, verbatim: the nav/fullscreen scripts are imported from
// deck2/index.ts and the markup mirrors buildDeckV2Html's, so the two decks
// review identically — only the slide design differs (theme.ts).
import { buildReportModel } from "../model/reportModel";
import { buildDeck3Slides } from "./slides";
import { DECK_V3_CSS } from "./theme";
import { icon } from "../ui/icons";
import { DECK_NAV_SCRIPT, DECK_FULLSCREEN_SCRIPT } from "../deck2";
import { openReportWindow, writeOrCloseOnFailure } from "../../htmlReport";
import { formatMonthFolderShortLabel } from "../../../population/monthFolder";
import { getLabels } from "../../../labels/labelsStore";
import { ZATCA_LOGO_URL } from "../../../../branding/organization";
import { esc } from "../primitives";
import type { ExecutiveReportInput } from "../../executiveReportTypes";

/**
 * Slides are a fixed 1920×1080 canvas scaled as one block via the
 * `--v3-scale` custom property (theme.ts). CSS alone can't derive the
 * unitless <number> `transform:scale()` needs from `100vw` (dividing a
 * length by a plain number stays a length, so the whole declaration is
 * dropped at parse time), so this script owns the ratio: an immediate
 * viewport-based estimate before first paint (it runs from <head>), then the
 * precise measurement of the viewer's content box once the DOM exists, re-run
 * on resize and fullscreen changes. In fullscreen the slide must fit BOTH
 * axes (one slide fills the screen), so the height ratio joins the min().
 *
 * Horizontal centering (`--v3-tx`, base/stacked mode only — fullscreen mode
 * centers via its own flex layout instead, see theme.ts) is a MEASURED pixel
 * correction, not a CSS percentage trick. A `right:50%;margin-right:-960px`
 * version shipped first and looked correct in every test here, but broke on
 * a real narrow window: for a `position:relative` box in a `dir="rtl"`
 * document, once `width` + both margins are all definite (margin-left
 * defaults to 0, not `auto`, the moment `margin-right` is set), the box model
 * is "over-constrained" and the spec has the browser silently recompute
 * `margin-left` around the *specified* `margin-right` — not leave it at the
 * `0` the CSS appears to say — so the box lands hundreds of pixels off from
 * a purely CSS-side calculation, direction- and width-dependent in a way
 * that's easy to miss testing a handful of viewport sizes. Measuring the
 * slide's actual rendered position after the scale is applied and shifting
 * it by exactly the pixel delta needed is immune to that: it doesn't matter
 * *why* the browser put the box where it did, only where it actually is.
 */
const DECK_V3_SCALE_SCRIPT = `(function(){
  var root = document.documentElement;
  function fullscreen(){ return document.fullscreenElement || document.webkitFullscreenElement; }
  function apply(scale){ root.style.setProperty('--v3-scale', String(scale > 0 ? scale : 1)); }
  function setTx(px){ root.style.setProperty('--v3-tx', px + 'px'); }
  function estimate(){
    var nav = window.innerWidth > 1280 ? 252 : 0;
    apply(Math.min(1, (window.innerWidth - nav - 32) / 1920));
  }
  function fit(){
    if (fullscreen()) {
      apply(Math.min((window.innerWidth - 32) / 1920, (window.innerHeight - 32) / 1080));
      setTx(0);
      return;
    }
    var viewer = document.querySelector('.deck-viewer-v3');
    if (!viewer) { estimate(); return; }
    var cs = getComputedStyle(viewer);
    var padL = parseFloat(cs.paddingLeft) || 0;
    var padR = parseFloat(cs.paddingRight) || 0;
    var avail = viewer.clientWidth - padL - padR;
    var scale = Math.min(1, avail / 1920);
    apply(scale);
    var slide = document.querySelector('.slide.v3');
    if (!slide) return;
    var viewerLeft = viewer.getBoundingClientRect().left;
    var extra = Math.max(0, avail - 1920 * scale);
    var targetLeft = viewerLeft + padL + extra / 2;
    var curLeft = slide.getBoundingClientRect().left;
    setTx(targetLeft - curLeft);
  }
  estimate();
  window.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  document.addEventListener('webkitfullscreenchange', fit);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fit);
  else fit();
})();`;

export function buildDeckV3Html(
  slides: string,
  monthLabel: string,
  brand: { title?: string; navBrand?: string; toolbarBrand?: string } = {},
): string {
  const labels = getLabels();
  const fullscreenEnter = esc(labels.exec_deck_fullscreen_enter);
  const fullscreenExit = esc(labels.exec_deck_fullscreen_exit);
  const slidePrevLabel = esc(labels.exec_deck_slideshow_prev);
  const slideNextLabel = esc(labels.exec_deck_slideshow_next);
  const title = brand.title ?? "العرض التنفيذي";
  const navBrand = brand.navBrand ?? "العرض التنفيذي";
  const toolbarBrand = brand.toolbarBrand ?? "العرض التنفيذي";
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} — ${esc(monthLabel)}</title>
<style>${DECK_V3_CSS}</style>
<script>${DECK_V3_SCALE_SCRIPT}</script>
</head>
<body>
<nav class="deck-nav" id="deck-nav" aria-label="التنقّل بين أقسام العرض">
  <div class="deck-nav-brand">
    <img src="${ZATCA_LOGO_URL}" alt=""/>
    <span>${esc(navBrand)}</span>
  </div>
  <div class="deck-nav-progress">
    <div class="deck-nav-progress-bar"><div class="deck-nav-progress-fill" id="deck-nav-fill"></div></div>
    <div class="deck-nav-progress-text" id="deck-nav-progress-text">الصفحة 1</div>
  </div>
  <ol class="deck-nav-sections" id="deck-nav-sections"></ol>
</nav>
<div class="deck-viewer deck-viewer-v3">
  <div class="deck-toolbar">
    <div class="deck-brand">
      <img src="${ZATCA_LOGO_URL}" alt=""/>
      <div>
        <strong>${esc(toolbarBrand)}</strong>
        <span>ضمان جودة الأشعة — ${esc(monthLabel)}</span>
      </div>
    </div>
    <div class="deck-toolbar-actions">
      <button class="btn btn-fullscreen" id="deck-fullscreen-button" type="button" aria-pressed="false" aria-label="${fullscreenEnter}" title="${fullscreenEnter}" data-enter-label="${fullscreenEnter}" data-exit-label="${fullscreenExit}"><span class="btn-fullscreen-icon btn-fullscreen-icon-expand">${icon("expand", 15)}</span><span class="btn-fullscreen-icon btn-fullscreen-icon-compress">${icon("compress", 15)}</span></button>
      <button class="btn" onclick="window.print()" title="اختر «حفظ كـ PDF» من المتصفح عند الطباعة، وليس «Microsoft Print to PDF»، لضمان الحجم والجودة الصحيحين">طباعة / PDF</button>
    </div>
  </div>
${slides}
</div>
<button type="button" class="btn-slide-nav btn-slide-prev" id="deck-slide-prev" aria-label="${slidePrevLabel}" title="${slidePrevLabel}">${icon("arrow", 20)}</button>
<button type="button" class="btn-slide-nav btn-slide-next" id="deck-slide-next" aria-label="${slideNextLabel}" title="${slideNextLabel}">${icon("arrow", 20)}</button>
<span class="deck-slide-counter" id="deck-slide-counter" dir="ltr"></span>
<script>${DECK_NAV_SCRIPT}${DECK_FULLSCREEN_SCRIPT}</script>
</body>
</html>`;
}

export async function buildExecutiveDeckV3(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<string> {
  const model = buildReportModel(input, employeeDisplayNames);
  const monthLabel = formatMonthFolderShortLabel(input.monthFolderName);
  const slides = await buildDeck3Slides(model, monthLabel, input.config.monthlyTarget);
  return buildDeckV3Html(slides, monthLabel);
}

export async function openExecutiveDeckV3(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(
    reportWindow,
    () => buildExecutiveDeckV3(input, employeeDisplayNames),
    `العرض_التنفيذي_${input.monthFolderName}.html`,
  );
}
