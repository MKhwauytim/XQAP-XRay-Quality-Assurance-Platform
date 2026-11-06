import { beforeAll, describe, expect, it } from "vitest";
import { buildOutputs, dropPart, editPart, editPptxText, writeFixtureWith } from "../__fixtures__/gateKit";
import type { Outputs } from "../__fixtures__/gateKit";
import { checkOoxml } from "./ooxmlSelfCheck";

let good: Outputs;
beforeAll(async () => { good = await buildOutputs(); });

describe("checkOoxml", () => {
  it("counts the fixture exactly", async () => {
    const r = await checkOoxml(good.pptx, good.xlsx, good.doc, good.plan, good.companion);
    expect(r.issues).toEqual([]);
    expect(r.counts).toMatchObject({ slides: 2, pptxTables: 1, pptxCharts: 1, pptxPictures: 0, xlsxTables: 2, xlsxPivots: 3, rawDigitHitsSkipped: 0 });
  });

  it("fails when a table part is deleted from the xlsx zip (silent-drop trap)", async () => {
    const r = await checkOoxml(good.pptx, await dropPart(good.xlsx, "xl/tables/table1.xml"), good.doc, good.plan);
    expect(r.issues[0].rule).toBe("gate.ooxml");
    expect(r.counts.xlsxTables).toBe(1);
    expect(r.issues).toContainEqual({ rule: "gate.ooxml", path: "xlsxTables", detail: "found 1, declared 2" });
    expect(r.issues).toContainEqual({ rule: "gate.ooxml", path: "xlsx: [Content_Types].xml", detail: "override for missing part xl/tables/table1.xml" });
  });

  it("fails on a part with no content type", async () => {
    const xlsx = await editPart(good.xlsx, "[Content_Types].xml", (x) => x.replace(/<Default Extension="rels"[^>]*\/>/, ""));
    const r = await checkOoxml(good.pptx, xlsx, good.doc, good.plan);
    expect(r.issues).toContainEqual({ rule: "gate.ooxml", path: "xlsx: _rels/.rels", detail: "part has no content type" });
  });

  it("fails on an Arabic-Indic digit in a slide, but only counts one in a raw sheet", async () => {
    const slideBad = await editPptxText(good.pptx, "70.00%", "\u0667\u0660%");
    expect((await checkOoxml(slideBad, good.xlsx, good.doc, good.plan)).issues[0]).toMatchObject({ rule: "gate.ooxml", path: "pptx: ppt/slides/slide1.xml" });
    const rawHit = await writeFixtureWith({ rawCell: "\u0663" });
    const r = await checkOoxml(rawHit.pptx, rawHit.xlsx, rawHit.doc, rawHit.plan, rawHit.companion);
    expect(r.issues).toEqual([]);
    expect(r.counts.rawDigitHitsSkipped).toBe(1);
  });

  it("fails on a part whose tags do not balance, and on bytes that are not a zip", async () => {
    const broken = await editPptxText(good.pptx, "</p:spTree>", "");
    expect((await checkOoxml(broken, good.xlsx, good.doc, good.plan)).issues[0]).toMatchObject({ rule: "gate.ooxml", path: "pptx: ppt/slides/slide1.xml" });
    const r = await checkOoxml(good.pptx, new Uint8Array([1, 2]), good.doc, good.plan);
    expect(r.issues[0]).toMatchObject({ rule: "gate.ooxml", path: "xlsx" });
  });
});
