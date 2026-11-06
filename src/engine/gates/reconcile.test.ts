import { beforeAll, describe, expect, it } from "vitest";
import { buildOutputs } from "../__fixtures__/gateKit";
import type { Outputs } from "../__fixtures__/gateKit";
import { readXlsxSteps } from "./readBack";
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

  it("fails when a step sheet is missing", async () => {
    const steps = (await readXlsxSteps(good.xlsx, good.plan)).slice(1);
    expect(checkReconciliation(good.processed, steps)).toEqual([{ rule: "gate.reconcile", path: "studies.s1", detail: "step sheet missing" }]);
  });
});
