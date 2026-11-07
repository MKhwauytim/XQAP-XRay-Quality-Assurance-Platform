import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { coreDates, directionPart, masterPart, postprocessPptx } from "./postprocess";

describe("directionPart", () => {
  it("keeps the first a:pPr, allows whitespace after <a:p>, forces rtl/algn", () => {
    const x = '<a:p>\n  <a:pPr algn="l"/><a:r><a:rPr lang="ar-SA"/><a:t>ا</a:t></a:r><a:pPr rtl="0"><a:defRPr/></a:pPr></a:p>';
    expect(directionPart(x, true)).toBe('<a:p>\n  <a:pPr algn="r" rtl="1"/><a:r><a:rPr lang="ar-SA"/><a:t>ا</a:t></a:r></a:p>');
  });

  it("inserts a:pPr when missing and sets tblPr rtl", () => {
    expect(directionPart("<a:tbl><a:tblPr/></a:tbl><a:p><a:r><a:t>x</a:t></a:r></a:p>", false))
      .toBe('<a:tbl><a:tblPr rtl="1"/></a:tbl><a:p><a:pPr rtl="1" algn="r"/><a:r><a:t>x</a:t></a:r></a:p>');
  });

  it("strips charset and pitchFamily and marks en-US runs rtl val=0 before extLst", () => {
    const x = '<a:r><a:rPr lang="en-US"><a:latin typeface="C" pitchFamily="2" charset="0"/><a:extLst/></a:rPr><a:t>12</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t>3</a:t></a:r>';
    expect(directionPart(x, true)).toBe('<a:r><a:rPr lang="en-US"><a:latin typeface="C"/><a:rtl val="0"/><a:extLst/></a:rPr><a:t>12</a:t></a:r><a:r><a:rPr lang="en-US"><a:rtl val="0"/></a:rPr><a:t>3</a:t></a:r>');
  });
});

const EN_DASH = String.fromCharCode(0x2013);

describe("masterPart and coreDates", () => {
  it("rewrites level defaults and long-dash bullets", () => {
    const out = masterPart(`<a:lvl2pPr algn="l" rtl="0"><a:buFont typeface="Arial" charset="0"/><a:buChar char="${EN_DASH}"/></a:lvl2pPr><a:bodyPr rtl="0"/>`);
    expect(out).toBe('<a:lvl2pPr algn="r" rtl="1"><a:buFont typeface="Arial"/><a:buChar char="-"/></a:lvl2pPr><a:bodyPr rtl="1"/>');
  });

  it("sets created and modified", () => {
    const x = '<dcterms:created xsi:type="W">2020-01-01T00:00:00.123Z</dcterms:created><dcterms:modified></dcterms:modified>';
    expect(coreDates(x, "2026-11-05T00:00:00Z")).toBe('<dcterms:created xsi:type="W">2026-11-05T00:00:00Z</dcterms:created><dcterms:modified>2026-11-05T00:00:00Z</dcterms:modified>');
  });
});

describe("postprocessPptx", () => {
  async function sample(n: number, when: Date): Promise<Uint8Array> {
    const inner = new JSZip();
    inner.file("docProps/core.xml", "<dcterms:created>x</dcterms:created>", { date: when });
    const z = new JSZip();
    z.file("ppt/slides/slide1.xml", "<a:p/>", { date: when });
    z.file(`ppt/charts/chart${n}.xml`, "<c:chartSpace/>", { date: when });
    z.file(`ppt/charts/_rels/chart${n}.xml.rels`, `<Relationship Target="../embeddings/Microsoft_Excel_Worksheet${n}.xlsx"/>`, { date: when });
    z.file(`ppt/embeddings/Microsoft_Excel_Worksheet${n}.xlsx`, await inner.generateAsync({ type: "uint8array" }), { date: when });
    z.file("[Content_Types].xml", `<Override PartName="/ppt/charts/chart${n}.xml"/>`, { date: when });
    return z.generateAsync({ type: "uint8array" });
  }

  it("renumbers charts and normalises dates so different inputs give equal bytes", async () => {
    const a = await postprocessPptx(await sample(3, new Date(2001, 1, 1)), "2026-11-05T00:00:00Z");
    const b = await postprocessPptx(await sample(7, new Date(2019, 5, 5)), "2026-11-05T00:00:00Z");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const z = await JSZip.loadAsync(a);
    expect(Object.keys(z.files)[0]).toBe("[Content_Types].xml");
    expect(await z.file("[Content_Types].xml")!.async("string")).toBe('<Override PartName="/ppt/charts/chart1.xml"/>');
    expect(await z.file("ppt/charts/_rels/chart1.xml.rels")!.async("string")).toContain("Microsoft_Excel_Worksheet1.xlsx");
    const inner = await JSZip.loadAsync(await z.file("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx")!.async("uint8array"));
    expect(await inner.file("docProps/core.xml")!.async("string")).toBe("<dcterms:created>2026-11-05T00:00:00Z</dcterms:created>");
  });
});
