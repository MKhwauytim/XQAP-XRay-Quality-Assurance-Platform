import { describe, expect, it } from "vitest";
import { cssToHex, fixPartXml, labelNumber } from "./deckToPptx";

describe("deckToPptx helpers", () => {
  it("turns computed colours into hex, blending alpha over the backdrop", () => {
    expect(cssToHex("rgb(16, 48, 79)")).toBe("10304F");
    expect(cssToHex("rgba(0, 0, 0, 0.5)", "FFFFFF")).toBe("808080");
    expect(cssToHex(null, "ABCDEF")).toBe("ABCDEF");
  });

  it("reads bar labels as numbers and refuses text", () => {
    expect(labelNumber("1,234")).toBe(1234);
    expect(labelNumber("82.3%")).toBe(82.3);
    expect(labelNumber("لا يوجد")).toBeNull();
    expect(labelNumber(null)).toBeNull();
  });

  it("makes every paragraph right-to-left and every table rtl", () => {
    const xml = fixPartXml('<a:tbl><a:tblPr firstRow="1"/></a:tbl><a:p><a:r><a:rPr lang="ar-SA"/><a:t>نص</a:t></a:r></a:p>', true);
    expect(xml).toContain('<a:tblPr rtl="1" firstRow="1"/>');
    expect(xml).toContain('<a:pPr rtl="1" algn="r"/>');
  });

  it("puts each Latin or digit token in its own left-to-right run", () => {
    const xml = fixPartXml('<a:p><a:r><a:rPr lang="ar-SA"/><a:t>الصفحة 15 / 37</a:t></a:r></a:p>', true);
    expect(xml).toContain('<a:rPr lang="en-US"><a:rtl val="0"/></a:rPr><a:t>15 / 37</a:t>');
    expect(xml).toContain('<a:rPr lang="ar-SA"/><a:t>الصفحة </a:t>');
  });

  it("never splits an XML escape, so the part stays well-formed", () => {
    const xml = fixPartXml('<a:p><a:r><a:rPr lang="ar-SA"/><a:t>مستوى أول &amp; ثاني</a:t></a:r></a:p>', true);
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain('<a:t>amp;');
    expect(xml).not.toMatch(/<a:t>&<\/a:t>/);
  });

  it("leaves chart parts' runs alone", () => {
    const xml = fixPartXml('<a:p><a:r><a:rPr lang="ar-SA"/><a:t>2025</a:t></a:r></a:p>', false);
    expect(xml).not.toContain('lang="en-US"');
  });
});

describe("somarFace", () => {
  it("picks the installed Somar Sans face for each CSS weight", async () => {
    const { somarFace } = await import("./deckToPptx");
    expect(somarFace(300)).toBe("Somar Sans Light");
    expect(somarFace(400)).toBe("Somar Sans");
    expect(somarFace(500)).toBe("Somar Sans Medium");
    expect(somarFace(600)).toBe("Somar Sans Bold");
    expect(somarFace(700)).toBe("Somar Sans Bold");
  });
});
