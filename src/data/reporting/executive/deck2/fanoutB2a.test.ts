// src/data/reporting/executive/deck2/fanoutB2a.test.ts
//
// Tests for batch B2a of the deck2 three-system fan-out (docs/superpowers/specs/
// 2026-07-25-deck2-fanout-remaining-pages-plan.md §6/§8/§9): slide-port-sample,
// slide-quality-ports, slide-quality-accuracy — "mechanical clones" of the
// already-shipped port-population exemplar, but each with its own correctness
// risk the plan calls out explicitly:
//   - port-sample: foldRemainder must SUM sampleTotal and pool coverage from
//     summed numerator/denominator, never average per-port rates.
//   - quality-ports: evaluated===0 ports must be excluded from Briefing ranking
//     and folded into a disclosed (not silently dropped) bar-less remainder,
//     pooled as ΣlowQ/Σevaluated.
//   - quality-accuracy: unrankable ports (below the data-sufficiency threshold)
//     must be excluded from ranking the same way, ranked ASCENDING (worst
//     first), and Grid must still show العيّنة for unrankable ports even though
//     their rate columns are null.
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput, ExecutiveReportRow } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildReportModel } from "../model/reportModel";
import type { ReportModel } from "../model/reportModel";
import { band } from "../model/dataSufficiency";
import type { KeyedAccuracy } from "../model/aggregates";
import { accuracyPortSlideBuilders, portSampleSlideBuilders, qualityPortSlideBuilders } from "./slides";
import { fmtNum, fmtPct } from "../primitives";

// ── Fixtures (same shape as deck2/deck2.test.ts and section3/*.test.ts) ────

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

function reportRow(overrides: Partial<ExecutiveReportRow> = {}): ExecutiveReportRow {
  return {
    xrayImageId: "XR-1",
    portCode: "P1",
    portName: "منفذ الاختبار",
    portType: "منفذ بري",
    movementType: "بري",
    stage: "المستوى الثاني",
    levelOneEmployeeId: null,
    levelTwoEmployeeId: null,
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: false,
    assignedTo: null,
    distributionStatus: null,
    expertResult: "سليمة",
    imageAvailable: true,
    noImageReason: null,
    hasMarking: true,
    imageQuality: null,
    lowQualityReason: null,
    suspicionLevel: null,
    suspectedTypes: null,
    smuggleMethod: null,
    answerStatus: "submitted",
    assignedAt: null,
    submittedAt: null,
    imageResultAccurate: true,
    levelOneAccurate: true,
    levelTwoAccurate: true,
    verificationCategory: "correct-clean",
    otherResults: {
      manual: { result: null, employeeId: null },
      opposite: { result: null, employeeId: null },
      liveMeans: { result: null, employeeId: null },
    },
    notes: null,
    ...overrides,
  };
}

/** A real model (so every untouched field is realistic) with `rows` swapped
 *  for a controlled fixture — same technique section3/*.test.ts uses. */
function modelWithRows(rows: ExecutiveReportRow[]): ReportModel {
  return { ...buildReportModel(input([popRow()])), rows };
}

/** Same, but also swaps `portAccuracy` (quality-accuracy reads BOTH: `rows`
 *  for land/sea port classification, `portAccuracy` for the actual rates). */
function modelWithAccuracy(rows: ExecutiveReportRow[], portAccuracy: KeyedAccuracy[]): ReportModel {
  return { ...buildReportModel(input([popRow()])), rows, portAccuracy };
}

function rate(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

type Counts = {
  evaluable: number;
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
};

/** A `model.portAccuracy` entry with fully consistent derived rates (mirrors
 *  section3/workloadAccuracy.test.ts's own `portAcc` helper). */
function portAcc(key: string, c: Counts): KeyedAccuracy {
  const reviewerSuspicious = c.correctSuspicion + c.missedSuspicion;
  return {
    key,
    ...c,
    accuracyByDecision: rate(c.correctClean + c.correctSuspicion, c.evaluable),
    detectionRate: rate(c.correctSuspicion, reviewerSuspicious),
    missedSuspicionRateByDecision: rate(c.missedSuspicion, reviewerSuspicious),
    suspicionDecisionAccuracy: rate(c.correctSuspicion, c.correctSuspicion + c.falseSuspicion),
    falseSuspicionRate: rate(c.falseSuspicion, c.correctClean + c.falseSuspicion),
    band: band(c.evaluable),
  };
}

/** Isolate one variant panel's HTML (data-variant-index="N" up to the next
 *  panel, or end-of-string for panel 3) — same technique deck2.test.ts uses. */
function panelSlice(html: string, index: 0 | 1 | 2 | 3): string {
  const start = html.indexOf(`data-variant-index="${index}"`);
  expect(start).toBeGreaterThan(-1);
  if (index === 3) return html.slice(start);
  const end = html.indexOf(`data-variant-index="${index + 1}"`);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

// ═══════════════════════════════════════════════════════════════════════════
// slide-port-sample (fan-out plan §6)
// ═══════════════════════════════════════════════════════════════════════════

describe("portSampleSlideBuilders — Ledger/Briefing/Grid (fan-out plan §6, batch B2a)", () => {
  function twoPortModel(): ReportModel {
    return modelWithRows([
      // منفذ أ (land): 5 rows, 3 in-sample (2 clean + 1 suspicious) → coverage 60%.
      reportRow({ xrayImageId: "L-1", portName: "منفذ أ", portType: "منفذ بري", imageResult: "سليمة", selectedInSample: true }),
      reportRow({ xrayImageId: "L-2", portName: "منفذ أ", portType: "منفذ بري", imageResult: "سليمة", selectedInSample: true }),
      reportRow({ xrayImageId: "L-3", portName: "منفذ أ", portType: "منفذ بري", imageResult: "اشتباه", selectedInSample: true }),
      reportRow({ xrayImageId: "L-4", portName: "منفذ أ", portType: "منفذ بري", imageResult: "سليمة", selectedInSample: false }),
      reportRow({ xrayImageId: "L-5", portName: "منفذ أ", portType: "منفذ بري", imageResult: "سليمة", selectedInSample: false }),
      // منفذ ب (sea): 2 rows, 1 in-sample → coverage 50%.
      reportRow({ xrayImageId: "S-1", portName: "منفذ ب", portType: "منفذ بحري", imageResult: "سليمة", selectedInSample: true }),
      reportRow({ xrayImageId: "S-2", portName: "منفذ ب", portType: "منفذ بحري", imageResult: "اشتباه", selectedInSample: false }),
    ]);
  }

  it("(a) Ledger: no chart/SVG markup, ordinal badges, frac() sample-mode cells, and the التغطية column", () => {
    const html = portSampleSlideBuilders(twoPortModel(), true)[0](6, 20);
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain("v2-sys-ledger");
    expect(panel1).toContain("v2-lg-port-sample");
    expect(panel1).not.toContain("v2-sys-brief");
    expect(panel1).not.toContain("v2-sys-grid");
    // No chart/icon markup at all in a Ledger card (unlike slot 0's iconed
    // .v2-port-col-head, ledgerPortCard has no icon slot).
    expect(panel1).not.toContain("<svg");
    expect(panel1).not.toContain("<figure");
    // Ordinal badges + sample-mode padding hook.
    expect(panel1).toContain('<span class="v2-lg-idx">1</span>منفذ أ');
    expect(panel1).toContain("sample-mode");
    // frac() stacked cells and the التغطية column.
    expect(panel1).toContain("<th>التغطية</th>");
    expect(panel1).toContain(`<b>${fmtNum(3)}</b><span>من ${fmtNum(5)}</span>`);
    expect(panel1).toContain(fmtPct(60));
  });

  it("(b) Briefing: leading port by sampleTotal (not population total), tone blue, coverage in the secondary line", () => {
    const html = portSampleSlideBuilders(twoPortModel(), true)[0](6, 20);
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain("v2-sys-brief");
    expect(panel2).toContain("v2-bf-port-sample");
    expect(panel2).toContain(`<div class="v2-bf-lede-figure blue">${fmtNum(3)}</div>`);
    expect(panel2).toContain("أعلى منفذ عيّنةً: منفذ أ");
    // Rank order by sampleTotal desc: منفذ أ (3) before منفذ ب (1).
    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(["منفذ أ", "منفذ ب"]);
    expect(panel2).toContain(`من ${fmtNum(5)} · تغطية ${fmtPct(60)}`);
    expect(panel2).toContain(`من ${fmtNum(2)} · تغطية ${fmtPct(50)}`);
  });

  it("(c) Grid: العيّنة/المجتمع/التغطية/اشتباه العيّنة columns, land/sea panels, sequential-gold only", () => {
    const html = portSampleSlideBuilders(twoPortModel(), true)[0](6, 20);
    const panel3 = panelSlice(html, 3);
    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-port-sample");
    expect(panel3).toContain("<figure");
    for (const label of ["العيّنة", "المجتمع", "التغطية", "اشتباه العيّنة"]) {
      expect(panel3).toContain(label);
    }
    expect(panel3).toContain("منفذ أ");
    expect(panel3).toContain("منفذ ب");
    // sequential-gold only: no diverging overlay colors should ever appear.
    expect(panel3).not.toContain('fill="var(--coral)"');
    expect(panel3).not.toContain('fill="var(--green)"');
  });

  it("(d) 2026-07-25 correctness risk: foldRemainder SUMS sampleTotal/total and pools coverage from the sums — never averages each folded port's own coverage %", () => {
    // Briefing combines LAND + SEA into one ranked list (same technique
    // deck2.test.ts's own port-population "20-port slice" test uses to reach
    // the density fold): 8 land + 7 sea = 15 combined ports, all of which fit
    // on ONE page (planPortPages(8,7,...) → maxCount=8, overflow=1 ≤
    // COMPRESS_OVERFLOW_MAX, single compact page, rowsPerPage=8 ≥ both counts).
    // briefingRankPlan(15) folds the tail: named=13 (the fixed
    // BRIEFING_RANK_NAMED_WHEN_FOLDED), folded=2.
    //
    // 13 "filler" ports all tie at sampleTotal=100 (ranking ahead of the 2
    // that fold). The 2 folded ports are engineered so a NAIVE average of
    // their individual coverages (50.05%) is wildly different from the
    // correct pooled figure (2/1001 ≈ 0.2%) — a tripwire for the averaging
    // bug this fan-out plan explicitly warns against.
    const rows: ExecutiveReportRow[] = [];
    for (let i = 0; i < 8; i++) {
      const port = `بر-${i}`;
      for (let s = 0; s < 100; s++) {
        rows.push(reportRow({ xrayImageId: `${port}-s${s}`, portName: port, portType: "منفذ بري", selectedInSample: true }));
      }
      for (let p = 0; p < 100; p++) {
        rows.push(reportRow({ xrayImageId: `${port}-p${p}`, portName: port, portType: "منفذ بري", selectedInSample: false }));
      }
    }
    for (let i = 0; i < 5; i++) {
      const port = `بحر-${i}`;
      for (let s = 0; s < 100; s++) {
        rows.push(reportRow({ xrayImageId: `${port}-s${s}`, portName: port, portType: "منفذ بحري", selectedInSample: true }));
      }
      for (let p = 0; p < 100; p++) {
        rows.push(reportRow({ xrayImageId: `${port}-p${p}`, portName: port, portType: "منفذ بحري", selectedInSample: false }));
      }
    }
    // بحر-5: sampleTotal=1, total=1 → coverage 100%.
    rows.push(reportRow({ xrayImageId: "s5-s0", portName: "بحر-5", portType: "منفذ بحري", selectedInSample: true }));
    // بحر-6: sampleTotal=1, total=1000 → coverage 0.1%.
    rows.push(reportRow({ xrayImageId: "s6-s0", portName: "بحر-6", portType: "منفذ بحري", selectedInSample: true }));
    for (let p = 1; p < 1000; p++) {
      rows.push(reportRow({ xrayImageId: `s6-p${p}`, portName: "بحر-6", portType: "منفذ بحري", selectedInSample: false }));
    }
    const model = modelWithRows(rows);
    const builders = portSampleSlideBuilders(model, true);
    expect(builders).toHaveLength(1); // single compact page, per planPortPages
    const html = builders[0](6, 20);
    const panel2 = panelSlice(html, 2);

    expect((panel2.match(/class="v2-bf-rank-row(?: rest)?"/g) ?? []).length).toBe(14); // 13 named + 1 remainder
    expect(panel2).toContain("بقية المنافذ (2)");
    // Pooled from the summed raw counts (2 sample / 1001 population: ≈0.2%),
    // NOT the naive average of the two folded ports' own coverage
    // percentages (100% and 0.1%, averaging to ≈50%) — uniquely identified
    // by pairing the pooled rate with its own denominator (1,001), since a
    // bare "0.2%" substring check would be too weak to rule out the bug.
    const pooledCoverage = fmtPct((2 / 1001) * 100);
    expect(pooledCoverage).not.toBe(fmtPct((100 + 0.1) / 2)); // sanity: the two differ enough to matter
    const remainderRow = panel2.slice(panel2.indexOf("بقية المنافذ"));
    expect(remainderRow).toContain(`من ${fmtNum(1001)} · تغطية ${pooledCoverage}`);
    // The remainder's own bar value is the SUMMED sample total (2), not an average.
    expect(remainderRow).toContain(`<span class="v2-bf-rank-value">${fmtNum(2)}</span>`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// slide-quality-ports (fan-out plan §8)
// ═══════════════════════════════════════════════════════════════════════════

describe("qualityPortSlideBuilders — Ledger/Briefing/Grid (fan-out plan §8, batch B2a)", () => {
  // منفذ أ (land): 10 evaluated (8 عالي / 1 متوسط / 1 منخفض) → low rate 10%.
  // منفذ ب (land): 5 evaluated, all منخفض → low rate 100% (worst).
  // منفذ ج (land): 3 rows, imageQuality NULL on all → evaluated=0, EXCLUDED.
  // منفذ د (sea): 4 evaluated (2 عالي / 2 منخفض) → low rate 50%.
  function fixtureModel(): ReportModel {
    const rows: ExecutiveReportRow[] = [
      ...Array.from({ length: 8 }, (_, i) =>
        reportRow({ xrayImageId: `A-h${i}`, portName: "منفذ أ", portType: "منفذ بري", imageQuality: "عالي", hasMarking: true }),
      ),
      reportRow({ xrayImageId: "A-m0", portName: "منفذ أ", portType: "منفذ بري", imageQuality: "متوسط", hasMarking: true }),
      reportRow({ xrayImageId: "A-l0", portName: "منفذ أ", portType: "منفذ بري", imageQuality: "منخفض", hasMarking: true }),
      ...Array.from({ length: 5 }, (_, i) =>
        reportRow({ xrayImageId: `B-l${i}`, portName: "منفذ ب", portType: "منفذ بري", imageQuality: "منخفض", hasMarking: false }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        reportRow({ xrayImageId: `C-u${i}`, portName: "منفذ ج", portType: "منفذ بري", imageQuality: null, hasMarking: true }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        reportRow({ xrayImageId: `D-h${i}`, portName: "منفذ د", portType: "منفذ بحري", imageQuality: "عالي", hasMarking: true }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        reportRow({ xrayImageId: `D-l${i}`, portName: "منفذ د", portType: "منفذ بحري", imageQuality: "منخفض", hasMarking: true }),
      ),
    ];
    return modelWithRows(rows);
  }

  it("(a) Ledger: lists ALL ports including the zero-evaluated one (muted dashes, never dropped), and the card title discloses the pooled denominator", () => {
    const html = qualityPortSlideBuilders(fixtureModel(), true)[0](6, 20);
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain("v2-sys-ledger");
    expect(panel1).toContain("v2-lg-quality-ports");
    // No chart markup — threshCell's below-target alert glyph legitimately
    // renders a tiny <svg> icon (functional color, not a chart), so "no
    // chart" is checked via the absence of a metricMatrix <figure>, not <svg>.
    expect(panel1).not.toContain("<figure");
    // Card titles disclose N ports · evaluated total, per the plan's exact
    // "{title} — {N} منفذ · {evaluatedTotal} صورة مُقيَّمة" wording.
    expect(panel1).toContain(`المنافذ البرية — ${fmtNum(3)} منفذ · ${fmtNum(15)} صورة مُقيَّمة`);
    expect(panel1).toContain(`المنافذ البحرية — ${fmtNum(1)} منفذ · ${fmtNum(4)} صورة مُقيَّمة`);
    // منفذ ج (zero-evaluated) still appears as its own row, muted dashes for
    // every quality-level cell — Ledger's job is exhaustive verifiability,
    // unlike Briefing which excludes it from ranking.
    expect(panel1).toContain("منفذ ج");
    const rowStart = panel1.indexOf(">منفذ ج<");
    const rowEnd = panel1.indexOf("</tr>", rowStart);
    const row = panel1.slice(rowStart, rowEnd);
    expect((row.match(/<span class="insuff">—<\/span>/g) ?? []).length).toBe(3); // عالي/متوسط/منخفض, all muted
  });

  it("(b) Briefing: rows sorted by low-quality rate DESC (worst first), evaluated===0 port excluded from ranking and pooled correctly — this is the exact class of edge case this codebase has shipped bugs on before", () => {
    const html = qualityPortSlideBuilders(fixtureModel(), true)[0](6, 20);
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain("v2-sys-brief");
    expect(panel2).toContain("v2-bf-quality-ports");

    // Pooled lede: 8 low / 19 evaluated across all 4 ports (1+5+0+2=8, 10+5+0+4=19).
    const lowRate = fmtPct((8 / 19) * 100);
    expect(panel2).toContain(`جودة منخفضة ${lowRate} — ${fmtNum(8)} من ${fmtNum(19)} صورة مُقيَّمة`);
    expect(panel2).toContain("4 منافذ في هذه الصفحة");

    // Rank order: منفذ ب (100%) worst, منفذ د (50%), منفذ أ (10%) best of the
    // rankable set, then the excluded aggregate LAST.
    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(["منفذ ب", "منفذ د", "منفذ أ", "منافذ بلا صور مُقيَّمة (1)"]);

    // The excluded ("منفذ ج") aggregate never gets a fabricated rate: value
    // text is the muted dash, and its bar renders at 0% width (bar-less).
    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values[3]).toBe("—");
    const widths = [...panel2.matchAll(/class="v2-bf-rank-fill \w+" style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
    expect(widths[3]).toBe(0);
    // Never silently dropped — its count is stated, and the row is present.
    expect((panel2.match(/class="v2-bf-rank-row(?: rest)?"/g) ?? []).length).toBe(4);

    // Support strip: pooled (not averaged) عالي/متوسط رigures.
    expect(panel2).toContain(fmtPct((10 / 19) * 100)); // عالي (مجمّع): 8+0+0+2=10
    expect(panel2).toContain(fmtPct((1 / 19) * 100)); // متوسط (مجمّع): 1+0+0+0=1
  });

  it("(c) Grid: عالي/متوسط/منخفض/التحديد columns all [0,100], sequential-gold only (no diverging ramp for منخفض), marking target disclosed in the panel sub", () => {
    const html = qualityPortSlideBuilders(fixtureModel(), true)[0](6, 20);
    const panel3 = panelSlice(html, 3);
    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-quality-ports");
    for (const label of ["عالي", "متوسط", "منخفض", "التحديد"]) {
      expect(panel3).toContain(label);
    }
    expect(panel3).toContain("0–100"); // every column's domain, printed 4 times
    expect((panel3.match(/0–100/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(panel3).toContain("هدف التحديد 90%");
    // The plan explicitly rejects diverging-green-coral for منخفض — verified
    // by absence of the diverging ramp's overlay colors anywhere in this panel.
    expect(panel3).not.toContain('fill="var(--coral)"');
    expect(panel3).not.toContain('fill="var(--green)"');
    expect(panel3).toContain('fill="var(--gold)"');
    expect(panel3).toContain("منفذ ج"); // zero-evaluated port still listed as a row
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// slide-quality-accuracy (fan-out plan §9)
// ═══════════════════════════════════════════════════════════════════════════

describe("accuracyPortSlideBuilders — Ledger/Briefing/Grid (fan-out plan §9, batch B2a)", () => {
  // منفذ أ (land): evaluable=20 (sufficient), accuracy 90%.
  // منفذ ب (land): evaluable=10 (limited, the minimum rankable), accuracy 40% (worst).
  // منفذ ج (land): evaluable=5 (insufficient — NOT rankable), accuracy 80% but excluded.
  // منفذ د (sea): evaluable=15 (limited), accuracy 80%.
  function fixtureModel(): ReportModel {
    const rows: ExecutiveReportRow[] = [
      reportRow({ xrayImageId: "A-1", portName: "منفذ أ", portType: "منفذ بري" }),
      reportRow({ xrayImageId: "B-1", portName: "منفذ ب", portType: "منفذ بري" }),
      reportRow({ xrayImageId: "C-1", portName: "منفذ ج", portType: "منفذ بري" }),
      reportRow({ xrayImageId: "D-1", portName: "منفذ د", portType: "منفذ بحري" }),
    ];
    const portAccuracy: KeyedAccuracy[] = [
      portAcc("منفذ أ", { evaluable: 20, correctClean: 9, correctSuspicion: 9, missedSuspicion: 1, falseSuspicion: 1 }),
      portAcc("منفذ ب", { evaluable: 10, correctClean: 2, correctSuspicion: 2, missedSuspicion: 3, falseSuspicion: 3 }),
      portAcc("منفذ ج", { evaluable: 5, correctClean: 3, correctSuspicion: 1, missedSuspicion: 0, falseSuspicion: 1 }),
      portAcc("منفذ د", { evaluable: 15, correctClean: 6, correctSuspicion: 6, missedSuspicion: 1, falseSuspicion: 2 }),
    ];
    return modelWithAccuracy(rows, portAccuracy);
  }

  it("(a) Ledger: adds the العيّنة column (evaluable), shown even for the unrankable port whose rates are muted, and the card title carries the pooled base", () => {
    const html = accuracyPortSlideBuilders(fixtureModel(), true)[0](6, 20);
    const panel1 = panelSlice(html, 1);
    expect(panel1).toContain("v2-sys-ledger");
    expect(panel1).toContain("v2-lg-quality-accuracy");
    // Same reasoning as the quality-ports Ledger test: threshCell's
    // below-target alert glyph legitimately renders a tiny <svg>, so "no
    // chart" is checked via the absence of a metricMatrix <figure>.
    expect(panel1).not.toContain("<figure");
    expect(panel1).toContain("<th>العيّنة</th>");
    // Card titles reuse the established "قرار قابل للتقييم" phrase (plan §11b).
    expect(panel1).toContain(`المنافذ البرية — ${fmtNum(3)} منفذ · ${fmtNum(35)} قرار قابل للتقييم`);
    expect(panel1).toContain(`المنافذ البحرية — ${fmtNum(1)} منفذ · ${fmtNum(15)} قرار قابل للتقييم`);
    // منفذ ج (unrankable, evaluable=5): rate cells muted, but its evaluable
    // COUNT still renders — "a rate without its denominator is exactly what
    // Ledger exists to fix."
    const rowStart = panel1.indexOf(">منفذ ج<");
    const rowEnd = panel1.indexOf("</tr>", rowStart);
    const row = panel1.slice(rowStart, rowEnd);
    expect((row.match(/<span class="insuff">—<\/span>/g) ?? []).length).toBe(3);
    expect(row).toContain(`<td>${fmtNum(5)}</td>`);
    // Land totals row: pooled from summed counts (14 correct / 35 evaluable = 74.3%).
    expect(panel1).toContain(fmtPct((26 / 35) * 100));
  });

  it("(b) Briefing: ranked ASCENDING (worst first), unrankable port excluded and folded into a bar-less remainder, «الأقل دقة أولًا» present in the basis chip", () => {
    const html = accuracyPortSlideBuilders(fixtureModel(), true)[0](6, 20);
    const panel2 = panelSlice(html, 2);
    expect(panel2).toContain("v2-sys-brief");
    expect(panel2).toContain("v2-bf-quality-accuracy");

    // Pooled overall accuracy across all 4 ports: (20 correct)/(50 evaluable)=76%.
    const overall = fmtPct((38 / 50) * 100);
    expect(panel2).toContain(`الدقة العامة ${overall} — ${fmtNum(38)} من ${fmtNum(50)} قرار`);
    // Load-bearing per the plan — without it rank #1 misreads as "best".
    expect(panel2).toContain("الأقل دقة أولًا");

    const labels = [...panel2.matchAll(/<span class="v2-bf-rank-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    // Ascending by accuracy: منفذ ب (40%) worst, منفذ د (80%), منفذ أ (90%) best,
    // then the unrankable aggregate last.
    expect(labels).toEqual(["منفذ ب", "منفذ د", "منفذ أ", "منافذ دون حد الكفاية (1)"]);

    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values[3]).toBe("—"); // never a fabricated rate for منفذ ج
    const widths = [...panel2.matchAll(/class="v2-bf-rank-fill \w+" style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
    expect(widths[3]).toBe(0); // bar-less
    expect((panel2.match(/class="v2-bf-rank-row(?: rest)?"/g) ?? []).length).toBe(4); // never silently dropped

    // Support strip: عدد المنافذ دون حد الكفاية = 1, pooled دقة الاشتباه/دقة السليمة.
    expect(panel2).toContain(`<b>${fmtNum(1)}</b><small>دون حد الكفاية</small>`);
  });

  it("(c) Grid: الدقة العامة/دقة الاشتباه/دقة السليمة [0,100] + العيّنة columns; unrankable port gets null rates but STILL shows its العيّنة count", () => {
    const html = accuracyPortSlideBuilders(fixtureModel(), true)[0](6, 20);
    const panel3 = panelSlice(html, 3);
    expect(panel3).toContain("v2-sys-grid");
    expect(panel3).toContain("v2-gd-quality-accuracy");
    for (const label of ["الدقة العامة", "دقة الاشتباه", "دقة السليمة", "العيّنة"]) {
      expect(panel3).toContain(label);
    }
    expect(panel3).toContain("هدف الدقة 90%");
    expect(panel3).toContain("منفذ ج");
    // منفذ ج's evaluable count (5) must still render as a real number in the
    // Grid, even though its 3 rate columns are null (dashed "—" cells) —
    // the exact correctness risk the plan flags for this page.
    expect(panel3).toContain(">5<");
  });
});
