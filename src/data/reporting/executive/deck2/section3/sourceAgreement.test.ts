// src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts
import { describe, expect, it } from "vitest";

import type { EmployeeAnswerFile, FieldAnswer } from "../../../../answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import type { SampleMasterData } from "../../../../sampling/sampleTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import { buildReportModel } from "../../model/reportModel";
import { BASE_ROWS_PER_PAGE, COMPRESS_OVERFLOW_MAX } from "../slideKit";
import { SOURCE_AGREEMENT_CSS, sourceAgreementSlide } from "./sourceAgreement";

const NOW = "2026-06-01T00:00:00.000Z";

/** The reviewer's verdict field. With `template: null` the label resolver is
 *  empty, so `buildExecutiveReportRows` falls back to
 *  `config.expertResultFieldId` — the same id used here. */
const REVIEW_FIELD = DEFAULT_EXEC_CONFIG.expertResultFieldId;

type Result = "سليمة" | "اشتباه";

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
    // BI never provided — the honest default for this month's fixtures.
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

function answerFile(items: EmployeeAnswerFile["items"]): EmployeeAnswerFile {
  return { username: "emp", monthFolderName: "5-May-2026", items };
}

function answerItem(xrayImageId: string, answers: FieldAnswer[]): EmployeeAnswerFile["items"][number] {
  return {
    xrayImageId,
    templateId: "default",
    templateVersion: 1,
    answers,
    lastSavedAt: NOW,
    submittedAt: NOW,
    answeredBy: "emp",
    status: "submitted",
  };
}

function sampleOf(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: rows.length,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: NOW,
    drawnBy: "admin",
    rows,
  };
}

function input(
  populationRows: PreparedPopulationRow[],
  opts: { sample?: boolean; reviews?: Map<string, Result> } = {},
): ExecutiveReportInput {
  const reviews = opts.reviews;
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: opts.sample ? sampleOf(populationRows) : null,
    distribution: null,
    employeeFiles: reviews
      ? [
          answerFile(
            populationRows
              .filter((r) => reviews.has(r.xrayImageId))
              .map((r) => answerItem(r.xrayImageId, [{ fieldId: REVIEW_FIELD, value: reviews.get(r.xrayImageId)! }])),
          ),
        ]
      : [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

/**
 * 20 images with a deliberately known agreement profile:
 *   • L1 = سليمة on every image
 *   • L2 = سليمة on 15, اشتباه on 5      → L1 vs L2 agree 15/20 = 75%
 *   • reviewer = سليمة on 18, اشتباه on 2 → L1 vs reviewer 18/20 = 90%
 *                                          L2 vs reviewer 17/20 = 85%
 *   • manual / opposite / liveMeans stay null (BI never provided)
 */
function knownProfile(count = 20): {
  rows: PreparedPopulationRow[];
  reviews: Map<string, Result>;
} {
  const rows: PreparedPopulationRow[] = [];
  const reviews = new Map<string, Result>();
  for (let i = 0; i < count; i++) {
    const id = `XR-${i + 1}`;
    rows.push(
      popRow({
        xrayImageId: id,
        sourceRowNumber: i + 1,
        xrayLevelOneResult: "سليمة",
        xrayLevelTwoResult: i < 15 ? "سليمة" : "اشتباه",
      }),
    );
    reviews.set(id, i < 18 ? "سليمة" : "اشتباه");
  }
  return { rows, reviews };
}

/**
 * 20 images extending `knownProfile` with real manual/opposite/liveMeans
 * results (`knownProfile` leaves those three permanently null — "BI never
 * provided" — which is realistic for most months but can't exercise the new
 * levels×teams grid's real percentages). The L1/L2/reviewer patterns are
 * IDENTICAL to `knownProfile` (same seeds), so every existing assertion about
 * those three sources keeps holding; only the three BI-sourced fields are
 * newly populated:
 *   • manual    = سليمة on the first 16 images, اشتباه on the last 4
 *   • opposite  = سليمة on the first 10 images, اشتباه on the last 10
 *   • liveMeans = سليمة on the first 5 images,  اشتباه on the last 15
 * Exact resulting agreement rates are read off the built model in each test
 * (same "guard the fixture against drift" pattern `knownProfile`'s own tests
 * use), not hand-derived here.
 */
function knownTeamsProfile(count = 20): {
  rows: PreparedPopulationRow[];
  reviews: Map<string, Result>;
} {
  const rows: PreparedPopulationRow[] = [];
  const reviews = new Map<string, Result>();
  for (let i = 0; i < count; i++) {
    const id = `XR-${i + 1}`;
    const manual: Result = i < 16 ? "سليمة" : "اشتباه";
    const opposite: Result = i < 10 ? "سليمة" : "اشتباه";
    const liveMeans: Result = i < 5 ? "سليمة" : "اشتباه";
    rows.push(
      popRow({
        xrayImageId: id,
        sourceRowNumber: i + 1,
        xrayLevelOneResult: "سليمة",
        xrayLevelTwoResult: i < 15 ? "سليمة" : "اشتباه",
        otherResults: {
          manual: { result: manual, code: null, employeeId: null },
          opposite: { result: opposite, code: null, employeeId: null },
          liveMeans: { result: liveMeans, code: null, employeeId: null },
        },
      }),
    );
    reviews.set(id, i < 18 ? "سليمة" : "اشتباه");
  }
  return { rows, reviews };
}

function render(inp: ExecutiveReportInput): string {
  return sourceAgreementSlide(buildReportModel(inp), 12, 24, false);
}

/** The muted cell `threshCell(null, …)` emits — the page's "not enough data" state. */
const MUTED_RATE_CELL = '<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>';

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("sourceAgreementSlide — slide shell", () => {
  it("renders the section-3 identity, title, subhead and icon", () => {
    const { rows, reviews } = knownProfile();
    const html = render(input(rows, { sample: true, reviews }));
    expect(html).toContain('id="slide-s3-source-agreement"');
    expect(html).toContain('data-section="section3"');
    expect(html).toContain('data-title="توافق النتائج بين المستويات والمصادر"');
    expect(html).toContain("القسم 3 — التحاليل المتقدمة");
    expect(html).toContain(
      "نسبة تطابق النتيجة بين كل مصدرين، ومقارنة كل مصدر بنتيجة المراجع.",
    );
    // Production mode never emits the dev-preview variant stack.
    expect(html).not.toContain('<div class="v2-variant-stack"');
  });

  it("renders all four variant panels in preview mode, identical bodies", () => {
    const { rows, reviews } = knownProfile();
    const html = sourceAgreementSlide(buildReportModel(input(rows, { sample: true, reviews })), 12, 24, true);
    expect(countOf(html, '<div class="v2-variant-stack"')).toBe(1);
    expect(countOf(html, 'data-variant-index="')).toBe(4);
  });
});

describe("sourceAgreementSlide — the two facts the page must not misrepresent", () => {
  it("states the asymmetric comparison scope verbatim", () => {
    const { rows, reviews } = knownProfile();
    const html = render(input(rows, { sample: true, reviews }));
    expect(html).toContain(
      "المقارنات التي تشمل «المراجع» تقتصر على صور العيّنة المدروسة؛ وما عداها يشمل مجتمع الشهر كاملًا.",
    );
  });

  it("says the two levels are inspection levels, not the four risk levels, and uses no severity wording", () => {
    const { rows, reviews } = knownProfile();
    const html = render(input(rows, { sample: true, reviews }));
    expect(html).toContain("«المستوى الأول» و«المستوى الثاني» هنا هما مستويا فحص الأشعة، وليسا مستويات المخاطر الأربعة.");
    for (const word of ["خطورة", "الأشد", "الأخطر", "تصاعدي", "الأعلى خطورة"]) {
      expect(html).not.toContain(word);
    }
  });

  it("uses the confirmed Arabic source labels", () => {
    const { rows, reviews } = knownProfile();
    const html = render(input(rows, { sample: true, reviews }));
    for (const label of [
      "المستوى الأول",
      "المستوى الثاني",
      "التفتيش اليدوي",
      "التفتيش المعاكس",
      "الوسائل الحية",
    ]) {
      expect(html).toContain(label);
    }
    // "المراجع (المعيار)" is no longer shown on the default view (2026-07-28
    // rework: the reviewer card compares both levels against the reviewer
    // without ever spelling out this specific compound label as a row header
    // of its own) — it still appears in the Ledger/Briefing variants, which
    // still walk all 15 source pairs including reviewer pairs.
    const preview = sourceAgreementSlide(
      buildReportModel(input(rows, { sample: true, reviews })),
      12,
      24,
      true,
    );
    expect(preview).toContain("المراجع (المعيار)");
  });
});

describe("sourceAgreementSlide — honest empty states", () => {
  it("BI never provided: manual / opposite / liveMeans are — everywhere with العيّنة = 0, never 0%", () => {
    const { rows, reviews } = knownProfile();
    const html = render(input(rows, { sample: true, reviews }));

    // Exactly the three BI-only sources are muted in the reviewer table; the
    // two X-ray levels have real rates (asserted in the next describe block).
    expect(countOf(html, MUTED_RATE_CELL)).toBe(3);
    // Their comparable count is printed as a real zero — a count, not a rate.
    expect(html).toContain("<td>0</td>");
    // The suppressed matrix cells render the heatmap's dashed em-dash, not 0%.
    expect(html).toContain(">—</text>");
    expect(html).not.toContain(">0%</text>");
    expect(html).not.toContain("<td>0%</td>");
  });

  it("nothing studied: the whole reviewer row and column are suppressed", () => {
    // No employeeFiles and no sample → no reviewer verdicts at all.
    const { rows } = knownProfile();
    const model = buildReportModel(input(rows));
    expect(model.sample.studied).toBe(0);
    for (const row of model.resultComparison.reviewerAgreement) {
      expect(row.comparable).toBe(0);
      expect(row.agreementRate).toBeNull();
    }

    const html = sourceAgreementSlide(model, 12, 24, false);
    // All five reviewer rows muted…
    expect(countOf(html, MUTED_RATE_CELL)).toBe(5);
    // …and the totals row too (pctCell's muted form).
    expect(html).toContain('<td><span class="insuff">—</span></td>');
    // The one pair that does NOT involve the reviewer (level1↔level2) is the
    // standalone stat callout, not the grid — it still reports (20 images).
    const statStart = html.indexOf('class="s3sa-lvl-stat"');
    expect(statStart).toBeGreaterThan(-1);
    expect(html.slice(statStart, html.indexOf("</div>", statStart) + "</div>".length)).toContain("75.0%");
  });
});

describe("sourceAgreementSlide — rates, gating and ن", () => {
  it("prints the known level×team agreement percentages in the new grid, level1×level2 in the stat callout, and keeps level×reviewer in the reviewer table only", () => {
    const { rows, reviews } = knownTeamsProfile();
    const model = buildReportModel(input(rows, { sample: true, reviews }));

    // Guard the fixture itself against drift in the aggregate layer.
    const find = (a: string, b: string) =>
      model.resultComparison.crossTeamMatrix.find(
        (c) => (c.sourceA === a && c.sourceB === b) || (c.sourceA === b && c.sourceB === a),
      )!;
    expect(find("levelOne", "manual").agreementRate).toBe(80);
    expect(find("levelOne", "opposite").agreementRate).toBe(50);
    expect(find("levelOne", "liveMeans").agreementRate).toBe(25);
    expect(find("levelTwo", "manual").agreementRate).toBe(95);
    expect(find("levelTwo", "opposite").agreementRate).toBe(75);
    expect(find("levelTwo", "liveMeans").agreementRate).toBe(50);
    expect(find("levelOne", "levelTwo").agreementRate).toBe(75);

    const html = sourceAgreementSlide(model, 12, 24, false);

    // The level×team cells render as real heatmap percentages.
    for (const pct of [80, 50, 25, 95, 75]) {
      expect(html).toContain(`>${pct}%</text>`);
    }

    // level1↔level2 is the standalone stat callout, NOT a grid cell.
    const statStart = html.indexOf('class="s3sa-lvl-stat"');
    expect(statStart).toBeGreaterThan(-1);
    expect(html.slice(statStart, html.indexOf("</div>", statStart) + "</div>".length)).toContain("75.0%");

    // level×reviewer numbers stay in the reviewer table only — never
    // re-added to the new grid (the reviewer card next to it already
    // covers them).
    expect(html).toContain("90.0%");
    expect(html).toContain("85.0%");
    expect(html).not.toContain(">90%</text>");
    expect(html).not.toContain(">85%</text>");
    // Below-target rows carry the alert glyph, so status is never colour-alone.
    expect(html).toContain('<td class="v2-bar-cell warn"');
    expect(html).toContain('class="v2-cell-flag"');
  });

  it("suppresses the level1↔level2 stat below the sufficiency cut but still shows its count", () => {
    // 5 comparable images → band "insufficient" → not rankable.
    const { rows } = knownProfile(5);
    const html = render(input(rows));
    const statStart = html.indexOf('class="s3sa-lvl-stat"');
    expect(statStart).toBeGreaterThan(-1);
    const statHtml = html.slice(statStart, html.indexOf("</div>", statStart) + "</div>".length);
    expect(statHtml).toContain('class="insuff"');
    expect(statHtml).not.toContain("100.0%");
    expect(statHtml).toContain("5 صورة");
  });

  it("shows the level1↔level2 stat rate again once the pair reaches the rankable band", () => {
    // 10 comparable images → band "limited" → rankable.
    const { rows } = knownProfile(10);
    const html = render(input(rows));
    const statStart = html.indexOf('class="s3sa-lvl-stat"');
    const statHtml = html.slice(statStart, html.indexOf("</div>", statStart) + "</div>".length);
    expect(statHtml).toContain("100.0%");
    expect(statHtml).toContain("10 صورة");
  });

  it("suppresses a level×team grid cell below the sufficiency cut but still shows its ن", () => {
    // 5 comparable images → band "insufficient" → not rankable, for every pair.
    const { rows } = knownTeamsProfile(5);
    const html = render(input(rows));
    expect(html).not.toContain("<td>100%</td>");
    expect(html).toContain(">—</text>");
    // ن is still disclosed for the suppressed level×team cells.
    const countsStart = html.indexOf("عدد الصور القابلة للمقارنة");
    expect(countsStart).toBeGreaterThan(-1);
    expect(html.slice(countsStart, countsStart + 500)).toContain("<td>5</td>");
  });

  it("shows a level×team grid cell's rate again once it reaches the rankable band", () => {
    // 10 comparable images → band "limited" → rankable.
    const { rows } = knownTeamsProfile(10);
    const html = render(input(rows));
    expect(html).toContain(">100%</text>");
    const countsStart = html.indexOf("عدد الصور القابلة للمقارنة");
    expect(html.slice(countsStart, countsStart + 500)).toContain("<td>10</td>");
  });

  it("renders no rows at all without throwing when the month is empty", () => {
    const html = render(input([]));
    expect(html).toContain('id="slide-s3-source-agreement"');
    expect(countOf(html, MUTED_RATE_CELL)).toBe(5);
    expect(html).not.toContain("%</text>");
  });
});

describe("sourceAgreementSlide — structure & determinism", () => {
  it("keeps the reviewer table at five rows plus a filler row and a totals row", () => {
    const { rows, reviews } = knownProfile();
    const html = render(input(rows, { sample: true, reviews }));
    expect(countOf(html, '<tr class="v2-fill-row"')).toBe(1);
    expect(html).toContain("<tfoot><tr>");
    expect(html).toContain("الإجمالي");
    // No pagination / compact tier is needed for five rows.
    expect(html).not.toContain("v2-port-col compact");
    expect(html).not.toContain("(تابع)");
  });

  it("is pure — the same model renders byte-identical HTML", () => {
    const { rows, reviews } = knownProfile();
    const model = buildReportModel(input(rows, { sample: true, reviews }));
    expect(sourceAgreementSlide(model, 12, 24, false)).toBe(sourceAgreementSlide(model, 12, 24, false));
    // …and two independently built models of the same input agree too.
    const a = render(input(rows, { sample: true, reviews }));
    const b = render(input(rows, { sample: true, reviews }));
    expect(a).toBe(b);
  });

  it("exports page-local CSS with no raw hex colour literals", () => {
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-split");
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-ngrid");
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-foot");
    expect(SOURCE_AGREEMENT_CSS).toContain(".s3sa-lvl-stat");
    expect(SOURCE_AGREEMENT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Ledger / Briefing / Grid fan-out (fan-out plan §11d, batch B3 item 2)
// ═══════════════════════════════════════════════════════════════════════════

/** Isolate one variant panel's HTML — same technique deck2.test.ts /
 *  fanoutB2a.test.ts / fanoutB3StagePort.test.ts all use. */
function panelSlice(html: string, index: 0 | 1 | 2 | 3): string {
  const start = html.indexOf(`data-variant-index="${index}"`);
  expect(start).toBeGreaterThan(-1);
  if (index === 3) return html.slice(start);
  const end = html.indexOf(`data-variant-index="${index + 1}"`);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

function renderPreview(inp: ExecutiveReportInput): string {
  return sourceAgreementSlide(buildReportModel(inp), 12, 24, true);
}

const SCOPE_TEXT =
  "المقارنات التي تشمل «المراجع» تقتصر على صور العيّنة المدروسة؛ وما عداها يشمل مجتمع الشهر كاملًا.";
const LEVEL_TEXT = "«المستوى الأول» و«المستوى الثاني» هنا هما مستويا فحص الأشعة، وليسا مستويات المخاطر الأربعة.";

describe("sourceAgreementSlide — Ledger (panel 1)", () => {
  it("renders a 15-pair table split 8/7 across two sub-tables, beside the reviewer table, in a v2-lg-split layout", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 1);

    expect(panel).toContain('class="v2-sys-ledger s3sa-lg"');
    expect(panel).toContain('class="v2-lg-split"');
    expect(panel).toContain("s3sa-lg-pairs");

    const pairTables = panel.match(/class="deck-table s3sa-lg-pair-table"/g) ?? [];
    expect(pairTables.length).toBe(2);

    // 20 ordinal badges total: 15 pairs (both sub-tables) + 5 reviewer rows
    // (ledgerPortCard's own ordinals) — the strongest structural proof all 15
    // pairs are actually rendered, not just "a table exists".
    expect(countOf(panel, 'class="v2-lg-idx"')).toBe(20);

    // 8 + 7 split: count <tr> rows inside each sub-table's own tbody
    // specifically (bounded to its own </table>, not the rest of the panel).
    const subTables = [...panel.matchAll(/<table class="deck-table s3sa-lg-pair-table">[\s\S]*?<\/table>/g)].map(
      (m) => m[0],
    );
    expect(subTables.length).toBe(2);
    const rowsInA = (subTables[0].match(/<tr>/g) ?? []).length - 1; // minus the thead row
    const rowsInB = (subTables[1].match(/<tr>/g) ?? []).length - 1;
    expect(rowsInA).toBe(8);
    expect(rowsInB).toBe(7);

    // The reviewer table (P2 ledgerPortCard) sits beside it — 5 rows, own ordinals.
    expect(panel).toContain("v2-lg-port-card");
    expect(panel).toContain("المقارنة بنتيجة المراجع");
  });

  it("drops the ن grid in Ledger only — the pair table's count column already carries it", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 1);
    expect(panel).not.toContain("s3sa-ngrid");
  });

  it("has ZERO chart markup anywhere in its panel — the strongest 'no charts in Ledger' check", () => {
    // Small icon glyphs (e.g. threshCell's below-target alert flag) are ALSO
    // inline <svg> — that's the deck-wide icon() convention, not a chart, and
    // is legitimate inside Ledger (spec §2: functional colour/glyphs are
    // Ledger-legal). The genuinely distinguishing signal is analyticsCharts.ts's
    // OWN markup: every chart figure it builds carries a `data-chart="…"`
    // attribute (see percentHeatmap/metricMatrix's svgOpen()) and wraps its
    // SVG in a <figure> — neither ever appears from a plain icon() call. So
    // checking those two markers, not a blanket "<svg", is what actually
    // proves no chart slipped into Ledger.
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 1);
    expect(panel).toContain("<svg"); // sanity: icon glyphs (e.g. the alert flag) DO still appear
    expect(panel).not.toContain("<figure");
    expect(panel).not.toContain('data-chart="');
    expect(panel).not.toContain("percentHeatmap");
  });

  it("carries both mandatory footnotes verbatim", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 1);
    expect(panel).toContain(SCOPE_TEXT);
    expect(panel).toContain(LEVEL_TEXT);
  });

  it("2026-07-28 whole-branch-review fix (C6): shows NO totals figure for the 15-pair table — a colspan-style note explains why, instead of a double/multi-counted sum", () => {
    // Each of the 6 sources appears in 5 of the 15 pairs, so summing
    // `comparable`/`agree` across all 15 rows would count every comparable
    // image up to 5-10× over — never a genuine total. This used to render
    // as "الإجمالي" + a fabricated pooled rate/count; it must not anymore.
    const { rows, reviews } = knownProfile();
    const model = buildReportModel(input(rows, { sample: true, reviews }));
    const html = sourceAgreementSlide(model, 12, 24, true);
    const panel = panelSlice(html, 1);
    // Exactly one explanatory bar (same slot the old totals line used),
    // never per-sub-column.
    expect(countOf(panel, "s3sa-lg-pair-totals")).toBe(1);
    expect(panel).not.toContain("<span>الإجمالي</span>");
    const notesBar = panel.slice(panel.indexOf('class="s3sa-lg-pair-totals"'));
    expect(notesBar).toContain("لا يوجد إجمالي واحد صحيح لهذا الجدول");
  });

  it("does NOT affect the reviewer table's own totals row — that pools 5 DISTINCT non-reviewer sources, a legitimate total, and is left unchanged", () => {
    const { rows, reviews } = knownProfile();
    const model = buildReportModel(input(rows, { sample: true, reviews }));
    const html = sourceAgreementSlide(model, 12, 24, true);
    const panel = panelSlice(html, 1);
    expect(panel).toContain("<td>الإجمالي</td>");
  });

  describe("15-row pair-table budget (worked arithmetic, not eyeballed)", () => {
    // Measured LIVE in deck-preview.html (1120px slide width) via
    // getBoundingClientRect on the actual rendered page, per this session's
    // browser-driven verification (see the doc comment above
    // `pairsLedgerCard` in sourceAgreement.ts for the full narrative,
    // including the real bug this caught: unconstrained column auto-sizing
    // wrapped rows to 3 lines and the pairs card visually overlapped the
    // footnote strip below it before `table-layout:fixed` + explicit column
    // widths were added).
    const AVAILABLE_SPLIT_BUDGET_PX = 396; // .v2-lg-split's real available height before the mandatory footnote
    const MEASURED_CARD_HEIGHT_PX = 290; // pairsLedgerCard's real rendered height with this fixture's data
    const WORST_CASE_ROW_PX = 30; // measured full-2-line-wrap row height at the tightened column widths
    const THEAD_PX = 20;
    const ROWS_PER_SUBCOLUMN = 8; // ceil(15 / 2) — see PAIR_SPLIT_AT
    const CARD_CHROME_PX = 60; // title + totals bar + their margins/gaps (measured)

    it("the real measured card height fits the real measured split budget, with margin to spare", () => {
      expect(MEASURED_CARD_HEIGHT_PX).toBeLessThan(AVAILABLE_SPLIT_BUDGET_PX);
      expect(AVAILABLE_SPLIT_BUDGET_PX - MEASURED_CARD_HEIGHT_PX).toBeGreaterThan(50);
    });

    it("a synthetic worst case — every one of the 8 rows in a sub-column wraps to 2 full lines — still fits the budget", () => {
      const worstCaseTableHeight = ROWS_PER_SUBCOLUMN * WORST_CASE_ROW_PX + THEAD_PX;
      const worstCaseCardHeight = worstCaseTableHeight + CARD_CHROME_PX;
      expect(worstCaseCardHeight).toBeLessThan(AVAILABLE_SPLIT_BUDGET_PX);
    });

    it("15 rows exceeds this deck's own documented single-column Ledger row ceiling — the split is load-bearing, not cosmetic", () => {
      // BASE_ROWS_PER_PAGE + COMPRESS_OVERFLOW_MAX (slideKit.ts) is this
      // deck's own measured, documented ceiling for how many rows a single
      // Ledger/port table column can safely hold before it must paginate or
      // otherwise restructure (7 base + 3 compact-tier overflow = 10). All 15
      // pairs in one packed column would exceed that documented ceiling;
      // splitting into 8 + 7 sub-columns brings each column's row count back
      // under it.
      const SINGLE_COLUMN_ROW_CEILING = BASE_ROWS_PER_PAGE + COMPRESS_OVERFLOW_MAX;
      const ROW_COUNT = 15;
      expect(ROW_COUNT).toBeGreaterThan(SINGLE_COLUMN_ROW_CEILING);
      expect(ROWS_PER_SUBCOLUMN).toBeLessThanOrEqual(SINGLE_COLUMN_ROW_CEILING);
    });
  });
});

describe("sourceAgreementSlide — Briefing (panel 2)", () => {
  it("ledes with the overall reviewer agreement rate (reviewerTotals' totalRate), scope-disclosure basis, tone green", () => {
    const { rows, reviews } = knownProfile();
    const model = buildReportModel(input(rows, { sample: true, reviews }));
    const totalRate = model.resultComparison.reviewerAgreement.reduce(
      (acc, r) => {
        acc.agree += r.agree;
        acc.comparable += r.comparable;
        return acc;
      },
      { agree: 0, comparable: 0 },
    );
    // Sanity: the fixture's own reviewer rows sum as expected (90%/85%/— triple).
    expect(totalRate.comparable).toBe(40); // 20 (L1×review) + 20 (L2×review); manual/opposite/liveMeans are 0

    const html = sourceAgreementSlide(model, 12, 24, true);
    const panel = panelSlice(html, 2);
    expect(panel).toContain('class="v2-sys-brief s3sa-bf"');
    expect(panel).toContain('<div class="v2-bf-lede-figure green">');
    expect(panel).toContain("التوافق العام مع المراجع");
    expect(panel).toContain("يقتصر التوافق مع المراجع على صور العيّنة المدروسة");
  });

  it("support strip carries the highest pair, lowest pair, and count of compared pairs", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 2);
    expect(panel).toContain("أعلى زوج توافقًا");
    expect(panel).toContain("أدنى زوج توافقًا");
    expect(panel).toContain("عدد الأزواج المقارَنة");
    // This fixture has exactly 3 pairs with any comparable images at all
    // (L1×L2, L1×review, L2×review) — the other 12 (BI never provided) are 0.
    expect(panel).toContain("<b>3</b>");
  });

  it("gate-suppressed pairs are EXCLUDED from ranking and folded into a bar-less remainder — never a fabricated rate", () => {
    // knownProfile's manual/opposite/liveMeans sources are always null (BI
    // never provided), so their 12 pairs (out of the 15) all have
    // comparable=0 → band "none" → NOT rankable. Only 3 pairs (L1×L2,
    // L1×review, L2×review) are rankable. This is a real, naturally-occurring
    // gate-suppression case, not a contrived one.
    const { rows, reviews } = knownProfile();
    const model = buildReportModel(input(rows, { sample: true, reviews }));
    const suppressedPairs = model.resultComparison.crossTeamMatrix.filter((c) => c.comparable === 0);
    expect(suppressedPairs.length).toBe(12);

    const html = sourceAgreementSlide(model, 12, 24, true);
    const panel = panelSlice(html, 2);

    // Exactly 3 REAL named rows (rank #1–3) plus 1 excluded-placeholder row =
    // 4 total rows — small enough (briefingRankPlan's comfortable-tier cap is
    // 5) that the density ladder never auto-folds on top of this: the
    // excluded row below comes from THIS page's own exclusion push, not a
    // `foldRemainder` invocation.
    expect((panel.match(/class="v2-bf-rank-row/g) ?? []).length).toBe(4);

    // The excluded pairs get their OWN row, immediately after their label,
    // with a "—" value — never a fabricated rate. comparable=0 for every
    // excluded pair → rateOf/gatedRate → null → pctCell renders "—".
    expect(panel).toContain("أزواج دون حد الكفاية (12)");
    const excludedRowMatch = panel.match(
      /<span class="v2-bf-rank-label">أزواج دون حد الكفاية \(12\)<\/span>[\s\S]*?<span class="v2-bf-rank-value">([^<]*)<\/span>/,
    );
    expect(excludedRowMatch).not.toBeNull();
    expect(excludedRowMatch![1]).toBe("—");
    expect(panel).not.toContain("أزواج دون حد الكفاية (12)%");
    // Its bar track (if bars render at all here) carries zero width — no
    // fabricated magnitude either.
    const excludedTrackMatch = panel.match(
      /<span class="v2-bf-rank-label">أزواج دون حد الكفاية \(12\)<\/span>\s*<span class="v2-bf-rank-track"><i class="v2-bf-rank-fill \w+" style="width:([\d.]+)%">/,
    );
    if (excludedTrackMatch) {
      expect(excludedTrackMatch[1]).toBe("0.0");
    }
  });

  it("named rank rows are the 3 rankable pairs sorted by agreement rate, each with a real (non-fabricated) rate", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 2);
    // Known profile rates: L1×L2 75%, L1×review 90%, L2×review 85% — sorted
    // descending: 90, 85, 75.
    const values = [...panel.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values[0]).toContain("90");
    expect(values[1]).toContain("85");
    expect(values[2]).toContain("75");
  });

  it("carries both mandatory footnotes verbatim", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 2);
    expect(panel).toContain(SCOPE_TEXT);
    expect(panel).toContain(LEVEL_TEXT);
  });
});

describe("sourceAgreementSlide — Grid (panel 3)", () => {
  it("renders two gridPanel-wrapped panels side by side: the heatmap matrix and the reviewer metricMatrix", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 3);

    expect(panel).toContain('class="v2-sys-grid s3sa-gd"');
    expect(panel).toContain('class="v2-gd-split"');
    // The exact panel-wrapper class only — not `v2-gd-panel-head`/`-chart`,
    // which also start with the same "v2-gd-panel" substring.
    expect((panel.match(/class="v2-gd-panel (matrix|reviewer)"/g) ?? []).length).toBe(2);
    expect(panel).toContain('class="v2-gd-panel matrix"');
    expect(panel).toContain('class="v2-gd-panel reviewer"');
  });

  it("keeps the ن grid beneath the heatmap — unlike Ledger, Grid does NOT drop it", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 3);
    expect(panel).toContain("s3sa-ngrid");
    expect(panel).toContain("عدد الصور القابلة للمقارنة");
  });

  it("the reviewer matrix has the right shape: 5 source rows × 4 metric columns with the plan's column names", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 3);

    // Isolate the reviewer-matrix panel specifically — the HEATMAP panel
    // legitimately lists all 6 sources (including "المراجع (المعيار)") in
    // its own sr-table, so a whole-panel substring check would be a false
    // negative/positive either way. The reviewer panel starts at its own
    // gridPanel title text.
    const revStart = panel.indexOf('class="v2-gd-panel reviewer"');
    expect(revStart).toBeGreaterThan(-1);
    const revHtml = panel.slice(revStart);

    for (const label of [
      "المستوى الأول",
      "المستوى الثاني",
      "التفتيش اليدوي",
      "التفتيش المعاكس",
      "الوسائل الحية",
    ]) {
      expect(revHtml).toContain(label);
    }
    // The reviewer itself is never a row in its own comparison matrix.
    expect(revHtml).not.toContain("المراجع (المعيار)");
    // Exactly 5 row headers in its accessible sr-table (5 sources, not 6).
    expect((revHtml.match(/<th scope="row">/g) ?? []).length).toBe(5);

    for (const col of ["التوافق مع المراجع", "اشتباه لديه–سليمة للمراجع", "سليمة لديه–اشتباه للمراجع", "العيّنة"]) {
      expect(revHtml).toContain(col);
    }
    // 5 column headers total in the sr-table: the row-header column
    // ("المصدر") plus the 4 metric columns — المجتمع/العيّنة's own base is
    // disclosed via the panel sub-line, not encoded as a SEPARATE 6th metric
    // column (same discipline portAgreement's Grid variant uses for its own
    // dropped column).
    expect((revHtml.match(/<th scope="col">/g) ?? []).length).toBe(5);
  });

  it("carries both mandatory footnotes verbatim", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel = panelSlice(html, 3);
    expect(panel).toContain(SCOPE_TEXT);
    expect(panel).toContain(LEVEL_TEXT);
  });
});

describe("sourceAgreementSlide — the 4 systems render distinct, non-degenerate bodies", () => {
  it("panel 0 (slot 0) is untouched (byte-identical to production), panels 1-3 are genuinely different from it and each other", () => {
    const { rows, reviews } = knownProfile();
    const html = renderPreview(input(rows, { sample: true, reviews }));
    const panel0 = panelSlice(html, 0);
    const panel1 = panelSlice(html, 1);
    const panel2 = panelSlice(html, 2);
    const panel3 = panelSlice(html, 3);
    expect(panel0).toContain('class="s3sa"');
    const bodies = [panel0, panel1, panel2, panel3];
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        expect(bodies[i]).not.toBe(bodies[j]);
      }
    }
  });
});
