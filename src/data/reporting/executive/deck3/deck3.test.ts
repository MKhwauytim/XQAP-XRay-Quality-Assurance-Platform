// src/data/reporting/executive/deck3/deck3.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveDeckV3, buildDeckV3Html } from "./index";

// Same fixture pattern as deck2.test.ts — a minimal but complete
// PreparedPopulationRow, overridden per test row.
function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني", xrayImageId: "XR-1", xrayEntryDate: null,
    portCode: "P1", portType: "منفذ بري", portName: "منفذ الاختبار",
    declarationNumber: null, declarationDate: null, plateOrContainerNumber: null, chassisNumber: null,
    xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة", movementType: "بري",
    reportNumber: null, targetedByRiskEngine: null, riskMessage: null,
    levelOneEmployee: null, levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null, certScanStatus: "NonCertscan", certScanSnippet: null, originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided", biMatched: false, biFilledFields: [],
    sourceSheetName: "Sheet1", sourceRowNumber: 1,
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

describe("buildExecutiveDeckV3", () => {
  it("renders exactly 21 slides in the handoff's fixed order", async () => {
    const html = await buildExecutiveDeckV3(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    const slideCount = (html.match(/class="slide v3/g) ?? []).length;
    expect(slideCount).toBe(21);
  });

  it("carries the deck2 viewer chrome: side nav, toolbar, print/PDF, fullscreen", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    expect(html).toContain('id="deck-nav"');
    expect(html).toContain('id="deck-nav-sections"');
    expect(html).toContain('id="deck-fullscreen-button"');
    expect(html).toContain("طباعة / PDF");
    expect(html).toContain('id="deck-slide-prev"');
    expect(html).toContain('id="deck-slide-counter"');
  });

  it("gives every slide the section hooks the nav script reads", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    const sectioned = (html.match(/data-section=/g) ?? []).length;
    expect(sectioned).toBe(21);
    expect(html).toContain('data-section-label="القسم الثالث — التحاليل المتقدمة"');
  });

  it("renders the three dark section dividers (the invisible-divider regression)", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    const dividers = (html.match(/class="slide v3 v3-divider"/g) ?? []).length;
    expect(dividers).toBe(3);
    // The divider background rule must exist — white-ish divider text on the
    // light page background was a real shipped bug.
    expect(html).toContain(".slide.v3.v3-divider{background:var(--v3-navy)");
  });

  it("uses locked terminology verbatim", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    expect(html).toContain("نتائج الوسائل الآلية");
    expect(html).toContain("نسبة تحديد موقع الاشتباه");
    expect(html).toContain("دقة السليمة");
    expect(html).toContain("دقة الاشتباه");
    expect(html).toContain("الدقة العامة");
  });

  it("wires real population counts, not the handoff's placeholder 148326/7563", async () => {
    const html = await buildExecutiveDeckV3(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain("148,326");
    expect(html).not.toContain("148326");
    expect(html).not.toContain("7,563");
  });

  it("derives the fixed-count level shares from the real monthly target", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    const target = DEFAULT_EXEC_CONFIG.monthlyTarget;
    expect(html).toContain(Math.round(target * 0.4).toLocaleString("ar-SA-u-nu-latn"));
    expect(html).not.toContain("6,250");
  });

  it("embeds the Somar font-face and handoff color tokens", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    expect(html).toContain('font-family:"Somar"');
    expect(html).toContain("#10304f");
  });

  it("numbers content slides NN / 21 and leaves covers and dividers uncounted", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    // Content slides carry zero-padded counters…
    for (const n of [2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20]) {
      expect(html).toContain(`>${String(n).padStart(2, "0")} / 21<`);
    }
    // …while covers (1, 21) and dividers (6, 9, 14) don't, per the handoff.
    for (const n of [1, 6, 9, 14, 21]) {
      expect(html).not.toContain(`>${String(n).padStart(2, "0")} / 21<`);
    }
  });

  it("escapes data-derived strings (port names) in the slides", async () => {
    const html = await buildExecutiveDeckV3(
      input([popRow({ portName: '<img src=x onerror=alert(1)>' })]),
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  // Bug: the port-distribution table (slide 8) rendered every land/sea port
  // in one fixed table with no row cap, so a real workspace with more ports
  // than fit one 1920×1080 slide silently overflowed past the slide's
  // `overflow:hidden` bottom edge — the trailing ports were simply invisible
  // (never clipped-but-scrollable, never re-flowed). Fixed by paginating into
  // `(يتبع)`-titled continuation slides (ROWS_PER_PORT_PAGE, slides.ts).
  it("splits the port-distribution table into (يتبع) continuation slides when a type has more ports than one page holds", async () => {
    const manyLandPorts = Array.from({ length: 12 }, (_, i) =>
      popRow({ xrayImageId: `XR-L${i}`, portName: `منفذ رقم ${i}`, portCode: `PL${i}` }),
    );
    const html = await buildExecutiveDeckV3(input(manyLandPorts));

    // 12 land ports at 8/page need 2 pages → 1 extra slide over the fixed 21.
    const slideCount = (html.match(/class="slide v3/g) ?? []).length;
    expect(slideCount).toBe(22);

    expect(html).toContain("التوزيع على المنافذ البرية والبحرية (يتبع)");
    // Every port still appears exactly once — none dropped or duplicated by
    // the chunking.
    for (let i = 0; i < 12; i++) {
      expect((html.match(new RegExp(`منفذ رقم ${i}<`, "g")) ?? []).length).toBe(1);
    }
    // The land grand total ("إجمالي البرية") renders once per port table
    // that has one (the population table here, and the always-single-page
    // accuracy table) — only on each table's final page, never repeated per
    // continuation page and never dropped.
    expect((html.match(/إجمالي البرية/g) ?? []).length).toBe(2);
  });
});

describe("buildDeckV3Html footerNote", () => {
  it("omits any footer content/styling when footerNote is not passed (backward compatible)", () => {
    const html = buildDeckV3Html("<section>x</section>", "أغسطس 2026");
    // The base CSS unconditionally carries a `.source-revisions` fullscreen
    // display:none guard (theme.ts) so it's ready the moment a footer IS
    // passed elsewhere — that selector reference alone isn't a leak. What
    // must stay absent is the actual footer block and its dedicated styling.
    expect(html).not.toContain('<section class="source-revisions"');
    expect(html).not.toContain(".srev-title");
  });

  it("appends footerNote after the slides when provided", () => {
    const html = buildDeckV3Html("<section>x</section>", "أغسطس 2026", {}, '<section class="source-revisions">test-footer</section>');
    expect(html).toContain("test-footer");
    expect(html.indexOf("<section>x</section>")).toBeLessThan(html.indexOf("test-footer"));
  });
});
