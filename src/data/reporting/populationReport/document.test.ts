import { describe, it, expect, vi } from "vitest";
import { buildPopulationDocument } from "./document";
import { makeRow, makeManifest, makeProcessingSummary, makeSampleMaster, makeDistribution } from "../reportTestFixtures";
import type { PopulationReportInput } from "./model";

function baseInput(): PopulationReportInput {
  const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" }), makeRow("2", "منفذ الحديثة", { portType: "بري" })];
  const sample = makeSampleMaster(populationRows);
  const distribution = makeDistribution(
    populationRows.map((r) => ({ id: r.xrayImageId, assignedTo: "user1", status: "completed" as const, row: { ...r } }))
  );
  return {
    monthFolderName: "8-August-2026",
    manifest: makeManifest(),
    processingSummary: makeProcessingSummary(),
    riskRawRowCount: 10,
    biRawRowCount: 8,
    populationRows,
    sampleRows: sample.rows,
    distributionEntries: distribution.entries,
    employeeDisplayNames: { user1: "أحمد" },
  };
}

describe("buildPopulationDocument", () => {
  it("produces a self-contained A4 document with all three sections", async () => {
    const html = await buildPopulationDocument(baseInput());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("تقرير المجتمع");
    expect(html).toContain("ميناء جدة");
    expect(html).toContain("منفذ الحديثة");
    expect(html).toContain("أحمد");
    expect(html).not.toContain("قيد الانتظار");
  });

  it("paginates per-employee detail rather than truncating it", async () => {
    const input = baseInput();
    // 50 distinct employees to force pagination of the employee tables
    const manyEntries = Array.from({ length: 50 }, (_, i) => ({
      xrayImageId: `IMG-${i}`,
      assignedTo: `user${i}`,
      status: "completed" as const,
      replacedById: null,
      lastEventAt: "2026-08-01T00:00:00.000Z",
      row: { ...input.populationRows[0], xrayImageId: `IMG-${i}` },
    }));
    input.distributionEntries = manyEntries;
    input.employeeDisplayNames = Object.fromEntries(manyEntries.map((e) => [e.assignedTo, `موظف ${e.assignedTo}`]));
    const html = await buildPopulationDocument(input);
    expect(html).toContain("موظف user0");
    expect(html).toContain("موظف user49"); // last employee still present, not truncated
  });

  describe("golden snapshot (deterministic-by-contract)", () => {
    it("matches the frozen-time snapshot", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
      try {
        expect(await buildPopulationDocument(baseInput())).toMatchSnapshot();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("export scope", () => {
    it("scope='population' excludes Sections 2+3's content", async () => {
      const html = await buildPopulationDocument(baseInput(), "population");
      expect(html).toContain("الاستلام");
      expect(html).not.toContain("العينة حسب المرحلة");
      expect(html).not.toContain("التوزيع حسب الموظف والمرحلة");
    });

    it("scope='sample' excludes Section 1's content but includes Sections 2+3 together", async () => {
      const html = await buildPopulationDocument(baseInput(), "sample");
      expect(html).not.toContain("بيانات المخاطر — قبل وبعد");
      expect(html).toContain("العينة حسب المرحلة");
      expect(html).toContain("التوزيع حسب الموظف والمرحلة");
    });
  });
});
