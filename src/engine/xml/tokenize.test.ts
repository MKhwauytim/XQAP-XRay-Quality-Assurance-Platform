import { describe, expect, it } from "vitest";
import { matchingClose, rewriteXml, setAttr, tokenizeXml } from "./tokenize";

describe("tokenizeXml", () => {
  it("tokenizes attributes and text and round-trips setAttr", () => {
    const x = '<a:p><a:pPr rtl="0"/><a:r><a:t>1 &amp; 2</a:t></a:r></a:p>';
    const t = tokenizeXml(x);
    expect(t.filter((k) => k.k !== "text").map((k) => (k as { name: string }).name)).toEqual(["a:p", "a:pPr", "a:r", "a:t", "a:t", "a:r", "a:p"]);
    expect(setAttr(x, t[1], "rtl", "1")).toBe('<a:p><a:pPr rtl="1"/><a:r><a:t>1 &amp; 2</a:t></a:r></a:p>');
  });

  it("decodes attribute values, keeps raw text, and removes with null", () => {
    const x = `<?xml version="1.0"?><a:latin typeface="A &amp; B" charset='0'/><!-- c --><a:t>x &lt; y</a:t>`;
    const t = tokenizeXml(x);
    expect(t.map((k) => k.k)).toEqual(["text", "self", "text", "open", "text", "close"]);
    const latin = t[1];
    if (latin.k === "text") throw new Error("expected a tag");
    expect(latin.attrs.get("typeface")).toBe("A & B");
    expect(t[4]).toMatchObject({ k: "text", text: "x &lt; y" });
    expect(setAttr(x, latin, "charset", null)).toContain('<a:latin typeface="A &amp; B"/>');
    expect(t.map((k) => x.slice(k.start, k.end)).join("")).toBe(x);
  });

  it("finds the matching close across nesting and rewrites only edited tokens", () => {
    const x = "<a:p><a:p></a:p> <a:r/></a:p>";
    const t = tokenizeXml(x);
    expect(matchingClose(t, 0)).toBe(t.length - 1);
    expect(rewriteXml(x, t, (k) => (k.k === "self" ? "<a:s/>" : undefined))).toBe("<a:p><a:p></a:p> <a:s/></a:p>");
  });
});
