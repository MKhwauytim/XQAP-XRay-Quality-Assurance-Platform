// Executive deck v2 — القسم 4 (التغطية والمساءلة التشغيلية) test coverage.
// R4/R5-for-decks deck-parity task (2026-08-08). See section4/index.ts,
// coverage.ts, accountability.ts for the section's own doc comments.

import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { makeDistribution, makeRow } from "../../../reportTestFixtures";
import { buildReportModel } from "../../model/reportModel";
import { coverageSlide, coverageSlideBuilders, PORT_BUCKET_CAP } from "./coverage";
import { accountabilitySlide, accountabilitySlideBuilders, EMPLOYEE_ROW_CAP } from "./accountability";
import { sectionFourBuilders } from "./index";
import { buildExecutiveDeckV2 } from "../index";

function input(populationRows: PreparedPopulationRow[], overrides: Partial<ExecutiveReportInput> = {}): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
    ...overrides,
  };
}

describe("coverageSlide / accountabilitySlide — no distribution yet", () => {
  it("both render an honest empty state, never a crash, when model.distributionCoverage/accountabilityProgress are null", () => {
    const model = buildReportModel(input([makeRow("XR-1", "منفذ أ")]));
    expect(model.distributionCoverage).toBeNull();
    expect(model.accountabilityProgress).toBeNull();

    const cov = coverageSlide(model, 5, 20, false);
    expect(cov).toContain('id="slide-s4-coverage"');
    expect(cov).toContain("v2-cov-empty");
    expect(cov).toContain("لا يوجد توزيع لهذا الشهر بعد");
    expect(cov).not.toContain("v2-cov-split");

    const acc = accountabilitySlide(model, 6, 20, false);
    expect(acc).toContain('id="slide-s4-accountability"');
    expect(acc).toContain("v2-cov-empty");
    expect(acc).not.toContain("v2-acc-split");
  });

  it("coverageSlideBuilders/accountabilitySlideBuilders each return exactly one page regardless of null/non-null (unconditional TOC row contract)", () => {
    const modelEmpty = buildReportModel(input([makeRow("XR-1", "منفذ أ")]));
    expect(coverageSlideBuilders(modelEmpty, false)).toHaveLength(1);
    expect(accountabilitySlideBuilders(modelEmpty, false)).toHaveLength(1);
  });
});

describe("coverageSlide — distribution present", () => {
  it("lists stage and port buckets with each bucket's top contributing employee", () => {
    const row1 = makeRow("XR-1", "منفذ أ", { stage: "المستوى الأول" });
    const row2 = makeRow("XR-2", "منفذ أ", { stage: "المستوى الأول" });
    const distribution = makeDistribution([
      { id: "XR-1", assignedTo: "u1", status: "completed", row: row1 },
      { id: "XR-2", assignedTo: "u2", status: "pending", row: row2 },
    ]);
    const model = buildReportModel(
      { ...input([row1, row2]), distribution },
      { u1: "الموظف الأول", u2: "الموظف الثاني" },
    );
    const html = coverageSlide(model, 5, 20, false);
    expect(html).toContain("v2-cov-split");
    expect(html).toContain("منفذ أ");
    expect(html).toContain("المستوى الأول");
    // u1 has 1 assigned in the port bucket, u2 also has 1 — the top employee
    // (assigned desc, ties → username asc) is u1 ("الموظف الأول").
    expect(html).toContain("أعلى مساهم: الموظف الأول (1)");
    // Two employees contributed to this bucket → "+1 آخرون" note.
    expect(html).toContain("+1");
    expect(html).toContain("آخرون");
  });

  it("folds port buckets beyond PORT_BUCKET_CAP into one honest remainder row, summing its own totals", () => {
    const rows: PreparedPopulationRow[] = [];
    const entries: Array<{ id: string; assignedTo: string; status: "completed"; row: PreparedPopulationRow }> = [];
    const portCount = PORT_BUCKET_CAP + 3;
    for (let i = 0; i < portCount; i++) {
      const row = makeRow(`XR-${i}`, `منفذ ${i}`);
      rows.push(row);
      entries.push({ id: `XR-${i}`, assignedTo: "u1", status: "completed", row });
    }
    const distribution = makeDistribution(entries);
    const model = buildReportModel({ ...input(rows), distribution }, { u1: "الموظف الأول" });
    const html = coverageSlide(model, 5, 20, false);
    expect(html).toContain(`الباقي (3 منفذ)`);
    expect(html).toContain("v2-cov-fold-row");
    // Every named port still shows exactly one assigned/completed image —
    // the folded row's own totals (3 ports × 1 each) must sum to 3/3, not a
    // dropped or double-counted figure.
    const foldMatch = html.match(/الباقي \(3 منفذ\)<\/div><\/td><td>(\d+)<\/td><td>(\d+)<\/td>/);
    expect(foldMatch).not.toBeNull();
    expect(foldMatch![1]).toBe("3");
    expect(foldMatch![2]).toBe("3");
  });
});

describe("accountabilitySlide — distribution present", () => {
  it("shows replacement/reassignment KPIs, a per-employee progress table aggregated across ports, and replacement reasons", () => {
    const rowA = makeRow("XR-1", "منفذ أ");
    const rowB = makeRow("XR-2", "منفذ ب");
    const rowC = makeRow("XR-3", "منفذ أ");
    const distribution = makeDistribution([
      { id: "XR-1", assignedTo: "u1", status: "completed", row: rowA },
      { id: "XR-2", assignedTo: "u1", status: "completed", row: rowB },
      { id: "XR-3", assignedTo: "u1", status: "replaced", row: rowC, replacedById: "XR-9" },
    ]);
    const model = buildReportModel(
      { ...input([rowA, rowB, rowC]), distribution, replacementReasons: { "XR-3": "صورة غير واضحة" } },
      { u1: "الموظف الأول" },
    );
    const html = accountabilitySlide(model, 6, 20, false);
    expect(html).toContain("v2-acc-split");
    // u1's progress is aggregated ACROSS both ports (منفذ أ + منفذ ب) into
    // one row: 2 assigned/completed (the replaced XR-3 is excluded from
    // progress per computeManagementModel's own rule), never one row per port.
    expect(html).toContain("الموظف الأول");
    expect(html).toContain("صورة غير واضحة");
    expect((html.match(/الموظف الأول/g) ?? []).length).toBe(1);
  });

  it("folds employees beyond EMPLOYEE_ROW_CAP into one honest remainder row", () => {
    const rows: PreparedPopulationRow[] = [];
    const entries: Array<{ id: string; assignedTo: string; status: "completed"; row: PreparedPopulationRow }> = [];
    const employeeCount = EMPLOYEE_ROW_CAP + 2;
    const names: Record<string, string> = {};
    for (let i = 0; i < employeeCount; i++) {
      const uname = `u${i}`;
      const row = makeRow(`XR-${i}`, "منفذ أ");
      rows.push(row);
      entries.push({ id: `XR-${i}`, assignedTo: uname, status: "completed", row });
      names[uname] = `موظف ${i}`;
    }
    const distribution = makeDistribution(entries);
    const model = buildReportModel({ ...input(rows), distribution }, names);
    const html = accountabilitySlide(model, 6, 20, false);
    expect(html).toContain("الباقي (2 موظف)");
    expect(html).toContain("v2-acc-fold-row");
  });

  it("shows the no-activity note when a distribution exists but carries zero replacements/reassignments", () => {
    const row = makeRow("XR-1", "منفذ أ");
    const distribution = makeDistribution([{ id: "XR-1", assignedTo: "u1", status: "pending", row }]);
    const model = buildReportModel({ ...input([row]), distribution }, { u1: "الموظف الأول" });
    const html = accountabilitySlide(model, 6, 20, false);
    expect(html).toContain("v2-acc-note");
    expect(html).toContain("لا توجد استبدالات أو إعادة تعيين مسجّلة لهذا الشهر");
  });
});

describe("sectionFourBuilders — assembly", () => {
  it("always returns separator + coverage + accountability (3 pages), null or not", () => {
    const modelNull = buildReportModel(input([makeRow("XR-1", "منفذ أ")]));
    expect(sectionFourBuilders(modelNull, false)).toHaveLength(3);

    const row = makeRow("XR-1", "منفذ أ");
    const distribution = makeDistribution([{ id: "XR-1", assignedTo: "u1", status: "completed", row }]);
    const modelPresent = buildReportModel({ ...input([row]), distribution }, { u1: "الموظف الأول" });
    expect(sectionFourBuilders(modelPresent, false)).toHaveLength(3);
  });

  it("the separator slide carries section number 4 and no statistics (same contract as sections 1-3)", () => {
    const model = buildReportModel(input([makeRow("XR-1", "منفذ أ")]));
    const [separator] = sectionFourBuilders(model, false);
    const html = separator!(5, 20);
    expect(html).toContain('id="slide-sep-4"');
    expect(html).toContain(">04<");
    expect(html).toContain("التغطية والمساءلة التشغيلية");
    expect(html).not.toContain("v2-sep-extra");
    expect(html).not.toContain("v2-sep-stat");
  });
});

describe("buildExecutiveDeckV2 — section 4 end-to-end integration", () => {
  it("renders القسم 4's slides after section 3 and before the closing slide, with a matching TOC row", async () => {
    const row = makeRow("XR-1", "منفذ أ");
    const distribution = makeDistribution([{ id: "XR-1", assignedTo: "u1", status: "completed", row }]);
    const html = await buildExecutiveDeckV2({ ...input([row]), distribution }, { u1: "الموظف الأول" });

    expect(html).toContain('id="slide-sep-4"');
    expect(html).toContain('id="slide-s4-coverage"');
    expect(html).toContain('id="slide-s4-accountability"');
    expect(html).toContain("القسم الرابع — التغطية والمساءلة التشغيلية");

    const sep4Idx = html.indexOf('id="slide-sep-4"');
    const closingIdx = html.indexOf('id="slide-closing"');
    const sep3Idx = html.indexOf('id="slide-sep-3"');
    expect(sep3Idx).toBeGreaterThan(-1);
    expect(sep4Idx).toBeGreaterThan(sep3Idx);
    expect(closingIdx).toBeGreaterThan(sep4Idx);

    // Every content slide's page-foot total must agree with the actual
    // number of "num / total" occurrences (a smoke check that section 4's
    // page count was folded into the deck total, not just appended
    // separately — a mismatch here would mean the closing slide's own
    // "N / N" self-reference is wrong).
    const feet = [...html.matchAll(/<div class="v2-page-foot" dir="ltr">(\d+) \/ (\d+)<\/div>/g)];
    expect(feet.length).toBeGreaterThan(0);
    const total = feet[0]![2];
    expect(feet.every((m) => m[2] === total)).toBe(true);
    expect(feet[feet.length - 1]![1]).toBe(total);
  });

  it("still renders section 4's honest empty state (never omits the section) when distribution is null", async () => {
    const html = await buildExecutiveDeckV2(input([makeRow("XR-1", "منفذ أ")]));
    expect(html).toContain('id="slide-s4-coverage"');
    expect(html).toContain('id="slide-s4-accountability"');
    expect(html).toContain("لا يوجد توزيع لهذا الشهر بعد");
  });
});
