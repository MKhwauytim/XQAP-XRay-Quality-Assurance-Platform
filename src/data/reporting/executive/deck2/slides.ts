// Executive deck v2 — content-first rebuild of the presentation edition.
// Page structure (user spec, 2026-07-04):
//   1  الغلاف       — report name, study period, issue date, department/section, ZATCA logo
//   2  المحتويات    — the report sections and the goal of each
//   3  المعجم       — key terms and what each means
//   4  فاصل القسم الأول — مجتمع الفحص
//   5  مجتمع الصور بناءً على المخاطر — the 4 risk stages: population + sample per stage
//   6+ مجتمع صور الفحص للشهر — two tables (منافذ برية / بحرية), paginated when long
//
// Design/CSS is intentionally minimal for now: it reuses the v1 deck theme so the
// content reads clearly; the dedicated visual pass happens after content approval.

import type { ReportModel } from "../model/reportModel";
import type { StageProfile } from "../../executiveReportTypes";
import { esc, fmtNum, fmtPct } from "../primitives";
import { icon } from "../ui/icons";
import { coverMeshSvg, dividerPatternSvg } from "../ui/generativeArt";
import { isRankable } from "../model/dataSufficiency";
import { formatStageLabel } from "../../../population/stageHelpers";
import { DEFAULT_SAMPLING_RULES } from "../../../population/populationConfig";
import { ORGANIZATION_PATH, ZATCA_LOGO_URL } from "../../../../branding/organization";
import type { SourceRevisions } from "../../sourceRevisions";
import { sourceRevisionEntries } from "../../sourceRevisions";
import {
  ACCURACY_TARGET,
  BASE_ROWS_PER_PAGE,
  MARKING_TARGET,
  NAV_SECTIONS,
  STAGE_TONES,
  badgeIcon,
  barCell,
  collectPortStats,
  fillerRow,
  frac,
  ledgerTableCard,
  maxOf,
  microArc,
  pad,
  pctCell,
  planPortPages,
  qualCell,
  rateOf,
  renderVariants,
  slideControls,
  sideRail,
  pageFoot,
  portTableCard,
  threshCell,
  v2Slide,
} from "./slideKit";
import type { CellTone, NavSectionKey, PortPopRow, SlideBuilder } from "./slideKit";
import { sectionThreeBuilders } from "./section3";

// The slide kit is the single source of truth for these two, but they were
// public from `slides.ts` before the kit existed — re-exported so any existing
// importer keeps working.
export { NAV_SECTIONS };
export type { NavSectionKey };

const ARABIC_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function formatDate(d: Date): string {
  return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ── Page 1 — الغلاف ─────────────────────────────────────────────────────────
/** Low-contrast geometric band (SVG pattern) used behind the cover + section
 *  covers — thin gold diagonals + a hairline grid, brand-amplifying, recessive.
 *  Pure decoration (aria-hidden); no data, so no esc() needed. */
function coverBand(): string {
  return `<svg class="v2-cover-band" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <pattern id="v2band-diag" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
        <line x1="0" y1="0" x2="0" y2="26" stroke="var(--gold)" stroke-width="1" stroke-opacity="0.06"/>
      </pattern>
      <linearGradient id="v2band-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--gold)" stop-opacity="0"/>
        <stop offset="1" stop-color="var(--gold)" stop-opacity="0.10"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="1200" height="400" fill="url(#v2band-diag)"/>
    <rect x="0" y="250" width="1200" height="150" fill="url(#v2band-fade)"/>
  </svg>`;
}

export function coverSlide(
  model: ReportModel,
  generatedAt: Date,
  variantPreview: boolean,
  seedBase = "",
): string {
  const [, department, section] = ORGANIZATION_PATH;
  // Seeded low-poly navy mesh behind the glow + geometric band (aria-hidden,
  // pure decoration). Deterministic on the month key so the cover is stable
  // across opens; "" on failure so the cover falls back to its gradient.
  const meshSvg = coverMeshSvg(seedBase || model.summary.periodId);
  const meshLayer = meshSvg
    ? `<div class="v2-cover-mesh" aria-hidden="true">${meshSvg}</div>`
    : "";
  const meta = [
    { label: "فترة الدراسة", value: model.summary.periodId, iconName: "layers" },
    { label: "تاريخ الإصدار", value: formatDate(generatedAt), iconName: "document" },
    { label: "الإدارة", value: department, iconName: "users" },
    { label: "القسم", value: section, iconName: "shield" },
  ]
    .map(
      (m) => `<div class="v2-cover-meta-item">
        <span class="v2-cover-meta-icon">${badgeIcon(m.iconName, 18)}</span>
        <span class="v2-cover-meta-text">
          <span class="v2-cover-meta-label">${esc(m.label)}</span>
          <span class="v2-cover-meta-value">${esc(m.value)}</span>
        </span>
      </div>`,
    )
    .join("");
  // Org header block: logo + gold divider + the organizational hierarchy lines.
  const orgBlock = `<div class="v2-org">
      <img class="v2-org-logo" src="${ZATCA_LOGO_URL}" alt="هيئة الزكاة والضريبة والجمارك"/>
      <div class="v2-org-lines">
        <b>هيئة الزكاة والضريبة والجمارك</b>
        ${ORGANIZATION_PATH.map((line) => `<span>${esc(line)}</span>`).join("")}
      </div>
    </div>`;
  // Asymmetric hero: giant month lockup + title on the start side, stacked
  // issue-metadata column on the end side, gold rule system between them.
  const coverBody = `<div class="v2-cover-grid">
      <div class="v2-cover-hero">
        <div class="v2-cover-kicker"><span class="v2-cover-kicker-dot"></span>عرض تنفيذي · تقرير شهري</div>
        <h1 class="v2-cover-title">تقرير ضمان جودة<br/>فحص الأشعة</h1>
        <div class="v2-cover-rule"></div>
        <div class="v2-cover-lockup">
          <span class="v2-cover-lockup-label">فترة الدراسة (عيّنة شهر)</span>
          <span class="v2-cover-lockup-period">${esc(model.summary.periodId)}</span>
        </div>
        <div class="v2-cover-badge"><span>${icon("shield", 13)}</span>داخلي — للاستخدام التنفيذي</div>
      </div>
      <div class="v2-cover-meta-col">${meta}</div>
    </div>`;
  const body = renderVariants("slide-cover", [coverBody, coverBody, coverBody, coverBody], variantPreview);
  return `<section class="slide v2 title-slide v2-cover" id="slide-cover" data-title="الغلاف" data-section="cover" data-section-label="${esc(NAV_SECTIONS.cover)}">
    ${slideControls("slide-cover", variantPreview)}
    ${meshLayer}
    <div class="slide-art" aria-hidden="true"></div>
    ${coverBand()}
    ${orgBlock}
    <div class="slide-inner">
      ${body}
    </div>
  </section>`;
}

// ── Page 2 — المحتويات ──────────────────────────────────────────────────────
export type TocItem = {
  title: string;
  goal: string;
  range: string;
  iconName: string;
  tone: string;
  figure: string;
  figureLabel: string;
};

export function tocSlide(items: TocItem[], num: number, total: number, variantPreview: boolean): string {
  const body = `<div class="v2-toc-grid">${items
    .map(
      (it, i) => `<div class="v2-toc-card ${esc(it.tone)}">
        <div class="v2-toc-num">${pad(i + 1)}</div>
        <div class="v2-toc-main">
          <h4><span class="v2-toc-icon">${icon(it.iconName, 16)}</span>${esc(it.title)}</h4>
          <p>${esc(it.goal)}</p>
        </div>
        <div class="v2-toc-side">
          <div class="v2-toc-figure">${esc(it.figure)}</div>
          <div class="v2-toc-figure-label">${esc(it.figureLabel)}</div>
          <div class="v2-toc-range" dir="ltr">${esc(it.range)}</div>
        </div>
      </div>`,
    )
    .join("")}</div>`;
  return v2Slide({
    id: "slide-toc",
    title: "المحتويات",
    eyebrow: "المحتويات",
    iconName: "layers",
    headline: "محتويات التقرير",
    subhead: "أقسام التقرير والهدف من كل قسم، ونطاق صفحاته.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "toc",
  });
}

// ── مؤشرات الشهر (headline dashboard + top ports) ─────────────────────────────
/** One compact hero number (population) plus stat tiles split into two
 *  visually distinct groups — raw population/sample counts vs. the one metric
 *  that comes out of the reviewer-accuracy STUDY, not a straight tally — then
 *  the top-6 land/sea ports by volume as ranked tables (bar-in-cell, same
 *  `deck-table`/`barCell` language as every other port page in this deck,
 *  replacing the old standalone chart page this slide absorbed). Each tile
 *  renders a graceful "—" empty state when its metric lacks data
 *  (denominator-gated rates), never a misleading zero. No prior-month I/O —
 *  the deck builders stay pure over one month's input. */
export function monthInNumbersSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
  const accuracy = model.summary.overallAccuracy;
  const rawTiles: Array<{ tone: string; icon: string; value: string; label: string; sub: string }> = [
    {
      tone: "coral",
      icon: "alert",
      value: fmtPct(model.population.suspicionRate),
      label: "نسبة الاشتباه",
      sub: `${fmtNum(model.population.suspicious)} صورة اشتباه في المجتمع`,
    },
    {
      tone: "blue",
      icon: "scan",
      value: fmtPct(model.sample.coverage),
      label: "نسبة حجم العيّنة",
      sub: `${fmtNum(model.sample.total)} من ${fmtNum(model.population.total)} صورة`,
    },
    {
      tone: "cyan",
      icon: "check",
      value: fmtNum(model.sample.studied),
      label: "الصور المدروسة",
      sub: `إنجاز ${fmtPct(model.sample.completionRate)} من العيّنة`,
    },
  ];
  const studyTile = {
    tone: "green",
    icon: "gauge",
    value: accuracy === null ? "—" : fmtPct(accuracy),
    label: "الدقة العامة",
    sub: accuracy === null ? "بيانات غير كافية للتقييم" : "مطابقة قرارات الفحص للمراجع",
  };
  const renderTile = (t: { tone: string; icon: string; value: string; label: string; sub: string }) =>
    `<div class="v2-num-tile ${t.tone}">
        <span class="v2-num-tile-icon">${badgeIcon(t.icon, 18)}</span>
        <div class="v2-num-tile-body">
          <span class="v2-num-tile-value">${esc(t.value)}</span>
          <span class="v2-num-tile-label">${esc(t.label)}</span>
          <span class="v2-num-tile-sub">${esc(t.sub)}</span>
        </div>
      </div>`;
  const { land, sea } = collectPortStats(model);
  const body = `<div class="v2-summary-layout">
      <div class="v2-summary-top">
        <div class="v2-num-hero compact">
          <span class="v2-num-hero-label">إجمالي مجتمع الصور</span>
          <span class="v2-num-hero-value">${fmtNum(model.population.total)}</span>
          <span class="v2-num-hero-unit">صورة فحص بالأشعة خلال ${esc(model.summary.periodId)}</span>
          <div class="v2-num-hero-rule"></div>
          <div class="v2-num-hero-split">
            <span><b>${fmtNum(model.population.clean)}</b><small>سليمة</small></span>
            <span><b>${fmtNum(model.population.suspicious)}</b><small>اشتباه</small></span>
          </div>
        </div>
        <div class="v2-summary-tilegroups">
          <div class="v2-tile-group raw">
            <span class="v2-tile-group-label">بيانات المجتمع والعيّنة</span>
            <div class="v2-num-tiles">${rawTiles.map(renderTile).join("")}</div>
          </div>
          <div class="v2-tile-group study">
            <span class="v2-tile-group-label">من دراسة المراجعة</span>
            <div class="v2-num-tiles">${renderTile(studyTile)}</div>
          </div>
        </div>
      </div>
      <div class="v2-port-ovr">
        ${summaryPortTable("المنافذ البرية", "truck", "land", land)}
        ${summaryPortTable("المنافذ البحرية", "ship", "sea", sea)}
      </div>
    </div>`;
  return v2Slide({
    id: "slide-month-numbers",
    title: "مؤشرات الشهر",
    eyebrow: "لمحة تنفيذية",
    iconName: "chart",
    headline: "مؤشرات الشهر",
    subhead: "أبرز مؤشرات الشهر، ثم أعلى المنافذ حجمًا — قبل الجداول التفصيلية.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "summary",
  });
}

/** Top-3-by-volume ranked table for one land/sea group on the merged summary
 *  page — same `.v2-port-col`/`deck-table`/`barCell` shell the detailed
 *  port-population pages use later in the deck, but the shared bottom band
 *  only has ~175px per column (measured live), well short of what the normal
 *  card header + even `.compact` rows need — so this ALSO gets the `.summary`
 *  modifier that shrinks just the header (smaller badge, tighter padding),
 *  scoped separately from `.compact` so it never touches the OTHER pages'
 *  paginated-overflow row density that `.compact` also drives. No pagination
 *  machinery (this is a curated preview, not the full listing). الإجمالي
 *  sums over ALL ports in the group, not just the shown top 3. */
function summaryPortTable(title: string, iconName: string, variant: "land" | "sea", rows: PortPopRow[]): string {
  const TOP_N = 3;
  const top = rows
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_N);
  const max = maxOf(top.map((p) => p.total));
  const tone = variant === "land" ? "green" : "blue";
  const trs = top
    .map((p) => `<tr><td>${esc(p.name)}</td>${barCell(fmtNum(p.total), (p.total / max) * 100, tone)}</tr>`)
    .join("");
  const total = rows.reduce((s, p) => s + p.total, 0);
  const totalsRow = `<tr><td>الإجمالي</td><td>${fmtNum(total)}</td></tr>`;
  return `<div class="v2-port-col ${variant} compact summary">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${badgeIcon(iconName, 16)}</span>
      <div><b>${esc(title)}</b><span>أعلى ${fmtNum(top.length)} من ${fmtNum(rows.length)} منفذ</span></div>
    </div>
    <table class="deck-table">
      <thead><tr><th>المنفذ</th><th>إجمالي الصور</th></tr></thead>
      <tbody>${trs}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

// ── Page 3 — المعجم ─────────────────────────────────────────────────────────
type Tone = "gold" | "blue" | "green" | "coral" | "slate" | "purple" | "cyan";

/** Essential glossary, organized into two semantic categories (owner request
 *  2026-07-14): sampling vocabulary first, judgment vocabulary second — the
 *  same order the deck's own sections flow. Color follows the CATEGORY (gold =
 *  population/sample, coral = decisions/quality), not the individual card, so
 *  the accent carries meaning instead of decoration. Per-term icons stay. */
type GlossaryTerm = { term: string; def: string; icon: string };
type GlossaryCategory = { label: string; icon: string; tone: Tone; terms: GlossaryTerm[] };
const GLOSSARY_CATEGORIES: GlossaryCategory[] = [
  {
    label: "مصطلحات المجتمع والعيّنة",
    icon: "layers",
    tone: "gold",
    terms: [
      // Was: "جميع صور الفحص بالأشعة المسجّلة خلال الشهر…" — wrong. The population is not an
      // undifferentiated month dump: populationProcessor drops invalid IDs, duplicates, and rows
      // whose level-1/2 result cannot be normalized, and every survivor is classified onto one of
      // the four levels from the risk file's المستوى column (stageHelpers.getStageKey).
      { term: "مجتمع الفحص", def: "حالات أشعة الشهر بعد استبعاد المعرّفات غير الصالحة والمكرّرة وغير المقروءة النتيجة، مصنّفةً على مستويات المخاطر الأربعة.", icon: "layers" },
      // Was: "تُسحب عشوائيًا بطريقة طبقية" — wrong. Allocation is quota-driven per level; the
      // randomness (Mulberry32 + Fisher-Yates) operates only INSIDE each level's quota.
      { term: "العيّنة", def: "الصور المسحوبة للدراسة وفق وزن سحب محدَّد مسبقًا لكل مستوى، مع اختيار عشوائي داخل حصة المستوى الواحد.", icon: "scan" },
      // Was: "…ومدى تمثيل العيّنة للمجتمع" — unsupportable. The draw is deliberately
      // non-proportional (census + fixed quotas), so coverage carries no representativeness signal.
      { term: "التغطية", def: "نسبة حجم العيّنة المسحوبة إلى حجم المجتمع؛ مقياس حجم لا يدل على تمثيل العيّنة للمجتمع.", icon: "gauge" },
    ],
  },
  {
    label: "مصطلحات القرارات والجودة",
    icon: "shield",
    tone: "coral",
    terms: [
      { term: "اشتباه", def: "قرار فحص يشير إلى شبهة تستدعي التحقق؛ ويقابله «سليمة» حين لا تظهر شبهة.", icon: "alert" },
      // Was: "صورة قرّر الفحص أنها سليمة…" — wrong unit. classifyOutcome scores each level's
      // decision independently, so the unit is a decision and one image can yield two.
      { term: "الاشتباه الفائت", def: "قرار مستوى واحد رأى الصورة سليمة وأثبت المراجع أنها اشتباه؛ ولكل صورة قراران يُقيَّمان مستقلّين.", icon: "alert" },
    ],
  },
];

/**
 * The four risk levels, each with its own definition — previously collapsed into
 * a single "مستويات المخاطر" glossary card that also got them wrong.
 *
 * These are FOUR CATEGORICAL DETECTION SCENARIOS, NOT a severity ranking
 * (owner, 2026-07-25: "they are all important and have different goals"). Two
 * consequences, both load-bearing:
 *   1. No severity vocabulary here — no منخفض/متوسط/مرتفع/حرج, no "escalating"
 *      language, and nothing implying level N outranks level N−1.
 *   2. The classification is NOT produced by محرّك المخاطر. `stage` is imported
 *      verbatim from the risk file's `المستوى` column; `targetedByRiskEngine` is
 *      a separate column, and the risk engine characterizes level 2 only.
 * Wording is the owner's own, from the reference deck they supplied.
 * Tone follows STAGE_TONES so a colour means the same level here as on the
 * stage×port pages — category identity, not severity.
 */
/**
 * Draw weight per level, derived from the app's own sampling rules rather than
 * typed in — `DEFAULT_SAMPLING_RULES` in populationConfig.ts.
 *
 * The two rule methods mean two different bases, which is why these do not sum
 * to 100 and must not be presented as if they did:
 *   • `percentage` (المستوى الأول) — a share of that level's OWN population.
 *     Configured at 100, i.e. a full census, and locked.
 *   • `exact` (المستويات الثاني–الرابع) — a fixed count, shown here as its share
 *     of the exact-quota pool: 2500 / 1875 / 1875 of 6250 = 40% / 30% / 30%.
 *
 * Reads the configured defaults, so a month whose rules were overridden in the
 * sampling wizard would still show these. Surfacing the per-month rule would
 * need `targetQuota` carried onto `StageProfile`, which currently drops it
 * (executiveKpiProfiles.ts `buildStageProfiles`).
 */
const LEVEL_DRAW_WEIGHTS: (number | null)[] = (() => {
  const order = ["first", "second", "third", "fourth"] as const;
  const rules = order.map((key) => DEFAULT_SAMPLING_RULES.find((r) => r.stageKey === key));
  const exactPool = rules.reduce((sum, r) => sum + (r?.method === "exact" ? r.value : 0), 0);
  return rules.map((r) => {
    if (!r) return null;
    if (r.method === "percentage") return r.value;
    return rateOf(r.value, exactPool);
  });
})();

type RiskLevel = { name: string; def: string; measures: string; icon: string; tone: Tone };
const RISK_LEVELS: RiskLevel[] = [
  {
    name: "المستوى الأول",
    def: "الحالات التي تم الاشتباه بها في الأشعة من قبل المستوى الأول أو الثاني، دون مؤشرات من الفرق الأمنية الأخرى ودون استهداف من محرك المخاطر.",
    measures: "انفراد الفحص بالاشتباه دون مؤشرات أخرى.",
    icon: "shield",
    tone: "gold",
  },
  {
    name: "المستوى الثاني",
    def: "الحالات التي استهدفها محرك المخاطر، ولم يتم الاشتباه بها من قبل المستوى الأول والثاني.",
    measures: "ما يلتقطه محرك المخاطر ولا يلتقطه الفحص.",
    icon: "flag",
    tone: "blue",
  },
  {
    name: "المستوى الثالث",
    def: "الحالات التي لم يتم الاشتباه بها من قبل المستويين أو أحدهما، وتم الاشتباه بها من قبل أحد الفرق الأمنية الأخرى.",
    measures: "ما تلتقطه الفرق الأمنية الأخرى ولا يلتقطه الفحص.",
    icon: "users",
    tone: "green",
  },
  {
    name: "المستوى الرابع",
    def: "الحالات التي تحتوي على ضبط أمني أو اجتازت الأشعة من جهات خارجية دون اكتشاف الاشتباه من المسؤولين.",
    measures: "ما ثبت فواته بضبط أمني أو باكتشاف خارجي.",
    icon: "alert",
    tone: "coral",
  },
];

/**
 * One full-height level column: icon + quiet ordinal, name, rule, definition,
 * this month's live share of the population, and a "ما يقيسه" footer.
 *
 * The share block (owner request 2026-07-25) is real data on an otherwise
 * definitional page, so it is labelled with the period and its base is printed
 * next to it — a reader must never take it for a fixed property of the level.
 * `share` is the level's own population over the month's total population, from
 * `model.population.byStage`, matched to this card by stage label. A level with
 * no matching profile (a month whose risk file used labels the alias table
 * doesn't know) renders "—", never 0%.
 */
function levelCard(lv: RiskLevel, i: number): string {
  const weight = LEVEL_DRAW_WEIGHTS[i] ?? null;
  const figure =
    weight === null
      ? `<span class="v2-level-share-empty insuff">—</span>`
      : `<b dir="ltr">${fmtPct(weight, 0)}</b>`;
  return `<div class="v2-level-card ${lv.tone}">
    <div class="v2-level-head">
      <span class="v2-level-icon">${badgeIcon(lv.icon, 24)}</span>
      <span class="v2-level-num" dir="ltr" aria-hidden="true">${pad(i + 1)}</span>
    </div>
    <h4>${esc(lv.name)}</h4>
    <span class="v2-level-rule" aria-hidden="true"></span>
    <p>${esc(lv.def)}</p>
    <div class="v2-level-share">
      <span>وزن العينة</span>
      ${figure}
    </div>
    <div class="v2-level-goal">
      <span>ما يقيسه</span>
      <b>${esc(lv.measures)}</b>
    </div>
  </div>`;
}

/** One glossary card: icon badge + term + definition, category-toned bottom rule. */
function termCard(g: GlossaryTerm, tone: Tone): string {
  return `<div class="v2-term-card ${tone}">
    <div class="v2-term-card-head">
      <span class="v2-term-icon">${badgeIcon(g.icon, 18)}</span>
      <b>${esc(g.term)}</b>
    </div>
    <p>${esc(g.def)}</p>
  </div>`;
}

/** One labeled category band: tone-coded chip + hairline + its cards.
 *  Column count follows the band's own term count (`--cols`) rather than a
 *  fixed 4, so a band keeps full-width cards instead of a ragged trailing gap
 *  when terms are added or removed. */
function termBand(cat: GlossaryCategory): string {
  return `<div class="v2-term-band ${cat.tone}">
    <div class="v2-term-band-head">
      <span class="v2-term-band-chip">${badgeIcon(cat.icon, 14)}<b>${esc(cat.label)}</b></span>
      <span class="v2-term-band-rule"></span>
    </div>
    <div class="v2-term-grid" style="--cols:${cat.terms.length}">${cat.terms.map((t) => termCard(t, cat.tone)).join("")}</div>
  </div>`;
}

/**
 * Build the المعجم pages. Two slides, not one (owner, 2026-07-25): the four
 * risk levels each carry their own definition now, and those definitions run
 * roughly twice the length the 4×2 term grid was sized for (existing terms are
 * 61–86 chars, a level definition is ~125). Splitting is what keeps both pages
 * readable instead of cramming twelve entries onto one.
 *   1. مستويات المخاطر — four full-height columns, one per level
 *   2. المصطلحات الرئيسية — the two category bands, four terms each
 */
export function glossarySlideBuilders(variantPreview: boolean): SlideBuilder[] {
  return [
    (num, total) => {
      const body = `<div class="v2-level-grid">${RISK_LEVELS.map(levelCard).join("")}</div>`;
      return v2Slide({
        id: "slide-glossary-levels",
        title: "مستويات المخاطر",
        eyebrow: "المعجم",
        iconName: "layers",
        headline: "المعجم — مستويات المخاطر",
        subhead: "أربعة مستويات لكل منها تعريفه وغرضه؛ تصنيفٌ للحالات لا ترتيبٌ لخطورتها.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "glossary",
      });
    },
    (num, total) => {
      const body = `<div class="v2-term-section">${GLOSSARY_CATEGORIES.map(termBand).join("")}</div>`;
      return v2Slide({
        id: "slide-glossary-1",
        title: "المعجم",
        eyebrow: "المعجم",
        iconName: "document",
        headline: "المعجم — المصطلحات الرئيسية",
        subhead: "توحيد المصطلحات قبل قراءة النتائج.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "glossary",
      });
    },
  ];
}

// ── Section separator — full-bleed color-blocked cover ───────────────────────
/**
 * A pure title card: section number, section name, and one-sentence definition.
 * Nothing else (owner, 2026-07-25).
 *
 * It previously also carried a headline statistic, a takeaway strip, and an
 * optional chart. Those are gone deliberately — a divider's job is to mark a
 * boundary and set up what follows, and every figure it showed was already
 * stated, in context and with its base, on the pages immediately after it.
 * `keyStatValue`/`keyStatLabel`/`takeaway`/`extra` were dropped from the
 * options rather than left ignored, so no call site can quietly pass data that
 * never renders.
 */
export function sectionSeparatorSlide(opts: {
  sectionNo: number;
  sectionKey: NavSectionKey;
  iconName: string;
  title: string;
  /** The section's one-sentence تعريف — the only prose on the slide. */
  blurb: string;
  tone: string;
  /** Deterministic seed base (month key) for the background pattern. */
  seedBase?: string;
  num: number;
  total: number;
  variantPreview: boolean;
}): string {
  const { sectionNo, sectionKey, iconName, title, blurb, tone, seedBase, num, total, variantPreview } = opts;
  // Seeded geometric pattern overlay, tinted to the section tone at very low
  // opacity (CSS-controlled) so it never touches headline contrast. Seed =
  // month key + section id → deterministic per report.
  const patternTone = tone === "cyan" ? "#32c5d2" : "#f4b400";
  const patternSvg = dividerPatternSvg(`${seedBase ?? ""}__${sectionKey}`, patternTone);
  const patternLayer = patternSvg
    ? `<div class="v2-sep-pattern" aria-hidden="true">${patternSvg}</div>`
    : "";
  // Centred single column. The oversized outlined numeral sits behind the
  // lockup as a watermark rather than beside it, so the eye lands on the
  // section name first and the number reads as ornament.
  const sepBody = `<div class="v2-sep ${esc(tone)}">
      <div class="v2-sep-watermark" aria-hidden="true">${pad(sectionNo)}</div>
      <div class="v2-sep-lockup">
        <span class="v2-sep-badge">${icon(iconName, 30)}</span>
        <div class="v2-sep-eyebrow">القسم ${esc(String(sectionNo))}</div>
        <h2>${esc(title)}</h2>
        <div class="v2-sep-rule"></div>
        <p>${esc(blurb)}</p>
      </div>
    </div>`;
  const body = renderVariants(`slide-sep-${sectionNo}`, [sepBody, sepBody, sepBody, sepBody], variantPreview);
  return `<section class="slide v2 v2-sep-slide ${esc(tone)}" id="slide-sep-${sectionNo}" data-title="${esc(title)}" data-section="${sectionKey}" data-section-label="${esc(NAV_SECTIONS[sectionKey])}">
  ${slideControls(`slide-sep-${sectionNo}`, variantPreview)}
  ${sideRail(sectionKey)}
  <div class="v2-sep-bg" aria-hidden="true"></div>
  ${patternLayer}
  ${coverBand()}
  <div class="slide-inner">
    ${body}
  </div>
  ${pageFoot(num, total)}
</section>`;
}

// ── Page 5 — مجتمع الصور بناءً على المخاطر ────────────────────────────────
/**
 * Short tag shown at the bottom of each stage tile. Used to read
 * "مستوى منخفض/متوسط/مرتفع/حرج" — a severity ranking that does not exist (the
 * four levels are categorical detection scenarios with different goals, see
 * `RISK_LEVELS`'s doc comment; [[risk-levels-are-categorical]]). Replaced with
 * the same وزن العينة figure the glossary's level cards show
 * (`LEVEL_DRAW_WEIGHTS`), so this page and the glossary agree instead of one
 * of them implying a ranking the other has already dropped.
 */
function stageShortTag(i: number): string {
  const weight = LEVEL_DRAW_WEIGHTS[i];
  return weight === undefined || weight === null ? `المستوى ${i + 1}` : `وزن العينة ${fmtPct(weight, 0)}`;
}

/** How many ports each stage-×-port card shows individually before folding the
 *  rest into its الإجمالي row (design spec §2.3 — "curated top-N, never the
 *  full table", same convention as portTable/qualityTable/accuracyTable). */
export const STAGE_CARD_TOP_N = 5;

/** Full-width stacked proportion bar: population share by risk stage, tone-coded,
 *  with the percentage printed inside each segment (dark ink, never the series
 *  color) and a direct-label legend below (the secondary encoding that keeps the
 *  brand stage tones legible under CVD). Pure HTML/CSS, RTL-native. */
function stageProportionBar(stages: StageProfile[]): string {
  const total = stages.reduce((s, x) => s + x.population, 0) || 1;
  const segs = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const pct = (s.population / total) * 100;
      return `<div class="v2-prop-seg ${tone}" style="width:${pct.toFixed(3)}%">${pct >= 6 ? `<span class="v2-prop-seg-pct">${fmtPct(pct, 0)}</span>` : ""}</div>`;
    })
    .join("");
  const legend = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      return `<span class="v2-prop-key ${tone}"><i></i>${esc(s.stageLabel)} · ${fmtNum(s.population)}</span>`;
    })
    .join("");
  return `<div class="v2-prop">
    <div class="v2-prop-bar">${segs}</div>
    <div class="v2-prop-legend">${legend}</div>
  </div>`;
}

/**
 * Horizontal compare-bars: one row per risk level, RTL (label on the right,
 * value on the left, bar fills right→left), tone-colored per STAGE_TONES,
 * value = share of population (%). Variant 2/4 for this slide
 * (docs/superpowers/specs/2026-07-25-deck2-risk-stages-variant2-design.md) —
 * a quick side-by-side read of relative size; levelFiguresTable() right below
 * carries the full numeric breakdown, so this view never needs its own axis
 * or legend.
 */
function stageCompareBars(stages: StageProfile[], populationTotal: number): string {
  const shares = stages.map((s) => (s.population / populationTotal) * 100);
  const max = Math.max(0, ...shares);
  const rows = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const pct = shares[i];
      const w = max > 0 ? Math.max(2, (pct / max) * 100) : 0;
      return `<div class="v2-cbar-row">
        <span class="v2-cbar-label">${esc(s.stageLabel)}</span>
        <span class="v2-cbar-track"><i class="v2-cbar-fill ${tone}" style="width:${w.toFixed(1)}%"></i></span>
        <span class="v2-cbar-value">${fmtPct(pct, 0)}</span>
      </div>`;
    })
    .join("");
  return `<div class="v2-cbar">${rows}</div>`;
}

/**
 * Exact-figures table for the 4 risk levels — one row per level plus a
 * totals row using the exact same population/sample/coverage totals variant
 * 0's bottom band renders, so the two variants never disagree. Variant 2/4
 * for this slide, see stageCompareBars() above.
 *
 * Reimplemented on top of the shared `ledgerTableCard` (slideKit.ts,
 * 2026-07-25, deck2-design-systems Task 1) instead of hand-rolling its own
 * `<table>` markup — `deck2.test.ts`'s
 * "levelFiguresTable byte-identity characterization" test pins this page's
 * variant-1 output to prove the extraction changed nothing. Two deliberate
 * non-defaults keep it that way: `cardClass: "v2-level-table-card"` (the
 * legacy name, aliased to `.v2-lg-table-card` in theme.ts) and `rowCount: 0`
 * (this card centers its fixed 4-row content via CSS rather than pinning a
 * totals row, so it opts out of `ledgerTableCard`'s filler-row mechanism —
 * see that function's doc comment).
 */
function levelFiguresTable(
  stages: StageProfile[],
  populationTotal: number,
  totals: { population: number; sample: number; coverage: number },
): string {
  const rows = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const share = (s.population / populationTotal) * 100;
      const weight = LEVEL_DRAW_WEIGHTS[i] ?? null;
      return `<tr>
        <td><span class="v2-level-row-num ${tone}">${i + 1}</span></td>
        <td>${esc(s.stageLabel)}</td>
        <td>${fmtPct(weight, 0)}</td>
        <td>${fmtPct(share, 0)}</td>
        <td>${fmtNum(s.population)}</td>
        <td>${fmtNum(s.sampleSize)}</td>
        <td>${fmtPct(s.coverage)}</td>
      </tr>`;
    })
    .join("");
  return ledgerTableCard({
    cardClass: "v2-level-table-card",
    theadCells: `
        <th></th><th>المستوى</th><th>وزن العينة</th><th>من المجتمع</th>
        <th>صورة</th><th>العيّنة</th><th>تغطية العيّنة</th>
      `,
    bodyRowsHtml: rows,
    totalsRowHtml: `<tr>
        <td></td><td>الإجمالي</td><td>—</td><td>100%</td>
        <td>${fmtNum(totals.population)}</td><td>${fmtNum(totals.sample)}</td><td>${fmtPct(totals.coverage)}</td>
      </tr>`,
    span: 7,
    rowCount: 0,
  });
}

export function riskStagesSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
  const stages = model.population.byStage;
  const populationTotal = stages.reduce((sum, stage) => sum + stage.population, 0) || 1;

  const tiles = stages
    .map((stage, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const tag = stageShortTag(i);
      const share = (stage.population / populationTotal) * 100;
      return `<div class="v2-risk-tile ${tone}">
        <div class="v2-risk-tile-head">
          <span class="v2-stage-num">${i + 1}</span>
          <span class="v2-risk-tile-titles"><b>${esc(stage.stageLabel)}</b><small>${esc(tag)}</small></span>
          <span class="v2-risk-tile-share"><b>${fmtPct(share, 0)}</b><small>من المجتمع</small></span>
        </div>
        <div class="v2-risk-tile-main">
          <div class="v2-risk-tile-figure">
            <b>${fmtNum(stage.population)}</b>
            <span>صورة ضمن مجتمع الشهر</span>
          </div>
          ${microArc(stage.coverage)}
        </div>
        <div class="v2-risk-tile-foot">
          <span><b>${fmtNum(stage.sampleSize)}</b><small>العيّنة</small></span>
          <span class="accent"><b>${fmtPct(stage.coverage)}</b><small>تغطية العيّنة</small></span>
        </div>
      </div>`;
    })
    .join("");
  const totals = `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 16)}</span><span><b>${fmtNum(model.population.total)}</b><small>إجمالي المجتمع (صورة)</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("scan", 16)}</span><span><b>${fmtNum(model.sample.total)}</b><small>إجمالي العيّنة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("gauge", 16)}</span><span><b>${fmtPct(model.sample.coverage)}</b><small>التغطية الكلية</small></span></div>
  </div>`;
  const body = `<div class="v2-risk-layout">
    ${stageProportionBar(stages)}
    <div class="v2-risk-tile-grid">${tiles}</div>
    ${totals}
  </div>`;
  const body2 = `<div class="v2-risk-layout">
    ${stageCompareBars(stages, populationTotal)}
    ${levelFiguresTable(stages, populationTotal, {
      population: model.population.total,
      sample: model.sample.total,
      coverage: model.sample.coverage,
    })}
  </div>`;
  return v2Slide({
    id: "slide-risk-stages",
    title: "مجتمع الصور بناءً على المخاطر",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "gauge",
    headline: "مجتمع الصور بناءً على المخاطر",
    subhead: "توزيع المجتمع بعد المعالجة على مستويات المخاطر الأربعة، وحصة كل مستوى من العيّنة.",
    bodyVariants: [body, body2, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}

// ── Page 6+ — مجتمع صور الفحص للشهر (جداول المنافذ) ───────────────────────
/**
 * One land/sea table as a tinted card (per the reference design). `population`
 * = plain month numbers (الصور/سليمة/اشتباه). `sample` = same shape, but every
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
  // Magnitude-column data bars (pure CSS background, zero added row height): the
  // الصور column in population mode, the العيّنة column in sample mode, each
  // scaled to the largest value in this chunk. Tone tracks the port variant
  // (green = land, blue = sea) so the bar reads as "size of this port".
  const magTone: CellTone = variant === "land" ? "green" : "blue";
  const maxMag = maxOf(rows.map((p) => (mode === "population" ? p.total : p.sampleTotal)));
  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            if (mode === "population") {
              return `<tr><td>${esc(p.name)}</td>${barCell(fmtNum(p.total), (p.total / maxMag) * 100, magTone)}<td>${fmtNum(p.clean)}</td><td>${fmtNum(p.suspicious)}</td></tr>`;
            }
            const coverage = p.total > 0 ? (p.sampleTotal / p.total) * 100 : 0;
            return `<tr><td>${esc(p.name)}</td>${barCell(frac(p.sampleTotal, p.total), (p.sampleTotal / maxMag) * 100, magTone)}<td>${frac(p.sampleClean, p.clean)}</td><td>${frac(p.sampleSuspicious, p.suspicious)}</td><td>${fmtPct(coverage)}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">—</span></td></tr>`;

  const sum = (f: (p: PortPopRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalPop = sum((p) => p.total);
  const totalSample = sum((p) => p.sampleTotal);
  const totalsRow =
    mode === "population"
      ? `<tr><td>الإجمالي</td><td>${fmtNum(totalPop)}</td><td>${fmtNum(sum((p) => p.clean))}</td><td>${fmtNum(sum((p) => p.suspicious))}</td></tr>`
      : `<tr><td>الإجمالي</td><td>${frac(totalSample, totalPop)}</td><td>${frac(sum((p) => p.sampleClean), sum((p) => p.clean))}</td><td>${frac(sum((p) => p.sampleSuspicious), sum((p) => p.suspicious))}</td><td>${fmtPct(totalPop > 0 ? (totalSample / totalPop) * 100 : 0)}</td></tr>`;

  const headSub =
    mode === "population"
      ? `${fmtNum(rows.length)} منفذ · ${fmtNum(totalPop)} صورة`
      : `${fmtNum(rows.length)} منفذ · ${fmtNum(totalSample)} عيّنة من ${fmtNum(totalPop)} صورة`;
  const theadCells =
    mode === "population"
      ? `<th>المنفذ</th><th>الصور</th><th>سليمة</th><th>اشتباه</th>`
      : `<th>المنفذ</th><th>العيّنة</th><th>سليمة</th><th>اشتباه</th><th>التغطية</th>`;

  return portTableCard({
    title,
    headSub,
    headIcon: variant === "land" ? "truck" : "ship",
    variant,
    compact,
    sampleMode: mode === "sample",
    theadCells,
    bodyRowsHtml: trs,
    rowCount: rows.length,
    span,
    totalsRowHtml: totalsRow,
  });
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
        title: `مجتمع صور الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `مجتمع صور الفحص لشهر ${model.summary.periodId}${cont}`,
        subhead: "منهجية التصنيف: تُصنَّف الصورة اشتباهًا إذا كانت نتيجة المستوى الأول أو الثاني اشتباهًا، وفي غير ذلك تُصنَّف سليمة.",
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

/**
 * Same tallying logic as collectPortStats (line 432), keyed by risk stage
 * instead of land/sea. Returns ports sorted by population descending within
 * each stage — the same sort key collectPortStats uses — so "top port" means
 * the same thing on the land/sea pages and these stage/port pages.
 *
 * `collectStagePortStats` itself is always internally correct — it's a
 * straightforward tally over the `model.rows` it's given, so `total`/
 * `sampleTotal` always reflect the actual rows for that (stage, port) pair.
 *
 * The caveat is whether its per-stage sums match `model.population.byStage`'s
 * `population`/`sampleSize` for the same stage, and that depends on how
 * `StageProfile` was built in `calculateExecutiveKPIs`
 * (`src/data/reporting/executiveReportData.ts`):
 * - Fallback branch (no sample, or no `stageAllocations`): `population`/
 *   `sampleSize` are computed by grouping `model.rows` by `row.stage` at
 *   report-generation time — the same rows this collector tallies — so the
 *   sums are guaranteed to match (asserted in stagePortStats.test.ts).
 * - Production branch (`sample.stageAllocations` present — the normal case
 *   after Phase 3 sampling): `population`/`sampleSize` come from a
 *   `StageAllocation` record frozen at sample-draw time
 *   (`src/data/sampling/sampleTypes.ts`). That snapshot is NOT recomputed
 *   from `model.rows`, so it is not guaranteed to match a fresh tally if
 *   data was reprocessed or a row's `stage` changed since the sample was
 *   drawn (also asserted in stagePortStats.test.ts, to document the
 *   divergence rather than hide it).
 */
export function collectStagePortStats(model: ReportModel): Map<string, PortPopRow[]> {
  const byStage = new Map<string, Map<string, PortPopRow>>();
  for (const r of model.rows) {
    // Canonicalize: real rows carry the RAW Excel stage alias (e.g. "SECOND_STAG",
    // "2", "الثاني"), while StageProfile.stageLabel is the canonical Arabic label
    // frozen at sample-draw time. Raw-key grouping made every card lookup miss on
    // real data (empty port tables, zero سليمة/اشتباه sums) — the synthetic
    // preview fixture used canonical labels and masked it. formatStageLabel maps
    // known aliases to the canonical label and echoes unknown strings unchanged,
    // so the fallback branch (raw StageProfile labels) still matches too.
    const stageKey = r.stage ? formatStageLabel(r.stage) : "غير محدد";
    const portName = r.portName ?? "غير محدد";
    let portMap = byStage.get(stageKey);
    if (!portMap) {
      portMap = new Map<string, PortPopRow>();
      byStage.set(stageKey, portMap);
    }
    let cur = portMap.get(portName);
    if (!cur) {
      cur = { name: portName, total: 0, clean: 0, suspicious: 0, sampleTotal: 0, sampleClean: 0, sampleSuspicious: 0 };
      portMap.set(portName, cur);
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
  const result = new Map<string, PortPopRow[]>();
  for (const [stageKey, portMap] of byStage) {
    result.set(stageKey, [...portMap.values()].sort((a, b) => b.total - a.total));
  }
  return result;
}

/** One stage's card on the population page: المنفذ | سليمة | اشتباه | الإجمالي,
 *  top STAGE_CARD_TOP_N ports by population, with a stage-wide totals row.
 *
 *  IMPORTANT (found in Task 1 review, see design spec §2.2's "Consistency
 *  caveat"): the totals row's الإجمالي column is pinned to `stage.population`
 *  (the StageProfile figure — same source as riskStagesSlide and this card's
 *  own data), NOT a fresh sum over `ports`. In the normal production case
 *  (sample.stageAllocations present), StageProfile's population comes from a
 *  frozen sample-draw-time snapshot, which is not guaranteed to equal a fresh
 *  count of `ports` (built from *current* model.rows) — summing `ports` here
 *  could visibly disagree with the number shown on the "مجتمع الصور بناءً
 *  على المخاطر" page for the same stage. سليمة/اشتباه have no equivalent on
 *  StageProfile, so those two columns still sum from `ports` — the best
 *  available breakdown, and in the rare case population changed after
 *  sampling, not guaranteed to add up to exactly the pinned الإجمالي. */
function stagePortPopulationCard(stage: StageProfile, i: number, ports: PortPopRow[]): string {
  const tone = STAGE_TONES[i % STAGE_TONES.length];
  const top = ports.slice(0, STAGE_CARD_TOP_N);
  const maxTotal = maxOf(top.map((p) => p.total));
  const trs =
    top
      .map(
        (p) =>
          `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.clean)}</td><td>${fmtNum(p.suspicious)}</td>${barCell(fmtNum(p.total), (p.total / maxTotal) * 100, tone)}</tr>`,
      )
      .join("");

  const sum = (f: (p: PortPopRow) => number) => ports.reduce((s, p) => s + f(p), 0);
  const totalsRow = `<tr><td>الإجمالي</td><td>${fmtNum(sum((p) => p.clean))}</td><td>${fmtNum(sum((p) => p.suspicious))}</td><td>${fmtNum(stage.population)}</td></tr>`;

  return `<div class="v2-stage-card ${tone} v2-stage-port-card">
    <div class="v2-stage-head">
      <span class="v2-stage-num">${i + 1}</span>
      <b>${esc(stage.stageLabel)}</b>
    </div>
    <table class="deck-table">
      <thead><tr><th>المنفذ</th><th>سليمة</th><th>اشتباه</th><th>الإجمالي</th></tr></thead>
      <tbody>${trs}${fillerRow(4, top.length)}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** One stage's card on the sample page: المنفذ | مجتمع المرحلة | العيّنة المستهدفة |
 *  نسبة التغطية, as plain numbers (not the land/sea page's stacked "N من M"
 *  frac cell — the reference design uses two separate plain columns here).
 *
 *  IMPORTANT (same caveat as stagePortPopulationCard above): all three
 *  totals-row cells are pinned to `stage.population`/`stage.sampleSize` (the
 *  same StageProfile figures already shown in the card header), not fresh
 *  sums over `ports` — this keeps the header figure and the totals row
 *  internally consistent by construction and matching the rest of the deck,
 *  regardless of whether a fresh row tally would agree with the frozen
 *  sample-draw-time allocation. */
function stagePortSampleCard(stage: StageProfile, i: number, ports: PortPopRow[]): string {
  const tone = STAGE_TONES[i % STAGE_TONES.length];
  const top = ports.slice(0, STAGE_CARD_TOP_N);
  const maxSample = maxOf(top.map((p) => p.sampleTotal));
  const trs =
    top
      .map((p) => {
        const coverage = p.total > 0 ? (p.sampleTotal / p.total) * 100 : 0;
        return `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.total)}</td>${barCell(fmtNum(p.sampleTotal), (p.sampleTotal / maxSample) * 100, tone)}<td>${fmtPct(coverage)}</td></tr>`;
      })
      .join("");

  const totalsRow = `<tr><td>الإجمالي</td><td>${fmtNum(stage.population)}</td><td>${fmtNum(stage.sampleSize)}</td><td>${fmtPct(stage.coverage)}</td></tr>`;

  return `<div class="v2-stage-card ${tone} v2-stage-port-card">
    <div class="v2-stage-head">
      <span class="v2-stage-num">${i + 1}</span>
      <b>${esc(stage.stageLabel)}</b>
      <span class="v2-stage-port-figure" dir="ltr">${fmtNum(stage.sampleSize)} / ${fmtNum(stage.population)}</span>
    </div>
    <table class="deck-table">
      <thead><tr><th>المنفذ</th><th>مجتمع المرحلة</th><th>العيّنة المستهدفة</th><th>نسبة التغطية</th></tr></thead>
      <tbody>${trs}${fillerRow(4, top.length)}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** Population page: مجتمع صور الفحص حسب المستوى والمنفذ. Never paginated —
 *  top-N is fixed, so row count doesn't grow with the port list the way the
 *  land/sea tables' does. */
export function stagePortPopulationSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const byStage = collectStagePortStats(model);
  const cards = model.population.byStage
    .map((s, i) => stagePortPopulationCard(s, i, byStage.get(formatStageLabel(s.stageLabel)) ?? []))
    .join("");
  const body = `<div class="v2-stage-port-grid">${cards}</div>`;
  return v2Slide({
    id: "slide-stage-port-population",
    title: "مجتمع صور الفحص حسب المستوى والمنفذ",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "layers",
    headline: `مجتمع صور الفحص حسب المستوى والمنفذ لشهر ${model.summary.periodId}`,
    subhead: "أعلى 5 منافذ بالحجم لكل مستوى مخاطر، مع إجمالي شامل لجميع المنافذ.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}

/** Sample page: عيّنة الفحص المسحوبة حسب المستوى والمنفذ. Same non-paginated shape. */
export function stagePortSampleSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const byStage = collectStagePortStats(model);
  const cards = model.population.byStage
    .map((s, i) => stagePortSampleCard(s, i, byStage.get(formatStageLabel(s.stageLabel)) ?? []))
    .join("");
  const body = `<div class="v2-stage-port-grid">${cards}</div>`;
  return v2Slide({
    id: "slide-stage-port-sample",
    title: "عيّنة الفحص المسحوبة حسب المستوى والمنفذ",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "layers",
    headline: `عيّنة الفحص المسحوبة حسب المستوى والمنفذ لشهر ${model.summary.periodId}`,
    subhead: "أعلى 5 منافذ بالحجم لكل مستوى مخاطر، بأرقام العيّنة ونسبة التغطية، مع إجمالي شامل.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
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

function qualityTable(
  title: string,
  rows: PortQualityRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const span = 5;
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
            return `<tr><td>${esc(p.name)}</td>${qualCell(high, "green")}${qualCell(med, "gold")}${qualCell(low, "coral")}${threshCell(marking, MARKING_TARGET)}</tr>`;
          })
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">—</span></td></tr>`;

  const sum = (f: (p: PortQualityRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalMarkP = sum((p) => p.markingPresent);
  const totalMarkM = sum((p) => p.markingMissing);
  const totalHigh = sum((p) => p.highQ);
  const totalMed = sum((p) => p.medQ);
  const totalLow = sum((p) => p.lowQ);
  const totalEvaluated = totalHigh + totalMed + totalLow;
  const totalsRow = `<tr><td>الإجمالي</td><td>${pctCell(rateOf(totalHigh, totalEvaluated))}</td><td>${pctCell(rateOf(totalMed, totalEvaluated))}</td><td>${pctCell(rateOf(totalLow, totalEvaluated))}</td><td>${pctCell(rateOf(totalMarkP, totalMarkP + totalMarkM))}</td></tr>`;

  return portTableCard({
    title,
    headSub: `${fmtNum(rows.length)} منفذ`,
    headIcon: variant === "land" ? "truck" : "ship",
    variant,
    compact,
    theadCells: `<th>المنفذ</th><th>عالي</th><th>متوسط</th><th>منخفض</th><th>التحديد</th>`,
    bodyRowsHtml: trs,
    rowCount: rows.length,
    span,
    totalsRowHtml: totalsRow,
  });
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

function accuracyTable(
  title: string,
  rows: PortAccuracyRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const span = 4;
  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            const accuracy = rateOf(p.correctClean + p.correctSuspicion, p.evaluable);
            const detection = rateOf(p.correctSuspicion, p.correctSuspicion + p.missedSuspicion);
            const clean = rateOf(p.correctClean, p.correctClean + p.falseSuspicion);
            // Below-target rows carry the warning tone + alert glyph (never color
            // alone). Unrankable ports (insufficient data) show muted "—", no bar.
            const show = (v: number | null) =>
              p.rankable ? threshCell(v, ACCURACY_TARGET) : `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;
            return `<tr><td>${esc(p.name)}</td>${show(accuracy)}${show(detection)}${show(clean)}</tr>`;
          })
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">—</span></td></tr>`;

  const sum = (f: (p: PortAccuracyRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalEvaluable = sum((p) => p.evaluable);
  const totalCC = sum((p) => p.correctClean);
  const totalCS = sum((p) => p.correctSuspicion);
  const totalMS = sum((p) => p.missedSuspicion);
  const totalFS = sum((p) => p.falseSuspicion);
  const totalsRow = `<tr><td>الإجمالي</td><td>${pctCell(rateOf(totalCC + totalCS, totalEvaluable))}</td><td>${pctCell(rateOf(totalCS, totalCS + totalMS))}</td><td>${pctCell(rateOf(totalCC, totalCC + totalFS))}</td></tr>`;

  return portTableCard({
    title,
    headSub: `${fmtNum(rows.length)} منفذ`,
    headIcon: variant === "land" ? "truck" : "ship",
    variant,
    compact,
    theadCells: `<th>المنفذ</th><th>الدقة العامة</th><th>دقة الاشتباه</th><th>دقة السليمة</th>`,
    bodyRowsHtml: trs,
    rowCount: rows.length,
    span,
    totalsRowHtml: totalsRow,
  });
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

// ── NEW — closing slide (data provenance + classification + organization) ─────
/** Elevates the source-revisions footer into a designed provenance block, paired
 *  with the classification reminder and the organization line. When no revisions
 *  are supplied it renders a graceful note rather than an empty block. Does NOT
 *  use the legacy `.srev-*` markup, so the footer-omission test (no `.srev-file`
 *  when revisions are absent) stays valid — the on-screen footer contract is
 *  untouched, this slide is an additional designed presentation. */
export function closingSlide(
  model: ReportModel,
  sourceRevisions: SourceRevisions | undefined,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const entries = sourceRevisionEntries(sourceRevisions);
  const provenance =
    entries.length > 0
      ? `<div class="v2-prov-list">${entries
          .map(
            ([file, rev]) =>
              `<div class="v2-prov-item"><span class="v2-prov-file" dir="ltr">${esc(file)}</span><span class="v2-prov-rev">مراجعة ${esc(String(rev))}</span></div>`,
          )
          .join("")}</div>`
      : `<div class="v2-prov-empty">لم تُسجَّل مراجعات لملفات المصدر مع هذا التقرير.</div>`;
  // Source attribution (owner request): which upload sources fed this month —
  // the risk-agency base file (always, every row originates from it) and the
  // optional BI supporting file, detected from the processor's row flags.
  const src = model.dataSources;
  const sourcesBlock = `<div class="v2-src-grid">
    <div class="v2-src-card gold">
      <div class="v2-src-head">${badgeIcon("layers", 15)}<b>بيانات وكالة المخاطر</b><span class="v2-src-tag">المصدر الأساسي</span></div>
      <p>${fmtNum(src.riskRowCount)} صورة مسجّلة هذا الشهر</p>
    </div>
    <div class="v2-src-card ${src.biProvided ? "blue" : "off"}">
      <div class="v2-src-head">${badgeIcon("scan", 15)}<b>بيانات ذكاء الأعمال</b><span class="v2-src-tag">مصدر داعم</span></div>
      <p>${src.biProvided ? `مُقدَّم — أثرى ${fmtNum(src.biMatchedCount)} صورة بالمطابقة` : "غير مُقدَّم هذا الشهر"}</p>
    </div>
  </div>`;
  const body = `<div class="v2-closing">
      <div class="v2-closing-main">
        <div class="v2-closing-icon">${badgeIcon("document", 26)}</div>
        <h2>مصدر البيانات والاعتماد</h2>
        <div class="v2-sep-rule"></div>
        <p>يربط هذا التقرير بنسخة البيانات المحدَّدة وقت التوليد؛ رقم المراجعة لكل ملف مصدر يضمن إمكانية التتبّع والمراجعة.</p>
        <div class="v2-prov-block">
          <div class="v2-prov-title"><span class="v2-prov-title-icon">${icon("layers", 14)}</span>مصادر البيانات المُدخلة</div>
          ${sourcesBlock}
          <div class="v2-prov-title"><span class="v2-prov-title-icon">${icon("document", 14)}</span>مراجعات ملفات المصدر</div>
          <div class="v2-prov-body">${provenance}</div>
        </div>
      </div>
      <div class="v2-closing-side">
        <div class="v2-closing-badge"><span>${icon("shield", 13)}</span>داخلي — للاستخدام التنفيذي</div>
        <div class="v2-closing-org">
          <b>هيئة الزكاة والضريبة والجمارك</b>
          ${ORGANIZATION_PATH.map((l) => `<span>${esc(l)}</span>`).join("")}
        </div>
        <div class="v2-closing-period">${esc(model.summary.periodId)}</div>
      </div>
    </div>`;
  return v2Slide({
    id: "slide-closing",
    title: "مصدر البيانات",
    eyebrow: "خاتمة",
    iconName: "shield",
    headline: "مصدر البيانات والاعتماد",
    subhead: "تتبّع نسخة البيانات، والتصنيف، والجهة المُصدِرة.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "closing",
  });
}

// ── Assembly ─────────────────────────────────────────────────────────────────
/**
 * Build all v2 slides in order. Section page ranges on the المحتويات slide are
 * computed from the real build sequence (never hand-typed), so the TOC cannot
 * drift as pages are added, removed, or paginated differently month to month.
 */
/** Owner request 2026-07-20: hide the مؤشرات الشهر slide (monthInNumbersSlide)
 *  from the generated report. NOT a removal — the function, its
 *  summaryPortTable helper, and every TOC/page-numbering hook for it stay in
 *  the code, just skipped, so it can be flipped back on without rebuilding
 *  any of it. Do not delete monthInNumbersSlide/summaryPortTable while this
 *  is false; they are dormant, not dead code. */
const SHOW_MONTH_NUMBERS_SLIDE = false;

export function buildDeckV2Slides(
  model: ReportModel,
  generatedAt = new Date(),
  variantPreview = false,
  sourceRevisions?: SourceRevisions,
  seedBase = "",
): string {
  const glossaryBuilders = glossarySlideBuilders(variantPreview); // levels page + terms page

  // (The section-2 opener funnel was removed with the separator's side column —
  // separators now carry only the section number, name, and تعريف.)

  // Section 1 — مجتمع الفحص: separator + risk stages + port tables (1..N pages).
  const sectionOne: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide({
        sectionNo: 1,
        sectionKey: "section1",
        iconName: "layers",
        title: "مجتمع الفحص",
        blurb:
          "التعريف بمجتمع الصور لهذا الشهر: حجمه، توزيعه على مستويات المخاطر، وتوزيعه على المنافذ البرية والبحرية، وهو الأساس الذي سُحبت منه العيّنة.",
        tone: "gold",
        seedBase,
        num,
        total,
        variantPreview,
      }),
    (num, total) => riskStagesSlide(model, num, total, variantPreview),
    ...portPopulationSlideBuilders(model, variantPreview),
    ...portSampleSlideBuilders(model, variantPreview),
    (num, total) => stagePortPopulationSlide(model, num, total, variantPreview),
    (num, total) => stagePortSampleSlide(model, num, total, variantPreview),
  ];

  // Section 2 — نتائج فحص الجودة: separator + image-quality + accuracy.
  const sectionTwo: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide({
        sectionNo: 2,
        sectionKey: "section2",
        iconName: "gauge",
        title: "نتائج فحص الجودة",
        blurb:
          "جودة الصور المفحوصة في كل منفذ (التوفّر والتحديد والجودة المقبولة)، ودقة قرارات الفحص بين الاشتباه والسليمة.",
        tone: "cyan",
        seedBase,
        num,
        total,
        variantPreview,
      }),
    ...qualityPortSlideBuilders(model, variantPreview),
    ...accuracyPortSlideBuilders(model, variantPreview),
  ];

  // Section 3 — التحاليل المتقدمة: assembled entirely in section3/index.ts, so
  // adding a page there needs no change here. Empty is a supported state and a
  // complete no-op: zero pages, zero TOC rows, page numbering unchanged.
  const sectionThree: SlideBuilder[] = sectionThreeBuilders(model, variantPreview);

  // Page order: cover(1) · toc(2) · [month-in-numbers(3) — currently hidden,
  // see SHOW_MONTH_NUMBERS_SLIDE] · glossary(N) · section 1 · section 2 ·
  // section 3 · closing(last).
  const summaryPageCount = SHOW_MONTH_NUMBERS_SLIDE ? 1 : 0;
  const total =
    2 +
    summaryPageCount +
    glossaryBuilders.length +
    sectionOne.length +
    sectionTwo.length +
    sectionThree.length +
    1; // +cover+toc(+summary), +closing
  const glossaryStart = 3 + summaryPageCount;
  const glossaryEnd = glossaryStart - 1 + glossaryBuilders.length;
  const sectionOneStart = glossaryEnd + 1;
  const sectionOneEnd = sectionOneStart + sectionOne.length - 1;
  const sectionTwoStart = sectionOneEnd + 1;
  const sectionTwoEnd = sectionTwoStart + sectionTwo.length - 1;
  const sectionThreeStart = sectionTwoEnd + 1;
  const sectionThreeEnd = sectionThreeStart + sectionThree.length - 1;
  const closingNum = total;

  const accuracyFig =
    model.summary.overallAccuracy === null ? "—" : fmtPct(model.summary.overallAccuracy);
  const tocItems: TocItem[] = [
    // مؤشرات الشهر's TOC entry only exists while the page itself is rendered
    // (SHOW_MONTH_NUMBERS_SLIDE) — a range pointing at a page that isn't there
    // would be a broken link, not a "coming soon" note.
    ...(SHOW_MONTH_NUMBERS_SLIDE
      ? [
          {
            title: "مؤشرات الشهر",
            goal: "أبرز مؤشرات الشهر، ثم أعلى المنافذ حجمًا.",
            range: pad(3),
            iconName: "chart",
            tone: "gold",
            figure: fmtNum(model.population.total),
            figureLabel: "صورة",
          },
        ]
      : []),
    {
      title: "المعجم",
      goal: "توحيد المصطلحات الرئيسية قبل قراءة النتائج.",
      range: glossaryEnd > glossaryStart ? `${pad(glossaryStart)}–${pad(glossaryEnd)}` : pad(glossaryStart),
      iconName: "document",
      tone: "blue",
      figure: fmtNum(GLOSSARY_CATEGORIES.reduce((s, c) => s + c.terms.length, 0)),
      figureLabel: "مصطلح",
    },
    {
      title: "القسم الأول — مجتمع الفحص",
      goal: "التعريف بمجتمع الصور وتوزيعه بحسب المخاطر والمنافذ، وأساس سحب العيّنة.",
      range: `${pad(sectionOneStart)}–${pad(sectionOneEnd)}`,
      iconName: "layers",
      tone: "green",
      figure: fmtNum(model.sample.total),
      figureLabel: "عيّنة",
    },
    {
      title: "القسم الثاني — نتائج فحص الجودة",
      goal: "جودة الصور المفحوصة، ودقة قرارات الفحص بين الاشتباه والسليمة، لكل منفذ.",
      range: `${pad(sectionTwoStart)}–${pad(sectionTwoEnd)}`,
      iconName: "gauge",
      tone: "coral",
      figure: accuracyFig,
      figureLabel: "الدقة",
    },
    // Same rule as مؤشرات الشهر above: a section with zero pages gets NO TOC
    // row — a range pointing at pages that aren't in the deck would be a
    // broken link. While section3/index.ts returns an empty array this entry
    // simply doesn't exist, and the TOC is byte-identical to before.
    ...(sectionThree.length > 0
      ? [
          {
            title: "القسم الثالث — التحاليل المتقدمة",
            goal: "تحاليل معمّقة تُكمل قراءة نتائج الجودة والدقة.",
            range:
              sectionThreeEnd > sectionThreeStart
                ? `${pad(sectionThreeStart)}–${pad(sectionThreeEnd)}`
                : pad(sectionThreeStart),
            iconName: "chart",
            tone: "purple",
            figure: fmtNum(sectionThree.length),
            figureLabel: "صفحة",
          },
        ]
      : []),
  ];

  const slides: string[] = [
    coverSlide(model, generatedAt, variantPreview, seedBase),
    tocSlide(tocItems, 2, total, variantPreview),
  ];
  if (SHOW_MONTH_NUMBERS_SLIDE) {
    slides.push(monthInNumbersSlide(model, 3, total, variantPreview));
  }
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
  for (const build of sectionThree) {
    slides.push(build(num, total));
    num += 1;
  }
  slides.push(closingSlide(model, sourceRevisions, closingNum, total, variantPreview));
  return slides.join("\n");
}
