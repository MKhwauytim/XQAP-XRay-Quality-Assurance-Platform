import { createHash } from "node:crypto";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { layoutOf } from "../__fixtures__/helpers";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import { LAYOUT } from "../layout/layoutReport";
import type { LayoutDoc, TableBox, TextBox } from "../layout/types";
import { matchingClose, tokenizeXml } from "../xml/tokenize";
import type { XmlTag, XmlToken } from "../xml/tokenize";
import { emu } from "./units";
import { writePptx } from "./writePptx";

const ISSUED_AT = "2026-11-05T00:00:00Z";

/**
 * The two-slide fixture with the text visual narrowed to 4 grid columns: col 0 clipped to the 24px margin
 * gives a 296px frame, so «تقرير جدة: نسبة التوائم 70.00%» wraps to exactly 2 lines under the fixed-advance measurer.
 */
function fixtureDoc(): LayoutDoc {
  const f = twoSlideFixture();
  f.spec.pages[0].visuals[0].frame = { col: 0, row: 1, w: 4, h: 3, z: 1 };
  return layoutOf({ f, files: FIXTURE_FILES });
}

const build = async (): Promise<Uint8Array> =>
  writePptx(fixtureDoc(), twoSlideFixture().theme, { title: "تقرير المنافذ", issuedAt: ISSUED_AT });
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

const tag = (t: XmlToken | undefined): XmlTag | undefined => (t && t.k !== "text" ? t : undefined);
const opens = (t: XmlToken, name: string): boolean => t.k !== "text" && t.k !== "close" && t.name === name;

/** Every `a:p` with its direct-child `a:pPr` count and the first one's attributes. */
function paragraphs(parts: string[]): { pPrCount: number; attrs: Record<string, string> }[] {
  const out: { pPrCount: number; attrs: Record<string, string> }[] = [];
  for (const xml of parts) {
    const toks = tokenizeXml(xml);
    toks.forEach((t, i) => {
      if (!(t.k === "open" && t.name === "a:p")) return;
      const close = matchingClose(toks, i);
      const pprs: XmlTag[] = [];
      for (let j = i + 1; j < close; j++) {
        const u = tag(toks[j]);
        if (!u || u.k === "close") continue;
        if (u.name === "a:pPr") pprs.push(u);
        j = matchingClose(toks, j);
      }
      out.push({ pPrCount: pprs.length, attrs: Object.fromEntries(pprs[0]?.attrs ?? []) });
    });
  }
  return out;
}

/** Runs whose `a:t` text equals `text`, with their `lang` and run-level `a:rtl val`. */
function runsWithText(parts: string[], text: string): { lang?: string; rtlVal?: string }[] {
  const out: { lang?: string; rtlVal?: string }[] = [];
  for (const xml of parts) {
    const toks = tokenizeXml(xml);
    toks.forEach((t, i) => {
      if (!(t.k === "open" && t.name === "a:r")) return;
      const close = matchingClose(toks, i);
      let lang: string | undefined, rtlVal: string | undefined, body = "";
      for (let j = i + 1; j < close; j++) {
        const u = toks[j];
        if (opens(u, "a:rPr")) lang = (u as XmlTag).attrs.get("lang");
        if (opens(u, "a:rtl")) rtlVal = (u as XmlTag).attrs.get("val");
        if (opens(u, "a:t") && toks[j + 1]?.k === "text") body = (toks[j + 1] as { text: string }).text;
      }
      if (body === text) out.push({ lang, rtlVal });
    });
  }
  return out;
}

/** Each `a:tbl`: the `a:tblPr rtl`, `a:gridCol w` values and `a:tr h` values (header first). */
function tables(parts: string[]): { tblPrRtl?: string; gridCols: number[]; rowHeights: number[] }[] {
  const out: { tblPrRtl?: string; gridCols: number[]; rowHeights: number[] }[] = [];
  for (const xml of parts) {
    const toks = tokenizeXml(xml);
    toks.forEach((t, i) => {
      if (!(t.k === "open" && t.name === "a:tbl")) return;
      const close = matchingClose(toks, i);
      const r = { tblPrRtl: undefined as string | undefined, gridCols: [] as number[], rowHeights: [] as number[] };
      for (let j = i + 1; j < close; j++) {
        const u = tag(toks[j]);
        if (!u || u.k === "close") continue;
        if (u.name === "a:tblPr") r.tblPrRtl = u.attrs.get("rtl");
        if (u.name === "a:gridCol") r.gridCols.push(Number(u.attrs.get("w")));
        if (u.name === "a:tr") r.rowHeights.push(Number(u.attrs.get("h")));
      }
      out.push(r);
    });
  }
  return out;
}

/** The XML of the shape (`p:sp` or `p:graphicFrame`) whose `p:cNvPr name` equals `name`. */
function shapeXml(parts: string[], name: string): string {
  for (const xml of parts) {
    const toks = tokenizeXml(xml);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (!(t.k === "open" && (t.name === "p:sp" || t.name === "p:graphicFrame"))) continue;
      const close = matchingClose(toks, i);
      for (let j = i + 1; j < close; j++) {
        const u = tag(toks[j]);
        if (u && u.name === "p:cNvPr" && u.attrs.get("name") === name) return xml.slice(t.start, toks[close].end);
      }
      i = close;
    }
  }
  throw new Error(`no shape named ${name}`);
}

async function embeddedCoreXml(bytes: Uint8Array): Promise<string> {
  const outer = await JSZip.loadAsync(bytes);
  const name = Object.keys(outer.files).find((n) => /^ppt\/embeddings\/[^/]+\.xlsx$/.test(n));
  if (!name) throw new Error("no embedded workbook");
  const inner = await JSZip.loadAsync(await outer.file(name)!.async("uint8array"));
  return inner.file("docProps/core.xml")!.async("string");
}

let doc: LayoutDoc;
let pptxBytes: Uint8Array;
let zip: JSZip;
const xml = { all: [] as string[], slides: [] as string[], charts: [] as string[], slidesAndCharts: [] as string[], mastersAndLayouts: "" };

beforeAll(async () => {
  doc = fixtureDoc();
  pptxBytes = await build();
  zip = await JSZip.loadAsync(pptxBytes);
  const read = async (re: RegExp) => Promise.all(Object.keys(zip.files).filter((n) => re.test(n)).sort().map((n) => zip.file(n)!.async("string")));
  xml.all = await read(/\.xml$/);
  xml.slides = await read(/^ppt\/slides\/slide\d+\.xml$/);
  xml.charts = await read(/^ppt\/charts\/chart\d+\.xml$/);
  xml.slidesAndCharts = [...xml.slides, ...xml.charts];
  xml.mastersAndLayouts = (await read(/^ppt\/(slideMasters|slideLayouts)\/[^/]+\.xml$/)).join("\n");
});

describe("writePptx", () => {
  it("writes one slide per layout slide", () => {
    expect(xml.slides).toHaveLength(doc.slides.length);
    expect(doc.slides.length).toBe(2);
  });

  it("no charset or pitchFamily left", () => {
    expect(xml.all.join("\n")).not.toMatch(/charset=|pitchFamily=/);
  });

  it("every paragraph rtl=1 algn=r and one a:pPr per paragraph", () => {
    const ps = paragraphs(xml.slidesAndCharts);
    expect(ps.length).toBeGreaterThan(10);
    for (const p of ps) { expect(p.pPrCount).toBe(1); expect(p.attrs).toMatchObject({ rtl: "1", algn: "r" }); }
  });

  it("number runs are en-US with rtl val=0", () => {
    const r = runsWithText(xml.slides, "70.00%");
    expect(r.length).toBeGreaterThan(0);
    r.forEach((x) => { expect(x.lang).toBe("en-US"); expect(x.rtlVal).toBe("0"); });
    const arabic = runsWithText(xml.slides, "الملخص");
    expect(arabic).toEqual([{ lang: "ar-SA", rtlVal: undefined }]);
  });

  it("no U+200E, isolate marks or long dashes", () => {
    expect(xml.all.join("")).not.toMatch(/[‎⁦-⁩]/);
    const dashes = [0x2013, 0x2014].map((c) => String.fromCharCode(c));
    for (const d of dashes) expect(xml.all.join("")).not.toContain(d);
  });

  it("table geometry exact in EMU with tblPr rtl=1", () => {
    const layoutTable = doc.slides[1].boxes.find((b): b is TableBox => b.kind === "table")!;
    const t = tables(xml.slides)[0];
    expect(t.tblPrRtl).toBe("1");
    expect(t.gridCols).toEqual(layoutTable.colW.map(emu));
    expect(t.rowHeights[0]).toBe(emu(LAYOUT.headerH));
    const body = t.rowHeights.slice(1);
    expect(body).toHaveLength(layoutTable.rows.length);
    expect(body.every((h) => h === emu(layoutTable.rowH))).toBe(true);
    expect(shapeXml(xml.slides, layoutTable.id)).toContain("<a:tbl>");
  });

  it("chart has c:externalData and maxMin orientation", () => {
    expect(xml.charts).toHaveLength(1);
    expect(xml.charts[0]).toContain("<c:externalData");
    expect(xml.charts[0]).toContain('<c:orientation val="maxMin"/>');
    expect(xml.charts[0]).toContain('formatCode="0.00&quot;%&quot;"');
  });

  it("master and layouts carry no rtl=\"0\" or algn=\"l\"", () => {
    expect(xml.mastersAndLayouts).toContain('rtl="1"');
    expect(xml.mastersAndLayouts).not.toMatch(/rtl="0"|algn="l"/);
  });

  it("a 2-line box has one a:br", () => {
    const box = doc.slides[0].boxes.find((b): b is TextBox => b.id === "s1-p1text-0")!;
    expect(box.lines).toHaveLength(2);
    expect(shapeXml(xml.slides, "s1-p1text-0").match(/<a:br\b/g)).toHaveLength(1);
  });

  it("line spacing is spcPts from LAYOUT line height, insets zero", () => {
    const s = shapeXml(xml.slides, "s1-p1text-0");
    const box = doc.slides[0].boxes.find((b): b is TextBox => b.id === "s1-p1text-0")!;
    const pts = Math.round(box.sizePx * LAYOUT.lineHeightRatio) * 0.5 * 100;
    expect(s).toContain(`<a:spcPts val="${pts}"/>`);
    expect(s).toMatch(/lIns="0" tIns="0" rIns="0" bIns="0"/);
  });

  it("every figure box id names a shape, table cells by position", () => {
    expect(doc.figures.length).toBeGreaterThan(0);
    for (const f of doc.figures) {
      const m = /^(.*)-r(\d+)c(\d+)$/.exec(f.boxId);
      expect(shapeXml([xml.slides[f.slide - 1]], m ? m[1] : f.boxId)).toContain("<p:cNvPr");
    }
  });

  it("embedded workbook dates come from issuedAt", async () => {
    const inner = await embeddedCoreXml(pptxBytes);
    expect(inner).toContain("2026-11-05T00:00:00Z");
    expect(await zip.file("docProps/core.xml")!.async("string")).toContain(`<dcterms:created xsi:type="dcterms:W3CDTF">${ISSUED_AT}</dcterms:created>`);
    const stamps = Object.values(zip.files).map((f) => f.date.getTime());
    expect(new Set(stamps).size).toBe(1);
  });

  it("byte-identical across two calls", async () => {
    expect(sha(await build())).toBe(sha(await build()));
  });
});
