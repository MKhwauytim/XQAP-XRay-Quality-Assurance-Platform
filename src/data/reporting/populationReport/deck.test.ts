import { describe, it, expect, vi } from "vitest";
import { buildSection1Slides, buildPopulationDeck, buildPopulationDeckSlides } from "./deck";
import { computePopulationReportModel } from "./model";
import { makeRow, makeManifest, makeProcessingSummary, makeSampleMaster, makeDistribution } from "../reportTestFixtures";
import type { PopulationReportScope } from "./types";
import type { DistributionStatus } from "../../distribution/distributionTypes";
import type { PreparedPopulationRow } from "../../population/populationTypes";

function testModel() {
  return computePopulationReportModel({
    monthFolderName: "8-August-2026",
    manifest: makeManifest(),
    processingSummary: makeProcessingSummary(),
    riskRawRowCount: 100,
    biRawRowCount: 90,
    populationRows: [makeRow("1", "ميناء جدة", { portType: "بحري" }), makeRow("2", "منفذ الحديثة", { portType: "بري" })],
    sampleRows: [],
    distributionEntries: [],
    employeeDisplayNames: {},
  });
}

describe("buildSection1Slides", () => {
  it("builds cover, contents, divider, and 5 content slides for Section 1", () => {
    const slides = buildSection1Slides(testModel(), (num) => ({
      num,
      total: 13,
      sectionKey: "s1",
      sectionLabel: "المجتمع",
      footText: "تقرير المجتمع",
    }));
    expect(slides).toHaveLength(8);
    expect(slides.join("")).toContain("تقرير المجتمع");
    expect(slides.join("")).toContain("ميناء جدة");
    expect(slides.join("")).toContain("منفذ الحديثة");
  });

  it("never renders workflow-status text", () => {
    const html = buildSection1Slides(testModel(), (num) => ({
      num,
      total: 13,
      sectionKey: "s1",
      sectionLabel: "المجتمع",
      footText: "",
    })).join("");
    expect(html).not.toContain("قيد الانتظار");
    expect(html).not.toContain("مكتمل");
    expect(html).not.toContain("مستبدل");
  });
});

describe("buildPopulationDeck", () => {
  it("produces a self-contained HTML deck with all three sections and no workflow-status text", async () => {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([{ id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } }]);
    const html = await buildPopulationDeck({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("تقرير المجتمع");
    expect(html).toContain("أحمد");
    expect(html).not.toContain("قيد الانتظار");
  });

  it("includes the source-revisions footer when sourceRevisions is populated", async () => {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([{ id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } }]);
    const html = await buildPopulationDeck({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
      sourceRevisions: { "population.final.json": 3 },
    });
    expect(html).toContain("source-revisions");
    expect(html).toContain("population.final.json");
  });

  describe("golden snapshot (deterministic-by-contract)", () => {
    it("matches the frozen-time snapshot", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
      try {
        const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
        const sample = makeSampleMaster(populationRows);
        const distribution = makeDistribution([{ id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } }]);
        const html = await buildPopulationDeck({
          monthFolderName: "8-August-2026",
          manifest: makeManifest(),
          processingSummary: makeProcessingSummary(),
          riskRawRowCount: 10,
          biRawRowCount: 8,
          populationRows,
          sampleRows: sample.rows,
          distributionEntries: distribution.entries,
          employeeDisplayNames: { user1: "أحمد" },
        });
        expect(html).toMatchSnapshot();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("export scope", () => {
  function scopedModel() {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([
      { id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } },
    ]);
    return computePopulationReportModel({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    });
  }

  it("scope='population' includes only Section 1 content, still has cover/contents/closing", async () => {
    const html = await buildPopulationDeckSlides(scopedModel(), "population");
    expect(html).toContain("الاستلام"); // Section 1 content present
    expect(html).not.toContain("التوزيع حسب الموظف"); // Section 3 content absent
    expect(html).not.toContain("العينة حسب المرحلة"); // Section 2 content absent
  });

  it("scope='sample' includes Sections 2+3 together but not Section 1's content", async () => {
    const html = await buildPopulationDeckSlides(scopedModel(), "sample");
    expect(html).toContain("العينة حسب المرحلة"); // Section 2 present
    expect(html).toContain("التوزيع حسب الموظف والمرحلة"); // Section 3 present
    expect(html).not.toContain("بيانات المخاطر — قبل وبعد"); // Section 1 content absent
  });

  it("defaults to 'both' when scope is omitted, matching today's full output", async () => {
    const withDefault = await buildPopulationDeckSlides(scopedModel());
    const withExplicitBoth = await buildPopulationDeckSlides(scopedModel(), "both");
    expect(withDefault).toBe(withExplicitBoth);
  });

  describe("golden snapshot — non-default scope (deterministic-by-contract)", () => {
    it("matches the frozen-time snapshot for scope='population'", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
      try {
        const html = await buildPopulationDeck(
          {
            monthFolderName: "8-August-2026",
            manifest: makeManifest(),
            processingSummary: makeProcessingSummary(),
            riskRawRowCount: 10,
            biRawRowCount: 8,
            populationRows: [makeRow("1", "ميناء جدة", { portType: "بحري" })],
            sampleRows: [],
            distributionEntries: [],
            employeeDisplayNames: {},
          },
          "population" satisfies PopulationReportScope
        );
        expect(html).toMatchSnapshot();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("row caps on the fixed-canvas deck (Fix 2)", () => {
  it("caps port tables at 10 rows with an aggregated remainder instead of silently truncating", async () => {
    // 15 land ports, port-i has (i+1) "سليمة" rows, so totals are 1..15 and
    // the sort-by-total-desc order is fully deterministic.
    const populationRows: PreparedPopulationRow[] = [];
    for (let i = 0; i < 15; i++) {
      for (let j = 0; j <= i; j++) {
        populationRows.push(
          makeRow(`port${i}-r${j}`, `port-${i}`, {
            portType: "بري",
            xrayLevelOneResult: "سليمة",
            xrayLevelTwoResult: "سليمة",
          })
        );
      }
    }
    const model = computePopulationReportModel({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: [],
      distributionEntries: [],
      employeeDisplayNames: {},
    });
    // top-10 totals are 15,14,...,6 (sum 105); remainder is the 5 smallest
    // ports (totals 1..5, sum 15). 105 + 15 = 120 = the true grand total.
    expect(model.reconciled.byPort.land).toHaveLength(15);
    const trueTotal = model.reconciled.byPort.land.reduce((sum, p) => sum + p.counts.total, 0);
    expect(trueTotal).toBe(120);

    const html = await buildPopulationDeckSlides(model, "population");
    expect(html).toContain("أخرى (5)"); // remainder row's label, with count of folded ports
    // The 5 lowest-total ports (port-0..port-4) are folded away individually...
    expect(html).not.toContain(">port-0<");
    expect(html).not.toContain(">port-4<");
    // ...while the top-10 (port-5..port-14) still render as their own rows.
    expect(html).toContain(">port-14<");
    expect(html).toContain(">port-5<");
  });

  it("caps employee tables at 12 with an aggregated remainder for section 3", async () => {
    const baseRow = makeRow("base", "ميناء جدة", { portType: "بحري" });
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `IMG-${i}`,
      assignedTo: `emp${i}`,
      status: "completed" as DistributionStatus,
      row: { ...baseRow, xrayImageId: `IMG-${i}` },
    }));
    const distribution = makeDistribution(entries);
    const employeeDisplayNames = Object.fromEntries(entries.map((e) => [e.assignedTo, `الموظف-${e.assignedTo}`]));
    const model = computePopulationReportModel({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows: [],
      sampleRows: [],
      distributionEntries: distribution.entries,
      employeeDisplayNames,
    });
    expect(model.distribution.byEmployeeStage).toHaveLength(15);

    const html = await buildPopulationDeckSlides(model, "sample");
    // Each of the three Section 3 tables (stage/port/certScan) applies the
    // same 12-cap + remainder — the remainder label appears at least once
    // per table, so at least 3 occurrences total.
    const occurrences = html.split("آخرون (3)").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    expect(html).toContain("الموظف-emp0");
    expect(html).toContain("الموظف-emp11");
    expect(html).not.toContain("الموظف-emp12");
    expect(html).not.toContain("الموظف-emp14");
  });
});

describe("deck section-nav labels per scope (Fix 5)", () => {
  function scopedModelForNav() {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([
      { id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } },
    ]);
    return computePopulationReportModel({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    });
  }

  it("scope='population' never labels a slide's nav section 'التوزيع'", async () => {
    const html = await buildPopulationDeckSlides(scopedModelForNav(), "population");
    expect(html).not.toContain('data-section-label="التوزيع"');
  });

  it("scope='sample' never labels a slide's nav section 'المجتمع'", async () => {
    const html = await buildPopulationDeckSlides(scopedModelForNav(), "sample");
    expect(html).not.toContain('data-section-label="المجتمع"');
  });

  it("scope='both' keeps today's exact section boundaries (unchanged by the Fix 5 relabel)", async () => {
    const html = await buildPopulationDeckSlides(scopedModelForNav(), "both");
    // slides 1-8 -> s1/المجتمع, 9-11 -> s2/العينة, 12-16 -> s3/التوزيع
    expect(html).toContain('id="v3-slide-1" data-section="s1" data-section-label="المجتمع"');
    expect(html).toContain('id="v3-slide-8" data-section="s1" data-section-label="المجتمع"');
    expect(html).toContain('id="v3-slide-9" data-section="s2" data-section-label="العينة"');
    expect(html).toContain('id="v3-slide-11" data-section="s2" data-section-label="العينة"');
    expect(html).toContain('id="v3-slide-12" data-section="s3" data-section-label="التوزيع"');
    expect(html).toContain('id="v3-slide-16" data-section="s3" data-section-label="التوزيع"');
  });
});
