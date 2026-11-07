// Measured deck3 slides (`deckGeometry.ts`) to an editable PowerPoint file.
//
// Every slide becomes one PowerPoint slide built from native parts: text boxes
// (runs keep colour, size and weight), real tables, native column charts with
// embedded data for the deck3 CSS bar charts, rectangles and lines for panels
// and rules, and pictures for the logo and any svg chart.
//
// Ported from the Jeddah PowerPoint trial (poc/port-pptx/toPptx.mjs). Units:
// 144 px per inch, pt = px x 0.5. Zip post-processing makes every paragraph
// right-to-left, every table rtl, and puts each Latin/digit token in its own
// left-to-right run so PowerPoint keeps numbers like "15 / 37" in order.

import JSZip from "jszip";
import type { Run, SlideGeo } from "./deckGeometry";

const FONT = "Somar";
const FIT_SAFETY = 1.04;
const inch = (px: number): number => px / 144;
const pt = (px: number): number => px * 0.5;

/** "rgb(a)" to hex, blending any alpha over the backdrop hex. */
export function cssToHex(css: string | null | undefined, backdrop = "FFFFFF"): string {
  const mm = css ? css.match(/rgba?\(([^)]+)\)/) : null;
  if (!mm) return backdrop;
  const [r, g, b, a = 1] = mm[1].split(",").map((x) => parseFloat(x));
  const bd = [0, 2, 4].map((i) => parseInt(backdrop.slice(i, i + 2), 16));
  return [r, g, b].map((c, i) => Math.round(c * a + bd[i] * (1 - a)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** A bar label ("1,234" or "82.3%") as a number; null when it is not one. */
export function labelNumber(label: string | null | undefined): number | null {
  if (label === null || label === undefined) return null;
  const n = Number(String(label).replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

type PptxText = { text: string; options: Record<string, unknown> };
type TextRun = Extract<Run, { text: string }>;

function runsToPptx(input: Run[], bg: string): PptxText[] {
  let runs = input;
  // A block with no Arabic letters split over several spans becomes one run, so the
  // left-to-right wrapping in post-processing sees the whole cluster.
  const plain = runs.filter((r): r is TextRun => !r.br);
  if (plain.length > 1 && plain.length === runs.length && !plain.some((r) => /[؀-ۿ]/.test(r.text))) {
    runs = [{ ...plain[0], text: plain.map((r) => r.text).join("") }];
  }
  const out: PptxText[] = [];
  let soft = false;
  for (const r of runs) {
    if (r.br === "soft") { soft = true; continue; }
    if (r.br) { if (out.length) out[out.length - 1].options.breakLine = true; continue; }
    const brk = soft;
    soft = false;
    out.push({ text: r.text, options: { softBreakBefore: brk || undefined, color: cssToHex(r.color, bg), fontSize: pt(r.size), bold: r.bold, fontFace: FONT, lang: "ar-SA" } });
  }
  return out.length ? out : [{ text: "", options: {} }];
}

// An XML escape (`&amp;`, `&#1234;`) is matched first so it is never split into a Latin run.
const TOKEN = /(&[A-Za-z0-9#]+;)|[A-Za-z0-9][A-Za-z0-9.,%\-/:+]*(?:\s*\/\s*[A-Za-z0-9][A-Za-z0-9.,%\-/:+]*)*/g;

/** The right-to-left fixes the trial proved in real PowerPoint, applied to one slide or chart part. */
export function fixPartXml(xml: string, isSlide: boolean): string {
  let s = xml.replace(/(<a:(?:latin|ea|cs|sym) typeface="[^"]*")(?: pitchFamily="[^"]*")?(?: charset="[^"]*")?/g, "$1");
  s = s.replace(/<a:p>(?!\s*<a:pPr)/g, '<a:p><a:pPr rtl="1" algn="r"/>');
  s = s.replace(/<a:pPr\b([^>]*?)(\/?)>/g, (_m, attrs: string, close: string) => `<a:pPr${attrs.replace(/\s(?:rtl|algn)="[^"]*"/g, "")} rtl="1" algn="r"${close}>`);
  s = s.replace(/<a:tblPr\b(?![^>]*rtl=)/g, '<a:tblPr rtl="1"');
  // One a:pPr per paragraph (pptxgenjs writes one per run in multi-run text).
  s = s.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_p, inner: string) => {
    let n = 0;
    return `<a:p>${inner.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pp) => (n++ ? "" : pp))}</a:p>`;
  });
  if (!isSlide) return s;
  // Latin and digit tokens: own run, lang="en-US", run-level <a:rtl val="0"/>.
  return s.replace(/<a:r>(<a:rPr\b[^>]*?)(\/>|>([\s\S]*?)<\/a:rPr>)<a:t>([^<]*)<\/a:t><\/a:r>/g, (mm, open: string, _close: string, kids: string | undefined, t: string) => {
    const run = (txt: string, ltr: boolean): string => {
      const o = ltr ? open.replace(/lang="[^"]*"/, 'lang="en-US"') : open;
      const k = (kids ?? "") + (ltr ? '<a:rtl val="0"/>' : "");
      return `<a:r>${k ? `${o}>${k}</a:rPr>` : `${o}/>`}<a:t>${txt}</a:t></a:r>`;
    };
    const parts: string[] = [];
    let last = 0;
    for (const m of t.matchAll(TOKEN)) {
      if (m[1]) continue;
      const idx = m.index ?? 0;
      if (idx > last) parts.push(run(t.slice(last, idx), false));
      parts.push(run(m[0], true));
      last = idx + m[0].length;
    }
    if (!parts.length) return mm;
    if (last < t.length) parts.push(run(t.slice(last), false));
    return parts.join("");
  });
}

/** The PowerPoint file for `slides`. */
export async function deckToPptx(slides: SlideGeo[], title: string): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "DECK3", width: inch(1920), height: inch(1080) });
  pptx.layout = "DECK3";
  pptx.rtlMode = true;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  pptx.title = title;
  const textBase = { fontFace: FONT, rtlMode: true, lang: "ar-SA", margin: 0, fit: "none" as const, valign: "top" as const, align: "right" as const };

  for (const g of slides) {
    const slide = pptx.addSlide();
    const bg = cssToHex(g.bg);
    slide.background = { color: bg };
    for (const s of g.shapes) {
      if (s.kind === "rect") {
        slide.addShape(pptx.ShapeType.rect, { x: inch(s.x), y: inch(s.y), w: inch(s.w), h: inch(s.h), fill: { color: cssToHex(s.fill, bg) }, line: { type: "none" } });
      } else if (s.dash === "dashed" || s.dash === "dotted") {
        const horiz = s.w >= s.h;
        slide.addShape(pptx.ShapeType.line, { x: inch(s.x), y: inch(s.y + (horiz ? s.h / 2 : 0)), w: inch(horiz ? s.w : 0), h: inch(horiz ? 0 : s.h), line: { color: cssToHex(s.color, bg), width: pt(Math.min(s.w, s.h)), dashType: s.dash === "dotted" ? "sysDot" : "dash" } });
      } else {
        slide.addShape(pptx.ShapeType.rect, { x: inch(s.x), y: inch(s.y), w: inch(s.w), h: inch(s.h), fill: { color: cssToHex(s.color, bg) }, line: { type: "none" } });
      }
    }
    for (const t of g.tables) {
      if (!t.rows.length) continue;
      const grid = t.rows.reduce((a, r) => (r.cells.length > a.cells.length && r.cells.every((c) => c.colspan === 1) ? r : a), t.rows[0]);
      const rows = t.rows.map((r) =>
        r.cells.map((c) => ({
          text: runsToPptx(c.runs, bg),
          options: {
            colspan: c.colspan > 1 ? c.colspan : undefined,
            fontFace: FONT, fontSize: pt(c.size), bold: c.bold, color: cssToHex(c.color, bg), align: "right", valign: "middle", rtlMode: true, lang: "ar-SA",
            margin: [0, inch(c.padR), 0, inch(c.padL)].map((v) => Math.min(v, 0.99)),
            fill: c.fill ? { color: cssToHex(c.fill, bg) } : undefined,
            border: [
              c.bt ? { type: "solid", pt: pt(c.bt), color: cssToHex(c.btc, bg) } : { type: "none" },
              { type: "none" },
              c.bb ? { type: "solid", pt: pt(c.bb), color: cssToHex(c.bbc, bg) } : { type: "none" },
              { type: "none" },
            ],
          },
        })),
      );
      slide.addTable(rows as unknown as Parameters<typeof slide.addTable>[0], { x: inch(t.x), y: inch(t.y), w: inch(t.w), colW: grid.cells.map((c) => inch(c.w)), rowH: t.rows.map((r) => inch(r.h)), autoPage: false });
    }
    for (const c of g.charts) {
      const top = c.y;
      const bottom = c.catsBox ? c.catsBox.y + c.catsBox.h : c.y + c.h;
      const H = bottom - top;
      const pts = c.points;
      const flat = pts.flat().filter((p): p is Extract<typeof p, { w: number }> => p.label !== null && (p.hPct ?? 0) > 0 && labelNumber(p.label) !== null);
      if (!flat.length) continue;
      // Axis range from two bars: hPct = (v - min) / (max - min) * 100.
      let min = 0;
      let max: number;
      const a = flat[0];
      const av = labelNumber(a.label) ?? 0;
      const b = flat.find((p) => labelNumber(p.label) !== av);
      if (b) {
        const slope = (b.hPct - a.hPct) / ((labelNumber(b.label) ?? 0) - av);
        min = av - a.hPct / slope;
        max = min + 100 / slope;
      } else {
        max = (av * 100) / a.hPct;
      }
      const isPct = flat.some((p) => /%/.test(p.label ?? ""));
      const cats = pts.map((_, i) => (c.cats.length === pts.length ? c.cats[i].text : ""));
      const data = [];
      for (let k = 0; k < c.series; k++) data.push({ name: `s${k + 1}`, labels: cats, values: pts.map((gp) => labelNumber(gp[k]?.label ?? null) ?? 0) });
      const slot = c.w / pts.length;
      const barW = flat[0].w || slot / 2;
      const colors = c.series > 1
        ? Array.from({ length: c.series }, (_, k) => cssToHex(pts.map((gp) => gp[k]).find((p) => p?.color)?.color ?? "rgb(0,0,0)"))
        : pts.map((gp) => cssToHex(gp[0]?.color ?? "rgb(200,200,200)"));
      slide.addChart(pptx.ChartType.bar, data, {
        x: inch(c.x), y: inch(top), w: inch(c.w), h: inch(H),
        layout: { x: 0, y: 0, w: 1, h: c.h / H },
        barDir: "col", barGrouping: "clustered",
        chartColors: colors,
        barGapWidthPct: Math.max(0, Math.min(500, Math.round(((slot - c.series * barW) / barW) * 100))),
        showLegend: false,
        valAxisHidden: true, valAxisMinVal: min, valAxisMaxVal: max, valGridLine: { style: "none" }, valAxisLineShow: false,
        catAxisLabelFontFace: FONT, catAxisLabelFontSize: pt(c.cats[0]?.size ?? 18), catAxisLabelColor: cssToHex(c.cats[0]?.color ?? "rgb(16,48,79)"), catAxisLineShow: false,
        // First category on the right, as in the HTML. PowerPoint accepts "maxMin";
        // pptxgenjs's types list only "minMax".
        catAxisOrientation: "maxMin" as "minMax",
        showValue: true, dataLabelPosition: "outEnd", dataLabelFontFace: FONT, dataLabelFontSize: pt(flat[0].labelSize), dataLabelColor: cssToHex(flat[0].labelColor ?? "rgb(16,48,79)"), dataLabelFontBold: true,
        dataLabelFormatCode: isPct ? '0.0"%"' : "#,##0",
        lang: "ar-SA",
      });
      for (const r of c.refs) slide.addShape(pptx.ShapeType.line, { x: inch(r.x), y: inch(r.y), w: inch(r.w), h: 0, line: { color: cssToHex(r.color), width: 1.5, dashType: "dash" } });
    }
    for (const t of g.texts) {
      const multi = t.lines > 1;
      const r = t.rect;
      // Single-line text keeps the HTML box with wrap off; wrapped text keeps the width the
      // browser wrapped at (x FIT_SAFETY), anchored on the right edge.
      const w = multi ? Math.min(t.content.w, r.w * FIT_SAFETY) : r.w;
      const x = multi ? r.x + r.w - w : r.x;
      const lh = t.runs.find((x2): x2 is TextRun => !x2.br)?.lh ?? 30;
      slide.addText(runsToPptx(t.runs, bg) as unknown as Parameters<typeof slide.addText>[0], {
        ...textBase,
        x: inch(x), y: inch(r.y), w: inch(w), h: inch(r.h + 2),
        wrap: multi,
        lineSpacing: multi ? pt(lh) : undefined,
      });
    }
    for (const im of g.images) {
      if (im.src.startsWith("data:image/svg+xml")) {
        const svg = decodeURIComponent(im.src.replace(/^data:image\/svg\+xml(;charset=utf-8)?,/, ""));
        const bytes = new TextEncoder().encode(svg);
        let bin = "";
        for (const byte of bytes) bin += String.fromCharCode(byte);
        slide.addImage({ data: `image/svg+xml;base64,${btoa(bin)}`, x: inch(im.x), y: inch(im.y), w: inch(im.w), h: inch(im.h) });
      } else if (im.src.startsWith("data:")) {
        slide.addImage({ data: im.src.replace(/^data:/, ""), x: inch(im.x), y: inch(im.y), w: inch(im.w), h: inch(im.h) });
      }
    }
  }

  const raw = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  const zip = await JSZip.loadAsync(raw);
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/(slides|charts)\/[^/]+\.xml$/.test(n))) {
    const file = zip.file(name);
    if (file) zip.file(name, fixPartXml(await file.async("string"), name.includes("slides/")));
  }
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/(slideMasters|slideLayouts)\/[^/]+\.xml$/.test(n))) {
    const file = zip.file(name);
    if (file) zip.file(name, (await file.async("string")).replace(/rtl="0"/g, 'rtl="1"').replace(/algn="l"/g, 'algn="r"'));
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
