// C1 snapshot-first (2026-09-28 corrective plan): pins the deck2, document and
// workbook output for a month whose rows carry the RAW stage aliases a real
// risk file uses (FIRST_STAGE / SECOND_STAG / "3" / FORTH_STAGE) plus one
// unmapped value, BEFORE the stage-grouping fix. The C1 tasks then review
// their snapshot diffs against this file: every changed line must be a stage
// label, key or ordering change and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { DEFAULT_EXEC_CONFIG, type ExecutiveReportInput } from "../executiveReportTypes";
import { makeDistribution, makeRow } from "../reportTestFixtures";
import { buildExecutiveDeckV2 } from "./deck2/index";
import { buildExecutiveReport } from "./index";
import { buildExecutiveWorkbookObject, SHEET_NAMES } from "./workbook/workbook";

function rawStageInput(): ExecutiveReportInput {
  const rows = [
    makeRow("SC-1", "منفذ أ", { stage: "FORTH_STAGE" }),
    makeRow("SC-2", "منفذ ب", { stage: "SECOND_STAG" }),
    makeRow("SC-3", "منفذ ب", {
      stage: "SECOND_STAG",
      xrayLevelOneResult: "اشتباه",
      xrayLevelTwoResult: "اشتباه",
    }),
    makeRow("SC-4", "منفذ ب", { stage: "SECOND_STAG" }),
    makeRow("SC-5", "منفذ أ", { stage: "FIRST_STAGE" }),
    makeRow("SC-6", "منفذ ب", { stage: "3" }),
    makeRow("SC-7", "منفذ أ", { stage: "LEVEL-X" }),
  ];
  const distribution = makeDistribution(
    rows.map((row, index) => ({
      id: row.xrayImageId,
      assignedTo: index % 2 === 0 ? "u1" : "u2",
      status: index === 2 ? ("completed" as const) : ("pending" as const),
      row,
    })),
    { monthFolderName: "5-May-2026" },
  );
  return {
    monthFolderName: "5-May-2026",
    populationRows: rows,
    sample: null,
    distribution,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

function sheetRows(wb: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`missing sheet ${name}`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
}

describe("executive report editions on raw stage aliases — golden (C1 snapshot-first)", () => {
  // Both HTML editions stamp today's date; freeze Date only (the builders
  // yield through real setTimeout — see deck2.test.ts's golden snapshot).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deck2 html", async () => {
    expect(await buildExecutiveDeckV2(rawStageInput())).toMatchSnapshot();
  });

  it("document html", async () => {
    expect(await buildExecutiveReport(rawStageInput())).toMatchSnapshot();
  });

  it("workbook stage / coverage / accountability sheets", async () => {
    const wb = await buildExecutiveWorkbookObject(rawStageInput());
    expect({
      stages: sheetRows(wb, SHEET_NAMES.stages),
      coverage: sheetRows(wb, SHEET_NAMES.coverage),
      accountability: sheetRows(wb, SHEET_NAMES.accountability),
    }).toMatchSnapshot();
  });
});
