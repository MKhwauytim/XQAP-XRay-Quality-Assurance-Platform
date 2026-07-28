// src/data/reporting/executive/deck2/deck2.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveDeckV2 } from "./index";
import { buildReportModel } from "../model/reportModel";
import { monthInNumbersSlide, portPopulationSlideBuilders, riskStagesSlide } from "./slides";
import { briefingRankPlan, BRIEFING_RANK_BUDGET_PX } from "./slideKit";
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

describe("slide-risk-stages fan-out — Ledger/Briefing/Grid (2026-07-25 fan-out plan §5 RECONCILIATION)", () => {
  it("variant 0 (production / variantPreview=false) never renders Ledger/Briefing/Grid markup", () => {
    const model = buildReportModel(
      input([popRow({ stage: "المستوى الأول" }), popRow({ xrayImageId: "XR-2", stage: "المستوى الثالث" })]),
    );
    const html = riskStagesSlide(model, 5, 20, false);
    expect(html).not.toContain("v2-lg-risk-stages");
    expect(html).not.toContain("v2-bf-risk-stages");
    expect(html).not.toContain("v2-gd-risk-stages");
    expect(html).not.toContain("v2-level-table-card");
    // variant 0's own markup still renders untouched
    expect(html).toContain("v2-risk-tile-grid");
    expect(html).toContain("v2-prop-bar");
  });

  it('Ledger slot (data-variant-index="1") has no chart markup, adds the «ما يقيسه» column, and carries the two-basis footnote row', () => {
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

    // stageCompareBars is gone — this slot is levelFiguresTable alone (no chart).
    expect(panel1).not.toContain("v2-cbar");
    expect(panel1).toContain('<div class="v2-level-table-card">');

    // New «ما يقيسه» column, sourced from RISK_LEVELS[i].measures.
    expect(panel1).toContain("<th>ما يقيسه</th>");
    expect(panel1).toContain("انفراد الفحص بالاشتباه دون مؤشرات أخرى.");
    expect(panel1).toContain("ما يلتقطه محرك المخاطر ولا يلتقطه الفحص.");

    // New tfoot footnote row: colspan across all 8 columns, two-basis caveat
    // worded to agree with LEVEL_DRAW_WEIGHTS's own doc comment.
    expect(panel1).toContain('<tr><td colspan="8" class="v2-lg-footnote">');
    expect(panel1).toContain("الأساسان مختلفان ولا يجمعان إلى 100%");

    // Every stage's real population/sample figures must still appear in the table.
    model.population.byStage.forEach((stage) => {
      expect(panel1).toContain(fmtNum(stage.population));
      expect(panel1).toContain(fmtNum(stage.sampleSize));
    });
    expect(panel1).toContain(fmtNum(model.population.total));
    expect(panel1).toContain(fmtNum(model.sample.total));

    // Variant 0's own panel (index 0) must be untouched — still has the tiles, not the table.
    const panel0Start = html.indexOf('data-variant-index="0"');
    const panel0 = html.slice(panel0Start, start);
    expect(panel0).toContain("v2-risk-tile-grid");
    expect(panel0).not.toContain("v2-level-table-card");
  });

  it('Briefing slot (data-variant-index="2") ranks the 4 levels in LEVEL ORDER — never sorted by population size — each with its own STAGE_TONES color', () => {
    // Population by level: الأول=1 (smallest), الثاني=4 (largest), الثالث=2, الرابع=3.
    // A magnitude-sorted rank list would put الثاني first; level order must not.
    const model = buildReportModel(
      input([
        popRow({ xrayImageId: "XR-1", stage: "المستوى الأول" }),
        popRow({ xrayImageId: "XR-2", stage: "المستوى الثاني" }),
        popRow({ xrayImageId: "XR-3", stage: "المستوى الثاني" }),
        popRow({ xrayImageId: "XR-4", stage: "المستوى الثاني" }),
        popRow({ xrayImageId: "XR-5", stage: "المستوى الثاني" }),
        popRow({ xrayImageId: "XR-6", stage: "المستوى الثالث" }),
        popRow({ xrayImageId: "XR-7", stage: "المستوى الثالث" }),
        popRow({ xrayImageId: "XR-8", stage: "المستوى الرابع" }),
        popRow({ xrayImageId: "XR-9", stage: "المستوى الرابع" }),
        popRow({ xrayImageId: "XR-10", stage: "المستوى الرابع" }),
      ]),
    );
    const html = riskStagesSlide(model, 5, 20, true);
    const start = html.indexOf('data-variant-index="2"');
    const end = html.indexOf('data-variant-index="3"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const panel2 = html.slice(start, end);

    expect((panel2.match(/class="v2-bf-rank-row"/g) ?? []).length).toBe(4);
    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(["المستوى الأول", "المستوى الثاني", "المستوى الثالث", "المستوى الرابع"]);

    const tones = [...panel2.matchAll(/<span class="v2-bf-rank-num (\w+)">/g)].map((m) => m[1]);
    expect(tones).toEqual(["gold", "blue", "green", "coral"]);

    // Lede carries sample coverage with a microArc, not a level count.
    expect(panel2).toContain('<div class="v2-bf-lede-arc">');
    expect(panel2).toContain("تغطية العيّنة");
  });

  it('Grid slot (data-variant-index="3") is one metricMatrix/gridPanel and never encodes وزن العينة', () => {
    const model = buildReportModel(
      input([popRow({ stage: "المستوى الأول" }), popRow({ xrayImageId: "XR-2", stage: "المستوى الثالث" })]),
    );
    const html = riskStagesSlide(model, 5, 20, true);
    const start = html.indexOf('data-variant-index="3"');
    expect(start).toBeGreaterThan(-1);
    const panel3 = html.slice(start);

    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-risk-stages");
    expect(panel3).toContain('<div class="v2-gd-panel">');
    expect(panel3).toContain("<figure");
    expect(panel3).toContain('<table dir="rtl"');
    expect(panel3).toContain("المستوى الأول");
    expect(panel3).toContain("المستوى الثالث");

    // وزن العينة is a two-basis config figure metricMatrix has no annotation
    // affordance to caveat — deliberately excluded from the Grid columns.
    expect(panel3).not.toContain("وزن العينة");
  });
});

describe("levelFiguresTable byte-identity characterization — SUPERSEDED 2026-07-25 (fan-out plan §5)", () => {
  // This pin originally proved the ledgerTableCard EXTRACTION (deck2-design-
  // systems Task 1) changed nothing about the page's then-shipped output. The
  // fan-out plan's B1 pass deliberately changes that output on purpose
  // (stageCompareBars dropped from Ledger, «ما يقيسه» column + two-basis
  // footnote row added — see levelFiguresTable's doc comment in slides.ts and
  // this date's edit log) — this is NOT a regression the old pin caught; the
  // expectation below is the NEW post-fan-out golden output, re-captured from
  // the actual render. The "no v2-cbar, has the new column + footnote" test in
  // the describe block above carries this test's original *intent* forward
  // (verifiably-correct shape rather than a frozen byte string); this test
  // still exists so the shape stays pinned once more, exactly like every
  // other characterization test in this file.
  const EXPECTED_PANEL1 =
    `data-variant-index="1"><div class="v2-sys-ledger v2-lg-risk-stages"><div class="v2-risk-layout">\n` +
    `    <div class="v2-level-table-card">\n` +
    `    <table class="deck-table">\n` +
    `      <thead><tr>\n` +
    `        <th></th><th>المستوى</th><th>ما يقيسه</th><th>وزن العينة</th><th>من المجتمع</th>\n` +
    `        <th>صورة</th><th>العيّنة</th><th>تغطية العيّنة</th>\n` +
    `      </tr></thead>\n` +
    `      <tbody><tr>\n` +
    `        <td><span class="v2-level-row-num gold">1</span></td>\n` +
    `        <td>المستوى الأول</td>\n` +
    `        <td>انفراد الفحص بالاشتباه دون مؤشرات أخرى.</td>\n` +
    `        <td>100%</td>\n` +
    `        <td>50%</td>\n` +
    `        <td>1</td>\n` +
    `        <td>0</td>\n` +
    `        <td>0.0%</td>\n` +
    `      </tr><tr>\n` +
    `        <td><span class="v2-level-row-num blue">2</span></td>\n` +
    `        <td>المستوى الثالث</td>\n` +
    `        <td>ما يلتقطه محرك المخاطر ولا يلتقطه الفحص.</td>\n` +
    `        <td>40%</td>\n` +
    `        <td>50%</td>\n` +
    `        <td>1</td>\n` +
    `        <td>0</td>\n` +
    `        <td>0.0%</td>\n` +
    `      </tr></tbody>\n` +
    `      <tfoot><tr>\n` +
    `        <td></td><td>الإجمالي</td><td></td><td>—</td><td>100%</td>\n` +
    `        <td>2</td><td>0</td><td>0.0%</td>\n` +
    `      </tr><tr><td colspan="8" class="v2-lg-footnote">وزن المستوى الأول نسبة من مجتمعه (حصر شامل)؛ وبقية الأوزان حصص من حصة العدد الثابت — الأساسان مختلفان ولا يجمعان إلى 100%</td></tr></tfoot>\n` +
    `    </table>\n` +
    `  </div>\n` +
    `  </div></div></div><div class="v2-variant-panel" `;

  it("slide-risk-stages variant-1 panel is byte-identical to the post-fan-out (2026-07-25) golden output", () => {
    const model = buildReportModel(
      input([popRow({ stage: "المستوى الأول" }), popRow({ xrayImageId: "XR-2", stage: "المستوى الثالث" })]),
    );
    const html = riskStagesSlide(model, 5, 20, true);
    const start = html.indexOf('data-variant-index="1"');
    const end = html.indexOf('data-variant-index="2"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const panel1 = html.slice(start, end);
    expect(panel1).toBe(EXPECTED_PANEL1);
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

    // NOTE: the deck's static CSS (theme.ts) always defines .v2-level-table-card/
    // .v2-risk-tile-grid rules regardless of which variant is selected — all 4 variants' CSS
    // ships in every report, only the markup differs — so assertions below match the HTML
    // *markup* tag (`<div class="...">`), not a bare class-name substring that would also
    // match the always-present CSS text and defeat the point of these checks.

    // Variant 0 (today's tiles + proportion bar) markup is present by default...
    expect(defaultHtml).toContain('<div class="v2-risk-tile-grid">');
    expect(defaultHtml).not.toContain('<div class="v2-level-table-card">');

    // ...but with the style choice applied, the SAME slide now renders variant 1's markup instead.
    expect(customHtml).not.toContain('<div class="v2-risk-tile-grid">');
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

describe("variant-choice family-key resolution (2026-07-25, deck2-design-systems fix)", () => {
  it("resolves a choice saved under a paginated slide's FAMILY key (no trailing page number) regardless of the exact page id being rendered", () => {
    // slide-port-population-N is the always-suffixed convention (page+1, starting at 1).
    const fixture = input([
      popRow({ portName: "ميناء أ" }),
      popRow({ xrayImageId: "XR-2", portName: "ميناء ب" }),
    ]);
    const html = buildExecutiveDeckV2(fixture, {}, {
      variantPreview: true,
      styleChoices: { "slide-port-population": 1 },
    });
    // The rendered page is "slide-port-population-1" (single page, 2 ports) — its
    // family key "slide-port-population" matches the saved choice, so panel 1
    // (not panel 0) should be the pre-selected active one for this slide.
    const start = html.indexOf('data-slide-id="slide-port-population-1"');
    expect(start).toBeGreaterThan(-1);
    const stackOpenTag = html.slice(start - 60, start + 120);
    expect(stackOpenTag).toContain('data-active-index="1"');
  });

  it("an exact per-page-id saved choice still wins over a family-key choice for that same page (backward compatibility)", () => {
    const fixture = input([popRow(), popRow({ xrayImageId: "XR-2" })]);
    const html = buildExecutiveDeckV2(fixture, {}, {
      variantPreview: true,
      styleChoices: { "slide-port-population": 1, "slide-port-population-1": 2 },
    });
    const start = html.indexOf('data-slide-id="slide-port-population-1"');
    const stackOpenTag = html.slice(start - 60, start + 120);
    expect(stackOpenTag).toContain('data-active-index="2"');
  });

  it("non-paginated slides are unaffected (family key equals the exact id, a no-op)", () => {
    const fixture = input([popRow()]);
    const html = buildExecutiveDeckV2(fixture, {}, {
      variantPreview: true,
      styleChoices: { "slide-cover": 2 },
    });
    const start = html.indexOf('data-slide-id="slide-cover"');
    const stackOpenTag = html.slice(start - 60, start + 120);
    expect(stackOpenTag).toContain('data-active-index="2"');
  });
});

describe("portPopulationSlideBuilders — Ledger/Briefing/Grid design systems (2026-07-25, deck2-design-systems Task 2)", () => {
  // Captured VERBATIM (2026-07-25, before any Task 2 code change) from
  // portPopulationSlideBuilders(model, false)[0](6, 20) for a 2-port (1 land,
  // 1 sea) fixture. This is the regression tripwire for this task: variant 0
  // (production) must never change while variants 1-3 are added alongside it.
  const EXPECTED_VARIANT0 =
    `<section class="slide v2" id="slide-port-population-1" data-title="مجتمع صور الفحص" data-section="section1" data-section-label="القسم 1 — مجتمع الفحص">\n` +
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
    `  <div class="slide-inner">\n` +
    `    <div class="slide-eyebrow">\n` +
    `      <span class="slide-eyebrow-icon"><svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M5 21V8l7-4 7 4v13"/><path d="M5 21h14"/><path d="M9 21v-6h6v6"/></svg></span>\n` +
    `      <span>القسم 1 — مجتمع الفحص</span>\n` +
    `    </div>\n` +
    `    <div class="slide-headline">مجتمع صور الفحص لشهر مايو 2026</div>\n` +
    `    <div class="slide-subhead">منهجية التصنيف: تُصنَّف الصورة اشتباهًا إذا كانت نتيجة المستوى الأول أو الثاني اشتباهًا، وفي غير ذلك تُصنَّف سليمة.</div>\n` +
    `    <div class="slide-body"><div class="v2-port-split"><div class="v2-port-col land">\n` +
    `    <div class="v2-port-col-head">\n` +
    `      <span class="v2-port-col-icon"><span style="display:inline-flex;transform:translate(2.1%,-8.5%)"><svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M2 16V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8"/><path d="M14 11h4l3 3v2h-2.2"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="16.8" cy="17.5" r="1.7"/><path d="M8.7 17.5h6.4"/><path d="M2 16h3.3"/></svg></span></span>\n` +
    `      <div><b>المنافذ البرية</b><span>1 منفذ · 1 صورة</span></div>\n` +
    `    </div>\n` +
    `    <table class="deck-table">\n` +
    `      <thead><tr><th>المنفذ</th><th>الصور</th><th>سليمة</th><th>اشتباه</th></tr></thead>\n` +
    `      <tbody><tr><td>منفذ أ</td><td class="v2-bar-cell green" style="--w:100.0%">1</td><td>1</td><td>0</td></tr><tr class="v2-fill-row" aria-hidden="true"><td colspan="4"></td></tr></tbody>\n` +
    `      <tfoot><tr><td>الإجمالي</td><td>1</td><td>1</td><td>0</td></tr></tfoot>\n` +
    `    </table>\n` +
    `  </div><div class="v2-port-col sea">\n` +
    `    <div class="v2-port-col-head">\n` +
    `      <span class="v2-port-col-icon"><svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M4 15l1.6 4.5h12.8L20 15l-8-2.6L4 15z"/><path d="M12 12.4V4"/><path d="M12 4l5.5 6.5H12"/></svg></span>\n` +
    `      <div><b>المنافذ البحرية</b><span>1 منفذ · 1 صورة</span></div>\n` +
    `    </div>\n` +
    `    <table class="deck-table">\n` +
    `      <thead><tr><th>المنفذ</th><th>الصور</th><th>سليمة</th><th>اشتباه</th></tr></thead>\n` +
    `      <tbody><tr><td>منفذ ب</td><td class="v2-bar-cell blue" style="--w:100.0%">1</td><td>0</td><td>1</td></tr><tr class="v2-fill-row" aria-hidden="true"><td colspan="4"></td></tr></tbody>\n` +
    `      <tfoot><tr><td>الإجمالي</td><td>1</td><td>0</td><td>1</td></tr></tfoot>\n` +
    `    </table>\n` +
    `  </div></div></div>\n` +
    `  </div>\n` +
    `  <div class="v2-page-foot" dir="ltr">06 / 20</div>\n` +
    `</section>`;

  function twoPortModel() {
    return buildReportModel(
      input([
        popRow({ portName: "منفذ أ", portType: "منفذ بري" }),
        popRow({ xrayImageId: "XR-2", portName: "منفذ ب", portType: "منفذ بحري", xrayLevelOneResult: "اشتباه" }),
      ]),
    );
  }

  it("(a) variant 0 (production) is byte-identical to before this task — regression guard", () => {
    const html = portPopulationSlideBuilders(twoPortModel(), false)[0](6, 20);
    expect(html).toBe(EXPECTED_VARIANT0);
  });

  it("(b) preview mode panel 1 contains v2-sys-ledger markup and NOT v2-sys-brief/v2-sys-grid", () => {
    const html = portPopulationSlideBuilders(twoPortModel(), true)[0](6, 20);
    const start = html.indexOf('data-variant-index="1"');
    const end = html.indexOf('data-variant-index="2"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const panel1 = html.slice(start, end);
    expect(panel1).toContain("v2-sys-ledger");
    expect(panel1).toContain("v2-lg-port-population");
    expect(panel1).not.toContain("v2-sys-brief");
    expect(panel1).not.toContain("v2-sys-grid");
    // Ordinal badge inside the first cell, not a new column.
    expect(panel1).toContain('<span class="v2-lg-idx">1</span>منفذ أ');
    expect(panel1).toContain('<span class="v2-lg-idx">1</span>منفذ ب');
    // Every port's real figures still appear (same data, different shell).
    expect(panel1).toContain(">1<"); // total/clean/suspicious counts

    const panel0Start = html.indexOf('data-variant-index="0"');
    const panel0 = html.slice(panel0Start, start);
    expect(panel0).toContain("v2-port-split");
    expect(panel0).not.toContain("v2-sys-ledger");
  });

  it("(c) preview mode panel 2 contains v2-sys-brief and the lede figure text for THIS page's leading port", () => {
    const html = portPopulationSlideBuilders(twoPortModel(), true)[0](6, 20);
    const start = html.indexOf('data-variant-index="2"');
    const end = html.indexOf('data-variant-index="3"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const panel2 = html.slice(start, end);
    expect(panel2).toContain("v2-sys-brief");
    expect(panel2).toContain("v2-bf-port-population");
    // Both ports have total=1, so land's "منفذ أ" wins the stable sort (first inserted).
    expect(panel2).toContain('<div class="v2-bf-lede-figure gold">1</div>');
    expect(panel2).toContain("أعلى منفذ: منفذ أ — 1 صورة");
    // Base tier (only 2 ports; nowhere near the compact-tier threshold) keeps the support strip.
    expect(panel2).toContain("v2-totals-band");
  });

  it("(d) preview mode panel 3 contains v2-sys-grid and a metricMatrix-produced figure/table", () => {
    const html = portPopulationSlideBuilders(twoPortModel(), true)[0](6, 20);
    const start = html.indexOf('data-variant-index="3"');
    expect(start).toBeGreaterThan(-1);
    const panel3 = html.slice(start);
    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-port-population");
    expect(panel3).toContain("<figure");
    expect(panel3).toContain('<table dir="rtl"');
    // Real port names appear as row labels in the screen-reader table.
    expect(panel3).toContain("منفذ أ");
    expect(panel3).toContain("منفذ ب");
  });

  it("(e) Briefing's support strip is unconditional (2026-07-25 design-ruling fix — it was previously and wrongly dropped on planPortPages' table-geometry compact signal, which has no bearing on Briefing's own budget) and 8 ports render in 2 columns at the comfortable tier", () => {
    // 8 land ports, 0 sea → maxCount=8, overflow=1 (≤ COMPRESS_OVERFLOW_MAX=3) → portTable()'s
    // OWN compact tier, 1 page — but Briefing no longer reads that signal at all.
    // briefingRankPlan(8): step3 (2 cols, comfortable 44px, cap 10) since 8 ≤ 10.
    const rows = Array.from({ length: 8 }, (_, i) =>
      popRow({ xrayImageId: `XR-${i}`, portName: `منفذ ${i}`, portType: "منفذ بري" }),
    );
    const model = buildReportModel(input(rows));
    const builders = portPopulationSlideBuilders(model, true);
    expect(builders).toHaveLength(1); // compact tier folds everything onto one page (slot 0's own tables)
    const html = builders[0](6, 20);
    const start = html.indexOf('data-variant-index="2"');
    const end = html.indexOf('data-variant-index="3"');
    const panel2 = html.slice(start, end);
    expect(panel2).toContain("v2-totals-band"); // unconditional now
    expect(panel2).toContain('class="v2-bf-rank t-comfortable"');
    expect((panel2.match(/class="v2-bf-rank-col"/g) ?? []).length).toBe(2);
    expect((panel2.match(/class="v2-bf-rank-row"/g) ?? []).length).toBe(8); // all 8, no fold
    expect(panel2).not.toContain('class="v2-bf-rank-row rest"');
  });

  it("(f) 2026-07-25 regression: a 14-port slice (the exact reported-bug scenario) renders ALL 14 ports individually, no silent drop, no fold row", () => {
    // 7 land + 7 sea = 14 combined — the previous implementation's bug capped
    // the combined rank list at rowsPerPage (7) and silently dropped the other 6.
    const rows = [
      ...Array.from({ length: 7 }, (_, i) =>
        popRow({ xrayImageId: `L-${i}`, portName: `بر ${i}`, portType: "منفذ بري" }),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        popRow({ xrayImageId: `S-${i}`, portName: `بحر ${i}`, portType: "منفذ بحري" }),
      ),
    ];
    const model = buildReportModel(input(rows));
    const builders = portPopulationSlideBuilders(model, true);
    const html = builders[0](6, 20);
    const start = html.indexOf('data-variant-index="2"');
    const end = html.indexOf('data-variant-index="3"');
    const panel2 = html.slice(start, end);
    // briefingRankPlan(14): densest step (2 cols, dense 30px, cap 14) — exactly full, no fold.
    expect(panel2).toContain('class="v2-bf-rank t-dense"');
    expect((panel2.match(/class="v2-bf-rank-row"/g) ?? []).length).toBe(14);
    expect(panel2).not.toContain('class="v2-bf-rank-row rest"');
    for (let i = 0; i < 7; i++) {
      expect(panel2).toContain(`بر ${i}`);
      expect(panel2).toContain(`بحر ${i}`);
    }
    // Basis chip states the "all shown" form, not the "folded" form.
    expect(panel2).toContain("جميع منافذ الصفحة");
  });

  it("(g) 2026-07-25: a 20-port slice folds the tail into one remainder row, and the completeness invariant holds — Σ(shown values) === the basis chip's stated total", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) =>
        popRow({ xrayImageId: `L-${i}`, portName: `بر ${i}`, portType: "منفذ بري" }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        popRow({ xrayImageId: `S-${i}`, portName: `بحر ${i}`, portType: "منفذ بحري" }),
      ),
    ];
    const model = buildReportModel(input(rows));
    const builders = portPopulationSlideBuilders(model, true);
    const html = builders[0](6, 20);
    const start = html.indexOf('data-variant-index="2"');
    const end = html.indexOf('data-variant-index="3"');
    const panel2 = html.slice(start, end);
    // briefingRankPlan(20): densest tier caps at 14 total slots → 13 named + 1 remainder.
    expect((panel2.match(/class="v2-bf-rank-row(?: rest)?"/g) ?? []).length).toBe(14);
    expect((panel2.match(/class="v2-bf-rank-row rest"/g) ?? []).length).toBe(1);
    expect(panel2).toContain("بقية المنافذ (7)"); // 20 - 13 named = 7 folded
    // Every rendered row's value (rank rows + the remainder row) is 1 image each,
    // so the total across all 20 real ports is 20 — same number the basis chip states.
    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">(\d+)<\/span>/g)].map((m) => Number(m[1]));
    const sumShown = values.reduce((s, v) => s + v, 0);
    expect(sumShown).toBe(20);
    expect(panel2).toContain("إجمالي 20 صورة");
    expect(panel2).toContain("أعلى 13 من");
  });

  it("(h) 2026-07-25: when the folded remainder's aggregate exceeds the single largest named port's total, its bar renders WIDER than rank #1's — not tied at a shared 100% cap", () => {
    // Same 20-port/7-folded shape as (g): every port has total=1, so
    // maxMag=1 but restTotal (7 folded ports) = 7 — the remainder
    // genuinely represents more images than any single named port.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) =>
        popRow({ xrayImageId: `L-${i}`, portName: `بر ${i}`, portType: "منفذ بري" }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        popRow({ xrayImageId: `S-${i}`, portName: `بحر ${i}`, portType: "منفذ بحري" }),
      ),
    ];
    const model = buildReportModel(input(rows));
    const builders = portPopulationSlideBuilders(model, true);
    const html = builders[0](6, 20);
    const start = html.indexOf('data-variant-index="2"');
    const end = html.indexOf('data-variant-index="3"');
    const panel2 = html.slice(start, end);
    const widths = [...panel2.matchAll(/class="v2-bf-rank-fill (?:gold|rest)" style="width:([\d.]+)%"/g)].map((m) =>
      Number(m[1]),
    );
    const rank1Width = widths[0];
    const restWidth = widths[widths.length - 1];
    // Rank #1 (a single port, total=1) must render narrower than 100% once
    // scaled against the remainder's larger aggregate (1/7 ≈ 14.3%) — the
    // bug this test guards against is rank #1 ALSO rendering at 100%
    // (which happens if named rows keep scaling against maxMag alone while
    // only the remainder is rescaled).
    expect(rank1Width).toBeCloseTo((1 / 7) * 100, 1);
    expect(restWidth).toBe(100);
    expect(restWidth).toBeGreaterThan(rank1Width);
  });
});

describe("P0 primitives — characterization: slide-port-population-1 Ledger/Briefing/Grid panels byte-identity (2026-07-25, deck2-fanout-remaining-pages-plan P0)", () => {
  // Captured VERBATIM (2026-07-25, before the P0 primitives-extraction refactor) from
  // portPopulationSlideBuilders(twoPortModel(), true)[0](6, 20) — panels 1 (Ledger), 2
  // (Briefing), 3 (Grid). This is the regression tripwire for the P0 refactor: reimplementing
  // ledgerPortTable/briefingPortRank/gridPortMatrix on top of the new shared slideKit
  // primitives (ledgerIdx/ledgerPortCard/briefingLede/briefingSupport/briefingRankList/
  // gridPanel) must not change a single byte of this already-shipped exemplar page.
  const EXPECTED_PANEL1_LEDGER =
    `data-variant-index="1"><div class="v2-sys-ledger v2-lg-port-population"><div class="v2-lg-split"><div class="v2-lg-port-card">
    <div class="v2-lg-table-card-title">المنافذ البرية</div>
    <table class="deck-table">
      <thead><tr><th>المنفذ</th><th>الصور</th><th>سليمة</th><th>اشتباه</th></tr></thead>
      <tbody><tr><td><span class="v2-lg-idx">1</span>منفذ أ</td><td class="v2-bar-cell green" style="--w:100.0%">1</td><td>1</td><td>0</td></tr></tbody>
      <tfoot><tr><td>الإجمالي</td><td>1</td><td>1</td><td>0</td></tr></tfoot>
    </table>
  </div><div class="v2-lg-port-card">
    <div class="v2-lg-table-card-title">المنافذ البحرية</div>
    <table class="deck-table">
      <thead><tr><th>المنفذ</th><th>الصور</th><th>سليمة</th><th>اشتباه</th></tr></thead>
      <tbody><tr><td><span class="v2-lg-idx">1</span>منفذ ب</td><td class="v2-bar-cell blue" style="--w:100.0%">1</td><td>0</td><td>1</td></tr></tbody>
      <tfoot><tr><td>الإجمالي</td><td>1</td><td>0</td><td>1</td></tr></tfoot>
    </table>
  </div></div></div></div><div class="v2-variant-panel" `;
  const EXPECTED_PANEL2_BRIEFING =
    `data-variant-index="2"><div class="v2-sys-brief v2-bf-port-population">
    <div class="v2-bf-lede">
      <div class="v2-bf-lede-figure gold">1</div>
      <div class="v2-bf-lede-label">أعلى منفذ: منفذ أ — 1 صورة</div>
      <div class="v2-bf-lede-basis">جميع منافذ الصفحة (منفذان) · إجمالي 2 صورة</div>
    </div>
    <div class="v2-totals-band">
        <div class="v2-totals-item"><span class="v2-totals-icon"><svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg></span><span><b>1</b><small>إجمالي الصور السليمة</small></span></div>
        <div class="v2-totals-item"><span class="v2-totals-icon"><svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4"/><path d="M12 17.5v.5"/></svg></span><span><b>1</b><small>إجمالي صور الاشتباه</small></span></div>
        <div class="v2-totals-item"><span class="v2-totals-icon"><svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/><circle cx="12" cy="18" r="1.2"/></svg></span><span><b>50.0%</b><small>نسبة الاشتباه للصفحة</small></span></div>
      </div>
    <div class="v2-bf-rank t-comfortable"><div class="v2-bf-rank-col"><div class="v2-bf-rank-row">
        <span class="v2-bf-rank-num gold">1</span>
        <span class="v2-bf-rank-label">منفذ أ</span>
        <span class="v2-bf-rank-track"><i class="v2-bf-rank-fill gold" style="width:100.0%"></i></span>
        <span class="v2-bf-rank-value">1</span>
        <span class="v2-bf-rank-secondary">اشتباه 0</span>
      </div><div class="v2-bf-rank-row">
        <span class="v2-bf-rank-num gold">2</span>
        <span class="v2-bf-rank-label">منفذ ب</span>
        <span class="v2-bf-rank-track"><i class="v2-bf-rank-fill gold" style="width:100.0%"></i></span>
        <span class="v2-bf-rank-value">1</span>
        <span class="v2-bf-rank-secondary">اشتباه 1</span>
      </div></div></div>
  </div></div><div class="v2-variant-panel" `;
  const EXPECTED_PANEL3_GRID =
    `data-variant-index="3"><div class="v2-sys-grid v2-gd-port-population"><div class="v2-gd-split"><div class="v2-gd-panel land">
    <div class="v2-gd-panel-head"><b>المنافذ البرية</b><span>1 منفذ</span></div>
    <div class="v2-gd-panel-chart"><figure dir="rtl" style="margin:0;padding:0;width:100%;height:100%;position:relative"><svg viewBox="0 0 620 320" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" font-family='"Somar","IBM Plex Sans Arabic","Noto Kufi Arabic","Tahoma","Arial",sans-serif' aria-hidden="true" focusable="false" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:block;direction:ltr" data-chart="مصفوفة المنافذ البرية"><text x="458.75" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" fill-opacity="0.82">الصور</text><text x="458.75" y="25" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.55">0–1</text><text x="328.25" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" fill-opacity="0.82">سليمة</text><text x="328.25" y="25" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.55">0–1</text><text x="197.75" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" fill-opacity="0.82">اشتباه</text><text x="197.75" y="25" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.55">0–1</text><text x="67.25" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" fill-opacity="0.82">نسبة الاشتباه</text><text x="67.25" y="25" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.55">0–100</text><text x="616" y="172" text-anchor="end" dominant-baseline="middle" font-size="11" fill="currentColor" fill-opacity="0.78">منفذ أ</text><rect x="394.5" y="29" width="128.5" height="286" rx="3" fill="var(--white)" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><rect x="394.5" y="29" width="128.5" height="286" rx="3" fill="var(--gold)" fill-opacity="1" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><text x="458.75" y="172" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="var(--navy)">1</text><rect x="264" y="29" width="128.5" height="286" rx="3" fill="var(--white)" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><rect x="264" y="29" width="128.5" height="286" rx="3" fill="var(--gold)" fill-opacity="1" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><text x="328.25" y="172" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="var(--navy)">1</text><rect x="133.5" y="29" width="128.5" height="286" rx="3" fill="var(--white)" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><rect x="133.5" y="29" width="128.5" height="286" rx="3" fill="var(--gold)" fill-opacity="0" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><text x="197.75" y="172" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="var(--navy)">0</text><rect x="3" y="29" width="128.5" height="286" rx="3" fill="var(--white)" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><rect x="3" y="29" width="128.5" height="286" rx="3" fill="var(--gold)" fill-opacity="0" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><text x="67.25" y="172" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="var(--navy)">0</text></svg><table dir="rtl" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0"><caption>مصفوفة المنافذ البرية</caption><thead><tr><th scope="col">المنفذ</th><th scope="col">الصور</th><th scope="col">سليمة</th><th scope="col">اشتباه</th><th scope="col">نسبة الاشتباه</th></tr></thead><tbody><tr><th scope="row">منفذ أ</th><td>1</td><td>1</td><td>0</td><td>0</td></tr></tbody></table></figure></div>
  </div><div class="v2-gd-panel sea">
    <div class="v2-gd-panel-head"><b>المنافذ البحرية</b><span>1 منفذ</span></div>
    <div class="v2-gd-panel-chart"><figure dir="rtl" style="margin:0;padding:0;width:100%;height:100%;position:relative"><svg viewBox="0 0 620 320" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" font-family='"Somar","IBM Plex Sans Arabic","Noto Kufi Arabic","Tahoma","Arial",sans-serif' aria-hidden="true" focusable="false" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:block;direction:ltr" data-chart="مصفوفة المنافذ البحرية"><text x="458.75" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" fill-opacity="0.82">الصور</text><text x="458.75" y="25" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.55">0–1</text><text x="328.25" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" fill-opacity="0.82">سليمة</text><text x="328.25" y="25" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.55">0–1</text><text x="197.75" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" fill-opacity="0.82">اشتباه</text><text x="197.75" y="25" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.55">0–1</text><text x="67.25" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" fill-opacity="0.82">نسبة الاشتباه</text><text x="67.25" y="25" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.55">0–100</text><text x="616" y="172" text-anchor="end" dominant-baseline="middle" font-size="11" fill="currentColor" fill-opacity="0.78">منفذ ب</text><rect x="394.5" y="29" width="128.5" height="286" rx="3" fill="var(--white)" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><rect x="394.5" y="29" width="128.5" height="286" rx="3" fill="var(--gold)" fill-opacity="1" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><text x="458.75" y="172" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="var(--navy)">1</text><rect x="264" y="29" width="128.5" height="286" rx="3" fill="var(--white)" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><rect x="264" y="29" width="128.5" height="286" rx="3" fill="var(--gold)" fill-opacity="0" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><text x="328.25" y="172" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="var(--navy)">0</text><rect x="133.5" y="29" width="128.5" height="286" rx="3" fill="var(--white)" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><rect x="133.5" y="29" width="128.5" height="286" rx="3" fill="var(--gold)" fill-opacity="1" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><text x="197.75" y="172" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="var(--navy)">1</text><rect x="3" y="29" width="128.5" height="286" rx="3" fill="var(--white)" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><rect x="3" y="29" width="128.5" height="286" rx="3" fill="var(--gold)" fill-opacity="1" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;"/><text x="67.25" y="172" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="var(--navy)">100</text></svg><table dir="rtl" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0"><caption>مصفوفة المنافذ البحرية</caption><thead><tr><th scope="col">المنفذ</th><th scope="col">الصور</th><th scope="col">سليمة</th><th scope="col">اشتباه</th><th scope="col">نسبة الاشتباه</th></tr></thead><tbody><tr><th scope="row">منفذ ب</th><td>1</td><td>0</td><td>1</td><td>100</td></tr></tbody></table></figure></div>
  </div></div></div></div></div></div>
  </div>
  <div class="v2-page-foot" dir="ltr">06 / 20</div>
</section>`;

  function twoPortModel() {
    return buildReportModel(
      input([
        popRow({ portName: "منفذ أ", portType: "منفذ بري" }),
        popRow({ xrayImageId: "XR-2", portName: "منفذ ب", portType: "منفذ بحري", xrayLevelOneResult: "اشتباه" }),
      ]),
    );
  }

  it("panel 1 (Ledger) is byte-identical before and after the P0 extraction", () => {
    const html = portPopulationSlideBuilders(twoPortModel(), true)[0](6, 20);
    const start = html.indexOf('data-variant-index="1"');
    const end = html.indexOf('data-variant-index="2"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(html.slice(start, end)).toBe(EXPECTED_PANEL1_LEDGER);
  });

  it("panel 2 (Briefing) is byte-identical before and after the P0 extraction", () => {
    const html = portPopulationSlideBuilders(twoPortModel(), true)[0](6, 20);
    const start = html.indexOf('data-variant-index="2"');
    const end = html.indexOf('data-variant-index="3"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(html.slice(start, end)).toBe(EXPECTED_PANEL2_BRIEFING);
  });

  it("panel 3 (Grid) is byte-identical before and after the P0 extraction", () => {
    const html = portPopulationSlideBuilders(twoPortModel(), true)[0](6, 20);
    const start = html.indexOf('data-variant-index="3"');
    expect(start).toBeGreaterThan(-1);
    expect(html.slice(start)).toBe(EXPECTED_PANEL3_GRID);
  });
});

describe("briefingRankPlan (2026-07-25, deck2-design-systems design ruling)", () => {
  it("follows the exact ladder from n=0 through the densest tier's capacity (n=14), never folding", () => {
    const cases: Array<[number, ReturnType<typeof briefingRankPlan>["tier"], 1 | 2, number]> = [
      [1, "comfortable", 1, 44],
      [5, "comfortable", 1, 44],
      [6, "compact", 1, 36],
      [7, "comfortable", 2, 44],
      [10, "comfortable", 2, 44],
      [11, "compact", 2, 36],
      [12, "compact", 2, 36],
      [13, "dense", 2, 30],
      [14, "dense", 2, 30],
    ];
    for (const [n, tier, columns, rowH] of cases) {
      const plan = briefingRankPlan(n);
      expect(plan).toMatchObject({ tier, columns, rowH, named: n, folded: 0 });
    }
  });

  it("folds beyond n=14, never folding exactly 1 item", () => {
    for (const n of [15, 16, 20, 24]) {
      const plan = briefingRankPlan(n);
      expect(plan.named).toBe(13);
      expect(plan.folded).toBe(n - 13);
      expect(plan.folded).toBeGreaterThanOrEqual(2); // never fold exactly one
    }
  });

  it("every plan fits inside the shared rank-list budget: rowsPerColumn × rowH + (rowsPerColumn-1) × 5 <= BRIEFING_RANK_BUDGET_PX", () => {
    for (let n = 0; n <= 30; n++) {
      const plan = briefingRankPlan(n);
      const used = plan.rowsPerColumn * plan.rowH + Math.max(0, plan.rowsPerColumn - 1) * 5;
      expect(used).toBeLessThanOrEqual(BRIEFING_RANK_BUDGET_PX);
    }
  });
});
