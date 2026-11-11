// T2 step 3: out/geometry.json (+ out/model.json for the timeline) -> out/port-report.pptx.
//
// Every slide of the HTML port report becomes one PowerPoint slide built from
// native parts only: text boxes (one per HTML text block, runs keep colour,
// size and weight), real tables (one per HTML table, rows/columns/rules as laid
// out), native charts with embedded workbooks (deck3 CSS bar charts, the tier
// histograms, and the monthly timeline as a line chart), and rectangles/lines
// for panels, rules and swatches. The logo is the only picture.
//
// Units follow poc/pptx: 6350 EMU per px (144 px per inch), pt = px x 0.5.
// Zip post-processing: strip charset/pitchFamily, every paragraph rtl="1" algn="r",
// every table a:tblPr rtl="1", every Latin/digit token in its own run with lang="en-US" and <a:rtl val="0"/> (the T1 method; the paragraph stays rtl="1"), and the master/layout defaults set to rtl="1" algn="r".

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import pptxgen from "pptxgenjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
const geo = JSON.parse(readFileSync(join(outDir, "geometry.json"), "utf8"));
const { m } = JSON.parse(readFileSync(join(outDir, "model.json"), "utf8"));
const reportHtml = readFileSync(join(outDir, "report.html"), "utf8");
const themeVar = (name) => reportHtml.match(new RegExp(`--v3-${name}:(#[0-9a-fA-F]{6})`))?.[1].slice(1).toUpperCase();

// Somar installs on the owner's machines as one family per weight («Somar Light», «Somar», «Somar Medium», «Somar Bold»): Light, Regular,
// Medium and Bold are four separate faces, so the weight picks the face and bold stays off.
const FONT = "Somar Medium";
const FONT_BOLD = "Somar Bold";
// The port report sets Light and Regular text in Somar Medium (owner, 2026-11-10).
const face = (w0) => { const w = Math.max(w0, 500); return (w <= 350 ? "Somar Light" : w <= 450 ? FONT : w <= 550 ? "Somar Medium" : FONT_BOLD); };
const FIT_SAFETY = 1.04;
const inch = (px) => px / 144;
const pt = (px) => px * 0.5;

// "rgb(a)" -> hex, blending any alpha over the given backdrop hex.
function hex(css, backdrop = "FFFFFF") {
  const mm = css && css.match(/rgba?\(([^)]+)\)/);
  if (!mm) return backdrop;
  const [r, g, b, a = 1] = mm[1].split(",").map((x) => parseFloat(x));
  const bd = [0, 2, 4].map((i) => parseInt(backdrop.slice(i, i + 2), 16));
  return [r, g, b].map((c, i) => Math.round(c * a + bd[i] * (1 - a)).toString(16).padStart(2, "0")).join("").toUpperCase();
}
const num = (label) => (label === null || label === undefined ? null : Number(String(label).replace(/[,%\s]/g, "")));

const pptx = new pptxgen();
pptx.defineLayout({ name: "DECK3", width: inch(1920), height: inch(1080) });
pptx.layout = "DECK3";
pptx.rtlMode = true;
pptx.theme = { headFontFace: FONT, bodyFontFace: FONT, lang: "ar-SA" };
pptx.title = `تقرير أعمال ${m.displayName}`;

const textBase = { fontFace: FONT, rtlMode: true, lang: "ar-SA", margin: 0, fit: "none", valign: "top", align: "right" };
const runsToPptx = (runs, bg) => {
  // A block with no Arabic letters ("15 / 37" split over two spans) becomes one run, so the
  // LRM wrapping in post-processing sees the whole cluster and PowerPoint keeps "15 / 37".
  const plain = runs.filter((r) => !r.br);
  if (plain.length > 1 && plain.length === runs.length && !plain.some((r) => /[؀-ۿ]/.test(r.text))) runs = [{ ...plain[0], text: plain.map((r) => r.text).join("") }];
  const out = [];
  let soft = false;
  for (const r of runs) {
    if (r.br === "soft") { soft = true; continue; } // where the HTML wrapped: a line break inside the paragraph
    if (r.br) { if (out.length) out[out.length - 1].options.breakLine = true; continue; }
    const brk = soft; soft = false;
    out.push({ text: r.text, options: { softBreakBefore: brk || undefined, color: hex(r.color, bg), fontSize: pt(r.size), bold: false, fontFace: face(r.weight ?? (r.bold ? 700 : 400)), lang: "ar-SA" } });
  }
  return out.length ? out : [{ text: "", options: {} }];
};

// Line chart for the timeline svg, rebuilt from the same model fields timelineInner() reads.
function addTimeline(slide, s, bg) {
  const variantOf = (g) => (g.includes("البرية") || g.includes("بري") ? "land" : g.includes("البحرية") || g === "منفذ بحري" ? "sea" : "all");
  const types = [...m.groups].sort((x, y) => ({ land: 0, sea: 1, all: 2 })[variantOf(x.label)] - ({ land: 0, sea: 1, all: 2 })[variantOf(y.label)]);
  const months = m.monthly.filter((x) => x.selected !== null || x.all !== null);
  const C = { selected: themeVar("gold"), land: themeVar("green"), sea: themeVar("blue"), all: themeVar("navy") };
  const series = [
    ...types.filter((g) => g.label !== m.group).map((g) => ({ name: g.label, color: variantOf(g.label) === "sea" ? C.sea : C.land, width: 3, dash: "solid", labels: false, values: months.map((x) => x.byGroup[g.label] ?? null) })),
    { name: "جميع المنافذ", color: C.all, width: 3, dash: "dash", labels: "t", values: months.map((x) => x.all) },
    { name: m.displayName, color: C.selected, width: 6, dash: "solid", labels: "b", values: months.map((x) => x.selected) },
  ];
  const all = series.flatMap((x) => x.values).filter((v) => v !== null);
  const lo = Math.max(0, Math.floor((Math.min(...all) * 100) / 10) * 10 - 10);
  const hi = 105;
  // svg geometry (viewBox 1760x560, meet) inside its box
  const W = 1760, H = 560, padL = 40, padR = 140, padT = 44, padB = 90;
  const sc = Math.min(s.w / W, s.h / H);
  const offX = s.x + (s.w - W * sc) / 2, offY = s.y + (s.h - H * sc) / 2;
  const box = { x: offX, y: offY, w: W * sc, h: H * sc };
  slide.addShape(pptx.ShapeType.rect, { x: inch(s.x), y: inch(s.y), w: inch(s.w), h: inch(s.h), fill: { color: themeVar("panel") }, line: { type: "none" } });
  const data = series.map((x) => ({ name: x.name, labels: months.map((mo) => String(Number(mo.monthKey.slice(5)))), values: x.values.map((v) => (v === null ? null : Math.round(v * 10000) / 100)) }));
  slide.addChart(pptx.ChartType.line, data, {
    x: inch(box.x), y: inch(box.y), w: inch(box.w), h: inch(box.h),
    layout: { x: padL / W, y: padT / H, w: (W - padL - padR) / W, h: (H - padT - padB) / H },
    chartColors: series.map((x) => x.color),
    lineSize: 3, lineDataSymbol: "none",
    showLegend: false,
    valAxisMinVal: lo, valAxisMaxVal: hi, valAxisMajorUnit: 10, valAxisLabelFormatCode: '0"%"',
    valAxisLabelFontFace: FONT, valAxisLabelFontSize: 10, valAxisLabelColor: themeVar("muted"),
    valGridLine: { color: themeVar("hair"), size: 0.75 }, valAxisLineShow: false,
    catAxisLabelFontFace: FONT, catAxisLabelFontSize: pt(19), catAxisLabelColor: themeVar("muted"),
    catAxisOrientation: "maxMin", catAxisLineShow: false,
    showValue: true, dataLabelFormatCode: '0"%"', dataLabelFontSize: 8, dataLabelFontBold: false, dataLabelFontFace: FONT_BOLD, dataLabelColor: "FFFFFF",
    lang: "ar-SA",
  });
  // Year names under their months, as in the svg.
  for (const t of s.texts.filter((t) => t.bold && t.size >= 24)) {
    slide.addText(t.text, { ...textBase, x: inch(t.x - 20), y: inch(t.y), w: inch(t.w + 40), h: inch(t.h + 4), fontSize: pt(t.size * sc), bold: false, fontFace: FONT_BOLD, color: themeVar("navy") });
  }
  // Period-average reference lines (all ports dotted navy, the port dashed gold), at the svg's y.
  const yOf = (v) => box.y + sc * (padT + (H - padT - padB) * (1 - (v * 100 - lo) / (hi - lo)));
  for (const [v, color, dash] of [[m.allPorts.image.accuracy, C.all, "sysDot"], [m.selected.image.accuracy, C.selected, "dash"]]) {
    if (v === null) continue;
    slide.addShape(pptx.ShapeType.line, { x: inch(box.x + padL * sc), y: inch(yOf(v)), w: inch((W - padL - padR) * sc), h: 0, line: { color, width: 1, dashType: dash } });
  }
  return series;
}

const timelineMeta = []; // chart index -> series label positions, applied in post-processing
let chartNo = 0;

geo.forEach((g, si) => {
  const slide = pptx.addSlide();
  const bg = hex(g.bg);
  slide.background = { color: bg };
  for (const s of g.shapes) {
    if (s.kind === "rect") slide.addShape(pptx.ShapeType.rect, { x: inch(s.x), y: inch(s.y), w: inch(s.w), h: inch(s.h), fill: { color: hex(s.fill, bg) }, line: { type: "none" } });
    else if (s.dash === "dashed" || s.dash === "dotted") {
      const horiz = s.w >= s.h;
      slide.addShape(pptx.ShapeType.line, { x: inch(s.x), y: inch(s.y + (horiz ? s.h / 2 : 0)), w: inch(horiz ? s.w : 0), h: inch(horiz ? 0 : s.h), line: { color: hex(s.color, bg), width: pt(Math.min(s.w, s.h)), dashType: s.dash === "dotted" ? "sysDot" : "dash" } });
    } else slide.addShape(pptx.ShapeType.rect, { x: inch(s.x), y: inch(s.y), w: inch(s.w), h: inch(s.h), fill: { color: hex(s.color, bg) }, line: { type: "none" } });
  }
  for (const t of g.tables) {
    const grid = t.rows.reduce((a, r) => (r.cells.length > a.cells.length && r.cells.every((c) => c.colspan === 1) ? r : a), t.rows[0]);
    const colW = grid.cells.map((c) => inch(c.w));
    const rows = t.rows.map((r) =>
      r.cells.map((c) => ({
        text: runsToPptx(c.runs, bg),
        options: {
          colspan: c.colspan > 1 ? c.colspan : undefined,
          fontFace: face(c.weight ?? (c.bold ? 700 : 400)), fontSize: pt(c.size), bold: false, color: hex(c.color, bg), align: "right", valign: "middle", rtlMode: true, lang: "ar-SA",
          margin: [0, inch(c.padR), 0, inch(c.padL)].map((v) => Math.min(v, 0.99)),
          fill: c.fill ? { color: hex(c.fill, bg) } : undefined,
          border: [c.bt ? { type: "solid", pt: pt(c.bt), color: hex(c.btc, bg) } : { type: "none" }, { type: "none" }, c.bb ? { type: "solid", pt: pt(c.bb), color: hex(c.bbc, bg) } : { type: "none" }, { type: "none" }],
        },
      })),
    );
    slide.addTable(rows, { objectName: `TB${g.tables.indexOf(t)}`, x: inch(t.x), y: inch(t.y), w: inch(t.w), colW, rowH: t.rows.map((r) => inch(r.h)), autoPage: false });
  }
  for (const c of g.charts) {
    const top = c.y, bottom = c.catsBox ? c.catsBox.y + c.catsBox.h : c.y + c.h;
    const H = bottom - top;
    const pts = c.points;
    const flat = pts.flat().filter((p) => p.label !== null && p.hPct > 0);
    // Axis range from two bars: hPct = (v - min) / (max - min) * 100
    let min = 0, max = 100;
    const a = flat[0], b = flat.find((p) => num(p.label) !== num(a.label));
    if (a && b) { const slope = (b.hPct - a.hPct) / (num(b.label) - num(a.label)); min = num(a.label) - a.hPct / slope; max = min + 100 / slope; }
    else if (a) { min = 0; max = (num(a.label) * 100) / a.hPct; }
    const isPct = flat.some((p) => /%/.test(p.label));
    const cats = pts.map((_, i) => (c.cats.length === pts.length ? c.cats[i].text : ""));
    const data = [];
    for (let k = 0; k < c.series; k++) data.push({ name: c.series > 1 ? `s${k + 1}` : "s1", labels: cats, values: pts.map((gp) => num(gp[k]?.label ?? null)) });
    const slot = c.w / pts.length;
    const barW = flat[0]?.w ?? slot / 2;
    const colors = c.series > 1 ? Array.from({ length: c.series }, (_, k) => hex(pts.map((gp) => gp[k]).find((p) => p?.color)?.color ?? "rgb(0,0,0)")) : pts.map((gp) => hex(gp[0].color ?? "rgb(200,200,200)"));
    slide.addChart(pptx.ChartType.bar, data, {
      x: inch(c.x), y: inch(top), w: inch(c.w), h: inch(H),
      layout: { x: 0, y: 0, w: 1, h: c.h / H },
      barDir: "col", barGrouping: "clustered",
      chartColors: colors,
      barGapWidthPct: Math.max(0, Math.min(500, Math.round(((slot - c.series * barW) / barW) * 100))), barOverlapPct: 0,
      showLegend: false,
      valAxisHidden: true, valAxisMinVal: min, valAxisMaxVal: max, valGridLine: { style: "none" }, valAxisLineShow: false,
      catAxisLabelFontFace: FONT, catAxisLabelFontSize: pt(c.cats[0]?.size ?? 18), catAxisLabelColor: hex(c.cats[0]?.color ?? "rgb(16,48,79)"), catAxisLineShow: false,
      catAxisOrientation: "maxMin",
      showValue: true, dataLabelPosition: "outEnd", dataLabelFontFace: FONT_BOLD, dataLabelFontSize: pt(flat[0]?.labelSize ?? 18), dataLabelColor: hex(flat[0]?.labelColor ?? "rgb(16,48,79)"), dataLabelFontBold: false,
      dataLabelFormatCode: isPct ? '0.0"%"' : "#,##0",
      lang: "ar-SA",
    });
    chartNo++;
    for (const r of c.refs) slide.addShape(pptx.ShapeType.line, { x: inch(r.x), y: inch(r.y), w: inch(r.w), h: 0, line: { color: hex(r.color), width: pt(r.w > 0 ? 3 : 3), dashType: "dash" } });
  }
  for (const s of g.svgs) {
    const series = addTimeline(slide, s, bg);
    chartNo++;
    timelineMeta.push({ chart: chartNo, series });
  }
  g.texts.forEach((t, ti) => {
    const multi = t.lines > 1;
    const r = t.rect;
    // G7b: single-line HTML text = the HTML text box exactly, wrap off (it cannot wrap, and it
    // overflows to the left like right-aligned text would). Wrapped HTML text = the width the
    // browser wrapped at x FIT_SAFETY (1.04, poc/pptx T4), anchored on the right edge.
    const w = multi ? Math.min(t.content.w, r.w * FIT_SAFETY) : r.w;
    const x = multi ? r.x + r.w - w : r.x;
    slide.addText(runsToPptx(t.runs, bg), {
      ...textBase,
      objectName: `T${ti}`,
      x: inch(x), y: inch(r.y), w: inch(w), h: inch(r.h + 2),
      wrap: multi,
      lineSpacing: multi ? pt(t.runs.find((x) => x.lh)?.lh ?? 30) : undefined,
    });
  });
  for (const im of g.images) {
    if (im.png) { slide.addImage({ data: im.src.replace(/^data:/, ""), x: inch(im.x), y: inch(im.y), w: inch(im.w), h: inch(im.h) }); continue; }
    const svg = decodeURIComponent(im.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
    slide.addImage({ data: `image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`, x: inch(im.x), y: inch(im.y), w: inch(im.w), h: inch(im.h) });
  }
  void si;
});

// ---- zip post-processing ----
const raw = await pptx.write({ outputType: "nodebuffer" });
writeFileSync(join(outDir, "port-report.raw.pptx"), raw);
const zip = await JSZip.loadAsync(raw);
const stats = { charset: 0, pPr: 0, tblRtl: 0, ltrRuns: 0 };
const TOKEN = /[A-Za-z0-9][A-Za-z0-9.,%\-\/:+]*(?:\s*\/\s*[A-Za-z0-9][A-Za-z0-9.,%\-\/:+]*)*/g;
for (const name of Object.keys(zip.files).filter((n) => /^ppt\/(slides|charts)\/[^/]+\.xml$/.test(n))) {
  let xml = await zip.file(name).async("string");
  xml = xml.replace(/(<a:(?:latin|ea|cs|sym) typeface="[^"]*")(?: pitchFamily="[^"]*")?(?: charset="[^"]*")?/g, (mm, head) => { if (mm !== head) stats.charset++; return head; });
  // Every paragraph: rtl="1" algn="r".
  xml = xml.replace(/<a:p>(?!\s*<a:pPr)/g, '<a:p><a:pPr rtl="1" algn="r"/>');
  xml = xml.replace(/<a:pPr\b([^>]*?)(\/?)>/g, (mm, attrs, close) => { stats.pPr++; return `<a:pPr${attrs.replace(/\s(?:rtl|algn)="[^"]*"/g, "")} rtl="1" algn="r"${close}>`; });
  // Every table: right-to-left column order.
  xml = xml.replace(/<a:tblPr\b(?![^>]*rtl=)/g, () => { stats.tblRtl++; return '<a:tblPr rtl="1"'; });
  // Keep one a:pPr per paragraph (pptxgenjs writes one per run in multi-run text).
  xml = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (p, inner) => { let n = 0; return `<a:p>${inner.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pp) => (n++ ? "" : pp))}</a:p>`; });
  // Latin and digit tokens: own run, lang="en-US", run-level <a:rtl val="0"/>. Paragraph stays rtl="1" algn="r".
  if (name.includes("slides/")) xml = xml.replace(/<a:r>(<a:rPr\b[^>]*?)(\/>|>([\s\S]*?)<\/a:rPr>)<a:t>([^<]*)<\/a:t><\/a:r>/g, (mm, open, close, kids, t) => {
    const run = (txt, ltr) => {
      const o = ltr ? open.replace(/lang="[^"]*"/, 'lang="en-US"') : open;
      const k = (kids ?? "") + (ltr ? '<a:rtl val="0"/>' : "");
      return `<a:r>${k ? `${o}>${k}</a:rPr>` : `${o}/>`}<a:t>${txt}</a:t></a:r>`;
    };
    const parts = []; let last = 0;
    for (const m of t.matchAll(TOKEN)) { if (m.index > last) parts.push(run(t.slice(last, m.index), false)); parts.push(run(m[0], true)); stats.ltrRuns++; last = m.index + m[0].length; }
    if (!parts.length) return mm;
    if (last < t.length) parts.push(run(t.slice(last), false));
    return parts.join("");
  });
  // Page number «NN / TT»: NN becomes PowerPoint's slide-number field, so it stays right when
  // slides are moved, added or deleted in PowerPoint (a fixed «22» on slide 6 was reported).
  if (name.includes("slides/")) xml = xml.replace(/<a:r>(<a:rPr\b[^>]*?(?:\/>|>(?:(?!<\/?a:r>)[\s\S])*?<\/a:rPr>))<a:t>(\d{2,3}) \/ (\d+)<\/a:t><\/a:r>/g, (mm, rPr, num, total) => {
    stats.slideNum = (stats.slideNum ?? 0) + 1;
    return `<a:fld id="{5C1E9B1A-7D2B-4C3E-9F1A-2B6D8E4A0C11}" type="slidenum">${rPr}<a:t>${num}</a:t></a:fld><a:r>${rPr}<a:t> / ${total}</a:t></a:r>`;
  });
  // Two runs in a right-to-left paragraph display in reverse («48 / 25»): the page-number paragraph is left-to-right.
  if (name.includes("slides/")) xml = xml.replace(/<a:p>((?:(?!<\/a:p>)[\s\S])*?type="slidenum"[\s\S]*?<\/a:p>)/g, (p, inner) => `<a:p>${inner.replace(/<a:pPr\b([^>]*?)rtl="1"/, '<a:pPr$1rtl="0"')}`);
  zip.file(name, xml);
}
for (const name of Object.keys(zip.files).filter((n) => /^ppt\/(slideMasters|slideLayouts)\/[^/]+\.xml$/.test(n))) {
  const xml = (await zip.file(name).async("string")).replace(/rtl="0"/g, 'rtl="1"').replace(/algn="l"/g, 'algn="r"');
  zip.file(name, xml);
}
// Timeline: data labels only on the two series the HTML labels (all ports above, the port below);
// points on the tick marks like the svg (first/last month at the plot edges).
for (const { chart, series } of timelineMeta) {
  const name = `ppt/charts/chart${chart}.xml`;
  let xml = await zip.file(name).async("string");
  let idx = 0;
  xml = xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
    const s = series[idx++];
    let out = ser.replace(/(<c:spPr>\s*<a:ln[^>]*w=")\d+(")/, `$1${Math.round(s.width * 6350 * 0.75)}$2`);
    if (s.dash !== "solid") out = out.replace(/<a:prstDash val="[^"]*"\/>/, `<a:prstDash val="${s.dash}"/>`);
    const dl = !s.labels ? '<c:dLbls><c:delete val="1"/></c:dLbls>'
      : `<c:dLbls><c:numFmt formatCode="0&quot;%&quot;" sourceLinked="0"/><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr rtl="1" algn="r"><a:defRPr sz="800" b="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Somar Bold"/><a:cs typeface="Somar Bold"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:dLblPos val="${s.labels}"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`;
    out = out.replace(/<c:dLbls>[\s\S]*?<\/c:dLbls>/, dl);
    return out;
  });
  xml = xml.replace(/<c:crossBetween val="between"\/>/g, '<c:crossBetween val="midCat"/>');
  zip.file(name, xml);
}
const file = join(outDir, "port-report.pptx");
writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("wrote", file, `slides ${geo.length} charts ${chartNo}`, JSON.stringify(stats));
