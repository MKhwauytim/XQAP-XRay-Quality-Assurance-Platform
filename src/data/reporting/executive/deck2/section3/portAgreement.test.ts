// src/data/reporting/executive/deck2/section3/portAgreement.test.ts
//
// Fixtures follow the deck2.test.ts style: real `PreparedPopulationRow`s pushed
// through the real `buildReportModel`, never a hand-shaped ReportModel literal.
// Reviewer verdicts are threaded the way production does it — via an
// `EmployeeAnswerFile` whose items answer `config.expertResultFieldId`
// ("qualityImageResult", the fallback field id when no template is supplied).

import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import type { EmployeeAnswerFile } from "../../../../answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { buildReportModel } from "../../model/reportModel";
import type { ReportModel } from "../../model/reportModel";
import { PORT_AGREEMENT_CSS, portAgreementSlideBuilders } from "./portAgreement";

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

/** N population rows at one port, level results supplied per index. */
function portRows(
  opts: {
    port: string;
    portType?: string;
    count: number;
    idPrefix: string;
    levelOne?: (i: number) => Result;
    levelTwo?: (i: number) => Result;
  },
): PreparedPopulationRow[] {
  const rows: PreparedPopulationRow[] = [];
  for (let i = 0; i < opts.count; i++) {
    rows.push(
      popRow({
        xrayImageId: `${opts.idPrefix}-${i + 1}`,
        portName: opts.port,
        portCode: opts.idPrefix,
        portType: opts.portType ?? "منفذ بري",
        xrayLevelOneResult: opts.levelOne ? opts.levelOne(i) : "سليمة",
        xrayLevelTwoResult: opts.levelTwo ? opts.levelTwo(i) : "سليمة",
        sourceRowNumber: i + 1,
      }),
    );
  }
  return rows;
}

/** One submitted reviewer answer per (imageId → verdict) pair. */
function answerFile(verdicts: Array<[string, Result]>): EmployeeAnswerFile {
  return {
    username: "reviewer-1",
    monthFolderName: "5-May-2026",
    items: verdicts.map(([xrayImageId, value]) => ({
      xrayImageId,
      templateId: "t",
      templateVersion: 1,
      answers: [{ fieldId: "qualityImageResult", value }],
      lastSavedAt: "2026-05-10T00:00:00.000Z",
      submittedAt: "2026-05-10T00:00:00.000Z",
      answeredBy: "reviewer-1",
      status: "submitted" as const,
    })),
  };
}

function input(
  populationRows: PreparedPopulationRow[],
  employeeFiles: EmployeeAnswerFile[] = [],
): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles,
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

function modelOf(
  populationRows: PreparedPopulationRow[],
  employeeFiles: EmployeeAnswerFile[] = [],
): ReportModel {
  return buildReportModel(input(populationRows, employeeFiles));
}

/** Render every page of the slide with plausible numbering. */
function renderAll(model: ReportModel, variantPreview = false): string[] {
  const builders = portAgreementSlideBuilders(model, variantPreview);
  return builders.map((b, i) => b(i + 1, builders.length));
}

function renderOne(model: ReportModel): string {
  const pages = renderAll(model);
  expect(pages).toHaveLength(1);
  return pages[0];
}

/** The single `<tr>` whose first cell is this port's name. */
function rowFor(html: string, port: string): string {
  const match = [...html.matchAll(/<tr>(?:(?!<\/tr>)[\s\S])*?<\/tr>/g)]
    .map((m) => m[0])
    .find((tr) => tr.includes(`<td>${port}</td>`));
  expect(match, `no row found for port ${port}`).toBeTruthy();
  return match as string;
}

/**
 * Percentages rendered as visible TEXT, in document order. `style` attributes
 * are stripped first: bar cells carry the fill width as `--w:NN.N%`, which is
 * presentation, not a printed figure. Muted "—" cells contribute nothing.
 */
function percentsIn(tr: string): string[] {
  const stripped = tr.replace(/ style="[^"]*"/g, "");
  return [...stripped.matchAll(/(\d+\.\d)%/g)].map((m) => m[0]);
}

/** How many muted "no data" cells the row carries. */
function mutedCount(tr: string): number {
  return (tr.match(/<span class="insuff">—<\/span>/g) ?? []).length;
}

// ── Shell / contract ────────────────────────────────────────────────────────
describe("portAgreementSlideBuilders — slide shell", () => {
  it("renders the required identity, title, subhead, section and icon", () => {
    const html = renderOne(modelOf(portRows({ port: "منفذ بري أ", count: 12, idPrefix: "A" })));
    expect(html).toContain('id="slide-s3-port-agreement"');
    expect(html).toContain('data-title="توافق المستويات حسب المنفذ"');
    expect(html).toContain('data-section="section3"');
    expect(html).toContain("القسم 3 — التحاليل المتقدمة");
    expect(html).toContain(
      "نسبة اتفاق المستوى الأول والثاني على النتيجة في كل منفذ، ومطابقة كل مستوى لنتيجة المراجع.",
    );
    // iconName: "port" — the gate glyph from the icon registry.
    expect(html).toContain('<path d="M5 21V8l7-4 7 4v13"/>');
  });

  it("splits land (green) and sea (blue) into the two v2-port-split columns", () => {
    const model = modelOf([
      ...portRows({ port: "منفذ بري أ", count: 12, idPrefix: "A" }),
      ...portRows({ port: "ميناء بحري ب", portType: "منفذ بحري", count: 12, idPrefix: "B" }),
    ]);
    const html = renderOne(model);
    expect(html).toContain('<div class="v2-port-split v2-agree-split">');
    expect(html).toContain('class="v2-port-col land green"');
    expect(html).toContain('class="v2-port-col sea blue"');
    // Each port lands in exactly one card.
    const land = html.slice(html.indexOf("v2-port-col land"), html.indexOf("v2-port-col sea"));
    expect(land).toContain("منفذ بري أ");
    expect(land).not.toContain("ميناء بحري ب");
  });

  it("emits the six required column headers and closes tbody with the filler row", () => {
    const html = renderOne(modelOf(portRows({ port: "منفذ بري أ", count: 12, idPrefix: "A" })));
    for (const th of [
      "<th>المنفذ</th>",
      "<th>اتفاق المستويين</th>",
      "<th>المجتمع</th>",
      "<th>مطابقة الأول للمراجع</th>",
      "<th>مطابقة الثاني للمراجع</th>",
      "<th>العيّنة</th>",
    ]) {
      expect(html).toContain(th);
    }
    expect(html).toContain('<tr class="v2-fill-row" aria-hidden="true"><td colspan="6"></td></tr>');
    // The filler row is the LAST thing in tbody, immediately before tfoot.
    expect(html).toContain('<td colspan="6"></td></tr></tbody>');
  });

  it("renders four identical body variants only in preview mode", () => {
    const model = modelOf(portRows({ port: "منفذ بري أ", count: 12, idPrefix: "A" }));
    const prod = renderAll(model, false)[0];
    const preview = renderAll(model, true)[0];
    expect(prod).not.toContain('<div class="v2-variant-stack"');
    expect(preview).toContain('data-slide-id="slide-s3-port-agreement"');
    expect((preview.match(/data-variant-index=/g) ?? [])).toHaveLength(4);
  });

  it("exports page CSS carrying only its own new rules", () => {
    expect(PORT_AGREEMENT_CSS).toContain(".v2-agree-wrap");
    expect(PORT_AGREEMENT_CSS).toContain(".v2-agree-split");
    expect(PORT_AGREEMENT_CSS).toContain(".v2-agree-note");
    // No raw hex literals (npm run check:hex-literals is a CI gate elsewhere).
    expect(PORT_AGREEMENT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

// ── Fact 1: the two X-ray levels, never a severity ranking ──────────────────
describe("portAgreementSlideBuilders — level semantics", () => {
  it("never uses severity language about the two inspection levels", () => {
    const html = renderOne(modelOf(portRows({ port: "منفذ بري أ", count: 12, idPrefix: "A" })));
    for (const forbidden of ["الأشد", "الأخطر", "أخطر", "أشد", "خطورة", "الأعلى خطورة"]) {
      expect(html).not.toContain(forbidden);
    }
  });
});

// ── Fact 2: two different denominators, stated ──────────────────────────────
describe("portAgreementSlideBuilders — the two denominators", () => {
  it("prints the population base and the sample base as separate columns with the right values", () => {
    // 12 images at the port; only 10 of them carry a reviewer verdict.
    const rows = portRows({
      port: "منفذ بري أ",
      count: 12,
      idPrefix: "A",
      // 3 of 12 disagree between the levels → 9/12 = 75.0% on the POPULATION.
      levelTwo: (i) => (i < 3 ? "اشتباه" : "سليمة"),
    });
    // Reviewer says اشتباه on the 3 disagreement images and سليمة on 7 others.
    const verdicts: Array<[string, Result]> = [];
    for (let i = 0; i < 10; i++) verdicts.push([`A-${i + 1}`, i < 3 ? "اشتباه" : "سليمة"]);
    const html = renderOne(modelOf(rows, [answerFile(verdicts)]));
    const tr = rowFor(html, "منفذ بري أ");

    // المجتمع = 12, العيّنة = 10 — different bases, both printed.
    expect(tr).toContain(">12</td>");
    expect(tr).toContain(">10</td>");

    // L1↔L2 = 9/12 = 75.0% (population).
    // L1↔reviewer  = 7/10 = 70.0%  (سليمة matched on the last 7 only).
    // L2↔reviewer  = 10/10 = 100.0% (level two mirrors the reviewer exactly).
    expect(percentsIn(tr)).toEqual(["75.0%", "70.0%", "100.0%"]);
    expect(mutedCount(tr)).toBe(0);
  });

  it("carries the scope footnote saying the two bases are not comparable", () => {
    const html = renderOne(modelOf(portRows({ port: "منفذ بري أ", count: 12, idPrefix: "A" })));
    expect(html).toContain('<div class="v2-agree-note">');
    expect(html).toContain("عمود المجتمع");
    expect(html).toContain("عمود العيّنة");
    expect(html).toContain("الأساسان مختلفان");
    expect(html).toContain("ولا تصحّ المقارنة المباشرة بين النسبتين");
  });

  it("repeats the scope footnote on continuation pages too", () => {
    const rows: PreparedPopulationRow[] = [];
    for (let p = 0; p < 11; p++) {
      rows.push(...portRows({ port: `منفذ ${p}`, count: 12, idPrefix: `P${p}` }));
    }
    const pages = renderAll(modelOf(rows));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page).toContain("الأساسان مختلفان");
  });
});

// ── Reviewer-free month ─────────────────────────────────────────────────────
describe("portAgreementSlideBuilders — no reviewer answers", () => {
  it("still computes L1↔L2 agreement from the population and mutes the reviewer columns", () => {
    const rows = portRows({
      port: "منفذ بري أ",
      count: 20,
      idPrefix: "A",
      levelTwo: (i) => (i < 5 ? "اشتباه" : "سليمة"),
    });
    const html = renderOne(modelOf(rows)); // no employeeFiles → no reviewer verdicts
    const tr = rowFor(html, "منفذ بري أ");

    // 15/20 = 75.0% on the population — the only percentage in the row.
    expect(percentsIn(tr)).toEqual(["75.0%"]);
    // Both reviewer-match cells are muted, never 0%.
    expect(mutedCount(tr)).toBe(2);
    expect(percentsIn(tr)).not.toContain("0.0%");
    // العيّنة is an honest zero, not a hidden cell.
    expect(tr).toContain(">0</td>");
    expect(tr).toContain(">20</td>");
  });

  it("mutes the reviewer totals in the tfoot as well, never 0%", () => {
    const html = renderOne(modelOf(portRows({ port: "منفذ بري أ", count: 20, idPrefix: "A" })));
    const tfoot = html.slice(html.indexOf("<tfoot>"), html.indexOf("</tfoot>"));
    expect(tfoot).toContain("الإجمالي");
    expect(tfoot).toContain("100.0%"); // L1↔L2 total (all rows agree)
    expect((tfoot.match(/<span class="insuff">—<\/span>/g) ?? [])).toHaveLength(2);
  });
});

// ── Perfect agreement ───────────────────────────────────────────────────────
describe("portAgreementSlideBuilders — perfect level agreement", () => {
  it("renders 100.0% for a port where both levels always match", () => {
    const rows = portRows({
      port: "منفذ متوافق",
      count: 14,
      idPrefix: "A",
      levelOne: (i) => (i % 2 === 0 ? "اشتباه" : "سليمة"),
      levelTwo: (i) => (i % 2 === 0 ? "اشتباه" : "سليمة"),
    });
    const tr = rowFor(renderOne(modelOf(rows)), "منفذ متوافق");
    expect(percentsIn(tr)[0]).toBe("100.0%");
    // At/above ACCURACY_TARGET → the "ok" tone, no alert glyph on that cell.
    expect(tr).toContain('class="v2-bar-cell ok"');
  });

  it("flags a below-target port with the alert glyph, not colour alone", () => {
    const rows = portRows({
      port: "منفذ متباين",
      count: 20,
      idPrefix: "A",
      levelTwo: (i) => (i < 10 ? "اشتباه" : "سليمة"),
    });
    const tr = rowFor(renderOne(modelOf(rows)), "منفذ متباين");
    expect(percentsIn(tr)[0]).toBe("50.0%");
    expect(tr).toContain('class="v2-bar-cell warn"');
    expect(tr).toContain('class="v2-cell-flag"');
  });
});

// ── Data-sufficiency gate ───────────────────────────────────────────────────
describe("portAgreementSlideBuilders — data sufficiency", () => {
  it("mutes every rate for a port below the sufficiency cut and still prints its n", () => {
    const model = modelOf([
      // 12 comparable → band "limited" → rankable.
      ...portRows({ port: "منفذ كبير", count: 12, idPrefix: "BIG" }),
      // 5 comparable → band "insufficient" → NOT rankable.
      ...portRows({ port: "منفذ صغير", count: 5, idPrefix: "SML" }),
    ]);
    const html = renderOne(model);

    const small = rowFor(html, "منفذ صغير");
    expect(percentsIn(small)).toEqual([]);
    expect(mutedCount(small)).toBe(3); // all three rate columns muted
    expect(small).toContain(">5</td>"); // n is ALWAYS printed

    const big = rowFor(html, "منفذ كبير");
    expect(percentsIn(big)).toEqual(["100.0%"]);
  });

  it("gates each column on its own denominator — a thin sample does not mute the population column", () => {
    // 20 population images, but only 4 reviewed → L1↔L2 rankable, reviewer not.
    const rows = portRows({
      port: "منفذ بري أ",
      count: 20,
      idPrefix: "A",
      levelTwo: (i) => (i < 2 ? "اشتباه" : "سليمة"),
    });
    const verdicts: Array<[string, Result]> = [];
    for (let i = 0; i < 4; i++) verdicts.push([`A-${i + 1}`, "سليمة"]);
    const tr = rowFor(renderOne(modelOf(rows, [answerFile(verdicts)])), "منفذ بري أ");

    expect(percentsIn(tr)).toEqual(["90.0%"]); // 18/20 population agreement
    expect(mutedCount(tr)).toBe(2); // both reviewer columns below the cut
    expect(tr).toContain(">20</td>");
    expect(tr).toContain(">4</td>");
  });

  it("orders rankable ports by lowest level agreement first, unrankable ports last", () => {
    const model = modelOf([
      ...portRows({
        port: "منفذ متوافق",
        count: 12,
        idPrefix: "HI",
      }),
      ...portRows({
        port: "منفذ متباين",
        count: 12,
        idPrefix: "LO",
        levelTwo: (i) => (i < 6 ? "اشتباه" : "سليمة"),
      }),
      ...portRows({ port: "منفذ ضئيل", count: 3, idPrefix: "TINY" }),
    ]);
    const html = renderOne(model);
    const order = [...html.matchAll(/<tr><td>(منفذ [^<]+)<\/td>/g)].map((m) => m[1]);
    expect(order).toEqual(["منفذ متباين", "منفذ متوافق", "منفذ ضئيل"]);
  });
});

// ── Pagination ──────────────────────────────────────────────────────────────
describe("portAgreementSlideBuilders — pagination", () => {
  it("stays on one page at the base row budget", () => {
    const rows: PreparedPopulationRow[] = [];
    for (let p = 0; p < 7; p++) rows.push(...portRows({ port: `منفذ ${p}`, count: 12, idPrefix: `P${p}` }));
    const pages = renderAll(modelOf(rows));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('id="slide-s3-port-agreement"');
    expect(pages[0]).not.toContain("(تابع)");
  });

  it("compresses a 1–3 row overflow onto one compact page", () => {
    const rows: PreparedPopulationRow[] = [];
    for (let p = 0; p < 9; p++) rows.push(...portRows({ port: `منفذ ${p}`, count: 12, idPrefix: `P${p}` }));
    const pages = renderAll(modelOf(rows));
    expect(pages).toHaveLength(1);
    // Class order comes from the shared `portTableCard` shell (variant, then
    // `compact`, then the page's tone class) — same shell every deck table uses.
    expect(pages[0]).toContain("v2-port-col land compact green");
  });

  it("paginates past the compress tier, suffixing ids and marking continuations", () => {
    const rows: PreparedPopulationRow[] = [];
    for (let p = 0; p < 11; p++) rows.push(...portRows({ port: `منفذ ${p}`, count: 12, idPrefix: `P${p}` }));
    const pages = renderAll(modelOf(rows));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('id="slide-s3-port-agreement-1"');
    expect(pages[1]).toContain('id="slide-s3-port-agreement-2"');
    expect(pages[0]).not.toContain("(تابع)");
    expect(pages[1]).toContain('data-title="توافق المستويات حسب المنفذ (تابع)"');

    // Every port appears exactly once across the pages, none dropped.
    const seen = pages.flatMap((p) => [...p.matchAll(/<tr><td>(منفذ \d+)<\/td>/g)].map((m) => m[1]));
    expect(new Set(seen).size).toBe(11);
    expect(seen).toHaveLength(11);
  });

  it("renders an empty-state row rather than an empty table for a missing side", () => {
    const html = renderOne(modelOf(portRows({ port: "منفذ بري أ", count: 12, idPrefix: "A" })));
    // No sea ports at all → the sea card shows one muted colspan row.
    expect(html).toContain('<tr><td colspan="6"><span class="insuff">—</span></td></tr>');
  });
});

// ── Purity / safety ─────────────────────────────────────────────────────────
describe("portAgreementSlideBuilders — determinism and escaping", () => {
  it("produces byte-identical HTML for the same model", () => {
    const rows: PreparedPopulationRow[] = [];
    for (let p = 0; p < 11; p++) {
      rows.push(
        ...portRows({
          port: `منفذ ${p}`,
          portType: p % 2 === 0 ? "منفذ بري" : "منفذ بحري",
          count: 12,
          idPrefix: `P${p}`,
          levelTwo: (i) => (i < p ? "اشتباه" : "سليمة"),
        }),
      );
    }
    const model = modelOf(rows);
    expect(renderAll(model).join("|")).toBe(renderAll(model).join("|"));
    // A second model built from the same input must render identically too.
    expect(renderAll(modelOf(rows)).join("|")).toBe(renderAll(model).join("|"));
  });

  it("escapes port names instead of emitting live markup", () => {
    const rows = portRows({
      port: '<script>alert("x")</script>',
      count: 12,
      idPrefix: "A",
    });
    const html = renderOne(modelOf(rows));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});
