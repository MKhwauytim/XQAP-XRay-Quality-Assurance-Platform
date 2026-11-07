// PoC: model.mjs -> out/poc.pptx via pptxgenjs 4.0.1 (Node).
import { mkdirSync, writeFileSync } from "node:fs";
import JSZip from "jszip"; // already a pptxgenjs dependency
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pptxgen from "pptxgenjs";
import { model, pxToIn, pxToPt } from "./model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

const pptx = new pptxgen();
pptx.defineLayout({ name: "DECK3", width: pxToIn(model.slide.w), height: pxToIn(model.slide.h) });
pptx.layout = "DECK3";
pptx.rtlMode = true;
pptx.theme = { headFontFace: model.font, bodyFontFace: model.font, lang: "ar-SA" };

const slide = pptx.addSlide();
slide.background = { color: model.bg };

const geo = (b) => ({ x: pxToIn(b.x), y: pxToIn(b.y), w: pxToIn(b.w), h: pxToIn(b.h) });
// R6: a number-only run ("85.5%") in an rtl="1" paragraph is reordered by PowerPoint to "%85.5";
// Chromium keeps "85.5%". So paragraphs with no Arabic letters are written LTR (still right-aligned).
const hasArabic = (s) => /[؀-ۿ]/.test(s);
const textBase = { fontFace: model.font, rtlMode: true, lang: "ar-SA", margin: 0, fit: "none", valign: "top", wrap: false };

for (const b of model.boxes) {
  if (b.kind === "rect") {
    slide.addShape(pptx.ShapeType.rect, { ...geo(b), fill: { color: b.fill }, line: { type: "none" } });
  } else if (b.kind === "text") {
    slide.addText(b.text, {
      ...geo(b), ...textBase,
      rtlMode: hasArabic(b.text),
      fontSize: pxToPt(b.size), bold: b.weight >= 700, color: b.color, align: b.align,
      lineSpacing: pxToPt(b.lineHeight),
    });
  } else if (b.kind === "table") {
    // RTL: OOXML tables have no reliable rtl flag in pptxgenjs, so mirror the
    // column order by hand (x' = W - x - w): logical col 0 becomes the rightmost.
    const order = b.colW.map((_, i) => i).reverse();
    const border = (r) => (r ? { type: "solid", pt: pxToPt(r.px), color: r.color } : { type: "none" });
    const mk = (txt, st, isHeader) => ({
      text: txt,
      options: {
        ...textBase, rtlMode: hasArabic(txt), fontSize: pxToPt(st.size), bold: st.weight >= 700, color: st.color, align: "right", valign: "middle",
        // [T, R, B, L] inches; CSS padding-left 14px
        margin: [0, pxToIn(b.padStart), 0, pxToIn(b.padEnd)],
        border: [border(isHeader ? st.topRule : null), { type: "none" }, border(st.bottomRule), { type: "none" }],
        fill: { color: model.bg },
      },
    });
    const rows = [
      order.map((c) => mk(b.header[c], b.headerStyle, true)),
      ...b.rows.map((r) => order.map((c) => mk(r[c], b.cellStyle, false))),
    ];
    slide.addTable(rows, {
      x: pxToIn(b.x), y: pxToIn(b.y), w: pxToIn(b.w),
      colW: order.map((c) => pxToIn(b.colW[c])),
      rowH: pxToIn(b.rowH),
      autoPage: false,
    });
  } else if (b.kind === "chart") {
    const p = b.plot;
    slide.addChart(pptx.ChartType.bar, [{ name: b.seriesName, labels: b.categories, values: b.values }], {
      ...geo(b),
      barDir: "col",
      chartColors: [b.barColor],
      barGapWidthPct: 60,
      layout: { x: p.left / b.w, y: p.top / b.h, w: (b.w - p.left - p.right) / b.w, h: (b.h - p.top - p.bottom) / b.h },
      showLegend: false,
      valAxisMinVal: b.axis.min, valAxisMaxVal: b.axis.max, valAxisMajorUnit: b.axis.step,
      valAxisLabelFontFace: model.font, valAxisLabelFontSize: pxToPt(b.valSize), valAxisLabelColor: b.labelColor,
      valGridLine: { color: b.gridColor, size: 0.75 },
      catAxisLabelFontFace: model.font, catAxisLabelFontSize: pxToPt(b.catSize), catAxisLabelColor: b.labelColor,
      catAxisLineShow: true, catAxisLineColor: b.gridColor, valAxisLineShow: false,
      catAxisOrientation: "maxMin", // RTL: first category on the right
      showValue: true, dataLabelPosition: "outEnd", dataLabelFontFace: model.font,
      dataLabelFontSize: pxToPt(b.dataLabelSize), dataLabelColor: b.valueColor, dataLabelFontBold: true,
      dataLabelFormatCode: "0.0",
      lang: "ar-SA",
    });
  }
}

// Zip post-processing (research §3-a). pptxgenjs writes every run's font as
//   <a:ea ... charset="-122"/> (GB2312) and <a:cs ... charset="-120"/> (Big5).
// With a non-Office font like Somar, PowerPoint honours that charset and maps
// Latin digits in ar-SA runs to garbage glyphs (see out/pptx-raw-charset-bug.png).
// Stripping pitchFamily/charset lets PowerPoint use the font's own cmap.
const raw = await pptx.write({ outputType: "nodebuffer" });
writeFileSync(join(outDir, "poc.raw.pptx"), raw);
const zip = await JSZip.loadAsync(raw);
let fixed = 0;
for (const name of Object.keys(zip.files).filter((n) => /^ppt\/(slides|charts)\/[^/]+\.xml$/.test(n))) {
  const xml = await zip.file(name).async("string");
  const out = xml.replace(/(<a:(?:latin|ea|cs|sym) typeface="[^"]*")(?: pitchFamily="[^"]*")?(?: charset="[^"]*")?/g, (m, head) => {
    if (m !== head) fixed++;
    return head;
  });
  // R6: omitting rtl is not enough — PowerPoint still rendered "%85.5". Number-only
  // paragraphs get an explicit rtl="0" and their runs lang="en-US".
  const out2 = out.replace(/<a:p>(?:(?!<\/a:p>).)*<\/a:p>/gs, (p) => {
    const text = [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("");
    if (!text || hasArabic(text) || !name.includes("slides/")) return p;
    return p.replace(/<a:pPr(?![^>]*rtl=)/, '<a:pPr rtl="0"').replace(/lang="ar-SA"/g, 'lang="en-US"');
  });
  zip.file(name, out2);
}
const file = join(outDir, "poc.pptx");
writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("wrote", file, `(stripped charset on ${fixed} font refs)`);
