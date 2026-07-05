// Executive deck v2 — content-first rebuild of the presentation edition.
// Page structure (user spec, 2026-07-04):
//   1  الغلاف       — report name, study period, issue date, department/section, ZATCA logo
//   2  المحتويات    — the report sections and the goal of each
//   3  المعجم       — key terms and what each means
//   4  فاصل القسم الأول — مجتمع الفحص
//   5  مجتمع الحالات بناءً على المخاطر — the 4 risk stages: population + sample per stage
//   6+ مجتمع حالات الفحص للشهر — two tables (منافذ برية / بحرية), paginated when long
//
// Design/CSS is intentionally minimal for now: it reuses the v1 deck theme so the
// content reads clearly; the dedicated visual pass happens after content approval.

import type { ReportModel } from "../model/reportModel";
import { esc, fmtNum, fmtPct } from "../primitives";
import { icon } from "../ui/icons";
import { isRankable } from "../model/dataSufficiency";
import { ORGANIZATION_PATH, ZATCA_LOGO_URL } from "../../../../branding/organization";

const ARABIC_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date): string {
  return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** A slide builder that receives its final 1-based number and the deck total. */
type SlideBuilder = (num: number, total: number) => string;

/**
 * Optical-centering correction for icons placed inside a circular badge.
 * Measured via `getBBox()` on every icon in the registry, rendered inside
 * its actual circle: most glyphs sit within ~0.5 of a 24-unit viewBox from
 * true center (imperceptible), but a few don't — `gauge`'s dial is drawn in
 * the lower half of its box, `truck` and `flag` are each off by ~1 unit on
 * one axis. Values are the glyph-bbox-center offset from (12,12) as a
 * percentage of the 24-unit viewBox, so the correction holds at any render
 * size (percentage `transform` is relative to the SVG's own box).
 */
const ICON_OPTICAL_NUDGE: Record<string, { x: number; y: number }> = {
  gauge: { x: 0, y: -10.8 },
  truck: { x: 2.1, y: -8.5 },
  flag: { x: 6.3, y: 0 },
};

/** Renders an icon meant to sit centered inside a circular badge, applying
 *  the optical-centering correction above when one exists for that icon.
 *  Plain (non-badge) icon usage elsewhere in the deck is unaffected. */
function badgeIcon(name: string, size: number): string {
  const nudge = ICON_OPTICAL_NUDGE[name];
  if (!nudge) return icon(name, size);
  return `<span style="display:inline-flex;transform:translate(${nudge.x}%,${nudge.y}%)">${icon(name, size)}</span>`;
}

/**
 * Per-slide print-include switch, top-right corner, on-screen only. Pure CSS,
 * no script: unchecking it excludes the WHOLE slide from print/PDF output via
 * the `.slide:has(.slide-print-toggle input:not(:checked))` rule in
 * theme.ts — safe to rely on `:has()` since this app already targets
 * Chromium only (File System Access API). Defaults checked (included).
 */
function printToggle(): string {
  return `<label class="slide-print-toggle" title="تضمين هذه الصفحة عند الطباعة">
    <input type="checkbox" checked/>
    <span class="slide-print-toggle-track"><span class="slide-print-toggle-thumb"></span></span>
  </label>`;
}

/** Section keys shared by the side nav (deck2/index.ts) and every slide builder
 *  that belongs to that section, so the nav's list and highlight logic can be
 *  derived purely from `data-section`/`data-section-label` attributes already
 *  in the DOM — no separate section registry to keep in sync. */
export const NAV_SECTIONS = {
  cover: "الغلاف",
  toc: "المحتويات",
  glossary: "المعجم",
  section1: "القسم 1 — مجتمع الفحص",
  section2: "القسم 2 — نتائج فحص الجودة",
} as const;
export type NavSectionKey = keyof typeof NAV_SECTIONS;

/**
 * Printed side tab rail (per the user's reference mockups): a vertical
 * report-title strip plus one rotated tab per section, running down every
 * content slide's inline-start edge, active section highlighted gold. Unlike
 * the on-screen deck-nav this is PART of the slide, so it prints. Arabic in
 * `writing-mode:vertical-rl` renders rotated 90° in Chromium — exactly the
 * look of the reference pages' edge tabs.
 */
function sideRail(active: NavSectionKey): string {
  const tabs: Array<{ key: NavSectionKey; label: string }> = [
    { key: "glossary", label: "المعجم" },
    { key: "section1", label: "مجتمع الفحص" },
    { key: "section2", label: "نتائج فحص الجودة" },
  ];
  return `<div class="v2-rail" aria-hidden="true">
    <div class="v2-rail-title">التقرير التنفيذي لضمان جودة الأشعة</div>
    ${tabs
      .map((t) => `<div class="v2-rail-tab${t.key === active ? " active" : ""}">${esc(t.label)}</div>`)
      .join("")}
  </div>`;
}

/** Footer page number, centered with short gold rules either side (the
 *  references' bottom-of-page device). Absolutely positioned inside the
 *  slide's existing bottom padding band — no impact on the body budget. */
function pageFoot(num: number, total: number): string {
  return `<div class="v2-page-foot" dir="ltr">${pad(num)} / ${pad(total)}</div>`;
}

/**
 * Wraps a slide's varying content into 1-of-4 selectable style variants.
 * Production (`variantPreview=false`) renders ONLY `bodies[0]` — byte-identical
 * to the single-variant output that existed before the switcher (a dev-preview
 * feature; see docs/superpowers/specs/2026-07-05-deck2-style-switcher-design.md).
 * Preview mode renders all 4, one visible via CSS (`.v2-variant-panel.active`),
 * plus an arrow-cycle control; the inline script in deck2/index.ts
 * (DECK_VARIANT_SCRIPT) does the cycling and persists the choice.
 */
function renderVariants(
  slideId: string,
  bodies: readonly [string, string, string, string],
  variantPreview: boolean,
): string {
  if (!variantPreview) return bodies[0];
  const panels = bodies
    .map(
      (html, i) =>
        `<div class="v2-variant-panel${i === 0 ? " active" : ""}" data-variant-index="${i}">${html}</div>`,
    )
    .join("");
  return `<div class="v2-variant-stack" data-slide-id="${esc(slideId)}" data-active-index="0">
    <div class="v2-variant-switcher">
      <button type="button" class="v2-variant-prev" aria-label="النمط السابق">‹</button>
      <span class="v2-variant-label">1 / 4</span>
      <button type="button" class="v2-variant-next" aria-label="النمط التالي">›</button>
    </div>
    ${panels}
  </div>`;
}

// ── v2 slide shell — rail + eyebrow + headline + body + footer page num. ────
// Unlike v1 there is no "decision footer"; the footer concept is gone in v2.
function v2Slide(opts: {
  id: string;
  title: string;
  eyebrow: string;
  iconName: string;
  headline: string;
  subhead?: string;
  bodyVariants: readonly [string, string, string, string];
  variantPreview: boolean;
  num: number;
  total: number;
  slideClass?: string;
  section: NavSectionKey;
}): string {
  const cls = `slide v2${opts.slideClass ? " " + opts.slideClass : ""}`;
  const body = renderVariants(opts.id, opts.bodyVariants, opts.variantPreview);
  return `<section class="${cls}" id="${esc(opts.id)}" data-title="${esc(opts.title)}" data-section="${opts.section}" data-section-label="${esc(NAV_SECTIONS[opts.section])}">
  ${printToggle()}
  ${sideRail(opts.section)}
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(opts.iconName, 16)}</span>
      <span>${esc(opts.eyebrow)}</span>
    </div>
    <div class="slide-headline">${esc(opts.headline)}</div>
    ${opts.subhead ? `<div class="slide-subhead">${esc(opts.subhead)}</div>` : ""}
    <div class="slide-body">${body}</div>
  </div>
  ${pageFoot(opts.num, opts.total)}
</section>`;
}

// ── Page 1 — الغلاف ─────────────────────────────────────────────────────────
export function coverSlide(model: ReportModel, generatedAt: Date, variantPreview: boolean): string {
  const [, department, section] = ORGANIZATION_PATH;
  const meta = [
    { label: "فترة الدراسة (عيّنة شهر)", value: model.summary.periodId, iconName: "layers" },
    { label: "تاريخ إصدار التقرير", value: formatDate(generatedAt), iconName: "document" },
    { label: "الإدارة", value: department, iconName: "users" },
    { label: "القسم", value: section, iconName: "shield" },
  ]
    .map(
      (m) => `<div class="v2-cover-meta-item">
        <span class="v2-cover-meta-icon">${badgeIcon(m.iconName, 20)}</span>
        <span class="v2-cover-meta-text">
          <span class="v2-cover-meta-label">${esc(m.label)}</span>
          <span class="v2-cover-meta-value">${esc(m.value)}</span>
        </span>
      </div>`,
    )
    .join("");
  // Org header block (per the reference mockups): logo + gold divider + the
  // organizational hierarchy lines, top-start of the page.
  const orgBlock = `<div class="v2-org">
      <img class="v2-org-logo" src="${ZATCA_LOGO_URL}" alt="هيئة الزكاة والضريبة والجمارك"/>
      <div class="v2-org-lines">
        <b>هيئة الزكاة والضريبة والجمارك</b>
        ${ORGANIZATION_PATH.map((line) => `<span>${esc(line)}</span>`).join("")}
      </div>
    </div>`;
  const coverBody = `<div class="title-kicker">عرض تنفيذي</div>
      <h1>تقرير ضمان جودة فحص الأشعة</h1>
      <div class="title-rule"></div>
      <div class="v2-cover-meta">${meta}</div>
      <div class="title-classify"><span>${icon("shield", 14)}</span>داخلي — للاستخدام التنفيذي</div>`;
  const body = renderVariants("slide-cover", [coverBody, coverBody, coverBody, coverBody], variantPreview);
  return `<section class="slide v2 title-slide" id="slide-cover" data-title="الغلاف" data-section="cover" data-section-label="${esc(NAV_SECTIONS.cover)}">
    ${printToggle()}
    <div class="slide-art" aria-hidden="true"></div>
    ${orgBlock}
    <div class="slide-inner">
      ${body}
    </div>
  </section>`;
}

// ── Page 2 — المحتويات ──────────────────────────────────────────────────────
export type TocItem = { title: string; goal: string; range: string; iconName: string };

export function tocSlide(items: TocItem[], num: number, total: number, variantPreview: boolean): string {
  const body = `<div class="deck-agenda">${items
    .map(
      (it, i) => `<div class="deck-agenda-item">
        <div class="deck-agenda-num">${pad(i + 1)}</div>
        <div class="deck-agenda-body"><h4><span class="deck-agenda-icon">${icon(it.iconName, 15)}</span>${esc(it.title)}</h4><p>${esc(it.goal)}</p></div>
        <div class="deck-agenda-range" dir="ltr">${esc(it.range)}</div>
      </div>`,
    )
    .join("")}</div>`;
  return v2Slide({
    id: "slide-toc",
    title: "المحتويات",
    eyebrow: "المحتويات",
    iconName: "layers",
    headline: "محتويات التقرير",
    subhead: "أقسام التقرير والهدف من كل قسم.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "toc",
  });
}

// ── Page 3 — المعجم ─────────────────────────────────────────────────────────
type Tone = "gold" | "blue" | "green" | "coral" | "slate" | "purple" | "cyan";

/** Starter glossary — terms, definitions, icon, and accent tone are content, edit freely here. */
const GLOSSARY: Array<{ term: string; def: string; icon: string; tone: Tone }> = [
  { term: "مجتمع الفحص", def: "جميع حالات الفحص بالأشعة المسجّلة خلال الشهر بعد المعالجة واستبعاد السجلات غير الصالحة.", icon: "layers", tone: "gold" },
  { term: "العيّنة", def: "مجموعة جزئية تُسحب عشوائيًا بطريقة طبقية من المجتمع لتخضع للدراسة التفصيلية.", icon: "scan", tone: "blue" },
  { term: "التغطية", def: "نسبة حجم العيّنة إلى حجم المجتمع.", icon: "gauge", tone: "green" },
  { term: "سليمة", def: "قرار فحص لا يشير إلى وجود شبهة في الصورة.", icon: "check", tone: "green" },
  { term: "اشتباه", def: "قرار فحص يشير إلى شبهة تستدعي التحقق.", icon: "alert", tone: "coral" },
  { term: "مستويات المخاطر", def: "تصنيف الحالات وفق محرّك المخاطر إلى أربعة مستويات، من الأول إلى الرابع.", icon: "layers", tone: "purple" },
  { term: "المستوى الأول / الثاني", def: "قرار المفتش الأول على الصورة، ثم مراجعة المفتش الثاني للقرار.", icon: "flag", tone: "blue" },
  { term: "المراجع (المعيار)", def: "نتيجة خبير الجودة التي تُقاس عليها دقة قرارات الفحص.", icon: "shield", tone: "gold" },
  { term: "الاشتباه الفائت", def: "حالة قرّر الفحص أنها سليمة وأثبت المراجع أنها اشتباه — الخطر الأمني الأول.", icon: "alert", tone: "coral" },
  { term: "الاشتباه الخاطئ", def: "حالة قرّر الفحص أنها اشتباه وأثبت المراجع أنها سليمة.", icon: "alert", tone: "slate" },
  { term: "CertScan", def: "الحالات الموثّقة بشهادة مسح معتمدة ضمن بيانات الفحص.", icon: "shield", tone: "cyan" },
  { term: "كفاية البيانات", def: "حدّ أدنى من القرارات القابلة للتقييم قبل إصدار حكم أو ترتيب — ما دونه يُوصف ولا يُرتّب.", icon: "document", tone: "slate" },
];

/** One glossary card: icon-circle badge + term + definition, colored bottom border. */
function termCard(g: (typeof GLOSSARY)[number]): string {
  return `<div class="v2-term-card ${g.tone}">
    <div class="v2-term-card-head">
      <span class="v2-term-icon">${badgeIcon(g.icon, 20)}</span>
      <b>${esc(g.term)}</b>
    </div>
    <p>${esc(g.def)}</p>
  </div>`;
}

/** Terms per page — beyond this the glossary overflows to a continuation page. */
const GLOSSARY_TERMS_PER_PAGE = 12;

/** Build one or more المعجم slides (paginated card grid, per the reference design). */
export function glossarySlideBuilders(variantPreview: boolean): SlideBuilder[] {
  const pages = Math.max(1, Math.ceil(GLOSSARY.length / GLOSSARY_TERMS_PER_PAGE));
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < pages; page++) {
    const chunk = GLOSSARY.slice(page * GLOSSARY_TERMS_PER_PAGE, (page + 1) * GLOSSARY_TERMS_PER_PAGE);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-term-grid">${chunk.map(termCard).join("")}</div>`;
      return v2Slide({
        id: `slide-glossary-${page + 1}`,
        title: `المعجم${cont}`,
        eyebrow: "المعجم",
        iconName: "document",
        headline: `المعجم — المصطلحات الرئيسية${cont}`,
        subhead: "توحيد المصطلحات قبل قراءة النتائج.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "glossary",
      });
    });
  }
  return builders;
}

// ── Section separator (page 4 pattern) ──────────────────────────────────────
export function sectionSeparatorSlide(
  sectionNo: number,
  sectionKey: NavSectionKey,
  iconName: string,
  title: string,
  blurb: string,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const sepBody = `<div class="v2-sep">
      <div class="v2-sep-icon">${badgeIcon(iconName, 30)}</div>
      <div class="v2-sep-num">${pad(sectionNo)}</div>
      <h2>${esc(title)}</h2>
      <div class="v2-sep-rule"></div>
      <p>${esc(blurb)}</p>
    </div>`;
  const body = renderVariants(`slide-sep-${sectionNo}`, [sepBody, sepBody, sepBody, sepBody], variantPreview);
  return `<section class="slide v2" id="slide-sep-${sectionNo}" data-title="${esc(title)}" data-section="${sectionKey}" data-section-label="${esc(NAV_SECTIONS[sectionKey])}">
  ${printToggle()}
  ${sideRail(sectionKey)}
  <div class="v2-sep-bg" aria-hidden="true"></div>
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(iconName, 16)}</span>
      <span>القسم ${esc(String(sectionNo))}</span>
    </div>
    ${body}
  </div>
  ${pageFoot(num, total)}
</section>`;
}

// ── Page 5 — مجتمع الحالات بناءً على المخاطر ────────────────────────────────
const STAGE_TONES = ["gold", "blue", "green", "coral"] as const;

/** Short severity tag shown at the bottom of each card (per the reference
 *  layout's "source of truth" / "final artifact" style caption). Keyed by
 *  stage label so an unmatched/custom label just falls back to the number. */
const STAGE_SHORT_TAG: Record<string, string> = {
  "المستوى الأول": "مستوى منخفض",
  "المستوى الثاني": "مستوى متوسط",
  "المستوى الثالث": "مستوى مرتفع",
  "المستوى الرابع": "مستوى حرج",
};

export function riskStagesSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
  const stages = model.population.byStage;
  const tiles = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const tag = STAGE_SHORT_TAG[s.stageLabel] ?? `المستوى ${i + 1}`;
      return `<div class="v2-stage-card ${tone}">
        <div class="v2-stage-head">
          <span class="v2-stage-num">${i + 1}</span>
          <b>${esc(s.stageLabel)}</b>
        </div>
        <div class="v2-stage-list">
          <div class="v2-stage-row"><span>الحالات</span><b>${fmtNum(s.population)}</b></div>
          <div class="v2-stage-row"><span>العيّنة</span><b>${fmtNum(s.sampleSize)}</b></div>
          <div class="v2-stage-row"><span>التغطية</span><b>${fmtPct(s.coverage)}</b></div>
        </div>
        <div class="v2-stage-tag">${esc(tag)}</div>
      </div>`;
    })
    .join("");
  const totals = `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 18)}</span><span><b>${fmtNum(model.population.total)}</b><small>إجمالي المجتمع (حالة)</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("scan", 18)}</span><span><b>${fmtNum(model.sample.total)}</b><small>إجمالي العيّنة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("gauge", 18)}</span><span><b>${fmtPct(model.sample.coverage)}</b><small>التغطية الكلية</small></span></div>
  </div>`;
  const body = `<div class="kpi-band n${Math.min(4, Math.max(2, stages.length))}">${tiles}</div>${totals}`;
  return v2Slide({
    id: "slide-risk-stages",
    title: "مجتمع الحالات بناءً على المخاطر",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "gauge",
    headline: "مجتمع الحالات بناءً على المخاطر",
    subhead: "توزيع المجتمع بعد المعالجة على مستويات المخاطر الأربعة، وحصة كل مستوى من العيّنة.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}

// ── Page 6+ — مجتمع حالات الفحص للشهر (جداول المنافذ) ───────────────────────
type PortPopRow = {
  name: string;
  total: number;
  clean: number;
  suspicious: number;
  sampleTotal: number;
  sampleClean: number;
  sampleSuspicious: number;
};

function collectPortStats(model: ReportModel): { land: PortPopRow[]; sea: PortPopRow[] } {
  const map = new Map<string, PortPopRow & { sea: boolean }>();
  for (const r of model.rows) {
    const name = r.portName ?? "غير محدد";
    let cur = map.get(name);
    if (!cur) {
      cur = {
        name,
        total: 0,
        clean: 0,
        suspicious: 0,
        sampleTotal: 0,
        sampleClean: 0,
        sampleSuspicious: 0,
        sea: (r.portType ?? "").includes("بحري"),
      };
      map.set(name, cur);
    }
    cur.total += 1;
    if (r.imageResult === "اشتباه") cur.suspicious += 1;
    else cur.clean += 1;
    if (r.selectedInSample) {
      cur.sampleTotal += 1;
      if (r.imageResult === "اشتباه") cur.sampleSuspicious += 1;
      else cur.sampleClean += 1;
    }
  }
  const all = [...map.values()].sort((a, b) => b.total - a.total);
  return { land: all.filter((p) => !p.sea), sea: all.filter((p) => p.sea) };
}

/** A stacked cell: the sample figure (big) over its population base (small). */
function frac(sampleN: number, popN: number): string {
  return `<span class="v2-frac"><b>${fmtNum(sampleN)}</b><span>من ${fmtNum(popN)}</span></span>`;
}

/** Row metrics, measured live in the browser with sub-pixel precision
 *  (v39.9/v39.10, retuned v39.16, re-measured v39.29 after the side-rail
 *  width change subtly shifted text-metric rounding). The sample table's
 *  stacked "N من M" cells (`.v2-frac`) are tuned in CSS to land close to the
 *  population table's plain single-line row height, but NOT identically —
 *  v39.29 found the compact tier's frac cells measure ~1.1-1.5px shorter
 *  than plain cells at the current layout width, so compact tier needs its
 *  own metrics for `mode === "sample"` rather than assuming parity. */
type ModeMetrics = { rowH: number; theadH: number; tfootH: number };
const METRICS_NORMAL: ModeMetrics = { rowH: 41.6, theadH: 41.2, tfootH: 41.2 };
const METRICS_COMPACT: ModeMetrics = { rowH: 25.4, theadH: 25, tfootH: 25 };
const METRICS_COMPACT_SAMPLE: ModeMetrics = { rowH: 23.925, theadH: 25, tfootH: 23.525 };

/** Vertical budget for one card's thead+rows+tfoot together, measured live:
 *  the 16:9 slide's `.slide-body` renders at 458.8px, a card header at 70px
 *  (388.8px), minus a small safety margin for the border-box + sub-pixel
 *  rounding that otherwise causes a 1-2px overflow in `.v2-port-col`'s own
 *  clipping (its 1px border eats into the content box on each side). */
const TABLE_BUDGET_PX = 387;

/**
 * One land/sea table as a tinted card (per the reference design). `population`
 * = plain month numbers (الحالات/سليمة/اشتباه). `sample` = same shape, but every
 * numeric cell stacks the drawn-sample figure over `من {population}`, plus a
 * التغطية column. The gap before الإجمالي is ONE spacer row sized to the
 * EXACT leftover pixels in the card's budget (not a fixed row count — a fixed
 * count left visible slack that showed as a gap, or as dead space below the
 * totals row once `compact` mode shrank real rows below the padded target).
 * This way the totals row always sits flush against the bottom of the card,
 * for any port count, in either tier.
 */
function portTable(
  title: string,
  rows: PortPopRow[],
  mode: "population" | "sample",
  variant: "land" | "sea",
  compact: boolean,
): string {
  const span = mode === "population" ? 4 : 5;
  const dataRowCount = rows.length > 0 ? rows.length : 1; // the "—" placeholder counts as one row
  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            if (mode === "population") {
              return `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.total)}</td><td>${fmtNum(p.clean)}</td><td>${fmtNum(p.suspicious)}</td></tr>`;
            }
            const coverage = p.total > 0 ? (p.sampleTotal / p.total) * 100 : 0;
            return `<tr><td>${esc(p.name)}</td><td>${frac(p.sampleTotal, p.total)}</td><td>${frac(p.sampleClean, p.clean)}</td><td>${frac(p.sampleSuspicious, p.suspicious)}</td><td>${fmtPct(coverage)}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">—</span></td></tr>`;

  const metrics = compact ? (mode === "sample" ? METRICS_COMPACT_SAMPLE : METRICS_COMPACT) : METRICS_NORMAL;
  const usedPx = metrics.theadH + metrics.tfootH + dataRowCount * metrics.rowH;
  const fillerPx = Math.max(0, TABLE_BUDGET_PX - usedPx);
  const blankRow =
    fillerPx > 0 ? `<tr class="v2-blank" style="height:${fillerPx}px"><td colspan="${span}">&nbsp;</td></tr>` : "";

  const sum = (f: (p: PortPopRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalPop = sum((p) => p.total);
  const totalSample = sum((p) => p.sampleTotal);
  const totalsRow =
    mode === "population"
      ? `<tr><td>الإجمالي</td><td>${fmtNum(totalPop)}</td><td>${fmtNum(sum((p) => p.clean))}</td><td>${fmtNum(sum((p) => p.suspicious))}</td></tr>`
      : `<tr><td>الإجمالي</td><td>${frac(totalSample, totalPop)}</td><td>${frac(sum((p) => p.sampleClean), sum((p) => p.clean))}</td><td>${frac(sum((p) => p.sampleSuspicious), sum((p) => p.suspicious))}</td><td>${fmtPct(totalPop > 0 ? (totalSample / totalPop) * 100 : 0)}</td></tr>`;

  const headSub =
    mode === "population"
      ? `${fmtNum(rows.length)} منفذ · ${fmtNum(totalPop)} حالة`
      : `${fmtNum(rows.length)} منفذ · ${fmtNum(totalSample)} عيّنة من ${fmtNum(totalPop)} حالة`;
  const ths =
    mode === "population"
      ? `<th>المنفذ</th><th>الحالات</th><th>سليمة</th><th>اشتباه</th>`
      : `<th>المنفذ</th><th>العيّنة</th><th>سليمة</th><th>اشتباه</th><th>التغطية</th>`;
  const headIcon = variant === "land" ? "truck" : "ship";
  const cls = `v2-port-col ${variant}${mode === "sample" ? " sample-mode" : ""}${compact ? " compact" : ""}`;

  return `<div class="${cls}">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${badgeIcon(headIcon, 26)}</span>
      <div><b>${esc(title)}</b><span>${headSub}</span></div>
    </div>
    <table class="deck-table">
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/**
 * Row budget, measured live (v39.10, recomputed v39.16 for the taller,
 * ink-safe row height) — each `.v2-port-col` card clips its own overflow, so
 * a table taller than its card silently loses its bottom rows (the totals
 * row first). The 16:9 slide's `.slide-body` renders at 459px and a card
 * header at 71px, leaving a 388px budget for thead+rows+tfoot together →
 * (388 − 41 − 41) / 41 ≈ 7 rows. Both port-table modes share this budget
 * since the sample table's stacked cells are tuned to the exact same row
 * height as the population table's plain cells.
 */
const BASE_ROWS_PER_PAGE = 7;

/**
 * If a table overflows its base budget by only 1–3 rows, compress row height
 * slightly (the `compact` CSS variant) so everyone fits on one page instead
 * of spilling those 1–3 rows onto a near-empty continuation page. Beyond a
 * 3-row overflow, paginate normally at the base row size. The shared compact
 * tier was measured to comfortably fit BASE+3 for both modes (12 population
 * rows, 9 sample rows) with 80px+ of slack to spare.
 */
const COMPRESS_OVERFLOW_MAX = 3;

type PortPagePlan = { pages: number; rowsPerPage: number; compact: boolean };

function planPortPages(landCount: number, seaCount: number, baseRowsPerPage: number): PortPagePlan {
  const maxCount = Math.max(landCount, seaCount);
  if (maxCount <= baseRowsPerPage) {
    return { pages: 1, rowsPerPage: baseRowsPerPage, compact: false };
  }
  const overflow = maxCount - baseRowsPerPage;
  if (overflow <= COMPRESS_OVERFLOW_MAX) {
    return { pages: 1, rowsPerPage: maxCount, compact: true };
  }
  return { pages: Math.ceil(maxCount / baseRowsPerPage), rowsPerPage: baseRowsPerPage, compact: false };
}

/** Build one or more port-population slides (paginated land/sea in parallel). */
export function portPopulationSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${portTable("المنافذ البرية", landChunk, "population", "land", plan.compact)}${portTable("المنافذ البحرية", seaChunk, "population", "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-port-population-${page + 1}`,
        title: `مجتمع حالات الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `مجتمع حالات الفحص لشهر ${model.summary.periodId}${cont}`,
        subhead: "منهجية التصنيف: تُصنَّف الحالة اشتباهًا إذا كانت نتيجة المستوى الأول أو الثاني اشتباهًا، وفي غير ذلك تُصنَّف سليمة.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section1",
      });
    });
  }
  return builders;
}

/** Sample mirror of the population page: sample figures stacked over their population base + coverage. */
export function portSampleSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${portTable("المنافذ البرية", landChunk, "sample", "land", plan.compact)}${portTable("المنافذ البحرية", seaChunk, "sample", "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-port-sample-${page + 1}`,
        title: `عيّنة الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `عيّنة الفحص المسحوبة لشهر ${model.summary.periodId}${cont}`,
        subhead: "الصفحة نفسها بأرقام العيّنة: كل رقم عيّنة وتحته أساسه من المجتمع، مع نسبة التغطية.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section1",
      });
    });
  }
  return builders;
}

// ── Section 2, page A — نتائج جودة الصور في المنافذ ─────────────────────────
type PortQualityRow = {
  name: string;
  imageAvailable: number;
  imageMissing: number;
  markingPresent: number;
  markingMissing: number;
  highQ: number;
  medQ: number;
  lowQ: number;
};

/** Denominator-gated rate — null (renders "—") when there's nothing to divide by. */
function rateOf(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

/** A percentage cell, muted (`.insuff`, matching the v1 deck's own port
 *  tables) when there's nothing to show rather than plain white "—" text. */
function pctCell(v: number | null): string {
  return v === null ? `<span class="insuff">—</span>` : fmtPct(v);
}

/**
 * Per-port image-quality tallies, computed fresh from `model.rows` using the
 * EXACT same predicates as the global KPI calculator
 * (`calculateExecutiveKPIs` in `executiveReportData.ts`): submitted answers
 * only, then `imageAvailable`/`hasMarking`/`imageQuality`. No per-port
 * version of these existed on the model before this page.
 */
function collectPortQualityStats(model: ReportModel): { land: PortQualityRow[]; sea: PortQualityRow[] } {
  const map = new Map<string, PortQualityRow & { sea: boolean }>();
  for (const r of model.rows) {
    if (r.answerStatus !== "submitted") continue;
    const name = r.portName ?? "غير محدد";
    let cur = map.get(name);
    if (!cur) {
      cur = {
        name,
        imageAvailable: 0,
        imageMissing: 0,
        markingPresent: 0,
        markingMissing: 0,
        highQ: 0,
        medQ: 0,
        lowQ: 0,
        sea: (r.portType ?? "").includes("بحري"),
      };
      map.set(name, cur);
    }
    if (r.imageAvailable === true) cur.imageAvailable += 1;
    else if (r.imageAvailable === false) cur.imageMissing += 1;
    if (r.hasMarking === true) cur.markingPresent += 1;
    else if (r.hasMarking === false) cur.markingMissing += 1;
    if (r.imageQuality === "عالي") cur.highQ += 1;
    else if (r.imageQuality === "متوسط") cur.medQ += 1;
    else if (r.imageQuality === "منخفض") cur.lowQ += 1;
  }
  const all = [...map.values()].sort(
    (a, b) => b.imageAvailable + b.imageMissing - (a.imageAvailable + a.imageMissing),
  );
  return { land: all.filter((p) => !p.sea), sea: all.filter((p) => p.sea) };
}

function qualityTable(title: string, rows: PortQualityRow[], variant: "land" | "sea", compact: boolean): string {
  const span = 5;
  const dataRowCount = rows.length > 0 ? rows.length : 1;
  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            // One shared denominator for the three level columns (quality-evaluated
            // images at this port), so عالي+متوسط+منخفض sum to ~100% per row.
            const evaluated = p.highQ + p.medQ + p.lowQ;
            const high = rateOf(p.highQ, evaluated);
            const med = rateOf(p.medQ, evaluated);
            const low = rateOf(p.lowQ, evaluated);
            const marking = rateOf(p.markingPresent, p.markingPresent + p.markingMissing);
            return `<tr><td>${esc(p.name)}</td><td>${pctCell(high)}</td><td>${pctCell(med)}</td><td>${pctCell(low)}</td><td>${pctCell(marking)}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">—</span></td></tr>`;

  const metrics = compact ? METRICS_COMPACT : METRICS_NORMAL;
  const usedPx = metrics.theadH + metrics.tfootH + dataRowCount * metrics.rowH;
  const fillerPx = Math.max(0, TABLE_BUDGET_PX - usedPx);
  const blankRow =
    fillerPx > 0 ? `<tr class="v2-blank" style="height:${fillerPx}px"><td colspan="${span}">&nbsp;</td></tr>` : "";

  const sum = (f: (p: PortQualityRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalMarkP = sum((p) => p.markingPresent);
  const totalMarkM = sum((p) => p.markingMissing);
  const totalHigh = sum((p) => p.highQ);
  const totalMed = sum((p) => p.medQ);
  const totalLow = sum((p) => p.lowQ);
  const totalEvaluated = totalHigh + totalMed + totalLow;
  const totalsRow = `<tr><td>الإجمالي</td><td>${pctCell(rateOf(totalHigh, totalEvaluated))}</td><td>${pctCell(rateOf(totalMed, totalEvaluated))}</td><td>${pctCell(rateOf(totalLow, totalEvaluated))}</td><td>${pctCell(rateOf(totalMarkP, totalMarkP + totalMarkM))}</td></tr>`;

  const headSub = `${fmtNum(rows.length)} منفذ`;
  const ths = `<th>المنفذ</th><th>عالي</th><th>متوسط</th><th>منخفض</th><th>التحديد</th>`;
  const headIcon = variant === "land" ? "truck" : "ship";
  const cls = `v2-port-col ${variant}${compact ? " compact" : ""}`;

  return `<div class="${cls}">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${badgeIcon(headIcon, 26)}</span>
      <div><b>${esc(title)}</b><span>${headSub}</span></div>
    </div>
    <table class="deck-table">
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** Build one or more image-quality slides (paginated land/sea in parallel). */
export function qualityPortSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortQualityStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${qualityTable("المنافذ البرية", landChunk, "land", plan.compact)}${qualityTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-quality-ports-${page + 1}`,
        title: `نتائج جودة الصور${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "scan",
        headline: `نتائج جودة الصور في المنافذ${cont}`,
        subhead: "توزيع مستويات جودة الصورة (عالي / متوسط / منخفض) ونسبة وجود التحديد في كل منفذ.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section2",
      });
    });
  }
  return builders;
}

// ── Section 2, page B — نتائج دقة نتائج المنافذ (اشتباه / سليمة) ───────────
type PortAccuracyRow = {
  name: string;
  evaluable: number;
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
  rankable: boolean;
};

/**
 * Per-port accuracy, from `model.portAccuracy` — the SAME aggregate the old
 * v1 deck's port-ranking slide already consumes (`Aggregates["byPort"]`), so
 * no new accuracy math is invented here. دقة السليمة is the one derived
 * value not already named on that aggregate: correctClean / (correctClean +
 * falseSuspicion). Ports below the data-sufficiency threshold are flagged
 * `rankable:false` — the table still lists them but shows "—" for their
 * rates rather than a misleading number (same `isRankable(band)` gate used
 * everywhere else in this report).
 */
function collectPortAccuracyRows(model: ReportModel): { land: PortAccuracyRow[]; sea: PortAccuracyRow[] } {
  const seaByPort = new Map<string, boolean>();
  for (const r of model.rows) {
    const name = r.portName ?? "غير محدد";
    if (!seaByPort.has(name)) seaByPort.set(name, (r.portType ?? "").includes("بحري"));
  }
  const items = model.portAccuracy.map((p) => ({
    name: p.key,
    evaluable: p.evaluable,
    correctClean: p.correctClean,
    correctSuspicion: p.correctSuspicion,
    missedSuspicion: p.missedSuspicion,
    falseSuspicion: p.falseSuspicion,
    rankable: isRankable(p.band),
    sea: seaByPort.get(p.key) ?? false,
  }));
  const all = items.sort((a, b) => b.evaluable - a.evaluable);
  return { land: all.filter((p) => !p.sea), sea: all.filter((p) => p.sea) };
}

function accuracyTable(title: string, rows: PortAccuracyRow[], variant: "land" | "sea", compact: boolean): string {
  const span = 4;
  const dataRowCount = rows.length > 0 ? rows.length : 1;
  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            const accuracy = rateOf(p.correctClean + p.correctSuspicion, p.evaluable);
            const detection = rateOf(p.correctSuspicion, p.correctSuspicion + p.missedSuspicion);
            const clean = rateOf(p.correctClean, p.correctClean + p.falseSuspicion);
            const show = (v: number | null) => pctCell(p.rankable ? v : null);
            return `<tr><td>${esc(p.name)}</td><td>${show(accuracy)}</td><td>${show(detection)}</td><td>${show(clean)}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">—</span></td></tr>`;

  const metrics = compact ? METRICS_COMPACT : METRICS_NORMAL;
  const usedPx = metrics.theadH + metrics.tfootH + dataRowCount * metrics.rowH;
  const fillerPx = Math.max(0, TABLE_BUDGET_PX - usedPx);
  const blankRow =
    fillerPx > 0 ? `<tr class="v2-blank" style="height:${fillerPx}px"><td colspan="${span}">&nbsp;</td></tr>` : "";

  const sum = (f: (p: PortAccuracyRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalEvaluable = sum((p) => p.evaluable);
  const totalCC = sum((p) => p.correctClean);
  const totalCS = sum((p) => p.correctSuspicion);
  const totalMS = sum((p) => p.missedSuspicion);
  const totalFS = sum((p) => p.falseSuspicion);
  const totalsRow = `<tr><td>الإجمالي</td><td>${pctCell(rateOf(totalCC + totalCS, totalEvaluable))}</td><td>${pctCell(rateOf(totalCS, totalCS + totalMS))}</td><td>${pctCell(rateOf(totalCC, totalCC + totalFS))}</td></tr>`;

  const headSub = `${fmtNum(rows.length)} منفذ`;
  const ths = `<th>المنفذ</th><th>الدقة العامة</th><th>دقة الاشتباه</th><th>دقة السليمة</th>`;
  const headIcon = variant === "land" ? "truck" : "ship";
  const cls = `v2-port-col ${variant}${compact ? " compact" : ""}`;

  return `<div class="${cls}">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${badgeIcon(headIcon, 26)}</span>
      <div><b>${esc(title)}</b><span>${headSub}</span></div>
    </div>
    <table class="deck-table">
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** Build one or more port-accuracy slides (paginated land/sea in parallel). */
export function accuracyPortSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortAccuracyRows(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${accuracyTable("المنافذ البرية", landChunk, "land", plan.compact)}${accuracyTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-quality-accuracy-${page + 1}`,
        title: `دقة نتائج المنافذ${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "gauge",
        headline: `نتائج دقة نتائج المنافذ (اشتباه / سليمة)${cont}`,
        subhead: "الدقة العامة، ودقة اكتشاف الاشتباه، ودقة تأكيد السليمة.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section2",
      });
    });
  }
  return builders;
}

// ── Assembly ─────────────────────────────────────────────────────────────────
/**
 * Build all v2 slides in order. Section page ranges on the المحتويات slide are
 * computed from the real build sequence (never hand-typed), so the TOC cannot
 * drift as pages are added, removed, or paginated differently month to month.
 */
export function buildDeckV2Slides(
  model: ReportModel,
  generatedAt = new Date(),
  variantPreview = false,
): string {
  const glossaryBuilders = glossarySlideBuilders(variantPreview); // 1..N pages, paginated by term count

  // Section 1 — مجتمع الفحص: separator + risk stages + port tables (1..N pages).
  const sectionOne: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(
        1,
        "section1",
        "layers",
        "مجتمع الفحص",
        "التعريف بمجتمع الحالات لهذا الشهر: حجمه، توزيعه على مستويات المخاطر، وتوزيعه على المنافذ البرية والبحرية — الأساس الذي سُحبت منه العيّنة.",
        num,
        total,
        variantPreview,
      ),
    (num, total) => riskStagesSlide(model, num, total, variantPreview),
    ...portPopulationSlideBuilders(model, variantPreview),
    ...portSampleSlideBuilders(model, variantPreview),
  ];

  // Section 2 — نتائج فحص الجودة: separator + image-quality page(s) + accuracy page(s).
  const sectionTwo: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(
        2,
        "section2",
        "gauge",
        "نتائج فحص الجودة",
        "جودة الصور المفحوصة في كل منفذ (التوفر والتحديد والجودة المقبولة)، ودقة قرارات الفحص بين الاشتباه والسليمة.",
        num,
        total,
        variantPreview,
      ),
    ...qualityPortSlideBuilders(model, variantPreview),
    ...accuracyPortSlideBuilders(model, variantPreview),
  ];

  const total = 2 + glossaryBuilders.length + sectionOne.length + sectionTwo.length; // cover + toc + glossary(N) + section 1 + section 2
  const glossaryStart = 3;
  const glossaryEnd = 2 + glossaryBuilders.length;
  const sectionOneStart = glossaryEnd + 1;
  const sectionOneEnd = sectionOneStart + sectionOne.length - 1;
  const sectionTwoStart = sectionOneEnd + 1;

  const tocItems: TocItem[] = [
    {
      title: "المعجم",
      goal: "توحيد المصطلحات الرئيسية قبل قراءة النتائج.",
      range: glossaryEnd > glossaryStart ? `${pad(glossaryStart)}–${pad(glossaryEnd)}` : pad(glossaryStart),
      iconName: "document",
    },
    {
      title: "القسم الأول — مجتمع الفحص",
      goal: "التعريف بمجتمع الحالات وتوزيعه بحسب المخاطر والمنافذ، وأساس سحب العيّنة.",
      range: `${pad(sectionOneStart)}–${pad(sectionOneEnd)}`,
      iconName: "layers",
    },
    {
      title: "القسم الثاني — نتائج فحص الجودة",
      goal: "جودة الصور المفحوصة، ودقة قرارات الفحص بين الاشتباه والسليمة، لكل منفذ.",
      range: `${pad(sectionTwoStart)}–${pad(total)}`,
      iconName: "gauge",
    },
  ];

  const slides: string[] = [
    coverSlide(model, generatedAt, variantPreview),
    tocSlide(tocItems, 2, total, variantPreview),
  ];
  let num = glossaryStart;
  for (const build of glossaryBuilders) {
    slides.push(build(num, total));
    num += 1;
  }
  for (const build of sectionOne) {
    slides.push(build(num, total));
    num += 1;
  }
  for (const build of sectionTwo) {
    slides.push(build(num, total));
    num += 1;
  }
  return slides.join("\n");
}
