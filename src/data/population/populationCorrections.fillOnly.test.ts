import { describe, expect, it } from "vitest";
import { computeCorrectionPreview } from "./populationCorrections";

const index = new Map<string, Record<string, unknown>>([
  ["A", { xrayImageId: "A", stage: null, xrayLevelOneResult: "", xrayLevelTwoResult: "سليمة" }],
]);

describe("fill-only corrections", () => {
  it("fills blanks, keeps existing values, canonicalizes stage codes and rejects unknown values", () => {
    const preview = computeCorrectionPreview(
      [{ xrayImageId: "A", fields: { stage: "SECOND_STAG", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه" } }],
      index
    );
    expect(preview.changes.map((c) => [c.field, c.newValue])).toEqual([
      ["stage", "المستوى الثاني"],
      ["xrayLevelOneResult", "اشتباه"],
    ]);
    expect(preview.protectedChanges.map((c) => c.field)).toEqual(["xrayLevelTwoResult"]);

    const bad = computeCorrectionPreview([{ xrayImageId: "A", fields: { stage: "anything", xrayLevelOneResult: "x" } }], index);
    expect(bad.changes).toEqual([]);
    expect(bad.invalidValues.map((c) => c.field)).toEqual(["stage", "xrayLevelOneResult"]);
  });
});
