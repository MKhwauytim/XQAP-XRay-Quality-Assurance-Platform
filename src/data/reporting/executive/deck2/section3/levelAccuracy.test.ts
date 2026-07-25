// src/data/reporting/executive/deck2/section3/levelAccuracy.test.ts
import { describe, expect, it } from "vitest";

import type { EmployeeAnswerFile, ItemAnswer } from "../../../../answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import { buildReportModel } from "../../model/reportModel";
import type { ReportModel } from "../../model/reportModel";
import { LEVEL_ACCURACY_CSS, levelAccuracySlideBuilders } from "./levelAccuracy";

// ── Fixtures ────────────────────────────────────────────────────────────────
// The page folds `model.factTable`, which only exists once a real model is
// built, so every fixture goes through `buildReportModel` rather than hand-
// shaping a model literal. `template: null` means the reviewer's verdict is
// read from the fallback field id (`DEFAULT_EXEC_CONFIG.expertResultFieldId`).

type Verdict = "سليمة" | "اشتباه";

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
    levelOneEmployee: "E-100",
    levelTwoEmployee: "E-200",
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

/** A submitted reviewer answer carrying only the verdict field the report reads. */
function answerItem(xrayImageId: string, expert: Verdict): ItemAnswer {
  return {
    xrayImageId,
    templateId: "T-1",
    templateVersion: 1,
    answers: [{ fieldId: DEFAULT_EXEC_CONFIG.expertResultFieldId, value: expert }],
    lastSavedAt: "2026-05-10T00:00:00.000Z",
    submittedAt: "2026-05-10T00:00:00.000Z",
    answeredBy: "reviewer-1",
    status: "submitted",
  };
}

function answerFile(items: ItemAnswer[]): EmployeeAnswerFile {
  return { username: "reviewer-1", monthFolderName: "5-May-2026", items };
}

function input(
  populationRows: PreparedPopulationRow[],
  files: EmployeeAnswerFile[] = [],
): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: files,
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

type PortSpec = {
  name: string;
  portType: string;
  /** One entry per image: the two inspection decisions + the reviewer verdict
   *  (`null` = the reviewer never recorded one → outcomeClass stays null). */
  images: Array<{ l1: Verdict; l2: Verdict; expert: Verdict | null }>;
};

function buildModel(ports: PortSpec[]): ReportModel {
  const rows: PreparedPopulationRow[] = [];
  const items: ItemAnswer[] = [];
  let seq = 0;
  for (const port of ports) {
    for (const img of port.images) {
      seq += 1;
      const id = `XR-${seq}`;
      rows.push(
        popRow({
          xrayImageId: id,
          portName: port.name,
          portType: port.portType,
          portCode: `P-${port.name}`,
          xrayLevelOneResult: img.l1,
          xrayLevelTwoResult: img.l2,
          sourceRowNumber: seq,
        }),
      );
      if (img.expert !== null) items.push(answerItem(id, img.expert));
    }
  }
  return buildReportModel(input(rows, items.length > 0 ? [answerFile(items)] : []));
}

/** N images where every level agrees with the reviewer's «سليمة». */
function cleanImages(n: number): PortSpec["images"] {
  return Array.from({ length: n }, () => ({
    l1: "سليمة" as Verdict,
    l2: "سليمة" as Verdict,
    expert: "سليمة" as Verdict,
  }));
}

function render(model: ReportModel): string {
  return levelAccuracySlideBuilders(model, false)
    .map((b, i, all) => b(i + 1, all.length))
    .join("");
}

/** The `<tr>` fragment whose المنفذ cell holds `portName`. */
function rowHtml(html: string, portName: string): string {
  const fragment = html.split("<tr>").find((part) => part.includes(`>${portName}</td>`));
  expect(fragment, `no table row found for port ${portName}`).toBeDefined();
  return fragment as string;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("levelAccuracySlideBuilders — slide shell", () => {
  it("stamps the section-3 identity, icon, headline and subhead", () => {
    const html = render(buildModel([{ name: "منفذ ألف", portType: "منفذ بري", images: cleanImages(20) }]));
    expect(html).toContain('id="slide-s3-level-accuracy"');
    expect(html).toContain('data-section="section3"');
    expect(html).toContain("القسم 3 — التحاليل المتقدمة");
    expect(html).toContain("دقة إجابات المستوى الأول والثاني");
    expect(html).toContain("مقارنة قرار كل مستوى بنتيجة المراجع، لكل منفذ.");
    // iconName: "layers" — the eyebrow badge renders the registry's layers path.
    expect(html).toContain('<span class="slide-eyebrow-icon">');
    expect(html).toContain('<path d="M12 4l8 4-8 4-8-4 8-4z"/>');
  });

  it("emits four identical body variants (production renders only the first)", () => {
    const builders = levelAccuracySlideBuilders(
      buildModel([{ name: "منفذ ألف", portType: "منفذ بري", images: cleanImages(20) }]),
      true,
    );
    const html = builders[0](1, 1);
    const panels = html.match(/class="v2-variant-panel/g) ?? [];
    expect(panels).toHaveLength(4);
  });

  it("never uses risk-severity vocabulary for the two inspection levels", () => {
    const html = render(buildModel([{ name: "منفذ ألف", portType: "منفذ بري", images: cleanImages(20) }]));
    for (const word of ["منخفض", "متوسط", "مرتفع", "حرج"]) {
      expect(html).not.toContain(word);
    }
    // …and it says outright which axis "المستوى الأول/الثاني" refers to here.
    expect(html).toContain("مرحلتا فحص بالأشعة");
  });
});

describe("levelAccuracySlideBuilders — no reviewer verdicts at all", () => {
  const model = buildModel([
    { name: "منفذ ألف", portType: "منفذ بري", images: [{ l1: "سليمة", l2: "سليمة", expert: null }] },
    { name: "ميناء باء", portType: "منفذ بحري", images: [{ l1: "اشتباه", l2: "سليمة", expert: null }] },
  ]);
  const html = render(model);

  it("renders one page carrying an honest Arabic empty state", () => {
    expect(levelAccuracySlideBuilders(model, false)).toHaveLength(1);
    expect(html).toContain('class="v2-lvlacc-empty"');
    expect(html).toContain("لا توجد إجابات مُعتمدة بعد لقياس الدقة");
    expect(html).toContain("تظهر النسب في هذه الصفحة فور اعتماد إجابات المراجعة.");
  });

  it("shows no port tables and invents no figures", () => {
    expect(html).not.toContain("v2-port-split");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("undefined");
    expect(html).not.toMatch(/\b0\.0%/);
  });
});

describe("levelAccuracySlideBuilders — per-level accuracy per port", () => {
  // 20 evaluable images (band "sufficient", so both levels are rankable):
  //   L1 is wrong on 2 of them (false-suspicion) → 18/20 = 90.0%
  //   L2 agrees with the reviewer on all 20      → 20/20 = 100.0%
  const model = buildModel([
    {
      name: "منفذ ألف",
      portType: "منفذ بري",
      images: [
        ...Array.from({ length: 2 }, () => ({
          l1: "اشتباه" as Verdict,
          l2: "سليمة" as Verdict,
          expert: "سليمة" as Verdict,
        })),
        ...cleanImages(18),
      ],
    },
  ]);
  const html = render(model);
  const row = rowHtml(html, "منفذ ألف");

  it("scores each level independently against the reviewer", () => {
    expect(row).toContain("90.0%");
    expect(row).toContain("100.0%");
  });

  it("prints ن for the port", () => {
    expect(row).toContain('<span class="v2-lvlacc-n" dir="ltr">20</span>');
  });

  it("renders الفارق as signed percentage points in an LTR span", () => {
    expect(row).toContain('<span class="v2-lvlacc-delta up" dir="ltr">+10.0</span>');
  });

  it("uses the coral tone and a minus sign when المستوى الثاني is the weaker one", () => {
    const flipped = buildModel([
      {
        name: "منفذ ألف",
        portType: "منفذ بري",
        images: [
          ...Array.from({ length: 2 }, () => ({
            l1: "سليمة" as Verdict,
            l2: "اشتباه" as Verdict,
            expert: "سليمة" as Verdict,
          })),
          ...cleanImages(18),
        ],
      },
    ]);
    expect(rowHtml(render(flipped), "منفذ ألف")).toContain(
      '<span class="v2-lvlacc-delta down" dir="ltr">−10.0</span>',
    );
  });

  it("splits land and sea into the two tinted columns", () => {
    const mixed = buildModel([
      { name: "منفذ ألف", portType: "منفذ بري", images: cleanImages(20) },
      { name: "ميناء باء", portType: "منفذ بحري", images: cleanImages(20) },
    ]);
    const out = render(mixed);
    expect(out).toContain('<div class="v2-port-split v2-lvlacc">');
    expect(out).toContain('class="v2-port-col land green"');
    expect(out).toContain('class="v2-port-col sea blue"');
    // The سليمة/بري port must land in the green column, the بحري one in the blue.
    const [, landPart, seaPart] = out.split(/class="v2-port-col (?:land green|sea blue)"/);
    expect(landPart).toContain("منفذ ألف");
    expect(landPart).not.toContain("ميناء باء");
    expect(seaPart).toContain("ميناء باء");
  });

  it("ends every tbody with the filler row, immediately before tfoot", () => {
    expect(html).toContain('<tr class="v2-fill-row" aria-hidden="true"><td colspan="5"></td></tr></tbody>');
    expect(html).toContain("الإجمالي");
  });
});

describe("levelAccuracySlideBuilders — data-sufficiency gate", () => {
  // 5 evaluable decisions per level → band "insufficient" → never a percentage.
  const model = buildModel([
    { name: "منفذ قليل", portType: "منفذ بري", images: cleanImages(5) },
    { name: "منفذ كافٍ", portType: "منفذ بري", images: cleanImages(20) },
  ]);
  const html = render(model);

  it("renders — for both levels and for الفارق below the cut", () => {
    const row = rowHtml(html, "منفذ قليل");
    const insuffCells = row.match(/<td class="v2-bar-cell neutral"><span class="insuff">—<\/span><\/td>/g) ?? [];
    expect(insuffCells).toHaveLength(3); // L1 accuracy, L2 accuracy, الفارق
    expect(row).not.toContain("%");
  });

  it("still prints ن for the under-powered port", () => {
    expect(rowHtml(html, "منفذ قليل")).toContain('<span class="v2-lvlacc-n" dir="ltr">5</span>');
  });

  it("leaves the sufficiently-powered port fully scored", () => {
    const row = rowHtml(html, "منفذ كافٍ");
    expect(row).toContain("100.0%");
    expect(row).toContain('<span class="v2-lvlacc-n" dir="ltr">20</span>');
  });

  it("keeps under-powered ports inside the الإجمالي denominator", () => {
    // 5 + 20 = 25 evaluable decisions per level in the land column.
    expect(html).toContain('<span class="v2-lvlacc-n" dir="ltr">25</span>');
  });

  it("never fabricates 0% anywhere on the page", () => {
    expect(html).not.toContain("NaN");
    expect(html).not.toMatch(/>0\.0%/);
  });
});

describe("levelAccuracySlideBuilders — reconciliation with model.portAccuracy", () => {
  const model = buildModel([
    {
      name: "منفذ ألف",
      portType: "منفذ بري",
      images: [
        { l1: "اشتباه", l2: "سليمة", expert: "سليمة" },
        { l1: "سليمة", l2: "اشتباه", expert: "اشتباه" },
        ...cleanImages(18),
        // Two images the reviewer never judged — excluded from BOTH sides.
        { l1: "اشتباه", l2: "اشتباه", expert: null },
        { l1: "سليمة", l2: "سليمة", expert: null },
      ],
    },
    { name: "ميناء باء", portType: "منفذ بحري", images: cleanImages(12) },
  ]);

  it("LEVEL_1 + LEVEL_2 counts equal the port's counts in model.portAccuracy", () => {
    for (const port of model.portAccuracy) {
      const scored = model.factTable.filter(
        (r) => r.outcomeClass !== null && (r.portName ?? "غير محدد") === port.key,
      );
      const per = (level: "LEVEL_1" | "LEVEL_2") => {
        const recs = scored.filter((r) => r.decisionLevel === level);
        return {
          evaluable: recs.length,
          correctClean: recs.filter((r) => r.outcomeClass === "correct-clean").length,
          correctSuspicion: recs.filter((r) => r.outcomeClass === "correct-suspicion").length,
          missedSuspicion: recs.filter((r) => r.outcomeClass === "missed-suspicion").length,
          falseSuspicion: recs.filter((r) => r.outcomeClass === "false-suspicion").length,
        };
      };
      const l1 = per("LEVEL_1");
      const l2 = per("LEVEL_2");
      expect(l1.evaluable + l2.evaluable).toBe(port.evaluable);
      expect(l1.correctClean + l2.correctClean).toBe(port.correctClean);
      expect(l1.correctSuspicion + l2.correctSuspicion).toBe(port.correctSuspicion);
      expect(l1.missedSuspicion + l2.missedSuspicion).toBe(port.missedSuspicion);
      expect(l1.falseSuspicion + l2.falseSuspicion).toBe(port.falseSuspicion);
      // …and the two levels are always evaluable in lockstep, which is why the
      // page prints a single `ن` per port rather than two.
      expect(l1.evaluable).toBe(l2.evaluable);
    }
  });

  it("prints ن as half of the port's portAccuracy evaluable count", () => {
    const html = render(model);
    for (const port of model.portAccuracy) {
      expect(rowHtml(html, port.key)).toContain(
        `<span class="v2-lvlacc-n" dir="ltr">${port.evaluable / 2}</span>`,
      );
    }
  });

  it("excludes reviewer-less images from ن", () => {
    // 20 judged + 2 unjudged at منفذ ألف → ن must be 20, never 22.
    const html = render(model);
    expect(rowHtml(html, "منفذ ألف")).toContain('<span class="v2-lvlacc-n" dir="ltr">20</span>');
  });
});

describe("levelAccuracySlideBuilders — pagination", () => {
  function ports(count: number, portType: string, prefix: string): PortSpec[] {
    return Array.from({ length: count }, (_unused, i) => ({
      name: `${prefix}-${i + 1}`,
      portType,
      images: cleanImages(20),
    }));
  }

  it("stays on one un-suffixed page within the row budget", () => {
    const builders = levelAccuracySlideBuilders(buildModel(ports(7, "منفذ بري", "بر")), false);
    expect(builders).toHaveLength(1);
    const html = builders[0](1, 1);
    expect(html).toContain('id="slide-s3-level-accuracy"');
    expect(html).not.toContain("(تابع)");
    expect(html).not.toContain("compact");
  });

  it("compresses rather than paginates on a small overflow", () => {
    const builders = levelAccuracySlideBuilders(buildModel(ports(9, "منفذ بري", "بر")), false);
    expect(builders).toHaveLength(1);
    const html = builders[0](1, 1);
    // Class order comes from the shared `portTableCard` shell (variant, then
    // `compact`, then the page's tone class) — same shell every deck table uses.
    expect(html).toContain('class="v2-port-col land compact green"');
    // All nine ports still land on the single page.
    for (let i = 1; i <= 9; i++) expect(html).toContain(`بر-${i}<`);
  });

  it("paginates land and sea in lockstep past the compression window", () => {
    const model = buildModel([...ports(12, "منفذ بري", "بر"), ...ports(3, "منفذ بحري", "بحر")]);
    const builders = levelAccuracySlideBuilders(model, false);
    expect(builders).toHaveLength(2);
    const [first, second] = builders.map((b, i) => b(i + 1, 2));
    expect(first).toContain('id="slide-s3-level-accuracy-1"');
    expect(first).not.toContain("(تابع)");
    expect(second).toContain('id="slide-s3-level-accuracy-2"');
    expect(second).toContain("(تابع)");
    // 12 land ports split 7 + 5; the 3 sea ports all fit on page one.
    expect((first.match(/بر-\d+</g) ?? [])).toHaveLength(7);
    expect((second.match(/بر-\d+</g) ?? [])).toHaveLength(5);
    expect((first.match(/بحر-\d+</g) ?? [])).toHaveLength(3);
    expect(second).toContain("لا توجد منافذ بهذه الفئة");
  });

  it("paginates a sea overflow the same way", () => {
    const builders = levelAccuracySlideBuilders(
      buildModel(ports(12, "منفذ بحري", "بحر")),
      false,
    );
    expect(builders).toHaveLength(2);
  });
});

describe("levelAccuracySlideBuilders — safety and determinism", () => {
  it("escapes port names into the table and the tooltip", () => {
    const model = buildModel([
      {
        name: '<img src=x onerror="alert(1)">',
        portType: "منفذ بري",
        images: cleanImages(20),
      },
    ]);
    const html = render(model);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("is deterministic for the same model and for equal inputs", () => {
    const spec: PortSpec[] = [
      { name: "منفذ ألف", portType: "منفذ بري", images: cleanImages(20) },
      { name: "ميناء باء", portType: "منفذ بحري", images: cleanImages(14) },
      { name: "منفذ جيم", portType: "منفذ بري", images: cleanImages(20) },
    ];
    const model = buildModel(spec);
    expect(render(model)).toBe(render(model));
    expect(render(buildModel(spec))).toBe(render(buildModel(spec)));
  });

  it("orders ports by evaluable volume, with a stable name tiebreak", () => {
    const html = render(
      buildModel([
        { name: "ب-صغير", portType: "منفذ بري", images: cleanImages(12) },
        { name: "أ-كبير", portType: "منفذ بري", images: cleanImages(20) },
        { name: "ج-كبير", portType: "منفذ بري", images: cleanImages(20) },
      ]),
    );
    const order = (name: string) => html.indexOf(`>${name}</td>`);
    expect(order("أ-كبير")).toBeLessThan(order("ج-كبير"));
    expect(order("ج-كبير")).toBeLessThan(order("ب-صغير"));
  });

  it("exports page-scoped CSS with no raw hex literals", () => {
    expect(LEVEL_ACCURACY_CSS).toContain(".v2-lvlacc-delta");
    expect(LEVEL_ACCURACY_CSS).toContain(".v2-lvlacc-empty");
    expect(LEVEL_ACCURACY_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
