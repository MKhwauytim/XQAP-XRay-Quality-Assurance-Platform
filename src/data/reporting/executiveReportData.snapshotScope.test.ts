import { describe, expect, it } from "vitest";

import { DEFAULT_LABELS } from "../labels/labelsStore";
import { makePopulationRow, makeSampleMaster } from "../population/populationTestFixtures";
import { collectPortStats } from "./executive/deck2/slideKit";
import { collectStagePortStats } from "./executive/deck2/slides";
import { buildReportModel } from "./executive/model/reportModel";
import { buildExecutiveReportRows } from "./executiveReportData";
import { DEFAULT_EXEC_CONFIG, type ExecutiveReportInput } from "./executiveReportTypes";

const MONTH = "5-May-2026";

function orphanInput(): ExecutiveReportInput {
  const population = [
    makePopulationRow("P1", "منفذ أ"),
    makePopulationRow("P2", "منفذ أ"),
    makePopulationRow("P3", "منفذ ب"),
  ].map((row) => ({ ...row, portType: "منفذ بري" }));
  // S9 is sampled but missing from the population, and its port exists ONLY in the snapshot.
  const orphan = { ...makePopulationRow("S9", "ميناء جدة"), portType: "منفذ بحري" };
  return {
    monthFolderName: MONTH,
    populationRows: population,
    sample: makeSampleMaster([population[0]!, orphan]),
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

describe("population-scoped figures exclude sample-snapshot rows (A2)", () => {
  it("port profiles sum to the population, while sample-scoped fields keep the orphan", () => {
    const model = buildReportModel(orphanInput());
    const flagged = buildExecutiveReportRows(orphanInput()).filter((r) => r.fromSampleSnapshot);
    expect(flagged).toHaveLength(1);

    expect(model.kpis.totalPopulation).toBe(3);
    expect(sum(model.kpis.portProfiles.map((p) => p.population))).toBe(3);
    expect(sum(model.kpis.portProfiles.map((p) => p.clean + p.suspicious))).toBe(3);
    // The orphan's port shows no population, but its sampled image is still counted.
    const jeddah = model.kpis.portProfiles.find((p) => p.portName === "ميناء جدة");
    expect(jeddah).toMatchObject({ population: 0, sampleSize: 1, coverage: 0 });
    expect(sum(model.kpis.portProfiles.map((p) => p.sampleSize))).toBe(2);
    for (const p of model.kpis.portProfiles) expect(p.coverage).toBeLessThanOrEqual(100);
  });

  it("stage profiles (fallback branch) sum to the population", () => {
    const model = buildReportModel(orphanInput());
    expect(sum(model.kpis.stageProfiles.map((s) => s.population))).toBe(3);
    expect(sum(model.kpis.stageProfiles.map((s) => s.sampleSize))).toBe(2);
    expect(model.kpis.sampleCoverage).toBeCloseTo((1 / 3) * 100, 6);
  });

  it("the deck's per-port and per-stage tallies sum to the population", () => {
    const model = buildReportModel(orphanInput());

    const { land, sea } = collectPortStats(model);
    const all = [...land, ...sea];
    expect(sum(all.map((p) => p.total))).toBe(model.kpis.totalPopulation);
    expect(sum(all.map((p) => p.clean + p.suspicious))).toBe(model.kpis.totalPopulation);
    expect(sum(all.map((p) => p.sampleTotal))).toBe(2);

    const byStage = collectStagePortStats(model);
    const stageTotal = sum([...byStage.values()].flatMap((ports) => ports.map((p) => p.total)));
    expect(stageTotal).toBe(model.kpis.totalPopulation);
  });
});

describe("disclosure in exports (A2)", () => {
  it("the deck's month overview footnotes the snapshot rows, and only when there are some", async () => {
    const { buildExecutiveDeckV2 } = await import("./executive/deck2/index");
    const withOrphan = await buildExecutiveDeckV2(orphanInput());
    const clean = await buildExecutiveDeckV2({ ...orphanInput(), sample: null });
    const note = DEFAULT_LABELS.report_sample_snapshot_footnote.replace("{count}", "1");
    expect(withOrphan).toContain(note);
    expect(clean).not.toContain("نسخة العينة المحفوظة في مؤشرات العينة");
  });

  it("the workbook's image-rows sheet flags snapshot rows in an extra column, only for such a month", async () => {
    const { buildExecutiveWorkbookObject, SHEET_NAMES } = await import("./executive/workbook/workbook");
    const XLSX = await import("xlsx");
    const headerOf = async (input: ExecutiveReportInput): Promise<{ header: unknown[]; rows: unknown[][] }> => {
      const wb = await buildExecutiveWorkbookObject(input);
      const table = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET_NAMES.rows]!, { header: 1 });
      return { header: table[0] ?? [], rows: table.slice(1) };
    };
    const withOrphan = await headerOf(orphanInput());
    const column = withOrphan.header.indexOf(DEFAULT_LABELS.report_sample_snapshot_column);
    expect(column).toBeGreaterThan(0);
    expect(withOrphan.rows.filter((row) => row[column] === "نعم")).toHaveLength(1);
    const clean = await headerOf({ ...orphanInput(), sample: null });
    expect(clean.header).not.toContain(DEFAULT_LABELS.report_sample_snapshot_column);
  });
});
