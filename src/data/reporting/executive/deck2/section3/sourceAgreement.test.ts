// src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts
import { describe, expect, it } from "vitest";

import type { EmployeeAnswerFile, FieldAnswer } from "../../../../answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import type { SampleMasterData } from "../../../../sampling/sampleTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import { buildReportModel } from "../../model/reportModel";
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
      "المراجع (المعيار)",
    ]) {
      expect(html).toContain(label);
    }
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
    // The one pair that does NOT involve the reviewer still reports (20 images).
    expect(html).toContain(">75%</text>");
  });
});

describe("sourceAgreementSlide — rates, gating and ن", () => {
  it("prints the known pair agreement percentages in the matrix and the reviewer table", () => {
    const { rows, reviews } = knownProfile();
    const model = buildReportModel(input(rows, { sample: true, reviews }));

    // Guard the fixture itself against drift in the aggregate layer.
    const pair = model.resultComparison.crossTeamMatrix.find(
      (c) => c.sourceA === "levelOne" && c.sourceB === "levelTwo",
    )!;
    expect(pair.comparable).toBe(20);
    expect(pair.agree).toBe(15);
    expect(pair.agreementRate).toBe(75);

    const html = sourceAgreementSlide(model, 12, 24, false);
    expect(html).toContain(">75%</text>"); // L1 × L2
    expect(html).toContain(">90%</text>"); // L1 × reviewer
    expect(html).toContain(">85%</text>"); // L2 × reviewer
    // The reviewer table renders the same figures at one decimal.
    expect(html).toContain("90.0%");
    expect(html).toContain("85.0%");
    // Below-target rows carry the alert glyph, so status is never colour-alone.
    expect(html).toContain('<td class="v2-bar-cell warn"');
    expect(html).toContain('class="v2-cell-flag"');
  });

  it("suppresses a pair below the sufficiency cut but still shows its ن", () => {
    // 5 comparable images → band "insufficient" → not rankable.
    const { rows } = knownProfile(5);
    const html = render(input(rows));
    expect(html).not.toContain(">100%</text>");
    expect(html).not.toContain("<td>100%</td>");
    expect(html).toContain(">—</text>");
    // ن is still disclosed for that suppressed pair.
    expect(html).toContain("<td>5</td>");
  });

  it("shows the rate again once the pair reaches the rankable band", () => {
    // 10 comparable images → band "limited" → rankable.
    const { rows } = knownProfile(10);
    const html = render(input(rows));
    expect(html).toContain(">100%</text>");
    expect(html).toContain("<td>10</td>");
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
    expect(SOURCE_AGREEMENT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
