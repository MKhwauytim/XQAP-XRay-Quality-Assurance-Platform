import { describe, expect, it } from "vitest";
import { packWith, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { Fixture } from "../__fixtures__/twoSlide";
import type { MessageKey } from "../messages";
import { mergePackMeasures, validateSpec } from "./validate";

describe("validateSpec", () => {
  it("accepts the two-slide fixture", () => {
    const f = twoSlideFixture();
    expect(validateSpec(f.spec, undefined, f.params)).toEqual([]);
  });

  it.each([
    ["unknown measure in a well", (f: Fixture) => { f.spec.pages[0]!.visuals[1]!.wells.values![0] = { measure: "nope" }; }, "measure.unknown", "pages[0].visuals[1].wells.values[0]"],
    ["text field dropped in barChart values", (f: Fixture) => { f.spec.pages[1]!.visuals[1]!.wells.values = [{ field: "port" }]; }, "well.invalid", "pages[1].visuals[1].wells.values[0]"],
    ["two axis fields on a bar chart", (f: Fixture) => { f.spec.pages[1]!.visuals[1]!.wells.axis!.push({ field: "portType" }); }, "well.invalid", "pages[1].visuals[1].wells.axis"],
    ["typed number in text", (f: Fixture) => { f.spec.pages[0]!.visuals[0]!.text = "نسبة 92%"; }, "literal.number", "pages[0].visuals[0].text"],
    ["bad formula", (f: Fixture) => { f.spec.model.measures[0]!.formula = "sum("; }, "formula.syntax", "model.measures[0].formula"],
    ["frame outside grid", (f: Fixture) => { f.spec.pages[0]!.visuals[0]!.frame.col = 23; }, "schema.invalid", "pages[0].visuals[0].frame"],
    ["frame on the title row", (f: Fixture) => { f.spec.pages[0]!.visuals[0]!.frame.row = 0; }, "schema.invalid", "pages[0].visuals[0].frame"],
    ["font under 20px", (f: Fixture) => { f.spec.pages[0]!.visuals[0]!.format!.sizePx = 18; }, "schema.invalid", "pages[0].visuals[0].format.sizePx"],
    ["missing required param", (f: Fixture) => { delete f.params.values.port; }, "schema.invalid", "params.values.port"],
    ["too many pages", (f: Fixture) => { f.spec.pages = Array(201).fill(f.spec.pages[0]); }, "limit.slides", "pages"],
    ["issuedAt not ISO", (f: Fixture) => { f.params.issuedAt = "yesterday"; }, "schema.invalid", "params.issuedAt"],
    ["measure cycle", (f: Fixture) => {
      f.spec.model.measures[0]!.formula = "@matchRate + 1";
      f.spec.model.measures[1]!.formula = "@studied + 1";
    }, "schema.invalid", "model.measures[0].formula"],
    ["dataset table named tblSource", (f: Fixture) => { f.spec.datasets[0]!.id = "source"; }, "schema.invalid", "datasets[0].id"],
    ["calc formula using a measure reference", (f: Fixture) => {
      f.spec.datasets[0]!.steps.push({ id: "s3", label: "حساب", kind: "calc", calc: { columnId: "x", type: "number", formula: "@studied" } });
    }, "formula.notAllowed", "datasets[0].steps[2].calc.formula"],
    ["too many visuals on a page", (f: Fixture) => { f.spec.pages[0]!.visuals = Array(41).fill(f.spec.pages[0]!.visuals[1]); }, "limit.visuals", "pages[0].visuals"],
  ] as [string, (f: Fixture) => void, MessageKey, string][])("rejects %s with its location", (_n, mutate, rule, path) => {
    const f = twoSlideFixture();
    mutate(f);
    expect(validateSpec(f.spec, undefined, f.params)).toContainEqual(expect.objectContaining({ rule, path }));
  });

  it("names the cycle path in the detail", () => {
    const f = twoSlideFixture();
    f.spec.model.measures[0]!.formula = "@matchRate + 1";
    f.spec.model.measures[1]!.formula = "@studied + 1";
    const hit = validateSpec(f.spec, undefined, f.params).find((i) => i.detail?.startsWith("measure cycle"));
    expect(hit?.detail).toBe("measure cycle: studied > matchRate > studied");
  });

  it("a spec with no pack is valid (pack mapping is optional)", () => {
    const f = twoSlideFixture();
    expect(f.spec.model.packId).toBeUndefined();
    expect(validateSpec(f.spec, undefined, f.params)).toEqual([]);
  });

  it("pack measures referenced by the spec are copied into model.measures", () => {
    const f = twoSlideFixture();
    const pack = packWith({ id: "packCount", formula: "count([الحالة])" });
    f.spec.pages[0]!.visuals[1]!.wells.values!.push({ measure: "packCount" });
    const merged = mergePackMeasures(f.spec, pack);
    expect(merged.model.measures.map((m) => m.id)).toContain("packCount");
    expect(merged.model.packId).toBe(pack.packId);
    expect(f.spec.model.measures.map((m) => m.id)).not.toContain("packCount");
    expect(validateSpec(merged, pack, f.params)).toEqual([]);
  });

  it("does not copy pack measures the spec never references", () => {
    const f = twoSlideFixture();
    const merged = mergePackMeasures(f.spec, packWith({ id: "packCount", formula: "count([الحالة])" }));
    expect(merged.model.measures.map((m) => m.id)).toEqual(["studied", "matchRate"]);
  });

  it("a spec measure sharing an id with a different pack measure is schema.invalid", () => {
    const f = twoSlideFixture();
    const pack = packWith({ id: "studied", formula: "count([العدد])" });
    expect(validateSpec(f.spec, pack, f.params)).toContainEqual(
      expect.objectContaining({ rule: "schema.invalid", path: "model.measures[0].id" }),
    );
  });
});
