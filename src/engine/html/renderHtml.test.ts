import { describe, expect, it } from "vitest";
import { layoutFixture, layoutOf, withText } from "../__fixtures__/helpers";
import { FIXTURE_THEME } from "../__fixtures__/twoSlide";
import { LAYOUT, lineHeightPx } from "../layout/layoutReport";
import type { BarChartBox, TableBox } from "../layout/types";
import { renderHtml, themeIssues } from "./renderHtml";

const attr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
    expect(boxHtml(html, measureCell.id)).toContain(`data-value-key="${attr(measureCell.valueKey!)}"`);
    expect(boxHtml(html, dimCell.id)).toContain(`data-group-key="${attr(dimCell.groupKey!)}"`);
    expect(boxHtml(html, dimCell.id)).not.toContain("data-value-key");
  });

  it("every registered figure box is addressable by its value key", () => {
    for (const f of doc.figures) {
      expect(html).toContain(`data-value-key="${attr(f.valueKey)}"`);
      expect(boxHtml(html, f.boxId)).toContain(attr(f.valueKey));
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

  it("HTML line-height equals the value derived from LAYOUT", () => {
    expect(LAYOUT.lineHeightRatio).toBe(1.4);
    const title = doc.slides[0].boxes[0] as { sizePx: number; id: string };
    expect(lineHeightPx(title.sizePx)).toBe(Math.round(title.sizePx * LAYOUT.lineHeightRatio));
    expect(boxHtml(html, title.id)).toContain(`line-height:${lineHeightPx(title.sizePx)}px`);
    expect(html).toContain(`line-height:${lineHeightPx(22)}px`);
  });

  it("a value key with a quote and an ampersand is escaped inside the attribute", () => {
    const d = structuredClone(doc);
    const t = d.slides[1].boxes.find((b) => b.kind === "table") as TableBox;
    t.rows[0][1].valueKey = 'a"b&c';
    t.rows[0][0].groupKey = 'g"<&>';
    const h = renderHtml(d, theme, { title: "t" });
    expect(h).toContain('data-value-key="a&quot;b&amp;c"');
    expect(h).toContain('data-group-key="g&quot;&lt;&amp;&gt;"');
    expect(h).not.toContain('a"b&c');
  });

  it("hostile title, page id and box id cannot break out", () => {
    const d = structuredClone(doc);
    d.slides[0].pageId = 'p"><script>x</script>';
    d.slides[0].boxes[0].id = 'b" onload="x';
    const h = renderHtml(d, theme, { title: "</title><script>alert(1)</script>" });
    expect(h).not.toContain("<script");
    expect(h).toContain("<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>");
    expect(h).toContain('data-page="p&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
    expect(h).toContain('data-box="b&quot; onload=&quot;x"');
    expect(h).not.toContain('onload="x"');
  });

  it("a hostile font is refused, reported at its path and never interpolated", () => {
    const bad = { ...theme, font: 'x"</style><script>' };
    expect(themeIssues(bad)).toEqual([{ rule: "theme.invalid", path: "theme.font" }]);
    const h = renderHtml(doc, { ...bad, fontData: new Uint8Array([1]) }, { title: "t" });
    expect(h).not.toContain("<script");
    expect(h).not.toContain("</style><");
    expect(h).not.toContain("@font-face");
    expect(h).toContain("font-family: sans-serif");
  });

  it("a hostile colour is refused, reported at its path and never interpolated", () => {
    const bad = { ...theme, ink: { ...theme.ink, navy: 'red" onload="x' }, tones: { ...theme.tones, primary: "url(http://evil)" } };
    expect(themeIssues(bad).map((i) => i.path).sort()).toEqual(["theme.ink.navy", "theme.tones.primary"]);
    const d = structuredClone(doc);
    (d.slides[0].boxes[0] as { color: string }).color = 'red" onload="x';
    const h = renderHtml(d, bad, { title: "t" });
    expect(h).not.toContain("onload");
    expect(h).not.toContain("evil");
    expect(h).toContain("color:currentColor");
  });

  it("the fixture theme passes validation", () => {
    expect(themeIssues(theme)).toEqual([]);
  });

  it("snapshot", () => {
    expect(html).toContain('class="slide"');
    expect(html).toMatchSnapshot();
  });
});
