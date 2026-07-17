import { describe, expect, it } from "vitest";
import type { ProcessingWorkflowStep } from "../../../../../data/population/populationConfig";
import {
  mergeMappingAliases,
  normalizeWorkflowOrders,
  parseMappingAliases,
} from "./mappingSettingsConfig";

describe("mapping settings config helpers", () => {
  it("normalizes comma-separated aliases and removes empty entries", () => {
    expect(parseMappingAliases(" رقم الأشعة, ,Xray ID,رقم الأشعة ")).toEqual([
      "رقم الأشعة",
      "Xray ID",
      "رقم الأشعة",
    ]);
  });

  it("merges detected aliases without discarding configured aliases", () => {
    expect(
      mergeMappingAliases(
        { imageId: ["المعرف", "ID"] },
        { imageId: ["ID", "Image ID"], port: ["المنفذ"] },
      ),
    ).toEqual({
      imageId: ["المعرف", "ID", "Image ID"],
      port: ["المنفذ"],
    });
  });

  it("returns new workflow steps with stable ten-point ordering", () => {
    const steps = [
      { stepId: "second", order: 99 },
      { stepId: "first", order: 1 },
    ] as ProcessingWorkflowStep[];

    const normalized = normalizeWorkflowOrders(steps);

    expect(normalized.map(({ stepId, order }) => ({ stepId, order }))).toEqual([
      { stepId: "second", order: 10 },
      { stepId: "first", order: 20 },
    ]);
    expect(normalized[0]).not.toBe(steps[0]);
  });
});
