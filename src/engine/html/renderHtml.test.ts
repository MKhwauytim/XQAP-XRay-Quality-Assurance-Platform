import { describe, expect, it } from "vitest";
import { layoutFixture, layoutOf, withText } from "../__fixtures__/helpers";
import { FIXTURE_THEME } from "../__fixtures__/twoSlide";
import type { BarChartBox, TableBox } from "../layout/types";
import { renderHtml } from "./renderHtml";

const theme = FIXTURE_THEME;
const doc = layoutFixture();
const html = renderHtml(doc, theme, { title: "تقرير" });

/** The element whose `data-box` is `id`, through its matching close tag (boxes of one kind do not nest). */
function boxHtml(h: string, id: string): string {
  const start = h.indexOf(`data-box="${id}"`);
  if (start < 0) throw new Error(`no box ${id}`);
  const open = h.lastIndexOf("<", start);
  const tag = /^<(\w+)/.exec(h.slice(open))![1];
  const end = h.indexOf(`</${tag}>`, start);
  return h.slice(open, end + tag.length + 3);
}

describe("renderHtml", () => {
  it("one section per slide", () => {
    expect(html.match(/class="slide"/g)).toHaveLength(2);
  });

  it("is static: no script, no input, no external URL except the SVG namespace", () => {
    expect(html).not.toMatch(/<script|<input|<select|<textarea|<button/);
    expect(html.replaceAll("http://www.w3.org/2000/svg", "")).not.toMatch(/https?:\/\//);
  });

  it("is RTL Arabic with the title escaped in <title>", () => {
    expect(html).toContain('<html lang="ar-SA" dir="rtl">');
    expect(html).toContain("<title>تقرير</title>");
    expect(renderHtml(doc, theme, { title: "a<b" })).toContain("<title>a&lt;b</title>");
  });

  it("a 2-line box has exactly one <br>", () => {
    const h = renderHtml(layoutOf(withText(`${"س".repeat(80)} ${"س".repeat(80)}`)), theme, { title: "t" });
    const text = layoutOf(withText(`${"س".repeat(80)} ${"س".repeat(80)}`)).slides[0].boxes.find((b) => b.kind === "text" && b.id.includes("p1text"))!;
    expect((text as { lines: unknown[] }).lines).toHaveLength(2);
    expect(boxHtml(h, text.id).match(/<br>/g)).toHaveLength(1);
  });

  it("every table cell carries data-box with its cell id", () => {
    expect(html).toMatch(/<td[^>]*data-box="s2-p2table-0-r1c1"/);
    const t = doc.slides[1].boxes.find((b) => b.kind === "table") as TableBox;
    for (const c of [...t.header, ...t.rows.flat()]) expect(html).toContain(`data-box="${c.id}"`);
  });

  it("measure cells carry data-value-key and dimension cells data-group-key", () => {
    const t = doc.slides[1].boxes.find((b) => b.kind === "table") as TableBox;
    const measureCell = t.rows[0].find((c) => c.valueKey !== undefined)!;
    const dimCell = t.rows[0].find((c) => c.groupKey !== undefined)!;
    expect(boxHtml(html, measureCell.id)).toContain(`data-value-key="${measureCell.valueKey}"`);
    expect(boxHtml(html, dimCell.id)).toContain(`data-group-key="${dimCell.groupKey}"`);
    expect(boxHtml(html, dimCell.id)).not.toContain("data-value-key");
  });

  it("every registered figure box is addressable by its value key", () => {
    for (const f of doc.figures) {
      expect(html).toContain(`data-value-key="${f.valueKey}"`);
      expect(boxHtml(html, f.boxId)).toContain(f.valueKey);
    }
  });

  it("Latin tokens sit in <span dir=\"ltr\">", () => {
    expect(html).toMatch(/<span dir="ltr">\d+\.\d\d%<\/span>/);
  });

  it("positions are absolute px from the boxes, no flex or grid", () => {
    const title = doc.slides[0].boxes[0];
    expect(boxHtml(html, title.id)).toContain(`left:${(title as { x: number }).x}px;top:${(title as { y: number }).y}px`);
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).toContain(".box { position: absolute; }");
  });

  it("bar chart is inline SVG with one keyed group per category", () => {
    const bar = doc.slides[1].boxes.find((b) => b.kind === "bar") as BarChartBox;
    const el = boxHtml(html, bar.id);
    expect(el).toContain("<svg");
    expect(el.match(/<g data-value-key=/g)).toHaveLength(bar.categories.length);
  });

  it("print CSS gives one page per slide", () => {
    expect(html).toContain("break-after: page");
    expect(html).toContain("size: 1920px 1080px");
  });

  it("embeds the font as @font-face data only when fontData is set", () => {
    expect(html).not.toContain("@font-face");
    const withFont = renderHtml(doc, { ...theme, fontData: new Uint8Array([1, 2, 3]) }, { title: "t" });
    expect(withFont).toContain("@font-face");
    expect(withFont).toContain("base64,AQID");
  });

  it("escapes < and & in user text", () => {
    const h = renderHtml(layoutOf(withText("أ < ب & ج")), theme, { title: "t" });
    expect(h).toContain("أ &lt; ب &amp; ج");
    expect(h).not.toContain("أ < ب");
  });

  it("snapshot", () => {
    expect(html).toContain('class="slide"');
    expect(html).toMatchSnapshot();
  });
});
