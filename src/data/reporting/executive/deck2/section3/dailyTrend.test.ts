import { describe, expect, it } from "vitest";
import type { EmployeeAnswerFile, ItemAnswer } from "../../../../answers/answerTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import { buildReportModel } from "../../model/reportModel";
import type { ReportModel } from "../../model/reportModel";
import { P_CHART_MIN_N } from "../../model/reviewerKpis";
import { fmtPct } from "../../primitives";
import { DAILY_TREND_CSS, dailyTrendSlide } from "./dailyTrend";

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// IMPORTANT (round-1 review fix): `aggregateDecisions` (decisionFactTable.ts)
// only keeps a `DecisionRecord` whose `outcomeClass !== null`, and
// `outcomeClass = classifyOutcome(employeeDecision, studyReviewResult)` is
// non-null ONLY when a reviewer verdict (`row.expertResult`) exists — which
// itself only exists when an `employeeFiles` answer supplies the
// `expertResultFieldId` field (`executiveReportData.ts:136-140`). A fixture
// with `employeeFiles: []` therefore ALWAYS lands `model.dailyTrend.days` at
// `[]` regardless of what `xrayEntryDate` it carries — every one of this
// file's original 6 tests hit that empty branch by accident (Task 4 review,
// Finding 1). The fixtures below follow `levelAccuracy.test.ts`'s pattern
// (population rows + `EmployeeAnswerFile`/`ItemAnswer` answers keyed on
// `expertResultFieldId`) so the populated (non-empty) path is genuinely
// exercised.

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
 *  reads — same shape `levelAccuracy.test.ts` uses. */
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

/** The four outcome classes `classifyOutcome` produces, and the (employee
 *  verdict, reviewer verdict) pair that yields each one — both L1 and L2 get
 *  the SAME verdict here, so one "image" always contributes exactly 2
 *  decision records to the SAME outcome class. */
type OutcomeKind = "correctClean" | "falseSuspicion" | "correctSuspicion" | "missedSuspicion";
const OUTCOME_VERDICTS: Record<OutcomeKind, { verdict: Verdict; expert: Verdict }> = {
  correctClean: { verdict: "سليمة", expert: "سليمة" },
  falseSuspicion: { verdict: "اشتباه", expert: "سليمة" },
  correctSuspicion: { verdict: "اشتباه", expert: "اشتباه" },
  missedSuspicion: { verdict: "سليمة", expert: "اشتباه" },
};

/** One day's plan: how many images (each = 2 decision records) fall into each
 *  outcome class. `day: null` means undated (`xrayEntryDate` unparseable). */
type DayPlan = { day: number | null } & Partial<Record<OutcomeKind, number>>;

function buildModel(plans: DayPlan[]): ReportModel {
  const rows: PreparedPopulationRow[] = [];
  const items: ItemAnswer[] = [];
  let seq = 0;
  for (const plan of plans) {
    const dateStr = plan.day === null ? "غير معروف" : `2026-05-${String(plan.day).padStart(2, "0")}`;
    (Object.keys(OUTCOME_VERDICTS) as OutcomeKind[]).forEach((kind) => {
      const count = plan[kind] ?? 0;
      for (let i = 0; i < count; i++) {
        seq += 1;
        const id = `XR-${seq}`;
        const { verdict, expert } = OUTCOME_VERDICTS[kind];
        rows.push(
          popRow({
            xrayImageId: id,
            xrayEntryDate: dateStr,
            xrayLevelOneResult: verdict,
            xrayLevelTwoResult: verdict,
            sourceRowNumber: seq,
          }),
        );
        items.push(answerItem(id, expert));
      }
    });
  }
  return buildReportModel(input(rows, items.length > 0 ? [answerFile(items)] : []));
}

// n per image = 2 (L1 + L2). Chosen so one arm's denominator sits BELOW
// P_CHART_MIN_N and the other sits AT/ABOVE it, whatever that constant is.
const LOW_N_IMAGES = Math.floor((P_CHART_MIN_N - 1) / 2); // minN=5 → 2 images → n=4
const RANKABLE_IMAGES = Math.ceil((P_CHART_MIN_N + 1) / 2); // minN=5 → 3 images → n=6

// A three-day spread used by the "genuinely exercises the SPC path" tests:
//   day 1  — both series rankable (n well above P_CHART_MIN_N, 80% each)
//   day 5  — both series low-n (n below P_CHART_MIN_N)
//   day 10 — دقة السليمة rankable, دقة الاشتباه has ZERO denominator (gap)
const SPC_PLAN: DayPlan[] = [
  { day: 1, correctClean: 4, falseSuspicion: 1, correctSuspicion: 4, missedSuspicion: 1 },
  { day: 5, correctClean: LOW_N_IMAGES - 1, falseSuspicion: 1, correctSuspicion: 1 },
  { day: 10, correctClean: RANKABLE_IMAGES },
];

/** Extract the screen-reader table row for day `day` as its two `<td>` cell
 *  texts, in series order [دقة السليمة, دقة الاشتباه] — the same order
 *  `buildSeries` emits. Asserting on this text (not just substring presence)
 *  is what actually proves `bandSeriesFrom`'s per-day mapping, since it is
 *  the only place in the rendered page a day's n/lo/hi survive as text. */
function srCells(html: string, day: number): [string, string] {
  const re = new RegExp(`<tr><th scope="row">${day}</th>((?:<td>[^<]*</td>){2})</tr>`);
  const match = re.exec(html);
  expect(match, `no sr-table row found for day ${day}`).toBeTruthy();
  const cells = [...(match as RegExpExecArray)[1].matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1] ?? "");
  expect(cells).toHaveLength(2);
  return cells as [string, string];
}

type ParsedCell = { pct: number; lo: number | null; hi: number | null; n: number } | "gap";

/** Parse one `timeSeriesBand` sr-table cell, e.g. "80% (64.2–95.8%) ن=10",
 *  "100% ن=2" (low-n, no band), or "—" (gap). */
function parseCell(cell: string): ParsedCell {
  if (cell === "—") return "gap";
  const m = /^(-?\d+(?:\.\d+)?)%(?: \((-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?)%\))? ن=(\d+)$/.exec(cell);
  expect(m, `unexpected sr-table cell format: "${cell}"`).toBeTruthy();
  const [, pct, lo, hi, n] = m as RegExpExecArray;
  return {
    pct: Number(pct),
    lo: lo !== undefined ? Number(lo) : null,
    hi: hi !== undefined ? Number(hi) : null,
    n: Number(n),
  };
}

describe("dailyTrendSlide", () => {
  it("renders the slide shell with its own id and section", () => {
    const html = dailyTrendSlide(buildModel(SPC_PLAN), 5, 20, false);
    expect(html).toContain('id="slide-s3-daily-trend"');
    expect(html).toContain('data-section="section3"');
    // Proves this hit the populated chart branch, not the empty state —
    // exactly what the original fixture (accidentally) never did.
    expect(html).toContain("v2-ts-wrap");
  });

  it("states the dated share and the غير مؤرخ count as a headline, not a footnote", () => {
    const model = buildModel([
      { day: 1, correctClean: 1 }, // 2 dated evaluable decisions
      { day: null, correctClean: 1 }, // 2 undated evaluable decisions
    ]);
    // A real, non-trivial split — not the null placeholder an empty model gives.
    expect(model.dailyTrend.datedShare).toBe(50);
    expect(model.dailyTrend.undated.evaluable).toBe(2);

    const html = dailyTrendSlide(model, 5, 20, false);
    expect(html).toContain("غير مؤرخ");
    expect(html).toContain("v2-dt-share");
    expect(html).toContain(fmtPct(50));
    // 50% is below CAUTION_THRESHOLD (80%): the explicit caution line must render.
    expect(html).toContain("v2-dt-caution");
    // This fixture has real dated days — must NOT fall into the empty state.
    expect(html).not.toContain("v2-dt-empty");
  });

  it("renders an honest empty state when no decision carries a date", () => {
    // One real, evaluable decision (an expert verdict exists) that is simply
    // undated — isolates "no day has data" from "nothing is evaluable at
    // all", which is the failure mode the original fixture had by accident.
    const model = buildModel([{ day: null, correctClean: 1 }]);
    expect(model.dailyTrend.undated.evaluable).toBe(2);
    expect(model.dailyTrend.days).toEqual([]);

    const html = dailyTrendSlide(model, 5, 20, false);
    expect(html).toContain("v2-dt-empty");
    expect(html).not.toContain("v2-ts-wrap");
  });

  it("exposes four variant panels in preview mode and one in production", () => {
    const model = buildModel(SPC_PLAN);
    expect((dailyTrendSlide(model, 5, 20, true).match(/v2-variant-panel/g) ?? [])).toHaveLength(4);
    expect(dailyTrendSlide(model, 5, 20, false)).not.toContain("v2-variant-panel");
  });

  it("is deterministic", () => {
    const model = buildModel(SPC_PLAN);
    expect(dailyTrendSlide(model, 5, 20, false)).toBe(dailyTrendSlide(model, 5, 20, false));
  });

  it("ships CSS scoped to its own class prefix", () => {
    expect(DAILY_TREND_CSS).toContain(".v2-dt-");
  });

  // ── The subtle part: bandSeriesFrom's p-chart → BandPoint mapping ─────────
  // These read the emitted screen-reader table (the only place a day's own
  // n/lo/hi survive as text), not just substring presence, per the round-1
  // review finding that no test exercised this mapping at all.

  it("gives a rankable day (denominator ≥ P_CHART_MIN_N) both a point and a band", () => {
    const html = dailyTrendSlide(buildModel(SPC_PLAN), 5, 20, false);
    const [clean, susp] = srCells(html, 1);

    const cleanParsed = parseCell(clean);
    expect(cleanParsed).not.toBe("gap");
    const c = cleanParsed as Exclude<ParsedCell, "gap">;
    expect(c.n).toBe(10); // 4 correctClean + 1 falseSuspicion, ×2 records each
    expect(c.pct).toBe(80); // 8 correct / 10
    expect(c.n).toBeGreaterThanOrEqual(P_CHART_MIN_N);
    expect(c.lo).not.toBeNull();
    expect(c.hi).not.toBeNull();
    expect(c.lo as number).toBeLessThanOrEqual(c.pct);
    expect(c.hi as number).toBeGreaterThanOrEqual(c.pct);

    const suspParsed = parseCell(susp);
    expect(suspParsed).not.toBe("gap");
    const s = suspParsed as Exclude<ParsedCell, "gap">;
    expect(s.n).toBe(10); // 4 correctSuspicion + 1 missedSuspicion, ×2 records each
    expect(s.pct).toBe(80); // 8 correct / 10
    expect(s.lo).not.toBeNull();
    expect(s.hi).not.toBeNull();
  });

  it("keeps a low-n day's point but drops its band (denominator below P_CHART_MIN_N)", () => {
    const html = dailyTrendSlide(buildModel(SPC_PLAN), 5, 20, false);
    const [clean, susp] = srCells(html, 5);

    const cleanParsed = parseCell(clean);
    expect(cleanParsed).not.toBe("gap");
    const c = cleanParsed as Exclude<ParsedCell, "gap">;
    expect(c.n).toBe(4); // 1 correctClean + 1 falseSuspicion, ×2
    expect(c.n).toBeLessThan(P_CHART_MIN_N);
    expect(c.pct).toBe(50); // 2 correct / 4
    expect(c.lo).toBeNull();
    expect(c.hi).toBeNull();

    const suspParsed = parseCell(susp);
    expect(suspParsed).not.toBe("gap");
    const s = suspParsed as Exclude<ParsedCell, "gap">;
    expect(s.n).toBe(2); // 1 correctSuspicion, ×2
    expect(s.n).toBeLessThan(P_CHART_MIN_N);
    expect(s.pct).toBe(100); // 2 correct / 2
    expect(s.lo).toBeNull();
    expect(s.hi).toBeNull();
  });

  it("renders a gap for a series with zero denominator that day, independently of the other series", () => {
    const html = dailyTrendSlide(buildModel(SPC_PLAN), 5, 20, false);
    const [clean, susp] = srCells(html, 10);

    // دقة الاشتباه has no correctSuspicion/missedSuspicion images at all on
    // day 10 — the day must be an explicit gap ("—"), never a fabricated 0%.
    expect(parseCell(susp)).toBe("gap");

    // دقة السليمة has plenty of data the SAME day — one series' gap must not
    // suppress the other series' point.
    const cleanParsed = parseCell(clean);
    expect(cleanParsed).not.toBe("gap");
    const c = cleanParsed as Exclude<ParsedCell, "gap">;
    expect(c.n).toBe(RANKABLE_IMAGES * 2);
    expect(c.pct).toBe(100);
    expect(c.lo).not.toBeNull();
    expect(c.hi).not.toBeNull();
  });
});
