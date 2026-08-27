import { describe, it, expect } from "vitest";
import { buildSection1Slides } from "./deck";
import { computePopulationReportModel } from "./model";
import { makeRow, makeManifest, makeProcessingSummary } from "../reportTestFixtures";

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
