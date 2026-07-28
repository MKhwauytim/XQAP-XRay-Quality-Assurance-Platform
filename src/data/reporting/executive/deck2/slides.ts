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
import { formatStageLabel, getStageKey } from "../../../population/stageHelpers";
import { DEFAULT_SAMPLING_RULES } from "../../../population/populationConfig";
import { ORGANIZATION_PATH, ZATCA_LOGO_URL } from "../../../../branding/organization";
import type { SourceRevisions } from "../../sourceRevisions";
import { sourceRevisionEntries } from "../../sourceRevisions";
import { metricMatrix } from "../ui/analyticsCharts";
import {
  ACCURACY_TARGET,
  BASE_ROWS_PER_PAGE,
  MARKING_TARGET,
  NAV_SECTIONS,
  STAGE_TONES,
  badgeIcon,
  barCell,
  briefingLede,
  briefingRankList,
  briefingRankPlan,
  briefingSupport,
  collectPortStats,
  fillerRow,
  frac,
  gridPanel,
  ledgerIdx,
  ledgerPortCard,
  ledgerTableCard,
  maxOf,
  microArc,
  pad,
  pctCell,
  planPortPages,
  portCountPhrase,
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
import type { BriefingRankItem, CellTone, NavSectionKey, PortPopRow, SlideBuilder } from "./slideKit";
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
 * Canonical order the four risk levels use across `RISK_LEVELS` /
 * `LEVEL_DRAW_WEIGHTS` / `STAGE_TONES` — the SAME order `LEVEL_DRAW_WEIGHTS`
 * derives from `DEFAULT_SAMPLING_RULES` above. A `StageProfile`'s POSITION in
 * `model.population.byStage` is NOT guaranteed to match this order: a level
 * with zero sample rows is entirely omitted from `byStage` (the production
 * path — `sampleAlgorithmInternals.ts`'s stageAllocations loop `continue`s
 * past `stageRows.length === 0 || target <= 0` — and the no-sample fallback
 * path in `buildStageProfiles`, which groups by whatever raw labels actually
 * appear in the rows) — every level AFTER a skipped one then shifts down one
 * array position. `RISK_LEVELS[i]`/`LEVEL_DRAW_WEIGHTS[i]`/`STAGE_TONES[i]`
 * must therefore never be indexed by a stage's loop position; resolve
 * identity via `levelIndexForStage` instead (2026-07-28 review fix).
 */
const CANONICAL_STAGE_ORDER = ["first", "second", "third", "fourth"] as const;

/**
 * Resolve `stage` to its 0-based index into `RISK_LEVELS`/`LEVEL_DRAW_WEIGHTS`/
 * `STAGE_TONES` BY IDENTITY, never by the stage's position in the `stages`
 * array it came from (see `CANONICAL_STAGE_ORDER`'s doc comment above).
 *
 * Resolved from `stage.stageLabel` via the same alias-matching `getStageKey`
 * every other stage-classification path in the app uses — NOT from
 * `stage.stageKey` directly: that field is only a reliable canonical key
 * ("first"/"second"/…) on the production path (`buildStageProfiles`'s
 * `sample.stageAllocations` branch); on the no-sample fallback branch it is
 * stamped `String(index)` (a placeholder, never a real level key), which
 * would make identity resolution silently fail for the very fixtures/months
 * that most need it. `stageLabel`, by contrast, is real semantic data on
 * BOTH branches (either `STAGE_LABELS[stageKey]` or the row's own `stage`
 * text), so resolving through it — the same way `formatStageLabel` already
 * does — works uniformly everywhere.
 *
 * Returns -1 for a label `getStageKey` can't map to one of the four levels
 * (legacy/unrecognized wording, or the raw label was never one of the four
 * to begin with). Callers MUST treat -1 as "unknown level" — render "—" and
 * a neutral tone — never fall back to a loop index, which would silently
 * reintroduce the exact bug this helper exists to fix.
 */
function levelIndexForStage(stage: StageProfile): number {
  const key = getStageKey(stage.stageLabel);
  return CANONICAL_STAGE_ORDER.indexOf(key as (typeof CANONICAL_STAGE_ORDER)[number]);
}

/** `STAGE_TONES` lookup by level identity (see `levelIndexForStage`);
 *  `"neutral"` — never a wrong neighbor's color — for an unresolved stage. */
function stageTone(stage: StageProfile): (typeof STAGE_TONES)[number] | "neutral" {
  const idx = levelIndexForStage(stage);
  return idx >= 0 ? STAGE_TONES[idx] : "neutral";
}

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
 *
 * Resolves `stage`'s level BY IDENTITY (`levelIndexForStage`), not by its
 * position in the caller's loop — a stage's own ordinal ("المستوى ٣") must
 * follow from what level it actually is, not from where it happens to sit in
 * a `stages` array that can have levels missing (2026-07-28 review fix; see
 * `CANONICAL_STAGE_ORDER`'s doc comment). Unresolvable stage → "—", never a
 * fabricated ordinal.
 */
function stageShortTag(stage: StageProfile): string {
  const idx = levelIndexForStage(stage);
  if (idx < 0) return "—";
  const weight = LEVEL_DRAW_WEIGHTS[idx];
  return weight === null ? `المستوى ${idx + 1}` : `وزن العينة ${fmtPct(weight, 0)}`;
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
    .map((s) => {
      const tone = stageTone(s);
      const pct = (s.population / total) * 100;
      return `<div class="v2-prop-seg ${tone}" style="width:${pct.toFixed(3)}%">${pct >= 6 ? `<span class="v2-prop-seg-pct">${fmtPct(pct, 0)}</span>` : ""}</div>`;
    })
    .join("");
  const legend = stages
    .map((s) => {
      const tone = stageTone(s);
      return `<span class="v2-prop-key ${tone}"><i></i>${esc(s.stageLabel)} · ${fmtNum(s.population)}</span>`;
    })
    .join("");
  return `<div class="v2-prop">
    <div class="v2-prop-bar">${segs}</div>
    <div class="v2-prop-legend">${legend}</div>
  </div>`;
}

/**
 * Two-basis caveat for وزن العينة, shared VERBATIM with `slide-glossary-levels`'s
 * Ledger table footnote (fan-out plan §3a/§5, docs/superpowers/specs/
 * 2026-07-25-deck2-fanout-remaining-pages-plan.md) — worded to agree with
 * `LEVEL_DRAW_WEIGHTS`'s own doc comment above (percentage-of-own-population
 * for the first level vs. share-of-the-exact-quota-pool for the rest), so a
 * reader never gets two different explanations for why these don't sum to
 * 100%.
 */
const LEVEL_WEIGHT_BASIS_FOOTNOTE =
  "وزن المستوى الأول نسبة من مجتمعه (حصر شامل)؛ وبقية الأوزان حصص من حصة العدد الثابت — الأساسان مختلفان ولا يجمعان إلى 100%";

/**
 * Exact-figures table for the 4 risk levels — Ledger slot 1's ENTIRE body for
 * this page (2026-07-25 fan-out plan §5 RECONCILIATION). `stageCompareBars`
 * used to render above this table in the Ledger slot; the fan-out plan ruled
 * it out of Ledger — "a labelled bar with a proportional track is a chart by
 * any reading," and Ledger is charts-free by contract (design spec §2) — so
 * `stageCompareBars` no longer exists (removed, not just unused) and this
 * table is now the whole slot.
 *
 * Two additions beyond the pre-fan-out shape:
 *   1. A «ما يقيسه» column (`RISK_LEVELS[i].measures`) — the card had ~190px
 *      of vertical slack once stageCompareBars left, which this column uses.
 *   2. A tfoot footnote row (colspan across every column) carrying
 *      `LEVEL_WEIGHT_BASIS_FOOTNOTE` — the same two-basis caveat
 *      `slide-glossary-levels`'s Ledger table will carry.
 *
 * ⚠️ THIS DELIBERATELY SUPERSEDES `deck2.test.ts`'s pre-2026-07-25
 * "levelFiguresTable byte-identity characterization" pin. That test existed
 * to prove the `ledgerTableCard` EXTRACTION (deck2-design-systems Task 1)
 * changed nothing about this page's already-shipped output — it was never a
 * promise that the content itself would never change again. The fan-out
 * plan's B1 pass supersedes it on purpose; the pinned expectation was updated
 * to the new shape in the same commit that made this edit, not deleted, and
 * a new "no v2-cbar, has ما يقيسه + footnote" test replaces the old one's
 * intent. See `docs/edit logs/2026-07-25.md` (this version's entry) for the
 * explicit before/after.
 *
 * Reimplemented on top of the shared `ledgerTableCard` (slideKit.ts,
 * 2026-07-25, deck2-design-systems Task 1) instead of hand-rolling its own
 * `<table>` markup. Two deliberate non-defaults: `cardClass:
 * "v2-level-table-card"` (the legacy name, aliased to `.v2-lg-table-card` in
 * theme.ts) and `rowCount: 0` (this card centers its fixed 4-row content via
 * CSS rather than pinning a totals row, so it opts out of `ledgerTableCard`'s
 * filler-row mechanism — see that function's doc comment).
 */
function levelFiguresTable(
  stages: StageProfile[],
  populationTotal: number,
  totals: { population: number; sample: number; coverage: number },
): string {
  const rows = stages
    .map((s) => {
      // Resolved BY IDENTITY (levelIndexForStage), not by loop position — see
      // CANONICAL_STAGE_ORDER's doc comment. `stages` can have a level
      // missing (zero sample rows), which shifts every later level's array
      // position down by one; pairing this row's tone/weight/«ما يقيسه» text
      // by `i` alone silently mispaired it with the WRONG level whenever that
      // happened (2026-07-28 review fix).
      const idx = levelIndexForStage(s);
      const tone = idx >= 0 ? STAGE_TONES[idx] : "neutral";
      const share = (s.population / populationTotal) * 100;
      const weight = idx >= 0 ? LEVEL_DRAW_WEIGHTS[idx] ?? null : null;
      const measures = idx >= 0 ? RISK_LEVELS[idx]?.measures ?? "—" : "—";
      return `<tr>
        <td><span class="v2-level-row-num ${tone}">${idx >= 0 ? idx + 1 : "—"}</span></td>
        <td>${esc(s.stageLabel)}</td>
        <td>${esc(measures)}</td>
        <td>${fmtPct(weight, 0)}</td>
        <td>${fmtPct(share, 0)}</td>
        <td>${fmtNum(s.population)}</td>
        <td>${fmtNum(s.sampleSize)}</td>
        <td>${fmtPct(s.coverage)}</td>
      </tr>`;
    })
    .join("");
  // The class belongs on the <tr> — theme.ts's selectors are scoped
  // `tfoot tr.v2-lg-footnote td` (muted caveat styling: 600 weight, .62rem,
  // slate ink, right-aligned, transparent background). Putting it on the
  // <td> instead (the pre-2026-07-28 bug) meant those selectors never
  // matched, so the row fell through to the plain `tfoot td` rule and
  // rendered as a second bold/white/tinted totals row — the opposite of a
  // caveat disclosing the weights DON'T sum to 100%.
  const footnoteRow = `<tr class="v2-lg-footnote"><td colspan="8">${esc(LEVEL_WEIGHT_BASIS_FOOTNOTE)}</td></tr>`;
  return ledgerTableCard({
    cardClass: "v2-level-table-card",
    theadCells: `
        <th></th><th>المستوى</th><th>ما يقيسه</th><th>وزن العينة</th><th>من المجتمع</th>
        <th>صورة</th><th>العيّنة</th><th>تغطية العيّنة</th>
      `,
    bodyRowsHtml: rows,
    totalsRowHtml: `<tr>
        <td></td><td>الإجمالي</td><td></td><td>—</td><td>100%</td>
        <td>${fmtNum(totals.population)}</td><td>${fmtNum(totals.sample)}</td><td>${fmtPct(totals.coverage)}</td>
      </tr>${footnoteRow}`,
    span: 8,
    rowCount: 0,
  });
}

export function riskStagesSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
  const stages = model.population.byStage;
  const populationTotal = stages.reduce((sum, stage) => sum + stage.population, 0) || 1;

  const tiles = stages
    .map((stage) => {
      // BY IDENTITY, not loop position — see CANONICAL_STAGE_ORDER's doc
      // comment (2026-07-28 review fix). The ordinal badge shows the level's
      // OWN number (e.g. "٣" for المستوى الثالث), not this tile's display
      // slot, so it never implies a different level when one is missing.
      const idx = levelIndexForStage(stage);
      const tone = stageTone(stage);
      const tag = stageShortTag(stage);
      const share = (stage.population / populationTotal) * 100;
      return `<div class="v2-risk-tile ${tone}">
        <div class="v2-risk-tile-head">
          <span class="v2-stage-num">${idx >= 0 ? idx + 1 : "—"}</span>
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
  const ledgerBody = `<div class="v2-sys-ledger v2-lg-risk-stages"><div class="v2-risk-layout">
    ${levelFiguresTable(stages, populationTotal, {
      population: model.population.total,
      sample: model.sample.total,
      coverage: model.sample.coverage,
    })}
  </div></div>`;
  const briefingBody = riskStagesBriefing(model, stages, populationTotal);
  const gridBody = riskStagesGrid(model, stages, populationTotal);
  return v2Slide({
    id: "slide-risk-stages",
    title: "مجتمع الصور بناءً على المخاطر",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "gauge",
    headline: "مجتمع الصور بناءً على المخاطر",
    subhead: "توزيع المجتمع بعد المعالجة على مستويات المخاطر الأربعة، وحصة كل مستوى من العيّنة.",
    bodyVariants: [body, ledgerBody, briefingBody, gridBody],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}

/**
 * Briefing system (slot 2) body for `slide-risk-stages` (fan-out plan §5).
 * The lede carries the month's sample COVERAGE (with `microArc`), not a level
 * count — this page's real headline number is "how much of the month's risk
 * population got sampled," and "there are four levels" is the glossary's job
 * (`slide-glossary-levels`, a later fan-out pass). Rank rows are the 4 levels
 * in LEVEL ORDER, never sorted by size — they are categorical detection
 * scenarios, not a severity ranking (see `RISK_LEVELS`'s doc comment /
 * [[risk-levels-are-categorical]]) — each carrying its own `STAGE_TONES`
 * color as a per-row override of Briefing's usual one-tone-per-page rule.
 * `STAGE_TONES` is a cross-page IDENTITY encoding (same color = same level on
 * the glossary, the stage×port cards, and here); the fan-out plan rules that
 * invariant matters more than this page's tone cohesion.
 */
function riskStagesBriefing(model: ReportModel, stages: StageProfile[], populationTotal: number): string {
  const largest = stages.reduce(
    (best, s) => (best === null || s.population > best.population ? s : best),
    null as StageProfile | null,
  );
  const supportStrip = briefingSupport([
    { iconName: "layers", value: fmtNum(model.population.total), label: "إجمالي المجتمع" },
    { iconName: "scan", value: fmtNum(model.sample.total), label: "إجمالي العيّنة" },
    { iconName: "flag", value: esc(largest?.stageLabel ?? "—"), label: "أكبر مستوى حصةً" },
  ]);
  const rankItems: BriefingRankItem[] = stages.map((s) => {
    // BY IDENTITY, not loop position — see CANONICAL_STAGE_ORDER's doc
    // comment (2026-07-28 review fix). An unresolvable stage omits `tone`
    // entirely so the row falls back to the list's own default tone ("gold")
    // rather than borrowing a specific neighbor level's color.
    const idx = levelIndexForStage(s);
    const share = (s.population / populationTotal) * 100;
    return {
      label: s.stageLabel,
      value: share,
      valueText: fmtPct(share, 0),
      secondaryText: `العيّنة ${fmtNum(s.sampleSize)} · تغطية ${fmtPct(s.coverage)}`,
      tone: idx >= 0 ? STAGE_TONES[idx] : undefined,
    };
  });
  // foldRemainder is required by briefingRankList's type (2026-07-28: a
  // missing foldRemainder used to silently drop the folded tail with no
  // remainder row and no type error — see slideKit.ts's doc comment). It can
  // never actually fire here: briefingRankPlan's smallest-tier cap is 5 and
  // `stages` has at most 4 rows (the four risk levels), so plan.folded is
  // always 0 — this callback exists only to satisfy the type contract.
  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "gold",
    scale: { kind: "auto" },
    foldRemainder: (folded) => ({
      label: `بقية المستويات (${fmtNum(folded.length)})`,
      value: null,
      valueText: "—",
      secondaryText: "",
      rest: true,
    }),
  });
  return `<div class="v2-sys-brief v2-bf-risk-stages">
    ${briefingLede({
      figure: fmtPct(model.sample.coverage, 0),
      tone: "gold",
      label: `تغطية العيّنة ${fmtPct(model.sample.coverage, 0)} — ${fmtNum(model.sample.total)} من ${fmtNum(model.population.total)} صورة`,
      // Reflects the actual number of levels present in `stages` rather than
      // assuming all four always show up (2026-07-28 review fix) — a month
      // whose risk file omits a level entirely (or the no-sample fallback
      // grouping, which only ever sees the levels rows actually carry)
      // should not claim "أربعة مستويات" when fewer are on the page.
      basis: `${fmtNum(stages.length)} مستويات · ${esc(model.summary.periodId)}`,
      arc: model.sample.coverage,
    })}
    ${supportStrip}
    ${rankHtml}
  </div>`;
}

/**
 * Grid system (slot 3) body for `slide-risk-stages` (fan-out plan §5): one
 * full-width `metricMatrix`, rows = the 4 stage labels, 4 own-domain columns
 * (الصور/العيّنة on their own max, من المجتمع/تغطية العيّنة on [0,100]), all
 * `sequential-gold` (no fixed target for any of them to diverge around).
 *
 * وزن العينة is deliberately NOT a column here — it is a config figure with
 * TWO different bases (percentage-of-own-population for level 1, share of the
 * exact-quota pool for the rest; see `LEVEL_DRAW_WEIGHTS`'s doc comment and
 * `LEVEL_WEIGHT_BASIS_FOOTNOTE` above), and `metricMatrix` has no annotation
 * affordance to disclose a two-basis caveat on one column. Ledger (footnote
 * row) and Briefing (basis chip) can carry it honestly; Grid cannot, so it's
 * left out rather than shown without its caveat.
 */
function riskStagesGrid(model: ReportModel, stages: StageProfile[], populationTotal: number): string {
  const share = (s: StageProfile) => (s.population / populationTotal) * 100;
  const matrix = metricMatrix(
    {
      rowLabels: stages.map((s) => s.stageLabel),
      columns: [
        {
          label: "الصور",
          domain: [0, maxOf(stages.map((s) => s.population))],
          ramp: "sequential-gold",
          values: stages.map((s) => s.population),
        },
        {
          label: "العيّنة",
          domain: [0, maxOf(stages.map((s) => s.sampleSize))],
          ramp: "sequential-gold",
          values: stages.map((s) => s.sampleSize),
        },
        { label: "من المجتمع", domain: [0, 100], ramp: "sequential-gold", values: stages.map(share) },
        {
          label: "تغطية العيّنة",
          domain: [0, 100],
          ramp: "sequential-gold",
          values: stages.map((s) => s.coverage),
        },
      ],
    },
    {
      width: 1160,
      height: 320,
      caption: "مصفوفة مستويات المخاطر",
      rowHeader: "المستوى",
      emptyNote: "لا توجد بيانات",
    },
  );
  const panel = gridPanel({
    title: "مستويات المخاطر",
    sub: `${fmtNum(model.population.total)} صورة · ${fmtNum(model.sample.total)} عيّنة · تغطية ${fmtPct(model.sample.coverage)}`,
    chartHtml: matrix,
  });
  return `<div class="v2-sys-grid v2-gd-risk-stages">${panel}</div>`;
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

/**
 * Ledger-system (slot 1 — السجل, "verifiability") port table: reuses the exact
 * same data + `barCell` magnitude tint as `portTable()` above ("this is the
 * shape ledger changes least — correct, because slot 0 already leans this
 * way," design spec), through the shared `ledgerPortCard` primitive
 * (slideKit.ts P2, 2026-07-25 fan-out-plan P0 extraction) — Ledger's whole
 * vocabulary is tables and figure-strips, no decorative card chrome. Ports
 * are already sorted descending by `collectPortStats`, so the small ordinal
 * badge (`ledgerIdx`, P1) sitting inside the first cell before the port name
 * doubles as a rank indicator rather than a fabricated new figure — and per
 * the brief, it's deliberately NOT a new column (no column budget to spare
 * on a half-width card).
 *
 * `rowCount: 0` opts out of `ledgerPortCard`'s filler-row bottom-pinning:
 * `DECK_TABLE_FILL_SCRIPT` (deck2/index.ts) only ever measures
 * `.v2-port-col`/`.v2-stage-port-card` cards, so an unmeasured filler row
 * under a different card shell would just be dead markup (see
 * `ledgerTableCard`'s own doc comment). The totals row simply follows the
 * last data row directly — see task-2-report.md for the full reasoning why
 * this reads correctly for Ledger's plainer, document-style table instead of
 * attempting an unsupported pinned-bottom look.
 */
function ledgerPortTable(title: string, rows: PortPopRow[], variant: "land" | "sea", compact: boolean): string {
  const magTone: CellTone = variant === "land" ? "green" : "blue";
  const maxMag = maxOf(rows.map((p) => p.total));
  const trs = rows
    .map(
      (p, i) =>
        `<tr><td>${ledgerIdx(i)}${esc(p.name)}</td>${barCell(fmtNum(p.total), (p.total / maxMag) * 100, magTone)}<td>${fmtNum(p.clean)}</td><td>${fmtNum(p.suspicious)}</td></tr>`,
    )
    .join("");
  const sum = (f: (p: PortPopRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalsRow = `<tr><td>الإجمالي</td><td>${fmtNum(sum((p) => p.total))}</td><td>${fmtNum(sum((p) => p.clean))}</td><td>${fmtNum(sum((p) => p.suspicious))}</td></tr>`;
  return ledgerPortCard({
    title,
    theadCells: `<th>المنفذ</th><th>الصور</th><th>سليمة</th><th>اشتباه</th>`,
    bodyRowsHtml: trs,
    totalsRowHtml: totalsRow,
    span: 4,
    rowCount: 0,
    compact,
  });
}

/**
 * Briefing system (slot 2) body for the port-population page. Density is
 * entirely delegated to `briefingRankPlan` (slideKit.ts) — this function
 * never re-derives a row budget or reads slot-0's table-geometry plan
 * (`planPortPages`'s `compact`/`rowsPerPage` are a PER-COLUMN table budget;
 * this is a COMBINED ranked list, a category error that silently dropped
 * rows in this function's first version — see the 2026-07-25 design-advisor
 * ruling this rewrite implements verbatim).
 *
 * Built on the shared `briefingLede`/`briefingSupport`/`briefingRankList`
 * primitives (slideKit.ts P3/P4/P5, 2026-07-25 fan-out-plan P0 extraction) —
 * this is the reference caller `briefingRankList`'s own doc comment points
 * to for how `foldRemainder` recovers richer per-port data (`restTotal`/
 * `restSuspicious`) that a generic `BriefingRankItem` doesn't carry, by
 * slicing the ORIGINAL `combined` array using the folded slice's length
 * rather than re-deriving `briefingRankPlan`'s ladder a second time.
 */
function briefingPortRank(landChunk: PortPopRow[], seaChunk: PortPopRow[]): string {
  const combined = [...landChunk, ...seaChunk].sort((a, b) => b.total - a.total);
  if (combined.length === 0) {
    return `<div class="v2-sys-brief v2-bf-port-population">
      <div class="v2-bf-lede"><div class="v2-bf-lede-figure gold"><span class="insuff">—</span></div></div>
    </div>`;
  }
  const lead = combined[0];
  const sliceTotal = combined.reduce((s, p) => s + p.total, 0);
  const plan = briefingRankPlan(combined.length);

  const cleanTotal = combined.reduce((s, p) => s + p.clean, 0);
  const suspiciousTotal = combined.reduce((s, p) => s + p.suspicious, 0);
  const suspicionRate = rateOf(suspiciousTotal, sliceTotal);
  const supportStrip = briefingSupport([
    { iconName: "check", value: fmtNum(cleanTotal), label: "إجمالي الصور السليمة" },
    { iconName: "alert", value: fmtNum(suspiciousTotal), label: "إجمالي صور الاشتباه" },
    { iconName: "gauge", value: pctCell(suspicionRate), label: "نسبة الاشتباه للصفحة" },
  ]);
  const basis =
    plan.folded > 0
      ? `أعلى ${fmtNum(plan.named)} من ${portCountPhrase(combined.length)} · البقية مجمّعة · إجمالي ${fmtNum(sliceTotal)} صورة`
      : `جميع منافذ الصفحة (${portCountPhrase(combined.length)}) · إجمالي ${fmtNum(sliceTotal)} صورة`;

  const rankItems: BriefingRankItem[] = combined.map((p) => ({
    label: p.name,
    value: p.total,
    valueText: fmtNum(p.total),
    secondaryText: `اشتباه ${fmtNum(p.suspicious)}`,
  }));
  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "gold",
    scale: { kind: "auto" },
    foldRemainder: (folded) => {
      // Recover the folded ports' raw rows from `combined` (richer than the
      // generic BriefingRankItem[] this callback receives) by slicing on the
      // folded count rather than re-deriving briefingRankPlan a second time.
      const restRows = combined.slice(combined.length - folded.length);
      const restTotal = restRows.reduce((s, p) => s + p.total, 0);
      const restSuspicious = restRows.reduce((s, p) => s + p.suspicious, 0);
      return {
        label: `بقية المنافذ (${fmtNum(folded.length)})`,
        value: restTotal,
        valueText: fmtNum(restTotal),
        secondaryText: `اشتباه ${fmtNum(restSuspicious)}`,
        rest: true,
      };
    },
  });

  return `<div class="v2-sys-brief v2-bf-port-population">
    ${briefingLede({
      figure: fmtNum(lead.total),
      tone: "gold",
      label: `أعلى منفذ: ${esc(lead.name)} — ${fmtNum(lead.total)} صورة`,
      basis,
    })}
    ${supportStrip}
    ${rankHtml}
  </div>`;
}

/**
 * Grid-system (slot 3 — الشبكة, "comparison") body for the port-population
 * page: ports (rows) × 4 metric columns (الصور / سليمة / اشتباه / نسبة
 * الاشتباه), each column normalized to its OWN domain via `metricMatrix`
 * (ui/analyticsCharts.ts) — never a shared scale across unlike units. The
 * rate column uses the same "sequential-gold" ramp as the count columns
 * (rather than a diverging ramp) because, unlike accuracy-vs-90%, this page
 * has no fixed target threshold for نسبة الاشتباه to diverge around — see
 * task-2-report.md for this judgment call.
 *
 * Land and sea render as two SEPARATE matrices side by side (mirrors every
 * other variant's land/sea split in this deck) rather than one combined
 * matrix with a row-group divider — `metricMatrix` has no divider affordance
 * of its own, and adding one would mean changing Task 1's already-reviewed
 * shared primitive; see task-2-report.md for the full rationale. The panel
 * chrome itself is the shared `gridPanel` primitive (slideKit.ts P6,
 * 2026-07-25 fan-out-plan P0 extraction).
 */
function gridPortMatrix(title: string, rows: PortPopRow[], variant: "land" | "sea", compact: boolean): string {
  const rate = (p: PortPopRow) => rateOf(p.suspicious, p.total);
  const matrix = metricMatrix(
    {
      rowLabels: rows.map((p) => p.name),
      columns: [
        {
          label: "الصور",
          domain: [0, maxOf(rows.map((p) => p.total))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.total),
        },
        {
          label: "سليمة",
          domain: [0, maxOf(rows.map((p) => p.clean))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.clean),
        },
        {
          label: "اشتباه",
          domain: [0, maxOf(rows.map((p) => p.suspicious))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.suspicious),
        },
        { label: "نسبة الاشتباه", domain: [0, 100], ramp: "sequential-gold", values: rows.map(rate) },
      ],
    },
    { width: 620, height: 320, compact, caption: `مصفوفة ${title}`, rowHeader: "المنفذ", emptyNote: "لا توجد بيانات" },
  );
  return gridPanel({
    title,
    sub: `${fmtNum(rows.length)} منفذ`,
    variant,
    chartHtml: matrix,
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
      const ledgerBody = `<div class="v2-sys-ledger v2-lg-port-population"><div class="v2-lg-split">${ledgerPortTable("المنافذ البرية", landChunk, "land", plan.compact)}${ledgerPortTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div></div>`;
      const briefingBody = briefingPortRank(landChunk, seaChunk);
      const gridBody = `<div class="v2-sys-grid v2-gd-port-population"><div class="v2-gd-split">${gridPortMatrix("المنافذ البرية", landChunk, "land", plan.compact)}${gridPortMatrix("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div></div>`;
      return v2Slide({
        id: `slide-port-population-${page + 1}`,
        title: `مجتمع صور الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `مجتمع صور الفحص لشهر ${model.summary.periodId}${cont}`,
        subhead: "منهجية التصنيف: تُصنَّف الصورة اشتباهًا إذا كانت نتيجة المستوى الأول أو الثاني اشتباهًا، وفي غير ذلك تُصنَّف سليمة.",
        bodyVariants: [body, ledgerBody, briefingBody, gridBody],
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
 * Ledger-system port-sample table (fan-out plan §6, batch B2a) — near-clone
 * of `ledgerPortTable`, but stacked sample-mode cells (`frac()`, "N من M")
 * instead of plain population counts, through the shared `ledgerPortCard`
 * (P2) with `extraClass: "sample-mode"` (theme.ts's matching padding rule).
 * `frac()` is kept deliberately (numerator+denominator in one cell) rather
 * than splitting into two columns — the plan calls this "maximally
 * auditable": every sample figure carries its own population base right
 * next to it, no separate lookup needed.
 */
function ledgerPortSampleTable(
  title: string,
  rows: PortPopRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const magTone: CellTone = variant === "land" ? "green" : "blue";
  const maxMag = maxOf(rows.map((p) => p.sampleTotal));
  const trs = rows
    .map((p, i) => {
      const coverage = p.total > 0 ? (p.sampleTotal / p.total) * 100 : 0;
      return `<tr><td>${ledgerIdx(i)}${esc(p.name)}</td>${barCell(frac(p.sampleTotal, p.total), (p.sampleTotal / maxMag) * 100, magTone)}<td>${frac(p.sampleClean, p.clean)}</td><td>${frac(p.sampleSuspicious, p.suspicious)}</td><td>${fmtPct(coverage)}</td></tr>`;
    })
    .join("");
  const sum = (f: (p: PortPopRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalPop = sum((p) => p.total);
  const totalSample = sum((p) => p.sampleTotal);
  const totalsRow = `<tr><td>الإجمالي</td><td>${frac(totalSample, totalPop)}</td><td>${frac(sum((p) => p.sampleClean), sum((p) => p.clean))}</td><td>${frac(sum((p) => p.sampleSuspicious), sum((p) => p.suspicious))}</td><td>${fmtPct(totalPop > 0 ? (totalSample / totalPop) * 100 : 0)}</td></tr>`;
  return ledgerPortCard({
    title,
    theadCells: `<th>المنفذ</th><th>العيّنة</th><th>سليمة</th><th>اشتباه</th><th>التغطية</th>`,
    bodyRowsHtml: trs,
    totalsRowHtml: totalsRow,
    span: 5,
    rowCount: 0,
    compact,
    extraClass: "sample-mode",
  });
}

/**
 * Briefing-system port-sample rank list (fan-out plan §6) — sibling of
 * `briefingPortRank`, ranked by `sampleTotal` (not population `total`) and
 * toned blue (adjacent to port-population's gold, signalling "same shape,
 * population→sample"). `foldRemainder` SUMS the folded ports' `sampleTotal`/
 * `total` and pools coverage from THOSE sums (`rateOf(restSample, restPop)`)
 * — never averages each folded port's own coverage % — same anti-averaging
 * discipline every other pooled figure in this fan-out follows.
 */
function briefingPortSampleRank(landChunk: PortPopRow[], seaChunk: PortPopRow[]): string {
  const combined = [...landChunk, ...seaChunk].sort((a, b) => b.sampleTotal - a.sampleTotal);
  if (combined.length === 0) {
    return `<div class="v2-sys-brief v2-bf-port-sample">
      <div class="v2-bf-lede"><div class="v2-bf-lede-figure blue"><span class="insuff">—</span></div></div>
    </div>`;
  }
  const lead = combined[0];
  const sliceSampleTotal = combined.reduce((s, p) => s + p.sampleTotal, 0);
  const slicePopTotal = combined.reduce((s, p) => s + p.total, 0);
  const plan = briefingRankPlan(combined.length);

  const sampleCleanTotal = combined.reduce((s, p) => s + p.sampleClean, 0);
  const pageCoverage = rateOf(sliceSampleTotal, slicePopTotal);
  const supportStrip = briefingSupport([
    { iconName: "scan", value: fmtNum(sliceSampleTotal), label: "إجمالي العيّنة" },
    { iconName: "check", value: fmtNum(sampleCleanTotal), label: "عيّنة السليمة" },
    { iconName: "gauge", value: pctCell(pageCoverage), label: "تغطية الصفحة" },
  ]);
  const basis =
    plan.folded > 0
      ? `أعلى ${fmtNum(plan.named)} من ${portCountPhrase(combined.length)} · إجمالي عيّنة الصفحة ${fmtNum(sliceSampleTotal)} من ${fmtNum(slicePopTotal)}`
      : `${portCountPhrase(combined.length)} · إجمالي عيّنة الصفحة ${fmtNum(sliceSampleTotal)} من ${fmtNum(slicePopTotal)}`;

  const rankItems: BriefingRankItem[] = combined.map((p) => {
    const coverage = rateOf(p.sampleTotal, p.total);
    return {
      label: p.name,
      value: p.sampleTotal,
      valueText: fmtNum(p.sampleTotal),
      secondaryText: `من ${fmtNum(p.total)} · تغطية ${pctCell(coverage)}`,
    };
  });
  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "blue",
    scale: { kind: "auto" },
    foldRemainder: (folded) => {
      // Recover the folded ports' raw sample/population totals from
      // `combined` (richer than the generic BriefingRankItem[] this
      // callback receives) by slicing on the folded count — same technique
      // briefingPortRank's own foldRemainder uses.
      const restRows = combined.slice(combined.length - folded.length);
      const restSample = restRows.reduce((s, p) => s + p.sampleTotal, 0);
      const restPop = restRows.reduce((s, p) => s + p.total, 0);
      const restCoverage = rateOf(restSample, restPop);
      return {
        label: `بقية المنافذ (${fmtNum(folded.length)})`,
        value: restSample,
        valueText: fmtNum(restSample),
        secondaryText: `من ${fmtNum(restPop)} · تغطية ${pctCell(restCoverage)}`,
        rest: true,
      };
    },
  });

  return `<div class="v2-sys-brief v2-bf-port-sample">
    ${briefingLede({
      figure: fmtNum(lead.sampleTotal),
      tone: "blue",
      label: `أعلى منفذ عيّنةً: ${esc(lead.name)} — ${fmtNum(lead.sampleTotal)} من ${fmtNum(lead.total)} صورة`,
      basis,
    })}
    ${supportStrip}
    ${rankHtml}
  </div>`;
}

/**
 * Grid-system port-sample matrix (fan-out plan §6) — sibling of
 * `gridPortMatrix`, sample-mode columns (العيّنة/المجتمع/التغطية/اشتباه
 * العيّنة) instead of population-mode ones, all `sequential-gold` (no fixed
 * target for any of them to diverge around, same reasoning as the exemplar).
 */
function gridPortSampleMatrix(
  title: string,
  rows: PortPopRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const coverage = (p: PortPopRow) => rateOf(p.sampleTotal, p.total);
  const matrix = metricMatrix(
    {
      rowLabels: rows.map((p) => p.name),
      columns: [
        {
          label: "العيّنة",
          domain: [0, maxOf(rows.map((p) => p.sampleTotal))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.sampleTotal),
        },
        {
          label: "المجتمع",
          domain: [0, maxOf(rows.map((p) => p.total))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.total),
        },
        { label: "التغطية", domain: [0, 100], ramp: "sequential-gold", values: rows.map(coverage) },
        {
          label: "اشتباه العيّنة",
          domain: [0, maxOf(rows.map((p) => p.sampleSuspicious))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.sampleSuspicious),
        },
      ],
    },
    { width: 620, height: 320, compact, caption: `مصفوفة ${title}`, rowHeader: "المنفذ", emptyNote: "لا توجد بيانات" },
  );
  return gridPanel({
    title,
    sub: `${fmtNum(rows.length)} منفذ`,
    variant,
    chartHtml: matrix,
  });
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
      const ledgerBody = `<div class="v2-sys-ledger v2-lg-port-sample"><div class="v2-lg-split">${ledgerPortSampleTable("المنافذ البرية", landChunk, "land", plan.compact)}${ledgerPortSampleTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div></div>`;
      const briefingBody = briefingPortSampleRank(landChunk, seaChunk);
      const gridBody = `<div class="v2-sys-grid v2-gd-port-sample"><div class="v2-gd-split">${gridPortSampleMatrix("المنافذ البرية", landChunk, "land", plan.compact)}${gridPortSampleMatrix("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div></div>`;
      return v2Slide({
        id: `slide-port-sample-${page + 1}`,
        title: `عيّنة الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `عيّنة الفحص المسحوبة لشهر ${model.summary.periodId}${cont}`,
        subhead: "الصفحة نفسها بأرقام العيّنة: كل رقم عيّنة وتحته أساسه من المجتمع، مع نسبة التغطية.",
        bodyVariants: [body, ledgerBody, briefingBody, gridBody],
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

/**
 * Ledger-system quality table (fan-out plan §8, batch B2a) — near-clone of
 * `qualityTable`'s columns/tones through the shared `ledgerPortCard` (P2),
 * plus an ordinal badge. The card `title` discloses the pooled denominator
 * (`{title} — {N} منفذ · {evaluatedTotal} صورة مُقيَّمة`, per the plan) —
 * Ledger's whole point is verifiability, and a quality DISTRIBUTION
 * (عالي/متوسط/منخفض) genuinely needs its base stated once at the card level
 * (each row already states its own port name; the shared base belongs on
 * the card, not repeated per row).
 */
function ledgerQualityTable(
  title: string,
  rows: PortQualityRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const trs = rows
    .map((p, i) => {
      const evaluated = p.highQ + p.medQ + p.lowQ;
      const high = rateOf(p.highQ, evaluated);
      const med = rateOf(p.medQ, evaluated);
      const low = rateOf(p.lowQ, evaluated);
      const marking = rateOf(p.markingPresent, p.markingPresent + p.markingMissing);
      return `<tr><td>${ledgerIdx(i)}${esc(p.name)}</td>${qualCell(high, "green")}${qualCell(med, "gold")}${qualCell(low, "coral")}${threshCell(marking, MARKING_TARGET)}</tr>`;
    })
    .join("");
  const sum = (f: (p: PortQualityRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalMarkP = sum((p) => p.markingPresent);
  const totalMarkM = sum((p) => p.markingMissing);
  const totalHigh = sum((p) => p.highQ);
  const totalMed = sum((p) => p.medQ);
  const totalLow = sum((p) => p.lowQ);
  const totalEvaluated = totalHigh + totalMed + totalLow;
  const totalsRow = `<tr><td>الإجمالي</td><td>${pctCell(rateOf(totalHigh, totalEvaluated))}</td><td>${pctCell(rateOf(totalMed, totalEvaluated))}</td><td>${pctCell(rateOf(totalLow, totalEvaluated))}</td><td>${pctCell(rateOf(totalMarkP, totalMarkP + totalMarkM))}</td></tr>`;

  return ledgerPortCard({
    title: `${title} — ${fmtNum(rows.length)} منفذ · ${fmtNum(totalEvaluated)} صورة مُقيَّمة`,
    theadCells: `<th>المنفذ</th><th>عالي</th><th>متوسط</th><th>منخفض</th><th>التحديد</th>`,
    bodyRowsHtml: trs,
    totalsRowHtml: totalsRow,
    span: 5,
    rowCount: 0,
    compact,
  });
}

/**
 * Briefing-system quality rank list (fan-out plan §8) — the one page in this
 * batch with a real EXCLUSION rule, not just a density fold: ports with
 * `evaluated === 0` carry no quality-level data at all, so they must never
 * be individually ranked (that would either misrepresent them with a fake
 * 0% low-quality rate, or silently vanish). They are pulled out of the
 * ranked set entirely and always surface as ONE aggregate row at the tail —
 * `منافذ بلا صور مُقيَّمة (k)`, `value: null` (bar-less: `evaluated===0` means
 * `ΣlowQ/Σevaluated` is definitionally `0/0`, i.e. `rateOf` returns null,
 * never a fabricated rate) — appended to `items` AFTER the ranked ports.
 *
 * This exclusion is orthogonal to `briefingRankList`'s own density-driven
 * fold (`briefingRankPlan`'s row-budget ladder): real per-page port counts
 * here (bounded by `planPortPages`/`BASE_ROWS_PER_PAGE`) never approach that
 * ladder's cap, so in every practical case the appended aggregate is the
 * WHOLE folded tail and its own label carries straight through. The
 * `foldRemainder` callback below still handles the (unreachable in practice,
 * but type-safety-mandatory) case where a very large rankable-port count
 * ALSO triggers the density fold and mixes real ranked ports into the same
 * tail — it recomputes the pooled rate correctly either way (via a raw
 * lowQ/evaluated array parallel to `items`, sliced by the folded count —
 * `briefingPortRank`'s own established technique) and only falls back to
 * the generic "بقية المنافذ" wording once the fold is provably NOT pure
 * exclusion, so a mixed tail is never mislabeled as "unevaluated".
 */
function briefingQualityRank(landChunk: PortQualityRow[], seaChunk: PortQualityRow[]): string {
  const combinedAll = [...landChunk, ...seaChunk];
  if (combinedAll.length === 0) {
    return `<div class="v2-sys-brief v2-bf-quality-ports">
      <div class="v2-bf-lede"><div class="v2-bf-lede-figure coral"><span class="insuff">—</span></div></div>
    </div>`;
  }
  const withEval = combinedAll.map((p) => ({ ...p, evaluated: p.highQ + p.medQ + p.lowQ }));
  const rankable = withEval
    .filter((p) => p.evaluated > 0)
    .sort((a, b) => b.lowQ / b.evaluated - a.lowQ / a.evaluated);
  const excluded = withEval.filter((p) => p.evaluated === 0);

  const sliceEvaluated = withEval.reduce((s, p) => s + p.evaluated, 0);
  const sliceHigh = withEval.reduce((s, p) => s + p.highQ, 0);
  const sliceMed = withEval.reduce((s, p) => s + p.medQ, 0);
  const sliceLow = withEval.reduce((s, p) => s + p.lowQ, 0);
  const sliceMarkP = withEval.reduce((s, p) => s + p.markingPresent, 0);
  const sliceMarkM = withEval.reduce((s, p) => s + p.markingMissing, 0);
  const lowRate = rateOf(sliceLow, sliceEvaluated);

  const supportStrip = briefingSupport([
    { iconName: "check", value: pctCell(rateOf(sliceHigh, sliceEvaluated)), label: "عالي (مجمّع)" },
    { iconName: "gauge", value: pctCell(rateOf(sliceMed, sliceEvaluated)), label: "متوسط (مجمّع)" },
    { iconName: "flag", value: pctCell(rateOf(sliceMarkP, sliceMarkP + sliceMarkM)), label: "التحديد (مجمّع)" },
  ]);
  const basis = `${portCountPhrase(combinedAll.length)} في هذه الصفحة`;

  const rankItems: BriefingRankItem[] = rankable.map((p) => {
    const rate = rateOf(p.lowQ, p.evaluated);
    return {
      label: p.name,
      value: rate,
      valueText: pctCell(rate),
      secondaryText: `من ${fmtNum(p.evaluated)} صورة`,
    };
  });
  // Raw per-item lowQ/evaluated, PARALLEL to rankItems (plus one synthetic
  // all-zero slot standing in for the whole excluded group), so
  // foldRemainder can recover real sums for whatever tail actually gets
  // folded — see this function's doc comment.
  const rawForFold: Array<{ lowQ: number; evaluated: number }> = rankable.map((p) => ({
    lowQ: p.lowQ,
    evaluated: p.evaluated,
  }));
  if (excluded.length > 0) {
    rankItems.push({
      label: `منافذ بلا صور مُقيَّمة (${fmtNum(excluded.length)})`,
      value: null,
      valueText: "—",
      secondaryText: "",
    });
    rawForFold.push({ lowQ: 0, evaluated: 0 });
  }

  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "coral",
    scale: { kind: "fixed", max: 100 },
    foldRemainder: (folded) => {
      const raw = rawForFold.slice(rawForFold.length - folded.length);
      const foldedLow = raw.reduce((s, r) => s + r.lowQ, 0);
      const foldedEvaluated = raw.reduce((s, r) => s + r.evaluated, 0);
      const rate = rateOf(foldedLow, foldedEvaluated);
      const isPureExclusion = excluded.length > 0 && folded.length === 1 && folded[0].value === null;
      return {
        label: isPureExclusion
          ? `منافذ بلا صور مُقيَّمة (${fmtNum(excluded.length)})`
          : `بقية المنافذ (${fmtNum(folded.length)})`,
        value: rate,
        valueText: pctCell(rate),
        secondaryText: foldedEvaluated > 0 ? `من ${fmtNum(foldedEvaluated)} صورة` : "",
        rest: true,
      };
    },
  });

  return `<div class="v2-sys-brief v2-bf-quality-ports">
    ${briefingLede({
      figure: pctCell(lowRate),
      tone: "coral",
      label: `جودة منخفضة ${pctCell(lowRate)} — ${fmtNum(sliceLow)} من ${fmtNum(sliceEvaluated)} صورة مُقيَّمة`,
      basis,
    })}
    ${supportStrip}
    ${rankHtml}
  </div>`;
}

/**
 * Grid-system quality matrix (fan-out plan §8) — rows = ports, columns
 * عالي/متوسط/منخفض/التحديد, ALL `sequential-gold` (the plan explicitly
 * rejects `diverging-green-coral` for منخفض: a diverging ramp needs a
 * genuinely meaningful midpoint, which a low-quality share doesn't have —
 * only a signed delta would). The 90% التحديد target has no threshold
 * vocabulary in `metricMatrix`, so it's disclosed in the panel head sub
 * instead (`«{N} منفذ · هدف التحديد {MARKING_TARGET}%»`), same "Ledger/
 * Briefing carry the caveat honestly, Grid states what it can" pattern
 * `slide-risk-stages`'s وزن العينة omission already establishes.
 */
function gridQualityMatrix(
  title: string,
  rows: PortQualityRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const withEval = rows.map((p) => ({ ...p, evaluated: p.highQ + p.medQ + p.lowQ }));
  const marking = (p: PortQualityRow) => rateOf(p.markingPresent, p.markingPresent + p.markingMissing);
  const matrix = metricMatrix(
    {
      rowLabels: rows.map((p) => p.name),
      columns: [
        {
          label: "عالي",
          domain: [0, 100],
          ramp: "sequential-gold",
          values: withEval.map((p) => rateOf(p.highQ, p.evaluated)),
        },
        {
          label: "متوسط",
          domain: [0, 100],
          ramp: "sequential-gold",
          values: withEval.map((p) => rateOf(p.medQ, p.evaluated)),
        },
        {
          label: "منخفض",
          domain: [0, 100],
          ramp: "sequential-gold",
          values: withEval.map((p) => rateOf(p.lowQ, p.evaluated)),
        },
        { label: "التحديد", domain: [0, 100], ramp: "sequential-gold", values: rows.map(marking) },
      ],
    },
    { width: 620, height: 320, compact, caption: `مصفوفة ${title}`, rowHeader: "المنفذ", emptyNote: "لا توجد بيانات" },
  );
  return gridPanel({
    title,
    sub: `${fmtNum(rows.length)} منفذ · هدف التحديد ${MARKING_TARGET}%`,
    variant,
    chartHtml: matrix,
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
      const ledgerBody = `<div class="v2-sys-ledger v2-lg-quality-ports"><div class="v2-lg-split">${ledgerQualityTable("المنافذ البرية", landChunk, "land", plan.compact)}${ledgerQualityTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div></div>`;
      const briefingBody = briefingQualityRank(landChunk, seaChunk);
      const gridBody = `<div class="v2-sys-grid v2-gd-quality-ports"><div class="v2-gd-split">${gridQualityMatrix("المنافذ البرية", landChunk, "land", plan.compact)}${gridQualityMatrix("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div></div>`;
      return v2Slide({
        id: `slide-quality-ports-${page + 1}`,
        title: `نتائج جودة الصور${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "scan",
        headline: `نتائج جودة الصور في المنافذ${cont}`,
        subhead: "توزيع مستويات جودة الصورة (عالي / متوسط / منخفض) ونسبة وجود التحديد في كل منفذ.",
        bodyVariants: [body, ledgerBody, briefingBody, gridBody],
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

/**
 * Ledger-system accuracy table (fan-out plan §9, batch B2a) — near-clone of
 * `accuracyTable`'s columns/tones through `ledgerPortCard` (P2), plus a NEW
 * العيّنة column (`fmtNum(p.evaluable)`) that slot 0's 4-column table has no
 * room for — per the plan, "a rate without its denominator is exactly what
 * Ledger exists to fix," and shown for EVERY row (including unrankable ones,
 * where it's the only figure the row carries: it's the reason the rates are
 * muted "—" instead of a fabricated number). Card title carries the pooled
 * base ("{title} — {N} منفذ · {evaluableTotal} قرار قابل للتقييم" — reusing
 * the exact "قرار قابل للتقييم" phrase the plan's §11b already establishes
 * for this same `evaluable` figure elsewhere in the deck).
 */
function ledgerAccuracyTable(
  title: string,
  rows: PortAccuracyRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const trs = rows
    .map((p, i) => {
      const accuracy = rateOf(p.correctClean + p.correctSuspicion, p.evaluable);
      const detection = rateOf(p.correctSuspicion, p.correctSuspicion + p.missedSuspicion);
      const clean = rateOf(p.correctClean, p.correctClean + p.falseSuspicion);
      const show = (v: number | null) =>
        p.rankable ? threshCell(v, ACCURACY_TARGET) : `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;
      return `<tr><td>${ledgerIdx(i)}${esc(p.name)}</td>${show(accuracy)}${show(detection)}${show(clean)}<td>${fmtNum(p.evaluable)}</td></tr>`;
    })
    .join("");
  const sum = (f: (p: PortAccuracyRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalEvaluable = sum((p) => p.evaluable);
  const totalCC = sum((p) => p.correctClean);
  const totalCS = sum((p) => p.correctSuspicion);
  const totalMS = sum((p) => p.missedSuspicion);
  const totalFS = sum((p) => p.falseSuspicion);
  const totalsRow = `<tr><td>الإجمالي</td><td>${pctCell(rateOf(totalCC + totalCS, totalEvaluable))}</td><td>${pctCell(rateOf(totalCS, totalCS + totalMS))}</td><td>${pctCell(rateOf(totalCC, totalCC + totalFS))}</td><td>${fmtNum(totalEvaluable)}</td></tr>`;

  return ledgerPortCard({
    title: `${title} — ${fmtNum(rows.length)} منفذ · ${fmtNum(totalEvaluable)} قرار قابل للتقييم`,
    theadCells: `<th>المنفذ</th><th>الدقة العامة</th><th>دقة الاشتباه</th><th>دقة السليمة</th><th>العيّنة</th>`,
    bodyRowsHtml: trs,
    totalsRowHtml: totalsRow,
    span: 5,
    rowCount: 0,
    compact,
  });
}

/**
 * Briefing-system accuracy rank list (fan-out plan §9) — ranked ASCENDING
 * (worst first, not the usual desc-by-magnitude convention every other rank
 * list in this fan-out uses): the basis chip's «الأقل دقة أولًا» is
 * load-bearing per the plan — without it, rank #1 would misread as "best"
 * when it is actually the LEAST accurate port on the page.
 *
 * Unrankable ports (`p.rankable === false`, i.e. below `isRankable`'s
 * data-sufficiency threshold) are excluded from ranking and folded into a
 * bar-less remainder («منافذ دون حد الكفاية (k)»), never given a fake rate —
 * same exclusion mechanics as `briefingQualityRank`'s evaluated===0 handling
 * above (see that function's doc comment for the full design rationale: the
 * exclusion is orthogonal to `briefingRankList`'s own density fold, and
 * `foldRemainder` recovers pooled correct/evaluable sums via a raw array
 * parallel to `items`, sliced by the folded count).
 */
function briefingAccuracyRank(landChunk: PortAccuracyRow[], seaChunk: PortAccuracyRow[]): string {
  const combinedAll = [...landChunk, ...seaChunk];
  if (combinedAll.length === 0) {
    return `<div class="v2-sys-brief v2-bf-quality-accuracy">
      <div class="v2-bf-lede"><div class="v2-bf-lede-figure green"><span class="insuff">—</span></div></div>
    </div>`;
  }
  const rankable = combinedAll
    .filter((p) => p.rankable)
    .map((p) => ({ ...p, accuracy: rateOf(p.correctClean + p.correctSuspicion, p.evaluable) }))
    // Ascending — worst first (see this function's doc comment).
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
  const excluded = combinedAll.filter((p) => !p.rankable);

  const sum = (f: (p: PortAccuracyRow) => number) => combinedAll.reduce((s, p) => s + f(p), 0);
  const totalEvaluable = sum((p) => p.evaluable);
  const totalCC = sum((p) => p.correctClean);
  const totalCS = sum((p) => p.correctSuspicion);
  const totalMS = sum((p) => p.missedSuspicion);
  const totalFS = sum((p) => p.falseSuspicion);
  const overallAccuracy = rateOf(totalCC + totalCS, totalEvaluable);

  const supportStrip = briefingSupport([
    { iconName: "alert", value: pctCell(rateOf(totalCS, totalCS + totalMS)), label: "دقة الاشتباه" },
    { iconName: "check", value: pctCell(rateOf(totalCC, totalCC + totalFS)), label: "دقة السليمة" },
    { iconName: "flag", value: fmtNum(excluded.length), label: "دون حد الكفاية" },
  ]);
  const basis = `${portCountPhrase(combinedAll.length)} · هدف ${ACCURACY_TARGET}% · الأقل دقة أولًا`;

  const rankItems: BriefingRankItem[] = rankable.map((p) => ({
    label: p.name,
    value: p.accuracy,
    valueText: pctCell(p.accuracy),
    secondaryText: `العيّنة ${fmtNum(p.evaluable)}`,
  }));
  // Raw per-item correct/evaluable counts, PARALLEL to rankItems (plus one
  // synthetic slot pooling the whole excluded group), so foldRemainder can
  // recover real sums for whatever tail actually gets folded — same
  // technique as briefingQualityRank above.
  const rawForFold: Array<{ correct: number; evaluable: number }> = rankable.map((p) => ({
    correct: p.correctClean + p.correctSuspicion,
    evaluable: p.evaluable,
  }));
  if (excluded.length > 0) {
    rankItems.push({
      label: `منافذ دون حد الكفاية (${fmtNum(excluded.length)})`,
      value: null,
      valueText: "—",
      secondaryText: "",
    });
    rawForFold.push({
      correct: excluded.reduce((s, p) => s + p.correctClean + p.correctSuspicion, 0),
      evaluable: excluded.reduce((s, p) => s + p.evaluable, 0),
    });
  }

  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "green",
    scale: { kind: "fixed", max: 100 },
    foldRemainder: (folded) => {
      const raw = rawForFold.slice(rawForFold.length - folded.length);
      const foldedCorrect = raw.reduce((s, r) => s + r.correct, 0);
      const foldedEvaluable = raw.reduce((s, r) => s + r.evaluable, 0);
      const rate = rateOf(foldedCorrect, foldedEvaluable);
      const isPureExclusion = excluded.length > 0 && folded.length === 1 && folded[0].value === null;
      return {
        label: isPureExclusion
          ? `منافذ دون حد الكفاية (${fmtNum(excluded.length)})`
          : `بقية المنافذ (${fmtNum(folded.length)})`,
        value: rate,
        valueText: pctCell(rate),
        secondaryText: foldedEvaluable > 0 ? `العيّنة ${fmtNum(foldedEvaluable)}` : "",
        rest: true,
      };
    },
  });

  return `<div class="v2-sys-brief v2-bf-quality-accuracy">
    ${briefingLede({
      figure: pctCell(overallAccuracy),
      tone: "green",
      label: `الدقة العامة ${pctCell(overallAccuracy)} — ${fmtNum(totalCC + totalCS)} من ${fmtNum(totalEvaluable)} قرار`,
      basis,
    })}
    ${supportStrip}
    ${rankHtml}
  </div>`;
}

/**
 * Grid-system accuracy matrix (fan-out plan §9) — rows = ports, columns
 * الدقة العامة/دقة الاشتباه/دقة السليمة (`[0,100]`) + العيّنة (own domain),
 * ALL `sequential-gold`. Unrankable ports pass `null` for the three rate
 * columns (`metricMatrix` renders "—", never a fake value) while still
 * showing العيّنة — same "state what you can, omit what you can't" pattern
 * as `gridQualityMatrix`'s marking-target sub line. Panel head sub carries
 * the accuracy target since `metricMatrix` has no threshold vocabulary of
 * its own (same reasoning as gridQualityMatrix's التحديد target).
 */
function gridAccuracyMatrix(
  title: string,
  rows: PortAccuracyRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const accuracy = (p: PortAccuracyRow) =>
    p.rankable ? rateOf(p.correctClean + p.correctSuspicion, p.evaluable) : null;
  const detection = (p: PortAccuracyRow) =>
    p.rankable ? rateOf(p.correctSuspicion, p.correctSuspicion + p.missedSuspicion) : null;
  const clean = (p: PortAccuracyRow) =>
    p.rankable ? rateOf(p.correctClean, p.correctClean + p.falseSuspicion) : null;
  const matrix = metricMatrix(
    {
      rowLabels: rows.map((p) => p.name),
      columns: [
        { label: "الدقة العامة", domain: [0, 100], ramp: "sequential-gold", values: rows.map(accuracy) },
        { label: "دقة الاشتباه", domain: [0, 100], ramp: "sequential-gold", values: rows.map(detection) },
        { label: "دقة السليمة", domain: [0, 100], ramp: "sequential-gold", values: rows.map(clean) },
        {
          label: "العيّنة",
          domain: [0, maxOf(rows.map((p) => p.evaluable))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.evaluable),
        },
      ],
    },
    { width: 620, height: 320, compact, caption: `مصفوفة ${title}`, rowHeader: "المنفذ", emptyNote: "لا توجد بيانات" },
  );
  return gridPanel({
    title,
    sub: `${fmtNum(rows.length)} منفذ · هدف الدقة ${ACCURACY_TARGET}%`,
    variant,
    chartHtml: matrix,
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
      const ledgerBody = `<div class="v2-sys-ledger v2-lg-quality-accuracy"><div class="v2-lg-split">${ledgerAccuracyTable("المنافذ البرية", landChunk, "land", plan.compact)}${ledgerAccuracyTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div></div>`;
      const briefingBody = briefingAccuracyRank(landChunk, seaChunk);
      const gridBody = `<div class="v2-sys-grid v2-gd-quality-accuracy"><div class="v2-gd-split">${gridAccuracyMatrix("المنافذ البرية", landChunk, "land", plan.compact)}${gridAccuracyMatrix("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div></div>`;
      return v2Slide({
        id: `slide-quality-accuracy-${page + 1}`,
        title: `دقة نتائج المنافذ${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "gauge",
        headline: `نتائج دقة نتائج المنافذ (اشتباه / سليمة)${cont}`,
        subhead: "الدقة العامة، ودقة اكتشاف الاشتباه، ودقة تأكيد السليمة.",
        bodyVariants: [body, ledgerBody, briefingBody, gridBody],
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
