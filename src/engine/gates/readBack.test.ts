import { beforeAll, describe, expect, it } from "vitest";
import type { EngineIssue } from "../errors";
import { buildOutputs } from "../__fixtures__/gateKit";
import type { Outputs } from "../__fixtures__/gateKit";
import {
  UNBOXED, formatCached, layoutBoxes, readHtmlBoxes, readPptxBoxes, readProcessedRowCounts, readRawRowCounts,
  readXlsxSource, readXlsxSteps, writtenDataRows, zipParts,
} from "./readBack";

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
    const html = '<body><section data-slide="1"><div class="box t" data-box="a" style="left:10px;top:20px">x<br>y</div></section></body>';
    expect(readHtmlBoxes(html).get(1)).toEqual([{ id: "a", x: 10, y: 20, lines: 2, text: "x y" }]);
  });

  it("a nested unboxed div or span does not close the box early", () => {
    const html = '<body><section data-slide="1"><div data-box="a" style="left:1px;top:2px"><span>x</span><div>y</div>z 5</div>w</section></body>';
    expect(readHtmlBoxes(html).get(1)).toEqual([
      { id: "a", x: 1, y: 2, lines: 1, text: "x y z 5" },
      { id: UNBOXED, x: 0, y: 0, lines: 1, text: "w" },
    ]);
  });

  it("the layout read-back places cells like the writers do", async () => {
    const l = layoutBoxes(good.doc).get(2) ?? [];
    const p = (await readPptxBoxes(good.pptx)).get(2) ?? [];
    expect(l.map((b) => [b.id, b.x, b.y])).toEqual(p.map((b) => [b.id, b.x, b.y]));
  });

  it("counts written rows from the sheet XML: empty <row> elements and gaps in r count as blank rows", () => {
    const ws = (ref: string) => ({ "!ref": ref });
    const problems: string[] = [];
    expect(writtenDataRows('<row r="1"><c/></row><row r="2"/><row r="4"><c/></row>', ws("A1:D4"), problems)).toBe(3);
    expect(problems).toEqual([]);
    expect(writtenDataRows('<row r="1"><c/></row><row r="3"><c/></row>', ws("A1:D5"), problems)).toBe(2);
    expect(problems).toEqual(["dimension does not match rows: dimension 5, highest row 3"]);
    const dup: string[] = [];
    writtenDataRows('<row r="1"/><row r="2"/><row r="2"/>', ws("A1:A2"), dup);
    expect(dup).toEqual(["3 row elements for 2 rows"]);
  });

  it("counts raw rows in the companion and filled processed rows in the report", async () => {
    const issues: EngineIssue[] = [];
    expect(readRawRowCounts(good.companion, good.plan, good.spec, await zipParts(good.companion), issues)).toEqual(new Map([["studies", 12]]));
    expect(issues).toEqual([]);
    expect(readProcessedRowCounts(good.xlsx, await zipParts(good.xlsx), good.plan)).toEqual(new Map([["studies", 10]]));
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
