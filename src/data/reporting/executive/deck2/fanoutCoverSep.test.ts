// src/data/reporting/executive/deck2/fanoutCoverSep.test.ts
//
// Tests for the LAST two pages of the deck2 three-system fan-out
// (docs/superpowers/specs/2026-07-28-deck2-fanout-cover-and-separators-plan.md):
// `slide-cover` (coverSlide) and `slide-sep-1/2/3` (sectionSeparatorSlide). This
// plan explicitly supersedes the prior "no fan-out for the separators" ruling
// (see the plan's own §0 and this batch's edit-log entry).
//
// Risks this file focuses on, per the plan's own "highest-risk trap" framing:
//   (a) The cover is dark in BOTH themes by design (theme.ts's `.slide.v2-cover`
//       rules) — covered by a live DOM check in the manual verification pass,
//       not here (jsdom/vitest doesn't compute CSS cascade); this file instead
//       pins the MARKUP (slot-0 byte-identity, field conservation, no rank list)
//       that the CSS re-overrides depend on being present.
//   (b) The separator's `tone` ("gold"|"cyan") has no matching `BriefingTone`
//       ("cyan" is not a member) — a raw pass-through would silently emit
//       `v2-bf-lede-figure cyan`, a class with NO CSS rule. This file asserts
//       the mapping is actually applied, never bypassed.
//   (c) Cover Briefing must never carry a rank list ("scope, never findings"
//       rule) and separator Ledger must never render a `<table>` (a data-free
//       divider doesn't get theatre-table treatment).
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildReportModel } from "../model/reportModel";
import { coverSlide, sectionSeparatorSlide } from "./slides";
import { coverMeshSvg } from "../ui/generativeArt";
import { ZATCA_LOGO_URL } from "../../../../branding/organization";
import { fmtNum, fmtPct } from "../primitives";

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId: "XR-1",
    xrayEntryDate: null,
    portCode: "P1",
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "بري",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

function input(populationRows: PreparedPopulationRow[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

/** Isolate one variant panel's HTML — same technique deck2.test.ts /
 *  fanoutB3Closing.test.ts use. */
function panelSlice(html: string, index: 0 | 1 | 2 | 3): string {
  const start = html.indexOf(`data-variant-index="${index}"`);
  expect(start).toBeGreaterThan(-1);
  if (index === 3) return html.slice(start);
  const end = html.indexOf(`data-variant-index="${index + 1}"`);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

function twoPortModel() {
  return buildReportModel(
    input([
      popRow({ portName: "منفذ أ", portType: "منفذ بري" }),
      popRow({ xrayImageId: "XR-2", portName: "منفذ ب", portType: "منفذ بحري" }),
    ]),
  );
}

const GENERATED_AT = new Date(2026, 6, 28, 10, 0, 0);

// ═══════════════════════════════════════════════════════════════════════════
// slide-cover — coverSlide
// ═══════════════════════════════════════════════════════════════════════════
describe("slide-cover fan-out — Ledger/Briefing/Grid (2026-07-28 fan-out plan §4)", () => {
  // Captured VERBATIM (2026-07-28, before any variant-1..3 code change) from
  // coverSlide(model, generatedAt, false, "seed") for a 2-port fixture, with
  // the two large deterministic-but-orthogonal blobs (the seeded low-poly
  // mesh SVG and the embedded ZATCA logo data URI) reconstructed via their
  // OWN already-tested generator (coverMeshSvg, generativeArt.test.ts) /
  // constant (ZATCA_LOGO_URL) instead of hand-copied — this keeps the pin's
  // regression value on coverSlide's OWN composition (untouched by this
  // task) without bloating this file with ~50KB of unrelated SVG path data.
  const EXPECTED_VARIANT0 =
    `<section class="slide v2 title-slide v2-cover" id="slide-cover" data-title="الغلاف" data-section="cover" data-section-label="الغلاف">\n` +
    `    <div class="slide-controls">\n` +
    `    <label class="slide-print-toggle" title="تضمين هذه الصفحة عند الطباعة">\n` +
    `    <input type="checkbox" checked/>\n` +
    `    <span class="slide-print-toggle-track"><span class="slide-print-toggle-thumb"></span></span>\n` +
    `  </label>\n` +
    `    \n` +
    `  </div>\n` +
    `    <div class="v2-cover-mesh" aria-hidden="true">${coverMeshSvg("seed")}</div>\n` +
    `    <div class="slide-art" aria-hidden="true"></div>\n` +
    `    <svg class="v2-cover-band" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true">\n` +
    `    <defs>\n` +
    `      <pattern id="v2band-diag" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">\n` +
    `        <line x1="0" y1="0" x2="0" y2="26" stroke="var(--gold)" stroke-width="1" stroke-opacity="0.06"/>\n` +
    `      </pattern>\n` +
    `      <linearGradient id="v2band-fade" x1="0" y1="0" x2="0" y2="1">\n` +
    `        <stop offset="0" stop-color="var(--gold)" stop-opacity="0"/>\n` +
    `        <stop offset="1" stop-color="var(--gold)" stop-opacity="0.10"/>\n` +
    `      </linearGradient>\n` +
    `    </defs>\n` +
    `    <rect x="0" y="0" width="1200" height="400" fill="url(#v2band-diag)"/>\n` +
    `    <rect x="0" y="250" width="1200" height="150" fill="url(#v2band-fade)"/>\n` +
    `  </svg>\n` +
    `    <div class="v2-org">\n` +
    `      <img class="v2-org-logo" src="${ZATCA_LOGO_URL}" alt="هيئة الزكاة والضريبة والجمارك"/>\n` +
    `      <div class="v2-org-lines">\n` +
    `        <b>هيئة الزكاة والضريبة والجمارك</b>\n` +
    `        <span>الشؤون القانونية والالتزام</span><span>الإدارة العامة لضمان الجودة والامتثال</span><span>إدارة الرقابة والامتثال على المنافذ</span>\n` +
    `      </div>\n` +
    `    </div>\n` +
    `    <div class="slide-inner">\n` +
    `      <div class="v2-cover-grid">\n` +
    `      <div class="v2-cover-hero">\n` +
    `        <div class="v2-cover-kicker"><span class="v2-cover-kicker-dot"></span>عرض تنفيذي · تقرير شهري</div>\n` +
    `        <h1 class="v2-cover-title">تقرير ضمان جودة<br/>فحص الأشعة</h1>\n` +
    `        <div class="v2-cover-rule"></div>\n` +
    `        <div class="v2-cover-lockup">\n` +
    `          <span class="v2-cover-lockup-label">فترة الدراسة (عيّنة شهر)</span>\n` +
    `          <span class="v2-cover-lockup-period">مايو 2026</span>\n` +
    `        </div>\n` +
    `        <div class="v2-cover-badge"><span><svg viewBox="0 0 24 24" width="13" height="13" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M12 3l7 3v5c0 4.2-2.9 7.4-7 8.5C7.9 18.4 5 15.2 5 11V6l7-3z"/></svg></span>داخلي — للاستخدام التنفيذي</div>\n` +
    `      </div>\n` +
    `      <div class="v2-cover-meta-col"><div class="v2-cover-meta-item">\n` +
    `        <span class="v2-cover-meta-icon"><svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/></svg></span>\n` +
    `        <span class="v2-cover-meta-text">\n` +
    `          <span class="v2-cover-meta-label">فترة الدراسة</span>\n` +
    `          <span class="v2-cover-meta-value">مايو 2026</span>\n` +
    `        </span>\n` +
    `      </div><div class="v2-cover-meta-item">\n` +
    `        <span class="v2-cover-meta-icon"><svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M7 3h7l4 4v14H7V3z"/><path d="M14 3v4h4"/><path d="M9.5 13h5"/><path d="M9.5 16.5h5"/></svg></span>\n` +
    `        <span class="v2-cover-meta-text">\n` +
    `          <span class="v2-cover-meta-label">تاريخ الإصدار</span>\n` +
    `          <span class="v2-cover-meta-value">28 يوليو 2026</span>\n` +
    `        </span>\n` +
    `      </div><div class="v2-cover-meta-item">\n` +
    `        <span class="v2-cover-meta-icon"><svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M4 20c0-2.8 2.2-5 5-5s5 2.2 5 5"/><path d="M16 4.5a3 3 0 0 1 0 6.5"/><path d="M15 15.2c2.3.4 4 2.4 4 4.8"/></svg></span>\n` +
    `        <span class="v2-cover-meta-text">\n` +
    `          <span class="v2-cover-meta-label">الإدارة</span>\n` +
    `          <span class="v2-cover-meta-value">الإدارة العامة لضمان الجودة والامتثال</span>\n` +
    `        </span>\n` +
    `      </div><div class="v2-cover-meta-item">\n` +
    `        <span class="v2-cover-meta-icon"><svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M12 3l7 3v5c0 4.2-2.9 7.4-7 8.5C7.9 18.4 5 15.2 5 11V6l7-3z"/></svg></span>\n` +
    `        <span class="v2-cover-meta-text">\n` +
    `          <span class="v2-cover-meta-label">القسم</span>\n` +
    `          <span class="v2-cover-meta-value">إدارة الرقابة والامتثال على المنافذ</span>\n` +
    `        </span>\n` +
    `      </div></div>\n` +
    `    </div>\n` +
    `    </div>\n` +
    `  </section>`;

  it("(a) variant 0 (production) is byte-identical to before this task — regression guard", () => {
    const html = coverSlide(twoPortModel(), GENERATED_AT, false, "seed");
    expect(html).toBe(EXPECTED_VARIANT0);
  });

  it("(b) Ledger slot: 7-row ledgerTableCard with ordinal badges, no totals row, classification footnote instead", () => {
    const html = coverSlide(twoPortModel(), GENERATED_AT, true, "seed");
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain("v2-sys-ledger");
    expect(panel1).toContain("v2-lg-cover");
    expect(panel1).not.toContain("v2-sys-brief");
    expect(panel1).not.toContain("v2-sys-grid");
    expect(panel1).toContain("<th></th><th>البند</th><th>القيمة</th>");
    const idxBadges = (panel1.match(/class="v2-lg-idx"/g) ?? []).length;
    expect(idxBadges).toBe(7);
    expect(panel1).not.toContain("الإجمالي");
    expect(panel1).toContain(
      `<tr class="v2-lg-footnote"><td colspan="3">داخلي — للاستخدام التنفيذي</td></tr>`,
    );
    // Hero kept verbatim (title + lockup), kicker/badge dropped (classification
    // now lives in the table footnote, not a repeated badge).
    expect(panel1).toContain("v2-cover-title");
    expect(panel1).toContain("v2-cover-lockup-period");
    expect(panel1).not.toContain("v2-cover-kicker");
    expect(panel1).not.toContain("v2-cover-badge");
  });

  it("(c) Briefing slot: lede is the population total (SCOPE, not a finding), no arc, 3-chip support strip, NO rank list", () => {
    const model = twoPortModel();
    const html = coverSlide(model, GENERATED_AT, true, "seed");
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain("v2-sys-brief");
    expect(panel2).toContain("v2-bf-cover");
    expect(panel2).toContain(`<div class="v2-bf-lede-figure gold">${fmtNum(model.population.total)}</div>`);
    expect(panel2).not.toContain("v2-bf-lede-arc"); // no arc — a different unit than the lede figure
    expect(panel2).toContain("v2-totals-band");
    expect(panel2).toContain(fmtNum(model.sample.total));
    expect(panel2).toContain(fmtPct(model.sample.coverage, 1));
    expect(panel2).toContain("داخلي");
    // The "scope, never findings" rule: nothing on the cover is rankable.
    expect(panel2).not.toContain("v2-bf-rank");
  });

  it("(d) Grid slot: 8 gridFieldCells (4x2), no metricMatrix, no gridPanel wrapper, no magnitude tint", () => {
    const model = twoPortModel();
    const html = coverSlide(model, GENERATED_AT, true, "seed");
    const panel3 = panelSlice(html, 3);
    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-cover");
    const cells = (panel3.match(/class="v2-gd-field-cell/g) ?? []).length;
    expect(cells).toBe(8);
    expect(panel3).not.toContain("metricMatrix");
    expect(panel3).not.toContain("<figure");
    expect(panel3).not.toContain("v2-gd-panel");
    expect(panel3).not.toContain("--w:"); // no magnitude tint
    expect(panel3).toContain(model.summary.periodId);
    expect(panel3).toContain(fmtNum(model.population.total));
  });

  it("(e) field conservation: all 4 meta fields + classification appear in EVERY slot, not just slot 0", () => {
    const model = twoPortModel();
    const html = coverSlide(model, GENERATED_AT, true, "seed");
    for (const idx of [0, 1, 2, 3] as const) {
      const panel = panelSlice(html, idx);
      expect(panel).toContain(model.summary.periodId); // فترة الدراسة
      expect(panel).toContain("28 يوليو 2026"); // تاريخ الإصدار
      expect(panel).toContain("الإدارة العامة لضمان الجودة والامتثال"); // الإدارة
      expect(panel).toContain("إدارة الرقابة والامتثال على المنافذ"); // القسم
      expect(panel).toContain("داخلي"); // classification
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// slide-sep-1/2/3 — sectionSeparatorSlide
// ═══════════════════════════════════════════════════════════════════════════
describe("slide-sep-1/2/3 fan-out — Ledger/Briefing/Grid (2026-07-28 fan-out plan §5)", () => {
  const EXPECTED_VARIANT0 =
    `<section class="slide v2 v2-sep-slide gold" id="slide-sep-1" data-title="مجتمع الفحص" data-section="section1" data-section-label="القسم 1 — مجتمع الفحص">\n` +
    `  <div class="slide-controls">\n` +
    `    <label class="slide-print-toggle" title="تضمين هذه الصفحة عند الطباعة">\n` +
    `    <input type="checkbox" checked/>\n` +
    `    <span class="slide-print-toggle-track"><span class="slide-print-toggle-thumb"></span></span>\n` +
    `  </label>\n` +
    `    \n` +
    `  </div>\n` +
    `  <div class="v2-rail" aria-hidden="true">\n` +
    `    <div class="v2-rail-title">التقرير التنفيذي لضمان جودة الأشعة</div>\n` +
    `    <div class="v2-rail-tab">المعجم</div><div class="v2-rail-tab active">مجتمع الفحص</div><div class="v2-rail-tab">نتائج فحص الجودة</div><div class="v2-rail-tab">التحاليل المتقدمة</div>\n` +
    `  </div>\n` +
    `  <div class="v2-sep-bg" aria-hidden="true"></div>\n` +
    `  <div class="v2-sep-pattern" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180"><rect x="1" y="23" width="10" height="10" rx="2" transform="rotate(54 6 28)" fill="#f4b400" fill-opacity="0.22"/><rect x="101" y="88" width="17" height="17" rx="2" transform="rotate(14 109.5 96.5)" fill="#f4b400" fill-opacity="0.22"/><rect x="98" y="23" width="26" height="26" rx="2" transform="rotate(71 111 36)" fill="#f4b400" fill-opacity="0.22"/><rect x="136" y="139" width="9" height="9" rx="2" transform="rotate(63 140.5 143.5)" fill="#f4b400" fill-opacity="0.22"/><rect x="223" y="81" width="28" height="28" rx="2" transform="rotate(69 237 95)" fill="#f4b400" fill-opacity="0.22"/><rect x="58" y="163" width="28" height="28" rx="2" transform="rotate(29 72 177)" fill="#f4b400" fill-opacity="0.22"/><rect x="123" y="40" width="32" height="32" rx="2" transform="rotate(40 139 56)" fill="#f4b400" fill-opacity="0.22"/><rect x="291" y="102" width="21" height="21" rx="2" transform="rotate(26 301.5 112.5)" fill="#f4b400" fill-opacity="0.22"/><rect x="51" y="113" width="11" height="11" rx="2" transform="rotate(60 56.5 118.5)" fill="#f4b400" fill-opacity="0.22"/><rect x="126" y="67" width="27" height="27" rx="2" transform="rotate(86 139.5 80.5)" fill="#f4b400" fill-opacity="0.22"/><rect x="211" y="107" width="18" height="18" rx="2" transform="rotate(74 220 116)" fill="#f4b400" fill-opacity="0.22"/><rect x="28" y="96" width="22" height="22" rx="2" transform="rotate(71 39 107)" fill="#f4b400" fill-opacity="0.22"/><rect x="78" y="148" width="16" height="16" rx="2" transform="rotate(57 86 156)" fill="#f4b400" fill-opacity="0.22"/><rect x="274" y="179" width="20" height="20" rx="2" transform="rotate(41 284 189)" fill="#f4b400" fill-opacity="0.22"/><rect x="19" y="11" width="13" height="13" rx="2" transform="rotate(9 25.5 17.5)" fill="#f4b400" fill-opacity="0.22"/><rect x="72" y="67" width="26" height="26" rx="2" transform="rotate(11 85 80)" fill="#f4b400" fill-opacity="0.22"/><rect x="274" y="21" width="16" height="16" rx="2" transform="rotate(49 282 29)" fill="#f4b400" fill-opacity="0.22"/><rect x="300" y="35" width="17" height="17" rx="2" transform="rotate(32 308.5 43.5)" fill="#f4b400" fill-opacity="0.22"/></svg></div>\n` +
    `  <svg class="v2-cover-band" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true">\n` +
    `    <defs>\n` +
    `      <pattern id="v2band-diag" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">\n` +
    `        <line x1="0" y1="0" x2="0" y2="26" stroke="var(--gold)" stroke-width="1" stroke-opacity="0.06"/>\n` +
    `      </pattern>\n` +
    `      <linearGradient id="v2band-fade" x1="0" y1="0" x2="0" y2="1">\n` +
    `        <stop offset="0" stop-color="var(--gold)" stop-opacity="0"/>\n` +
    `        <stop offset="1" stop-color="var(--gold)" stop-opacity="0.10"/>\n` +
    `      </linearGradient>\n` +
    `    </defs>\n` +
    `    <rect x="0" y="0" width="1200" height="400" fill="url(#v2band-diag)"/>\n` +
    `    <rect x="0" y="250" width="1200" height="150" fill="url(#v2band-fade)"/>\n` +
    `  </svg>\n` +
    `  <div class="slide-inner">\n` +
    `    <div class="v2-sep gold">\n` +
    `      <div class="v2-sep-watermark" aria-hidden="true">01</div>\n` +
    `      <div class="v2-sep-lockup">\n` +
    `        <span class="v2-sep-badge"><svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/></svg></span>\n` +
    `        <div class="v2-sep-eyebrow">القسم 1</div>\n` +
    `        <h2>مجتمع الفحص</h2>\n` +
    `        <div class="v2-sep-rule"></div>\n` +
    `        <p>التعريف بمجتمع الصور لهذا الشهر.</p>\n` +
    `      </div>\n` +
    `    </div>\n` +
    `  </div>\n` +
    `  <div class="v2-page-foot" dir="ltr">04 / 20</div>\n` +
    `</section>`;

  function sepOpts(overrides: Partial<Parameters<typeof sectionSeparatorSlide>[0]> = {}) {
    return {
      sectionNo: 1,
      sectionKey: "section1" as const,
      iconName: "layers",
      title: "مجتمع الفحص",
      blurb: "التعريف بمجتمع الصور لهذا الشهر.",
      tone: "gold",
      seedBase: "seed",
      num: 4,
      total: 20,
      variantPreview: false,
      ...overrides,
    };
  }

  it("(a) variant 0 (production) is byte-identical to before this task — regression guard", () => {
    const html = sectionSeparatorSlide(sepOpts());
    expect(html).toBe(EXPECTED_VARIANT0);
  });

  it("(b) Ledger slot: a ruled document opener — NO table, ordinal badge + eyebrow + title + hanging-label definition", () => {
    const html = sectionSeparatorSlide(sepOpts({ variantPreview: true }));
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain("v2-sys-ledger");
    expect(panel1).toContain("v2-lg-sep");
    expect(panel1).not.toContain("v2-sys-brief");
    expect(panel1).not.toContain("v2-sys-grid");
    expect(panel1).not.toContain("<table"); // deliberately no theatre-table
    expect(panel1).toContain('<span class="v2-lg-idx">1</span>'); // ledgerIdx(sectionNo-1) renders sectionNo
    expect(panel1).toContain("v2-lg-sep-eyebrow");
    expect(panel1).toContain("مجتمع الفحص"); // title
    expect(panel1).toContain("التعريف"); // hanging-label key
    expect(panel1).toContain("التعريف بمجتمع الصور لهذا الشهر."); // the blurb itself
    // slot-0 vocabulary dropped in every new slot, per the fan-out plan.
    expect(panel1).not.toContain("v2-sep-watermark");
    expect(panel1).not.toContain("v2-sep-badge");
  });

  it("(c) Briefing slot: just one briefingLede — figure=sectionNo, tone=gold for a gold-tone section, no support strip, no rank list", () => {
    const html = sectionSeparatorSlide(sepOpts({ variantPreview: true }));
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain("v2-sys-brief");
    expect(panel2).toContain("v2-bf-sep");
    expect(panel2).toContain('<div class="v2-bf-lede-figure gold">1</div>');
    expect(panel2).toContain("مجتمع الفحص"); // label = title
    expect(panel2).toContain("التعريف بمجتمع الصور لهذا الشهر."); // basis = blurb
    expect(panel2).not.toContain("v2-totals-band");
    expect(panel2).not.toContain("v2-bf-rank");
  });

  it("(d) THE TONE-MAPPING TRAP: tone=cyan (slide-sep-2) maps to Briefing tone BLUE, never emits v2-bf-lede-figure cyan", () => {
    const html = sectionSeparatorSlide(
      sepOpts({ sectionNo: 2, sectionKey: "section2", tone: "cyan", num: 11, total: 20, variantPreview: true }),
    );
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain('<div class="v2-bf-lede-figure blue">2</div>');
    expect(panel2).not.toContain("v2-bf-lede-figure cyan");
    expect(html).not.toContain("v2-bf-lede-figure cyan");
  });

  it("(e) tone=gold (slide-sep-1 and slide-sep-3) maps to Briefing tone gold, never blue/cyan", () => {
    const html1 = sectionSeparatorSlide(sepOpts({ sectionNo: 1, tone: "gold", variantPreview: true }));
    const html3 = sectionSeparatorSlide(
      sepOpts({ sectionNo: 3, sectionKey: "section3", tone: "gold", num: 18, total: 20, variantPreview: true }),
    );
    expect(panelSlice(html1, 2)).toContain('<div class="v2-bf-lede-figure gold">1</div>');
    expect(panelSlice(html3, 2)).toContain('<div class="v2-bf-lede-figure gold">3</div>');
    expect(html1).not.toContain("v2-bf-lede-figure cyan");
    expect(html1).not.toContain("v2-bf-lede-figure blue");
    expect(html3).not.toContain("v2-bf-lede-figure cyan");
    expect(html3).not.toContain("v2-bf-lede-figure blue");
  });

  it("(f) Grid slot: one full-width gridPanel wrapping gridFieldCells (section number + blurb as the wide cell)", () => {
    const html = sectionSeparatorSlide(sepOpts({ variantPreview: true }));
    const panel3 = panelSlice(html, 3);
    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-sep");
    expect(panel3).toContain("v2-gd-panel");
    expect(panel3).toContain("gold"); // gridPanel variant class for a gold-tone section
    const cells = (panel3.match(/class="v2-gd-field-cell/g) ?? []).length;
    expect(cells).toBe(2);
    expect(panel3).toContain('class="v2-gd-field-cell num"><span class="v2-gd-field-label">رقم القسم');
    expect(panel3).toContain('class="v2-gd-field-cell wide">');
    expect(panel3).toContain("التعريف بمجتمع الصور لهذا الشهر.");
    expect(panel3).not.toContain("metricMatrix");
    expect(panel3).not.toContain("<figure");
  });

  it("(g) no vertical-overflow risk check — section 3's blurb (the longest of the three) round-trips intact at the bumped Briefing figure size (CSS itself is verified live, not here)", () => {
    const s3Blurb =
      "قراءة أعمق للأرقام: علاقة حجم العمل بالدقة، ودقة كل مستوى فحص، وتوافق النتائج بين المصادر، وأثر التحديد وجودة الصورة على الدقة.";
    const html = sectionSeparatorSlide(
      sepOpts({ sectionNo: 3, sectionKey: "section3", tone: "gold", blurb: s3Blurb, num: 18, total: 20, variantPreview: true }),
    );
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain(s3Blurb);
    expect(panel2).toContain('<div class="v2-bf-lede-figure gold">3</div>');
  });
});
