// src/data/reporting/executive/deck2/deck2.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveDeckV2 } from "./index";

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

describe("stage×port grid slides", () => {
  it("renders both new slide titles and the الإجمالي totals row in production output", () => {
    const html = buildExecutiveDeckV2(
      input([
        popRow({ stage: "المستوى الأول", portName: "ميناء أ" }),
        popRow({ xrayImageId: "XR-2", stage: "المستوى الأول", portName: "ميناء ب", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه" }),
      ]),
    );
    expect(html).toContain("مجتمع حالات الفحص حسب المستوى والمنفذ");
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
