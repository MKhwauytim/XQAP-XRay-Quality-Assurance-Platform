// src/data/reporting/executive/deck2/fanoutB3StagePort.test.ts
//
// Tests for batch B3 item 1 of the deck2 three-system fan-out (docs/superpowers/
// specs/2026-07-25-deck2-fanout-remaining-pages-plan.md §7): slide-stage-port-
// population + slide-stage-port-sample — the bespoke stage×port pair. Per the
// plan, this is "the trickiest page in the deck", so this file focuses on its
// four explicit correctness risks:
//   (a) the Ledger cards MUST keep the `.v2-stage-port-card` class AND pass a
//       real `rowCount` (never the `rowCount: 0` convention every other Ledger
//       table in this fan-out uses) — DECK_TABLE_FILL_SCRIPT measures exactly
//       that class to pin each card's totals row to the bottom.
//   (b) stage/port level identity must be resolved BY IDENTITY
//       (`levelIndexForStage`), not by array position, in both Ledger and
//       Briefing — proven with a fixture that has a GAP in `stages` (same
//       technique as B1's risk-stages regression test).
//   (c) Briefing carries exactly 4 rank rows — ONE PER STAGE, not one per
//       port — with the correct per-stage bar/secondary text.
//   (d) Grid's 5 port columns all share the identical domain array, long port
//       names are truncated in the column header, and the full name is still
//       discoverable elsewhere in the page's own output.
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import type { SampleMasterData } from "../../../sampling/sampleTypes";
import { buildReportModel } from "../model/reportModel";
import type { ReportModel } from "../model/reportModel";
import { stagePortPopulationSlide, stagePortSampleSlide } from "./slides";
import { truncLabel } from "./slideKit";
import { fmtNum, fmtPct } from "../primitives";

// ── Fixtures (same shape as stagePortStats.test.ts / deck2.test.ts) ────────

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الأول",
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

function input(populationRows: PreparedPopulationRow[], sample: SampleMasterData | null = null): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

/** Isolate one variant panel's HTML — same technique deck2.test.ts /
 *  fanoutB2a.test.ts use. */
function panelSlice(html: string, index: 0 | 1 | 2 | 3): string {
  const start = html.indexOf(`data-variant-index="${index}"`);
  expect(start).toBeGreaterThan(-1);
  if (index === 3) return html.slice(start);
  const end = html.indexOf(`data-variant-index="${index + 1}"`);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

// A deliberately long Arabic port name (>10 chars, the Grid column-header
// truncation budget) that is also this page's biggest port overall — so it
// both leads the Briefing lede AND is the one Grid column that must actually
// get truncated.
const LONG_PORT = "ميناء الدمام الإسلامي الكبير جدا";

/**
 * Rich, fully-canonical (no gaps) 4-stage fixture, built through the SAME
 * "real popRows via buildReportModel" technique stagePortStats.test.ts and
 * deck2.test.ts's own risk-stages gap test use — this keeps `model.rows`
 * (which `collectStagePortStats` reads) and `model.population.byStage`
 * (which the pinned totals/support figures read) mutually consistent by
 * construction, without hand-assembling two independently-controlled model
 * fragments.
 *
 * `sample` carries real `rows` (so `selectedInSample`/sampleSize/coverage are
 * non-zero and independently checkable) but an EMPTY `stageAllocations`, which
 * forces `buildStageProfiles`'s fallback branch — `population.byStage` is a
 * fresh count of `model.rows`, so every figure below is independently
 * derivable from the popRow counts alone (see calculateExecutiveKPIs /
 * buildStageProfiles's fallback branch in executiveKpiProfiles.ts).
 *
 * Layout (population / sampled):
 *   المستوى الأول:  LONG_PORT ×5 (3 sampled), ميناء ب ×2 (1 sampled)  → pop 7,  sample 4
 *   المستوى الثاني: LONG_PORT ×10 (4 sampled), ميناء ج ×1 (0 sampled) → pop 11, sample 4
 *   المستوى الثالث: ميناء د ×3 (2 sampled)                            → pop 3,  sample 2
 *   المستوى الرابع: ميناء ب ×6 (1 sampled), ميناء هـ ×4 (0 sampled)   → pop 10, sample 1
 *
 * Overall port totals (population): LONG_PORT=15, ميناء ب=8, ميناء هـ=4,
 * ميناء د=3, ميناء ج=1 — exactly 5 distinct ports, so the Grid's "top-5
 * ports by overall population" is deterministically all five, in that order.
 *
 * Largest single (stage,port) cell by population is LONG_PORT at المستوى
 * الثاني (10) — bigger than LONG_PORT at المستوى الأول (5), so the Briefing
 * lede test below has a real "which stage's own top port wins" comparison to
 * verify, not a trivially-only-one-candidate case.
 */
function richFourStageModel(): ReportModel {
  const rows: PreparedPopulationRow[] = [];
  const sampled: PreparedPopulationRow[] = [];
  const push = (id: string, stage: string, portName: string, inSample: boolean) => {
    const row = popRow({ xrayImageId: id, stage, portName });
    rows.push(row);
    if (inSample) sampled.push(row);
  };

  for (let i = 1; i <= 5; i++) push(`L1-LONG-${i}`, "المستوى الأول", LONG_PORT, i <= 3);
  for (let i = 1; i <= 2; i++) push(`L1-B-${i}`, "المستوى الأول", "ميناء ب", i <= 1);

  for (let i = 1; i <= 10; i++) push(`L2-LONG-${i}`, "المستوى الثاني", LONG_PORT, i <= 4);
  push("L2-C-1", "المستوى الثاني", "ميناء ج", false);

  for (let i = 1; i <= 3; i++) push(`L3-D-${i}`, "المستوى الثالث", "ميناء د", i <= 2);

  for (let i = 1; i <= 6; i++) push(`L4-B-${i}`, "المستوى الرابع", "ميناء ب", i <= 1);
  for (let i = 1; i <= 4; i++) push(`L4-E-${i}`, "المستوى الرابع", "ميناء هـ", false);

  const sample: SampleMasterData = {
    rngSeed: "",
    totalRequested: sampled.length,
    totalActual: sampled.length,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: 0,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "",
    drawnBy: "",
    rows: sampled,
  };

  return buildReportModel(input(rows, sample));
}

/**
 * A GAP fixture — only المستوى الرابع (level 4, small population) and
 * المستوى الثاني (level 2, large population) have any rows; levels 1 and 3
 * are entirely absent from `model.population.byStage`. Level 4's (smaller)
 * rows come FIRST, so `stages` is `[level4, level2]` — array positions
 * [0, 1]. Position-based indexing (the pre-2026-07-28 bug class) would pair
 * position 0 with level 1's tone/ordinal and position 1 with level 2's —
 * both wrong. A magnitude-sort would additionally put level 2 (4 rows)
 * BEFORE level 4 (1 row); this fixture keeps them in encounter order so a
 * "never sorted by size" check has a real divergence to catch, not a
 * coincidence.
 */
function gapModel(): ReportModel {
  return buildReportModel(
    input([
      popRow({ xrayImageId: "G-1", stage: "المستوى الرابع", portName: "ميناء س" }),
      popRow({ xrayImageId: "G-2", stage: "المستوى الثاني", portName: "ميناء ص" }),
      popRow({ xrayImageId: "G-3", stage: "المستوى الثاني", portName: "ميناء ص" }),
      popRow({ xrayImageId: "G-4", stage: "المستوى الثاني", portName: "ميناء ص" }),
      popRow({ xrayImageId: "G-5", stage: "المستوى الثاني", portName: "ميناء ص" }),
    ]),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// (a) The one place Ledger must NOT use rowCount: 0
// ═══════════════════════════════════════════════════════════════════════════

describe("stage×port Ledger — .v2-stage-port-card + real rowCount (fan-out plan §7, the DECK_TABLE_FILL_SCRIPT risk)", () => {
  it("population page: all 4 cards keep .v2-stage-port-card AND emit a real filler row (rowCount = top.length, never 0)", () => {
    const model = richFourStageModel();
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel1 = panelSlice(html, 1);

    // Every stage in this fixture has ports (top.length > 0 for all 4), so a
    // rowCount:0 regression would silently drop the filler row on every card
    // at once — count both signals together so neither can silently vanish.
    expect((panel1.match(/v2-stage-port-card/g) ?? []).length).toBe(4);
    expect((panel1.match(/class="v2-fill-row" aria-hidden="true"/g) ?? []).length).toBe(4);

    // The cards are built through ledgerTableCard directly (not the
    // ledgerPortCard P2 wrapper, which forces its own .v2-lg-port-card
    // prefix and can't carry this exact cardClass) — confirms that choice.
    expect(panel1).not.toContain("v2-lg-port-card");
    expect(panel1).toContain("v2-lg-stage-card");
  });

  it("sample page: same class + real rowCount contract holds independently", () => {
    const model = richFourStageModel();
    const html = stagePortSampleSlide(model, 7, 20, true);
    const panel1 = panelSlice(html, 1);
    expect((panel1.match(/v2-stage-port-card/g) ?? []).length).toBe(4);
    expect((panel1.match(/class="v2-fill-row" aria-hidden="true"/g) ?? []).length).toBe(4);
  });

  it("a stage with zero ports gets NO filler row (rowCount: 0 is correct there, not a regression) — proves rowCount tracks top.length, not a hardcoded constant", () => {
    // Only 3 of the 4 canonical levels have any rows at all; المستوى الرابع
    // has zero ports, so its own card's rowCount must be 0 (no fill row),
    // while the other three (which DO have ports) still get theirs.
    const model = buildReportModel(
      input([
        popRow({ xrayImageId: "1", stage: "المستوى الأول", portName: "ميناء أ" }),
        popRow({ xrayImageId: "2", stage: "المستوى الثاني", portName: "ميناء ب" }),
        popRow({ xrayImageId: "3", stage: "المستوى الثالث", portName: "ميناء ج" }),
      ]),
    );
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel1 = panelSlice(html, 1);
    expect((panel1.match(/v2-stage-port-card/g) ?? []).length).toBe(3);
    expect((panel1.match(/class="v2-fill-row" aria-hidden="true"/g) ?? []).length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) Identity-based level indexing under a gap (Ledger + Briefing)
// ═══════════════════════════════════════════════════════════════════════════

describe("stage×port level-identity resolution — regression for positional (levelIndexForStage) mispairing", () => {
  it("Ledger: each card's tone follows its OWN level, not its array position", () => {
    const model = gapModel();
    expect(model.population.byStage.map((s) => s.stageLabel)).toEqual(["المستوى الرابع", "المستوى الثاني"]);

    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel1 = panelSlice(html, 1);

    // Position 0 is level 4: coral, NOT level 1's gold that positional
    // indexing (array position 0 → STAGE_TONES[0]) would have produced.
    expect(panel1).toContain('class="v2-lg-stage-card v2-stage-port-card coral">');
    // Position 1 is level 2: blue — asserted explicitly, not assumed correct
    // by omission (level 2's own tone happens to also sit at STAGE_TONES[1],
    // so a positional-index bug could coincidentally look right here; the
    // coral assertion above is what actually catches the bug class).
    expect(panel1).toContain('class="v2-lg-stage-card v2-stage-port-card blue">');
    expect(panel1).not.toContain('class="v2-lg-stage-card v2-stage-port-card gold">');

    // Each card's title still names its OWN stage correctly (never borrowed).
    expect(panel1).toContain("المستوى الرابع — أعلى 5 من منفذ واحد");
    expect(panel1).toContain("المستوى الثاني — أعلى 5 من منفذ واحد");
  });

  it("Briefing: rank-row tone follows its OWN level, and display order (never sorted by population size) is preserved", () => {
    const model = gapModel();
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel2 = panelSlice(html, 2);

    expect((panel2.match(/class="v2-bf-rank-row"/g) ?? []).length).toBe(2);
    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    // المستوى الرابع (population 1) comes BEFORE المستوى الثاني (population
    // 4) — a magnitude sort would reverse this; display/stage order must win.
    expect(labels).toEqual(["المستوى الرابع", "المستوى الثاني"]);

    const tones = [...panel2.matchAll(/<span class="v2-bf-rank-num (\w+)">/g)].map((m) => m[1]);
    expect(tones).toEqual(["coral", "blue"]);

    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values).toEqual([fmtNum(1), fmtNum(4)]);
  });

  it("Briefing lede also resolves the winning stage's tone BY IDENTITY", () => {
    const model = gapModel();
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel2 = panelSlice(html, 2);
    // المستوى الثاني's ميناء ص (4) beats المستوى الرابع's ميناء س (1) —
    // the lede must carry level 2's OWN tone (blue), not a positional guess.
    expect(panel2).toContain('<div class="v2-bf-lede-figure blue">');
    expect(panel2).toContain("أعلى تركّز: ميناء ص في المستوى الثاني");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (c) Briefing: exactly 4 rank rows, one per STAGE (never one per port)
// ═══════════════════════════════════════════════════════════════════════════

describe("stage×port Briefing — 4 rank rows, one per stage, correct bar/secondary per page (fan-out plan §7 point 4)", () => {
  it("population page: bar = stage population, secondary names that stage's own top port", () => {
    const model = richFourStageModel();
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel2 = panelSlice(html, 2);

    // Exactly 4 rows — never one per port (this fixture has 5 distinct
    // ports across the page, which would produce 5 rows if this Briefing
    // wrongly ranked ports instead of stages).
    expect((panel2.match(/class="v2-bf-rank-row"/g) ?? []).length).toBe(4);
    expect(panel2).not.toContain("rest");

    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(["المستوى الأول", "المستوى الثاني", "المستوى الثالث", "المستوى الرابع"]);

    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values).toEqual([fmtNum(7), fmtNum(11), fmtNum(3), fmtNum(10)]); // stage populations

    // Secondary text names each stage's OWN top port + its count.
    const secondaries = [...panel2.matchAll(/<span class="v2-bf-rank-secondary">([^<]*)<\/span>/g)].map(
      (m) => m[1],
    );
    expect(secondaries[0]).toContain(`(${fmtNum(5)})`); // level 1's top port: LONG_PORT ×5
    expect(secondaries[1]).toContain(`(${fmtNum(10)})`); // level 2's top port: LONG_PORT ×10
    expect(secondaries[2]).toContain(`ميناء د (${fmtNum(3)})`); // level 3's only port
    expect(secondaries[3]).toContain(`ميناء ب (${fmtNum(6)})`); // level 4's top port

    const tones = [...panel2.matchAll(/<span class="v2-bf-rank-num (\w+)">/g)].map((m) => m[1]);
    expect(tones).toEqual(["gold", "blue", "green", "coral"]);
  });

  it("sample page: bar = stage sampleSize, secondary is that stage's OWN coverage (not a repeated top-port name)", () => {
    const model = richFourStageModel();
    const html = stagePortSampleSlide(model, 7, 20, true);
    const panel2 = panelSlice(html, 2);

    expect((panel2.match(/class="v2-bf-rank-row"/g) ?? []).length).toBe(4);

    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values).toEqual([fmtNum(4), fmtNum(4), fmtNum(2), fmtNum(1)]); // stage sampleSizes

    const secondaries = [...panel2.matchAll(/<span class="v2-bf-rank-secondary">([^<]*)<\/span>/g)].map(
      (m) => m[1],
    );
    expect(secondaries).toEqual([
      `تغطية ${fmtPct((4 / 7) * 100)}`,
      `تغطية ${fmtPct((4 / 11) * 100)}`,
      `تغطية ${fmtPct((2 / 3) * 100)}`,
      `تغطية ${fmtPct((1 / 10) * 100)}`,
    ]);
  });

  it("lede is the single largest (stage,port) cell on the page, not just the biggest stage or biggest port in isolation", () => {
    const model = richFourStageModel();
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel2 = panelSlice(html, 2);
    // المستوى الثاني's own population (11) is the page's largest stage, and
    // LONG_PORT's own page-wide total (15) is the page's largest port — but
    // the lede must be the (stage,port) CELL, which is LONG_PORT within
    // المستوى الثاني specifically (10), not either of those larger totals.
    expect(panel2).toContain(`<div class="v2-bf-lede-figure blue">${fmtNum(10)}</div>`);
    expect(panel2).toContain(`أعلى تركّز: ${LONG_PORT} في المستوى الثاني — ${fmtNum(10)} صورة`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (d) Grid: transposed matrix, 5 columns sharing one domain, truncated headers
// ═══════════════════════════════════════════════════════════════════════════

describe("stage×port Grid — transposed matrix, shared domain, truncated-but-discoverable port names (fan-out plan §7 point 5)", () => {
  it("population page: 5 columns share the identical [0, globalMax] domain, rows are the 4 stage labels", () => {
    const model = richFourStageModel();
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel3 = panelSlice(html, 3);

    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-stage-port-population");
    // globalMax across the whole 4×5 matrix is 10 (LONG_PORT × المستوى
    // الثاني) — every column's header prints "0–10" if and only if all 5
    // columns share that identical domain (a per-column independent scale
    // would print a different range per column instead).
    const figureStart = panel3.indexOf("<figure");
    const figureEnd = panel3.indexOf("</figure>") + "</figure>".length;
    const figureHtml = panel3.slice(figureStart, figureEnd);
    expect((figureHtml.match(/0–10/g) ?? []).length).toBe(5);

    for (const stageLabel of ["المستوى الأول", "المستوى الثاني", "المستوى الثالث", "المستوى الرابع"]) {
      expect(figureHtml).toContain(stageLabel);
    }
  });

  it("sample page: same shared-domain contract with the sample-mode globalMax (4)", () => {
    const model = richFourStageModel();
    const html = stagePortSampleSlide(model, 7, 20, true);
    const panel3 = panelSlice(html, 3);
    const figureStart = panel3.indexOf("<figure");
    const figureEnd = panel3.indexOf("</figure>") + "</figure>".length;
    const figureHtml = panel3.slice(figureStart, figureEnd);
    expect((figureHtml.match(/0–4/g) ?? []).length).toBe(5);
  });

  it("the long port name is truncated inside the chart/sr-table figure, but its FULL name is still discoverable in the page's own legend line", () => {
    const model = richFourStageModel();
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel3 = panelSlice(html, 3);

    const figureStart = panel3.indexOf("<figure");
    const figureEnd = panel3.indexOf("</figure>") + "</figure>".length;
    const figureHtml = panel3.slice(figureStart, figureEnd);

    const truncated = truncLabel(LONG_PORT, 10);
    expect(truncated).not.toBe(LONG_PORT); // sanity: this fixture's name is actually long enough to truncate
    expect(figureHtml).toContain(truncated);
    // metricMatrix's SVG header AND its paired sr-table both read the same
    // (truncated) column label — see truncLabel's own doc comment for why —
    // so the untouched full name must NOT appear inside the figure itself.
    expect(figureHtml).not.toContain(LONG_PORT);

    // The full, untruncated name IS discoverable elsewhere on the page: the
    // legend line this page adds specifically to keep it findable.
    expect(panel3).toContain("v2-gd-stage-port-legend");
    expect(panel3).toContain(LONG_PORT);

    // The 4 short port names never needed truncation in the first place.
    for (const shortName of ["ميناء ب", "ميناء هـ", "ميناء د", "ميناء ج"]) {
      expect(figureHtml).toContain(shortName);
    }
  });

  it("a (stage,port) pair with zero rows renders as a real tinted 0, never a hollow missing '—' cell", () => {
    // المستوى الثالث only has ميناء د — every OTHER top-5 column for that
    // row is a genuine zero, not "unmeasured."
    const model = richFourStageModel();
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel3 = panelSlice(html, 3);
    // metricMatrix renders a missing cell as an outlined dashed rect with a
    // "—" glyph and never fills a real value's tinted rect — with every
    // cell in this fixture being either a real count (possibly 0) and no
    // column shorter than rowLabels, there must be zero "missing" glyphs.
    const figureStart = panel3.indexOf("<figure");
    const figureEnd = panel3.indexOf("</figure>") + "</figure>".length;
    const figureHtml = panel3.slice(figureStart, figureEnd);
    expect(figureHtml).not.toContain('stroke-dasharray="3 3"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// General shape checks
// ═══════════════════════════════════════════════════════════════════════════

describe("stage×port pages — production variant + basic system shape", () => {
  it("production (variantPreview=false) renders only variant 0's markup, untouched", () => {
    const model = richFourStageModel();
    const html = stagePortPopulationSlide(model, 7, 20, false);
    expect(html).not.toContain("v2-sys-ledger");
    expect(html).not.toContain("v2-sys-brief");
    expect(html).not.toContain("v2-sys-grid");
    expect(html).toContain("v2-stage-port-grid");
  });

  it("Ledger slot has no chart/SVG markup", () => {
    const model = richFourStageModel();
    const html = stagePortPopulationSlide(model, 7, 20, true);
    const panel1 = panelSlice(html, 1);
    expect(panel1).not.toContain("<svg");
    expect(panel1).not.toContain("<figure");
  });

  it("Grid slot renders the SAME 5-port column set on both pages (page-wide top-5 by population, not per-mode)", () => {
    const model = richFourStageModel();
    const popHtml = panelSlice(stagePortPopulationSlide(model, 7, 20, true), 3);
    const sampleHtml = panelSlice(stagePortSampleSlide(model, 7, 20, true), 3);
    const truncated = truncLabel(LONG_PORT, 10);
    for (const html of [popHtml, sampleHtml]) {
      expect(html).toContain(truncated);
      for (const shortName of ["ميناء ب", "ميناء هـ", "ميناء د", "ميناء ج"]) {
        expect(html).toContain(shortName);
      }
    }
  });
});
