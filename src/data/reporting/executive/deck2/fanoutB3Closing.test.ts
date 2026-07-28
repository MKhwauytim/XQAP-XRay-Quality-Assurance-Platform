// src/data/reporting/executive/deck2/fanoutB3Closing.test.ts
//
// Tests for batch B3 item 5 (the LAST bespoke page) of the deck2 three-system
// fan-out (docs/superpowers/specs/2026-07-25-deck2-fanout-remaining-pages-plan.md
// §10): slide-closing — a data-provenance record (key→value), not a rankable
// entity list. Three risks this file focuses on:
//   (a) Ledger — the zero-revisions empty state must live INSIDE the table
//       shape (a colspan row), not as separate prose; BI provided/not-provided
//       both render; the classification/period line sits in a real tfoot row.
//   (b) Briefing — `bars:false` (no `.v2-bf-rank-track`, per the `no-bars` CSS
//       hook); `foldRemainder` is a REAL implementation (pools the folded
//       filenames+revisions into the remainder row, proven with a fixture
//       that exceeds `briefingRankPlan`'s densest-tier cap of 14 named rows),
//       not a silent-drop stub; the zero-revisions case renders a note, not
//       an empty `.v2-bf-rank` wrapper.
//   (c) Grid — literally reuses the Ledger table markup (byte-for-byte,
//       asserted via string equality, not "looks similar"), wrapped in the
//       Grid namespacing class.
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildReportModel } from "../model/reportModel";
import { closingSlide } from "./slides";
import { fmtNum } from "../primitives";

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
 *  fanoutB3StagePort.test.ts use. */
function panelSlice(html: string, index: 0 | 1 | 2 | 3): string {
  const start = html.indexOf(`data-variant-index="${index}"`);
  expect(start).toBeGreaterThan(-1);
  if (index === 3) return html.slice(start);
  const end = html.indexOf(`data-variant-index="${index + 1}"`);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

const NO_REVISIONS_NOTE = "لم تُسجَّل مراجعات لملفات المصدر مع هذا التقرير.";

// ═══════════════════════════════════════════════════════════════════════════
// (a) Ledger
// ═══════════════════════════════════════════════════════════════════════════

describe("slide-closing Ledger — provenance table (fan-out plan §10)", () => {
  it("zero revisions: the graceful note renders INSIDE the table as a colspan row, not as separate prose", () => {
    const model = buildReportModel(input([popRow()]));
    const html = closingSlide(model, undefined, 7, 20, true);
    const panel1 = panelSlice(html, 1);

    // Lives inside a real table row, not slot 0's standalone .v2-prov-empty.
    expect(panel1).not.toContain("v2-prov-empty");
    expect(panel1).toContain(`<td colspan="3"><span class="insuff">${NO_REVISIONS_NOTE}</span></td>`);
    expect(panel1).toContain("<table");
    expect(panel1).toContain("الملف/المصدر");
    expect(panel1).toContain("المراجعة/العدد");
  });

  it("with revisions: one row per entry, filename dir=\"ltr\", no empty-state note", () => {
    const model = buildReportModel(input([popRow()]));
    const html = closingSlide(
      model,
      { "population.final.json": 7, "sample.master.json": 3 },
      7,
      20,
      true,
    );
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain('<td dir="ltr">population.final.json</td>');
    expect(panel1).toContain('<td dir="ltr">sample.master.json</td>');
    expect(panel1).toContain("مراجعة 7");
    expect(panel1).toContain("مراجعة 3");
    expect(panel1).not.toContain(NO_REVISIONS_NOTE);
  });

  it("BI not provided: renders the muted not-provided cell, no matched count", () => {
    const model = buildReportModel(input([popRow()]));
    const html = closingSlide(model, undefined, 7, 20, true);
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain("بيانات ذكاء الأعمال");
    expect(panel1).toContain("غير مُقدَّم هذا الشهر");
    expect(panel1).not.toContain("أثرى");
  });

  it("BI provided: renders the matched-count sentence, not the not-provided cell", () => {
    const model = buildReportModel(
      input([popRow({ xrayImageId: "XR-1", biMatched: true }), popRow({ xrayImageId: "XR-2" })]),
    );
    expect(model.dataSources.biProvided).toBe(true);
    expect(model.dataSources.biMatchedCount).toBe(1);
    const html = closingSlide(model, undefined, 7, 20, true);
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain(`مُقدَّم — أثرى ${fmtNum(1)} صورة`);
    expect(panel1).not.toContain("غير مُقدَّم هذا الشهر");
  });

  it("classification line sits in a real tfoot row, spanning all 3 columns", () => {
    const model = buildReportModel(input([popRow()]));
    const html = closingSlide(model, undefined, 7, 20, true);
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain(
      `<tr class="v2-lg-footnote"><td colspan="3">داخلي — للاستخدام التنفيذي · ${model.summary.periodId}</td></tr>`,
    );
    // it's genuinely inside <tfoot>, not a stray row dumped in <tbody>.
    const tfootStart = panel1.indexOf("<tfoot>");
    const tfootEnd = panel1.indexOf("</tfoot>");
    expect(panel1.indexOf("v2-lg-footnote")).toBeGreaterThan(tfootStart);
    expect(panel1.indexOf("v2-lg-footnote")).toBeLessThan(tfootEnd);
  });

  it("the risk-agency source card is always the first row, with its riskRowCount", () => {
    const model = buildReportModel(input([popRow({ xrayImageId: "XR-1" }), popRow({ xrayImageId: "XR-2" })]));
    const html = closingSlide(model, undefined, 7, 20, true);
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain(`<td>بيانات وكالة المخاطر</td><td>المصدر الأساسي</td><td>${fmtNum(2)} صورة</td>`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) Briefing
// ═══════════════════════════════════════════════════════════════════════════

describe("slide-closing Briefing — lede/support + bars:false rank list (fan-out plan §10)", () => {
  it("lede IS src.riskRowCount, tone gold, basis names the period", () => {
    const model = buildReportModel(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    const html = closingSlide(model, undefined, 7, 20, true);
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain(`<div class="v2-bf-lede-figure gold">${fmtNum(2)}</div>`);
    expect(panel2).toContain(`${fmtNum(2)} صورة من بيانات وكالة المخاطر`);
    expect(panel2).toContain(`فترة الدراسة ${model.summary.periodId}`);
  });

  it("rank list renders with bars:false — no .v2-bf-rank-track, no-bars class present on every row", () => {
    const model = buildReportModel(input([popRow()]));
    const html = closingSlide(
      model,
      { "population.final.json": 7, "sample.master.json": 3 },
      7,
      20,
      true,
    );
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain("v2-bf-rank");
    expect(panel2).not.toContain("v2-bf-rank-track");
    const rows = [...panel2.matchAll(/class="(v2-bf-rank-row[^"]*)"/g)].map((m) => m[1]);
    expect(rows.length).toBe(2);
    for (const cls of rows) expect(cls).toContain("no-bars");
  });

  it("zero revisions: renders the graceful empty note, not an empty .v2-bf-rank wrapper", () => {
    const model = buildReportModel(input([popRow()]));
    const html = closingSlide(model, undefined, 7, 20, true);
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain("v2-bf-closing-empty");
    expect(panel2).toContain(NO_REVISIONS_NOTE);
    expect(panel2).not.toContain("v2-bf-rank ");
    expect(panel2).not.toContain('class="v2-bf-rank t-');
  });

  it("foldRemainder is a REAL implementation: with >14 revisions (exceeding briefingRankPlan's densest-tier cap), every folded filename+revision is pooled into the remainder row — none silently dropped", () => {
    // 20 source files → alphabetically sorted by sourceRevisionEntries;
    // briefingRankPlan's densest tier caps at 14 named rows, so this forces
    // exactly 6 folded rows (13 named "when folded" + up to that ladder —
    // the exact split is an implementation detail; what matters is that ALL
    // of the folded tail's file/revision pairs are individually discoverable
    // in the remainder row's own markup, not just a bare count).
    const revisions: Record<string, number> = {};
    const files: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const name = `source-file-${String(i).padStart(2, "0")}.json`;
      files.push(name);
      revisions[name] = i;
    }
    files.sort((a, b) => a.localeCompare(b)); // sourceRevisionEntries' own order

    const model = buildReportModel(input([popRow()]));
    const html = closingSlide(model, revisions, 7, 20, true);
    const panel2 = panelSlice(html, 2);

    // Exactly one remainder ("rest") row.
    expect((panel2.match(/class="v2-bf-rank-row rest no-bars"/g) ?? []).length).toBe(1);
    expect(panel2).toContain("ملفات إضافية");

    // Every one of the LAST 20-13=7 files (the tail, per briefingRankPlan's
    // "when folded" named count of 13) must appear — filename AND its own
    // revision — inside the remainder row's secondary text. Named rows are
    // the FIRST 13 files (files[0..12]); the fold tail is files[13..19].
    const namedCount = 13;
    const foldedFiles = files.slice(namedCount);
    expect(foldedFiles.length).toBeGreaterThan(0);
    for (const file of foldedFiles) {
      const rev = revisions[file];
      expect(panel2).toContain(file);
      expect(panel2).toContain(`مراجعة ${rev}`);
    }

    // And the named files must ALSO all still be individually present as
    // their own named rows (proving the split point, not just the remainder).
    for (const file of files.slice(0, namedCount)) {
      expect(panel2).toContain(file);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (c) Grid — literal reuse of the Ledger table, not a duplicated markup
// ═══════════════════════════════════════════════════════════════════════════

/** Extract a bounded substring (inclusive of both markers) — used to pull the
 *  exact `<table>...</table>` block out of a panel without depending on the
 *  fragile whole-wrapper-div boundary arithmetic (the same
 *  `<div>...</div>` nests multiple times at the tail of every variant panel:
 *  the org block's own close, the system wrapper's close, and the
 *  `.v2-variant-panel` close all land back-to-back). */
function extractBetween(html: string, startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(-1);
  return html.slice(start, end + endMarker.length);
}

describe("slide-closing Grid — reuses the Ledger table verbatim (fan-out plan §10, deliberate degenerate case)", () => {
  it("Grid's <table> markup is BYTE-IDENTICAL to Ledger's — proves closingGrid calls the same builder, not a reimplementation", () => {
    const model = buildReportModel(
      input([popRow({ xrayImageId: "XR-1", biMatched: true }), popRow({ xrayImageId: "XR-2" })]),
    );
    const html = closingSlide(
      model,
      { "population.final.json": 7, "sample.master.json": 3 },
      7,
      20,
      true,
    );
    const panel1 = panelSlice(html, 1);
    const panel3 = panelSlice(html, 3);

    const ledgerTable = extractBetween(panel1, '<table class="deck-table">', "</table>");
    const gridTable = extractBetween(panel3, '<table class="deck-table">', "</table>");

    // Exact string equality — not "both contain similar rows": if closingGrid
    // ever drifted into its own hand-rolled table, this would catch even a
    // whitespace-level divergence.
    expect(gridTable).toBe(ledgerTable);
    expect(ledgerTable).toContain("population.final.json");
    expect(ledgerTable).toContain(`مُقدَّم — أثرى ${fmtNum(1)} صورة`);

    // The verbatim org block (badge + org name + period) is ALSO identical
    // between the two slots — same closingOrgBlock() call, not a per-slot copy.
    const ledgerBadge = extractBetween(panel1, '<div class="v2-closing-badge">', "</div>");
    const gridBadge = extractBetween(panel3, '<div class="v2-closing-badge">', "</div>");
    expect(gridBadge).toBe(ledgerBadge);
    expect(panel1).toContain(`<div class="v2-closing-period">${model.summary.periodId}</div>`);
    expect(panel3).toContain(`<div class="v2-closing-period">${model.summary.periodId}</div>`);
  });

  it("Grid slot carries the Grid namespacing class and no chart/SVG markup (this page has no matrix)", () => {
    const model = buildReportModel(input([popRow()]));
    const html = closingSlide(model, undefined, 7, 20, true);
    const panel3 = panelSlice(html, 3);
    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-closing");
    // No metricMatrix/percentHeatmap chart markup (both wrap in <figure>) —
    // the badge/icon <svg> elements the org block and table icons already
    // use elsewhere in this deck are NOT charts, so <svg> alone isn't the
    // right signal here; <figure> is metricMatrix's own distinguishing tag.
    expect(panel3).not.toContain("<figure");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// General shape checks
// ═══════════════════════════════════════════════════════════════════════════

describe("slide-closing — production variant untouched", () => {
  it("production (variantPreview=false) renders only variant 0's markup, unchanged from before the fan-out", () => {
    const model = buildReportModel(input([popRow()]));
    const html = closingSlide(model, { "population.final.json": 7 }, 7, 20, false);
    expect(html).not.toContain("v2-sys-ledger");
    expect(html).not.toContain("v2-sys-brief");
    expect(html).not.toContain("v2-sys-grid");
    expect(html).toContain('<div class="v2-prov-item">');
    expect(html).toContain("population.final.json");
  });
});
