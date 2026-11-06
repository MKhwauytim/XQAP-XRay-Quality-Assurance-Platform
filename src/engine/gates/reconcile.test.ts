import { beforeAll, describe, expect, it } from "vitest";
import { buildOutputs, dropLastRow } from "../__fixtures__/gateKit";
import type { Outputs } from "../__fixtures__/gateKit";
import { FIXTURE_FILES, FIXTURE_SHEET, twoSlideFixture } from "../__fixtures__/twoSlide";
import { runGates } from "./runGates";
import { readProcessedRowCounts, readRawRowCounts, readXlsxSteps, zipParts } from "./readBack";
import { checkReconciliation } from "./reconcile";

let good: Outputs;
beforeAll(async () => { good = await buildOutputs(); });

describe("checkReconciliation", () => {
  it("fails when a step's removed count is off by one", async () => {
    const steps = await readXlsxSteps(good.xlsx, good.plan);
    expect(checkReconciliation(good.processed, steps)).toEqual([]);
    steps[0].removed += 1;
    expect(checkReconciliation(good.processed, steps)[0].rule).toBe("gate.reconcile");
  });

  const rowsOf = async (o: Outputs) => ({
    raw: readRawRowCounts(o.companion, o.plan, o.spec),
    processed: readProcessedRowCounts(o.xlsx, await zipParts(o.xlsx), o.plan),
  });

  it("reads the companion: a raw row dropped from its raw sheet fails", async () => {
    const steps = await readXlsxSteps(good.xlsx, good.plan);
    expect(checkReconciliation(good.processed, steps, await rowsOf(good))).toEqual([]);
    const rawSheet = good.plan.companion.sheets.find((s) => s.kind === "raw")?.name ?? "";
    const companion = await dropLastRow(good.companion, rawSheet);
    expect(checkReconciliation(good.processed, steps, await rowsOf({ ...good, companion }))).toEqual([
      { rule: "gate.reconcile", path: "studies", detail: "companion raw rows 11 != raw count 12" },
    ]);
  });

  it("a truncated processed sheet fails against the processed rows and the last step", async () => {
    const steps = await readXlsxSteps(good.xlsx, good.plan);
    const xlsx = await dropLastRow(good.xlsx, "الدراسات");
    expect(checkReconciliation(good.processed, steps, await rowsOf({ ...good, xlsx }))).toEqual([
      { rule: "gate.reconcile", path: "studies", detail: "processed sheet rows 9 != processed 10" },
      { rule: "gate.reconcile", path: "studies", detail: "processed sheet rows 9 != last step out 10" },
    ]);
  });

  it("fails when a step sheet is missing", async () => {
    const steps = (await readXlsxSteps(good.xlsx, good.plan)).slice(1);
    expect(checkReconciliation(good.processed, steps)).toEqual([{ rule: "gate.reconcile", path: "studies.s1", detail: "step sheet missing" }]);
  });

  it("an interior blank row and an unreferenced extra sheet both reconcile; a dropped raw row still blocks", async () => {
    const files = structuredClone(FIXTURE_FILES);
    files[0].sheets[0].rows.splice(3, 0, [null, null, null, null]);
    files[0].sheets.push({ sheetName: "ملاحظات", headers: ["ملاحظة"], rows: [["أ"], ["ب"], ["ج"]] });
    const o = await buildOutputs(twoSlideFixture(), files);
    expect(o.processed.get("studies")?.rawCount).toBe(13);
    const steps = await readXlsxSteps(o.xlsx, o.plan);
    expect(checkReconciliation(o.processed, steps, await rowsOf(o))).toEqual([]);
    expect((await runGates(o)).issues.filter((i) => i.rule === "gate.reconcile")).toEqual([]);
    const rawSheet = o.plan.companion.sheets.find((s) => s.raw?.sheetName === FIXTURE_SHEET)?.name ?? "";
    const companion = await dropLastRow(o.companion, rawSheet);
    expect(checkReconciliation(o.processed, steps, await rowsOf({ ...o, companion }))).toEqual([
      { rule: "gate.reconcile", path: "studies", detail: "companion raw rows 12 != raw count 13" },
    ]);
  });
});
