import { describe, expect, it } from "vitest";

import type { EmployeeAnswerFile, ItemAnswer } from "../../../../answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import { buildReportModel } from "../../model/reportModel";
import type { ReportModel } from "../../model/reportModel";
import { OUTCOME_MATRIX_CSS, outcomeMatrixSlide } from "./outcomeMatrix";

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// `model.errorAnalysis` is folded from `model.factTable`, and a `DecisionRecord`
// only gets a non-null `outcomeClass` when a reviewer verdict exists
// (`classifyOutcome` returns `null` on a `null` `studyReviewResult` —
// decisionFactTable.ts). That verdict itself only exists when an
// `employeeFiles` answer supplies `DEFAULT_EXEC_CONFIG.expertResultFieldId`
// (executiveReportData.ts). A fixture with `employeeFiles: []` therefore
// ALWAYS lands every count in `model.errorAnalysis` at zero regardless of what
// population rows it carries — the exact accidental-empty-branch failure mode
// `dailyTrend.test.ts`/`levelAccuracy.test.ts` document. Every fixture below
// goes through `buildReportModel` with a real answer file so the populated
// path is genuinely exercised.

type Verdict = "سليمة" | "اشتباه";

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الأول",
    xrayImageId: "XR-1",
    xrayEntryDate: "2026-05-14",
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

/** A submitted reviewer answer carrying only the verdict field the report
 *  reads — same shape `levelAccuracy.test.ts`/`dailyTrend.test.ts` use. */
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

function input(rows: PreparedPopulationRow[], files: EmployeeAnswerFile[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-may-2026",
    populationRows: rows,
    sample: null,
    distribution: null,
    employeeFiles: files,
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

/** The brief's own `modelWith` shape (task-5-brief.md Step 1): every row's
 *  reviewer verdict is made to AGREE with the row's own L1 result, so a bare
 *  `modelWith([popRow()])` still exercises the POPULATED branch (one real
 *  evaluable decision per level) rather than the accidental-empty one. This
 *  fixture does not target a specific outcome class — that is what
 *  `buildOutcomeModel` below is for. */
function modelWith(rows: PreparedPopulationRow[]): ReportModel {
  const items = rows.map((r) => answerItem(r.xrayImageId, r.xrayLevelOneResult));
  return buildReportModel(input(rows, items.length > 0 ? [answerFile(items)] : []));
}

/** The four outcome classes `classifyOutcome` produces, and the (employee
 *  verdict, reviewer verdict) pair that yields each one — same table
 *  `dailyTrend.test.ts` uses. Both L1 and L2 get the SAME employee verdict
 *  here, so one "image" always contributes exactly 2 decision records to the
 *  SAME outcome class (decision grain, not image grain). */
type OutcomeKind = "correctClean" | "falseSuspicion" | "correctSuspicion" | "missedSuspicion";
const OUTCOME_VERDICTS: Record<OutcomeKind, { verdict: Verdict; expert: Verdict }> = {
  correctClean: { verdict: "سليمة", expert: "سليمة" },
  falseSuspicion: { verdict: "اشتباه", expert: "سليمة" },
  correctSuspicion: { verdict: "اشتباه", expert: "اشتباه" },
  missedSuspicion: { verdict: "سليمة", expert: "اشتباه" },
};

/** Builds a model with an exact, caller-chosen number of images per outcome
 *  class (optionally split across named ports), so a test can assert real
 *  non-zero counts and distinguish the four classes from one another instead
 *  of merely proving "some cell" rendered. */
function buildOutcomeModel(plans: Array<Partial<Record<OutcomeKind, number>> & { port?: string }>): ReportModel {
  const rows: PreparedPopulationRow[] = [];
  const items: ItemAnswer[] = [];
  let seq = 0;
  for (const plan of plans) {
    const portName = plan.port ?? "منفذ الاختبار";
    (Object.keys(OUTCOME_VERDICTS) as OutcomeKind[]).forEach((kind) => {
      const count = plan[kind] ?? 0;
      for (let i = 0; i < count; i++) {
        seq += 1;
        const id = `XR-${seq}`;
        const { verdict, expert } = OUTCOME_VERDICTS[kind];
        rows.push(
          popRow({
            xrayImageId: id,
            xrayLevelOneResult: verdict,
            xrayLevelTwoResult: verdict,
            portName,
            sourceRowNumber: seq,
          }),
        );
        items.push(answerItem(id, expert));
      }
    });
  }
  return buildReportModel(input(rows, items.length > 0 ? [answerFile(items)] : []));
}

/** Extracts a matrix cell's printed count for a given class label — proves the
 *  actual figure shown, not just that the label text exists somewhere. */
function cellCount(html: string, label: string): number {
  const re = new RegExp(
    `<div class="v2-om-cell-label">${label}</div>\\s*<div class="v2-om-count">([\\d,]+)</div>`,
  );
  const match = re.exec(html);
  expect(match, `no matrix cell found for label "${label}"`).toBeTruthy();
  return Number((match as RegExpExecArray)[1].replace(/,/g, ""));
}

describe("outcomeMatrixSlide", () => {
  it("renders the slide shell", () => {
    const html = outcomeMatrixSlide(modelWith([popRow()]), 6, 20, false);
    expect(html).toContain('id="slide-s3-outcome-matrix"');
    expect(html).toContain('data-section="section3"');
  });

  it("states اشتباه فائت as an absolute count, not only a rate", () => {
    const html = outcomeMatrixSlide(
      modelWith([
        popRow({
          xrayImageId: "A",
          xrayLevelOneResult: "سليمة",
          xrayLevelTwoResult: "سليمة",
        }),
      ]),
      6,
      20,
      false,
    );
    expect(html).toContain("اشتباه فائت");
    expect(html).toContain("v2-om-count");
  });

  it("renders — rather than 0% when there is nothing evaluable", () => {
    const html = outcomeMatrixSlide(modelWith([]), 6, 20, false);
    expect(html).not.toContain("0.0%");
  });

  it("lists ports below the month-wide matrix", () => {
    const html = outcomeMatrixSlide(modelWith([popRow()]), 6, 20, false);
    expect(html).toContain("v2-om-ports");
  });

  it("is deterministic", () => {
    const model = modelWith([popRow()]);
    expect(outcomeMatrixSlide(model, 6, 20, false)).toBe(outcomeMatrixSlide(model, 6, 20, false));
  });

  it("ships scoped CSS", () => {
    expect(OUTCOME_MATRIX_CSS).toContain(".v2-om-");
  });

  // ── The subtle part: real non-zero counts, and the four classes kept apart ─

  it("shows real non-zero counts for a populated month (proves the populated branch, not just an empty-state shell)", () => {
    const model = buildOutcomeModel([{ correctClean: 7, correctSuspicion: 3, falseSuspicion: 5, missedSuspicion: 2 }]);
    // 2 decision records per image (L1 + L2).
    expect(model.errorAnalysis.totals).toEqual({
      correctClean: 14,
      correctSuspicion: 6,
      falseSuspicion: 10,
      missedSuspicion: 4,
      evaluable: 34,
    });

    const html = outcomeMatrixSlide(model, 6, 20, false);
    expect(cellCount(html, "اشتباه فائت")).toBe(4);
    expect(cellCount(html, "اشتباه صحيح")).toBe(6);
    expect(cellCount(html, "اشتباه خاطئ")).toBe(10);
    expect(cellCount(html, "سليمة صحيحة")).toBe(14);
    // The stated denominator matches the matrix's own total.
    expect(html).toContain(`<b>34</b><small>إجمالي القرارات القابلة للتقييم`);
  });

  it("lands a سليمة/سليمة employee decision against an اشتباه reviewer verdict specifically in اشتباه فائت, not any other cell", () => {
    // A single image: L1/L2 both said سليمة, the reviewer said اشتباه.
    const model = buildOutcomeModel([{ missedSuspicion: 1 }]);
    expect(model.errorAnalysis.totals).toEqual({
      correctClean: 0,
      correctSuspicion: 0,
      falseSuspicion: 0,
      missedSuspicion: 2, // 2 decision records (L1 + L2) from the one image
      evaluable: 2,
    });

    const html = outcomeMatrixSlide(model, 6, 20, false);
    expect(cellCount(html, "اشتباه فائت")).toBe(2);
    expect(cellCount(html, "اشتباه صحيح")).toBe(0);
    expect(cellCount(html, "اشتباه خاطئ")).toBe(0);
    expect(cellCount(html, "سليمة صحيحة")).toBe(0);
  });

  it("sorts the per-port table by اشتباه فائت descending, then port key ascending, and gives each port an honest own-denominator rate", () => {
    const model = buildOutcomeModel([
      { port: "منفذ ألف", missedSuspicion: 1, correctClean: 1 }, // 2 missed decisions
      { port: "منفذ باء", missedSuspicion: 3, correctClean: 1 }, // 6 missed decisions — should rank first
      { port: "منفذ جيم", correctClean: 1 }, // 0 missed decisions — should rank last
    ]);
    const html = outcomeMatrixSlide(model, 6, 20, false);
    const portsSection = html.slice(html.indexOf('class="v2-om-ports"'));
    const order = ["منفذ باء", "منفذ ألف", "منفذ جيم"].map((name) => portsSection.indexOf(name));
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("mutes a port's rate to — (not 0%) when its own evaluable count is below the sufficiency cut", () => {
    // A single image at one port: 2 evaluable decisions total, well under the
    // `insufficient` band's floor, so the port's rates must render muted. The
    // matrix's OTHER three cells (0 of the 2 evaluable decisions) legitimately
    // ARE 0.0% here — that check is scoped to the ports table specifically,
    // not the whole page, so it doesn't false-positive on those real zeros.
    const model = buildOutcomeModel([{ port: "منفذ صغير", missedSuspicion: 1 }]);
    const html = outcomeMatrixSlide(model, 6, 20, false);
    const portsSection = html.slice(html.indexOf('class="v2-om-ports"'));
    expect(portsSection).not.toContain("0.0%");
    expect(portsSection).toContain('<span class="insuff">—</span>');
  });
});
