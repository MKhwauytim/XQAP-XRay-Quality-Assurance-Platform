import { beforeAll, describe, expect, it } from "vitest";
import { buildOutputs, editPptxText } from "../__fixtures__/gateKit";
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
      expect.objectContaining({ rule: "gate.figureParity", page: 2, path: "s2-p2table-0-r1c2", detail: "HTML: box lacks [75.00% x1]" }),
      expect.objectContaining({ rule: "gate.figureParity", page: 2, detail: "HTML: extra [76.00% x1] missing [75.00% x1]" }),
    ]);
  });

  it("blocks two figures swapped between boxes, which the per-slide multiset alone would pass", async () => {
    let swapped = await editPptxText(good.pptx, "75.00%", "SWAP");
    swapped = await editPptxText(swapped, "66.67%", "75.00%");
    swapped = await editPptxText(swapped, "SWAP", "66.67%");
    const r = checkFigureParity(good.doc, await readPptxBoxes(swapped), readHtmlBoxes(good.html), src, good.values);
    expect(r.map((i) => i.path).sort()).toEqual(["s2-p2table-0-r1c2", "s2-p2table-0-r2c2"]);
    expect(r.every((i) => (i.detail ?? "").startsWith("PPTX: box lacks"))).toBe(true);
  });

  it("counts HTML text outside every box, such as a page-number footer", () => {
    const html = readHtmlBoxes(good.html.replace("</section>", '<div class="footer">صفحة <span>3</span></div></section>'));
    expect(checkFigureParity(good.doc, pptx, html, src, good.values)).toEqual([
      expect.objectContaining({ page: 1, detail: "HTML: extra [3 x1] missing []" }),
    ]);
  });

  it("blocks a digit in body text outside every slide", () => {
    const html = readHtmlBoxes(good.html.replace("</body>", "<p>2026</p></body>"));
    expect(checkFigureParity(good.doc, pptx, html, src, good.values)).toEqual([
      expect.objectContaining({ rule: "gate.figureParity", detail: "HTML: digits outside every slide [2026]" }),
    ]);
  });

  it("blocks المصدر rows that give one value key two displays", () => {
    const first = src.findIndex((r) => r.valueKey === "matchRate");
    const bad = src.map((r, i) => (i === first ? { ...r, display: "71.00%" } : r));
    const r = checkFigureParity(good.doc, pptx, readHtmlBoxes(good.html), bad, good.values);
    expect(r).toContainEqual(expect.objectContaining({ path: "matchRate", detail: expect.stringContaining("different displays") }));
  });

  it("fails when an المصدر row disagrees with the figure", () => {
    const bad = src.map((r) => (r.valueKey === "studied" ? { ...r, display: "11" } : r));
    const r = checkFigureParity(good.doc, pptx, readHtmlBoxes(good.html), bad, good.values);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((i) => i.rule === "gate.figureParity" && (i.detail ?? "").startsWith("المصدر"))).toBe(true);
  });
});
