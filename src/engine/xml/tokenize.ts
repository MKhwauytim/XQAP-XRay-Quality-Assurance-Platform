/**
 * A scoped XML tokenizer for OOXML parts the engine writes or reads back (PPTX post-processing, Task 12 gates).
 * It is not a validating parser: it splits markup into tags and text with their source offsets. Attribute
 * values are stored decoded; text tokens keep their raw (still escaped) source. Declarations, comments,
 * CDATA and processing instructions come back as `text` tokens so a rewrite never drops them.
 */
export type XmlToken =
  | { k: "open" | "close" | "self"; name: string; attrs: Map<string, string>; start: number; end: number }
  | { k: "text"; text: string; start: number; end: number };

export type XmlTag = Extract<XmlToken, { name: string }>;

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const DECODE: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/g, (m, e: string) => {
    if (e[0] !== "#") return DECODE[e];
    const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

export const escapeAttr = (s: string): string =>
  s.replace(/[&<"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&quot;"));
export const escapeText = (s: string): string =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/** The end offset (exclusive) of a special construct starting at `i`, or -1 when `i` starts an ordinary tag. */
function specialEnd(xml: string, i: number): number {
  const close = (term: string): number => {
    const j = xml.indexOf(term, i);
    return j < 0 ? xml.length : j + term.length;
  };
  if (xml.startsWith("<!--", i)) return close("-->");
  if (xml.startsWith("<![CDATA[", i)) return close("]]>");
  if (xml.startsWith("<?", i)) return close("?>");
  if (xml.startsWith("<!", i)) return close(">");
  return -1;
}

/** Tokens in source order; concatenating `xml.slice(start, end)` over all tokens gives back `xml`. */
export function tokenizeXml(xml: string): XmlToken[] {
  const out: XmlToken[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) { out.push({ k: "text", text: xml.slice(i), start: i, end: xml.length }); break; }
    if (lt > i) out.push({ k: "text", text: xml.slice(i, lt), start: i, end: lt });
    const special = specialEnd(xml, lt);
    if (special >= 0) {
      out.push({ k: "text", text: xml.slice(lt, special), start: lt, end: special });
      i = special;
      continue;
    }
    const gt = tagEnd(xml, lt);
    const body = xml.slice(lt + 1, gt);
    if (body.startsWith("/")) {
      out.push({ k: "close", name: body.slice(1).trim(), attrs: new Map(), start: lt, end: gt + 1 });
    } else {
      const self = body.endsWith("/");
      const inner = self ? body.slice(0, -1) : body;
      const nameEnd = inner.search(/[\s]|$/);
      const attrs = new Map<string, string>();
      for (const m of inner.slice(nameEnd).matchAll(ATTR)) attrs.set(m[1], decodeXml(m[2] ?? m[3] ?? ""));
      out.push({ k: self ? "self" : "open", name: inner.slice(0, nameEnd), attrs, start: lt, end: gt + 1 });
    }
    i = gt + 1;
  }
  return out;
}

/** The `>` closing the tag at `lt`, skipping quoted attribute values. */
function tagEnd(xml: string, lt: number): number {
  let quote = "";
  for (let j = lt + 1; j < xml.length; j++) {
    const c = xml[j];
    if (quote) { if (c === quote) quote = ""; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return j;
  }
  return xml.length - 1;
}

/** Serialise a tag token from its name and attributes (double quotes, one space between attributes). */
export function serializeTag(t: { k: "open" | "close" | "self"; name: string; attrs: Map<string, string> }): string {
  if (t.k === "close") return `</${t.name}>`;
  let s = `<${t.name}`;
  for (const [k, v] of t.attrs) s += ` ${k}="${escapeAttr(v)}"`;
  return s + (t.k === "self" ? "/>" : ">");
}

/** Set (or with `null` remove) one attribute on a tag token; returns the whole document with that tag rewritten. */
export function setAttr(xml: string, token: XmlToken, name: string, value: string | null): string {
  if (token.k === "text" || token.k === "close") return xml;
  const attrs = new Map(token.attrs);
  if (value === null) attrs.delete(name);
  else attrs.set(name, value);
  return xml.slice(0, token.start) + serializeTag({ ...token, attrs }) + xml.slice(token.end);
}

/** Index of the token closing the element opened at `i` (itself for a self-closing tag). */
export function matchingClose(tokens: XmlToken[], i: number): number {
  const t = tokens[i];
  if (t.k !== "open") return i;
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    const u = tokens[j];
    if (u.k === "open" && u.name === t.name) depth++;
    else if (u.k === "close" && u.name === t.name && --depth === 0) return j;
  }
  return tokens.length - 1;
}

/**
 * Rebuild a document, replacing selected tokens. `edit` returns the replacement source for a token,
 * or `undefined` to keep the original bytes. Unedited regions are copied verbatim.
 */
export function rewriteXml(xml: string, tokens: XmlToken[], edit: (t: XmlToken, i: number) => string | undefined): string {
  const parts: string[] = [];
  let pos = 0;
  tokens.forEach((t, i) => {
    const r = edit(t, i);
    if (r === undefined) return;
    parts.push(xml.slice(pos, t.start), r);
    pos = t.end;
  });
  parts.push(xml.slice(pos));
  return parts.join("");
}
