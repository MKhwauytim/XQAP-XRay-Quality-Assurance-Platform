import JSZip from "jszip";
import { escapeText, matchingClose, rewriteXml, serializeTag, tokenizeXml } from "../xml/tokenize";
import type { XmlTag, XmlToken } from "../xml/tokenize";

/**
 * OOXML post-processing on the zip pptxgenjs wrote (PoC techniques, M5, M13):
 * - `charset` and `pitchFamily` stripped from every font reference (they garble digits);
 * - every slide and chart paragraph keeps one `a:pPr` (the first) carrying `rtl="1" algn="r"`;
 * - every `a:tblPr` carries `rtl="1"`;
 * - every slide run with `lang="en-US"` (an LTR run from `splitRuns`) carries `<a:rtl val="0"/>`;
 * - master and layout paragraph defaults rewritten to `rtl="1" algn="r"`;
 * - chart parts and their workbooks renumbered from 1 in slide order (pptxgenjs numbers them from a module-level
 *   counter, so a second call in one process would otherwise write `chart2.xml`);
 * - master bullet characters U+2013/U+2014 replaced with "-" (T3 scans every part);
 * - every zip entry date and every `docProps/core.xml` date taken from `issuedAt`, in the outer file and in each
 *   embedded chart workbook (C17), which is rezipped with the same fixed options, so the bytes are reproducible.
 */
export async function postprocessPptx(zip: Uint8Array, issuedAt: string): Promise<Uint8Array> {
  const date = new Date(issuedAt);
  const stamp = w3cdtf(date);
  const src = await JSZip.loadAsync(zip);
  const out = new Map<string, Uint8Array | string>();
  const rename = chartRenames(entryNames(src));
  for (const name of entryNames(src)) {
    const file = src.file(name);
    if (!file) continue;
    const target = renamePath(name, rename);
    if (/^ppt\/embeddings\/[^/]+\.xlsx$/.test(name)) {
      out.set(target, await normaliseInnerZip(await file.async("uint8array"), date, stamp));
    } else if (/\.(xml|rels)$/.test(name)) {
      out.set(target, rewritePart(target, renameRefs(await file.async("string"), rename), stamp));
    } else {
      out.set(target, await file.async("uint8array"));
    }
  }
  const types = out.get("[Content_Types].xml");
  if (typeof types === "string") out.set("[Content_Types].xml", dropDanglingOverrides(types, new Set(out.keys())));
  return zipEntries(new Map([...out].sort(([a], [b]) => entryOrder(a, b))), date);
}

/** pptxgenjs declares an override for `slideMaster2.xml`, which it never writes; drop overrides with no part. */
const dropDanglingOverrides = (xml: string, parts: Set<string>): string =>
  xml.replace(/<Override\b[^>]*\bPartName="\/([^"]+)"[^>]*\/>/g, (m, part: string) => (parts.has(part) ? m : ""));

const entryOrder = (a: string, b: string): number =>
  a === b ? 0 : a === "[Content_Types].xml" ? -1 : b === "[Content_Types].xml" ? 1 : a < b ? -1 : 1;

const CHART_NO = /^ppt\/charts\/chart(\d+)\.xml$/;
const CHART_REF = /(chart|Microsoft_Excel_Worksheet)(\d+)\.(xml|xlsx)/g;

/** pptxgenjs chart number to its 1-based position among this file's charts. */
function chartRenames(names: string[]): Map<string, string> {
  const nums = names.map((n) => CHART_NO.exec(n)?.[1]).filter((n): n is string => n !== undefined)
    .sort((a, b) => Number(a) - Number(b));
  return new Map(nums.map((n, i) => [n, String(i + 1)]));
}

const renamePath = (s: string, rename: Map<string, string>): string =>
  s.replace(CHART_REF, (m, stem: string, n: string, ext: string) => (rename.has(n) ? `${stem}${rename.get(n)}.${ext}` : m));

/** Chart and workbook references live in attribute values (`PartName`, `Target`); only those are rewritten. */
function renameRefs(xml: string, rename: Map<string, string>): string {
  if (rename.size === 0) return xml;
  const tokens = tokenizeXml(xml);
  return rewriteXml(xml, tokens, (t) => {
    if (!isTag(t) || t.k === "close") return undefined;
    let changed = false;
    const attrs = new Map<string, string>();
    for (const [k, v] of t.attrs) {
      const r = renamePath(v, rename);
      if (r !== v) changed = true;
      attrs.set(k, r);
    }
    return changed ? serializeTag({ ...t, attrs }) : undefined;
  });
}

/** Entry names without folders, `[Content_Types].xml` first, the rest sorted, so order never depends on write timing. */
function entryNames(z: JSZip): string[] {
  const names = Object.keys(z.files).filter((n) => !z.files[n].dir).sort();
  const ct = names.indexOf("[Content_Types].xml");
  if (ct > 0) names.unshift(...names.splice(ct, 1));
  return names;
}

async function zipEntries(entries: Map<string, Uint8Array | string>, date: Date): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [name, data] of entries) z.file(name, data, { date, createFolders: false });
  return z.generateAsync({
    type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "DOS", streamFiles: false,
  });
}

async function normaliseInnerZip(bytes: Uint8Array, date: Date, stamp: string): Promise<Uint8Array> {
  const src = await JSZip.loadAsync(bytes);
  const out = new Map<string, Uint8Array | string>();
  for (const name of entryNames(src)) {
    const file = src.file(name);
    if (!file) continue;
    out.set(name, name === "docProps/core.xml" ? coreDates(await file.async("string"), stamp) : await file.async("uint8array"));
  }
  return zipEntries(out, date);
}

/** ISO 8601 to the second, as `dcterms` dates are written. */
const w3cdtf = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function rewritePart(name: string, xml: string, stamp: string): string {
  if (name === "docProps/core.xml") return coreDates(xml, stamp);
  if (/^ppt\/(slides|charts)\/[^/]+\.xml$/.test(name)) return directionPart(xml, name.startsWith("ppt/slides/"));
  if (/^ppt\/(slideMasters|slideLayouts)\/[^/]+\.xml$/.test(name)) return masterPart(xml);
  return /\.xml$/.test(name) ? fontRefs(xml) : xml;
}

/** `dcterms:created` and `dcterms:modified` text set to the issue stamp. */
export function coreDates(xml: string, stamp: string): string {
  const tokens = tokenizeXml(xml);
  const dated = new Set<number>();
  tokens.forEach((t, i) => {
    if (t.k === "open" && (t.name === "dcterms:created" || t.name === "dcterms:modified")) dated.add(i);
  });
  return rewriteXml(xml, tokens, (t, i) => {
    if (dated.has(i)) {
      const next = tokens[i + 1];
      return next?.k === "text" ? undefined : serializeTag(t as XmlTag) + escapeText(stamp);
    }
    return dated.has(i - 1) && t.k === "text" ? escapeText(stamp) : undefined;
  });
}

const FONT_REF = new Set(["a:latin", "a:ea", "a:cs", "a:sym", "a:buFont"]);
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, "g");

const stripFont = (t: XmlTag): string | undefined =>
  FONT_REF.has(t.name) && (t.attrs.has("charset") || t.attrs.has("pitchFamily"))
    ? withAttrs(t, { charset: null, pitchFamily: null }) : undefined;

/** Any other part (theme, master): font references only. */
function fontRefs(xml: string): string {
  const tokens = tokenizeXml(xml);
  return rewriteXml(xml, tokens, (t) => (isTag(t) && t.k !== "close" ? stripFont(t) : undefined));
}
const PPR = '<a:pPr rtl="1" algn="r"/>';
const LTR_MARK = '<a:rtl val="0"/>';

const isTag = (t: XmlToken | undefined): t is XmlTag => t !== undefined && t.k !== "text";
const withAttrs = (t: XmlTag, set: Record<string, string | null>): string => {
  const attrs = new Map(t.attrs);
  for (const [k, v] of Object.entries(set)) if (v === null) attrs.delete(k); else attrs.set(k, v);
  return serializeTag({ ...t, attrs });
};

/** Slide or chart part: fonts, paragraph direction, table direction and (slides only) LTR run marks. */
export function directionPart(xml: string, ltrRuns: boolean): string {
  const tokens = tokenizeXml(xml);
  const replace = new Map<number, string>();
  /** Token indexes to drop whole: extra `a:pPr` elements. */
  const drop = new Set<number>();
  tokens.forEach((t, i) => {
    if (!isTag(t)) return;
    const font = t.k === "close" ? undefined : stripFont(t);
    if (font !== undefined) {
      replace.set(i, font);
    } else if (t.k !== "close" && t.name === "a:tblPr") {
      replace.set(i, withAttrs(t, { rtl: "1" }));
    } else if (t.k === "open" && t.name === "a:p") {
      paragraph(tokens, i, replace, drop);
    } else if (ltrRuns && t.k !== "close" && t.name === "a:rPr" && t.attrs.get("lang") === "en-US") {
      ltrRun(tokens, i, t, replace);
    }
  });
  return rewriteXml(xml, tokens, (_t, i) => (drop.has(i) ? "" : replace.get(i)));
}

/** First direct-child `a:pPr` kept and forced RTL; later ones dropped; one inserted when there is none. */
function paragraph(tokens: XmlToken[], open: number, replace: Map<number, string>, drop: Set<number>): void {
  const close = matchingClose(tokens, open);
  let kept = false;
  for (let j = open + 1; j < close; j++) {
    const t = tokens[j];
    if (!isTag(t) || t.k === "close") continue;
    const end = matchingClose(tokens, j);
    if (t.name === "a:pPr") {
      if (!kept) { replace.set(j, withAttrs(t, { rtl: "1", algn: "r" })); kept = true; }
      else for (let d = j; d <= end; d++) drop.add(d);
    }
    j = end;
  }
  if (!kept) replace.set(open, serializeTag(tokens[open] as XmlTag) + PPR);
}

function ltrRun(tokens: XmlToken[], i: number, t: XmlTag, replace: Map<number, string>): void {
  if (t.k === "self") { replace.set(i, serializeTag({ ...t, k: "open" }) + LTR_MARK + "</a:rPr>"); return; }
  const close = matchingClose(tokens, i);
  for (let j = i + 1; j < close; j++) {
    const u = tokens[j];
    if (isTag(u) && u.name === "a:rtl") return;
  }
  // Schema order puts a:rtl after the font and hyperlink children and before a:extLst.
  let at = close;
  for (let j = i + 1; j < close; j++) {
    const u = tokens[j];
    if (isTag(u) && u.k !== "close" && u.name === "a:extLst") { at = j; break; }
  }
  replace.set(at, LTR_MARK + serializeTag(tokens[at] as XmlTag));
}

/** Master and layout: every level default and paragraph property `rtl="1" algn="r"`; no `rtl="0"` or `algn="l"` left. */
export function masterPart(xml: string): string {
  const tokens = tokenizeXml(xml);
  return rewriteXml(xml, tokens, (t) => {
    if (!isTag(t) || t.k === "close") return undefined;
    const font = stripFont(t);
    if (font !== undefined) return font;
    const ch = t.attrs.get("char");
    if (t.name === "a:buChar" && ch !== undefined && ch.replace(LONG_DASH, "-") !== ch) return withAttrs(t, { char: ch.replace(LONG_DASH, "-") });
    if (/^a:(lvl\dpPr|defPPr|pPr)$/.test(t.name)) return withAttrs(t, { rtl: "1", algn: "r" });
    const fix: Record<string, string> = {};
    if (t.attrs.get("rtl") === "0") fix.rtl = "1";
    if (t.attrs.get("algn") === "l") fix.algn = "r";
    return Object.keys(fix).length > 0 ? withAttrs(t, fix) : undefined;
  });
}
