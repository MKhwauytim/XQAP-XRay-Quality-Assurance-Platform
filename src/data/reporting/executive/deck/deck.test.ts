import { describe, expect, it } from "vitest";

import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveDeck } from "./index";

// Pictographic-emoji regex (per the task contract): the deck must contain no emoji.
// The FE00–FE0F variation-selector range is intentional (part of the contract); the
// no-misleading-character-class rule flags it as a combining mark, so disable it here.
// eslint-disable-next-line no-misleading-character-class
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}]/u;

// The exact slide titles, in order (data-title attributes). Title slide, then the
// agenda (الفهرس), then the 13 content slides (blueprint §3, curated to ~15).
const EXPECTED_TITLES = [
  "الغلاف",
  "الفهرس",
  "الملخص التنفيذي",
  "ما الذي فحصناه",
  "حُكم الدقة",
  "القوة والضعف حسب المنفذ",
  "هل تساعد المراجعة المزدوجة",
  "هل تتفق الفرق الأخرى",
  "ما الذي يحرّك الجودة",
  "أبرز المفتشين",
  "مفتشون يحتاجون دعمًا",
  "أكبر خطر",
  "الإجراءات ذات الأولوية",
  "قرارات مطلوبة",
  "الفترة القادمة",
];

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

/** A richer fixture: BI-mapped inspectors + cross-team results + a mix of outcomes,
 *  so the data-bearing slides (verdict / ports / corroboration / inspectors / risk)
 *  exercise their populated branches rather than only the empty states. */
function richInput(): ExecutiveReportInput {
  const rows: PreparedPopulationRow[] = [];
  const ports = ["منفذ الأول", "منفذ الثاني", "منفذ الثالث"];
  for (let i = 0; i < 60; i++) {
    const port = ports[i % ports.length];
    // Introduce some missed/false suspicion variety.
    const l1: "سليمة" | "اشتباه" = i % 5 === 0 ? "سليمة" : i % 3 === 0 ? "اشتباه" : "سليمة";
    const expert: "سليمة" | "اشتباه" = i % 7 === 0 ? "اشتباه" : i % 3 === 0 ? "اشتباه" : "سليمة";
    rows.push(
      popRow({
        xrayImageId: `XR-${i + 1}`,
        portName: port,
        portCode: `P${(i % ports.length) + 1}`,
        levelOneEmployee: `EMP-${(i % 4) + 1}`,
        levelTwoEmployee: `EMP-${(i % 3) + 5}`,
        xrayLevelOneResult: l1,
        xrayLevelTwoResult: i % 4 === 0 ? "اشتباه" : "سليمة",
        otherResults: {
          manual: { result: i % 2 === 0 ? "سليمة" : "اشتباه", code: "M", employeeId: null },
          opposite: { result: i % 3 === 0 ? "اشتباه" : "سليمة", code: null, employeeId: "OP-1" },
          liveMeans: { result: null, code: null, employeeId: null },
        },
        biEnrichmentStatus: "BI Matched",
        biMatched: true,
        sourceRowNumber: i + 1,
        // expert result threaded via answer files normally; here it flows through
        // the row bridge — but populationRows alone don't carry expertResult.
      }),
    );
    void expert;
  }
  return input(rows);
}

describe("buildExecutiveDeck — structure", () => {
  it("returns a non-empty self-contained HTML document", () => {
    const html = buildExecutiveDeck(input([popRow()]));
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('dir="rtl"');
  });

  it("renders all 15 slides with the expected titles in order", () => {
    const html = buildExecutiveDeck(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    const titles = [...html.matchAll(/data-title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(EXPECTED_TITLES);
    // 15 <section class="slide ...">
    const slideCount = (html.match(/class="slide[ "]/g) ?? []).length;
    expect(slideCount).toBe(15);
  });

  it("contains landscape 16:9 print sizing", () => {
    const html = buildExecutiveDeck(input([popRow()]));
    expect(html).toContain("size:297mm 167mm");
    expect(html).toMatch(/aspect-ratio:297\/167/);
  });

  it("contains inline SVG visuals", () => {
    const html = buildExecutiveDeck(input([popRow()]));
    expect(html).toContain("<svg");
  });

  it("contains no pictographic emoji glyphs", () => {
    const html = buildExecutiveDeck(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(EMOJI.test(html)).toBe(false);
  });

  it("shows the unmapped-inspector empty state when BI did not match", () => {
    const html = buildExecutiveDeck(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).toContain("هوية المفتش غير مرتبطة (لم تتم مطابقة BI)");
  });

  it("uses the Arabic period label and report classification on the title slide", () => {
    const html = buildExecutiveDeck(input([popRow()]));
    expect(html).toContain("مايو 2026");
    expect(html).toContain("داخلي — للاستخدام التنفيذي");
  });
});

describe("buildExecutiveDeck — populated data", () => {
  it("builds all 15 slides with no emoji on a richer BI-mapped fixture", () => {
    const html = buildExecutiveDeck(richInput());
    const titles = [...html.matchAll(/data-title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(EXPECTED_TITLES);
    expect(EMOJI.test(html)).toBe(false);
    expect(html).toContain("<svg");
  });
});
