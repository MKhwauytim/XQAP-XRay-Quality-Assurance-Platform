import { beforeAll, describe, expect, it } from "vitest";
import { buildOutputs } from "../__fixtures__/gateKit";
import type { Outputs } from "../__fixtures__/gateKit";
import { checkFigureParity, figureTokens } from "./figureParity";
import { readHtmlBoxes, readPptxBoxes, readXlsxSource } from "./readBack";
import type { ReadBox } from "./readBack";

let good: Outputs;
let pptx: Map<number, ReadBox[]>;
let src: { valueKey: string; display: string }[];
beforeAll(async () => {
  good = await buildOutputs();
  pptx = await readPptxBoxes(good.pptx);
  src = await readXlsxSource(good.xlsx);
});

describe("checkFigureParity", () => {
  it("tokenizes numbers with commas removed", () => {
    expect(figureTokens("نسبة 1,234.50% من 7")).toEqual(["1234.50%", "7"]);
  });

  it("passes the fixture", () => {
    expect(checkFigureParity(good.doc, pptx, readHtmlBoxes(good.html), src, good.values)).toEqual([]);
  });

  it("fails when an HTML number differs, on that page", () => {
    const html = readHtmlBoxes(good.html.replace("75.00%", "76.00%"));
    expect(checkFigureParity(good.doc, pptx, html, src, good.values)).toEqual([
      expect.objectContaining({ rule: "gate.figureParity", page: 2, detail: "HTML: extra [76.00% x1] missing [75.00% x1]" }),
    ]);
  });

  it("fails when an المصدر row disagrees with the figure", () => {
    const bad = src.map((r) => (r.valueKey === "studied" ? { ...r, display: "11" } : r));
    const r = checkFigureParity(good.doc, pptx, readHtmlBoxes(good.html), bad, good.values);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((i) => i.rule === "gate.figureParity" && (i.detail ?? "").startsWith("المصدر"))).toBe(true);
  });
});
