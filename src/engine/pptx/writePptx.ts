import pptxgen from "pptxgenjs";
import type { Run } from "../layout/bidiRuns";
import { LAYOUT, lineHeightPx } from "../layout/layoutReport";
import { FIT_SAFETY } from "../layout/measure";
import type { BarChartBox, LayoutBox, LayoutDoc, TableBox, TextBox, TextCell } from "../layout/types";
import type { MeasureSpec, ThemeTokens } from "../spec/types";
import { postprocessPptx } from "./postprocess";
import { inFromPx, ptFromPx } from "./units";

/**
 * PPTX from the layout model, then post-processed (`postprocessPptx`).
 *
 * Figure traceability: every shape's name (`p:cNvPr name`) is its layout box id, which is the `LayoutFigure.boxId`
 * of text-box and bar-chart figures. A table figure's box id is `{tableBoxId}-r{row}c{col}`: the table shape is
 * named `{tableBoxId}` and the cell is the `a:tc` at that position (row 0 the header `a:tr`, columns in logical
 * order), since PPTX cells carry no name (C24).
 */
export async function writePptx(doc: LayoutDoc, theme: ThemeTokens, opts: { title: string; issuedAt: string }): Promise<Uint8Array> {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: "ENGINE", width: inFromPx(doc.width), height: inFromPx(doc.height) });
  pptx.layout = "ENGINE";
  pptx.rtlMode = true;
  pptx.theme = { headFontFace: theme.font, bodyFontFace: theme.font };
  pptx.title = opts.title;
  pptx.author = "";
  pptx.company = "";
  for (const s of doc.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(theme.ink.bg) };
    for (const b of s.boxes) addBox(pptx, slide, b, theme);
  }
  const raw = (await pptx.write({ outputType: "uint8array", compression: true })) as Uint8Array;
  return postprocessPptx(raw, opts.issuedAt);
}

/** Theme colours are `#RRGGBB` (validated by `themeIssues`); pptxgenjs wants them without the hash. */
const hex = (c: string): string => c.replace(/^#/, "").toUpperCase();

function addBox(pptx: pptxgen, slide: pptxgen.Slide, b: LayoutBox, theme: ThemeTokens): void {
  switch (b.kind) {
    case "text": addTextBox(slide, b, theme); return;
    case "table": addTable(slide, b, theme); return;
    case "bar": addBar(pptx, slide, b, theme); return;
    case "rect":
      slide.addShape(pptx.ShapeType.rect, {
        objectName: b.id, x: inFromPx(b.x), y: inFromPx(b.y), w: inFromPx(b.w), h: inFromPx(b.h),
        fill: { color: hex(b.fill) }, line: { type: "none" },
      });
      return;
    case "rule":
      slide.addShape(pptx.ShapeType.rect, {
        objectName: b.id, x: inFromPx(b.x), y: inFromPx(b.y), w: inFromPx(b.w), h: inFromPx(LAYOUT.ruleH),
        fill: { color: hex(b.color) }, line: { type: "none" },
      });
  }
}

interface RunStyle { sizePx: number; weight: 400 | 700; color: string; font: string }

/** One pptxgenjs text run per layout run; each recorded line after the first starts with a soft break (`a:br`). */
function runs(lines: Run[][], s: RunStyle): pptxgen.TextProps[] {
  const out: pptxgen.TextProps[] = [];
  lines.forEach((line, li) => {
    line.forEach((r, ri) => {
      out.push({
        text: r.text,
        options: {
          lang: r.ltr ? "en-US" : "ar-SA", fontFace: s.font, fontSize: ptFromPx(s.sizePx), bold: s.weight === 700,
          color: hex(s.color), lineSpacing: lineSpacingPt(s.sizePx), softBreakBefore: li > 0 && ri === 0 ? true : undefined,
        },
      });
    });
  });
  return out.length > 0 ? out : [{ text: "", options: { lang: "ar-SA" } }];
}

const lineSpacingPt = (sizePx: number): number => ptFromPx(lineHeightPx(sizePx));

/** Single-line boxes keep the frame with wrap off; wrapped boxes get `w x FIT_SAFETY` capped at the frame, anchored right. */
function addTextBox(slide: pptxgen.Slide, b: TextBox, theme: ThemeTokens): void {
  const multi = b.lines.length > 1;
  const w = multi ? Math.min(b.w * FIT_SAFETY, b.w) : b.w;
  const x = b.x + b.w - w;
  slide.addText(runs(b.lines, { sizePx: b.sizePx, weight: b.weight, color: b.color, font: theme.font }), {
    objectName: b.id, x: inFromPx(x), y: inFromPx(b.y), w: inFromPx(w), h: inFromPx(b.h),
    margin: 0, fit: "none", wrap: multi, valign: "top", align: "right", rtlMode: true, lang: "ar-SA",
    fontFace: theme.font, lineSpacing: lineSpacingPt(b.sizePx),
  });
}

function cellOf(c: TextCell, color: string, fill: string, rule: { pt: number; color: string }, theme: ThemeTokens): pptxgen.TableCell {
  // Values under 1 are read as inches by pptxgenjs, so zero top/bottom and the layout's px padding left/right.
  const pad = inFromPx(LAYOUT.cellPad);
  return {
    text: runs(c.lines, { sizePx: c.sizePx, weight: c.weight, color, font: theme.font }),
    options: {
      fontFace: theme.font, fontSize: ptFromPx(c.sizePx), bold: c.weight === 700, color: hex(color),
      align: "right", valign: "middle", lang: "ar-SA", margin: [0, pad, 0, pad], fill: { color: hex(fill) },
      border: [{ type: "none" }, { type: "none" }, { type: "solid", pt: rule.pt, color: hex(rule.color) }, { type: "none" }],
    },
  };
}

function addTable(slide: pptxgen.Slide, b: TableBox, theme: ThemeTokens): void {
  const head = b.header.map((c) => cellOf(c, theme.ink.bg, theme.ink.navy, { pt: ptFromPx(2), color: theme.ink.gold }, theme));
  const body = b.rows.map((r) => r.map((c) => cellOf(c, theme.ink.text, theme.ink.bg, { pt: ptFromPx(1), color: theme.ink.hair }, theme)));
  const w = b.colW.reduce((a, x) => a + x, 0);
  slide.addTable([head, ...body], {
    objectName: b.id, x: inFromPx(b.x), y: inFromPx(b.y), w: inFromPx(w), colW: b.colW.map(inFromPx),
    rowH: [LAYOUT.headerH, ...b.rows.map(() => b.rowH)].map(inFromPx), autoPage: false,
  });
}

/** Excel number format for chart labels; cached values are at display precision. */
function labelFormat(f: MeasureSpec["format"]): string {
  const dec = f.digits > 0 ? `.${"0".repeat(f.digits)}` : "";
  return f.kind === "pct" ? `0${dec}"%"` : `#,##0${dec}`;
}

function cachedValue(v: number | null, f: MeasureSpec["format"]): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const shown = f.kind === "pct" ? v * 100 : v;
  return Number(shown.toFixed(f.digits));
}

/** Native clustered column chart with its embedded workbook; first category on the right (`maxMin`). */
function addBar(pptx: pptxgen, slide: pptxgen.Slide, b: BarChartBox, theme: ThemeTokens): void {
  const data = [{ name: b.id, labels: b.categories, values: b.values.map((v) => cachedValue(v, b.format)) }];
  slide.addChart(pptx.ChartType.bar, data as pptxgen.OptsChartData[], {
    objectName: b.id, x: inFromPx(b.x), y: inFromPx(b.y), w: inFromPx(b.w), h: inFromPx(b.h),
    barDir: "col", barGrouping: "clustered", chartColors: [hex(b.color)], showLegend: false,
    valAxisHidden: true, valAxisMinVal: 0, valGridLine: { style: "none" }, valAxisLineShow: false,
    // The bundled types list only "minMax"; the writer accepts "maxMin" (poc/port-pptx).
    catAxisOrientation: "maxMin" as "minMax", catAxisLineShow: false, catAxisLabelFontFace: theme.font,
    catAxisLabelFontSize: ptFromPx(LAYOUT.barLabelPx), catAxisLabelColor: hex(theme.ink.muted),
    showValue: true, dataLabelPosition: "outEnd", dataLabelFontFace: theme.font, dataLabelFontSize: ptFromPx(LAYOUT.barLabelPx),
    dataLabelColor: hex(theme.ink.text), dataLabelFormatCode: labelFormat(b.format), lang: "ar-SA",
  });
}
