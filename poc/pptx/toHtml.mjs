// PoC: model.mjs -> out/poc.html (position:absolute boxes, Somar, dir=rtl, SVG chart).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { model } from "./model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

// Edge headless did not resolve the per-user-installed "Somar" by name (fell back
// to Times), so load the same installed TTFs explicitly — mirrors the app, which
// embeds Somar via @font-face (src/branding/fonts.ts).
const FONT_DIR = "file:///" + (process.env.LOCALAPPDATA || "").replace(/\\/g, "/") + "/Microsoft/Windows/Fonts";
const esc =(s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const pos = (b) => `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;`;
const hex = (c) => `#${c}`;

const parts = [];
for (const b of model.boxes) {
  if (b.kind === "rect") {
    parts.push(`<div class="abs" style="${pos(b)}background:${hex(b.fill)}"></div>`);
  } else if (b.kind === "text") {
    parts.push(
      `<div class="abs t" style="${pos(b)}font-size:${b.size}px;font-weight:${b.weight};color:${hex(b.color)};text-align:${b.align};line-height:${b.lineHeight}px">${esc(b.text)}</div>`,
    );
  } else if (b.kind === "table") {
    const cols = b.colW.map((w) => `<col style="width:${w}px">`).join("");
    const cell = (tag, txt, st, isHeader) => {
      const top = isHeader && st.topRule ? `border-top:${st.topRule.px}px solid ${hex(st.topRule.color)};` : "";
      const bot = st.bottomRule ? `border-bottom:${st.bottomRule.px}px solid ${hex(st.bottomRule.color)};` : "";
      return `<${tag} style="${top}${bot}font-size:${st.size}px;font-weight:${st.weight};color:${hex(st.color)};padding:0 ${b.padStart}px 0 ${b.padEnd}px;height:${b.rowH}px">${esc(txt)}</${tag}>`;
    };
    const head = `<tr>${b.header.map((h) => cell("th", h, b.headerStyle, true)).join("")}</tr>`;
    const body = b.rows.map((r) => `<tr>${r.map((v) => cell("td", v, b.cellStyle, false)).join("")}</tr>`).join("");
    parts.push(`<table class="abs tbl" style="left:${b.x}px;top:${b.y}px;width:${b.w}px"><colgroup>${cols}</colgroup>${head}${body}</table>`);
  } else if (b.kind === "chart") {
    const p = b.plot;
    const pw = b.w - p.left - p.right, ph = b.h - p.top - p.bottom;
    const { min, max, step } = b.axis;
    const yOf = (v) => p.top + ph - ((v - min) / (max - min)) * ph;
    const n = b.values.length, slot = pw / n, gap = 0.6; // barGapWidthPct 60
    const barW = slot / (1 + gap);
    const svg = [];
    for (let v = min; v <= max; v += step) {
      const y = yOf(v);
      svg.push(`<line x1="${p.left}" x2="${p.left + pw}" y1="${y}" y2="${y}" stroke="${hex(b.gridColor)}" stroke-width="1"/>`);
      // value axis on the RIGHT (cat axis maxMin)
      svg.push(`<text x="${p.left + pw + 12}" y="${y}" dominant-baseline="middle" text-anchor="start" font-size="${b.valSize}" fill="${hex(b.labelColor)}">${v}</text>`);
    }
    b.values.forEach((v, i) => {
      // RTL: category 0 rightmost
      const sx = p.left + pw - (i + 1) * slot;
      const bx = sx + (slot - barW) / 2;
      const y = yOf(v);
      svg.push(`<rect x="${bx}" y="${y}" width="${barW}" height="${yOf(min) - y}" fill="${hex(b.barColor)}"/>`);
      svg.push(`<text x="${bx + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="${b.dataLabelSize}" font-weight="700" fill="${hex(b.valueColor)}">${v.toFixed(1)}</text>`);
      svg.push(`<text x="${sx + slot / 2}" y="${p.top + ph + 30}" text-anchor="middle" font-size="${b.catSize}" fill="${hex(b.labelColor)}" direction="rtl">${esc(b.categories[i])}</text>`);
    });
    parts.push(`<svg class="abs" style="${pos(b)}" viewBox="0 0 ${b.w} ${b.h}" width="${b.w}" height="${b.h}">${svg.join("")}</svg>`);
  }
}

const html = `<!doctype html>
<html lang="ar-SA" dir="rtl"><head><meta charset="utf-8"><title>PPTX PoC</title>
<style>
@font-face{font-family:"${model.font}";src:url("${FONT_DIR}/Somar-Regular.ttf");font-weight:400;}
@font-face{font-family:"${model.font}";src:url("${FONT_DIR}/Somar-Bold.ttf");font-weight:700;}
html,body{margin:0;padding:0;background:${hex(model.bg)};}
.slide{position:relative;width:${model.slide.w}px;height:${model.slide.h}px;overflow:hidden;background:${hex(model.bg)};font-family:"${model.font}";}
.abs{position:absolute;margin:0;box-sizing:border-box;}
.t{white-space:nowrap;overflow:visible;}
.tbl{border-collapse:collapse;table-layout:fixed;font-family:"${model.font}";}
.tbl th,.tbl td{box-sizing:border-box;text-align:right;white-space:nowrap;line-height:1;vertical-align:middle;}
svg text{font-family:"${model.font}";}
</style></head>
<body><div class="slide" dir="rtl">${parts.join("\n")}</div></body></html>
`;
const file = join(outDir, "poc.html");
writeFileSync(file, html);
console.log("wrote", file);
