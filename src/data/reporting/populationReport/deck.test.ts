import { describe, it, expect, vi } from "vitest";
import { buildSection1Slides, buildPopulationDeck, buildPopulationDeckSlides } from "./deck";
import { computePopulationReportModel } from "./model";
import { makeRow, makeManifest, makeProcessingSummary, makeSampleMaster, makeDistribution } from "../reportTestFixtures";
import type { PopulationReportScope } from "./types";

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
