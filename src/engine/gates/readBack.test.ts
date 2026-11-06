import { beforeAll, describe, expect, it } from "vitest";
import { buildOutputs } from "../__fixtures__/gateKit";
import type { Outputs } from "../__fixtures__/gateKit";
import { formatCached, readHtmlBoxes, readPptxBoxes, readXlsxSource, readXlsxSteps } from "./readBack";

let good: Outputs;
beforeAll(async () => { good = await buildOutputs(); });

describe("read-backs", () => {
  it("reads PPTX table cells by {tableShapeName}-r{row}c{col} with offsets from the grid", async () => {
    const p = await readPptxBoxes(good.pptx);
    expect([...p.keys()]).toEqual([1, 2]);
    const cells = p.get(2) ?? [];
    expect(cells.some((b) => b.id.endsWith("-r1c1"))).toBe(true);
    expect(cells.find((b) => b.id.endsWith("-r1c2"))).toMatchObject({ text: "75.00%", lines: 1 });
  });

  it("reads the chart's cached values with the data-label format", async () => {
    const bar = (await readPptxBoxes(good.pptx)).get(2)?.find((b) => b.id === "s2-p2bar-0");
    expect(bar?.text).toBe("البطحاء الحديثة جدة 66.67% 66.67% 75.00%");
  });

  it("HTML and PPTX boxes agree on ids and positions for the fixture", async () => {
    const h = readHtmlBoxes(good.html).get(2) ?? [];
    const p = (await readPptxBoxes(good.pptx)).get(2) ?? [];
    expect(h.map((b) => b.id)).toEqual(p.map((b) => b.id));
    expect(h.find((b) => b.id.endsWith("-r3c1"))).toMatchObject({ x: 648, y: 237, text: "10" });
  });

  it("counts <br> in HTML as extra lines", () => {
    const html = '<section data-slide="1"><div class="box t" data-box="a" style="left:10px;top:20px">x<br>y</div></section>';
    expect(readHtmlBoxes(html).get(1)).toEqual([{ id: "a", x: 10, y: 20, lines: 2, text: "x y" }]);
  });

  it("reads المصدر rows by value key", async () => {
    const src = await readXlsxSource(good.xlsx);
    expect(src).toHaveLength(good.doc.figures.length);
    expect(src).toContainEqual({ valueKey: "matchRate", display: "70.00%" });
  });

  it("reads B4:D4 of each step sheet", async () => {
    expect(await readXlsxSteps(good.xlsx, good.plan)).toEqual([
      { datasetId: "studies", stepId: "s1", inCount: 12, removed: 1, outCount: 11 },
      { datasetId: "studies", stepId: "s2", inCount: 11, removed: 1, outCount: 10 },
    ]);
  });

  it("formats cached chart values like the label codes the writer emits", () => {
    expect(formatCached("66.67", '0.00"%"')).toBe("66.67%");
    expect(formatCached("1234.5", "#,##0.0")).toBe("1,234.5");
    expect(formatCached("", "#,##0")).toBe("");
  });
});
