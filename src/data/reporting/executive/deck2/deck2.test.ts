// src/data/reporting/executive/deck2/deck2.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveDeckV2 } from "./index";
import { buildReportModel } from "../model/reportModel";
import { monthInNumbersSlide, riskStagesSlide } from "./slides";
import { fmtNum } from "../primitives";
import { resetLabel, setLabel } from "../../../labels/labelsStore";

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

describe("buildExecutiveDeckV2 — production path (no opts)", () => {
  // Match the opening markup tag, not the bare class name — the CSS block
  // (added in Task 3) legitimately contains the literal substring
  // "v2-variant-stack"/"v2-variant-switcher" as selector text, always, in both
  // production and preview mode (CSS is static and unconditional; only the
  // switcher's DOM markup and client script are gated on variantPreview). A
  // bare substring check would false-positive on that CSS text alone.
  it("never emits variant-switcher DOM markup when opts is omitted", () => {
    const html = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain('<div class="v2-variant-stack"');
    expect(html).not.toContain('<div class="v2-variant-switcher"');
    expect(html).not.toContain("__deck-style-choices");
  });

  it("never emits variant-switcher DOM markup when variantPreview is explicitly false", () => {
    const html = buildExecutiveDeckV2(
      input([popRow(), popRow({ xrayImageId: "XR-2" })]),
      {},
      { variantPreview: false },
    );
    expect(html).not.toContain('<div class="v2-variant-stack"');
    expect(html).not.toContain("__deck-style-choices");
  });

  it("produces byte-identical output for the same input regardless of the opts param shape", () => {
    const fixture = input([popRow(), popRow({ xrayImageId: "XR-2" })]);
    const a = buildExecutiveDeckV2(fixture);
    const b = buildExecutiveDeckV2(fixture, {}, { variantPreview: false });
    expect(a).toBe(b);
  });

  it("renders the source-revisions footer when the input carries revisions (B2)", () => {
    const fixture = {
      ...input([popRow()]),
      sourceRevisions: { "population.final.json": 7, "sample.master.json": 3 },
    };
    const html = buildExecutiveDeckV2(fixture);
    expect(html).toContain("population.final.json");
    expect(html).toContain("مراجعة 7");
    expect(html).toContain("مراجعة 3");
  });

  it("does not render artificial blank or ghost table rows", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).not.toContain('class="v2-ghost"');
    expect(html).not.toContain('class="v2-blank"');
  });

  it("includes an accessible full-screen presentation control", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain('id="deck-fullscreen-button"');
    expect(html).toContain('aria-label="ملء الشاشة"');
    expect(html).toContain("root.requestFullscreen || root.webkitRequestFullscreen");
    expect(html).toContain("button.hidden = true");
    expect(html).toContain("document.addEventListener('fullscreenchange', sync)");
    expect(html).toContain("document.addEventListener('fullscreenerror', disable)");
    expect(html).toContain("aria-pressed=\"false\"");
    expect(html).toMatch(/@media print\{[\s\S]*?\.btn-fullscreen\{display:none!important;\}/);
  });

  it("replaces the fullscreen scroll-stack with single-slide presentation CSS", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain("body.deck-fullscreen .slide{display:none;margin:0;}");
    expect(html).toContain("body.deck-fullscreen .slide.deck-slide-active{");
    expect(html).toContain(".btn-slide-nav,.deck-slide-counter{display:none;}");
    expect(html).toContain(".btn-fullscreen-icon-compress{display:none;}");
    expect(html).toMatch(
      /@media print\{[\s\S]*?\.btn-slide-nav,\.deck-slide-counter\{display:none!important;\}/,
    );
  });

  it("uses the configurable Arabic labels for the full-screen control", () => {
    setLabel("exec_deck_fullscreen_enter", "عرض موسّع");
    setLabel("exec_deck_fullscreen_exit", "إنهاء العرض الموسّع");
    try {
      const html = buildExecutiveDeckV2(input([popRow()]));
      expect(html).toContain('aria-label="عرض موسّع"');
      expect(html).toContain('data-exit-label="إنهاء العرض الموسّع"');
    } finally {
      resetLabel("exec_deck_fullscreen_enter");
      resetLabel("exec_deck_fullscreen_exit");
    }
  });

  it("uses an icon-only expand/compress fullscreen button instead of a text label", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain('class="btn-fullscreen-icon btn-fullscreen-icon-expand"');
    expect(html).toContain('class="btn-fullscreen-icon btn-fullscreen-icon-compress"');
    expect(html).not.toContain(">ملء الشاشة</button>");
  });

  it("renders single-slide presentation navigation elements and script", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain('id="deck-slide-prev"');
    expect(html).toContain('id="deck-slide-next"');
    expect(html).toContain('id="deck-slide-counter"');
    expect(html).toContain("var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'))");
    expect(html).toContain("classList.toggle('deck-slide-active'");
    expect(html).toContain("document.addEventListener('keydown'");
    expect(html).toContain("document.addEventListener('mousemove'");
    expect(html).toContain("e.key === 'ArrowLeft'");
    expect(html).toContain("e.key === 'ArrowRight'");
  });

  it("renders the slide counter with dir=\"ltr\" so the N / M numerals don't reverse in this RTL report", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain('id="deck-slide-counter" dir="ltr"');
  });

  it("uses the configurable Arabic labels for the slide prev/next controls", () => {
    setLabel("exec_deck_slideshow_prev", "الشريحة السابقة (مخصص)");
    setLabel("exec_deck_slideshow_next", "الشريحة التالية (مخصص)");
    try {
      const html = buildExecutiveDeckV2(input([popRow()]));
      expect(html).toContain('aria-label="الشريحة السابقة (مخصص)"');
      expect(html).toContain('aria-label="الشريحة التالية (مخصص)"');
    } finally {
      resetLabel("exec_deck_slideshow_prev");
      resetLabel("exec_deck_slideshow_next");
    }
  });

  it("does not force-scroll on initial page load, only after a real fullscreen session ends", () => {
    // everActivated guard: sync() runs once unconditionally at script init,
    // before the user has ever entered fullscreen. Without the guard, that
    // initial call fell into the "just exited" branch and scrolled to slide 0.
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain("var everActivated = false;");
    expect(html).toContain("everActivated = true;");
    expect(html).toMatch(
      /if \(everActivated\) \{\s*var el = slides\[activeIndex\];\s*if \(el && el\.scrollIntoView\) el\.scrollIntoView\(\{ block: 'start' \}\);\s*\}/,
    );
  });

  it("excludes per-slide controls (e.g. the print-include toggle) from the click-to-advance handler", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain(
      "e.target.closest('.btn-slide-nav, .deck-slide-counter, #deck-fullscreen-button, .slide-controls')",
    );
  });

  it("omits the footer entirely when no revisions are supplied", () => {
    // Match markup, not the bare substring — SOURCE_REVISIONS_CSS always ships
    // the `.srev-file` selector text (same false-positive noted above for the
    // variant-stack CSS).
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).not.toContain('<span class="srev-file"');
  });
});

describe("buildExecutiveDeckV2 — preview mode", () => {
  it("emits exactly one variant-stack per slide with 4 panels each, and DECK_VARIANT_SCRIPT", () => {
    const html = buildExecutiveDeckV2(
      input([popRow(), popRow({ xrayImageId: "XR-2" })]),
      {},
      { variantPreview: true },
    );
    // Match the opening tag, not the bare class name — the CSS block (added in
    // Task 3) also contains the literal substring "v2-variant-stack" as a
    // selector, which would otherwise throw off a plain substring count.
    const stackOpens = [...html.matchAll(/<div class="v2-variant-stack"/g)];
    const panelOpens = [...html.matchAll(/<div class="v2-variant-panel(?: active)?" data-variant-index="\d"/g)];
    const slideSections = [...html.matchAll(/<section class="slide v2/g)];
    expect(stackOpens.length).toBeGreaterThan(0);
    expect(stackOpens.length).toBe(slideSections.length);
    expect(panelOpens.length).toBe(stackOpens.length * 4);
    expect(html).toContain("__deck-style-choices");
  });
});

describe("visual overhaul — new slides & structures", () => {
  it("hides the مؤشرات الشهر slide from the generated deck (owner request 2026-07-20)", () => {
    // SHOW_MONTH_NUMBERS_SLIDE in slides.ts gates this off — the slide is
    // dormant, not deleted. This locks in the hidden state so a future edit
    // doesn't silently flip it back on.
    const html = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain('id="slide-month-numbers"');
    // Match the rendered heading/TOC tags, not the bare Arabic phrase — the
    // CSS's own section-header comment (theme.ts, same convention every other
    // deck2 section comment already uses) legitimately contains this string
    // too, and a plain substring check would false-positive on that alone.
    expect(html).not.toContain('data-title="مؤشرات الشهر"');
    expect(html).not.toContain(">مؤشرات الشهر<");
    // the old standalone ports-overview page stays absorbed/removed regardless
    expect(html).not.toContain('id="slide-port-overview"');
  });

  it("monthInNumbersSlide still renders correctly when called directly (dormant, not broken)", () => {
    // Exercises the hidden slide in isolation so its code stays covered while
    // SHOW_MONTH_NUMBERS_SLIDE is false — same content assertions the merged
    // KPI-dashboard + top-ports-table design had when it was live.
    const model = buildReportModel(
      input([
        popRow({ portName: "ميناء أ" }),
        popRow({ xrayImageId: "XR-2", portName: "ميناء ب" }),
      ]),
    );
    const html = monthInNumbersSlide(model, 3, 20, false);
    expect(html).toContain('id="slide-month-numbers"');
    expect(html).toContain("مؤشرات الشهر");
    expect(html).not.toContain("الشهر في أرقام");
    expect(html).toContain("v2-num-hero-value");
    // raw population/sample tiles (3) + the one reviewer-accuracy tile, grouped separately
    const tiles = (html.match(/class="v2-num-tile /g) ?? []).length;
    expect(tiles).toBe(4);
    // the disagreement-with-reviewer tile was dropped per owner feedback
    expect(html).not.toContain("صور الاختلاف مع المراجع");
    expect(html).toContain("أعلى");
    expect(html).toContain("v2-port-col");
  });

  it("renders the closing provenance slide, elevating source revisions into a designed block", () => {
    const withRev = {
      ...input([popRow()]),
      sourceRevisions: { "population.final.json": 7, "sample.master.json": 3 },
    };
    const html = buildExecutiveDeckV2(withRev);
    expect(html).toContain('id="slide-closing"');
    // Match the markup tag, not the bare class — the CSS block ships the
    // `.v2-prov-item` selector text unconditionally (same false-positive as the
    // variant-stack CSS check above).
    expect(html).toContain('<div class="v2-prov-item"');
    expect(html).toContain("population.final.json");
    expect(html).toContain("مراجعة 7");
    // graceful empty state when no revisions
    const html2 = buildExecutiveDeckV2(input([popRow()]));
    expect(html2).toContain('id="slide-closing"');
    expect(html2).toContain('<div class="v2-prov-empty"');
    expect(html2).not.toContain('<div class="v2-prov-item"');
  });

  it("section separators are a pure title card — number, name, تعريف, nothing else (2026-07-25)", () => {
    // The results funnel and the v2-sep-extra/v2-sep-stat side column were
    // removed per the owner's request: a separator should carry no figures,
    // only the section identity and its one-sentence definition.
    const html = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain("v2-sep-extra");
    expect(html).not.toContain("v2-sep-stat");
    expect(html).not.toContain("v2-sep-takeaway");
    expect(html).toContain("v2-sep-lockup");
    expect(html).toContain("v2-sep-watermark");
  });

  it("paints in-cell proportional data bars in the port tables (background only)", () => {
    const html = buildExecutiveDeckV2(
      input([
        popRow({ portName: "ميناء أ" }),
        popRow({ xrayImageId: "XR-2", portName: "ميناء ب" }),
      ]),
    );
    expect(html).toContain("v2-bar-cell");
    expect(html).toContain("--w:");
  });

  it("renders four tone-coded TOC cards each with a key figure (مؤشرات الشهر's card is hidden along with its slide)", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    const cards = (html.match(/class="v2-toc-card /g) ?? []).length;
    // المعجم + القسم 1 + القسم 2 + القسم 3 (التحاليل المتقدمة, added 2026-07-25).
    // The count tracks sections that actually render pages — a section whose
    // builder list is empty contributes no card, which is what kept this at 3
    // while section 3 was still scaffolding.
    expect(cards).toBe(4);
    expect(html).toContain("v2-toc-figure");
  });
});

describe("stage×port grid slides", () => {
  it("renders both new slide titles and the الإجمالي totals row in production output", () => {
    const html = buildExecutiveDeckV2(
      input([
        popRow({ stage: "المستوى الأول", portName: "ميناء أ" }),
        popRow({ xrayImageId: "XR-2", stage: "المستوى الأول", portName: "ميناء ب", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه" }),
      ]),
    );
    expect(html).toContain("مجتمع صور الفحص حسب المستوى والمنفذ");
    expect(html).toContain("عيّنة الفحص المسحوبة حسب المستوى والمنفذ");
    expect(html).toContain('id="slide-stage-port-population"');
    expect(html).toContain('id="slide-stage-port-sample"');
  });

  it("each stage card's totals row shows the pinned stage population alongside the summed سليمة/اشتباه", () => {
    const html = buildExecutiveDeckV2(
      input([
        popRow({ stage: "المستوى الأول", portName: "ميناء أ", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
        popRow({ xrayImageId: "XR-2", stage: "المستوى الأول", portName: "ميناء ب", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه" }),
      ]),
    );
    // This fixture's input() always has sample: null, forcing
    // calculateExecutiveKPIs's fallback branch (executiveReportData.ts
    // ~line 393), where stage.population IS a fresh count of model.rows —
    // so it equals 2 here. Don't read this as "totals always equal the port
    // sum": stagePortPopulationCard pins الإجمالي to stage.population
    // specifically because that does NOT hold in the production branch
    // (sample.stageAllocations present) — see the design spec's consistency
    // caveat and Task 1's stagePortStats.test.ts production-branch test.
    const stage1Card = html.split('id="slide-stage-port-population"')[1].split("</section>")[0];
    expect(stage1Card).toContain("<td>الإجمالي</td><td>1</td><td>1</td><td>2</td>");
  });
});

describe("closing slide — data-source attribution + embedded Arabic font", () => {
  it("shows the risk-agency base source with the row count, and BI as absent when never provided", () => {
    // Default popRow has biEnrichmentStatus "BI Not Provided" and biMatched false.
    const html = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).toContain("بيانات وكالة المخاطر");
    expect(html).toContain("المصدر الأساسي");
    expect(html).toContain("بيانات ذكاء الأعمال");
    expect(html).toContain("غير مُقدَّم هذا الشهر");
    expect(html).toContain('<div class="v2-src-card off"');
  });

  it("shows BI as provided with the enriched-row count when the processor matched rows", () => {
    const html = buildExecutiveDeckV2(
      input([
        popRow({ biEnrichmentStatus: "BI Matched", biMatched: true }),
        popRow({ xrayImageId: "XR-2" }),
      ]),
    );
    expect(html).toContain('<div class="v2-src-card blue"');
    expect(html).toContain("أثرى 1 صورة بالمطابقة");
    expect(html).not.toContain("غير مُقدَّم هذا الشهر");
  });

  it("embeds the IBM Plex Sans Arabic @font-face (base64 woff2) in the report HTML", () => {
    const html = buildExecutiveDeckV2(input([popRow()]));
    expect(html).toContain("@font-face");
    expect(html).toContain('font-family:"IBM Plex Sans Arabic"');
    expect(html).toContain("base64");
    expect(html).toContain('format("woff2")');
  });

  it("renders a deterministic seeded cover mesh SVG on the cover slide", () => {
    const a = buildExecutiveDeckV2(input([popRow()]));
    const b = buildExecutiveDeckV2(input([popRow()]));
    expect(a).toContain('class="v2-cover-mesh"');
    // Same month key → byte-identical deck output (mesh + patterns are seeded).
    expect(a).toBe(b);
  });
});

describe("riskStagesSlide — variant 2/4: compare-bars + exact-figures table (2026-07-25)", () => {
  it("variant 0 (production / variantPreview=false) never renders the new compare-bars or table markup", () => {
    const model = buildReportModel(
      input([popRow({ stage: "المستوى الأول" }), popRow({ xrayImageId: "XR-2", stage: "المستوى الثالث" })]),
    );
    const html = riskStagesSlide(model, 5, 20, false);
    expect(html).not.toContain("v2-cbar");
    expect(html).not.toContain("v2-level-table-card");
    // variant 0's own markup still renders untouched
    expect(html).toContain("v2-risk-tile-grid");
    expect(html).toContain("v2-prop-bar");
  });

  it("preview mode's slot 2 (data-variant-index=\"1\") renders the compare-bars + exact-figures table with the model's real per-level and total figures", () => {
    const model = buildReportModel(
      input([popRow({ stage: "المستوى الأول" }), popRow({ xrayImageId: "XR-2", stage: "المستوى الثالث" })]),
    );
    const html = riskStagesSlide(model, 5, 20, true);

    const panels = [...html.matchAll(/<div class="v2-variant-panel(?: active)?" data-variant-index="\d"/g)];
    expect(panels.length).toBe(4);

    // Isolate panel 1's HTML (between its own opening tag and the next panel's).
    const start = html.indexOf('data-variant-index="1"');
    const end = html.indexOf('data-variant-index="2"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const panel1 = html.slice(start, end);

    expect(panel1).toContain('<div class="v2-cbar">');
    expect(panel1).toContain('<div class="v2-level-table-card">');
    expect((panel1.match(/class="v2-cbar-row"/g) ?? []).length).toBe(model.population.byStage.length);

    // Every stage's real population/sample figures must appear in the table.
    model.population.byStage.forEach((stage) => {
      expect(panel1).toContain(fmtNum(stage.population));
      expect(panel1).toContain(fmtNum(stage.sampleSize));
    });

    // The totals row must use the exact same totals variant 0's bottom band renders.
    expect(panel1).toContain(fmtNum(model.population.total));
    expect(panel1).toContain(fmtNum(model.sample.total));

    // Variant 0's own panel (index 0) must be untouched — still has the tiles, not the table.
    const panel0Start = html.indexOf('data-variant-index="0"');
    const panel0 = html.slice(panel0Start, start);
    expect(panel0).toContain("v2-risk-tile-grid");
    expect(panel0).not.toContain("v2-level-table-card");
  });
});

describe("style choices — production selection + backward compatibility (2026-07-25)", () => {
  it("with no styleChoices opt, output is byte-identical to today (regression guard)", () => {
    const a = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    const b = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]), {}, {});
    expect(a).toBe(b);
  });

  it("with styleChoices selecting slot 1 for slide-risk-stages, production output renders variant 1's markup instead of variant 0's", () => {
    const fixture = input([
      popRow({ stage: "المستوى الأول" }),
      popRow({ xrayImageId: "XR-2", stage: "المستوى الثالث" }),
    ]);
    const defaultHtml = buildExecutiveDeckV2(fixture);
    const customHtml = buildExecutiveDeckV2(fixture, {}, { styleChoices: { "slide-risk-stages": 1 } });

    // NOTE: the deck's static CSS (theme.ts) always defines .v2-cbar/.v2-level-table-card/
    // .v2-risk-tile-grid rules regardless of which variant is selected — all 4 variants' CSS
    // ships in every report, only the markup differs — so assertions below match the HTML
    // *markup* tag (`<div class="...">`), not a bare class-name substring that would also
    // match the always-present CSS text and defeat the point of these checks.

    // Variant 0 (today's tiles + proportion bar) markup is present by default...
    expect(defaultHtml).toContain('<div class="v2-risk-tile-grid">');
    expect(defaultHtml).not.toContain('<div class="v2-cbar">');
    expect(defaultHtml).not.toContain('<div class="v2-level-table-card">');

    // ...but with the style choice applied, the SAME slide now renders variant 1's markup instead.
    expect(customHtml).not.toContain('<div class="v2-risk-tile-grid">');
    expect(customHtml).toContain('<div class="v2-cbar">');
    expect(customHtml).toContain('<div class="v2-level-table-card">');

    // Every other slide is unaffected by a choice scoped to slide-risk-stages only.
    expect(customHtml).toContain('class="v2-toc-card ');
  });

  it("an out-of-range or unknown slide id in styleChoices is ignored (falls back to variant 0), never throws", () => {
    const fixture = input([popRow()]);
    expect(() =>
      buildExecutiveDeckV2(fixture, {}, { styleChoices: { "slide-risk-stages": 99, "no-such-slide": 2 } }),
    ).not.toThrow();
    const html = buildExecutiveDeckV2(fixture, {}, { styleChoices: { "slide-risk-stages": 99 } });
    expect(html).toContain('<div class="v2-risk-tile-grid">'); // fell back to variant 0, not a crash or an out-of-bounds undefined render
  });

  it("preview mode: the variant-switcher label matches the pre-selected panel (regression — the label used to be hardcoded '1 / 4' regardless of the saved choice)", () => {
    const fixture = input([popRow(), popRow({ xrayImageId: "XR-2" })]);

    // No saved choice → panel 0 is pre-selected → label reads "1 / 4".
    const defaultHtml = buildExecutiveDeckV2(fixture, {}, { variantPreview: true });
    const defaultSwitcherStart = defaultHtml.indexOf('data-for="slide-risk-stages"');
    expect(defaultSwitcherStart).toBeGreaterThan(-1);
    expect(defaultHtml.slice(defaultSwitcherStart, defaultSwitcherStart + 300)).toContain(
      '<span class="v2-variant-label">1 / 4</span>',
    );

    // Saved choice selects slot 2 (0-based) → panel 2 is pre-selected → label must read "3 / 4", not "1 / 4".
    const customHtml = buildExecutiveDeckV2(fixture, {}, {
      variantPreview: true,
      styleChoices: { "slide-risk-stages": 2 },
    });
    const customSwitcherStart = customHtml.indexOf('data-for="slide-risk-stages"');
    expect(customSwitcherStart).toBeGreaterThan(-1);
    expect(customHtml.slice(customSwitcherStart, customSwitcherStart + 300)).toContain(
      '<span class="v2-variant-label">3 / 4</span>',
    );
    // Also confirm the matching panel stack was actually pre-selected (not just the label).
    expect(customHtml).toContain('data-slide-id="slide-risk-stages" data-active-index="2"');
  });
});
