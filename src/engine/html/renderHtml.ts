import type { Run } from "../layout/bidiRuns";
import { LAYOUT } from "../layout/layoutReport";
import type { BarChartBox, LayoutBox, LayoutDoc, LayoutSlide, RectBox, RuleBox, TableBox, TextBox, TextCell } from "../layout/types";
import { formatValue } from "../resolve/resolve";
import type { ThemeTokens } from "../spec/types";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const runHtml = (r: Run): string => (r.ltr ? `<span dir="ltr">${esc(r.text)}</span>` : esc(r.text));
/** Recorded lines joined with `<br>`; the line count equals the layout's (M2). */
const linesHtml = (lines: Run[][]): string => lines.map((l) => l.map(runHtml).join("")).join("<br>");

const px = (n: number): string => `${n}px`;
const geom = (x: number, y: number, w: number, h: number): string =>
  `left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}`;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const lineHeight = (sizePx: number): number => Math.round(sizePx * 1.4);

function textBox(b: TextBox): string {
  const attrs = b.valueKeys.length > 0 ? ` data-value-key="${esc(b.valueKeys.join(" "))}"` : "";
  const style = `${geom(b.x, b.y, b.w, b.h)};font-size:${px(b.sizePx)};font-weight:${b.weight};line-height:${px(lineHeight(b.sizePx))};color:${b.color}`;
  return `<div class="box t" data-box="${esc(b.id)}"${attrs} style="${style}">${linesHtml(b.lines)}</div>`;
}

function cell(tag: "th" | "td", c: TextCell): string {
  let attrs = ` data-box="${esc(c.id)}"`;
  if (c.valueKey !== undefined) attrs += ` data-value-key="${esc(c.valueKey)}"`;
  if (c.groupKey !== undefined) attrs += ` data-group-key="${esc(c.groupKey)}"`;
  const style = `font-size:${px(c.sizePx)};font-weight:${c.weight};line-height:${px(lineHeight(c.sizePx))}`;
  return `<${tag}${attrs} style="${style}">${linesHtml(c.lines)}</${tag}>`;
}

function tableBox(b: TableBox): string {
  const width = b.colW.reduce((a, w) => a + w, 0);
  const cols = b.colW.map((w) => `<col style="width:${px(w)}">`).join("");
  const head = `<tr class="h" style="height:${px(LAYOUT.headerH)}">${b.header.map((c) => cell("th", c)).join("")}</tr>`;
  const body = b.rows.map((r) => `<tr style="height:${px(b.rowH)}">${r.map((c) => cell("td", c)).join("")}</tr>`).join("");
  const h = LAYOUT.headerH + b.rows.length * b.rowH;
  return `<div class="box" data-box="${esc(b.id)}" style="${geom(b.x, b.y, width, h)}">` +
    `<table style="width:${px(width)}"><colgroup>${cols}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

const BAR_LABEL_PX = 20;

function barChart(b: BarChartBox, theme: ThemeTokens): string {
  const n = b.categories.length;
  const plotH = Math.max(0, b.h - BAR_LABEL_PX * 3 - 16);
  const baseY = BAR_LABEL_PX + 8 + plotH;
  const max = Math.max(0, ...b.values.map((v) => (v === null ? 0 : v)));
  const slot = n > 0 ? b.w / n : 0;
  const barW = Math.round(slot * 0.6);
  const parts: string[] = [`<line x1="0" y1="${baseY}" x2="${b.w}" y2="${baseY}" stroke="${theme.ink.hair}" stroke-width="2"/>`];
  for (let i = 0; i < n; i++) {
    // RTL: the first category sits at the right edge.
    const cx = b.w - slot * (i + 0.5);
    const v = b.values[i];
    const hh = v === null || max === 0 ? 0 : Math.round((v / max) * plotH);
    const display = v === null ? "-" : formatValue(v, b.format);
    const key = b.valueKeys[i] !== undefined ? ` data-value-key="${esc(b.valueKeys[i])}"` : "";
    parts.push(
      `<g${key}>` +
        (hh > 0 ? `<rect x="${Math.round(cx - barW / 2)}" y="${baseY - hh}" width="${barW}" height="${hh}" fill="${b.color}"/>` : "") +
        `<text x="${Math.round(cx)}" y="${baseY - hh - 8}" text-anchor="middle" font-size="${BAR_LABEL_PX}" fill="${theme.ink.text}" direction="ltr">${esc(display)}</text>` +
        `<text x="${Math.round(cx)}" y="${baseY + BAR_LABEL_PX + 8}" text-anchor="middle" font-size="${BAR_LABEL_PX}" fill="${theme.ink.muted}" direction="rtl">${esc(b.categories[i])}</text>` +
        `</g>`,
    );
  }
  return `<div class="box" data-box="${esc(b.id)}" style="${geom(b.x, b.y, b.w, b.h)}">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="0 0 ${b.w} ${b.h}">${parts.join("")}</svg></div>`;
}

const rectBox = (b: RectBox): string =>
  `<div class="box" data-box="${esc(b.id)}" style="${geom(b.x, b.y, b.w, b.h)};background:${b.fill}"></div>`;
const ruleBox = (b: RuleBox): string =>
  `<div class="box" data-box="${esc(b.id)}" style="${geom(b.x, b.y, b.w, LAYOUT.ruleH)};background:${b.color}"></div>`;

function box(b: LayoutBox, theme: ThemeTokens): string {
  switch (b.kind) {
    case "text": return textBox(b);
    case "table": return tableBox(b);
    case "bar": return barChart(b, theme);
    case "rect": return rectBox(b);
    case "rule": return ruleBox(b);
  }
}

const slideHtml = (s: LayoutSlide, theme: ThemeTokens): string =>
  `<section class="slide" data-slide="${s.index}" data-page="${esc(s.pageId)}">${s.boxes.map((b) => box(b, theme)).join("")}</section>`;

function css(theme: ThemeTokens): string {
  const fontFace = theme.fontData
    ? `@font-face { font-family: "${theme.font}"; src: url(data:font/ttf;base64,${toBase64(theme.fontData)}) format("truetype"); }\n`
    : "";
  return `${fontFace}* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${theme.ink.panel}; font-family: "${theme.font}", sans-serif; color: ${theme.ink.text}; }
.slide { position: relative; width: ${LAYOUT.slideW}px; height: ${LAYOUT.slideH}px; margin: 0 auto 24px; overflow: hidden; background: ${theme.ink.bg}; }
.box { position: absolute; }
.t { white-space: nowrap; text-align: right; overflow: visible; }
table { border-collapse: collapse; table-layout: fixed; }
th, td { padding: 0 ${LAYOUT.cellPad}px; text-align: right; vertical-align: middle; white-space: nowrap; overflow: hidden; border-bottom: 1px solid ${theme.ink.hair}; color: ${theme.ink.text}; }
th { background: ${theme.ink.navy}; color: ${theme.ink.bg}; border-bottom: 2px solid ${theme.ink.gold}; }
svg text { font-family: "${theme.font}", sans-serif; }
@media print { @page { size: ${LAYOUT.slideW}px ${LAYOUT.slideH}px; margin: 0 } body { background: ${theme.ink.bg}; } .slide { margin: 0; break-after: page; } }`;
}

/** Static HTML from the layout model (decision 15): no script, no form control, no external URL. Positions come from the boxes only. */
export function renderHtml(doc: LayoutDoc, theme: ThemeTokens, opts: { title: string }): string {
  return `<!DOCTYPE html>
<html lang="ar-SA" dir="rtl">
<head>
<meta charset="utf-8">
<title>${esc(opts.title)}</title>
<style>
${css(theme)}
</style>
</head>
<body>
${doc.slides.map((s) => slideHtml(s, theme)).join("\n")}
</body>
</html>
`;
}
